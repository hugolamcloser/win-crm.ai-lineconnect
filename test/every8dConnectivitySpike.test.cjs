const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const {
  createEvery8dFetchTransport,
  createSanitizedEvery8dLogger,
  Every8dClient,
  Every8dClientError,
  Every8dTransportError,
  sanitizeEvery8dLogMetadata
} = require("../dist/integrations/every8dClient");
const {
  EVERY8D_SEND_CONFIRMATION,
  Every8dSpikeSafetyError,
  readEvery8dSpikeConfig
} = require("../dist/config/every8dSpike");
const { runEvery8dConnectivitySpike } = require("../dist/scripts/every8dConnectivitySpike");

function createCaptureLogger() {
  const entries = [];
  const write = (level) => (metadata, message) => entries.push({ level, metadata, message });

  return {
    entries,
    logger: {
      info: write("info"),
      warn: write("warn"),
      error: write("error")
    }
  };
}

function createQueuedTransport(items) {
  const requests = [];

  return {
    requests,
    transport: {
      async request(request) {
        requests.push(request);
        const next = items.shift();

        if (next instanceof Error) {
          throw next;
        }

        if (!next) {
          throw new Error("Unexpected mock transport request");
        }

        return next;
      }
    }
  };
}

function clientConfig(overrides = {}) {
  return {
    siteUrl: "https://provider.example.test",
    uid: "fixture-uid",
    password: "fixture-password-do-not-use",
    timeoutMs: 1000,
    ...overrides
  };
}

function enabledSpikeConfig(overrides = {}) {
  return {
    ...clientConfig(),
    spikeEnabled: true,
    sendEnabled: true,
    sendConfirmation: EVERY8D_SEND_CONFIRMATION,
    approvedRecipient: "approved-test-recipient",
    requestedRecipient: "approved-test-recipient",
    message: "Issue 77 controlled fixture",
    ...overrides
  };
}

test("EVERY8D authentication success returns the documented token", async () => {
  const { logger } = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([
    { status: 200, body: JSON.stringify({ Result: true, Msg: "fixture-bearer-token" }) }
  ]);
  const client = new Every8dClient(clientConfig(), transport, logger);

  const result = await client.authenticate();

  assert.equal(result.token, "fixture-bearer-token");
  assert.equal(result.httpStatus, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://provider.example.test/API21/HTTP/ConnectionHandler.ashx");
  assert.deepEqual(JSON.parse(requests[0].body), {
    HandlerType: 3,
    VerifyType: 1,
    UID: "fixture-uid",
    PWD: "fixture-password-do-not-use"
  });
});

test("EVERY8D authentication failure exposes only predictable provider status", async () => {
  const capture = createCaptureLogger();
  const { transport } = createQueuedTransport([
    { status: 200, body: JSON.stringify({ Result: false, Status: -2, Msg: "credentials rejected" }) }
  ]);
  const client = new Every8dClient(clientConfig(), transport, capture.logger);

  await assert.rejects(
    () => client.authenticate(),
    (error) =>
      error instanceof Every8dClientError &&
      error.code === "provider_failure" &&
      error.operation === "authenticate" &&
      error.providerStatus === "-2"
  );
  assert.doesNotMatch(JSON.stringify(capture.entries), /credentials rejected/);
});

test("EVERY8D SendSMS success parses counts, cost, and BATCHID", async () => {
  const { logger } = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([
    { status: 200, body: "98.5,1,1.5,0,batch-fixture-1" }
  ]);
  const client = new Every8dClient(clientConfig(), transport, logger);

  const result = await client.sendSms({
    token: "fixture-bearer-token",
    recipient: "approved-test-recipient",
    message: "controlled fixture"
  });

  assert.deepEqual(
    {
      credit: result.credit,
      sentCount: result.sentCount,
      cost: result.cost,
      unsentCount: result.unsentCount,
      batchId: result.batchId
    },
    { credit: "98.5", sentCount: 1, cost: "1.5", unsentCount: 0, batchId: "batch-fixture-1" }
  );
  assert.equal(requests[0].headers.authorization, "Bearer fixture-bearer-token");
  assert.equal(new URLSearchParams(requests[0].body).get("DEST"), "approved-test-recipient");
});

test("EVERY8D SendSMS provider failure is typed and does not expose provider message", async () => {
  const capture = createCaptureLogger();
  const { transport } = createQueuedTransport([{ status: 200, body: "-99,provider fixture failure" }]);
  const client = new Every8dClient(clientConfig(), transport, capture.logger);

  await assert.rejects(
    () =>
      client.sendSms({
        token: "fixture-bearer-token",
        recipient: "approved-test-recipient",
        message: "controlled fixture"
      }),
    (error) =>
      error instanceof Every8dClientError &&
      error.code === "provider_failure" &&
      error.providerStatus === "-99"
  );
  assert.doesNotMatch(JSON.stringify(capture.entries), /provider fixture failure/);
});

test("EVERY8D malformed SendSMS response fails closed", async () => {
  const { logger } = createCaptureLogger();
  const { transport } = createQueuedTransport([{ status: 200, body: "unexpected,response,shape" }]);
  const client = new Every8dClient(clientConfig(), transport, logger);

  await assert.rejects(
    () =>
      client.sendSms({
        token: "fixture-bearer-token",
        recipient: "approved-test-recipient",
        message: "controlled fixture"
      }),
    (error) => error instanceof Every8dClientError && error.code === "malformed_response"
  );
});

test("EVERY8D delivery-status query parses BID, MR, and delivery state", async () => {
  const { logger } = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([
    {
      status: 200,
      body: JSON.stringify({
        SMS_COUNT: 1,
        BID: "batch-fixture-1",
        DATA: [
          {
            MR: "message-reference-1",
            MOBILE: "approved-test-recipient",
            STATUS: 100,
            COST: "1",
            REAL_COST: "1"
          }
        ]
      })
    }
  ]);
  const client = new Every8dClient(clientConfig(), transport, logger);

  const result = await client.getDeliveryStatus("fixture-bearer-token", "batch-fixture-1");

  assert.equal(result.smsCount, 1);
  assert.equal(result.bid, "batch-fixture-1");
  assert.equal(result.records[0].mr, "message-reference-1");
  assert.equal(result.records[0].status, "100");
  assert.equal(new URLSearchParams(requests[0].body).get("RESPFORMAT"), "1");
});

test("EVERY8D documented zero-result delivery shape is accepted", async () => {
  const { logger } = createCaptureLogger();
  const { transport } = createQueuedTransport([
    { status: 200, body: JSON.stringify({ SMS_COUNT: 0, BID: "batch-fixture-1" }) }
  ]);
  const client = new Every8dClient(clientConfig(), transport, logger);

  const result = await client.getDeliveryStatus("fixture-bearer-token", "batch-fixture-1");

  assert.equal(result.smsCount, 0);
  assert.deepEqual(result.records, []);
});

test("EVERY8D timeout is mapped without making a real network request", async () => {
  const fakeFetch = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("fixture abort")), { once: true });
    });
  const transport = createEvery8dFetchTransport(fakeFetch);
  const { logger } = createCaptureLogger();
  const client = new Every8dClient(clientConfig({ timeoutMs: 100 }), transport, logger);

  await assert.rejects(
    () => client.authenticate(),
    (error) => error instanceof Every8dClientError && error.code === "timeout"
  );
});

test("EVERY8D network failure is mapped predictably", async () => {
  const { logger } = createCaptureLogger();
  const { transport } = createQueuedTransport([new Every8dTransportError("network_failure")]);
  const client = new Every8dClient(clientConfig(), transport, logger);

  await assert.rejects(
    () => client.authenticate(),
    (error) => error instanceof Every8dClientError && error.code === "network_failure"
  );
});

test("EVERY8D missing configuration fails before transport use", () => {
  const { logger } = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  assert.throws(
    () => new Every8dClient(clientConfig({ uid: "", password: "" }), transport, logger),
    (error) => error instanceof Every8dClientError && error.code === "invalid_configuration"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D structured logging redacts credential, token, recipient, and message fields", () => {
  const capture = createCaptureLogger();
  const logger = createSanitizedEvery8dLogger(capture.logger);
  const metadata = {
    uid: "fixture-uid-sensitive",
    password: "fixture-password-sensitive",
    authorization: "Bearer fixture-token-sensitive",
    recipient: "fixture-recipient-sensitive",
    nested: {
      message: "fixture-message-sensitive",
      safe: 'payload PWD="fixture-inline-sensitive" and Bearer fixture-inline-token'
    }
  };

  logger.info(metadata, "fixture log");
  const output = JSON.stringify(capture.entries);

  for (const value of [
    "fixture-uid-sensitive",
    "fixture-password-sensitive",
    "fixture-token-sensitive",
    "fixture-recipient-sensitive",
    "fixture-message-sensitive",
    "fixture-inline-sensitive",
    "fixture-inline-token"
  ]) {
    assert.doesNotMatch(output, new RegExp(value));
  }
  assert.match(output, /\[redacted\]/);
  assert.deepEqual(sanitizeEvery8dLogMetadata({ token: "fixture" }), { token: "[redacted]" });
});

test("EVERY8D runner is disabled by default and performs no transport request", async () => {
  const config = readEvery8dSpikeConfig({});
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () => runEvery8dConnectivitySpike({ config, transport, logger: capture.logger }),
    (error) => error instanceof Every8dSpikeSafetyError && error.code === "spike_disabled"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D runner can authenticate while real send remains disabled", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([
    { status: 200, body: JSON.stringify({ Result: true, Msg: "fixture-bearer-token" }) }
  ]);

  const result = await runEvery8dConnectivitySpike({
    config: enabledSpikeConfig({ sendEnabled: false, sendConfirmation: "", message: "" }),
    transport,
    logger: capture.logger
  });

  assert.equal(result.outcome, "authenticated_only");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /ConnectionHandler\.ashx$/);
});

test("EVERY8D runner rejects an unapproved recipient before authentication", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () =>
      runEvery8dConnectivitySpike({
        config: enabledSpikeConfig({ requestedRecipient: "different-test-recipient" }),
        transport,
        logger: capture.logger
      }),
    (error) => error instanceof Every8dSpikeSafetyError && error.code === "recipient_not_approved"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D runner executes one mocked send and one mocked delivery query with one token", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([
    { status: 200, body: JSON.stringify({ Result: true, Msg: "fixture-bearer-token" }) },
    { status: 200, body: "98,1,1,0,batch-fixture-1" },
    {
      status: 200,
      body: JSON.stringify({
        SMS_COUNT: 1,
        BID: "batch-fixture-1",
        DATA: [{ MR: "message-reference-1", STATUS: 0 }]
      })
    }
  ]);

  const result = await runEvery8dConnectivitySpike({
    config: enabledSpikeConfig(),
    transport,
    logger: capture.logger
  });

  assert.equal(result.outcome, "sent_and_queried");
  assert.equal(requests.length, 3);
  assert.match(requests[0].url, /ConnectionHandler\.ashx$/);
  assert.match(requests[1].url, /SendSMS\.ashx$/);
  assert.match(requests[2].url, /GetDeliveryStatus\.ashx$/);
  assert.equal(requests[1].headers.authorization, "Bearer fixture-bearer-token");
  assert.equal(requests[2].headers.authorization, "Bearer fixture-bearer-token");
  assert.equal(new URLSearchParams(requests[1].body).getAll("DEST").length, 1);
  const loggedEvidence = JSON.stringify(capture.entries);
  assert.match(loggedEvidence, /batch-fixture-1/);
  assert.match(loggedEvidence, /message-reference-1/);
  assert.doesNotMatch(loggedEvidence, /fixture-bearer-token/);
  assert.doesNotMatch(loggedEvidence, /fixture-password-do-not-use/);
});
