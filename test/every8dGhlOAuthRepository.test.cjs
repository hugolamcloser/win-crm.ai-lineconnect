const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createEvery8dGhlOAuthRepository
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
