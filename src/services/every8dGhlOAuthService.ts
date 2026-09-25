import crypto from "node:crypto";
import {
  assertEvery8dGhlOAuthConfig,
  every8dGhlOAuthTokenUrl,
  Every8dGhlOAuthConfigurationError,
  getEvery8dGhlOAuthConfigFingerprint,
  readEvery8dGhlOAuthConfig,
  type Every8dGhlOAuthConfig
} from "../config/every8dGhlOAuth";
import {
  every8dGhlOAuthRepository,
  type Every8dGhlMarketplaceInstallation,
  type Every8dGhlOAuthRepository,
  type Every8dOAuthBootstrapStatus,
  type Every8dOAuthExchangeClaim
} from "./every8dGhlOAuthRepository";
import {
  decryptEvery8dAuthorizationCode,
  encryptEvery8dAuthorizationCode
} from "./every8dGhlAuthorizationCodeEncryption";
import { encryptEvery8dGhlOAuthToken } from "./every8dGhlTokenEncryption";
import {
  createEvery8dPublicOAuthState,
  verifyEvery8dPublicOAuthState
} from "./every8dGhlOAuthStateAuth";

const tokenExchangeTimeoutMs = 15_000;
const maximumTokenResponseBytes = 64 * 1024;
const secretLength = 32;
const maximumAuthorizationValueLength = 4096;
const reconcileBatchSize = 8;
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export type Every8dGhlOAuthErrorCode =
  | "oauth_disabled"
  | "oauth_configuration_invalid"
  | "oauth_request_invalid"
  | "oauth_admission_rejected"
  | "oauth_state_invalid"
  | "installation_not_eligible"
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

export type Every8dExchangeFailureClass =
  | "invalid_grant"
  | "token_response_rejected"
  | "exchange_outcome_unknown";

export class Every8dGhlTokenExchangeError extends Error {
  readonly failureClass: Every8dExchangeFailureClass;
  constructor(failureClass: Every8dExchangeFailureClass) {
    super("HighLevel OAuth token exchange failed");
    this.name = "Every8dGhlTokenExchangeError";
    this.failureClass = failureClass;
  }
}

type LocationTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
};

type CompleteLocationTokenResponse = LocationTokenResponse & {
  userType: string;
  locationId: string;
  companyId: string;
  appId?: string;
  approvedLocations?: string[];
  ownershipModes: Array<boolean | undefined>;
};

type RuntimeDependencies = {
  config: Every8dGhlOAuthConfig;
  repository: Every8dGhlOAuthRepository;
  exchangeAuthorizationCode(input: { code: string; config: Every8dGhlOAuthConfig }): Promise<unknown>;
  now(): number;
  randomBytes(size: number): Buffer;
};

function oauthError(code: Every8dGhlOAuthErrorCode, message: string): Every8dGhlOAuthError {
  return new Every8dGhlOAuthError(code, message);
}

function requireEnabled(config: Every8dGhlOAuthConfig): void {
  if (!config.enabled) throw oauthError("oauth_disabled", "EVERY8D Connect OAuth is disabled");
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
  return /^[0-9a-f]{64}$/.test(left) && /^[0-9a-f]{64}$/.test(right)
    && crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function validRequestValue(value: string): boolean {
  return value.length > 0 && value.length <= maximumAuthorizationValueLength;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function aliased<T>(record: Record<string, unknown>, keys: string[], parse: (value: unknown) => T | null,
  equals: (left: T, right: T) => boolean = Object.is): T | null | undefined {
  let result: T | undefined;
  let supplied = false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const parsed = parse(record[key]);
    if (parsed === null || (supplied && !equals(result as T, parsed))) return null;
    result = parsed;
    supplied = true;
  }
  return supplied ? result : undefined;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : null;
}

function normalizeScopes(value: unknown): string[] | null {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\s+/) : null;
  if (!raw || raw.some((scope) => typeof scope !== "string" || !scope.trim())) return null;
  return Array.from(new Set(raw.map((scope) => String(scope).trim()))).sort();
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function persistedCredentialsAreExact(input: {
  persisted: unknown;
  installation: Every8dGhlMarketplaceInstallation;
  config: Every8dGhlOAuthConfig;
  encryptionKeyVersion: string;
  expiresAt: string;
  grantedScopes: string[];
}): boolean {
  const record = getRecord(input.persisted);
  if (!record) return false;
  const persistedExpiry = typeof record.token_expires_at === "string"
    ? Date.parse(record.token_expires_at) : Number.NaN;
  const expectedExpiry = Date.parse(input.expiresAt);
  const persistedScopes = Array.isArray(record.granted_scopes)
    && record.granted_scopes.every((scope) => typeof scope === "string" && scope.length > 0
      && scope === scope.trim())
    ? record.granted_scopes as string[] : null;
  const expectedScopes = [...input.grantedScopes].sort();
  return record.id === input.installation.id
    && record.app_namespace === "every8d_connect"
    && record.marketplace_app_id === input.config.marketplaceAppId
    && record.oauth_client_id === input.config.oauthClientId
    && record.tenant_id === input.installation.tenant_id
    && record.location_id === input.installation.location_id
    && record.company_id === input.installation.company_id
    && record.conversation_provider_id === input.config.conversationProviderId
    && record.channel === "sms"
    && record.provider === "every8d"
    && (record.status === "pending" || record.status === "active")
    && record.installation_generation === input.installation.installation_generation
    && record.latest_lifecycle_event_type === "INSTALL"
    && record.latest_lifecycle_version_id === input.config.marketplaceVersionId
    && typeof record.access_token_ciphertext === "string"
    && record.access_token_ciphertext.length > 0
    && typeof record.refresh_token_ciphertext === "string"
    && record.refresh_token_ciphertext.length > 0
    && record.encryption_key_version === input.encryptionKeyVersion
    && Number.isFinite(expectedExpiry)
    && Number.isFinite(persistedExpiry)
    && persistedExpiry === expectedExpiry
    && persistedScopes !== null
    && sameStrings(persistedScopes, expectedScopes);
}

function parseCompleteLocationTokenResponse(value: unknown): CompleteLocationTokenResponse {
  const record = getRecord(value);
  if (!record) throw new Every8dGhlTokenExchangeError("exchange_outcome_unknown");
  const accessToken = aliased(record, ["access_token", "accessToken"], nonEmptyString);
  const refreshToken = aliased(record, ["refresh_token", "refreshToken"], nonEmptyString);
  const userType = aliased(record, ["userType", "user_type"], nonEmptyString);
  const locationId = aliased(record, ["locationId", "location_id"], nonEmptyString);
  const companyId = aliased(record, ["companyId", "company_id"], nonEmptyString);
  const appId = aliased(record, ["appId", "app_id"], nonEmptyString);
  const expiresIn = aliased(record, ["expires_in", "expiresIn"], finiteNumber) ?? Number.NaN;
  const scopes = aliased(record, ["scopes", "scope"], normalizeScopes, sameStrings);
  const approvedLocations = aliased(record, ["approvedLocations", "approved_locations"], stringArray, sameStrings);
  const ownershipModes = [
    aliased(record, ["isBulkInstallation", "is_bulk_installation"], booleanValue),
    aliased(record, ["installToFutureLocations", "install_to_future_locations"], booleanValue),
    aliased(record, ["approveAllLocations", "approve_all_locations"], booleanValue)
  ];
  if (!accessToken || !refreshToken || !userType || !locationId || !companyId
    || appId === null || expiresIn === null || !Number.isFinite(expiresIn)
    || scopes === null || scopes === undefined || approvedLocations === null
    || ownershipModes.some((flag) => flag === null)) {
    throw new Every8dGhlTokenExchangeError("exchange_outcome_unknown");
  }
  return {
    accessToken, refreshToken, userType, locationId, companyId, expiresIn, scopes,
    ...(appId === undefined ? {} : { appId }),
    ...(approvedLocations === undefined ? {} : { approvedLocations }),
    ownershipModes: ownershipModes as Array<boolean | undefined>
  };
}

function validateLocationTokenResponse(
  value: unknown,
  installation: Every8dGhlMarketplaceInstallation,
  config: Every8dGhlOAuthConfig
): LocationTokenResponse {
  const {
    accessToken, refreshToken, userType, locationId, companyId, appId, expiresIn,
    scopes, approvedLocations, ownershipModes
  } = parseCompleteLocationTokenResponse(value);
  const expectedScopes = [...config.requiredScopes].sort();
  if (
    userType !== "Location"
    || locationId !== installation.location_id || companyId !== installation.company_id
    || (appId !== undefined && appId !== config.marketplaceAppId)
    || ownershipModes.some((flag) => flag === true)
    || (approvedLocations !== undefined
      && (approvedLocations.length !== 1 || approvedLocations[0] !== installation.location_id))
    || !Number.isSafeInteger(expiresIn) || expiresIn <= 0 || expiresIn > 31 * 24 * 60 * 60
    || !sameStrings(scopes, expectedScopes)
  ) {
    throw new Every8dGhlTokenExchangeError("token_response_rejected");
  }
  return { accessToken, refreshToken, expiresIn, scopes };
}

function claimIsExact(claim: Every8dOAuthExchangeClaim, config: Every8dGhlOAuthConfig): boolean {
  const installation = claim.installation;
  const bootstrap = claim.bootstrap;
  return bootstrap.app_namespace === "every8d_connect"
    && bootstrap.marketplace_version_id === config.marketplaceVersionId
    && bootstrap.expected_location_id === config.expectedLocationId
    && bootstrap.target_installation_generation === installation.installation_generation
    && bootstrap.config_fingerprint === getEvery8dGhlOAuthConfigFingerprint(config)
    && bootstrap.status === "exchanging"
    && Boolean(bootstrap.authorization_code_ciphertext)
    && Boolean(bootstrap.authorization_code_key_version)
    && bootstrap.claimed_installation_id === installation.id
    && bootstrap.claimed_installation_generation === installation.installation_generation
    && installation.app_namespace === "every8d_connect"
    && installation.marketplace_app_id === config.marketplaceAppId
    && installation.oauth_client_id === config.oauthClientId
    && installation.conversation_provider_id === config.conversationProviderId
    && installation.location_id === config.expectedLocationId
    && installation.channel === "sms" && installation.provider === "every8d"
    && installation.company_id !== null
    && installation.latest_lifecycle_event_type === "INSTALL"
    && installation.latest_lifecycle_version_id === config.marketplaceVersionId
    && (installation.status === "pending" || installation.status === "active");
}

function codeContext(claim: Every8dOAuthExchangeClaim) {
  return {
    appNamespace: claim.bootstrap.app_namespace,
    stateHash: claim.bootstrap.state_hash,
    marketplaceVersionId: claim.bootstrap.marketplace_version_id,
    redirectUri: claim.bootstrap.redirect_uri,
    configFingerprint: claim.bootstrap.config_fingerprint,
    expectedLocationId: claim.bootstrap.expected_location_id
  } as const;
}

export function createEvery8dGhlOAuthRuntime(dependencies: RuntimeDependencies) {
  const configFingerprint = (): string => getEvery8dGhlOAuthConfigFingerprint(dependencies.config);

  async function fail(bootstrapId: string, failureClass: string): Promise<void> {
    try { await dependencies.repository.failBootstrap({ bootstrapId, failureClass }); } catch { /* next pass audits it */ }
  }

  async function processBootstrap(bootstrapId: string): Promise<void> {
    requireEnabled(dependencies.config);
    const claim = await dependencies.repository.claimExchange({
      bootstrapId,
      marketplaceVersionId: dependencies.config.marketplaceVersionId,
      configFingerprint: configFingerprint()
    });
    if (!claim) return;
    if (!claimIsExact(claim, dependencies.config)) {
      await fail(bootstrapId, "configuration_drift");
      return;
    }

    let code: string;
    try {
      code = decryptEvery8dAuthorizationCode({
        ciphertext: claim.bootstrap.authorization_code_ciphertext!,
        expectedKeyVersion: claim.bootstrap.authorization_code_key_version!,
        keys: dependencies.config.encryptionKeys,
        context: codeContext(claim)
      });
    } catch {
      await fail(bootstrapId, "authorization_code_invalid");
      return;
    }

    let token: LocationTokenResponse;
    try {
      const response = await dependencies.exchangeAuthorizationCode({ code, config: dependencies.config });
      token = validateLocationTokenResponse(response, claim.installation, dependencies.config);
    } catch (error) {
      await fail(bootstrapId, error instanceof Every8dGhlTokenExchangeError
        ? error.failureClass : "exchange_outcome_unknown");
      return;
    }

    const installation = claim.installation;
    const tokenContext = {
      installationId: installation.id,
      installationGeneration: installation.installation_generation,
      marketplaceAppId: installation.marketplace_app_id,
      oauthClientId: installation.oauth_client_id,
      tenantId: installation.tenant_id,
      locationId: installation.location_id,
      companyId: installation.company_id!
    };
    const access = encryptEvery8dGhlOAuthToken({
      plaintext: token.accessToken,
      activeKeyVersion: dependencies.config.activeKeyVersion,
      keys: dependencies.config.encryptionKeys,
      context: { ...tokenContext, purpose: "access_token" }
    });
    const refresh = encryptEvery8dGhlOAuthToken({
      plaintext: token.refreshToken,
      activeKeyVersion: dependencies.config.activeKeyVersion,
      keys: dependencies.config.encryptionKeys,
      context: { ...tokenContext, purpose: "refresh_token" }
    });
    const finalized = await dependencies.repository.finalizeExchange({
      bootstrapId,
      marketplaceVersionId: dependencies.config.marketplaceVersionId,
      configFingerprint: configFingerprint(),
      accessTokenCiphertext: access.ciphertext,
      refreshTokenCiphertext: refresh.ciphertext,
      encryptionKeyVersion: access.keyVersion,
      tokenExpiresAt: new Date(dependencies.now() + token.expiresIn * 1000).toISOString(),
      grantedScopes: token.scopes
    });
    if (!finalized) await fail(bootstrapId, "credential_persistence_failed");
  }

  async function requireInstalled(input: {
    installationId: string;
    tenantId?: string;
    locationId?: string;
    installationGeneration?: number;
  }): Promise<Every8dGhlMarketplaceInstallation> {
    const found = await dependencies.repository.getEligibleInstallation({
      ...input,
      marketplaceAppId: dependencies.config.marketplaceAppId,
      oauthClientId: dependencies.config.oauthClientId,
      conversationProviderId: dependencies.config.conversationProviderId,
      marketplaceVersionId: dependencies.config.marketplaceVersionId
    });
    if (!found || !found.company_id || found.latest_lifecycle_event_type !== "INSTALL"
      || found.latest_lifecycle_version_id !== dependencies.config.marketplaceVersionId
      || found.marketplace_app_id !== dependencies.config.marketplaceAppId
      || found.oauth_client_id !== dependencies.config.oauthClientId
      || found.conversation_provider_id !== dependencies.config.conversationProviderId
      || found.channel !== "sms" || found.provider !== "every8d"
      || (input.tenantId !== undefined && found.tenant_id !== input.tenantId)
      || (input.locationId !== undefined && found.location_id !== input.locationId)
      || (input.installationGeneration !== undefined
        && found.installation_generation !== input.installationGeneration)) {
      throw oauthError("installation_not_eligible", "EVERY8D Connect installation is not eligible");
    }
    return found;
  }

  async function completeInstalledCallback(input: {
    code: string;
    state: string;
    browserBinding: string;
  }): Promise<{ status: "connected" }> {
    const stateHash = sha256(input.state);
    const bindingHash = sha256(input.browserBinding);
    const state = await dependencies.repository.getOAuthStateByHash(stateHash);
    if (!state) throw oauthError("oauth_state_invalid", "EVERY8D Connect OAuth state is invalid");
    let installation: Every8dGhlMarketplaceInstallation;
    try {
      installation = await requireInstalled({
        installationId: state.installation_id,
        installationGeneration: state.installation_generation
      });
    } catch {
      throw oauthError("oauth_state_invalid", "EVERY8D Connect OAuth state is invalid");
    }
    const expiry = new Date(state.expires_at).getTime();
    if (state.redirect_uri !== dependencies.config.redirectUri
      || !timingSafeHexEqual(state.browser_binding_hash, bindingHash)
      || state.consumed_at !== null || state.revoked_at !== null
      || !Number.isFinite(expiry) || expiry <= dependencies.now()) {
      throw oauthError("oauth_state_invalid", "EVERY8D Connect OAuth state is invalid");
    }
    const consumed = await dependencies.repository.consumeOAuthState({
      stateId: state.id, stateHash, installationId: installation.id,
      installationGeneration: installation.installation_generation,
      browserBindingHash: bindingHash, redirectUri: dependencies.config.redirectUri
    });
    if (!consumed) throw oauthError("oauth_state_invalid", "EVERY8D Connect OAuth state is invalid");

    let parsed: LocationTokenResponse;
    try {
      parsed = validateLocationTokenResponse(
        await dependencies.exchangeAuthorizationCode({ code: input.code, config: dependencies.config }),
        installation,
        dependencies.config
      );
    } catch {
      throw oauthError("token_exchange_failed", "HighLevel OAuth token exchange failed");
    }
    try {
      installation = await requireInstalled({
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
    const access = encryptEvery8dGhlOAuthToken({
      plaintext: parsed.accessToken, activeKeyVersion: dependencies.config.activeKeyVersion,
      keys: dependencies.config.encryptionKeys, context: { ...context, purpose: "access_token" }
    });
    const refresh = encryptEvery8dGhlOAuthToken({
      plaintext: parsed.refreshToken, activeKeyVersion: dependencies.config.activeKeyVersion,
      keys: dependencies.config.encryptionKeys, context: { ...context, purpose: "refresh_token" }
    });
    const persistedExpiry = new Date(dependencies.now() + parsed.expiresIn * 1000).toISOString();
    const persisted = await dependencies.repository.persistInstalledCredentials({
      ...context,
      conversationProviderId: installation.conversation_provider_id,
      marketplaceVersionId: dependencies.config.marketplaceVersionId,
      accessTokenCiphertext: access.ciphertext,
      refreshTokenCiphertext: refresh.ciphertext,
      encryptionKeyVersion: access.keyVersion,
      expiresAt: persistedExpiry,
      grantedScopes: parsed.scopes
    });
    if (!persistedCredentialsAreExact({
      persisted,
      installation,
      config: dependencies.config,
      encryptionKeyVersion: access.keyVersion,
      expiresAt: persistedExpiry,
      grantedScopes: parsed.scopes
    })) {
      throw oauthError("credential_persistence_failed", "HighLevel OAuth credential persistence failed");
    }
    return { status: "connected" };
  }

  return {
    isEnabled(): boolean { return dependencies.config.enabled; },

    async start(): Promise<{ authorizationUrl: string; browserBinding: string; expiresAt: string }> {
      requireEnabled(dependencies.config);
      const nonce = dependencies.randomBytes(secretLength);
      const browserBinding = dependencies.randomBytes(secretLength).toString("base64url");
      const authenticated = createEvery8dPublicOAuthState({
        config: dependencies.config,
        configFingerprint: configFingerprint(),
        nonce,
        browserBindingHash: sha256(browserBinding),
        now: dependencies.now()
      });
      const authorizationUrl = new URL(dependencies.config.installationUrl);
      authorizationUrl.searchParams.set("state", authenticated.state);
      return {
        authorizationUrl: authorizationUrl.toString(),
        browserBinding,
        expiresAt: new Date(authenticated.payload.expiresAt * 1000).toISOString()
      };
    },

    async initiate(input: { installationId: string; tenantId: string; locationId: string }): Promise<{
      authorizationUrl: string;
      browserBinding: string;
      expiresAt: string;
    }> {
      requireEnabled(dependencies.config);
      if (!validRequestValue(input.installationId) || !validRequestValue(input.tenantId)
        || !validRequestValue(input.locationId)) {
        throw oauthError("oauth_request_invalid", "EVERY8D Connect OAuth request is invalid");
      }
      const installation = await requireInstalled(input);
      const state = dependencies.randomBytes(secretLength).toString("base64url");
      const browserBinding = dependencies.randomBytes(secretLength).toString("base64url");
      const expiresAt = new Date(dependencies.now()
        + dependencies.config.stateTtlSeconds * 1000).toISOString();
      await dependencies.repository.createOAuthState({
        installationId: installation.id,
        installationGeneration: installation.installation_generation,
        stateHash: sha256(state), browserBindingHash: sha256(browserBinding),
        redirectUri: dependencies.config.redirectUri, expiresAt
      });
      const authorizationUrl = new URL(dependencies.config.installationUrl);
      authorizationUrl.searchParams.set("state", state);
      return { authorizationUrl: authorizationUrl.toString(), browserBinding, expiresAt };
    },

    async acceptCallback(input: { code: string; state: string; browserBinding: string }): Promise<{ status: "pending"; ready: boolean }> {
      requireEnabled(dependencies.config);
      if (!validRequestValue(input.code) || !validRequestValue(input.state) || !validRequestValue(input.browserBinding)) {
        throw oauthError("oauth_request_invalid", "EVERY8D Connect OAuth request is invalid");
      }
      const stateHash = sha256(input.state);
      const browserBindingHash = sha256(input.browserBinding);
      const fingerprint = configFingerprint();
      let state;
      try {
        state = verifyEvery8dPublicOAuthState({
          state: input.state,
          browserBindingHash,
          config: dependencies.config,
          configFingerprint: fingerprint,
          now: dependencies.now()
        });
      } catch {
        throw oauthError("oauth_state_invalid", "EVERY8D Connect OAuth state is invalid");
      }
      const encrypted = encryptEvery8dAuthorizationCode({
        plaintext: input.code,
        activeKeyVersion: dependencies.config.activeKeyVersion,
        keys: dependencies.config.encryptionKeys,
        context: {
          appNamespace: state.appNamespace,
          stateHash,
          marketplaceVersionId: state.marketplaceVersionId,
          redirectUri: state.redirectUri,
          configFingerprint: state.configFingerprint,
          expectedLocationId: state.expectedLocationId
        }
      });
      const accepted = await dependencies.repository.acceptCallback({
        marketplaceAppId: dependencies.config.marketplaceAppId,
        oauthClientId: dependencies.config.oauthClientId,
        conversationProviderId: dependencies.config.conversationProviderId,
        marketplaceVersionId: state.marketplaceVersionId,
        expectedLocationId: state.expectedLocationId,
        stateHash, browserBindingHash,
        redirectUri: dependencies.config.redirectUri, configFingerprint: fingerprint,
        expiresAt: new Date(state.expiresAt * 1000).toISOString(),
        authorizationCodeCiphertext: encrypted.ciphertext,
        authorizationCodeKeyVersion: encrypted.keyVersion
      });
      if (!accepted) throw oauthError("oauth_state_invalid", "EVERY8D Connect OAuth state is invalid");
      return { status: "pending", ready: accepted.status === "ready" };
    },

    async completeCallback(input: { code: string; state: string; browserBinding: string }): Promise<{
      status: "pending" | "connected";
      ready: boolean;
    }> {
      requireEnabled(dependencies.config);
      if (!validRequestValue(input.code) || !validRequestValue(input.state)
        || !validRequestValue(input.browserBinding)) {
        throw oauthError("oauth_request_invalid", "EVERY8D Connect OAuth request is invalid");
      }
      try {
        return await this.acceptCallback(input);
      } catch (error) {
        if (!(error instanceof Every8dGhlOAuthError) || error.code !== "oauth_state_invalid") throw error;
      }
      return { ...(await completeInstalledCallback(input)), ready: false };
    },

    async getStatus(browserBinding: string): Promise<Every8dOAuthBootstrapStatus | null> {
      requireEnabled(dependencies.config);
      if (!validRequestValue(browserBinding)) return null;
      return dependencies.repository.getStatus({
        browserBindingHash: sha256(browserBinding), configFingerprint: configFingerprint()
      });
    },

    async reconcileOnce(): Promise<void> {
      requireEnabled(dependencies.config);
      const ids = await dependencies.repository.listRecoverable({
        marketplaceVersionId: dependencies.config.marketplaceVersionId,
        configFingerprint: configFingerprint(),
        limit: reconcileBatchSize
      });
      for (const id of ids) await processBootstrap(id);
    },

    processBootstrap
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
      throw new Every8dGhlTokenExchangeError("exchange_outcome_unknown");
    }
    chunks.push(value);
  }
  try {
    return fatalUtf8Decoder.decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  } catch {
    throw new Every8dGhlTokenExchangeError("exchange_outcome_unknown");
  }
}

export async function exchangeEvery8dGhlAuthorizationCode(input: {
  code: string;
  config: Every8dGhlOAuthConfig;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  if (input.config.tokenUrl !== every8dGhlOAuthTokenUrl) {
    throw new Every8dGhlTokenExchangeError("token_response_rejected");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), tokenExchangeTimeoutMs);
  try {
    const response = await (input.fetchImpl ?? fetch)(input.config.tokenUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.config.oauthClientId,
        client_secret: input.config.oauthClientSecret,
        grant_type: "authorization_code",
        code: input.code,
        user_type: "Location",
        redirect_uri: input.config.redirectUri
      }),
      signal: controller.signal,
      redirect: "error"
    });
    const responseText = await readBoundedResponse(response);
    if (!response.ok) {
      let errorRecord: Record<string, unknown> | null;
      try { errorRecord = getRecord(JSON.parse(responseText)); }
      catch { throw new Every8dGhlTokenExchangeError("exchange_outcome_unknown"); }
      if (!errorRecord) throw new Every8dGhlTokenExchangeError("exchange_outcome_unknown");
      if (response.status === 400) {
        if (errorRecord.error === "invalid_grant") {
          throw new Every8dGhlTokenExchangeError("invalid_grant");
        }
      }
      throw new Every8dGhlTokenExchangeError("exchange_outcome_unknown");
    }
    try {
      const parsed = JSON.parse(responseText) as unknown;
      parseCompleteLocationTokenResponse(parsed);
      return parsed;
    }
    catch { throw new Every8dGhlTokenExchangeError("exchange_outcome_unknown"); }
  } catch (error) {
    if (error instanceof Every8dGhlTokenExchangeError) throw error;
    throw new Every8dGhlTokenExchangeError("exchange_outcome_unknown");
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
