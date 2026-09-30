import { env } from "./config/env";
import { logger } from "./config/logger";
import { createApp } from "./app";
import { every8dGhlOAuthReconciler } from "./services/every8dGhlOAuthReconciler";
import { every8dGhlOAuthRefreshReconciler } from "./services/every8dGhlOAuthRefreshReconciler";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "LINE to GHL middleware listening");
});
const stopEvery8dOAuthReconciler = every8dGhlOAuthReconciler.start();
every8dGhlOAuthRefreshReconciler.start();
let shutdownStarted = false;

async function shutdown(signal: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info({ signal }, "Shutting down");
  stopEvery8dOAuthReconciler();
  const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.all([every8dGhlOAuthRefreshReconciler.stopAndDrain(), serverClosed]);
  process.exit(0);
}

process.on("SIGINT", (signal) => { void shutdown(signal); });
process.on("SIGTERM", (signal) => { void shutdown(signal); });
