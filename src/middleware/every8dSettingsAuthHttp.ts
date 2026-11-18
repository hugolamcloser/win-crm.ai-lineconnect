import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { RequestHandler } from "express";
import type { Every8dSettingsAuthHttpConfig } from "../config/every8dSettingsAuthHttp";
import {
  EVERY8D_SETTINGS_AUTH_MAX_BODY_BYTES,
  parseEvery8dSettingsAuthJsonEnvelope
} from "./every8dSettingsAuthJson";
import type { Every8dSettingsAuthJsonEnvelope } from "./every8dSettingsAuthJson";

const namespace = "/settings/auth";
const unmatched = "/settings/auth/*";
const closeCommittedError = Symbol("closeCommittedError");
type BoundaryResponse = ServerResponse & { [closeCommittedError]?: () => void };

export type Every8dSettingsAuthRequestTarget =
  | Readonly<{ form: "OTHER_FORM" }>
  | Readonly<{
      form: "ORIGIN_FORM" | "ABSOLUTE_FORM_HTTP" | "ABSOLUTE_FORM_HTTPS" | "MALFORMED_HTTP_ABSOLUTE_FORM";
      rawPath: string;
      queryDelimiterPresent: boolean;
    }>;

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, letter => letter.toLowerCase());
}

export function classifyEvery8dSettingsAuthRequestTarget(target: string): Every8dSettingsAuthRequestTarget {
  const query = target.indexOf("?");
  const beforeQuery = query < 0 ? target : target.slice(0, query);
  const queryDelimiterPresent = query >= 0;
  if (target.startsWith("/")) {
    return { form: "ORIGIN_FORM", rawPath: beforeQuery, queryDelimiterPresent };
  }

  const scheme = asciiLower(target.slice(0, 8));
  const https = scheme === "https://";
  if (!https && !scheme.startsWith("http://")) return { form: "OTHER_FORM" };
  const start = https ? 8 : 7;
  const pathStart = beforeQuery.indexOf("/", start);
  if (beforeQuery.length <= start) return { form: "OTHER_FORM" };
  return {
    form: pathStart === start ? "MALFORMED_HTTP_ABSOLUTE_FORM" :
      https ? "ABSOLUTE_FORM_HTTPS" : "ABSOLUTE_FORM_HTTP",
    rawPath: pathStart < 0 ? "/" : beforeQuery.slice(pathStart),
    queryDelimiterPresent
  };
}

function isProtectedPath(path: string): boolean {
  return path === namespace || path.startsWith(namespace + "/");
}

function ownsAuthPath(path: string): boolean {
  if (isProtectedPath(path) || isProtectedPath(asciiLower(path))) return true;

  const decoded = path.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)));
  const normalized: string[] = [];
  // Start below the root. Empty segments participate in traversal like other segments.
  for (const segment of asciiLower(decoded.replace(/\\/g, "/")).split("/").slice(1)) {
    if (segment === "..") normalized.pop();
    else if (segment !== ".") normalized.push(segment);
  }
  return isProtectedPath("/" + normalized.join("/"));
}

export function ownsEvery8dSettingsAuthTarget(target: Every8dSettingsAuthRequestTarget): boolean {
  if (target.form === "OTHER_FORM") return false;
  const path = target.rawPath;
  // Match the pathname visible downstream without normalizing any fragment text.
  const fragment = path.indexOf("#");
  return ownsAuthPath(fragment >= 0 ? path.slice(0, fragment) : path);
}

export const every8dSettingsAuthRoutes = Object.freeze({
  "GET /settings/auth": null,
  "GET /settings/auth/csrf": null,
  "POST /settings/auth/enrollment/challenge": Object.freeze(["email", "enrollmentCapability"]),
  "POST /settings/auth/enrollment/verify": Object.freeze(["otp"]),
  "POST /settings/auth/login/challenge": Object.freeze(["email"]),
  "POST /settings/auth/login/verify": Object.freeze(["otp"]),
  "GET /settings/auth/session": null,
  "POST /settings/auth/logout": Object.freeze([])
});
type Route = keyof typeof every8dSettingsAuthRoutes;
type RoutePath = Route extends infer Entry ?
  Entry extends `${string} ${infer Path}` ? Path : never : never;

function matchRoute(method: string, target: Every8dSettingsAuthRequestTarget): Route | undefined {
  if (target.form !== "ORIGIN_FORM") return undefined;
  const key = method + " " + target.rawPath;
  return Object.hasOwn(every8dSettingsAuthRoutes, key) ? key as Route : undefined;
}

export function matchEvery8dSettingsAuthDispatch(
  method: string, target: Every8dSettingsAuthRequestTarget
): Route | undefined {
  if (target.form === "OTHER_FORM" || target.queryDelimiterPresent) return undefined;
  return matchRoute(method, target);
}

const errorStatuses = Object.freeze({
  not_available: 404,
  invalid_request: 400,
  request_rejected: 403,
  payload_too_large: 413,
  unsupported_media_type: 415,
  try_later: 429,
  authentication_failed: 400,
  unauthorized: 401,
  temporarily_unavailable: 503
});
type PublicError = keyof typeof errorStatuses;

type Representation =
  | Readonly<{ type: "application/json" | "text/html"; bytes: Buffer }>
  | undefined;

export function setEvery8dSettingsAuthSecurityHeaders(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

const representationHeaders = [
  "Content-Type", "Content-Length", "Transfer-Encoding", "Content-Encoding",
  "Content-Range", "Trailer", "ETag", "Last-Modified", "Location"
] as const;

function hasConnectionClose(res: ServerResponse): boolean {
  return String(res.getHeader("Connection") ?? "").split(",")
    .some(token => asciiLower(token.trim()) === "close");
}

function resetFixedErrorHeaders(res: ServerResponse): void {
  const closing = hasConnectionClose(res);
  for (const header of res.getHeaderNames()) res.removeHeader(header);
  if (closing) res.setHeader("Connection", "close");
}

export function endEvery8dSettingsAuthResponse(
  res: ServerResponse, method: string, status: number, representation?: Representation
): void {
  res.statusCode = status;
  setEvery8dSettingsAuthSecurityHeaders(res);
  if (status === 204 || representation) {
    for (const header of representationHeaders) res.removeHeader(header);
  }
  if (status === 204) {
    res.end();
    return;
  }

  if (representation) {
    res.setHeader("Content-Type", representation.type + "; charset=utf-8");
    res.setHeader("Content-Length", representation.bytes.length);
  }
  res.end(method === "HEAD" ? undefined : representation?.bytes);
}

export function endEvery8dSettingsAuthError(res: ServerResponse, method: string, error: PublicError): void {
  if (res.headersSent || res.writableEnded || res.destroyed) {
    const close = (res as BoundaryResponse)[closeCommittedError];
    if (close) close();
    else res.destroy();
    return;
  }
  resetFixedErrorHeaders(res);
  endEvery8dSettingsAuthResponse(res, method, errorStatuses[error], {
    type: "application/json",
    bytes: Buffer.from(JSON.stringify({ error }))
  });
}

type Telemetry = Readonly<{
  event: "settings_auth_http";
  category: "response" | "transport_closed";
  route: RoutePath | typeof unmatched;
  method: "GET" | "POST" | "HEAD" | "OPTIONS" | "OTHER";
  statusClass: "2xx" | "3xx" | "4xx" | "5xx" | "other" | "none";
  latency: "under_10ms" | "under_100ms" | "100ms_or_more";
  count: 1;
}>;

type BoundaryOptions = Readonly<{
  dispatch: (input: Readonly<{
    route: Route;
    req: IncomingMessage;
    res: ServerResponse;
    envelope: Every8dSettingsAuthJsonEnvelope | undefined;
  }>) => void | Promise<void>;
  telemetry?: (event: Telemetry) => void | Promise<void>;
}>;

function emitTelemetry(
  sink: BoundaryOptions["telemetry"], method: string, route: Route | undefined,
  status: number | undefined, started: number
): void {
  if (!sink) return;
  const elapsed = performance.now() - started;
  const bucket = method === "GET" || method === "POST" || method === "HEAD" ||
    method === "OPTIONS" ? method : "OTHER";
  const statusClass = status === undefined ? "none" :
    status >= 200 && status < 600 ? (`${Math.floor(status / 100)}xx` as Telemetry["statusClass"]) : "other";

  const event: Telemetry = {
    event: "settings_auth_http",
    category: status === undefined ? "transport_closed" : "response",
    route: route && statusClass === "2xx" ? route.slice(route.indexOf(" ") + 1) as RoutePath : unmatched,
    method: bucket, statusClass,
    latency: elapsed < 10 ? "under_10ms" : elapsed < 100 ? "under_100ms" : "100ms_or_more",
    count: 1
  };
  // Telemetry failure is local and never changes the response or gate.
  try {
    void Promise.resolve(sink(event)).catch(() => {});
  } catch {
    // The sink is outside the HTTP admission authority.
  }
}

type Framing =
  | Readonly<{ length: number | undefined }>
  | Readonly<{ error: "invalid_request" | "payload_too_large" }>;

function rawFields(headers: readonly string[], field: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < headers.length; index += 2) {
    if (asciiLower(headers[index]) === field) values.push(headers[index + 1]);
  }
  return values;
}

function admitFraming(headers: readonly string[]): Framing {
  const lengths = rawFields(headers, "content-length");
  const encodings = rawFields(headers, "transfer-encoding");
  if (encodings.length > 0) {
    return lengths.length === 0 && encodings.length === 1 && asciiLower(encodings[0]) === "chunked" ?
      { length: undefined } : { error: "invalid_request" };
  }
  if (lengths.length === 0) return { length: 0 };
  const [length] = lengths;
  if (lengths.length > 1 || !/^(?:0|[1-9][0-9]*)$/.test(length)) return { error: "invalid_request" };
  const limit = String(EVERY8D_SETTINGS_AUTH_MAX_BODY_BYTES);
  if (length.length > limit.length || (length.length === limit.length && length > limit)) {
    return { error: "payload_too_large" };
  }
  return { length: Number(length) };
}

function admitsPostMedia(headers: readonly string[]): boolean {
  const type = rawFields(headers, "content-type");
  const encoding = rawFields(headers, "content-encoding");
  return type.length === 1 && /^application\/json(?:;[ \t]*charset=utf-8)?$/.test(asciiLower(type[0])) &&
    (encoding.length === 0 || (encoding.length === 1 && asciiLower(encoding[0]) === "identity"));
}

type BodyAdmission = Buffer | "overflow" | "incomplete";

function readBody(req: IncomingMessage, length: number | undefined): Promise<BodyAdmission> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const settle = (outcome: BodyAdmission): void => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("close", onClose);
      req.off("error", onClose);
      resolve(outcome);
    };
    const onClose = (): void => settle("incomplete");
    const onEnd = (): void => {
      if (!req.complete || (length !== undefined && length !== bytes)) return settle("incomplete");
      settle(Buffer.concat(chunks, bytes));
    };
    const onData = (chunk: Buffer): void => {
      if (chunk.length > EVERY8D_SETTINGS_AUTH_MAX_BODY_BYTES - bytes) {
        req.pause();
        settle("overflow");
        return;
      }
      bytes += chunk.length;
      chunks.push(chunk);
    };
    req.once("close", onClose);
    req.once("error", onClose);
    req.once("end", onEnd);
    req.on("data", onData);
  });
}

type Gate = {
  phase: "free" | "pending" | "closing";
  waiters: (() => void)[];
  draining: boolean;
};

function closeGate(gate: Gate): void {
  gate.phase = "closing";
  gate.waiters.length = 0;
}

function releaseWaiters(gate: Gate): void {
  gate.draining = true;
  try {
    while (gate.phase === "free" && gate.waiters.length > 0) gate.waiters.shift()?.();
  } finally {
    gate.draining = false;
  }
}

function canReuse(socket: Socket, res: ServerResponse): boolean {
  // Node's own finish listener can detach the response socket, or close it first.
  const response = res as ServerResponse & {
    shouldKeepAlive: boolean;
    maxRequestsOnConnectionReached?: boolean;
  };
  return !socket.destroyed && socket.writable && !socket.writableEnded &&
    response.shouldKeepAlive && !response.maxRequestsOnConnectionReached &&
    !hasConnectionClose(res);
}

/** Intended to run first when mounted. C3c-5a uses it only in an isolated harness. */
export function createEvery8dSettingsAuthHttpBoundary(
  config: Every8dSettingsAuthHttpConfig, options: BoundaryOptions
): RequestHandler {
  const states = new WeakMap<Socket, Gate>();

  return (req, res, next): void => {
    const socket = req.socket;

    const enter = (resuming: boolean): void => {
      let gate = states.get(socket);
      if (gate?.phase === "closing" || socket.destroyed || socket.writableEnded) return;
      if (gate && (gate.phase === "pending" || (gate.draining && !resuming))) {
        gate.waiters.push(() => enter(true));
        return;
      }

      const target = classifyEvery8dSettingsAuthRequestTarget(req.originalUrl ?? req.url ?? "");
      if (!ownsEvery8dSettingsAuthTarget(target)) return next();
      if (!gate) {
        gate = { phase: "free", waiters: [], draining: false };
        states.set(socket, gate);
        const connectionGate = gate;
        socket.once("close", () => closeGate(connectionGate));
      }

      const connectionGate = gate;
      const method = req.method ?? "";
      const started = performance.now();
      let route: Route | undefined;
      let observed = false;
      let owner = false;
      let responseFinished = false;
      let executionComplete = false;

      const observe = (status?: number): void => {
        if (observed) return;
        observed = true;
        emitTelemetry(options.telemetry, method, route, status, started);
      };
      const terminate = (): void => {
        closeGate(connectionGate);
        socket.destroy();
      };
      const reject = (error: PublicError, close: boolean): void => {
        const closing = close || !canReuse(socket, res);
        if (closing) closeGate(connectionGate);
        if (socket.destroyed || !socket.writable || socket.writableEnded || res.destroyed ||
          res.headersSent || res.writableEnded) return terminate();
        if (closing) res.setHeader("Connection", "close");
        endEvery8dSettingsAuthError(res, method, error);
      };
      const fail = (): void => {
        try {
          reject("temporarily_unavailable", true);
        } catch {
          terminate();
        }
      };
      const abortOwner = (): void => {
        if (!res.writableFinished) terminate();
      };
      const detachOwnerListeners = (): void => {
        req.off("aborted", abortOwner);
        req.off("error", abortOwner);
      };

      const settleOwner = (): void => {
        if (!owner || connectionGate.phase !== "pending" || !responseFinished) return;
        if (!canReuse(socket, res)) {
          closeGate(connectionGate);
          if (!socket.destroyed && !socket.writableEnded) socket.end();
        } else if (executionComplete) {
          connectionGate.phase = "free";
          releaseWaiters(connectionGate);
        }
      };

      res.once("finish", () => {
        detachOwnerListeners();
        observe(res.statusCode);
        if (!res.writableFinished) return terminate();
        responseFinished = true;
        settleOwner();
      });
      res.once("close", () => {
        detachOwnerListeners();
        if (!res.writableFinished && !observed) {
          observe();
          terminate();
        }
      });
      res.on("error", () => {
        if (!responseFinished || !executionComplete) terminate();
      });

      const admit = async (): Promise<void> => {
        const headers = req.rawHeaders;
        if (headers.length >= 2000) return reject("invalid_request", true);

        const framing = admitFraming(headers);
        if ("error" in framing) return reject(framing.error, true);
        const unread = framing.length !== 0;
        const exact = matchRoute(method, target);
        if (!exact || !config.operational) return reject("not_available", unread);
        route = matchEvery8dSettingsAuthDispatch(method, target);
        if (!route) return reject("invalid_request", unread);

        const post = method === "POST";
        if (post) {
          const origins = rawFields(headers, "origin");
          if (origins.length !== 1 || origins[0] !== config.publicOrigin) {
            return reject("request_rejected", unread);
          }
          if (!admitsPostMedia(headers)) return reject("unsupported_media_type", unread);
        } else if (unread) {
          return reject("invalid_request", true);
        }

        owner = true;
        connectionGate.phase = "pending";
        (res as BoundaryResponse)[closeCommittedError] = terminate;

        let envelope: Every8dSettingsAuthJsonEnvelope | undefined;
        if (post) {
          req.once("aborted", abortOwner);
          req.once("error", abortOwner);
          const body = await readBody(req, framing.length);
          if (connectionGate.phase !== "pending" || socket.destroyed) return;
          if (body === "incomplete") return terminate();
          if (body === "overflow") return reject("payload_too_large", true);

          const fields = every8dSettingsAuthRoutes[route];
          envelope = fields === null ? undefined : parseEvery8dSettingsAuthJsonEnvelope(body, fields);
          if (fields !== null && !envelope) return reject("invalid_request", false);
        }
        setEvery8dSettingsAuthSecurityHeaders(res);
        await options.dispatch({ route, req, res, envelope });
        if (!res.writableEnded && states.get(socket)?.phase === "pending") fail();
      };

      void admit().then(() => {
        executionComplete = true;
        settleOwner();
      }).catch(fail);
    };

    enter(false);
  };
}
