/** Adapter implementations validate provider evidence before returning these closed results.
 * One send means at most one submission: no retries, redirect replay, background queue,
 * or construction-time sends. Honour cancellation and release request references and
 * zero owned mutable buffers in finally. Never log inputs, responses, or raw errors.
 * Adapter registry/ID validation and operational approval belong to later slices.
 */
export type Every8dSettingsEmailProviderResult =
  | Readonly<{ outcome: "accepted"; evidence: "authoritative_acceptance"; providerMessageId: string }>
  | Readonly<{ outcome: "rejected"; evidence: "definitive_refusal" }>
  | Readonly<{ outcome: "not_accepted_retryable"; evidence: Readonly<{
      kind: "transport_not_started" | "authoritative_non_acceptance" }> }>
  | Readonly<{ outcome: "outcome_unknown" }>;

export type Every8dSettingsEmailProviderInput = Readonly<{
  canonicalSender: string;
  recipient: string;
  subject: string;
  body: string;
  idempotencyKey: string;
  signal: AbortSignal;
  /** Local monotonic deadline, never wall-clock or fresh provider authority. */
  deadlineMonotonicNs: bigint;
}>;
export type Every8dSettingsEmailProvider = Readonly<{
  send(input: Every8dSettingsEmailProviderInput): Promise<Every8dSettingsEmailProviderResult>;
}>;

/** Trusted local selection, supplied by a future approved caller; no config parsing here. */
export type Every8dSettingsEmailSender =
  | Readonly<{ status: "available"; canonicalSender: string; adapter: Every8dSettingsEmailProvider }>
  | Readonly<{ status: "unavailable"; evidence: "no_approved_sender" | "no_approved_provider" }>
  | Readonly<{ status: "indeterminate" }>;

const unknownResult = Object.freeze({ outcome: "outcome_unknown" } as const);
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
/** Defensive adapter-boundary validation. HTTP status or an arbitrary boolean is not evidence. */
export function validateEvery8dSettingsEmailProviderResult(value: unknown): Every8dSettingsEmailProviderResult {
  try {
    if (exact(value, ["outcome", "evidence", "providerMessageId"]) && value.outcome === "accepted" &&
      value.evidence === "authoritative_acceptance" && typeof value.providerMessageId === "string" &&
      value.providerMessageId.length >= 1 && value.providerMessageId.length <= 255 &&
      !/[^\x21-\x7e]/.test(value.providerMessageId)) {
      return Object.freeze({ outcome: "accepted", evidence: "authoritative_acceptance", providerMessageId: value.providerMessageId });
    }
    if (exact(value, ["outcome", "evidence"])) {
      if (value.outcome === "rejected" && value.evidence === "definitive_refusal") {
        return Object.freeze({ outcome: "rejected", evidence: "definitive_refusal" });
      }
      if (value.outcome === "not_accepted_retryable" && exact(value.evidence, ["kind"]) &&
        (value.evidence.kind === "transport_not_started" || value.evidence.kind === "authoritative_non_acceptance")) {
        return Object.freeze({ outcome: "not_accepted_retryable", evidence: Object.freeze({ kind: value.evidence.kind }) });
      }
    }
    return unknownResult;
  } catch { return unknownResult; }
}
