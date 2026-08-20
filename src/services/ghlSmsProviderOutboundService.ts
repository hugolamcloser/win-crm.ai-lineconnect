import { env } from "../config/env";
import { logger } from "../config/logger";
import type { Every8dLogger } from "../integrations/every8dClient";
import { createEvery8dPhase2cMockTransport } from "../integrations/every8dPhase2cMockTransport";
import {
  Every8dSmsProviderFactory,
  type Every8dMockOnlyTransport,
} from "../integrations/every8dSmsProvider";
import type { GhlSmsProviderPayload } from "../routes/ghlSmsProviderWebhook";
import { SmsProviderConfigService } from "./smsProviderConfigService";
import { SmsOutboundService } from "./smsOutboundService";
import {
  claimGhlSmsOutboundOperation,
  finalizeGhlSmsOutboundOperation,
  getTenantById,
  getTenantIdsByLocationId,
  markGhlSmsOutboundOperationSendStarted,
  type ClaimGhlSmsOutboundOperationInput,
  type FinalizeGhlSmsOutboundOperationInput,
  type GhlSmsOutboundOperationClaimResult,
  type GhlSmsOutboundOperationIdentity,
  type TenantRecord,
} from "./repository";
import type { SmsFailureCode } from "../types/sms";

export interface GhlSmsProviderOutboundResponse {
  ok: boolean;
  status: "mocked" | "duplicate" | "failed";
  provider: "every8d";
  providerAttempts: 0 | 1;
  retryAttempted: false;
  error: string;
}

export interface GhlSmsProviderOutboundResult {
  httpStatus: number;
  body: GhlSmsProviderOutboundResponse;
}

export interface GhlSmsProviderOutboundDependencies {
  getTenantIdsByLocationId(locationId: string): Promise<string[]>;
  getTenantById(tenantId: string): Promise<TenantRecord | null>;
  claimOperation(
    input: ClaimGhlSmsOutboundOperationInput,
  ): Promise<GhlSmsOutboundOperationClaimResult>;
  markSendStarted(input: GhlSmsOutboundOperationIdentity): Promise<boolean>;
  finalizeOperation(
    input: FinalizeGhlSmsOutboundOperationInput,
  ): Promise<boolean>;
  createMockTransport(): Every8dMockOnlyTransport;
  logger: Every8dLogger;
}

export const GHL_SMS_PHASE_2C_CONFIRMATION =
  "ENABLE_APPROVED_PHASE_2C_MOCK_ONLY" as const;

function disabledResult(): GhlSmsProviderOutboundResult {
  return {
    httpStatus: 503,
    body: {
      ok: false,
      status: "failed",
      provider: "every8d",
      providerAttempts: 0,
      retryAttempted: false,
      error: "phase_2c_disabled",
    },
  };
}

function failureResult(
  httpStatus: number,
  error: string,
  providerAttempts: 0 | 1 = 0,
): GhlSmsProviderOutboundResult {
  return {
    httpStatus,
    body: {
      ok: false,
      status: "failed",
      provider: "every8d",
      providerAttempts,
      retryAttempted: false,
      error,
    },
  };
}

function duplicateResult(): GhlSmsProviderOutboundResult {
  return {
    httpStatus: 200,
    body: {
      ok: true,
      status: "duplicate",
      provider: "every8d",
      providerAttempts: 0,
      retryAttempted: false,
      error: "",
    },
  };
}

const DEFINITIVE_FAILURE_CODES = new Set<SmsFailureCode>([
  "service_disabled",
  "missing_tenant_id",
  "missing_location_id",
  "missing_provider",
  "unsupported_provider",
  "invalid_destination",
  "invalid_message",
  "invalid_reference",
  "configuration_not_found",
  "tenant_mismatch",
  "location_mismatch",
  "ambiguous_configuration",
  "configuration_disabled",
  "provider_configuration_invalid",
  "provider_rejected",
]);

function classifyFailure(
  failureCode: SmsFailureCode,
): "definitive_failed" | "ambiguous" {
  return DEFINITIVE_FAILURE_CODES.has(failureCode)
    ? "definitive_failed"
    : "ambiguous";
}

function sanitizedProviderStatus(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  if (!normalized || !/^[A-Za-z0-9_.:-]{1,64}$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function hasCompleteApprovedConfiguration(): boolean {
  return (
    env.GHL_SMS_PHASE_2C_CONFIRMATION === GHL_SMS_PHASE_2C_CONFIRMATION &&
    Boolean(env.GHL_SMS_PHASE_2C_ALLOWED_LOCATION_ID.trim()) &&
    Boolean(env.GHL_SMS_PHASE_2C_ALLOWED_TENANT_ID.trim()) &&
    Boolean(env.GHL_SMS_PHASE_2C_ALLOWED_CONTACT_ID.trim()) &&
    /^09\d{8}$/.test(env.GHL_SMS_PHASE_2C_ALLOWED_PHONE) &&
    Boolean(env.GHL_SMS_PHASE_2C_ALLOWED_MESSAGE.trim()) &&
    Array.from(env.GHL_SMS_PHASE_2C_ALLOWED_MESSAGE).length <= 333
  );
}

function requestIsApproved(payload: GhlSmsProviderPayload): boolean {
  return (
    payload.locationId === env.GHL_SMS_PHASE_2C_ALLOWED_LOCATION_ID.trim() &&
    payload.contactId === env.GHL_SMS_PHASE_2C_ALLOWED_CONTACT_ID.trim() &&
    payload.phone === env.GHL_SMS_PHASE_2C_ALLOWED_PHONE &&
    payload.message === env.GHL_SMS_PHASE_2C_ALLOWED_MESSAGE
  );
}

export function createGhlSmsProviderOutboundService(
  dependencies: GhlSmsProviderOutboundDependencies,
): (
  payload: GhlSmsProviderPayload,
) => Promise<GhlSmsProviderOutboundResult> {
  return async (payload) => {
    if (!env.GHL_SMS_PHASE_2C_ENABLED) {
      return disabledResult();
    }

    if (!hasCompleteApprovedConfiguration()) {
      return failureResult(503, "phase_2c_configuration_invalid");
    }

    if (!requestIsApproved(payload)) {
      return failureResult(403, "request_not_approved");
    }

    let tenantIds: string[];

    try {
      tenantIds = (
        await dependencies.getTenantIdsByLocationId(payload.locationId)
      )
        .map((tenantId) => tenantId.trim())
        .filter(Boolean);
    } catch {
      return failureResult(503, "tenant_resolution_failed");
    }

    if (tenantIds.length === 0) {
      return failureResult(404, "location_not_onboarded");
    }

    if (tenantIds.length > 1) {
      return failureResult(409, "ambiguous_tenant");
    }

    const derivedTenantId = tenantIds[0] as string;
    let tenant: TenantRecord | null;

    try {
      tenant = await dependencies.getTenantById(derivedTenantId);
    } catch {
      return failureResult(503, "tenant_resolution_failed");
    }

    if (
      !tenant ||
      tenant.id !== derivedTenantId ||
      tenant.location_id !== payload.locationId ||
      tenant.id !== env.GHL_SMS_PHASE_2C_ALLOWED_TENANT_ID.trim()
    ) {
      return failureResult(409, "tenant_binding_invalid");
    }

    let claim: GhlSmsOutboundOperationClaimResult;

    try {
      claim = await dependencies.claimOperation({
        tenantId: derivedTenantId,
        locationId: payload.locationId,
        ghlMessageId: payload.messageId,
      });
    } catch {
      return failureResult(503, "sms_operation_claim_failed");
    }

    if (!claim.claimed) {
      return duplicateResult();
    }

    const operationIdentity: GhlSmsOutboundOperationIdentity = {
      operationId: claim.operationId,
      tenantId: derivedTenantId,
      locationId: payload.locationId,
      ghlMessageId: payload.messageId,
    };

    let sendStarted: boolean;

    try {
      sendStarted = await dependencies.markSendStarted(operationIdentity);
    } catch {
      return failureResult(503, "sms_operation_send_start_failed");
    }

    if (!sendStarted) {
      return failureResult(503, "sms_operation_send_start_failed");
    }

    let providerFactory: Every8dSmsProviderFactory;

    try {
      providerFactory = new Every8dSmsProviderFactory({
        transport: dependencies.createMockTransport(),
        logger: dependencies.logger,
      });
    } catch {
      let finalized: boolean;

      try {
        finalized = await dependencies.finalizeOperation({
          ...operationIdentity,
          state: "definitive_failed",
          failureCode: "provider_configuration_invalid",
        });
      } catch {
        finalized = false;
      }

      if (!finalized) {
        return failureResult(500, "sms_operation_finalization_failed", 1);
      }

      return failureResult(503, "mock_provider_unavailable");
    }

    const configService = new SmsProviderConfigService([
      {
        configurationId: "phase-2c-mock-only",
        tenantId: derivedTenantId,
        locationId: payload.locationId,
        provider: "every8d",
        enabled: true,
        credentials: {
          siteUrl: "https://phase-2c-mock.invalid",
          uid: "phase-2c-mock-uid",
          password: "phase-2c-mock-password",
          timeoutMs: 1_000,
        },
      },
    ]);
    const outboundService = new SmsOutboundService({
      enabled: true,
      configService,
      providerFactories: { every8d: providerFactory },
      logger: dependencies.logger,
    });
    const result = await outboundService.send({
      tenantId: derivedTenantId,
      locationId: payload.locationId,
      provider: "every8d",
      destination: payload.phone,
      message: payload.message,
      reference: "issue-83-phase-2c-mock",
    });

    if (!result.ok) {
      let finalized: boolean;

      try {
        finalized = await dependencies.finalizeOperation({
          ...operationIdentity,
          state: classifyFailure(result.failure.code),
          failureCode: result.failure.code,
          providerHttpStatus: result.failure.httpStatus,
          providerStatus: sanitizedProviderStatus(
            result.failure.providerStatus,
          ),
        });
      } catch {
        finalized = false;
      }

      if (!finalized) {
        return failureResult(500, "sms_operation_finalization_failed", 1);
      }

      return failureResult(502, result.failure.code, result.providerAttempts);
    }

    let finalized: boolean;

    try {
      finalized = await dependencies.finalizeOperation({
        ...operationIdentity,
        state: "accepted",
        providerHttpStatus: result.providerResult.httpStatus,
        providerStatus: sanitizedProviderStatus(
          result.providerResult.providerStatus,
        ),
        providerSentCount: result.providerResult.sentCount,
        providerUnsentCount: result.providerResult.unsentCount,
        providerBatchId: result.correlation.batchId,
        providerBid: result.correlation.bid,
        providerBidSource: result.correlation.bidSource,
      });
    } catch {
      finalized = false;
    }

    if (!finalized) {
      return failureResult(500, "sms_operation_finalization_failed", 1);
    }

    return {
      httpStatus: 200,
      body: {
        ok: true,
        status: "mocked",
        provider: "every8d",
        providerAttempts: 1,
        retryAttempted: false,
        error: "",
      },
    };
  };
}

export const processGhlSmsProviderOutbound =
  createGhlSmsProviderOutboundService({
    getTenantIdsByLocationId,
    getTenantById,
    claimOperation: claimGhlSmsOutboundOperation,
    markSendStarted: markGhlSmsOutboundOperationSendStarted,
    finalizeOperation: finalizeGhlSmsOutboundOperation,
    createMockTransport: createEvery8dPhase2cMockTransport,
    logger,
  });
