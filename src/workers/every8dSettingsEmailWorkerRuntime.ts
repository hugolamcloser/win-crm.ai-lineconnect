import type { Every8dSettingsAuthHmacKeyring } from "../config/every8dSettingsAuth";
import type { Every8dSettingsEmailOutboxRepository } from "../types/every8dSettingsEmailOutbox";
import type { Every8dSettingsEmailProvider, Every8dSettingsEmailProviderResult } from "../types/every8dSettingsEmailProvider";
import { createEvery8dSettingsEmailWorker } from "../services/every8dSettingsEmailWorker";
import type { Every8dSettingsEmailWorkerClock } from "../services/every8dSettingsEmailWorker";
import { createEmailWorkerTelemetry } from "./every8dSettingsEmailWorkerTelemetry";
import type { EmailWorkerTelemetry, EmailWorkerStopReason } from "./every8dSettingsEmailWorkerTelemetry";

export const emailWorkerTiming = Object.freeze({ pollMs: 1000, pollJitterMs: 200,
  backoffMs: Object.freeze([1000, 2000, 4000, 8000, 10000]), recoveryMs: 5000, purgeMs: 60000,
  maintenanceBatch: 100, repositoryStallMs: 15000, drainMs: 20000 });
export const emailWorkerClock: Every8dSettingsEmailWorkerClock = Object.freeze({
  nowNs: () => process.hrtime.bigint(),
  schedule(delayMs, callback) { const timer = setTimeout(callback, delayMs); return () => clearTimeout(timer); }
});
/** Application admission refusal, never a repository result or acknowledgement. */
export class EmailWorkerStopping extends Error {
  constructor() { super("Email worker admission closed"); this.name = "EmailWorkerStopping"; }
}
type Repository = Pick<Every8dSettingsEmailOutboxRepository, "claim" | "beginSend" | "finalize" | "recover" | "purge">;
export type EmailWorkerExit = Readonly<{ reason: EmailWorkerStopReason; drained: boolean }>;
export function emailWorkerDelay(failures: number, random: () => number): number {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error("Invalid worker jitter source");
  if (failures === 0) return 1000 + Math.floor(sample * 201);
  const tier = emailWorkerTiming.backoffMs[Math.min(failures - 1, 4)]!;
  return tier * 0.9 + Math.floor(sample * (tier * 0.1 + 1));
}

/** One serial application loop; the unchanged engine still owns each one-shot batch. */
export function createEvery8dSettingsEmailWorkerRuntime(dependencies: Readonly<{
  repository: Repository; encryptionKeyring: Every8dSettingsAuthHmacKeyring;
  provider: Every8dSettingsEmailProvider; canonicalSender: string;
  clock?: Every8dSettingsEmailWorkerClock; random?: () => number; telemetry: EmailWorkerTelemetry;
}>) {
  const clock = dependencies.clock ?? emailWorkerClock;
  const emit = createEmailWorkerTelemetry(dependencies.telemetry, clock);
  let state: "idle" | "running" | "stopping" | "stopped" = "idle";
  let stopReason: EmailWorkerStopReason = "signal";
  let flowActive = false, repositoryActive = 0, providerActive = 0, repositoryFailed = false;
  let cancelWait = () => {}, cancelDrain = () => {};
  const cancellation = new AbortController();
  let resolveDone!: (result: EmailWorkerExit) => void;
  const done = new Promise<EmailWorkerExit>((resolve) => { resolveDone = resolve; });
  function finish(drained: boolean): void {
    if (state !== "stopping") return;
    state = "stopped";
    cancelWait(); cancelDrain();
    emit(drained ? "drained" : "drain_expired", undefined, stopReason);
    resolveDone(Object.freeze({ reason: stopReason, drained }));
  }
  function checkDrain(): void {
    if (!flowActive && repositoryActive === 0 && providerActive === 0) finish(true);
  }
  function stop(reason: EmailWorkerStopReason = "signal"): Promise<EmailWorkerExit> {
    if (state === "stopping" || state === "stopped") return done;
    stopReason = reason; state = "stopping";
    emit("stopping", undefined, reason);
    cancelDrain = clock.schedule(emailWorkerTiming.drainMs, () => finish(false));
    cancelWait();
    cancellation.abort();
    checkDrain();
    return done;
  }
  function admit(finalization = false): void {
    if (state !== "running" && !(finalization && state === "stopping")) throw new EmailWorkerStopping();
  }
  async function operation<T extends { outcome: string; category?: string }>(call: () => Promise<T>, finalization = false): Promise<T> {
    admit(finalization);
    repositoryActive += 1;
    const cancelStall = clock.schedule(emailWorkerTiming.repositoryStallMs, () => {
      // Observe only. Never race/replace this promise or release its slot on timeout.
      emit("repository_stall"); void stop("repository_stall");
    });
    try {
      const result = await call();
      if (result.outcome === "failure") {
        repositoryFailed = true;
        if (result.category === "repository_contract_violation") {
          emit("repository_contract_violation"); void stop("repository_contract_violation");
        } else emit("repository_failure");
      }
      return result; // Preserve the exact repository acknowledgement, including late results.
    } catch (error) {
      repositoryFailed = true; emit("repository_failure"); throw error;
    } finally { cancelStall(); repositoryActive -= 1; checkDrain(); }
  }
  const repository: Repository = Object.freeze({
    claim: (input) => operation(() => dependencies.repository.claim(input)),
    beginSend: (input) => operation(() => dependencies.repository.beginSend(input)),
    finalize: (input) => operation(() => dependencies.repository.finalize(input), true),
    recover: (input) => operation(() => dependencies.repository.recover(input)),
    purge: (input) => operation(() => dependencies.repository.purge(input))
  });
  const provider: Every8dSettingsEmailProvider = Object.freeze({
    send(input) {
      admit();
      const deadline = input.deadlineMonotonicNs;
      const remainingMs = Number((deadline - clock.nowNs()) / 1000000n);
      if (remainingMs < 1) throw new EmailWorkerStopping();
      // Forward engine cancellation without replacing its original deadline or
      // treating abort as positive non-acceptance.
      const controller = new AbortController();
      const inputSignal = input.signal;
      providerActive += 1;
      return new Promise<Every8dSettingsEmailProviderResult>((resolve) => {
        let settled = false, cancelDeadline = () => {};
        const finishProvider = (result: Every8dSettingsEmailProviderResult, abort: boolean) => {
          if (settled) return;
          settled = true; cancelDeadline();
          inputSignal.removeEventListener("abort", forwardAbort);
          if (abort) controller.abort();
          providerActive -= 1; resolve(result); checkDrain();
        };
        const unknown = Object.freeze({ outcome: "outcome_unknown" } as const);
        const forwardAbort = () => finishProvider(unknown, true);
        try {
          inputSignal.addEventListener("abort", forwardAbort, { once: true });
          if (inputSignal.aborted) { forwardAbort(); return; }
          cancelDeadline = clock.schedule(remainingMs, forwardAbort);
          if (settled) { cancelDeadline(); return; }
          // No retries and no new invocation after a synchronous stop during setup.
          admit();
          Promise.resolve(dependencies.provider.send(Object.freeze({ canonicalSender: input.canonicalSender,
            recipient: input.recipient, subject: input.subject, body: input.body, idempotencyKey: input.idempotencyKey,
            signal: controller.signal, deadlineMonotonicNs: deadline }))).then(
            (result) => finishProvider(clock.nowNs() >= deadline ? unknown : result, clock.nowNs() >= deadline),
            () => finishProvider(unknown, true));
        } catch { finishProvider(unknown, true); }
      });
    }
  });
  const worker = createEvery8dSettingsEmailWorker({ repository,
    encryptionKeyring: dependencies.encryptionKeyring,
    sender: Object.freeze({ status: "available", canonicalSender: dependencies.canonicalSender, adapter: provider }), clock });
  function wait(delay: number): Promise<void> {
    if (state !== "running") return Promise.resolve();
    return new Promise((resolve) => {
      const cancel = clock.schedule(delay, () => { cancelWait = () => {}; resolve(); });
      cancelWait = () => { cancel(); cancelWait = () => {}; resolve(); };
    });
  }
  async function loop(): Promise<void> {
    let nextRecovery = 0n, nextPurge = 0n, nextPoll = 0n, startupComplete = false, failures = 0;
    try {
      while (state === "running") {
        repositoryFailed = false;
        const now = clock.nowNs();
        const purgeDue = now >= nextPurge;
        let recoveredThisPass = false;
        // Due times are advanced from completion, so missed intervals coalesce.
        if (purgeDue || now >= nextRecovery) {
          const recovered = await repository.recover({ batchSize: 100 });
          if (state !== "running") break;
          if (recovered.outcome === "applied") {
            recoveredThisPass = true;
            nextRecovery = clock.nowNs() + 5000000000n; emit("recovery");
          }
        }
        if (purgeDue && recoveredThisPass && !repositoryFailed && state === "running") {
          const purged = await repository.purge({ batchSize: 100 });
          if (state !== "running") break;
          if (purged.outcome === "applied") {
            nextPurge = clock.nowNs() + 60000000000n; emit("purge");
          }
        }
        if (!repositoryFailed && !startupComplete && nextRecovery > 0n && nextPurge > 0n) {
          startupComplete = true; emit("ready");
        }
        let ranBatch = false;
        if (!repositoryFailed && startupComplete && state === "running" && clock.nowNs() >= nextPoll) {
          ranBatch = true;
          const batch = await worker.runBatch(cancellation.signal);
          if (state !== "running") break;
          if (batch.outcome !== "completed") repositoryFailed = true;
          if (batch.outcome === "completed" && batch.diagnostics.length > 0) emit("batch");
        }
        if (state !== "running") break;
        if (repositoryFailed) {
          failures = Math.min(failures + 1, 5);
          const delay = emailWorkerDelay(failures, dependencies.random ?? Math.random);
          emit("backoff_wait", delay);
          nextPoll = clock.nowNs() + BigInt(delay) * 1000000n;
          await wait(delay); // Maintenance cannot bypass repository backoff.
        } else {
          failures = 0;
          if (ranBatch) {
            const delay = emailWorkerDelay(0, dependencies.random ?? Math.random);
            nextPoll = clock.nowNs() + BigInt(delay) * 1000000n;
          }
          // Maintenance may wake the loop early, but must not shorten the poll delay.
          const nextMaintenance = nextRecovery < nextPurge ? nextRecovery : nextPurge;
          const nextWake = nextPoll < nextMaintenance ? nextPoll : nextMaintenance;
          await wait(Math.max(0, Number((nextWake - clock.nowNs()) / 1000000n)));
        }
      }
    } catch (error) {
      if (!(error instanceof EmailWorkerStopping)) void stop("internal_failure");
    } finally { flowActive = false; checkDrain(); }
  }
  return Object.freeze({
    done, stop,
    start(): void {
      if (state !== "idle") return;
      state = "running"; flowActive = true;
      // loop owns every rejection; no timer can start a second loop/batch.
      void loop();
    },
    get state() { return state; }
  });
}
