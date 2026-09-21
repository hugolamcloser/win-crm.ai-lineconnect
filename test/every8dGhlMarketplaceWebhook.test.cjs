const assert = require("node:assert/strict");
const express = require("express");
const test = require("node:test");
const { parseEvery8dGhlOAuthEncryptionKeys } = require("../dist/services/every8dGhlTokenEncryption");

const { createEvery8dGhlMarketplaceLifecycleService } = require("../dist/services/every8dGhlMarketplaceLifecycleService");
const { createEvery8dGhlMarketplaceWebhookRouter } = require("../dist/routes/every8dGhlMarketplaceWebhook");

function config(overrides = {}) {
  return {
    enabled: true,
    marketplaceAppId: "every8d-app-98",
    oauthClientId: "every8d-client-98",
    oauthClientSecret: "synthetic-client-secret",
    redirectUri: "https://oauth.example.invalid/oauth/every8d-connect/callback",
    installationUrl: "https://marketplace.example.invalid/install/every8d-app-98",
    installationUrlSha256: "694c2700462b0a59a39d022f30583d32727f255e87587e6d53af7b32a6d6a430",
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

function installPayload(overrides = {}) {
  return {
    type: "INSTALL",
    appId: "every8d-app-98",
    appNamespace: "every8d_connect",
    installType: "Location",
    locationId: "location-98",
    companyId: "company-98",
    isBulkInstallation: false,
    installToFutureLocations: false,
    approveAllLocations: false,
    ...overrides
  };
}

function createHarness(options = {}) {
  let tenantReads = 0;
  let uninstalls = 0;
  const service = createEvery8dGhlMarketplaceLifecycleService({
    config: config(options.config),
    getExactTenant: async () => {
      tenantReads += 1;
      return options.tenant === undefined
        ? { id: "00000000-0000-4000-8000-000000000098", location_id: "location-98", ghl_provider_id: "line-provider" }
        : options.tenant;
    },
    uninstallInstallation: async () => {
      uninstalls += 1;
      return options.uninstallResult === undefined
        ? { id: "installation-98", status: "uninstalled", installation_generation: 2 }
        : options.uninstallResult;
    }
  });

  return {
    service,
    get tenantReads() { return tenantReads; },
    get uninstalls() { return uninstalls; },
  };
}

test("signed Location INSTALL validates an exact existing tenant then stops on missing immutable company binding", async () => {
  const harness = createHarness();
  await assert.rejects(
    () => harness.service.handle(installPayload()),
    (error) => error.code === "provisioning_blocked" && /company binding/.test(error.message)
  );
  assert.equal(harness.tenantReads, 1);
  assert.equal(harness.uninstalls, 0);
});

test("disabled lifecycle runtime performs zero ownership lookup or mutation", async () => {
  const harness = createHarness({ config: { enabled: false } });
  await assert.rejects(
    () => harness.service.handle(installPayload()),
    (error) => error.code === "lifecycle_disabled"
  );
  assert.equal(harness.tenantReads, 0);
  assert.equal(harness.uninstalls, 0);
});

for (const [name, payload] of [
  ["wrong app", installPayload({ appId: "foreign-app" })],
  ["missing namespace", installPayload({ appNamespace: undefined })],
  ["wrong namespace", installPayload({ appNamespace: "line_connect" })],
  ["missing install type", installPayload({ installType: undefined })],
  ["agency install", installPayload({ installType: "Agency", locationId: undefined })],
  ["Company ownership", installPayload({ installType: "Company" })],
  ["bulk install", installPayload({ isBulkInstallation: true })],
  ["future locations", installPayload({ installToFutureLocations: true })],
  ["approve all locations", installPayload({ approveAllLocations: true })],
  ["ambiguous event", installPayload({ type: "UPDATE" })]
]) {
  test(`${name} lifecycle evidence fails before tenant lookup or ownership mutation`, async () => {
    const harness = createHarness();
    await assert.rejects(() => harness.service.handle(payload), /lifecycle evidence was rejected/);
    assert.equal(harness.tenantReads, 0);
    assert.equal(harness.uninstalls, 0);
  });
}

test("missing or ambiguous exact tenant fails without installation creation", async () => {
  const harness = createHarness({ tenant: null });
  await assert.rejects(() => harness.service.handle(installPayload()), /tenant ownership was not exact/);
  assert.equal(harness.tenantReads, 1);
});

test("Location UNINSTALL invalidates only the exact configured installation", async () => {
  const harness = createHarness();
  const result = await harness.service.handle({
    type: "UNINSTALL",
    appId: "every8d-app-98",
    appNamespace: "every8d_connect",
    installType: "Location",
    locationId: "location-98"
  });

  assert.deepEqual(result, { status: "uninstalled", installationId: "installation-98", installationGeneration: 2 });
  assert.equal(harness.tenantReads, 0);
  assert.equal(harness.uninstalls, 1);
});

for (const [name, override] of [
  ["missing namespace", { appNamespace: undefined }],
  ["wrong namespace", { appNamespace: "line_connect" }],
  ["missing install type", { installType: undefined }],
  ["wrong install type", { installType: "Agency" }]
]) {
  test(`Location UNINSTALL rejects ${name} before mutation`, async () => {
    const harness = createHarness();
    await assert.rejects(
      () => harness.service.handle({
        type: "UNINSTALL",
        appId: "every8d-app-98",
        appNamespace: "every8d_connect",
        installType: "Location",
        locationId: "location-98",
        ...override
      }),
      /lifecycle evidence was rejected/
    );
    assert.equal(harness.uninstalls, 0);
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
  const body = JSON.stringify(installPayload());

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
