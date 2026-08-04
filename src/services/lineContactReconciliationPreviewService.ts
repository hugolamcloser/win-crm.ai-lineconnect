import crypto from "node:crypto";
import { z } from "zod";
import { resolveReconciliationFieldPolicy } from "../config/lineContactReconciliationFieldPolicy";
import { env } from "../config/env";
import { logger } from "../config/logger";
import {
  GhlReconciliationReadError,
  ghlReconciliationReadClient,
  type GhlReconciliationReadClient
} from "../integrations/ghlReconciliationReadClient";
import {
  countLineProfilesExactlyForTenant,
  getTenantIdsByLocationId,
  type ExactLineProfileCountResult
} from "./repository";
import {
  reconciliationRiskKeys,
  type GhlReconciliationContact,
  type LineIdentityTagState,
  type LineContactReconciliationPreviewRequest,
  type LineContactReconciliationPreviewResponse,
  type ReconciliationDecision,
  type ReconciliationReadStatus,
  type ReconciliationRiskKey,
  type TransferInventoryCounts
} from "../types/lineContactReconciliation";

const DEFAULT_PREVIEW_DEADLINE_MS = 8_000;
const emailSchema = z.string().email();
const e164PhonePattern = /^\+[1-9]\d{7,14}$/;
const supportedLineUserIdPattern = /^[Uu][0-9A-Fa-f]{32}$/;

type PreviewDependencies = {
  getTenantIdsByLocationId: (locationId: string) => Promise<string[]>;
  countLineProfilesExactlyForTenant: (
    tenantId: string,
    filter: { contactId: string } | { lineUserId: string }
  ) => Promise<ExactLineProfileCountResult>;
  readClient: GhlReconciliationReadClient;
  now: () => number;
  overallDeadlineMs: number;
  getPreviewKeySecret: () => string;
};

type TransferInventory = LineContactReconciliationPreviewResponse["transferInventory"];
type CustomFieldDefinitions = Awaited<
  ReturnType<Awaited<ReturnType<GhlReconciliationReadClient["openSession"]>>["getCustomFieldDefinitions"]>
>;
type ExactCountAssessment =
  | { kind: "ZERO" }
  | { kind: "ONE"; row: ExactLineProfileCountResult["rows"][number] }
  | { kind: "MULTIPLE" }
  | { kind: "INCONSISTENT" };

const lineIdentityTagPattern = /^line:([A-Za-z0-9_-]+)$/i;
const lineIdentityTagPrefixPattern = /^line:/i;

type LineIdentityTagAnalysis = {
  state: LineIdentityTagState;
  malformed: boolean;
};

function emptyRiskStatuses(status: ReconciliationReadStatus = "UNAVAILABLE"): Record<ReconciliationRiskKey, ReconciliationReadStatus> {
  return Object.fromEntries(reconciliationRiskKeys.map((key) => [key, status])) as Record<
    ReconciliationRiskKey,
    ReconciliationReadStatus
  >;
}

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function normalizePhone(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeComparableValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? stableSerialize(value) : undefined;
  }

  if (value && typeof value === "object") {
    return Object.keys(value as object).length > 0 ? stableSerialize(value) : undefined;
  }

  return undefined;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function buildPreviewKey(input: {
  locationId: string;
  currentContactId: string;
  source: string;
  email?: string;
  phone?: string;
}, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update("wincrm:line-contact-reconciliation-preview:v1\u0000")
    .update(stableSerialize([
      input.locationId,
      input.currentContactId,
      input.source,
      input.email ?? "",
      input.phone ?? ""
    ]))
    .digest("hex")
    .slice(0, 32);
}

function emptyInventoryCounts(): TransferInventoryCounts {
  return { masterOnly: null, candidateOnly: null, equal: null, conflicting: null };
}

function emptyTransferInventory(): TransferInventory {
  return {
    standardFields: emptyInventoryCounts(),
    customFields: emptyInventoryCounts(),
    candidateOnlyNonIdentityTags: null,
    protectedOrUnsupportedStandardFields: emptyInventoryCounts(),
    unclassifiedStandardFieldCount: null
  };
}

function assessExactCount(result: ExactLineProfileCountResult): ExactCountAssessment {
  if (!Number.isInteger(result.exactCount) || result.exactCount < 0 || !Array.isArray(result.rows)) {
    return { kind: "INCONSISTENT" };
  }

  if (result.exactCount === 0) {
    return result.rows.length === 0 ? { kind: "ZERO" } : { kind: "INCONSISTENT" };
  }

  if (result.exactCount === 1) {
    return result.rows.length === 1
      ? { kind: "ONE", row: result.rows[0] as ExactLineProfileCountResult["rows"][number] }
      : { kind: "INCONSISTENT" };
  }

  return { kind: "MULTIPLE" };
}

function countValueInventory(
  masterValues: Map<string, string | undefined>,
  candidateValues: Map<string, string | undefined>,
  excludedIds: Set<string> = new Set()
): TransferInventoryCounts {
  const counts = { masterOnly: 0, candidateOnly: 0, equal: 0, conflicting: 0 };

  for (const fieldId of new Set([...masterValues.keys(), ...candidateValues.keys()])) {
    if (excludedIds.has(fieldId)) {
      continue;
    }

    const masterValue = masterValues.get(fieldId);
    const candidateValue = candidateValues.get(fieldId);

    if (masterValue && !candidateValue) {
      counts.masterOnly += 1;
    } else if (!masterValue && candidateValue) {
      counts.candidateOnly += 1;
    } else if (masterValue && candidateValue && masterValue === candidateValue) {
      counts.equal += 1;
    } else if (masterValue && candidateValue) {
      counts.conflicting += 1;
    }
  }

  return counts;
}

function buildStandardFieldInventory(
  master: GhlReconciliationContact,
  candidate: GhlReconciliationContact
): TransferInventoryCounts {
  const masterValues = new Map(
    Object.entries(master.standardFields ?? {}).map(([key, value]) => [key, normalizeComparableValue(value)])
  );
  const candidateValues = new Map(
    Object.entries(candidate.standardFields ?? {}).map(([key, value]) => [key, normalizeComparableValue(value)])
  );
  return countValueInventory(masterValues, candidateValues);
}

function buildProtectedStandardFieldInventory(
  master: GhlReconciliationContact,
  candidate?: GhlReconciliationContact
): TransferInventoryCounts {
  const masterValues = new Map(
    Object.entries(master.protectedOrUnsupportedStandardFields ?? {})
      .map(([key, value]) => [key, normalizeComparableValue(value)] as const)
  );
  const candidateValues = new Map(
    Object.entries(candidate?.protectedOrUnsupportedStandardFields ?? {})
      .map(([key, value]) => [key, normalizeComparableValue(value)] as const)
  );
  return countValueInventory(masterValues, candidateValues);
}

function countUnclassifiedStandardFields(
  master: GhlReconciliationContact,
  candidate?: GhlReconciliationContact
): number {
  return (master.unclassifiedStandardFieldCount ?? 0) + (candidate?.unclassifiedStandardFieldCount ?? 0);
}

function canonicalizeSupportedLineUserId(value: string): string | undefined {
  const normalized = value.trim();

  if (!supportedLineUserIdPattern.test(normalized)) {
    return undefined;
  }

  return `U${normalized.slice(1).toLowerCase()}`;
}

function analyzeLineIdentityTags(tags: string[], lineUserId: string): LineIdentityTagAnalysis {
  const identityValues = new Set<string>();

  for (const tag of tags) {
    const normalizedTag = tag.trim();

    if (!lineIdentityTagPrefixPattern.test(normalizedTag)) {
      continue;
    }

    const match = lineIdentityTagPattern.exec(normalizedTag);
    const canonicalIdentity = match?.[1]
      ? canonicalizeSupportedLineUserId(match[1])
      : undefined;

    if (!canonicalIdentity) {
      return { state: "NOT_EVALUATED", malformed: true };
    }

    identityValues.add(canonicalIdentity);
  }

  if (identityValues.size === 0) {
    return { state: "NONE", malformed: false };
  }

  if (identityValues.size > 1) {
    return { state: "AMBIGUOUS", malformed: false };
  }

  const canonicalMappedIdentity = canonicalizeSupportedLineUserId(lineUserId);

  if (!canonicalMappedIdentity) {
    return { state: "NOT_EVALUATED", malformed: true };
  }

  return {
    state: identityValues.has(canonicalMappedIdentity) ? "MATCH" : "DIFFERENT",
    malformed: false
  };
}

function countCandidateOnlyNonIdentityTags(masterTags: string[], candidateTags: string[]): number {
  const nonIdentityTags = (tags: string[]): Set<string> => new Set(
    tags
      .map((tag) => tag.trim())
      .filter((tag) => tag && !lineIdentityTagPattern.test(tag))
      .map((tag) => tag.toLowerCase())
  );
  const master = nonIdentityTags(masterTags);
  return [...nonIdentityTags(candidateTags)].filter((tag) => !master.has(tag)).length;
}

function collectCustomFieldValues(
  fields: Array<{ id: string; value: unknown }>
): { malformed: boolean; values: Map<string, string | undefined> } {
  const values = new Map<string, string | undefined>();

  if (!Array.isArray(fields)) {
    return { malformed: true, values };
  }

  for (const field of fields) {
    if (!field || typeof field !== "object" || typeof field.id !== "string" || !field.id.trim()) {
      return { malformed: true, values };
    }

    const fieldId = field.id.trim();
    const normalizedValue = normalizeComparableValue(field.value);

    if (values.has(fieldId) && values.get(fieldId) !== normalizedValue) {
      return { malformed: true, values };
    }

    values.set(fieldId, normalizedValue);
  }

  return { malformed: false, values };
}

function contactMatchesIdentity(contact: GhlReconciliationContact, email?: string, phone?: string): boolean {
  return Boolean(
    (email && normalizeEmail(contact.email) === email) ||
    (phone && normalizePhone(contact.phone) === phone)
  );
}

function hasStandardIdentityConflict(
  master: GhlReconciliationContact,
  candidate: GhlReconciliationContact,
  email?: string,
  phone?: string
): boolean {
  const masterEmail = normalizeEmail(master.email);
  const candidateEmail = normalizeEmail(candidate.email);
  const masterPhone = normalizePhone(master.phone);
  const candidatePhone = normalizePhone(candidate.phone);

  return Boolean(
    (email && ((masterEmail && masterEmail !== email) || (candidateEmail && candidateEmail !== email))) ||
    (phone && ((masterPhone && masterPhone !== phone) || (candidatePhone && candidatePhone !== phone))) ||
    (masterEmail && candidateEmail && masterEmail !== candidateEmail) ||
    (masterPhone && candidatePhone && masterPhone !== candidatePhone)
  );
}

function errorToReadStatus(error: unknown): ReconciliationReadStatus {
  if (!(error instanceof GhlReconciliationReadError)) {
    return "UNAVAILABLE";
  }

  if (error.kind === "MISSING_SCOPE" || error.kind === "MALFORMED" || error.kind === "UNAVAILABLE") {
    return error.kind;
  }

  return "UNAVAILABLE";
}

function createResponse(input: {
  decision: ReconciliationDecision;
  reasonCodes: string[];
  previewKey: string;
  emailSupplied: boolean;
  phoneSupplied: boolean;
  currentContactMatchesMapping?: boolean | null;
  distinctCandidateCount?: number | null;
  riskStatuses?: Record<ReconciliationRiskKey, ReconciliationReadStatus>;
  fieldStatus?: ReconciliationReadStatus;
  lineIdentityConflict?: boolean | null;
  protectedBusinessConflict?: boolean | null;
  masterLineIdentityTagState?: LineIdentityTagState;
  candidateLineIdentityTagState?: LineIdentityTagState;
  transferInventory?: TransferInventory;
}): LineContactReconciliationPreviewResponse {
  const riskStatuses = input.riskStatuses ?? emptyRiskStatuses();

  return {
    decision: input.decision,
    reasonCodes: input.reasonCodes,
    previewKey: input.previewKey,
    readOnly: true,
    currentContactMatchesMapping: input.currentContactMatchesMapping ?? null,
    identity: {
      emailSupplied: input.emailSupplied,
      phoneSupplied: input.phoneSupplied
    },
    distinctCandidateCount: input.distinctCandidateCount ?? null,
    riskReadStatuses: { ...riskStatuses },
    associatedRecords: { ...riskStatuses },
    lineIdentityTags: {
      master: input.masterLineIdentityTagState ?? "NOT_EVALUATED",
      candidate: input.candidateLineIdentityTagState ?? "NOT_EVALUATED"
    },
    transferInventory: input.transferInventory ?? emptyTransferInventory(),
    fieldPolicy: {
      status: input.fieldStatus ?? "UNAVAILABLE",
      lineIdentityConflict: input.lineIdentityConflict ?? null,
      protectedBusinessConflict: input.protectedBusinessConflict ?? null
    }
  };
}

function auditResult(response: LineContactReconciliationPreviewResponse): LineContactReconciliationPreviewResponse {
  return response;
}

function logCompletion(response: LineContactReconciliationPreviewResponse): LineContactReconciliationPreviewResponse {
  logger.info(
    {
      previewKey: response.previewKey,
      decision: response.decision,
      reasonCodes: response.reasonCodes,
      distinctCandidateCount: response.distinctCandidateCount,
      currentContactMatchesMapping: response.currentContactMatchesMapping
    },
    "Completed read-only LINE contact reconciliation preview"
  );
  return response;
}

function evaluateFieldPolicy(input: {
  master: GhlReconciliationContact;
  candidate: GhlReconciliationContact;
  definitions: CustomFieldDefinitions;
  configuredLineUserFieldId?: string;
  trustedLineUserId: string;
}): {
  status: ReconciliationReadStatus;
  lineIdentityConflict: boolean;
  lineIdentityReasonCodes: string[];
  protectedBusinessConflict: boolean;
  inventory: TransferInventoryCounts;
} {
  const masterCollection = collectCustomFieldValues(input.master.customFields);
  const candidateCollection = collectCustomFieldValues(input.candidate.customFields);

  if (masterCollection.malformed || candidateCollection.malformed) {
    return {
      status: "MALFORMED",
      lineIdentityConflict: false,
      lineIdentityReasonCodes: [],
      protectedBusinessConflict: false,
      inventory: emptyInventoryCounts()
    };
  }

  let policy;

  try {
    policy = resolveReconciliationFieldPolicy(input.definitions, input.configuredLineUserFieldId);
  } catch {
    return {
      status: "MALFORMED",
      lineIdentityConflict: false,
      lineIdentityReasonCodes: [],
      protectedBusinessConflict: false,
      inventory: emptyInventoryCounts()
    };
  }

  const definedIds = new Set(input.definitions.map((definition) => definition.id));
  const masterValues = masterCollection.values;
  const candidateValues = candidateCollection.values;
  const presentIds = new Set([...masterValues.keys(), ...candidateValues.keys()]);

  if ([...presentIds].some((fieldId) => !definedIds.has(fieldId))) {
    return {
      status: "MALFORMED",
      lineIdentityConflict: false,
      lineIdentityReasonCodes: [],
      protectedBusinessConflict: false,
      inventory: emptyInventoryCounts()
    };
  }

  const masterLineIdentityValues = [...policy.lineIdentityFieldIds]
    .map((fieldId) => masterValues.get(fieldId))
    .filter((value): value is string => Boolean(value));
  const candidateLineIdentityValues = [...policy.lineIdentityFieldIds]
    .map((fieldId) => candidateValues.get(fieldId))
    .filter((value): value is string => Boolean(value));
  const masterLineIdentityWrong = masterLineIdentityValues.some((value) => value !== input.trustedLineUserId);
  const candidateLineIdentityWrong = candidateLineIdentityValues.some((value) => value !== input.trustedLineUserId);
  const lineIdentityValuesConflict = new Set([
    ...masterLineIdentityValues,
    ...candidateLineIdentityValues
  ]).size > 1;
  const lineIdentityReasonCodes = [
    ...(masterLineIdentityWrong ? ["MAPPED_CONTACT_LINE_FIELD_DIFFERENT_USER"] : []),
    ...(candidateLineIdentityWrong ? ["CANDIDATE_LINE_FIELD_DIFFERENT_USER"] : []),
    ...(lineIdentityValuesConflict ? ["LINE_IDENTITY_FIELDS_CONFLICT"] : [])
  ];
  const lineIdentityConflict = lineIdentityReasonCodes.length > 0;
  let protectedBusinessConflict = false;

  for (const fieldId of presentIds) {
    const masterValue = masterValues.get(fieldId);
    const candidateValue = candidateValues.get(fieldId);

    if (!masterValue || !candidateValue || masterValue === candidateValue || policy.ignoredFieldIds.has(fieldId)) {
      continue;
    }

    if (policy.protectedBusinessFieldIds.has(fieldId)) {
      protectedBusinessConflict = true;
    }
  }

  return {
    status: lineIdentityConflict || protectedBusinessConflict ? "FOUND" : "CLEAR",
    lineIdentityConflict,
    lineIdentityReasonCodes,
    protectedBusinessConflict,
    inventory: countValueInventory(masterValues, candidateValues, policy.ignoredFieldIds)
  };
}

function evaluateMappedMasterLineIdentityFields(input: {
  master: GhlReconciliationContact;
  definitions: CustomFieldDefinitions;
  configuredLineUserFieldId?: string;
  trustedLineUserId: string;
}): {
  status: ReconciliationReadStatus;
  lineIdentityConflict: boolean;
} {
  const masterCollection = collectCustomFieldValues(input.master.customFields);

  if (masterCollection.malformed) {
    return { status: "MALFORMED", lineIdentityConflict: false };
  }

  let policy;

  try {
    policy = resolveReconciliationFieldPolicy(input.definitions, input.configuredLineUserFieldId);
  } catch {
    return { status: "MALFORMED", lineIdentityConflict: false };
  }

  const definedIds = new Set(input.definitions.map((definition) => definition.id));

  if ([...masterCollection.values.keys()].some((fieldId) => !definedIds.has(fieldId))) {
    return { status: "MALFORMED", lineIdentityConflict: false };
  }

  const lineIdentityConflict = [...policy.lineIdentityFieldIds]
    .map((fieldId) => masterCollection.values.get(fieldId))
    .some((value) => Boolean(value) && value !== input.trustedLineUserId);

  return {
    status: lineIdentityConflict ? "FOUND" : "CLEAR",
    lineIdentityConflict
  };
}

export function createLineContactReconciliationPreviewService(
  overrides: Partial<PreviewDependencies> = {}
): (request: LineContactReconciliationPreviewRequest) => Promise<LineContactReconciliationPreviewResponse> {
  const dependencies: PreviewDependencies = {
    getTenantIdsByLocationId,
    countLineProfilesExactlyForTenant,
    readClient: ghlReconciliationReadClient,
    now: Date.now,
    overallDeadlineMs: DEFAULT_PREVIEW_DEADLINE_MS,
    getPreviewKeySecret: () => env.WEBHOOK_SHARED_SECRET,
    ...overrides
  };

  return async (request) => {
    const run = async (): Promise<LineContactReconciliationPreviewResponse> => {
    const locationId = request.locationId.trim();
    const currentContactId = request.currentContactId.trim();
    const source = request.source.trim().toLowerCase();
    const email = normalizeEmail(request.identity.email);
    const phone = normalizePhone(request.identity.phone);
    const previewKeySecret = dependencies.getPreviewKeySecret().trim();

    if (!previewKeySecret) {
      throw new Error("WEBHOOK_SHARED_SECRET is required for reconciliation Preview keys");
    }

    const previewKey = buildPreviewKey({ locationId, currentContactId, source, email, phone }, previewKeySecret);
    const responseBase = {
      previewKey,
      emailSupplied: Boolean(email),
      phoneSupplied: Boolean(phone)
    };

    if (source !== "line") {
      return auditResult(createResponse({
        ...responseBase,
        decision: "UNSUPPORTED_SOURCE",
        reasonCodes: ["SOURCE_MUST_BE_LINE"]
      }));
    }

    if (email && !emailSchema.safeParse(email).success) {
      return auditResult(createResponse({ ...responseBase, decision: "INVALID_EMAIL", reasonCodes: ["EMAIL_INVALID"] }));
    }

    if (phone && !e164PhonePattern.test(phone)) {
      return auditResult(createResponse({ ...responseBase, decision: "INVALID_PHONE", reasonCodes: ["PHONE_MUST_BE_E164"] }));
    }

    if (!email && !phone) {
      return auditResult(createResponse({ ...responseBase, decision: "NO_IDENTIFIER", reasonCodes: ["NO_IDENTITY_SIGNAL"] }));
    }

    const deadlineAt = dependencies.now() + dependencies.overallDeadlineMs;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let deadlineReached = false;
    const deadlineResult = (): LineContactReconciliationPreviewResponse => auditResult(createResponse({
      ...responseBase,
      decision: "MANUAL_COMPLEX",
      reasonCodes: ["PREVIEW_DEADLINE_EXCEEDED"]
    }));
    const canStartGhlRead = (): boolean => !deadlineReached && dependencies.now() < deadlineAt;
    const deadlineResponse = new Promise<LineContactReconciliationPreviewResponse>((resolve) => {
      timeoutHandle = setTimeout(() => {
        deadlineReached = true;
        resolve(deadlineResult());
      }, dependencies.overallDeadlineMs);
    });

    const execute = async (): Promise<LineContactReconciliationPreviewResponse> => {
      try {
        const tenantIds = [...new Set((await dependencies.getTenantIdsByLocationId(locationId)).map((id) => id.trim()).filter(Boolean))];

        if (tenantIds.length === 0) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MAPPING_NOT_FOUND",
            reasonCodes: ["LOCATION_NOT_ONBOARDED"]
          }));
        }

        if (tenantIds.length > 1) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "CROSS_TENANT_BLOCKED",
            reasonCodes: ["LOCATION_HAS_MULTIPLE_TENANTS"]
          }));
        }

        const tenantId = tenantIds[0] as string;
        const contactMapping = await dependencies.countLineProfilesExactlyForTenant(tenantId, { contactId: currentContactId });
        const contactMappingAssessment = assessExactCount(contactMapping);

        if (contactMappingAssessment.kind === "ZERO") {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MAPPING_NOT_FOUND",
            reasonCodes: ["CONTACT_MAPPING_NOT_FOUND"],
            currentContactMatchesMapping: false
          }));
        }

        if (contactMappingAssessment.kind === "MULTIPLE") {
          return auditResult(createResponse({
            ...responseBase,
            decision: "AMBIGUOUS",
            reasonCodes: ["CONTACT_MAPPING_AMBIGUOUS"],
            currentContactMatchesMapping: null
          }));
        }

        if (contactMappingAssessment.kind === "INCONSISTENT") {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes: ["CONTACT_MAPPING_COUNT_INCONSISTENT"],
            currentContactMatchesMapping: null
          }));
        }

        const mappedProfile = contactMappingAssessment.row;
        const lineUserId = mappedProfile?.line_user_id?.trim();

        if (!mappedProfile || !lineUserId) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MAPPING_NOT_FOUND",
            reasonCodes: ["LINE_USER_MAPPING_MISSING"],
            currentContactMatchesMapping: false
          }));
        }

        const lineMapping = await dependencies.countLineProfilesExactlyForTenant(tenantId, { lineUserId });
        const lineMappingAssessment = assessExactCount(lineMapping);

        if (lineMappingAssessment.kind === "ZERO") {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MAPPING_NOT_FOUND",
            reasonCodes: ["LINE_USER_MAPPING_NOT_FOUND"],
            currentContactMatchesMapping: false
          }));
        }

        if (lineMappingAssessment.kind === "MULTIPLE") {
          return auditResult(createResponse({
            ...responseBase,
            decision: "AMBIGUOUS",
            reasonCodes: ["LINE_USER_MAPPING_AMBIGUOUS"],
            currentContactMatchesMapping: null
          }));
        }

        if (lineMappingAssessment.kind === "INCONSISTENT") {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes: ["LINE_USER_MAPPING_COUNT_INCONSISTENT"],
            currentContactMatchesMapping: null
          }));
        }

        const lineMappedProfile = lineMappingAssessment.row;
        const mappingMatches = Boolean(
          lineMappedProfile &&
          lineMappedProfile.id === mappedProfile.id &&
          lineMappedProfile.ghl_contact_id?.trim() === currentContactId
        );

        if (!mappingMatches) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MAPPING_CONTACT_MISMATCH",
            reasonCodes: ["CURRENT_CONTACT_DOES_NOT_MATCH_MAPPING"],
            currentContactMatchesMapping: false
          }));
        }

        let session;

        if (!canStartGhlRead()) {
          return deadlineResult();
        }

        try {
          session = await dependencies.readClient.openSession(locationId, tenantId, deadlineAt);
        } catch (error) {
          const isCrossTenant = error instanceof GhlReconciliationReadError && error.kind === "CROSS_TENANT";
          return auditResult(createResponse({
            ...responseBase,
            decision: isCrossTenant ? "CROSS_TENANT_BLOCKED" : "MANUAL_COMPLEX",
            reasonCodes: [isCrossTenant ? "OAUTH_TENANT_MISMATCH" : "GHL_READ_SESSION_UNAVAILABLE"],
            currentContactMatchesMapping: true
          }));
        }

        let master: GhlReconciliationContact;

        if (!canStartGhlRead()) {
          return deadlineResult();
        }

        try {
          master = await session.getContact(currentContactId, deadlineAt);
        } catch (error) {
          if (error instanceof GhlReconciliationReadError && error.kind === "NOT_FOUND") {
            return auditResult(createResponse({
              ...responseBase,
              decision: "MAPPING_NOT_FOUND",
              reasonCodes: ["MAPPED_GHL_CONTACT_NOT_FOUND"],
              currentContactMatchesMapping: true
            }));
          }

          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes: [`MAPPED_CONTACT_${errorToReadStatus(error)}`],
            currentContactMatchesMapping: true
          }));
        }

        if (!master.locationId || master.locationId !== locationId || master.id !== currentContactId) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "CROSS_TENANT_BLOCKED",
            reasonCodes: ["MAPPED_CONTACT_LOCATION_MISMATCH"],
            currentContactMatchesMapping: true
          }));
        }

        const masterLineIdentityTagAnalysis = analyzeLineIdentityTags(master.tags, lineUserId);

        if (masterLineIdentityTagAnalysis.malformed) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes: ["MAPPED_CONTACT_LINE_IDENTITY_TAG_MALFORMED"],
            currentContactMatchesMapping: true
          }));
        }

        const masterLineIdentityTagState = masterLineIdentityTagAnalysis.state;

        if (masterLineIdentityTagState === "AMBIGUOUS") {
          return auditResult(createResponse({
            ...responseBase,
            decision: "AMBIGUOUS",
            reasonCodes: ["MAPPED_CONTACT_LINE_IDENTITY_TAGS_AMBIGUOUS"],
            currentContactMatchesMapping: true,
            masterLineIdentityTagState
          }));
        }

        if (masterLineIdentityTagState === "DIFFERENT") {
          return auditResult(createResponse({
            ...responseBase,
            decision: "IDENTITY_CONFLICT",
            reasonCodes: ["MAPPED_CONTACT_LINE_TAG_DIFFERENT_USER"],
            currentContactMatchesMapping: true,
            masterLineIdentityTagState
          }));
        }

        let fieldDefinitions: CustomFieldDefinitions;

        if (!canStartGhlRead()) {
          return deadlineResult();
        }

        try {
          fieldDefinitions = await session.getCustomFieldDefinitions(deadlineAt);
        } catch (error) {
          const fieldStatus = errorToReadStatus(error);
          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes: [`MAPPED_LINE_FIELD_METADATA_${fieldStatus}`],
            currentContactMatchesMapping: true,
            masterLineIdentityTagState,
            fieldStatus
          }));
        }

        const mappedMasterFieldEvaluation = evaluateMappedMasterLineIdentityFields({
          master,
          definitions: fieldDefinitions,
          configuredLineUserFieldId: env.GHL_LINE_USER_ID_FIELD_ID,
          trustedLineUserId: lineUserId
        });

        if (mappedMasterFieldEvaluation.status === "MALFORMED") {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes: ["MAPPED_LINE_FIELD_METADATA_MALFORMED"],
            currentContactMatchesMapping: true,
            masterLineIdentityTagState,
            fieldStatus: "MALFORMED"
          }));
        }

        let searchResults: GhlReconciliationContact[];

        if (!canStartGhlRead()) {
          return deadlineResult();
        }

        try {
          const searches = [
            ...(email ? [session.searchContacts("email", email, deadlineAt)] : []),
            ...(phone ? [session.searchContacts("phone", phone, deadlineAt)] : [])
          ];
          searchResults = (await Promise.all(searches)).flat();
        } catch (error) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes: [`CONTACT_SEARCH_${errorToReadStatus(error)}`],
            currentContactMatchesMapping: true,
            masterLineIdentityTagState
          }));
        }

        const exactMatches = new Map<string, GhlReconciliationContact>();

        for (const contact of searchResults) {
          if (contact.locationId && contact.locationId !== locationId) {
            return auditResult(createResponse({
              ...responseBase,
              decision: "CROSS_TENANT_BLOCKED",
              reasonCodes: ["SEARCH_RESULT_LOCATION_MISMATCH"],
              currentContactMatchesMapping: true,
              masterLineIdentityTagState
            }));
          }

          if (contactMatchesIdentity(contact, email, phone)) {
            exactMatches.set(contact.id, contact);
          }
        }

        const distinctMatches = [...exactMatches.values()].filter((contact) => contact.id !== currentContactId);

        if (distinctMatches.length > 1) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "AMBIGUOUS",
            reasonCodes: ["MULTIPLE_DISTINCT_CANDIDATES"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: distinctMatches.length,
            masterLineIdentityTagState
          }));
        }

        if (distinctMatches.length === 0) {
          const alreadyReconciled = exactMatches.has(currentContactId) || contactMatchesIdentity(master, email, phone);
          const transferInventory: TransferInventory = {
            ...emptyTransferInventory(),
            protectedOrUnsupportedStandardFields: buildProtectedStandardFieldInventory(master),
            unclassifiedStandardFieldCount: countUnclassifiedStandardFields(master)
          };

          if (mappedMasterFieldEvaluation.lineIdentityConflict) {
            return auditResult(createResponse({
              ...responseBase,
              decision: "IDENTITY_CONFLICT",
              reasonCodes: ["MAPPED_CONTACT_LINE_FIELD_DIFFERENT_USER"],
              currentContactMatchesMapping: true,
              distinctCandidateCount: 0,
              masterLineIdentityTagState,
              transferInventory,
              fieldStatus: "FOUND",
              lineIdentityConflict: true,
              protectedBusinessConflict: false
            }));
          }

          return auditResult(createResponse({
            ...responseBase,
            decision: alreadyReconciled ? "ALREADY_RECONCILED" : "NO_MATCH",
            reasonCodes: [alreadyReconciled ? "IDENTITY_ALREADY_ON_MAPPED_CONTACT" : "NO_DISTINCT_CANDIDATE"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 0,
            masterLineIdentityTagState,
            transferInventory,
            fieldStatus: "CLEAR",
            lineIdentityConflict: false,
            protectedBusinessConflict: false
          }));
        }

        let candidate: GhlReconciliationContact;

        if (!canStartGhlRead()) {
          return deadlineResult();
        }

        try {
          candidate = await session.getContact((distinctMatches[0] as GhlReconciliationContact).id, deadlineAt);
        } catch (error) {
          if (error instanceof GhlReconciliationReadError && error.kind === "NOT_FOUND") {
            return auditResult(createResponse({
              ...responseBase,
              decision: "MANUAL_COMPLEX",
              reasonCodes: ["CANDIDATE_DISAPPEARED"],
              currentContactMatchesMapping: true,
              distinctCandidateCount: 1,
              masterLineIdentityTagState
            }));
          }

          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes: [`CANDIDATE_CONTACT_${errorToReadStatus(error)}`],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            masterLineIdentityTagState
          }));
        }

        if (!candidate.locationId || candidate.locationId !== locationId || candidate.id === currentContactId) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "CROSS_TENANT_BLOCKED",
            reasonCodes: ["CANDIDATE_OWNERSHIP_MISMATCH"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            masterLineIdentityTagState
          }));
        }

        if (!contactMatchesIdentity(candidate, email, phone)) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes: ["CANDIDATE_DETAIL_IDENTITY_MISMATCH"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            masterLineIdentityTagState
          }));
        }

        const candidateLineIdentityTagAnalysis = analyzeLineIdentityTags(candidate.tags, lineUserId);
        const candidateLineIdentityTagState = candidateLineIdentityTagAnalysis.state;
        const protectedStandardFieldInventory = buildProtectedStandardFieldInventory(master, candidate);
        const transferInventory: TransferInventory = {
          standardFields: buildStandardFieldInventory(master, candidate),
          customFields: emptyInventoryCounts(),
          candidateOnlyNonIdentityTags: countCandidateOnlyNonIdentityTags(master.tags, candidate.tags),
          protectedOrUnsupportedStandardFields: protectedStandardFieldInventory,
          unclassifiedStandardFieldCount: countUnclassifiedStandardFields(master, candidate)
        };

        const candidateMapping = await dependencies.countLineProfilesExactlyForTenant(tenantId, {
          contactId: candidate.id
        });
        const candidateMappingAssessment = assessExactCount(candidateMapping);

        if (candidateMappingAssessment.kind === "MULTIPLE" || candidateMappingAssessment.kind === "INCONSISTENT") {
          return auditResult(createResponse({
            ...responseBase,
            decision: "AMBIGUOUS",
            reasonCodes: ["CANDIDATE_LINE_MAPPING_AMBIGUOUS"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            masterLineIdentityTagState,
            candidateLineIdentityTagState,
            transferInventory
          }));
        }

        if (candidateMappingAssessment.kind === "ONE") {
          const candidateMappedProfile = candidateMappingAssessment.row;
          const candidateMappedLineUserId = candidateMappedProfile?.line_user_id?.trim();

          if (!candidateMappedProfile || !candidateMappedLineUserId) {
            return auditResult(createResponse({
              ...responseBase,
              decision: "MANUAL_COMPLEX",
              reasonCodes: ["CANDIDATE_LINE_MAPPING_MALFORMED"],
              currentContactMatchesMapping: true,
              distinctCandidateCount: 1,
              masterLineIdentityTagState,
              candidateLineIdentityTagState,
              transferInventory
            }));
          }

          if (candidateMappedLineUserId !== lineUserId) {
            return auditResult(createResponse({
              ...responseBase,
              decision: "IDENTITY_CONFLICT",
              reasonCodes: ["CANDIDATE_MAPPED_TO_DIFFERENT_LINE_USER"],
              currentContactMatchesMapping: true,
              distinctCandidateCount: 1,
              masterLineIdentityTagState,
              candidateLineIdentityTagState,
              transferInventory
            }));
          }

          if (candidateMappedProfile.ghl_contact_id?.trim() !== candidate.id) {
            return auditResult(createResponse({
              ...responseBase,
              decision: "AMBIGUOUS",
              reasonCodes: ["CANDIDATE_LINE_MAPPING_AMBIGUOUS"],
              currentContactMatchesMapping: true,
              distinctCandidateCount: 1,
              masterLineIdentityTagState,
              candidateLineIdentityTagState,
              transferInventory
            }));
          }

          return auditResult(createResponse({
            ...responseBase,
            decision: "AMBIGUOUS",
            reasonCodes: ["SAME_LINE_USER_MAPPED_TO_MULTIPLE_CONTACTS"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            masterLineIdentityTagState,
            candidateLineIdentityTagState,
            transferInventory
          }));
        }

        if (candidateLineIdentityTagAnalysis.malformed) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes: ["CANDIDATE_LINE_IDENTITY_TAG_MALFORMED"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            masterLineIdentityTagState,
            transferInventory
          }));
        }

        if (candidateLineIdentityTagState === "AMBIGUOUS") {
          return auditResult(createResponse({
            ...responseBase,
            decision: "AMBIGUOUS",
            reasonCodes: ["CANDIDATE_LINE_IDENTITY_TAGS_AMBIGUOUS"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            masterLineIdentityTagState,
            candidateLineIdentityTagState,
            transferInventory
          }));
        }

        if (candidateLineIdentityTagState === "DIFFERENT") {
          return auditResult(createResponse({
            ...responseBase,
            decision: "IDENTITY_CONFLICT",
            reasonCodes: ["CANDIDATE_LINE_TAG_DIFFERENT_USER"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            masterLineIdentityTagState,
            candidateLineIdentityTagState,
            transferInventory
          }));
        }

        const fieldEvaluation = evaluateFieldPolicy({
          master,
          candidate,
          definitions: fieldDefinitions,
          configuredLineUserFieldId: env.GHL_LINE_USER_ID_FIELD_ID,
          trustedLineUserId: lineUserId
        });
        transferInventory.customFields = fieldEvaluation.inventory;
        const standardIdentityConflict = hasStandardIdentityConflict(master, candidate, email, phone);
        const identityConflict = standardIdentityConflict || fieldEvaluation.lineIdentityConflict;

        if (identityConflict) {
          const identityReasonCodes = [
            ...(standardIdentityConflict ? ["STANDARD_IDENTITY_CONFLICT"] : []),
            ...fieldEvaluation.lineIdentityReasonCodes
          ];
          return auditResult(createResponse({
            ...responseBase,
            decision: "IDENTITY_CONFLICT",
            reasonCodes: identityReasonCodes,
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            fieldStatus: fieldEvaluation.status,
            lineIdentityConflict: fieldEvaluation.lineIdentityConflict,
            protectedBusinessConflict: fieldEvaluation.protectedBusinessConflict,
            masterLineIdentityTagState,
            candidateLineIdentityTagState,
            transferInventory
          }));
        }

        if (fieldEvaluation.status !== "CLEAR" || fieldEvaluation.protectedBusinessConflict) {
          const reasonCodes = [
            ...(fieldEvaluation.protectedBusinessConflict ? ["PROTECTED_BUSINESS_FIELD_CONFLICT"] : []),
            ...(fieldEvaluation.status !== "CLEAR" && !fieldEvaluation.protectedBusinessConflict
              ? [`FIELD_POLICY_${fieldEvaluation.status}`]
              : [])
          ];
          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes,
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            fieldStatus: fieldEvaluation.status,
            lineIdentityConflict: false,
            protectedBusinessConflict: fieldEvaluation.protectedBusinessConflict,
            masterLineIdentityTagState,
            candidateLineIdentityTagState,
            transferInventory
          }));
        }

        if ((transferInventory.unclassifiedStandardFieldCount ?? 0) > 0) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes: ["UNCLASSIFIED_STANDARD_FIELD_PRESENT"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            fieldStatus: fieldEvaluation.status,
            lineIdentityConflict: false,
            protectedBusinessConflict: false,
            masterLineIdentityTagState,
            candidateLineIdentityTagState,
            transferInventory
          }));
        }

        const protectedStandardReasonCodes = [
          ...(protectedStandardFieldInventory.candidateOnly
            ? ["CANDIDATE_ONLY_PROTECTED_STANDARD_FIELD"]
            : []),
          ...(protectedStandardFieldInventory.conflicting
            ? ["CONFLICTING_PROTECTED_STANDARD_FIELD"]
            : [])
        ];

        if (protectedStandardReasonCodes.length > 0) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes: protectedStandardReasonCodes,
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            fieldStatus: fieldEvaluation.status,
            lineIdentityConflict: false,
            protectedBusinessConflict: false,
            masterLineIdentityTagState,
            candidateLineIdentityTagState,
            transferInventory
          }));
        }

        if (!canStartGhlRead()) {
          return deadlineResult();
        }

        const riskPromises = reconciliationRiskKeys.map(async (risk) => [
          risk,
          await session.checkAssociatedRecords(risk, candidate.id, deadlineAt)
        ] as const);
        const riskResults = await Promise.allSettled(riskPromises);
        const riskStatuses = emptyRiskStatuses();

        for (const riskResult of riskResults) {
          if (riskResult.status === "fulfilled") {
            const [risk, status] = riskResult.value as readonly [ReconciliationRiskKey, ReconciliationReadStatus];
            riskStatuses[risk] = status;
          }
        }

        const nonClearRisks = reconciliationRiskKeys.filter((risk) => riskStatuses[risk] !== "CLEAR");

        if (nonClearRisks.length > 0) {
          const reasonCodes = nonClearRisks.map((risk) => `${risk.toUpperCase()}_${riskStatuses[risk]}`);
          return auditResult(createResponse({
            ...responseBase,
            decision: "MANUAL_COMPLEX",
            reasonCodes,
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            riskStatuses,
            fieldStatus: fieldEvaluation.status,
            lineIdentityConflict: false,
            protectedBusinessConflict: fieldEvaluation.protectedBusinessConflict,
            masterLineIdentityTagState,
            candidateLineIdentityTagState,
            transferInventory
          }));
        }

        return auditResult(createResponse({
          ...responseBase,
          decision: "AUTO_SIMPLE",
          reasonCodes: ["READ_ONLY_PREVIEW_CLEAR"],
          currentContactMatchesMapping: true,
          distinctCandidateCount: 1,
          riskStatuses,
          fieldStatus: "CLEAR",
          lineIdentityConflict: false,
          protectedBusinessConflict: false,
          masterLineIdentityTagState,
          candidateLineIdentityTagState,
          transferInventory
        }));
      } catch {
        return auditResult(createResponse({
          ...responseBase,
          decision: "MANUAL_COMPLEX",
          reasonCodes: ["READ_ONLY_PREVIEW_UNAVAILABLE"]
        }));
      }
    };

    try {
      return await Promise.race([execute(), deadlineResponse]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
    };

    return logCompletion(await run());
  };
}

export const previewLineContactReconciliation = createLineContactReconciliationPreviewService();
