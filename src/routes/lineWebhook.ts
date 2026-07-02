import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/errors";
import type { RawBodyRequest } from "../types/http";
import type { LineWebhookPayload } from "../types/line";
import { verifyLineSignature } from "../integrations/lineClient";
import { processLineWebhookEvent } from "../services/lineSyncService";

const lineWebhookSchema = z.object({
  destination: z.string(),
  events: z.array(z.record(z.unknown()))
});

export const lineWebhookRouter = Router();

lineWebhookRouter.post(["/webhooks/line", "/webhooks/line/inbound"], async (req: RawBodyRequest, res, next) => {
  try {
    const signature = req.header("x-line-signature");

    if (!req.rawBody || !verifyLineSignature(req.rawBody, signature)) {
      throw new HttpError(401, "Invalid LINE signature");
    }

    const payload = lineWebhookSchema.parse(req.body) as LineWebhookPayload;
    const results = [];

    for (const event of payload.events) {
      results.push(await processLineWebhookEvent(event));
    }

    res.json({ ok: true, results });
  } catch (error) {
    next(error);
  }
});
