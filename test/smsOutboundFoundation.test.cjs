const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const {
  Every8dTransportError,
  createEvery8dFetchTransport,
} = require("../dist/integrations/every8dClient");
const {
  EVERY8D_MOCK_TRANSPORT_KIND,
  Every8dSmsProviderFactory,
} = require("../dist/integrations/every8dSmsProvider");
const {
  SmsProviderConfigService,
  SmsProviderConfigurationError,
} = require("../dist/services/smsProviderConfigService");
const { SmsOutboundService } = require("../dist/services/smsOutboundService");

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function every8dConfig(overrides = {}) {
  return {
    configurationId: "sms-config-tenant-a",
    tenantId: "tenant-a",
    locationId: "location-a",
    provider: "every8d",
    enabled: true,
    credentials: {
      siteUrl: "https://provider.example.test",
      uid: "fixture-uid-sensitive",
      password: "fixture-password-sensitive",
      timeoutMs: 1000,
    },
    ...overrides,
  };
}

function outboundRequest(overrides = {}) {
  return {
    tenantId: "tenant-a",
    locationId: "location-a",
    provider: "every8d",
    destination: "+886912345678",
    message: "mock-only outbound content",
    reference: "internal-reference-a",
    ...overrides,
  };
}

function createCaptureLogger() {
  const entries = [];
  const write = (level) => (metadata, message) =>
    entries.push({ level, metadata, message });

  return {
    entries,
    logger: {
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
    },
  };
}

function createMockOnlyTransport(items) {
  const queue = [...items];
  const requests = [];

  return {
    requests,
    transport: {
      kind: EVERY8D_MOCK_TRANSPORT_KIND,
      async request(request) {
        requests.push(request);
        const next = queue.shift();

        if (next instanceof Error) {
          throw next;
        }

        if (!next) {
          throw new Error("Unexpected mock transport request");
        }

        return next;
      },
    },
  };
}

function successfulProviderResponses(overrides = {}) {
  return [
    {
      status: 200,
      body: JSON.stringify({
        Result: true,
        Msg: overrides.token ?? "fixture-bearer-sensitive",
      }),
    },
    { status: 200, body: overrides.sendBody ?? "98,1,1,0,batch-fixture-a" },
  ];
}

function createFoundationHarness({
  configs = [every8dConfig()],
  enabled = true,
  responses = successfulProviderResponses(),
} = {}) {
  const capture = createCaptureLogger();
  const { requests, transport } = createMockOnlyTransport(responses);
  const factory = new Every8dSmsProviderFactory({
    transport,
    logger: capture.logger,
  });
  let createCount = 0;
  const countingFactory = {
    create(configuration) {
      createCount += 1;
      return factory.create(configuration);
    },
  };
  const service = new SmsOutboundService({
    enabled,
    configService: new SmsProviderConfigService(configs),
    providerFactories: { every8d: countingFactory },
    logger: capture.logger,
  });

  return {
    service,
    requests,
    capture,
    getCreateCount: () => createCount,
  };
}

async function expectConfigError(configs, selector, expectedCode) {
  const resolver = new SmsProviderConfigService(configs);

  assert.throws(
    () => resolver.resolve(selector),
    (error) =>
      error instanceof SmsProviderConfigurationError &&
      error.code === expectedCode,
  );
}

test("configuration resolver returns only the exact tenant, location, and provider match", () => {
  const tenantA = every8dConfig();
  const tenantB = every8dConfig({
    configurationId: "sms-config-tenant-b",
    tenantId: "tenant-b",
    locationId: "location-b",
    credentials: {
      siteUrl: "https://provider-b.example.test",
      uid: "fixture-uid-b",
      password: "fixture-password-b",
      timeoutMs: 2000,
    },
  });
  const resolver = new SmsProviderConfigService([tenantA, tenantB]);

  const resolved = resolver.resolve({
    tenantId: "tenant-b",
    locationId: "location-b",
    provider: "every8d",
  });

  assert.equal(resolved.configurationId, "sms-config-tenant-b");
  assert.equal(resolved.tenantId, "tenant-b");
  assert.equal(resolved.locationId, "location-b");
  assert.equal(resolved.credentials.uid, "fixture-uid-b");
});

test("configuration resolver rejects missing tenant and missing location identities", async () => {
  await expectConfigError(
    [every8dConfig()],
    { tenantId: "", locationId: "location-a", provider: "every8d" },
    "missing_tenant_id",
  );
  await expectConfigError(
    [every8dConfig()],
    { tenantId: "tenant-a", locationId: "", provider: "every8d" },
    "missing_location_id",
  );
});

test("configuration resolver rejects zero matches without fallback", async () => {
  await expectConfigError(
    [],
    {
      tenantId: "tenant-missing",
      locationId: "location-missing",
      provider: "every8d",
    },
    "configuration_not_found",
  );
});

test("configuration resolver rejects tenant and location mismatches", async () => {
  await expectConfigError(
    [every8dConfig()],
    { tenantId: "tenant-other", locationId: "location-a", provider: "every8d" },
    "tenant_mismatch",
  );
  await expectConfigError(
    [every8dConfig()],
    { tenantId: "tenant-a", locationId: "location-other", provider: "every8d" },
    "location_mismatch",
  );
});

test("configuration resolver rejects duplicate exact and cross-match ambiguity", async () => {
  await expectConfigError(
    [every8dConfig(), every8dConfig({ configurationId: "duplicate" })],
    { tenantId: "tenant-a", locationId: "location-a", provider: "every8d" },
    "ambiguous_configuration",
  );
  await expectConfigError(
    [
      every8dConfig({ locationId: "location-x" }),
      every8dConfig({ configurationId: "cross", tenantId: "tenant-x" }),
    ],
    { tenantId: "tenant-a", locationId: "location-a", provider: "every8d" },
    "ambiguous_configuration",
  );
});

test("configuration resolver rejects a disabled exact configuration", async () => {
  await expectConfigError(
    [every8dConfig({ enabled: false })],
    { tenantId: "tenant-a", locationId: "location-a", provider: "every8d" },
    "configuration_disabled",
  );
});

test("outbound service is default-off and does not resolve or construct a provider", async () => {
  let resolveCount = 0;
  let createCount = 0;
  const service = new SmsOutboundService({
    configService: {
      resolve() {
        resolveCount += 1;
        return every8dConfig();
      },
    },
    providerFactories: {
      every8d: {
        create() {
          createCount += 1;
          throw new Error("provider must not be constructed");
        },
      },
    },
    logger: createCaptureLogger().logger,
  });

  const result = await service.send(outboundRequest());

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "service_disabled");
  assert.equal(result.failure.stage, "gate");
  assert.equal(result.providerAttempts, 0);
  assert.equal(resolveCount, 0);
  assert.equal(createCount, 0);
});

test("outbound service requires an explicit supported provider", async () => {
  const missingProvider = createFoundationHarness();
  const missingResult = await missingProvider.service.send(
    outboundRequest({ provider: "" }),
  );
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.failure.code, "missing_provider");
  assert.equal(missingProvider.getCreateCount(), 0);
  assert.equal(missingProvider.requests.length, 0);

  const unsupportedProvider = createFoundationHarness();
  const unsupportedResult = await unsupportedProvider.service.send(
    outboundRequest({ provider: "another-provider" }),
  );
  assert.equal(unsupportedResult.ok, false);
  assert.equal(unsupportedResult.failure.code, "unsupported_provider");
  assert.equal(unsupportedProvider.getCreateCount(), 0);
  assert.equal(unsupportedProvider.requests.length, 0);
});

test("outbound service rejects malformed phone and message requests before provider creation", async () => {
  const malformedPhone = createFoundationHarness();
  const phoneResult = await malformedPhone.service.send(
    outboundRequest({ destination: "+886 912 345 678" }),
  );
  assert.equal(phoneResult.ok, false);
  assert.equal(phoneResult.failure.code, "invalid_destination");
  assert.equal(malformedPhone.getCreateCount(), 0);
  assert.equal(malformedPhone.requests.length, 0);

  const malformedMessage = createFoundationHarness();
  const messageResult = await malformedMessage.service.send(
    outboundRequest({ message: "   " }),
  );
  assert.equal(messageResult.ok, false);
  assert.equal(messageResult.failure.code, "invalid_message");
  assert.equal(malformedMessage.getCreateCount(), 0);
  assert.equal(malformedMessage.requests.length, 0);
});

test("valid outbound request authenticates and performs exactly one mocked SendSMS operation", async () => {
  const harness = createFoundationHarness();

  const result = await harness.service.send(outboundRequest());

  assert.equal(result.ok, true);
  assert.equal(result.tenantId, "tenant-a");
  assert.equal(result.locationId, "location-a");
  assert.equal(result.provider, "every8d");
  assert.equal(result.reference, "internal-reference-a");
  assert.equal(result.providerAttempts, 1);
  assert.deepEqual(result.providerResult, {
    httpStatus: 200,
    sentCount: 1,
    unsentCount: 0,
    cost: "1",
  });
  assert.deepEqual(result.correlation, {
    batchId: "batch-fixture-a",
    bid: "batch-fixture-a",
    bidSource: "batch_id",
    mr: undefined,
  });
  assert.equal(harness.getCreateCount(), 1);
  assert.equal(harness.requests.length, 2);
  assert.match(harness.requests[0].url, /ConnectionHandler\.ashx$/);
  assert.match(harness.requests[1].url, /SendSMS\.ashx$/);
  assert.equal(
    harness.requests.filter((request) => /SendSMS\.ashx$/.test(request.url))
      .length,
    1,
  );
});

test("provider-neutral service preserves MR only when a provider actually returns it", async () => {
  let sendCount = 0;
  const service = new SmsOutboundService({
    enabled: true,
    configService: new SmsProviderConfigService([every8dConfig()]),
    providerFactories: {
      every8d: {
        create() {
          return {
            async send() {
              sendCount += 1;
              return {
                provider: "every8d",
                result: { httpStatus: 200, sentCount: 1 },
                correlation: {
                  batchId: "batch-with-mr",
                  bid: "batch-with-mr",
                  bidSource: "provider",
                  mr: ["mr-returned-by-provider"],
                },
              };
            },
          };
        },
      },
    },
    logger: createCaptureLogger().logger,
  });

  const result = await service.send(outboundRequest());

  assert.equal(result.ok, true);
  assert.deepEqual(result.correlation.mr, ["mr-returned-by-provider"]);
  assert.equal(sendCount, 1);
});

test("EVERY8D authentication rejection is normalized without constructing a send request", async () => {
  const harness = createFoundationHarness({
    responses: [
      {
        status: 200,
        body: JSON.stringify({
          Result: false,
          Status: -2,
          Msg: "fixture rejection",
        }),
      },
    ],
  });

  const result = await harness.service.send(outboundRequest());

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "provider_rejected");
  assert.equal(result.failure.providerOperation, "authenticate");
  assert.equal(result.failure.providerStatus, "-2");
  assert.equal(result.failure.retryAttempted, false);
  assert.equal(harness.requests.length, 1);
});

test("EVERY8D SendSMS provider rejection is normalized and never retried", async () => {
  const harness = createFoundationHarness({
    responses: successfulProviderResponses({
      sendBody: "-99,fixture provider rejection",
    }),
  });

  const result = await harness.service.send(outboundRequest());

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "provider_rejected");
  assert.equal(result.failure.providerOperation, "send_sms");
  assert.equal(result.failure.providerStatus, "-99");
  assert.equal(result.failure.retryable, false);
  assert.equal(result.failure.retryAttempted, false);
  assert.equal(result.providerAttempts, 1);
  assert.equal(harness.requests.length, 2);
  assert.equal(
    harness.requests.filter((request) => /SendSMS\.ashx$/.test(request.url))
      .length,
    1,
  );
});

test("EVERY8D HTTP failure is normalized without retry", async () => {
  const harness = createFoundationHarness({
    responses: [
      successfulProviderResponses()[0],
      { status: 503, body: "service unavailable fixture" },
    ],
  });

  const result = await harness.service.send(outboundRequest());

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "http_failure");
  assert.equal(result.failure.httpStatus, 503);
  assert.equal(result.failure.retryAttempted, false);
  assert.equal(harness.requests.length, 2);
});

test("EVERY8D timeout is normalized and SendSMS is never retried", async () => {
  const harness = createFoundationHarness({
    responses: [
      successfulProviderResponses()[0],
      new Every8dTransportError("timeout"),
    ],
  });

  const result = await harness.service.send(outboundRequest());

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "timeout");
  assert.equal(result.failure.providerOperation, "send_sms");
  assert.equal(result.failure.retryAttempted, false);
  assert.equal(result.providerAttempts, 1);
  assert.equal(harness.requests.length, 2);
  assert.equal(
    harness.requests.filter((request) => /SendSMS\.ashx$/.test(request.url))
      .length,
    1,
  );
});

test("EVERY8D ambiguous network failure is normalized and never retried", async () => {
  const harness = createFoundationHarness({
    responses: [
      successfulProviderResponses()[0],
      new Every8dTransportError("network_failure"),
    ],
  });

  const result = await harness.service.send(outboundRequest());

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "network_failure");
  assert.equal(result.failure.providerOperation, "send_sms");
  assert.equal(result.failure.retryable, false);
  assert.equal(result.failure.retryAttempted, false);
  assert.equal(result.providerAttempts, 1);
  assert.equal(harness.requests.length, 2);
  assert.equal(
    harness.requests.filter((request) => /SendSMS\.ashx$/.test(request.url))
      .length,
    1,
  );
});

test("malformed EVERY8D response is normalized without retry", async () => {
  const harness = createFoundationHarness({
    responses: successfulProviderResponses({
      sendBody: "unexpected,three,fields",
    }),
  });

  const result = await harness.service.send(outboundRequest());

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "malformed_provider_response");
  assert.equal(result.failure.providerOperation, "send_sms");
  assert.equal(result.failure.retryAttempted, false);
  assert.equal(harness.requests.length, 2);
});

test("credentials, token, destination, and message are absent from logs and results", async () => {
  const sensitiveToken = "fixture-bearer-unique-sensitive";
  const harness = createFoundationHarness({
    responses: successfulProviderResponses({ token: sensitiveToken }),
  });
  const request = outboundRequest({
    destination: "+886987654321",
    message: "unique message content that must stay private",
  });

  const result = await harness.service.send(request);
  const serialized = JSON.stringify({
    entries: harness.capture.entries,
    result,
  });

  assert.equal(result.ok, true);
  assert.doesNotMatch(serialized, /fixture-uid-sensitive/);
  assert.doesNotMatch(serialized, /fixture-password-sensitive/);
  assert.doesNotMatch(serialized, /fixture-bearer-unique-sensitive/);
  assert.doesNotMatch(serialized, /\+886987654321/);
  assert.doesNotMatch(
    serialized,
    /unique message content that must stay private/,
  );
});

test("tenant mismatch cannot fall back to another tenant configuration", async () => {
  const harness = createFoundationHarness({
    configs: [
      every8dConfig(),
      every8dConfig({
        configurationId: "tenant-b-config",
        tenantId: "tenant-b",
        locationId: "location-b",
        credentials: {
          siteUrl: "https://provider-b.example.test",
          uid: "tenant-b-uid",
          password: "tenant-b-password",
          timeoutMs: 1000,
        },
      }),
    ],
  });

  const result = await harness.service.send(
    outboundRequest({ tenantId: "tenant-missing", locationId: "location-b" }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "tenant_mismatch");
  assert.equal(result.providerAttempts, 0);
  assert.equal(harness.getCreateCount(), 0);
  assert.equal(harness.requests.length, 0);
});

test("Phase 2A EVERY8D factory refuses the existing network transport", () => {
  const capture = createCaptureLogger();
  const networkTransport = createEvery8dFetchTransport(async () => {
    throw new Error("network transport must never execute");
  });

  assert.throws(
    () =>
      new Every8dSmsProviderFactory({
        transport: networkTransport,
        logger: capture.logger,
      }),
    /requires a mock-only transport/,
  );
});

test("mock-only provider path never invokes global fetch", async () => {
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("real network access is prohibited");
  };
  const harness = createFoundationHarness();

  const result = await harness.service.send(outboundRequest());

  assert.equal(result.ok, true);
  assert.equal(fetchCalls, 0);
  assert.equal(harness.requests.length, 2);
});
