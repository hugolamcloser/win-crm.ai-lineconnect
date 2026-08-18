import { logger as applicationLogger } from "../config/logger";
import {
  assertEvery8dPhase2bApproved,
  readEvery8dPhase2bConfig,
  Every8dPhase2bSafetyError,
  type Every8dPhase2bConfig,
} from "../config/every8dPhase2b";
import {
  createSanitizedEvery8dLogger,
  Every8dClientError,
  type Every8dLogger,
} from "../integrations/every8dClient";
import {
  createEvery8dPhase2bControlledLiveTransport,
  Every8dPhase2bControlledLiveSmsProviderFactory,
  type Every8dPhase2bControlledLiveTransport,
} from "../integrations/every8dSmsProvider";
import { SmsProviderConfigService } from "../services/smsProviderConfigService";
import { SmsOutboundService } from "../services/smsOutboundService";
import type { SmsOutboundResult } from "../types/sms";

const PHASE_2B_CONFIGURATION_ID = "issue-81-phase-2b-controlled";
const PHASE_2B_REFERENCE = "issue-81-phase-2b-controlled";

export interface RunEvery8dPhase2bOutboundValidationInput {
  config: Every8dPhase2bConfig;
  transport: Every8dPhase2bControlledLiveTransport;
  logger: Every8dLogger;
}

export async function runEvery8dPhase2bOutboundValidation(
  input: RunEvery8dPhase2bOutboundValidationInput,
): Promise<SmsOutboundResult> {
  assertEvery8dPhase2bApproved(input.config);

  const safeLogger = createSanitizedEvery8dLogger(input.logger);
  const configService = new SmsProviderConfigService([
    {
      configurationId: PHASE_2B_CONFIGURATION_ID,
      tenantId: input.config.approvedTenantId.trim(),
      locationId: input.config.approvedLocationId.trim(),
      provider: "every8d",
      enabled: true,
      credentials: {
        siteUrl: input.config.siteUrl.trim(),
        uid: input.config.uid,
        password: input.config.password,
        timeoutMs: input.config.timeoutMs,
      },
    },
  ]);
  const providerFactory =
    new Every8dPhase2bControlledLiveSmsProviderFactory({
      transport: input.transport,
      logger: safeLogger,
    });
  const outboundService = new SmsOutboundService({
    enabled: true,
    configService,
    providerFactories: { every8d: providerFactory },
    logger: safeLogger,
  });

  const result = await outboundService.send({
    tenantId: input.config.requestedTenantId.trim(),
    locationId: input.config.requestedLocationId.trim(),
    provider: input.config.provider.trim(),
    destination: input.config.requestedRecipient.trim(),
    message: input.config.message,
    reference: PHASE_2B_REFERENCE,
  });

  if (result.ok) {
    safeLogger.info(
      {
        outcome: "accepted",
        tenantId: result.tenantId,
        locationId: result.locationId,
        provider: result.provider,
        providerAttempts: result.providerAttempts,
        httpStatus: result.providerResult.httpStatus,
        sentCount: result.providerResult.sentCount,
        unsentCount: result.providerResult.unsentCount,
        cost: result.providerResult.cost,
        batchId: result.correlation.batchId,
        bid: result.correlation.bid,
        bidSource: result.correlation.bidSource,
      },
      "EVERY8D Phase 2B controlled outbound validation completed",
    );
  } else {
    safeLogger.error(
      {
        outcome: "failed",
        tenantId: result.tenantId,
        locationId: result.locationId,
        provider: result.provider,
        providerAttempts: result.providerAttempts,
        failureCode: result.failure.code,
        failureStage: result.failure.stage,
        providerOperation: result.failure.providerOperation,
        httpStatus: result.failure.httpStatus,
        providerStatus: result.failure.providerStatus,
        retryAttempted: result.failure.retryAttempted,
      },
      "EVERY8D Phase 2B controlled outbound validation stopped",
    );
  }

  return result;
}

function logRunnerFailure(logger: Every8dLogger, error: unknown): void {
  const safeLogger = createSanitizedEvery8dLogger(logger);

  if (error instanceof Every8dPhase2bSafetyError) {
    safeLogger.error(
      { failureType: "safety_gate", failureCode: error.code },
      "EVERY8D Phase 2B controlled outbound validation stopped",
    );
    return;
  }

  if (error instanceof Every8dClientError) {
    safeLogger.error(
      {
        failureType: "client",
        failureCode: error.code,
        operation: error.operation,
        httpStatus: error.httpStatus,
        providerStatus: error.providerStatus,
      },
      "EVERY8D Phase 2B controlled outbound validation stopped",
    );
    return;
  }

  safeLogger.error(
    { failureType: "unexpected", failureCode: "unexpected_failure" },
    "EVERY8D Phase 2B controlled outbound validation stopped",
  );
}

export async function main(): Promise<void> {
  try {
    const config = readEvery8dPhase2bConfig();

    assertEvery8dPhase2bApproved(config);

    const result = await runEvery8dPhase2bOutboundValidation({
      config,
      transport: createEvery8dPhase2bControlledLiveTransport(),
      logger: applicationLogger,
    });

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    logRunnerFailure(applicationLogger, error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
