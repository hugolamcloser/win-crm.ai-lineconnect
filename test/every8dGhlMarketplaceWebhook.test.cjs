const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const express = require("express");
const test = require("node:test");
const { parseEvery8dGhlOAuthEncryptionKeys } = require("../dist/services/every8dGhlTokenEncryption");

const { createEvery8dGhlMarketplaceLifecycleService } = require("../dist/services/every8dGhlMarketplaceLifecycleService");
const {
  createEvery8dGhlMarketplaceWebhookRouter,
  parseEvery8dGhlMarketplaceLifecyclePayload
} = require("../dist/routes/every8dGhlMarketplaceWebhook");

const observedAppId = "6aabd562fdb2a17e6120d3ce";
const observedVersionId = "6aabd562fdb2a17e6120d3ce";
const observedLocationId = "YpZUCDPCffMDeYhgb4rL";
const observedCompanyId = "ONptkvfkK2hv1AxVLpEJ";
const observedInstallationUrl = `https://app.gohighlevel.com/v2/location/${observedLocationId}/integration/${observedAppId}/versions/${observedVersionId}`;

function config(overrides = {}) {
  return {
    enabled: true,
    marketplaceAppId: observedAppId,
    oauthClientId: "every8d-client-98",
    oauthClientSecret: "synthetic-client-secret",
    redirectUri: "https://oauth.example.invalid/oauth/every8d-connect/callback",
    installationUrl: observedInstallationUrl,
    installationUrlSha256: createHash("sha256").update(observedInstallationUrl).digest("hex"),
    tokenUrl: "https://services.leadconnectorhq.com/oauth/token",
    conversationProviderId: "every8d-provider-98",
    requiredScopes: ["locations.readonly"],
    stateTtlSeconds: 600,
    activeKeyVersion: "test-v1",
    encryptionKeys: parseEvery8dGhlOAuthEncryptionKeys(JSON.stringify({
      "test-v1": Buffer.alloc(32, 0x71).toString("base64")
    })),
    ...overrides
  };
}

function observedInstallPayload(overrides = {}) {
  return {
    type: "INSTALL",
    appId: observedAppId,
    versionId: observedVersionId,
    installType: "Location",
    locationId: observedLocationId,
    companyId: observedCompanyId,
    userId: "h7q6jHn7ypGe6mg2wS0G",
    companyName: "Win-CRM",
    isWhitelabelCompany: true,
    whitelabelDetails: {
      logoUrl: "<observed-url>",
      domain: "app.win-crm.ai"
    },
    trial: {},
    timestamp: "2026-09-22T14:20:53.728Z",
    webhookId: "ab2bccb7-9c5c-4f49-b40d-9bbd665c024a",
    ...overrides
  };
}

function observedUninstallPayload(overrides = {}) {
  return {
    type: "UNINSTALL",
    appId: observedAppId,
    versionId: observedVersionId,
    locationId: observedLocationId,
    timestamp: "2026-09-22T14:35:55.549Z",
    webhookId: "31c72437-bcc2-4c9e-bf0d-55910b229dc0",
    ...overrides
  };
}

function exactInstallation(overrides = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000098",
    app_namespace: "every8d_connect",
    marketplace_app_id: observedAppId,
    oauth_client_id: "every8d-client-98",
    tenant_id: "00000000-0000-4000-8000-000000000098",
    location_id: observedLocationId,
    company_id: observedCompanyId,
    conversation_provider_id: "every8d-provider-98",
    channel: "sms",
    provider: "every8d",
    status: "pending",
    installation_generation: 1,
    access_token_ciphertext: null,
    refresh_token_ciphertext: null,
    encryption_key_version: null,
    token_expires_at: null,
    granted_scopes: [],
    created_at: "2026-09-22T14:20:53.728Z",
    updated_at: "2026-09-22T14:20:53.728Z",
    ...overrides
  };
}

function createHarness(options = {}) {
  let tenantReads = 0;
  let provisions = 0;
  let uninstalls = 0;
  let provisionInput = null;
  let uninstallInput = null;
  let installation = options.installation === undefined ? exactInstallation() : options.installation;
  const serviceConfig = config(options.config);

  const exactStoredIdentity = (input) => installation &&
    installation.marketplace_app_id === input.marketplaceAppId &&
    installation.oauth_client_id === input.oauthClientId &&
    installation.location_id === input.locationId &&
    installation.conversation_provider_id === input.conversationProviderId &&
    installation.app_namespace === "every8d_connect" &&
    installation.channel === "sms" &&
    installation.provider === "every8d" &&
    installation.company_id;

  const service = createEvery8dGhlMarketplaceLifecycleService({
    config: serviceConfig,
    getExactTenant: async (locationId) => {
      tenantReads += 1;
      if (options.tenant !== undefined) return options.tenant;
      if (locationId !== observedLocationId) return null;
      return {
        id: "00000000-0000-4000-8000-000000000098",
        location_id: observedLocationId,
        ghl_provider_id: "line-provider"
      };
    },
    provisionInstallation: async (input) => {
      provisions += 1;
      provisionInput = input;
      if (options.provisionResult !== undefined) return options.provisionResult;
      if (
        input.marketplaceAppId !== observedAppId ||
        input.oauthClientId !== "every8d-client-98" ||
        input.tenantId !== "00000000-0000-4000-8000-000000000098" ||
        input.locationId !== observedLocationId ||
        input.companyId !== observedCompanyId ||
        input.conversationProviderId !== "every8d-provider-98"
      ) {
        throw new Error("synthetic ownership conflict");
      }
      if (!installation) installation = exactInstallation();
      return { ...installation };
    },
    uninstallInstallation: async (input) => {
      uninstalls += 1;
      uninstallInput = input;
      if (options.uninstallResult !== undefined) return options.uninstallResult;
      if (!exactStoredIdentity(input)) return null;
      if (installation.status !== "uninstalled") {
        installation = {
          ...installation,
          status: "uninstalled",
          installation_generation: installation.installation_generation + 1
        };
      }
      return { ...installation };
    }
  });

  return {
    service,
    get tenantReads() { return tenantReads; },
    get provisions() { return provisions; },
    get uninstalls() { return uninstalls; },
    get provisionInput() { return provisionInput; },
    get uninstallInput() { return uninstallInput; },
    get installation() { return installation; },
    get installationRows() { return installation ? 1 : 0; }
  };
}

test("observed INSTALL shape is accepted by the parser without invented installation identity", () => {
  const fixture = observedInstallPayload();
  assert.equal("appNamespace" in fixture, false);
  assert.equal("installationId" in fixture, false);
  assert.deepEqual(parseEvery8dGhlMarketplaceLifecyclePayload(fixture), fixture);
});

test("observed UNINSTALL shape is accepted by the parser with only observed fields", () => {
  const fixture = observedUninstallPayload();
  for (const absent of ["companyId", "installType", "appNamespace", "installationId"]) {
    assert.equal(absent in fixture, false);
  }
  assert.deepEqual(parseEvery8dGhlMarketplaceLifecyclePayload(fixture), fixture);
});

test("signed observed Location INSTALL provisions exact immutable company ownership", async () => {
  const harness = createHarness();
  const result = await harness.service.handle(observedInstallPayload());

  assert.deepEqual(result, {
    status: "pending",
    installationId: "10000000-0000-4000-8000-000000000098",
    installationGeneration: 1
  });
  assert.equal(harness.tenantReads, 1);
  assert.equal(harness.provisions, 1);
  assert.equal(harness.uninstalls, 0);
  assert.deepEqual(harness.provisionInput, {
    marketplaceAppId: observedAppId,
    oauthClientId: "every8d-client-98",
    tenantId: "00000000-0000-4000-8000-000000000098",
    locationId: observedLocationId,
    companyId: observedCompanyId,
    conversationProviderId: "every8d-provider-98"
  });
});

test("disabled lifecycle runtime performs zero ownership lookup or mutation", async () => {
  const harness = createHarness({ config: { enabled: false } });
  await assert.rejects(
    () => harness.service.handle(observedInstallPayload()),
    (error) => error.code === "lifecycle_disabled"
  );
  assert.equal(harness.tenantReads, 0);
  assert.equal(harness.provisions, 0);
  assert.equal(harness.uninstalls, 0);
});

for (const [name, payload] of [
  ["missing company", observedInstallPayload({ companyId: undefined })],
  ["invalid company", observedInstallPayload({ companyId: "not valid" })],
  ["wrong install type", observedInstallPayload({ installType: "Agency" })],
  ["wrong app", observedInstallPayload({ appId: "foreign-app" })],
  ["wrong version", observedInstallPayload({ versionId: "foreign-version" })],
  ["bulk install", observedInstallPayload({ isBulkInstallation: true })],
  ["future locations", observedInstallPayload({ installToFutureLocations: true })],
  ["approve all locations", observedInstallPayload({ approveAllLocations: true })],
  ["ambiguous event", observedInstallPayload({ type: "UPDATE" })]
]) {
  test(`INSTALL ${name} fails before tenant lookup or ownership mutation`, async () => {
    const harness = createHarness();
    await assert.rejects(() => harness.service.handle(payload), /lifecycle evidence was rejected/);
    assert.equal(harness.tenantReads, 0);
    assert.equal(harness.provisions, 0);
    assert.equal(harness.uninstalls, 0);
  });
}

test("missing or ambiguous exact tenant fails without installation creation", async () => {
  const harness = createHarness({ tenant: null });
  await assert.rejects(() => harness.service.handle(observedInstallPayload()), /tenant ownership was not exact/);
  assert.equal(harness.tenantReads, 1);
  assert.equal(harness.provisions, 0);
});

test("UNINSTALL without companyId or installType succeeds only against exact stored company ownership", async () => {
  const harness = createHarness({ installation: exactInstallation({ status: "active", installation_generation: 7 }) });
  const result = await harness.service.handle(observedUninstallPayload());

  assert.deepEqual(result, {
    status: "uninstalled",
    installationId: "10000000-0000-4000-8000-000000000098",
    installationGeneration: 8
  });
  assert.equal(harness.tenantReads, 0);
  assert.equal(harness.provisions, 0);
  assert.equal(harness.uninstalls, 1);
  assert.deepEqual(harness.uninstallInput, {
    marketplaceAppId: observedAppId,
    oauthClientId: "every8d-client-98",
    locationId: observedLocationId,
    conversationProviderId: "every8d-provider-98"
  });
  assert.equal(harness.installation.company_id, observedCompanyId);
});

test("UNINSTALL without existing bound ownership fails closed and never provisions", async () => {
  const harness = createHarness({ installation: null });
  await assert.rejects(
    () => harness.service.handle(observedUninstallPayload()),
    (error) => error.code === "ownership_conflict"
  );
  assert.equal(harness.provisions, 0);
  assert.equal(harness.uninstalls, 1);
});

test("UNINSTALL ambiguity fails closed and never provisions", async () => {
  const harness = createHarness({ uninstallResult: null });
  await assert.rejects(
    () => harness.service.handle(observedUninstallPayload()),
    (error) => error.code === "ownership_conflict"
  );
  assert.equal(harness.provisions, 0);
  assert.equal(harness.uninstalls, 1);
});

test("repeated INSTALL with the same webhookId converges without duplicate rows or generation changes", async () => {
  const harness = createHarness();
  const payload = observedInstallPayload();
  const first = await harness.service.handle(payload);
  const second = await harness.service.handle(payload);

  assert.deepEqual(second, first);
  assert.equal(harness.provisions, 2);
  assert.equal(harness.installationRows, 1);
  assert.equal(harness.installation.installation_generation, 1);
});

test("repeated UNINSTALL with the same webhookId converges on one terminal generation", async () => {
  const harness = createHarness({ installation: exactInstallation({ status: "active", installation_generation: 7 }) });
  const payload = observedUninstallPayload();
  const first = await harness.service.handle(payload);
  const second = await harness.service.handle(payload);

  assert.deepEqual(second, first);
  assert.equal(harness.uninstalls, 2);
  assert.equal(harness.installationRows, 1);
  assert.equal(harness.installation.installation_generation, 8);
});

test("changed webhookId duplicate lifecycle cannot become installation identity", async () => {
  const harness = createHarness();
  const first = await harness.service.handle(observedInstallPayload());
  const second = await harness.service.handle(observedInstallPayload({ webhookId: "different-install-delivery" }));

  assert.deepEqual(second, first);
  assert.equal(harness.installationRows, 1);
  assert.equal(harness.installation.id, first.installationId);
  assert.equal(JSON.stringify(harness.provisionInput).includes("webhookId"), false);
});

test("changed webhookId duplicate UNINSTALL keeps the same stored installation identity and generation", async () => {
  const harness = createHarness({ installation: exactInstallation({ status: "active", installation_generation: 7 }) });
  const first = await harness.service.handle(observedUninstallPayload());
  const second = await harness.service.handle(observedUninstallPayload({ webhookId: "different-uninstall-delivery" }));

  assert.deepEqual(second, first);
  assert.equal(harness.installationRows, 1);
  assert.equal(harness.installation.installation_generation, 8);
  assert.equal(JSON.stringify(harness.uninstallInput).includes("webhookId"), false);
});

for (const [name, payload] of [
  ["wrong app", observedUninstallPayload({ appId: "foreign-app" })],
  ["wrong version", observedUninstallPayload({ versionId: "foreign-version" })],
  ["wrong location", observedUninstallPayload({ locationId: "foreign-location" })]
]) {
  test(`UNINSTALL ${name} cannot mutate another installation`, async () => {
    const harness = createHarness({ installation: exactInstallation({ status: "active", installation_generation: 7 }) });
    await assert.rejects(() => harness.service.handle(payload));
    assert.equal(harness.installation.status, "active");
    assert.equal(harness.installation.installation_generation, 7);
  });
}

async function startRouter(dependencies) {
  const app = express();
  app.use(express.json({
    verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); }
  }));
  app.use(createEvery8dGhlMarketplaceWebhookRouter(dependencies));
  app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}/webhooks/ghl/every8d-connect/lifecycle`
  };
}

test("webhook requires X-GHL-Signature Ed25519 authority over the exact raw body", async (t) => {
  let handlerCalls = 0;
  let verifiedRawBody = null;
  const { server, url } = await startRouter({
    verifySignature: ({ rawBody, ghlSignature }) => {
      verifiedRawBody = rawBody.toString("utf8");
      return ghlSignature === "valid-ed25519";
    },
    handler: async () => {
      handlerCalls += 1;
      return { status: "pending", installationId: "installation-98", installationGeneration: 1 };
    }
  });
  t.after(() => server.close());
  const body = JSON.stringify(observedInstallPayload());

  const legacyOnly = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-wh-signature": "legacy-rsa" },
    body
  });
  assert.equal(legacyOnly.status, 401);
  assert.equal(handlerCalls, 0);

  const accepted = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ghl-signature": "valid-ed25519" },
    body
  });
  assert.equal(accepted.status, 200);
  assert.equal(handlerCalls, 1);
  assert.equal(verifiedRawBody, body);
});
