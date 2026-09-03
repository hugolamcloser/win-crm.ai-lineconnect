import crypto from "node:crypto";
import { resolveReconciliationFieldPolicy } from "../config/lineContactReconciliationFieldPolicy";
import type { GhlReconciliationContact } from "../types/lineContactReconciliation";
import type { LineContactReconciliationAutoSimpleContext } from "./lineContactReconciliationPreviewService";

export type ContactReconciliationSemanticSnapshot = {
  mappingFingerprint: string;
  masterFingerprint: string;
  candidateFingerprint: string;
  fieldPolicyFingerprint: string;
  semanticFingerprint: string;
};

function normalizeSemanticValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map(normalizeSemanticValue)
      .sort((left, right) => stableSerialize(left).localeCompare(stableSerialize(right)));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeSemanticValue(entry)])
    );
  }

  return value;
}

export function stableSerialize(value: unknown): string {
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

export function reconciliationHmac(secret: string, domain: string, value: unknown): string {
  if (!secret.trim()) {
    throw new Error("A server secret is required for reconciliation fingerprints");
  }

  return crypto
    .createHmac("sha256", secret)
    .update(`wincrm:line-contact-reconciliation:${domain}:v1\u0000`)
    .update(stableSerialize(normalizeSemanticValue(value)))
    .digest("hex");
}

function normalizeContact(contact: GhlReconciliationContact): Record<string, unknown> {
  const normalizeFields = (fields: Record<string, unknown>): Array<[string, unknown]> =>
    Object.entries(fields)
      .map(([key, value]) => [key.trim().toLowerCase(), normalizeSemanticValue(value)] as [string, unknown])
      .sort(([left], [right]) => left.localeCompare(right));

  const customFieldValues = new Map<string, unknown>();
  for (const field of contact.customFields) {
    const fieldId = field.id.trim();
    const fieldValue = normalizeSemanticValue(field.value);

    if (!fieldId) {
      throw new Error("A semantic contact snapshot requires custom-field IDs");
    }

    if (
      customFieldValues.has(fieldId) &&
      stableSerialize(customFieldValues.get(fieldId)) !== stableSerialize(fieldValue)
    ) {
      throw new Error("A semantic contact snapshot cannot contain conflicting duplicate custom fields");
    }

    customFieldValues.set(fieldId, fieldValue);
  }

  const customFields = [...customFieldValues.entries()]
    .sort(([left], [right]) => left.localeCompare(right));

  const tags = [...new Set(contact.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();

  return {
    id: contact.id.trim(),
    locationId: contact.locationId?.trim() ?? "",
    transferableStandardFields: normalizeFields(contact.standardFields ?? {}),
    protectedOrUnsupportedStandardFields: normalizeFields(contact.protectedOrUnsupportedStandardFields ?? {}),
    unclassifiedStandardFieldCount: contact.unclassifiedStandardFieldCount,
    customFields,
    tags
  };
}

export function buildContactReconciliationSemanticSnapshot(
  context: LineContactReconciliationAutoSimpleContext,
  secret: string
): ContactReconciliationSemanticSnapshot {
  const fieldPolicy = resolveReconciliationFieldPolicy(
    context.fieldDefinitions,
    context.configuredLineUserFieldId
  );
  const relevantFieldIds = new Set([
    ...context.master.customFields.map((field) => field.id.trim()),
    ...context.candidate.customFields.map((field) => field.id.trim()),
    ...fieldPolicy.lineIdentityFieldIds,
    ...(context.configuredLineUserFieldId ? [context.configuredLineUserFieldId.trim()] : [])
  ]);
  const mappingFingerprint = reconciliationHmac(secret, "mapping-snapshot", {
    tenantId: context.tenantId,
    locationId: context.locationId,
    mappingId: context.mappedProfile.id,
    masterContactId: context.currentContactId,
    mappedContactId: context.mappedProfile.ghl_contact_id?.trim() ?? "",
    lineUserId: context.lineUserId,
    lineSourceType: context.mappedProfile.line_source_type,
    lineSourceId: context.mappedProfile.line_source_id,
    conversationId: context.mappedProfile.ghl_conversation_id?.trim() ?? ""
  });
  const masterFingerprint = reconciliationHmac(secret, "master-contact-snapshot", {
    contact: normalizeContact(context.master),
    lineIdentityTagState: context.response.lineIdentityTags.master
  });
  const candidateFingerprint = reconciliationHmac(secret, "candidate-contact-snapshot", {
    contact: normalizeContact(context.candidate),
    lineIdentityTagState: context.response.lineIdentityTags.candidate,
    identityOwnership: {
      email: context.identity.email
        ? context.candidate.email?.trim().toLowerCase() === context.identity.email
        : false,
      phone: context.identity.phone
        ? context.candidate.phone?.trim() === context.identity.phone
        : false
    }
  });
  const fieldPolicyFingerprint = reconciliationHmac(secret, "field-policy-snapshot", {
    definitions: context.fieldDefinitions
      .filter((definition) => relevantFieldIds.has(definition.id.trim()))
      .map((definition) => ({
        id: definition.id.trim(),
        fieldKey: definition.fieldKey?.trim().toLowerCase() ?? "",
        name: definition.name?.trim().toLowerCase() ?? "",
        model: definition.model?.trim().toLowerCase() ?? ""
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    configuredLineUserFieldId: context.configuredLineUserFieldId?.trim() ?? ""
  });
  const semanticFingerprint = reconciliationHmac(secret, "combined-semantic-snapshot", {
    mappingFingerprint,
    masterFingerprint,
    candidateFingerprint,
    fieldPolicyFingerprint,
    riskReadStatuses: context.response.riskReadStatuses,
    currentContactMatchesMapping: context.response.currentContactMatchesMapping,
    distinctCandidateCount: context.response.distinctCandidateCount
  });

  return {
    mappingFingerprint,
    masterFingerprint,
    candidateFingerprint,
    fieldPolicyFingerprint,
    semanticFingerprint
  };
}
