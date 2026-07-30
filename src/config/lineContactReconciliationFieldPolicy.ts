import type { GhlReconciliationCustomFieldDefinition } from "../types/lineContactReconciliation";

type StableFieldReference = {
  fieldKeys: readonly string[];
  names: readonly string[];
};

const lineIdentityReferences: readonly StableFieldReference[] = [
  {
    fieldKeys: ["contact.line_user_id", "contact.line_userid", "contact.line_id"],
    names: ["LINE User ID", "LINE UserId", "LINE ID"]
  }
];

const ignoredTemporaryReferences: readonly StableFieldReference[] = [
  { fieldKeys: ["contact.ai_event_command"], names: ["AI Event Command"] },
  { fieldKeys: ["contact.ai_tag_command"], names: ["AI Tag Command"] },
  { fieldKeys: ["contact.ai_content_command"], names: ["AI Content Command"] },
  { fieldKeys: ["contact.ai_candidate_email"], names: ["AI Candidate Email", "Candidate Email"] },
  { fieldKeys: ["contact.ai_candidate_phone"], names: ["AI Candidate Phone", "Candidate Phone"] }
];

function normalizeStableName(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function matchesReference(
  definition: GhlReconciliationCustomFieldDefinition,
  reference: StableFieldReference
): boolean {
  const fieldKey = normalizeStableName(definition.fieldKey);
  const name = normalizeStableName(definition.name);

  return (
    reference.fieldKeys.some((candidate) => normalizeStableName(candidate) === fieldKey) ||
    reference.names.some((candidate) => normalizeStableName(candidate) === name)
  );
}

export type ReconciliationFieldPolicy = {
  lineIdentityFieldIds: Set<string>;
  ignoredFieldIds: Set<string>;
  protectedBusinessFieldIds: Set<string>;
};

export function resolveReconciliationFieldPolicy(
  definitions: GhlReconciliationCustomFieldDefinition[],
  configuredLineUserFieldId?: string
): ReconciliationFieldPolicy {
  const definitionIds = new Set<string>();
  const fieldKeys = new Set<string>();

  for (const definition of definitions) {
    const definitionId = definition.id.trim();
    const fieldKey = normalizeStableName(definition.fieldKey);

    if (!definitionId || definitionIds.has(definitionId) || (fieldKey && fieldKeys.has(fieldKey))) {
      throw new Error("Ambiguous HighLevel custom-field metadata");
    }

    definitionIds.add(definitionId);

    if (fieldKey) {
      fieldKeys.add(fieldKey);
    }
  }

  for (const reference of [...lineIdentityReferences, ...ignoredTemporaryReferences]) {
    const matchingDefinitionIds = new Set(
      definitions.filter((definition) => matchesReference(definition, reference)).map((definition) => definition.id)
    );

    if (matchingDefinitionIds.size > 1) {
      throw new Error("Ambiguous HighLevel custom-field policy metadata");
    }
  }

  const lineIdentityFieldIds = new Set<string>();
  const ignoredFieldIds = new Set<string>();
  const protectedBusinessFieldIds = new Set<string>();
  const normalizedConfiguredFieldId = configuredLineUserFieldId?.trim();

  for (const definition of definitions) {
    if (lineIdentityReferences.some((reference) => matchesReference(definition, reference))) {
      lineIdentityFieldIds.add(definition.id);
      continue;
    }

    if (ignoredTemporaryReferences.some((reference) => matchesReference(definition, reference))) {
      ignoredFieldIds.add(definition.id);
      continue;
    }

    protectedBusinessFieldIds.add(definition.id);
  }

  if (normalizedConfiguredFieldId && definitionIds.has(normalizedConfiguredFieldId)) {
    lineIdentityFieldIds.add(normalizedConfiguredFieldId);
    ignoredFieldIds.delete(normalizedConfiguredFieldId);
    protectedBusinessFieldIds.delete(normalizedConfiguredFieldId);
  }

  return { lineIdentityFieldIds, ignoredFieldIds, protectedBusinessFieldIds };
}

export const reconciliationFieldPolicyDocumentation = {
  lineIdentityFieldKeys: lineIdentityReferences.flatMap((reference) => [...reference.fieldKeys]),
  ignoredTemporaryFieldNames: ignoredTemporaryReferences.flatMap((reference) => [...reference.names]),
  unknownFieldsAreProtected: true
} as const;
