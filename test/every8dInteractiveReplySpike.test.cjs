const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

const { Every8dClient, Every8dClientError } = require("../dist/integrations/every8dClient");
const {
  EVERY8D_DEFAULT_INTERACTIVE_EVENT_ID,
  EVERY8D_INTERACTIVE_CONFIRMATION,
  EVERY8D_MAX_INTERACTIVE_MESSAGE_CHARACTERS,
  Every8dInteractiveSafetyError,
  readEvery8dInteractiveSpikeConfig
} = require("../dist/config/every8dInteractiveSpike");
const {
  runEvery8dInteractiveReplySpike
} = require("../dist/scripts/every8dInteractiveReplySpike");

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

function enabledInteractiveConfig(overrides = {}) {
  return {
    ...clientConfig(),
    interactiveEnabled: true,
    sendEnabled: true,
    sendConfirmation: EVERY8D_INTERACTIVE_CONFIRMATION,
    eventId: EVERY8D_DEFAULT_INTERACTIVE_EVENT_ID,
    approvedRecipient: "approved-test-recipient",
    requestedRecipient: "approved-test-recipient",
    message: "WinCRM EVERY8D 雙向回覆測試，請依簡訊內回覆方式回覆 TEST01。",
    ordinarySendEnabled: false,
    replyQueryEnabled: false,
    ...overrides
  };
}

test("EVERY8D client includes the documented EventID on one general SendSMS request", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([
    { status: 200, body: "98,1,1,0,batch-interactive-1" }
  ]);
  const client = new Every8dClient(clientConfig(), transport, capture.logger);

  const result = await client.sendSms({
    token: "fixture-bearer-token",
    recipient: "approved-test-recipient",
    message: "interactive fixture content",
    eventId: "-1"
  });

  assert.equal(result.batchId, "batch-interactive-1");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /SendSMS\.ashx$/);
  const body = new URLSearchParams(requests[0].body);
  assert.equal(body.get("DEST"), "approved-test-recipient");
  assert.equal(body.getAll("DEST").length, 1);
  assert.equal(body.get("MSG"), "interactive fixture content");
  assert.equal(body.get("EventID"), "-1");

  const loggedEvidence = JSON.stringify(capture.entries);
  assert.match(loggedEvidence, /interactiveReplyRequested/);
  assert.match(loggedEvidence, /-1/);
  assert.doesNotMatch(loggedEvidence, /approved-test-recipient/);
  assert.doesNotMatch(loggedEvidence, /interactive fixture content/);
  assert.doesNotMatch(loggedEvidence, /fixture-bearer-token/);
});

test("EVERY8D interactive runner is disabled by default and performs no request", async () => {
  const config = readEvery8dInteractiveSpikeConfig({});
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () => runEvery8dInteractiveReplySpike({ config, transport, logger: capture.logger }),
    (error) =>
      error instanceof Every8dInteractiveSafetyError && error.code === "interactive_disabled"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D interactive runner requires its exact send confirmation", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () =>
      runEvery8dInteractiveReplySpike({
        config: enabledInteractiveConfig({ sendConfirmation: "" }),
        transport,
        logger: capture.logger
      }),
    (error) =>
      error instanceof Every8dInteractiveSafetyError &&
      error.code === "send_confirmation_missing"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D interactive runner permits only the documented default EventID -1", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () =>
      runEvery8dInteractiveReplySpike({
        config: enabledInteractiveConfig({ eventId: "another-activity" }),
        transport,
        logger: capture.logger
      }),
    (error) =>
      error instanceof Every8dInteractiveSafetyError && error.code === "event_id_not_allowed"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D interactive runner refuses overlapping ordinary-send and reply-query gates", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () =>
      runEvery8dInteractiveReplySpike({
        config: enabledInteractiveConfig({ ordinarySendEnabled: true }),
        transport,
        logger: capture.logger
      }),
    (error) =>
      error instanceof Every8dInteractiveSafetyError && error.code === "ordinary_send_enabled"
  );
  await assert.rejects(
    () =>
      runEvery8dInteractiveReplySpike({
        config: enabledInteractiveConfig({ replyQueryEnabled: true }),
        transport,
        logger: capture.logger
      }),
    (error) =>
      error instanceof Every8dInteractiveSafetyError && error.code === "reply_query_enabled"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D interactive runner rejects bulk and unapproved recipients", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () =>
      runEvery8dInteractiveReplySpike({
        config: enabledInteractiveConfig({ requestedRecipient: "one,two" }),
        transport,
        logger: capture.logger
      }),
    (error) =>
      error instanceof Every8dInteractiveSafetyError && error.code === "bulk_recipient_rejected"
  );
  await assert.rejects(
    () =>
      runEvery8dInteractiveReplySpike({
        config: enabledInteractiveConfig({ requestedRecipient: "different-test-recipient" }),
        transport,
        logger: capture.logger
      }),
    (error) =>
      error instanceof Every8dInteractiveSafetyError && error.code === "recipient_not_approved"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D interactive runner enforces the pre-link message cap", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([]);

  await assert.rejects(
    () =>
      runEvery8dInteractiveReplySpike({
        config: enabledInteractiveConfig({
          message: "x".repeat(EVERY8D_MAX_INTERACTIVE_MESSAGE_CHARACTERS + 1)
        }),
        transport,
        logger: capture.logger
      }),
    (error) =>
      error instanceof Every8dInteractiveSafetyError && error.code === "message_too_long"
  );
  assert.equal(requests.length, 0);
});

test("EVERY8D interactive runner performs one send and one delivery query, never a reply query", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([
    { status: 200, body: JSON.stringify({ Result: true, Msg: "fixture-bearer-token" }) },
    { status: 200, body: "98,1,1,0,batch-interactive-1" },
    {
      status: 200,
      body: JSON.stringify({
        SMS_COUNT: 1,
        BID: "batch-interactive-1",
        DATA: [{ MR: "interactive-message-reference-1", STATUS: 0 }]
      })
    }
  ]);

  const result = await runEvery8dInteractiveReplySpike({
    config: enabledInteractiveConfig(),
    transport,
    logger: capture.logger
  });

  assert.equal(result.outcome, "interactive_sent_and_delivery_queried");
  assert.equal(result.eventId, "-1");
  assert.equal(requests.length, 3);
  assert.match(requests[0].url, /ConnectionHandler\.ashx$/);
  assert.match(requests[1].url, /SendSMS\.ashx$/);
  assert.match(requests[2].url, /GetDeliveryStatus\.ashx$/);
  assert.equal(requests.some((request) => /GetReplyMessage\.ashx$/.test(request.url)), false);
  const sendBody = new URLSearchParams(requests[1].body);
  assert.equal(sendBody.getAll("DEST").length, 1);
  assert.equal(sendBody.get("EventID"), "-1");
  assert.equal(
    sendBody.get("MSG"),
    "WinCRM EVERY8D 雙向回覆測試，請依簡訊內回覆方式回覆 TEST01。"
  );

  const loggedEvidence = JSON.stringify(capture.entries);
  assert.match(loggedEvidence, /batch-interactive-1/);
  assert.match(loggedEvidence, /interactive-message-reference-1/);
  assert.match(loggedEvidence, /replyQueryExecuted/);
  assert.doesNotMatch(loggedEvidence, /fixture-bearer-token/);
  assert.doesNotMatch(loggedEvidence, /fixture-password-do-not-use/);
  assert.doesNotMatch(loggedEvidence, /approved-test-recipient/);
  assert.doesNotMatch(loggedEvidence, /雙向回覆測試/);
});

test("EVERY8D interactive SendSMS provider failure is not retried", async () => {
  const capture = createCaptureLogger();
  const { transport, requests } = createQueuedTransport([
    { status: 200, body: JSON.stringify({ Result: true, Msg: "fixture-bearer-token" }) },
    { status: 200, body: "-99,provider fixture failure" }
  ]);

  await assert.rejects(
    () =>
      runEvery8dInteractiveReplySpike({
        config: enabledInteractiveConfig(),
        transport,
        logger: capture.logger
      }),
    (error) => error instanceof Every8dClientError && error.code === "provider_failure"
  );

  assert.equal(requests.length, 2);
  assert.equal(requests.filter((request) => /SendSMS\.ashx$/.test(request.url)).length, 1);
  assert.equal(requests.some((request) => /GetDeliveryStatus\.ashx$/.test(request.url)), false);
  assert.doesNotMatch(JSON.stringify(capture.entries), /provider fixture failure/);
});
