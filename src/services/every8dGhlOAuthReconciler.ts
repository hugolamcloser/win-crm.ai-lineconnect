import { logger } from "../config/logger";
import { every8dGhlOAuthRuntime } from "./every8dGhlOAuthService";

const intervalMs = 30_000;

type ReconcileRuntime = {
  isEnabled(): boolean;
  reconcileOnce(): Promise<void>;
};

export function createEvery8dGhlOAuthReconciler(runtime: ReconcileRuntime) {
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  async function run(): Promise<void> {
    if (!runtime.isEnabled() || running) return;
    running = true;
    try {
      await runtime.reconcileOnce();
    } catch {
      logger.warn("EVERY8D OAuth reconciler pass failed safely");
    } finally {
      running = false;
    }
  }

  function trigger(): void {
    if (!runtime.isEnabled()) return;
    setImmediate(() => { void run(); });
  }

  return {
    trigger,
    start(): () => void {
      if (!runtime.isEnabled() || timer) return () => undefined;
      trigger();
      timer = setInterval(() => { void run(); }, intervalMs);
      timer.unref();
      return () => {
        if (timer) clearInterval(timer);
        timer = null;
      };
    }
  };
}

export const every8dGhlOAuthReconciler = createEvery8dGhlOAuthReconciler(every8dGhlOAuthRuntime);
