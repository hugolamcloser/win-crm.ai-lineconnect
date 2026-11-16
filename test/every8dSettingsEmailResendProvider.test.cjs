const assert = require("node:assert/strict");
const dns = require("node:dns");
const dc = require("node:diagnostics_channel");
const { EventEmitter, getEventListeners, once } = require("node:events");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const { PerformanceObserver } = require("node:perf_hooks");
const { beforeEach, test } = require("node:test");
const { inspect } = require("node:util");
const { createEvery8dSettingsEmailResendProvider: create } = require("../dist/services/every8dSettingsEmailResendProvider");

const nsPerMs = 1_000_000n;
const apiKey = "synthetic-key-canary!~";
const providerId = "synthetic-ID-canary!?~";
const responseCanary = "synthetic-response-canary";
const rawErrorCanary = "synthetic-raw-error-canary";
const unknown = { outcome: "outcome_unknown" };
const notStarted = { outcome: "not_accepted_retryable", evidence: { kind: "transport_not_started" } };
const notAccepted = { outcome: "not_accepted_retryable", evidence: { kind: "authoritative_non_acceptance" } };
const accepted = { outcome: "accepted", evidence: "authoritative_acceptance", providerMessageId: providerId };
const validJson = JSON.stringify({ id: providerId });
const media = "Content-Type: application/json\r\n";
const chunked = "Transfer-Encoding: chunked\r\n";
const mail = {
  canonicalSender: "synthetic-sender-canary@example.invalid",
  recipient: "synthetic-recipient-canary@example.invalid",
  subject: "  synthetic-subject-canary ☃ ",
  body: "synthetic-body-canary\nsynthetic-OTP-canary  ",
  idempotencyKey: "wincrm-c3c3-email-v1:76543210-abcd-4def-8abc-fedcba012345",
};
const payload = JSON.stringify({ from: mail.canonicalSender, to: [mail.recipient], subject: mail.subject, text: mail.body });
const expectedRequest = Buffer.from([
  "POST /emails HTTP/1.1", "Host: api.resend.com", "Authorization: Bearer " + apiKey,
  "Content-Type: application/json", "Accept: application/json", "Accept-Encoding: identity",
  "Idempotency-Key: " + mail.idempotencyKey, "Content-Length: " + Buffer.byteLength(payload), "Connection: close", "", payload,
].join("\r\n"));
const canaries = [apiKey, ...Object.values(mail), "synthetic-OTP-canary", providerId, responseCanary, rawErrorCanary];

let allowedPorts;
beforeEach((t) => {
  allowedPorts = new Set();
  let blockedCount = 0;
  const blocked = () => { blockedCount++; throw Error("External network is forbidden in Resend tests."); };
  for (const target of [dns, dns.promises]) {
    for (const method of Object.keys(target).filter((name) => /^(lookup|resolve|reverse)/.test(name))) {
      if (target === dns && method === "lookup") continue;
      if (typeof target[method] === "function") t.mock.method(target, method, blocked);
    }
  }
  // Node uses lookup even when binding a server to a literal IPv4 address.
  t.mock.method(dns, "lookup", (host, options, callback) => {
    if (host !== "127.0.0.1" || options?.all !== true || typeof callback !== "function") return blocked();
    queueMicrotask(() => callback(null, [{ address: host, family: 4 }]));
  });
  t.mock.method(globalThis, "fetch", blocked);
  const socketConnect = net.Socket.prototype.connect;
  t.mock.method(net.Socket.prototype, "connect", function (first, ...args) {
    const options = Array.isArray(first) ? first[0] : first;
    if (options?.host !== "127.0.0.1" || !allowedPorts.has(options.port)) return blocked();
    return socketConnect.call(this, first, ...args);
  });
  t.after(() => assert.equal(blockedCount, 0, "external network entry attempted"));
});

class FakeSocket extends EventEmitter {
  authorized = true;
  alpnProtocol = "http/1.1";
  writes = [];
  destroyed = 0;

  write(bytes, release) { this.writes.push({ bytes, release }); }
  destroy() { this.destroyed++; }
}

function harness(t, options = {}) {
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
  const connections = [];
  const wraps = [];
  const fatal = [];
  const socketsForTest = {
    tcp(connectionOptions) {
      const socket = new FakeSocket();
      connections.push({ socket, options: connectionOptions });
      options.onTcp?.();
      return socket;
    },
    tls(connectionOptions) {
      const socket = new FakeSocket();
      wraps.push({ socket, options: connectionOptions });
      options.onTls?.(socket);
      return socket;
    },
  };
  const reportProviderFatal = (...args) => { fatal.push(args); options.onFatal?.(); };
  if (options.useDefault) {
    t.mock.method(net, "connect", socketsForTest.tcp);
    t.mock.method(tls, "connect", socketsForTest.tls);
  }
  const provider = options.useDefault ? create({ apiKey, reportProviderFatal }) :
    create({ apiKey, reportProviderFatal, socketsForTest });
  return {
    provider, input, controller, timers, connections, wraps, fatal,
    send(changes = {}) { return provider.send({ ...input, ...changes }); },
    connect(index = connections.length - 1) {
      connections[index].socket.emit("connect");
      return wraps.at(-1)?.socket;
    },
    secure() {
      const socket = this.connect();
      socket.emit("secureConnect");
      return socket;
    },
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
  };
}

function assertResult(actual, expected) {
  assert.ok(JSON.stringify(actual) === JSON.stringify(expected), "unexpected closed provider result");
}

function assertClean(h, count) {
  assert.equal(h.fatal.length, count, "fatal observation count");
  assert.ok(h.fatal.every((args) => args.length === 0), "fatal observation carried a payload");
  assert.equal(getEventListeners(h.input.signal, "abort").length, 0, "adapter abort listener remains");
  assert.equal(h.timers.size, 0, "adapter deadline timer remains");
  assert.ok(h.wraps.every(({ socket }) => socket.writes.length <= 1), "request was resubmitted");
  assert.ok(h.connections.every(({ socket }) => socket.destroyed === 1), "TCP socket cleanup mismatch");
  assert.ok(h.wraps.every(({ socket }) => socket.destroyed === 1), "TLS socket cleanup mismatch");
}

function headers(status, fields, reason = "Synthetic") {
  return "HTTP/1.1 " + status + " " + reason + "\r\n" + fields + "\r\n";
}

function fixed(status, body = validJson, fields = media) {
  return Buffer.concat([
    Buffer.from(headers(status, fields + "Content-Length: " + Buffer.byteLength(body) + "\r\n")),
    Buffer.from(body),
  ]);
}

function emitWire(socket, wire, segmentation = "coalesced") {
  const bytes = Buffer.from(wire);
  const sizes = segmentation === "byte" ? [1] : segmentation === "mixed" ? [17, 3, 64, 1, 5] : [bytes.length || 1];
  for (let i = 0, n = 0; i < bytes.length; n++) {
    const end = i + sizes[n % sizes.length];
    socket.emit("data", bytes.subarray(i, end));
    i = end;
  }
}

async function assertWire(t, wire, expected, fatal, { segmentation, eof = false } = {}) {
  const h = harness(t);
  const result = h.send();
  const socket = h.secure();
  const write = socket.writes[0];
  emitWire(socket, wire, segmentation);
  if (eof) socket.emit("end");
  assertResult(await result, expected);
  assert.equal(h.connections.length, 1);
  assert.equal(h.wraps.length, 1);
  assert.equal(socket.writes.length, 1);
  assert.ok(write.bytes.equals(expectedRequest), "request bytes changed before release");
  write.release();
  assert.ok(write.bytes.every((byte) => byte === 0), "write callback did not clear request buffer");
  assertClean(h, fatal);
}

test("the default path connects once and wraps the already-connected socket with fixed TLS policy", async (t) => {
  const h = harness(t, { useDefault: true });
  assert.ok(Object.isFrozen(h.provider));
  assert.equal(h.connections.length, 0);
  assertClean(h, 0);
  const send = h.send();
  assert.equal(h.connections.length, 1);
  const { socket, options } = h.connections[0];
  assert.ok(inspect(options) === inspect({ host: "api.resend.com", port: 443, autoSelectFamily: false }),
    "fixed TCP options changed");
  assert.equal(h.wraps.length, 0);
  const secure = h.connect();
  const policy = h.wraps[0].options;
  assert.ok(policy.socket === socket && policy.servername === "api.resend.com" && policy.rejectUnauthorized === true &&
    policy.minVersion === "TLSv1.2" && policy.ALPNProtocols.join() === "http/1.1" &&
    policy.ca.length === tls.rootCertificates.length && policy.ca.every((root, i) => root === tls.rootCertificates[i]) &&
    Object.keys(policy).length === 6, "fixed TLS policy changed");
  assert.equal(secure.writes.length, 0);
  secure.emit("secureConnect");
  secure.emit("secureConnect");
  assert.equal(secure.writes.length, 1);
  assert.equal(Buffer.byteLength(mail.idempotencyKey), 57);
  assert.ok(secure.writes[0].bytes.equals(expectedRequest), "request wire bytes differ");
  emitWire(secure, fixed(200, validJson, 'CONTENT-TYPE: Application/JSON; charset="UTF-8"\r\nContent-Encoding: Identity\r\nConnection: keep-alive\r\n'));
  assertResult(await send, accepted);
  secure.writes[0].release();
  assertClean(h, 0);
});

test("idempotent replay accepts exactly one response per caller invocation", async (t) => {
  const h = harness(t);
  for (const count of [1, 2]) {
    const result = h.send();
    const socket = h.secure();
    emitWire(socket, fixed(200));
    assertResult(await result, accepted);
    assert.equal(h.connections.length, count);
    assert.equal(h.wraps.length, count);
    assert.ok(socket.writes[0].bytes.equals(expectedRequest), "idempotent replay request changed");
    socket.writes[0].release();
    assertClean(h, 0);
  }
});

for (const [label, terminate, expected] of [
  ["early valid response", (h, s) => emitWire(s, fixed(200)), accepted],
  ["abort", (h) => h.controller.abort(), unknown],
  ["deadline", (h) => h.advanceTo(h.input.deadlineMonotonicNs), unknown],
  ["socket error", (h, s) => s.emit("error", Error(rawErrorCanary)), unknown],
]) {
  test("a held native-style write callback preserves bytes through " + label, async (t) => {
    const h = harness(t);
    const result = h.send();
    const socket = h.secure();
    const write = socket.writes[0];
    terminate(h, socket);
    assertResult(await result, expected);
    assert.ok(write.bytes.equals(expectedRequest), "Node-owned buffer was mutated during settlement");
    emitWire(socket, fixed(401, '{"name":"missing_api_key","message":"unused"}'));
    socket.emit("error", Error(rawErrorCanary));
    assert.ok(write.bytes.equals(expectedRequest), "late events mutated Node-owned buffer");
    write.release(Error(rawErrorCanary));
    assert.ok(write.bytes.every((byte) => byte === 0), "write callback did not clear the exact buffer");
    assert.equal(socket.writes.length, 1);
    assertClean(h, 0);
  });
}

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
for (const [status, name, fatal, result = unknown] of mappings) {
  test("preserves outcome " + status + " / " + name, (t) =>
    assertWire(t, fixed(status, JSON.stringify({ name, message: responseCanary, statusCode: status }),
      media + "Location: https://redirect.example.invalid/\r\nRetry-After: 123\r\n"), result, fatal));
}

const statusPrefix = '{"name":"missing_api_key","message":"unused","statusCode":';
for (const token of ["401", "401.0", "401e0", "401E0", "401E+0", "401.00000000000001", "400.99999999999999",
  "400.99999999999994", '"401"', "403", "-401", "+401", "0401", "4010", "40 1"]) {
  test("statusCode authority uses the original token " + token, (t) =>
    assertWire(t, fixed(401, statusPrefix + token + "}"), token === "401" ? notAccepted : unknown, 1, { segmentation: "byte" }));
}

const jsonCases = [
  ["optional status absent", 401, '{"name":"missing_api_key","message":"unused"}', notAccepted],
  ["nested evidence ignored", 401,
    '{"name":"missing_api_key","message":"unused","meta":[{"name":"other","statusCode":403}]}', notAccepted],
  ["quoted and escaped punctuation", 401,
    JSON.stringify({ name: "missing_api_key", message: '":{\\[]}\n', meta: { value: "\uD800" } }), notAccepted],
  ["depth 64", 401, '{"name":"missing_api_key","message":"unused","meta":' + "[".repeat(63) + "0" + "]".repeat(63) + "}", notAccepted],
  ["depth 65", 401, '{"name":"missing_api_key","message":"unused","meta":' + "[".repeat(64) + "0" + "]".repeat(64) + "}"],
  ["wrong name type", 401, '{"name":1,"message":"unused"}'],
  ["wrong message type", 401, '{"name":"missing_api_key","message":null}'],
  ["absent message", 401, '{"name":"missing_api_key"}'],
  ["absent name", 401, '{"message":"missing_api_key"}'],
  ["duplicate name", 401, '{"name":"other","name":"missing_api_key","message":"unused"}'],
  ["escaped duplicate name", 401, '{"name":"other","n\\u0061me":"missing_api_key","message":"unused"}'],
  ["duplicate message", 401, '{"name":"missing_api_key","message":"a","message":"b"}'],
  ["duplicate status", 401, statusPrefix + '401,"statusCode":401}'],
  ["escaped duplicate status", 401, statusPrefix + '401,"status\\u0043ode":401}'],
  ["duplicate id", 200, '{"id":"a","id":"b"}'],
  ["escaped duplicate id", 200, '{"id":"a","\\u0069d":"b"}'],
  ["escaped id member", 200, '{"\\u0069d":"' + providerId + '"}', accepted],
  ["extra member", 200, '{"id":"a","extra":null}'],
  ["trailing JSON", 200, validJson + " {}"],
  ["unmatched object", 200, '{"id":"a"'],
  ["trailing comma", 200, '{"id":"a",}'],
  ["top-level array", 200, "[" + validJson + "]"],
  ["BOM", 200, "\uFEFF" + validJson],
  ["invalid UTF-8", 200, Buffer.from([0x7b, 0xc3, 0x28, 0x7d])],
  ["absent ID", 200, "{}"],
  ["empty ID", 200, '{"id":""}'],
  ["long ID", 200, JSON.stringify({ id: "~".repeat(256) })],
  ["space in ID", 200, '{"id":"a b"}'],
  ["control in ID", 200, '{"id":"a\\u0000b"}'],
  ["DEL in ID", 200, '{"id":"\\u007f"}'],
  ["non-ASCII ID", 200, '{"id":"é"}'],
  ["numeric ID", 200, '{"id":42}'],
  ["invalid escape", 200, '{"id":"\\q"}'],
];
for (const [label, status, body, result = unknown] of jsonCases) {
  test("strict JSON evidence: " + label, (t) => assertWire(t, fixed(status, body), result,
    result === accepted ? 0 : 1, { segmentation: "mixed" }));
}

const chunkBody = "8\r\n" + validJson.slice(0, 8) + "\r\n" +
  (validJson.length - 8).toString(16) + "\r\n" + validJson.slice(8) + "\r\n";
const endChunk = "0\r\n\r\n";
function chunkFrame(fields = "", body = chunkBody + endChunk) {
  return headers(200, media + chunked + fields) + body;
}

for (const segmentation of ["coalesced", "byte", "mixed"]) {
  for (const [label, wire, result, fatal, eof] of [
    ["fixed", fixed(200), accepted, 0],
    ["chunked", chunkFrame(), accepted, 0],
    ["surplus after fixed frame", Buffer.concat([fixed(200), fixed(403)]), accepted, 0],
    ["surplus after chunked frame", chunkFrame("", chunkBody + endChunk + "garbage"), accepted, 0],
    ["unsupported gzip transfer", headers(200, media + "Transfer-Encoding: gzip, chunked\r\n") + chunkBody + endChunk, unknown, 1],
    ["unsupported deflate transfer", headers(200, media + "Transfer-Encoding: deflate, chunked\r\n") + chunkBody + endChunk, unknown, 1],
    ["duplicate transfer encoding", chunkFrame(chunked), unknown, 1],
    ["dual explicit framing", chunkFrame("Content-Length: 123\r\n"), unknown, 1],
    ["chunk extension", chunkFrame("", chunkBody.replace("8\r\n", "8;x=1\r\n") + endChunk), unknown, 1],
    ["invalid hex", chunkFrame("", "q\r\n"), unknown, 1],
    ["chunk size line exceeds 16 digits", chunkFrame("", "00000000000000000\r\n"), unknown, 1],
    ["chunk size exceeds body bounds", chunkFrame("", "ffffffffffffffff\r\n"), unknown, 1],
    ["declared trailer", chunkFrame("Trailer: Content-Type\r\n"), unknown, 1],
    ["noncanonical last chunk", chunkFrame("", chunkBody + "00\r\n\r\n"), unknown, 1],
    ...["X-Trailer: a", "Content-Type: text/plain", "Content-Encoding: gzip", "Content-Length: 0"].map((trailer) =>
      ["actual trailer " + trailer.split(":")[0], chunkFrame("", chunkBody + "0\r\n" + trailer + "\r\n\r\n"), unknown, 1]),
    ["premature chunk EOF", chunkFrame("", chunkBody + "0\r\n"), unknown, 0, true],
    ["premature fixed EOF", headers(200, media + "Content-Length: 100\r\n") + validJson, unknown, 0, true],
    ["close-delimited body", headers(200, media) + validJson, unknown, 1, true],
  ]) {
    test(label + " / " + segmentation, (t) => assertWire(t, wire, result, fatal, { segmentation, eof }));
  }
}

for (const direction of ["leading", "trailing"]) {
  for (const size of [16_384, 16_385]) {
    const additional = "X-Wire: v\r\n";
    const emptyHeader = headers(200, media + "Content-Length: " + validJson.length + "\r\n" + additional);
    const padding = " ".repeat(size - emptyHeader.length);
    const padded = direction === "leading" ? "X-Wire: " + padding + "v" : "X-Wire: v" + padding;
    const head = emptyHeader.replace("X-Wire: v", padded);
    for (const segmentation of ["coalesced", "mixed"]) {
      test("wire header " + direction + " OWS at " + size + " octets / " + segmentation, (t) => {
        assert.equal(Buffer.byteLength(head), size);
        return assertWire(t, head + validJson, size === 16_384 ? accepted : unknown,
          size === 16_384 ? 0 : 1, { segmentation });
      });
    }
  }
}

for (const [label, wire, fatal] of [
  ["bare status LF", fixed(200).toString().replace("\r\n", "\n"), 0],
  ["bare header LF", fixed(200).toString().replace("application/json\r\n", "application/json\n"), 1],
  ["HTTP/1.0", fixed(200).toString().replace("HTTP/1.1", "HTTP/1.0"), 0],
  ["HTTP/0.9", fixed(200).toString().replace("HTTP/1.1", "HTTP/0.9"), 0],
  ["HTTP/2", fixed(200).toString().replace("HTTP/1.1", "HTTP/2"), 0],
  ["101 upgrade", fixed(101), 0],
  ["100 followed by valid 200", Buffer.concat([fixed(100), fixed(200)]), 0],
  ["103 informational", fixed(103), 0],
  ["99 status", fixed(99), 0],
  ["600 status", fixed(600), 0],
  ["2000 status", fixed(2000), 0],
  ["fractional status", fixed("200.0"), 0],
  ["DEL in reason", headers(200, media, "bad\x7f"), 0],
  ["oversize reason", headers(200, media, "x".repeat(1024)), 0],
  ["obs-fold", fixed(200, validJson, media + " X-Fold\r\n"), 1],
  ["whitespace before colon", fixed(200, validJson, media + "Other : x\r\n"), 1],
  ["invalid field-name token", fixed(200, validJson, media + "X(@): x\r\n"), 1],
  ["DEL in header", fixed(200, validJson, media + "Other: x\x7f\r\n"), 1],
  ["NUL in header", fixed(200, validJson, media + "Other: x\x00\r\n"), 1],
  ["wrong media", fixed(200, validJson, "Content-Type: text/plain\r\n"), 1],
  ["duplicate media", fixed(200, validJson, media + media), 1],
  ["contradictory media", fixed(200, validJson, media + "content-type: text/plain\r\n"), 1],
  ["wrong charset", fixed(200, validJson, "Content-Type: application/json; charset=latin1\r\n"), 1],
  ["encoded content", fixed(200, validJson, media + "Content-Encoding: gzip\r\n"), 1],
  ["duplicate encoding", fixed(200, validJson, media + "Content-Encoding: identity\r\ncontent-encoding: identity\r\n"), 1],
  ["duplicate length", fixed(200, validJson, media + "content-length: 5\r\n"), 1],
  ["comma-separated length", headers(200, media + "Content-Length: 3, 3\r\n"), 1],
  ["non-decimal length", headers(200, media + "Content-Length: +3\r\n"), 1],
  ["over-limit length", headers(200, media + "Content-Length: 16385\r\n"), 1],
  ["invalid Connection list", fixed(200, validJson, media + "Connection: close, Content-Type\r\n"), 1],
  ["duplicate Connection", fixed(200, validJson, media + "Connection: close\r\nconnection: close\r\n"), 1],
]) {
  test("rejects HTTP wire " + label, (t) => assertWire(t, wire, unknown, fatal, { segmentation: "mixed", eof: true }));
}

test("the exact status-line, body and ID limits can establish acceptance", (t) => {
  const id = "~".repeat(255);
  const body = JSON.stringify({ id }).padEnd(16_384);
  const head = headers(200, media + "Content-Length: 16384\r\n", "r".repeat(1024 - "HTTP/1.1 200 \r\n".length));
  return assertWire(t, head + body, { ...accepted, providerMessageId: id }, 0, { segmentation: "mixed" });
});

test("decoded chunk body and cumulative metadata are bounded", async (t) => {
  const h = harness(t);
  const send = h.send();
  const socket = h.secure();
  const block = ("0000000000000001\r\n \r\n").repeat(7_000);
  emitWire(socket, chunkFrame("", block + endChunk));
  assertResult(await send, unknown);
  socket.writes[0].release();
  assertClean(h, 1);
});

test("fatal headers latch through EOF and late events", async (t) => {
  const h = harness(t, { onFatal() { throw Error(rawErrorCanary); } });
  const sent = h.send();
  const socket = h.secure();
  emitWire(socket, headers(401, media + "Content-Length: 50\r\n") + '{"name":');
  assert.equal(h.fatal.length, 1);
  socket.emit("end");
  emitWire(socket, fixed(403));
  assertResult(await sent, unknown);
  socket.writes[0].release();
  assertClean(h, 1);
});

test("fatal observer exception leaves complete authentication evidence intact", (t) => {
  const h = harness(t, { onFatal() { throw Error(rawErrorCanary); } });
  const sent = h.send();
  const socket = h.secure();
  emitWire(socket, fixed(401, '{"name":"missing_api_key","message":"unused"}'));
  return sent.then((result) => {
    assertResult(result, notAccepted);
    socket.writes[0].release();
    assertClean(h, 1);
  });
});

test("pre-entry deadline, abort, and local invariant retain their distinct fatal policy", async (t) => {
  const h = harness(t);
  assertResult(await h.send({ deadlineMonotonicNs: nsPerMs - 1n }), notStarted);
  assertResult(await h.send({ idempotencyKey: mail.idempotencyKey + "\r\n" }), notStarted);
  h.controller.abort();
  assertResult(await h.send(), notStarted);
  assert.equal(h.connections.length, 0);
  assertClean(h, 1);
});

for (const action of ["clock", "abort"]) {
  test("rechecks " + action + " after request preparation and before TCP invocation", async (t) => {
    const h = harness(t);
    const input = { ...h.input, deadlineMonotonicNs: nsPerMs };
    Object.defineProperty(input, "subject", { get() {
      if (action === "clock") h.advanceTo(1n);
      else h.controller.abort();
      return mail.subject;
    } });
    assertResult(await h.provider.send(input), notStarted);
    assert.equal(h.connections.length, 0);
    assertClean(h, 0);
  });
}

test("exactly one millisecond permits one TCP invocation", async (t) => {
  const h = harness(t);
  const sent = h.send({ deadlineMonotonicNs: nsPerMs });
  h.advanceTo(nsPerMs);
  assertResult(await sent, unknown);
  assert.equal(h.connections.length, 1);
  assert.equal(h.wraps.length, 0);
  assertClean(h, 0);
});

for (const phase of ["TCP", "TLS"]) {
  for (const action of ["abort", "deadline", "error"]) {
    test(action + " during " + phase + " cannot write or establish non-acceptance", async (t) => {
      const h = harness(t);
      const sent = h.send();
      const socket = phase === "TLS" ? h.connect() : h.connections[0].socket;
      if (action === "abort") h.controller.abort();
      if (action === "deadline") h.advanceTo(h.input.deadlineMonotonicNs);
      if (action === "error") socket.emit("error", Object.assign(Error(rawErrorCanary), {
        code: phase === "TLS" ? "CERT_HAS_EXPIRED" : "ENOTFOUND",
      }));
      assertResult(await sent, unknown);
      socket.emit(phase === "TLS" ? "secureConnect" : "connect");
      assert.equal(socket.writes.length, 0);
      assert.equal(h.connections.length, 1);
      assert.equal(h.wraps.length, phase === "TLS" ? 1 : 0);
      assertClean(h, 0);
    });
  }
}

for (const failure of ["TCP throw", "TLS throw", "TLS ALPN mismatch", "TLS unauthorized", "pre-write response"]) {
  test(failure + " after TCP entry is ambiguous", async (t) => {
    const h = harness(t, {
      onTcp() { if (failure === "TCP throw") throw Error(rawErrorCanary); },
      onTls(socket) {
        if (failure === "TLS throw") throw Error(rawErrorCanary);
        if (failure === "TLS ALPN mismatch") socket.alpnProtocol = "h2";
        if (failure === "TLS unauthorized") socket.authorized = false;
      },
    });
    const sent = h.send();
    if (failure !== "TCP throw") {
      const socket = h.connect();
      if (failure === "pre-write response") emitWire(socket, fixed(200));
      if (failure !== "TLS throw") socket.emit("secureConnect");
    }
    assertResult(await sent, unknown);
    assert.equal(h.connections.length, 1);
    assert.ok(h.wraps.every(({ socket }) => socket.writes.length === 0), "HTTP bytes written");
    if (!failure.endsWith("throw")) assertClean(h, 0);
  });
}

test("data at original deadline cannot beat a delayed timer", async (t) => {
  const h = harness(t);
  const sent = h.send();
  const socket = h.secure();
  h.advanceTo(h.input.deadlineMonotonicNs, false);
  emitWire(socket, fixed(200));
  assertResult(await sent, unknown);
  socket.writes[0].release();
  assertClean(h, 0);
});

test("failure surfaces and observer arguments omit synthetic secrets and raw errors", async (t) => {
  const captured = [];
  for (const method of ["log", "info", "warn", "error", "debug"]) t.mock.method(console, method, (...args) => captured.push(args));
  const h = harness(t);
  const a = h.send();
  const socket = h.secure();
  emitWire(socket, fixed(200, JSON.stringify({ id: providerId, extra: responseCanary })));
  const b = h.send();
  const next = h.secure();
  const error = new Error(rawErrorCanary, { cause: Error("synthetic-cause-canary") });
  error.stack = "synthetic-stack-canary";
  error.request = next;
  next.emit("error", error);
  socket.writes[0].release();
  next.writes[0].release();
  let configError;
  try { create({ apiKey: apiKey + "\n", reportProviderFatal() {} }); } catch (error) { configError = error; }
  const surface = inspect([await a, await b, configError, captured, h.fatal], { depth: null });
  for (const canary of [...canaries, "synthetic-cause-canary", "synthetic-stack-canary"]) {
    assert.ok(!surface.includes(canary), "a synthetic secret reached a failure surface");
  }
  assert.equal(captured.length, 0);
  assertClean(h, 1);
});


// Synthetic loopback fixtures. The CA and leaf key are used only by these local tests.
const [testCa, testCert, testKey, expiredCert] = [
  `-----BEGIN CERTIFICATE-----
MIIBpDCCAUmgAwIBAgIUTFDWOOLSZIAHvR/sHkbemZ+b/8MwCgYIKoZIzj0EAwIw
JzElMCMGA1UEAwwcU3ludGhldGljIFJlc2VuZCBsb29wYmFjayBDQTAeFw0yNjEx
MTYwNzQ1MjBaFw0zNjExMTMwNzQ1MjBaMCcxJTAjBgNVBAMMHFN5bnRoZXRpYyBS
ZXNlbmQgbG9vcGJhY2sgQ0EwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQZ56Fn
qI7z4inXsYunUX9XZBXk+lgeVuR9vtnoSAVghcMb8gG+OgHoiPCVLf9Tj6ODNeRk
9Hzc5z+45JyJP031o1MwUTAdBgNVHQ4EFgQU/8Y3uETK3oQuYimRLkgvzvaTOLEw
HwYDVR0jBBgwFoAU/8Y3uETK3oQuYimRLkgvzvaTOLEwDwYDVR0TAQH/BAUwAwEB
/zAKBggqhkjOPQQDAgNJADBGAiEAiyBjcZxOKfn2PjkuXT3aUVILZfIozrtb0Ydp
qm5XlskCIQDFZj6rXgOd6o5eSIiXSF9fmvQh5u2sem3UkkYABNKyVw==
-----END CERTIFICATE-----
`,
  `-----BEGIN CERTIFICATE-----
MIIBoDCCAUWgAwIBAgIUXDQgzBJdckNh9d05YY1FCs/DFCswCgYIKoZIzj0EAwIw
JzElMCMGA1UEAwwcU3ludGhldGljIFJlc2VuZCBsb29wYmFjayBDQTAeFw0yNjEx
MTYwNzQ1MjBaFw0zNjExMTMwNzQ1MjBaMBkxFzAVBgNVBAMMDmFwaS5yZXNlbmQu
Y29tMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEVuIce/CFJ0767h3GZ+pCT9Dq
SNWvL6qJIEQsfaDWUzOwkt8wf+OnFj1aDBt78nbMVhXICFaElki7ViDscEfdiaNd
MFswGQYDVR0RBBIwEIIOYXBpLnJlc2VuZC5jb20wHQYDVR0OBBYEFFe+3Em3rYVA
ae26h5/cvIgH/FFCMB8GA1UdIwQYMBaAFP/GN7hEyt6ELmIpkS5IL872kzixMAoG
CCqGSM49BAMCA0kAMEYCIQC8RKQoHghslejaw0g6c7Y7KDc0XqKb2pYeKXrlkPFt
vgIhAM2q1KgFe/3hMYK+MrB9Prk1GkNozh0MmgBkVRGZnKFA
-----END CERTIFICATE-----
`,
  `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg5Kr0gZrfoZvtl98u
caNc5eZS/+CDvJwLOgUoJ+cxsAGhRANCAARW4hx78IUnTvruHcZn6kJP0OpI1a8v
qokgRCx9oNZTM7CS3zB/46cWPVoMG3vydsxWFcgIVoSWSLtWIOxwR92J
-----END PRIVATE KEY-----
`,
  `-----BEGIN CERTIFICATE-----
MIIBnzCCAUWgAwIBAgIUXDQgzBJdckNh9d05YY1FCs/DFCwwCgYIKoZIzj0EAwIw
JzElMCMGA1UEAwwcU3ludGhldGljIFJlc2VuZCBsb29wYmFjayBDQTAeFw0yNjEx
MTYwNzQ1MjBaFw0yNjExMTYwNzQ1MjBaMBkxFzAVBgNVBAMMDmFwaS5yZXNlbmQu
Y29tMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEVuIce/CFJ0767h3GZ+pCT9Dq
SNWvL6qJIEQsfaDWUzOwkt8wf+OnFj1aDBt78nbMVhXICFaElki7ViDscEfdiaNd
MFswGQYDVR0RBBIwEIIOYXBpLnJlc2VuZC5jb20wHQYDVR0OBBYEFFe+3Em3rYVA
ae26h5/cvIgH/FFCMB8GA1UdIwQYMBaAFP/GN7hEyt6ELmIpkS5IL872kzixMAoG
CCqGSM49BAMCA0gAMEUCIC88JNuB5ftKz7ezgKm6aJEzKckU2oUT8KkAMJvS/rhf
AiEAvc8pBl1A4oheYZqTlNLv8D4OST1LYXoPVnFbIrw32vw=
-----END CERTIFICATE-----
`
];

async function listenLocally(t, server) {
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.listen({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const { port } = server.address();
  allowedPorts.add(port);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return port;
}

function loopbackSockets(port, { trust = testCa, hostname, onTcp, onWrap } = {}) {
  return {
    tcp() {
      const socket = net.connect({ host: "127.0.0.1", port, autoSelectFamily: false });
      onTcp?.(socket);
      return socket;
    },
    tls(options) {
      assert.ok(options.socket instanceof net.Socket && !options.socket.connecting &&
        options.socket.remoteAddress === "127.0.0.1", "TLS requires the connected loopback socket");
      const secure = tls.connect({ ...options, ca: trust, servername: hostname ?? options.servername });
      onWrap?.(secure);
      return secure;
    },
  };
}

async function tlsPeer(t, options = {}) {
  const received = [];
  let connections = 0;
  let handshakes = 0;
  const server = tls.createServer({
    cert: options.cert ?? testCert, key: testKey,
    ALPNProtocols: options.alpn ?? ["http/1.1"], minVersion: "TLSv1.2",
  }, (socket) => {
    handshakes++;
    socket.on("error", () => {});
    let bytes = 0;
    socket.on("data", (chunk) => {
      received.push(chunk);
      bytes += chunk.length;
      if (bytes === expectedRequest.length) socket.write(fixed(200));
    });
  });
  server.on("connection", () => connections++);
  return { received, port: await listenLocally(t, server), connections: () => connections, handshakes: () => handshakes };
}

function nativeInput(controller = new AbortController(), ms = 4000) {
  return { ...mail, signal: controller.signal, deadlineMonotonicNs: process.hrtime.bigint() + BigInt(ms) * nsPerMs };
}

const observedChannels = [
  ...["request.created", "request.start", "request.error", "response.finish"].map((name) => "http.client." + name),
  ...["created", "start", "error", "bodyChunkSent", "bodySent", "finish", "close"].map((name) => "http2.client.stream." + name),
  ...["beforeConnect", "connected", "connectError", "sendHeaders"].map((name) => "undici:client:" + name),
  ...["create", "bodySent", "headers", "trailers", "error"].map((name) => "undici:request:" + name),
];

function observeDiagnostics(t) {
  const httpEvents = [];
  const entries = [];
  const plainSockets = [];
  const plainObservations = [];
  let keylogEvents = 0;
  for (const name of observedChannels) {
    const channel = dc.channel(name);
    const observe = (event) => httpEvents.push({ name, headers: event.request?.getHeaders?.() });
    channel.subscribe(observe);
    t.after(() => channel.unsubscribe(observe));
  }
  const socketChannel = dc.channel("net.client.socket");
  const retain = ({ socket }) => {
    plainSockets.push(socket);
    socket.on("keylog", () => keylogEvents++);
    socket.on("data", (data) => plainObservations.push(Buffer.from(data)));
    const write = socket.write;
    socket.write = function (data, ...args) {
      plainObservations.push(Buffer.from(data));
      return write.call(this, data, ...args);
    };
  };
  socketChannel.subscribe(retain);
  t.after(() => socketChannel.unsubscribe(retain));
  const perf = new PerformanceObserver((list) => entries.push(...list.getEntries()));
  perf.observe({ entryTypes: ["http"] });
  t.after(() => perf.disconnect());
  return { httpEvents, entries, plainSockets, plainObservations, keylogEvents: () => keylogEvents };
}

function includesBothHeaderCanaries(value) {
  const text = inspect(value, { depth: null });
  return text.includes("Bearer " + apiKey) && text.includes(mail.idempotencyKey);
}

test("native HTTPS positive control detects both secrets in request diagnostics and HttpClient performance", { timeout: 10_000 }, async (t) => {
  const server = https.createServer({ key: testKey, cert: testCert }, (req, res) => {
    req.resume();
    res.end("{}");
  });
  const port = await listenLocally(t, server);
  const seen = observeDiagnostics(t);
  await new Promise((resolve, reject) => {
    const req = https.request({
      host: "127.0.0.1", port, ca: testCa, servername: "api.resend.com", method: "POST", agent: false,
      headers: { Authorization: "Bearer " + apiKey, "Idempotency-Key": mail.idempotencyKey },
    }, (res) => {
      res.on("error", () => reject(Error("Native HTTPS positive response failed.")));
      res.on("end", resolve);
      res.resume();
    });
    req.once("error", () => reject(Error("Native HTTPS positive control failed.")));
    req.end();
  });
  await new Promise(setImmediate);
  assert.ok(seen.httpEvents.some((event) => event.name === "http.client.request.start" && includesBothHeaderCanaries(event.headers)),
    "ordinary HTTPS diagnostics did not expose both positive-control canaries");
  assert.ok(seen.entries.some((entry) => entry.name === "HttpClient" && includesBothHeaderCanaries(entry.detail.req?.headers)),
    "ordinary HTTPS performance did not expose both positive-control canaries");
  t.diagnostic("native diagnostic runtime " + process.version);
});

test("native TCP-to-TLS sends exact wire bytes without HTTP diagnostics or plaintext on the published socket", { timeout: 10_000 }, async (t) => {
  const peer = await tlsPeer(t);
  const seen = observeDiagnostics(t);
  let tcp;
  let wrapped;
  let wraps = 0;
  let writes = 0;
  let writesBeforeSecure = 0;
  let secure = false;
  let closed;
  const socketsForTest = loopbackSockets(peer.port, {
    onTcp(socket) { tcp = socket; },
    onWrap(socket) {
      wrapped = socket;
      wraps++;
      closed = new Promise((resolve) => socket.once("close", resolve));
      socket.once("secureConnect", () => { secure = true; });
      const write = socket.write;
      socket.write = function (...args) {
        writes++;
        if (!secure) writesBeforeSecure++;
        return write.apply(this, args);
      };
    },
  });
  const fatal = [];
  const provider = create({ apiKey, socketsForTest, reportProviderFatal: (...args) => fatal.push(args) });
  assertResult(await provider.send(nativeInput()), accepted);
  await closed;
  await new Promise(setImmediate);
  assert.equal(seen.httpEvents.length, 0, "revised transport published HTTP client diagnostics");
  assert.ok(!seen.entries.some((entry) => entry.name === "HttpClient"), "revised transport emitted HttpClient performance");
  assert.equal(seen.plainSockets.length, 1);
  assert.ok(seen.plainSockets[0] === tcp && tcp !== wrapped && !(tcp instanceof tls.TLSSocket) && tcp.encrypted !== true,
    "published socket is not exclusively plain TCP");
  assert.equal(seen.keylogEvents(), 0, "plain socket published TLS key material");
  const surface = Buffer.concat(seen.plainObservations).toString("utf8");
  assert.ok(canaries.every((canary) => !surface.includes(canary)), "plain socket observation contained a secret canary");
  assert.ok(Buffer.concat(peer.received).equals(expectedRequest), "TLS peer did not receive exact application bytes");
  assert.deepEqual([peer.connections(), peer.handshakes(), wraps, writes, writesBeforeSecure, fatal.length], [1, 1, 1, 1, 0, 0]);
  t.diagnostic("native TLS runtime " + process.version);
});

for (const [label, peerOptions, clientOptions, expected, authorizationError] of [
  ["trusted certificate without ALPN selection", { alpn: [] }, {}, accepted],
  ["wrong hostname", {}, { hostname: "wrong.example.invalid" }, unknown, "ERR_TLS_CERT_ALTNAME_INVALID"],
  ["untrusted certificate", {}, { trust: [] }, unknown, "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
  ["expired certificate", { cert: expiredCert }, {}, unknown, "CERT_HAS_EXPIRED"],
]) {
  test("native TLS: " + label, { timeout: 10_000 }, async (t) => {
    const peer = await tlsPeer(t, peerOptions);
    const errors = [];
    let wraps = 0;
    const socketsForTest = loopbackSockets(peer.port, {
      ...clientOptions,
      onWrap(socket) { wraps++; socket.on("error", (error) => errors.push(error.code)); },
    });
    const fatal = [];
    const provider = create({ apiKey, socketsForTest, reportProviderFatal: (...args) => fatal.push(args) });
    assertResult(await provider.send(nativeInput()), expected);
    assert.deepEqual([peer.connections(), wraps, fatal.length], [1, 1, 0]);
    if (expected === accepted) {
      assert.ok(Buffer.concat(peer.received).equals(expectedRequest), "no-ALPN request differs");
    } else {
      assert.equal(peer.received.length, 0, "certificate failure leaked HTTP bytes");
      assert.ok(errors.includes(authorizationError), "expected native verification failure");
    }
  });
}

for (const action of ["abort", "deadline"]) {
  test("native TLS stall consumes original budget during " + action, { timeout: 10_000 }, async (t) => {
    const controller = new AbortController();
    const server = net.createServer((socket) => { socket.resume(); });
    const port = await listenLocally(t, server);
    let wraps = 0;
    let writes = 0;
    let fatals = 0;
    const socketsForTest = loopbackSockets(port, {
      onWrap(socket) {
        wraps++;
        const write = socket.write;
        socket.write = function (...args) { writes++; return write.apply(this, args); };
        if (action === "abort") setImmediate(() => controller.abort());
      },
    });
    const provider = create({ apiKey, socketsForTest, reportProviderFatal() { fatals++; } });
    assertResult(await provider.send(nativeInput(controller, action === "deadline" ? 250 : 4000)), unknown);
    assert.deepEqual([wraps, writes, fatals], [1, 0, 0]);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
}


for (const action of ["abort", "deadline"]) {
  test("native TCP entry preserves ambiguity during " + action + " before TLS", { timeout: 10_000 }, async (t) => {
    const controller = new AbortController();
    const port = await listenLocally(t, net.createServer((socket) => socket.resume()));
    const input = nativeInput(controller);
    const monotonic = process.hrtime.bigint;
    let elapsed = false;
    t.mock.method(process.hrtime, "bigint", () => elapsed ? input.deadlineMonotonicNs : monotonic());
    let connections = 0;
    let wraps = 0;
    let fatals = 0;
    const socketsForTest = loopbackSockets(port, {
      onTcp(socket) {
        connections++;
        assert.ok(socket.connecting, "expected a pending native TCP attempt");
        if (action === "abort") controller.abort();
        else elapsed = true;
      },
      onWrap() { wraps++; },
    });
    const provider = create({ apiKey, socketsForTest, reportProviderFatal() { fatals++; } });
    assertResult(await provider.send(input), unknown);
    assert.deepEqual([connections, wraps, fatals], [1, 0, 0]);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
}
