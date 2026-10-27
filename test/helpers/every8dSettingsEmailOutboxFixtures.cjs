const { createEvery8dSettingsEmailOutboxRepository } = require("../../dist/services/every8dSettingsEmailOutboxRepository");
const JOB = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const CHALLENGE = "10000000-0000-4000-8000-000000000001";
const LEASE = "20000000-0000-4000-8000-000000000001";
const NOW = "2026-10-26T00:00:00.000001Z";
const AVAILABLE = "2026-10-25T23:59:59.000001Z";
const EXPIRES = "2026-10-26T00:00:30.000001Z";
const PROVIDER = "2026-10-26T00:00:10.000001Z";
const DEADLINE = "2026-10-26T00:10:00.000001Z";
const RESOLVED = "2026-10-26T00:00:01.000001Z";
const GATES = { enabled: true, httpEnabled: true, emailDispatchEnabled: true };
const bytea = (value) => "\\x" + value.toString("hex");
function context() { return { jobId: JOB, challengeId: CHALLENGE, requestTokenHash: Buffer.alloc(32, 1),
  purpose: "enrollment", envelopeVersion: 1, payloadVersion: 1, templateVersion: 1 }; }
function encrypted() { return { envelopeVersion: 1, payloadVersion: 1, templateVersion: 1,
  encryptionKeyVersion: "enc", nonce: Buffer.alloc(12, 3), ciphertext: Buffer.from([4]), authenticationTag: Buffer.alloc(16, 5) }; }
function inputs() { return {
  enqueue: { ...context(), ...encrypted() }, claim: { batchSize: 1 },
  beginSend: { jobId: JOB, leaseId: LEASE, fence: "1" },
  finalize: { jobId: JOB, leaseId: LEASE, fence: "1", attemptCount: 1, providerOutcome: "accepted",
    preSendDisposition: null, nonAcceptanceProven: false, providerMessageId: "synthetic-provider-id" },
  recover: { batchSize: 1 }, purge: { batchSize: 1 }
}; }
function claimRow(envelope = encrypted(), overrides = {}) { const c = context(); return {
  job_id: c.jobId, challenge_id: c.challengeId, request_token_hash: bytea(c.requestTokenHash), purpose: c.purpose,
  envelope_version: envelope.envelopeVersion, payload_version: envelope.payloadVersion, template_version: envelope.templateVersion,
  encryption_key_version: envelope.encryptionKeyVersion, nonce: bytea(envelope.nonce), ciphertext: bytea(envelope.ciphertext),
  authentication_tag: bytea(envelope.authenticationTag), lease_id: LEASE, fence: "1", lease_expires_at: EXPIRES,
  attempt_count: 0, available_at: AVAILABLE, delivery_deadline_at: DEADLINE, leased_at: NOW, db_now: NOW, ...overrides
}; }
function responses() { return {
  enqueue: { job_id: JOB, state: "PENDING", created_at: NOW, delivery_deadline_at: DEADLINE },
  claim: claimRow(),
  beginSend: { job_id: JOB, state: "SENDING", attempt_count: 1, lease_id: LEASE, fence: "1", attempt_started_at: NOW,
    provider_deadline_at: PROVIDER, lease_expires_at: EXPIRES, delivery_deadline_at: DEADLINE,
    terminal_disposition: null, terminal_at: null, db_now: NOW },
  finalize: { job_id: JOB, state: "ACCEPTED", attempt_count: 1, terminal_disposition: "accepted", terminal_at: RESOLVED,
    available_at: null, provider_message_id: "synthetic-provider-id", challenge_recording: "recorded", resolved_at: RESOLVED },
  recover: { job_id: JOB, previous_state: "LEASED", state: "PENDING", attempt_count: 0,
    terminal_disposition: null, terminal_at: null, available_at: AVAILABLE, challenge_recording: "not_applicable", recovered_at: NOW },
  purge: { purged_count: 1 }
}; }
function repository(response, gates = GATES) {
  const calls = [];
  const repo = createEvery8dSettingsEmailOutboxRepository(gates, () => ({ rpc: async (name, args) => {
    calls.push({ name, args }); return typeof response === "function" ? response(name, args) : response;
  } }));
  return { repo, calls };
}
async function parsedClaim(row = claimRow()) {
  const { repo, calls } = repository({ data: [row], error: null });
  const result = await repo.claim({ batchSize: 1 });
  if (result.outcome !== "applied" || result.receipts.length !== 1) throw new Error("invalid synthetic claim setup");
  return { receipt: result.receipts[0], calls };
}
module.exports = { JOB, OTHER, CHALLENGE, LEASE, NOW, AVAILABLE, EXPIRES, PROVIDER, DEADLINE, RESOLVED,
  GATES, bytea, context, encrypted, inputs, claimRow, responses, repository, parsedClaim };
