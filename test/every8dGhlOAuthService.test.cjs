const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  Every8dGhlOAuthError,
  createEvery8dGhlOAuthRuntime
} = require("../dist/services/every8dGhlOAuthService");
const {
  decryptEvery8dGhlOAuthToken,
  parseEvery8dGhlOAuthEncryptionKeys
} = require("../dist/services/every8dGhlTokenEncryption");

const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const accessToken = "synthetic-access-secret";
const refreshToken = "synthetic-refresh-secret";
const keyConfig = JSON.stringify({
  "test-v1": Buffer.alloc(32, 0x51).toString("base64")
});

function config(overrides = {}) {
  return {
    enabled: true,
    marketplaceAppId: "every8d-app-98",
    oauthClientId: "every8d-client-98",
    oauthClientSecret: "synthetic-client-secret",
    redirectUri: "https://oauth.example.invalid/oauth/every8d-connect/callback",
    installationUrl: "https://marketplace.example.invalid/install/every8d-app-98",
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
    conversation_provider_id: "every8d-provider-98",
    channel: "sms",
    provider: "every8d",
    status: "pending",
    installation_generation: 3,
    access_token_ciphertext: null,
    refresh_token_ciphertext: null,
    encryption_key_version: null,
    token_expires_at: null,
    granted_scopes: [],
    created_at: "2026-09-21T11:00:00.000Z",
    updated_at: "2026-09-21T11:00:00.000Z",
    ...overrides
  };
}

function locationToken(overrides = {}) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
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

function createHarness(options = {}) {
  const selectedInstallation = options.installation ?? installation();
  const states = new Map();
  let stateSequence = 0;
  let repositoryReads = 0;
  let stateCreates = 0;
  let stateConsumes = 0;
  let exchangeCalls = 0;
  let persistCalls = 0;
  let persisted = null;

  const repository = {
    async getEligibleInstallation() {
      repositoryReads += 1;
      return selectedInstallation;
    },
    async createOAuthState(input) {
      stateCreates += 1;
      const record = {
        id: `state-${++stateSequence}`,
        installation_id: input.installationId,
        installation_generation: input.installationGeneration,
        state_hash: input.stateHash,
        browser_binding_hash: input.browserBindingHash,
        redirect_uri: input.redirectUri,
        created_at: new Date(NOW).toISOString(),
        expires_at: input.expiresAt,
        consumed_at: null,
        revoked_at: null
      };
      states.set(record.state_hash, record);
      return record;
    },
    async getOAuthStateByHash(stateHash) {
      return states.get(stateHash) ?? null;
    },
    async consumeOAuthState(input) {
      const record = states.get(input.stateHash);
      if (
        !record ||
        record.id !== input.stateId ||
        record.installation_id !== input.installationId ||
        record.installation_generation !== input.installationGeneration ||
        record.browser_binding_hash !== input.browserBindingHash ||
        record.redirect_uri !== input.redirectUri ||
        record.consumed_at ||
        record.revoked_at ||
        new Date(record.expires_at).getTime() <= NOW
      ) {
        return null;
      }
      record.consumed_at = new Date(NOW).toISOString();
      stateConsumes += 1;
      return { ...record };
    },
    async persistCredentials(input) {
      persistCalls += 1;
      persisted = input;
      return options.persistenceResult === undefined ? {
        ...selectedInstallation,
        access_token_ciphertext: input.accessTokenCiphertext,
        refresh_token_ciphertext: input.refreshTokenCiphertext,
        encryption_key_version: input.encryptionKeyVersion,
        token_expires_at: input.expiresAt,
        granted_scopes: input.grantedScopes
      } : options.persistenceResult;
    }
  };

  const runtime = createEvery8dGhlOAuthRuntime({
    config: config(options.config),
    repository,
    exchangeAuthorizationCode: async () => {
      exchangeCalls += 1;
      if (options.exchangeGate) await options.exchangeGate;
      if (options.exchangeError) throw options.exchangeError;
      return options.tokenResponse ?? locationToken();
    },
    now: () => NOW,
    randomBytes: (size) => crypto.randomBytes(size)
  });

  async function initiate() {
    return runtime.initiate({
      installationId: selectedInstallation.id,
      tenantId: "00000000-0000-4000-8000-000000000098",
      locationId: "location-98"
    });
  }

  async function callback(initiation, overrides = {}) {
    return runtime.completeCallback({
      code: "synthetic-authorization-code",
      state: new URL(initiation.authorizationUrl).searchParams.get("state"),
      browserBinding: initiation.browserBinding,
      ...overrides
    });
  }

  return {
    runtime,
    repository,
    states,
    initiate,
    callback,
    get repositoryReads() { return repositoryReads; },
    get stateCreates() { return stateCreates; },
    get stateConsumes() { return stateConsumes; },
    get exchangeCalls() { return exchangeCalls; },
    get persistCalls() { return persistCalls; },
    get persisted() { return persisted; }
  };
}

test("default-off OAuth performs zero repository, network, or persistence activity", async () => {
  const harness = createHarness({ config: { enabled: false } });

  await assert.rejects(
    () => harness.runtime.initiate({
      installationId: installation().id,
      tenantId: installation().tenant_id,
      locationId: installation().location_id
    }),
    (error) => error instanceof Every8dGhlOAuthError && error.code === "oauth_disabled"
  );
  assert.equal(harness.repositoryReads, 0);
  assert.equal(harness.stateCreates, 0);
  assert.equal(harness.exchangeCalls, 0);
  assert.equal(harness.persistCalls, 0);
});

test("initiation stores only state and browser-binding SHA-256 hashes", async () => {
  const harness = createHarness();
  const initiation = await harness.initiate();
  const rawState = new URL(initiation.authorizationUrl).searchParams.get("state");
  const stored = [...harness.states.values()][0];

  assert.equal(stored.state_hash, crypto.createHash("sha256").update(rawState).digest("hex"));
  assert.equal(stored.browser_binding_hash, crypto.createHash("sha256").update(initiation.browserBinding).digest("hex"));
  assert.equal(JSON.stringify(stored).includes(rawState), false);
  assert.equal(JSON.stringify(stored).includes(initiation.browserBinding), false);
  assert.equal(stored.installation_id, installation().id);
  assert.equal(stored.installation_generation, 3);
});

test("exact Location installation consumes once and persists only encrypted credentials", async () => {
  const harness = createHarness();
  const initiation = await harness.initiate();
  const result = await harness.callback(initiation);

  assert.deepEqual(result, { status: "connected" });
  assert.equal(harness.stateConsumes, 1);
  assert.equal(harness.exchangeCalls, 1);
  assert.equal(harness.persistCalls, 1);
  assert.equal(JSON.stringify(harness.persisted).includes(accessToken), false);
  assert.equal(JSON.stringify(harness.persisted).includes(refreshToken), false);
  assert.deepEqual(harness.persisted.grantedScopes, ["locations.readonly"]);
  assert.equal(harness.persisted.encryptionKeyVersion, "test-v1");

  const aadBase = {
    installationId: installation().id,
    installationGeneration: 3,
    marketplaceAppId: "every8d-app-98",
    oauthClientId: "every8d-client-98",
    tenantId: "00000000-0000-4000-8000-000000000098",
    locationId: "location-98"
  };
  assert.equal(decryptEvery8dGhlOAuthToken({
    ciphertext: harness.persisted.accessTokenCiphertext,
    expectedKeyVersion: "test-v1",
    keys: config().encryptionKeys,
    context: { ...aadBase, purpose: "access_token" }
  }), accessToken);
  assert.equal(decryptEvery8dGhlOAuthToken({
    ciphertext: harness.persisted.refreshTokenCiphertext,
    expectedKeyVersion: "test-v1",
    keys: config().encryptionKeys,
    context: { ...aadBase, purpose: "refresh_token" }
  }), refreshToken);
});

for (const [name, changed] of [
  ["wrong installation", { id: "10000000-0000-4000-8000-000000000099" }],
  ["wrong app", { marketplace_app_id: "foreign-app" }],
  ["wrong client", { oauth_client_id: "foreign-client" }],
  ["wrong tenant", { tenant_id: "00000000-0000-4000-8000-000000000099" }],
  ["wrong location", { location_id: "foreign-location" }]
]) {
  test(`${name} installation context fails before state persistence or exchange`, async () => {
    const expectedId = installation().id;
    const harness = createHarness({ installation: installation(changed) });

    await assert.rejects(
      () => harness.runtime.initiate({
        installationId: expectedId,
        tenantId: installation().tenant_id,
        locationId: installation().location_id
      }),
      (error) => error instanceof Every8dGhlOAuthError && error.code === "installation_not_eligible"
    );
    assert.equal(harness.stateCreates, 0);
    assert.equal(harness.exchangeCalls, 0);
  });
}

for (const [name, tokenResponse] of [
  ["Company token", locationToken({ userType: "Company", locationId: undefined })],
  ["bulk install", locationToken({ isBulkInstallation: true })],
  ["future-location install", locationToken({ installToFutureLocations: true })],
  ["approve-all-locations", locationToken({ approveAllLocations: true })],
  ["foreign approved location", locationToken({ approvedLocations: ["foreign-location"] })],
  ["wrong app response", locationToken({ appId: "foreign-app" })],
  ["wrong location response", locationToken({ locationId: "foreign-location" })],
  ["unexpected scope", locationToken({ scope: "locations.readonly contacts.write" })]
]) {
  test(`${name} is rejected after permanent state consumption and before persistence`, async () => {
    const harness = createHarness({ tokenResponse });
    const initiation = await harness.initiate();

    await assert.rejects(
      () => harness.callback(initiation),
      (error) => error instanceof Every8dGhlOAuthError && error.code === "token_response_rejected"
    );
    assert.equal(harness.stateConsumes, 1);
    assert.equal(harness.exchangeCalls, 1);
    assert.equal(harness.persistCalls, 0);
    await assert.rejects(
      () => harness.callback(initiation),
      (error) => error instanceof Every8dGhlOAuthError && error.code === "oauth_state_invalid"
    );
    assert.equal(harness.exchangeCalls, 1);
  });
}

for (const [name, mutate] of [
  ["expired state", (state) => { state.expires_at = new Date(NOW - 1).toISOString(); }],
  ["consumed state", (state) => { state.consumed_at = new Date(NOW - 1).toISOString(); }],
  ["revoked state", (state) => { state.revoked_at = new Date(NOW - 1).toISOString(); }],
  ["stale generation", (state) => { state.installation_generation -= 1; }],
  ["wrong redirect", (state) => { state.redirect_uri = "https://foreign.invalid/callback"; }]
]) {
  test(`${name} fails before token exchange`, async () => {
    const harness = createHarness();
    const initiation = await harness.initiate();
    mutate([...harness.states.values()][0]);

    await assert.rejects(
      () => harness.callback(initiation),
      (error) => error instanceof Every8dGhlOAuthError && error.code === "oauth_state_invalid"
    );
    assert.equal(harness.exchangeCalls, 0);
    assert.equal(harness.persistCalls, 0);
  });
}

test("wrong browser binding fails before state consumption or token exchange", async () => {
  const harness = createHarness();
  const initiation = await harness.initiate();

  await assert.rejects(
    () => harness.callback(initiation, { browserBinding: "foreign-browser-binding" }),
    (error) => error instanceof Every8dGhlOAuthError && error.code === "oauth_state_invalid"
  );
  assert.equal(harness.stateConsumes, 0);
  assert.equal(harness.exchangeCalls, 0);
});

test("two concurrent callbacks produce one state winner and one token exchange", async () => {
  let releaseExchange;
  const exchangeGate = new Promise((resolve) => { releaseExchange = resolve; });
  const harness = createHarness({ exchangeGate });
  const initiation = await harness.initiate();
  const first = harness.callback(initiation);
  const second = harness.callback(initiation);
  releaseExchange();
  const results = await Promise.allSettled([first, second]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(harness.stateConsumes, 1);
  assert.equal(harness.exchangeCalls, 1);
  assert.equal(harness.persistCalls, 1);
});

test("exchange failures expose no authorization code, state, binding, token, or provider body", async () => {
  const harness = createHarness({ exchangeError: new Error("provider leaked synthetic-authorization-code") });
  const initiation = await harness.initiate();
  const rawState = new URL(initiation.authorizationUrl).searchParams.get("state");

  await assert.rejects(() => harness.callback(initiation), (error) => {
    assert.equal(error.code, "token_exchange_failed");
    const serialized = JSON.stringify(error);
    for (const secret of ["synthetic-authorization-code", rawState, initiation.browserBinding, accessToken, refreshToken]) {
      assert.equal(error.message.includes(secret), false);
      assert.equal(serialized.includes(secret), false);
    }
    return true;
  });
  assert.equal(harness.stateConsumes, 1);
  assert.equal(harness.persistCalls, 0);
});

test("EVERY8D OAuth source has no legacy LINE OAuth, tenant creation, SMS, or EVERY8D transport dependency", () => {
  const source = [
    "src/services/every8dGhlOAuthService.ts",
    "src/services/every8dGhlOAuthRepository.ts"
  ].map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");

  for (const forbidden of [
    "upsertGhlOAuthToken",
    "getGhlOAuthToken",
    "ensureTenantForLocation",
    "ghl_oauth_tokens",
    "GHL_CUSTOM_PROVIDER_ID",
    "ghlSmsProviderOutboundService",
    "consumeGhlSmsControlledLiveAuthorization",
    "every8dClient"
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
