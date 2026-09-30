import crypto from "node:crypto";
import { logger } from "../config/logger";
import { every8dGhlOAuthRefreshService } from "./every8dGhlOAuthRefreshService";

export const every8dGhlOAuthRefreshStartupMinimumMs = 5_000;
export const every8dGhlOAuthRefreshStartupMaximumMs = 15_000;
export const every8dGhlOAuthRefreshIntervalMs = 60_000;
export const every8dGhlOAuthRefreshMaximumJitterMs = 10_000;
export const every8dGhlOAuthRefreshShutdownDrainMs = 20_000;

type RefreshRuntime = {
  isEnabled(): boolean;
  runOnce(): Promise<unknown>;
};

type ReconcilerLogger = Pick<typeof logger, "info" | "warn">;
type TimerHandle = ReturnType<typeof setTimeout>;

type ReconcilerDependencies = {
  runtime: RefreshRuntime;
  log: ReconcilerLogger;
  randomInt: (minimum: number, maximumExclusive: number) => number;
  setTimeoutImpl: (callback: () => void, milliseconds: number) => TimerHandle;
  clearTimeoutImpl: (handle: TimerHandle) => void;
};

export function createEvery8dGhlOAuthRefreshReconciler(
  dependencies: ReconcilerDependencies
) {
  let started = false;
  let timer: TimerHandle | null = null;
  let inFlight: Promise<void> | null = null;

  function nextStartupDelay(): number {
    return dependencies.randomInt(
      every8dGhlOAuthRefreshStartupMinimumMs,
      every8dGhlOAuthRefreshStartupMaximumMs + 1
    );
  }

  function nextRecurringDelay(): number {
    return every8dGhlOAuthRefreshIntervalMs
      + dependencies.randomInt(0, every8dGhlOAuthRefreshMaximumJitterMs + 1);
  }

  function trigger(): Promise<void> {
    if (!dependencies.runtime.isEnabled()) return Promise.resolve();
    if (inFlight) return inFlight;

    inFlight = Promise.resolve()
      .then(async () => dependencies.runtime.runOnce())
      .then(() => undefined)
      .catch(() => {
        dependencies.log.warn({ event: "every8d_ghl_oauth_refresh_timer_error" },
          "EVERY8D HighLevel OAuth refresh pass failed safely");
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function schedule(delayMs: number): void {
    if (!started || !dependencies.runtime.isEnabled()) return;
    timer = dependencies.setTimeoutImpl(() => {
      timer = null;
      void trigger().finally(() => {
        if (!started) return;
        try {
          schedule(nextRecurringDelay());
        } catch {
          started = false;
          dependencies.log.warn({ event: "every8d_ghl_oauth_refresh_timer_error" },
            "EVERY8D HighLevel OAuth refresh timer failed safely");
        }
      });
    }, delayMs);
    if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
      timer.unref();
    }
  }

  return {
    start(): boolean {
      if (started || !dependencies.runtime.isEnabled()) return false;
      started = true;
      try {
        const delayMs = nextStartupDelay();
        dependencies.log.info({
          event: "every8d_ghl_oauth_refresh_reconciler_started",
          startupDelayMs: delayMs
        }, "EVERY8D HighLevel OAuth refresh reconciler started");
        schedule(delayMs);
        return true;
      } catch {
        started = false;
        dependencies.log.warn({ event: "every8d_ghl_oauth_refresh_timer_error" },
          "EVERY8D HighLevel OAuth refresh timer failed safely");
        return false;
      }
    },

    trigger,

    async stopAndDrain(): Promise<void> {
      started = false;
      if (timer) {
        dependencies.clearTimeoutImpl(timer);
        timer = null;
      }
      const activePass = inFlight;
      if (!activePass) return;

      let drainTimer: TimerHandle | null = null;
      await Promise.race([
        activePass,
        new Promise<void>((resolve) => {
          drainTimer = dependencies.setTimeoutImpl(resolve, every8dGhlOAuthRefreshShutdownDrainMs);
        })
      ]);
      if (drainTimer) dependencies.clearTimeoutImpl(drainTimer);
    }
  };
}

export const every8dGhlOAuthRefreshReconciler = createEvery8dGhlOAuthRefreshReconciler({
  runtime: every8dGhlOAuthRefreshService,
  log: logger,
  randomInt: crypto.randomInt,
  setTimeoutImpl: setTimeout,
  clearTimeoutImpl: clearTimeout
});
