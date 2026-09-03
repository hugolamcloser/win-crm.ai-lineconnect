import { Router } from "express";
import { z } from "zod";
import { requireSharedSecret } from "../middleware/sharedSecret";
import { executeLineContactReconciliationApplyDryRun } from "../services/lineContactReconciliationApplyDryRunService";
import { previewLineContactReconciliation } from "../services/lineContactReconciliationPreviewService";
import type {
  ContactReconciliationDryRunRequest,
  ContactReconciliationDryRunResponse
} from "../types/lineContactReconciliationApplyDryRun";
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

const applyDryRunRequestSchema = z.object({
  authorizationId: z.string().uuid(),
  authorizationToken: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/),
  previewKey: z.string().regex(/^[0-9a-f]{32}$/),
  request: previewRequestSchema
}).strict();

type PreviewHandler = (
  request: LineContactReconciliationPreviewRequest
) => Promise<LineContactReconciliationPreviewResponse>;

type ApplyDryRunHandler = (
  request: ContactReconciliationDryRunRequest
) => Promise<ContactReconciliationDryRunResponse>;

export function createLineContactReconciliationRouter(
  preview: PreviewHandler = previewLineContactReconciliation,
  applyDryRun: ApplyDryRunHandler = executeLineContactReconciliationApplyDryRun
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

  router.post("/internal/line-contact-reconcile/apply/dry-run", requireSharedSecret, async (req, res, next) => {
    try {
      const input = applyDryRunRequestSchema.parse(req.body);
      res.status(200).json(await applyDryRun(input));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const lineContactReconciliationRouter = createLineContactReconciliationRouter();
