import { Router } from "express";
import { z } from "zod";
import { requireSharedSecret } from "../middleware/sharedSecret";
import { ensureDefaultTenant, linkGhlMapping } from "../services/repository";

const linkMappingSchema = z.object({
  lineUserId: z.string().min(1),
  ghlContactId: z.string().min(1).optional(),
  ghlConversationId: z.string().min(1).optional()
});

export const adminRouter = Router();

adminRouter.post("/admin/mappings", requireSharedSecret, async (req, res, next) => {
  try {
    const input = linkMappingSchema.parse(req.body);
    const tenantId = await ensureDefaultTenant();
    const record = await linkGhlMapping({
      tenantId,
      lineUserId: input.lineUserId,
      ghlContactId: input.ghlContactId,
      ghlConversationId: input.ghlConversationId
    });

    res.json({ ok: true, record });
  } catch (error) {
    next(error);
  }
});
