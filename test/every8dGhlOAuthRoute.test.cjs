const assert = require("node:assert/strict");
const express = require("express");
const test = require("node:test");

const { Every8dGhlOAuthError } = require("../dist/services/every8dGhlOAuthService");
const { createEvery8dGhlOAuthRouter } = require("../dist/routes/every8dGhlOAuth");

async function startRouter(options = {}) {
  const app = express();
  app.use(express.json());
  app.use(createEvery8dGhlOAuthRouter({
    runtime: options.runtime,
    initiationGuard: options.initiationGuard ?? ((_req, _res, next) => next()),
    secureCookies: options.secureCookies ?? true
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("initiation uses exact server-authorized ownership and sets a narrow secure binding cookie", async (t) => {
  let initiationInput = null;
  const runtime = {
    initiate: async (input) => {
      initiationInput = input;
      return {
        authorizationUrl: "https://marketplace.example.invalid/install/app?state=synthetic-state",
        browserBinding: "synthetic-browser-binding",
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      };
    },
    completeCallback: async () => ({ status: "connected" })
  };
  const { server, baseUrl } = await startRouter({ runtime });
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/oauth/every8d-connect/initiate`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      installationId: "10000000-0000-4000-8000-000000000098",
      tenantId: "00000000-0000-4000-8000-000000000098",
      locationId: "location-98"
    })
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://marketplace.example.invalid/install/app?state=synthetic-state");
  assert.match(response.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(response.headers.get("set-cookie"), /Secure/i);
  assert.match(response.headers.get("set-cookie"), /SameSite=Lax/i);
  assert.match(response.headers.get("set-cookie"), /Path=\/oauth\/every8d-connect/i);
  assert.match(response.headers.get("set-cookie"), /Max-Age=600/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(initiationInput, {
    installationId: "10000000-0000-4000-8000-000000000098",
    tenantId: "00000000-0000-4000-8000-000000000098",
    locationId: "location-98"
  });
});

test("callback passes only code, state, and HttpOnly binding and returns generic no-store success", async (t) => {
  let callbackInput = null;
  const runtime = {
    initiate: async () => { throw new Error("not expected"); },
    completeCallback: async (input) => {
      callbackInput = input;
      return { status: "connected" };
    }
  };
  const { server, baseUrl } = await startRouter({ runtime });
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/oauth/every8d-connect/callback?code=synthetic-code&state=synthetic-state`, {
    headers: { cookie: "wincrm_every8d_oauth_binding=synthetic-browser-binding" }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true, status: "connected" });
  assert.deepEqual(callbackInput, {
    code: "synthetic-code",
    state: "synthetic-state",
    browserBinding: "synthetic-browser-binding"
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/i);
  assert.equal(JSON.stringify(body).includes("synthetic"), false);
});

test("callback failure response never exposes OAuth inputs or provider diagnostics", async (t) => {
  const runtime = {
    initiate: async () => { throw new Error("not expected"); },
    completeCallback: async () => {
      throw new Every8dGhlOAuthError("token_exchange_failed", "safe failure");
    }
  };
  const { server, baseUrl } = await startRouter({ runtime });
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/oauth/every8d-connect/callback?code=authorization-code-sensitive&state=state-sensitive`, {
    headers: { cookie: "wincrm_every8d_oauth_binding=binding-sensitive" }
  });
  const bodyText = await response.text();

  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(bodyText), { ok: false, error: "token_exchange_failed" });
  for (const secret of ["authorization-code-sensitive", "state-sensitive", "binding-sensitive", "safe failure"]) {
    assert.equal(bodyText.includes(secret), false);
  }
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/i);
});

test("initiation guard rejects before OAuth runtime activity", async (t) => {
  let runtimeCalls = 0;
  const runtime = {
    initiate: async () => { runtimeCalls += 1; },
    completeCallback: async () => { runtimeCalls += 1; }
  };
  const { server, baseUrl } = await startRouter({
    runtime,
    initiationGuard: (_req, res) => res.status(401).json({ error: "unauthorized" })
  });
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/oauth/every8d-connect/initiate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installationId: "x", tenantId: "y", locationId: "z" })
  });
  assert.equal(response.status, 401);
  assert.equal(runtimeCalls, 0);
});

test("browser-supplied company ownership is rejected before OAuth runtime activity", async (t) => {
  let runtimeCalls = 0;
  const runtime = {
    initiate: async () => { runtimeCalls += 1; },
    completeCallback: async () => { runtimeCalls += 1; }
  };
  const { server, baseUrl } = await startRouter({ runtime });
  t.after(() => server.close());

  const response = await fetch(`${baseUrl}/oauth/every8d-connect/initiate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      installationId: "10000000-0000-4000-8000-000000000098",
      tenantId: "00000000-0000-4000-8000-000000000098",
      locationId: "location-98",
      companyId: "browser-company"
    })
  });

  assert.equal(response.status, 400);
  assert.equal(runtimeCalls, 0);
});
