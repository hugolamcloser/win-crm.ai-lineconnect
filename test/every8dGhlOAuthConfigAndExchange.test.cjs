const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  Every8dGhlOAuthConfigurationError,
  assertEvery8dGhlOAuthConfig,
  readEvery8dGhlOAuthConfig
} = require("../dist/config/every8dGhlOAuth");
const {
  Every8dGhlTokenExchangeError,
  exchangeEvery8dGhlAuthorizationCode
} = require("../dist/services/every8dGhlOAuthService");

const syntheticKey = Buffer.alloc(32, 0x61).toString("base64");
const syntheticInstallationUrl = "https://app.gohighlevel.com/v2/location/location-test-98/integration/integration-test-98/versions/version-test-98";
const syntheticInstallationUrlSha256 = "f16af35b0cf17cea441f86b7c665c8999e36c37bc1216a8041049212b753f539";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function completeEnvironment(overrides = {}) {
  return {
    EVERY8D_GHL_OAUTH_ENABLED: "true",
    EVERY8D_GHL_MARKETPLACE_APP_ID: "every8d-app-98",
    EVERY8D_GHL_OAUTH_CLIENT_ID: "every8d-client-98",
    EVERY8D_GHL_OAUTH_CLIENT_SECRET: "synthetic-client-secret",
    EVERY8D_GHL_OAUTH_REDIRECT_URI: "https://oauth.example.invalid/oauth/every8d-connect/callback",
    EVERY8D_GHL_OAUTH_INSTALLATION_URL: syntheticInstallationUrl,
    EVERY8D_GHL_OAUTH_INSTALLATION_URL_SHA256: syntheticInstallationUrlSha256,
    EVERY8D_GHL_CONVERSATION_PROVIDER_ID: "every8d-provider-98",
    EVERY8D_GHL_OAUTH_REQUIRED_SCOPES: "locations.readonly",
    EVERY8D_GHL_OAUTH_ACTIVE_KEY_VERSION: "test-v1",
    EVERY8D_GHL_OAUTH_ENCRYPTION_KEYS: JSON.stringify({ "test-v1": syntheticKey }),
    ...overrides
  };
}

test("EVERY8D HighLevel OAuth is disabled by default without parsing secret configuration", () => {
  const config = readEvery8dGhlOAuthConfig({
    EVERY8D_GHL_OAUTH_ENCRYPTION_KEYS: "deliberately-invalid-while-disabled"
  });
  assert.equal(config.enabled, false);
  assert.equal(config.encryptionKeys.size, 0);
});

test("enabled configuration requires dedicated complete exact values", () => {
  const valid = readEvery8dGhlOAuthConfig(completeEnvironment());
  assert.doesNotThrow(() => assertEvery8dGhlOAuthConfig(valid));

  for (const key of [
    "EVERY8D_GHL_MARKETPLACE_APP_ID",
    "EVERY8D_GHL_OAUTH_CLIENT_ID",
    "EVERY8D_GHL_OAUTH_CLIENT_SECRET",
    "EVERY8D_GHL_OAUTH_REDIRECT_URI",
    "EVERY8D_GHL_OAUTH_INSTALLATION_URL",
    "EVERY8D_GHL_OAUTH_INSTALLATION_URL_SHA256",
    "EVERY8D_GHL_CONVERSATION_PROVIDER_ID",
    "EVERY8D_GHL_OAUTH_REQUIRED_SCOPES",
    "EVERY8D_GHL_OAUTH_ACTIVE_KEY_VERSION",
    "EVERY8D_GHL_OAUTH_ENCRYPTION_KEYS"
  ]) {
    const invalid = readEvery8dGhlOAuthConfig(completeEnvironment({ [key]: "" }));
    assert.throws(
      () => assertEvery8dGhlOAuthConfig(invalid),
      (error) => error instanceof Every8dGhlOAuthConfigurationError
    );
  }
});

test("enabled configuration accepts the exact approved synthetic HighLevel Location install link", () => {
  const exact = readEvery8dGhlOAuthConfig(completeEnvironment());
  assert.doesNotThrow(() => assertEvery8dGhlOAuthConfig(exact));
  assert.equal(exact.expectedLocationId, "location-test-98");
});

for (const [name, installationUrl, approvedDigest] of [
  ["one-character URL change", syntheticInstallationUrl.replace("location-test-98", "location-test-99"), syntheticInstallationUrlSha256],
  ["alternate host", syntheticInstallationUrl.replace("app.gohighlevel.com", "app.gohighlevel.example"), sha256(syntheticInstallationUrl.replace("app.gohighlevel.com", "app.gohighlevel.example"))],
  ["Company installation path", syntheticInstallationUrl.replace("/v2/location/location-test-98/", "/v2/company/company-test-98/"), sha256(syntheticInstallationUrl.replace("/v2/location/location-test-98/", "/v2/company/company-test-98/"))],
  ["location change", syntheticInstallationUrl.replace("location-test-98", "other-location-98"), syntheticInstallationUrlSha256],
  ["integration identity change", syntheticInstallationUrl.replace("integration-test-98", "other-integration-98"), syntheticInstallationUrlSha256],
  ["version identity change", syntheticInstallationUrl.replace("version-test-98", "other-version-98"), syntheticInstallationUrlSha256],
  ["query addition", `${syntheticInstallationUrl}?unexpected=true`, sha256(`${syntheticInstallationUrl}?unexpected=true`)],
  ["fragment addition", `${syntheticInstallationUrl}#unexpected`, sha256(`${syntheticInstallationUrl}#unexpected`)]
]) {
  test(`enabled configuration rejects ${name}`, () => {
    const invalid = readEvery8dGhlOAuthConfig(completeEnvironment({
      EVERY8D_GHL_OAUTH_INSTALLATION_URL: installationUrl,
      EVERY8D_GHL_OAUTH_INSTALLATION_URL_SHA256: approvedDigest
    }));
    assert.throws(
      () => assertEvery8dGhlOAuthConfig(invalid),
      (error) => error instanceof Every8dGhlOAuthConfigurationError
    );
  });
}

test("enabled configuration rejects malformed or missing installation URL approval digests", () => {
  for (const digest of ["", "A".repeat(64), "not-a-sha256-digest"]) {
    const invalid = readEvery8dGhlOAuthConfig(completeEnvironment({
      EVERY8D_GHL_OAUTH_INSTALLATION_URL_SHA256: digest
    }));
    assert.throws(
      () => assertEvery8dGhlOAuthConfig(invalid),
      (error) => error instanceof Every8dGhlOAuthConfigurationError
    );
  }
});

test("enabled configuration rejects a whitespace-only dedicated client secret", () => {
  const invalid = readEvery8dGhlOAuthConfig(completeEnvironment({
    EVERY8D_GHL_OAUTH_CLIENT_SECRET: " \t\r\n "
  }));

  assert.throws(
    () => assertEvery8dGhlOAuthConfig(invalid),
    (error) => error instanceof Every8dGhlOAuthConfigurationError
  );
});

test("enabled configuration accepts only the exact documented HighLevel token endpoint", () => {
  const exact = readEvery8dGhlOAuthConfig(completeEnvironment({
    EVERY8D_GHL_OAUTH_TOKEN_URL: "https://services.leadconnectorhq.com/oauth/token"
  }));
  assert.doesNotThrow(() => assertEvery8dGhlOAuthConfig(exact));

  for (const tokenUrl of [
    "https://attacker.example.invalid/oauth/token",
    "https://services.leadconnectorhq.com/oauth/other",
    "https://services.leadconnectorhq.com/oauth/token?next=other",
    "http://services.leadconnectorhq.com/oauth/token"
  ]) {
    const invalid = readEvery8dGhlOAuthConfig(completeEnvironment({
      EVERY8D_GHL_OAUTH_TOKEN_URL: tokenUrl
    }));
    assert.throws(
      () => assertEvery8dGhlOAuthConfig(invalid),
      (error) => error instanceof Every8dGhlOAuthConfigurationError,
      tokenUrl
    );
  }
});

test("token exchange rejects an alternate endpoint before any network request", async () => {
  const config = readEvery8dGhlOAuthConfig(completeEnvironment({
    EVERY8D_GHL_OAUTH_TOKEN_URL: "https://attacker.example.invalid/oauth/token"
  }));
  let requests = 0;

  await assert.rejects(
    () => exchangeEvery8dGhlAuthorizationCode({
      code: "synthetic-code",
      config,
      fetchImpl: async () => {
        requests += 1;
        return new Response("{}", { status: 200 });
      }
    }),
    (error) => error instanceof Every8dGhlTokenExchangeError
  );
  assert.equal(requests, 0);
});

test("authorization-code exchange uses only dedicated Location client input", async () => {
  const config = readEvery8dGhlOAuthConfig(completeEnvironment());
  let request = null;
  const payload = { access_token: "synthetic-access", refresh_token: "synthetic-refresh" };
  const result = await exchangeEvery8dGhlAuthorizationCode({
    code: "synthetic-code",
    config,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.deepEqual(result, payload);
  assert.equal(request.url, "https://services.leadconnectorhq.com/oauth/token");
  const body = new URLSearchParams(request.init.body);
  assert.equal(body.get("client_id"), "every8d-client-98");
  assert.equal(body.get("client_secret"), "synthetic-client-secret");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("user_type"), "Location");
  assert.equal(body.get("redirect_uri"), config.redirectUri);
  assert.equal(body.get("code"), "synthetic-code");
  assert.equal(request.init.redirect, "error");
});

test("token exchange refuses every redirect status without a follow-up network request", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const config = readEvery8dGhlOAuthConfig(completeEnvironment());
    let requests = 0;

    await assert.rejects(
      () => exchangeEvery8dGhlAuthorizationCode({
        code: "synthetic-code",
        config,
        fetchImpl: async (_url, init) => {
          requests += 1;
          assert.equal(init.redirect, "error");
          return new Response("", {
            status,
            headers: { location: "https://attacker.example.invalid/collect" }
          });
        }
      }),
      (error) => error instanceof Every8dGhlTokenExchangeError,
      String(status)
    );
    assert.equal(requests, 1, String(status));
  }
});

test("token exchange rejects oversized and malformed provider responses without reflecting content", async () => {
  const config = readEvery8dGhlOAuthConfig(completeEnvironment());

  for (const body of ["x".repeat(70_000), "provider-secret-non-json"]) {
    await assert.rejects(
      () => exchangeEvery8dGhlAuthorizationCode({
        code: "synthetic-code",
        config,
        fetchImpl: async () => new Response(body, { status: 200 })
      }),
      (error) => {
        assert.equal(error instanceof Every8dGhlTokenExchangeError, true);
        assert.equal(error.message.includes(body.slice(0, 20)), false);
        return true;
      }
    );
  }
});

test("invalid_grant is classified as a definitive one-time terminal exchange outcome", async () => {
  const config = readEvery8dGhlOAuthConfig(completeEnvironment());
  await assert.rejects(
    () => exchangeEvery8dGhlAuthorizationCode({
      code: "synthetic-code", config,
      fetchImpl: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
    }),
    (error) => error instanceof Every8dGhlTokenExchangeError && error.failureClass === "invalid_grant"
  );
});

for (const [name, fetchImpl] of [
  ["timeout", async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }],
  ["network failure", async () => { throw new Error("network unavailable"); }],
  ["429", async () => new Response("rate limited", { status: 429 })],
  ["5xx", async () => new Response("provider unavailable", { status: 503 })]
]) {
  test(`${name} is classified exchange_outcome_unknown and is not made retryable`, async () => {
    const config = readEvery8dGhlOAuthConfig(completeEnvironment());
    await assert.rejects(
      () => exchangeEvery8dGhlAuthorizationCode({ code: "synthetic-code", config, fetchImpl }),
      (error) => error instanceof Every8dGhlTokenExchangeError
        && error.failureClass === "exchange_outcome_unknown"
        && !error.message.includes("synthetic-code")
    );
  });
}
