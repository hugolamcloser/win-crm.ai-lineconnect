const assert = require("node:assert/strict");
const dns = require("node:dns");
const { EventEmitter, getEventListeners } = require("node:events");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const { beforeEach, test } = require("node:test");
const { inspect } = require("node:util");
const { createEvery8dSettingsEmailResendProvider: create } = require("../dist/services/every8dSettingsEmailResendProvider");

const nsPerMs = 1_000_000n;
const apiKey = "synthetic-key-canary!~";
const providerId = "synthetic-ID-canary!?~";
const responseCanary = "synthetic-response-canary";
const rawErrorCanary = "synthetic-raw-error-canary";
const causeCanary = "synthetic-cause-canary";
const stackCanary = "synthetic-stack-canary";
const unknown = { outcome: "outcome_unknown" };
const notStarted = { outcome: "not_accepted_retryable", evidence: { kind: "transport_not_started" } };
const notAccepted = { outcome: "not_accepted_retryable", evidence: { kind: "authoritative_non_acceptance" } };
const accepted = { outcome: "accepted", evidence: "authoritative_acceptance", providerMessageId: providerId };
const validJson = JSON.stringify({ id: providerId });
const jsonHeaders = ["Content-Type", "application/json"];
const mail = {
  canonicalSender: "synthetic-sender-canary@example.invalid",
  recipient: "synthetic-recipient-canary@example.invalid",
  subject: "  synthetic-subject-canary ☃ ",
  body: "synthetic-body-canary\nsynthetic-OTP-canary  ",
  idempotencyKey: "wincrm-c3c3-email-v1:76543210-abcd-4def-8abc-fedcba012345",
};

let networkAttempts;
beforeEach((t) => {
  networkAttempts = 0;
  const blocked = () => { networkAttempts++; throw Error("External network is forbidden in Resend tests."); };
  for (const [target, methods] of [
    [dns, ["lookup", "resolve"]], [dns.promises, ["lookup", "resolve"]], [net.Socket.prototype, ["connect"]],
    [http, ["request", "get"]], [https, ["request", "get"]], [tls, ["connect"]], [globalThis, ["fetch"]],
  ]) {
    for (const method of methods) t.mock.method(target, method, blocked);
  }
  t.after(() => assert.equal(networkAttempts, 0, "external network entry attempted"));
});

class FakeRequest extends EventEmitter {
  headers = new Map();
  submitted = [];
  destroyed = 0;

  setHeader(name, value) { this.headers.set(name, value); }
  end(body, onWritten) {
    this.submitted.push(Buffer.from(body));
    this.written = body;
    onWritten();
  }
  destroy() { this.destroyed++; }
}

class FakeResponse extends EventEmitter {
  complete = false;
  destroyed = 0;

  constructor(status, headers = jsonHeaders) {
    super();
    this.statusCode = status;
    this.rawHeaders = headers;
  }
  destroy() { this.destroyed++; }
  chunk(value) { this.emit("data", Buffer.isBuffer(value) ? value : Buffer.from(value)); }
  finish() { this.complete = true; this.emit("end"); }
}

function harness(t, overrides = {}) {
  let now = 0n;
  let nextTimer = 0;
  const timers = new Map();
  t.mock.method(process.hrtime, "bigint", () => now);
  t.mock.method(globalThis, "setTimeout", (fn, delay) => {
    timers.set(++nextTimer, { fn, at: now + BigInt(delay) * nsPerMs });
    return nextTimer;
  });
  t.mock.method(globalThis, "clearTimeout", (id) => timers.delete(id));

  const controller = new AbortController();
  const input = { ...mail, signal: controller.signal, deadlineMonotonicNs: 20n * nsPerMs };
  const invocations = [];
  const fatal = [];
  const transport = (options, onResponse) => {
    const request = new FakeRequest();
    invocations.push({ options, request, onResponse });
    return overrides.onRequest ? overrides.onRequest(request) : request;
  };
  const reportProviderFatal = (...args) => {
    fatal.push(args);
    overrides.onFatal?.();
  };
  if (overrides.useDefault) t.mock.method(https, "request", transport);
  const provider = overrides.useDefault
    ? create({ apiKey, reportProviderFatal })
    : create({ apiKey, reportProviderFatal, requestForTest: transport });

  return {
    provider, input, controller, invocations, fatal, timers, transport,
    send: (changes = {}) => provider.send({ ...input, ...changes }),
    advanceTo(value, runTimers = true) {
      now = value;
      if (runTimers) {
        for (const [id, timer] of timers) {
          if (timer.at > now) continue;
          timers.delete(id);
          timer.fn();
        }
      }
    },
    response(status, headers, index = 0) {
      const response = new FakeResponse(status, headers);
      invocations[index].onResponse(response);
      return response;
    },
  };
}

function assertResult(result, expected) {
  assert.ok(JSON.stringify(result) === JSON.stringify(expected), "unexpected closed provider result");
}

function assertFatal(h, count) {
  assert.equal(h.fatal.length, count, "fatal observation count");
  assert.ok(h.fatal.every((args) => args.length === 0), "fatal observation carried a payload");
}

function assertClean(h) {
  assert.equal(getEventListeners(h.input.signal, "abort").length, 0, "adapter abort listener remains");
  assert.equal(h.timers.size, 0, "adapter deadline timer remains");
  assert.ok(h.invocations.every(({ request }) => request.submitted.length <= 1), "request body was resubmitted");
}

test("the default adapter uses one fixed direct HTTPS POST and exact input values", async (t) => {
  const h = harness(t, { useDefault: true });
  assert.ok(Object.isFrozen(h.provider));
  assert.equal(h.invocations.length, 0);
  assertClean(h);
  const send = h.send();
  assert.equal(h.invocations.length, 1);
  const { options, request } = h.invocations[0];
  assert.ok(JSON.stringify(options) === JSON.stringify({
    protocol: "https:", hostname: "api.resend.com", path: "/emails", method: "POST",
    agent: false, rejectUnauthorized: true, maxHeaderSize: 16_384,
  }), "fixed HTTPS connection options changed");
  assert.equal(request.maxHeadersCount, 0);
  assert.equal(request.submitted.length, 1);
  const [submitted] = request.submitted;
  const expectedHeaders = {
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "identity",
    "Idempotency-Key": mail.idempotencyKey, "Content-Length": submitted.byteLength,
  };
  assert.equal(request.headers.size, Object.keys(expectedHeaders).length);
  for (const [key, value] of Object.entries(expectedHeaders)) {
    assert.ok(request.headers.get(key) === value, "request header mismatch");
  }
  assert.equal(Buffer.byteLength(mail.idempotencyKey), 57);
  assert.ok(submitted.toString("utf8") === JSON.stringify({
    from: mail.canonicalSender, to: [mail.recipient], subject: mail.subject, text: mail.body,
  }), "request JSON mismatch");
  assert.ok(request.written.every((byte) => byte === 0), "adapter-owned request bytes were retained");

  const response = h.response(200, ["CONTENT-TYPE", 'Application/JSON; charset="UTF-8"', "Content-Encoding", "identity"]);
  response.chunk(validJson.slice(0, 12));
  response.chunk(validJson.slice(12));
  response.finish();
  assertResult(await send, accepted);
  assertFatal(h, 0);
  assertClean(h);
  assert.equal(request.destroyed, 0);
  assert.equal(response.destroyed, 0);
});

test("a successful idempotent replay is accepted once for each caller invocation", async (t) => {
  const h = harness(t);
  for (const index of [0, 1]) {
    const send = h.send();
    const response = h.response(200, jsonHeaders, index);
    response.chunk(validJson);
    response.finish();
    assertResult(await send, accepted);
    assert.equal(h.invocations.length, index + 1);
    assert.equal(h.invocations[index].request.submitted.length, 1);
    assert.ok(h.invocations[index].request.headers.get("Idempotency-Key") === mail.idempotencyKey, "key changed");
    assertFatal(h, 0);
    assertClean(h);
  }
});

const invalidSuccesses = [
  ["missing ID", "{}"], ["empty ID", '{"id":""}'], ["oversized ID", JSON.stringify({ id: "a".repeat(256) })],
  ["space", '{"id":"a b"}'], ["control", '{"id":"a\\u0000b"}'], ["DEL", '{"id":"\\u007f"}'],
  ["non-ASCII", '{"id":"é"}'], ["wrong ID type", '{"id":42}'], ["duplicate ID", '{"id":"a","id":"b"}'],
  ["escaped duplicate ID", '{"id":"a","\\u0069d":"b"}'], ["extra member", '{"id":"a","extra":null}'],
  ["array", '[{"id":"a"}]'], ["invalid JSON", '{"id":"a"'], ["trailing JSON", '{"id":"a"}{}'],
  ["invalid UTF-8", Buffer.from([123, 34, 105, 100, 34, 58, 34, 0xc3, 0x28, 34, 125])],
  ["wrong media type", validJson, ["Content-Type", "text/html"]],
  ["non-UTF-8 media type", validJson, ["Content-Type", "application/json; charset=iso-8859-1"]],
  ["duplicate media type", validJson, [...jsonHeaders, ...jsonHeaders]],
  ["contradictory media type", validJson, [...jsonHeaders, "content-type", "text/html"]],
  ["compressed encoding", validJson, [...jsonHeaders, "Content-Encoding", "gzip"]],
  ["duplicate encoding", validJson, [...jsonHeaders, "Content-Encoding", "identity", "content-encoding", "identity"]],
  ["oversized headers", validJson, [...jsonHeaders, "X-Large", "a".repeat(16_384)]],
  ["shorter body than Content-Length", validJson, [...jsonHeaders, "Content-Length", "1000"]],
  ["invalid Content-Length", validJson, [...jsonHeaders, "Content-Length", "1, 2"]],
  ["declared body overflow", validJson, [...jsonHeaders, "Content-Length", "16385"]],
];

for (const [label, body, headers] of invalidSuccesses) {
  test("200 with " + label + " is unknown and fatal", async (t) => {
    const h = harness(t);
    const send = h.send();
    const response = h.response(200, headers);
    response.chunk(body);
    response.finish();
    assertResult(await send, unknown);
    assertFatal(h, 1);
    assert.equal(h.invocations.length, 1);
    assertClean(h);
  });
}

test("exactly 16,384 streamed bytes and a 255-byte ID can prove acceptance", async (t) => {
  const h = harness(t);
  const send = h.send();
  const id = "~".repeat(255);
  const response = h.response(200);
  response.chunk(JSON.stringify({ id }).padEnd(16_384));
  response.finish();
  assertResult(await send, { ...accepted, providerMessageId: id });
  assertFatal(h, 0);
  assertClean(h);
});

for (const length of [undefined, "10"]) {
  test("actual streamed overflow destroys unfinished transport (" + (length ? "wrong length" : "chunked") + ")", async (t) => {
    const h = harness(t);
    const send = h.send();
    const response = h.response(200, length
      ? [...jsonHeaders, "Content-Length", length] : [...jsonHeaders, "Transfer-Encoding", "chunked"]);
    response.chunk(Buffer.alloc(16_384));
    response.chunk("a");
    assertResult(await send, unknown);
    assert.equal(response.destroyed, 1);
    assert.equal(h.invocations[0].request.destroyed, 1);
    assertFatal(h, 1);
    assertClean(h);
  });
}

test("a streamed length contradiction reports fatal before a later interruption", async (t) => {
  const h = harness(t);
  const send = h.send();
  const response = h.response(200, [...jsonHeaders, "Content-Length", "2"]);
  response.chunk("{} ");
  assertFatal(h, 1);
  h.controller.abort();
  assertResult(await send, unknown);
  assert.equal(response.destroyed, 1);
  assert.equal(h.invocations[0].request.destroyed, 1);
  assertFatal(h, 1);
  assertClean(h);
});

const mappings = [
  [201, "unexpected_success", 1], [204, "unexpected_success", 1], [302, "redirect", 1], [307, "redirect", 1],
  [400, "invalid_idempotency_key", 1], [400, "validation_error", 1], [400, "unrecognized", 0],
  [401, "missing_api_key", 1, notAccepted], [401, "validation_error", 1, notAccepted],
  [401, "restricted_api_key", 1], [401, "unrecognized", 1],
  [403, "invalid_permission", 1, notAccepted], [403, "restricted_api_key", 1, notAccepted],
  [403, "suspended_api_key", 1, notAccepted], [403, "validation_error", 1], [403, "unrecognized", 1],
  [404, "not_found", 1], [405, "method_not_allowed", 1],
  [409, "invalid_idempotent_request", 1], [409, "concurrent_idempotent_requests", 0], [409, "unrecognized", 0],
  [422, "missing_required_field", 1], [422, "missing_required_parameter", 1], [422, "invalid_parameter", 1],
  [422, "invalid_attachment", 1], [422, "unrecognized", 0],
  [429, "daily_quota_exceeded", 1], [429, "monthly_quota_exceeded", 1], [429, "rate_limit_exceeded", 0],
  [429, "unrecognized", 0], [500, "application_error", 0], [502, "unrecognized", 0],
  [503, "service_unavailable", 0], [504, "unrecognized", 0], [599, "invalid_permission", 0],
];

for (const [status, name, fatalCount, expected = unknown] of mappings) {
  test("maps HTTP " + status + " / " + name + " without replay", async (t) => {
    const h = harness(t);
    const send = h.send();
    const response = h.response(status, [
      ...jsonHeaders, "Location", "https://redirect.example.invalid/", "Retry-After", "123",
    ]);
    response.chunk(JSON.stringify({ name, message: responseCanary, statusCode: status }));
    response.finish();
    assertResult(await send, expected);
    assertFatal(h, fatalCount);
    assert.equal(h.invocations.length, 1);
    assert.equal(h.invocations[0].request.submitted.length, 1);
    assertClean(h);
  });
}

for (const [label, body] of [
  ["optional status omitted", '{"name":"missing_api_key","message":"unused"}'],
  ["nested unrelated data", '{"name":"missing_api_key","meta":{"name":"other","list":[{"name":"other"}]},"message":"unused"}'],
]) {
  test("structured authentication denial with " + label, async (t) => {
    const h = harness(t);
    const send = h.send();
    const response = h.response(401);
    response.chunk(body);
    response.finish();
    assertResult(await send, notAccepted);
    assertFatal(h, 1);
    assertClean(h);
  });
}

for (const [label, body, headers] of [
  ["duplicate name", '{"name":"missing_api_key","name":"missing_api_key","message":"unused"}'],
  ["duplicate message", '{"name":"missing_api_key","message":"a","message":"b"}'],
  ["escaped duplicate statusCode", '{"name":"missing_api_key","message":"unused","statusCode":401,"status\\u0043ode":401}'],
  ["mismatched statusCode", '{"name":"missing_api_key","message":"unused","statusCode":403}'],
  ["fractional statusCode", '{"name":"missing_api_key","message":"unused","statusCode":401.5}'],
  ["string statusCode", '{"name":"missing_api_key","message":"unused","statusCode":"401"}'],
  ["absent message", '{"name":"missing_api_key"}'],
  ["non-string name", '{"name":401,"message":"unused"}'],
  ["non-string message", '{"name":"missing_api_key","message":null}'],
  ["free text only", '{"message":"missing_api_key"}'],
  ["invalid UTF-8", Buffer.from([0xc3, 0x28])],
  ["wrong media type", '{"name":"missing_api_key","message":"unused"}', ["Content-Type", "text/plain"]],
]) {
  test("401 with " + label + " cannot establish non-acceptance", async (t) => {
    const h = harness(t);
    const send = h.send();
    const response = h.response(401, headers);
    assertFatal(h, 1);
    response.chunk(body);
    response.finish();
    assertResult(await send, unknown);
    assertFatal(h, 1);
    assertClean(h);
  });
}

test("an invalid named error cannot establish a body-dependent fatal condition", async (t) => {
  const h = harness(t);
  const send = h.send();
  const response = h.response(429);
  response.chunk('{"name":"monthly_quota_exceeded","message":"unused","statusCode":400}');
  response.finish();
  assertResult(await send, unknown);
  assertFatal(h, 0);
  assertClean(h);
});

test("pre-abort and expired or sub-millisecond budget prevent transport entry", async (t) => {
  const h = harness(t);
  for (const deadlineMonotonicNs of [-1n, 0n, nsPerMs - 1n]) {
    assertResult(await h.send({ deadlineMonotonicNs }), notStarted);
  }
  h.controller.abort(Error(rawErrorCanary));
  assertResult(await h.send(), notStarted);
  assert.equal(h.invocations.length, 0);
  assertFatal(h, 0);
  assertClean(h);
});

test("the immediate pre-invocation check catches lost budget after request preparation", async (t) => {
  const h = harness(t);
  const input = { ...h.input, deadlineMonotonicNs: nsPerMs };
  Object.defineProperty(input, "subject", { get() { h.advanceTo(1n); return mail.subject; } });
  assertResult(await h.provider.send(input), notStarted);
  assert.equal(h.invocations.length, 0);
  assertFatal(h, 0);
  assertClean(h);
});

test("the immediate pre-invocation check catches abort during request preparation", async (t) => {
  const h = harness(t);
  const input = { ...h.input };
  Object.defineProperty(input, "subject", { get() { h.controller.abort(); return mail.subject; } });
  assertResult(await h.provider.send(input), notStarted);
  assert.equal(h.invocations.length, 0);
  assertFatal(h, 0);
  assertClean(h);
});

test("exactly one millisecond permits the sole request", async (t) => {
  const h = harness(t);
  const send = h.send({ deadlineMonotonicNs: nsPerMs });
  assert.equal(h.invocations.length, 1);
  h.advanceTo(nsPerMs);
  assertResult(await send, unknown);
  assert.equal(h.invocations[0].request.destroyed, 1);
  assertFatal(h, 0);
  assertClean(h);
});

test("a proven pre-entry invariant failure reports fatal without transport", async (t) => {
  const h = harness(t);
  assertResult(await h.send({ idempotencyKey: mail.idempotencyKey + "\n" }), notStarted);
  assert.equal(h.invocations.length, 0);
  assertFatal(h, 1);
  assertClean(h);
});

for (const [label, terminate] of [
  ["abort after dispatch", (h) => h.controller.abort(Error(rawErrorCanary))],
  ["deadline after dispatch", (h) => h.advanceTo(h.input.deadlineMonotonicNs)],
  ["response close after dispatch", (_h, response) => response.emit("close")],
]) {
  test(label + " destroys unfinished transport and ignores late success", async (t) => {
    const h = harness(t);
    const send = h.send();
    const response = h.response(200);
    response.chunk(validJson.slice(0, 12));
    terminate(h, response);
    assertResult(await send, unknown);
    assert.equal(h.invocations.length, 1);
    assert.equal(h.invocations[0].request.destroyed, 1);
    assert.equal(response.destroyed, 1);
    response.chunk(validJson.slice(12));
    response.finish();
    response.emit("error", Error(rawErrorCanary));
    const late = h.response(403);
    assert.equal(late.destroyed, 1);
    assertFatal(h, 0);
    assertClean(h);
  });
}

test("response events at the original deadline cannot win a delayed watchdog race", async (t) => {
  const h = harness(t);
  const send = h.send();
  const response = h.response(200);
  response.chunk(validJson);
  h.advanceTo(h.input.deadlineMonotonicNs, false);
  response.finish();
  assertResult(await send, unknown);
  assertFatal(h, 0);
  assertClean(h);
});

for (const code of ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "CERT_HAS_EXPIRED", "HPE_HEADER_OVERFLOW"]) {
  test(code + " after invocation is ambiguous without authoritative headers", async (t) => {
    const h = harness(t);
    const send = h.send();
    h.invocations[0].request.emit("error", Object.assign(Error(rawErrorCanary), { code }));
    assertResult(await send, unknown);
    assert.equal(h.invocations.length, 1);
    assertFatal(h, 0);
    assertClean(h);
  });
}

test("a synchronous HTTPS invocation throw is ambiguous and cannot resubmit", async (t) => {
  const h = harness(t, { onRequest: () => { throw Error(rawErrorCanary); } });
  assertResult(await h.send(), unknown);
  assert.equal(h.invocations.length, 1);
  assert.equal(h.invocations[0].request.submitted.length, 0);
  assertFatal(h, 0);
  assertClean(h);
});

test("a status-only fatal observation latches through an incomplete response", async (t) => {
  const h = harness(t);
  const send = h.send();
  const response = h.response(403);
  assertFatal(h, 1);
  response.chunk('{"name":"restricted_api_key",');
  response.emit("close");
  assertResult(await send, unknown);
  const late = h.response(401);
  late.chunk('{"name":"missing_api_key","message":"unused"}');
  late.finish();
  assertFatal(h, 1);
  assertClean(h);
});

test("fatal observer failures cannot leak or replace closed evidence", async (t) => {
  const h = harness(t, { onFatal: () => { throw Error(rawErrorCanary); } });
  const send = h.send();
  const response = h.response(401);
  response.chunk(JSON.stringify({ name: "validation_error", message: responseCanary }));
  response.finish();
  assertResult(await send, notAccepted);
  assertFatal(h, 1);
  assertClean(h);
});

test("canaries stay out of failure results, errors, logs, and callback arguments", async (t) => {
  const captured = [];
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    t.mock.method(console, method, (...args) => captured.push(args));
  }
  const h = harness(t);
  const a = h.send();
  const response = h.response(200);
  response.chunk(JSON.stringify({ id: providerId, extra: responseCanary }));
  response.finish();
  const b = h.send();
  const error = new Error(rawErrorCanary, { cause: Error(causeCanary) });
  error.stack = stackCanary;
  error.request = h.invocations[1].request;
  h.invocations[1].request.emit("error", error);
  let configError;
  try { create({ apiKey: apiKey + "\n", reportProviderFatal() {} }); } catch (error) { configError = error; }
  const surface = inspect([await a, await b, configError, captured, h.fatal], { depth: null });
  for (const canary of [
    apiKey, "Bearer " + apiKey, ...Object.values(mail), "synthetic-OTP-canary", providerId,
    responseCanary, rawErrorCanary, causeCanary, stackCanary,
  ]) {
    assert.ok(!surface.includes(canary), "a secret canary reached a failure or diagnostic surface");
  }
  assert.equal(captured.length, 0);
  assertFatal(h, 1);
  assertClean(h);
});
