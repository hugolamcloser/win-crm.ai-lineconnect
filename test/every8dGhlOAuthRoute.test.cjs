const assert = require("node:assert/strict");
const express = require("express");
const test = require("node:test");

const { Every8dGhlOAuthError } = require("../dist/services/every8dGhlOAuthService");
const { createEvery8dGhlOAuthRouter } = require("../dist/routes/every8dGhlOAuth");

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
