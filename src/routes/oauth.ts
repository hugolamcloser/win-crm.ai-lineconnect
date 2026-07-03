import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middleware/errors";
import { exchangeGhlAuthorizationCode } from "../services/ghlOAuthService";

const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().optional()
});

export const oauthRouter = Router();

oauthRouter.get("/oauth/callback", async (req, res, next) => {
  try {
    const parsed = oauthCallbackSchema.safeParse(req.query);

    if (!parsed.success) {
      throw new HttpError(400, "Missing GHL OAuth authorization code", parsed.error.flatten());
    }

    const status = await exchangeGhlAuthorizationCode(parsed.data.code);

    res.json({
      ok: true,
      installed: true,
      state: parsed.data.state,
      oauth: status
    });
  } catch (error) {
    next(error);
  }
});
