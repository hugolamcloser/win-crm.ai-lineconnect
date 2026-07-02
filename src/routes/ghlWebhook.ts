import { Router } from "express";
import { env } from "../config/env";
import { HttpError } from "../middleware/errors";
import { processGhlOutboundWebhook } from "../services/ghlSyncService";

export const ghlWebhookRouter = Router();

function validateProviderSecret(headerValue: string | undefined): void {
  if (!env.GHL_CUSTOM_PROVIDER_SECRET) {
    return;
  }

  if (headerValue !== env.GHL_CUSTOM_PROVIDER_SECRET) {
    throw new HttpError(401, "Invalid GHL provider secret");
  }
}

ghlWebhookRouter.post(["/webhooks/ghl", "/webhooks/ghl/outbound"], async (req, res, next) => {
  try {
    validateProviderSecret(req.header("x-provider-secret") ?? req.header("x-ghl-secret"));

    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      throw new HttpError(400, "Invalid outbound webhook payload");
    }

    const result = await processGhlOutboundWebhook(req.body as Record<string, unknown>);
    res.json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});
