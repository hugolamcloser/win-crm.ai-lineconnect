import { Router } from "express";
import { z } from "zod";
import { logger } from "../config/logger";
import { HttpError } from "../middleware/errors";
import type { RawBodyRequest } from "../types/http";
import type { LineWebhookPayload } from "../types/line";
import { verifyLineSignature } from "../integrations/lineClient";
import { processLineWebhookEvent, type LineInboundProcessingContext } from "../services/lineSyncService";
import { getLineChannelByWebhookKey } from "../services/repository";
import { serializeError } from "../utils/errors";
import { redactSecrets } from "../utils/redaction";

const lineWebhookSchema = z.object({
  destination: z.string(),
  events: z.array(z.record(z.unknown()))
});

export const lineWebhookRouter = Router();

async function processLineEventsInBackground(
  payload: LineWebhookPayload,
  context: LineInboundProcessingContext = {}
): Promise<void> {
  for (const event of payload.events) {
    try {
      await processLineWebhookEvent(event, context);
    } catch (error) {
      logger.error(
        {
          tenantId: context.tenantId,
          lineChannelId: context.lineChannelId,
          webhookKey: context.webhookKey,
          lineUserId: "userId" in event.source ? event.source.userId : undefined,
          lineMessageId: event.message?.id,
          error: redactSecrets(serializeError(error))
        },
        "Unhandled LINE background processing error"
      );
    }
  }
}

function hasUsableCredential(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

lineWebhookRouter.post("/webhooks/line/:webhookKey/inbound", async (req: RawBodyRequest, res, next) => {
  try {
    const webhookKey = req.params.webhookKey;
    const lineChannel = await getLineChannelByWebhookKey(webhookKey);

    if (!lineChannel) {
      logger.warn("LINE webhook channel not found");
      throw new HttpError(404, "LINE channel not found");
    }

    if (!lineChannel.is_active) {
      logger.warn({ lineChannelId: lineChannel.id, tenantId: lineChannel.tenant_id }, "LINE webhook channel is inactive");
      throw new HttpError(403, "LINE channel is inactive");
    }

    if (!hasUsableCredential(lineChannel.channel_access_token) || !hasUsableCredential(lineChannel.channel_secret)) {
      logger.warn(
        {
          webhookKey,
          lineChannelId: lineChannel.id,
          tenantId: lineChannel.tenant_id,
          channelAccessTokenPresent: hasUsableCredential(lineChannel.channel_access_token),
          channelSecretPresent: hasUsableCredential(lineChannel.channel_secret)
        },
        "LINE webhook channel credentials are incomplete"
      );
      throw new HttpError(409, "LINE channel is not connected");
    }

    const signature = req.header("x-line-signature");

    if (!req.rawBody || !verifyLineSignature(req.rawBody, signature, lineChannel.channel_secret)) {
      throw new HttpError(401, "Invalid LINE signature");
    }

    const payload = lineWebhookSchema.parse(req.body) as LineWebhookPayload;
    logger.info(
      {
        webhookKey,
        lineChannelId: lineChannel.id,
        tenantId: lineChannel.tenant_id,
        eventCount: payload.events.length
      },
      "LINE webhook accepted for background processing"
    );
    res.json({ ok: true, accepted: true });
    void processLineEventsInBackground(payload, {
      tenantId: lineChannel.tenant_id,
      lineChannelId: lineChannel.id,
      webhookKey,
      channelAccessToken: lineChannel.channel_access_token
    });
  } catch (error) {
    next(error);
  }
});

lineWebhookRouter.post(["/webhooks/line", "/webhooks/line/inbound"], (req: RawBodyRequest, res, next) => {
  try {
    const signature = req.header("x-line-signature");

    if (!req.rawBody || !verifyLineSignature(req.rawBody, signature)) {
      throw new HttpError(401, "Invalid LINE signature");
    }

    const payload = lineWebhookSchema.parse(req.body) as LineWebhookPayload;
    logger.info({ eventCount: payload.events.length }, "LINE webhook accepted for background processing");
    res.json({ ok: true, accepted: true });
    void processLineEventsInBackground(payload);
  } catch (error) {
    next(error);
  }
});
