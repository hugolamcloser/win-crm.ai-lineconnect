const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CONTACT_RECONCILIATION_DRY_RUN_AUTHORIZATION_TTL_MS,
  createLineContactReconciliationApplyDryRunService
} = require("../dist/services/lineContactReconciliationApplyDryRunService");
const {
  buildContactReconciliationSemanticSnapshot
} = require("../dist/services/contactReconciliationSemanticSnapshot");
const {
  buildContactReconciliationTransferPlan
} = require("../dist/services/contactReconciliationTransferPlan");

const operationId = "11111111-1111-4111-8111-111111111111";
const tenantId = "tenant-test";
const locationId = "location-test";
const masterContactId = "contact-master";
const candidateContactId = "contact-candidate";
const lineUserId = `U${"a".repeat(32)}`;
const email = "dry-run-person@example.com";
const secret = "dry-run-test-server-secret";
const previewKey = "a".repeat(32);

const riskStatuses = {
  conversations: "CLEAR",
  notes: "CLEAR",
  tasks: "CLEAR",
  opportunities: "CLEAR",
  appointments: "CLEAR",
  orders: "CLEAR",
  transactions: "CLEAR",
  invoices: "CLEAR"
};

function response(overrides = {}) {
  return {
    decision: "AUTO_SIMPLE",
    reasonCodes: ["READ_ONLY_PREVIEW_CLEAR"],
    previewKey,
    readOnly: true,
    currentContactMatchesMapping: true,
    identity: { emailSupplied: true, phoneSupplied: false },
    distinctCandidateCount: 1,
    riskReadStatuses: { ...riskStatuses },
    associatedRecords: { ...riskStatuses },
    lineIdentityTags: { master: "MATCH", candidate: "NONE" },
    transferInventory: {
      standardFields: { masterOnly: 1, candidateOnly: 2, equal: 0, conflicting: 0 },
      customFields: { masterOnly: 0, candidateOnly: 0, equal: 0, conflicting: 0 },
      candidateOnlyNonIdentityTags: 1,
      protectedOrUnsupportedStandardFields: { masterOnly: 0, candidateOnly: 0, equal: 0, conflicting: 0 },
      unclassifiedStandardFieldCount: 0
    },
    fieldPolicy: { status: "CLEAR", lineIdentityConflict: false, protectedBusinessConflict: false },
    ...overrides
  };
}

function contact(id, overrides = {}) {
  const result = {
    id,
    locationId,
    tags: [],
    customFields: [],
    standardFields: {},
    protectedOrUnsupportedStandardFields: {},
    unclassifiedStandardFieldCount: 0,
    ...overrides
  };
  return result;
}

function context(overrides = {}) {
  const master = overrides.master ?? contact(masterContactId, {
    tags: ["line", `line:${lineUserId}`, "master-tag"],
    standardFields: { firstName: "Master" }
  });
  const candidate = overrides.candidate ?? contact(candidateContactId, {
    email,
    tags: ["candidate-tag"],
    standardFields: { email, lastName: "Candidate" }
  });

  return {
    tenantId,
    locationId,
    currentContactId: masterContactId,
    lineUserId,
    mappedProfile: {
      id: "profile-test",
      tenant_id: tenantId,
      line_user_id: lineUserId,
      line_source_type: "user",
      line_source_id: lineUserId,
      display_name: null,
      picture_url: null,
      ghl_contact_id: masterContactId,
      ghl_conversation_id: "conversation-test",
      line_channel_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    },
    master,
    candidate,
    fieldDefinitions: overrides.fieldDefinitions ?? [],
    configuredLineUserFieldId: overrides.configuredLineUserFieldId,
    identity: { email },
    response: overrides.response ?? response(),
    ...overrides,
    master,
    candidate
  };
}

function createMemoryRepository() {
  let operation;
  const calls = { creates: [], claims: 0, revalidations: 0, finalizations: [], expirations: 0, events: [] };

  return {
    calls,
    get operation() { return operation; },
    repository: {
      async createPlanned(input) {
        calls.events.push("create");
        if (operation && ["PLANNED", "LOCKED", "REVALIDATED"].includes(operation.state)) {
          throw new Error("An active reconciliation operation already exists for this pair");
        }
        calls.creates.push(input);
        operation = {
          id: operationId,
          tenant_id: input.tenantId,
          location_id: input.locationId,
          master_contact_id: input.masterContactId,
          candidate_contact_id: input.candidateContactId,
          identity_type: input.identityType,
          line_identity_fingerprint: input.lineIdentityFingerprint,
          reconciliation_identity_fingerprint: input.reconciliationIdentityFingerprint,
          preview_key_fingerprint: input.previewKeyFingerprint,
          authorization_token_fingerprint: input.authorizationTokenFingerprint,
          authorization_binding_fingerprint: input.authorizationBindingFingerprint,
          mapping_snapshot_fingerprint: input.mappingSnapshotFingerprint,
          master_snapshot_fingerprint: input.masterSnapshotFingerprint,
          candidate_snapshot_fingerprint: input.candidateSnapshotFingerprint,
          field_policy_fingerprint: input.fieldPolicyFingerprint,
          initial_semantic_fingerprint: input.initialSemanticFingerprint,
          revalidated_semantic_fingerprint: null,
          transfer_plan_fingerprint: null,
          transfer_plan_summary: null,
          state: "PLANNED",
          result_decision: null,
          reason_codes: [],
          authorization_consumed_at: null,
          locked_at: null,
          revalidated_at: null,
          finalized_at: null,
          expires_at: input.expiresAt,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z"
        };
        return operation;
      },
      async getById(id) {
        calls.events.push("get");
        return operation?.id === id ? operation : null;
      },
      async claim(input) {
        calls.events.push("claim");
        calls.claims += 1;
        if (!operation || operation.state !== "PLANNED") return false;
        if (
          input.operationId !== operation.id ||
          input.tenantId !== operation.tenant_id ||
          input.locationId !== operation.location_id ||
          input.masterContactId !== operation.master_contact_id ||
          input.candidateContactId !== operation.candidate_contact_id ||
          input.authorizationTokenFingerprint !== operation.authorization_token_fingerprint ||
          input.authorizationBindingFingerprint !== operation.authorization_binding_fingerprint
        ) return false;
        operation.state = "LOCKED";
        operation.authorization_consumed_at = "2026-01-01T00:00:01.000Z";
        operation.locked_at = "2026-01-01T00:00:01.000Z";
        return true;
      },
      async markRevalidated(input) {
        calls.events.push("mark-revalidated");
        calls.revalidations += 1;
        if (!operation || operation.state !== "LOCKED") return false;
        operation.state = "REVALIDATED";
        operation.revalidated_semantic_fingerprint = input.semanticFingerprint;
        operation.revalidated_at = "2026-01-01T00:00:02.000Z";
        return true;
      },
      async finalize(input) {
        calls.events.push(`finalize:${input.state}`);
        calls.finalizations.push(input);
        if (!operation || !["LOCKED", "REVALIDATED"].includes(operation.state)) return false;
        operation.state = input.state;
        operation.reason_codes = input.reasonCodes;
        operation.result_decision = input.resultDecision ?? null;
        operation.transfer_plan_fingerprint = input.transferPlanFingerprint ?? null;
        operation.transfer_plan_summary = input.transferPlanSummary ?? null;
        operation.finalized_at = "2026-01-01T00:00:03.000Z";
        return true;
      },
      async expire() {
        calls.events.push("expire");
        calls.expirations += 1;
        if (!operation || operation.state !== "PLANNED") return false;
        operation.state = "EXPIRED";
        return true;
      }
    }
  };
}

function harness(options = {}) {
  let now = options.now ?? Date.parse("2026-01-01T00:00:00.000Z");
  const memory = createMemoryRepository();
  const assessments = options.assessments ?? [
    { response: response(), context: context() },
    { response: response(), context: context() }
  ];
  const calls = { assessments: 0 };
  const service = createLineContactReconciliationApplyDryRunService({
    repository: memory.repository,
    now: () => now,
    randomToken: () => "authorization_token_value_0123456789abcdef",
    getSecret: () => secret,
    authorizationTtlMs: options.authorizationTtlMs ?? CONTACT_RECONCILIATION_DRY_RUN_AUTHORIZATION_TTL_MS,
    assess: async () => {
      memory.calls.events.push("assess");
      return assessments[calls.assessments++];
    }
  });
  const request = { locationId, currentContactId: masterContactId, source: "line", identity: { email } };

  return {
    service,
    memory,
    calls,
    request,
    advance(ms) { now += ms; }
  };
}

async function prepareAndExecute(h) {
  const authorization = await h.service.prepareAuthorization(h.request);
  const result = await h.service.execute({
    authorizationId: authorization.authorizationId,
    authorizationToken: authorization.authorizationToken,
    previewKey: authorization.previewKey,
    request: h.request
  });
  return { authorization, result };
}

test("dry-run authorization is one-time and a duplicate cannot create or execute a second operation", async () => {
  const h = harness();
  const { authorization, result } = await prepareAndExecute(h);
  assert.equal(result.result, "DRY_RUN_READY");
  assert.equal(h.memory.calls.creates.length, 1);
  assert.equal(h.memory.calls.claims, 1);

  const duplicate = await h.service.execute({
    authorizationId: authorization.authorizationId,
    authorizationToken: authorization.authorizationToken,
    previewKey: authorization.previewKey,
    request: h.request
  });
  assert.equal(duplicate.result, "FAILED_SAFE");
  assert.deepEqual(duplicate.reasonCodes, ["AUTHORIZATION_NOT_CONSUMABLE"]);
  assert.equal(h.memory.calls.claims, 1);
  assert.equal(h.calls.assessments, 2);
  assert.deepEqual(h.memory.calls.events.slice(0, 7), [
    "assess",
    "create",
    "get",
    "claim",
    "assess",
    "mark-revalidated",
    "finalize:DRY_RUN_READY"
  ]);
});

test("a duplicate active pair cannot create a second authorization operation", async () => {
  const h = harness();
  await h.service.prepareAuthorization(h.request);

  await assert.rejects(
    h.service.prepareAuthorization(h.request),
    /active reconciliation operation/i
  );
  assert.equal(h.memory.calls.creates.length, 1);
  assert.equal(h.memory.operation.state, "PLANNED");
});

test("expired authorization fails before lock or Preview revalidation", async () => {
  const h = harness({ authorizationTtlMs: 100 });
  const authorization = await h.service.prepareAuthorization(h.request);
  h.advance(101);
  const result = await h.service.execute({
    authorizationId: authorization.authorizationId,
    authorizationToken: authorization.authorizationToken,
    previewKey: authorization.previewKey,
    request: h.request
  });
  assert.equal(result.result, "EXPIRED");
  assert.equal(h.memory.calls.claims, 0);
  assert.equal(h.calls.assessments, 1);
  assert.equal(h.memory.calls.expirations, 1);
});

test("tenant/location/master/identity/preview authorization binding mismatches fail before claim", async () => {
  for (const mutate of [
    (value) => { value.request.locationId = "foreign-location"; },
    (value) => { value.request.currentContactId = "foreign-master"; },
    (value) => { value.request.identity.email = "foreign@example.com"; },
    (value) => { value.previewKey = "b".repeat(32); }
  ]) {
    const h = harness();
    const authorization = await h.service.prepareAuthorization(h.request);
    const input = {
      authorizationId: authorization.authorizationId,
      authorizationToken: authorization.authorizationToken,
      previewKey: authorization.previewKey,
      request: structuredClone(h.request)
    };
    mutate(input);
    const result = await h.service.execute(input);
    assert.equal(result.result, "FAILED_SAFE");
    assert.deepEqual(result.reasonCodes, ["AUTHORIZATION_BINDING_MISMATCH"]);
    assert.equal(h.memory.calls.claims, 0);
  }
});

test("exact mapped master and AUTO_SIMPLE remain required during locked revalidation", async () => {
  const noLongerAuto = response({
    decision: "MANUAL_COMPLEX",
    reasonCodes: ["MAPPED_CONTACT_UNAVAILABLE"],
    currentContactMatchesMapping: false
  });
  const h = harness({ assessments: [
    { response: response(), context: context() },
    { response: noLongerAuto }
  ] });
  const { result } = await prepareAndExecute(h);
  assert.equal(result.result, "FAILED_SAFE");
  assert.deepEqual(result.reasonCodes, ["PREVIEW_NO_LONGER_AUTO_SIMPLE"]);
  assert.equal(result.currentContactMatchesMapping, false);
  assert.equal(h.memory.operation.state, "FAILED_SAFE");
});

test("candidate is backend-derived and a changed derived candidate fails closed", async () => {
  const changed = context({ candidate: contact("different-derived-candidate", {
    email,
    standardFields: { email }
  }) });
  const h = harness({ assessments: [
    { response: response(), context: context() },
    { response: response(), context: changed }
  ] });
  const authorization = await h.service.prepareAuthorization(h.request);
  assert.equal("candidateContactId" in h.request, false);
  assert.equal(h.memory.calls.creates[0].candidateContactId, candidateContactId);
  const result = await h.service.execute({
    authorizationId: authorization.authorizationId,
    authorizationToken: authorization.authorizationToken,
    previewKey: authorization.previewKey,
    request: h.request
  });
  assert.equal(result.result, "FAILED_SAFE");
  assert.deepEqual(result.reasonCodes, ["DERIVED_CANDIDATE_CHANGED"]);
  assert.equal(result.sameCandidateConfirmed, false);
});

test("a cross-tenant or cross-location revalidation cannot reuse the locked pair", async () => {
  for (const changed of [
    context({ tenantId: "foreign-tenant" }),
    context({ locationId: "foreign-location" })
  ]) {
    const h = harness({ assessments: [
      { response: response(), context: context() },
      { response: response(), context: changed }
    ] });
    const { result } = await prepareAndExecute(h);
    assert.equal(result.result, "FAILED_SAFE");
    assert.deepEqual(result.reasonCodes, ["REVALIDATION_CONTEXT_CHANGED"]);
    assert.equal(result.sameCandidateConfirmed, false);
    assert.equal(h.memory.operation.state, "FAILED_SAFE");
  }
});

test("semantic business-state changes reject a stale authorization", async () => {
  const changed = context({ candidate: contact(candidateContactId, {
    email,
    standardFields: { email, firstName: "Changed" }
  }) });
  const h = harness({ assessments: [
    { response: response(), context: context() },
    { response: response(), context: changed }
  ] });
  const { result } = await prepareAndExecute(h);
  assert.equal(result.result, "FAILED_SAFE");
  assert.deepEqual(result.reasonCodes, ["STALE_SEMANTIC_STATE"]);
  assert.equal(result.sameCandidateConfirmed, true);
  assert.equal(result.semanticStateMatches, false);
});

test("unstable raw transport metadata and ordering do not create false stale detection", async () => {
  const first = context();
  first.master.updatedAt = "unstable-first";
  first.candidate.transportMetadata = { requestId: "one" };
  first.candidate.tags = ["master-independent", "candidate-tag"];
  const second = context();
  second.master.updatedAt = "unstable-second";
  second.candidate.transportMetadata = { requestId: "two" };
  second.candidate.tags = ["candidate-tag", "master-independent"];
  const h = harness({ assessments: [
    { response: response(), context: first },
    { response: response(), context: second }
  ] });
  const { result } = await prepareAndExecute(h);
  assert.equal(result.result, "DRY_RUN_READY");
  assert.equal(result.semanticStateMatches, true);
});

test("unused unrelated custom-field metadata does not create false stale detection", async () => {
  const first = context({ fieldDefinitions: [] });
  const second = context({
    fieldDefinitions: [{ id: "unused-field", name: "Unused", fieldKey: "contact.unused", model: "contact" }]
  });
  const h = harness({ assessments: [
    { response: response(), context: first },
    { response: response(), context: second }
  ] });
  const { result } = await prepareAndExecute(h);
  assert.equal(result.result, "DRY_RUN_READY");
  assert.equal(result.semanticStateMatches, true);
});

test("canonical snapshots are stable across field, tag, definition, object, and array ordering", () => {
  const left = context({
    fieldDefinitions: [
      { id: "field-b", name: "B", fieldKey: "contact.b", model: "contact" },
      { id: "field-a", name: "A", fieldKey: "contact.a", model: "contact" }
    ],
    candidate: contact(candidateContactId, {
      email,
      tags: ["B", "a"],
      customFields: [{ id: "field-b", value: ["two", "one"] }, { id: "field-a", value: { y: 2, x: 1 } }],
      standardFields: { email, firstName: "Candidate" }
    })
  });
  const right = context({
    fieldDefinitions: [...left.fieldDefinitions].reverse(),
    candidate: contact(candidateContactId, {
      email,
      tags: ["a", "b"],
      customFields: [{ id: "field-a", value: { x: 1, y: 2 } }, { id: "field-b", value: ["one", "two"] }],
      standardFields: { firstName: "Candidate", email }
    })
  });
  assert.deepEqual(
    buildContactReconciliationSemanticSnapshot(left, secret),
    buildContactReconciliationSemanticSnapshot(right, secret)
  );
});

test("equal duplicate custom-field values canonicalize to one semantic value", () => {
  const fieldDefinitions = [{ id: "field-a", name: "A", fieldKey: "contact.a", model: "contact" }];
  const once = context({
    fieldDefinitions,
    candidate: contact(candidateContactId, {
      email,
      customFields: [{ id: "field-a", value: "same" }],
      standardFields: { email }
    })
  });
  const duplicated = context({
    fieldDefinitions,
    candidate: contact(candidateContactId, {
      email,
      customFields: [{ id: "field-a", value: "same" }, { id: "field-a", value: "same" }],
      standardFields: { email }
    })
  });

  assert.deepEqual(
    buildContactReconciliationSemanticSnapshot(once, secret),
    buildContactReconciliationSemanticSnapshot(duplicated, secret)
  );
});

test("transfer plan excludes LINE identity and ignored fields and returns sanitized counts only", () => {
  const lineFieldId = "line-field";
  const ignoredFieldId = "ai-field";
  const businessFieldId = "business-field";
  const value = "private-custom-value";
  const c = context({
    fieldDefinitions: [
      { id: lineFieldId, name: "LINE ID", fieldKey: "contact.line_id", model: "contact" },
      { id: ignoredFieldId, name: "AI Event Command", fieldKey: "contact.ai_event_command", model: "contact" },
      { id: businessFieldId, name: "Business", fieldKey: "contact.business", model: "contact" }
    ],
    candidate: contact(candidateContactId, {
      email,
      tags: [`line:${lineUserId}`, "ordinary"],
      customFields: [
        { id: lineFieldId, value: lineUserId },
        { id: ignoredFieldId, value: "temporary" },
        { id: businessFieldId, value }
      ],
      standardFields: { email }
    })
  });
  const plan = buildContactReconciliationTransferPlan(c);
  assert.equal(plan.customFields.setOnMaster, 1);
  assert.equal(plan.lineIdentityValuesExcluded, 2);
  assert.equal(plan.ignoredTemporaryFieldsExcluded, 1);
  assert.equal(plan.ordinaryTagsToAdd, 1);
  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes(lineFieldId), false);
  assert.equal(serialized.includes(businessFieldId), false);
  assert.equal(serialized.includes(lineUserId), false);
  assert.equal(serialized.includes(value), false);
});

test("attributionSource, inboundDndSettings, conflicts, and unknown fields block the dry-run plan", () => {
  for (const candidate of [
    contact(candidateContactId, {
      email,
      standardFields: { email },
      protectedOrUnsupportedStandardFields: { attributionSource: "business-attribution" }
    }),
    contact(candidateContactId, {
      email,
      standardFields: { email },
      protectedOrUnsupportedStandardFields: { inboundDndSettings: { all: { status: "active" } } }
    }),
    contact(candidateContactId, {
      email,
      standardFields: { email, firstName: "Different" }
    }),
    contact(candidateContactId, {
      email,
      standardFields: { email },
      unclassifiedStandardFieldCount: 1
    })
  ]) {
    const master = candidate.standardFields.firstName
      ? contact(masterContactId, { standardFields: { firstName: "Master" } })
      : context().master;
    const plan = buildContactReconciliationTransferPlan(context({ master, candidate }));
    assert.equal(plan.executable, false);
    assert.ok(plan.blockerCodes.length > 0);
  }
});

test("different non-empty master Email or Phone is never overwritten", () => {
  const plan = buildContactReconciliationTransferPlan(context({
    master: contact(masterContactId, {
      email: "master@example.com",
      phone: "+12025550111",
      standardFields: { email: "master@example.com", phone: "+12025550111" }
    }),
    candidate: contact(candidateContactId, {
      email,
      phone: "+12025550112",
      standardFields: { email, phone: "+12025550112" }
    }),
    identity: { email, phone: "+12025550112" }
  }));
  assert.equal(plan.emailAction, "BLOCK_CONFLICT");
  assert.equal(plan.phoneAction, "BLOCK_CONFLICT");
  assert.equal(plan.executable, false);
});

test("operation persistence and response contain no raw Email, Phone, LINE ID, token, or GHL payload", async () => {
  const h = harness();
  const { authorization, result } = await prepareAndExecute(h);
  const persisted = JSON.stringify(h.memory.calls.creates[0]);
  const returned = JSON.stringify(result);
  for (const sensitive of [email, lineUserId, authorization.authorizationToken, "+12025550123"]) {
    assert.equal(persisted.includes(sensitive), false);
    assert.equal(returned.includes(sensitive), false);
  }
  assert.equal("rawPayload" in h.memory.calls.creates[0], false);
  assert.equal(result.readOnly, true);
});

test("dry-run service has no GHL/LINE/provider/workflow mutation dependency", async () => {
  const h = harness();
  const { result } = await prepareAndExecute(h);
  assert.equal(result.result, "DRY_RUN_READY");
  assert.deepEqual(Object.keys(h.memory.calls).sort(), [
    "claims",
    "creates",
    "events",
    "expirations",
    "finalizations",
    "revalidations"
  ]);
});
