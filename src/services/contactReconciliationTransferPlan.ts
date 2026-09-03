import { resolveReconciliationFieldPolicy } from "../config/lineContactReconciliationFieldPolicy";
import type {
  ContactReconciliationTransferPlanSummary,
  SanitizedTransferCounts,
  TransferAction
} from "../types/lineContactReconciliationApplyDryRun";
import type { LineContactReconciliationAutoSimpleContext } from "./lineContactReconciliationPreviewService";
import { stableSerialize } from "./contactReconciliationSemanticSnapshot";

const lineIdentityTagPrefixPattern = /^line:/i;

function normalizeValue(value: unknown): string | undefined {
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

function emptyCounts(): SanitizedTransferCounts {
  return { setOnMaster: 0, noOpEqual: 0, retainMaster: 0, blockedConflict: 0 };
}

function classifyAction(masterValue: string | undefined, candidateValue: string | undefined): TransferAction {
  if (!masterValue && !candidateValue) return "NONE";
  if (masterValue && !candidateValue) return "RETAIN_MASTER";
  if (!masterValue && candidateValue) return "SET_ON_MASTER";
  if (masterValue === candidateValue) return "NO_OP_EQUAL";
  return "BLOCK_CONFLICT";
}

function countRelationship(
  masterValues: Map<string, string | undefined>,
  candidateValues: Map<string, string | undefined>,
  excludedIds: Set<string> = new Set()
): SanitizedTransferCounts {
  const counts = emptyCounts();

  for (const key of new Set([...masterValues.keys(), ...candidateValues.keys()])) {
    if (excludedIds.has(key)) continue;

    switch (classifyAction(masterValues.get(key), candidateValues.get(key))) {
      case "SET_ON_MASTER":
        counts.setOnMaster += 1;
        break;
      case "NO_OP_EQUAL":
        counts.noOpEqual += 1;
        break;
      case "RETAIN_MASTER":
        counts.retainMaster += 1;
        break;
      case "BLOCK_CONFLICT":
        counts.blockedConflict += 1;
        break;
      case "NONE":
        break;
    }
  }

  return counts;
}

function collectCustomFields(fields: Array<{ id: string; value: unknown }>): Map<string, string | undefined> {
  const values = new Map<string, string | undefined>();

  for (const field of fields) {
    const fieldId = field.id.trim();
    const value = normalizeValue(field.value);

    if (!fieldId || (values.has(fieldId) && values.get(fieldId) !== value)) {
      throw new Error("Custom-field values were ambiguous while building a reconciliation transfer plan");
    }

    values.set(fieldId, value);
  }

  return values;
}

function fieldsToMap(fields: Record<string, unknown>, excludedKeys: Set<string> = new Set()): Map<string, string | undefined> {
  return new Map(
    Object.entries(fields)
      .map(([key, value]) => [key.trim().toLowerCase(), normalizeValue(value)] as const)
      .filter(([key]) => !excludedKeys.has(key))
  );
}

export function buildContactReconciliationTransferPlan(
  context: LineContactReconciliationAutoSimpleContext
): ContactReconciliationTransferPlanSummary {
  if (context.response.decision !== "AUTO_SIMPLE") {
    throw new Error("A reconciliation transfer plan requires AUTO_SIMPLE Preview evidence");
  }

  const policy = resolveReconciliationFieldPolicy(
    context.fieldDefinitions,
    context.configuredLineUserFieldId
  );
  const masterCustomFields = collectCustomFields(context.master.customFields);
  const candidateCustomFields = collectCustomFields(context.candidate.customFields);
  const customFields = countRelationship(masterCustomFields, candidateCustomFields, new Set([
    ...policy.lineIdentityFieldIds,
    ...policy.ignoredFieldIds
  ]));
  const emailAction = classifyAction(
    context.master.email?.trim().toLowerCase() || undefined,
    context.candidate.email?.trim().toLowerCase() || undefined
  );
  const phoneAction = classifyAction(
    context.master.phone?.trim() || undefined,
    context.candidate.phone?.trim() || undefined
  );
  const excludedStandardIdentityKeys = new Set(["email", "phone"]);
  const standardFields = countRelationship(
    fieldsToMap(context.master.standardFields, excludedStandardIdentityKeys),
    fieldsToMap(context.candidate.standardFields, excludedStandardIdentityKeys)
  );
  const protectedFields = countRelationship(
    fieldsToMap(context.master.protectedOrUnsupportedStandardFields),
    fieldsToMap(context.candidate.protectedOrUnsupportedStandardFields)
  );
  const masterOrdinaryTags = new Set(
    context.master.tags
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag && !lineIdentityTagPrefixPattern.test(tag))
  );
  const candidateOrdinaryTags = new Set(
    context.candidate.tags
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag && !lineIdentityTagPrefixPattern.test(tag))
  );
  const lineIdentityValuesExcluded = context.candidate.tags.filter((tag) => lineIdentityTagPrefixPattern.test(tag.trim())).length +
    [...policy.lineIdentityFieldIds].filter((fieldId) => Boolean(candidateCustomFields.get(fieldId))).length;
  const ignoredTemporaryFieldsExcluded = [...policy.ignoredFieldIds]
    .filter((fieldId) => Boolean(masterCustomFields.get(fieldId)) || Boolean(candidateCustomFields.get(fieldId)))
    .length;
  const blockerCodes = [
    ...(emailAction === "BLOCK_CONFLICT" ? ["EMAIL_CONFLICT"] : []),
    ...(phoneAction === "BLOCK_CONFLICT" ? ["PHONE_CONFLICT"] : []),
    ...(standardFields.blockedConflict > 0 ? ["CONFLICTING_TRANSFERABLE_STANDARD_FIELD"] : []),
    ...(customFields.blockedConflict > 0 ? ["CONFLICTING_CUSTOM_FIELD"] : []),
    ...(protectedFields.setOnMaster > 0 ? ["CANDIDATE_ONLY_PROTECTED_STANDARD_FIELD"] : []),
    ...(protectedFields.blockedConflict > 0 ? ["CONFLICTING_PROTECTED_STANDARD_FIELD"] : []),
    ...(context.master.unclassifiedStandardFieldCount + context.candidate.unclassifiedStandardFieldCount > 0
      ? ["UNCLASSIFIED_STANDARD_FIELD_PRESENT"]
      : [])
  ];

  return {
    executable: blockerCodes.length === 0,
    emailAction,
    phoneAction,
    standardFields,
    customFields,
    ordinaryTagsToAdd: [...candidateOrdinaryTags].filter((tag) => !masterOrdinaryTags.has(tag)).length,
    lineIdentityValuesExcluded,
    ignoredTemporaryFieldsExcluded,
    protectedCandidateOnlyBlockers: protectedFields.setOnMaster,
    protectedConflictingBlockers: protectedFields.blockedConflict,
    unclassifiedBlockers: context.master.unclassifiedStandardFieldCount + context.candidate.unclassifiedStandardFieldCount,
    blockerCodes
  };
}
