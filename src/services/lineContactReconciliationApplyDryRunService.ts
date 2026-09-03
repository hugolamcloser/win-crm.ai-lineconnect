import crypto from "node:crypto";
import { env } from "../config/env";
import type {
  ContactReconciliationDryRunAuthorization,
  ContactReconciliationDryRunRequest,
  ContactReconciliationDryRunResponse,
  ContactReconciliationTransferPlanSummary
} from "../types/lineContactReconciliationApplyDryRun";
import type {
  LineContactReconciliationPreviewRequest,
  LineContactReconciliationPreviewResponse
} from "../types/lineContactReconciliation";
import {
  contactReconciliationOperationRepository,
  type ContactReconciliationOperationRecord,
  type ContactReconciliationOperationRepository
} from "./contactReconciliationOperationRepository";
import {
  buildContactReconciliationSemanticSnapshot,
  reconciliationHmac,
  type ContactReconciliationSemanticSnapshot
} from "./contactReconciliationSemanticSnapshot";
import { buildContactReconciliationTransferPlan } from "./contactReconciliationTransferPlan";
import {
  createLineContactReconciliationPreviewService,
  type LineContactReconciliationAutoSimpleContext
} from "./lineContactReconciliationPreviewService";

export const CONTACT_RECONCILIATION_DRY_RUN_AUTHORIZATION_TTL_MS = 5 * 60 * 1_000;
const MAX_DRY_RUN_PREVIEW_MS = 8_000;

type AutoSimpleAssessment = {
  response: LineContactReconciliationPreviewResponse;
  context?: LineContactReconciliationAutoSimpleContext;
};

type DryRunDependencies = {
  repository: ContactReconciliationOperationRepository;
  assess(request: LineContactReconciliationPreviewRequest, maximumDurationMs?: number): Promise<AutoSimpleAssessment>;
  now(): number;
  randomToken(): string;
  getSecret(): string;
  authorizationTtlMs: number;
};

function createDefaultAssessment(
  request: LineContactReconciliationPreviewRequest,
  maximumDurationMs = MAX_DRY_RUN_PREVIEW_MS
): Promise<AutoSimpleAssessment> {
  let context: LineContactReconciliationAutoSimpleContext | undefined;
  const preview = createLineContactReconciliationPreviewService({
    overallDeadlineMs: Math.max(1, Math.min(MAX_DRY_RUN_PREVIEW_MS, maximumDurationMs)),
    captureAutoSimpleContext: (captured) => {
      context = captured;
    }
  });

  return preview(request).then((response) => ({ response, context }));
}

function normalizeRequest(request: LineContactReconciliationPreviewRequest): LineContactReconciliationPreviewRequest {
  return {
    locationId: request.locationId.trim(),
    currentContactId: request.currentContactId.trim(),
    source: request.source.trim().toLowerCase(),
    identity: {
      email: request.identity.email?.trim().toLowerCase() || undefined,
      phone: request.identity.phone?.trim() || undefined
    }
  };
}

function getIdentityType(request: LineContactReconciliationPreviewRequest): "email" | "phone" | "email_phone" {
  if (request.identity.email && request.identity.phone) return "email_phone";
  if (request.identity.email) return "email";
  if (request.identity.phone) return "phone";
  throw new Error("A reconciliation dry-run authorization requires an identity");
}

function fingerprintableIdentity(identity: LineContactReconciliationPreviewRequest["identity"]): {
  email: string | null;
  phone: string | null;
} {
  return {
    email: identity.email ?? null,
    phone: identity.phone ?? null
  };
}

function safeFingerprintMatch(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function authorizationBinding(input: {
  tenantId: string;
  locationId: string;
  masterContactId: string;
  candidateContactId: string;
  identityFingerprint: string;
  previewKeyFingerprint: string;
  initialSemanticFingerprint: string;
  tokenFingerprint: string;
  expiresAt: string;
}, secret: string): string {
  return reconciliationHmac(secret, "dry-run-authorization-binding", input);
}

function operationRef(operationId: string, secret: string): string {
  return reconciliationHmac(secret, "dry-run-operation-reference", operationId).slice(0, 16);
}

function emptyResult(
  input: {
    result: ContactReconciliationDryRunResponse["result"];
    reasonCodes: string[];
    operationId: string;
    preview?: LineContactReconciliationPreviewResponse;
    sameCandidateConfirmed?: boolean;
    semanticStateMatches?: boolean;
    transferPlan?: ContactReconciliationTransferPlanSummary | null;
  },
  secret: string
): ContactReconciliationDryRunResponse {
  return {
    result: input.result,
    reasonCodes: input.reasonCodes,
    operationRef: operationRef(input.operationId, secret),
    readOnly: true,
    previewDecision: input.preview?.decision ?? null,
    currentContactMatchesMapping: input.preview?.currentContactMatchesMapping ?? null,
    distinctCandidateCount: input.preview?.distinctCandidateCount ?? null,
    sameCandidateConfirmed: input.sameCandidateConfirmed ?? false,
    semanticStateMatches: input.semanticStateMatches ?? false,
    transferPlan: input.transferPlan ?? null
  };
}

function requireAutoSimpleAssessment(assessment: AutoSimpleAssessment): LineContactReconciliationAutoSimpleContext {
  if (assessment.response.decision !== "AUTO_SIMPLE" || !assessment.context) {
    throw new Error("A reconciliation dry-run authorization requires AUTO_SIMPLE Preview evidence");
  }

  if (
    assessment.response.currentContactMatchesMapping !== true ||
    assessment.response.distinctCandidateCount !== 1 ||
    Object.values(assessment.response.riskReadStatuses).some((status) => status !== "CLEAR") ||
    assessment.response.fieldPolicy.status !== "CLEAR" ||
    assessment.response.fieldPolicy.lineIdentityConflict !== false ||
    assessment.response.fieldPolicy.protectedBusinessConflict !== false ||
    (assessment.response.transferInventory.protectedOrUnsupportedStandardFields.candidateOnly ?? 0) > 0 ||
    (assessment.response.transferInventory.protectedOrUnsupportedStandardFields.conflicting ?? 0) > 0 ||
    (assessment.response.transferInventory.unclassifiedStandardFieldCount ?? 0) > 0
  ) {
    throw new Error("AUTO_SIMPLE Preview evidence was incomplete for reconciliation dry-run authorization");
  }

  return assessment.context;
}

function buildFingerprints(input: {
  context: LineContactReconciliationAutoSimpleContext;
  previewKey: string;
  token: string;
  expiresAt: string;
}, secret: string): {
  snapshot: ContactReconciliationSemanticSnapshot;
  lineIdentityFingerprint: string;
  identityFingerprint: string;
  previewKeyFingerprint: string;
  tokenFingerprint: string;
  bindingFingerprint: string;
} {
  const snapshot = buildContactReconciliationSemanticSnapshot(input.context, secret);
  const lineIdentityFingerprint = reconciliationHmac(secret, "immutable-line-identity", input.context.lineUserId);
  const identityFingerprint = reconciliationHmac(
    secret,
    "supplied-reconciliation-identity",
    fingerprintableIdentity(input.context.identity)
  );
  const previewKeyFingerprint = reconciliationHmac(secret, "preview-key-binding", input.previewKey);
  const tokenFingerprint = reconciliationHmac(secret, "dry-run-authorization-token", input.token);
  const bindingFingerprint = authorizationBinding({
    tenantId: input.context.tenantId,
    locationId: input.context.locationId,
    masterContactId: input.context.currentContactId,
    candidateContactId: input.context.candidate.id,
    identityFingerprint,
    previewKeyFingerprint,
    initialSemanticFingerprint: snapshot.semanticFingerprint,
    tokenFingerprint,
    expiresAt: input.expiresAt
  }, secret);

  return {
    snapshot,
    lineIdentityFingerprint,
    identityFingerprint,
    previewKeyFingerprint,
    tokenFingerprint,
    bindingFingerprint
  };
}

function validateStoredAuthorization(input: {
  operation: ContactReconciliationOperationRecord;
  request: ContactReconciliationDryRunRequest;
  tokenFingerprint: string;
  identityFingerprint: string;
  previewKeyFingerprint: string;
  bindingFingerprint: string;
}): boolean {
  const normalized = normalizeRequest(input.request.request);
  return (
    input.operation.location_id === normalized.locationId &&
    input.operation.master_contact_id === normalized.currentContactId &&
    safeFingerprintMatch(input.operation.authorization_token_fingerprint, input.tokenFingerprint) &&
    safeFingerprintMatch(input.operation.reconciliation_identity_fingerprint, input.identityFingerprint) &&
    safeFingerprintMatch(input.operation.preview_key_fingerprint, input.previewKeyFingerprint) &&
    safeFingerprintMatch(input.operation.authorization_binding_fingerprint, input.bindingFingerprint)
  );
}

export function createLineContactReconciliationApplyDryRunService(
  overrides: Partial<DryRunDependencies> = {}
): {
  prepareAuthorization(request: LineContactReconciliationPreviewRequest): Promise<ContactReconciliationDryRunAuthorization>;
  execute(request: ContactReconciliationDryRunRequest): Promise<ContactReconciliationDryRunResponse>;
} {
  const dependencies: DryRunDependencies = {
    repository: contactReconciliationOperationRepository,
    assess: createDefaultAssessment,
    now: Date.now,
    randomToken: () => crypto.randomBytes(32).toString("base64url"),
    getSecret: () => env.WEBHOOK_SHARED_SECRET,
    authorizationTtlMs: CONTACT_RECONCILIATION_DRY_RUN_AUTHORIZATION_TTL_MS,
    ...overrides
  };

  const getSecret = (): string => {
    const secret = dependencies.getSecret().trim();
    if (!secret) throw new Error("WEBHOOK_SHARED_SECRET is required for reconciliation dry-run authorization");
    return secret;
  };

  return {
    async prepareAuthorization(request) {
      const secret = getSecret();
      const normalizedRequest = normalizeRequest(request);
      const assessment = await dependencies.assess(normalizedRequest);
      const context = requireAutoSimpleAssessment(assessment);
      const transferPlan = buildContactReconciliationTransferPlan(context);

      if (!transferPlan.executable) {
        throw new Error("Reconciliation transfer plan contained a protected or unsupported blocker");
      }

      const authorizationToken = dependencies.randomToken();
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(authorizationToken)) {
        throw new Error("Generated reconciliation authorization token was invalid");
      }

      const expiresAt = new Date(dependencies.now() + dependencies.authorizationTtlMs).toISOString();
      const fingerprints = buildFingerprints({
        context,
        previewKey: assessment.response.previewKey,
        token: authorizationToken,
        expiresAt
      }, secret);
      const operation = await dependencies.repository.createPlanned({
        tenantId: context.tenantId,
        locationId: context.locationId,
        masterContactId: context.currentContactId,
        candidateContactId: context.candidate.id,
        identityType: getIdentityType(normalizedRequest),
        lineIdentityFingerprint: fingerprints.lineIdentityFingerprint,
        reconciliationIdentityFingerprint: fingerprints.identityFingerprint,
        previewKeyFingerprint: fingerprints.previewKeyFingerprint,
        authorizationTokenFingerprint: fingerprints.tokenFingerprint,
        authorizationBindingFingerprint: fingerprints.bindingFingerprint,
        mappingSnapshotFingerprint: fingerprints.snapshot.mappingFingerprint,
        masterSnapshotFingerprint: fingerprints.snapshot.masterFingerprint,
        candidateSnapshotFingerprint: fingerprints.snapshot.candidateFingerprint,
        fieldPolicyFingerprint: fingerprints.snapshot.fieldPolicyFingerprint,
        initialSemanticFingerprint: fingerprints.snapshot.semanticFingerprint,
        expiresAt
      });

      return {
        authorizationId: operation.id,
        authorizationToken,
        previewKey: assessment.response.previewKey,
        expiresAt
      };
    },

    async execute(request) {
      const secret = getSecret();
      const normalizedRequest = normalizeRequest(request.request);
      const tokenFingerprint = reconciliationHmac(secret, "dry-run-authorization-token", request.authorizationToken);
      const identityFingerprint = reconciliationHmac(
        secret,
        "supplied-reconciliation-identity",
        fingerprintableIdentity(normalizedRequest.identity)
      );
      const previewKeyFingerprint = reconciliationHmac(secret, "preview-key-binding", request.previewKey);
      const operation = await dependencies.repository.getById(request.authorizationId);

      if (!operation) {
        return emptyResult({
          result: "FAILED_SAFE",
          reasonCodes: ["AUTHORIZATION_NOT_FOUND"],
          operationId: request.authorizationId
        }, secret);
      }

      const bindingFingerprint = authorizationBinding({
        tenantId: operation.tenant_id,
        locationId: normalizedRequest.locationId,
        masterContactId: normalizedRequest.currentContactId,
        candidateContactId: operation.candidate_contact_id,
        identityFingerprint,
        previewKeyFingerprint,
        initialSemanticFingerprint: operation.initial_semantic_fingerprint,
        tokenFingerprint,
        expiresAt: operation.expires_at
      }, secret);

      if (!validateStoredAuthorization({
        operation,
        request: { ...request, request: normalizedRequest },
        tokenFingerprint,
        identityFingerprint,
        previewKeyFingerprint,
        bindingFingerprint
      })) {
        return emptyResult({
          result: "FAILED_SAFE",
          reasonCodes: ["AUTHORIZATION_BINDING_MISMATCH"],
          operationId: operation.id
        }, secret);
      }

      if (operation.state !== "PLANNED") {
        return emptyResult({
          result: "FAILED_SAFE",
          reasonCodes: ["AUTHORIZATION_NOT_CONSUMABLE"],
          operationId: operation.id
        }, secret);
      }

      if (new Date(operation.expires_at).getTime() <= dependencies.now()) {
        await dependencies.repository.expire({ operationId: operation.id, authorizationTokenFingerprint: tokenFingerprint });
        return emptyResult({
          result: "EXPIRED",
          reasonCodes: ["AUTHORIZATION_EXPIRED"],
          operationId: operation.id
        }, secret);
      }

      const claimed = await dependencies.repository.claim({
        operationId: operation.id,
        tenantId: operation.tenant_id,
        locationId: operation.location_id,
        masterContactId: operation.master_contact_id,
        candidateContactId: operation.candidate_contact_id,
        authorizationTokenFingerprint: tokenFingerprint,
        authorizationBindingFingerprint: bindingFingerprint
      });

      if (!claimed) {
        return emptyResult({
          result: "FAILED_SAFE",
          reasonCodes: ["AUTHORIZATION_NOT_CONSUMABLE"],
          operationId: operation.id
        }, secret);
      }

      let preview: LineContactReconciliationPreviewResponse | undefined;

      const failClaimedOperation = async (reasonCodes: string[], input: {
        sameCandidateConfirmed?: boolean;
        semanticStateMatches?: boolean;
      } = {}): Promise<ContactReconciliationDryRunResponse> => {
        await dependencies.repository.finalize({
          operationId: operation.id,
          tenantId: operation.tenant_id,
          locationId: operation.location_id,
          state: "FAILED_SAFE",
          reasonCodes
        });
        return emptyResult({
          result: "FAILED_SAFE",
          reasonCodes,
          operationId: operation.id,
          preview,
          ...input
        }, secret);
      };

      try {
        const remainingMs = new Date(operation.expires_at).getTime() - dependencies.now();
        if (remainingMs <= 0) return await failClaimedOperation(["AUTHORIZATION_EXPIRED_AFTER_CLAIM"]);

        const assessment = await dependencies.assess(normalizedRequest, Math.min(MAX_DRY_RUN_PREVIEW_MS, remainingMs));
        preview = assessment.response;

        if (preview.decision !== "AUTO_SIMPLE" || !assessment.context) {
          return await failClaimedOperation(["PREVIEW_NO_LONGER_AUTO_SIMPLE"]);
        }

        let context: LineContactReconciliationAutoSimpleContext;
        try {
          context = requireAutoSimpleAssessment(assessment);
        } catch {
          return await failClaimedOperation(["PREVIEW_REVALIDATION_INCOMPLETE"]);
        }

        const reconciliationContextMatches =
          context.tenantId === operation.tenant_id &&
          context.locationId === operation.location_id &&
          context.currentContactId === operation.master_contact_id;

        if (!reconciliationContextMatches) {
          return await failClaimedOperation(["REVALIDATION_CONTEXT_CHANGED"]);
        }

        const sameCandidateConfirmed = context.candidate.id === operation.candidate_contact_id;

        if (!sameCandidateConfirmed) {
          return await failClaimedOperation(["DERIVED_CANDIDATE_CHANGED"]);
        }

        const snapshot = buildContactReconciliationSemanticSnapshot(context, secret);
        const semanticStateMatches =
          safeFingerprintMatch(snapshot.mappingFingerprint, operation.mapping_snapshot_fingerprint) &&
          safeFingerprintMatch(snapshot.masterFingerprint, operation.master_snapshot_fingerprint) &&
          safeFingerprintMatch(snapshot.candidateFingerprint, operation.candidate_snapshot_fingerprint) &&
          safeFingerprintMatch(snapshot.fieldPolicyFingerprint, operation.field_policy_fingerprint) &&
          safeFingerprintMatch(snapshot.semanticFingerprint, operation.initial_semantic_fingerprint);

        if (!semanticStateMatches) {
          return await failClaimedOperation(["STALE_SEMANTIC_STATE"], {
            sameCandidateConfirmed: true,
            semanticStateMatches: false
          });
        }

        const transferPlan = buildContactReconciliationTransferPlan(context);
        if (!transferPlan.executable) {
          return await failClaimedOperation(["TRANSFER_PLAN_BLOCKED", ...transferPlan.blockerCodes], {
            sameCandidateConfirmed: true,
            semanticStateMatches: true
          });
        }

        const markedRevalidated = await dependencies.repository.markRevalidated({
          operationId: operation.id,
          tenantId: operation.tenant_id,
          locationId: operation.location_id,
          semanticFingerprint: snapshot.semanticFingerprint
        });

        if (!markedRevalidated) {
          return await failClaimedOperation(["REVALIDATION_STATE_TRANSITION_FAILED"], {
            sameCandidateConfirmed: true,
            semanticStateMatches: true
          });
        }

        const transferPlanFingerprint = reconciliationHmac(secret, "dry-run-transfer-plan", transferPlan);
        const finalized = await dependencies.repository.finalize({
          operationId: operation.id,
          tenantId: operation.tenant_id,
          locationId: operation.location_id,
          state: "DRY_RUN_READY",
          resultDecision: "AUTO_SIMPLE",
          reasonCodes: ["DRY_RUN_REVALIDATED"],
          transferPlanFingerprint,
          transferPlanSummary: transferPlan
        });

        if (!finalized) {
          return emptyResult({
            result: "FAILED_SAFE",
            reasonCodes: ["DRY_RUN_FINALIZATION_FAILED"],
            operationId: operation.id,
            preview,
            sameCandidateConfirmed: true,
            semanticStateMatches: true
          }, secret);
        }

        return emptyResult({
          result: "DRY_RUN_READY",
          reasonCodes: ["DRY_RUN_REVALIDATED"],
          operationId: operation.id,
          preview,
          sameCandidateConfirmed: true,
          semanticStateMatches: true,
          transferPlan
        }, secret);
      } catch {
        try {
          return await failClaimedOperation(["DRY_RUN_REVALIDATION_FAILED"]);
        } catch {
          return emptyResult({
            result: "FAILED_SAFE",
            reasonCodes: ["DRY_RUN_REVALIDATION_FAILED"],
            operationId: operation.id,
            preview
          }, secret);
        }
      }
    }
  };
}

export const lineContactReconciliationApplyDryRunService =
  createLineContactReconciliationApplyDryRunService();

export const prepareLineContactReconciliationDryRunAuthorization =
  lineContactReconciliationApplyDryRunService.prepareAuthorization;

export const executeLineContactReconciliationApplyDryRun =
  lineContactReconciliationApplyDryRunService.execute;
