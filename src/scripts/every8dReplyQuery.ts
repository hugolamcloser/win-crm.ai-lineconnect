import { logger as applicationLogger } from "../config/logger";
import {
  assertEvery8dReplyQueryApproved,
  Every8dReplyQuerySafetyError,
  readEvery8dReplyQueryConfig,
  type Every8dReplyQueryConfig
} from "../config/every8dReplyQuery";
import {
  createEvery8dFetchTransport,
  createSanitizedEvery8dLogger,
  Every8dClient,
  Every8dClientError,
  type Every8dLogger,
  type Every8dReplyMessagesResult,
  type Every8dTransport
} from "../integrations/every8dClient";
import { buildShortLogRef, hasLogValue } from "../utils/logPrivacy";

export interface RunEvery8dReplyQueryInput {
  config: Every8dReplyQueryConfig;
  transport: Every8dTransport;
  logger: Every8dLogger;
}

export async function runEvery8dReplyQuery(
  input: RunEvery8dReplyQueryInput
): Promise<Every8dReplyMessagesResult> {
  assertEvery8dReplyQueryApproved(input.config);

  const safeLogger = createSanitizedEvery8dLogger(input.logger);
  const client = new Every8dClient(input.config, input.transport, safeLogger);
  const authentication = await client.authenticate();
  const result = await client.getReplyMessages(
    authentication.token,
    input.config.batchId.trim(),
    input.config.pageNumber
  );

  safeLogger.info(
    {
      outcome: "existing_batch_replies_queried",
      batchId: input.config.batchId.trim(),
      bid: result.bid,
      smsCount: result.smsCount,
      pageNumber: input.config.pageNumber,
      mrContext: hasLogValue(input.config.mrContext) ? input.config.mrContext.trim() : undefined,
      eventIdContext: hasLogValue(input.config.eventIdContext)
        ? input.config.eventIdContext.trim()
        : undefined,
      replies: result.records.map((record) => ({
        senderRef: buildShortLogRef(record.mobile),
        replyRef: buildShortLogRef(record.content),
        replyPresent: hasLogValue(record.content),
        replyLength: typeof record.content === "string" ? Array.from(record.content).length : 0,
        receivedTime: record.receivedTime
      }))
    },
    "EVERY8D existing-batch reply query completed"
  );

  return result;
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
      "EVERY8D reply query stopped"
    );
    return;
  }

  if (error instanceof Every8dReplyQuerySafetyError) {
    safeLogger.error(
      { failureType: "safety_gate", errorCode: error.code },
      "EVERY8D reply query stopped"
    );
    return;
  }

  safeLogger.error(
    { failureType: "unexpected", errorCode: "unexpected_failure" },
    "EVERY8D reply query stopped"
  );
}

export async function main(): Promise<void> {
  try {
    await runEvery8dReplyQuery({
      config: readEvery8dReplyQueryConfig(),
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
