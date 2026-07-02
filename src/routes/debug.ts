import { Router } from "express";
import { getEnvPresenceReport } from "../config/env";

export const debugRouter = Router();

debugRouter.get("/debug/env-check", (_req, res) => {
  res.json({
    ok: true,
    environment: getEnvPresenceReport()
  });
});
