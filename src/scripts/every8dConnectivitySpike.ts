import { logger as applicationLogger } from "../config/logger";
import {
  assertEvery8dRealSendApproved,
  assertEvery8dSpikeActivated,
  readEvery8dSpikeConfig,
  type Every8dSpikeConfig,
  Every8dSpikeSafetyError
} from "../config/every8dSpike";
import {
  createEvery8dFetchTransport,
  createSanitizedEvery8dLogger,
  Every8dClient,
  Every8dClientError,
  type Every8dDeliveryStatusResult,
  type Every8dLogger,
  type Every8dSendSmsResult,
  type Every8dTransport
} from "../integrations/every8dClient";

export type Every8dSpikeResult =
  | {
      outcome: "authenticated_only";
      authenticationHttpStatus: number;
    }
  | {
      outcome: "sent_and_queried";
      authenticationHttpStatus: number;
      send: Every8dSendSmsResult;
      delivery: Every8dDeliveryStatusResult;
    };

export interface RunEvery8dConnectivitySpikeInput {
  config: Every8dSpikeConfig;
  transport: Every8dTransport;
  logger: Every8dLogger;
}

export async function runEvery8dConnectivitySpike(
  input: RunEvery8dConnectivitySpikeInput
): Promise<Every8dSpikeResult> {
  assertEvery8dSpikeActivated(input.config);

  if (input.config.sendEnabled) {
    assertEvery8dRealSendApproved(input.config);
  }

  const safeLogger = createSanitizedEvery8dLogger(input.logger);
  const client = new Every8dClient(input.config, input.transport, safeLogger);
  const authentication = await client.authenticate();

  if (!input.config.sendEnabled) {
    safeLogger.warn(
      { outcome: "authenticated_only", realSendEnabled: false },
      "EVERY8D authentication completed; real SMS send remained disabled"
    );
    return {
      outcome: "authenticated_only",
      authenticationHttpStatus: authentication.httpStatus
    };
  }

  const send = await client.sendSms({
    token: authentication.token,
    recipient: input.config.requestedRecipient.trim(),
    message: input.config.message.trim()
  });
  const delivery = await client.getDeliveryStatus(authentication.token, send.batchId);

  safeLogger.info(
    {
      outcome: "sent_and_queried",
      batchId: send.batchId,
      bid: delivery.bid,
      messageReferences: delivery.records.map((record) => record.mr).filter(Boolean),
      deliveryStates: delivery.records.map((record) => record.status).filter(Boolean)
    },
    "EVERY8D controlled connectivity spike completed"
  );

  return {
    outcome: "sent_and_queried",
    authenticationHttpStatus: authentication.httpStatus,
    send,
    delivery
  };
}

function logRunnerFailure(logger: Every8dLogger, error: unknown): void {
  const safeLogger = createSanitizedEvery8dLogger(logger);

  if (error instanceof Every8dClientError) {
    safeLogger.error(
      {
        failureType: "client",
        errorCode: error.code,
        operation: error.operation,
        httpStatus: error.httpStatus,
        providerStatus: error.providerStatus
      },
      "EVERY8D connectivity spike stopped"
    );
    return;
  }

  if (error instanceof Every8dSpikeSafetyError) {
    safeLogger.error(
      { failureType: "safety_gate", errorCode: error.code },
      "EVERY8D connectivity spike stopped"
    );
    return;
  }

  safeLogger.error(
    { failureType: "unexpected", errorCode: "unexpected_failure" },
    "EVERY8D connectivity spike stopped"
  );
}

export async function main(): Promise<void> {
  try {
    await runEvery8dConnectivitySpike({
      config: readEvery8dSpikeConfig(),
      transport: createEvery8dFetchTransport(),
      logger: applicationLogger
    });
  } catch (error) {
    logRunnerFailure(applicationLogger, error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
