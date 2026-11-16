import { parseEvery8dSettingsEmailResendApiKey } from "../config/every8dSettingsEmailResend";
import type {
  Every8dSettingsEmailProvider,
  Every8dSettingsEmailProviderInput,
  Every8dSettingsEmailProviderResult as Result,
} from "../types/every8dSettingsEmailProvider";
import { exchangeResendHttp, resendHost, resendMinimumBudgetNs, type ResendSocketConnectors }
  from "./every8dSettingsEmailResendTransport";

const unknown = Object.freeze({ outcome: "outcome_unknown" } as const);
const notStarted = Object.freeze({
  outcome: "not_accepted_retryable", evidence: Object.freeze({ kind: "transport_not_started" }),
} as const);
const notAccepted = Object.freeze({
  outcome: "not_accepted_retryable", evidence: Object.freeze({ kind: "authoritative_non_acceptance" }),
} as const);

function prepareRequest(apiKey: string, input: Every8dSettingsEmailProviderInput): Buffer {
  const { canonicalSender, recipient, subject, body, idempotencyKey } = input;
  if ([canonicalSender, recipient, subject, body, idempotencyKey].some((field) => typeof field !== "string") ||
      !idempotencyKey || Buffer.byteLength(idempotencyKey, "utf8") > 256 || /[^\x21-\x7e]/.test(idempotencyKey)) {
    throw new Error("Invalid Resend email request.");
  }
  const json = JSON.stringify({ from: canonicalSender, to: [recipient], subject, text: body });
  const headers = [
    "POST /emails HTTP/1.1",
    "Host: " + resendHost,
    "Authorization: Bearer " + apiKey,
    "Content-Type: application/json",
    "Accept: application/json",
    "Accept-Encoding: identity",
    "Idempotency-Key: " + idempotencyKey,
    "Content-Length: " + Buffer.byteLength(json, "utf8"),
    "Connection: close",
    "", "",
  ];
  return Buffer.from(headers.join("\r\n") + json, "utf8");
}

type JsonEvidence = { kind: "string" | "number" | "other"; text: string };
const other: JsonEvidence = { kind: "other", text: "" };
const relevantKeys = new Set(["id", "name", "message", "statusCode"]);

// Validate every token and container while retaining only top-level evidence.
// A single validated string token can use the built-in escape decoder.
function parseEvidence(bytes: Buffer, status: number) {
  const json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const tokenPattern = /[ \t\r\n]*("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9A-Fa-f]{4}))*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null|[{}\[\]:,])/y;
  const members = new Map<string, JsonEvidence>();
  let count = 0;
  let duplicate = false;
  let position = 0;
  const invalid = () => { throw new Error("Invalid Resend evidence."); };

  function next(): string | undefined {
    tokenPattern.lastIndex = position;
    const token = tokenPattern.exec(json);
    if (token) position = tokenPattern.lastIndex;
    return token?.[1];
  }

  function readValue(token: string | undefined, depth: number): JsonEvidence {
    if (token === undefined) return invalid();
    if (token === "{" || token === "[") {
      readContainer(token, depth);
      return other;
    }
    if (token.startsWith('"')) return { kind: "string", text: JSON.parse(token) as string };
    if (/^[-0-9]/.test(token)) return { kind: "number", text: token };
    if (token === "true" || token === "false" || token === "null") return other;
    return invalid();
  }

  function readContainer(open: "{" | "[", depth: number): void {
    if (depth > 64) invalid();
    const close = open === "{" ? "}" : "]";
    let token = next();
    if (token === close) return;
    for (;;) {
      if (open === "{") {
        if (!token?.startsWith('"')) return invalid();
        const key = JSON.parse(token) as string;
        if (next() !== ":") invalid();
        const value = readValue(next(), depth + 1);
        if (depth === 1) {
          count++;
          if (relevantKeys.has(key) && (status === 200 ? key === "id" : key !== "id")) {
            if (members.has(key)) duplicate = true;
            members.set(key, value);
          }
        }
      } else {
        readValue(token, depth + 1);
      }
      const delimiter = next();
      if (delimiter === close) return;
      if (delimiter !== ",") invalid();
      token = next();
    }
  }

  if (next() !== "{") return undefined;
  readContainer("{", 1);
  if (duplicate || /[^ \t\r\n]/.test(json.slice(position))) return undefined;
  return { count, members };
}

function classify(status: number, bytes: Buffer): { result: Result; fatal: boolean } {
  let object: ReturnType<typeof parseEvidence>;
  try { object = parseEvidence(bytes, status); } catch { /* Invalid UTF-8 or JSON. */ }

  if (status === 200) {
    const id = object?.members.get("id");
    if (object?.count === 1 && id?.kind === "string" && id.text.length >= 1 &&
        id.text.length <= 255 && !/[^\x21-\x7e]/.test(id.text)) {
      return { result: Object.freeze({
        outcome: "accepted", evidence: "authoritative_acceptance", providerMessageId: id.text,
      }), fatal: false };
    }
    return { result: unknown, fatal: true };
  }

  const nameToken = object?.members.get("name");
  const message = object?.members.get("message");
  const declaredStatus = object?.members.get("statusCode");
  if (nameToken?.kind !== "string" || message?.kind !== "string" ||
      (declaredStatus && (declaredStatus.kind !== "number" || declaredStatus.text !== String(status)))) {
    return { result: unknown, fatal: false };
  }

  const name = nameToken.text;
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

export function createEvery8dSettingsEmailResendProvider({
  apiKey,
  reportProviderFatal,
  socketsForTest,
}: Readonly<{ apiKey: string; reportProviderFatal(): void; socketsForTest?: ResendSocketConnectors }>): Every8dSettingsEmailProvider {
  const admittedKey = parseEvery8dSettingsEmailResendApiKey(apiKey);
  if (admittedKey === undefined) throw new Error("Invalid Resend email configuration.");

  return Object.freeze({
    async send(input: Every8dSettingsEmailProviderInput): Promise<Result> {
      let reported = false;
      const report = () => {
        if (reported) return;
        reported = true;
        try { reportProviderFatal(); } catch { /* The observer supplies no delivery evidence. */ }
      };

      try {
        const { signal, deadlineMonotonicNs: deadline } = input;
        if (signal.aborted || deadline - process.hrtime.bigint() < resendMinimumBudgetNs) return notStarted;
        return exchangeResendHttp<Result>(prepareRequest(admittedKey, input), {
          signal, deadline, unknown, notStarted, preEntryFailure: report,
          onHeaders(status) {
            if ((status > 200 && status < 400) || status === 404 || status === 405) {
              report();
              return unknown;
            }
            if (status === 401 || status === 403) report();
            return [200, 400, 401, 403, 409, 422, 429].includes(status) ? undefined : unknown;
          },
          onInvalid(status) {
            if (status === 200) report();
            return unknown;
          },
          onBody(status, bytes, expired) {
            const { result, fatal } = classify(status, bytes);
            if (expired()) return unknown;
            // A reentrant fatal observer can abort this send. The transport's
            // single settlement then keeps the conservative result.
            if (fatal) report();
            return result;
          },
        }, socketsForTest);
      } catch {
        report();
        return notStarted;
      }
    },
  });
}
