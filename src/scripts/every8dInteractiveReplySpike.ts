import { logger as applicationLogger } from "../config/logger";
import {
  assertEvery8dInteractiveSendApproved,
  Every8dInteractiveSafetyError,
  readEvery8dInteractiveSpikeConfig,
  type Every8dInteractiveSpikeConfig
} from "../config/every8dInteractiveSpike";
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

export interface Every8dInteractiveSpikeResult {
  outcome: "interactive_sent_and_delivery_queried";
  eventId: string;
  send: Every8dSendSmsResult;
  delivery: Every8dDeliveryStatusResult;
}

export interface RunEvery8dInteractiveSpikeInput {
  config: Every8dInteractiveSpikeConfig;
  transport: Every8dTransport;
  logger: Every8dLogger;
}

export async function runEvery8dInteractiveReplySpike(
  input: RunEvery8dInteractiveSpikeInput
): Promise<Every8dInteractiveSpikeResult> {
  assertEvery8dInteractiveSendApproved(input.config);

  const safeLogger = createSanitizedEvery8dLogger(input.logger);
  const client = new Every8dClient(input.config, input.transport, safeLogger);
  const authentication = await client.authenticate();
  const eventId = input.config.eventId.trim();
  const send = await client.sendSms({
    token: authentication.token,
    recipient: input.config.requestedRecipient.trim(),
    message: input.config.message.trim(),
    eventId
  });
  const delivery = await client.getDeliveryStatus(authentication.token, send.batchId);

  safeLogger.info(
    {
      outcome: "interactive_sent_and_delivery_queried",
      eventId,
      batchId: send.batchId,
      bid: delivery.bid,
      mrValues: delivery.records.map((record) => record.mr).filter(Boolean),
      deliveryStates: delivery.records.map((record) => record.status).filter(Boolean),
      replyQueryExecuted: false
    },
    "EVERY8D controlled interactive-reply spike completed"
  );

  return {
    outcome: "interactive_sent_and_delivery_queried",
    eventId,
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
      "EVERY8D interactive-reply spike stopped"
    );
    return;
  }

  if (error instanceof Every8dInteractiveSafetyError) {
    safeLogger.error(
      { failureType: "safety_gate", errorCode: error.code },
      "EVERY8D interactive-reply spike stopped"
    );
    return;
  }

  safeLogger.error(
    { failureType: "unexpected", errorCode: "unexpected_failure" },
    "EVERY8D interactive-reply spike stopped"
  );
}

export async function main(): Promise<void> {
  try {
    await runEvery8dInteractiveReplySpike({
      config: readEvery8dInteractiveSpikeConfig(),
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
