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
process.env.LINE_CHANNEL_ACCESS_TOKEN = "global-line-token";
process.env.LINE_CHANNEL_SECRET = "global-line-secret";

const repository = require("../dist/services/repository");
const oauthService = require("../dist/services/ghlOAuthService");
const lineOutbound = require("../dist/services/lineOutboundChannelService");

const originalRepositoryExports = {};

for (const key of [
  "ensureDefaultTenant",
  "getGhlOAuthToken",
  "getGhlOAuthTokenStatus",
  "upsertGhlOAuthToken",
  "getLineChannelById",
  "getLineChannelByTenantId"
]) {
  originalRepositoryExports[key] = repository[key];
}

const originalFetch = global.fetch;

afterEach(() => {
  for (const [key, value] of Object.entries(originalRepositoryExports)) {
    repository[key] = value;
  }

  global.fetch = originalFetch;
});

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

function setupOAuthRows(rows) {
  repository.ensureDefaultTenant = async () => "tenant_A";
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
  repository.upsertGhlOAuthToken = async (input) => {
    const existing = rows.get(input.locationId);
    const token = buildTokenRow(input.locationId, input.accessToken, input.refreshToken, {
      id: existing?.id ?? `token_${input.locationId}`,
      tenant_id: input.tenantId ?? null,
      company_id: input.companyId ?? null,
      expires_at: input.expiresAt,
      scopes: input.scopes ?? [],
      token_type: input.tokenType ?? null,
      created_at: existing?.created_at ?? "2026-07-11T00:00:00.000Z"
    });

    rows.set(input.locationId, token);
    return token;
  };
}

function mockTokenResponse(payload, inspectRequest) {
  global.fetch = async (_url, init) => {
    inspectRequest?.(init);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    });
  };
}

test("OAuth token storage and refresh stay isolated by location", async () => {
  const rows = new Map([
    ["loc_A", buildTokenRow("loc_A", "access_A", "refresh_A")],
    ["loc_B", buildTokenRow("loc_B", "access_B", "refresh_B")]
  ]);
  setupOAuthRows(rows);

  const authContext = await oauthService.getGhlAuthContext("loc_B", { allowPrivateFallback: false });
  assert.equal(authContext.mode, "oauth");
  assert.equal(authContext.locationId, "loc_B");
  assert.equal(authContext.accessToken, "access_B");

  mockTokenResponse(
    {
      access_token: "access_B_install",
      refresh_token: "refresh_B_install",
      expires_in: 3600,
      location_id: "loc_B",
      company_id: "company_B",
      scopes: ["oauth.readonly", "oauth.write"],
      token_type: "Bearer"
    },
    (init) => {
      const body = init.body.toString();
      assert.match(body, /grant_type=authorization_code/);
      assert.match(body, /code=/);
    }
  );

  const installStatus = await oauthService.exchangeGhlAuthorizationCode("mock-code-location-B");
  assert.equal(installStatus.location_id, "loc_B");
  assert.equal(rows.get("loc_A").access_token, "access_A");
  assert.equal(rows.get("loc_B").access_token, "access_B_install");

  mockTokenResponse(
    {
      access_token: "access_B_refreshed",
      refresh_token: "refresh_B_refreshed",
      expires_in: 3600,
      scopes: ["oauth.readonly", "oauth.write"],
      token_type: "Bearer"
    },
    (init) => {
      const body = init.body.toString();
      assert.match(body, /grant_type=refresh_token/);
      assert.match(body, /refresh_token=refresh_B_install/);
    }
  );

  const refreshed = await oauthService.refreshGhlOAuthToken("loc_B");
  assert.equal(refreshed.location_id, "loc_B");
  assert.equal(rows.get("loc_A").access_token, "access_A");
  assert.equal(rows.get("loc_B").access_token, "access_B_refreshed");

  await assert.rejects(
    () => oauthService.getGhlAuthContext("loc_missing", { allowPrivateFallback: false }),
    /No HighLevel OAuth token is stored for location loc_missing/
  );
  assert.equal(rows.get("loc_A").access_token, "access_A");
  assert.equal(rows.get("loc_B").access_token, "access_B_refreshed");
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
