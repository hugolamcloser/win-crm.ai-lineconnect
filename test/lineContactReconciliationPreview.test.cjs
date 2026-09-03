const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  createLineContactReconciliationPreviewService
} = require("../dist/services/lineContactReconciliationPreviewService");
const { logger } = require("../dist/config/logger");
const { env } = require("../dist/config/env");
const {
  resolveReconciliationFieldPolicy
} = require("../dist/config/lineContactReconciliationFieldPolicy");
const { GhlReconciliationReadError } = require("../dist/integrations/ghlReconciliationReadClient");

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
  const result = {
    id,
    locationId,
    tags: [],
    customFields: [],
    ...overrides
  };

  result.standardFields = overrides.standardFields ?? Object.fromEntries(
    [["email", result.email], ["phone", result.phone]].filter(([, value]) => value !== undefined)
  );
  result.protectedOrUnsupportedStandardFields = overrides.protectedOrUnsupportedStandardFields ?? {};
  result.unclassifiedStandardFieldCount = overrides.unclassifiedStandardFieldCount ?? 0;
  return result;
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
      if (options.getContact) return options.getContact(id);
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
      if ("contactId" in filter && filter.contactId !== currentContactId) {
        return { exactCount: 0, rows: [] };
      }
      return { exactCount: 1, rows: [mappedProfile] };
    },
    readClient: {
      async openSession() {
        calls.sessions += 1;
        if (options.openSessionError) throw options.openSessionError;
        return session;
      }
    },
    getPreviewKeySecret: () => options.previewKeySecret ?? "preview-test-shared-secret",
    captureAutoSimpleContext: options.captureAutoSimpleContext
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

test("AUTO_SIMPLE can expose server-internal dry-run context without changing the public Preview response", async () => {
  let captured;
  const { service } = createHarness({ captureAutoSimpleContext: (context) => { captured = context; } });
  const result = await service(baseRequest);

  assert.equal(result.decision, "AUTO_SIMPLE");
  assert.equal(captured.tenantId, tenantId);
  assert.equal(captured.currentContactId, currentContactId);
  assert.equal(captured.candidate.id, candidateContactId);
  assert.equal(captured.lineUserId, lineUserId);
  assert.equal(JSON.stringify(result).includes(candidateContactId), false);
  assert.equal(JSON.stringify(result).includes(lineUserId), false);
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

test("OAuth tenant mismatch remains CROSS_TENANT_BLOCKED at the Preview boundary", async () => {
  const harness = createHarness({
    openSessionError: new GhlReconciliationReadError("CROSS_TENANT", "OAuth context mismatch")
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "CROSS_TENANT_BLOCKED");
  assert.equal(result.reasonCodes.includes("OAUTH_TENANT_MISMATCH"), true);
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

test("inconsistent exact-count results fail closed at every mapping boundary", async () => {
  for (const result of [
    { exactCount: 0, rows: [profile()] },
    { exactCount: 1, rows: [] }
  ]) {
    const harness = createHarness({ mappingResult: () => result });
    const preview = await harness.service(baseRequest);
    assert.equal(preview.decision, "MANUAL_COMPLEX");
    assert.deepEqual(preview.reasonCodes, ["CONTACT_MAPPING_COUNT_INCONSISTENT"]);
  }

  const knownDuplicate = createHarness({ mappingResult: () => ({ exactCount: 2, rows: [] }) });
  assert.equal((await knownDuplicate.service(baseRequest)).decision, "AMBIGUOUS");

  const lineMappingInconsistent = createHarness({
    mappingResult: (_filter, call) => call === 1
      ? { exactCount: 1, rows: [profile()] }
      : { exactCount: 1, rows: [] }
  });
  const linePreview = await lineMappingInconsistent.service(baseRequest);
  assert.equal(linePreview.decision, "MANUAL_COMPLEX");
  assert.deepEqual(linePreview.reasonCodes, ["LINE_USER_MAPPING_COUNT_INCONSISTENT"]);

  for (const candidateResult of [
    { exactCount: 0, rows: [profile({ id: "candidate-profile", ghl_contact_id: candidateContactId })] },
    { exactCount: 1, rows: [] },
    { exactCount: 2, rows: [] }
  ]) {
    const harness = createHarness({
      mappingResult: (filter) => "contactId" in filter && filter.contactId === candidateContactId
        ? candidateResult
        : { exactCount: 1, rows: [profile()] }
    });
    const preview = await harness.service(baseRequest);
    assert.equal(preview.decision, "AMBIGUOUS");
    assert.deepEqual(preview.reasonCodes, ["CANDIDATE_LINE_MAPPING_AMBIGUOUS"]);
  }
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

test("realistic mapped-master protected fields do not block NO_MATCH or ALREADY_RECONCILED", async () => {
  const protectedFields = {
    source: "LINE Official Account",
    type: "lead",
    timezone: "Asia/Kuala_Lumpur",
    assignedTo: "assigned-user-reference"
  };
  const noMatch = createHarness({
    master: contact(currentContactId, { protectedOrUnsupportedStandardFields: protectedFields }),
    searchResults: []
  });
  const noMatchResult = await noMatch.service(baseRequest);
  assert.equal(noMatchResult.decision, "NO_MATCH");
  assert.deepEqual(noMatchResult.transferInventory.protectedOrUnsupportedStandardFields, {
    masterOnly: 4, candidateOnly: 0, equal: 0, conflicting: 0
  });
  assert.equal(noMatch.calls.risks.length, 0);

  const already = createHarness({
    master: contact(currentContactId, {
      email: "person@example.com",
      protectedOrUnsupportedStandardFields: protectedFields
    }),
    searchResults: []
  });
  const alreadyResult = await already.service(baseRequest);
  assert.equal(alreadyResult.decision, "ALREADY_RECONCILED");
  assert.equal(already.calls.risks.length, 0);
  assert.equal(already.calls.fieldDefinitions, 1);
});

test("mapped-master LINE identity fields are validated even without a candidate", async () => {
  const trusted = createHarness({
    master: contact(currentContactId, { customFields: [{ id: "line-field", value: lineUserId }] }),
    searchResults: [],
    fieldDefinitions: [{ id: "line-field", fieldKey: "contact.line_id", name: "LINE ID", model: "contact" }]
  });
  const trustedResult = await trusted.service(baseRequest);
  assert.equal(trustedResult.decision, "NO_MATCH");
  assert.equal(trustedResult.fieldPolicy.lineIdentityConflict, false);
  assert.equal(trusted.calls.risks.length, 0);

  const wrong = createHarness({
    master: contact(currentContactId, { customFields: [{ id: "line-field", value: "different-line-user" }] }),
    searchResults: [],
    fieldDefinitions: [{ id: "line-field", fieldKey: "contact.line_id", name: "LINE ID", model: "contact" }]
  });
  const wrongResult = await wrong.service(baseRequest);
  assert.equal(wrongResult.decision, "IDENTITY_CONFLICT");
  assert.deepEqual(wrongResult.reasonCodes, ["MAPPED_CONTACT_LINE_FIELD_DIFFERENT_USER"]);
  assert.equal(wrong.calls.risks.length, 0);
  assert.doesNotMatch(JSON.stringify(wrongResult), /different-line-user|line-user-test/);
});

test("mapped-master LINE metadata failures are manual without candidate risk reads", async () => {
  for (const kind of ["MALFORMED", "UNAVAILABLE"]) {
    const harness = createHarness({
      searchResults: [],
      fieldError: new GhlReconciliationReadError(kind, "metadata unavailable")
    });
    const result = await harness.service(baseRequest);

    assert.equal(result.decision, "MANUAL_COMPLEX");
    assert.deepEqual(result.reasonCodes, [`MAPPED_LINE_FIELD_METADATA_${kind}`]);
    assert.equal(harness.calls.searches.length, 0);
    assert.equal(harness.calls.risks.length, 0);
  }
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

const lineIdentityDefinition = [
  { id: "line-field", fieldKey: "contact.line_id", name: "LINE ID", model: "contact" }
];

test("trusted LINE identity field values are accepted as valid evidence", async () => {
  const harness = createHarness({
    master: contact(currentContactId, { customFields: [{ id: "line-field", value: lineUserId }] }),
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      customFields: [{ id: "line-field", value: lineUserId }]
    }),
    fieldDefinitions: lineIdentityDefinition
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "AUTO_SIMPLE");
  assert.equal(result.fieldPolicy.lineIdentityConflict, false);
});

test("master-only wrong LINE identity field is rejected against the trusted mapping", async () => {
  const harness = createHarness({
    master: contact(currentContactId, { customFields: [{ id: "line-field", value: "wrong-user" }] }),
    fieldDefinitions: lineIdentityDefinition
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "IDENTITY_CONFLICT");
  assert.deepEqual(result.reasonCodes, ["MAPPED_CONTACT_LINE_FIELD_DIFFERENT_USER"]);
  assert.doesNotMatch(JSON.stringify(result), /wrong-user|line-user-test/);
});

test("candidate-only wrong LINE identity field is rejected against the trusted mapping", async () => {
  const harness = createHarness({
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      customFields: [{ id: "line-field", value: "wrong-user" }]
    }),
    fieldDefinitions: lineIdentityDefinition
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "IDENTITY_CONFLICT");
  assert.deepEqual(result.reasonCodes, ["CANDIDATE_LINE_FIELD_DIFFERENT_USER"]);
});

test("the same wrong LINE identity field on both contacts rejects both owners", async () => {
  const harness = createHarness({
    master: contact(currentContactId, { customFields: [{ id: "line-field", value: "same-wrong-user" }] }),
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      customFields: [{ id: "line-field", value: "same-wrong-user" }]
    }),
    fieldDefinitions: lineIdentityDefinition
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "IDENTITY_CONFLICT");
  assert.deepEqual(result.reasonCodes, [
    "MAPPED_CONTACT_LINE_FIELD_DIFFERENT_USER",
    "CANDIDATE_LINE_FIELD_DIFFERENT_USER"
  ]);
});

test("different wrong LINE identity fields are rejected as conflicting evidence", async () => {
  const harness = createHarness({
    master: contact(currentContactId, { customFields: [{ id: "line-field", value: "wrong-master" }] }),
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      customFields: [{ id: "line-field", value: "wrong-candidate" }]
    }),
    fieldDefinitions: lineIdentityDefinition
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "IDENTITY_CONFLICT");
  assert.deepEqual(result.reasonCodes, [
    "MAPPED_CONTACT_LINE_FIELD_DIFFERENT_USER",
    "CANDIDATE_LINE_FIELD_DIFFERENT_USER",
    "LINE_IDENTITY_FIELDS_CONFLICT"
  ]);
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
    assert.equal(result.riskReadStatuses.notes, status);
    assert.equal("scopeAvailability" in result, false);
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

test("candidate mapping to another LINE user is an identity conflict", async () => {
  const { service, calls } = createHarness({
    mappingResult: (filter) => {
      if ("contactId" in filter && filter.contactId === candidateContactId) {
        return { exactCount: 1, rows: [profile({ id: "candidate-profile", line_user_id: "different-line-user", ghl_contact_id: candidateContactId })] };
      }
      return { exactCount: 1, rows: [profile()] };
    }
  });
  const result = await service(baseRequest);

  assert.equal(result.decision, "IDENTITY_CONFLICT");
  assert.deepEqual(result.reasonCodes, ["CANDIDATE_MAPPED_TO_DIFFERENT_LINE_USER"]);
  assert.equal(calls.risks.length, 0);
});

test("a distinct candidate mapped to the same LINE user is ambiguous", async () => {
  const { service, calls } = createHarness({
    mappingResult: (filter) => {
      if ("contactId" in filter && filter.contactId === candidateContactId) {
        return {
          exactCount: 1,
          rows: [profile({ id: "candidate-profile", ghl_contact_id: candidateContactId })]
        };
      }
      return { exactCount: 1, rows: [profile()] };
    }
  });
  const result = await service(baseRequest);

  assert.equal(result.decision, "AMBIGUOUS");
  assert.deepEqual(result.reasonCodes, ["SAME_LINE_USER_MAPPED_TO_MULTIPLE_CONTACTS"]);
  assert.equal(calls.risks.length, 0);
});

test("ambiguous candidate LINE mappings fail before risk reads", async () => {
  const { service, calls } = createHarness({
    mappingResult: (filter) => {
      if ("contactId" in filter && filter.contactId === candidateContactId) {
        return {
          exactCount: 2,
          rows: [
            profile({ id: "candidate-profile-a", ghl_contact_id: candidateContactId }),
            profile({ id: "candidate-profile-b", ghl_contact_id: candidateContactId })
          ]
        };
      }
      return { exactCount: 1, rows: [profile()] };
    }
  });
  const result = await service(baseRequest);

  assert.equal(result.decision, "AMBIGUOUS");
  assert.deepEqual(result.reasonCodes, ["CANDIDATE_LINE_MAPPING_AMBIGUOUS"]);
  assert.equal(calls.risks.length, 0);
});

const validLineUserId = "U0123456789abcdef0123456789abcdef";
const lowercasePrefixLineUserId = `u${validLineUserId.slice(1)}`;
const differentValidLineUserId = "U0123456789abcdef0123456789abcdee";

test("valid LINE identity tags match across the observed uppercase-U and lowercase-u variants", async () => {
  const harness = createHarness({
    profile: profile({ line_user_id: validLineUserId }),
    master: contact(currentContactId, { tags: [`line:${lowercasePrefixLineUserId}`] }),
    searchResults: []
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "NO_MATCH");
  assert.equal(result.lineIdentityTags.master, "MATCH");
});

test("a different valid LINE identity body remains an identity conflict", async () => {
  const harness = createHarness({
    profile: profile({ line_user_id: validLineUserId }),
    master: contact(currentContactId, { tags: [`line:${differentValidLineUserId}`] })
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "IDENTITY_CONFLICT");
  assert.deepEqual(result.reasonCodes, ["MAPPED_CONTACT_LINE_TAG_DIFFERENT_USER"]);
});

test("malformed LINE identity tags fail closed", async () => {
  const harness = createHarness({
    profile: profile({ line_user_id: validLineUserId }),
    master: contact(currentContactId, { tags: ["line:not-a-supported-line-user-id"] })
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "MANUAL_COMPLEX");
  assert.deepEqual(result.reasonCodes, ["MAPPED_CONTACT_LINE_IDENTITY_TAG_MALFORMED"]);
  assert.equal(result.lineIdentityTags.master, "NOT_EVALUATED");
});

test("case variants of one valid LINE identity deduplicate without false ambiguity", async () => {
  const uppercaseBodyVariant = `u${validLineUserId.slice(1).toUpperCase()}`;
  const harness = createHarness({
    profile: profile({ line_user_id: validLineUserId }),
    master: contact(currentContactId, {
      tags: [`line:${validLineUserId}`, `LINE:${lowercasePrefixLineUserId}`, `line:${uppercaseBodyVariant}`]
    }),
    searchResults: []
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "NO_MATCH");
  assert.equal(result.lineIdentityTags.master, "MATCH");
});

test("multiple genuinely different canonical LINE identities remain ambiguous", async () => {
  const harness = createHarness({
    profile: profile({ line_user_id: validLineUserId }),
    master: contact(currentContactId, {
      tags: [`line:${lowercasePrefixLineUserId}`, `line:${differentValidLineUserId}`]
    })
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "AMBIGUOUS");
  assert.deepEqual(result.reasonCodes, ["MAPPED_CONTACT_LINE_IDENTITY_TAGS_AMBIGUOUS"]);
});

test("existing exact-case LINE identity tags continue to pass and ordinary line tags remain non-identity", async () => {
  const harness = createHarness({
    profile: profile({ line_user_id: validLineUserId }),
    master: contact(currentContactId, { tags: [`LINE:${validLineUserId}`] }),
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      tags: ["line", `line:${validLineUserId}`]
    })
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "AUTO_SIMPLE");
  assert.deepEqual(result.lineIdentityTags, { master: "MATCH", candidate: "MATCH" });
  assert.equal(result.transferInventory.candidateOnlyNonIdentityTags, 1);
});

test("LINE identity normalization never exposes raw identities in responses or completion logs", async () => {
  const originalInfo = logger.info;
  const logged = [];
  logger.info = (...args) => logged.push(args);

  try {
    const harness = createHarness({
      profile: profile({ line_user_id: validLineUserId }),
      master: contact(currentContactId, { tags: [`line:${lowercasePrefixLineUserId}`] }),
      searchResults: []
    });
    const result = await harness.service(baseRequest);
    const serialized = JSON.stringify({ result, logged });

    assert.doesNotMatch(serialized, new RegExp(validLineUserId, "i"));
    assert.doesNotMatch(serialized, new RegExp(lowercasePrefixLineUserId, "i"));
  } finally {
    logger.info = originalInfo;
  }
});

test("LINE ID name and contact.line_id key are confirmed LINE identity fields", async () => {
  for (const definition of [
    { id: "line-field", fieldKey: "contact.line_id", name: "Unrelated Name", model: "contact" },
    { id: "line-field", fieldKey: "contact.other", name: "LINE ID", model: "contact" }
  ]) {
    const harness = createHarness({
      master: contact(currentContactId, { customFields: [{ id: "line-field", value: "line-a" }] }),
      candidate: contact(candidateContactId, {
        email: "person@example.com",
        customFields: [{ id: "line-field", value: "line-b" }]
      }),
      fieldDefinitions: [definition]
    });
    assert.equal((await harness.service(baseRequest)).decision, "IDENTITY_CONFLICT");
  }
});

test("configured LINE field ID is identity only when confirmed in current location metadata", async () => {
  const originalConfiguredId = env.GHL_LINE_USER_ID_FIELD_ID;
  env.GHL_LINE_USER_ID_FIELD_ID = "configured-line-field";

  try {
    const contactPair = {
      master: contact(currentContactId, { customFields: [{ id: "configured-line-field", value: "line-a" }] }),
      candidate: contact(candidateContactId, {
        email: "person@example.com",
        customFields: [{ id: "configured-line-field", value: "line-b" }]
      })
    };
    const confirmed = createHarness({
      ...contactPair,
      fieldDefinitions: [{ id: "configured-line-field", fieldKey: "contact.other", name: "Other", model: "contact" }]
    });
    assert.equal((await confirmed.service(baseRequest)).decision, "IDENTITY_CONFLICT");

    const absent = createHarness({
      ...contactPair,
      fieldDefinitions: [{ id: "different-field", fieldKey: "contact.other", name: "Other", model: "contact" }]
    });
    const absentResult = await absent.service(baseRequest);
    assert.equal(absentResult.decision, "MANUAL_COMPLEX");
    assert.equal(absentResult.fieldPolicy.status, "MALFORMED");
  } finally {
    env.GHL_LINE_USER_ID_FIELD_ID = originalConfiguredId;
  }
});

test("duplicate and malformed custom-field entries fail closed while equal duplicates normalize", async () => {
  const definition = [{ id: "protected", fieldKey: "contact.protected", name: "Protected", model: "contact" }];
  const conflictingDuplicate = createHarness({
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      customFields: [{ id: "protected", value: "one" }, { id: "protected", value: "two" }]
    }),
    fieldDefinitions: definition
  });
  const conflictResult = await conflictingDuplicate.service(baseRequest);
  assert.equal(conflictResult.decision, "MANUAL_COMPLEX");
  assert.equal(conflictResult.fieldPolicy.status, "MALFORMED");

  const malformed = createHarness({
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      customFields: [{ value: "missing-id" }]
    }),
    fieldDefinitions: definition
  });
  assert.equal((await malformed.service(baseRequest)).decision, "MANUAL_COMPLEX");

  const equalDuplicate = createHarness({
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      customFields: [{ id: "protected", value: "same" }, { id: "protected", value: "same" }]
    }),
    fieldDefinitions: definition
  });
  assert.equal((await equalDuplicate.service(baseRequest)).decision, "AUTO_SIMPLE");
});

test("duplicate custom-field metadata IDs fail closed", async () => {
  const harness = createHarness({
    fieldDefinitions: [
      { id: "duplicate", fieldKey: "contact.one", name: "One", model: "contact" },
      { id: "duplicate", fieldKey: "contact.two", name: "Two", model: "contact" }
    ]
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "MANUAL_COMPLEX");
  assert.equal(result.fieldPolicy.status, "MALFORMED");
});

test("unrelated definitions may share a normalized fieldKey and remain protected independently by ID", () => {
  const policy = resolveReconciliationFieldPolicy([
    { id: "protected-one", fieldKey: "contact.shared_key", name: "First Business Field", model: "contact" },
    { id: "protected-two", fieldKey: " CONTACT.SHARED_KEY ", name: "Second Business Field", model: "contact" }
  ]);

  assert.deepEqual([...policy.lineIdentityFieldIds], []);
  assert.deepEqual([...policy.ignoredFieldIds], []);
  assert.deepEqual([...policy.protectedBusinessFieldIds], ["protected-one", "protected-two"]);
});

test("field policy rejects duplicate definition IDs", () => {
  assert.throws(() => resolveReconciliationFieldPolicy([
    { id: "duplicate", fieldKey: "contact.one", name: "One", model: "contact" },
    { id: "duplicate", fieldKey: "contact.two", name: "Two", model: "contact" }
  ]), /Ambiguous HighLevel custom-field metadata/);
});

test("field policy rejects multiple definitions matching one LINE identity reference", () => {
  assert.throws(() => resolveReconciliationFieldPolicy([
    { id: "line-one", fieldKey: "contact.line_id", name: "First", model: "contact" },
    { id: "line-two", fieldKey: " CONTACT.LINE_ID ", name: "Second", model: "contact" }
  ]), /Ambiguous HighLevel custom-field policy metadata/);
});

test("field policy rejects multiple definitions matching one ignored temporary-field reference", () => {
  assert.throws(() => resolveReconciliationFieldPolicy([
    { id: "ignored-one", fieldKey: "contact.ai_event_command", name: "First", model: "contact" },
    { id: "ignored-two", fieldKey: " CONTACT.AI_EVENT_COMMAND ", name: "Second", model: "contact" }
  ]), /Ambiguous HighLevel custom-field policy metadata/);
});

test("one LINE identity definition resolves once alongside unrelated duplicate fieldKeys", () => {
  const policy = resolveReconciliationFieldPolicy([
    { id: "line-field", fieldKey: "contact.line_id", name: "LINE ID", model: "contact" },
    { id: "protected-one", fieldKey: "contact.shared_key", name: "First Business Field", model: "contact" },
    { id: "protected-two", fieldKey: " CONTACT.SHARED_KEY ", name: "Second Business Field", model: "contact" }
  ]);

  assert.deepEqual([...policy.lineIdentityFieldIds], ["line-field"]);
  assert.deepEqual([...policy.ignoredFieldIds], []);
  assert.deepEqual([...policy.protectedBusinessFieldIds], ["protected-one", "protected-two"]);
});

test("mapped and candidate contact 404 responses use distinct safe classifications", async () => {
  const mappedMissing = createHarness({
    getContactError: new GhlReconciliationReadError("NOT_FOUND", "not found", 404)
  });
  const mappedResult = await mappedMissing.service(baseRequest);
  assert.equal(mappedResult.decision, "MAPPING_NOT_FOUND");
  assert.deepEqual(mappedResult.reasonCodes, ["MAPPED_GHL_CONTACT_NOT_FOUND"]);

  const candidateMissing = createHarness({
    getContact: async (id) => {
      if (id === currentContactId) return contact(currentContactId);
      throw new GhlReconciliationReadError("NOT_FOUND", "not found", 404);
    }
  });
  const candidateResult = await candidateMissing.service(baseRequest);
  assert.equal(candidateResult.decision, "MANUAL_COMPLEX");
  assert.deepEqual(candidateResult.reasonCodes, ["CANDIDATE_DISAPPEARED"]);
});

test("malformed master and candidate tags fail closed through read classifications", async () => {
  const mappedMalformed = createHarness({
    getContactError: new GhlReconciliationReadError("MALFORMED", "malformed tags")
  });
  const mappedResult = await mappedMalformed.service(baseRequest);
  assert.equal(mappedResult.decision, "MANUAL_COMPLEX");
  assert.deepEqual(mappedResult.reasonCodes, ["MAPPED_CONTACT_MALFORMED"]);

  const candidateMalformed = createHarness({
    getContact: async (id) => {
      if (id === currentContactId) return contact(currentContactId);
      throw new GhlReconciliationReadError("MALFORMED", "malformed tags");
    }
  });
  const candidateResult = await candidateMalformed.service(baseRequest);
  assert.equal(candidateResult.decision, "MANUAL_COMPLEX");
  assert.deepEqual(candidateResult.reasonCodes, ["CANDIDATE_CONTACT_MALFORMED"]);
});

test("unclassified non-empty standard data is counted and fails closed without exposing names or values", async () => {
  const unknownFieldName = "futureBusinessValue";
  const unknownValue = "private-unknown-value";
  const harness = createHarness({
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      [unknownFieldName]: unknownValue,
      unclassifiedStandardFieldCount: 1
    })
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "MANUAL_COMPLEX");
  assert.deepEqual(result.reasonCodes, ["UNCLASSIFIED_STANDARD_FIELD_PRESENT"]);
  assert.equal(result.transferInventory.unclassifiedStandardFieldCount, 1);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${unknownFieldName}|${unknownValue}`));
});

test("master-only inbound DND settings are safe because the intended master retains them", async () => {
  const harness = createHarness({
    master: contact(currentContactId, {
      protectedOrUnsupportedStandardFields: {
        inboundDndSettings: { all: { status: "active" } }
      }
    })
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "AUTO_SIMPLE");
  assert.deepEqual(result.transferInventory.protectedOrUnsupportedStandardFields, {
    masterOnly: 1, candidateOnly: 0, equal: 0, conflicting: 0
  });
});

test("candidate-only inbound DND settings remain a protected blocker", async () => {
  const harness = createHarness({
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      protectedOrUnsupportedStandardFields: {
        inboundDndSettings: { all: { status: "active" } }
      }
    })
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "MANUAL_COMPLEX");
  assert.deepEqual(result.reasonCodes, ["CANDIDATE_ONLY_PROTECTED_STANDARD_FIELD"]);
  assert.deepEqual(result.transferInventory.protectedOrUnsupportedStandardFields, {
    masterOnly: 0, candidateOnly: 1, equal: 0, conflicting: 0
  });
});

test("conflicting inbound DND settings remain a protected blocker", async () => {
  const harness = createHarness({
    master: contact(currentContactId, {
      protectedOrUnsupportedStandardFields: {
        inboundDndSettings: { all: { status: "active" } }
      }
    }),
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      protectedOrUnsupportedStandardFields: {
        inboundDndSettings: { all: { status: "inactive" } }
      }
    })
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "MANUAL_COMPLEX");
  assert.deepEqual(result.reasonCodes, ["CONFLICTING_PROTECTED_STANDARD_FIELD"]);
  assert.deepEqual(result.transferInventory.protectedOrUnsupportedStandardFields, {
    masterOnly: 0, candidateOnly: 0, equal: 0, conflicting: 1
  });
});

test("candidate-only protected standard data requires manual review", async () => {
  const harness = createHarness({
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      protectedOrUnsupportedStandardFields: { type: "lead" }
    })
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "MANUAL_COMPLEX");
  assert.deepEqual(result.reasonCodes, ["CANDIDATE_ONLY_PROTECTED_STANDARD_FIELD"]);
  assert.deepEqual(result.transferInventory.protectedOrUnsupportedStandardFields, {
    masterOnly: 0, candidateOnly: 1, equal: 0, conflicting: 0
  });
});

test("equal protected standard data is safe for Preview", async () => {
  const protectedFields = { type: "lead", businessId: "business-reference" };
  const harness = createHarness({
    master: contact(currentContactId, { protectedOrUnsupportedStandardFields: protectedFields }),
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      protectedOrUnsupportedStandardFields: protectedFields
    })
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "AUTO_SIMPLE");
  assert.deepEqual(result.transferInventory.protectedOrUnsupportedStandardFields, {
    masterOnly: 0, candidateOnly: 0, equal: 2, conflicting: 0
  });
});

test("conflicting protected standard data requires manual review without exposing data", async () => {
  const harness = createHarness({
    master: contact(currentContactId, {
      protectedOrUnsupportedStandardFields: { attributionSource: "line-source-private" }
    }),
    candidate: contact(candidateContactId, {
      email: "person@example.com",
      protectedOrUnsupportedStandardFields: { attributionSource: "form-source-private" }
    })
  });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "MANUAL_COMPLEX");
  assert.deepEqual(result.reasonCodes, ["CONFLICTING_PROTECTED_STANDARD_FIELD"]);
  assert.deepEqual(result.transferInventory.protectedOrUnsupportedStandardFields, {
    masterOnly: 0, candidateOnly: 0, equal: 0, conflicting: 1
  });
  assert.doesNotMatch(JSON.stringify(result), /attributionSource|line-source-private|form-source-private/);
});

test("transfer inventory returns counts only for standard fields, custom fields, and candidate-only tags", async () => {
  const master = contact(currentContactId, {
    tags: ["shared", "master-only"],
    standardFields: { firstName: "Same", lastName: "Master", city: "Kuala Lumpur", state: "A" },
    customFields: [
      { id: "equal", value: "same" },
      { id: "master-only", value: "master" },
      { id: "conflict", value: "one" }
    ]
  });
  const candidate = contact(candidateContactId, {
    email: "person@example.com",
    tags: ["shared", "candidate-only", "line"],
    standardFields: { firstName: "Same", phone: "+60123456789", city: "Penang", state: "A" },
    customFields: [
      { id: "equal", value: "same" },
      { id: "candidate-only", value: "candidate" },
      { id: "conflict", value: "two" }
    ]
  });
  const fieldDefinitions = ["equal", "master-only", "candidate-only", "conflict"].map((id) => ({
    id,
    fieldKey: `contact.${id}`,
    name: id,
    model: "contact"
  }));
  const harness = createHarness({ master, candidate, fieldDefinitions });
  const result = await harness.service(baseRequest);

  assert.equal(result.decision, "MANUAL_COMPLEX");
  assert.deepEqual(result.transferInventory.standardFields, {
    masterOnly: 1,
    candidateOnly: 1,
    equal: 2,
    conflicting: 1
  });
  assert.deepEqual(result.transferInventory.customFields, {
    masterOnly: 1,
    candidateOnly: 1,
    equal: 1,
    conflicting: 1
  });
  assert.equal(result.transferInventory.candidateOnlyNonIdentityTags, 2);
  assert.deepEqual(result.transferInventory.protectedOrUnsupportedStandardFields, {
    masterOnly: 0, candidateOnly: 0, equal: 0, conflicting: 0
  });
  assert.equal(result.transferInventory.unclassifiedStandardFieldCount, 0);
  const serialized = JSON.stringify(result.transferInventory);
  assert.doesNotMatch(
    serialized,
    /"(?:Same|Master|Kuala Lumpur|Penang|shared|master-only|candidate-only|conflict|person@example\.com)"/
  );
});

test("Preview key is HMAC-based, deterministic, and changes with request input", async () => {
  const secret = "hmac-preview-test-secret";
  const first = await createHarness({ previewKeySecret: secret }).service(baseRequest);
  const same = await createHarness({ previewKeySecret: secret }).service(baseRequest);
  const different = await createHarness({ previewKeySecret: secret }).service({
    ...baseRequest,
    identity: { email: "different@example.com" }
  });
  const plainInput = [locationId, currentContactId, "line", "person@example.com", ""].join("\u001f");
  const plainSha256 = crypto.createHash("sha256").update(plainInput).digest("hex").slice(0, 32);

  assert.equal(first.previewKey, same.previewKey);
  assert.notEqual(first.previewKey, different.previewKey);
  assert.notEqual(first.previewKey, plainSha256);
});

test("deadline winner prevents later reads and emits exactly one completion log", async () => {
  let releaseMaster;
  const masterGate = new Promise((resolve) => { releaseMaster = resolve; });
  const originalInfo = logger.info;
  const completions = [];
  logger.info = (...args) => completions.push(args);
  const harness = createHarness({
    overallDeadlineMs: 20,
    getContact: async (id) => {
      if (id === currentContactId) {
        await masterGate;
        return contact(currentContactId);
      }
      return contact(candidateContactId, { email: "person@example.com" });
    }
  });

  try {
    const result = await harness.service(baseRequest);
    assert.equal(result.decision, "MANUAL_COMPLEX");
    assert.deepEqual(result.reasonCodes, ["PREVIEW_DEADLINE_EXCEEDED"]);
    releaseMaster();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(harness.calls.searches.length, 0);
    assert.equal(harness.calls.risks.length, 0);
    assert.equal(completions.length, 1);
  } finally {
    logger.info = originalInfo;
  }
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
