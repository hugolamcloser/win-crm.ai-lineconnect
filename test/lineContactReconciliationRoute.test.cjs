const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");

const { env } = require("../dist/config/env");
const { errorHandler } = require("../dist/middleware/errors");
const { createLineContactReconciliationRouter } = require("../dist/routes/lineContactReconciliation");

function request(server, { headers = {}, body }) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      path: "/internal/line-contact-reconcile/preview",
      method: "POST",
      headers: { "content-type": "application/json", ...headers }
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

test("preview route is protected, returns HTTP 200 decisions, and uses mapping terminology", async () => {
  const originalSecret = env.WEBHOOK_SHARED_SECRET;
  env.WEBHOOK_SHARED_SECRET = "route-test-secret";
  const app = express();
  app.use(express.json());
  app.use(createLineContactReconciliationRouter(async () => ({
    decision: "NO_IDENTIFIER",
    reasonCodes: ["NO_IDENTITY_SIGNAL"],
    previewKey: "preview-test",
    readOnly: true,
    currentContactMatchesMapping: null,
    identity: { emailSupplied: false, phoneSupplied: false },
    distinctCandidateCount: null,
    riskReadStatuses: {
      conversations: "UNAVAILABLE", notes: "UNAVAILABLE", tasks: "UNAVAILABLE", opportunities: "UNAVAILABLE",
      appointments: "UNAVAILABLE", orders: "UNAVAILABLE", transactions: "UNAVAILABLE", invoices: "UNAVAILABLE"
    },
    associatedRecords: {
      conversations: "UNAVAILABLE", notes: "UNAVAILABLE", tasks: "UNAVAILABLE", opportunities: "UNAVAILABLE",
      appointments: "UNAVAILABLE", orders: "UNAVAILABLE", transactions: "UNAVAILABLE", invoices: "UNAVAILABLE"
    },
    lineIdentityTags: { master: "NOT_EVALUATED", candidate: "NOT_EVALUATED" },
    transferInventory: {
      standardFields: { masterOnly: null, candidateOnly: null, equal: null, conflicting: null },
      customFields: { masterOnly: null, candidateOnly: null, equal: null, conflicting: null },
      candidateOnlyNonIdentityTags: null
    },
    fieldPolicy: { status: "UNAVAILABLE", lineIdentityConflict: null, protectedBusinessConflict: null }
  })));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const body = { locationId: "location-test", currentContactId: "contact-test", source: "line", identity: {} };

  try {
    const denied = await request(server, { body });
    assert.equal(denied.status, 401);

    const allowed = await request(server, { headers: { "x-webhook-secret": "route-test-secret" }, body });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.decision, "NO_IDENTIFIER");
    assert.equal("currentContactMatchesMapping" in allowed.body, true);
    assert.equal("riskReadStatuses" in allowed.body, true);
    assert.equal("scopeAvailability" in allowed.body, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    env.WEBHOOK_SHARED_SECRET = originalSecret;
  }
});
test("preview route rejects caller-supplied tenant or LINE identity fields", async () => {
  const originalSecret = env.WEBHOOK_SHARED_SECRET;
  env.WEBHOOK_SHARED_SECRET = "route-test-secret";
  let previewCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(createLineContactReconciliationRouter(async () => {
    previewCalls += 1;
    throw new Error("must not run");
  }));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const response = await request(server, {
      headers: { "x-webhook-secret": "route-test-secret" },
      body: {
        locationId: "location-test",
        currentContactId: "contact-test",
        tenantId: "caller-tenant",
        lineUserId: "caller-line-user",
        source: "line",
        identity: {}
      }
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "validation_error");
    assert.equal(previewCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    env.WEBHOOK_SHARED_SECRET = originalSecret;
  }
});
