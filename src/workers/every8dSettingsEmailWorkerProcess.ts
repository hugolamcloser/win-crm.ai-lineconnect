import { readEvery8dSettingsEmailWorkerConfig } from "../config/every8dSettingsEmailWorker";
import type { Every8dSettingsEmailProviderRegistry } from "../services/every8dSettingsEmailProviderRegistry";
import type { Every8dSettingsEmailOutboxRepository } from "../types/every8dSettingsEmailOutbox";
import type { createEvery8dSettingsEmailWorkerRuntime } from "./every8dSettingsEmailWorkerRuntime";
import type { Every8dSettingsEmailWorkerClock } from "../services/every8dSettingsEmailWorker";
import { createEmailWorkerTelemetry } from "./every8dSettingsEmailWorkerTelemetry";
import type { EmailWorkerTelemetry, EmailWorkerStopReason } from "./every8dSettingsEmailWorkerTelemetry";

export type EmailWorkerProcess = Readonly<{
  on(event: "SIGTERM" | "SIGINT" | "uncaughtException" | "unhandledRejection", listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}>;
/** Separate from the executable so tests can supply only network-free dependencies. */
export async function runEvery8dSettingsEmailWorkerProcess(dependencies: Readonly<{
  process: EmailWorkerProcess; loadEnvironment(): NodeJS.ProcessEnv;
  registry?: Every8dSettingsEmailProviderRegistry;
  createRepository(config: import("../config/every8dSettingsAuth").Every8dSettingsAuthConfig): Every8dSettingsEmailOutboxRepository;
  telemetry: EmailWorkerTelemetry; clock?: Every8dSettingsEmailWorkerClock; random?: () => number;
}>): Promise<Readonly<{ exitCode: number; forceExit: boolean }>> {
  const emit = createEmailWorkerTelemetry(dependencies.telemetry);
  let stopping = false, failure = false;
  let runtime: ReturnType<typeof createEvery8dSettingsEmailWorkerRuntime> | undefined;
  function stop(reason: EmailWorkerStopReason): void {
    if (stopping) return;
    stopping = true;
    if (reason === "process_failure") failure = true;
    void runtime?.stop(reason);
  }
  const signal = () => stop("signal"), fatal = () => stop("process_failure");
  const handlers = [["SIGTERM", signal], ["SIGINT", signal], ["uncaughtException", fatal], ["unhandledRejection", fatal]] as const;
  for (const [event, handler] of handlers) dependencies.process.on(event, handler);
  try {
    const source = dependencies.loadEnvironment();
    if (stopping) return Object.freeze({ exitCode: failure ? 1 : 0, forceExit: false });
    const config = readEvery8dSettingsEmailWorkerConfig(source, dependencies.registry);
    if (config.status === "disabled") { emit("disabled"); return Object.freeze({ exitCode: 0, forceExit: false }); }
    if (stopping) return Object.freeze({ exitCode: failure ? 1 : 0, forceExit: false });
    const ready = config.registration.parseReadiness(source);
    if (stopping) return Object.freeze({ exitCode: failure ? 1 : 0, forceExit: false });
    const provider = ready.createClient();
    if (stopping) return Object.freeze({ exitCode: failure ? 1 : 0, forceExit: false });
    const repository = dependencies.createRepository(config.auth);
    if (stopping) return Object.freeze({ exitCode: failure ? 1 : 0, forceExit: false });
    const { createEvery8dSettingsEmailWorkerRuntime: createRuntime } = require("./every8dSettingsEmailWorkerRuntime") as
      typeof import("./every8dSettingsEmailWorkerRuntime");
    runtime = createRuntime({ repository, provider,
      encryptionKeyring: config.emailOutboxEncryption.keys, canonicalSender: config.canonicalSender,
      clock: dependencies.clock, random: dependencies.random, telemetry: dependencies.telemetry });
    runtime.start();
    const result = await runtime.done;
    return Object.freeze({ exitCode: failure || !result.drained || result.reason !== "signal" ? 1 : 0,
      forceExit: !result.drained });
  } catch {
    emit("startup_failed");
    if (runtime) await runtime.stop("internal_failure");
    return Object.freeze({ exitCode: 1, forceExit: false });
  } finally {
    for (const [event, handler] of handlers) dependencies.process.removeListener(event, handler);
  }
}
