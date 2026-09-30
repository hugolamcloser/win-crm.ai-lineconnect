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

function refreshCandidate(overrides = {}) { return {
  id: installationId, app_namespace: "every8d_connect", marketplace_app_id: "app-98",
  oauth_client_id: "client-98", tenant_id: "00000000-0000-4000-8000-000000000098",
  location_id: "location-98", company_id: "company-98", conversation_provider_id: "provider-98",
  channel: "sms", provider: "every8d", status: "pending", installation_generation: 3,
  latest_lifecycle_event_type: "INSTALL", latest_lifecycle_version_id: "version-98",
  credential_revision: 1, credential_state: "usable", encryption_key_version: "token-v1",
  token_expires_at: "2026-09-23T12:04:00.000Z", granted_scopes: ["locations.readonly"], ...overrides
}; }

function queryHarness(data) {
  const calls = [];
  const query = {};
  for (const method of ["select", "eq", "in", "not", "gt", "lte", "order", "limit"]) {
    query[method] = (...args) => { calls.push({ method, args }); return query; };
  }
  query.maybeSingle = async () => ({ data, error: null });
  const repository = createEvery8dGhlOAuthRepository(() => ({
    from(table) { calls.push({ method: "from", args: [table] }); return query; }
  }));
  return { calls, repository };
}

const refreshIdentity = {
  installationId, marketplaceAppId: "app-98", oauthClientId: "client-98",
  tenantId: "00000000-0000-4000-8000-000000000098", locationId: "location-98",
  companyId: "company-98", conversationProviderId: "provider-98",
  marketplaceVersionId: "version-98", installationGeneration: 3
};

test("refresh candidate query is ciphertext-free, exact, ordered, and limited to one", async () => {
  const h = queryHarness(refreshCandidate());
  assert.equal((await h.repository.findRefreshCandidate({
    marketplaceAppId: "app-98", oauthClientId: "client-98", expectedLocationId: "location-98",
    conversationProviderId: "provider-98", marketplaceVersionId: "version-98",
    refreshDueBefore: "2026-09-23T12:05:00.000Z"
  })).id, installationId);
  const projection = h.calls.find((call) => call.method === "select").args[0];
  assert.doesNotMatch(projection, /ciphertext|refresh_lease/);
  assert.match(projection, /credential_revision,credential_state,encryption_key_version,token_expires_at,granted_scopes/);
  assert.deepEqual(h.calls.filter((call) => call.method === "in")[0].args,
    ["status", ["pending", "active"]]);
  assert.deepEqual(h.calls.filter((call) => call.method === "order").map((call) => call.args[0]),
    ["token_expires_at", "id"]);
  assert.deepEqual(h.calls.find((call) => call.method === "limit").args, [1]);
  for (const [column, value] of [
    ["app_namespace", "every8d_connect"], ["marketplace_app_id", "app-98"],
    ["oauth_client_id", "client-98"], ["location_id", "location-98"],
    ["conversation_provider_id", "provider-98"], ["channel", "sms"],
    ["provider", "every8d"], ["latest_lifecycle_event_type", "INSTALL"],
    ["latest_lifecycle_version_id", "version-98"], ["credential_state", "usable"]
  ]) assert.ok(h.calls.some((call) => call.method === "eq" && call.args[0] === column && call.args[1] === value));
});

test("stale lease probe is ciphertext-free and exact", async () => {
  const row = refreshCandidate({
    credential_state: "refreshing", refresh_lease_expires_at: "2026-09-23T12:00:00.000Z"
  });
  delete row.encryption_key_version;
  delete row.token_expires_at;
  delete row.granted_scopes;
  const h = queryHarness(row);
  const found = await h.repository.findExpiredRefreshLease({
    marketplaceAppId: "app-98", oauthClientId: "client-98", expectedLocationId: "location-98",
    conversationProviderId: "provider-98", marketplaceVersionId: "version-98",
    expiredBefore: "2026-09-23T12:01:00.000Z"
  });
  assert.equal(found.credential_state, "refreshing");
  assert.doesNotMatch(h.calls.find((call) => call.method === "select").args[0], /ciphertext/);
  assert.ok(h.calls.some((call) => call.method === "lte"
    && call.args[0] === "refresh_lease_expires_at"));
});

test("refresh RPCs preserve the exact generation, revision, lease, and bytea contract", async () => {
  const leaseId = "30000000-0000-4000-8000-000000000098";
  const h = harness({
    claim_every8d_ghl_oauth_refresh_v1: {
      installationId, installationGeneration: 3, credentialRevision: 7,
      refreshLeaseId: leaseId, refreshLeaseExpiresAt: "2026-09-23T12:05:00.000Z",
      refreshTokenCiphertext: "\\x656e63727970746564", encryptionKeyVersion: "token-v1",
      grantedScopes: ["locations.readonly"]
    },
    finalize_every8d_ghl_oauth_refresh_v1: true,
    fail_every8d_ghl_oauth_refresh_v1: true
  });
  const claim = await h.repository.claimRefresh(refreshIdentity);
  assert.equal(claim.refreshTokenCiphertext, "encrypted");
  assert.deepEqual(h.calls[0].input, {
    input_installation_id: installationId, input_marketplace_app_id: "app-98",
    input_oauth_client_id: "client-98", input_tenant_id: refreshIdentity.tenantId,
    input_location_id: "location-98", input_company_id: "company-98",
    input_conversation_provider_id: "provider-98", input_marketplace_version_id: "version-98",
    input_installation_generation: 3
  });
  assert.equal(await h.repository.finalizeRefresh({
    ...refreshIdentity, priorCredentialRevision: 7, refreshLeaseId: leaseId,
    accessTokenCiphertext: "new-access", refreshTokenCiphertext: "new-refresh",
    encryptionKeyVersion: "token-v2", tokenExpiresAt: "2026-09-23T13:00:00.000Z",
    grantedScopes: ["locations.readonly"]
  }), true);
  assert.equal(h.calls[1].input.input_prior_credential_revision, 7);
  assert.equal(h.calls[1].input.input_refresh_lease_id, leaseId);
  assert.match(h.calls[1].input.input_access_token_ciphertext, /^\\x[0-9a-f]+$/);
  for (const failureClass of ["invalid_grant", "token_response_rejected",
    "refresh_outcome_unknown", "credential_persistence_failed"]) {
    assert.equal(await h.repository.failRefresh({
      ...refreshIdentity, priorCredentialRevision: 7, refreshLeaseId: leaseId, failureClass
    }), true);
    assert.equal(h.calls.at(-1).input.input_failure_class, failureClass);
  }
});

test("refresh claim parser fails closed and preserves a lost claim", async () => {
  assert.equal(await harness({ claim_every8d_ghl_oauth_refresh_v1: null })
    .repository.claimRefresh(refreshIdentity), null);
  for (const malformed of [{ credentialRevision: 1 }, {
    installationId, installationGeneration: 3, credentialRevision: 1,
    refreshLeaseId: "bad", refreshLeaseExpiresAt: now,
    refreshTokenCiphertext: "\\x01", encryptionKeyVersion: "token-v1", grantedScopes: ["scope"]
  }]) {
    await assert.rejects(() => harness({ claim_every8d_ghl_oauth_refresh_v1: malformed })
      .repository.claimRefresh(refreshIdentity));
  }
});
