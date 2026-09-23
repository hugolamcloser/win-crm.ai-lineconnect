const assert = require("node:assert/strict");
const test = require("node:test");
const { createEvery8dGhlOAuthRepository } = require("../dist/services/every8dGhlOAuthRepository");

function harness(responses = {}) {
  const calls = [];
  const client = {
    rpc(name, input) {
      calls.push({ name, input });
      const response = responses[name] ?? null;
      const promise = Promise.resolve({ data: response, error: null });
      promise.single = async () => ({ data: response, error: null });
      promise.maybeSingle = async () => ({ data: response, error: null });
      return promise;
    }
  };
  return { calls, repository: createEvery8dGhlOAuthRepository(() => client) };
}

test("repository applies lifecycle only through v2 and includes exact signed version evidence", async () => {
  const installation = { id: "installation-98" };
  const h = harness({ apply_every8d_ghl_marketplace_lifecycle_v2: { outcome: "applied", installation } });
  const result = await h.repository.applyLifecycleEvent({
    eventType: "INSTALL", marketplaceAppId: "app-98", oauthClientId: "client-98",
    tenantId: "tenant-98", locationId: "location-98", companyId: "company-98",
    conversationProviderId: "provider-98", marketplaceVersionId: "version-98",
    eventAt: "2026-09-23T12:00:00.000Z", eventId: "event-98"
  });
  assert.deepEqual(result, { outcome: "applied", installation });
  assert.deepEqual(h.calls[0], {
    name: "apply_every8d_ghl_marketplace_lifecycle_v2",
    input: {
      input_event_type: "INSTALL", input_marketplace_app_id: "app-98",
      input_oauth_client_id: "client-98", input_tenant_id: "tenant-98",
      input_location_id: "location-98", input_company_id: "company-98",
      input_conversation_provider_id: "provider-98", input_marketplace_version_id: "version-98",
      input_event_at: "2026-09-23T12:00:00.000Z", input_event_id: "event-98"
    }
  });
});

test("bootstrap persistence receives only hashes and trusted server context", async () => {
  const h = harness({ create_every8d_public_oauth_bootstrap_v1: { id: "bootstrap-98", expires_at: "2026-09-23T12:10:00Z" } });
  await h.repository.createBootstrap({
    marketplaceAppId: "app-98", oauthClientId: "client-98", conversationProviderId: "provider-98",
    marketplaceVersionId: "version-98", stateHash: "a".repeat(64), browserBindingHash: "b".repeat(64),
    redirectUri: "https://oauth.example.invalid/oauth/every8d-connect/callback",
    configFingerprint: "c".repeat(64), ttlSeconds: 600
  });
  const serialized = JSON.stringify(h.calls[0]);
  assert.equal(serialized.includes("tenant"), false);
  assert.equal(serialized.includes("location"), false);
  assert.equal(serialized.includes("company"), false);
  assert.equal(serialized.includes("installation_id"), false);
  assert.equal(serialized.includes("browser_binding_hash"), true);
});

test("authorization code and final tokens are encoded as bytea only for narrow transaction RPCs", async () => {
  const h = harness({
    accept_every8d_public_oauth_callback_v1: "ready",
    finalize_every8d_oauth_exchange_v1: true
  });
  await h.repository.acceptCallback({
    bootstrapId: "bootstrap-98", stateHash: "a".repeat(64), browserBindingHash: "b".repeat(64),
    redirectUri: "https://oauth.example.invalid/oauth/every8d-connect/callback",
    configFingerprint: "c".repeat(64), authorizationCodeCiphertext: "encrypted-code-envelope",
    authorizationCodeKeyVersion: "code-v1"
  });
  await h.repository.finalizeExchange({
    bootstrapId: "bootstrap-98", marketplaceVersionId: "version-98",
    configFingerprint: "c".repeat(64), accessTokenCiphertext: "encrypted-access-envelope",
    refreshTokenCiphertext: "encrypted-refresh-envelope", encryptionKeyVersion: "token-v1",
    tokenExpiresAt: "2026-09-23T13:00:00Z", grantedScopes: ["locations.readonly"]
  });
  assert.match(h.calls[0].input.input_authorization_code_ciphertext, /^\\x[0-9a-f]+$/);
  assert.match(h.calls[1].input.input_access_token_ciphertext, /^\\x[0-9a-f]+$/);
  assert.match(h.calls[1].input.input_refresh_token_ciphertext, /^\\x[0-9a-f]+$/);
  assert.equal(JSON.stringify(h.calls).includes("synthetic-access-secret"), false);
});
