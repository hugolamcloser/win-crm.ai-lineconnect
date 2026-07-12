const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.GHL_API_BASE_URL = "https://services.leadconnectorhq.com";
process.env.GHL_API_VERSION = "2021-07-28";
process.env.GHL_LOCATION_ID = "legacy_global_location";
process.env.GHL_CUSTOM_PROVIDER_ID = "legacy_global_provider";
process.env.GHL_INBOUND_MESSAGE_TYPE = "Custom";
process.env.GHL_SEND_CONVERSATION_PROVIDER_ID = "true";
process.env.GHL_LOCATION_API_AUTH_MODE = "private_integration";
process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "private-contact-token";
process.env.GHL_ALLOW_PRIVATE_TOKEN_FALLBACK = "true";
const removedInboundAuthVariableName = ["GHL", "INBOUND", "SEND", "AUTH", "MODE"].join("_");
process.env[removedInboundAuthVariableName] = "private_integration";

const config = require("../dist/config/env");
const repository = require("../dist/services/repository");
const inboundClient = require("../dist/integrations/ghlInboundMessageClient");
const locationClient = require("../dist/integrations/ghlLocationClient");

const originalGetGhlOAuthToken = repository.getGhlOAuthToken;
const originalFetch = global.fetch;

afterEach(() => {
  repository.getGhlOAuthToken = originalGetGhlOAuthToken;
  global.fetch = originalFetch;
});

function buildOAuthToken(locationId) {
  return {
    id: `token_${locationId}`,
    tenant_id: `tenant_${locationId}`,
    location_id: locationId,
    company_id: "company_exact",
    access_token: `oauth-token-${locationId}`,
    refresh_token: `refresh-token-${locationId}`,
    expires_at: "2999-01-01T00:00:00.000Z",
    scopes: ["conversations/message.write"],
    token_type: "Bearer",
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:00:00.000Z"
  };
}

test("removed inbound auth variable cannot override exact-location OAuth", async () => {
  const tokenLookups = [];
  const requests = [];

  repository.getGhlOAuthToken = async (locationId) => {
    tokenLookups.push(locationId);
    return locationId === "location_exact" ? buildOAuthToken(locationId) : null;
  };
  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify({ messageId: "ghl_message_exact", conversationId: "ghl_conversation_exact" }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  };

  const result = await inboundClient.sendInboundMessageToGhl({
    tenantId: "tenant_exact",
    locationId: "location_exact",
    conversationProviderId: "provider_exact",
    contactId: "contact_exact",
    externalConversationId: "line:line_user_exact",
    externalMessageId: "line_message_exact",
    message: "OAuth-only inbound test"
  });

  assert.equal(Object.hasOwn(config.env, removedInboundAuthVariableName), false);
  assert.equal(JSON.stringify(config.getEnvPresenceReport()).includes(removedInboundAuthVariableName), false);
  assert.deepEqual(tokenLookups, ["location_exact"]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://services.leadconnectorhq.com/conversations/messages/inbound");
  assert.equal(requests[0].init.headers.Authorization, "Bearer oauth-token-location_exact");
  assert.notEqual(requests[0].init.headers.Authorization, "Bearer private-contact-token");
  assert.equal(result.diagnostics.actual_auth_mode_used, "oauth");
  assert.equal(result.diagnostics.required_auth_mode, "oauth");
  assert.equal(result.diagnostics.contact_auth_mode_used, "private_integration");
  assert.equal(result.diagnostics.token_source_selected_for_inbound_send, "stored_oauth_access_token");
  assert.equal(result.diagnostics.locationId, "location_exact");
  assert.equal(result.diagnostics.ghlProviderId, "provider_exact");
  assert.equal(Object.hasOwn(result.diagnostics, "configured_auth_mode"), false);
});

test("private integration remains available for contact operations only", async () => {
  const requests = [];
  repository.getGhlOAuthToken = async () => {
    throw new Error("Contact private integration path must not read an OAuth token");
  };
  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ contact: { id: "contact_private" } }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  };

  const contact = await locationClient.createGhlContact({
    locationId: "location_contact",
    lineUserId: "line_user_contact",
    displayName: "Private Contact"
  });

  assert.equal(contact.id, "contact_private");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://services.leadconnectorhq.com/contacts/");
  assert.equal(requests[0].init.headers.Authorization, "Bearer private-contact-token");
  assert.equal(locationClient.getConfiguredLocationApiAuthMode(), "private_integration");
});

test("missing exact-location OAuth token fails closed without an inbound request", async () => {
  let fetchCalls = 0;
  repository.getGhlOAuthToken = async (locationId) => {
    assert.equal(locationId, "location_missing");
    return null;
  };
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Inbound request must not be sent without location OAuth");
  };

  await assert.rejects(
    () =>
      inboundClient.sendInboundMessageToGhl({
        tenantId: "tenant_missing",
        locationId: "location_missing",
        conversationProviderId: "provider_missing",
        contactId: "contact_missing",
        externalConversationId: "line:line_user_missing",
        externalMessageId: "line_message_missing",
        message: "Fail-closed inbound test"
      }),
    /No HighLevel OAuth token is stored for location location_missing/
  );

  assert.equal(fetchCalls, 0);
});
