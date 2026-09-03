const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");

const { env } = require("../dist/config/env");
const { errorHandler } = require("../dist/middleware/errors");
const { createLineContactReconciliationRouter } = require("../dist/routes/lineContactReconciliation");

function request(server, { headers = {}, body, path = "/internal/line-contact-reconcile/preview" }) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      path,
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
      candidateOnlyNonIdentityTags: null,
      protectedOrUnsupportedStandardFields: {
        masterOnly: null, candidateOnly: null, equal: null, conflicting: null
      },
      unclassifiedStandardFieldCount: null
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

test("Apply dry-run route is protected, accepts no caller candidate, and returns sanitized read-only output", async () => {
  const originalSecret = env.WEBHOOK_SHARED_SECRET;
  env.WEBHOOK_SHARED_SECRET = "route-test-secret";
  let captured;
  const app = express();
  app.use(express.json());
  app.use(createLineContactReconciliationRouter(
    async () => { throw new Error("preview route must not run"); },
    async (input) => {
      captured = input;
      return {
        result: "DRY_RUN_READY",
        reasonCodes: ["DRY_RUN_REVALIDATED"],
        operationRef: "safe-operation-ref",
        readOnly: true,
        previewDecision: "AUTO_SIMPLE",
        currentContactMatchesMapping: true,
        distinctCandidateCount: 1,
        sameCandidateConfirmed: true,
        semanticStateMatches: true,
        transferPlan: {
          executable: true,
          emailAction: "SET_ON_MASTER",
          phoneAction: "NONE",
          standardFields: { setOnMaster: 0, noOpEqual: 0, retainMaster: 0, blockedConflict: 0 },
          customFields: { setOnMaster: 0, noOpEqual: 0, retainMaster: 0, blockedConflict: 0 },
          ordinaryTagsToAdd: 0,
          lineIdentityValuesExcluded: 0,
          ignoredTemporaryFieldsExcluded: 0,
          protectedCandidateOnlyBlockers: 0,
          protectedConflictingBlockers: 0,
          unclassifiedBlockers: 0,
          blockerCodes: []
        }
      };
    }
  ));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const path = "/internal/line-contact-reconcile/apply/dry-run";
  const body = {
    authorizationId: "11111111-1111-4111-8111-111111111111",
    authorizationToken: "authorization_token_value_0123456789abcdef",
    previewKey: "a".repeat(32),
    request: {
      locationId: "location-test",
      currentContactId: "contact-master",
      source: "line",
      identity: { email: "candidate@example.com" }
    }
  };

  try {
    const denied = await request(server, { path, body });
    assert.equal(denied.status, 401);
    assert.equal(captured, undefined);

    const allowed = await request(server, {
      path,
      headers: { "x-webhook-secret": "route-test-secret" },
      body
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.result, "DRY_RUN_READY");
    assert.equal(allowed.body.readOnly, true);
    assert.equal("candidateContactId" in captured, false);
    assert.equal("candidateContactId" in captured.request, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    env.WEBHOOK_SHARED_SECRET = originalSecret;
  }
});

test("Apply dry-run route rejects caller-supplied candidate, tenant, or LINE identity", async () => {
  const originalSecret = env.WEBHOOK_SHARED_SECRET;
  env.WEBHOOK_SHARED_SECRET = "route-test-secret";
  let dryRunCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(createLineContactReconciliationRouter(
    async () => { throw new Error("preview route must not run"); },
    async () => {
      dryRunCalls += 1;
      throw new Error("dry-run must not run");
    }
  ));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const response = await request(server, {
      path: "/internal/line-contact-reconcile/apply/dry-run",
      headers: { "x-webhook-secret": "route-test-secret" },
      body: {
        authorizationId: "11111111-1111-4111-8111-111111111111",
        authorizationToken: "authorization_token_value_0123456789abcdef",
        previewKey: "a".repeat(32),
        candidateContactId: "caller-candidate",
        request: {
          locationId: "location-test",
          currentContactId: "contact-master",
          tenantId: "caller-tenant",
          lineUserId: "caller-line-user",
          source: "line",
          identity: { email: "candidate@example.com" }
        }
      }
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "validation_error");
    assert.equal(dryRunCalls, 0);
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
