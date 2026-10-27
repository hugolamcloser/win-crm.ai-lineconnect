import crypto from "node:crypto";
import type { Every8dSettingsAuthConfig } from "../config/every8dSettingsAuth";
import { normalizeEvery8dSettingsEmail, formatEvery8dSettingsOtp, parseEvery8dSettingsOtp } from "./every8dSettingsAuthPrimitives";
import { encryptEvery8dSettingsEmailOutboxPayload } from "./every8dSettingsEmailOutboxCrypto";
import { createEvery8dSettingsEmailOutboxRepository } from "./every8dSettingsEmailOutboxRepository";
import type { Every8dSettingsEmailOutboxRepository, Every8dSettingsEmailOutboxSingleResult,
  Every8dSettingsEmailOutboxEnqueueReceipt } from "../types/every8dSettingsEmailOutbox";

const disabled = Object.freeze({ outcome: "disabled" } as const);
const unavailable = Object.freeze({ outcome: "unavailable" } as const);
const notApplied = Object.freeze({ outcome: "not_applied" } as const);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type PreparationResult = Every8dSettingsEmailOutboxSingleResult<Every8dSettingsEmailOutboxEnqueueReceipt> |
  typeof disabled | typeof unavailable;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createEvery8dSettingsEmailOutboxPreparationService(
  config: Every8dSettingsAuthConfig,
  repositoryFactory?: () => Every8dSettingsEmailOutboxRepository
): Readonly<{ enqueuePreparedChallenge(result: unknown): Promise<PreparationResult> }> {
  const enabled = config.enabled === true && config.httpEnabled === true;
  const encryption = config.emailOutboxEncryption;
  const gates = Object.freeze({ enabled: config.enabled, httpEnabled: config.httpEnabled,
    emailDispatchEnabled: config.emailDispatchEnabled });
  return Object.freeze({
    async enqueuePreparedChallenge(result: unknown): Promise<PreparationResult> {
      if (!enabled) return disabled;
      if (!encryption) return unavailable;
      try {
        // The caller first awaits the unchanged C3b service's durable preparation.
        // This boundary never starts/reconstructs a challenge or combines commits.
        if (!record(result) || result.outcome !== "accepted" || result.deliveryCommand === null) return notApplied;
        const prepared = result.deliveryCommand;
        if (!record(prepared)) return notApplied;
        // Do not enumerate/spread the prepared command or read its raw capability.
        const challengeId = prepared.challengeId, purpose = prepared.purpose;
        const created = prepared.createdAt, expires = prepared.expiresAt;
        const request = prepared.deliveryRequest, handle = prepared.deliveryHandle;
        if (typeof challengeId !== "string" || challengeId.length !== 36 || !uuid.test(challengeId) ||
          (purpose !== "enrollment" && purpose !== "login") || !(created instanceof Date) ||
          !(expires instanceof Date) || !Number.isFinite(created.getTime()) || !Number.isFinite(expires.getTime()) ||
          created.getTime() >= expires.getTime() || !record(request) || !record(handle) ||
          request.purpose !== purpose || !(request.expiresAt instanceof Date) ||
          request.expiresAt.getTime() !== expires.getTime() || !Buffer.isBuffer(handle.requestTokenHash) ||
          handle.requestTokenHash.length !== 32 || typeof request.recipient !== "string" ||
          normalizeEvery8dSettingsEmail(request.recipient) !== request.recipient ||
          typeof request.displayOtp !== "string" || request.displayOtp.length !== 9 ||
          formatEvery8dSettingsOtp(parseEvery8dSettingsOtp(request.displayOtp)) !== request.displayOtp) return unavailable;
        const jobId = crypto.randomUUID(), requestTokenHash = Buffer.from(handle.requestTokenHash);
        const encrypted = encryptEvery8dSettingsEmailOutboxPayload({ jobId, challengeId, requestTokenHash,
          purpose, envelopeVersion: 1, payloadVersion: 1, templateVersion: 1 },
          { recipient: request.recipient, displayOtp: request.displayOtp }, encryption);
        const repository = repositoryFactory ? repositoryFactory() : createEvery8dSettingsEmailOutboxRepository(gates);
        // Exactly one enqueue, after encryption. Ambiguous/failing commits are never retried.
        const enqueued = await repository.enqueue({ jobId, challengeId, requestTokenHash, purpose, ...encrypted });
        if (enqueued.outcome === "applied") return enqueued.receipt.jobId === jobId ? enqueued : unavailable;
        if (enqueued.outcome === "not_applied") return notApplied;
        if (enqueued.outcome === "failure" && (enqueued.category === "repository_unavailable" ||
          enqueued.category === "repository_contract_violation")) return enqueued;
        return unavailable;
      } catch { return unavailable; }
    }
  });
}
