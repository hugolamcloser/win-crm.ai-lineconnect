const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createGhlReconciliationPreviewOAuthSessionOpener
} = require("../dist/services/ghlOAuthService");

const NOW = Date.parse("2026-07-31T00:00:00.000Z");
const FUTURE = new Date(NOW + 60 * 60 * 1000).toISOString();

function token(overrides = {}) {
  return {
    id: "oauth-row",
    tenant_id: "tenant-test",
    location_id: "location-test",
    company_id: "company-test",
    access_token: "access-sensitive",
    refresh_token: "refresh-sensitive",
    expires_at: FUTURE,
    scopes: ["contacts.readonly"],
    token_type: "Bearer",
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
    ...overrides
  };
}

function savedToken(input, overrides = {}) {
  return token({
    tenant_id: input.tenantId,
    location_id: input.locationId,
    company_id: input.companyId ?? null,
    access_token: input.accessToken,
    refresh_token: input.refreshToken,
    expires_at: input.expiresAt,
    scopes: input.scopes ?? [],
    token_type: input.tokenType ?? null,
    ...overrides
  });
}

function createHarness(options = {}) {
  let exchangeCount = 0;
  let persistCount = 0;
  let lastMaximumTimeoutMs = null;
  let persistedInput = null;
  const stored = options.stored === undefined ? token() : options.stored;
  const exchangePayload = options.exchangePayload ?? {
    access_token: "refreshed-access-sensitive",
    refresh_token: "refreshed-refresh-sensitive",
    expires_in: 3600
  };
  const opener = createGhlReconciliationPreviewOAuthSessionOpener({
    loadToken: async () => stored,
    exchangeRefreshToken: async (input) => {
      exchangeCount += 1;
      lastMaximumTimeoutMs = input.maximumTimeoutMs;
      if (options.exchangeError) {
        throw options.exchangeError;
      }
      if (options.exchangeGate) {
        await options.exchangeGate;
      }
      return exchangePayload;
    },
    persistToken: async (input) => {
      persistCount += 1;
      persistedInput = input;
      if (options.persistError) {
        throw options.persistError;
      }
      return savedToken(input, options.savedOverrides);
    },
    now: options.now ?? (() => NOW)
  });

  return {
    open: (deadline = NOW + 5_000) => opener({
      locationId: "location-test",
      expectedTenantId: "tenant-test",
      overallDeadlineAt: deadline
    }),
    get exchangeCount() { return exchangeCount; },
    get persistCount() { return persistCount; },
    get lastMaximumTimeoutMs() { return lastMaximumTimeoutMs; },
    get persistedInput() { return persistedInput; }
  };
}

test("valid stored access token performs zero refreshes and no persistence", async () => {
  const harness = createHarness();
  const session = await harness.open();

  assert.equal(session.getActiveToken().access_token.length > 0, true);
  assert.equal(session.hasRefreshed(), false);
  assert.equal(harness.exchangeCount, 0);
  assert.equal(harness.persistCount, 0);
});

for (const [name, stored] of [
  ["foreign stored location", token({ location_id: "location-foreign" })],
  ["foreign stored tenant", token({ tenant_id: "tenant-foreign" })],
  ["missing stored access token", token({ access_token: "" })]
]) {
  test(`${name} fails before exchange or persistence`, async () => {
    const harness = createHarness({ stored });

    await assert.rejects(() => harness.open());
    assert.equal(harness.exchangeCount, 0);
    assert.equal(harness.persistCount, 0);
  });
}

for (const [name, expiresAt] of [
  ["near-expiry", new Date(NOW + 10_000).toISOString()],
  ["expired", new Date(NOW - 1_000).toISOString()]
]) {
  test(`${name} stored token refreshes and persists exactly once`, async () => {
    const harness = createHarness({ stored: token({ expires_at: expiresAt }) });
    const session = await harness.open();

    assert.equal(session.hasRefreshed(), true);
    assert.equal(session.getActiveToken().access_token.length > 0, true);
    assert.equal(harness.exchangeCount, 1);
    assert.equal(harness.persistCount, 1);
    assert.equal(harness.lastMaximumTimeoutMs, 5_000);
  });
}

test("missing refresh token fails before exchange or persistence", async () => {
  const harness = createHarness({
    stored: token({ expires_at: new Date(NOW - 1_000).toISOString(), refresh_token: "" })
  });

  await assert.rejects(() => harness.open(), /refresh token is unavailable/);
  assert.equal(harness.exchangeCount, 0);
  assert.equal(harness.persistCount, 0);
});

test("refresh rejection fails closed without persistence", async () => {
  const harness = createHarness({
    stored: token({ expires_at: new Date(NOW - 1_000).toISOString() }),
    exchangeError: new Error("vendor rejected refresh-sensitive")
  });

  await assert.rejects(() => harness.open(), (error) => {
    assert.equal(error.message, "OAuth refresh exchange failed");
    assert.equal(error.message.includes("refresh-sensitive"), false);
    return true;
  });
  assert.equal(harness.exchangeCount, 1);
  assert.equal(harness.persistCount, 0);
});

test("foreign refresh-response location is rejected before persistence", async () => {
  const harness = createHarness({
    stored: token({ expires_at: new Date(NOW - 1_000).toISOString() }),
    exchangePayload: {
      access_token: "refreshed-access-sensitive",
      refresh_token: "refreshed-refresh-sensitive",
      expires_in: 3600,
      locationId: "location-foreign"
    }
  });

  await assert.rejects(() => harness.open(), /did not match the expected location/);
  assert.equal(harness.exchangeCount, 1);
  assert.equal(harness.persistCount, 0);
});

test("saved token with a foreign tenant is rejected after OAuth-only persistence", async () => {
  const harness = createHarness({
    stored: token({ expires_at: new Date(NOW - 1_000).toISOString() }),
    savedOverrides: { tenant_id: "tenant-foreign" }
  });

  await assert.rejects(() => harness.open(), /did not match the expected location and tenant/);
  assert.equal(harness.exchangeCount, 1);
  assert.equal(harness.persistCount, 1);
});

test("saved token with a foreign location is rejected after OAuth-only persistence", async () => {
  const harness = createHarness({
    stored: token({ expires_at: new Date(NOW - 1_000).toISOString() }),
    savedOverrides: { location_id: "location-foreign" }
  });

  await assert.rejects(() => harness.open(), /did not match the expected location and tenant/);
  assert.equal(harness.exchangeCount, 1);
  assert.equal(harness.persistCount, 1);
});

test("refreshed token that remains near expiry is rejected before persistence", async () => {
  const harness = createHarness({
    stored: token({ expires_at: new Date(NOW - 1_000).toISOString() }),
    exchangePayload: {
      access_token: "refreshed-access-sensitive",
      refresh_token: "refreshed-refresh-sensitive",
      expires_in: 10
    }
  });

  await assert.rejects(() => harness.open(), /remained expired or unusable/);
  assert.equal(harness.exchangeCount, 1);
  assert.equal(harness.persistCount, 0);
});

test("deadline exhaustion before refresh prevents exchange and persistence", async () => {
  const harness = createHarness({
    stored: token({ expires_at: new Date(NOW - 1_000).toISOString() })
  });

  await assert.rejects(() => harness.open(NOW), /deadline was reached before OAuth refresh/);
  assert.equal(harness.exchangeCount, 0);
  assert.equal(harness.persistCount, 0);
});

test("deadline exhaustion during refresh prevents persistence", async () => {
  const times = [NOW, NOW, NOW + 1_001];
  const harness = createHarness({
    stored: token({ expires_at: new Date(NOW - 1_000).toISOString() }),
    now: () => times.shift() ?? NOW + 1_001
  });

  await assert.rejects(() => harness.open(NOW + 1_000), /deadline was reached during OAuth refresh/);
  assert.equal(harness.exchangeCount, 1);
  assert.equal(harness.persistCount, 0);
});

test("deadline exhaustion after OAuth persistence prevents a usable session", async () => {
  const times = [NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW + 1_001];
  const harness = createHarness({
    stored: token({ expires_at: new Date(NOW - 1_000).toISOString() }),
    now: () => times.shift() ?? NOW + 1_001
  });

  await assert.rejects(() => harness.open(NOW + 1_000), /deadline was reached after OAuth token persistence/);
  assert.equal(harness.exchangeCount, 1);
  assert.equal(harness.persistCount, 1);
});

test("concurrent refresh callers share one session-level exchange promise", async () => {
  let releaseExchange;
  const exchangeGate = new Promise((resolve) => { releaseExchange = resolve; });
  const harness = createHarness({ exchangeGate });
  const session = await harness.open();
  const first = session.refresh();
  const second = session.refresh();

  assert.equal(harness.exchangeCount, 1);
  releaseExchange();
  const [firstToken, secondToken] = await Promise.all([first, second]);

  assert.equal(firstToken, secondToken);
  assert.equal(harness.exchangeCount, 1);
  assert.equal(harness.persistCount, 1);
});

test("strict helper has no private-token fallback and cannot select another tenant", async () => {
  const harness = createHarness({ stored: null });

  await assert.rejects(() => harness.open(), /No stored location OAuth token/);
  assert.equal(harness.exchangeCount, 0);
  assert.equal(harness.persistCount, 0);
});

test("refresh persistence input is limited to the OAuth token record", async () => {
  const harness = createHarness({
    stored: token({ expires_at: new Date(NOW - 1_000).toISOString() })
  });
  await harness.open();
  const input = harness.persistedInput;

  assert.equal(harness.persistCount, 1);
  assert.deepEqual(Object.keys(input).sort(), [
    "accessToken",
    "companyId",
    "expiresAt",
    "locationId",
    "refreshToken",
    "scopes",
    "tenantId",
    "tokenType"
  ]);
  for (const forbidden of [
    "contactId",
    "lineUserId",
    "conversationId",
    "providerId",
    "workflowId",
    "lineProfileId"
  ]) {
    assert.equal(Object.hasOwn(input, forbidden), false);
  }
});

test("OAuth errors and session metadata do not serialize token values", async () => {
  const harness = createHarness({
    stored: token({ expires_at: new Date(NOW - 1_000).toISOString() }),
    exchangeError: new Error("access-sensitive refresh-sensitive")
  });
  let serialized = "";

  await assert.rejects(async () => {
    try {
      await harness.open();
    } catch (error) {
      serialized = JSON.stringify({ name: error.name, message: error.message });
      throw error;
    }
  });

  assert.equal(serialized.includes("access-sensitive"), false);
  assert.equal(serialized.includes("refresh-sensitive"), false);
});
