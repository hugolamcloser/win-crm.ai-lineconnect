const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const express = require("express");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { jsonBodyParser } = require("../dist/middleware/jsonBody");
const { errorHandler } = require("../dist/middleware/errors");
const {
  createGhlSmsProviderWebhookRouter,
} = require("../dist/routes/ghlSmsProviderWebhook");
const { env } = require("../dist/config/env");
const {
  createGhlSmsProviderOutboundService,
} = require("../dist/services/ghlSmsProviderOutboundService");
const {
  createEvery8dPhase2cMockTransport,
} = require("../dist/integrations/every8dPhase2cMockTransport");
const {
  EVERY8D_MOCK_TRANSPORT_KIND,
  EVERY8D_PHASE_2B_CONTROLLED_LIVE_TRANSPORT_KIND,
} = require("../dist/integrations/every8dSmsProvider");
const {
  Every8dTransportError,
} = require("../dist/integrations/every8dClient");
const {
  SmsOutboundService,
} = require("../dist/services/smsOutboundService");

function providerPayload(overrides = {}) {
  return {
    contactId: "contact-phase-2c-approved",
    locationId: "location-phase-2c-approved",
    messageId: "message-phase-2c-approved",
    type: "SMS",
    phone: "0912345678",
    message: "Phase 2C mock-only SMS fixture",
    ...overrides,
  };
}

function approvedTenant(overrides = {}) {
  return {
    id: "tenant-phase-2c-approved",
    location_id: "location-phase-2c-approved",
    ghl_provider_id: "provider-line-existing",
    line_channel_id: "line-channel-existing",
    created_at: "2026-08-19T00:00:00.000Z",
    updated_at: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

function mockedResult() {
  return {
    httpStatus: 200,
    body: {
      ok: true,
      status: "mocked",
      provider: "every8d",
      providerAttempts: 1,
      retryAttempted: false,
      error: "",
    },
  };
}

function captureLogger() {
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

const phase2cEnvKeys = [
  "GHL_SMS_PHASE_2C_ENABLED",
  "GHL_SMS_PHASE_2C_CONFIRMATION",
  "GHL_SMS_PHASE_2C_ALLOWED_LOCATION_ID",
  "GHL_SMS_PHASE_2C_ALLOWED_TENANT_ID",
  "GHL_SMS_PHASE_2C_ALLOWED_CONTACT_ID",
  "GHL_SMS_PHASE_2C_ALLOWED_PHONE",
  "GHL_SMS_PHASE_2C_ALLOWED_MESSAGE",
];

function setApprovedPhase2cEnv(overrides = {}) {
  const original = Object.fromEntries(
    phase2cEnvKeys.map((key) => [key, env[key]]),
  );
  Object.assign(env, {
    GHL_SMS_PHASE_2C_ENABLED: true,
    GHL_SMS_PHASE_2C_CONFIRMATION: "ENABLE_APPROVED_PHASE_2C_MOCK_ONLY",
    GHL_SMS_PHASE_2C_ALLOWED_LOCATION_ID: "location-phase-2c-approved",
    GHL_SMS_PHASE_2C_ALLOWED_TENANT_ID: "tenant-phase-2c-approved",
    GHL_SMS_PHASE_2C_ALLOWED_CONTACT_ID: "contact-phase-2c-approved",
    GHL_SMS_PHASE_2C_ALLOWED_PHONE: "0912345678",
    GHL_SMS_PHASE_2C_ALLOWED_MESSAGE: "Phase 2C mock-only SMS fixture",
    ...overrides,
  });
  return () => Object.assign(env, original);
}

async function withProviderServer(dependencies, run) {
  const app = express();
  app.use(jsonBodyParser);
  app.use(createGhlSmsProviderWebhookRouter(dependencies));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    return await run(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function requestProvider(server, { headers = {}, rawBody } = {}) {
  const body = rawBody ?? JSON.stringify(providerPayload());
  const address = server.address();

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: address.port,
        path: "/webhooks/ghl/sms/outbound",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode,
            body: responseBody ? JSON.parse(responseBody) : null,
          });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

test("SMS Delivery URL verifies exact raw bytes and rejects missing or invalid X-GHL-Signature before processing", async () => {
  const verified = [];
  let handlerCalls = 0;

  await withProviderServer(
    {
      verifySignature(input) {
        verified.push({
          rawBody: input.rawBody.toString("utf8"),
          ghlSignature: input.ghlSignature,
          legacySignature: input.legacySignature,
        });
        return input.ghlSignature === "valid-signature";
      },
      async handler() {
        handlerCalls += 1;
        return mockedResult();
      },
    },
    async (server) => {
      const exactRawBody =
        '{ "contactId":"contact-phase-2c-approved", "locationId":"location-phase-2c-approved", "messageId":"message-phase-2c-approved", "type":"SMS", "phone":"0912345678", "message":"Phase 2C mock-only SMS fixture" }';
      const missing = await requestProvider(server, { rawBody: exactRawBody });
      const invalid = await requestProvider(server, {
        headers: { "x-ghl-signature": "invalid-signature" },
        rawBody: exactRawBody,
      });
      const valid = await requestProvider(server, {
        headers: { "x-ghl-signature": "valid-signature" },
        rawBody: exactRawBody,
      });

      assert.equal(missing.status, 401);
      assert.equal(invalid.status, 401);
      assert.equal(valid.status, 200);
      assert.equal(handlerCalls, 1);
      assert.equal(verified.length, 3);
      assert.equal(verified[2].rawBody, exactRawBody);
      assert.equal(verified[2].ghlSignature, "valid-signature");
      assert.equal(verified[2].legacySignature, undefined);
    },
  );
});

test("SMS Delivery URL accepts only the documented Phase 2C SMS payload", async () => {
  const handled = [];

  await withProviderServer(
    {
      verifySignature: () => true,
      async handler(payload) {
        handled.push(payload);
        return mockedResult();
      },
    },
    async (server) => {
      const headers = { "x-ghl-signature": "valid-signature" };
      const accepted = await requestProvider(server, {
        headers,
        rawBody: JSON.stringify(
          providerPayload({ userId: "user-optional", attachments: [] }),
        ),
      });
      assert.equal(accepted.status, 200);

      const invalidPayloads = [
        providerPayload({ type: "Custom" }),
        providerPayload({ attachments: ["https://example.test/mms.png"] }),
        providerPayload({ tenantId: "caller-tenant" }),
        providerPayload({ provider: "every8d" }),
        providerPayload({ credentials: { uid: "caller" } }),
        providerPayload({ config: { enabled: true } }),
        providerPayload({ providerConfiguration: { enabled: true } }),
        providerPayload({ transport: "live" }),
        providerPayload({ transportSelection: "controlled-live" }),
        providerPayload({ retry: { attempts: 3 } }),
        providerPayload({ retrySettings: { attempts: 3 } }),
        providerPayload({ siteUrl: "https://provider.invalid" }),
        providerPayload({ uid: "caller-uid" }),
        providerPayload({ password: "caller-password" }),
        providerPayload({ bearerToken: "caller-token" }),
        providerPayload({ unexpectedSmsControl: true }),
      ];

      for (const payload of invalidPayloads) {
        const response = await requestProvider(server, {
          headers,
          rawBody: JSON.stringify(payload),
        });
        assert.equal(response.status, 400, JSON.stringify(payload));
        assert.equal(response.body.error, "validation_error");
      }

      for (const requiredField of [
        "contactId",
        "locationId",
        "messageId",
        "type",
        "phone",
        "message",
      ]) {
        const payload = providerPayload();
        delete payload[requiredField];
        const response = await requestProvider(server, {
          headers,
          rawBody: JSON.stringify(payload),
        });
        assert.equal(response.status, 400, requiredField);
        assert.equal(response.body.error, "validation_error", requiredField);
      }

      assert.equal(handled.length, 1);
      assert.deepEqual(handled[0], {
        ...providerPayload(),
        userId: "user-optional",
        attachments: [],
      });
    },
  );
});

test("SMS Delivery URL requires rawBody and cannot be authenticated by legacy or Workflow Action headers", async () => {
  let verifierCalls = 0;
  let handlerCalls = 0;
  const dependencies = {
    verifySignature(input) {
      verifierCalls += 1;
      assert.equal(input.legacySignature, undefined);
      return input.ghlSignature === "valid-signature";
    },
    async handler() {
      handlerCalls += 1;
      return mockedResult();
    },
  };

  const noRawBodyApp = express();
  noRawBodyApp.use(express.json());
  noRawBodyApp.use(createGhlSmsProviderWebhookRouter(dependencies));
  noRawBodyApp.use(errorHandler);
  const noRawBodyServer = noRawBodyApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => noRawBodyServer.once("listening", resolve));

  try {
    const response = await requestProvider(noRawBodyServer, {
      headers: { "x-ghl-signature": "valid-signature" },
    });
    assert.equal(response.status, 400);
    assert.equal(verifierCalls, 0);
  } finally {
    await new Promise((resolve) => noRawBodyServer.close(resolve));
  }

  await withProviderServer(dependencies, async (server) => {
    const legacyOnly = await requestProvider(server, {
      headers: { "x-wh-signature": "legacy-signature" },
    });
    const workflowSecretOnly = await requestProvider(server, {
      headers: { "x-wincrm-webhook-secret": "workflow-secret" },
    });

    assert.equal(legacyOnly.status, 401);
    assert.equal(workflowSecretOnly.status, 401);
  });

  assert.equal(verifierCalls, 2);
  assert.equal(handlerCalls, 0);
});

test("Phase 2C SMS provider service is disabled by default with zero downstream activity", async () => {
  const originalEnabled = env.GHL_SMS_PHASE_2C_ENABLED;
  env.GHL_SMS_PHASE_2C_ENABLED = false;
  const capture = captureLogger();
  const calls = { tenantIds: 0, tenant: 0, mockTransport: 0 };
  const service = createGhlSmsProviderOutboundService({
    logger: capture.logger,
    async getTenantIdsByLocationId() {
      calls.tenantIds += 1;
      throw new Error("tenant lookup must not run");
    },
    async getTenantById() {
      calls.tenant += 1;
      throw new Error("tenant lookup must not run");
    },
    createMockTransport() {
      calls.mockTransport += 1;
      throw new Error("mock transport must not be constructed");
    },
  });

  try {
    const result = await service(providerPayload());

    assert.deepEqual(result, {
      httpStatus: 503,
      body: {
        ok: false,
        status: "failed",
        provider: "every8d",
        providerAttempts: 0,
        retryAttempted: false,
        error: "phase_2c_disabled",
      },
    });
    assert.deepEqual(calls, {
      tenantIds: 0,
      tenant: 0,
      mockTransport: 0,
    });
    assert.deepEqual(capture.entries, []);
  } finally {
    env.GHL_SMS_PHASE_2C_ENABLED = originalEnabled;
  }
});

test("Phase 2C requires exact server configuration and signed fixture allowlists before tenant resolution", async () => {
  const restoreEnv = setApprovedPhase2cEnv();
  const capture = captureLogger();
  let tenantLookups = 0;
  const service = createGhlSmsProviderOutboundService({
    logger: capture.logger,
    async getTenantIdsByLocationId() {
      tenantLookups += 1;
      throw new Error("tenant lookup must not run");
    },
    async getTenantById() {
      throw new Error("tenant row lookup must not run");
    },
    createMockTransport() {
      throw new Error("mock transport must not be constructed");
    },
  });

  try {
    for (const payload of [
      providerPayload({ locationId: "location-not-approved" }),
      providerPayload({ contactId: "contact-not-approved" }),
      providerPayload({ phone: "0987654321" }),
      providerPayload({ message: "Message not approved" }),
    ]) {
      const result = await service(payload);
      assert.equal(result.httpStatus, 403);
      assert.equal(result.body.error, "request_not_approved");
      assert.equal(result.body.providerAttempts, 0);
    }

    for (const [key, invalidValue] of [
      ["GHL_SMS_PHASE_2C_CONFIRMATION", "wrong-confirmation"],
      ["GHL_SMS_PHASE_2C_ALLOWED_LOCATION_ID", ""],
      ["GHL_SMS_PHASE_2C_ALLOWED_TENANT_ID", ""],
      ["GHL_SMS_PHASE_2C_ALLOWED_CONTACT_ID", ""],
      ["GHL_SMS_PHASE_2C_ALLOWED_PHONE", ""],
      ["GHL_SMS_PHASE_2C_ALLOWED_MESSAGE", ""],
    ]) {
      const originalValue = env[key];
      env[key] = invalidValue;
      const invalidConfiguration = await service(providerPayload());
      env[key] = originalValue;
      assert.equal(invalidConfiguration.httpStatus, 503, key);
      assert.equal(
        invalidConfiguration.body.error,
        "phase_2c_configuration_invalid",
        key,
      );
    }
    assert.equal(tenantLookups, 0);
  } finally {
    restoreEnv();
  }
});

test("Phase 2C derives exactly one tenant from signed locationId and rejects every ambiguous binding", async () => {
  const restoreEnv = setApprovedPhase2cEnv();
  const capture = captureLogger();
  let mockTransports = 0;

  try {
    for (const scenario of [
      {
        tenantIds: [],
        tenant: approvedTenant(),
        status: 404,
        error: "location_not_onboarded",
      },
      {
        tenantIds: ["tenant-phase-2c-approved", "tenant-other"],
        tenant: approvedTenant(),
        status: 409,
        error: "ambiguous_tenant",
      },
      {
        tenantIds: [
          "tenant-phase-2c-approved",
          "tenant-phase-2c-approved",
        ],
        tenant: approvedTenant(),
        status: 409,
        error: "ambiguous_tenant",
      },
      {
        tenantIds: ["tenant-phase-2c-approved"],
        tenant: null,
        status: 409,
        error: "tenant_binding_invalid",
      },
      {
        tenantIds: ["tenant-phase-2c-approved"],
        tenant: approvedTenant({ location_id: "location-other" }),
        status: 409,
        error: "tenant_binding_invalid",
      },
      {
        tenantIds: ["tenant-other"],
        tenant: approvedTenant({ id: "tenant-other" }),
        status: 409,
        error: "tenant_binding_invalid",
      },
    ]) {
      let tenantRowLookups = 0;
      const service = createGhlSmsProviderOutboundService({
        logger: capture.logger,
        async getTenantIdsByLocationId(locationId) {
          assert.equal(locationId, "location-phase-2c-approved");
          return scenario.tenantIds;
        },
        async getTenantById() {
          tenantRowLookups += 1;
          return scenario.tenant;
        },
        createMockTransport() {
          mockTransports += 1;
          throw new Error("mock transport must not be constructed");
        },
      });

      const result = await service(providerPayload());
      assert.equal(result.httpStatus, scenario.status);
      assert.equal(result.body.error, scenario.error);
      assert.equal(result.body.providerAttempts, 0);
      assert.equal(
        tenantRowLookups,
        scenario.tenantIds.length === 1 ? 1 : 0,
      );
    }
    assert.equal(mockTransports, 0);
  } finally {
    restoreEnv();
  }
});

test("approved Phase 2C request invokes the mock EVERY8D provider exactly once without fetch", async () => {
  const restoreEnv = setApprovedPhase2cEnv();
  const capture = captureLogger();
  const transport = createEvery8dPhase2cMockTransport();
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  let mockTransportCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("global.fetch must remain unreachable");
  };

  const service = createGhlSmsProviderOutboundService({
    logger: capture.logger,
    async getTenantIdsByLocationId(locationId) {
      assert.equal(locationId, "location-phase-2c-approved");
      return ["tenant-phase-2c-approved"];
    },
    async getTenantById(tenantId) {
      assert.equal(tenantId, "tenant-phase-2c-approved");
      return approvedTenant();
    },
    createMockTransport() {
      mockTransportCalls += 1;
      return transport;
    },
  });

  try {
    const result = await service(providerPayload());

    assert.deepEqual(result, mockedResult());
    assert.equal(mockTransportCalls, 1);
    assert.equal(fetchCalls, 0);
    assert.equal(transport.requests.length, 2);
    assert.equal(
      transport.requests.filter((request) =>
        request.url.endsWith("/ConnectionHandler.ashx"),
      ).length,
      1,
    );
    assert.equal(
      transport.requests.filter((request) =>
        request.url.endsWith("/SendSMS.ashx"),
      ).length,
      1,
    );
  } finally {
    global.fetch = originalFetch;
    restoreEnv();
  }
});

test("approved Phase 2C request invokes SmsOutboundService exactly once", async () => {
  const restoreEnv = setApprovedPhase2cEnv();
  const originalSend = SmsOutboundService.prototype.send;
  let outboundCalls = 0;
  SmsOutboundService.prototype.send = async function (request) {
    outboundCalls += 1;
    assert.deepEqual(request, {
      tenantId: "tenant-phase-2c-approved",
      locationId: "location-phase-2c-approved",
      provider: "every8d",
      destination: "0912345678",
      message: "Phase 2C mock-only SMS fixture",
      reference: "issue-83-phase-2c-mock",
    });
    return {
      ok: true,
      tenantId: request.tenantId,
      locationId: request.locationId,
      provider: "every8d",
      providerAttempts: 1,
      providerResult: {},
      correlation: {},
    };
  };

  const service = createGhlSmsProviderOutboundService({
    logger: captureLogger().logger,
    async getTenantIdsByLocationId() {
      return ["tenant-phase-2c-approved"];
    },
    async getTenantById() {
      return approvedTenant();
    },
    createMockTransport() {
      return createEvery8dPhase2cMockTransport();
    },
  });

  try {
    assert.deepEqual(await service(providerPayload()), mockedResult());
    assert.equal(outboundCalls, 1);
  } finally {
    SmsOutboundService.prototype.send = originalSend;
    restoreEnv();
  }
});

test("Phase 2C provider failures make one SendSMS attempt and never retry", async () => {
  const restoreEnv = setApprovedPhase2cEnv();
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("global.fetch must remain unreachable");
  };

  try {
    for (const scenario of [
      {
        expected: "provider_rejected",
        send: { status: 200, body: "-99,fixture rejection" },
      },
      {
        expected: "timeout",
        send: new Every8dTransportError("timeout"),
      },
      {
        expected: "network_failure",
        send: new Every8dTransportError("network_failure"),
      },
      {
        expected: "malformed_provider_response",
        send: { status: 200, body: "unexpected,three,fields" },
      },
    ]) {
      const requests = [];
      const queue = [
        {
          status: 200,
          body: JSON.stringify({ Result: true, Msg: "mock-token" }),
        },
        scenario.send,
      ];
      const transport = {
        kind: EVERY8D_MOCK_TRANSPORT_KIND,
        async request(request) {
          requests.push(request);
          const response = queue.shift();
          if (response instanceof Error) throw response;
          if (!response) throw new Error("unexpected provider attempt");
          return response;
        },
      };
      const capture = captureLogger();
      const service = createGhlSmsProviderOutboundService({
        logger: capture.logger,
        async getTenantIdsByLocationId() {
          return ["tenant-phase-2c-approved"];
        },
        async getTenantById() {
          return approvedTenant();
        },
        createMockTransport() {
          return transport;
        },
      });

      const result = await service(providerPayload());
      assert.equal(result.httpStatus, 502, scenario.expected);
      assert.equal(result.body.error, scenario.expected);
      assert.equal(result.body.providerAttempts, 1);
      assert.equal(result.body.retryAttempted, false);
      assert.equal(
        requests.filter((request) =>
          request.url.endsWith("/ConnectionHandler.ashx"),
        ).length,
        1,
      );
      assert.equal(
        requests.filter((request) =>
          request.url.endsWith("/SendSMS.ashx"),
        ).length,
        1,
      );
      assert.equal(queue.length, 0);
    }
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
    restoreEnv();
  }
});

test("Phase 2C rejects the Phase 2B controlled-live transport before any provider request", async () => {
  const restoreEnv = setApprovedPhase2cEnv();
  let transportRequests = 0;
  const service = createGhlSmsProviderOutboundService({
    logger: captureLogger().logger,
    async getTenantIdsByLocationId() {
      return ["tenant-phase-2c-approved"];
    },
    async getTenantById() {
      return approvedTenant();
    },
    createMockTransport() {
      return {
        kind: EVERY8D_PHASE_2B_CONTROLLED_LIVE_TRANSPORT_KIND,
        async request() {
          transportRequests += 1;
          throw new Error("controlled-live transport must be unreachable");
        },
      };
    },
  });

  try {
    const result = await service(providerPayload());
    assert.equal(result.httpStatus, 503);
    assert.equal(result.body.error, "mock_provider_unavailable");
    assert.equal(result.body.providerAttempts, 0);
    assert.equal(transportRequests, 0);
  } finally {
    restoreEnv();
  }
});

test("Phase 2C logs and results omit full signed identifiers, message content, phone, and mock secrets", async () => {
  const sensitive = {
    tenant: "tenant-redaction-unique",
    location: "location-redaction-unique",
    contact: "contact-redaction-unique",
    messageId: "message-redaction-unique",
    phone: "0998765432",
    message: "Unique Phase 2C redaction fixture content",
    token: "unique-phase-2c-mock-token",
  };
  const restoreEnv = setApprovedPhase2cEnv({
    GHL_SMS_PHASE_2C_ALLOWED_TENANT_ID: sensitive.tenant,
    GHL_SMS_PHASE_2C_ALLOWED_LOCATION_ID: sensitive.location,
    GHL_SMS_PHASE_2C_ALLOWED_CONTACT_ID: sensitive.contact,
    GHL_SMS_PHASE_2C_ALLOWED_PHONE: sensitive.phone,
    GHL_SMS_PHASE_2C_ALLOWED_MESSAGE: sensitive.message,
  });
  const capture = captureLogger();
  const transport = {
    kind: EVERY8D_MOCK_TRANSPORT_KIND,
    async request(request) {
      if (request.url.endsWith("/ConnectionHandler.ashx")) {
        return {
          status: 200,
          body: JSON.stringify({ Result: true, Msg: sensitive.token }),
        };
      }
      return { status: 200, body: "98,1,1,0,mock-batch" };
    },
  };
  const service = createGhlSmsProviderOutboundService({
    logger: capture.logger,
    async getTenantIdsByLocationId() {
      return [sensitive.tenant];
    },
    async getTenantById() {
      return approvedTenant({
        id: sensitive.tenant,
        location_id: sensitive.location,
      });
    },
    createMockTransport() {
      return transport;
    },
  });

  try {
    const result = await service(
      providerPayload({
        tenantId: undefined,
        locationId: sensitive.location,
        contactId: sensitive.contact,
        messageId: sensitive.messageId,
        phone: sensitive.phone,
        message: sensitive.message,
      }),
    );
    const serialized = JSON.stringify({ logs: capture.entries, result });

    assert.equal(result.httpStatus, 200);
    for (const value of Object.values(sensitive)) {
      assert.doesNotMatch(serialized, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  } finally {
    restoreEnv();
  }
});

test("SMS provider implementation has no LINE, OAuth, fallback, status API, live transport, or fetch path", () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "routes", "ghlSmsProviderWebhook.ts"),
    "utf8",
  );
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
  const implementation = `${routeSource}\n${serviceSource}`;

  for (const forbidden of [
    "processGhlOutboundWebhook",
    "ghlSyncService",
    "sendLine",
    "getGhlOAuthToken",
    "refreshGhlOAuthToken",
    "GHL_PRIVATE_INTEGRATION_TOKEN",
    "conversationProviderId",
    "GHL_LOCATION_ID",
    "getTenantByLocationId",
    "ensureDefaultTenant",
    "createEvery8dPhase2bControlledLiveTransport",
    "Every8dPhase2bControlledLiveSmsProviderFactory",
    "createEvery8dFetchTransport",
    "globalThis.fetch",
    "updateWorkflowProviderMessageStatus",
  ]) {
    assert.doesNotMatch(implementation, new RegExp(forbidden), forbidden);
  }
  assert.doesNotMatch(routeSource, /x-wincrm-webhook-secret/i);
  assert.doesNotMatch(routeSource, /x-wh-signature/i);
  assert.match(serviceSource, /getTenantIdsByLocationId/);
  assert.match(serviceSource, /createEvery8dPhase2cMockTransport/);
  assert.match(serviceSource, /Every8dSmsProviderFactory/);
});

test("application startup registers the SMS provider route and cannot send SMS", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("application startup must not call fetch");
  };

  const { createApp } = require("../dist/app");
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    assert.equal(fetchCalls, 0);
    const response = await requestProvider(server);
    assert.equal(response.status, 401);
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});
