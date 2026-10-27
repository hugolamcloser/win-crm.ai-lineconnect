import { getSupabase } from "../config/supabase";
import type { Every8dSettingsAuthConfig } from "../config/every8dSettingsAuth";
import { isEvery8dSettingsEmailOutboxKeyVersion } from "../config/every8dSettingsEmailOutbox";
import type { Every8dSettingsAuthRepositoryFailure } from "../types/every8dSettingsAuthOrchestration";
import type { Every8dSettingsEmailOutboxRepository, Every8dSettingsEmailOutboxEnqueueInput,
  Every8dSettingsEmailOutboxEnqueueReceipt, Every8dSettingsEmailOutboxClaimReceipt,
  Every8dSettingsEmailOutboxBeginReceipt, Every8dSettingsEmailOutboxFinalizeInput,
  Every8dSettingsEmailOutboxFinalizeReceipt, Every8dSettingsEmailOutboxRecoverReceipt,
  Every8dSettingsEmailOutboxLeaseInput } from "../types/every8dSettingsEmailOutbox";

type Row = Record<string, unknown>;
type RpcClient = Readonly<{ rpc(name: string, input: Record<string, unknown>): PromiseLike<Readonly<{ data: unknown; error: unknown }>> }>;
type RpcClientGetter = () => RpcClient;
const unavailable = Object.freeze({ outcome: "failure", category: "repository_unavailable" } as const);
const violation = Object.freeze({ outcome: "failure", category: "repository_contract_violation" } as const);
const notApplied = Object.freeze({ outcome: "not_applied" } as const);
const empty = Object.freeze({ outcome: "applied", receipts: Object.freeze([]) } as const);
const jobPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const states = ["PENDING", "LEASED", "SENDING", "RETRY_WAIT", "ACCEPTED", "FAILED_TERMINAL", "DELIVERY_OUTCOME_UNKNOWN", "CANCELLED", "EXPIRED"];
const recordings = ["not_applicable", "recorded", "not_recorded"];
const validatedClaims = new WeakMap<object, Every8dSettingsEmailOutboxClaimReceipt>();
class InvalidContract extends Error {}
function need(condition: unknown): asserts condition { if (!condition) throw new InvalidContract(); }
function text(value: unknown): string { need(typeof value === "string"); return value; }
function uuid(value: unknown, job = false): string {
  const result = text(value); need(result.length === 36 && (job ? jobPattern : uuidPattern).test(result)); return result;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  need(typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum); return value;
}
function record(value: unknown): Row {
  need(typeof value === "object" && value !== null && !Array.isArray(value));
  return { ...value };
}
function exact(value: unknown, keys: readonly string[]): Row {
  const result = record(value), actual = Object.keys(result);
  need(actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(result, key)));
  return result;
}
function rows(data: unknown, maximum: number): Row[] {
  need(Array.isArray(data) && data.length <= maximum);
  return Array.from(data, record);
}
function purpose(value: unknown): "login" | "enrollment" { need(value === "login" || value === "enrollment"); return value; }
function binary(value: unknown, minimum: number, maximum = minimum): Buffer {
  need(Buffer.isBuffer(value) && value.length >= minimum && value.length <= maximum); return Buffer.from(value);
}
function bytea(value: unknown, minimum: number, maximum = minimum): Buffer {
  const encoded = text(value);
  need(/^\\x(?:[0-9a-f]{2})+$/.exec(encoded)?.[0] === encoded);
  const bytes = Buffer.from(encoded.slice(2), "hex");
  need(bytes.length >= minimum && bytes.length <= maximum); return bytes;
}
function encodeBytea(value: unknown, minimum: number, maximum = minimum): string {
  return "\\x" + binary(value, minimum, maximum).toString("hex");
}
export function parseEvery8dSettingsEmailOutboxFence(value: unknown): string {
  need(typeof value === "string" && value.length <= 19 && /^[1-9][0-9]*$/.exec(value)?.[0] === value);
  need(BigInt(value) <= 9223372036854775807n);
  return value;
}
function timestamp(value: unknown): { value: string; micros: bigint } {
  const raw = text(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(raw);
  need(m && m[0] === raw);
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  need(year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]! &&
    Number(m[4]) <= 23 && Number(m[5]) <= 59 && Number(m[6]) <= 59 &&
    Number(m[9] ?? 0) <= 15 && Number(m[10] ?? 0) <= 59);
  const whole = Date.parse(raw.replace(/\.\d+/, ""));
  need(Number.isSafeInteger(whole));
  return { value: raw, micros: BigInt(whole) * 1000n + BigInt((m[7] ?? "").padEnd(6, "0")) };
}
function versions(row: Row): void {
  need(row.envelope_version === 1 && row.payload_version === 1 && row.template_version === 1);
  need(isEvery8dSettingsEmailOutboxKeyVersion(row.encryption_key_version));
}
function terminal(state: unknown, disposition: unknown, count: number): boolean {
  if (state === "ACCEPTED") return disposition === "accepted" && count >= 1;
  if (state === "DELIVERY_OUTCOME_UNKNOWN") return disposition === "delivery_outcome_unknown" && count >= 1;
  if (state === "EXPIRED") return disposition === "expired_pre_send" && count === 0;
  if (state === "CANCELLED") return disposition === "cancelled_pre_send" && count === 0;
  if (state !== "FAILED_TERMINAL") return false;
  if (disposition === "provider_rejected") return count >= 1;
  if (disposition === "sender_unavailable_pre_send") return count <= 2;
  if (disposition === "retry_budget_exhausted") return count === 3;
  return (disposition === "retry_deadline_exhausted" || disposition === "retry_unusable") && count >= 1 && count <= 2;
}
function providerId(value: unknown): string {
  const id = text(value); need(id.length >= 1 && id.length <= 255 && /^[!-~]+$/.exec(id)?.[0] === id); return id;
}
function leaseArguments(input: unknown): { input_job_id: string; input_lease_id: string; input_fence: string } {
  const value = record(input);
  return { input_job_id: uuid(value.jobId, true), input_lease_id: uuid(value.leaseId), input_fence: parseEvery8dSettingsEmailOutboxFence(value.fence) };
}
function enqueueArguments(input: Every8dSettingsEmailOutboxEnqueueInput): Record<string, unknown> {
  const value = exact(input, ["jobId", "challengeId", "requestTokenHash", "purpose", "envelopeVersion", "payloadVersion", "templateVersion", "encryptionKeyVersion", "nonce", "ciphertext", "authenticationTag"]);
  need(value.envelopeVersion === 1 && value.payloadVersion === 1 && value.templateVersion === 1 && isEvery8dSettingsEmailOutboxKeyVersion(value.encryptionKeyVersion));
  return { input_job_id: uuid(value.jobId, true), input_challenge_id: uuid(value.challengeId),
    input_request_token_hash: encodeBytea(value.requestTokenHash, 32), input_purpose: purpose(value.purpose),
    input_envelope_version: 1, input_payload_version: 1, input_template_version: 1,
    input_encryption_key_version: value.encryptionKeyVersion, input_nonce: encodeBytea(value.nonce, 12),
    input_ciphertext: encodeBytea(value.ciphertext, 1, 512), input_authentication_tag: encodeBytea(value.authenticationTag, 16) };
}
function finalizeArguments(input: Every8dSettingsEmailOutboxFinalizeInput): Record<string, unknown> {
  const v = exact(input, ["jobId", "leaseId", "fence", "attemptCount", "providerOutcome", "preSendDisposition", "nonAcceptanceProven", "providerMessageId"]);
  const count = integer(v.attemptCount, 0, 3);
  const accepted = v.providerOutcome === "accepted" && v.preSendDisposition === null && v.nonAcceptanceProven === false && typeof v.providerMessageId === "string";
  const rejected = (v.providerOutcome === "rejected" || v.providerOutcome === "outcome_unknown") && v.preSendDisposition === null && v.nonAcceptanceProven === false && v.providerMessageId === null;
  const retry = v.providerOutcome === "not_accepted_retryable" && v.preSendDisposition === null && v.nonAcceptanceProven === true && v.providerMessageId === null;
  const pre = v.providerOutcome === null && v.preSendDisposition === "sender_unavailable" && v.nonAcceptanceProven === false && v.providerMessageId === null;
  need(accepted || rejected || retry || pre);
  need(pre ? count <= 2 : count >= 1);
  if (accepted) providerId(v.providerMessageId);
  return { ...leaseArguments(v), input_attempt_count: count, input_provider_outcome: v.providerOutcome,
    input_pre_send_disposition: v.preSendDisposition, input_non_acceptance_proven: v.nonAcceptanceProven,
    input_provider_message_id: v.providerMessageId };
}
function parseEnqueue(row: Row, args: Record<string, unknown>): Every8dSettingsEmailOutboxEnqueueReceipt {
  const r = exact(row, ["job_id", "state", "created_at", "delivery_deadline_at"]);
  need(uuid(r.job_id, true) === args.input_job_id && states.includes(text(r.state)));
  const created = timestamp(r.created_at), deadline = timestamp(r.delivery_deadline_at);
  need(created.micros < deadline.micros);
  return Object.freeze({ jobId: r.job_id as string, state: r.state as Every8dSettingsEmailOutboxEnqueueReceipt["state"], createdAt: created.value, deliveryDeadlineAt: deadline.value });
}
function parseClaim(row: Row): Every8dSettingsEmailOutboxClaimReceipt {
  const r = exact(row, ["job_id", "challenge_id", "request_token_hash", "purpose", "envelope_version", "payload_version", "template_version", "encryption_key_version", "nonce", "ciphertext", "authentication_tag", "lease_id", "fence", "lease_expires_at", "attempt_count", "available_at", "delivery_deadline_at", "leased_at", "db_now"]);
  versions(r);
  const jobId = uuid(r.job_id, true), challengeId = uuid(r.challenge_id), leaseId = uuid(r.lease_id);
  const fence = parseEvery8dSettingsEmailOutboxFence(r.fence), count = integer(r.attempt_count, 0, 2);
  const hash = bytea(r.request_token_hash, 32), nonce = bytea(r.nonce, 12), ciphertext = bytea(r.ciphertext, 1, 512), tag = bytea(r.authentication_tag, 16);
  const available = timestamp(r.available_at), leased = timestamp(r.leased_at), expiry = timestamp(r.lease_expires_at), deadline = timestamp(r.delivery_deadline_at), now = timestamp(r.db_now);
  need(available.micros <= leased.micros && leased.micros === now.micros && expiry.micros - leased.micros === 30000000n && now.micros + 10000000n < deadline.micros);
  const receipt: Every8dSettingsEmailOutboxClaimReceipt = Object.freeze({ jobId, challengeId, purpose: purpose(r.purpose),
    envelopeVersion: 1, payloadVersion: 1, templateVersion: 1, encryptionKeyVersion: text(r.encryption_key_version),
    get requestTokenHash() { return Buffer.from(hash); }, get nonce() { return Buffer.from(nonce); },
    get ciphertext() { return Buffer.from(ciphertext); }, get authenticationTag() { return Buffer.from(tag); },
    leaseId, fence, attemptCount: count, availableAt: available.value, leasedAt: leased.value, leaseExpiresAt: expiry.value,
    deliveryDeadlineAt: deadline.value, dbNow: now.value });
  validatedClaims.set(receipt, receipt);
  return receipt;
}
// Internal pure receipt-origin check; this is not a repository operation or RPC.
export function readValidatedEvery8dSettingsEmailOutboxClaim(value: Every8dSettingsEmailOutboxClaimReceipt): Every8dSettingsEmailOutboxClaimReceipt | null {
  return typeof value === "object" && value !== null ? validatedClaims.get(value) ?? null : null;
}
function parseBegin(row: Row, args: Record<string, unknown>): Every8dSettingsEmailOutboxBeginReceipt {
  const r = exact(row, ["job_id", "state", "attempt_count", "lease_id", "fence", "attempt_started_at", "provider_deadline_at", "lease_expires_at", "delivery_deadline_at", "terminal_disposition", "terminal_at", "db_now"]);
  need(uuid(r.job_id, true) === args.input_job_id && parseEvery8dSettingsEmailOutboxFence(r.fence) === args.input_fence);
  const count = integer(r.attempt_count, 0, 3), now = timestamp(r.db_now), deadline = timestamp(r.delivery_deadline_at);
  if (r.state === "SENDING") {
    need(count >= 1 && uuid(r.lease_id) === args.input_lease_id && r.terminal_disposition === null && r.terminal_at === null);
    const started = timestamp(r.attempt_started_at), provider = timestamp(r.provider_deadline_at), lease = timestamp(r.lease_expires_at);
    need(started.micros === now.micros && provider.micros - started.micros === 10000000n && provider.micros < lease.micros && provider.micros < deadline.micros);
  } else {
    need(["FAILED_TERMINAL", "CANCELLED", "EXPIRED"].includes(text(r.state)) && terminal(r.state, r.terminal_disposition, count));
    need(r.terminal_disposition === "retry_unusable" || r.terminal_disposition === "retry_deadline_exhausted" || r.terminal_disposition === "cancelled_pre_send" || r.terminal_disposition === "expired_pre_send");
    need(r.lease_id === null && r.attempt_started_at === null && r.provider_deadline_at === null && r.lease_expires_at === null && timestamp(r.terminal_at).micros === now.micros);
  }
  return Object.freeze({ jobId: r.job_id, state: r.state, attemptCount: count, leaseId: r.lease_id, fence: r.fence,
    attemptStartedAt: r.attempt_started_at, providerDeadlineAt: r.provider_deadline_at, leaseExpiresAt: r.lease_expires_at,
    deliveryDeadlineAt: deadline.value, terminalDisposition: r.terminal_disposition, terminalAt: r.terminal_at, dbNow: now.value }) as Every8dSettingsEmailOutboxBeginReceipt;
}
function parseFinalize(row: Row, args: Record<string, unknown>): Every8dSettingsEmailOutboxFinalizeReceipt {
  const r = exact(row, ["job_id", "state", "attempt_count", "terminal_disposition", "terminal_at", "available_at", "provider_message_id", "challenge_recording", "resolved_at"]);
  need(uuid(r.job_id, true) === args.input_job_id && integer(r.attempt_count, 0, 3) === args.input_attempt_count && recordings.includes(text(r.challenge_recording)));
  const count = r.attempt_count as number, resolved = timestamp(r.resolved_at);
  if (r.state === "RETRY_WAIT") {
    need(count === 1 || count === 2);
    need(args.input_provider_outcome === "not_accepted_retryable" && args.input_non_acceptance_proven === true &&
      r.terminal_at === null && r.terminal_disposition === null && r.provider_message_id === null && r.challenge_recording === "not_applicable");
    need(timestamp(r.available_at).micros - resolved.micros === (count === 1 ? 5000000n : 20000000n));
  } else {
    need(terminal(r.state, r.terminal_disposition, count) && r.available_at === null && timestamp(r.terminal_at).micros === resolved.micros);
    if (args.input_provider_outcome === "accepted") {
      need(r.state === "ACCEPTED" && providerId(r.provider_message_id) === args.input_provider_message_id);
    } else {
      need(r.provider_message_id === null);
      if (args.input_provider_outcome === "rejected") need(r.state === "FAILED_TERMINAL" && r.terminal_disposition === "provider_rejected");
      else if (args.input_provider_outcome === "outcome_unknown") need(r.state === "DELIVERY_OUTCOME_UNKNOWN");
      else if (args.input_provider_outcome === null) need(r.state === "FAILED_TERMINAL" && r.terminal_disposition === "sender_unavailable_pre_send");
      else {
        need(r.state === "FAILED_TERMINAL" && ["retry_budget_exhausted", "retry_deadline_exhausted", "retry_unusable"].includes(text(r.terminal_disposition)));
        need(count === 3 ? r.terminal_disposition === "retry_budget_exhausted" : r.terminal_disposition !== "retry_budget_exhausted");
      }
    }
    need(args.input_provider_outcome === "not_accepted_retryable" ? r.challenge_recording === "not_applicable" : r.challenge_recording === "recorded" || r.challenge_recording === "not_recorded");
  }
  return Object.freeze({ jobId: r.job_id, state: r.state, attemptCount: count, terminalDisposition: r.terminal_disposition,
    terminalAt: r.terminal_at, availableAt: r.available_at, providerMessageId: r.provider_message_id,
    challengeRecording: r.challenge_recording, resolvedAt: resolved.value }) as Every8dSettingsEmailOutboxFinalizeReceipt;
}
// Closed recovery families from frozen sections 16, 22, 23 and 26.
// Recovery preserves the single returned attempt count; it cannot create an attempt.
const recoveryFamilies = [
  { previous: "PENDING", minimum: 0, maximum: 0,
    outcomes: [["EXPIRED", "expired_pre_send"], ["CANCELLED", "cancelled_pre_send"]] },
  { previous: "LEASED", minimum: 0, maximum: 0,
    outcomes: [["PENDING", null], ["EXPIRED", "expired_pre_send"], ["CANCELLED", "cancelled_pre_send"]] },
  { previous: "LEASED", minimum: 1, maximum: 2,
    outcomes: [["RETRY_WAIT", null], ["FAILED_TERMINAL", "retry_unusable"], ["FAILED_TERMINAL", "retry_deadline_exhausted"]] },
  { previous: "RETRY_WAIT", minimum: 1, maximum: 2,
    outcomes: [["FAILED_TERMINAL", "retry_unusable"], ["FAILED_TERMINAL", "retry_deadline_exhausted"]] },
  { previous: "SENDING", minimum: 1, maximum: 3,
    outcomes: [["DELIVERY_OUTCOME_UNKNOWN", "delivery_outcome_unknown"]] }
] as const;
function validRecoverySemantics(row: Row, count: number): boolean {
  return recoveryFamilies.some((family) => row.previous_state === family.previous &&
    count >= family.minimum && count <= family.maximum &&
    family.outcomes.some(([state, disposition]) => row.state === state && row.terminal_disposition === disposition) &&
    (family.previous === "SENDING"
      ? row.challenge_recording === "recorded" || row.challenge_recording === "not_recorded"
      : row.challenge_recording === "not_applicable"));
}
function parseRecover(row: Row): Every8dSettingsEmailOutboxRecoverReceipt {
  const r = exact(row, ["job_id", "previous_state", "state", "attempt_count", "terminal_disposition", "terminal_at", "available_at", "challenge_recording", "recovered_at"]);
  uuid(r.job_id, true);
  const count = integer(r.attempt_count, 0, 3), recovered = timestamp(r.recovered_at);
  need(validRecoverySemantics(r, count));
  if (r.state === "PENDING" || r.state === "RETRY_WAIT") {
    need(r.terminal_at === null && r.terminal_disposition === null);
    need(timestamp(r.available_at).micros <= recovered.micros);
  } else {
    need(terminal(r.state, r.terminal_disposition, count) && r.available_at === null && timestamp(r.terminal_at).micros === recovered.micros);
  }
  return Object.freeze({ jobId: r.job_id, previousState: r.previous_state, state: r.state, attemptCount: count,
    terminalDisposition: r.terminal_disposition, terminalAt: r.terminal_at, availableAt: r.available_at,
    challengeRecording: r.challenge_recording, recoveredAt: recovered.value }) as Every8dSettingsEmailOutboxRecoverReceipt;
}
function uniqueJobs(receipts: readonly Readonly<{ jobId: string }>[]): void {
  need(new Set(receipts.map((r) => r.jobId)).size === receipts.length);
}
async function rpc(getClient: RpcClientGetter, name: string, input: Record<string, unknown>): Promise<unknown | Every8dSettingsAuthRepositoryFailure> {
  let result: unknown;
  try { result = await getClient().rpc(name, input); }
  catch { return unavailable; }
  try {
    const response = record(result);
    if (!("data" in response) || !("error" in response)) return violation;
    return response.error === null ? response.data : unavailable;
  } catch { return violation; }
}
function failure(value: unknown): value is Every8dSettingsAuthRepositoryFailure { return value === unavailable || value === violation; }

export function createEvery8dSettingsEmailOutboxRepository(
  config: Pick<Every8dSettingsAuthConfig, "enabled" | "httpEnabled" | "emailDispatchEnabled">,
  getClient: RpcClientGetter = getSupabase as unknown as RpcClientGetter
): Every8dSettingsEmailOutboxRepository {
  // Immutable gate decisions precede all operation input getters/client construction.
  const prepareEnabled = config.enabled === true && config.httpEnabled === true;
  const dispatchEnabled = prepareEnabled && config.emailDispatchEnabled === true;
  return Object.freeze({
    async enqueue(input) {
      if (!prepareEnabled) return notApplied;
      try {
        const args = enqueueArguments(input), data = await rpc(getClient, "runtime_enqueue_every8d_settings_auth_email_v1", args);
        if (failure(data)) return data;
        const result = rows(data, 1);
        return result.length === 0 ? notApplied : Object.freeze({ outcome: "applied", receipt: parseEnqueue(result[0]!, args) });
      } catch { return violation; }
    },
    async claim(input) {
      if (!dispatchEnabled) return empty;
      try {
        const v = exact(input, ["batchSize"]), batch = integer(v.batchSize, 1, 10);
        const data = await rpc(getClient, "runtime_claim_every8d_settings_auth_email_v1", { input_batch_size: batch });
        if (failure(data)) return data;
        const receipts = rows(data, batch).map(parseClaim); uniqueJobs(receipts);
        for (let i = 1; i < receipts.length; i += 1) {
          const before = receipts[i - 1]!, after = receipts[i]!;
          const left = timestamp(before.availableAt).micros, right = timestamp(after.availableAt).micros;
          need(left < right || (left === right && before.jobId < after.jobId));
        }
        return Object.freeze({ outcome: "applied", receipts: Object.freeze(receipts) });
      } catch { return violation; }
    },
    async beginSend(input) {
      if (!dispatchEnabled) return notApplied;
      try {
        exact(input, ["jobId", "leaseId", "fence"]);
        const args = leaseArguments(input), data = await rpc(getClient, "runtime_begin_every8d_settings_auth_email_send_v1", args);
        if (failure(data)) return data;
        const result = rows(data, 1);
        return result.length === 0 ? notApplied : Object.freeze({ outcome: "applied", receipt: parseBegin(result[0]!, args) });
      } catch { return violation; }
    },
    async finalize(input) {
      try {
        const args = finalizeArguments(input), data = await rpc(getClient, "runtime_finalize_every8d_settings_auth_email_v1", args);
        if (failure(data)) return data;
        const result = rows(data, 1);
        return result.length === 0 ? notApplied : Object.freeze({ outcome: "applied", receipt: parseFinalize(result[0]!, args) });
      } catch { return violation; }
    },
    async recover(input) {
      try {
        const v = exact(input, ["batchSize"]), batch = integer(v.batchSize, 1, 100);
        const data = await rpc(getClient, "runtime_recover_every8d_settings_auth_email_v1", { input_batch_size: batch });
        if (failure(data)) return data;
        const receipts = rows(data, batch).map(parseRecover); uniqueJobs(receipts);
        return Object.freeze({ outcome: "applied", receipts: Object.freeze(receipts) });
      } catch { return violation; }
    },
    async purge(input) {
      try {
        const v = exact(input, ["batchSize"]), batch = integer(v.batchSize, 1, 100);
        const data = await rpc(getClient, "runtime_purge_every8d_settings_auth_email_v1", { input_batch_size: batch });
        if (failure(data)) return data;
        const result = rows(data, 1); need(result.length === 1);
        const row = exact(result[0], ["purged_count"]);
        return Object.freeze({ outcome: "applied", count: integer(row.purged_count, 0, batch) });
      } catch { return violation; }
    }
  });
}
