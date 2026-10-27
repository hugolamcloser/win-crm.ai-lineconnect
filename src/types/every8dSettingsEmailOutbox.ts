import type { Every8dSettingsAuthPurpose } from "../services/every8dSettingsAuthPrimitives";
import type { Every8dSettingsAuthRepositoryFailure } from "./every8dSettingsAuthOrchestration";

export type Every8dSettingsEmailOutboxState = "PENDING" | "LEASED" | "SENDING" | "RETRY_WAIT" |
  "ACCEPTED" | "FAILED_TERMINAL" | "DELIVERY_OUTCOME_UNKNOWN" | "CANCELLED" | "EXPIRED";
export type Every8dSettingsEmailOutboxDisposition = "accepted" | "provider_rejected" |
  "delivery_outcome_unknown" | "sender_unavailable_pre_send" | "retry_budget_exhausted" |
  "retry_deadline_exhausted" | "retry_unusable" | "cancelled_pre_send" | "expired_pre_send";
export type Every8dSettingsEmailOutboxRecording = "not_applicable" | "recorded" | "not_recorded";
export type Every8dSettingsEmailOutboxContext = Readonly<{
  jobId: string; challengeId: string; requestTokenHash: Buffer; purpose: Every8dSettingsAuthPurpose;
  envelopeVersion: 1; payloadVersion: 1; templateVersion: 1; encryptionKeyVersion: string;
}>;
export type Every8dSettingsEmailOutboxEncryptedPayload = Readonly<{
  envelopeVersion: 1; payloadVersion: 1; templateVersion: 1; encryptionKeyVersion: string;
  nonce: Buffer; ciphertext: Buffer; authenticationTag: Buffer;
}>;
export type Every8dSettingsEmailOutboxEnqueueInput = Every8dSettingsEmailOutboxContext &
  Every8dSettingsEmailOutboxEncryptedPayload;
export type Every8dSettingsEmailOutboxPayload = Readonly<{ recipient: string; displayOtp: string }>;
export type Every8dSettingsEmailOutboxLeaseInput = Readonly<{
  jobId: string; leaseId: string; fence: string;
}>;
export type Every8dSettingsEmailOutboxFinalizeInput = Every8dSettingsEmailOutboxLeaseInput & Readonly<{
  attemptCount: number;
  providerOutcome: "accepted" | "rejected" | "not_accepted_retryable" | "outcome_unknown" | null;
  preSendDisposition: "sender_unavailable" | null;
  nonAcceptanceProven: boolean; providerMessageId: string | null;
}>;
export type Every8dSettingsEmailOutboxEnqueueReceipt = Readonly<{
  jobId: string; state: Every8dSettingsEmailOutboxState; createdAt: string; deliveryDeadlineAt: string;
}>;
export type Every8dSettingsEmailOutboxClaimReceipt = Every8dSettingsEmailOutboxEnqueueInput & Readonly<{
  leaseId: string; fence: string; leaseExpiresAt: string; attemptCount: number; availableAt: string;
  deliveryDeadlineAt: string; leasedAt: string; dbNow: string;
}>;
export type Every8dSettingsEmailOutboxBeginReceipt = Readonly<{
  jobId: string; state: "SENDING" | "FAILED_TERMINAL" | "CANCELLED" | "EXPIRED";
  attemptCount: number; leaseId: string | null; fence: string;
  attemptStartedAt: string | null; providerDeadlineAt: string | null; leaseExpiresAt: string | null;
  deliveryDeadlineAt: string; terminalDisposition: Every8dSettingsEmailOutboxDisposition | null;
  terminalAt: string | null; dbNow: string;
}>;
export type Every8dSettingsEmailOutboxFinalizeReceipt = Readonly<{
  jobId: string; state: Every8dSettingsEmailOutboxState; attemptCount: number;
  terminalDisposition: Every8dSettingsEmailOutboxDisposition | null; terminalAt: string | null;
  availableAt: string | null; providerMessageId: string | null;
  challengeRecording: Every8dSettingsEmailOutboxRecording; resolvedAt: string;
}>;
export type Every8dSettingsEmailOutboxRecoverReceipt = Readonly<{
  jobId: string; previousState: "PENDING" | "LEASED" | "SENDING" | "RETRY_WAIT";
  state: Every8dSettingsEmailOutboxState; attemptCount: number;
  terminalDisposition: Every8dSettingsEmailOutboxDisposition | null; terminalAt: string | null;
  availableAt: string | null; challengeRecording: Every8dSettingsEmailOutboxRecording; recoveredAt: string;
}>;
export type Every8dSettingsEmailOutboxSingleResult<T> =
  Readonly<{ outcome: "applied"; receipt: T }> | Readonly<{ outcome: "not_applied" }> |
  Every8dSettingsAuthRepositoryFailure;
export type Every8dSettingsEmailOutboxBatchResult<T> =
  Readonly<{ outcome: "applied"; receipts: readonly T[] }> | Every8dSettingsAuthRepositoryFailure;
export type Every8dSettingsEmailOutboxRepository = Readonly<{
  enqueue(input: Every8dSettingsEmailOutboxEnqueueInput): Promise<Every8dSettingsEmailOutboxSingleResult<Every8dSettingsEmailOutboxEnqueueReceipt>>;
  claim(input: Readonly<{ batchSize: number }>): Promise<Every8dSettingsEmailOutboxBatchResult<Every8dSettingsEmailOutboxClaimReceipt>>;
  beginSend(input: Every8dSettingsEmailOutboxLeaseInput): Promise<Every8dSettingsEmailOutboxSingleResult<Every8dSettingsEmailOutboxBeginReceipt>>;
  finalize(input: Every8dSettingsEmailOutboxFinalizeInput): Promise<Every8dSettingsEmailOutboxSingleResult<Every8dSettingsEmailOutboxFinalizeReceipt>>;
  recover(input: Readonly<{ batchSize: number }>): Promise<Every8dSettingsEmailOutboxBatchResult<Every8dSettingsEmailOutboxRecoverReceipt>>;
  purge(input: Readonly<{ batchSize: number }>): Promise<Readonly<{ outcome: "applied"; count: number }> | Every8dSettingsAuthRepositoryFailure>;
}>;
