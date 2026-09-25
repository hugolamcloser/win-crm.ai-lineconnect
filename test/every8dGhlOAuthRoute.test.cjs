const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const test = require("node:test");

const { Every8dGhlOAuthError } = require("../dist/services/every8dGhlOAuthService");
const { createEvery8dGhlOAuthRouter } = require("../dist/routes/every8dGhlOAuth");

const launcherPath = "/oauth/every8d-connect/launch";
const launcherOrigin = "https://win-crm.up.railway.app";

async function startRouter(runtime, triggerReconcile = () => undefined, initiationGuard = (_req, _res, next) => next()) {
  const app = express();
  app.use(express.json());
  app.use(createEvery8dGhlOAuthRouter({ runtime, triggerReconcile, now: () => 1_000_000, initiationGuard }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function runtime(overrides = {}) {
  const result = {
    isEnabled: () => true,
    start: async () => ({
      authorizationUrl: "https://app.gohighlevel.com/install?state=synthetic-state",
      browserBinding: "synthetic-binding",
      expiresAt: new Date(1_600_000).toISOString()
    }),
    initiate: async () => ({
      authorizationUrl: "https://app.gohighlevel.com/install?state=installed-state",
      browserBinding: "installed-binding",
      expiresAt: new Date(1_600_000).toISOString()
    }),
    acceptCallback: async () => ({ status: "pending", ready: false }),
    completeCallback: async () => ({ status: "pending", ready: false }),
    getStatus: async () => "waiting_install",
    ...overrides
  };
  if (!overrides.completeCallback && overrides.acceptCallback) {
    result.completeCallback = overrides.acceptCallback;
  }
  return result;
}

function launcherHeaders(overrides = {}) {
  return {
    origin: launcherOrigin,
    "content-type": "application/x-www-form-urlencoded",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
    ...overrides
  };
}

async function sendRawLauncher(baseUrl, { path = launcherPath, headers = {}, body } = {}) {
  const target = new URL(baseUrl);
  const requestHeaders = launcherHeaders();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) delete requestHeaders[name];
    else requestHeaders[name] = value;
  }
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path,
      method: "POST",
      headers: requestHeaders
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => {
        response.body = Buffer.concat(chunks).toString("utf8");
        resolve(response);
      });
    });
    request.once("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function oneLauncherHref(body) {
  const anchors = [...body.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/gi)];
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0][2], "Continue to HighLevel");
  const href = anchors[0][1].match(/\bhref="([^"]*)"/i);
  assert.ok(href);
  assert.match(anchors[0][1], /\brel="noreferrer"/i);
  assert.doesNotMatch(anchors[0][1], /\btarget=/i);
  return decodeHtmlAttribute(href[1]);
}

function assertRawLauncherRejected(response, label) {
  assert.equal(response.statusCode, 400, label);
  assert.equal(response.headers["set-cookie"], undefined, label);
  assert.equal(response.headers.location, undefined, label);
}

async function sendChunkedBody(baseUrl, body) {
  const target = new URL("/oauth/every8d-connect/start", baseUrl);
  return await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "POST",
      headers: { "transfer-encoding": "chunked" }
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response));
    });
    request.once("error", reject);
    request.write(body);
    request.end();
  });
}

test("disabled launcher GET is static, unavailable, and has no OAuth side effects", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({
    isEnabled: () => false,
    start: async () => { starts += 1; }
  }));
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}${launcherPath}`, { redirect: "manual" });
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /^text\/html/i);
  assert.match(body, /EVERY8D connection is unavailable/);
  assert.doesNotMatch(body, /<form\b/i);
  assert.doesNotMatch(body, /<button\b/i);
  assert.equal(starts, 0);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(response.headers.get("content-security-policy"), /base-uri 'none'/);
});

test("enabled launcher GET exposes only one native POST form with launcher security headers", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({
    start: async () => { starts += 1; }
  }));
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}${launcherPath}`, { redirect: "manual" });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/i);
  assert.equal(starts, 0);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  const csp = response.headers.get("content-security-policy");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.equal((body.match(/<form\b/gi) ?? []).length, 1);
  assert.match(body, /<form method="post" action="\/oauth\/every8d-connect\/launch">/i);
  assert.match(body, /<button type="submit">Connect EVERY8D to HighLevel<\/button>/i);
  assert.doesNotMatch(body, /<input\b/i);
  assert.doesNotMatch(body, /<button[^>]+(?:name|value)=/i);
  assert.doesNotMatch(body, /<(?:script|style|link|img|iframe)\b/i);
  for (const forbidden of ["tenant", "company", "appId", "version", "providerId", "installationUrl", "redirectUri", "state", "binding", "secret", "http://", "https://"]) {
    assert.equal(body.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test("disabled launcher POST returns before every launcher validation and side effect", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({
    isEnabled: () => false,
    start: async () => { starts += 1; }
  }));
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}${launcherPath}?tenantId=untrusted`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "text/plain", origin: "null" },
    body: "not-empty"
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "oauth_disabled" });
  assert.equal(starts, 0);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("location"), null);
});

test("valid launcher POST starts OAuth once and returns one safe continuation link with the narrow binding cookie", async (t) => {
  let starts = 0;
  const authorizationUrl = "https://app.gohighlevel.com/install?state=a&next=\"quote\"'single'<tag>";
  const { server, baseUrl } = await startRouter(runtime({
    start: async () => {
      starts += 1;
      return {
        authorizationUrl,
        browserBinding: "synthetic-binding",
        expiresAt: new Date(1_600_000).toISOString()
      };
    }
  }));
  t.after(() => server.close());

  const response = await sendRawLauncher(baseUrl);
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /^text\/html/i);
  assert.equal(starts, 1);
  assert.equal(response.headers.location, undefined);
  assert.equal((response.body.match(/<a\b/gi) ?? []).length, 1);
  assert.equal(oneLauncherHref(response.body), authorizationUrl);
  assert.match(
    response.body,
    /<a href="https:\/\/app\.gohighlevel\.com\/install\?state=a&amp;next=&quot;quote&quot;&#39;single&#39;&lt;tag&gt;" rel="noreferrer">Continue to HighLevel<\/a>/
  );
  assert.equal(response.body.includes(authorizationUrl), false);
  assert.doesNotMatch(response.body, /<form\b/i);
  assert.doesNotMatch(response.body, /<(?:script|style|link|img|iframe)\b/i);
  assert.doesNotMatch(response.body, /<meta[^>]+http-equiv=["']?refresh/i);
  for (const requestValue of [launcherOrigin, "application/x-www-form-urlencoded", "same-origin", "navigate", "document"]) {
    assert.equal(response.body.includes(requestValue), false, requestValue);
  }
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers.pragma, "no-cache");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(
    response.headers["content-security-policy"],
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );
  assert.doesNotMatch(response.headers["content-security-policy"], /form-action 'self'/);
  const cookie = response.headers["set-cookie"][0];
  assert.equal(
    cookie,
    "wincrm_every8d_oauth_binding=synthetic-binding; Path=/oauth/every8d-connect; Max-Age=600; HttpOnly; SameSite=Lax; Secure"
  );
});

test("launcher accepts an empty chunked body as exactly zero bytes", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({
    start: async () => {
      starts += 1;
      return {
        authorizationUrl: "https://app.gohighlevel.com/install?state=empty-chunked",
        browserBinding: "empty-chunked-binding",
        expiresAt: new Date(1_600_000).toISOString()
      };
    }
  }));
  t.after(() => server.close());

  const response = await sendRawLauncher(baseUrl, { headers: { "transfer-encoding": "chunked" } });
  assert.equal(response.statusCode, 200);
  assert.equal(starts, 1);
  assert.equal(response.headers.location, undefined);
  assert.equal(oneLauncherHref(response.body), "https://app.gohighlevel.com/install?state=empty-chunked");
});

test("launcher rejects every invalid Origin before runtime start", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({ start: async () => { starts += 1; } }));
  t.after(() => server.close());
  const cases = [
    ["missing", undefined],
    ["null", "null"],
    ["wrong scheme", "http://win-crm.up.railway.app"],
    ["wrong host", "https://example.com"],
    ["wrong port", "https://win-crm.up.railway.app:443"],
    ["trailing slash", "https://win-crm.up.railway.app/"],
    ["suffix match", "https://win-crm.up.railway.app.attacker.example"],
    ["subdomain", "https://sub.win-crm.up.railway.app"],
    ["same-site different origin", "https://other.up.railway.app"],
    ["multiple values", `${launcherOrigin}, ${launcherOrigin}`],
    ["multiple header fields", [launcherOrigin, launcherOrigin]]
  ];
  for (const [label, origin] of cases) {
    const response = await sendRawLauncher(baseUrl, { headers: { origin } });
    assertRawLauncherRejected(response, label);
    assert.equal(starts, 0, label);
  }
  assert.equal(starts, 0);
});

test("launcher rejects missing or different Fetch Metadata before runtime start", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({ start: async () => { starts += 1; } }));
  t.after(() => server.close());
  const cases = [
    ["missing site", "sec-fetch-site", undefined],
    ["cross-site", "sec-fetch-site", "cross-site"],
    ["same-site", "sec-fetch-site", "same-site"],
    ["missing mode", "sec-fetch-mode", undefined],
    ["cors", "sec-fetch-mode", "cors"],
    ["missing destination", "sec-fetch-dest", undefined],
    ["empty destination", "sec-fetch-dest", "empty"],
    ["iframe", "sec-fetch-dest", "iframe"]
  ];
  for (const [label, header, value] of cases) {
    const response = await sendRawLauncher(baseUrl, { headers: { [header]: value } });
    assertRawLauncherRejected(response, label);
    assert.equal(starts, 0, label);
  }
  assert.equal(starts, 0);
});

test("launcher rejects every query, including a bare query delimiter, before runtime start", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({ start: async () => { starts += 1; } }));
  t.after(() => server.close());
  for (const query of ["?x=1", "?tenantId=untrusted", "?redirectUri=https%3A%2F%2Fexample.com"]) {
    const response = await sendRawLauncher(baseUrl, { path: `${launcherPath}${query}` });
    assertRawLauncherRejected(response, query);
    assert.equal(starts, 0, query);
  }
  const bareQuery = await sendRawLauncher(baseUrl, { path: `${launcherPath}?`, headers: { "content-length": "0" } });
  assertRawLauncherRejected(bareQuery, "bare query delimiter");
  assert.equal(starts, 0);
});

test("launcher requires the exact parameter-free form Content-Type before runtime start", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({ start: async () => { starts += 1; } }));
  t.after(() => server.close());
  const cases = [
    ["missing", undefined, undefined],
    ["JSON", "application/json", undefined],
    ["empty JSON object", "application/json", "{}"],
    ["text", "text/plain", undefined],
    ["multipart", "multipart/form-data; boundary=test", undefined],
    ["octet stream", "application/octet-stream", undefined],
    ["charset parameter", "application/x-www-form-urlencoded; charset=UTF-8", undefined],
    ["unsupported", "text/html", undefined]
  ];
  for (const [label, contentType, body] of cases) {
    const response = await sendRawLauncher(baseUrl, {
      headers: { "content-type": contentType },
      ...(body === undefined ? {} : { body })
    });
    assertRawLauncherRejected(response, label);
    assert.equal(starts, 0, label);
  }
  assert.equal(starts, 0);
});

test("launcher rejects every body byte and noncanonical Content-Length before runtime start", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({ start: async () => { starts += 1; } }));
  t.after(() => server.close());
  for (const body of ["x=1", "x=", "=", " ", "x", "tenantId=untrusted", "redirectUri=https%3A%2F%2Fexample.com"]) {
    const response = await sendRawLauncher(baseUrl, { body });
    assertRawLauncherRejected(response, JSON.stringify(body));
    assert.equal(starts, 0, JSON.stringify(body));
  }
  const noncanonicalLength = await sendRawLauncher(baseUrl, { headers: { "content-length": "00" } });
  assertRawLauncherRejected(noncanonicalLength, "noncanonical Content-Length");
  const chunked = await sendRawLauncher(baseUrl, {
    headers: { "transfer-encoding": "chunked" },
    body: "x=1"
  });
  assertRawLauncherRejected(chunked, "chunked non-empty body");
  assert.equal(starts, 0);
});

test("duplicate launcher POSTs create independent starts and overwrite only the same binding cookie", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({
    start: async () => {
      starts += 1;
      return {
        authorizationUrl: `https://app.gohighlevel.com/install?state=state-${starts}`,
        browserBinding: `binding-${starts}`,
        expiresAt: new Date(1_600_000).toISOString()
      };
    }
  }));
  t.after(() => server.close());
  const first = await sendRawLauncher(baseUrl);
  const second = await sendRawLauncher(baseUrl);
  assert.equal(starts, 2);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.match(first.headers["set-cookie"][0], /^wincrm_every8d_oauth_binding=binding-1;/);
  assert.match(second.headers["set-cookie"][0], /^wincrm_every8d_oauth_binding=binding-2;/);
  assert.notEqual(first.headers["set-cookie"][0], second.headers["set-cookie"][0]);
  assert.equal(first.headers.location, undefined);
  assert.equal(second.headers.location, undefined);
  assert.equal(oneLauncherHref(first.body), "https://app.gohighlevel.com/install?state=state-1");
  assert.equal(oneLauncherHref(second.body), "https://app.gohighlevel.com/install?state=state-2");
  assert.notEqual(oneLauncherHref(first.body), oneLauncherHref(second.body));
});

test("public POST start accepts an empty body, returns 303, and sets the narrow secure cookie and security headers", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({ start: async () => {
    starts += 1;
    return {
      authorizationUrl: "https://app.gohighlevel.com/install?state=synthetic-state",
      browserBinding: "synthetic-binding",
      expiresAt: new Date(1_600_000).toISOString()
    };
  } }));
  t.after(() => server.close());
  const response = await fetch(`${baseUrl}/oauth/every8d-connect/start`, {
    method: "POST", redirect: "manual"
  });
  assert.equal(response.status, 303);
  assert.equal(starts, 1);
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; Secure/i);
  assert.match(response.headers.get("set-cookie"), /Path=\/oauth\/every8d-connect/i);
  assert.doesNotMatch(response.headers.get("set-cookie"), /Domain=/i);
  assert.match(response.headers.get("set-cookie"), /Max-Age=600/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("public start rejects queries, JSON objects, and every non-empty or unsupported body", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({ start: async () => {
    starts += 1;
    return { authorizationUrl: "https://example.invalid", browserBinding: "binding", expiresAt: new Date(1_600_000).toISOString() };
  } }));
  t.after(() => server.close());
  const cases = [
    [`${baseUrl}/oauth/every8d-connect/start?x=1`, {}],
    [`${baseUrl}/oauth/every8d-connect/start`, { headers: { "content-type": "application/json" }, body: "{}" }],
    [`${baseUrl}/oauth/every8d-connect/start`, { headers: { "content-type": "application/json" }, body: "{\"x\":1}" }],
    [`${baseUrl}/oauth/every8d-connect/start`, { headers: { "content-type": "text/plain" }, body: "x" }],
    [`${baseUrl}/oauth/every8d-connect/start`, { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "x=1" }],
    [`${baseUrl}/oauth/every8d-connect/start`, { headers: { "content-type": "application/octet-stream" }, body: "x" }]
  ];
  for (const [url, init] of cases) {
    const response = await fetch(url, { method: "POST", redirect: "manual", ...init });
    assert.equal(response.status, 400);
  }
  assert.equal(starts, 0);
});

test("public start rejects malformed JSON before runtime start", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({ start: async () => { starts += 1; } }));
  t.after(() => server.close());
  const response = await fetch(`${baseUrl}/oauth/every8d-connect/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{"
  });
  assert.equal(response.status, 400);
  assert.equal(starts, 0);
});

test("public start rejects multipart bodies without ownership fields", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({ start: async () => { starts += 1; } }));
  t.after(() => server.close());
  const form = new FormData();
  form.set("harmless", "value");
  const response = await fetch(`${baseUrl}/oauth/every8d-connect/start`, {
    method: "POST",
    body: form
  });
  assert.equal(response.status, 400);
  assert.equal(starts, 0);
});

test("public start rejects a non-empty chunked body without Content-Length", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({ start: async () => { starts += 1; } }));
  t.after(() => server.close());
  const response = await sendChunkedBody(baseUrl, "x");
  assert.equal(response.statusCode, 400);
  assert.equal(starts, 0);
});

test("public start rejects every browser-supplied ownership or redirect field before runtime start", async (t) => {
  let starts = 0;
  const { server, baseUrl } = await startRouter(runtime({ start: async () => { starts += 1; } }));
  t.after(() => server.close());
  for (const key of ["tenantId", "locationId", "companyId", "installationId", "generation", "state", "browserBinding", "installationUrl", "redirectUri"]) {
    const response = await fetch(`${baseUrl}/oauth/every8d-connect/start`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [key]: "attacker-input" })
    });
    assert.equal(response.status, 400, key);
  }
  assert.equal(starts, 0);
});

test("disabled start returns before body validation with zero cookie and redirect activity", async (t) => {
  let calls = 0;
  const disabled = runtime({
    isEnabled: () => false,
    start: async () => { calls += 1; throw new Every8dGhlOAuthError("oauth_disabled", "disabled"); }
  });
  const { server, baseUrl } = await startRouter(disabled);
  t.after(() => server.close());
  const response = await fetch(`${baseUrl}/oauth/every8d-connect/start`, {
    method: "POST", redirect: "manual", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: "untrusted" })
  });
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("location"), null);
});

test("callback requires state and binding, accepts no ownership fields, and redirects cleanly to pending", async (t) => {
  let callbackInput = null;
  let triggers = 0;
  const { server, baseUrl } = await startRouter(runtime({
    acceptCallback: async (input) => { callbackInput = input; return { status: "pending", ready: true }; }
  }), () => { triggers += 1; });
  t.after(() => server.close());
  const response = await fetch(`${baseUrl}/oauth/every8d-connect/callback?code=secret-code&state=secret-state`, {
    redirect: "manual", headers: { cookie: "wincrm_every8d_oauth_binding=secret-binding" }
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/oauth/every8d-connect/pending");
  assert.equal(response.headers.get("location").includes("secret"), false);
  assert.deepEqual(callbackInput, { code: "secret-code", state: "secret-state", browserBinding: "secret-binding" });
  assert.equal(triggers, 1);
});

test("callback replay or validation failure is generic and leaks no code, state, binding, or diagnostic", async (t) => {
  const { server, baseUrl } = await startRouter(runtime({
    acceptCallback: async () => { throw new Every8dGhlOAuthError("oauth_state_invalid", "sensitive diagnostic"); }
  }));
  t.after(() => server.close());
  const response = await fetch(`${baseUrl}/oauth/every8d-connect/callback?code=secret-code&state=secret-state`, {
    headers: { cookie: "wincrm_every8d_oauth_binding=secret-binding" }
  });
  const body = await response.text();
  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(body), { ok: false, error: "oauth_state_invalid" });
  for (const value of ["secret-code", "secret-state", "secret-binding", "sensitive diagnostic"]) {
    assert.equal(body.includes(value), false);
  }
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/i);
});

test("pending and status expose no OAuth or ownership identifiers", async (t) => {
  const { server, baseUrl } = await startRouter(runtime({ getStatus: async () => "succeeded" }));
  t.after(() => server.close());
  const pending = await fetch(`${baseUrl}/oauth/every8d-connect/pending`);
  const pendingBody = await pending.text();
  assert.equal(pending.status, 200);
  assert.equal(pendingBody.includes("code="), false);
  const status = await fetch(`${baseUrl}/oauth/every8d-connect/status`, {
    headers: { cookie: "wincrm_every8d_oauth_binding=secret-binding" }
  });
  assert.deepEqual(await status.json(), { ok: true, status: "connected" });
  assert.match(status.headers.get("set-cookie"), /Max-Age=0/i);
  assert.equal(status.headers.get("cache-control"), "no-store");
});

test("shared-secret installed initiation remains available with exact ownership input and legacy connected callback", async (t) => {
  let initiationInput = null;
  let callbackInput = null;
  const r = runtime({
    initiate: async (input) => {
      initiationInput = input;
      return {
        authorizationUrl: "https://app.gohighlevel.com/install?state=installed-state",
        browserBinding: "installed-binding",
        expiresAt: new Date(1_600_000).toISOString()
      };
    },
    completeCallback: async (input) => {
      callbackInput = input;
      return { status: "connected", ready: false };
    }
  });
  const { server, baseUrl } = await startRouter(r);
  t.after(() => server.close());
  const initiated = await fetch(`${baseUrl}/oauth/every8d-connect/initiate`, {
    method: "POST", redirect: "manual", headers: { "content-type": "application/json" },
    body: JSON.stringify({ installationId: "installation-98", tenantId: "tenant-98", locationId: "location-98" })
  });
  assert.equal(initiated.status, 302);
  assert.deepEqual(initiationInput, { installationId: "installation-98", tenantId: "tenant-98", locationId: "location-98" });
  const callback = await fetch(`${baseUrl}/oauth/every8d-connect/callback?code=code&state=state`, {
    headers: { cookie: "wincrm_every8d_oauth_binding=binding" }
  });
  assert.equal(callback.status, 200);
  assert.deepEqual(await callback.json(), { ok: true, status: "connected" });
  assert.deepEqual(callbackInput, { code: "code", state: "state", browserBinding: "binding" });
});
