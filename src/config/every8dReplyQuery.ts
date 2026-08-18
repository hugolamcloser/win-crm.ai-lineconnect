import { Every8dClientError, type Every8dClientConfig } from "../integrations/every8dClient";

export const EVERY8D_REPLY_QUERY_CONFIRMATION = "QUERY_EXISTING_BATCH_REPLIES";

export interface Every8dReplyQueryConfig extends Every8dClientConfig {
  queryEnabled: boolean;
  queryConfirmation: string;
  batchId: string;
  pageNumber: number;
  mrContext: string;
  eventIdContext: string;
  outboundSendEnabled: boolean;
}

export type Every8dReplyQuerySafetyErrorCode =
  | "query_disabled"
  | "query_confirmation_missing"
  | "batch_id_missing"
  | "page_not_allowed"
  | "outbound_send_enabled";

export class Every8dReplyQuerySafetyError extends Error {
  readonly code: Every8dReplyQuerySafetyErrorCode;

  constructor(code: Every8dReplyQuerySafetyErrorCode, message: string) {
    super(message);
    this.name = "Every8dReplyQuerySafetyError";
    this.code = code;
  }
}

function isExplicitlyEnabled(value: string | undefined): boolean {
  return value === "true";
}

function parseTimeout(value: string | undefined): number {
  if (!value?.trim()) {
    return 10_000;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 60_000) {
    throw new Every8dClientError({
      code: "invalid_configuration",
      operation: "authenticate",
      message: "EVERY8D_TIMEOUT_MS must be between 100 and 60000"
    });
  }

  return parsed;
}

function parsePageNumber(value: string | undefined): number {
  if (!value?.trim()) {
    return 1;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Every8dReplyQuerySafetyError(
      "page_not_allowed",
      "EVERY8D_REPLY_QUERY_PAGE must be the controlled page 1"
    );
  }

  return parsed;
}

export function readEvery8dReplyQueryConfig(
  source: NodeJS.ProcessEnv = process.env
): Every8dReplyQueryConfig {
  return {
    siteUrl: source.EVERY8D_SITE_URL ?? "",
    uid: source.EVERY8D_UID ?? "",
    password: source.EVERY8D_PASSWORD ?? "",
    timeoutMs: parseTimeout(source.EVERY8D_TIMEOUT_MS),
    queryEnabled: isExplicitlyEnabled(source.EVERY8D_REPLY_QUERY_ENABLED),
    queryConfirmation: source.EVERY8D_REPLY_QUERY_CONFIRMATION ?? "",
    batchId: source.EVERY8D_REPLY_QUERY_BATCH_ID ?? "",
    pageNumber: parsePageNumber(source.EVERY8D_REPLY_QUERY_PAGE),
    mrContext: source.EVERY8D_REPLY_QUERY_MR ?? "",
    eventIdContext: source.EVERY8D_REPLY_QUERY_EVENT_ID ?? "",
    outboundSendEnabled: isExplicitlyEnabled(source.EVERY8D_SPIKE_SEND_ENABLED)
  };
}

export function assertEvery8dReplyQueryApproved(config: Every8dReplyQueryConfig): void {
  if (!config.queryEnabled) {
    throw new Every8dReplyQuerySafetyError(
      "query_disabled",
      "EVERY8D reply query is disabled; set EVERY8D_REPLY_QUERY_ENABLED=true deliberately"
    );
  }

  if (config.queryConfirmation !== EVERY8D_REPLY_QUERY_CONFIRMATION) {
    throw new Every8dReplyQuerySafetyError(
      "query_confirmation_missing",
      "EVERY8D reply query requires the exact confirmation phrase"
    );
  }

  if (!config.batchId.trim()) {
    throw new Every8dReplyQuerySafetyError(
      "batch_id_missing",
      "EVERY8D_REPLY_QUERY_BATCH_ID is required"
    );
  }

  if (config.pageNumber !== 1) {
    throw new Every8dReplyQuerySafetyError(
      "page_not_allowed",
      "The controlled reply query is restricted to page 1"
    );
  }

  if (config.outboundSendEnabled) {
    throw new Every8dReplyQuerySafetyError(
      "outbound_send_enabled",
      "Disable EVERY8D_SPIKE_SEND_ENABLED before querying replies"
    );
  }
}
