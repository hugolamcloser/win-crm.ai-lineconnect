import type { RequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { requireSharedSecret } from "../middleware/sharedSecret";
import {
  Every8dGhlOAuthError,
  every8dGhlOAuthRuntime
} from "../services/every8dGhlOAuthService";

const bindingCookieName = "wincrm_every8d_oauth_binding";
const cookiePath = "/oauth/every8d-connect";
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
  initiate(input: { installationId: string; tenantId: string; locationId: string }): Promise<{
    authorizationUrl: string;
    browserBinding: string;
    expiresAt: string;
  }>;
  completeCallback(input: { code: string; state: string; browserBinding: string }): Promise<{
    status: "connected";
  }>;
};

type OAuthRouteDependencies = {
  runtime: OAuthRuntime;
  initiationGuard: RequestHandler;
  secureCookies: boolean;
};

function cookieAttributes(input: { maxAge: number; secure: boolean }): string {
  return [
    `Path=${cookiePath}`,
    `Max-Age=${Math.max(0, Math.floor(input.maxAge))}`,
    "HttpOnly",
    "SameSite=Lax",
    input.secure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function setBindingCookie(
  res: Parameters<RequestHandler>[1],
  value: string,
  expiresAt: string,
  secure: boolean
): void {
  const maxAge = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000);
  res.setHeader(
    "Set-Cookie",
    `${bindingCookieName}=${encodeURIComponent(value)}; ${cookieAttributes({ maxAge, secure })}`
  );
}

function clearBindingCookie(res: Parameters<RequestHandler>[1], secure: boolean): void {
  res.setHeader(
    "Set-Cookie",
    `${bindingCookieName}=; ${cookieAttributes({ maxAge: 0, secure })}`
  );
}

function readBindingCookie(header: string | undefined): string | null {
  if (!header) return null;

  const matches = header
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${bindingCookieName}=`));

  if (matches.length !== 1) return null;

  try {
    const value = decodeURIComponent(matches[0]!.slice(bindingCookieName.length + 1));
    return value.length > 0 && value.length <= 4096 ? value : null;
  } catch {
    return null;
  }
}

function errorStatus(error: Every8dGhlOAuthError): number {
  if (error.code === "oauth_disabled" || error.code === "oauth_configuration_invalid") return 503;
  if (
    error.code === "oauth_request_invalid" ||
    error.code === "installation_not_eligible" ||
    error.code === "oauth_state_invalid" ||
    error.code === "token_response_rejected"
  ) return 400;
  return 502;
}

export function createEvery8dGhlOAuthRouter(dependencies: OAuthRouteDependencies): Router {
  const router = Router();

  router.use(cookiePath, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    next();
  });

  router.post(`${cookiePath}/initiate`, dependencies.initiationGuard, async (req, res) => {
    try {
      const input = initiationSchema.parse(req.body);
      const initiation = await dependencies.runtime.initiate(input);
      setBindingCookie(res, initiation.browserBinding, initiation.expiresAt, dependencies.secureCookies);
      res.redirect(302, initiation.authorizationUrl);
    } catch (error) {
      if (error instanceof Every8dGhlOAuthError) {
        logger.warn({ oauthErrorCode: error.code }, "Rejected EVERY8D Connect OAuth initiation");
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
      if (!browserBinding) {
        throw new Every8dGhlOAuthError("oauth_state_invalid", "EVERY8D Connect OAuth state is invalid");
      }

      const result = await dependencies.runtime.completeCallback({ ...input, browserBinding });
      clearBindingCookie(res, dependencies.secureCookies);
      res.status(200).json({ ok: true, status: result.status });
    } catch (error) {
      clearBindingCookie(res, dependencies.secureCookies);
      if (error instanceof Every8dGhlOAuthError) {
        logger.warn({ oauthErrorCode: error.code }, "Rejected EVERY8D Connect OAuth callback");
        res.status(errorStatus(error)).json({ ok: false, error: error.code });
        return;
      }
      res.status(400).json({ ok: false, error: "oauth_request_invalid" });
    }
  });

  return router;
}

export const every8dGhlOAuthRouter = createEvery8dGhlOAuthRouter({
  runtime: every8dGhlOAuthRuntime,
  initiationGuard: requireSharedSecret,
  secureCookies: env.NODE_ENV === "production"
});
