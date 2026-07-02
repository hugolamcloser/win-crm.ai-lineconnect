import pino from "pino";
import { env } from "./env";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.x-line-signature",
      "req.headers.x-ghl-signature",
      "req.headers.x-provider-secret",
      "config.SUPABASE_SERVICE_ROLE_KEY",
      "config.LINE_CHANNEL_ACCESS_TOKEN",
      "config.GHL_PRIVATE_INTEGRATION_TOKEN"
    ],
    censor: "[redacted]"
  }
});
