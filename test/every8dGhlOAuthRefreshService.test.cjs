const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const {
  Every8dGhlOAuthRefreshClientError
} = require("../dist/integrations/every8dGhlOAuthRefreshClient");
const {
  createEvery8dGhlOAuthRefreshService
} = require("../dist/services/every8dGhlOAuthRefreshService");
const {
  decryptEvery8dGhlOAuthToken,
  encryptEvery8dGhlOAuthToken,
  parseEvery8dGhlOAuthEncryptionKeys
} = require("../dist/services/every8dGhlTokenEncryption");

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const installationUrl = "https://app.gohighlevel.com/v2/location/location-98/integration/integration-test-98/versions/version-test-98";
const installationId = "10000000-0000-4000-8000-000000000098";
const tenantId = "00000000-0000-4000-8000-000000000098";
const leaseId = "30000000-0000-4000-8000-000000000098";
const keys = parseEvery8dGhlOAuthEncryptionKeys(JSON.stringify({
  "test-v1": Buffer.alloc(32, 0x41).toString("base64"),
  "test-v2": Buffer.alloc(32, 0x42).toString("base64")
}));

function sha256(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function config(overrides = {}) { return {
  enabled: true, refreshEnabled: true, marketplaceAppId: "every8d-app-98",
  oauthClientId: "every8d-client-98", oauthClientSecret: "synthetic-client-secret",
  redirectUri: "https://oauth.example.invalid/oauth/every8d-connect/callback",
  installationUrl, installationUrlSha256: sha256(installationUrl),
  marketplaceVersionId: "version-test-98", expectedLocationId: "location-98",
  tokenUrl: "https://services.leadconnectorhq.com/oauth/token",
  conversationProviderId: "every8d-provider-98", requiredScopes: ["locations.readonly"],
  stateTtlSeconds: 600, activeKeyVersion: "test-v2", encryptionKeys: keys, ...overrides
}; }

function identity() { return {
  installationId, installationGeneration: 3, marketplaceAppId: "every8d-app-98",
  oauthClientId: "every8d-client-98", tenantId, locationId: "location-98",
  companyId: "company-98", conversationProviderId: "every8d-provider-98",
  marketplaceVersionId: "version-test-98"
}; }

function candidate(overrides = {}) { return {
  id: installationId, app_namespace: "every8d_connect", marketplace_app_id: "every8d-app-98",
  oauth_client_id: "every8d-client-98", tenant_id: tenantId, location_id: "location-98",
  company_id: "company-98", conversation_provider_id: "every8d-provider-98",
  channel: "sms", provider: "every8d", status: "pending", installation_generation: 3,
  latest_lifecycle_event_type: "INSTALL", latest_lifecycle_version_id: "version-test-98",
  credential_revision: 7, credential_state: "usable", encryption_key_version: "test-v1",
  token_expires_at: "2026-09-23T12:04:00.000Z", granted_scopes: ["locations.readonly"],
  ...overrides
}; }

function context(purpose) { return { ...identity(), purpose, installationId,
  installationGeneration: 3 }; }

function encryptedRefreshToken(plaintext = "claimed-refresh-secret") {
  return encryptEvery8dGhlOAuthToken({
    plaintext, activeKeyVersion: "test-v1", keys, context: context("refresh_token")
  }).ciphertext;
}

function claim(overrides = {}) { return {
  installationId, installationGeneration: 3, credentialRevision: 7, refreshLeaseId: leaseId,
  refreshLeaseExpiresAt: "2026-09-23T12:05:00.000Z",
  refreshTokenCiphertext: encryptedRefreshToken(), encryptionKeyVersion: "test-v1",
  grantedScopes: ["locations.readonly"], ...overrides
}; }

function harness(overrides = {}) {
  const calls = [];
  const logs = [];
  const repository = {
    async findExpiredRefreshLease(input) { calls.push(["findExpiredRefreshLease", input]); return null; },
    async findRefreshCandidate(input) { calls.push(["findRefreshCandidate", input]); return candidate(); },
    async claimRefresh(input) { calls.push(["claimRefresh", input]); return claim(); },
    async finalizeRefresh(input) { calls.push(["finalizeRefresh", input]); return true; },
    async failRefresh(input) { calls.push(["failRefresh", input]); return true; },
    async getRefreshState(input) { calls.push(["getRefreshState", input]); return null; },
    ...overrides.repository
  };
  let exchangeCalls = 0;
  const service = createEvery8dGhlOAuthRefreshService({
    config: config(overrides.config), repository,
    async exchangeRefreshToken(input) {
      exchangeCalls += 1;
      calls.push(["exchangeRefreshToken", input]);
      if (overrides.exchangeRefreshToken) return overrides.exchangeRefreshToken(input);
      return { accessToken: "rotated-access-secret", refreshToken: "rotated-refresh-secret",
        expiresIn: 3600, scopes: ["locations.readonly"] };
    },
    now: () => NOW,
    log: {
      info(data, message) { logs.push({ level: "info", data, message }); },
      warn(data, message) { logs.push({ level: "warn", data, message }); }
    },
    decryptToken: overrides.decryptToken ?? decryptEvery8dGhlOAuthToken,
    encryptToken: overrides.encryptToken ?? encryptEvery8dGhlOAuthToken
  });
  return { calls, logs, repository, service, exchangeCalls: () => exchangeCalls };
}

test("refresh service default-off has zero query, RPC, decryption, or network side effects", async () => {
  let touched = 0;
  const h = harness({
    config: { refreshEnabled: false },
    repository: { async findExpiredRefreshLease() { touched += 1; } },
    decryptToken() { touched += 1; },
    async exchangeRefreshToken() { touched += 1; }
  });
  assert.deepEqual(await h.service.runOnce(), {
    staleLeaseFound: false, candidateFound: false, claimWon: false,
    finalized: false, failureClass: null
  });
  assert.equal(touched, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.exchangeCalls(), 0);
});

test("scope mismatch and unknown stored key are rejected before claim", async () => {
  for (const row of [candidate({ granted_scopes: ["wrong.scope"] }),
    candidate({ encryption_key_version: "unknown-key" })]) {
    const h = harness({ repository: { async findRefreshCandidate(input) {
      h.calls.push(["findRefreshCandidate", input]); return row;
    } } });
    const result = await h.service.runOnce();
    assert.equal(result.candidateFound, true);
    assert.equal(h.calls.some(([name]) => name === "claimRefresh"), false);
    assert.equal(h.exchangeCalls(), 0);
  }
});

test("claim loser makes no provider request and a concurrent winner refreshes only once", async () => {
  let claimCount = 0;
  const h = harness({ repository: { async claimRefresh(input) {
    h.calls.push(["claimRefresh", input]); claimCount += 1; return claimCount === 1 ? claim() : null;
  } } });
  const [first, second] = await Promise.all([h.service.runOnce(), h.service.runOnce()]);
  assert.equal([first.claimWon, second.claimWon].filter(Boolean).length, 1);
  assert.equal(h.exchangeCalls(), 1);
});

test("winner decrypts only the claim and atomically finalizes rotated tokens under active key", async () => {
  const h = harness({ exchangeRefreshToken(input) {
    assert.equal(input.refreshToken, "claimed-refresh-secret");
    assert.deepEqual(input.claimedScopes, ["locations.readonly"]);
    return { accessToken: "rotated-access-secret", refreshToken: "rotated-refresh-secret",
      expiresIn: 3600, scopes: ["locations.readonly"] };
  } });
  const result = await h.service.runOnce();
  assert.equal(result.finalized, true);
  const finalized = h.calls.find(([name]) => name === "finalizeRefresh")[1];
  assert.equal(finalized.priorCredentialRevision, 7);
  assert.equal(finalized.refreshLeaseId, leaseId);
  assert.equal(finalized.encryptionKeyVersion, "test-v2");
  assert.equal(finalized.tokenExpiresAt, "2026-09-23T13:00:00.000Z");
  assert.equal(decryptEvery8dGhlOAuthToken({ ciphertext: finalized.accessTokenCiphertext,
    expectedKeyVersion: "test-v2", keys, context: context("access_token") }),
  "rotated-access-secret");
  assert.equal(decryptEvery8dGhlOAuthToken({ ciphertext: finalized.refreshTokenCiphertext,
    expectedKeyVersion: "test-v2", keys, context: context("refresh_token") }),
  "rotated-refresh-secret");
});

test("provider failures map only to the three authorized provider failure classes with no retry", async () => {
  for (const failureClass of ["invalid_grant", "token_response_rejected", "refresh_outcome_unknown"]) {
    const h = harness({ exchangeRefreshToken() { throw new Every8dGhlOAuthRefreshClientError(failureClass); } });
    const result = await h.service.runOnce();
    assert.equal(result.failureClass, failureClass);
    assert.equal(h.exchangeCalls(), 1);
    const failed = h.calls.find(([name]) => name === "failRefresh")[1];
    assert.equal(failed.failureClass, failureClass);
    assert.equal(failed.priorCredentialRevision, 7);
    assert.equal(failed.refreshLeaseId, leaseId);
  }
});

test("post-claim local decrypt, encryption, and persistence exceptions fail credential_persistence_failed", async () => {
  for (const overrides of [
    { decryptToken() { throw new Error("local decrypt failure"); } },
    { encryptToken() { throw new Error("local encryption failure"); } },
    { repository: { async finalizeRefresh() { throw new Error("database unavailable"); } } }
  ]) {
    const h = harness(overrides);
    const result = await h.service.runOnce();
    assert.equal(result.failureClass, "credential_persistence_failed");
    const failed = h.calls.find(([name]) => name === "failRefresh")[1];
    assert.equal(failed.failureClass, "credential_persistence_failed");
    assert.ok(h.exchangeCalls() <= 1);
  }
});

test("false finalize re-reads authoritative state and never retries or calls failure RPC", async () => {
  const h = harness({ repository: {
    async finalizeRefresh(input) { h.calls.push(["finalizeRefresh", input]); return false; },
    async getRefreshState(input) { h.calls.push(["getRefreshState", input]); return {
      credential_revision: 8, credential_state: "reauth_required", refresh_lease_id: null,
      refresh_failure_class: "refresh_outcome_unknown", refresh_failed_at: "2026-09-23T12:01:00.000Z"
    }; }
  } });
  const result = await h.service.runOnce();
  assert.equal(result.finalized, false);
  assert.equal(h.exchangeCalls(), 1);
  assert.equal(h.calls.filter(([name]) => name === "getRefreshState").length, 1);
  assert.equal(h.calls.some(([name]) => name === "failRefresh"), false);
});

test("failure RPC failure leaves the lease for stale recovery and never retries provider", async () => {
  const h = harness({
    exchangeRefreshToken() { throw new Every8dGhlOAuthRefreshClientError("invalid_grant"); },
    repository: { async failRefresh() { throw new Error("database unavailable"); } }
  });
  const result = await h.service.runOnce();
  assert.equal(result.failureClass, "invalid_grant");
  assert.equal(h.exchangeCalls(), 1);
  assert.ok(h.logs.some((entry) => entry.data.event === "every8d_ghl_oauth_refresh_failure_rpc_failed"));
});

test("stale lease recovery claims only to trigger the database burn and does not contact provider", async () => {
  const stale = candidate({ credential_state: "refreshing",
    refresh_lease_expires_at: "2026-09-23T11:59:00.000Z" });
  delete stale.encryption_key_version;
  delete stale.token_expires_at;
  delete stale.granted_scopes;
  const h = harness({ repository: {
    async findExpiredRefreshLease(input) { h.calls.push(["findExpiredRefreshLease", input]); return stale; },
    async findRefreshCandidate(input) { h.calls.push(["findRefreshCandidate", input]); return null; },
    async claimRefresh(input) { h.calls.push(["claimRefresh", input]); return null; },
    async getRefreshState(input) { h.calls.push(["getRefreshState", input]); return {
      credential_revision: 7, credential_state: "reauth_required", refresh_lease_id: null,
      refresh_failure_class: "refresh_outcome_unknown", refresh_failed_at: "2026-09-23T12:00:00.000Z"
    }; }
  } });
  const result = await h.service.runOnce();
  assert.equal(result.staleLeaseFound, true);
  assert.equal(h.exchangeCalls(), 0);
  assert.deepEqual(h.calls.filter(([name]) => name === "claimRefresh")[0][1], identity());
});

test("sanitized refresh logs contain no token, ciphertext, client secret, or response body", async () => {
  const h = harness();
  await h.service.runOnce();
  const serialized = JSON.stringify(h.logs);
  for (const forbidden of ["claimed-refresh-secret", "rotated-access-secret", "rotated-refresh-secret",
    "synthetic-client-secret", claim().refreshTokenCiphertext, "responseBody"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
