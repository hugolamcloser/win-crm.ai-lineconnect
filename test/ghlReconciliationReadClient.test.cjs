const assert = require("node:assert/strict");
const test = require("node:test");

const {
  GhlReconciliationReadError,
  assertReconciliationTransportAllowed,
  createGhlReconciliationReadClient,
  reconciliationRequiredReadScopes
} = require("../dist/integrations/ghlReconciliationReadClient");
const {
  classifyReconciliationStandardField
} = require("../dist/config/lineContactReconciliationStandardFieldPolicy");

const allScopes = [...reconciliationRequiredReadScopes];

function token(scopes = allScopes) {
  return {
    id: "token-row",
    tenant_id: "tenant-test",
    location_id: "location-test",
    company_id: null,
    access_token: "private-test-token",
    refresh_token: "private-test-refresh",
    expires_at: "2099-01-01T00:00:00.000Z",
    scopes,
    token_type: "Bearer",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("transport allowlist permits declared GETs and only POST /contacts/search", () => {
  for (const path of [
    "/contacts/contact-test",
    "/locations/location-test/customFields",
    "/contacts/contact-test/notes",
    "/contacts/contact-test/tasks",
    "/contacts/contact-test/appointments",
    "/conversations/search",
    "/opportunities/search",
    "/payments/orders",
    "/payments/transactions",
    "/invoices/"
  ]) {
    assert.doesNotThrow(() => assertReconciliationTransportAllowed("GET", path));
  }

  assert.doesNotThrow(() => assertReconciliationTransportAllowed("POST", "/contacts/search"));
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    assert.throws(() => assertReconciliationTransportAllowed(method, "/contacts/contact-test"), /Rejected non-read/);
  }
  assert.throws(() => assertReconciliationTransportAllowed("POST", "/contacts"), /Rejected non-read/);
  assert.throws(() => assertReconciliationTransportAllowed("POST", "/conversations/search"), /Rejected non-read/);
  assert.throws(() => assertReconciliationTransportAllowed("GET", "/contacts/search/duplicate"), /Rejected non-read/);
});

test("search dispatches one exact allowed POST with location-scoped filter", async () => {
  const calls = [];
  const client = createGhlReconciliationReadClient({
    loadToken: async () => token(),
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return jsonResponse({ contacts: [] });
    }
  });
  const session = await client.openSession("location-test", "tenant-test", Date.now() + 1_000);
  const result = await session.searchContacts("email", "person@example.com", Date.now() + 1_000);

  assert.deepEqual(result, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/contacts/search");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    locationId: "location-test",
    page: 1,
    pageLimit: 100,
    filters: [{ field: "email", operator: "eq", value: "person@example.com" }]
  });
});

test("missing stored scopes fail before fetch and are exposed without credentials", async () => {
  let fetchCount = 0;
  const client = createGhlReconciliationReadClient({
    loadToken: async () => token(["contacts.readonly"]),
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse({ conversations: [] });
    }
  });
  const session = await client.openSession("location-test", "tenant-test", Date.now() + 1_000);

  assert.ok(session.missingRequiredScopes.includes("conversations.readonly"));
  assert.equal(await session.checkAssociatedRecords("conversations", "contact-test", Date.now() + 1_000), "MISSING_SCOPE");
  assert.equal(fetchCount, 0);
});

test("tenant/location token mismatch is blocked and expired tokens are not refreshed", async () => {
  const mismatched = createGhlReconciliationReadClient({ loadToken: async () => token() });
  await assert.rejects(
    () => mismatched.openSession("location-test", "tenant-other", Date.now() + 1_000),
    (error) => error instanceof GhlReconciliationReadError && error.kind === "CROSS_TENANT"
  );

  let loads = 0;
  const expired = createGhlReconciliationReadClient({
    loadToken: async () => {
      loads += 1;
      return { ...token(), expires_at: "2000-01-01T00:00:00.000Z" };
    }
  });
  await assert.rejects(
    () => expired.openSession("location-test", "tenant-test", Date.now() + 1_000),
    (error) => error instanceof GhlReconciliationReadError && error.kind === "UNAVAILABLE"
  );
  assert.equal(loads, 1);
});

test("per-read timeout aborts once and returns UNAVAILABLE without retry", async () => {
  let fetchCount = 0;
  const client = createGhlReconciliationReadClient({
    loadToken: async () => token(),
    perReadTimeoutMs: 10,
    fetchImpl: async (_url, init) => {
      fetchCount += 1;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
  });
  const session = await client.openSession("location-test", "tenant-test", Date.now() + 1_000);
  const status = await session.checkAssociatedRecords("notes", "contact-test", Date.now() + 1_000);

  assert.equal(status, "UNAVAILABLE");
  assert.equal(fetchCount, 1);
});

test("associated record parsers report CLEAR, FOUND, MALFORMED, and MISSING_SCOPE", async () => {
  const payloads = [
    { notes: [] },
    { notes: [{ id: "note-test" }] },
    { unexpected: [] }
  ];
  let index = 0;
  const client = createGhlReconciliationReadClient({
    loadToken: async () => token(),
    fetchImpl: async () => jsonResponse(payloads[index++])
  });
  const session = await client.openSession("location-test", "tenant-test", Date.now() + 1_000);

  assert.equal(await session.checkAssociatedRecords("notes", "contact-test", Date.now() + 1_000), "CLEAR");
  assert.equal(await session.checkAssociatedRecords("notes", "contact-test", Date.now() + 1_000), "FOUND");
  assert.equal(await session.checkAssociatedRecords("notes", "contact-test", Date.now() + 1_000), "MALFORMED");

  const denied = createGhlReconciliationReadClient({
    loadToken: async () => token(),
    fetchImpl: async () => jsonResponse({ error: "denied" }, 403)
  });
  const deniedSession = await denied.openSession("location-test", "tenant-test", Date.now() + 1_000);
  assert.equal(await deniedSession.checkAssociatedRecords("notes", "contact-test", Date.now() + 1_000), "MISSING_SCOPE");
});

test("pagination uncertainty is malformed and count metadata cannot be mistaken for CLEAR", async () => {
  const responses = [
    { contacts: [{ id: "contact-candidate", locationId: "location-test", email: "person@example.com" }], total: 2 },
    { notes: [], total: 1 }
  ];
  const client = createGhlReconciliationReadClient({
    loadToken: async () => token(),
    fetchImpl: async () => jsonResponse(responses.shift())
  });
  const session = await client.openSession("location-test", "tenant-test", Date.now() + 1_000);

  await assert.rejects(
    () => session.searchContacts("email", "person@example.com", Date.now() + 1_000),
    (error) => error instanceof GhlReconciliationReadError && error.kind === "MALFORMED"
  );
  assert.equal(await session.checkAssociatedRecords("notes", "contact-test", Date.now() + 1_000), "FOUND");
});

test("contact and custom-field readers accept documented nested structures", async () => {
  const responses = [
    { contact: { id: "contact-test", locationId: "location-test", tags: ["line"], customFields: [{ id: "field-test", value: "value" }] } },
    { customFields: [{ id: "field-test", name: "Protected", fieldKey: "contact.protected", model: "contact" }] }
  ];
  const client = createGhlReconciliationReadClient({
    loadToken: async () => token(),
    fetchImpl: async () => jsonResponse(responses.shift())
  });
  const session = await client.openSession("location-test", "tenant-test", Date.now() + 1_000);
  const contact = await session.getContact("contact-test", Date.now() + 1_000);
  const definitions = await session.getCustomFieldDefinitions(Date.now() + 1_000);

  assert.equal(contact.id, "contact-test");
  assert.deepEqual(contact.tags, ["line"]);
  assert.deepEqual(contact.customFields, [{ id: "field-test", value: "value" }]);
  assert.equal(definitions[0].fieldKey, "contact.protected");
});

test("standard contact fields are explicitly classified without treating metadata as transferable", async () => {
  const client = createGhlReconciliationReadClient({
    loadToken: async () => token(),
    fetchImpl: async () => jsonResponse({
      contact: {
        id: "contact-test",
        locationId: "location-test",
        firstName: "Transferable",
        email: "person@example.com",
        updatedAt: "2026-01-01T00:00:00.000Z",
        attributionSource: { source: "metadata" },
        links: [{ rel: "self" }],
        source: "protected-source",
        futureBusinessValue: "unclassified-value",
        tags: [],
        customFields: []
      }
    })
  });
  const session = await client.openSession("location-test", "tenant-test", Date.now() + 1_000);
  const contact = await session.getContact("contact-test", Date.now() + 1_000);

  assert.deepEqual(contact.standardFields, {
    firstName: "Transferable",
    email: "person@example.com"
  });
  assert.deepEqual(Object.keys(contact.protectedOrUnsupportedStandardFields).sort(), ["attributionSource", "source"]);
  assert.equal(contact.unclassifiedStandardFieldCount, 1);
  assert.equal(JSON.stringify(contact.standardFields).includes("updatedAt"), false);
  assert.equal(JSON.stringify(contact.standardFields).includes("attributionSource"), false);
  assert.equal(JSON.stringify(contact.standardFields).includes("links"), false);
});

test("valuable relationship and attribution fields are protected while true system metadata is ignored", () => {
  for (const fieldName of [
    "type",
    "followers",
    "followersIds",
    "attributions",
    "attributionSource",
    "lastAttributionSource",
    "businessId"
  ]) {
    assert.equal(classifyReconciliationStandardField(fieldName), "PROTECTED_OR_UNSUPPORTED");
  }

  for (const fieldName of [
    "id",
    "contactId",
    "locationId",
    "createdAt",
    "updatedAt",
    "deleted",
    "deletedAt",
    "links",
    "tags",
    "customFields",
    "validEmail"
  ]) {
    assert.equal(classifyReconciliationStandardField(fieldName), "IGNORED_METADATA");
  }
});

test("malformed contact tags are rejected instead of discarded", async () => {
  for (const tags of ["line", ["line", 42], ["line", "  "]]) {
    const client = createGhlReconciliationReadClient({
      loadToken: async () => token(),
      fetchImpl: async () => jsonResponse({ contact: { id: "contact-test", locationId: "location-test", tags } })
    });
    const session = await client.openSession("location-test", "tenant-test", Date.now() + 1_000);

    await assert.rejects(
      () => session.getContact("contact-test", Date.now() + 1_000),
      (error) => error instanceof GhlReconciliationReadError && error.kind === "MALFORMED"
    );
  }
});

test("GET contact 404 has a distinct NOT_FOUND error kind", async () => {
  const client = createGhlReconciliationReadClient({
    loadToken: async () => token(),
    fetchImpl: async () => jsonResponse({ message: "not found" }, 404)
  });
  const session = await client.openSession("location-test", "tenant-test", Date.now() + 1_000);

  await assert.rejects(
    () => session.getContact("contact-test", Date.now() + 1_000),
    (error) => error instanceof GhlReconciliationReadError && error.kind === "NOT_FOUND" && error.statusCode === 404
  );
});

test("malformed contact custom fields and duplicate metadata IDs are rejected", async () => {
  const responses = [
    { contact: { id: "contact-test", locationId: "location-test", customFields: [{ value: "missing-id" }] } },
    { customFields: [
      { id: "duplicate", fieldKey: "contact.one", name: "One" },
      { id: "duplicate", fieldKey: "contact.two", name: "Two" }
    ] }
  ];
  const client = createGhlReconciliationReadClient({
    loadToken: async () => token(),
    fetchImpl: async () => jsonResponse(responses.shift())
  });
  const session = await client.openSession("location-test", "tenant-test", Date.now() + 1_000);

  await assert.rejects(
    () => session.getContact("contact-test", Date.now() + 1_000),
    (error) => error instanceof GhlReconciliationReadError && error.kind === "MALFORMED"
  );
  await assert.rejects(
    () => session.getCustomFieldDefinitions(Date.now() + 1_000),
    (error) => error instanceof GhlReconciliationReadError && error.kind === "MALFORMED"
  );
});
