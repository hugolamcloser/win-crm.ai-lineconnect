const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.GHL_API_BASE_URL = "https://services.leadconnectorhq.com";
process.env.GHL_API_VERSION = "v3";
process.env.GHL_OAUTH_CLIENT_ID = "oauth-client";
process.env.GHL_OAUTH_CLIENT_SECRET = "oauth-client-secret";
process.env.GHL_OAUTH_REDIRECT_URI = "https://example.com/oauth/callback";
process.env.WEBHOOK_SHARED_SECRET = "stage-zero-shared-secret";

const config = require("../dist/config/env");
const loggerModule = require("../dist/config/logger");
const repository = require("../dist/services/repository");
const oauthService = require("../dist/services/ghlOAuthService");
const probeClient = require("../dist/integrations/ghlInternalCommentProbeClient");
const probeService = require("../dist/services/ghlInternalCommentProbeService");
const workflowMirrorClient = require("../dist/integrations/ghlWorkflowOutboundMirrorClient");
const lineClient = require("../dist/integrations/lineClient");
const ghlSyncService = require("../dist/services/ghlSyncService");
const { createApp } = require("../dist/app");

const originalFetch = global.fetch;
const originalEnv = { ...config.env };
const originals = {
  getTenantIdsByLocationId: repository.getTenantIdsByLocationId,
  hasLineProfileForGhlContactInTenantIds: repository.hasLineProfileForGhlContactInTenantIds,
  getGhlAuthContext: oauthService.getGhlAuthContext,
  forceRefreshGhlAuthContext: oauthService.forceRefreshGhlAuthContext,
  createGhlInternalCommentProbe: probeClient.createGhlInternalCommentProbe,
  mirrorWorkflowOutboundMessageToGhl: workflowMirrorClient.mirrorWorkflowOutboundMessageToGhl,
  pushLineTextMessage: lineClient.pushLineTextMessage,
  pushLineImageMessage: lineClient.pushLineImageMessage,
  pushLineMessages: lineClient.pushLineMessages,
  processGhlOutboundWebhook: ghlSyncService.processGhlOutboundWebhook,
  loggerInfo: loggerModule.logger.info,
  loggerWarn: loggerModule.logger.warn,
  loggerError: loggerModule.logger.error
};

afterEach(() => {
  Object.assign(config.env, originalEnv);
  repository.getTenantIdsByLocationId = originals.getTenantIdsByLocationId;
  repository.hasLineProfileForGhlContactInTenantIds = originals.hasLineProfileForGhlContactInTenantIds;
  oauthService.getGhlAuthContext = originals.getGhlAuthContext;
  oauthService.forceRefreshGhlAuthContext = originals.forceRefreshGhlAuthContext;
  probeClient.createGhlInternalCommentProbe = originals.createGhlInternalCommentProbe;
  workflowMirrorClient.mirrorWorkflowOutboundMessageToGhl = originals.mirrorWorkflowOutboundMessageToGhl;
  lineClient.pushLineTextMessage = originals.pushLineTextMessage;
  lineClient.pushLineImageMessage = originals.pushLineImageMessage;
  lineClient.pushLineMessages = originals.pushLineMessages;
  ghlSyncService.processGhlOutboundWebhook = originals.processGhlOutboundWebhook;
  loggerModule.logger.info = originals.loggerInfo;
  loggerModule.logger.warn = originals.loggerWarn;
  loggerModule.logger.error = originals.loggerError;
  global.fetch = originalFetch;
});

function setupUnmappedContact() {
  repository.getTenantIdsByLocationId = async () => ["tenant-stage-zero"];
  repository.hasLineProfileForGhlContactInTenantIds = async () => false;
}

function requestApp(input) {
  return new Promise((resolve, reject) => {
    const app = createApp();
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const rawBody = JSON.stringify(input.body ?? {});
      const request = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: input.path,
          method: input.method ?? "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(rawBody),
            ...(input.headers ?? {})
          }
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            server.close((closeError) => {
              if (closeError) {
                reject(closeError);
                return;
              }
              resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
            });
          });
        }
      );
      request.on("error", (error) => server.close(() => reject(error)));
      request.end(rawBody);
    });
    server.on("error", reject);
  });
}

test("InternalComment proof requires the x-wincrm-webhook-secret header", async () => {
  let probeCalls = 0;
  setupUnmappedContact();
  probeClient.createGhlInternalCommentProbe = async () => {
    probeCalls += 1;
    return {
      ok: true,
      statusCode: 200,
      authMode: "oauth",
      messageId: "message-returned-to-authorized-caller",
      conversationId: "conversation-returned-to-authorized-caller",
      responseJsonParsed: true
    };
  };

  const missing = await requestApp({
    path: "/debug/ghl/internal-comment-proof",
    body: { locationId: "location-sensitive", contactId: "contact-sensitive", probeCase: "A" }
  });
  const invalid = await requestApp({
    path: "/debug/ghl/internal-comment-proof",
    headers: { "x-wincrm-webhook-secret": "invalid-secret" },
    body: { locationId: "location-sensitive", contactId: "contact-sensitive", probeCase: "A" }
  });
  const valid = await requestApp({
    path: "/debug/ghl/internal-comment-proof",
    headers: { "x-wincrm-webhook-secret": "stage-zero-shared-secret" },
    body: { locationId: "location-sensitive", contactId: "contact-sensitive", probeCase: "A" }
  });

  assert.equal(missing.status, 401);
  assert.equal(invalid.status, 401);
  assert.equal(valid.status, 200);
  assert.equal(valid.body.conversationProviderIdIncluded, false);
  assert.equal(valid.body.lineApiCalledByProbe, false);
  assert.equal(probeCalls, 1);
});

test("cases A, B and C never include conversationProviderId or invoke mirror and LINE clients", async () => {
  const requests = [];
  let mirrorCalls = 0;
  let lineCalls = 0;
  setupUnmappedContact();
  oauthService.getGhlAuthContext = async (locationId, options) => {
    assert.equal(options.allowPrivateFallback, false);
    return { mode: "oauth", accessToken: "oauth-token-sensitive", locationId };
  };
  workflowMirrorClient.mirrorWorkflowOutboundMessageToGhl = async () => {
    mirrorCalls += 1;
    throw new Error("The provider-first mirror must not be called");
  };
  for (const key of ["pushLineTextMessage", "pushLineImageMessage", "pushLineMessages"]) {
    lineClient[key] = async () => {
      lineCalls += 1;
      throw new Error("LINE must not be called");
    };
  }
  global.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    requests.push(payload);
    return new Response(JSON.stringify({
      messageId: `ghl-message-${requests.length}`,
      conversationId: "ghl-conversation-sensitive"
    }), { status: 200 });
  };

  await probeService.runInternalCommentProbe({
    locationId: "location-sensitive",
    contactId: "contact-sensitive",
    probeCase: "A"
  });
  await probeService.runInternalCommentProbe({
    locationId: "location-sensitive",
    contactId: "contact-sensitive",
    probeCase: "B",
    resourceUrl: "https://safe.example/proof-link"
  });
  await probeService.runInternalCommentProbe({
    locationId: "location-sensitive",
    contactId: "contact-sensitive",
    probeCase: "C",
    resourceUrl: "https://safe.example/proof-image.png"
  });

  assert.equal(requests.length, 3);
  for (const payload of requests) {
    assert.equal(payload.type, "InternalComment");
    assert.equal(payload.status, "delivered");
    assert.equal(Object.hasOwn(payload, "conversationProviderId"), false);
  }
  assert.equal(requests[0].attachments, undefined);
  assert.match(requests[1].message, /https:\/\/safe\.example\/proof-link/);
  assert.deepEqual(requests[2].attachments, ["https://safe.example/proof-image.png"]);
  assert.equal(mirrorCalls, 0);
  assert.equal(lineCalls, 0);
});

test("a contact with any tenant-scoped LINE profile mapping is rejected before HighLevel", async () => {
  let highLevelCalls = 0;
  repository.getTenantIdsByLocationId = async () => ["tenant-stage-zero"];
  repository.hasLineProfileForGhlContactInTenantIds = async () => true;
  probeClient.createGhlInternalCommentProbe = async () => {
    highLevelCalls += 1;
    throw new Error("HighLevel must not be called for a mapped contact");
  };

  await assert.rejects(
    () => probeService.runInternalCommentProbe({
      locationId: "location-sensitive",
      contactId: "mapped-contact-sensitive",
      probeCase: "A"
    }),
    (error) => error.statusCode === 409 && /must not have a LINE profile mapping/.test(error.message)
  );
  assert.equal(highLevelCalls, 0);
});

test("InternalComment client refreshes OAuth once after a 401 without adding provider metadata", async () => {
  const calls = [];
  let refreshCalls = 0;
  oauthService.getGhlAuthContext = async (locationId) => ({
    mode: "oauth",
    accessToken: "expired-oauth-token-sensitive",
    locationId
  });
  oauthService.forceRefreshGhlAuthContext = async (locationId) => {
    refreshCalls += 1;
    return { mode: "oauth", accessToken: "refreshed-oauth-token-sensitive", locationId };
  };
  global.fetch = async (_url, init) => {
    calls.push({ headers: init.headers, payload: JSON.parse(init.body) });
    if (calls.length === 1) {
      return new Response("rejected-body-token-sensitive", { status: 401 });
    }
    return new Response(JSON.stringify({ messageId: 12345, conversationId: "conversation-safe-return" }), {
      status: 200
    });
  };

  const result = await probeClient.createGhlInternalCommentProbe({
    locationId: "location-sensitive",
    contactId: "contact-sensitive",
    probeCase: "A"
  });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, "12345");
  assert.equal(refreshCalls, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers.Authorization, "Bearer expired-oauth-token-sensitive");
  assert.equal(calls[1].headers.Authorization, "Bearer refreshed-oauth-token-sensitive");
  assert.equal(Object.hasOwn(calls[0].payload, "conversationProviderId"), false);
});

test("unsafe HighLevel response content and probe inputs never enter structured logs", async () => {
  const logEntries = [];
  const sensitiveValues = [
    "location-sensitive-value",
    "contact-sensitive-value",
    "oauth-token-sensitive-value",
    "https://safe.example/image-sensitive.png?token=signed-sensitive-value",
    "customer-message-sensitive-value"
  ];
  loggerModule.logger.info = (metadata, message) => logEntries.push({ metadata, message });
  oauthService.getGhlAuthContext = async (locationId) => ({
    mode: "oauth",
    accessToken: sensitiveValues[2],
    locationId
  });
  global.fetch = async () => new Response(
    `${sensitiveValues[4]} ${sensitiveValues[3]} ${sensitiveValues[2]} ${"x".repeat(40_000)}`,
    { status: 200, headers: { "content-type": "text/plain" } }
  );

  const result = await probeClient.createGhlInternalCommentProbe({
    requestId: "safe-correlation-id",
    locationId: sensitiveValues[0],
    contactId: sensitiveValues[1],
    probeCase: "C",
    resourceUrl: sensitiveValues[3]
  });
  const serializedLogs = JSON.stringify(logEntries);

  assert.equal(result.ok, true);
  assert.equal(result.responseJsonParsed, false);
  assert.equal(result.messageId, undefined);
  assert.equal(result.conversationId, undefined);
  for (const sensitiveValue of sensitiveValues) {
    assert.equal(serializedLogs.includes(sensitiveValue), false);
  }
  assert.match(serializedLogs, /safe-correlation-id/);
  assert.match(serializedLogs, /conversationProviderIdIncluded/);
  assert.match(serializedLogs, /statusCode/);
});

test("registered probe contact provider callbacks are observed and intercepted before LINE delivery", async () => {
  const warningLogs = [];
  let providerHandlerCalls = 0;
  let lineCalls = 0;
  setupUnmappedContact();
  config.env.GHL_CUSTOM_PROVIDER_SECRET = "provider-secret-sensitive";
  probeClient.createGhlInternalCommentProbe = async () => ({
    ok: true,
    statusCode: 200,
    authMode: "oauth",
    messageId: "created-message-sensitive",
    conversationId: "created-conversation-sensitive",
    responseJsonParsed: true
  });
  await probeService.runInternalCommentProbe({
    locationId: "location-sensitive",
    contactId: "registered-contact-sensitive",
    probeCase: "A"
  });
  ghlSyncService.processGhlOutboundWebhook = async () => {
    providerHandlerCalls += 1;
    return { status: "processed" };
  };
  for (const key of ["pushLineTextMessage", "pushLineImageMessage", "pushLineMessages"]) {
    lineClient[key] = async () => {
      lineCalls += 1;
      throw new Error("LINE must not be called");
    };
  }
  loggerModule.logger.warn = (metadata, message) => warningLogs.push({ metadata, message });

  const response = await requestApp({
    path: "/webhooks/ghl/line/outbound",
    headers: { "x-provider-secret": "provider-secret-sensitive" },
    body: {
      type: "Custom",
      locationId: "location-sensitive",
      contactId: "registered-contact-sensitive",
      conversationId: "callback-conversation-sensitive",
      messageId: "callback-message-sensitive",
      message: "callback-customer-message-sensitive",
      attachments: ["https://safe.example/callback-sensitive.png?token=signed-sensitive"]
    }
  });
  const serializedLogs = JSON.stringify(warningLogs);

  assert.equal(response.status, 200);
  assert.equal(response.body.result.status, "skipped");
  assert.equal(response.body.result.eventKind, "provider_callback_candidate");
  assert.equal(providerHandlerCalls, 0);
  assert.equal(lineCalls, 0);
  assert.match(serializedLogs, /internalCommentProbeEventObserved/);
  assert.match(serializedLogs, /safety_intercepted/);
  for (const sensitiveValue of [
    "location-sensitive",
    "registered-contact-sensitive",
    "callback-conversation-sensitive",
    "callback-message-sensitive",
    "callback-customer-message-sensitive",
    "signed-sensitive",
    "provider-secret-sensitive"
  ]) {
    assert.equal(serializedLogs.includes(sensitiveValue), false);
  }
});

test("generic InternalComment OutboundMessage webhooks are observable without entering provider delivery", async () => {
  let providerHandlerCalls = 0;
  let lineCalls = 0;
  config.env.GHL_CUSTOM_PROVIDER_SECRET = "provider-secret-sensitive";
  ghlSyncService.processGhlOutboundWebhook = async () => {
    providerHandlerCalls += 1;
    return { status: "processed" };
  };
  lineClient.pushLineTextMessage = async () => {
    lineCalls += 1;
    throw new Error("LINE must not be called");
  };

  const response = await requestApp({
    path: "/webhooks/ghl/line/outbound",
    headers: { "x-provider-secret": "provider-secret-sensitive" },
    body: {
      type: "OutboundMessage",
      messageType: "InternalComment",
      locationId: "location-sensitive",
      contactId: "unregistered-contact-sensitive",
      conversationId: "conversation-sensitive",
      messageId: "message-sensitive",
      body: "Stage 0 InternalComment proof: internal-comment-content-sensitive"
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.result.status, "skipped");
  assert.equal(response.body.result.eventKind, "outbound_webhook");
  assert.equal(providerHandlerCalls, 0);
  assert.equal(lineCalls, 0);
});
