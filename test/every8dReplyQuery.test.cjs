const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const {
  Every8dClient,
  Every8dClientError,
  Every8dTransportError
} = require("../dist/integrations/every8dClient");
const {
  EVERY8D_REPLY_QUERY_CONFIRMATION,
  Every8dReplyQuerySafetyError,
  readEvery8dReplyQueryConfig
} = require("../dist/config/every8dReplyQuery");
const { runEvery8dReplyQuery } = require("../dist/scripts/every8dReplyQuery");

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

function enabledQueryConfig(overrides = {}) {
  return {
    ...clientConfig(),
    queryEnabled: true,
    queryConfirmation: EVERY8D_REPLY_QUERY_CONFIRMATION,
    batchId: "batch-fixture-1",
    pageNumber: 1,
    mrContext: "message-reference-1",
    eventIdContext: "event-fixture-1",
    outboundSendEnabled: false,
    ...overrides
  };
}

test("EVERY8D reply query parses documented BID and MO records", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([
    {
      status: 200,
      body: JSON.stringify({
        SMS_COUNT: 1,
        BID: "batch-fixture-1",
        DATA: [
          {
            NAME: "fixture-name-sensitive",
            MOBILE: "0912345678",
            CONTENT: "fixture-reply-sensitive",
            RECEIVED_TIME: "2026-08-18 10:11:12"
          }
        ]
      })
    }
  ]);
  const client = new Every8dClient(clientConfig(), transport, capture.logger);

  const result = await client.getReplyMessages("fixture-bearer-token", "batch-fixture-1", 1);

  assert.equal(result.smsCount, 1);
  assert.equal(result.bid, "batch-fixture-1");
  assert.equal(result.records[0].mobile, "0912345678");
  assert.equal(result.records[0].content, "fixture-reply-sensitive");
  assert.equal(result.records[0].receivedTime, "2026-08-18 10:11:12");
  assert.match(requests[0].url, /GetReplyMessage\.ashx$/);
  assert.equal(requests[0].headers.authorization, "Bearer fixture-bearer-token");
  const requestBody = new URLSearchParams(requests[0].body);
  assert.equal(requestBody.get("BID"), "batch-fixture-1");
  assert.equal(requestBody.get("PNO"), "1");
  assert.equal(requestBody.get("RESPFORMAT"), "1");

  const loggedEvidence = JSON.stringify(capture.entries);
  assert.doesNotMatch(loggedEvidence, /0912345678/);
  assert.doesNotMatch(loggedEvidence, /fixture-reply-sensitive/);
  assert.doesNotMatch(loggedEvidence, /fixture-name-sensitive/);
  assert.doesNotMatch(loggedEvidence, /fixture-bearer-token/);
});

test("EVERY8D reply query accepts the documented zero-result shape", async () => {
  const capture = createCaptureLogger();
  const { transport } = createQueuedTransport([
    { status: 200, body: JSON.stringify({ SMS_COUNT: 0, BID: "batch-fixture-1" }) }
  ]);
  const client = new Every8dClient(clientConfig(), transport, capture.logger);

  const result = await client.getReplyMessages("fixture-bearer-token", "batch-fixture-1");

  assert.equal(result.smsCount, 0);
  assert.deepEqual(result.records, []);
});

test("EVERY8D malformed reply response fails closed", async () => {
  const capture = createCaptureLogger();
  const { transport } = createQueuedTransport([
    { status: 200, body: JSON.stringify({ SMS_COUNT: 1, BID: "batch-fixture-1", DATA: "invalid" }) }
  ]);
  const client = new Every8dClient(clientConfig(), transport, capture.logger);

  await assert.rejects(
    () => client.getReplyMessages("fixture-bearer-token", "batch-fixture-1"),
    (error) =>
      error instanceof Every8dClientError &&
      error.code === "malformed_response" &&
      error.operation === "get_reply_messages"
  );
});

test("EVERY8D reply query maps network failures without retries", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([
    new Every8dTransportError("network_failure")
  ]);
  const client = new Every8dClient(clientConfig(), transport, capture.logger);

  await assert.rejects(
    () => client.getReplyMessages("fixture-bearer-token", "batch-fixture-1"),
    (error) =>
      error instanceof Every8dClientError &&
      error.code === "network_failure" &&
      error.operation === "get_reply_messages"
  );
  assert.equal(requests.length, 1);
});

test("EVERY8D reply runner is disabled by default and performs no request", async () => {
  const config = readEvery8dReplyQueryConfig({});
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () => runEvery8dReplyQuery({ config, transport, logger: capture.logger }),
    (error) => error instanceof Every8dReplyQuerySafetyError && error.code === "query_disabled"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D reply runner requires the exact query confirmation before any request", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () =>
      runEvery8dReplyQuery({
        config: enabledQueryConfig({ queryConfirmation: "" }),
        transport,
        logger: capture.logger
      }),
    (error) =>
      error instanceof Every8dReplyQuerySafetyError &&
      error.code === "query_confirmation_missing"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D reply runner rejects an enabled outbound send gate", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () =>
      runEvery8dReplyQuery({
        config: enabledQueryConfig({ outboundSendEnabled: true }),
        transport,
        logger: capture.logger
      }),
    (error) =>
      error instanceof Every8dReplyQuerySafetyError && error.code === "outbound_send_enabled"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D reply runner rejects a missing batch and non-first pages", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () =>
      runEvery8dReplyQuery({
        config: enabledQueryConfig({ batchId: "" }),
        transport,
        logger: capture.logger
      }),
    (error) => error instanceof Every8dReplyQuerySafetyError && error.code === "batch_id_missing"
  );
  await assert.rejects(
    () =>
      runEvery8dReplyQuery({
        config: enabledQueryConfig({ pageNumber: 2 }),
        transport,
        logger: capture.logger
      }),
    (error) => error instanceof Every8dReplyQuerySafetyError && error.code === "page_not_allowed"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D reply runner rejects missing provider configuration before transport use", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () =>
      runEvery8dReplyQuery({
        config: enabledQueryConfig({ password: "" }),
        transport,
        logger: capture.logger
      }),
    (error) => error instanceof Every8dClientError && error.code === "invalid_configuration"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D reply runner authenticates then makes exactly one query-only request", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([
    { status: 200, body: JSON.stringify({ Result: true, Msg: "fixture-bearer-token" }) },
    {
      status: 200,
      body: JSON.stringify({
        SMS_COUNT: 1,
        BID: "batch-fixture-1",
        DATA: [
          {
            MOBILE: "0912345678",
            CONTENT: "fixture-reply-sensitive",
            RECEIVED_TIME: "2026-08-18 10:11:12"
          }
        ]
      })
    }
  ]);

  const result = await runEvery8dReplyQuery({
    config: enabledQueryConfig(),
    transport,
    logger: capture.logger
  });

  assert.equal(result.smsCount, 1);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /ConnectionHandler\.ashx$/);
  assert.match(requests[1].url, /GetReplyMessage\.ashx$/);
  assert.equal(requests.some((request) => /SendSMS\.ashx$/.test(request.url)), false);
  assert.equal(requests[1].headers.authorization, "Bearer fixture-bearer-token");

  const loggedEvidence = JSON.stringify(capture.entries);
  assert.match(loggedEvidence, /batch-fixture-1/);
  assert.match(loggedEvidence, /message-reference-1/);
  assert.match(loggedEvidence, /event-fixture-1/);
  assert.match(loggedEvidence, /replyRef/);
  assert.match(loggedEvidence, /senderRef/);
  assert.doesNotMatch(loggedEvidence, /0912345678/);
  assert.doesNotMatch(loggedEvidence, /fixture-reply-sensitive/);
  assert.doesNotMatch(loggedEvidence, /fixture-bearer-token/);
  assert.doesNotMatch(loggedEvidence, /fixture-password-do-not-use/);
});
