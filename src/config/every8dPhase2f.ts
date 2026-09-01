export const EVERY8D_PHASE_2F_CONFIRMATION =
  "ENABLE_APPROVED_PHASE_2F_CONTROLLED_LIVE" as const;

export interface Every8dPhase2fAuthorizationConfig {
  enabled: boolean;
  sendEnabled: boolean;
  confirmation: string;
  networkConfirmed: boolean;
  allowedTenantId: string;
  allowedLocationId: string;
  allowedContactId: string;
  allowedPhone: string;
  allowedMessage: string;
  authorizationId: string;
  fingerprintSecret: string;
}

export type Every8dPhase2fConfigurationErrorCode =
  | "phase_2f_disabled"
  | "send_disabled"
  | "confirmation_invalid"
  | "network_unconfirmed"
  | "authorization_scope_invalid"
  | "authorization_id_invalid"
  | "fingerprint_secret_invalid"
  | "provider_configuration_invalid";

export class Every8dPhase2fConfigurationError extends Error {
  readonly code: Every8dPhase2fConfigurationErrorCode;

  constructor(code: Every8dPhase2fConfigurationErrorCode) {
    super(`EVERY8D Phase 2F configuration rejected: ${code}`);
    this.name = "Every8dPhase2fConfigurationError";
    this.code = code;
  }
}

function isExplicitlyEnabled(value: string | undefined): boolean {
  return value === "true";
}

function trimmed(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function readEvery8dPhase2fAuthorizationConfig(
  source: NodeJS.ProcessEnv = process.env,
): Every8dPhase2fAuthorizationConfig {
  return {
    enabled: isExplicitlyEnabled(source.GHL_SMS_PHASE_2F_ENABLED),
    sendEnabled: isExplicitlyEnabled(source.GHL_SMS_PHASE_2F_SEND_ENABLED),
    confirmation: source.GHL_SMS_PHASE_2F_CONFIRMATION ?? "",
    networkConfirmed: isExplicitlyEnabled(
      source.GHL_SMS_PHASE_2F_NETWORK_CONFIRMED,
    ),
    allowedTenantId: trimmed(source.GHL_SMS_PHASE_2F_ALLOWED_TENANT_ID),
    allowedLocationId: trimmed(source.GHL_SMS_PHASE_2F_ALLOWED_LOCATION_ID),
    allowedContactId: trimmed(source.GHL_SMS_PHASE_2F_ALLOWED_CONTACT_ID),
    allowedPhone: trimmed(source.GHL_SMS_PHASE_2F_ALLOWED_PHONE),
    allowedMessage: source.GHL_SMS_PHASE_2F_ALLOWED_MESSAGE ?? "",
    authorizationId: trimmed(source.GHL_SMS_PHASE_2F_AUTHORIZATION_ID),
    fingerprintSecret:
      source.GHL_SMS_PHASE_2F_FINGERPRINT_SECRET ?? "",
  };
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertEvery8dPhase2fAuthorizationConfig(
  config: Every8dPhase2fAuthorizationConfig,
): void {
  if (!config.enabled) {
    throw new Every8dPhase2fConfigurationError("phase_2f_disabled");
  }

  if (!config.sendEnabled) {
    throw new Every8dPhase2fConfigurationError("send_disabled");
  }

  if (config.confirmation !== EVERY8D_PHASE_2F_CONFIRMATION) {
    throw new Every8dPhase2fConfigurationError("confirmation_invalid");
  }

  if (!config.networkConfirmed) {
    throw new Every8dPhase2fConfigurationError("network_unconfirmed");
  }

  if (
    !uuidPattern.test(config.allowedTenantId) ||
    !config.allowedLocationId ||
    !config.allowedContactId ||
    !config.allowedPhone ||
    !config.allowedMessage.trim() ||
    Array.from(config.allowedMessage).length > 333
  ) {
    throw new Every8dPhase2fConfigurationError(
      "authorization_scope_invalid",
    );
  }

  if (!uuidPattern.test(config.authorizationId)) {
    throw new Every8dPhase2fConfigurationError("authorization_id_invalid");
  }

  if (Buffer.byteLength(config.fingerprintSecret, "utf8") < 32) {
    throw new Every8dPhase2fConfigurationError(
      "fingerprint_secret_invalid",
    );
  }
}

export interface Every8dPhase2fProviderConfig {
  siteUrl: string;
  uid: string;
  password: string;
  timeoutMs: number;
}

function parseProviderTimeout(value: string | undefined): number {
  if (!value?.trim()) {
    return 10_000;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 60_000) {
    throw new Every8dPhase2fConfigurationError(
      "provider_configuration_invalid",
    );
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

export function readEvery8dPhase2fProviderConfig(
  source: NodeJS.ProcessEnv = process.env,
): Every8dPhase2fProviderConfig {
  const config = {
    siteUrl: trimmed(source.EVERY8D_PHASE_2F_SITE_URL),
    uid: source.EVERY8D_PHASE_2F_UID ?? "",
    password: source.EVERY8D_PHASE_2F_PASSWORD ?? "",
    timeoutMs: parseProviderTimeout(source.EVERY8D_PHASE_2F_TIMEOUT_MS),
  };

  if (
    !isCredentialFreeHttpsOrigin(config.siteUrl) ||
    !config.uid.trim() ||
    !config.password
  ) {
    throw new Every8dPhase2fConfigurationError(
      "provider_configuration_invalid",
    );
  }

  return config;
}
