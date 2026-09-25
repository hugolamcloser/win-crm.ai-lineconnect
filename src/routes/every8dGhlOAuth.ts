import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { logger } from "../config/logger";
import { requireSharedSecret } from "../middleware/sharedSecret";
import { every8dGhlOAuthReconciler } from "../services/every8dGhlOAuthReconciler";
import { Every8dGhlOAuthError, every8dGhlOAuthRuntime } from "../services/every8dGhlOAuthService";
import type { Every8dOAuthBootstrapStatus } from "../services/every8dGhlOAuthRepository";
import type { RawBodyRequest } from "../types/http";

const bindingCookieName = "wincrm_every8d_oauth_binding";
const cookiePath = "/oauth/every8d-connect";
const launcherOrigin = "https://win-crm.up.railway.app";
const launcherContentType = "application/x-www-form-urlencoded";
const launcherCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const launcherSuccessCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const launcherEnabledHtml =
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>Connect EVERY8D to HighLevel</title></head>" +
  "<body><main><form method=\"post\" action=\"/oauth/every8d-connect/launch\">" +
  "<button type=\"submit\">Connect EVERY8D to HighLevel</button></form></main></body></html>";
const launcherDisabledHtml =
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>EVERY8D connection unavailable</title></head>" +
  "<body><main><h1>EVERY8D connection is unavailable</h1></main></body></html>";

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function launcherSuccessHtml(authorizationUrl: string): string {
  return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Ready to connect EVERY8D</title></head>" +
    "<body><main><h1>Ready to connect EVERY8D</h1>" +
    "<p>Continue now to HighLevel to finish connecting.</p><p>Continue in this browser.</p>" +
    `<a href="${escapeHtmlAttribute(authorizationUrl)}" rel="noreferrer">Continue to HighLevel</a>` +
    "</main></body></html>";
}
const exactIdentifier = z.string().trim().min(1).max(256);
const initiationSchema = z.object({
  installationId: exactIdentifier,
  tenantId: exactIdentifier,
  locationId: exactIdentifier
}).strict();
const callbackSchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(4096)
}).strict();

type OAuthRuntime = {
  isEnabled(): boolean;
  start(): Promise<{ authorizationUrl: string; browserBinding: string; expiresAt: string }>;
  initiate(input: { installationId: string; tenantId: string; locationId: string }): Promise<{
    authorizationUrl: string;
    browserBinding: string;
    expiresAt: string;
  }>;
  acceptCallback(input: { code: string; state: string; browserBinding: string }): Promise<{
    status: "pending";
    ready: boolean;
  }>;
  completeCallback(input: { code: string; state: string; browserBinding: string }): Promise<{
    status: "pending" | "connected";
    ready: boolean;
  }>;
  getStatus(browserBinding: string): Promise<Every8dOAuthBootstrapStatus | null>;
};

type OAuthRouteDependencies = {
  runtime: OAuthRuntime;
  triggerReconcile(): void;
  now(): number;
  initiationGuard: RequestHandler;
};

function cookieAttributes(maxAge: number): string {
  return [
    `Path=${cookiePath}`,
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    "HttpOnly",
    "SameSite=Lax",
    "Secure"
  ].join("; ");
}

function setBindingCookie(res: Response, value: string, expiresAt: string, now: number): void {
  const maxAge = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  res.setHeader("Set-Cookie", `${bindingCookieName}=${encodeURIComponent(value)}; ${cookieAttributes(maxAge)}`);
}

function clearBindingCookie(res: { setHeader(name: string, value: string): void }): void {
  res.setHeader("Set-Cookie", `${bindingCookieName}=; ${cookieAttributes(0)}`);
}

function readBindingCookie(header: string | undefined): string | null {
  if (!header) return null;
  const matches = header.split(";").map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${bindingCookieName}=`));
  if (matches.length !== 1) return null;
  try {
    const value = decodeURIComponent(matches[0]!.slice(bindingCookieName.length + 1));
    return value.length > 0 && value.length <= 4096 ? value : null;
  } catch { return null; }
}

function errorStatus(error: Every8dGhlOAuthError): number {
  if (error.code === "oauth_disabled" || error.code === "oauth_configuration_invalid") return 503;
  if (error.code === "oauth_admission_rejected") return 429;
  if (error.code === "token_exchange_failed" || error.code === "credential_persistence_failed") return 502;
  return 400;
}

function statusBody(status: Every8dOAuthBootstrapStatus | null): "pending" | "connected" | "failed" {
  if (status === "succeeded") return "connected";
  if (status === "failed" || status === null) return "failed";
  return "pending";
}

async function isStrictlyEmptyStartRequest(req: Parameters<RequestHandler>[0]): Promise<boolean> {
  if (Object.keys(req.query).length !== 0) return false;
  const contentType = req.header("content-type");
  if (contentType && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) return false;
  const rawBody = (req as RawBodyRequest).rawBody;
  if (rawBody) return rawBody.length === 0;
  const contentLength = req.header("content-length");
  if (contentLength !== undefined) return contentLength === "0";
  if (!req.readable || req.readableEnded) return req.body === undefined;
  return await new Promise<boolean>((resolve) => {
    let empty = true;
    req.once("data", () => { empty = false; });
    req.once("end", () => resolve(empty));
    req.once("error", () => resolve(false));
    req.resume();
  });
}

async function hasExactlyZeroLauncherBody(req: Parameters<RequestHandler>[0]): Promise<boolean> {
  const contentLength = req.header("content-length");
  if (contentLength !== undefined && contentLength !== "0") {
    req.resume();
    return false;
  }

  const rawBody = (req as RawBodyRequest).rawBody;
  if (rawBody !== undefined) return rawBody.length === 0;
  if (req.readableEnded) {
    const buffered = req.read() as Buffer | string | null;
    return buffered === null || Buffer.byteLength(buffered) === 0;
  }
  if (!req.readable) return false;

  return await new Promise<boolean>((resolve) => {
    let settled = false;

    function finish(empty: boolean): void {
      if (settled) return;
      settled = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
      resolve(empty);
    }

    function onData(chunk: Buffer | string): void {
      if (Buffer.byteLength(chunk) > 0) {
        finish(false);
        req.resume();
      }
    }

    function onEnd(): void { finish(true); }
    function onError(): void { finish(false); }
    function onAborted(): void { finish(false); }

    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    req.once("aborted", onAborted);
    req.resume();
  });
}

export function createEvery8dGhlOAuthRouter(dependencies: OAuthRouteDependencies): Router {
  const router = Router();

  router.use(cookiePath, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });

  router.get(`${cookiePath}/launch`, (_req, res) => {
    if (!dependencies.runtime.isEnabled()) {
      res.status(503).type("html").send(launcherDisabledHtml);
      return;
    }

    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", launcherCsp);
    res.status(200).type("html").send(launcherEnabledHtml);
  });

  router.post(`${cookiePath}/launch`, async (req, res) => {
    if (!dependencies.runtime.isEnabled()) {
      res.status(503).json({ ok: false, error: "oauth_disabled" });
      return;
    }

    const rejectInvalidRequest = (): void => {
      req.resume();
      res.status(400).json({ ok: false, error: "oauth_request_invalid" });
    };
    if (req.originalUrl.includes("?")) {
      rejectInvalidRequest();
      return;
    }
    if (req.header("origin") !== launcherOrigin) {
      rejectInvalidRequest();
      return;
    }
    if (
      req.header("sec-fetch-site") !== "same-origin" ||
      req.header("sec-fetch-mode") !== "navigate" ||
      req.header("sec-fetch-dest") !== "document"
    ) {
      rejectInvalidRequest();
      return;
    }
    if (req.header("content-type") !== launcherContentType) {
      rejectInvalidRequest();
      return;
    }
    if (!(await hasExactlyZeroLauncherBody(req))) {
      rejectInvalidRequest();
      return;
    }

    try {
      const start = await dependencies.runtime.start();
      setBindingCookie(res, start.browserBinding, start.expiresAt, dependencies.now());
      res.setHeader("Content-Security-Policy", launcherSuccessCsp);
      res.status(200).type("html").send(launcherSuccessHtml(start.authorizationUrl));
    } catch (error) {
      if (error instanceof Every8dGhlOAuthError) {
        logger.warn({ oauthErrorCode: error.code }, "Rejected EVERY8D Connect OAuth launcher");
        res.status(errorStatus(error)).json({ ok: false, error: error.code });
        return;
      }
      res.status(400).json({ ok: false, error: "oauth_request_invalid" });
    }
  });

  router.post(`${cookiePath}/start`, async (req, res) => {
    try {
      if (!dependencies.runtime.isEnabled()) {
        await dependencies.runtime.start();
      }
      if (!(await isStrictlyEmptyStartRequest(req))) {
        throw new Every8dGhlOAuthError("oauth_request_invalid", "OAuth start request must be empty");
      }
      const start = await dependencies.runtime.start();
      setBindingCookie(res, start.browserBinding, start.expiresAt, dependencies.now());
      res.redirect(303, start.authorizationUrl);
    } catch (error) {
      if (error instanceof Every8dGhlOAuthError) {
        logger.warn({ oauthErrorCode: error.code }, "Rejected EVERY8D Connect OAuth start");
        res.status(errorStatus(error)).json({ ok: false, error: error.code });
        return;
      }
      res.status(400).json({ ok: false, error: "oauth_request_invalid" });
    }
  });

  router.post(`${cookiePath}/initiate`, dependencies.initiationGuard, async (req, res) => {
    try {
      const input = initiationSchema.parse(req.body);
      const initiation = await dependencies.runtime.initiate(input);
      setBindingCookie(res, initiation.browserBinding, initiation.expiresAt, dependencies.now());
      res.redirect(302, initiation.authorizationUrl);
    } catch (error) {
      if (error instanceof Every8dGhlOAuthError) {
        logger.warn({ oauthErrorCode: error.code }, "Rejected EVERY8D Connect installed OAuth initiation");
        res.status(errorStatus(error)).json({ ok: false, error: error.code });
        return;
      }
      res.status(400).json({ ok: false, error: "oauth_request_invalid" });
    }
  });

  router.get(`${cookiePath}/callback`, async (req, res) => {
    try {
      const input = callbackSchema.parse(req.query);
      const browserBinding = readBindingCookie(req.header("cookie") ?? undefined);
      if (!browserBinding) throw new Every8dGhlOAuthError("oauth_state_invalid", "OAuth state is invalid");
      const accepted = await dependencies.runtime.completeCallback({ ...input, browserBinding });
      if (accepted.ready) dependencies.triggerReconcile();
      if (accepted.status === "connected") {
        clearBindingCookie(res);
        res.status(200).json({ ok: true, status: "connected" });
        return;
      }
      res.redirect(303, `${cookiePath}/pending`);
    } catch (error) {
      clearBindingCookie(res);
      if (error instanceof Every8dGhlOAuthError) {
        logger.warn({ oauthErrorCode: error.code }, "Rejected EVERY8D Connect OAuth callback");
        res.status(errorStatus(error)).json({ ok: false, error: error.code });
        return;
      }
      res.status(400).json({ ok: false, error: "oauth_request_invalid" });
    }
  });

  router.get(`${cookiePath}/status`, async (req, res) => {
    try {
      const browserBinding = readBindingCookie(req.header("cookie") ?? undefined);
      if (!browserBinding) throw new Every8dGhlOAuthError("oauth_state_invalid", "OAuth state is invalid");
      const status = statusBody(await dependencies.runtime.getStatus(browserBinding));
      if (status !== "pending") clearBindingCookie(res);
      res.status(200).json({ ok: true, status });
    } catch (error) {
      if (error instanceof Every8dGhlOAuthError) {
        res.status(errorStatus(error)).json({ ok: false, error: error.code });
        return;
      }
      res.status(400).json({ ok: false, error: "oauth_request_invalid" });
    }
  });

  router.get(`${cookiePath}/pending`, (_req, res) => {
    res.status(200).type("html").send(
      "<!doctype html><html><head><meta charset=\"utf-8\"><title>EVERY8D connection pending</title></head>" +
      "<body><main><h1>Connection pending</h1><p>You may close this page. Completion does not depend on this browser.</p></main></body></html>"
    );
  });

  return router;
}

export const every8dGhlOAuthRouter = createEvery8dGhlOAuthRouter({
  runtime: every8dGhlOAuthRuntime,
  triggerReconcile: () => every8dGhlOAuthReconciler.trigger(),
  now: Date.now,
  initiationGuard: requireSharedSecret
});
