import type { LineContactReconciliationPreviewRequest } from "./lineContactReconciliation";

export const contactReconciliationDryRunStates = [
  "PLANNED",
  "LOCKED",
  "REVALIDATED",
  "DRY_RUN_READY",
  "FAILED_SAFE",
  "EXPIRED"
] as const;

export type ContactReconciliationDryRunState = (typeof contactReconciliationDryRunStates)[number];

export type ContactReconciliationDryRunRequest = {
  authorizationId: string;
  authorizationToken: string;
  previewKey: string;
  request: LineContactReconciliationPreviewRequest;
};

export type TransferAction = "NONE" | "SET_ON_MASTER" | "NO_OP_EQUAL" | "RETAIN_MASTER" | "BLOCK_CONFLICT";

export type SanitizedTransferCounts = {
  setOnMaster: number;
  noOpEqual: number;
  retainMaster: number;
  blockedConflict: number;
};

export type ContactReconciliationTransferPlanSummary = {
  executable: boolean;
  emailAction: TransferAction;
  phoneAction: TransferAction;
  standardFields: SanitizedTransferCounts;
  customFields: SanitizedTransferCounts;
  ordinaryTagsToAdd: number;
  lineIdentityValuesExcluded: number;
  ignoredTemporaryFieldsExcluded: number;
  protectedCandidateOnlyBlockers: number;
  protectedConflictingBlockers: number;
  unclassifiedBlockers: number;
  blockerCodes: string[];
};

export type ContactReconciliationDryRunResponse = {
  result: "DRY_RUN_READY" | "FAILED_SAFE" | "EXPIRED";
  reasonCodes: string[];
  operationRef: string;
  readOnly: true;
  previewDecision: string | null;
  currentContactMatchesMapping: boolean | null;
  distinctCandidateCount: number | null;
  sameCandidateConfirmed: boolean;
  semanticStateMatches: boolean;
  transferPlan: ContactReconciliationTransferPlanSummary | null;
};

export type ContactReconciliationDryRunAuthorization = {
  authorizationId: string;
  authorizationToken: string;
  previewKey: string;
  expiresAt: string;
};
