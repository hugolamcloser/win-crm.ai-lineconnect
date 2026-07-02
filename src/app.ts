import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { logger } from "./config/logger";
import { jsonBodyParser } from "./middleware/jsonBody";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import { adminRouter } from "./routes/admin";
import { debugRouter } from "./routes/debug";
import { ghlWebhookRouter } from "./routes/ghlWebhook";
import { healthRouter } from "./routes/health";
import { lineWebhookRouter } from "./routes/lineWebhook";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(pinoHttp({ logger }));
  app.use(jsonBodyParser);

  app.use(healthRouter);
  app.use(debugRouter);
  app.use(lineWebhookRouter);
  app.use(ghlWebhookRouter);
  app.use(adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
