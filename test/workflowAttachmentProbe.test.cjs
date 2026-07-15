const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const config = require("../dist/config/env");
const loggerModule = require("../dist/config/logger");
const supabaseConfig = require("../dist/config/supabase");
const repository = require("../dist/services/repository");
const lineClient = require("../dist/integrations/lineClient");
const ghlClient = require("../dist/integrations/ghlClient");
const ghlInboundMessageClient = require("../dist/integrations/ghlInboundMessageClient");
const ghlLocationClient = require("../dist/integrations/ghlLocationClient");
const workflowOutboundClient = require("../dist/integrations/ghlWorkflowOutboundMirrorClient");
const { createApp } = require("../dist/app");

const originalEnv = { ...config.env };
const originalLoggerInfo = loggerModule.logger.info;
const originalGetSupabase = supabaseConfig.getSupabase;
const patchedFunctions = [];

afterEach(() => {
  Object.assign(config.env, originalEnv);
  loggerModule.logger.info = originalLoggerInfo;
  supabaseConfig.getSupabase = originalGetSupabase;

  while (patchedFunctions.length > 0) {
    const [module, key, original] = patchedFunctions.pop();
    module[key] = original;
  }
});

function patchFunctionsToFail(module, label, predicate = () => true) {
  for (const [key, value] of Object.entries(module)) {
    if (typeof value !== "function" || !predicate(key)) {
      continue;
    }

    patchedFunctions.push([module, key, value]);
    module[key] = async () => {
      throw new Error(`${label} function must not be called: ${key}`);
    };
  }
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
          path: "/debug/workflow-action-attachment-probe",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(rawBody),
            ...(input.secret
              ? { [input.headerName ?? "x-wincrm-webhook-secret"]: input.secret }
              : {})
          }
        },
        (response) => {
          let responseBody = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            responseBody += chunk;
          });
          response.on("end", () => {
            server.close(() => {
              resolve({
                statusCode: response.statusCode,
                body: responseBody ? JSON.parse(responseBody) : null
              });
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

function protectedPayload(overrides = {}) {
  return {
    data: {
      imageAttachmentProbe: "https://cdn.example.com/image.png",
      imageUrlProbe: "https://images.example.com/image.png",
      ...overrides
    },
    extras: {
      locationId: "location_probe",
      contactId: "contact_probe",
      workflowId: "workflow_probe"
    },
    meta: { key: "attachment-probe", version: "1" }
  };
}

function assertCommonPresence(body) {
  assert.match(body.requestId, /^\d+$/);
  assert.equal(body.locationIdPresent, true);
  assert.equal(body.contactIdPresent, true);
  assert.equal(body.workflowIdPresent, true);
  assert.equal(body.imageAttachmentProbePresent, true);
  assert.equal(body.imageUrlProbePresent, true);
  assert.equal(body.imageUrlProbeHttps, true);
}

test("production probe rejects missing and invalid x-wincrm-webhook-secret headers", async () => {
  config.env.NODE_ENV = "production";
  config.env.WEBHOOK_SHARED_SECRET = "probe-shared-secret";

  const missing = await requestApp({ body: protectedPayload() });
  const invalid = await requestApp({ body: protectedPayload(), secret: "wrong-secret" });

  assert.equal(missing.statusCode, 401);
  assert.equal(missing.body.error, "Invalid shared secret");
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.body.error, "Invalid shared secret");
});

test("production probe accepts the Marketplace x-wincrm-webhook-secret header", async () => {
  config.env.NODE_ENV = "production";
  config.env.WEBHOOK_SHARED_SECRET = "probe-shared-secret";

  const response = await requestApp({
    body: protectedPayload(),
    secret: "probe-shared-secret",
    headerName: "x-wincrm-webhook-secret"
  });

  assert.equal(response.statusCode, 200);
  assertCommonPresence(response.body);
});

test("production probe retains intentional x-webhook-secret support", async () => {
  config.env.NODE_ENV = "production";
  config.env.WEBHOOK_SHARED_SECRET = "probe-shared-secret";

  const response = await requestApp({
    body: protectedPayload(),
    secret: "probe-shared-secret",
    headerName: "x-webhook-secret"
  });

  assert.equal(response.statusCode, 200);
  assertCommonPresence(response.body);
});

test("protected probe accepts payload metadata without calling external or persistence functions", async () => {
  config.env.NODE_ENV = "production";
  config.env.WEBHOOK_SHARED_SECRET = "probe-shared-secret";
  patchFunctionsToFail(lineClient, "LINE");
  patchFunctionsToFail(ghlClient, "HighLevel");
  patchFunctionsToFail(ghlInboundMessageClient, "HighLevel inbound message");
  patchFunctionsToFail(ghlLocationClient, "HighLevel location");
  patchFunctionsToFail(workflowOutboundClient, "HighLevel workflow outbound");
  patchFunctionsToFail(repository, "repository write", (key) =>
    /^(claim|clear|complete|ensure|fail|finalize|link|mark|save|set|update|upsert)/.test(key)
  );
  supabaseConfig.getSupabase = () => {
    throw new Error("Supabase must not be accessed by the attachment probe");
  };

  const response = await requestApp({
    body: protectedPayload(),
    secret: "probe-shared-secret"
  });

  assert.equal(response.statusCode, 200);
  assertCommonPresence(response.body);
  assert.equal(response.body.imageAttachmentProbeValueType, "string");
  assert.equal(response.body.attachmentEntryCount, 1);
  assert.deepEqual(response.body.attachmentTopLevelKeys, []);
  assert.deepEqual(response.body.attachmentArrayElementTypes, []);
  assert.equal(response.body.attachmentStringLooksLikeJson, false);
  assert.equal(response.body.attachmentStringDecodedType, null);
  assert.equal(response.body.httpsUrlFieldPath, "$");
});

test("probe classifies a string attachment and returns only its safe URL metadata", async () => {
  config.env.NODE_ENV = "production";
  config.env.WEBHOOK_SHARED_SECRET = "probe-shared-secret";
  const response = await requestApp({
    body: protectedPayload({
      imageAttachmentProbe: "https://cdn.example.com/private/image.png?signature=secret-value"
    }),
    secret: "probe-shared-secret"
  });

  assert.equal(response.statusCode, 200);
  assertCommonPresence(response.body);
  assert.equal(response.body.imageAttachmentProbeValueType, "string");
  assert.equal(response.body.attachmentEntryCount, 1);
  assert.equal(response.body.httpsUrlDetected, true);
  assert.equal(response.body.urlHostname, "cdn.example.com");
  assert.equal(response.body.urlHasQueryParameters, true);
});

test("probe classifies an attachment array and counts its entries", async () => {
  config.env.NODE_ENV = "production";
  config.env.WEBHOOK_SHARED_SECRET = "probe-shared-secret";
  const response = await requestApp({
    body: protectedPayload({
      imageAttachmentProbe: [
        "http://insecure.example.com/image.png",
        "https://array.example.com/image.png"
      ]
    }),
    secret: "probe-shared-secret"
  });

  assert.equal(response.statusCode, 200);
  assertCommonPresence(response.body);
  assert.equal(response.body.imageAttachmentProbeValueType, "array");
  assert.equal(response.body.attachmentEntryCount, 2);
  assert.equal(response.body.httpsUrlDetected, true);
  assert.equal(response.body.urlHostname, "array.example.com");
  assert.equal(response.body.urlHasQueryParameters, false);
});

test("probe reports array element types and an object URL path without returning contents", async () => {
  config.env.NODE_ENV = "production";
  config.env.WEBHOOK_SHARED_SECRET = "probe-shared-secret";
  const filename = "private-array-image.png";
  const response = await requestApp({
    body: protectedPayload({
      imageAttachmentProbe: [
        {
          filename,
          url: "https://array-object.example.com/private/image.png?signature=array-secret"
        },
        "opaque-array-content",
        42,
        true,
        null,
        []
      ]
    }),
    secret: "probe-shared-secret"
  });
  const responseText = JSON.stringify(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.attachmentTopLevelKeys, []);
  assert.deepEqual(response.body.attachmentArrayElementTypes, [
    "object",
    "string",
    "number",
    "boolean",
    "null",
    "array"
  ]);
  assert.equal(response.body.httpsUrlFieldPath, "$[0].url");
  assert.match(response.body.httpsUrlFieldPath, /^\$(?:\[\d+\]|\.[A-Za-z_][A-Za-z0-9_]*)*$/);
  assert.equal(responseText.includes(filename), false);
  assert.equal(responseText.includes("opaque-array-content"), false);
  assert.equal(responseText.includes("array-secret"), false);
});

test("probe classifies an attachment object without returning object contents", async () => {
  config.env.NODE_ENV = "production";
  config.env.WEBHOOK_SHARED_SECRET = "probe-shared-secret";
  const objectSecret = "object-bearer-secret";
  const response = await requestApp({
    body: protectedPayload({
      imageAttachmentProbe: {
        url: "https://object.example.com/image.png",
        headers: { authorization: objectSecret }
      }
    }),
    secret: "probe-shared-secret"
  });

  assert.equal(response.statusCode, 200);
  assertCommonPresence(response.body);
  assert.equal(response.body.imageAttachmentProbeValueType, "object");
  assert.equal(response.body.attachmentEntryCount, 1);
  assert.equal(response.body.httpsUrlDetected, true);
  assert.equal(response.body.urlHostname, "object.example.com");
  assert.equal(JSON.stringify(response.body).includes(objectSecret), false);
});

test("probe reports sanitized top-level keys and a nested URL field path without values", async () => {
  config.env.NODE_ENV = "production";
  config.env.WEBHOOK_SHARED_SECRET = "probe-shared-secret";
  const unsafePropertyName = "private-file[0].png";
  const nestedSecret = "nested-object-secret";
  const response = await requestApp({
    body: protectedPayload({
      imageAttachmentProbe: {
        [unsafePropertyName]: {
          url: "https://nested.example.com/private/file.png?signature=nested-signature",
          token: nestedSecret
        },
        safeMetadata: "metadata-value-must-not-return"
      }
    }),
    secret: "probe-shared-secret"
  });
  const responseText = JSON.stringify(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.attachmentTopLevelKeys, ["field_0", "safeMetadata"]);
  assert.equal(response.body.httpsUrlFieldPath, "$.field_0.url");
  assert.match(response.body.httpsUrlFieldPath, /^\$(?:\[\d+\]|\.[A-Za-z_][A-Za-z0-9_]*)*$/);
  for (const sensitiveValue of [
    unsafePropertyName,
    nestedSecret,
    "nested-signature",
    "metadata-value-must-not-return",
    "private/file.png"
  ]) {
    assert.equal(responseText.includes(sensitiveValue), false);
  }
});

test("probe identifies JSON-encoded attachment strings by broad decoded type only", async () => {
  config.env.NODE_ENV = "production";
  config.env.WEBHOOK_SHARED_SECRET = "probe-shared-secret";
  const decodedSecret = "decoded-json-secret";
  const encodedAttachment = JSON.stringify([{ url: `https://json.example.com/${decodedSecret}.png` }]);
  const response = await requestApp({
    body: protectedPayload({ imageAttachmentProbe: encodedAttachment }),
    secret: "probe-shared-secret"
  });
  const responseText = JSON.stringify(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.imageAttachmentProbeValueType, "string");
  assert.equal(response.body.attachmentStringLooksLikeJson, true);
  assert.equal(response.body.attachmentStringDecodedType, "array");
  assert.equal(response.body.httpsUrlDetected, false);
  assert.equal(response.body.httpsUrlFieldPath, null);
  assert.equal(responseText.includes(decodedSecret), false);
  assert.equal(responseText.includes(encodedAttachment), false);
});

test("probe caps returned keys, array inspection, traversal depth, and total inspected nodes", async () => {
  config.env.NODE_ENV = "production";
  config.env.WEBHOOK_SHARED_SECRET = "probe-shared-secret";
  const largeObject = Object.fromEntries(
    Array.from({ length: 25 }, (_, index) => [`key_${index}`, `value_${index}`])
  );
  let deepObject = { url: "https://too-deep.example.com/private/deep-file.png" };
  for (let index = 0; index < 8; index += 1) {
    deepObject = { child: deepObject };
  }
  const wideObject = Object.fromEntries(
    Array.from({ length: 20 }, (_, outerIndex) => [
      `branch_${outerIndex}`,
      Object.fromEntries(
        Array.from({ length: 20 }, (_, innerIndex) => [
          `leaf_${innerIndex}`,
          outerIndex === 19 && innerIndex === 19
            ? "https://node-limit.example.com/private/last-file.png"
            : `opaque_${outerIndex}_${innerIndex}`
        ])
      )
    ])
  );

  const [keysResponse, arrayResponse, depthResponse, nodesResponse] = await Promise.all([
    requestApp({
      body: protectedPayload({ imageAttachmentProbe: largeObject }),
      secret: "probe-shared-secret"
    }),
    requestApp({
      body: protectedPayload({
        imageAttachmentProbe: [
          ...Array.from({ length: 10 }, (_, index) => `opaque_${index}`),
          "https://array-limit.example.com/private/uninspected-file.png"
        ]
      }),
      secret: "probe-shared-secret"
    }),
    requestApp({
      body: protectedPayload({ imageAttachmentProbe: deepObject }),
      secret: "probe-shared-secret"
    }),
    requestApp({
      body: protectedPayload({ imageAttachmentProbe: wideObject }),
      secret: "probe-shared-secret"
    })
  ]);

  assert.equal(keysResponse.body.attachmentTopLevelKeys.length, 20);
  assert.equal(keysResponse.body.attachmentTopLevelKeys.includes("key_20"), false);
  assert.equal(arrayResponse.body.attachmentArrayElementTypes.length, 10);
  assert.equal(arrayResponse.body.httpsUrlDetected, false);
  assert.equal(arrayResponse.body.httpsUrlFieldPath, null);
  assert.equal(depthResponse.body.httpsUrlDetected, false);
  assert.equal(depthResponse.body.httpsUrlFieldPath, null);
  assert.equal(nodesResponse.body.httpsUrlDetected, false);
  assert.equal(nodesResponse.body.httpsUrlFieldPath, null);
});

test("probe omits full attachment URLs, signed query values, payload secrets, and headers from response and logs", async () => {
  config.env.NODE_ENV = "production";
  config.env.WEBHOOK_SHARED_SECRET = "probe-shared-secret";
  const attachmentUrl =
    "https://signed.example.com/private/image.png?X-Amz-Signature=signed-query-secret&token=url-token-secret";
  const imageUrl = "https://images.example.com/image.png?signature=image-url-secret";
  const filename = "confidential-customer-filename.png";
  const payloadSecret = "payload-access-token-secret";
  const logCalls = [];
  loggerModule.logger.info = (...args) => {
    logCalls.push(args);
  };

  const response = await requestApp({
    body: {
      ...protectedPayload({
        imageAttachmentProbe: { file: { filename, url: attachmentUrl } },
        imageUrlProbe: imageUrl
      }),
      headers: { authorization: `Bearer ${payloadSecret}` },
      access_token: payloadSecret
    },
    secret: "probe-shared-secret"
  });
  const responseText = JSON.stringify(response.body);
  const logText = JSON.stringify(logCalls);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.urlHostname, "signed.example.com");
  assert.equal(response.body.urlHasQueryParameters, true);
  assert.equal(response.body.httpsUrlFieldPath, "$.file.url");
  assert.equal(response.body.imageUrlProbeHttps, true);
  for (const sensitiveValue of [
    attachmentUrl,
    imageUrl,
    "signed-query-secret",
    "url-token-secret",
    "image-url-secret",
    filename,
    payloadSecret,
    "probe-shared-secret"
  ]) {
    assert.equal(responseText.includes(sensitiveValue), false);
    assert.equal(logText.includes(sensitiveValue), false);
  }
  assert.equal(logCalls.length, 1);
  assert.deepEqual(logCalls[0][0], response.body);
  assert.equal(logCalls[0][1], "Inspected HighLevel workflow action attachment probe metadata");
});
