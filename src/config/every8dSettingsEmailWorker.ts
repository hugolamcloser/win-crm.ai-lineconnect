import { readEvery8dSettingsAuthConfig } from "./every8dSettingsAuth";
import type { Every8dSettingsAuthConfig } from "./every8dSettingsAuth";
import type { Every8dSettingsEmailOutboxEncryptionConfig } from "./every8dSettingsEmailOutbox";
import { normalizeEvery8dSettingsEmail } from "../services/every8dSettingsAuthPrimitives";
import {
  every8dSettingsEmailProviderRegistry,
  lookupEvery8dSettingsEmailProvider
} from "../services/every8dSettingsEmailProviderRegistry";
import type {
  Every8dSettingsEmailProviderRegistration,
  Every8dSettingsEmailProviderRegistry
} from "../services/every8dSettingsEmailProviderRegistry";

export class Every8dSettingsEmailWorkerConfigurationError extends Error {
  constructor() {
    super("EVERY8D settings email worker configuration is incomplete or invalid");
    this.name = "Every8dSettingsEmailWorkerConfigurationError";
  }
}

export type Every8dSettingsEmailWorkerConfig =
  | Readonly<{
      status: "disabled";
      auth: Every8dSettingsAuthConfig;
      providerId: string | undefined;
      canonicalSender: string | undefined;
    }>
  | Readonly<{
      /** Configuration admission only, not provider readiness or a running worker. */
      status: "operational";
      auth: Every8dSettingsAuthConfig;
      providerId: string;
      canonicalSender: string;
      emailOutboxEncryption: Every8dSettingsEmailOutboxEncryptionConfig;
      registration: Every8dSettingsEmailProviderRegistration;
    }>;

function invalidConfiguration(): never {
  throw new Every8dSettingsEmailWorkerConfigurationError();
}

function parseProviderId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  // Preserve the frozen identity contract without adding a character grammar.
  if (typeof value !== "string" || value.length === 0 || value.length > 32 ||
    value !== value.toLowerCase()) invalidConfiguration();
  return value;
}

function parseCanonicalSender(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== "string" || value !== normalizeEvery8dSettingsEmail(value)) {
      return invalidConfiguration();
    }
    return value;
  } catch {
    return invalidConfiguration();
  }
}

/** Pure configuration admission. No readiness parser, factory, worker or IO is invoked. */
export function readEvery8dSettingsEmailWorkerConfig(
  source: NodeJS.ProcessEnv = process.env,
  registry: Every8dSettingsEmailProviderRegistry = every8dSettingsEmailProviderRegistry
): Every8dSettingsEmailWorkerConfig {
  // This authority independently parses all three flags, HMAC and supplied encryption.
  const auth = readEvery8dSettingsAuthConfig(source);
  const providerId = parseProviderId(source.EVERY8D_SETTINGS_AUTH_EMAIL_PROVIDER);
  const canonicalSender = parseCanonicalSender(source.EVERY8D_SETTINGS_AUTH_EMAIL_FROM);
  const operational = auth.enabled && auth.httpEnabled && auth.emailDispatchEnabled;

  if (!operational) {
    return Object.freeze({ status: "disabled", auth, providerId, canonicalSender });
  }
  const emailOutboxEncryption = auth.emailOutboxEncryption;
  if (!auth.emailPseudonymHmac || !auth.otpHmac || !emailOutboxEncryption ||
    providerId === undefined || canonicalSender === undefined) invalidConfiguration();
  const registration = lookupEvery8dSettingsEmailProvider(providerId, registry);
  if (!registration) invalidConfiguration();
  return Object.freeze({ status: "operational", auth, providerId, canonicalSender,
    emailOutboxEncryption, registration });
}
