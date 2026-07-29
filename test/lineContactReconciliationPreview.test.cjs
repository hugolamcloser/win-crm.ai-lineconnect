const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createLineContactReconciliationPreviewService
} = require("../dist/services/lineContactReconciliationPreviewService");
const { logger } = require("../dist/config/logger");

const locationId = "location-test";
const currentContactId = "contact-master";
const candidateContactId = "contact-candidate";
const tenantId = "tenant-test";
const lineUserId = "line-user-test";

const baseRequest = {
  locationId,
  currentContactId,
  source: "line",
  identity: { email: "person@example.com" }
};

function profile(overrides = {}) {
  return {
    id: "profile-test",
    tenant_id: tenantId,
    line_user_id: lineUserId,
    line_source_type: "user",
    line_source_id: lineUserId,
    display_name: null,
    picture_url: null,
    ghl_contact_id: currentContactId,
    ghl_conversation_id: "conversation-test",
    line_channel_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function contact(id, overrides = {}) {
  return {
    id,
    locationId,
    tags: [],
    customFields: [],
    ...overrides
  };
}

function createHarness(options = {}) {
  const calls = {
    tenants: 0,
    mappings: 0,
    sessions: 0,
    contacts: [],
    searches: [],
    fieldDefinitions: 0,
    risks: []
  };
  const mappedProfile = options.profile ?? profile();
  const master = options.master ?? contact(currentContactId);
  const candidate = options.candidate ?? contact(candidateContactId, { email: "person@example.com" });
  const riskStatuses = options.riskStatuses ?? {};
  const session = {
    missingRequiredScopes: [],
    async getContact(id) {
      calls.contacts.push(id);
      if (options.getContactError) throw options.getContactError;
      return id === currentContactId ? master : candidate;
    },
    async searchContacts(field, value) {
      calls.searches.push({ field, value });
      if (options.searchError) throw options.searchError;
      return options.searchResults ?? [candidate];
    },
    async getCustomFieldDefinitions() {
      calls.fieldDefinitions += 1;
      if (options.fieldError) throw options.fieldError;
      return options.fieldDefinitions ?? [];
    },
    async checkAssociatedRecords(risk) {
      calls.risks.push(risk);
      if (options.riskCheck) return options.riskCheck(risk);
      return riskStatuses[risk] ?? "CLEAR";
    }
  };
  const service = createLineContactReconciliationPreviewService({
    overallDeadlineMs: options.overallDeadlineMs ?? 500,
    now: options.now ?? Date.now,
    async getTenantIdsByLocationId() {
      calls.tenants += 1;
      if (options.tenantPromise) return options.tenantPromise;
      return options.tenantIds ?? [tenantId];
    },
    async countLineProfilesExactlyForTenant(_tenantId, filter) {
      calls.mappings += 1;
      if (options.mappingResult) return options.mappingResult(filter, calls.mappings);
      return { exactCount: 1, rows: [mappedProfile] };
    },
    readClient: {
      async openSession() {
        calls.sessions += 1;
        if (options.openSessionError) throw options.openSessionError;
        return session;
      }
    }
  });

  return { service, calls };
}

test("AUTO_SIMPLE requires a unique mapped master, one distinct candidate, clear fields, and clear risks", async () => {
  const { service, calls } = createHarness();
  const result = await service(baseRequest);

  assert.equal(result.decision, "AUTO_SIMPLE");
  assert.equal(result.currentContactMatchesMapping, true);
  assert.equal(result.distinctCandidateCount, 1);
  assert.equal(result.readOnly, true);
  assert.deepEqual(Object.values(result.associatedRecords), Array(8).fill("CLEAR"));
  assert.equal(calls.risks.length, 8);
});

test("NO_IDENTIFIER makes zero tenant, HighLevel search, and risk requests", async () => {
  const { service, calls } = createHarness();
  const result = await service({ ...baseRequest, identity: { email: "  ", phone: " " } });

  assert.equal(result.decision, "NO_IDENTIFIER");
  assert.equal(calls.tenants, 0);
  assert.equal(calls.sessions, 0);
  assert.equal(calls.searches.length, 0);
  assert.equal(calls.risks.length, 0);
});

test("invalid and unsupported identity inputs follow classification precedence", async () => {
  const unsupported = createHarness();
  assert.equal((await unsupported.service({ ...baseRequest, source: "sms", identity: { email: "bad" } })).decision, "UNSUPPORTED_SOURCE");
  assert.equal(unsupported.calls.tenants, 0);

  const invalidEmail = createHarness();
  assert.equal((await invalidEmail.service({ ...baseRequest, identity: { email: "bad" } })).decision, "INVALID_EMAIL");

  const invalidPhone = createHarness();
  assert.equal((await invalidPhone.service({ ...baseRequest, identity: { phone: "0123456789" } })).decision, "INVALID_PHONE");
});

test("zero tenant returns LOCATION_NOT_ONBOARDED and multiple tenants are cross-tenant blocked", async () => {
  const zero = createHarness({ tenantIds: [] });
  const zeroResult = await zero.service(baseRequest);
  assert.equal(zeroResult.decision, "MAPPING_NOT_FOUND");
  assert.deepEqual(zeroResult.reasonCodes, ["LOCATION_NOT_ONBOARDED"]);
  assert.equal(zero.calls.sessions, 0);

  const multiple = createHarness({ tenantIds: [tenantId, "tenant-other"] });
  const multipleResult = await multiple.service(baseRequest);
  assert.equal(multipleResult.decision, "CROSS_TENANT_BLOCKED");
  assert.equal(multiple.calls.sessions, 0);
});

test("mapping exact-count outcomes never select a preferred duplicate row", async () => {
  const missing = createHarness({ mappingResult: () => ({ exactCount: 0, rows: [] }) });
  assert.equal((await missing.service(baseRequest)).decision, "MAPPING_NOT_FOUND");

  const duplicate = createHarness({ mappingResult: () => ({ exactCount: 2, rows: [profile(), profile({ id: "profile-two" })] }) });
  assert.equal((await duplicate.service(baseRequest)).decision, "AMBIGUOUS");

  const mismatch = createHarness({
    mappingResult: (_filter, call) => call === 1
      ? { exactCount: 1, rows: [profile()] }
      : { exactCount: 1, rows: [profile({ id: "profile-other", ghl_contact_id: "contact-other" })] }
  });
  const mismatchResult = await mismatch.service(baseRequest);
  assert.equal(mismatchResult.decision, "MAPPING_CONTACT_MISMATCH");
  assert.equal(mismatchResult.currentContactMatchesMapping, false);
});

test("NO_MATCH requires valid identity and no distinct match; master identity is ALREADY_RECONCILED", async () => {
  const noMatch = createHarness({ searchResults: [] });
  assert.equal((await noMatch.service(baseRequest)).decision, "NO_MATCH");

  const already = createHarness({
    master: contact(currentContactId, { email: "person@example.com" }),
    searchResults: [contact(currentContactId, { email: "person@example.com" })]
  });
  assert.equal((await already.service(baseRequest)).decision, "ALREADY_RECONCILED");
});

test("multiple distinct candidates return AMBIGUOUS without running risk checks", async () => {
  const { service, calls } = createHarness({
    searchResults: [
      contact("candidate-one", { email: "person@example.com" }),
      contact("candidate-two", { email: "person@example.com" })
    ]
  });
  const result = await service(baseRequest);

  assert.equal(result.decision, "AMBIGUOUS");
  assert.equal(result.distinctCandidateCount, 2);
  assert.equal(calls.risks.length, 0);
});

test("standard and LINE identity conflicts return IDENTITY_CONFLICT", async () => {
  const standard = createHarness({ master: contact(currentContactId, { email: "other@example.com" }) });
  assert.equal((await standard.service(baseRequest)).decision, "IDENTITY_CONFLICT");

  const lineField = createHarness({
    master: contact(currentContactId, { customFields: [{ id: "line-field", value: "line-a" }] }),
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      customFields: [{ id: "line-field", value: "line-b" }]
    }),
    fieldDefinitions: [{ id: "line-field", fieldKey: "contact.line_user_id", name: "LINE User ID", model: "contact" }]
  });
  assert.equal((await lineField.service(baseRequest)).decision, "IDENTITY_CONFLICT");
});

test("protected business conflicts are manual while one-sided, equal, and ignored fields are safe", async () => {
  const definitions = [
    { id: "protected", fieldKey: "contact.account_tier", name: "Account Tier", model: "contact" },
    { id: "ignored", fieldKey: "contact.ai_event_command", name: "AI Event Command", model: "contact" }
  ];
  const conflict = createHarness({
    master: contact(currentContactId, { customFields: [{ id: "protected", value: "gold" }] }),
    candidate: contact(candidateContactId, { email: "person@example.com", customFields: [{ id: "protected", value: "silver" }] }),
    fieldDefinitions: definitions
  });
  assert.equal((await conflict.service(baseRequest)).decision, "MANUAL_COMPLEX");

  const safe = createHarness({
    master: contact(currentContactId, { customFields: [{ id: "protected", value: "gold" }, { id: "ignored", value: "old" }] }),
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      customFields: [{ id: "protected", value: "gold" }, { id: "ignored", value: "new" }]
    }),
    fieldDefinitions: definitions
  });
  assert.equal((await safe.service(baseRequest)).decision, "AUTO_SIMPLE");
});

test("stale candidate custom fields are never used as request identity", async () => {
  const staleValue = "stale@example.com";
  const { service, calls } = createHarness({
    master: contact(currentContactId, { customFields: [{ id: "candidate-email", value: staleValue }] }),
    candidate: contact(candidateContactId, {
      phone: "+60123456789",
      customFields: [{ id: "candidate-email", value: staleValue }]
    }),
    searchResults: [contact(candidateContactId, { phone: "+60123456789" })],
    fieldDefinitions: [{ id: "candidate-email", fieldKey: "contact.ai_candidate_email", name: "AI Candidate Email", model: "contact" }]
  });
  const result = await service({ ...baseRequest, identity: { phone: "+60123456789" } });

  assert.equal(result.decision, "AUTO_SIMPLE");
  assert.deepEqual(calls.searches, [{ field: "phone", value: "+60123456789" }]);
  assert.equal(calls.searches.some((call) => call.value === staleValue), false);
});

test("every non-CLEAR associated-record status forces MANUAL_COMPLEX and is reported", async () => {
  for (const status of ["FOUND", "MISSING_SCOPE", "UNAVAILABLE", "MALFORMED"]) {
    const { service } = createHarness({ riskStatuses: { notes: status } });
    const result = await service(baseRequest);
    assert.equal(result.decision, "MANUAL_COMPLEX");
    assert.equal(result.associatedRecords.notes, status);
    assert.equal(result.scopeAvailability.notes, status);
  }
});

test("risk checks start concurrently only after candidate ownership and identity validation", async () => {
  let active = 0;
  let maxActive = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const concurrent = createHarness({
    riskCheck: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return "CLEAR";
    }
  });
  const pending = concurrent.service(baseRequest);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(concurrent.calls.risks.length, 8);
  assert.ok(maxActive > 1);
  release();
  assert.equal((await pending).decision, "AUTO_SIMPLE");

  const invalidOwner = createHarness({ candidate: contact(candidateContactId, { locationId: "other-location", email: "person@example.com" }) });
  assert.equal((await invalidOwner.service(baseRequest)).decision, "CROSS_TENANT_BLOCKED");
  assert.equal(invalidOwner.calls.risks.length, 0);

  const invalidIdentity = createHarness({
    searchResults: [contact(candidateContactId, { email: "person@example.com" })],
    candidate: contact(candidateContactId, { email: "different@example.com" })
  });
  assert.equal((await invalidIdentity.service(baseRequest)).decision, "MANUAL_COMPLEX");
  assert.equal(invalidIdentity.calls.risks.length, 0);
});

test("overall preview deadline returns MANUAL_COMPLEX without a retry", async () => {
  const never = new Promise(() => {});
  const { service, calls } = createHarness({ tenantPromise: never, overallDeadlineMs: 20 });
  const result = await service(baseRequest);

  assert.equal(result.decision, "MANUAL_COMPLEX");
  assert.deepEqual(result.reasonCodes, ["PREVIEW_DEADLINE_EXCEEDED"]);
  assert.equal(calls.tenants, 1);
  assert.equal(calls.sessions, 0);
});

test("preview key is deterministic and audit logs contain no raw identifiers or identity values", async () => {
  const originalInfo = logger.info;
  const logged = [];
  logger.info = (...args) => logged.push(args);

  try {
    const firstHarness = createHarness();
    const secondHarness = createHarness();
    const first = await firstHarness.service(baseRequest);
    const second = await secondHarness.service(baseRequest);
    assert.equal(first.previewKey, second.previewKey);

    const serialized = JSON.stringify(logged);
    assert.doesNotMatch(serialized, new RegExp(locationId));
    assert.doesNotMatch(serialized, new RegExp(currentContactId));
    assert.doesNotMatch(serialized, /person@example\.com/);
    assert.doesNotMatch(serialized, new RegExp(tenantId));
    assert.doesNotMatch(serialized, new RegExp(lineUserId));
  } finally {
    logger.info = originalInfo;
  }
});
