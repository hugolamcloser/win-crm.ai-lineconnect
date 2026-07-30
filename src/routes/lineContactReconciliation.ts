import { Router } from "express";
import { z } from "zod";
import { requireSharedSecret } from "../middleware/sharedSecret";
import { previewLineContactReconciliation } from "../services/lineContactReconciliationPreviewService";
import type {
  LineContactReconciliationPreviewRequest,
  LineContactReconciliationPreviewResponse
} from "../types/lineContactReconciliation";

const previewRequestSchema = z.object({
  locationId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  currentContactId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  source: z.string().trim().min(1).max(32),
  identity: z.object({
    email: z.string().max(320).optional(),
    phone: z.string().max(32).optional()
  }).strict()
}).strict();

type PreviewHandler = (
  request: LineContactReconciliationPreviewRequest
) => Promise<LineContactReconciliationPreviewResponse>;

export function createLineContactReconciliationRouter(
  preview: PreviewHandler = previewLineContactReconciliation
): Router {
  const router = Router();

  router.post("/internal/line-contact-reconcile/preview", requireSharedSecret, async (req, res, next) => {
    try {
      const input = previewRequestSchema.parse(req.body);
      res.status(200).json(await preview(input));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const lineContactReconciliationRouter = createLineContactReconciliationRouter();
