import crypto from "node:crypto";
import {
  assertEvery8dGhlOAuthConfig,
  every8dGhlOAuthTokenUrl,
  Every8dGhlOAuthConfigurationError,
  readEvery8dGhlOAuthConfig,
  type Every8dGhlOAuthConfig
} from "../config/every8dGhlOAuth";
import {
  every8dGhlOAuthRepository,
  type Every8dGhlMarketplaceInstallation,
  type Every8dGhlOAuthRepository,
  type Every8dGhlOAuthState
} from "./every8dGhlOAuthRepository";
import { encryptEvery8dGhlOAuthToken } from "./every8dGhlTokenEncryption";

const tokenExchangeTimeoutMs = 15_000;
const maximumTokenResponseBytes = 64 * 1024;
const secretLength = 32;
const maximumAuthorizationValueLength = 4096;

export type Every8dGhlOAuthErrorCode =
  | "oauth_disabled"
  | "oauth_configuration_invalid"
  | "oauth_request_invalid"
  | "installation_not_eligible"
  | "oauth_state_invalid"
  | "token_exchange_failed"
  | "token_response_rejected"
  | "credential_persistence_failed";

export class Every8dGhlOAuthError extends Error {
  readonly code: Every8dGhlOAuthErrorCode;

  constructor(code: Every8dGhlOAuthErrorCode, message: string) {
    super(message);
    this.name = "Every8dGhlOAuthError";
    this.code = code;
  }
}

type Every8dGhlLocationTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
  userType: "Location";
  locationId: string;
  companyId: string;
};

type Every8dGhlOAuthRuntimeDependencies = {
  config: Every8dGhlOAuthConfig;
  repository: Every8dGhlOAuthRepository;
  exchangeAuthorizationCode(input: {
    code: string;
    config: Every8dGhlOAuthConfig;
  }): Promise<unknown>;
  now(): number;
  randomBytes(size: number): Buffer;
};

function oauthError(code: Every8dGhlOAuthErrorCode, message: string): Every8dGhlOAuthError {
  return new Every8dGhlOAuthError(code, message);
}

function requireEnabled(config: Every8dGhlOAuthConfig): void {
  if (!config.enabled) {
    throw oauthError("oauth_disabled", "EVERY8D Connect OAuth is disabled");
  }

  try {
    assertEvery8dGhlOAuthConfig(config);
  } catch (error) {
    if (error instanceof Every8dGhlOAuthConfigurationError) {
      throw oauthError("oauth_configuration_invalid", "EVERY8D Connect OAuth configuration is invalid");
    }
    throw error;
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function validRequestValue(value: string): boolean {
  return value.length > 0 && value.length <= maximumAuthorizationValueLength;
}

function installationMatches(input: {
  installation: Every8dGhlMarketplaceInstallation;
  config: Every8dGhlOAuthConfig;
  installationId: string;
  tenantId?: string;
  locationId?: string;
  installationGeneration?: number;
}): boolean {
  const { installation, config } = input;
  return (
    installation.id === input.installationId &&
    installation.app_namespace === "every8d_connect" &&
    installation.marketplace_app_id === config.marketplaceAppId &&
    installation.oauth_client_id === config.oauthClientId &&
    Boolean(installation.tenant_id) &&
    Boolean(installation.location_id) &&
    Boolean(installation.company_id) &&
    (input.tenantId === undefined || installation.tenant_id === input.tenantId) &&
    (input.locationId === undefined || installation.location_id === input.locationId) &&
    installation.conversation_provider_id === config.conversationProviderId &&
    installation.channel === "sms" &&
    installation.provider === "every8d" &&
    (installation.status === "pending" || installation.status === "active") &&
    Number.isSafeInteger(installation.installation_generation) &&
    installation.installation_generation > 0 &&
    (input.installationGeneration === undefined ||
      installation.installation_generation === input.installationGeneration)
  );
}

async function requireInstallation(input: {
  repository: Every8dGhlOAuthRepository;
  config: Every8dGhlOAuthConfig;
  installationId: string;
  tenantId?: string;
  locationId?: string;
  installationGeneration?: number;
}): Promise<Every8dGhlMarketplaceInstallation> {
  const installation = await input.repository.getEligibleInstallation({
    installationId: input.installationId,
    marketplaceAppId: input.config.marketplaceAppId,
    oauthClientId: input.config.oauthClientId,
    tenantId: input.tenantId,
    locationId: input.locationId,
    conversationProviderId: input.config.conversationProviderId,
    installationGeneration: input.installationGeneration
  });

  if (!installation || !installationMatches({ ...input, installation })) {
    throw oauthError("installation_not_eligible", "EVERY8D Connect installation is not eligible");
  }

  return installation;
}

function normalizeScopes(value: unknown): string[] | null {
  const rawScopes = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s+/)
      : null;

  if (!rawScopes || rawScopes.some((scope) => typeof scope !== "string" || !scope.trim())) {
    return null;
  }

  return Array.from(new Set(rawScopes.map((scope) => String(scope).trim()))).sort();
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameTimestampInstant(left: string | null, right: string): boolean {
  if (!left) return false;
  const leftEpochMs = new Date(left).getTime();
  const rightEpochMs = new Date(right).getTime();
  return Number.isFinite(leftEpochMs) && Number.isFinite(rightEpochMs) && leftEpochMs === rightEpochMs;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getRequiredString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getOptionalString(record: Record<string, unknown>, ...keys: string[]): string | null | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const value = record[key];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    }
  }
  return undefined;
}

function validateLocationTokenResponse(
  value: unknown,
  installation: Every8dGhlMarketplaceInstallation,
  config: Every8dGhlOAuthConfig
): Every8dGhlLocationTokenResponse {
  const record = getRecord(value);
  if (!record) throw oauthError("token_response_rejected", "HighLevel OAuth token response was rejected");

  const accessToken = getRequiredString(record, "access_token", "accessToken");
  const refreshToken = getRequiredString(record, "refresh_token", "refreshToken");
  const userType = getRequiredString(record, "userType", "user_type");
  const locationId = getRequiredString(record, "locationId", "location_id");
  const companyId = getRequiredString(record, "companyId", "company_id");
  const appId = getOptionalString(record, "appId", "app_id");
  const expiresInValue = record.expires_in ?? record.expiresIn;
  const expiresIn = typeof expiresInValue === "number"
    ? expiresInValue
    : typeof expiresInValue === "string" && expiresInValue.trim()
      ? Number(expiresInValue)
      : Number.NaN;
  const scopes = normalizeScopes(record.scopes ?? record.scope);
  const expectedScopes = [...config.requiredScopes].sort();
  const approvedLocations = record.approvedLocations ?? record.approved_locations;

  const ownershipModeFields = [
    record.isBulkInstallation,
    record.is_bulk_installation,
    record.installToFutureLocations,
    record.install_to_future_locations,
    record.approveAllLocations,
    record.approve_all_locations
  ];
  const ownershipModeRejected = ownershipModeFields.some(
    (flag) => flag !== undefined && flag !== false
  );
  const approvedLocationsValid = approvedLocations === undefined || (
    Array.isArray(approvedLocations) &&
    approvedLocations.length === 1 &&
    approvedLocations[0] === installation.location_id
  );

  if (
    !accessToken ||
    !refreshToken ||
    userType !== "Location" ||
    locationId !== installation.location_id ||
    !companyId ||
    companyId !== installation.company_id ||
    appId === null ||
    (appId !== undefined && appId !== config.marketplaceAppId) ||
    ownershipModeRejected ||
    !approvedLocationsValid ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > 31 * 24 * 60 * 60 ||
    !scopes ||
    !sameStrings(scopes, expectedScopes)
  ) {
    throw oauthError("token_response_rejected", "HighLevel OAuth token response was rejected");
  }

  return { accessToken, refreshToken, expiresIn, scopes, userType: "Location", locationId, companyId };
}

function stateIsEligible(input: {
  state: Every8dGhlOAuthState;
  installation: Every8dGhlMarketplaceInstallation;
  config: Every8dGhlOAuthConfig;
  browserBindingHash: string;
  now: number;
}): boolean {
  const expiry = new Date(input.state.expires_at).getTime();
  return (
    input.state.installation_id === input.installation.id &&
    input.state.installation_generation === input.installation.installation_generation &&
    input.state.redirect_uri === input.config.redirectUri &&
    timingSafeHexEqual(input.state.browser_binding_hash, input.browserBindingHash) &&
    input.state.consumed_at === null &&
    input.state.revoked_at === null &&
    Number.isFinite(expiry) &&
    expiry > input.now
  );
}

export function createEvery8dGhlOAuthRuntime(
  overrides: Every8dGhlOAuthRuntimeDependencies
): {
  initiate(input: { installationId: string; tenantId: string; locationId: string }): Promise<{
    authorizationUrl: string;
    browserBinding: string;
    expiresAt: string;
  }>;
  completeCallback(input: {
    code: string;
    state: string;
    browserBinding: string;
  }): Promise<{ status: "connected" }>;
} {
  const dependencies = overrides;

  return {
    async initiate(input) {
      requireEnabled(dependencies.config);

      if (!validRequestValue(input.installationId) || !validRequestValue(input.tenantId) || !validRequestValue(input.locationId)) {
        throw oauthError("oauth_request_invalid", "EVERY8D Connect OAuth request is invalid");
      }

      const installation = await requireInstallation({
        repository: dependencies.repository,
        config: dependencies.config,
        installationId: input.installationId,
        tenantId: input.tenantId,
        locationId: input.locationId
      });
      const state = dependencies.randomBytes(secretLength).toString("base64url");
      const browserBinding = dependencies.randomBytes(secretLength).toString("base64url");
      const expiresAt = new Date(
        dependencies.now() + dependencies.config.stateTtlSeconds * 1000
      ).toISOString();

      await dependencies.repository.createOAuthState({
        installationId: installation.id,
        installationGeneration: installation.installation_generation,
        stateHash: sha256(state),
        browserBindingHash: sha256(browserBinding),
        redirectUri: dependencies.config.redirectUri,
        expiresAt
      });

      const authorizationUrl = new URL(dependencies.config.installationUrl);
      authorizationUrl.searchParams.set("state", state);

      return { authorizationUrl: authorizationUrl.toString(), browserBinding, expiresAt };
    },

    async completeCallback(input) {
      requireEnabled(dependencies.config);

      if (
        !validRequestValue(input.code) ||
        !validRequestValue(input.state) ||
        !validRequestValue(input.browserBinding)
      ) {
        throw oauthError("oauth_request_invalid", "EVERY8D Connect OAuth request is invalid");
      }

      const stateHash = sha256(input.state);
      const browserBindingHash = sha256(input.browserBinding);
      const state = await dependencies.repository.getOAuthStateByHash(stateHash);

      if (!state) throw oauthError("oauth_state_invalid", "EVERY8D Connect OAuth state is invalid");

      let installation: Every8dGhlMarketplaceInstallation;
      try {
        installation = await requireInstallation({
          repository: dependencies.repository,
          config: dependencies.config,
          installationId: state.installation_id,
          installationGeneration: state.installation_generation
        });
      } catch {
        throw oauthError("oauth_state_invalid", "EVERY8D Connect OAuth state is invalid");
      }

      if (!stateIsEligible({
        state,
        installation,
        config: dependencies.config,
        browserBindingHash,
        now: dependencies.now()
      })) {
        throw oauthError("oauth_state_invalid", "EVERY8D Connect OAuth state is invalid");
      }

      const consumed = await dependencies.repository.consumeOAuthState({
        stateId: state.id,
        stateHash,
        installationId: installation.id,
        installationGeneration: installation.installation_generation,
        browserBindingHash,
        redirectUri: dependencies.config.redirectUri
      });

      if (!consumed) throw oauthError("oauth_state_invalid", "EVERY8D Connect OAuth state is invalid");

      let rawTokenResponse: unknown;
      try {
        rawTokenResponse = await dependencies.exchangeAuthorizationCode({
          code: input.code,
          config: dependencies.config
        });
      } catch {
        throw oauthError("token_exchange_failed", "HighLevel OAuth token exchange failed");
      }

      const token = validateLocationTokenResponse(rawTokenResponse, installation, dependencies.config);

      try {
        installation = await requireInstallation({
          repository: dependencies.repository,
          config: dependencies.config,
          installationId: installation.id,
          tenantId: installation.tenant_id,
          locationId: installation.location_id,
          installationGeneration: installation.installation_generation
        });
      } catch {
        throw oauthError("credential_persistence_failed", "HighLevel OAuth credential persistence failed");
      }

      const context = {
        installationId: installation.id,
        installationGeneration: installation.installation_generation,
        marketplaceAppId: installation.marketplace_app_id,
        oauthClientId: installation.oauth_client_id,
        tenantId: installation.tenant_id,
        locationId: installation.location_id,
        companyId: installation.company_id!
      };
      const encryptedAccess = encryptEvery8dGhlOAuthToken({
        plaintext: token.accessToken,
        activeKeyVersion: dependencies.config.activeKeyVersion,
        keys: dependencies.config.encryptionKeys,
        context: { ...context, purpose: "access_token" }
      });
      const encryptedRefresh = encryptEvery8dGhlOAuthToken({
        plaintext: token.refreshToken,
        activeKeyVersion: dependencies.config.activeKeyVersion,
        keys: dependencies.config.encryptionKeys,
        context: { ...context, purpose: "refresh_token" }
      });
      const expiresAt = new Date(dependencies.now() + token.expiresIn * 1000).toISOString();

      const persisted = await dependencies.repository.persistCredentials({
        installationId: installation.id,
        marketplaceAppId: installation.marketplace_app_id,
        oauthClientId: installation.oauth_client_id,
        tenantId: installation.tenant_id,
        locationId: installation.location_id,
        companyId: installation.company_id!,
        conversationProviderId: installation.conversation_provider_id,
        installationGeneration: installation.installation_generation,
        accessTokenCiphertext: encryptedAccess.ciphertext,
        refreshTokenCiphertext: encryptedRefresh.ciphertext,
        encryptionKeyVersion: encryptedAccess.keyVersion,
        expiresAt,
        grantedScopes: token.scopes
      });

      if (!persisted || !installationMatches({
        installation: persisted,
        config: dependencies.config,
        installationId: installation.id,
        tenantId: installation.tenant_id,
        locationId: installation.location_id,
        installationGeneration: installation.installation_generation
      }) ||
      !persisted.access_token_ciphertext ||
      !persisted.refresh_token_ciphertext ||
      persisted.encryption_key_version !== encryptedAccess.keyVersion ||
      !sameTimestampInstant(persisted.token_expires_at, expiresAt) ||
      !sameStrings([...(persisted.granted_scopes ?? [])].sort(), token.scopes)) {
        throw oauthError("credential_persistence_failed", "HighLevel OAuth credential persistence failed");
      }

      return { status: "connected" };
    }
  };
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumTokenResponseBytes) {
      await reader.cancel();
      throw oauthError("token_exchange_failed", "HighLevel OAuth token exchange failed");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export async function exchangeEvery8dGhlAuthorizationCode(input: {
  code: string;
  config: Every8dGhlOAuthConfig;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  if (input.config.tokenUrl !== every8dGhlOAuthTokenUrl) {
    throw oauthError("token_exchange_failed", "HighLevel OAuth token exchange failed");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), tokenExchangeTimeoutMs);
  const body = new URLSearchParams({
    client_id: input.config.oauthClientId,
    client_secret: input.config.oauthClientSecret,
    grant_type: "authorization_code",
    code: input.code,
    user_type: "Location",
    redirect_uri: input.config.redirectUri
  });

  try {
    const response = await (input.fetchImpl ?? fetch)(input.config.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      signal: controller.signal,
      redirect: "error"
    });
    const responseText = await readBoundedResponse(response);

    if (!response.ok) {
      throw oauthError("token_exchange_failed", "HighLevel OAuth token exchange failed");
    }

    try {
      return JSON.parse(responseText) as unknown;
    } catch {
      throw oauthError("token_exchange_failed", "HighLevel OAuth token exchange failed");
    }
  } catch {
    throw oauthError("token_exchange_failed", "HighLevel OAuth token exchange failed");
  } finally {
    clearTimeout(timeout);
  }
}

export const every8dGhlOAuthRuntime = createEvery8dGhlOAuthRuntime({
  config: readEvery8dGhlOAuthConfig(),
  repository: every8dGhlOAuthRepository,
  exchangeAuthorizationCode: ({ code, config }) => exchangeEvery8dGhlAuthorizationCode({ code, config }),
  now: Date.now,
  randomBytes: crypto.randomBytes
});
