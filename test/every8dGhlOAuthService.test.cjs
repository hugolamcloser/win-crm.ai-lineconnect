const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { getEvery8dGhlOAuthConfigFingerprint } = require("../dist/config/every8dGhlOAuth");
const {
  Every8dGhlOAuthError,
  Every8dGhlTokenExchangeError,
  createEvery8dGhlOAuthRuntime
} = require("../dist/services/every8dGhlOAuthService");
const { createEvery8dGhlOAuthReconciler } = require("../dist/services/every8dGhlOAuthReconciler");
const { decryptEvery8dGhlOAuthToken, parseEvery8dGhlOAuthEncryptionKeys } = require("../dist/services/every8dGhlTokenEncryption");

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const installationUrl = "https://app.gohighlevel.com/v2/location/location-98/integration/integration-test-98/versions/version-test-98";
const keyConfig = JSON.stringify({ "test-v1": Buffer.alloc(32, 0x51).toString("base64") });

function sha256(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }

function config(overrides = {}) {
  return {
    enabled: true,
    marketplaceAppId: "every8d-app-98",
    oauthClientId: "every8d-client-98",
    oauthClientSecret: "synthetic-client-secret",
    redirectUri: "https://oauth.example.invalid/oauth/every8d-connect/callback",
    installationUrl,
    installationUrlSha256: sha256(installationUrl),
    marketplaceVersionId: "version-test-98",
    expectedLocationId: "location-98",
    tokenUrl: "https://services.leadconnectorhq.com/oauth/token",
    conversationProviderId: "every8d-provider-98",
    requiredScopes: ["locations.readonly"],
    stateTtlSeconds: 600,
    activeKeyVersion: "test-v1",
    encryptionKeys: parseEvery8dGhlOAuthEncryptionKeys(keyConfig),
    ...overrides
  };
}

function installation(overrides = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000098",
    app_namespace: "every8d_connect",
    marketplace_app_id: "every8d-app-98",
    oauth_client_id: "every8d-client-98",
    tenant_id: "00000000-0000-4000-8000-000000000098",
    location_id: "location-98",
    company_id: "company-98",
    conversation_provider_id: "every8d-provider-98",
    channel: "sms",
    provider: "every8d",
    status: "pending",
    installation_generation: 3,
    latest_lifecycle_event_at: "2026-09-23T11:59:00.000Z",
    latest_lifecycle_event_id: "install-event-98",
    latest_lifecycle_event_type: "INSTALL",
    latest_lifecycle_version_id: "version-test-98",
    access_token_ciphertext: null,
    refresh_token_ciphertext: null,
    encryption_key_version: null,
    token_expires_at: null,
    granted_scopes: [],
    ...overrides
  };
}

function token(overrides = {}) {
  return {
    access_token: "synthetic-access-secret",
    refresh_token: "synthetic-refresh-secret",
    expires_in: 3600,
    scope: "locations.readonly",
    userType: "Location",
    locationId: "location-98",
    companyId: "company-98",
    appId: "every8d-app-98",
    isBulkInstallation: false,
    installToFutureLocations: false,
    approveAllLocations: false,
    approvedLocations: ["location-98"],
    ...overrides
  };
}

function harness(options = {}) {
  const selectedConfig = config(options.config);
  const fingerprint = getEvery8dGhlOAuthConfigFingerprint(selectedConfig);
  const calls = { accept: 0, list: 0, claim: 0, fail: 0, finalize: 0, exchange: 0, random: 0 };
  let bootstrap = null;
  let failureClass = null;
  let persisted = null;
  let sequence = 0;
  let claimWon = false;
  const legacyStates = new Map();

  const repository = {
    async acceptCallback(input) {
      calls.accept += 1;
      if (options.rejectInspect || bootstrap) return null;
      bootstrap = {
        id: "20000000-0000-4000-8000-000000000098",
        app_namespace: "every8d_connect",
        marketplace_version_id: input.marketplaceVersionId,
        expected_location_id: input.expectedLocationId,
        target_installation_generation: 3,
        state_hash: input.stateHash,
        browser_binding_hash: input.browserBindingHash,
        redirect_uri: input.redirectUri,
        config_fingerprint: input.configFingerprint,
        status: options.installFirst === false ? "waiting_install" : "ready",
        expires_at: input.expiresAt,
        callback_received_at: new Date(NOW).toISOString(),
        authorization_code_ciphertext: input.authorizationCodeCiphertext,
        authorization_code_key_version: input.authorizationCodeKeyVersion,
        claimed_installation_id: options.installFirst === false ? null : installation().id,
        claimed_installation_generation: options.installFirst === false ? null : 3,
        exchange_started_at: null,
        terminal_at: null,
        failure_class: null
      };
      return { id: bootstrap.id, status: bootstrap.status, targetInstallationGeneration: 3, expiresAt: bootstrap.expires_at };
    },
    async listRecoverable() {
      calls.list += 1;
      return bootstrap?.status === "ready" ? [bootstrap.id] : [];
    },
    async claimExchange() {
      calls.claim += 1;
      if (!bootstrap || bootstrap.status !== "ready" || claimWon) return null;
      claimWon = true;
      bootstrap.status = "exchanging";
      bootstrap.exchange_started_at = new Date(NOW).toISOString();
      return { bootstrap: { ...bootstrap }, installation: installation(options.installation) };
    },
    async failBootstrap(input) {
      calls.fail += 1;
      failureClass = input.failureClass;
      if (bootstrap && bootstrap.status !== "succeeded") {
        bootstrap.status = "failed";
        bootstrap.authorization_code_ciphertext = null;
        bootstrap.authorization_code_key_version = null;
      }
      return true;
    },
    async finalizeExchange(input) {
      calls.finalize += 1;
      if (options.finalizeFalse) return false;
      persisted = input;
      bootstrap.status = "succeeded";
      bootstrap.authorization_code_ciphertext = null;
      bootstrap.authorization_code_key_version = null;
      return true;
    },
    async getStatus() { return bootstrap?.status ?? null; },
    async getEligibleInstallation() { return installation(options.installation); },
    async createOAuthState(input) {
      const state = {
        id: "legacy-state-98", installation_id: input.installationId,
        installation_generation: input.installationGeneration, state_hash: input.stateHash,
        browser_binding_hash: input.browserBindingHash, redirect_uri: input.redirectUri,
        created_at: new Date(NOW).toISOString(), expires_at: input.expiresAt,
        consumed_at: null, revoked_at: null
      };
      legacyStates.set(state.state_hash, state);
      return state;
    },
    async getOAuthStateByHash(stateHash) { return legacyStates.get(stateHash) ?? null; },
    async consumeOAuthState(input) {
      const state = legacyStates.get(input.stateHash);
      if (!state || state.consumed_at || state.browser_binding_hash !== input.browserBindingHash) return null;
      state.consumed_at = new Date(NOW).toISOString();
      return state;
    },
    async persistInstalledCredentials(input) { persisted = input; return installation(); }
  };

  const runtime = createEvery8dGhlOAuthRuntime({
    config: selectedConfig,
    repository,
    exchangeAuthorizationCode: async () => {
      calls.exchange += 1;
      if (options.exchangeError) throw options.exchangeError;
      if (options.exchangeGate) await options.exchangeGate;
      return options.token ?? token();
    },
    now: () => NOW,
    randomBytes: (size) => {
      calls.random += 1;
      sequence += 1;
      return Buffer.alloc(size, sequence);
    }
  });

  async function startAndCallback(callbackOverrides = {}) {
    const started = await runtime.start();
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    const accepted = await runtime.acceptCallback({
      code: "synthetic-authorization-code",
      state,
      browserBinding: started.browserBinding,
      ...callbackOverrides
    });
    return { started, state, accepted };
  }

  return {
    runtime, repository, calls, startAndCallback, fingerprint,
    get bootstrap() { return bootstrap; },
    get failureClass() { return failureClass; },
    get persisted() { return persisted; }
  };
}

test("OAuth disabled performs zero DB, RNG, cookie-equivalent, reconciler, and network activity", async () => {
  const h = harness({ config: { enabled: false } });
  for (const operation of [
    () => h.runtime.start(),
    () => h.runtime.acceptCallback({ code: "x", state: "y", browserBinding: "z" }),
    () => h.runtime.reconcileOnce()
  ]) {
    await assert.rejects(operation, (error) => error instanceof Every8dGhlOAuthError && error.code === "oauth_disabled");
  }
  const reconciler = createEvery8dGhlOAuthReconciler(h.runtime);
  reconciler.trigger();
  const stop = reconciler.start();
  stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.calls, { accept: 0, list: 0, claim: 0, fail: 0, finalize: 0, exchange: 0, random: 0 });
});

test("public start creates independent authenticated state and binding with zero persistence", async () => {
  const h = harness();
  const started = await h.runtime.start();
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  assert.notEqual(state, started.browserBinding);
  assert.equal(h.bootstrap, null);
  assert.equal(h.calls.accept, 0);
  assert.equal(new URL(started.authorizationUrl).origin, "https://app.gohighlevel.com");
  assert.equal(h.calls.random, 2);
});

test("many abandoned public starts create no durable attempt and consume no admission slot", async () => {
  const h = harness();
  const states = new Set();
  const bindings = new Set();
  for (let index = 0; index < 40; index += 1) {
    const started = await h.runtime.start();
    states.add(new URL(started.authorizationUrl).searchParams.get("state"));
    bindings.add(started.browserBinding);
  }
  assert.equal(states.size, 40);
  assert.equal(bindings.size, 40);
  assert.equal(h.bootstrap, null);
  assert.equal(h.calls.accept, 0);
  assert.equal((await h.runtime.start()).authorizationUrl.startsWith(installationUrl), true);
});

test("callback validates state and binding before encrypting the code and replay is rejected", async () => {
  const h = harness();
  const { started, state, accepted } = await h.startAndCallback();
  assert.deepEqual(accepted, { status: "pending", ready: true });
  assert.equal(h.bootstrap.authorization_code_ciphertext.includes("synthetic-authorization-code"), false);
  const originalCiphertext = h.bootstrap.authorization_code_ciphertext;
  await assert.rejects(
    () => h.runtime.acceptCallback({ code: "second-code", state, browserBinding: started.browserBinding }),
    (error) => error instanceof Every8dGhlOAuthError && error.code === "oauth_state_invalid"
  );
  assert.equal(h.calls.accept, 2);
  assert.equal(h.bootstrap.authorization_code_ciphertext, originalCiphertext);
});

test("wrong state, binding, and config drift fail before code acceptance or exchange", async () => {
  for (const overrides of [
    { state: "wrong-state" },
    { browserBinding: "wrong-binding" }
  ]) {
    const h = harness();
    const started = await h.runtime.start();
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    await assert.rejects(
      () => h.runtime.acceptCallback({ code: "secret-code", state, browserBinding: started.browserBinding, ...overrides }),
      (error) => error.code === "oauth_state_invalid"
    );
    assert.equal(h.calls.accept, 0);
    assert.equal(h.calls.exchange, 0);
  }
  const drift = harness({ rejectInspect: true });
  await assert.rejects(() => drift.startAndCallback(), (error) => error.code === "oauth_state_invalid");
  assert.equal(drift.calls.accept, 1);
});

test("ready exchange has one claimant, validates exact ownership, and atomically finalizes encrypted credentials", async () => {
  const h = harness();
  await h.startAndCallback();
  await Promise.all([h.runtime.reconcileOnce(), h.runtime.reconcileOnce()]);
  assert.equal(h.calls.exchange, 1);
  assert.equal(h.calls.finalize, 1);
  assert.equal(h.bootstrap.status, "succeeded");
  assert.equal(h.bootstrap.authorization_code_ciphertext, null);
  assert.equal(h.persisted.accessTokenCiphertext.includes("synthetic-access-secret"), false);
  const i = installation();
  const decrypted = decryptEvery8dGhlOAuthToken({
    ciphertext: h.persisted.accessTokenCiphertext,
    expectedKeyVersion: "test-v1",
    keys: config().encryptionKeys,
    context: {
      installationId: i.id, installationGeneration: i.installation_generation,
      marketplaceAppId: i.marketplace_app_id, oauthClientId: i.oauth_client_id,
      tenantId: i.tenant_id, locationId: i.location_id, companyId: i.company_id,
      purpose: "access_token"
    }
  });
  assert.equal(decrypted, "synthetic-access-secret");
});

for (const [name, tokenOverride] of [
  ["Location mode", { userType: "Company" }],
  ["location ownership", { locationId: "foreign-location" }],
  ["company ownership", { companyId: "foreign-company" }],
  ["app identity", { appId: "foreign-app" }],
  ["scope set", { scope: "locations.write" }],
  ["bulk authority", { isBulkInstallation: true }],
  ["future authority", { installToFutureLocations: true }],
  ["all-location authority", { approveAllLocations: true }]
]) {
  test(`token response rejects mismatched ${name}`, async () => {
    const h = harness({ token: token(tokenOverride) });
    await h.startAndCallback();
    await h.runtime.reconcileOnce();
    assert.equal(h.failureClass, "token_response_rejected");
    assert.equal(h.calls.finalize, 0);
    assert.equal(h.bootstrap.authorization_code_ciphertext, null);
  });
}

for (const failureClass of ["invalid_grant", "token_response_rejected", "exchange_outcome_unknown"]) {
  test(`${failureClass} is terminal, scrubs the code, and is never automatically replayed`, async () => {
    const h = harness({ exchangeError: new Every8dGhlTokenExchangeError(failureClass) });
    await h.startAndCallback();
    await h.runtime.reconcileOnce();
    await h.runtime.reconcileOnce();
    assert.equal(h.failureClass, failureClass);
    assert.equal(h.calls.exchange, 1);
    assert.equal(h.bootstrap.authorization_code_ciphertext, null);
  });
}

test("failed atomic finalization leaves no usable credentials and marks the attempt failed", async () => {
  const h = harness({ finalizeFalse: true });
  await h.startAndCallback();
  await h.runtime.reconcileOnce();
  assert.equal(h.failureClass, "credential_persistence_failed");
  assert.equal(h.persisted, null);
});

test("OAuth errors and persistence inputs do not expose raw code, state, binding, or tokens", async () => {
  const h = harness({ exchangeError: new Error("provider-body-sensitive") });
  const { started, state } = await h.startAndCallback();
  await h.runtime.reconcileOnce();
  const serialized = JSON.stringify({ calls: h.calls, failureClass: h.failureClass, bootstrap: h.bootstrap });
  for (const secret of ["synthetic-authorization-code", state, started.browserBinding, "provider-body-sensitive", "synthetic-access-secret"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("installed shared-secret flow remains installation-bound and requires current signed version evidence", async () => {
  const h = harness();
  const started = await h.runtime.initiate({
    installationId: installation().id,
    tenantId: installation().tenant_id,
    locationId: installation().location_id
  });
  const result = await h.runtime.completeCallback({
    code: "installed-authorization-code",
    state: new URL(started.authorizationUrl).searchParams.get("state"),
    browserBinding: started.browserBinding
  });
  assert.deepEqual(result, { status: "connected", ready: false });
  assert.equal(h.calls.exchange, 1);
  assert.equal(h.persisted.marketplaceVersionId, "version-test-98");
  const wrongVersion = harness({ installation: { latest_lifecycle_version_id: "foreign-version" } });
  await assert.rejects(
    () => wrongVersion.runtime.initiate({
      installationId: installation().id,
      tenantId: installation().tenant_id,
      locationId: installation().location_id
    }),
    (error) => error.code === "installation_not_eligible"
  );
  assert.equal(wrongVersion.calls.exchange, 0);
});

test("EVERY8D OAuth source remains isolated from LINE, SMS dispatch, and EVERY8D transport modules", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/services/every8dGhlOAuthService.ts"), "utf8");
  for (const forbidden of ["lineClient", "line_channels", "ghlSms", "smsOutbound", "every8dClient", "every8dSmsProvider"]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
