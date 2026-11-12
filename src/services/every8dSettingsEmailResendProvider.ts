import { addAbortListener } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request, type RequestOptions } from "node:https";
import { parseEvery8dSettingsEmailResendApiKey } from "../config/every8dSettingsEmailResend";
import type {
  Every8dSettingsEmailProvider,
  Every8dSettingsEmailProviderInput,
  Every8dSettingsEmailProviderResult as Result,
} from "../types/every8dSettingsEmailProvider";

const maxHeaders = 16 * 1024;
const maxBody = 16_384;
const nsPerMs = 1_000_000n;
const unknown = Object.freeze({ outcome: "outcome_unknown" } as const);
const notStarted = Object.freeze({
  outcome: "not_accepted_retryable", evidence: Object.freeze({ kind: "transport_not_started" }),
} as const);
const notAccepted = Object.freeze({
  outcome: "not_accepted_retryable", evidence: Object.freeze({ kind: "authoritative_non_acceptance" }),
} as const);

type RequestTransport = (options: RequestOptions, onResponse: (res: IncomingMessage) => void) => ClientRequest;

function prepareRequest(apiKey: string, input: Every8dSettingsEmailProviderInput) {
  const { canonicalSender, recipient, subject, body, idempotencyKey } = input;
  if ([canonicalSender, recipient, subject, body, idempotencyKey].some((field) => typeof field !== "string") ||
      !idempotencyKey || Buffer.byteLength(idempotencyKey, "utf8") > 256 || /[^\x21-\x7e]/.test(idempotencyKey)) {
    throw new Error("Invalid Resend email request.");
  }
  const payload = Buffer.from(JSON.stringify({ from: canonicalSender, to: [recipient], subject, text: body }));
  const options: RequestOptions = {
    protocol: "https:", hostname: "api.resend.com", path: "/emails", method: "POST",
    agent: false, rejectUnauthorized: true, maxHeaderSize: maxHeaders,
  };
  // Keep sensitive headers out of Node's connection options and diagnostics.
  const headers = {
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Encoding": "identity",
    "Idempotency-Key": idempotencyKey,
    "Content-Length": payload.byteLength,
  };
  return { options, headers, payload };
}

function responseLength(rawHeaders: string[]): number | undefined {
  const headers = new Map<string, string>();
  let size = 2;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toLowerCase();
    const value = rawHeaders[i + 1];
    size += Buffer.byteLength(rawHeaders[i], "latin1") + Buffer.byteLength(value, "latin1") + 4;
    if (size > maxHeaders) return undefined;
    if (name === "content-type" || name === "content-encoding" || name === "content-length") {
      if (headers.has(name)) return undefined;
      headers.set(name, value);
    }
  }
  const mediaType = headers.get("content-type");
  const encoding = headers.get("content-encoding");
  if (!mediaType || !/^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?[ \t]*$/i.test(mediaType) ||
      (encoding !== undefined && encoding !== "identity")) return undefined;
  const length = headers.get("content-length");
  if (length === undefined) return -1;
  if (!length || /[^0-9]/.test(length) || Number(length) > maxBody) return undefined;
  return Number(length);
}

function parseEvidence(bytes: Buffer, status: number): Record<string, unknown> | undefined {
  const json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const object: unknown = JSON.parse(json);
  if (typeof object !== "object" || object === null || Array.isArray(object)) return undefined;

  // JSON.parse validates the grammar but collapses duplicate keys. Count decoded
  // evidence keys at depth one, including escaped spellings of the same key.
  const evidenceKeys = status === 200 ? ["id"] : ["name", "message", "statusCode"];
  const seen = new Set<string>();
  let depth = 0;
  let previous = "";
  for (const [token] of json.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:]/g)) {
    if (token === ":" && depth === 1) {
      const key: string = JSON.parse(previous);
      if (evidenceKeys.includes(key)) {
        if (seen.has(key)) return undefined;
        seen.add(key);
      }
    }
    if (token === "{" || token === "[") depth++;
    if (token === "}" || token === "]") depth--;
    previous = token;
  }
  return object as Record<string, unknown>;
}

function classify(status: number, bytes: Buffer): { result: Result; fatal: boolean } {
  let object: Record<string, unknown> | undefined;
  try { object = parseEvidence(bytes, status); } catch { /* Invalid UTF-8 or JSON. */ }

  if (status === 200) {
    const id = object?.id;
    if (object && Object.keys(object).length === 1 && Object.hasOwn(object, "id") && typeof id === "string" &&
        id.length >= 1 && id.length <= 255 && !/[^\x21-\x7e]/.test(id)) {
      return { result: Object.freeze({
        outcome: "accepted", evidence: "authoritative_acceptance", providerMessageId: id,
      }), fatal: false };
    }
    return { result: unknown, fatal: true };
  }

  if (!object || !Object.hasOwn(object, "name") || !Object.hasOwn(object, "message") ||
      typeof object.name !== "string" || typeof object.message !== "string" ||
      (Object.hasOwn(object, "statusCode") && (!Number.isInteger(object.statusCode) || object.statusCode !== status))) {
    return { result: unknown, fatal: false };
  }

  const { name } = object;
  if ((status === 401 && ["missing_api_key", "validation_error"].includes(name)) ||
      (status === 403 && ["invalid_permission", "restricted_api_key", "suspended_api_key"].includes(name))) {
    return { result: notAccepted, fatal: true };
  }
  const fatal = (status === 400 && ["invalid_idempotency_key", "validation_error"].includes(name)) ||
    (status === 409 && name === "invalid_idempotent_request") ||
    (status === 422 && ["missing_required_field", "missing_required_parameter", "invalid_parameter", "invalid_attachment"].includes(name)) ||
    (status === 429 && ["daily_quota_exceeded", "monthly_quota_exceeded"].includes(name));
  return { result: unknown, fatal };
}

function dispatch(
  { options, headers, payload }: ReturnType<typeof prepareRequest>,
  signal: AbortSignal,
  deadline: bigint,
  transport: RequestTransport,
  reportProviderFatal: () => void,
): Promise<Result> {
  return new Promise((resolve) => {
    let enteredTransport = false;
    let settled = false;
    let reportedFatal = false;
    let outgoing: ClientRequest | undefined;
    let incoming: IncomingMessage | undefined;
    let responseEnded = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: ReturnType<typeof addAbortListener> | undefined;
    let requestBody: Buffer | undefined = payload;
    let responseBody: Buffer | undefined;

    const reportFatal = () => {
      if (reportedFatal) return;
      reportedFatal = true;
      try { reportProviderFatal(); } catch { /* The observer supplies no delivery evidence. */ }
    };
    const releaseBody = () => {
      requestBody?.fill(0);
      requestBody = undefined;
    };
    const finish = (result: Result, fatal = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortListener?.[Symbol.dispose]();
      if (!responseEnded) {
        incoming?.destroy();
        outgoing?.destroy();
      }
      incoming = undefined;
      outgoing = undefined;
      releaseBody();
      responseBody?.fill(0);
      responseBody = undefined;
      if (fatal) reportFatal();
      resolve(result);
    };
    const cancel = () => finish(enteredTransport ? unknown : notStarted);
    const expired = () => signal.aborted || process.hrtime.bigint() >= deadline;
    const failTransport = () => finish(unknown);
    const armDeadline = () => {
      const remaining = deadline - process.hrtime.bigint();
      if (remaining <= 0n) { cancel(); return; }
      const delay = (remaining + nsPerMs - 1n) / nsPerMs;
      timer = setTimeout(armDeadline, Number(delay > 2_147_483_647n ? 2_147_483_647n : delay));
    };

    const onResponse = (res: IncomingMessage) => {
      res.on("error", failTransport);
      if (settled) { res.destroy(); return; }
      incoming = res;
      res.once("close", failTransport);
      if (expired()) { cancel(); return; }
      const status = res.statusCode ?? 0;
      if ((status > 200 && status < 400) || status === 404 || status === 405) {
        finish(unknown, true);
        return;
      }
      // These statuses are fatal independently of the body. Keep reading bounded
      // evidence because only specific complete error objects prove non-acceptance.
      if (status === 401 || status === 403) reportFatal();
      if (settled) return;
      if (![200, 400, 401, 403, 409, 422, 429].includes(status)) {
        finish(unknown);
        return;
      }

      const length = responseLength(res.rawHeaders);
      if (length === undefined) { finish(unknown, status === 200); return; }
      responseBody = Buffer.alloc(maxBody);
      let bytesRead = 0;
      res.on("data", (chunk: Buffer) => {
        if (!responseBody) return;
        if (expired()) { cancel(); return; }
        const nextLength = bytesRead + chunk.byteLength;
        if (nextLength > maxBody || (length !== -1 && nextLength > length)) {
          finish(unknown, status === 200);
          return;
        }
        chunk.copy(responseBody, bytesRead);
        bytesRead = nextLength;
      });
      res.once("end", () => {
        if (!responseBody) return;
        if (expired()) { cancel(); return; }
        if (!res.complete) { failTransport(); return; }
        responseEnded = true;
        if (length !== -1 && length !== bytesRead) { finish(unknown, status === 200); return; }
        const { result, fatal } = classify(status, responseBody.subarray(0, bytesRead));
        if (expired()) { cancel(); return; }
        finish(result, fatal);
      });
    };

    try {
      abortListener = addAbortListener(signal, cancel);
      armDeadline();
      if (settled || signal.aborted || deadline - process.hrtime.bigint() < nsPerMs) { cancel(); return; }
      enteredTransport = true;
      const active = transport(options, onResponse);
      active.on("error", failTransport);
      active.once("close", failTransport);
      if (settled) { active.destroy(); return; }
      outgoing = active;
      // Read all header fields up to the byte limit, including duplicates.
      active.maxHeadersCount = 0;
      if (expired()) { cancel(); return; }
      for (const [name, value] of Object.entries(headers)) active.setHeader(name, value);
      if (expired()) { cancel(); return; }
      active.end(requestBody, releaseBody);
    } catch {
      finish(enteredTransport ? unknown : notStarted, !enteredTransport);
    }
  });
}

export function createEvery8dSettingsEmailResendProvider({
  apiKey,
  reportProviderFatal,
  requestForTest = request,
}: Readonly<{ apiKey: string; reportProviderFatal(): void; requestForTest?: RequestTransport }>): Every8dSettingsEmailProvider {
  const admittedKey = parseEvery8dSettingsEmailResendApiKey(apiKey);
  if (admittedKey === undefined) throw new Error("Invalid Resend email configuration.");

  return Object.freeze({
    async send(input: Every8dSettingsEmailProviderInput): Promise<Result> {
      try {
        const { signal, deadlineMonotonicNs } = input;
        if (signal.aborted || deadlineMonotonicNs - process.hrtime.bigint() < nsPerMs) return notStarted;
        return dispatch(prepareRequest(admittedKey, input), signal, deadlineMonotonicNs, requestForTest, reportProviderFatal);
      } catch {
        try { reportProviderFatal(); } catch { /* The observer supplies no delivery evidence. */ }
        return notStarted;
      }
    },
  });
}
