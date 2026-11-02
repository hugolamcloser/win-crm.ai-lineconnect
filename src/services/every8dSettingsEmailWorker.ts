import type { Every8dSettingsAuthHmacKeyring } from "../config/every8dSettingsAuth";
import type { Every8dSettingsEmailOutboxRepository, Every8dSettingsEmailOutboxClaimReceipt,
  Every8dSettingsEmailOutboxPayload, Every8dSettingsEmailOutboxFinalizeInput } from "../types/every8dSettingsEmailOutbox";
import type { Every8dSettingsEmailProvider, Every8dSettingsEmailProviderInput,
  Every8dSettingsEmailProviderResult, Every8dSettingsEmailSender } from "../types/every8dSettingsEmailProvider";
import { validateEvery8dSettingsEmailProviderResult } from "../types/every8dSettingsEmailProvider";
import { decryptClaimedPayload, every8dSettingsEmailProviderIdempotencyKey } from "./every8dSettingsEmailOutboxCrypto";
import { readValidatedEvery8dSettingsEmailOutboxClaim, readValidatedEvery8dSettingsEmailOutboxBegin } from "./every8dSettingsEmailOutboxRepository";
import { normalizeEvery8dSettingsEmail } from "./every8dSettingsAuthPrimitives";
import { renderEvery8dSettingsEmail } from "./every8dSettingsEmailTemplate";

export type Every8dSettingsEmailWorkerClock = Readonly<{
  nowNs(): bigint;
  schedule(delayMs: number, callback: () => void): () => void;
}>;
const localClock: Every8dSettingsEmailWorkerClock = Object.freeze({
  nowNs: () => process.hrtime.bigint(),
  schedule(delayMs, callback) { const timer = setTimeout(callback, delayMs); return () => clearTimeout(timer); }
});
export type Every8dSettingsEmailWorkerDiagnostic = Readonly<{
  category: "payload_unavailable" | "internal_unavailable" | "sender_indeterminate" | "sender_unavailable" |
    "cancelled_pre_send" | "authority_unavailable" | "local_budget_exhausted" |
    "accepted" | "rejected" | "not_accepted_retryable" | "outcome_unknown";
  finalization: "not_attempted" | "confirmed" | "unconfirmed";
}>;
export type Every8dSettingsEmailWorkerBatch = Readonly<{
  outcome: "completed" | "busy" | "claim_unavailable";
  diagnostics: readonly Every8dSettingsEmailWorkerDiagnostic[];
}>;
const activeRepositories = new WeakSet<object>();
const unknownResult = Object.freeze({ outcome: "outcome_unknown" } as const);
function diagnostic(category: Every8dSettingsEmailWorkerDiagnostic["category"],
  finalization: Every8dSettingsEmailWorkerDiagnostic["finalization"] = "not_attempted"): Every8dSettingsEmailWorkerDiagnostic {
  return Object.freeze({ category, finalization });
}
function dbDurationNs(later: string, earlier: string): bigint {
  // These repository-validated pairs have identical microsecond fractions. Their
  // difference is exact in milliseconds; no local wall clock participates.
  return BigInt(Date.parse(later) - Date.parse(earlier)) * 1000000n;
}

/** Exactly one selected result, including synchronous throw, cancellation and late promises. */
async function invokeOnce(adapter: Every8dSettingsEmailProvider, input: Every8dSettingsEmailProviderInput | undefined,
  clock: Every8dSettingsEmailWorkerClock, controller: AbortController, cancellation?: AbortSignal
): Promise<Every8dSettingsEmailProviderResult | null> {
  if (!input) return null;
  const deadline = input.deadlineMonotonicNs;
  return new Promise((resolve) => {
    let settled = false;
    let invoked = false;
    let cancelTimer = () => {};
    const finish = (result: Every8dSettingsEmailProviderResult | null, abort: boolean) => {
      if (settled) return;
      settled = true;
      cancelTimer();
      cancellation?.removeEventListener("abort", onAbort);
      if (abort) controller.abort();
      resolve(result);
    };
    const onAbort = () => finish(invoked ? unknownResult : null, true);
    try {
      cancellation?.addEventListener("abort", onAbort, { once: true });
      const remaining = deadline - clock.nowNs();
      if (cancellation?.aborted || remaining <= 0n) { finish(null, true); return; }
      // Truncate rather than round up. Sub-millisecond budget cannot authorize a call.
      const delayMs = Number(remaining / 1000000n);
      if (delayMs <= 0) { finish(null, true); return; }
      cancelTimer = clock.schedule(delayMs, onAbort);
      if (settled) { cancelTimer(); return; }
      if (clock.nowNs() >= deadline || cancellation?.aborted) { finish(null, true); return; }
      invoked = true;
      Promise.resolve(adapter.send(input!)).then((value) => {
        if (settled) return;
        if (clock.nowNs() >= deadline || cancellation?.aborted) finish(unknownResult, true);
        else {
          const validated = validateEvery8dSettingsEmailProviderResult(value);
          if (clock.nowNs() >= deadline || cancellation?.aborted) finish(unknownResult, true);
          else finish(validated, false);
        }
      }, () => finish(unknownResult, true));
    } catch { finish(invoked ? unknownResult : null, true); }
    finally { input = undefined; } // Late promise handlers retain only the deadline, never the request.
  });
}

/** Construction does no work. No polling, recovery, purge, config, transport or lifecycle wiring. */
export function createEvery8dSettingsEmailWorker(dependencies: Readonly<{
  repository: Pick<Every8dSettingsEmailOutboxRepository, "claim" | "beginSend" | "finalize">;
  encryptionKeyring: Every8dSettingsAuthHmacKeyring;
  sender: Every8dSettingsEmailSender;
  clock?: Every8dSettingsEmailWorkerClock;
}>): Readonly<{ runBatch(cancellation?: AbortSignal): Promise<Every8dSettingsEmailWorkerBatch> }> {
  const { repository, encryptionKeyring, sender } = dependencies;
  const clock = dependencies.clock ?? localClock;
  async function finalize(input: Every8dSettingsEmailOutboxFinalizeInput,
    category: Every8dSettingsEmailWorkerDiagnostic["category"]): Promise<Every8dSettingsEmailWorkerDiagnostic> {
    try {
      const result = await repository.finalize(input);
      return diagnostic(category, result.outcome === "applied" ? "confirmed" : "unconfirmed");
    } catch { return diagnostic(category, "unconfirmed"); }
  }
  async function processJob(claim: Every8dSettingsEmailOutboxClaimReceipt, claimStarted: bigint,
    cancellation?: AbortSignal): Promise<Every8dSettingsEmailWorkerDiagnostic> {
    let payload: Every8dSettingsEmailOutboxPayload | undefined;
    let rendered: ReturnType<typeof renderEvery8dSettingsEmail> | undefined;
    let request: Every8dSettingsEmailProviderInput | undefined;
    let result: Every8dSettingsEmailProviderResult | null | undefined;
    try {
      try { payload = decryptClaimedPayload(claim, encryptionKeyring); }
      catch { return diagnostic("payload_unavailable"); }
      rendered = renderEvery8dSettingsEmail({ purpose: claim.purpose, templateVersion: claim.templateVersion,
        displayOtp: payload.displayOtp, deliveryDeadlineAt: claim.deliveryDeadlineAt });
      const lease = { jobId: claim.jobId, leaseId: claim.leaseId, fence: claim.fence };
      if (cancellation?.aborted) return diagnostic("cancelled_pre_send");
      const claimDeadline = claimStarted + dbDurationNs(claim.leaseExpiresAt, claim.dbNow);
      if (clock.nowNs() >= claimDeadline) return diagnostic("local_budget_exhausted");
      if (sender.status === "unavailable" &&
        (sender.evidence === "no_approved_sender" || sender.evidence === "no_approved_provider")) {
        payload = undefined; rendered = undefined;
        return await finalize({ ...lease, attemptCount: claim.attemptCount, providerOutcome: null,
          preSendDisposition: "sender_unavailable", nonAcceptanceProven: false, providerMessageId: null }, "sender_unavailable");
      }
      if (sender.status !== "available" || typeof sender.canonicalSender !== "string" ||
        normalizeEvery8dSettingsEmail(sender.canonicalSender) !== sender.canonicalSender ||
        typeof sender.adapter?.send !== "function") return diagnostic("sender_indeterminate");
      const idempotencyKey = every8dSettingsEmailProviderIdempotencyKey(claim.jobId);
      const beginStarted = clock.nowNs();
      const begun = await repository.beginSend(lease);
      if (begun.outcome !== "applied") return diagnostic("authority_unavailable");
      const receipt = readValidatedEvery8dSettingsEmailOutboxBegin(begun.receipt);
      if (!receipt || receipt.state !== "SENDING" || receipt.jobId !== claim.jobId ||
        receipt.leaseId !== claim.leaseId || receipt.fence !== claim.fence ||
        receipt.attemptCount !== claim.attemptCount + 1) return diagnostic("authority_unavailable");
      const beginDeadline = beginStarted + dbDurationNs(receipt.providerDeadlineAt!, receipt.dbNow);
      const deadline = beginDeadline < claimDeadline ? beginDeadline : claimDeadline;
      if (cancellation?.aborted || deadline - clock.nowNs() < 1000000n) return diagnostic("local_budget_exhausted");
      const controller = new AbortController();
      request = Object.freeze({ canonicalSender: sender.canonicalSender, recipient: payload.recipient,
        subject: rendered.subject, body: rendered.body, idempotencyKey, signal: controller.signal,
        deadlineMonotonicNs: deadline });
      result = await invokeOnce(sender.adapter, request, clock, controller, cancellation);
      // Plaintext is no longer needed while awaiting the final durable operation.
      request = undefined; rendered = undefined; payload = undefined;
      if (!result) return diagnostic("local_budget_exhausted");
      return await finalize({ ...lease, attemptCount: receipt.attemptCount, providerOutcome: result.outcome,
        preSendDisposition: null, nonAcceptanceProven: result.outcome === "not_accepted_retryable",
        providerMessageId: result.outcome === "accepted" ? result.providerMessageId : null }, result.outcome);
    } catch { return diagnostic("internal_unavailable"); }
    finally {
      // No mutable plaintext Buffer is allocated here. Crypto zeroes its owned
      // buffers. JS strings and runtime/transport copies cannot be guaranteed erased.
      request = undefined; rendered = undefined; payload = undefined; result = undefined;
    }
  }
  return Object.freeze({
    async runBatch(cancellation) {
      if (activeRepositories.has(repository)) return Object.freeze({ outcome: "busy", diagnostics: Object.freeze([]) });
      activeRepositories.add(repository);
      try {
        const claimStarted = clock.nowNs();
        const claimed = await repository.claim({ batchSize: 10 });
        if (claimed.outcome !== "applied" || claimed.receipts.length > 10 ||
          claimed.receipts.some((receipt) => !readValidatedEvery8dSettingsEmailOutboxClaim(receipt))) {
          return Object.freeze({ outcome: "claim_unavailable", diagnostics: Object.freeze([]) });
        }
        const diagnostics = await Promise.all(claimed.receipts.map((receipt) => processJob(receipt, claimStarted, cancellation)));
        return Object.freeze({ outcome: "completed", diagnostics: Object.freeze(diagnostics) });
      } catch { return Object.freeze({ outcome: "claim_unavailable", diagnostics: Object.freeze([]) }); }
      finally { activeRepositories.delete(repository); }
    }
  });
}
