import {
  Every8dClientError,
  type Every8dClientConfig,
} from "../integrations/every8dClient";

export const EVERY8D_PHASE_2B_SEND_CONFIRMATION =
  "SEND_ONE_PHASE_2B_APPROVED_SMS" as const;
export const EVERY8D_PHASE_2B_APPROVED_MESSAGE =
  "WinCRM EVERY8D Phase 2B 測試簡訊，收到請忽略。" as const;
export const EVERY8D_PHASE_2B_PROVIDER = "every8d" as const;

const taiwanNationalMobilePattern = /^09\d{8}$/;

export interface Every8dPhase2bConfig extends Every8dClientConfig {
  phase2bEnabled: boolean;
  sendEnabled: boolean;
  sendConfirmation: string;
  approvedTenantId: string;
  approvedLocationId: string;
  requestedTenantId: string;
  requestedLocationId: string;
  provider: string;
  approvedRecipient: string;
  requestedRecipient: string;
  message: string;
  legacySpikeSendEnabled: boolean;
  interactiveSendEnabled: boolean;
}

export type Every8dPhase2bSafetyErrorCode =
  | "phase_2b_disabled"
  | "send_disabled"
  | "send_confirmation_invalid"
  | "tenant_id_missing"
  | "location_id_missing"
  | "tenant_not_approved"
  | "location_not_approved"
  | "provider_invalid"
  | "recipient_missing"
  | "recipient_invalid"
  | "recipient_not_approved"
  | "message_not_approved"
  | "provider_configuration_invalid"
  | "conflicting_send_path_enabled";

export class Every8dPhase2bSafetyError extends Error {
  readonly code: Every8dPhase2bSafetyErrorCode;

  constructor(code: Every8dPhase2bSafetyErrorCode, message: string) {
    super(message);
    this.name = "Every8dPhase2bSafetyError";
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
      message: "EVERY8D_TIMEOUT_MS must be between 100 and 60000",
    });
  }

  return parsed;
}

function isCredentialFreeHttpsOrigin(value: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return (
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    !parsed.search &&
    !parsed.hash &&
    (parsed.pathname === "/" || parsed.pathname === "")
  );
}

export function readEvery8dPhase2bConfig(
  source: NodeJS.ProcessEnv = process.env,
): Every8dPhase2bConfig {
  return {
    siteUrl: source.EVERY8D_SITE_URL ?? "",
    uid: source.EVERY8D_UID ?? "",
    password: source.EVERY8D_PASSWORD ?? "",
    timeoutMs: parseTimeout(source.EVERY8D_TIMEOUT_MS),
    phase2bEnabled: isExplicitlyEnabled(source.EVERY8D_PHASE_2B_ENABLED),
    sendEnabled: isExplicitlyEnabled(source.EVERY8D_PHASE_2B_SEND_ENABLED),
    sendConfirmation:
      source.EVERY8D_PHASE_2B_SEND_CONFIRMATION ?? "",
    approvedTenantId:
      source.EVERY8D_PHASE_2B_APPROVED_TENANT_ID ?? "",
    approvedLocationId:
      source.EVERY8D_PHASE_2B_APPROVED_LOCATION_ID ?? "",
    requestedTenantId: source.EVERY8D_PHASE_2B_TENANT_ID ?? "",
    requestedLocationId: source.EVERY8D_PHASE_2B_LOCATION_ID ?? "",
    provider: source.EVERY8D_PHASE_2B_PROVIDER ?? "",
    approvedRecipient:
      source.EVERY8D_PHASE_2B_APPROVED_RECIPIENT ?? "",
    requestedRecipient: source.EVERY8D_PHASE_2B_RECIPIENT ?? "",
    message: source.EVERY8D_PHASE_2B_MESSAGE ?? "",
    legacySpikeSendEnabled: isExplicitlyEnabled(
      source.EVERY8D_SPIKE_SEND_ENABLED,
    ),
    interactiveSendEnabled: isExplicitlyEnabled(
      source.EVERY8D_INTERACTIVE_SEND_ENABLED,
    ),
  };
}

export function assertEvery8dPhase2bApproved(
  config: Every8dPhase2bConfig,
): void {
  if (!config.phase2bEnabled) {
    throw new Every8dPhase2bSafetyError(
      "phase_2b_disabled",
      "EVERY8D Phase 2B controlled runtime is disabled",
    );
  }

  if (!config.sendEnabled) {
    throw new Every8dPhase2bSafetyError(
      "send_disabled",
      "EVERY8D Phase 2B controlled send is disabled",
    );
  }

  if (config.sendConfirmation !== EVERY8D_PHASE_2B_SEND_CONFIRMATION) {
    throw new Every8dPhase2bSafetyError(
      "send_confirmation_invalid",
      "EVERY8D Phase 2B requires the exact approval confirmation",
    );
  }

  if (config.legacySpikeSendEnabled || config.interactiveSendEnabled) {
    throw new Every8dPhase2bSafetyError(
      "conflicting_send_path_enabled",
      "Another EVERY8D controlled send path is enabled",
    );
  }

  const approvedTenantId = config.approvedTenantId.trim();
  const requestedTenantId = config.requestedTenantId.trim();
  const approvedLocationId = config.approvedLocationId.trim();
  const requestedLocationId = config.requestedLocationId.trim();

  if (!approvedTenantId || !requestedTenantId) {
    throw new Every8dPhase2bSafetyError(
      "tenant_id_missing",
      "Approved and requested tenant identities are required",
    );
  }

  if (!approvedLocationId || !requestedLocationId) {
    throw new Every8dPhase2bSafetyError(
      "location_id_missing",
      "Approved and requested location identities are required",
    );
  }

  if (requestedTenantId !== approvedTenantId) {
    throw new Every8dPhase2bSafetyError(
      "tenant_not_approved",
      "Requested tenant does not match the approved tenant",
    );
  }

  if (requestedLocationId !== approvedLocationId) {
    throw new Every8dPhase2bSafetyError(
      "location_not_approved",
      "Requested location does not match the approved location",
    );
  }

  if (config.provider !== EVERY8D_PHASE_2B_PROVIDER) {
    throw new Every8dPhase2bSafetyError(
      "provider_invalid",
      "EVERY8D Phase 2B accepts only the EVERY8D provider",
    );
  }

  const approvedRecipient = config.approvedRecipient;
  const requestedRecipient = config.requestedRecipient;

  if (!approvedRecipient || !requestedRecipient) {
    throw new Every8dPhase2bSafetyError(
      "recipient_missing",
      "Approved and requested recipients are required",
    );
  }

  if (
    !taiwanNationalMobilePattern.test(approvedRecipient) ||
    !taiwanNationalMobilePattern.test(requestedRecipient)
  ) {
    throw new Every8dPhase2bSafetyError(
      "recipient_invalid",
      "EVERY8D Phase 2B accepts one Taiwan mobile in 09xxxxxxxx format",
    );
  }

  if (requestedRecipient !== approvedRecipient) {
    throw new Every8dPhase2bSafetyError(
      "recipient_not_approved",
      "Requested recipient does not match the approved recipient",
    );
  }

  if (config.message !== EVERY8D_PHASE_2B_APPROVED_MESSAGE) {
    throw new Every8dPhase2bSafetyError(
      "message_not_approved",
      "EVERY8D Phase 2B requires the exact reviewed test message",
    );
  }

  if (
    !isCredentialFreeHttpsOrigin(config.siteUrl.trim()) ||
    !config.uid.trim() ||
    !config.password.trim() ||
    !Number.isSafeInteger(config.timeoutMs) ||
    config.timeoutMs < 100 ||
    config.timeoutMs > 60_000
  ) {
    throw new Every8dPhase2bSafetyError(
      "provider_configuration_invalid",
      "Complete valid runtime-only EVERY8D configuration is required",
    );
  }
}
