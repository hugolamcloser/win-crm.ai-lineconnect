import { Every8dClientError, type Every8dClientConfig } from "../integrations/every8dClient";

export const EVERY8D_SEND_CONFIRMATION = "SEND_ONE_APPROVED_SMS";
export const EVERY8D_MAX_CONTROLLED_MESSAGE_CHARACTERS = 70;

export interface Every8dSpikeConfig extends Every8dClientConfig {
  spikeEnabled: boolean;
  sendEnabled: boolean;
  sendConfirmation: string;
  approvedRecipient: string;
  requestedRecipient: string;
  message: string;
}

export type Every8dSpikeSafetyErrorCode =
  | "spike_disabled"
  | "send_confirmation_missing"
  | "approved_recipient_missing"
  | "requested_recipient_missing"
  | "recipient_not_approved"
  | "bulk_recipient_rejected"
  | "message_missing"
  | "message_too_long";

export class Every8dSpikeSafetyError extends Error {
  readonly code: Every8dSpikeSafetyErrorCode;

  constructor(code: Every8dSpikeSafetyErrorCode, message: string) {
    super(message);
    this.name = "Every8dSpikeSafetyError";
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

export function readEvery8dSpikeConfig(
  source: NodeJS.ProcessEnv = process.env
): Every8dSpikeConfig {
  return {
    siteUrl: source.EVERY8D_SITE_URL ?? "",
    uid: source.EVERY8D_UID ?? "",
    password: source.EVERY8D_PASSWORD ?? "",
    timeoutMs: parseTimeout(source.EVERY8D_TIMEOUT_MS),
    spikeEnabled: isExplicitlyEnabled(source.EVERY8D_SPIKE_ENABLED),
    sendEnabled: isExplicitlyEnabled(source.EVERY8D_SPIKE_SEND_ENABLED),
    sendConfirmation: source.EVERY8D_SPIKE_SEND_CONFIRMATION ?? "",
    approvedRecipient: source.EVERY8D_APPROVED_RECIPIENT ?? "",
    requestedRecipient: source.EVERY8D_SPIKE_RECIPIENT ?? "",
    message: source.EVERY8D_SPIKE_MESSAGE ?? ""
  };
}

export function assertEvery8dSpikeActivated(config: Every8dSpikeConfig): void {
  if (!config.spikeEnabled) {
    throw new Every8dSpikeSafetyError(
      "spike_disabled",
      "EVERY8D connectivity spike is disabled; set EVERY8D_SPIKE_ENABLED=true deliberately"
    );
  }
}

export function assertEvery8dRealSendApproved(config: Every8dSpikeConfig): void {
  if (!config.sendEnabled || config.sendConfirmation !== EVERY8D_SEND_CONFIRMATION) {
    throw new Every8dSpikeSafetyError(
      "send_confirmation_missing",
      "EVERY8D real send requires the explicit send flag and confirmation phrase"
    );
  }

  const approvedRecipient = config.approvedRecipient.trim();
  const requestedRecipient = config.requestedRecipient.trim();

  if (!approvedRecipient) {
    throw new Every8dSpikeSafetyError(
      "approved_recipient_missing",
      "EVERY8D_APPROVED_RECIPIENT is required for a controlled send"
    );
  }

  if (!requestedRecipient) {
    throw new Every8dSpikeSafetyError(
      "requested_recipient_missing",
      "EVERY8D_SPIKE_RECIPIENT is required for a controlled send"
    );
  }

  if (/[,;\r\n]/.test(approvedRecipient) || /[,;\r\n]/.test(requestedRecipient)) {
    throw new Every8dSpikeSafetyError(
      "bulk_recipient_rejected",
      "EVERY8D controlled send accepts exactly one recipient"
    );
  }

  if (requestedRecipient !== approvedRecipient) {
    throw new Every8dSpikeSafetyError(
      "recipient_not_approved",
      "EVERY8D requested recipient does not exactly match the approved recipient"
    );
  }

  const message = config.message.trim();

  if (!message) {
    throw new Every8dSpikeSafetyError(
      "message_missing",
      "EVERY8D_SPIKE_MESSAGE is required for a controlled send"
    );
  }

  if (Array.from(message).length > EVERY8D_MAX_CONTROLLED_MESSAGE_CHARACTERS) {
    throw new Every8dSpikeSafetyError(
      "message_too_long",
      `EVERY8D controlled message must not exceed ${EVERY8D_MAX_CONTROLLED_MESSAGE_CHARACTERS} characters`
    );
  }
}
