import { Router } from "express";
import { getEnvPresenceReport } from "../config/env";
import { getRecentDebugEvents } from "../services/repository";
import { redactSecrets } from "../utils/redaction";

export const debugRouter = Router();

debugRouter.get("/debug/env-check", (_req, res) => {
  res.json({
    ok: true,
    environment: getEnvPresenceReport()
  });
});

debugRouter.get("/debug/recent-events", async (_req, res, next) => {
  try {
    const events = redactSecrets(await getRecentDebugEvents());
    res.json({
      ok: true,
      ...events
    });
  } catch (error) {
    next(error);
  }
});
