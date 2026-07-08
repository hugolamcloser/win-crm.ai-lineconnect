import type { IncomingMessage } from "node:http";
import express from "express";
import helmet from "helmet";
import pino from "pino";
import pinoHttp from "pino-http";
import { logger } from "./config/logger";
import { jsonBodyParser } from "./middleware/jsonBody";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import { adminRouter } from "./routes/admin";
import { appLineRouter } from "./routes/appLine";
import { debugRouter } from "./routes/debug";
import { ghlWebhookRouter } from "./routes/ghlWebhook";
import { healthRouter } from "./routes/health";
import { lineWebhookRouter } from "./routes/lineWebhook";
import { oauthRouter } from "./routes/oauth";

const sensitiveQueryKeys = new Set([
  "pageToken",
  "actionToken",
  "channelAccessToken",
  "channelSecret",
  "channel_access_token",
  "channel_secret"
]);

function redactSensitiveUrlQuery(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return rawUrl;
  }

  try {
    const parsedUrl = new URL(rawUrl, "http://localhost");
    let changed = false;

    for (const key of sensitiveQueryKeys) {
      if (parsedUrl.searchParams.has(key)) {
        parsedUrl.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }

    return changed ? `${parsedUrl.pathname}${parsedUrl.search}` : rawUrl;
  } catch {
    return rawUrl.replace(
      /([?&](?:pageToken|actionToken|channelAccessToken|channelSecret|channel_access_token|channel_secret)=)[^&]*/gi,
      "$1[redacted]"
    );
  }
}

function redactRequestSerializer(req: IncomingMessage): Record<string, unknown> {
  const serializedReq = pino.stdSerializers.req(req) as unknown as Record<string, unknown> & { url?: unknown };

  if (typeof serializedReq.url === "string") {
    serializedReq.url = redactSensitiveUrlQuery(serializedReq.url);
  }

  return serializedReq;
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(pinoHttp({ logger, serializers: { req: redactRequestSerializer } }));
  app.use(jsonBodyParser);

  app.use(healthRouter);
  app.use(debugRouter);
  app.use(oauthRouter);
  app.use(lineWebhookRouter);
  app.use(ghlWebhookRouter);
  app.use(appLineRouter);
  app.use(adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
