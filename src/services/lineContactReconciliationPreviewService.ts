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

const lineIdentityTagPattern = /^line:([A-Za-z0-9_-]+)$/i;

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
    candidateOnlyNonIdentityTags: null
  };
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

function analyzeLineIdentityTags(tags: string[], lineUserId: string): LineIdentityTagState {
  const identityValues = new Set(
    tags.flatMap((tag) => {
      const match = lineIdentityTagPattern.exec(tag.trim());
      return match?.[1] ? [match[1]] : [];
    })
  );

  if (identityValues.size === 0) {
    return "NONE";
  }

  if (identityValues.size > 1) {
    return "AMBIGUOUS";
  }

  return identityValues.has(lineUserId) ? "MATCH" : "DIFFERENT";
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
  definitions: Awaited<ReturnType<Awaited<ReturnType<GhlReconciliationReadClient["openSession"]>>["getCustomFieldDefinitions"]>>;
  configuredLineUserFieldId?: string;
}): {
  status: ReconciliationReadStatus;
  lineIdentityConflict: boolean;
  protectedBusinessConflict: boolean;
  inventory: TransferInventoryCounts;
} {
  const masterCollection = collectCustomFieldValues(input.master.customFields);
  const candidateCollection = collectCustomFieldValues(input.candidate.customFields);

  if (masterCollection.malformed || candidateCollection.malformed) {
    return {
      status: "MALFORMED",
      lineIdentityConflict: false,
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
      protectedBusinessConflict: false,
      inventory: emptyInventoryCounts()
    };
  }

  let lineIdentityConflict = false;
  let protectedBusinessConflict = false;

  for (const fieldId of presentIds) {
    const masterValue = masterValues.get(fieldId);
    const candidateValue = candidateValues.get(fieldId);

    if (!masterValue || !candidateValue || masterValue === candidateValue || policy.ignoredFieldIds.has(fieldId)) {
      continue;
    }

    if (policy.lineIdentityFieldIds.has(fieldId)) {
      lineIdentityConflict = true;
    } else if (policy.protectedBusinessFieldIds.has(fieldId)) {
      protectedBusinessConflict = true;
    }
  }

  return {
    status: lineIdentityConflict || protectedBusinessConflict ? "FOUND" : "CLEAR",
    lineIdentityConflict,
    protectedBusinessConflict,
    inventory: countValueInventory(masterValues, candidateValues, policy.ignoredFieldIds)
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

        if (contactMapping.exactCount === 0) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MAPPING_NOT_FOUND",
            reasonCodes: ["CONTACT_MAPPING_NOT_FOUND"],
            currentContactMatchesMapping: false
          }));
        }

        if (contactMapping.exactCount > 1 || contactMapping.rows.length !== 1) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "AMBIGUOUS",
            reasonCodes: ["CONTACT_MAPPING_AMBIGUOUS"],
            currentContactMatchesMapping: null
          }));
        }

        const mappedProfile = contactMapping.rows[0];
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

        if (lineMapping.exactCount === 0) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "MAPPING_NOT_FOUND",
            reasonCodes: ["LINE_USER_MAPPING_NOT_FOUND"],
            currentContactMatchesMapping: false
          }));
        }

        if (lineMapping.exactCount > 1 || lineMapping.rows.length !== 1) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "AMBIGUOUS",
            reasonCodes: ["LINE_USER_MAPPING_AMBIGUOUS"],
            currentContactMatchesMapping: null
          }));
        }

        const lineMappedProfile = lineMapping.rows[0];
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

        const masterLineIdentityTagState = analyzeLineIdentityTags(master.tags, lineUserId);

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
          return auditResult(createResponse({
            ...responseBase,
            decision: alreadyReconciled ? "ALREADY_RECONCILED" : "NO_MATCH",
            reasonCodes: [alreadyReconciled ? "IDENTITY_ALREADY_ON_MAPPED_CONTACT" : "NO_DISTINCT_CANDIDATE"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 0,
            masterLineIdentityTagState
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

        const candidateLineIdentityTagState = analyzeLineIdentityTags(candidate.tags, lineUserId);
        const transferInventory: TransferInventory = {
          standardFields: buildStandardFieldInventory(master, candidate),
          customFields: emptyInventoryCounts(),
          candidateOnlyNonIdentityTags: countCandidateOnlyNonIdentityTags(master.tags, candidate.tags)
        };
        const candidateMapping = await dependencies.countLineProfilesExactlyForTenant(tenantId, {
          contactId: candidate.id
        });

        if (candidateMapping.exactCount > 1 || candidateMapping.rows.length > 1) {
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

        if (candidateMapping.exactCount === 1) {
          const candidateMappedProfile = candidateMapping.rows[0];
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

          if (
            candidateMappedProfile.id !== mappedProfile.id ||
            candidateMappedProfile.ghl_contact_id?.trim() !== currentContactId
          ) {
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
            decision: "ALREADY_RECONCILED",
            reasonCodes: ["CANDIDATE_USES_CURRENT_LINE_MAPPING"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            masterLineIdentityTagState,
            candidateLineIdentityTagState,
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

        if (!canStartGhlRead()) {
          return deadlineResult();
        }

        const fieldPromise = session.getCustomFieldDefinitions(deadlineAt);
        const riskPromises = reconciliationRiskKeys.map(async (risk) => [
          risk,
          await session.checkAssociatedRecords(risk, candidate.id, deadlineAt)
        ] as const);
        const [fieldResult, ...riskResults] = await Promise.allSettled([fieldPromise, ...riskPromises]);
        const riskStatuses = emptyRiskStatuses();

        for (const riskResult of riskResults) {
          if (riskResult.status === "fulfilled") {
            const [risk, status] = riskResult.value as readonly [ReconciliationRiskKey, ReconciliationReadStatus];
            riskStatuses[risk] = status;
          }
        }

        const fieldEvaluation = fieldResult.status === "fulfilled"
          ? evaluateFieldPolicy({
              master,
              candidate,
              definitions: fieldResult.value,
              configuredLineUserFieldId: env.GHL_LINE_USER_ID_FIELD_ID
            })
          : {
              status: errorToReadStatus(fieldResult.reason),
              lineIdentityConflict: false,
              protectedBusinessConflict: false,
              inventory: emptyInventoryCounts()
            };
        transferInventory.customFields = fieldEvaluation.inventory;
        const standardIdentityConflict = hasStandardIdentityConflict(master, candidate, email, phone);
        const identityConflict = standardIdentityConflict || fieldEvaluation.lineIdentityConflict;

        if (identityConflict) {
          return auditResult(createResponse({
            ...responseBase,
            decision: "IDENTITY_CONFLICT",
            reasonCodes: [standardIdentityConflict ? "STANDARD_IDENTITY_CONFLICT" : "LINE_IDENTITY_FIELD_CONFLICT"],
            currentContactMatchesMapping: true,
            distinctCandidateCount: 1,
            riskStatuses,
            fieldStatus: fieldEvaluation.status,
            lineIdentityConflict: fieldEvaluation.lineIdentityConflict,
            protectedBusinessConflict: fieldEvaluation.protectedBusinessConflict,
            masterLineIdentityTagState,
            candidateLineIdentityTagState,
            transferInventory
          }));
        }

        const nonClearRisks = reconciliationRiskKeys.filter((risk) => riskStatuses[risk] !== "CLEAR");

        if (fieldEvaluation.status !== "CLEAR" || fieldEvaluation.protectedBusinessConflict || nonClearRisks.length > 0) {
          const reasonCodes = [
            ...(fieldEvaluation.protectedBusinessConflict ? ["PROTECTED_BUSINESS_FIELD_CONFLICT"] : []),
            ...(fieldEvaluation.status !== "CLEAR" && !fieldEvaluation.protectedBusinessConflict
              ? [`FIELD_POLICY_${fieldEvaluation.status}`]
              : []),
            ...nonClearRisks.map((risk) => `${risk.toUpperCase()}_${riskStatuses[risk]}`)
          ];
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
