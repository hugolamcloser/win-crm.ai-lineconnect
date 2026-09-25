import { env } from "./config/env";
import { logger } from "./config/logger";
import { createApp } from "./app";
import { every8dGhlOAuthReconciler } from "./services/every8dGhlOAuthReconciler";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "LINE to GHL middleware listening");
});
const stopEvery8dOAuthReconciler = every8dGhlOAuthReconciler.start();

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  stopEvery8dOAuthReconciler();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
