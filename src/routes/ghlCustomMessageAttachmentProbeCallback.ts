import express, { Router } from "express";
import { logger } from "../config/logger";
import { verifyGhlWebhookSignature } from "../middleware/ghlWebhookSignature";
import { HttpError } from "../middleware/errors";
import {
  recordStage1Callback,
  requireStage1Config
} from "../services/ghlCustomMessageAttachmentProbeService";

export const ghlCustomMessageAttachmentProbeCallbackRouter = Router();

ghlCustomMessageAttachmentProbeCallbackRouter.post(
  "/webhooks/ghl/stage-1/custom-message-outbound",
  express.raw({ type: ["application/json", "application/*+json"], limit: "2mb" }),
  (req, res, next) => {
    try {
      requireStage1Config();

      if (!Buffer.isBuffer(req.body)) {
        throw new HttpError(400, "Raw HighLevel callback body is required");
      }

      const signatureValid = verifyGhlWebhookSignature({
        rawBody: req.body,
        ghlSignature: req.header("x-ghl-signature") ?? undefined
      });

      if (!signatureValid) {
        throw new HttpError(401, "Invalid HighLevel callback signature");
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(req.body.toString("utf8"));
      } catch {
        throw new HttpError(400, "Invalid HighLevel callback JSON");
      }

      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new HttpError(400, "Invalid HighLevel callback payload");
      }

      const metadata = recordStage1Callback(parsed as Record<string, unknown>);

      logger.info(
        {
          callbackReceived: true,
          signatureValid: true,
          callbackKind: metadata.callbackKind,
          correlationStatus: metadata.correlationStatus,
          messageIdPresent: metadata.messageIdPresent,
          messageIdRef: metadata.messageIdRef,
          probeRunRef: metadata.probeRunRef,
          providerCallbackCount: metadata.providerCallbackCount,
          genericOutboundObservationConfigured: metadata.genericOutboundObservationConfigured,
          genericOutboundCallbackCount: metadata.genericOutboundCallbackCount,
          dispatchStatus: "intercepted",
          lineDeliveryAttempted: false
        },
        "Intercepted Stage 1 HighLevel Custom message callback without LINE delivery"
      );

      res.status(200).json({ ok: true, intercepted: true, callbackReceived: true });
    } catch (error) {
      next(error);
    }
  }
);
