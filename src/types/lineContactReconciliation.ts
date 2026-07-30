export const reconciliationDecisions = [
  "UNSUPPORTED_SOURCE",
  "INVALID_EMAIL",
  "INVALID_PHONE",
  "NO_IDENTIFIER",
  "CROSS_TENANT_BLOCKED",
  "MAPPING_NOT_FOUND",
  "AMBIGUOUS",
  "MAPPING_CONTACT_MISMATCH",
  "ALREADY_RECONCILED",
  "NO_MATCH",
  "IDENTITY_CONFLICT",
  "MANUAL_COMPLEX",
  "AUTO_SIMPLE"
] as const;

export type ReconciliationDecision = (typeof reconciliationDecisions)[number];

export const reconciliationReadStatuses = [
  "CLEAR",
  "FOUND",
  "MISSING_SCOPE",
  "UNAVAILABLE",
  "MALFORMED"
] as const;

export type ReconciliationReadStatus = (typeof reconciliationReadStatuses)[number];

export const reconciliationRiskKeys = [
  "conversations",
  "notes",
  "tasks",
  "opportunities",
  "appointments",
  "orders",
  "transactions",
  "invoices"
] as const;

export type ReconciliationRiskKey = (typeof reconciliationRiskKeys)[number];

export type LineIdentityTagState = "NOT_EVALUATED" | "NONE" | "MATCH" | "DIFFERENT" | "AMBIGUOUS";

export type TransferInventoryCounts = {
  masterOnly: number | null;
  candidateOnly: number | null;
  equal: number | null;
  conflicting: number | null;
};

export type LineContactReconciliationPreviewRequest = {
  locationId: string;
  currentContactId: string;
  source: string;
  identity: {
    email?: string;
    phone?: string;
  };
};

export type SanitizedIdentitySummary = {
  emailSupplied: boolean;
  phoneSupplied: boolean;
};

export type LineContactReconciliationPreviewResponse = {
  decision: ReconciliationDecision;
  reasonCodes: string[];
  previewKey: string;
  readOnly: true;
  currentContactMatchesMapping: boolean | null;
  identity: SanitizedIdentitySummary;
  distinctCandidateCount: number | null;
  riskReadStatuses: Record<ReconciliationRiskKey, ReconciliationReadStatus>;
  associatedRecords: Record<ReconciliationRiskKey, ReconciliationReadStatus>;
  lineIdentityTags: {
    master: LineIdentityTagState;
    candidate: LineIdentityTagState;
  };
  transferInventory: {
    standardFields: TransferInventoryCounts;
    customFields: TransferInventoryCounts;
    candidateOnlyNonIdentityTags: number | null;
    protectedOrUnsupportedStandardFields: TransferInventoryCounts;
    unclassifiedStandardFieldCount: number | null;
  };
  fieldPolicy: {
    status: ReconciliationReadStatus;
    lineIdentityConflict: boolean | null;
    protectedBusinessConflict: boolean | null;
  };
};

export type GhlReconciliationContact = {
  id: string;
  locationId?: string;
  email?: string;
  phone?: string;
  tags: string[];
  customFields: Array<{ id: string; value: unknown }>;
  standardFields: Record<string, unknown>;
  protectedOrUnsupportedStandardFields: Record<string, unknown>;
  unclassifiedStandardFieldCount: number;
};

export type GhlReconciliationCustomFieldDefinition = {
  id: string;
  name?: string;
  fieldKey?: string;
  model?: string;
};
