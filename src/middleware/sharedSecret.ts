import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env";
import { HttpError } from "./errors";

function timingSafeSecretEqual(provided: string | undefined, expected: string): boolean {
  if (!provided) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function requireConfiguredSecret(provided: string | undefined, next: Parameters<RequestHandler>[2]): void {
  if (!env.WEBHOOK_SHARED_SECRET) {
    next(new HttpError(503, "WEBHOOK_SHARED_SECRET is not configured"));
    return;
  }

  if (!timingSafeSecretEqual(provided, env.WEBHOOK_SHARED_SECRET)) {
    next(new HttpError(401, "Invalid shared secret"));
    return;
  }

  next();
}

export const requireSharedSecret: RequestHandler = (req, _res, next) => {
  const provided = req.header("x-webhook-secret") ?? req.header("authorization")?.replace(/^Bearer\s+/i, "");
  requireConfiguredSecret(provided, next);
};

export const requireWinCrmWebhookSecret: RequestHandler = (req, _res, next) => {
  requireConfiguredSecret(req.header("x-wincrm-webhook-secret") ?? undefined, next);
};
