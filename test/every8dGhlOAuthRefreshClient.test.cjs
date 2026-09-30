const assert = require("node:assert/strict");
const test = require("node:test");
const {
  Every8dGhlOAuthRefreshClientError,
  every8dGhlOAuthRefreshMaximumResponseBytes,
  every8dGhlOAuthRefreshTimeoutMs,
  refreshEvery8dGhlOAuthToken
} = require("../dist/integrations/every8dGhlOAuthRefreshClient");

const config = {
  enabled: true, refreshEnabled: true, marketplaceAppId: "app-98", oauthClientId: "client-98",
  oauthClientSecret: "test-client-secret", tokenUrl: "https://services.leadconnectorhq.com/oauth/token",
  requiredScopes: ["conversations.write", "locations.readonly"]
};

function body(overrides = {}) { return {
  access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600,
  token_type: "Bearer", scope: "locations.readonly conversations.write", ...overrides
}; }

function response(status, value) {
  return new Response(typeof value === "string" || value instanceof Uint8Array ? value : JSON.stringify(value), {
    status, headers: { "content-type": "application/json" }
  });
}

async function run(fetchImpl, overrides = {}) {
  return refreshEvery8dGhlOAuthToken({
    refreshToken: "claimed-refresh", config, claimedScopes: config.requiredScopes,
    expectedLocationId: "location-98", expectedCompanyId: "company-98", fetchImpl, ...overrides
  });
}

async function rejectsAs(fetchImpl, failureClass, overrides) {
  await assert.rejects(() => run(fetchImpl, overrides), (error) => {
    assert.ok(error instanceof Every8dGhlOAuthRefreshClientError);
    assert.equal(error.failureClass, failureClass);
    return true;
  });
}

test("refresh request is one bounded snake_case form request with redirects disabled", async () => {
  let calls = 0;
  const result = await run(async (url, options) => {
    calls += 1;
    assert.equal(url, config.tokenUrl);
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.deepEqual(Object.fromEntries(options.body), {
      client_id: "client-98", client_secret: "test-client-secret",
      grant_type: "refresh_token", refresh_token: "claimed-refresh"
    });
    return response(200, body());
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    accessToken: "rotated-access", refreshToken: "rotated-refresh", expiresIn: 3600,
    scopes: ["conversations.write", "locations.readonly"]
  });
});

test("refresh client accepts absent optional identity and exact present identity", async () => {
  await run(async () => response(200, body()));
  await run(async () => response(200, body({
    userType: "Location", locationId: "location-98", companyId: "company-98", appId: "app-98",
    approvedLocations: ["location-98"], isBulkInstallation: false,
    installToFutureLocations: false, approveAllLocations: false
  })));
});

test("refresh client accepts agreeing camel aliases and rejects alias conflicts", async () => {
  await run(async () => response(200, body({
    accessToken: "rotated-access", refreshToken: "rotated-refresh", expiresIn: 3600,
    tokenType: "Bearer"
  })));
  await rejectsAs(async () => response(200, body({ accessToken: "different" })),
    "token_response_rejected");
});

test("refresh client enforces rotating tokens, expiry, token type, and exact scope sets", async () => {
  for (const invalid of [
    { access_token: "" }, { refresh_token: " rotated " }, { expires_in: 0 },
    { expires_in: 2678401 }, { expires_in: 1.5 }, { token_type: "MAC" },
    { scope: "locations.readonly" }, { scope: "locations.readonly conversations.write extra" },
    { scope: "locations.readonly locations.readonly conversations.write" }
  ]) await rejectsAs(async () => response(200, body(invalid)), "token_response_rejected");
});

test("refresh client rejects mismatched or broadened optional identity", async () => {
  for (const invalid of [
    { userType: "Company" }, { locationId: "location-other" }, { companyId: "company-other" },
    { appId: "app-other" }, { approvedLocations: ["location-98", "location-other"] },
    { isBulkInstallation: true }, { installToFutureLocations: true }, { approveAllLocations: true }
  ]) await rejectsAs(async () => response(200, body(invalid)), "token_response_rejected");
});

test("exact HTTP 400 invalid_grant is terminal and all other HTTP failures are outcome unknown", async () => {
  await rejectsAs(async () => response(400, { error: "invalid_grant" }), "invalid_grant");
  for (const status of [400, 401, 429, 500, 503]) {
    await rejectsAs(async () => response(status, { error: "provider_error" }),
      "refresh_outcome_unknown");
  }
});

test("malformed, partial, oversized, non-JSON, and invalid UTF-8 success are outcome unknown", async () => {
  await rejectsAs(async () => response(200, "not-json"), "refresh_outcome_unknown");
  await rejectsAs(async () => response(200, { access_token: "only-one-field" }),
    "refresh_outcome_unknown");
  const missingScope = body();
  delete missingScope.scope;
  await rejectsAs(async () => response(200, missingScope), "refresh_outcome_unknown");
  await rejectsAs(async () => response(200,
    new Uint8Array(every8dGhlOAuthRefreshMaximumResponseBytes + 1)), "refresh_outcome_unknown");
  await rejectsAs(async () => response(200, new Uint8Array([0xc3, 0x28])),
    "refresh_outcome_unknown");
});

test("timeout, connection reset, and redirect rejection are outcome unknown with zero retry", async () => {
  let calls = 0;
  let timeoutMs;
  let timeoutCallback;
  await rejectsAs(async (_url, options) => {
    calls += 1;
    timeoutCallback();
    assert.equal(options.signal.aborted, true);
    throw new DOMException("aborted", "AbortError");
  }, "refresh_outcome_unknown", {
    setTimeoutImpl(callback, milliseconds) {
      timeoutCallback = callback;
      timeoutMs = milliseconds;
      return { marker: "timer" };
    },
    clearTimeoutImpl() {}
  });
  assert.equal(timeoutMs, every8dGhlOAuthRefreshTimeoutMs);
  assert.equal(calls, 1);

  for (const failure of [new TypeError("connection reset"), new TypeError("redirect mode is error")]) {
    calls = 0;
    await rejectsAs(async () => { calls += 1; throw failure; }, "refresh_outcome_unknown");
    assert.equal(calls, 1);
  }
});
