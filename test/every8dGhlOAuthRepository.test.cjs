const assert = require("node:assert/strict");
const test = require("node:test");
const { createEvery8dGhlOAuthRepository } = require("../dist/services/every8dGhlOAuthRepository");

const installationId = "10000000-0000-4000-8000-000000000098";
const bootstrapId = "20000000-0000-4000-8000-000000000098";
const now = "2026-09-23T12:00:00.000Z";
const refreshColumnNames = [
  "credential_revision", "credential_state", "refresh_lease_id", "refresh_started_at",
  "refresh_lease_expires_at", "refresh_failure_class", "refresh_failed_at", "last_refreshed_at"
];
function installation(overrides = {}) { return {
  id: installationId, app_namespace: "every8d_connect", marketplace_app_id: "app-98",
  oauth_client_id: "client-98", tenant_id: "00000000-0000-4000-8000-000000000098",
  location_id: "location-98", company_id: "company-98", conversation_provider_id: "provider-98",
  channel: "sms", provider: "every8d", status: "pending", installation_generation: 3,
  latest_lifecycle_event_at: now, latest_lifecycle_event_id: "event-98",
  latest_lifecycle_event_type: "INSTALL", latest_lifecycle_version_id: "version-98",
  access_token_ciphertext: null, refresh_token_ciphertext: null, encryption_key_version: null,
  token_expires_at: null, granted_scopes: [], credential_revision: 0, credential_state: "none",
  refresh_lease_id: null, refresh_started_at: null, refresh_lease_expires_at: null,
  refresh_failure_class: null, refresh_failed_at: null, last_refreshed_at: null,
  created_at: now, updated_at: now, ...overrides
}; }
function preC1aInstallation(overrides = {}) {
  const row = installation(overrides);
  for (const column of refreshColumnNames) delete row[column];
  return row;
}
function bootstrap(overrides = {}) { return {
  id: bootstrapId, app_namespace: "every8d_connect", marketplace_version_id: "version-98",
  expected_location_id: "location-98", target_installation_generation: 3,
  state_hash: "a".repeat(64), browser_binding_hash: "b".repeat(64),
  redirect_uri: "https://oauth.example.invalid/oauth/every8d-connect/callback",
  config_fingerprint: "c".repeat(64), status: "exchanging", created_at: now,
  expires_at: "2026-09-23T12:10:00.000Z", callback_received_at: now,
  authorization_code_ciphertext: "\\x656e63727970746564", authorization_code_key_version: "code-v1",
  claimed_installation_id: installationId, claimed_installation_generation: 3,
  exchange_started_at: now, terminal_at: null, failure_class: null, ...overrides
}; }
function harness(responses = {}) {
  const calls = [];
  const client = { rpc(name, input) {
    calls.push({ name, input });
    return Promise.resolve({ data: responses[name] ?? null, error: null });
  } };
  return { calls, repository: createEvery8dGhlOAuthRepository(() => client) };
}

function persistenceHarness(data) {
  const query = {
    update() { return this; },
    eq() { return this; },
    in() { return this; },
    select() { return this; },
    async maybeSingle() { return { data, error: null }; }
  };
  return createEvery8dGhlOAuthRepository(() => ({ from() { return query; } }));
}

const persistenceInput = {
  installationId,
  marketplaceAppId: "app-98",
  oauthClientId: "client-98",
  tenantId: "00000000-0000-4000-8000-000000000098",
  locationId: "location-98",
  companyId: "company-98",
  conversationProviderId: "provider-98",
  installationGeneration: 3,
  marketplaceVersionId: "version-98",
  accessTokenCiphertext: "encrypted-access",
  refreshTokenCiphertext: "encrypted-refresh",
  encryptionKeyVersion: "token-v1",
  expiresAt: "2026-09-23T13:00:00.000Z",
  grantedScopes: ["locations.readonly"]
};

const lifecycleInput = {
  eventType: "INSTALL", marketplaceAppId: "app-98", oauthClientId: "client-98",
  tenantId: "00000000-0000-4000-8000-000000000098", locationId: "location-98", companyId: "company-98",
  conversationProviderId: "provider-98", marketplaceVersionId: "version-98", eventAt: now, eventId: "event-98"
};

test("repository validates lifecycle v2 output without coercing authority", async () => {
  const h = harness({ apply_every8d_ghl_marketplace_lifecycle_v2: { outcome: "applied", installation: installation() } });
  assert.equal((await h.repository.applyLifecycleEvent(lifecycleInput)).outcome, "applied");
  const malformed = harness({ apply_every8d_ghl_marketplace_lifecycle_v2: { outcome: 1, installation: installation() } });
  await assert.rejects(() => malformed.repository.applyLifecycleEvent(lifecycleInput));
});

test("installation parser accepts exact pre-C1a and post-C1a rows without synthesizing metadata", async () => {
  const rows = [preC1aInstallation(), installation()];
  for (const row of rows) {
    const h = harness({ apply_every8d_ghl_marketplace_lifecycle_v2: { outcome: "applied", installation: row } });
    const parsed = (await h.repository.applyLifecycleEvent(lifecycleInput)).installation;
    assert.equal(parsed.id, installationId);
    assert.equal(parsed.location_id, "location-98");
    assert.equal(parsed.status, "pending");
    assert.deepEqual(parsed.granted_scopes, []);
  }
  const pre = (await harness({
    apply_every8d_ghl_marketplace_lifecycle_v2: {
      outcome: "applied", installation: preC1aInstallation()
    }
  }).repository.applyLifecycleEvent(lifecycleInput)).installation;
  assert.equal(Object.hasOwn(pre, "credential_revision"), false);
  assert.equal(Object.hasOwn(pre, "credential_state"), false);
});

test("installation parser rejects partial or malformed C1a metadata", async () => {
  const malformedRows = [
    { ...preC1aInstallation(), credential_revision: 1 },
    installation({ credential_state: "invented" }),
    installation({ refresh_lease_id: "not-a-uuid" }),
    installation({ refresh_started_at: "not-a-timestamp" }),
    installation({ unexpected: true })
  ];
  for (const row of malformedRows) {
    const h = harness({ apply_every8d_ghl_marketplace_lifecycle_v2: { outcome: "applied", installation: row } });
    await assert.rejects(() => h.repository.applyLifecycleEvent(lifecycleInput));
  }
});

test("atomic callback RPC receives only authenticated context and server-pinned Location", async () => {
  const h = harness({ accept_every8d_public_oauth_callback_v1: {
    id: bootstrapId, status: "ready", targetInstallationGeneration: 3,
    expiresAt: "2026-09-23T12:10:00.000Z" } });
  const result = await h.repository.acceptCallback({
    marketplaceAppId: "app-98", oauthClientId: "client-98", conversationProviderId: "provider-98",
    marketplaceVersionId: "version-98", expectedLocationId: "location-98",
    stateHash: "a".repeat(64), browserBindingHash: "b".repeat(64),
    redirectUri: "https://oauth.example.invalid/oauth/every8d-connect/callback",
    configFingerprint: "c".repeat(64), expiresAt: "2026-09-23T12:10:00.000Z",
    authorizationCodeCiphertext: "encrypted-code", authorizationCodeKeyVersion: "code-v1" });
  assert.equal(result.status, "ready");
  assert.equal(h.calls[0].input.input_expected_location_id, "location-98");
  assert.match(h.calls[0].input.input_authorization_code_ciphertext, /^\\x[0-9a-f]+$/);
  assert.equal(/tenant|company|claimed_installation_id/.test(JSON.stringify(h.calls[0])), false);
});

test("new security-sensitive RPC results fail closed when malformed", async () => {
  for (const value of [123, [123], [{ list_every8d_oauth_recoverable_v1: "not-a-uuid" }]]) {
    const h = harness({ list_every8d_oauth_recoverable_v1: value });
    await assert.rejects(() => h.repository.listRecoverable({ marketplaceVersionId: "version-98", configFingerprint: "c".repeat(64), limit: 8 }));
  }
  const status = harness({ get_every8d_oauth_bootstrap_status_v1: "invented" });
  await assert.rejects(() => status.repository.getStatus({ browserBindingHash: "b".repeat(64), configFingerprint: "c".repeat(64) }));
  const claim = harness({ claim_every8d_oauth_exchange_v1: { bootstrap: bootstrap({ target_installation_generation: "3" }), installation: installation() } });
  await assert.rejects(() => claim.repository.claimExchange({ bootstrapId, marketplaceVersionId: "version-98", configFingerprint: "c".repeat(64) }));
});

test("claim and finalization validate and preserve bytea boundaries", async () => {
  const h = harness({ claim_every8d_oauth_exchange_v1: { bootstrap: bootstrap(), installation: installation() }, finalize_every8d_oauth_exchange_v1: true });
  const claim = await h.repository.claimExchange({ bootstrapId, marketplaceVersionId: "version-98", configFingerprint: "c".repeat(64) });
  assert.equal(claim.bootstrap.authorization_code_ciphertext, "encrypted");
  assert.equal(await h.repository.finalizeExchange({ bootstrapId, marketplaceVersionId: "version-98", configFingerprint: "c".repeat(64),
    accessTokenCiphertext: "encrypted-access", refreshTokenCiphertext: "encrypted-refresh", encryptionKeyVersion: "token-v1",
    tokenExpiresAt: "2026-09-23T13:00:00.000Z", grantedScopes: ["locations.readonly"] }), true);
  assert.match(h.calls[1].input.input_access_token_ciphertext, /^\\x[0-9a-f]+$/);
});

test("legacy credential persistence result uses the strict compatibility schema", async () => {
  const valid = installation({
    access_token_ciphertext: "\\x01",
    refresh_token_ciphertext: "\\x02",
    encryption_key_version: "token-v1",
    token_expires_at: persistenceInput.expiresAt,
    granted_scopes: persistenceInput.grantedScopes,
    credential_revision: 1,
    credential_state: "usable"
  });
  assert.equal((await persistenceHarness(valid).persistInstalledCredentials(persistenceInput)).id, installationId);
  assert.equal(await persistenceHarness(null).persistInstalledCredentials(persistenceInput), null);
  for (const malformed of [
    1,
    { ...valid, unexpected: true },
    { ...valid, access_token_ciphertext: "not-bytea" },
    { ...valid, granted_scopes: [""] }
  ]) {
    await assert.rejects(() => persistenceHarness(malformed).persistInstalledCredentials(persistenceInput));
  }
});
