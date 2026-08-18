import { Every8dClientError, type Every8dClientConfig } from "../integrations/every8dClient";

export const EVERY8D_INTERACTIVE_CONFIRMATION = "SEND_ONE_APPROVED_INTERACTIVE_SMS";
export const EVERY8D_DEFAULT_INTERACTIVE_EVENT_ID = "-1";
export const EVERY8D_MAX_INTERACTIVE_MESSAGE_CHARACTERS = 53;

export interface Every8dInteractiveSpikeConfig extends Every8dClientConfig {
  interactiveEnabled: boolean;
  sendEnabled: boolean;
  sendConfirmation: string;
  eventId: string;
  approvedRecipient: string;
  requestedRecipient: string;
  message: string;
  ordinarySendEnabled: boolean;
  replyQueryEnabled: boolean;
}

export type Every8dInteractiveSafetyErrorCode =
  | "interactive_disabled"
  | "send_confirmation_missing"
  | "event_id_not_allowed"
  | "approved_recipient_missing"
  | "requested_recipient_missing"
  | "recipient_not_approved"
  | "bulk_recipient_rejected"
  | "message_missing"
  | "message_too_long"
  | "ordinary_send_enabled"
  | "reply_query_enabled";

export class Every8dInteractiveSafetyError extends Error {
  readonly code: Every8dInteractiveSafetyErrorCode;

  constructor(code: Every8dInteractiveSafetyErrorCode, message: string) {
    super(message);
    this.name = "Every8dInteractiveSafetyError";
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

export function readEvery8dInteractiveSpikeConfig(
  source: NodeJS.ProcessEnv = process.env
): Every8dInteractiveSpikeConfig {
  return {
    siteUrl: source.EVERY8D_SITE_URL ?? "",
    uid: source.EVERY8D_UID ?? "",
    password: source.EVERY8D_PASSWORD ?? "",
    timeoutMs: parseTimeout(source.EVERY8D_TIMEOUT_MS),
    interactiveEnabled: isExplicitlyEnabled(source.EVERY8D_INTERACTIVE_ENABLED),
    sendEnabled: isExplicitlyEnabled(source.EVERY8D_INTERACTIVE_SEND_ENABLED),
    sendConfirmation: source.EVERY8D_INTERACTIVE_CONFIRMATION ?? "",
    eventId: source.EVERY8D_INTERACTIVE_EVENT_ID ?? "",
    approvedRecipient: source.EVERY8D_APPROVED_RECIPIENT ?? "",
    requestedRecipient: source.EVERY8D_INTERACTIVE_RECIPIENT ?? "",
    message: source.EVERY8D_INTERACTIVE_MESSAGE ?? "",
    ordinarySendEnabled: isExplicitlyEnabled(source.EVERY8D_SPIKE_SEND_ENABLED),
    replyQueryEnabled: isExplicitlyEnabled(source.EVERY8D_REPLY_QUERY_ENABLED)
  };
}

export function assertEvery8dInteractiveSendApproved(
  config: Every8dInteractiveSpikeConfig
): void {
  if (!config.interactiveEnabled) {
    throw new Every8dInteractiveSafetyError(
      "interactive_disabled",
      "EVERY8D interactive spike is disabled; set EVERY8D_INTERACTIVE_ENABLED=true deliberately"
    );
  }

  if (
    !config.sendEnabled ||
    config.sendConfirmation !== EVERY8D_INTERACTIVE_CONFIRMATION
  ) {
    throw new Every8dInteractiveSafetyError(
      "send_confirmation_missing",
      "EVERY8D interactive send requires the explicit send flag and confirmation phrase"
    );
  }

  if (config.eventId.trim() !== EVERY8D_DEFAULT_INTERACTIVE_EVENT_ID) {
    throw new Every8dInteractiveSafetyError(
      "event_id_not_allowed",
      "The controlled interactive test permits only the documented default EventID -1"
    );
  }

  if (config.ordinarySendEnabled) {
    throw new Every8dInteractiveSafetyError(
      "ordinary_send_enabled",
      "Disable EVERY8D_SPIKE_SEND_ENABLED before an interactive send"
    );
  }

  if (config.replyQueryEnabled) {
    throw new Every8dInteractiveSafetyError(
      "reply_query_enabled",
      "Disable EVERY8D_REPLY_QUERY_ENABLED before an interactive send"
    );
  }

  const approvedRecipient = config.approvedRecipient.trim();
  const requestedRecipient = config.requestedRecipient.trim();

  if (!approvedRecipient) {
    throw new Every8dInteractiveSafetyError(
      "approved_recipient_missing",
      "EVERY8D_APPROVED_RECIPIENT is required for a controlled interactive send"
    );
  }

  if (!requestedRecipient) {
    throw new Every8dInteractiveSafetyError(
      "requested_recipient_missing",
      "EVERY8D_INTERACTIVE_RECIPIENT is required for a controlled interactive send"
    );
  }

  if (/[,;\r\n]/.test(approvedRecipient) || /[,;\r\n]/.test(requestedRecipient)) {
    throw new Every8dInteractiveSafetyError(
      "bulk_recipient_rejected",
      "EVERY8D controlled interactive send accepts exactly one recipient"
    );
  }

  if (requestedRecipient !== approvedRecipient) {
    throw new Every8dInteractiveSafetyError(
      "recipient_not_approved",
      "EVERY8D interactive recipient does not exactly match the approved recipient"
    );
  }

  const message = config.message.trim();

  if (!message) {
    throw new Every8dInteractiveSafetyError(
      "message_missing",
      "EVERY8D_INTERACTIVE_MESSAGE is required for a controlled interactive send"
    );
  }

  if (Array.from(message).length > EVERY8D_MAX_INTERACTIVE_MESSAGE_CHARACTERS) {
    throw new Every8dInteractiveSafetyError(
      "message_too_long",
      `EVERY8D interactive message must not exceed ${EVERY8D_MAX_INTERACTIVE_MESSAGE_CHARACTERS} characters before provider link insertion`
    );
  }
}
