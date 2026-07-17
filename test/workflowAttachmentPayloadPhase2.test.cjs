const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");

process.env.NODE_ENV = "production";
process.env.LOG_LEVEL = "silent";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.WEBHOOK_SHARED_SECRET = crypto.randomUUID();

const { createApp } = require("../dist/app");
const config = require("../dist/config/env");
const loggerModule = require("../dist/config/logger");

const originalLoggerInfo = loggerModule.logger.info;

afterEach(() => {
  loggerModule.logger.info = originalLoggerInfo;
});

function requestApp(input) {
  return new Promise((resolve, reject) => {
    const app = createApp();
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const rawBody = JSON.stringify(input.body);
      const request = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/debug/ghl/workflow-attachment-payload",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(rawBody),
            ...(input.authorized
              ? { "x-wincrm-webhook-secret": config.env.WEBHOOK_SHARED_SECRET }
              : {})
          }
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            const responseText = Buffer.concat(chunks).toString("utf8");
            server.close((closeError) => {
              if (closeError) {
                reject(closeError);
                return;
              }

              resolve({
                status: response.statusCode,
                body: responseText ? JSON.parse(responseText) : null
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

function captureProbeLogs() {
  const logs = [];
  loggerModule.logger.info = (...args) => logs.push(args);
  return logs;
}

function emptyFieldMetadata() {
  return {
    present: false,
    type: "undefined",
    isArray: false,
    arrayLength: null,
    stringLength: null,
    nonEmptyString: false,
    nonWhitespaceString: false,
    objectKeys: [],
    urlLikeValuePresent: false,
    mimeTypePresent: false,
    filenamePresent: false,
    attachmentObjectCount: 0,
    urlPresentCount: 0,
    namePresentCount: 0,
    sizePresentCount: 0,
    missingUrlCount: 0,
    imageCount: 0,
    videoCount: 0,
    audioCount: 0,
    documentCount: 0,
    otherCount: 0
  };
}

test("attachment payload probe reports missing fields", async () => {
  const response = await requestApp({ authorized: true, body: {} });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.fields.message, emptyFieldMetadata());
  assert.deepEqual(response.body.fields.imageAttachment, emptyFieldMetadata());
  assert.deepEqual(response.body.fields.videoAttachment, emptyFieldMetadata());
});

test("attachment payload probe classifies an empty string without returning it", async () => {
  const response = await requestApp({ authorized: true, body: { message: "" } });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.fields.message, {
    ...emptyFieldMetadata(),
    present: true,
    type: "string",
    stringLength: 0
  });
});

test("attachment payload probe distinguishes a whitespace-only string", async () => {
  const response = await requestApp({ authorized: true, body: { message: "   " } });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.fields.message, {
    ...emptyFieldMetadata(),
    present: true,
    type: "string",
    stringLength: 3,
    nonEmptyString: true
  });
});

test("attachment payload probe reports non-empty string metadata without exposing message text", async () => {
  const logs = captureProbeLogs();
  const customerMessage = "customer-message-value-fixture";
  const response = await requestApp({ authorized: true, body: { message: customerMessage } });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.fields.message, {
    ...emptyFieldMetadata(),
    present: true,
    type: "string",
    stringLength: customerMessage.length,
    nonEmptyString: true,
    nonWhitespaceString: true
  });
  assert.deepEqual(response.body.fields.imageAttachment, emptyFieldMetadata());
  assert.deepEqual(response.body.fields.videoAttachment, emptyFieldMetadata());
  assert.doesNotMatch(JSON.stringify({ response: response.body, logs }), /customer-message-value-fixture/);
});

test("attachment payload probe classifies a string URL without returning it", async () => {
  const logs = captureProbeLogs();
  const attachmentUrl = "https://media.example.test/private/customer-image.png?signature=signed-value-fixture";
  const response = await requestApp({
    authorized: true,
    body: { imageAttachment: attachmentUrl }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.fields.imageAttachment, {
    ...emptyFieldMetadata(),
    present: true,
    type: "string",
    stringLength: attachmentUrl.length,
    nonEmptyString: true,
    nonWhitespaceString: true,
    urlLikeValuePresent: true,
  });
  assert.doesNotMatch(
    JSON.stringify({ response: response.body, logs }),
    /media\.example\.test|customer-image\.png|signed-value-fixture/
  );
});

test("attachment payload probe classifies an attachment object safely", async () => {
  const logs = captureProbeLogs();
  const response = await requestApp({
    authorized: true,
    body: {
      data: {
        imageAttachment: {
          url: "https://media.example.test/private/object-image.png?token=object-signed-value",
          mimeType: "image/png",
          filename: "object-customer-image.png",
          accessToken: "object-token-value",
          locationId: "object-location-value"
        }
      }
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.fields.imageAttachment, {
    ...emptyFieldMetadata(),
    present: true,
    type: "object",
    objectKeys: ["url", "mimeType", "filename"],
    urlLikeValuePresent: true,
    mimeTypePresent: true,
    filenamePresent: true
  });
  assert.doesNotMatch(
    JSON.stringify({ response: response.body, logs }),
    /object-image\.png|object-customer-image\.png|object-signed-value|object-token-value|object-location-value/
  );
});

test("attachment payload probe classifies a mixed attachment array safely", async () => {
  const logs = captureProbeLogs();
  const response = await requestApp({
    authorized: true,
    body: {
      videoAttachment: [
        { url: "https://media.example.test/private/image-one?token=image-token", name: "customer-image.jpg", size: 10 },
        { url: "https://media.example.test/private/video-one?token=video-token", name: "customer-video.mp4", size: "20" },
        { url: "https://media.example.test/private/audio-one?token=audio-token", name: "customer-audio.m4a", size: 30 },
        { url: "https://media.example.test/private/document-one?token=document-token", name: "customer-document.pdf", size: 40 },
        { url: "https://media.example.test/private/other-one?token=other-token", name: "customer-other.archive", size: 50 }
      ]
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.fields.videoAttachment, {
    ...emptyFieldMetadata(),
    present: true,
    type: "object",
    isArray: true,
    arrayLength: 5,
    objectKeys: ["url", "name", "size"],
    urlLikeValuePresent: true,
    filenamePresent: true,
    attachmentObjectCount: 5,
    urlPresentCount: 5,
    namePresentCount: 5,
    sizePresentCount: 5,
    imageCount: 1,
    videoCount: 1,
    audioCount: 1,
    documentCount: 1,
    otherCount: 1
  });
  assert.doesNotMatch(
    JSON.stringify({ response: response.body, logs }),
    /customer-(?:image|video|audio|document|other)|image-token|video-token|audio-token|document-token|other-token|\.jpg|\.mp4|\.m4a|\.pdf|\.archive/
  );
});

test("attachment payload probe counts an attachment object missing its URL", async () => {
  const logs = captureProbeLogs();
  const response = await requestApp({
    authorized: true,
    body: {
      imageAttachment: [{ name: "missing-url-customer-file.pdf", size: 123 }]
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.fields.imageAttachment, {
    ...emptyFieldMetadata(),
    present: true,
    type: "object",
    isArray: true,
    arrayLength: 1,
    objectKeys: ["name", "size"],
    filenamePresent: true,
    attachmentObjectCount: 1,
    namePresentCount: 1,
    sizePresentCount: 1,
    missingUrlCount: 1,
    documentCount: 1
  });
  assert.doesNotMatch(JSON.stringify({ response: response.body, logs }), /missing-url-customer-file|\.pdf/);
});

test("attachment payload probe inspects nested attachment structure without values", async () => {
  const logs = captureProbeLogs();
  const response = await requestApp({
    authorized: true,
    body: {
      imageAttachment: {
        asset: {
          delivery: {
            href: "https://media.example.test/private/nested-image.webp?signature=nested-signed-value"
          },
          metadata: {
            mediaType: "image/webp",
            name: "nested-customer-image.webp"
          }
        }
      }
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.fields.imageAttachment.objectKeys, [
    "asset",
    "delivery",
    "href",
    "metadata",
    "mediaType",
    "name"
  ]);
  assert.equal(response.body.fields.imageAttachment.urlLikeValuePresent, true);
  assert.equal(response.body.fields.imageAttachment.mimeTypePresent, true);
  assert.equal(response.body.fields.imageAttachment.filenamePresent, true);
  assert.doesNotMatch(
    JSON.stringify({ response: response.body, logs }),
    /nested-image\.webp|nested-customer-image\.webp|nested-signed-value/
  );
});

test("attachment payload probe excludes secrets, URLs, filenames, messages, and identifiers", async () => {
  const logs = captureProbeLogs();
  const sensitiveValues = [
    "private-customer-message-fixture",
    "https://media.example.test/private/sensitive-file.jpg?signature=private-signed-query",
    "sensitive-file.jpg",
    "private-token-fixture",
    "private-secret-fixture",
    "private-location-fixture",
    "private-contact-fixture",
    "base64-file-content-fixture"
  ];
  const response = await requestApp({
    authorized: true,
    body: {
      message: sensitiveValues[0],
      imageAttachment: {
        url: sensitiveValues[1],
        filename: sensitiveValues[2],
        accessToken: sensitiveValues[3],
        clientSecret: sensitiveValues[4],
        locationId: sensitiveValues[5],
        contactId: sensitiveValues[6],
        fileContents: sensitiveValues[7]
      }
    }
  });
  const exposed = JSON.stringify({ response: response.body, logs });

  assert.equal(response.status, 200);
  for (const sensitiveValue of sensitiveValues) {
    assert.equal(exposed.includes(sensitiveValue), false);
  }
  assert.equal(exposed.includes(config.env.WEBHOOK_SHARED_SECRET), false);
  assert.deepEqual(response.body.fields.imageAttachment.objectKeys, ["url", "filename"]);
  assert.doesNotMatch(exposed, /accessToken|clientSecret|locationId|contactId|fileContents/);
});

test("attachment payload probe rejects an unauthorized request", async () => {
  const logs = captureProbeLogs();
  const response = await requestApp({
    authorized: false,
    body: { imageAttachment: "https://media.example.test/private/unauthorized.png" }
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { ok: false, error: "Unauthorized" });
  assert.deepEqual(logs, []);
});
