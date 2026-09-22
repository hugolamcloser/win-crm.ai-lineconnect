const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createEvery8dGhlOAuthRepository,
  createUninstallEvery8dGhlMarketplaceInstallation
} = require("../dist/services/every8dGhlOAuthRepository");

function createPostgrestHarness(returnedRow) {
  const calls = { table: null, update: null, eq: [], in: [], rpc: null };
  const query = {
    update(value) {
      calls.update = value;
      return query;
    },
    eq(column, value) {
      calls.eq.push([column, value]);
      return query;
    },
    in(column, value) {
      calls.in.push([column, value]);
      return query;
    },
    select() {
      return query;
    },
    async maybeSingle() {
      return { data: returnedRow, error: null };
    }
  };
  const client = {
    from(table) {
      calls.table = table;
      return query;
    },
    rpc(name, input) {
      calls.rpc = { name, input };
      return {
        async single() {
          return { data: returnedRow, error: null };
        }
      };
    }
  };
  return { calls, client };
}

test("repository persists encrypted credentials with exact ownership filters and returns realistic PostgREST shapes", async () => {
  const returned = {
    id: "10000000-0000-4000-8000-000000000098",
    app_namespace: "every8d_connect",
    marketplace_app_id: "every8d-app-98",
    oauth_client_id: "every8d-client-98",
    tenant_id: "00000000-0000-4000-8000-000000000098",
    location_id: "location-98",
    company_id: "company-98",
    conversation_provider_id: "every8d-provider-98",
    channel: "sms",
    provider: "every8d",
    status: "pending",
    installation_generation: 3,
    access_token_ciphertext: "\\x656e637279707465642d616363657373",
    refresh_token_ciphertext: "\\x656e637279707465642d72656672657368",
    encryption_key_version: "test-v1",
    token_expires_at: "2026-09-21T13:00:00+00:00",
    granted_scopes: ["locations.readonly"],
    created_at: "2026-09-21T11:00:00+00:00",
    updated_at: "2026-09-21T12:00:00+00:00"
  };
  const harness = createPostgrestHarness(returned);
  const repository = createEvery8dGhlOAuthRepository(() => harness.client);

  const result = await repository.persistCredentials({
    installationId: returned.id,
    marketplaceAppId: returned.marketplace_app_id,
    oauthClientId: returned.oauth_client_id,
    tenantId: returned.tenant_id,
    locationId: returned.location_id,
    companyId: returned.company_id,
    conversationProviderId: returned.conversation_provider_id,
    installationGeneration: returned.installation_generation,
    accessTokenCiphertext: "encrypted-access",
    refreshTokenCiphertext: "encrypted-refresh",
    encryptionKeyVersion: "test-v1",
    expiresAt: "2026-09-21T13:00:00.000Z",
    grantedScopes: ["locations.readonly"]
  });

  assert.equal(result, returned);
  assert.equal(harness.calls.table, "ghl_marketplace_installations");
  assert.deepEqual(harness.calls.update, {
    access_token_ciphertext: "\\x656e637279707465642d616363657373",
    refresh_token_ciphertext: "\\x656e637279707465642d72656672657368",
    encryption_key_version: "test-v1",
    token_expires_at: "2026-09-21T13:00:00.000Z",
    granted_scopes: ["locations.readonly"]
  });
  assert.deepEqual(harness.calls.eq, [
    ["id", returned.id],
    ["app_namespace", "every8d_connect"],
    ["marketplace_app_id", returned.marketplace_app_id],
    ["oauth_client_id", returned.oauth_client_id],
    ["tenant_id", returned.tenant_id],
    ["location_id", returned.location_id],
    ["company_id", returned.company_id],
    ["conversation_provider_id", returned.conversation_provider_id],
    ["installation_generation", returned.installation_generation]
  ]);
  assert.deepEqual(harness.calls.in, [["status", ["pending", "active"]]]);
  assert.equal(JSON.stringify(harness.calls.update).includes("synthetic-access-secret"), false);
  assert.equal(JSON.stringify(harness.calls.update).includes("synthetic-refresh-secret"), false);
});

test("repository provisions company ownership only through the atomic database primitive", async () => {
  const returned = {
    id: "10000000-0000-4000-8000-000000000100",
    app_namespace: "every8d_connect",
    marketplace_app_id: "every8d-app-100",
    oauth_client_id: "every8d-client-100",
    tenant_id: "00000000-0000-4000-8000-000000000100",
    location_id: "location-100",
    company_id: "company-100",
    conversation_provider_id: "every8d-provider-100",
    channel: "sms",
    provider: "every8d",
    status: "pending",
    installation_generation: 1
  };
  const harness = createPostgrestHarness(returned);
  const repository = createEvery8dGhlOAuthRepository(() => harness.client);

  const result = await repository.provisionInstallation({
    marketplaceAppId: returned.marketplace_app_id,
    oauthClientId: returned.oauth_client_id,
    tenantId: returned.tenant_id,
    locationId: returned.location_id,
    companyId: returned.company_id,
    conversationProviderId: returned.conversation_provider_id
  });

  assert.equal(result, returned);
  assert.deepEqual(harness.calls.rpc, {
    name: "provision_every8d_ghl_marketplace_installation_v1",
    input: {
      input_marketplace_app_id: returned.marketplace_app_id,
      input_oauth_client_id: returned.oauth_client_id,
      input_tenant_id: returned.tenant_id,
      input_location_id: returned.location_id,
      input_company_id: returned.company_id,
      input_conversation_provider_id: returned.conversation_provider_id
    }
  });
});

function createUninstallHarness(overrides = {}) {
  let row = {
    id: "10000000-0000-4000-8000-000000000100",
    app_namespace: "every8d_connect",
    marketplace_app_id: "every8d-app-100",
    oauth_client_id: "every8d-client-100",
    tenant_id: "00000000-0000-4000-8000-000000000100",
    location_id: "location-100",
    company_id: "company-100",
    conversation_provider_id: "every8d-provider-100",
    channel: "sms",
    provider: "every8d",
    status: "active",
    installation_generation: 7,
    ...overrides
  };
  let updates = 0;
  let initialReads = 0;
  let releaseInitialReads;
  const initialReadGate = new Promise((resolve) => { releaseInitialReads = resolve; });

  function matches(filters) {
    return filters.every(([column, value]) => row?.[column] === value);
  }

  function query() {
    const filters = [];
    let updateValue = null;
    return {
      select() { return this; },
      update(value) { updateValue = value; return this; },
      eq(column, value) { filters.push([column, value]); return this; },
      async maybeSingle() {
        if (!updateValue) {
          const snapshot = row && matches(filters) ? { ...row } : null;
          if (overrides.concurrentReads && initialReads < 2) {
            initialReads += 1;
            if (initialReads === 2) releaseInitialReads();
            await initialReadGate;
          }
          return { data: snapshot, error: null };
        }
        if (!row || !matches(filters)) return { data: null, error: null };
        row = { ...row, ...updateValue };
        updates += 1;
        return { data: { ...row }, error: null };
      }
    };
  }

  const uninstall = createUninstallEvery8dGhlMarketplaceInstallation(() => ({
    from(table) {
      assert.equal(table, "ghl_marketplace_installations");
      return query();
    }
  }));
  const exactInput = {
    marketplaceAppId: "every8d-app-100",
    oauthClientId: "every8d-client-100",
    locationId: "location-100",
    companyId: "company-100",
    conversationProviderId: "every8d-provider-100"
  };

  return {
    uninstall,
    exactInput,
    get row() { return row; },
    get updates() { return updates; }
  };
}

test("sequential duplicate uninstall returns the exact terminal row without a second generation increment", async () => {
  const harness = createUninstallHarness();
  const first = await harness.uninstall(harness.exactInput);
  const second = await harness.uninstall(harness.exactInput);

  assert.deepEqual(second, first);
  assert.equal(first.status, "uninstalled");
  assert.equal(first.installation_generation, 8);
  assert.equal(harness.updates, 1);
});

test("concurrent duplicate uninstall callers converge on one exact terminal generation", async () => {
  const harness = createUninstallHarness({ concurrentReads: true });
  const [first, second] = await Promise.all([
    harness.uninstall(harness.exactInput),
    harness.uninstall(harness.exactInput)
  ]);

  assert.deepEqual(second, first);
  assert.equal(first.status, "uninstalled");
  assert.equal(first.installation_generation, 8);
  assert.equal(harness.row.installation_generation, 8);
  assert.equal(harness.updates, 1);
});

for (const [name, changed] of [
  ["app", { marketplaceAppId: "foreign-app" }],
  ["client", { oauthClientId: "foreign-client" }],
  ["location", { locationId: "foreign-location" }],
  ["company", { companyId: "foreign-company" }],
  ["provider", { conversationProviderId: "foreign-provider" }]
]) {
  test(`uninstall rejects a wrong ${name} without mutation`, async () => {
    const harness = createUninstallHarness();
    assert.equal(await harness.uninstall({ ...harness.exactInput, ...changed }), null);
    assert.equal(harness.row.status, "active");
    assert.equal(harness.row.installation_generation, 7);
    assert.equal(harness.updates, 0);
  });
}
