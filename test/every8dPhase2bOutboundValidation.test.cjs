const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const {
  EVERY8D_PHASE_2B_APPROVED_MESSAGE,
  EVERY8D_PHASE_2B_SEND_CONFIRMATION,
  Every8dPhase2bSafetyError,
  readEvery8dPhase2bConfig,
} = require("../dist/config/every8dPhase2b");
const {
  EVERY8D_PHASE_2B_CONTROLLED_LIVE_TRANSPORT_KIND,
  EVERY8D_MOCK_TRANSPORT_KIND,
  Every8dPhase2bControlledLiveSmsProviderFactory,
} = require("../dist/integrations/every8dSmsProvider");
const {
  Every8dTransportError,
} = require("../dist/integrations/every8dClient");
const {
  runEvery8dPhase2bOutboundValidation,
} = require("../dist/scripts/every8dPhase2bOutboundValidation");

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

function createControlledTransport(items) {
  const queue = [...items];
  const requests = [];

  return {
    requests,
    transport: {
      kind: EVERY8D_PHASE_2B_CONTROLLED_LIVE_TRANSPORT_KIND,
      async request(request) {
        requests.push(request);
        const next = queue.shift();

        if (next instanceof Error) {
          throw next;
        }

        if (!next) {
          throw new Error("Unexpected Phase 2B mock transport request");
        }

        return next;
      },
    },
  };
}

function successfulResponses(overrides = {}) {
  return [
    {
      status: 200,
      body: JSON.stringify({
        Result: true,
        Msg: overrides.token ?? "phase-2b-fixture-token-sensitive",
      }),
    },
    {
      status: 200,
      body: overrides.sendBody ?? "98,1,1,0,phase-2b-batch-fixture",
    },
  ];
}

function approvedConfig(overrides = {}) {
  return {
    siteUrl: "https://provider.example.test",
    uid: "phase-2b-fixture-uid-sensitive",
    password: "phase-2b-fixture-password-sensitive",
    timeoutMs: 1000,
    phase2bEnabled: true,
    sendEnabled: true,
    sendConfirmation: EVERY8D_PHASE_2B_SEND_CONFIRMATION,
    approvedTenantId: "tenant-approved",
    approvedLocationId: "location-approved",
    requestedTenantId: "tenant-approved",
    requestedLocationId: "location-approved",
    provider: "every8d",
    approvedRecipient: "0912345678",
    requestedRecipient: "0912345678",
    message: EVERY8D_PHASE_2B_APPROVED_MESSAGE,
    legacySpikeSendEnabled: false,
    interactiveSendEnabled: false,
    ...overrides,
  };
}

async function expectGateFailure(overrides, expectedCode) {
  const capture = createCaptureLogger();
  const { transport, requests } = createControlledTransport([]);

  await assert.rejects(
    () =>
      runEvery8dPhase2bOutboundValidation({
        config: approvedConfig(overrides),
        transport,
        logger: capture.logger,
      }),
    (error) =>
      error instanceof Every8dPhase2bSafetyError &&
      error.code === expectedCode,
  );
  assert.equal(requests.length, 0);
}

function sendRequestCount(requests) {
  return requests.filter((request) => /\/SendSMS\.ashx$/.test(request.url))
    .length;
}

test("Phase 2B is disabled by default and performs no provider operation", async () => {
  const config = readEvery8dPhase2bConfig({});
  const capture = createCaptureLogger();
  const { transport, requests } = createControlledTransport([]);

  await assert.rejects(
    () =>
      runEvery8dPhase2bOutboundValidation({
        config,
        transport,
        logger: capture.logger,
      }),
    (error) =>
      error instanceof Every8dPhase2bSafetyError &&
      error.code === "phase_2b_disabled",
  );
  assert.equal(requests.length, 0);
});

test("Phase 2B send gate is independently disabled", async () => {
  await expectGateFailure({ sendEnabled: false }, "send_disabled");
});

test("Phase 2B requires the exact approval confirmation", async () => {
  await expectGateFailure(
    { sendConfirmation: "SEND_ONE_PHASE_2B_SMS" },
    "send_confirmation_invalid",
  );
});

test("Phase 2B rejects wrong tenant before configuration or transport use", async () => {
  await expectGateFailure(
    { requestedTenantId: "tenant-other" },
    "tenant_not_approved",
  );
});

test("Phase 2B rejects wrong location before configuration or transport use", async () => {
  await expectGateFailure(
    { requestedLocationId: "location-other" },
    "location_not_approved",
  );
});

test("Phase 2B accepts only the EVERY8D provider", async () => {
  await expectGateFailure({ provider: "another-provider" }, "provider_invalid");
});

test("Phase 2B rejects a different otherwise-valid Taiwan recipient", async () => {
  await expectGateFailure(
    { requestedRecipient: "0987654321" },
    "recipient_not_approved",
  );
});

test("Phase 2B restricts both recipients to 09xxxxxxxx", async () => {
  for (const invalid of [
    "+886912345678",
    "886912345678",
    "0912 345 678",
    " 0912345678",
    "0912345678 ",
    "0812345678",
    "091234567",
    "09123456789",
    "09abcdefgh",
  ]) {
    await expectGateFailure(
      { approvedRecipient: invalid, requestedRecipient: invalid },
      "recipient_invalid",
    );
  }
});

test("Phase 2B rejects comma, semicolon, CR, LF, and multi-recipient inputs", async () => {
  for (const invalid of [
    "0912345678,0987654321",
    "0912345678;0987654321",
    "0912345678\r0987654321",
    "0912345678\n0987654321",
  ]) {
    await expectGateFailure(
      { approvedRecipient: invalid, requestedRecipient: invalid },
      "recipient_invalid",
    );
  }
});

test("Phase 2B rejects any message other than the reviewed exact content", async () => {
  for (const message of [
    "WinCRM EVERY8D Phase 2B 測試簡訊，收到請忽略",
    `${EVERY8D_PHASE_2B_APPROVED_MESSAGE} https://example.test`,
    "Marketing fixture",
    "",
  ]) {
    await expectGateFailure({ message }, "message_not_approved");
  }
});

test("Phase 2B refuses activation alongside an older controlled send path", async () => {
  await expectGateFailure(
    { legacySpikeSendEnabled: true },
    "conflicting_send_path_enabled",
  );
  await expectGateFailure(
    { interactiveSendEnabled: true },
    "conflicting_send_path_enabled",
  );
});

test("Phase 2B controlled-live factory rejects the Phase 2A mock marker", () => {
  const capture = createCaptureLogger();

  assert.throws(
    () =>
      new Every8dPhase2bControlledLiveSmsProviderFactory({
        transport: {
          kind: EVERY8D_MOCK_TRANSPORT_KIND,
          async request() {
            throw new Error("wrong transport must not execute");
          },
        },
        logger: capture.logger,
      }),
    /requires the controlled-live transport/,
  );
});

test("Phase 2B requires complete runtime-only provider configuration", async () => {
  for (const override of [
    { siteUrl: "" },
    { siteUrl: "http://provider.example.test" },
    { siteUrl: "https://user:password@provider.example.test" },
    { uid: "" },
    { password: "" },
  ]) {
    await expectGateFailure(override, "provider_configuration_invalid");
  }
});

test("Phase 2B exact approved identity reaches Phase 2A resolver and sends once", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createControlledTransport(
    successfulResponses(),
  );

  const result = await runEvery8dPhase2bOutboundValidation({
    config: approvedConfig(),
    transport,
    logger: capture.logger,
  });

  assert.equal(result.ok, true);
  assert.equal(result.tenantId, "tenant-approved");
  assert.equal(result.locationId, "location-approved");
  assert.equal(result.provider, "every8d");
  assert.equal(result.providerAttempts, 1);
  assert.deepEqual(result.correlation, {
    batchId: "phase-2b-batch-fixture",
    bid: "phase-2b-batch-fixture",
    bidSource: "batch_id",
    mr: undefined,
  });
  assert.equal(requests.length, 2);
  assert.equal(
    requests.filter((request) =>
      /\/ConnectionHandler\.ashx$/.test(request.url),
    ).length,
    1,
  );
  assert.equal(sendRequestCount(requests), 1);
});

test("Phase 2B uses general SendSMS with one DEST and no interactive or query operation", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createControlledTransport(
    successfulResponses(),
  );

  await runEvery8dPhase2bOutboundValidation({
    config: approvedConfig(),
    transport,
    logger: capture.logger,
  });

  const sendRequest = requests.find((request) =>
    /\/SendSMS\.ashx$/.test(request.url),
  );
  const parameters = new URLSearchParams(sendRequest.body);

  assert.deepEqual([...parameters.keys()].sort(), ["DEST", "MSG"]);
  assert.equal(parameters.get("DEST"), "0912345678");
  assert.equal(parameters.get("MSG"), EVERY8D_PHASE_2B_APPROVED_MESSAGE);
  assert.equal(parameters.get("EventID"), null);
  assert.equal(
    requests.some((request) => /GetDeliveryStatus\.ashx$/.test(request.url)),
    false,
  );
  assert.equal(
    requests.some((request) => /GetReplyMessage\.ashx$/.test(request.url)),
    false,
  );
  assert.doesNotMatch(
    requests.map((request) => request.url).join(" "),
    /SafeSay/i,
  );
});

test("Phase 2B provider rejection has one SendSMS attempt and no retry", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createControlledTransport(
    successfulResponses({ sendBody: "-99,fixture rejection" }),
  );

  const result = await runEvery8dPhase2bOutboundValidation({
    config: approvedConfig(),
    transport,
    logger: capture.logger,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "provider_rejected");
  assert.equal(result.failure.retryAttempted, false);
  assert.equal(result.providerAttempts, 1);
  assert.equal(sendRequestCount(requests), 1);
});

test("Phase 2B timeout has one SendSMS attempt and no retry", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createControlledTransport([
    successfulResponses()[0],
    new Every8dTransportError("timeout"),
  ]);

  const result = await runEvery8dPhase2bOutboundValidation({
    config: approvedConfig(),
    transport,
    logger: capture.logger,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "timeout");
  assert.equal(result.failure.retryAttempted, false);
  assert.equal(sendRequestCount(requests), 1);
});

test("Phase 2B network failure has one SendSMS attempt and no retry", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createControlledTransport([
    successfulResponses()[0],
    new Every8dTransportError("network_failure"),
  ]);

  const result = await runEvery8dPhase2bOutboundValidation({
    config: approvedConfig(),
    transport,
    logger: capture.logger,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "network_failure");
  assert.equal(result.failure.retryAttempted, false);
  assert.equal(sendRequestCount(requests), 1);
});

test("Phase 2B malformed response has one SendSMS attempt and no retry", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createControlledTransport(
    successfulResponses({ sendBody: "unexpected,three,fields" }),
  );

  const result = await runEvery8dPhase2bOutboundValidation({
    config: approvedConfig(),
    transport,
    logger: capture.logger,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "malformed_provider_response");
  assert.equal(result.failure.retryAttempted, false);
  assert.equal(sendRequestCount(requests), 1);
});

test("Phase 2B logs, errors, and results omit sensitive runtime values", async () => {
  const capture = createCaptureLogger();
  const sensitiveToken = "phase-2b-unique-token-sensitive";
  const config = approvedConfig();
  const { transport } = createControlledTransport(
    successfulResponses({ token: sensitiveToken }),
  );

  const result = await runEvery8dPhase2bOutboundValidation({
    config,
    transport,
    logger: capture.logger,
  });
  const serialized = JSON.stringify({ entries: capture.entries, result });

  for (const value of [
    config.uid,
    config.password,
    sensitiveToken,
    config.requestedRecipient,
    config.message,
  ]) {
    assert.doesNotMatch(serialized, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("Phase 2B mock validation never uses global fetch", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("global fetch must not be used by Phase 2B mock tests");
  };

  try {
    const capture = createCaptureLogger();
    const { transport } = createControlledTransport(successfulResponses());
    const result = await runEvery8dPhase2bOutboundValidation({
      config: approvedConfig(),
      transport,
      logger: capture.logger,
    });

    assert.equal(result.ok, true);
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("importing the Phase 2B runner has no execution side effect", () => {
  const runnerPath = require.resolve(
    "../dist/scripts/every8dPhase2bOutboundValidation",
  );
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("runner import must not call fetch");
  };

  try {
    delete require.cache[runnerPath];
    const imported = require(runnerPath);
    assert.equal(typeof imported.runEvery8dPhase2bOutboundValidation, "function");
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("production application modules cannot invoke the Phase 2B runner", () => {
  const srcRoot = path.resolve(__dirname, "../src");
  const allowed = new Set([
    path.join(srcRoot, "config", "every8dPhase2b.ts"),
    path.join(srcRoot, "integrations", "every8dSmsProvider.ts"),
    path.join(srcRoot, "scripts", "every8dPhase2bOutboundValidation.ts"),
  ]);
  const queue = [srcRoot];

  while (queue.length > 0) {
    const directory = queue.pop();

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        queue.push(entryPath);
      } else if (entry.name.endsWith(".ts") && !allowed.has(entryPath)) {
        const source = fs.readFileSync(entryPath, "utf8");
        assert.doesNotMatch(source, /every8dPhase2b|Phase2bControlledLive/);
      }
    }
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
  );
  assert.equal(packageJson.scripts.start, "node dist/server.js");
  assert.equal(
    packageJson.scripts.dev,
    "npm run build && node --watch dist/server.js",
  );
  assert.equal(
    packageJson.scripts["every8d:phase-2b-outbound-validation"],
    "npm run build && node dist/scripts/every8dPhase2bOutboundValidation.js",
  );
});
