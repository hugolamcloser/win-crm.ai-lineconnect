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
  suppressedCount?: number;
}>) => void;
const suppressionWindowNs = 60000000000n;
const maxSuppressedCount = 2147483647;
export function createEmailWorkerTelemetry(sink: EmailWorkerTelemetry, clock?: Readonly<{ nowNs(): bigint }>) {
  // Fixed keys and numeric bookkeeping only; never retain an attempted event,
  // delay, reason, diagnostic, request or exception. No suppression timer.
  const suppression = new Map<string, { lastEmissionNs: bigint; count: number }>();
  return (event: EmailWorkerEvent, delayMs?: number, reason?: EmailWorkerStopReason, suppressedCount?: number): void => {
    if (!events.includes(event)) return;
    try {
      const category = ["batch", "recovery", "purge", "poll_wait"].includes(event) ? "activity" :
        ["repository_failure", "repository_contract_violation", "repository_stall", "backoff_wait"].includes(event) ? event : undefined;
      if (clock && category) {
        const now = clock.nowNs(), previous = suppression.get(category);
        if (previous && now - previous.lastEmissionNs < suppressionWindowNs) {
          previous.count = Math.min(maxSuppressedCount, previous.count + 1);
          return;
        }
        suppressedCount = previous?.count || undefined;
        // Count even a failed sink attempt so logging failures cannot cause a storm.
        suppression.set(category, { lastEmissionNs: now, count: 0 });
      }
      // Reconstruct even typed input; runtime JavaScript callers confer no telemetry authority.
      const safe = Object.freeze({ component: "settings_email_worker" as const, event,
        ...(typeof delayMs === "number" && Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 20000 ? { delayMs } : {}),
        ...(typeof reason === "string" && reasons.includes(reason) ? { reason } : {}),
        ...(typeof suppressedCount === "number" && Number.isFinite(suppressedCount) && Number.isInteger(suppressedCount) && suppressedCount >= 0 ?
          { suppressedCount: Math.min(maxSuppressedCount, suppressedCount) } : {}) });
      sink(safe);
    } catch { /* Telemetry cannot change durable decisions or shutdown. */ }
  };
}
