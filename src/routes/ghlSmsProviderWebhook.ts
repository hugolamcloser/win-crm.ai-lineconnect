import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/errors";
import { verifyGhlWebhookSignature } from "../middleware/ghlWebhookSignature";
import { processGhlSmsProviderOutbound } from "../services/ghlSmsProviderOutboundService";
import type { RawBodyRequest } from "../types/http";
import { normalizeTaiwanMobile } from "../utils/taiwanPhone";

const exactGhlIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

const taiwanMobileDestination = z.string().transform((value, context) => {
  const normalized = normalizeTaiwanMobile(value);

  if (!normalized) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid Taiwan mobile destination",
    });
    return z.NEVER;
  }

  return normalized.every8dNational;
});

export const ghlSmsProviderPayloadSchema = z
  .object({
    contactId: exactGhlIdentifier,
    locationId: exactGhlIdentifier,
    messageId: exactGhlIdentifier,
    type: z.literal("SMS"),
    phone: taiwanMobileDestination,
    message: z
      .string()
      .trim()
      .min(1)
      .refine((value) => Array.from(value).length <= 333),
    userId: exactGhlIdentifier.optional(),
    attachments: z.array(z.string()).max(0).optional(),
  })
  .strict();

export type GhlSmsProviderPayload = z.infer<
  typeof ghlSmsProviderPayloadSchema
>;

export interface GhlSmsProviderWebhookResult {
  httpStatus: number;
  body: object;
}

export interface GhlSmsProviderWebhookDependencies {
  verifySignature(input: {
    rawBody: Buffer;
    ghlSignature?: string;
    legacySignature?: string;
  }): boolean;
  handler(payload: GhlSmsProviderPayload): Promise<GhlSmsProviderWebhookResult>;
}

export function createGhlSmsProviderWebhookRouter(
  dependencies: GhlSmsProviderWebhookDependencies,
): Router {
  const router = Router();

  router.post(
    "/webhooks/ghl/sms/outbound",
    async (req: RawBodyRequest, res, next) => {
      try {
        if (!req.rawBody) {
          throw new HttpError(400, "Raw SMS provider callback body is required");
        }

        if (
          !dependencies.verifySignature({
            rawBody: req.rawBody,
            ghlSignature: req.header("x-ghl-signature") ?? undefined,
          })
        ) {
          throw new HttpError(
            401,
            "Invalid HighLevel SMS provider callback signature",
          );
        }

        const result = await dependencies.handler(
          ghlSmsProviderPayloadSchema.parse(req.body),
        );
        res.status(result.httpStatus).json(result.body);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const ghlSmsProviderWebhookRouter =
  createGhlSmsProviderWebhookRouter({
    verifySignature: verifyGhlWebhookSignature,
    handler: processGhlSmsProviderOutbound,
  });
