import type { RequestHandler } from "express";
import { env } from "../config/env";
import { HttpError } from "./errors";

export const requireSharedSecret: RequestHandler = (req, _res, next) => {
  if (!env.WEBHOOK_SHARED_SECRET) {
    next(new HttpError(503, "WEBHOOK_SHARED_SECRET is not configured"));
    return;
  }

  const provided = req.header("x-webhook-secret") ?? req.header("authorization")?.replace(/^Bearer\s+/i, "");

  if (provided !== env.WEBHOOK_SHARED_SECRET) {
    next(new HttpError(401, "Invalid shared secret"));
    return;
  }

  next();
};
