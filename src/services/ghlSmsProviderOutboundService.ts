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
  getTenantById,
  getTenantIdsByLocationId,
  type TenantRecord,
} from "./repository";

export interface GhlSmsProviderOutboundResponse {
  ok: boolean;
  status: "mocked" | "failed";
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

    let providerFactory: Every8dSmsProviderFactory;

    try {
      providerFactory = new Every8dSmsProviderFactory({
        transport: dependencies.createMockTransport(),
        logger: dependencies.logger,
      });
    } catch {
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
      return failureResult(502, result.failure.code, result.providerAttempts);
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
    createMockTransport: createEvery8dPhase2cMockTransport,
    logger,
  });
