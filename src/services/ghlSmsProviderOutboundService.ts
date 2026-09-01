import { env } from "../config/env";
import {
  Every8dPhase2fConfigurationError,
  assertEvery8dPhase2fAuthorizationConfig,
  readEvery8dPhase2fAuthorizationConfig,
  readEvery8dPhase2fProviderConfig,
} from "../config/every8dPhase2f";
import { logger } from "../config/logger";
import type { Every8dLogger } from "../integrations/every8dClient";
import { createEvery8dPhase2cMockTransport } from "../integrations/every8dPhase2cMockTransport";
import {
  Every8dSmsProviderFactory,
  createEvery8dPhase2fControlledLiveSmsProviderFactory,
  type Every8dMockOnlyTransport,
} from "../integrations/every8dSmsProvider";
import type { GhlSmsProviderPayload } from "../routes/ghlSmsProviderWebhook";
import { SmsProviderConfigService } from "./smsProviderConfigService";
import { SmsOutboundService } from "./smsOutboundService";
import {
  claimGhlSmsControlledLiveOutboundOperation,
  claimGhlSmsOutboundOperation,
  consumeGhlSmsControlledLiveAuthorization,
  finalizeGhlSmsControlledLiveOutboundOperation,
  finalizeGhlSmsControlledLiveOutboundOperationBeforeSend,
  finalizeGhlSmsOutboundOperation,
  getTenantById,
  getTenantIdsByLocationId,
  markGhlSmsOutboundOperationSendStarted,
  type ClaimGhlSmsOutboundOperationInput,
  type ConsumeGhlSmsControlledLiveAuthorizationInput,
  type FinalizeGhlSmsOutboundOperationInput,
  type GhlSmsOutboundOperationClaimResult,
  type GhlSmsOutboundOperationIdentity,
  type TenantRecord,
} from "./repository";
import type { SmsFailureCode, SmsOutboundResult } from "../types/sms";
import { hmacSha256Fingerprint } from "../utils/hmacFingerprint";
import {
  normalizeTaiwanMobile,
  type NormalizedTaiwanMobile,
} from "../utils/taiwanPhone";

export interface GhlSmsProviderOutboundResponse {
  ok: boolean;
  status: "mocked" | "accepted" | "duplicate" | "failed";
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
  claimControlledLiveOperation?(
    input: ClaimGhlSmsOutboundOperationInput,
  ): Promise<GhlSmsOutboundOperationClaimResult>;
  consumeControlledLiveAuthorization?(
    input: ConsumeGhlSmsControlledLiveAuthorizationInput,
  ): Promise<boolean>;
  finalizeControlledLiveBeforeSend?(
    input: GhlSmsOutboundOperationIdentity & {
      state: "definitive_failed";
      failureCode: string;
    },
  ): Promise<boolean>;
  finalizeControlledLiveOperation?(
    input: FinalizeGhlSmsOutboundOperationInput,
  ): Promise<boolean>;
  createControlledLiveOutboundService?(input: {
    tenantId: string;
    locationId: string;
    provider: "every8d";
    providerMode: "controlled_live";
  }): Pick<SmsOutboundService, "send">;
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

function hasCompleteApprovedConfiguration(
  approvedDestination: NormalizedTaiwanMobile | null,
): approvedDestination is NormalizedTaiwanMobile {
  return (
    env.GHL_SMS_PHASE_2C_CONFIRMATION === GHL_SMS_PHASE_2C_CONFIRMATION &&
    Boolean(env.GHL_SMS_PHASE_2C_ALLOWED_LOCATION_ID.trim()) &&
    Boolean(env.GHL_SMS_PHASE_2C_ALLOWED_TENANT_ID.trim()) &&
    Boolean(env.GHL_SMS_PHASE_2C_ALLOWED_CONTACT_ID.trim()) &&
    approvedDestination !== null &&
    Boolean(env.GHL_SMS_PHASE_2C_ALLOWED_MESSAGE.trim()) &&
    Array.from(env.GHL_SMS_PHASE_2C_ALLOWED_MESSAGE).length <= 333
  );
}

function requestIsApproved(
  payload: GhlSmsProviderPayload,
  requestedDestination: NormalizedTaiwanMobile,
  approvedDestination: NormalizedTaiwanMobile,
): boolean {
  return (
    payload.locationId === env.GHL_SMS_PHASE_2C_ALLOWED_LOCATION_ID.trim() &&
    payload.contactId === env.GHL_SMS_PHASE_2C_ALLOWED_CONTACT_ID.trim() &&
    requestedDestination.canonicalE164 === approvedDestination.canonicalE164 &&
    payload.message === env.GHL_SMS_PHASE_2C_ALLOWED_MESSAGE
  );
}

function createEvery8dPhase2fControlledLiveOutboundService(input: {
  tenantId: string;
  locationId: string;
  provider: "every8d";
  providerMode: "controlled_live";
}): SmsOutboundService {
  const providerConfig = readEvery8dPhase2fProviderConfig();
  const providerFactory = createEvery8dPhase2fControlledLiveSmsProviderFactory({
    logger,
    tenantId: input.tenantId,
    locationId: input.locationId,
    credentials: providerConfig,
  });
  const configService = new SmsProviderConfigService([
    {
      configurationId: "phase-2f-controlled-live",
      tenantId: input.tenantId,
      locationId: input.locationId,
      provider: "every8d",
      providerMode: "controlled_live",
      enabled: true,
      credentials: providerConfig,
    },
  ]);

  return new SmsOutboundService({
    enabled: true,
    configService,
    providerFactories: { every8d: providerFactory },
    logger,
  });
}

async function processControlledLive(
  payload: GhlSmsProviderPayload,
  dependencies: GhlSmsProviderOutboundDependencies,
): Promise<GhlSmsProviderOutboundResult> {
  const config = readEvery8dPhase2fAuthorizationConfig();

  try {
    assertEvery8dPhase2fAuthorizationConfig(config);
  } catch (error) {
    const code =
      error instanceof Every8dPhase2fConfigurationError
        ? `phase_2f_${error.code}`
        : "phase_2f_configuration_invalid";
    return failureResult(503, code);
  }

  const approvedDestination = normalizeTaiwanMobile(config.allowedPhone);
  const requestedDestination = normalizeTaiwanMobile(payload.phone);

  if (!approvedDestination) {
    return failureResult(503, "phase_2f_configuration_invalid");
  }

  if (
    !requestedDestination ||
    payload.locationId !== config.allowedLocationId ||
    payload.contactId !== config.allowedContactId ||
    requestedDestination.canonicalE164 !== approvedDestination.canonicalE164 ||
    payload.message !== config.allowedMessage
  ) {
    return failureResult(403, "request_not_approved");
  }

  let tenantIds: string[];

  try {
    tenantIds = (await dependencies.getTenantIdsByLocationId(payload.locationId))
      .map((tenantId) => tenantId.trim())
      .filter(Boolean);
  } catch {
    return failureResult(503, "tenant_resolution_failed");
  }

  if (tenantIds.length === 0) {
    return failureResult(404, "location_not_onboarded");
  }

  if (tenantIds.length !== 1) {
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
    tenant.id !== config.allowedTenantId
  ) {
    return failureResult(409, "tenant_binding_invalid");
  }

  const claimControlled = dependencies.claimControlledLiveOperation;
  const consumeAuthorization =
    dependencies.consumeControlledLiveAuthorization;
  const finalizeBeforeSend = dependencies.finalizeControlledLiveBeforeSend;
  const finalizeAfterSend = dependencies.finalizeControlledLiveOperation;
  const createOutbound = dependencies.createControlledLiveOutboundService;

  if (
    !claimControlled ||
    !consumeAuthorization ||
    !finalizeBeforeSend ||
    !finalizeAfterSend ||
    !createOutbound
  ) {
    return failureResult(503, "phase_2f_runtime_unavailable");
  }

  let claim: GhlSmsOutboundOperationClaimResult;

  try {
    claim = await claimControlled({
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
  const finalizeBeforeProvider = async (
    failureCode: string,
  ): Promise<boolean> => {
    try {
      return await finalizeBeforeSend({
        ...operationIdentity,
        state: "definitive_failed",
        failureCode,
      });
    } catch {
      return false;
    }
  };
  const authorizationInput: ConsumeGhlSmsControlledLiveAuthorizationInput = {
    authorizationId: config.authorizationId,
    operationId: claim.operationId,
    tenantId: derivedTenantId,
    locationId: payload.locationId,
    contactId: payload.contactId,
    destinationFingerprint: hmacSha256Fingerprint(
      config.fingerprintSecret,
      "destination",
      requestedDestination.canonicalE164,
    ),
    messageFingerprint: hmacSha256Fingerprint(
      config.fingerprintSecret,
      "message",
      payload.message,
    ),
  };
  let authorized: boolean;

  try {
    authorized = await consumeAuthorization(authorizationInput);
  } catch {
    const finalized = await finalizeBeforeProvider(
      "authorization_rpc_failed",
    );
    return finalized
      ? failureResult(503, "authorization_rpc_failed")
      : failureResult(500, "sms_operation_finalization_failed");
  }

  if (!authorized) {
    const finalized = await finalizeBeforeProvider(
      "authorization_unavailable",
    );
    return finalized
      ? failureResult(409, "authorization_unavailable")
      : failureResult(500, "sms_operation_finalization_failed");
  }

  let outboundService: Pick<SmsOutboundService, "send">;

  try {
    outboundService = createOutbound({
      tenantId: derivedTenantId,
      locationId: payload.locationId,
      provider: "every8d",
      providerMode: "controlled_live",
    });
  } catch {
    let finalized = false;

    try {
      finalized = await finalizeAfterSend({
        ...operationIdentity,
        state: "definitive_failed",
        failureCode: "provider_configuration_invalid",
      });
    } catch {
      finalized = false;
    }

    return finalized
      ? failureResult(503, "provider_configuration_invalid", 1)
      : failureResult(500, "sms_operation_finalization_failed", 1);
  }

  let result: SmsOutboundResult;

  try {
    result = await outboundService.send({
      tenantId: derivedTenantId,
      locationId: payload.locationId,
      provider: "every8d",
      destination: requestedDestination.every8dNational,
      message: payload.message,
      reference: "issue-90-phase-2f-controlled-live",
    });
  } catch {
    result = {
      ok: false,
      tenantId: derivedTenantId,
      locationId: payload.locationId,
      provider: "every8d",
      providerAttempts: 1,
      failure: {
        code: "provider_failure",
        stage: "provider",
        retryable: false,
        retryAttempted: false,
      },
    };
  }

  if (!result.ok) {
    let finalized = false;

    try {
      finalized = await finalizeAfterSend({
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

    return finalized
      ? failureResult(502, result.failure.code, 1)
      : failureResult(500, "sms_operation_finalization_failed", 1);
  }

  let finalized = false;

  try {
    finalized = await finalizeAfterSend({
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
      status: "accepted",
      provider: "every8d",
      providerAttempts: 1,
      retryAttempted: false,
      error: "",
    },
  };
}

export function createGhlSmsProviderOutboundService(
  dependencies: GhlSmsProviderOutboundDependencies,
): (
  payload: GhlSmsProviderPayload,
) => Promise<GhlSmsProviderOutboundResult> {
  return async (payload) => {
    if (readEvery8dPhase2fAuthorizationConfig().enabled) {
      return processControlledLive(payload, dependencies);
    }

    if (!env.GHL_SMS_PHASE_2C_ENABLED) {
      return disabledResult();
    }

    const approvedDestination = normalizeTaiwanMobile(
      env.GHL_SMS_PHASE_2C_ALLOWED_PHONE,
    );

    if (!hasCompleteApprovedConfiguration(approvedDestination)) {
      return failureResult(503, "phase_2c_configuration_invalid");
    }

    const requestedDestination = normalizeTaiwanMobile(payload.phone);

    if (
      !requestedDestination ||
      !requestIsApproved(payload, requestedDestination, approvedDestination)
    ) {
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
      destination: requestedDestination.every8dNational,
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
    claimControlledLiveOperation:
      claimGhlSmsControlledLiveOutboundOperation,
    consumeControlledLiveAuthorization:
      consumeGhlSmsControlledLiveAuthorization,
    finalizeControlledLiveBeforeSend:
      finalizeGhlSmsControlledLiveOutboundOperationBeforeSend,
    finalizeControlledLiveOperation:
      finalizeGhlSmsControlledLiveOutboundOperation,
    createControlledLiveOutboundService:
      createEvery8dPhase2fControlledLiveOutboundService,
    logger,
  });
