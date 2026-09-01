const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.GHL_SMS_PHASE_2C_ENABLED = "false";

const {
  EVERY8D_PHASE_2F_CONFIRMATION,
  Every8dPhase2fConfigurationError,
  assertEvery8dPhase2fAuthorizationConfig,
  readEvery8dPhase2fAuthorizationConfig,
  readEvery8dPhase2fProviderConfig,
} = require("../dist/config/every8dPhase2f");
const { hmacSha256Fingerprint } = require("../dist/utils/hmacFingerprint");
const { env } = require("../dist/config/env");
const {
  createGhlSmsProviderOutboundService,
} = require("../dist/services/ghlSmsProviderOutboundService");
const {
  EVERY8D_PHASE_2B_CONTROLLED_LIVE_TRANSPORT_KIND,
  Every8dPhase2fControlledLiveSmsProviderFactory,
} = require("../dist/integrations/every8dSmsProvider");

const phase2fEnvKeys = [
  "GHL_SMS_PHASE_2F_ENABLED",
  "GHL_SMS_PHASE_2F_SEND_ENABLED",
  "GHL_SMS_PHASE_2F_CONFIRMATION",
  "GHL_SMS_PHASE_2F_NETWORK_CONFIRMED",
  "GHL_SMS_PHASE_2F_ALLOWED_TENANT_ID",
  "GHL_SMS_PHASE_2F_ALLOWED_LOCATION_ID",
  "GHL_SMS_PHASE_2F_ALLOWED_CONTACT_ID",
  "GHL_SMS_PHASE_2F_ALLOWED_PHONE",
  "GHL_SMS_PHASE_2F_ALLOWED_MESSAGE",
  "GHL_SMS_PHASE_2F_AUTHORIZATION_ID",
  "GHL_SMS_PHASE_2F_FINGERPRINT_SECRET",
];

function setPhase2fEnv(overrides = {}) {
  const original = Object.fromEntries(
    phase2fEnvKeys.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, validAuthorizationSource(overrides));

  return () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function controlledPayload(overrides = {}) {
  return {
    contactId: "contact-phase-2f-approved",
    locationId: "location-phase-2f-approved",
    messageId: "message-phase-2f-a",
    type: "SMS",
    phone: "0912345678",
    message: "Phase 2F controlled-live synthetic fixture",
    ...overrides,
  };
}

function controlledTenant(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000090",
    location_id: "location-phase-2f-approved",
    ghl_provider_id: "existing-line-provider",
    line_channel_id: "existing-line-channel",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function controlledSuccess() {
  return {
    ok: true,
    tenantId: "00000000-0000-4000-8000-000000000090",
    locationId: "location-phase-2f-approved",
    provider: "every8d",
    reference: "issue-90-phase-2f-controlled-live",
    providerAttempts: 1,
    providerResult: {
      httpStatus: 200,
      providerStatus: "0",
      sentCount: 1,
      unsentCount: 0,
    },
    correlation: {
      batchId: "synthetic-batch",
      bid: "synthetic-batch",
      bidSource: "batch_id",
    },
  };
}

function controlledHarness(overrides = {}) {
  const calls = {
    tenantIds: 0,
    tenant: 0,
    claim: 0,
    consume: 0,
    finalizeBeforeSend: 0,
    finalizeAfterSend: 0,
    factory: 0,
    provider: 0,
    mockPath: 0,
  };
  let operationSequence = 0;
  const dependencies = {
    async getTenantIdsByLocationId() {
      calls.tenantIds += 1;
      return ["00000000-0000-4000-8000-000000000090"];
    },
    async getTenantById() {
      calls.tenant += 1;
      return controlledTenant();
    },
    async claimOperation() {
      calls.mockPath += 1;
      throw new Error("Phase 2C claim must remain unreachable");
    },
    async markSendStarted() {
      calls.mockPath += 1;
      throw new Error("Phase 2C send-start must remain unreachable");
    },
    async finalizeOperation() {
      calls.mockPath += 1;
      throw new Error("Phase 2C finalization must remain unreachable");
    },
    createMockTransport() {
      calls.mockPath += 1;
      throw new Error("Phase 2C transport must remain unreachable");
    },
    async claimControlledLiveOperation() {
      calls.claim += 1;
      operationSequence += 1;
      return {
        claimed: true,
        operationId: `20000000-0000-4000-8000-${String(operationSequence).padStart(12, "0")}`,
      };
    },
    async consumeControlledLiveAuthorization() {
      calls.consume += 1;
      return true;
    },
    async finalizeControlledLiveBeforeSend() {
      calls.finalizeBeforeSend += 1;
      return true;
    },
    async finalizeControlledLiveOperation() {
      calls.finalizeAfterSend += 1;
      return true;
    },
    createControlledLiveOutboundService() {
      calls.factory += 1;
      return {
        async send() {
          calls.provider += 1;
          return controlledSuccess();
        },
      };
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    ...overrides,
  };

  return { calls, dependencies };
}

function validAuthorizationSource(overrides = {}) {
  return {
    GHL_SMS_PHASE_2F_ENABLED: "true",
    GHL_SMS_PHASE_2F_SEND_ENABLED: "true",
    GHL_SMS_PHASE_2F_CONFIRMATION: EVERY8D_PHASE_2F_CONFIRMATION,
    GHL_SMS_PHASE_2F_NETWORK_CONFIRMED: "true",
    GHL_SMS_PHASE_2F_ALLOWED_TENANT_ID:
      "00000000-0000-4000-8000-000000000090",
    GHL_SMS_PHASE_2F_ALLOWED_LOCATION_ID: "location-phase-2f-approved",
    GHL_SMS_PHASE_2F_ALLOWED_CONTACT_ID: "contact-phase-2f-approved",
    GHL_SMS_PHASE_2F_ALLOWED_PHONE: "+886912345678",
    GHL_SMS_PHASE_2F_ALLOWED_MESSAGE:
      "Phase 2F controlled-live synthetic fixture",
    GHL_SMS_PHASE_2F_AUTHORIZATION_ID:
      "10000000-0000-4000-8000-000000000090",
    GHL_SMS_PHASE_2F_FINGERPRINT_SECRET:
      "synthetic-phase-2f-fingerprint-key-32-bytes-minimum",
    ...overrides,
  };
}

test("Phase 2F master and send gates are disabled by default", () => {
  const config = readEvery8dPhase2fAuthorizationConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.sendEnabled, false);
  assert.equal(config.networkConfirmed, false);
});

test("Phase 2F requires the exact confirmation and explicit network confirmation", () => {
  for (const [overrides, expectedCode] of [
    [{ GHL_SMS_PHASE_2F_CONFIRMATION: "wrong" }, "confirmation_invalid"],
    [{ GHL_SMS_PHASE_2F_NETWORK_CONFIRMED: "false" }, "network_unconfirmed"],
  ]) {
    assert.throws(
      () =>
        assertEvery8dPhase2fAuthorizationConfig(
          readEvery8dPhase2fAuthorizationConfig(
            validAuthorizationSource(overrides),
          ),
        ),
      (error) =>
        error instanceof Every8dPhase2fConfigurationError &&
        error.code === expectedCode,
    );
  }
});

test("Phase 2F rejects missing or weak HMAC configuration", () => {
  for (const secret of ["", "synthetic-too-short"] ) {
    assert.throws(
      () =>
        assertEvery8dPhase2fAuthorizationConfig(
          readEvery8dPhase2fAuthorizationConfig(
            validAuthorizationSource({
              GHL_SMS_PHASE_2F_FINGERPRINT_SECRET: secret,
            }),
          ),
        ),
      (error) =>
        error instanceof Every8dPhase2fConfigurationError &&
        error.code === "fingerprint_secret_invalid",
    );
  }
});

test("HMAC fingerprints use deterministic domain-separated lowercase SHA-256 hex", () => {
  assert.equal(
    hmacSha256Fingerprint(
      "key",
      "destination",
      "The quick brown fox jumps over the lazy dog",
    ),
    "68619c09ee15c7909a368634c680ebd8935d5aaab62a7bdaca6ef8df7883a445",
  );
  assert.match(
    hmacSha256Fingerprint(
      "synthetic-key",
      "destination",
      "+886912345678",
    ),
    /^[0-9a-f]{64}$/,
  );
  assert.notEqual(
    hmacSha256Fingerprint(
      "synthetic-key",
      "destination",
      "+886912345678",
    ),
    hmacSha256Fingerprint(
      "synthetic-key",
      "message",
      "+886912345678",
    ),
  );
});

test("Phase 2F provider configuration is runtime-only and rejects incomplete credentials", () => {
  assert.throws(
    () => readEvery8dPhase2fProviderConfig({}),
    (error) =>
      error instanceof Every8dPhase2fConfigurationError &&
      error.code === "provider_configuration_invalid",
  );

  assert.deepEqual(
    readEvery8dPhase2fProviderConfig({
      EVERY8D_PHASE_2F_SITE_URL: "https://provider.example.test",
      EVERY8D_PHASE_2F_UID: "synthetic-bound-uid",
      EVERY8D_PHASE_2F_PASSWORD: "synthetic-bound-password",
      EVERY8D_PHASE_2F_TIMEOUT_MS: "1200",
    }),
    {
      siteUrl: "https://provider.example.test",
      uid: "synthetic-bound-uid",
      password: "synthetic-bound-password",
      timeoutMs: 1200,
    },
  );
});

test("Phase 2F provider factory is exact-tenant controlled-live and ignores caller credentials", async () => {
  const requests = [];
  const responses = [
    {
      status: 200,
      body: JSON.stringify({ Result: true, Msg: "synthetic-token" }),
    },
    { status: 200, body: "98,1,1,0,synthetic-batch" },
  ];
  const factory = new Every8dPhase2fControlledLiveSmsProviderFactory({
    tenantId: "00000000-0000-4000-8000-000000000090",
    locationId: "location-phase-2f-approved",
    credentials: {
      siteUrl: "https://provider.example.test",
      uid: "synthetic-bound-uid",
      password: "synthetic-bound-password",
      timeoutMs: 1000,
    },
    transport: {
      kind: EVERY8D_PHASE_2B_CONTROLLED_LIVE_TRANSPORT_KIND,
      async request(request) {
        requests.push(request);
        return responses.shift();
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  });
  const configuration = {
    configurationId: "phase-2f-controlled-live",
    tenantId: "00000000-0000-4000-8000-000000000090",
    locationId: "location-phase-2f-approved",
    provider: "every8d",
    providerMode: "controlled_live",
    enabled: true,
    credentials: {
      siteUrl: "https://caller-controlled.invalid",
      uid: "caller-controlled-uid",
      password: "caller-controlled-password",
      timeoutMs: 60000,
    },
  };

  for (const override of [
    { tenantId: "00000000-0000-4000-8000-000000000091" },
    { locationId: "wrong-location" },
    { providerMode: "mock" },
    { configurationId: "caller-selected" },
  ]) {
    assert.throws(
      () => factory.create({ ...configuration, ...override }),
      /rejected a non-exact controlled-live binding/,
    );
  }

  const provider = factory.create(configuration);
  await provider.send({
    destination: "0912345678",
    message: "Phase 2F controlled-live synthetic fixture",
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[0].body), {
    HandlerType: 3,
    VerifyType: 1,
    UID: "synthetic-bound-uid",
    PWD: "synthetic-bound-password",
  });
  assert.doesNotMatch(
    JSON.stringify(requests),
    /caller-controlled/,
  );
});

test("Phase 2F exact request allowlists fail closed before an operation claim", async () => {
  const restore = setPhase2fEnv();
  const originalPhase2c = env.GHL_SMS_PHASE_2C_ENABLED;
  env.GHL_SMS_PHASE_2C_ENABLED = false;
  const { calls, dependencies } = controlledHarness();
  const service = createGhlSmsProviderOutboundService(dependencies);

  try {
    for (const payload of [
      controlledPayload({ locationId: "wrong-location" }),
      controlledPayload({ contactId: "wrong-contact" }),
      controlledPayload({ phone: "0987654321" }),
      controlledPayload({ message: "wrong-message" }),
    ]) {
      const result = await service(payload);
      assert.equal(result.httpStatus, 403);
      assert.equal(result.body.providerAttempts, 0);
    }

    assert.equal(calls.tenantIds, 0);
    assert.equal(calls.claim, 0);
    assert.equal(calls.consume, 0);
    assert.equal(calls.factory, 0);
    assert.equal(calls.provider, 0);
  } finally {
    env.GHL_SMS_PHASE_2C_ENABLED = originalPhase2c;
    restore();
  }
});

test("Phase 2F send, confirmation, network, and HMAC gates precede all downstream activity", async () => {
  const originalPhase2c = env.GHL_SMS_PHASE_2C_ENABLED;
  env.GHL_SMS_PHASE_2C_ENABLED = false;

  try {
    for (const override of [
      { GHL_SMS_PHASE_2F_SEND_ENABLED: "false" },
      { GHL_SMS_PHASE_2F_CONFIRMATION: "wrong" },
      { GHL_SMS_PHASE_2F_NETWORK_CONFIRMED: "false" },
      { GHL_SMS_PHASE_2F_FINGERPRINT_SECRET: "weak" },
    ]) {
      const restore = setPhase2fEnv(override);
      const { calls, dependencies } = controlledHarness();

      try {
        const result = await createGhlSmsProviderOutboundService(
          dependencies,
        )(controlledPayload());
        assert.equal(result.httpStatus, 503);
        assert.equal(result.body.providerAttempts, 0);
        assert.equal(calls.tenantIds, 0);
        assert.equal(calls.claim, 0);
        assert.equal(calls.consume, 0);
        assert.equal(calls.factory, 0);
        assert.equal(calls.provider, 0);
      } finally {
        restore();
      }
    }
  } finally {
    env.GHL_SMS_PHASE_2C_ENABLED = originalPhase2c;
  }
});

test("Phase 2F rejects a non-exact tenant binding before durable claim", async () => {
  const restore = setPhase2fEnv();
  const { calls, dependencies } = controlledHarness({
    async getTenantIdsByLocationId() {
      calls.tenantIds += 1;
      return ["00000000-0000-4000-8000-000000000091"];
    },
    async getTenantById() {
      calls.tenant += 1;
      return controlledTenant({
        id: "00000000-0000-4000-8000-000000000091",
      });
    },
  });

  try {
    const result = await createGhlSmsProviderOutboundService(dependencies)(
      controlledPayload(),
    );
    assert.equal(result.httpStatus, 409);
    assert.equal(result.body.error, "tenant_binding_invalid");
    assert.equal(calls.claim, 0);
    assert.equal(calls.factory, 0);
    assert.equal(calls.provider, 0);
  } finally {
    restore();
  }
});

test("duplicate operation and unavailable authorization grant zero controlled-live provider activity", async () => {
  const restore = setPhase2fEnv();

  try {
    const duplicateHarness = controlledHarness({
      async claimControlledLiveOperation() {
        duplicateHarness.calls.claim += 1;
        return { claimed: false };
      },
    });
    const duplicate = await createGhlSmsProviderOutboundService(
      duplicateHarness.dependencies,
    )(controlledPayload());
    assert.equal(duplicate.body.status, "duplicate");
    assert.equal(duplicateHarness.calls.consume, 0);
    assert.equal(duplicateHarness.calls.factory, 0);
    assert.equal(duplicateHarness.calls.provider, 0);

    const unavailableHarness = controlledHarness({
      async consumeControlledLiveAuthorization() {
        unavailableHarness.calls.consume += 1;
        return false;
      },
    });
    const unavailable = await createGhlSmsProviderOutboundService(
      unavailableHarness.dependencies,
    )(controlledPayload({ messageId: "message-phase-2f-b" }));
    assert.equal(unavailable.httpStatus, 409);
    assert.equal(unavailable.body.error, "authorization_unavailable");
    assert.equal(unavailableHarness.calls.finalizeBeforeSend, 1);
    assert.equal(unavailableHarness.calls.factory, 0);
    assert.equal(unavailableHarness.calls.provider, 0);
  } finally {
    restore();
  }
});

test("RPC failure keeps credentials and provider construction unreachable", async () => {
  const restore = setPhase2fEnv();
  const { calls, dependencies } = controlledHarness({
    async consumeControlledLiveAuthorization() {
      calls.consume += 1;
      throw new Error("synthetic RPC failure");
    },
  });

  try {
    const result = await createGhlSmsProviderOutboundService(dependencies)(
      controlledPayload(),
    );
    assert.equal(result.httpStatus, 503);
    assert.equal(result.body.error, "authorization_rpc_failed");
    assert.equal(calls.finalizeBeforeSend, 1);
    assert.equal(calls.factory, 0);
    assert.equal(calls.provider, 0);
  } finally {
    restore();
  }
});

test("one successful authorization permits one provider path and cannot be reused by a second GHL message", async () => {
  const restore = setPhase2fEnv();
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  let available = true;
  const { calls, dependencies } = controlledHarness({
    async consumeControlledLiveAuthorization() {
      calls.consume += 1;
      if (!available) {
        return false;
      }
      available = false;
      return true;
    },
  });
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("global.fetch must remain unreachable in Phase 2F-A tests");
  };

  try {
    const service = createGhlSmsProviderOutboundService(dependencies);
    const winner = await service(controlledPayload());
    const loser = await service(
      controlledPayload({ messageId: "message-phase-2f-b" }),
    );

    assert.equal(winner.httpStatus, 200);
    assert.equal(winner.body.status, "accepted");
    assert.equal(loser.httpStatus, 409);
    assert.equal(loser.body.error, "authorization_unavailable");
    assert.equal(calls.claim, 2);
    assert.equal(calls.consume, 2);
    assert.equal(calls.factory, 1);
    assert.equal(calls.provider, 1);
    assert.equal(calls.finalizeAfterSend, 1);
    assert.equal(calls.finalizeBeforeSend, 1);
    assert.equal(calls.mockPath, 0);
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("post-permission provider outcomes use conservative final states without retries", async () => {
  const restore = setPhase2fEnv();

  try {
    for (const [failureCode, expectedState] of [
      ["provider_rejected", "definitive_failed"],
      ["network_failure", "ambiguous"],
      ["timeout", "ambiguous"],
      ["http_failure", "ambiguous"],
      ["malformed_provider_response", "ambiguous"],
      ["provider_failure", "ambiguous"],
    ]) {
      let finalization;
      const { calls, dependencies } = controlledHarness({
        createControlledLiveOutboundService() {
          calls.factory += 1;
          return {
            async send() {
              calls.provider += 1;
              return {
                ok: false,
                tenantId: "00000000-0000-4000-8000-000000000090",
                locationId: "location-phase-2f-approved",
                provider: "every8d",
                providerAttempts: 1,
                failure: {
                  code: failureCode,
                  stage: "provider",
                  retryable: false,
                  retryAttempted: false,
                },
              };
            },
          };
        },
        async finalizeControlledLiveOperation(input) {
          calls.finalizeAfterSend += 1;
          finalization = input;
          return true;
        },
      });

      const result = await createGhlSmsProviderOutboundService(dependencies)(
        controlledPayload({ messageId: `message-${failureCode}` }),
      );
      assert.equal(result.body.providerAttempts, 1, failureCode);
      assert.equal(finalization.state, expectedState, failureCode);
      assert.equal(finalization.failureCode, failureCode, failureCode);
      assert.equal(calls.provider, 1, failureCode);
    }
  } finally {
    restore();
  }
});

test("Phase 2F outbound implementation contains no LINE, SafeSay, reply/query, or HighLevel status-update path", () => {
  const serviceSource = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "src",
      "services",
      "ghlSmsProviderOutboundService.ts",
    ),
    "utf8",
  );

  for (const forbidden of [
    /sendLine/,
    /SafeSay/i,
    /GetReplyMessage/,
    /GetDeliveryStatus/,
    /updateWorkflowProviderMessageStatus/,
  ]) {
    assert.doesNotMatch(serviceSource, forbidden);
  }
});
