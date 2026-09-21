import { parseEvery8dGhlOAuthEncryptionKeys, type Every8dGhlOAuthEncryptionKeys } from "../services/every8dGhlTokenEncryption";

const defaultTokenUrl = "https://services.leadconnectorhq.com/oauth/token";
const defaultStateTtlSeconds = 600;
const exactIdentifierPattern = /^[A-Za-z0-9_.-]{1,256}$/;

export type Every8dGhlOAuthConfig = {
  enabled: boolean;
  marketplaceAppId: string;
  oauthClientId: string;
  oauthClientSecret: string;
  redirectUri: string;
  installationUrl: string;
  tokenUrl: string;
  conversationProviderId: string;
  requiredScopes: string[];
  stateTtlSeconds: number;
  activeKeyVersion: string;
  encryptionKeys: Every8dGhlOAuthEncryptionKeys;
};

export class Every8dGhlOAuthConfigurationError extends Error {
  constructor() {
    super("EVERY8D HighLevel OAuth configuration is incomplete or invalid");
    this.name = "Every8dGhlOAuthConfigurationError";
  }
}

function trimmed(value: string | undefined): string {
  return value?.trim() ?? "";
}

function parseScopes(value: string | undefined): string[] {
  return Array.from(new Set(
    trimmed(value)
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean)
  )).sort();
}

function isExactHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}

export function readEvery8dGhlOAuthConfig(
  source: NodeJS.ProcessEnv = process.env
): Every8dGhlOAuthConfig {
  const enabled = source.EVERY8D_GHL_OAUTH_ENABLED === "true";
  const encryptionKeysValue = trimmed(source.EVERY8D_GHL_OAUTH_ENCRYPTION_KEYS);
  let encryptionKeys: Every8dGhlOAuthEncryptionKeys = new Map();

  if (enabled && encryptionKeysValue) {
    try {
      encryptionKeys = parseEvery8dGhlOAuthEncryptionKeys(encryptionKeysValue);
    } catch {
      throw new Every8dGhlOAuthConfigurationError();
    }
  }

  return {
    enabled,
    marketplaceAppId: trimmed(source.EVERY8D_GHL_MARKETPLACE_APP_ID),
    oauthClientId: trimmed(source.EVERY8D_GHL_OAUTH_CLIENT_ID),
    oauthClientSecret: source.EVERY8D_GHL_OAUTH_CLIENT_SECRET ?? "",
    redirectUri: trimmed(source.EVERY8D_GHL_OAUTH_REDIRECT_URI),
    installationUrl: trimmed(source.EVERY8D_GHL_OAUTH_INSTALLATION_URL),
    tokenUrl: trimmed(source.EVERY8D_GHL_OAUTH_TOKEN_URL) || defaultTokenUrl,
    conversationProviderId: trimmed(source.EVERY8D_GHL_CONVERSATION_PROVIDER_ID),
    requiredScopes: parseScopes(source.EVERY8D_GHL_OAUTH_REQUIRED_SCOPES),
    stateTtlSeconds: defaultStateTtlSeconds,
    activeKeyVersion: trimmed(source.EVERY8D_GHL_OAUTH_ACTIVE_KEY_VERSION),
    encryptionKeys
  };
}

export function assertEvery8dGhlOAuthConfig(config: Every8dGhlOAuthConfig): void {
  if (!config.enabled) {
    throw new Every8dGhlOAuthConfigurationError();
  }

  if (
    !exactIdentifierPattern.test(config.marketplaceAppId) ||
    !exactIdentifierPattern.test(config.oauthClientId) ||
    !config.oauthClientSecret ||
    !exactIdentifierPattern.test(config.conversationProviderId) ||
    !isExactHttpsUrl(config.redirectUri) ||
    !isExactHttpsUrl(config.installationUrl) ||
    !isExactHttpsUrl(config.tokenUrl) ||
    config.requiredScopes.length === 0 ||
    !exactIdentifierPattern.test(config.activeKeyVersion) ||
    !config.encryptionKeys.has(config.activeKeyVersion) ||
    config.stateTtlSeconds <= 0 ||
    config.stateTtlSeconds > 900
  ) {
    throw new Every8dGhlOAuthConfigurationError();
  }
}
