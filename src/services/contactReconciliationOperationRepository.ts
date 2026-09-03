import { getSupabase } from "../config/supabase";
import type {
  ContactReconciliationDryRunState,
  ContactReconciliationTransferPlanSummary
} from "../types/lineContactReconciliationApplyDryRun";

export type ContactReconciliationOperationRecord = {
  id: string;
  tenant_id: string;
  location_id: string;
  master_contact_id: string;
  candidate_contact_id: string;
  identity_type: "email" | "phone" | "email_phone";
  line_identity_fingerprint: string;
  reconciliation_identity_fingerprint: string;
  preview_key_fingerprint: string;
  authorization_token_fingerprint: string;
  authorization_binding_fingerprint: string;
  mapping_snapshot_fingerprint: string;
  master_snapshot_fingerprint: string;
  candidate_snapshot_fingerprint: string;
  field_policy_fingerprint: string;
  initial_semantic_fingerprint: string;
  revalidated_semantic_fingerprint: string | null;
  transfer_plan_fingerprint: string | null;
  transfer_plan_summary: ContactReconciliationTransferPlanSummary | null;
  state: ContactReconciliationDryRunState;
  result_decision: "AUTO_SIMPLE" | null;
  reason_codes: string[];
  authorization_consumed_at: string | null;
  locked_at: string | null;
  revalidated_at: string | null;
  finalized_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type CreateContactReconciliationOperationInput = {
  tenantId: string;
  locationId: string;
  masterContactId: string;
  candidateContactId: string;
  identityType: "email" | "phone" | "email_phone";
  lineIdentityFingerprint: string;
  reconciliationIdentityFingerprint: string;
  previewKeyFingerprint: string;
  authorizationTokenFingerprint: string;
  authorizationBindingFingerprint: string;
  mappingSnapshotFingerprint: string;
  masterSnapshotFingerprint: string;
  candidateSnapshotFingerprint: string;
  fieldPolicyFingerprint: string;
  initialSemanticFingerprint: string;
  expiresAt: string;
};

export type ClaimContactReconciliationOperationInput = {
  operationId: string;
  tenantId: string;
  locationId: string;
  masterContactId: string;
  candidateContactId: string;
  authorizationTokenFingerprint: string;
  authorizationBindingFingerprint: string;
};

export type ContactReconciliationOperationRepository = {
  createPlanned(input: CreateContactReconciliationOperationInput): Promise<ContactReconciliationOperationRecord>;
  getById(operationId: string): Promise<ContactReconciliationOperationRecord | null>;
  claim(input: ClaimContactReconciliationOperationInput): Promise<boolean>;
  markRevalidated(input: {
    operationId: string;
    tenantId: string;
    locationId: string;
    semanticFingerprint: string;
  }): Promise<boolean>;
  finalize(input: {
    operationId: string;
    tenantId: string;
    locationId: string;
    state: "DRY_RUN_READY" | "FAILED_SAFE";
    resultDecision?: "AUTO_SIMPLE";
    reasonCodes: string[];
    transferPlanFingerprint?: string;
    transferPlanSummary?: ContactReconciliationTransferPlanSummary;
  }): Promise<boolean>;
  expire(input: { operationId: string; authorizationTokenFingerprint: string }): Promise<boolean>;
};

function normalizeCode(code: string): string {
  const normalized = code.trim().toUpperCase();

  if (!/^[A-Z0-9_]{1,96}$/.test(normalized)) {
    throw new Error("Contact reconciliation reason code was invalid");
  }

  return normalized;
}

export const contactReconciliationOperationRepository: ContactReconciliationOperationRepository = {
  async createPlanned(input) {
    const { data, error } = await getSupabase()
      .from("contact_reconciliation_operations")
      .insert({
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
        expires_at: input.expiresAt,
        state: "PLANNED"
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    if (!data || typeof data !== "object") throw new Error("Planned reconciliation operation was not returned");
    return data as ContactReconciliationOperationRecord;
  },

  async getById(operationId) {
    const { data, error } = await getSupabase()
      .from("contact_reconciliation_operations")
      .select("*")
      .eq("id", operationId)
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data as ContactReconciliationOperationRecord | null;
  },

  async claim(input) {
    const { data, error } = await getSupabase().rpc("claim_contact_reconciliation_dry_run_v1", {
      p_operation_id: input.operationId,
      p_tenant_id: input.tenantId,
      p_location_id: input.locationId,
      p_master_contact_id: input.masterContactId,
      p_candidate_contact_id: input.candidateContactId,
      p_authorization_token_fingerprint: input.authorizationTokenFingerprint,
      p_authorization_binding_fingerprint: input.authorizationBindingFingerprint
    });

    if (error) throw new Error(error.message);
    return data === true;
  },

  async markRevalidated(input) {
    const { data, error } = await getSupabase().rpc("mark_contact_reconciliation_revalidated_v1", {
      p_operation_id: input.operationId,
      p_tenant_id: input.tenantId,
      p_location_id: input.locationId,
      p_revalidated_semantic_fingerprint: input.semanticFingerprint
    });

    if (error) throw new Error(error.message);
    return data === true;
  },

  async finalize(input) {
    const { data, error } = await getSupabase().rpc("finalize_contact_reconciliation_dry_run_v1", {
      p_operation_id: input.operationId,
      p_tenant_id: input.tenantId,
      p_location_id: input.locationId,
      p_state: input.state,
      p_result_decision: input.resultDecision ?? null,
      p_reason_codes: input.reasonCodes.map(normalizeCode),
      p_transfer_plan_fingerprint: input.transferPlanFingerprint ?? null,
      p_transfer_plan_summary: input.transferPlanSummary ?? null
    });

    if (error) throw new Error(error.message);
    return data === true;
  },

  async expire(input) {
    const { data, error } = await getSupabase().rpc("expire_contact_reconciliation_authorization_v1", {
      p_operation_id: input.operationId,
      p_authorization_token_fingerprint: input.authorizationTokenFingerprint
    });

    if (error) throw new Error(error.message);
    return data === true;
  }
};
