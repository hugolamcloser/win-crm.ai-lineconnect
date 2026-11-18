const assert = require("node:assert/strict");
const { once } = require("node:events");
const http = require("node:http");
const net = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");
const { test } = require("node:test");
const { domainToASCII, domainToUnicode } = require("node:url");
const express = require("express");
const {
  parseEvery8dSettingsAuthPublicOrigin, readEvery8dSettingsAuthHttpConfig
} = require("../dist/config/every8dSettingsAuthHttp");
const {
  classifyEvery8dSettingsAuthRequestTarget: classify,
  createEvery8dSettingsAuthHttpBoundary,
  endEvery8dSettingsAuthError,
  endEvery8dSettingsAuthResponse,
  every8dSettingsAuthRoutes,
  matchEvery8dSettingsAuthDispatch: match,
  ownsEvery8dSettingsAuthTarget: owns
} = require("../dist/middleware/every8dSettingsAuthHttp");
const { parseEvery8dSettingsAuthJsonEnvelope: parse } = require("../dist/middleware/every8dSettingsAuthJson");

const origin = "https://settings.example";
const enabledEnv = {
  EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: "true",
  EVERY8D_SETTINGS_AUTH_HTTP_ENABLED: "true",
  EVERY8D_SETTINGS_AUTH_PUBLIC_BASE_URL: origin
};
const config = readEvery8dSettingsAuthHttpConfig(enabledEnv);
const login = "/settings/auth/login/challenge";
const body = '{"email":"synthetic"}';
const close = "Connection: close";
const postHeaders = ["Origin: " + origin, "Content-Type: application/json"];
const accepted = '{"status":"accepted"}';
const security = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(condition) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for loopback event");
    await delay(5);
  }
}

async function serve(t, options = {}) {
  const seen = [];
  const calls = [];
  const downstream = [];
  const telemetry = [];
  const globalErrors = [];
  const app = express();
  app.use(createEvery8dSettingsAuthHttpBoundary(options.config ?? config, {
    dispatch: input => {
      calls.push(input.route);
      if (options.dispatch) return options.dispatch(input);
      if (input.route === "GET /settings/auth") {
        return endEvery8dSettingsAuthResponse(input.res, "GET", 200, {
          type: "text/html", bytes: Buffer.from("<p>café</p>")
        });
      }
      if (input.route === "POST " + login) {
        return endEvery8dSettingsAuthResponse(input.res, "POST", 202, {
          type: "application/json", bytes: Buffer.from(accepted)
        });
      }
      endEvery8dSettingsAuthResponse(input.res, input.req.method, 204);
    },
    telemetry: event => {
      telemetry.push(event);
      return options.telemetry?.();
    }
  }));
  app.use((req, res) => {
    downstream.push(req.originalUrl);
    res.statusCode = 200;
    res.end("ordinary");
  });
  app.use((error, _req, res, _next) => {
    globalErrors.push(error);
    res.statusCode = 599;
    res.end();
  });

  const server = http.createServer((req, res) => {
    seen.push({ req, res });
    options.before?.(req, res, seen.length);
    app(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  return { server, seen, calls, downstream, telemetry, globalErrors };
}

async function connect(t, server) {
  const socket = net.connect(server.address().port, "127.0.0.1");
  const chunks = [];
  const finished = new Promise(resolve => {
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("error", () => {});
    socket.on("close", () => resolve(Buffer.concat(chunks)));
    socket.setTimeout(5000, () => socket.destroy());
  });
  t.after(() => socket.destroy());
  await once(socket, "connect");
  return { socket, finished, received: () => Buffer.concat(chunks).toString() };
}

function request(method, target, headers = [], bytes = "") {
  return Buffer.concat([
    Buffer.from([method + " " + target + " HTTP/1.1", "Host: loopback.example", ...headers, "", ""].join("\r\n")),
    Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  ]);
}

function post(bytes = body, headers = postHeaders, target = login) {
  return request("POST", target, [...headers, close, "Content-Length: " + Buffer.byteLength(bytes)], bytes);
}

async function exchange(t, server, data) {
  const client = await connect(t, server);
  client.socket.write(data);
  return client.finished;
}

function response(bytes) {
  const boundary = bytes.indexOf("\r\n\r\n");
  assert.ok(boundary > 0, "Expected a complete HTTP response header");
  const [status, ...lines] = bytes.subarray(0, boundary).toString().split("\r\n");
  const headers = Object.fromEntries(lines.map(line => {
    const i = line.indexOf(":");
    return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()];
  }));
  return { status: Number(status.split(" ")[1]), headers, body: bytes.subarray(boundary + 4) };
}

function checkError(bytes, status, code, { head = false, closing = true } = {}) {
  const wire = response(bytes);
  const expected = '{"error":"' + code + '"}';
  assert.equal(wire.status, status);
  assert.equal(wire.body.toString(), head ? "" : expected);
  assert.equal(wire.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(Number(wire.headers["content-length"]), Buffer.byteLength(expected));
  if (closing) assert.equal(wire.headers.connection, "close");
  for (const [name, value] of Object.entries(security)) assert.equal(wire.headers[name], value);
  assert.equal(wire.headers.etag, undefined);
  assert.equal(wire.headers.location, undefined);
}

test("strict public origin and operational AND gate", () => {
  for (const [input, output] of [
    [origin, origin], [origin + "/", origin], ["https://localhost:1", "https://localhost:1"],
    ["https://xn--bcher-kva.example:65535", "https://xn--bcher-kva.example:65535"],
    ["https://192.0.2.10:8443", "https://192.0.2.10:8443"], ["https://[2001:db8::1]/", "https://[2001:db8::1]"]
  ]) assert.equal(parseEvery8dSettingsAuthPublicOrigin(input), output);
  for (const input of [
    "", " http://settings.example", "http://settings.example", "HTTPS://settings.example",
    "https://Settings.example", "https://settings.example.", "https://-bad.example",
    "https://bad-.example", "https://" + "a".repeat(64) + ".example", "https://bad_name.example",
    "https://xn--.example", "https://bücher.example", "https://user@settings.example",
    origin + "/a", origin + "//", origin + "?", origin + "#", origin + "%2f", origin + "\\",
    origin + "\t", origin + "\n", "https://[fe80::1%25test]", "https://[2001:0db8:0:0:0:0:0:1]",
    "https://[2001:DB8::1]", "https://127.1", "https://0x7f000001", "https://192.0.2.010",
    ...["443", "0444", "+444", "0", "65536", ""].map(port => origin + ":" + port)
  ]) assert.throws(() => parseEvery8dSettingsAuthPublicOrigin(input), { name: "Every8dSettingsAuthHttpConfigurationError" });

  for (const challenges of [false, true]) {
    for (const enabled of [false, true]) {
      const value = readEvery8dSettingsAuthHttpConfig({
        ...enabledEnv, EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: String(challenges),
        EVERY8D_SETTINGS_AUTH_HTTP_ENABLED: String(enabled),
        EVERY8D_SETTINGS_AUTH_EMAIL_DISPATCH_ENABLED: "irrelevant"
      });
      assert.equal(value.operational, challenges && enabled);
      assert.equal(value.publicOrigin, origin);
    }
  }
  assert.equal(readEvery8dSettingsAuthHttpConfig({}).operational, false);
  assert.throws(() => readEvery8dSettingsAuthHttpConfig({ ...enabledEnv, EVERY8D_SETTINGS_AUTH_PUBLIC_BASE_URL: undefined }));
  assert.throws(() => readEvery8dSettingsAuthHttpConfig({ EVERY8D_SETTINGS_AUTH_PUBLIC_BASE_URL: "https://BAD.example" }));
  assert.throws(() => readEvery8dSettingsAuthHttpConfig({ EVERY8D_SETTINGS_AUTH_HTTP_ENABLED: " false" }));
});

test("request target forms preserve original spelling and classify only one secondary pass", () => {
  for (const path of [
    "/settings/auth", "/settings/auth/", "/SETTINGS/AUTH/../other", "/Settings/Auth/%2e%2e/other",
    "/SETTINGS/AUTH/%zz", "/settings/auth/%2e%2e/other", "/settings\\auth",
    "/settings%5Cauth", "/settings%2fauth", "/settings/./auth", "/unrelated/../settings/auth",
    "/../settings/auth", "/settings/%61uth", "/sEtTiNgS/%61uTh"
  ]) {
    for (const prefix of ["", "https://untrusted.example", "hTtP://untrusted.example"]) {
      assert.equal(owns(classify(prefix + path)), true, prefix + path);
    }
  }
  for (const path of [
    "//settings/auth", "/settings//auth", "/settings/authentic", "/settings/auth-other",
    "/settings/auth2", "/settings/authorization", "/settings/%61uthentic", "/settings/%61uth-other",
    "/settings/auth%32", "/settings/%2561uth", "/settings/auth%3F", "/settings/%zz",
    "/settings/%", "/settings/%z", "/settings/%0z", "/settings/%e1uth"
  ]) {
    for (const prefix of ["", "https://untrusted.example", "http://untrusted.example"]) {
      assert.equal(owns(classify(prefix + path)), false, prefix + path);
    }
  }
  assert.deepEqual(classify("HtTpS://anything/settings\\auth/%zz?tail"), {
    form: "ABSOLUTE_FORM_HTTPS", rawPath: "/settings\\auth/%zz", queryDelimiterPresent: true
  });
  assert.deepEqual(classify("HTTP://host?query/ignored"), {
    form: "ABSOLUTE_FORM_HTTP", rawPath: "/", queryDelimiterPresent: true
  });
  assert.deepEqual(classify("https://host"), {
    form: "ABSOLUTE_FORM_HTTPS", rawPath: "/", queryDelimiterPresent: false
  });
  assert.deepEqual(classify("/settings/auth%3F?"), {
    form: "ORIGIN_FORM", rawPath: "/settings/auth%3F", queryDelimiterPresent: true
  });
  for (const target of ["*", "host:443", "ftp://host/settings/auth", "http://?host"]) {
    assert.deepEqual(classify(target), { form: "OTHER_FORM" });
  }
  assert.deepEqual(Object.keys(every8dSettingsAuthRoutes), [
    "GET /settings/auth", "GET /settings/auth/csrf", "POST /settings/auth/enrollment/challenge",
    "POST /settings/auth/enrollment/verify", "POST " + login, "POST /settings/auth/login/verify",
    "GET /settings/auth/session", "POST /settings/auth/logout"
  ]);
  for (const route of Object.keys(every8dSettingsAuthRoutes)) {
    const [method, path] = route.split(" ");
    assert.equal(match(method, classify(path)), route);
    assert.equal(match(method, classify(path + "?")), undefined);
    assert.equal(match(method, classify("https://host" + path)), undefined);
    assert.equal(match(method.toLowerCase(), classify(path)), undefined);
  }
});

test("claimed aliases and absolute targets stay local while genuine neighbors pass through", async t => {
  const h = await serve(t);
  for (const path of [
    "/settings/auth/", "/SeTtInGs/AUTH", "/SETTINGS/AUTH/../other", "/settings/auth/%zz",
    "/settings/%61uth", "/settings/auth/about", "/settings/auth/%3F", "/settings%5cauth",
    "http://outside/settings/auth", "http://outside/SETTINGS/AUTH", "https://outside/settings/auth?",
    "https://outside/settings/%61uth", "http://outside/settings/auth/%zz",
    "http://outside/SETTINGS/AUTH/../../other"
  ]) checkError(await exchange(t, h.server, request("GET", path, [close])), 404, "not_available");
  for (const path of ["/settings/auth?", "/settings/auth?key=1"]) {
    checkError(await exchange(t, h.server, request("GET", path, [close])), 400, "invalid_request");
  }
  checkError(await exchange(t, h.server, request("HEAD", "/settings/auth", [close])), 404, "not_available", { head: true });
  checkError(await exchange(t, h.server, request("OPTIONS", "/settings/auth", [close])), 404, "not_available");
  assert.deepEqual(h.downstream, []);
  assert.deepEqual(h.calls, []);

  for (const [method, path] of [
    ["GET", "/settings/authentic"], ["GET", "http://outside/settings/%61uthentic"],
    ["GET", "http://outside"], ["OPTIONS", "*"]
  ]) assert.equal(response(await exchange(t, h.server, request(method, path, [close]))).body.toString(), "ordinary");
  assert.equal(h.downstream.length, 4);
  assert.deepEqual(h.globalErrors, []);

  const disabled = await serve(t, { config: readEvery8dSettingsAuthHttpConfig({}) });
  checkError(await exchange(t, disabled.server, request("GET", "/settings/auth", [close])), 404, "not_available");
  assert.deepEqual(disabled.calls, []);
});

test("Node v22.23.4 default header ceiling and application saturation cutoff", async t => {
  let bodyReaders = 0;
  const h = await serve(t, {
    before(req) {
      const on = req.on;
      req.on = function (name, listener) {
        if (name === "data") bodyReaders++;
        return on.call(this, name, listener);
      };
    }
  });
  assert.equal(h.server.maxHeadersCount, null);
  for (const count of [999, 1000, 1001]) {
    const before = h.seen.length;
    const headers = [...postHeaders, close, "Content-Length: " + body.length,
      ...Array(count - 5).fill("X: a")];
    const bytes = await exchange(t, h.server, request("POST", login, headers, body));
    if (count === 1001) {
      const status = response(bytes).status;
      if (process.version === "v22.23.4" || status === 431) {
        assert.equal(status, 431);
        assert.equal(h.seen.length, before);
        assert.equal(h.telemetry.length, 2);
      } else {
        // Other supported releases can truncate collection and still deliver the request.
        checkError(bytes, 400, "invalid_request");
        assert.equal(h.seen.length, before + 1);
        assert.ok(h.seen.at(-1).req.rawHeaders.length >= 2000);
      }
    } else {
      assert.equal(h.seen.length, before + 1);
      assert.equal(h.seen.at(-1).req.rawHeaders.length, count * 2);
      if (count === 1000) checkError(bytes, 400, "invalid_request");
      else assert.equal(response(bytes).status, 202);
    }
  }
  assert.equal(bodyReaders, 1);
  assert.deepEqual(h.calls, ["POST " + login]);
  assert.deepEqual(h.downstream, []);
});

test("raw Origin and media admission ignore forwarded trust and reject ambiguous fields", async t => {
  const h = await serve(t);
  for (const headers of [
    ["Content-Type: application/json", "Forwarded: proto=https;host=settings.example"],
    ["Origin: null", postHeaders[1]], ["Origin: " + origin + "/", postHeaders[1]],
    ["Origin: " + origin + ", " + origin, postHeaders[1]],
    [...postHeaders, "oRiGiN: " + origin],
    ["Origin: https://wrong.example", postHeaders[1], "X-Forwarded-Host: settings.example"]
  ]) checkError(await exchange(t, h.server, post(body, headers)), 403, "request_rejected");

  for (const media of [
    [], ["Content-Type: application/json", "Content-Type: application/json"],
    ["Content-Type: application/json, application/json"], ['Content-Type: application/json; charset="utf-8"'],
    ["Content-Type: application/json; charset=utf-8; charset=utf-8"],
    ["Content-Type: application/json; charset=iso-8859-1"], ["Content-Type: text/plain"],
    [postHeaders[1], "Content-Encoding: gzip"], [postHeaders[1], "Content-Encoding: identity, identity"],
    [postHeaders[1], "Content-Encoding: identity", "Content-Encoding: identity"]
  ]) checkError(await exchange(t, h.server, post(body, [postHeaders[0], ...media])), 415, "unsupported_media_type");
  assert.deepEqual(h.calls, []);
  assert.equal(response(await exchange(t, h.server, post(body, [
    postHeaders[0], "Content-Type: Application/JSON; CHARSET=UTF-8", "Content-Encoding: IDENTITY"
  ]))).status, 202);
});

function chunked(bytes, complete = true) {
  return Buffer.concat([
    Buffer.from(bytes.length.toString(16) + "\r\n"),
    bytes, Buffer.from(complete ? "\r\n0\r\n\r\n" : "\r\n")
  ]);
}

test("framing distinguishes native parser errors from bounded application admission", async t => {
  const h = await serve(t);
  const atLimit = Buffer.from(body.padEnd(8192));
  const overLimit = Buffer.from(body.padEnd(8193));
  const sendChunked = (bytes, encoding = "ChUnKeD") => exchange(t, h.server, request("POST", login, [
    ...postHeaders, close, "Transfer-Encoding: " + encoding
  ], chunked(bytes)));
  assert.equal(response(await exchange(t, h.server, post(atLimit))).status, 202);
  assert.equal(response(await sendChunked(atLimit)).status, 202);
  checkError(await sendChunked(overLimit), 413, "payload_too_large");
  checkError(await exchange(t, h.server, request("POST", login, [
    ...postHeaders, "Content-Length: 8193"
  ])), 413, "payload_too_large");
  checkError(await exchange(t, h.server, request("POST", login, [
    ...postHeaders, "Content-Length: 9007199254740993"
  ])), 413, "payload_too_large");
  checkError(await exchange(t, h.server, request("POST", login, [
    ...postHeaders, "Content-Length: 00"
  ])), 400, "invalid_request");
  for (const encoding of ["gzip, chunked", "identity", "chunked ;x=y"]) {
    const before = h.seen.length;
    checkError(await sendChunked(Buffer.from(body), encoding), 400, "invalid_request");
    assert.equal(h.seen.length, before + 1);
  }
  for (const framing of [
    ["Content-Length: +1"], ["Content-Length: 1.0"], ["Content-Length: 1 2"], ["Content-Length:"],
    ["Content-Length: 0", "Content-Length: 0"], ["Content-Length: 0", "Transfer-Encoding: chunked"],
    ["Transfer-Encoding: chunked", "Transfer-Encoding: chunked"]
  ]) {
    const before = h.seen.length;
    const wire = response(await exchange(t, h.server, request("POST", login, [...postHeaders, close, ...framing])));
    assert.equal(wire.status, 400);
    assert.equal(wire.body.length, 0);
    assert.equal(h.seen.length, before);
  }

  const eof = await connect(t, h.server);
  const before = h.seen.length;
  eof.socket.end(request("POST", login, [...postHeaders, "Content-Length: 20"], "{"));
  await eof.finished;
  assert.equal(h.seen.length, before + 1);
  await waitFor(() => h.seen.at(-1).req.destroyed);

  const abandoned = await connect(t, h.server);
  abandoned.socket.write(request("POST", login, [...postHeaders, "Transfer-Encoding: chunked"], "2\r\n{"));
  await waitFor(() => h.seen.length === before + 2);
  abandoned.socket.destroy();
  await abandoned.finished;
  await waitFor(() => h.seen.at(-1).req.destroyed);
  assert.deepEqual(h.calls, ["POST " + login, "POST " + login]);
  assert.deepEqual(h.downstream, []);
  assert.deepEqual(h.globalErrors, []);
});

test("strict JSON requires an exact flat all-string envelope and fatal UTF-8", async t => {
  const loginFields = every8dSettingsAuthRoutes["POST " + login];
  const enrollment = "POST /settings/auth/enrollment/challenge";
  const malformed = [
    Buffer.from([0x7b, 0xc3, 0x28, 0x7d]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body)]),
    '{"email":"one","em\\u0061il":"two"}', '{"unknown":"value"}', '{}',
    '{"email":null}', '{"email":true}', '{"email":0}', '{"email":{"nested":"value"}}',
    '{"email":["value"]}', '{"email":"value"} {}', '{"email":"value",}', '{"email":"\\x00"}',
    '["value"]', '{"email":"value"}\u00a0'
  ];
  for (const bytes of malformed) assert.equal(parse(Buffer.from(bytes), loginFields), undefined);
  assert.equal(parse(Buffer.from('{"em\\u0061il":"\\u0000"}'), loginFields).email, "\x00");
  const enrollmentBody = Buffer.from('{"enrollmentCapability":"?","email":""}');
  const parsed = parse(enrollmentBody, every8dSettingsAuthRoutes[enrollment]);
  assert.equal(parsed.enrollmentCapability, "?");
  assert.equal(parsed.email, "");
  assert.ok(parse(Buffer.from(" \r\n{}\t"), every8dSettingsAuthRoutes["POST /settings/auth/logout"]));
  assert.ok(parse(Buffer.from(body.padEnd(8192)), loginFields));
  assert.equal(parse(Buffer.from(body.padEnd(8193)), loginFields), undefined);

  const h = await serve(t);
  for (const bytes of malformed) {
    checkError(await exchange(t, h.server, post(bytes)), 400, "invalid_request");
  }
  assert.equal(response(await exchange(t, h.server, post(enrollmentBody, postHeaders, enrollment.slice(5)))).status, 204);
  assert.deepEqual(h.calls, [enrollment]);
  assert.deepEqual(h.globalErrors, []);
});

function keptPost(bytes = body) {
  return request("POST", login, [...postHeaders, "Content-Length: " + Buffer.byteLength(bytes)], bytes);
}

function followUp(path, closeAfter = false) {
  return request("GET", path, closeAfter ? [close] : []);
}

function wireStatuses(wire) {
  return [...wire.matchAll(/HTTP\/1\.1 (\d{3}) /g)].map(match => Number(match[1]));
}

test("completed owner retains two waiters through execution and reusably finishing", async t => {
  const release = deferred();
  const h = await serve(t, {
    async dispatch({ req, res }) {
      assert.ok(req.complete && req.readableEnded);
      await release.promise;
      endEvery8dSettingsAuthResponse(res, "POST", 204);
    }
  });
  const client = await connect(t, h.server);
  client.socket.write(Buffer.concat([keptPost(), followUp("/first"), followUp("/second", true)]));
  await waitFor(() => h.seen.length === 3 && h.calls.length === 1);
  assert.deepEqual(h.downstream, []);
  assert.equal(h.seen[0].res.writableFinished, false);
  assert.equal(client.received(), "");
  release.resolve();
  assert.deepEqual(wireStatuses((await client.finished).toString()), [204, 200, 200]);
  assert.deepEqual(h.downstream, ["/first", "/second"]);
  assert.deepEqual(h.globalErrors, []);
});

test("fully read JSON rejection permits ordered follow-ups only after response finish", async t => {
  const queuedEnd = deferred();
  const h = await serve(t, {
    before(req, res, index) {
      if (index !== 1) return;
      const end = res.end.bind(res);
      res.end = function (...args) {
        queuedEnd.resolve(() => end(...args));
        return res;
      };
    }
  });
  const client = await connect(t, h.server);
  client.socket.write(Buffer.concat([keptPost("{}"), followUp("/first"), followUp("/second", true)]));
  const end = await queuedEnd.promise;
  await waitFor(() => h.seen.length === 3);
  assert.equal(h.seen[0].req.readableEnded, true);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.downstream, []);
  end();
  const wire = (await client.finished).toString();
  assert.deepEqual(wireStatuses(wire), [400, 200, 200]);
  assert.ok(wire.includes('{"error":"invalid_request"}'));
  assert.deepEqual(h.downstream, ["/first", "/second"]);
});

test("late explicit and implicit closing block every waiter after complete body", async t => {
  for (const explicit of [true, false]) {
    const release = deferred();
    const h = await serve(t, {
      async dispatch({ req, res }) {
        assert.equal(req.readableEnded, true);
        await release.promise;
        if (explicit) res.setHeader("Connection", "close");
        else res.shouldKeepAlive = false;
        endEvery8dSettingsAuthResponse(res, "POST", 204);
      }
    });
    const client = await connect(t, h.server);
    client.socket.write(Buffer.concat([keptPost(), followUp("/first"), followUp("/second")]));
    await waitFor(() => h.seen.length === 3 && h.calls.length === 1);
    assert.deepEqual(h.downstream, []);
    release.resolve();
    const wire = response(await client.finished);
    assert.equal(wire.status, 204);
    assert.equal(wire.headers.connection, "close");
    assert.equal(wire.body.length, 0);
    assert.deepEqual(h.downstream, []);
    assert.deepEqual(h.globalErrors, []);
  }
});

test("8193rd byte and unread-body rejection close pipelines before downstream", async t => {
  const h = await serve(t);
  const client = await connect(t, h.server);
  const first = chunked(Buffer.from(body.padEnd(8192)), false);
  client.socket.write(request("POST", login, [...postHeaders, "Transfer-Encoding: chunked"], first));
  await waitFor(() => h.seen.length === 1 && h.seen[0].req.readableFlowing === true);
  assert.equal(h.seen[0].req.readableEnded, false);
  assert.equal(client.received(), "");
  client.socket.write(Buffer.concat([
    Buffer.from("1\r\n \r\n0\r\n\r\n"), followUp("/first"), followUp("/second")
  ]));
  checkError(await client.finished, 413, "payload_too_large");
  assert.equal(h.seen.length, 3);
  assert.deepEqual(h.downstream, []);
  assert.deepEqual(h.calls, []);

  const next = await connect(t, h.server);
  next.socket.write(Buffer.concat([
    request("POST", login, [postHeaders[1], "Content-Length: " + body.length], body),
    followUp("/ordinary")
  ]));
  checkError(await next.finished, 403, "request_rejected");
  assert.deepEqual(h.downstream, []);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.globalErrors, []);
});

test("socket or response close before finish blocks waiters through duplicate notifications", async t => {
  for (const bySocket of [true, false]) {
    const release = deferred();
    const h = await serve(t, { dispatch: () => release.promise });
    const client = await connect(t, h.server);
    client.socket.write(Buffer.concat([keptPost(), followUp("/first"), followUp("/second")]));
    await waitFor(() => h.seen.length === 3 && h.calls.length === 1);
    const { req, res } = h.seen[0];
    if (bySocket) client.socket.destroy();
    else res.destroy();
    assert.equal((await client.finished).byteLength, 0);
    await waitFor(() => req.socket.destroyed && h.telemetry.length === 1);
    res.emit("close");
    req.emit("aborted");
    req.socket.emit("close");
    release.resolve();
    assert.equal(h.telemetry.length, 1);
    assert.equal(h.telemetry[0].category, "transport_closed");
    assert.deepEqual(h.downstream, []);
    assert.deepEqual(h.globalErrors, []);
  }
});

test("first resumed auth waiter takes ownership before the next waiter is released", async t => {
  const owner = [deferred(), deferred()];
  const h = await serve(t, {
    async dispatch({ res }) {
      await owner.shift().promise;
      endEvery8dSettingsAuthResponse(res, "POST", 204);
    }
  });
  const [first, second] = owner;
  const client = await connect(t, h.server);
  client.socket.write(Buffer.concat([keptPost(), keptPost(), followUp("/ordinary", true)]));
  await waitFor(() => h.seen.length === 3 && h.calls.length === 1);
  assert.deepEqual(h.downstream, []);
  first.resolve();
  await waitFor(() => h.calls.length === 2);
  assert.deepEqual(h.downstream, []);
  // Duplicate notifications on the finished response cannot close the new owner's gate.
  h.seen[0].res.emit("error", new Error("synthetic-late-response-event"));
  h.seen[0].res.emit("close");
  assert.equal(h.seen[1].req.socket.destroyed, false);
  second.resolve();
  assert.deepEqual(wireStatuses((await client.finished).toString()), [204, 204, 200]);
  assert.deepEqual(h.downstream, ["/ordinary"]);
  assert.equal(h.telemetry.length, 2);
});

test("early response finish cannot release waiters during a rejected dispatch", async t => {
  const release = deferred();
  const h = await serve(t, {
    async dispatch({ res }) {
      endEvery8dSettingsAuthResponse(res, "POST", 204);
      await release.promise;
      throw new Error("synthetic-dispatch-failure");
    }
  });
  const client = await connect(t, h.server);
  client.socket.write(Buffer.concat([keptPost(), followUp("/first"), followUp("/second")]));
  await waitFor(() => h.seen.length === 3 && h.seen[0].res.writableFinished);
  assert.deepEqual(h.downstream, []);
  release.resolve();
  assert.deepEqual(wireStatuses((await client.finished).toString()), [204]);
  assert.deepEqual(h.downstream, []);
  assert.deepEqual(h.globalErrors, []);
});

test("fixed errors and direct representations ignore negotiation and validators", async t => {
  const errors = Object.entries({
    not_available: 404, invalid_request: 400, request_rejected: 403, payload_too_large: 413,
    unsupported_media_type: 415, try_later: 429, authentication_failed: 400, unauthorized: 401,
    temporarily_unavailable: 503
  });
  const fixed = await serve(t, {
    dispatch({ req, res }) {
      endEvery8dSettingsAuthError(res, req.method, errors.shift()[0]);
    }
  });
  for (const [error, status] of [...errors]) {
    checkError(await exchange(t, fixed.server, request("GET", "/settings/auth", [
      close, "Accept: text/plain", 'If-None-Match: "*"'
    ])), status, error);
  }

  const h = await serve(t);
  const document = response(await exchange(t, h.server, request("GET", "/settings/auth", [
    close, "Accept: application/xml", "If-None-Match: *"
  ])));
  assert.equal(document.status, 200);
  assert.equal(document.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(Number(document.headers["content-length"]), Buffer.byteLength("<p>café</p>"));
  assert.equal(document.body.toString(), "<p>café</p>");
  assert.equal(document.headers.etag, undefined);
  assert.equal(document.headers.location, undefined);
  const empty = response(await exchange(t, h.server, request("GET", "/settings/auth/session", [close])));
  assert.equal(empty.status, 204);
  assert.equal(empty.headers["content-length"], undefined);
  assert.equal(empty.headers["transfer-encoding"], undefined);
  assert.equal(empty.body.length, 0);
});

test("local error containment and telemetry exclude request and error sentinels", async t => {
  const sentinels = ["synthetic-target-value", "synthetic-header-value", "synthetic-cookie-value",
    "synthetic-body-value", "synthetic-error-value"];
  let calls = 0;
  const h = await serve(t, {
    dispatch({ res }) {
      calls++;
      if (calls === 1) throw new Error(sentinels[4]);
      if (calls === 2) return Promise.reject(new Error(sentinels[4]));
      res.writeHead(200, { "Content-Length": 80 });
      res.write("partial");
      return Promise.reject(new Error(sentinels[4]));
    },
    telemetry: () => Promise.reject(new Error("synthetic-telemetry-failure"))
  });
  const markerBody = JSON.stringify({ email: sentinels[3] });
  const headers = [...postHeaders, "X-Synthetic: " + sentinels[1], "Cookie: key=" + sentinels[2]];
  const output = [];
  output.push(await exchange(t, h.server, post(markerBody, headers, login + "?" + sentinels[0])));
  checkError(output[0], 400, "invalid_request");
  for (let count = 0; count < 2; count++) {
    const bytes = await exchange(t, h.server, post(markerBody, headers));
    checkError(bytes, 503, "temporarily_unavailable");
    output.push(bytes);
  }
  const partial = await exchange(t, h.server, post(markerBody, headers));
  assert.ok(wireStatuses(partial.toString()).length <= 1);
  output.push(partial);
  await waitFor(() => h.telemetry.length === 4);
  assert.deepEqual(h.globalErrors, []);
  assert.deepEqual(h.downstream, []);
  for (const event of h.telemetry) {
    assert.deepEqual(Object.keys(event).sort(), ["category", "count", "event", "latency", "method", "route", "statusClass"]);
    assert.equal(event.route, "/settings/auth/*");
    assert.equal(event.count, 1);
  }
  assert.equal(sentinels.some(sentinel => JSON.stringify(h.telemetry).includes(sentinel) ||
    output.some(bytes => bytes.includes(sentinel))), false);
});

test("canonical IDNA A-label roundtrip applies to every supplied origin, including disabled config", () => {
  assert.equal(domainToASCII(domainToUnicode("xn--bcher-kva")), "xn--bcher-kva");
  assert.equal(parseEvery8dSettingsAuthPublicOrigin("https://xn--bcher-kva.example/"),
    "https://xn--bcher-kva.example");

  assert.equal(domainToUnicode("xn---bga"), "œ");
  assert.equal(domainToASCII(domainToUnicode("xn---bga")), "xn--bga");
  assert.equal(new URL("https://xn---bga.example").origin, "https://xn---bga.example");
  assert.equal(domainToUnicode("xn--a"), "");

  for (const label of ["xn---bga", "xn--a"]) {
    const value = "https://example." + label;
    const error = { name: "Every8dSettingsAuthHttpConfigurationError" };
    assert.throws(() => parseEvery8dSettingsAuthPublicOrigin(value), error);
    for (const flag of ["EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED", "EVERY8D_SETTINGS_AUTH_HTTP_ENABLED"]) {
      const disabled = { ...enabledEnv, [flag]: "false", EVERY8D_SETTINGS_AUTH_PUBLIC_BASE_URL: value };
      assert.throws(() => readEvery8dSettingsAuthHttpConfig(disabled), error);
      delete disabled.EVERY8D_SETTINGS_AUTH_PUBLIC_BASE_URL;
      assert.equal(readEvery8dSettingsAuthHttpConfig(disabled).operational, false);
    }
  }
});

test("Node delivers empty-authority and literal-fragment targets with ownership-only rejection", async t => {
  const h = await serve(t);
  const malformed = classify("hTtPs:///settings/auth");
  assert.equal(malformed.form, "MALFORMED_HTTP_ABSOLUTE_FORM");
  assert.equal(malformed.rawPath, "/settings/auth");
  assert.equal(match("GET", malformed), undefined);
  assert.equal(owns(classify("/settings/auth%23fragment")), false);
  assert.equal(owns(classify("/ordinary#fragment#settings/auth")), false);

  const protectedTargets = [
    "https:///settings/auth", "http:///settings/%61uth",
    "/settings/auth#fragment", "/settings/%61uth#fragment",
    "https://outside/settings/auth#fragment", "https:///settings/auth#fragment"
  ];
  for (const target of protectedTargets) {
    const before = h.seen.length;
    checkError(await exchange(t, h.server, request("GET", target, [close])), 404, "not_available");
    assert.equal(h.seen.length, before + 1);
    assert.equal(h.seen.at(-1).req.originalUrl, target);
  }
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.downstream, []);
  assert.equal(h.telemetry.length, protectedTargets.length);

  const neighbors = [
    "https:///settings/authentic",
    "/settings/authentic#fragment",
    "https://outside/settings/authentic#fragment",
    "https:///settings/authentic#fragment"
  ];
  for (const target of neighbors) {
    const wire = response(await exchange(t, h.server, request("GET", target, [close])));
    assert.equal(wire.status, 200);
    assert.equal(wire.body.toString(), "ordinary");
  }
  assert.deepEqual(h.downstream, neighbors);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.globalErrors, []);
});

test("exact GETs dispatch bodylessly and reject body framing without a reader or follower", async t => {
  let readers = 0;
  const h = await serve(t, {
    before(req) {
      const on = req.on;
      req.on = function (name, listener) {
        if (name === "data") readers++;
        return on.call(this, name, listener);
      };
    },
    dispatch({ req, res, envelope }) {
      assert.equal(req.readableEnded, false);
      assert.equal(envelope, undefined);
      endEvery8dSettingsAuthResponse(res, req.method, 204);
    }
  });
  const route = "/settings/auth/csrf";
  for (const headers of [[close], [close, "Content-Length: 0"]]) {
    const before = h.calls.length;
    assert.equal(response(await exchange(t, h.server, request("GET", route, headers))).status, 204);
    assert.equal(h.calls.length, before + 1);
  }
  checkError(await exchange(t, h.server, request("HEAD", route, [close])), 404, "not_available", { head: true });
  checkError(await exchange(t, h.server, request("OPTIONS", route, [close])), 404, "not_available");

  for (const [framing, bytes] of [
    ["Content-Length: 4", "test"],
    ["Transfer-Encoding: chunked", "0\r\n\r\n"]
  ]) {
    const pipelined = Buffer.concat([request("GET", route, [framing], bytes), followUp("/ordinary")]);
    checkError(await exchange(t, h.server, pipelined), 400, "invalid_request");
  }
  const incomplete = await connect(t, h.server);
  incomplete.socket.write(request("GET", route, ["Content-Length: 10"], "x"));
  checkError(await incomplete.finished, 400, "invalid_request");
  checkError(await exchange(t, h.server, request("GET", route, [
    "Content-Length: 8193"
  ])), 413, "payload_too_large");
  assert.equal(readers, 0);
  assert.deepEqual(h.calls, ["GET " + route, "GET " + route]);
  assert.deepEqual(h.downstream, []);
  assert.deepEqual(h.globalErrors, []);
});

test("claimed framing errors precede exactness, query, absolute-form and disabled decisions", async t => {
  const enabled = await serve(t);
  const disabled = await serve(t, { config: readEvery8dSettingsAuthHttpConfig({}) });
  for (const [h, target] of [
    [enabled, "/settings/auth"], [disabled, "/settings/auth"], [enabled, "/SETTINGS/AUTH"],
    [enabled, "https://outside/settings/auth"], [enabled, "/settings/auth?"],
    [enabled, "https:///settings/auth#fragment"]
  ]) {
    checkError(await exchange(t, h.server, request("GET", target, ["Content-Length: 00"])), 400, "invalid_request");
  }
  checkError(await exchange(t, disabled.server, request("GET", "/settings/auth?query", [
    "Content-Length: 8193"
  ])), 413, "payload_too_large");
  checkError(await exchange(t, enabled.server, request("GET", "https://outside/settings/auth?query", [
    close, "Content-Length: 0"
  ])), 404, "not_available");
  checkError(await exchange(t, enabled.server, request("GET", "/settings/auth?query", [
    close, "Content-Length: 0"
  ])), 400, "invalid_request");
  for (const h of [enabled, disabled]) {
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.downstream, []);
    assert.deepEqual(h.globalErrors, []);
  }
});

const stagedRepresentationHeaders = {
  "content-type": "text/plain",
  "content-length": "999",
  "transfer-encoding": "chunked",
  "content-encoding": "gzip",
  "content-range": "bytes 0-1/2",
  trailer: "X-Synthetic-Trailer",
  location: "/synthetic",
  etag: '"synthetic"',
  "last-modified": "Thu, 01 Jan 1970 00:00:00 GMT"
};
const successfulCookie = "review-synthetic=ok; Path=/";

function stageResponseHeaders(res) {
  for (const [name, value] of Object.entries(stagedRepresentationHeaders)) res.setHeader(name, value);
  res.setHeader("Set-Cookie", successfulCookie);
}

test("represented success and 204 replace stale headers and preserve intentional cookies", async t => {
  const encoded = Buffer.from("<p>café</p>");
  const h = await serve(t, {
    dispatch({ route, req, res }) {
      stageResponseHeaders(res);
      if (route === "GET /settings/auth") {
        endEvery8dSettingsAuthResponse(res, req.method, 200, { type: "text/html", bytes: encoded });
      } else {
        endEvery8dSettingsAuthResponse(res, req.method, 204);
      }
    }
  });
  const represented = response(await exchange(t, h.server, request("GET", "/settings/auth", [close])));
  const empty = response(await exchange(t, h.server, request("GET", "/settings/auth/session", [close])));
  assert.equal(represented.status, 200);
  assert.equal(represented.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(represented.headers["content-length"], String(encoded.length));
  assert.deepEqual(represented.body, encoded);
  assert.equal(empty.status, 204);
  assert.equal(empty.body.length, 0);
  for (const name of Object.keys(stagedRepresentationHeaders)) {
    assert.equal(empty.headers[name], undefined);
    if (name !== "content-type" && name !== "content-length") {
      assert.equal(represented.headers[name], undefined);
    }
  }
  for (const wire of [represented, empty]) assert.equal(wire.headers["set-cookie"], successfulCookie);
  assert.deepEqual(h.globalErrors, []);
});

test("sync and async dispatch fallbacks rebuild fixed headers and keep the close decision", async t => {
  for (const asynchronous of [false, true]) {
    const h = await serve(t, {
      dispatch({ res }) {
        stageResponseHeaders(res);
        res.setHeader("X-Provisional", "synthetic");
        res.setHeader("Vary", "Accept");
        res.setHeader("Connection", "keep-alive");
        const failure = new Error("synthetic-handler-failure");
        if (asynchronous) return Promise.reject(failure);
        throw failure;
      }
    });
    const client = await connect(t, h.server);
    client.socket.write(Buffer.concat([keptPost(), followUp("/ordinary")]));
    const reply = await client.finished;
    checkError(reply, 503, "temporarily_unavailable");
    const { headers } = response(reply);
    for (const name of ["set-cookie", "x-provisional", "vary", ...Object.keys(stagedRepresentationHeaders)]) {
      if (name !== "content-type" && name !== "content-length") assert.equal(headers[name], undefined);
    }
    assert.deepEqual(h.calls, ["POST " + login]);
    assert.deepEqual(h.downstream, []);
    assert.deepEqual(h.globalErrors, []);
  }
});
