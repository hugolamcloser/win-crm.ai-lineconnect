import { Router } from "express";
import { z } from "zod";
import { logger } from "../config/logger";
import { HttpError } from "../middleware/errors";
import { verifyGhlEd25519Signature } from "../middleware/ghlWebhookSignature";
import {
  Every8dGhlMarketplaceLifecycleError,
  every8dGhlMarketplaceLifecycleService,
  type Every8dGhlMarketplaceLifecyclePayload,
  type Every8dGhlMarketplaceLifecycleResult
} from "../services/every8dGhlMarketplaceLifecycleService";
import type { RawBodyRequest } from "../types/http";

const identifier = z.string().trim().min(1).max(256);
const lifecycleSchema = z.object({
  type: identifier,
  appId: identifier.optional(),
  appNamespace: identifier.optional(),
  installType: identifier.optional(),
  locationId: identifier.optional(),
  companyId: identifier.optional(),
  isBulkInstallation: z.boolean().optional(),
  installToFutureLocations: z.boolean().optional(),
  approveAllLocations: z.boolean().optional()
}).passthrough();

type WebhookDependencies = {
  verifySignature(input: { rawBody: Buffer; ghlSignature?: string }): boolean;
  handler(payload: Every8dGhlMarketplaceLifecyclePayload): Promise<Every8dGhlMarketplaceLifecycleResult>;
};

function statusForLifecycleError(error: Every8dGhlMarketplaceLifecycleError): number {
  if (error.code === "lifecycle_disabled") return 503;
  if (error.code === "lifecycle_rejected") return 400;
  return 409;
}

export function createEvery8dGhlMarketplaceWebhookRouter(dependencies: WebhookDependencies): Router {
  const router = Router();

  router.post("/webhooks/ghl/every8d-connect/lifecycle", async (req: RawBodyRequest, res, next) => {
    try {
      if (!req.rawBody) throw new HttpError(400, "Raw lifecycle webhook body is required");

      if (!dependencies.verifySignature({
        rawBody: req.rawBody,
        ghlSignature: req.header("x-ghl-signature") ?? undefined
      })) {
        throw new HttpError(401, "Invalid HighLevel lifecycle webhook signature");
      }

      const payload = lifecycleSchema.parse(req.body);
      const result = await dependencies.handler(payload);
      logger.info(
        { eventType: payload.type, lifecycleStatus: result.status },
        "Processed EVERY8D Connect Marketplace lifecycle event"
      );
      res.status(200).json({ ok: true, status: result.status });
    } catch (error) {
      if (error instanceof Every8dGhlMarketplaceLifecycleError) {
        logger.warn(
          { lifecycleErrorCode: error.code },
          "Rejected EVERY8D Connect Marketplace lifecycle event"
        );
        res.status(statusForLifecycleError(error)).json({ ok: false, error: error.code });
        return;
      }
      next(error);
    }
  });

  return router;
}

export const every8dGhlMarketplaceWebhookRouter = createEvery8dGhlMarketplaceWebhookRouter({
  verifySignature: verifyGhlEd25519Signature,
  handler: (payload) => every8dGhlMarketplaceLifecycleService.handle(payload)
});
