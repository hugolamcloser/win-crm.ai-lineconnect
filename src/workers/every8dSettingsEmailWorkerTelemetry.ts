/** Closed operational vocabulary. No caller payload is spread or logged. */
export type EmailWorkerEvent = "disabled" | "startup_failed" | "ready" | "batch" |
  "recovery" | "purge" | "repository_failure" | "repository_contract_violation" |
  "repository_stall" | "poll_wait" | "backoff_wait" | "stopping" | "drained" | "drain_expired";
export type EmailWorkerStopReason = "signal" | "process_failure" | "repository_stall" |
  "repository_contract_violation" | "internal_failure";
const events: readonly string[] = ["disabled", "startup_failed", "ready", "batch", "recovery", "purge",
  "repository_failure", "repository_contract_violation", "repository_stall", "poll_wait", "backoff_wait",
  "stopping", "drained", "drain_expired"];
const reasons: readonly string[] = ["signal", "process_failure", "repository_stall",
  "repository_contract_violation", "internal_failure"];
export type EmailWorkerTelemetry = (event: Readonly<{
  component: "settings_email_worker"; event: EmailWorkerEvent; delayMs?: number; reason?: EmailWorkerStopReason;
}>) => void;
export function createEmailWorkerTelemetry(sink: EmailWorkerTelemetry) {
  return (event: EmailWorkerEvent, delayMs?: number, reason?: EmailWorkerStopReason): void => {
    if (!events.includes(event)) return;
    // Reconstruct even typed input; runtime JavaScript callers confer no telemetry authority.
    const safe = Object.freeze({ component: "settings_email_worker" as const, event,
      ...(typeof delayMs === "number" && Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 20000 ? { delayMs } : {}),
      ...(typeof reason === "string" && reasons.includes(reason) ? { reason } : {}) });
    try { sink(safe); } catch { /* Telemetry cannot change durable decisions or shutdown. */ }
  };
}
