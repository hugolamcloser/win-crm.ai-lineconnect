const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.GHL_LOCATION_ID = "loc_A";
process.env.GHL_CUSTOM_PROVIDER_ID = "provider_A";
process.env.GHL_OAUTH_CLIENT_ID = "oauth-client";
process.env.GHL_OAUTH_CLIENT_SECRET = "oauth-client-secret";
process.env.GHL_OAUTH_REDIRECT_URI = "https://example.com/oauth/callback";
process.env.GHL_MARKETPLACE_APP_ID = "marketplace-app";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "global-line-token";
process.env.LINE_CHANNEL_SECRET = "global-line-secret";

const config = require("../dist/config/env");
const repository = require("../dist/services/repository");
const oauthService = require("../dist/services/ghlOAuthService");
const lineOutbound = require("../dist/services/lineOutboundChannelService");

const originalRepositoryExports = {};

for (const key of [
  "ensureTenantForLocation",
  "getGhlOAuthToken",
  "getGhlOAuthTokenStatus",
  "upsertGhlOAuthToken",
  "getLineChannelById",
  "getLineChannelByTenantId"
]) {
  originalRepositoryExports[key] = repository[key];
}

const originalFetch = global.fetch;
const originalEnv = { ...config.env };

afterEach(() => {
  for (const [key, value] of Object.entries(originalRepositoryExports)) {
    repository[key] = value;
  }

  Object.assign(config.env, originalEnv);
  global.fetch = originalFetch;
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getTenantIdForLocation(locationId) {
  if (locationId === "loc_A") {
    return "tenant_A";
  }

  if (locationId === "loc_B") {
    return "tenant_B";
  }

  return `tenant_${locationId}`;
}

function buildTenant(locationId, overrides = {}) {
  return {
    id: getTenantIdForLocation(locationId),
    location_id: locationId,
    ghl_provider_id: `provider_${locationId}`,
    line_channel_id: "default",
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
    ...overrides
  };
}

function buildTokenRow(locationId, accessToken, refreshToken, overrides = {}) {
  return {
    id: `token_${locationId}`,
    tenant_id: null,
    location_id: locationId,
    company_id: null,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: "2999-01-01T00:00:00.000Z",
    scopes: ["oauth.readonly", "oauth.write"],
    token_type: "Bearer",
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
    ...overrides
  };
}

function setupOAuthStore(input = {}) {
  const rows = new Map(input.initialTokens ?? []);
  const tenants = new Map(input.initialTenants ?? [["loc_A", buildTenant("loc_A")]]);
  const failTenantLocations = new Set(input.failTenantLocations ?? []);

  repository.ensureTenantForLocation = async (locationId) => {
    if (failTenantLocations.has(locationId)) {
      throw new Error(`No tenant for location ${locationId}`);
    }

    const existing = tenants.get(locationId);

    if (existing) {
      return existing;
    }

    const tenant = buildTenant(locationId);
    tenants.set(locationId, tenant);
    return tenant;
  };

  repository.getGhlOAuthToken = async (locationId) => rows.get(locationId) ?? null;
  repository.getGhlOAuthTokenStatus = async (locationId) => {
    const token = rows.get(locationId);

    if (!token) {
      return {
        location_id: locationId,
        token_present: false,
        refresh_token_present: false,
        expires_at: null,
        expired: true,
        scopes: [],
        company_id: null
      };
    }

    return {
      location_id: token.location_id,
      token_present: Boolean(token.access_token),
      refresh_token_present: Boolean(token.refresh_token),
      expires_at: token.expires_at,
      expired: false,
      scopes: token.scopes,
      company_id: token.company_id
    };
  };

  repository.upsertGhlOAuthToken = async (tokenInput) => {
    const existing = rows.get(tokenInput.locationId);
    const token = buildTokenRow(tokenInput.locationId, tokenInput.accessToken, tokenInput.refreshToken, {
      id: existing?.id ?? `token_${tokenInput.locationId}`,
      tenant_id: tokenInput.tenantId ?? null,
      company_id: tokenInput.companyId ?? null,
      expires_at: tokenInput.expiresAt,
      scopes: tokenInput.scopes ?? [],
      token_type: tokenInput.tokenType ?? null,
      created_at: existing?.created_at ?? "2026-07-11T00:00:00.000Z"
    });

    rows.set(tokenInput.locationId, token);
    return token;
  };

  return { rows, tenants };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createFetchSequence(steps) {
  const calls = [];

  global.fetch = async (url, init = {}) => {
    const step = steps.shift();
    const urlString = typeof url === "string" ? url : url.toString();
    const parsedUrl = new URL(urlString);
    const method = init.method ?? "GET";
    const body = init.body?.toString() ?? "";
    const call = { url: parsedUrl, urlString, method, init, body };
    calls.push(call);

    assert.ok(step, `Unexpected fetch call: ${method} ${urlString}`);
    step.assert?.(call);

    return jsonResponse(step.payload, step.status ?? 200);
  };

  return calls;
}

function authCodeStep(payload, assertRequest) {
  return {
    payload,
    assert: (call) => {
      assert.equal(call.method, "POST");
      assert.match(call.body, /grant_type=authorization_code/);
      assert.match(call.body, /code=/);
      assertRequest?.(call);
    }
  };
}

function installedLocationsStep(payload, assertRequest) {
  return {
    payload,
    assert: (call) => {
      assert.equal(call.method, "GET");
      assert.equal(call.url.pathname, "/oauth/installed-locations");
      assert.equal(call.url.searchParams.get("companyId"), "company_1");
      assert.equal(call.url.searchParams.get("appId"), "marketplace-app");
      assert.equal(call.url.searchParams.get("isInstalled"), "true");
      assert.equal(call.url.searchParams.get("pageSize"), "100");
      assert.equal(call.init.headers.Version, "v3");
      assertRequest?.(call);
    }
  };
}

function locationTokenStep(locationId, payload, assertRequest) {
  return {
    payload,
    assert: (call) => {
      assert.equal(call.method, "POST");
      assert.equal(call.url.pathname, "/oauth/location-token");
      assert.equal(call.body, `companyId=company_1&locationId=${encodeURIComponent(locationId)}`);
      assert.equal(call.init.headers.Version, "v3");
      assertRequest?.(call);
    }
  };
}

test("direct Location authorization-code token creates an unknown tenant and OAuth row without GHL_LOCATION_ID", async () => {
  const locAToken = buildTokenRow("loc_A", "access_A", "refresh_A", {
    tenant_id: "tenant_A",
    company_id: "company_A"
  });
  const originalLocA = clone(locAToken);
  const { rows, tenants } = setupOAuthStore({
    initialTokens: [["loc_A", locAToken]]
  });

  createFetchSequence([
    authCodeStep({
      access_token: "access_new",
      refresh_token: "refresh_new",
      expires_in: 3600,
      location_id: "loc_new",
      company_id: "company_new",
      scope: "oauth.readonly oauth.write",
      token_type: "Bearer"
    })
  ]);

  const installStatus = await oauthService.exchangeGhlAuthorizationCode("mock-code-direct-location");

  assert.equal(installStatus.location_id, "loc_new");
  assert.equal(installStatus.token_present, true);
  assert.equal(installStatus.refresh_token_present, true);
  assert.equal(tenants.get("loc_new").id, "tenant_loc_new");
  assert.equal(rows.get("loc_new").tenant_id, "tenant_loc_new");
  assert.equal(rows.get("loc_new").location_id, "loc_new");
  assert.equal(rows.get("loc_new").company_id, "company_new");
  assert.deepEqual(rows.get("loc_new").scopes, ["oauth.readonly", "oauth.write"]);
  assert.equal(rows.get("loc_new").token_type, "Bearer");
  assert.deepEqual(rows.get("loc_A"), originalLocA);
});

test("direct Location authorization-code token parses camelCase fields", async () => {
  const { rows, tenants } = setupOAuthStore();

  createFetchSequence([
    authCodeStep({
      accessToken: "access_camel",
      refreshToken: "refresh_camel",
      expiresIn: 3600,
      locationId: "loc_camel",
      companyId: "company_camel",
      scopes: "oauth.readonly oauth.write",
      tokenType: "Bearer"
    })
  ]);

  const installStatus = await oauthService.exchangeGhlAuthorizationCode("mock-code-camel-location");

  assert.equal(installStatus.location_id, "loc_camel");
  assert.equal(tenants.get("loc_camel").id, "tenant_loc_camel");
  assert.equal(rows.get("loc_camel").tenant_id, "tenant_loc_camel");
  assert.equal(rows.get("loc_camel").access_token, "access_camel");
  assert.equal(rows.get("loc_camel").refresh_token, "refresh_camel");
  assert.equal(rows.get("loc_camel").company_id, "company_camel");
  assert.deepEqual(rows.get("loc_camel").scopes, ["oauth.readonly", "oauth.write"]);
  assert.equal(rows.get("loc_camel").token_type, "Bearer");
});

test("Company token with one approvedLocations entry converts and stores one location OAuth row", async () => {
  const { rows, tenants } = setupOAuthStore();

  createFetchSequence([
    authCodeStep({
      accessToken: "company_access",
      refreshToken: "company_refresh",
      expiresIn: 3600,
      companyId: "company_1",
      userType: "Company",
      approvedLocations: ["loc_B"],
      isBulkInstallation: false,
      appId: "app_from_response",
      versionId: "version_5"
    }),
    locationTokenStep("loc_B", {
      accessToken: "access_B",
      refreshToken: "refresh_B",
      expiresIn: 3600,
      locationId: "loc_B",
      companyId: "company_1",
      scope: "oauth.readonly oauth.write",
      tokenType: "Bearer"
    })
  ]);

  const installStatus = await oauthService.exchangeGhlAuthorizationCode("mock-code-company-one");

  assert.equal(installStatus.mode, "company_to_location");
  assert.equal(installStatus.company_id, "company_1");
  assert.deepEqual(installStatus.locations.map((location) => location.location_id), ["loc_B"]);
  assert.equal(installStatus.locations[0].tenant_id, "tenant_B");
  assert.equal(tenants.get("loc_B").id, "tenant_B");
  assert.equal(rows.get("loc_B").tenant_id, "tenant_B");
  assert.equal(rows.get("loc_B").access_token, "access_B");
  assert.equal(rows.get("loc_B").refresh_token, "refresh_B");
});

test("Company token with two approvedLocations entries creates separate tenants and token rows", async () => {
  const locAToken = buildTokenRow("loc_A", "access_A", "refresh_A", { tenant_id: "tenant_A" });
  const originalLocA = clone(locAToken);
  const { rows, tenants } = setupOAuthStore({
    initialTokens: [["loc_A", locAToken]]
  });

  createFetchSequence([
    authCodeStep({
      access_token: "company_access",
      refresh_token: "company_refresh",
      expires_in: 3600,
      company_id: "company_1",
      user_type: "Company",
      approved_locations: [{ _id: "loc_B" }, { locationId: "loc_C" }],
      is_bulk_installation: true
    }),
    locationTokenStep("loc_B", {
      accessToken: "access_B",
      refreshToken: "refresh_B",
      expiresIn: 3600,
      locationId: "loc_B",
      companyId: "company_1",
      scope: "oauth.readonly oauth.write",
      tokenType: "Bearer"
    }),
    locationTokenStep("loc_C", {
      accessToken: "access_C",
      refreshToken: "refresh_C",
      expiresIn: 3600,
      locationId: "loc_C",
      companyId: "company_1",
      scope: "oauth.readonly",
      tokenType: "Bearer"
    })
  ]);

  const installStatus = await oauthService.exchangeGhlAuthorizationCode("mock-code-company-two");

  assert.equal(installStatus.mode, "company_to_location");
  assert.deepEqual(installStatus.locations.map((location) => location.location_id), ["loc_B", "loc_C"]);
  assert.equal(tenants.get("loc_B").id, "tenant_B");
  assert.equal(tenants.get("loc_C").id, "tenant_loc_C");
  assert.equal(rows.get("loc_B").access_token, "access_B");
  assert.equal(rows.get("loc_B").tenant_id, "tenant_B");
  assert.equal(rows.get("loc_C").access_token, "access_C");
  assert.equal(rows.get("loc_C").tenant_id, "tenant_loc_C");
  assert.deepEqual(rows.get("loc_A"), originalLocA);
});

test("Company token without approvedLocations uses installed-locations lookup", async () => {
  const { rows } = setupOAuthStore();
  const calls = createFetchSequence([
    authCodeStep({
      accessToken: "company_access",
      refreshToken: "company_refresh",
      expiresIn: 3600,
      companyId: "company_1",
      userType: "Company"
    }),
    installedLocationsStep({
      items: [{ _id: "loc_D" }]
    }),
    locationTokenStep("loc_D", {
      accessToken: "access_D",
      refreshToken: "refresh_D",
      expiresIn: 3600,
      locationId: "loc_D",
      companyId: "company_1",
      scope: "oauth.readonly oauth.write",
      tokenType: "Bearer"
    })
  ]);

  const installStatus = await oauthService.exchangeGhlAuthorizationCode("mock-code-company-installed");

  assert.equal(installStatus.mode, "company_to_location");
  assert.deepEqual(installStatus.locations.map((location) => location.location_id), ["loc_D"]);
  assert.equal(rows.get("loc_D").tenant_id, "tenant_loc_D");
  assert.equal(rows.get("loc_D").access_token, "access_D");
  assert.equal(calls.filter((call) => call.url.pathname === "/oauth/installed-locations").length, 1);
});

test("installed-locations lookup supports pagination", async () => {
  const { rows } = setupOAuthStore();
  const calls = createFetchSequence([
    authCodeStep({
      accessToken: "company_access",
      refreshToken: "company_refresh",
      expiresIn: 3600,
      companyId: "company_1",
      userType: "Company"
    }),
    installedLocationsStep({
      items: [{ _id: "loc_E1" }],
      nextPageToken: "page_2"
    }),
    installedLocationsStep(
      {
        items: [{ _id: "loc_E2" }]
      },
      (call) => {
        assert.equal(call.url.searchParams.get("pageToken"), "page_2");
      }
    ),
    locationTokenStep("loc_E1", {
      accessToken: "access_E1",
      refreshToken: "refresh_E1",
      expiresIn: 3600,
      locationId: "loc_E1",
      companyId: "company_1",
      scope: "oauth.readonly",
      tokenType: "Bearer"
    }),
    locationTokenStep("loc_E2", {
      accessToken: "access_E2",
      refreshToken: "refresh_E2",
      expiresIn: 3600,
      locationId: "loc_E2",
      companyId: "company_1",
      scope: "oauth.readonly",
      tokenType: "Bearer"
    })
  ]);

  const installStatus = await oauthService.exchangeGhlAuthorizationCode("mock-code-company-paged");

  assert.deepEqual(installStatus.locations.map((location) => location.location_id), ["loc_E1", "loc_E2"]);
  assert.equal(rows.get("loc_E1").access_token, "access_E1");
  assert.equal(rows.get("loc_E2").access_token, "access_E2");
  assert.equal(calls.filter((call) => call.url.pathname === "/oauth/installed-locations").length, 2);
});

test("location-token response location mismatch fails closed and stores nothing", async () => {
  const locAToken = buildTokenRow("loc_A", "access_A", "refresh_A", { tenant_id: "tenant_A" });
  const originalLocA = clone(locAToken);
  const { rows } = setupOAuthStore({
    initialTokens: [["loc_A", locAToken]]
  });

  createFetchSequence([
    authCodeStep({
      accessToken: "company_access",
      refreshToken: "company_refresh",
      expiresIn: 3600,
      companyId: "company_1",
      userType: "Company",
      approvedLocations: ["loc_F"]
    }),
    locationTokenStep("loc_F", {
      accessToken: "access_wrong",
      refreshToken: "refresh_wrong",
      expiresIn: 3600,
      locationId: "loc_OTHER",
      companyId: "company_1",
      scope: "oauth.readonly",
      tokenType: "Bearer"
    })
  ]);

  await assert.rejects(
    () => oauthService.exchangeGhlAuthorizationCode("mock-code-company-mismatch"),
    /did not match requested location loc_F/
  );
  assert.equal(rows.has("loc_F"), false);
  assert.equal(rows.has("loc_OTHER"), false);
  assert.deepEqual(rows.get("loc_A"), originalLocA);
});

test("location-token response missing access token fails closed and stores nothing", async () => {
  const { rows } = setupOAuthStore();

  createFetchSequence([
    authCodeStep({
      accessToken: "company_access",
      refreshToken: "company_refresh",
      expiresIn: 3600,
      companyId: "company_1",
      userType: "Company",
      approvedLocations: ["loc_F2"]
    }),
    locationTokenStep("loc_F2", {
      refreshToken: "refresh_F2",
      expiresIn: 3600,
      locationId: "loc_F2",
      companyId: "company_1",
      scope: "oauth.readonly",
      tokenType: "Bearer"
    })
  ]);

  await assert.rejects(
    () => oauthService.exchangeGhlAuthorizationCode("mock-code-company-missing-location-access"),
    /did not include a location-specific access token/
  );
  assert.equal(rows.has("loc_F2"), false);
});

test("Company token missing companyId fails safely", async () => {
  const { rows } = setupOAuthStore();

  createFetchSequence([
    authCodeStep({
      accessToken: "company_access",
      refreshToken: "company_refresh",
      expiresIn: 3600,
      userType: "Company",
      approvedLocations: ["loc_G"]
    })
  ]);

  await assert.rejects(
    () => oauthService.exchangeGhlAuthorizationCode("mock-code-missing-company"),
    /did not include companyId/
  );
  assert.equal(rows.has("loc_G"), false);
});

test("Company token fallback without GHL_MARKETPLACE_APP_ID fails safely", async () => {
  const { rows } = setupOAuthStore();
  config.env.GHL_MARKETPLACE_APP_ID = "";

  createFetchSequence([
    authCodeStep({
      accessToken: "company_access",
      refreshToken: "company_refresh",
      expiresIn: 3600,
      companyId: "company_1",
      userType: "Company"
    })
  ]);

  await assert.rejects(
    () => oauthService.exchangeGhlAuthorizationCode("mock-code-missing-app-id"),
    /GHL_MARKETPLACE_APP_ID is required/
  );
  assert.equal(rows.size, 0);
});

test("OAuth refresh remains scoped to the stored token row and preserves omitted metadata", async () => {
  const locAToken = buildTokenRow("loc_A", "access_A", "refresh_A", {
    tenant_id: "tenant_A",
    company_id: "company_A",
    scopes: ["oauth.readonly"],
    token_type: "Bearer"
  });
  const originalLocA = clone(locAToken);
  const { rows } = setupOAuthStore({
    initialTokens: [
      ["loc_A", locAToken],
      [
        "loc_B",
        buildTokenRow("loc_B", "access_B", "refresh_B", {
          tenant_id: "tenant_B",
          company_id: "company_B",
          scopes: ["oauth.readonly", "oauth.write"],
          token_type: "Bearer"
        })
      ]
    ]
  });

  createFetchSequence([
    {
      payload: {
        access_token: "access_B_refreshed",
        refresh_token: "refresh_B_refreshed",
        expires_in: 3600
      },
      assert: (call) => {
        assert.equal(call.method, "POST");
        assert.match(call.body, /grant_type=refresh_token/);
        assert.match(call.body, /refresh_token=refresh_B/);
      }
    }
  ]);

  const refreshed = await oauthService.refreshGhlOAuthToken("loc_B");
  assert.equal(refreshed.location_id, "loc_B");
  assert.equal(refreshed.tenant_id, "tenant_B");
  assert.deepEqual(rows.get("loc_A"), originalLocA);
  assert.equal(rows.get("loc_B").tenant_id, "tenant_B");
  assert.equal(rows.get("loc_B").company_id, "company_B");
  assert.deepEqual(rows.get("loc_B").scopes, ["oauth.readonly", "oauth.write"]);
  assert.equal(rows.get("loc_B").token_type, "Bearer");
  assert.equal(rows.get("loc_B").access_token, "access_B_refreshed");
  assert.equal(rows.get("loc_B").refresh_token, "refresh_B_refreshed");
});

test("OAuth refresh stores supplied metadata for the same location only", async () => {
  const locAToken = buildTokenRow("loc_A", "access_A", "refresh_A", {
    tenant_id: "tenant_A",
    company_id: "company_A",
    scopes: ["oauth.readonly"],
    token_type: "Bearer"
  });
  const originalLocA = clone(locAToken);
  const { rows } = setupOAuthStore({
    initialTokens: [
      ["loc_A", locAToken],
      [
        "loc_B",
        buildTokenRow("loc_B", "access_B", "refresh_B", {
          tenant_id: "tenant_B",
          company_id: "company_B",
          scopes: ["oauth.readonly", "oauth.write"],
          token_type: "Bearer"
        })
      ]
    ]
  });

  createFetchSequence([
    {
      payload: {
        accessToken: "access_B_refreshed_with_metadata",
        refreshToken: "refresh_B_refreshed_with_metadata",
        expiresIn: 3600,
        companyId: "company_B_updated",
        scopes: ["oauth.readonly"],
        tokenType: "BearerV2"
      },
      assert: (call) => {
        assert.equal(call.method, "POST");
        assert.match(call.body, /grant_type=refresh_token/);
        assert.match(call.body, /refresh_token=refresh_B/);
      }
    }
  ]);

  const refreshed = await oauthService.refreshGhlOAuthToken("loc_B");
  assert.equal(refreshed.location_id, "loc_B");
  assert.equal(refreshed.tenant_id, "tenant_B");
  assert.deepEqual(rows.get("loc_A"), originalLocA);
  assert.equal(rows.get("loc_B").tenant_id, "tenant_B");
  assert.equal(rows.get("loc_B").company_id, "company_B_updated");
  assert.deepEqual(rows.get("loc_B").scopes, ["oauth.readonly"]);
  assert.equal(rows.get("loc_B").token_type, "BearerV2");
  assert.equal(rows.get("loc_B").access_token, "access_B_refreshed_with_metadata");
  assert.equal(rows.get("loc_B").refresh_token, "refresh_B_refreshed_with_metadata");
});

test("missing OAuth token fails safely without using another tenant token", async () => {
  const locAToken = buildTokenRow("loc_A", "access_A", "refresh_A", { tenant_id: "tenant_A" });
  const originalLocA = clone(locAToken);
  const { rows } = setupOAuthStore({
    initialTokens: [["loc_A", locAToken]]
  });

  await assert.rejects(
    () => oauthService.getGhlAuthContext("loc_missing", { allowPrivateFallback: false }),
    /No HighLevel OAuth token is stored for location loc_missing/
  );
  assert.deepEqual(rows.get("loc_A"), originalLocA);
  assert.equal(rows.has("loc_missing"), false);
});

test("LINE outbound channel selection stays isolated by tenant", async () => {
  const channels = new Map([
    [
      "line_channel_A",
      {
        id: "line_channel_A",
        tenant_id: "tenant_A",
        webhook_key: "webhook_A",
        channel_access_token: "line_token_A",
        channel_secret: "line_secret_A",
        is_active: true
      }
    ],
    [
      "line_channel_B",
      {
        id: "line_channel_B",
        tenant_id: "tenant_B",
        webhook_key: "webhook_B",
        channel_access_token: "line_token_B",
        channel_secret: "line_secret_B",
        is_active: true
      }
    ]
  ]);

  repository.getLineChannelById = async (lineChannelId) => channels.get(lineChannelId) ?? null;
  repository.getLineChannelByTenantId = async (tenantId) =>
    [...channels.values()].find((channel) => channel.tenant_id === tenantId) ?? null;

  const profileChannelSelection = await lineOutbound.resolveLineChannelForOutbound("tenant_B", {
    line_channel_id: "line_channel_B"
  });
  assert.equal(profileChannelSelection.channelAccessToken, "line_token_B");
  assert.equal(profileChannelSelection.channelTokenSource, "profile_channel");

  const tenantChannelSelection = await lineOutbound.resolveLineChannelForOutbound("tenant_B", {
    line_channel_id: null
  });
  assert.equal(tenantChannelSelection.channelAccessToken, "line_token_B");
  assert.equal(tenantChannelSelection.channelTokenSource, "tenant_active_channel");

  await assert.rejects(
    () =>
      lineOutbound.resolveLineChannelForOutbound("tenant_missing", {
        line_channel_id: null
      }),
    (error) => {
      assert.equal(error.name, "LineChannelNotConnectedError");
      assert.equal(error.channelTokenSource, "tenant_active_channel");
      assert.equal(error.lineChannelId, undefined);
      return true;
    }
  );
});
