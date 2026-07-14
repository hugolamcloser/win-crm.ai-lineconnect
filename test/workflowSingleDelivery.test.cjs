const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.GHL_CUSTOM_PROVIDER_ID = "global_provider_must_not_be_used";
process.env.GHL_WORKFLOW_LINE_DELIVERY_MODE = "provider_first";

const config = require("../dist/config/env");
const repository = require("../dist/services/repository");
const workflowOutboundClient = require("../dist/integrations/ghlWorkflowOutboundMirrorClient");
const lineClient = require("../dist/integrations/lineClient");
const lineOutboundChannelService = require("../dist/services/lineOutboundChannelService");
const ghlWorkflowActionService = require("../dist/services/ghlWorkflowActionService");
const ghlSyncService = require("../dist/services/ghlSyncService");

const patchedExports = [
  [repository, "getTenantIdsByLocationId"],
  [repository, "findLineProfileByGhlIdsForTenantIds"],
  [repository, "getTenantById"],
  [repository, "findWorkflowOutboundMirrorMessageEventForTenantIds"],
  [repository, "findSentGhlOutboundProviderMessageEvent"],
  [repository, "saveMessageEvent"],
  [workflowOutboundClient, "mirrorWorkflowOutboundMessageToGhl"],
  [lineOutboundChannelService, "resolveLineChannelForOutbound"],
  [lineClient, "pushLineTextMessage"]
];
const originals = patchedExports.map(([module, key]) => [module, key, module[key]]);
const originalDeliveryMode = config.env.GHL_WORKFLOW_LINE_DELIVERY_MODE;
const originalMirrorEnabled = config.env.GHL_WORKFLOW_OUTBOUND_MIRROR_ENABLED;

afterEach(() => {
  for (const [module, key, value] of originals) {
    module[key] = value;
  }

  config.env.GHL_WORKFLOW_LINE_DELIVERY_MODE = originalDeliveryMode;
  config.env.GHL_WORKFLOW_OUTBOUND_MIRROR_ENABLED = originalMirrorEnabled;
});

function workflowPayload(overrides = {}) {
  return {
    data: { message: "one workflow reply" },
    extras: {
      locationId: "location_exact",
      contactId: "contact_exact",
      workflowId: "workflow_exact"
    },
    meta: { key: "send-line", version: "1" },
    ...overrides
  };
}

function setupWorkflowHarness() {
  const calls = {
    tenantLocations: [],
    profileLookups: [],
    tenantLookups: [],
    channelSelections: [],
    providerDispatches: [],
    linePushes: []
  };
  const messageEvents = [];

  repository.getTenantIdsByLocationId = async (locationId) => {
    calls.tenantLocations.push(locationId);
    return ["tenant_exact"];
  };
  repository.findLineProfileByGhlIdsForTenantIds = async (tenantIds, ids) => {
    calls.profileLookups.push({ tenantIds, ids });
    return {
      id: "profile_exact",
      tenant_id: "tenant_exact",
      line_user_id: "line_user_exact",
      line_channel_id: "line_channel_exact",
      ghl_contact_id: "contact_exact",
      ghl_conversation_id: "conversation_exact"
    };
  };
  repository.getTenantById = async (tenantId) => {
    calls.tenantLookups.push(tenantId);
    return {
      id: "tenant_exact",
      location_id: "location_exact",
      ghl_provider_id: "provider_exact"
    };
  };
  repository.saveMessageEvent = async (input) => {
    messageEvents.push(input);
  };
  lineOutboundChannelService.resolveLineChannelForOutbound = async (tenantId, mapping) => {
    calls.channelSelections.push({ tenantId, mapping });
    return {
      channelAccessToken: "line_token_exact",
      lineChannelId: "line_channel_exact",
      channelTokenSource: "profile_channel"
    };
  };
  workflowOutboundClient.mirrorWorkflowOutboundMessageToGhl = async (input) => {
    calls.providerDispatches.push(input);
    return {
      ok: true,
      endpoint: "/conversations/messages",
      method: "POST",
      authMode: "oauth",
      statusCode: 201,
      requestBody: {
        type: "Custom",
        contactId: input.contactId,
        message: input.message,
        status: "delivered",
        conversationProviderId: input.conversationProviderId
      },
      ghlMessageId: "ghl_message_exact",
      ghlConversationId: "conversation_exact"
    };
  };
  lineClient.pushLineTextMessage = async (...args) => {
    calls.linePushes.push(args);
    return { messageId: "line_message_unexpected" };
  };

  return { calls, messageEvents };
}

test("provider_first workflow dispatch uses the exact tenant provider and never pushes LINE directly", async () => {
  config.env.GHL_WORKFLOW_LINE_DELIVERY_MODE = "provider_first";
  const { calls, messageEvents } = setupWorkflowHarness();

  const result = await ghlWorkflowActionService.processGhlWorkflowSendLine(workflowPayload());

  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body, {
    ok: true,
    status: "sent",
    provider: "line",
    lineMessageId: null,
    error: ""
  });
  assert.deepEqual(calls.tenantLocations, ["location_exact"]);
  assert.deepEqual(calls.profileLookups, [{
    tenantIds: ["tenant_exact"],
    ids: { contactId: "contact_exact" }
  }]);
  assert.deepEqual(calls.tenantLookups, ["tenant_exact"]);
  assert.equal(calls.channelSelections.length, 1);
  assert.equal(calls.providerDispatches.length, 1);
  assert.equal(calls.providerDispatches[0].locationId, "location_exact");
  assert.equal(calls.providerDispatches[0].contactId, "contact_exact");
  assert.equal(calls.providerDispatches[0].conversationProviderId, "provider_exact");
  assert.equal(calls.linePushes.length, 0);
  assert.equal(messageEvents.length, 1);
  assert.equal(messageEvents[0].tenantId, "tenant_exact");
  assert.equal(messageEvents[0].ghlMessageId, "ghl_message_exact");
  assert.equal(messageEvents[0].status, "success");
  assert.equal(messageEvents[0].requestPayload.source, "ghl_workflow_provider_dispatch");
  assert.notEqual(messageEvents[0].requestPayload.source, "ghl_workflow_outbound_mirror");
});

test("provider_first fails closed when the mapped tenant does not belong to the exact location", async () => {
  config.env.GHL_WORKFLOW_LINE_DELIVERY_MODE = "provider_first";
  const { calls, messageEvents } = setupWorkflowHarness();
  repository.getTenantById = async () => ({
    id: "tenant_exact",
    location_id: "location_other",
    ghl_provider_id: "provider_other"
  });

  const result = await ghlWorkflowActionService.processGhlWorkflowSendLine(workflowPayload());

  assert.equal(result.body.ok, false);
  assert.equal(result.body.status, "failed");
  assert.match(result.body.error, /does not belong/);
  assert.equal(calls.channelSelections.length, 0);
  assert.equal(calls.providerDispatches.length, 0);
  assert.equal(calls.linePushes.length, 0);
  assert.equal(messageEvents.at(-1).requestPayload.source, "ghl_workflow_provider_dispatch");
});

test("provider_first missing locationId performs no tenant, profile, channel, provider, or LINE operation", async () => {
  config.env.GHL_WORKFLOW_LINE_DELIVERY_MODE = "provider_first";
  const { calls } = setupWorkflowHarness();
  const payload = workflowPayload();
  delete payload.extras.locationId;

  const result = await ghlWorkflowActionService.processGhlWorkflowSendLine(payload);

  assert.equal(result.httpStatus, 400);
  assert.equal(result.body.ok, false);
  assert.deepEqual(calls.tenantLocations, []);
  assert.deepEqual(calls.profileLookups, []);
  assert.deepEqual(calls.channelSelections, []);
  assert.deepEqual(calls.providerDispatches, []);
  assert.deepEqual(calls.linePushes, []);
});

test("provider_first disconnected channel fails before HighLevel dispatch", async () => {
  config.env.GHL_WORKFLOW_LINE_DELIVERY_MODE = "provider_first";
  const { calls, messageEvents } = setupWorkflowHarness();
  lineOutboundChannelService.resolveLineChannelForOutbound = async () => {
    throw new lineOutboundChannelService.LineChannelNotConnectedError({
      lineChannelId: "line_channel_exact",
      channelTokenSource: "profile_channel"
    });
  };

  const result = await ghlWorkflowActionService.processGhlWorkflowSendLine(workflowPayload());

  assert.equal(result.httpStatus, 409);
  assert.equal(result.body.ok, false);
  assert.equal(calls.providerDispatches.length, 0);
  assert.equal(calls.linePushes.length, 0);
  assert.equal(messageEvents.at(-1).status, "failed");
  assert.equal(messageEvents.at(-1).requestPayload.channelConnected, false);
});

test("direct_legacy rollback mode retains one direct LINE push", async () => {
  config.env.GHL_WORKFLOW_LINE_DELIVERY_MODE = "direct_legacy";
  config.env.GHL_WORKFLOW_OUTBOUND_MIRROR_ENABLED = false;
  const { calls, messageEvents } = setupWorkflowHarness();

  const result = await ghlWorkflowActionService.processGhlWorkflowSendLine(workflowPayload());

  assert.equal(result.body.ok, true);
  assert.equal(result.body.lineMessageId, "line_message_unexpected");
  assert.equal(calls.linePushes.length, 1);
  assert.equal(calls.providerDispatches.length, 0);
  assert.equal(messageEvents.at(-1).provider, "line");
  assert.equal(messageEvents.at(-1).status, "sent");
});

function setupProviderCallbackHarness() {
  const calls = {
    tenantLocations: [],
    mirrorGuards: [],
    profileLookups: [],
    idempotencyChecks: [],
    channelSelections: [],
    linePushes: []
  };
  const messageEvents = [];
  let sentEvent = null;

  repository.getTenantIdsByLocationId = async (locationId) => {
    calls.tenantLocations.push(locationId);
    return ["tenant_exact"];
  };
  repository.findWorkflowOutboundMirrorMessageEventForTenantIds = async (input) => {
    calls.mirrorGuards.push(input);
    return null;
  };
  repository.findLineProfileByGhlIdsForTenantIds = async (tenantIds, ids) => {
    calls.profileLookups.push({ tenantIds, ids });
    return {
      id: "profile_exact",
      tenant_id: "tenant_exact",
      line_user_id: "line_user_exact",
      line_channel_id: "line_channel_exact",
      ghl_contact_id: "contact_exact",
      ghl_conversation_id: "conversation_exact"
    };
  };
  repository.findSentGhlOutboundProviderMessageEvent = async (input) => {
    calls.idempotencyChecks.push(input);
    return sentEvent;
  };
  repository.saveMessageEvent = async (input) => {
    messageEvents.push(input);

    if (input.status === "sent" && input.requestPayload?.source === "ghl_outbound_provider") {
      sentEvent = {
        id: "sent_event_exact",
        tenant_id: input.tenantId,
        ghl_message_id: input.ghlMessageId,
        request_payload: input.requestPayload
      };
    }
  };
  lineOutboundChannelService.resolveLineChannelForOutbound = async (tenantId, mapping) => {
    calls.channelSelections.push({ tenantId, mapping });
    return {
      channelAccessToken: "line_token_exact",
      lineChannelId: "line_channel_exact",
      channelTokenSource: "profile_channel"
    };
  };
  lineClient.pushLineTextMessage = async (lineUserId, message, channelAccessToken) => {
    calls.linePushes.push({ lineUserId, message, channelAccessToken });
    return { messageId: "line_message_exact" };
  };

  return { calls, messageEvents };
}

function providerCallbackPayload(messageId = "ghl_message_exact") {
  return {
    locationId: "location_exact",
    contactId: "contact_exact",
    conversationId: "conversation_exact",
    messageId,
    message: "provider callback reply"
  };
}

test("provider callback sends once to the exact LINE user with the exact tenant channel token", async () => {
  const { calls, messageEvents } = setupProviderCallbackHarness();

  const result = await ghlSyncService.processGhlOutboundWebhook(providerCallbackPayload());

  assert.deepEqual(result, { status: "processed" });
  assert.deepEqual(calls.tenantLocations, ["location_exact"]);
  assert.deepEqual(calls.profileLookups[0].tenantIds, ["tenant_exact"]);
  assert.deepEqual(calls.profileLookups[0].ids, {
    contactId: "contact_exact",
    conversationId: "conversation_exact"
  });
  assert.deepEqual(calls.idempotencyChecks, [{
    tenantId: "tenant_exact",
    ghlMessageId: "ghl_message_exact"
  }]);
  assert.deepEqual(calls.linePushes, [{
    lineUserId: "line_user_exact",
    message: "provider callback reply",
    channelAccessToken: "line_token_exact"
  }]);
  assert.equal(messageEvents.at(-1).tenantId, "tenant_exact");
  assert.equal(messageEvents.at(-1).ghlMessageId, "ghl_message_exact");
  assert.equal(messageEvents.at(-1).requestPayload.source, "ghl_outbound_provider");
});

test("provider callback retry is durably acknowledged and skipped after the first successful send", async () => {
  const { calls, messageEvents } = setupProviderCallbackHarness();
  const payload = providerCallbackPayload("ghl_message_retry");

  const first = await ghlSyncService.processGhlOutboundWebhook(payload);
  const second = await ghlSyncService.processGhlOutboundWebhook(payload);

  assert.deepEqual(first, { status: "processed" });
  assert.deepEqual(second, { status: "skipped", reason: "Already sent" });
  assert.equal(calls.linePushes.length, 1);
  assert.equal(calls.channelSelections.length, 1);
  assert.equal(calls.idempotencyChecks.length, 2);
  assert.equal(messageEvents.at(-1).status, "skipped");
  assert.equal(messageEvents.at(-1).requestPayload.skipReason, "already_sent");
});

test("provider callback with a disconnected exact-tenant channel fails closed without a LINE push", async () => {
  const { calls, messageEvents } = setupProviderCallbackHarness();
  lineOutboundChannelService.resolveLineChannelForOutbound = async () => {
    throw new lineOutboundChannelService.LineChannelNotConnectedError({
      lineChannelId: "line_channel_exact",
      channelTokenSource: "profile_channel"
    });
  };

  await assert.rejects(
    () => ghlSyncService.processGhlOutboundWebhook(providerCallbackPayload("ghl_disconnected_message")),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /LINE channel is not connected/);
      return true;
    }
  );

  assert.equal(calls.linePushes.length, 0);
  assert.equal(messageEvents.at(-1).status, "failed");
  assert.equal(messageEvents.at(-1).tenantId, "tenant_exact");
  assert.equal(messageEvents.at(-1).requestPayload.channelConnected, false);
});

test("manual HighLevel Conversations outbound messages remain compatible and send exactly once", async () => {
  const { calls } = setupProviderCallbackHarness();

  const result = await ghlSyncService.processGhlOutboundWebhook(
    providerCallbackPayload("ghl_manual_message")
  );

  assert.deepEqual(result, { status: "processed" });
  assert.equal(calls.linePushes.length, 1);
  assert.equal(calls.linePushes[0].lineUserId, "line_user_exact");
  assert.equal(calls.linePushes[0].channelAccessToken, "line_token_exact");
});
