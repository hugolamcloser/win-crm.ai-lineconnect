const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const supabaseConfig = require("../dist/config/supabase");
const repository = require("../dist/services/repository");

const originalGetSupabase = supabaseConfig.getSupabase;

afterEach(() => {
  supabaseConfig.getSupabase = originalGetSupabase;
});

function operationIdentity(overrides = {}) {
  return {
    operationId: "operation-exact",
    tenantId: "tenant-exact",
    locationId: "location-exact",
    ghlMessageId: "message-exact",
    ...overrides,
  };
}

test("SMS operation migration defines the approved isolated identity, states, privacy, and access boundary", () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "supabase",
      "migrations",
      "202608190001_ghl_sms_outbound_operations.sql",
    ),
    "utf8",
  );

  assert.match(migration, /create table if not exists public\.ghl_sms_outbound_operations/);
  assert.match(
    migration,
    /constraint ghl_sms_outbound_operations_identity_key\s+unique \(tenant_id, location_id, ghl_message_id\)/,
  );
  assert.match(
    migration,
    /state in \('processing', 'accepted', 'definitive_failed', 'ambiguous'\)/,
  );
  assert.match(migration, /provider = 'every8d'/);
  assert.match(migration, /provider_mode = 'mock'/);
  assert.match(migration, /provider_bid_source in \('provider', 'batch_id'\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all .* from anon, authenticated/);
  assert.doesNotMatch(
    migration,
    /phone|destination|message_body|sms_body|raw_payload|raw_body|contact_id|credential|bearer|oauth|response_body/i,
  );
});

test("plain concurrent claim inserts produce one winner and map only 23505 to duplicate", async () => {
  const inserts = [];
  let insertAttempt = 0;
  supabaseConfig.getSupabase = () => ({
    from(table) {
      assert.equal(table, "ghl_sms_outbound_operations");
      return {
        insert(payload) {
          inserts.push(payload);
          return {
            select(columns) {
              assert.equal(columns, "id");
              return {
                async single() {
                  insertAttempt += 1;
                  return insertAttempt === 1
                    ? { data: { id: "operation-winner" }, error: null }
                    : {
                        data: null,
                        error: { code: "23505", message: "duplicate identity" },
                      };
                },
              };
            },
          };
        },
      };
    },
  });
  const input = {
    tenantId: "tenant-exact",
    locationId: "location-exact",
    ghlMessageId: "message-exact",
  };

  const results = await Promise.all([
    repository.claimGhlSmsOutboundOperation(input),
    repository.claimGhlSmsOutboundOperation(input),
  ]);

  assert.deepEqual(results, [
    { claimed: true, operationId: "operation-winner" },
    { claimed: false },
  ]);
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts[0], {
    tenant_id: "tenant-exact",
    location_id: "location-exact",
    ghl_message_id: "message-exact",
    provider: "every8d",
    provider_mode: "mock",
    state: "processing",
    provider_attempts: 0,
  });
  assert.doesNotMatch(
    JSON.stringify(inserts),
    /phone|destination|sms body|raw payload|contact|credential|token/i,
  );
});

test("claim fails closed for non-unique database errors", async () => {
  supabaseConfig.getSupabase = () => ({
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                single: async () => ({
                  data: null,
                  error: { code: "XX000", message: "database unavailable" },
                }),
              };
            },
          };
        },
      };
    },
  });

  await assert.rejects(
    () =>
      repository.claimGhlSmsOutboundOperation({
        tenantId: "tenant-exact",
        locationId: "location-exact",
        ghlMessageId: "message-exact",
      }),
    /database unavailable/,
  );
});

test("send-start and finalization use exact compare-and-set filters and sanitized columns", async () => {
  const operations = [];
  supabaseConfig.getSupabase = () => ({
    from(table) {
      assert.equal(table, "ghl_sms_outbound_operations");
      const operation = { update: null, filters: [] };
      operations.push(operation);
      const chain = {
        update(payload) {
          operation.update = payload;
          return chain;
        },
        eq(column, value) {
          operation.filters.push(["eq", column, value]);
          return chain;
        },
        is(column, value) {
          operation.filters.push(["is", column, value]);
          return chain;
        },
        not(column, operator, value) {
          operation.filters.push(["not", column, operator, value]);
          return chain;
        },
        select(columns) {
          assert.equal(columns, "id");
          return chain;
        },
        maybeSingle: async () => ({
          data: { id: "operation-exact" },
          error: null,
        }),
      };
      return chain;
    },
  });

  assert.equal(
    await repository.markGhlSmsOutboundOperationSendStarted(operationIdentity()),
    true,
  );
  assert.equal(
    await repository.finalizeGhlSmsOutboundOperation({
      ...operationIdentity(),
      state: "accepted",
      providerHttpStatus: 200,
      providerStatus: "0",
      providerSentCount: 1,
      providerUnsentCount: 0,
      providerBatchId: "mock-batch-exact",
      providerBid: "mock-batch-exact",
      providerBidSource: "batch_id",
    }),
    true,
  );

  assert.equal(operations.length, 2);
  assert.equal(operations[0].update.provider_attempts, 1);
  assert.ok(operations[0].update.send_started_at);
  assert.deepEqual(operations[0].filters, [
    ["eq", "id", "operation-exact"],
    ["eq", "tenant_id", "tenant-exact"],
    ["eq", "location_id", "location-exact"],
    ["eq", "ghl_message_id", "message-exact"],
    ["eq", "provider", "every8d"],
    ["eq", "provider_mode", "mock"],
    ["eq", "state", "processing"],
    ["is", "send_started_at", null],
  ]);
  assert.equal(operations[1].update.state, "accepted");
  assert.equal(operations[1].update.provider_batch_id, "mock-batch-exact");
  assert.equal(operations[1].update.provider_bid, "mock-batch-exact");
  assert.equal(operations[1].update.provider_bid_source, "batch_id");
  assert.equal(operations[1].update.failure_code, null);
  assert.ok(operations[1].update.finalized_at);
  assert.deepEqual(operations[1].filters, [
    ["eq", "id", "operation-exact"],
    ["eq", "tenant_id", "tenant-exact"],
    ["eq", "location_id", "location-exact"],
    ["eq", "ghl_message_id", "message-exact"],
    ["eq", "provider", "every8d"],
    ["eq", "provider_mode", "mock"],
    ["eq", "state", "processing"],
    ["not", "send_started_at", "is", null],
  ]);
  assert.doesNotMatch(
    JSON.stringify(operations),
    /phone|destination|message body|raw payload|contact|credential|token|response body/i,
  );
});

test("compare-and-set miss returns false and never creates new send permission", async () => {
  supabaseConfig.getSupabase = () => ({
    from() {
      const chain = {
        update: () => chain,
        eq: () => chain,
        is: () => chain,
        select: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  });

  assert.equal(
    await repository.markGhlSmsOutboundOperationSendStarted(operationIdentity()),
    false,
  );
});

test("repository rejects non-normalized provider status before persistence", async () => {
  supabaseConfig.getSupabase = () => {
    throw new Error("database must remain unreachable");
  };

  await assert.rejects(
    () =>
      repository.finalizeGhlSmsOutboundOperation({
        ...operationIdentity(),
        state: "accepted",
        providerStatus: "raw provider response text",
      }),
    /must be normalized/,
  );
});
