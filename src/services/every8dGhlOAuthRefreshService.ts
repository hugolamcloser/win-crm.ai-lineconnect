import {
  Every8dGhlOAuthRefreshClientError,
  refreshEvery8dGhlOAuthToken,
  type Every8dGhlOAuthRefreshResult
} from "../integrations/every8dGhlOAuthRefreshClient";
import {
  assertEvery8dGhlOAuthRefreshConfig,
  type Every8dGhlOAuthConfig
} from "../config/every8dGhlOAuth";
import {
  every8dGhlOAuthRepository,
  type Every8dGhlOAuthExpiredRefreshLease,
  type Every8dGhlOAuthRefreshCandidate,
  type Every8dGhlOAuthRefreshClaim,
  type Every8dGhlOAuthRefreshFailureClass,
  type Every8dGhlOAuthRefreshIdentity,
  type Every8dGhlOAuthRepository
} from "./every8dGhlOAuthRepository";
import {
  decryptEvery8dGhlOAuthToken,
  encryptEvery8dGhlOAuthToken,
  type Every8dGhlOAuthTokenContext
} from "./every8dGhlTokenEncryption";
import { logger } from "../config/logger";
import { readEvery8dGhlOAuthConfig } from "../config/every8dGhlOAuth";

const refreshDueWindowMs = 5 * 60 * 1000;

type RefreshLogger = Pick<typeof logger, "info" | "warn">;

export type Every8dGhlOAuthRefreshPassResult = {
  staleLeaseFound: boolean;
  candidateFound: boolean;
  claimWon: boolean;
  finalized: boolean;
  failureClass: Every8dGhlOAuthRefreshFailureClass | null;
};

type RefreshServiceDependencies = {
  config: Every8dGhlOAuthConfig;
  repository: Every8dGhlOAuthRepository;
  exchangeRefreshToken: (input: {
    refreshToken: string;
    config: Every8dGhlOAuthConfig;
    claimedScopes: string[];
    expectedLocationId: string;
    expectedCompanyId: string;
  }) => Promise<Every8dGhlOAuthRefreshResult>;
  now: () => number;
  log: RefreshLogger;
  decryptToken: typeof decryptEvery8dGhlOAuthToken;
  encryptToken: typeof encryptEvery8dGhlOAuthToken;
};

function sameScopeSet(left: string[], right: string[]): boolean {
  const normalize = (values: string[]): string[] | null => {
    if (values.some((value) => !value || value !== value.trim() || /\s/.test(value))) return null;
    const normalized = [...new Set(values)].sort();
    return normalized.length === values.length ? normalized : null;
  };
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft !== null && normalizedRight !== null
    && normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((scope, index) => scope === normalizedRight[index]);
}

function identityFromRow(
  row: Every8dGhlOAuthRefreshCandidate | Every8dGhlOAuthExpiredRefreshLease
): Every8dGhlOAuthRefreshIdentity {
  return {
    installationId: row.id,
    marketplaceAppId: row.marketplace_app_id,
    oauthClientId: row.oauth_client_id,
    tenantId: row.tenant_id,
    locationId: row.location_id,
    companyId: row.company_id,
    conversationProviderId: row.conversation_provider_id,
    marketplaceVersionId: row.latest_lifecycle_version_id,
    installationGeneration: row.installation_generation
  };
}

function tokenContext(
  identity: Every8dGhlOAuthRefreshIdentity,
  purpose: "access_token" | "refresh_token"
): Every8dGhlOAuthTokenContext {
  return {
    installationId: identity.installationId,
    installationGeneration: identity.installationGeneration,
    marketplaceAppId: identity.marketplaceAppId,
    oauthClientId: identity.oauthClientId,
    tenantId: identity.tenantId,
    locationId: identity.locationId,
    companyId: identity.companyId,
    purpose
  };
}

function emptyPassResult(): Every8dGhlOAuthRefreshPassResult {
  return {
    staleLeaseFound: false,
    candidateFound: false,
    claimWon: false,
    finalized: false,
    failureClass: null
  };
}

export function createEvery8dGhlOAuthRefreshService(dependencies: RefreshServiceDependencies) {
  function isEnabled(): boolean {
    return dependencies.config.enabled && dependencies.config.refreshEnabled;
  }

  async function readStateSafely(identity: Every8dGhlOAuthRefreshIdentity): Promise<void> {
    try {
      const state = await dependencies.repository.getRefreshState(identity);
      dependencies.log.info({
        event: "every8d_ghl_oauth_refresh_state_observed",
        credentialState: state?.credential_state ?? "missing",
        failureClass: state?.refresh_failure_class ?? null
      }, "EVERY8D HighLevel OAuth refresh state observed");
    } catch {
      dependencies.log.warn({ event: "every8d_ghl_oauth_refresh_state_read_failed" },
        "EVERY8D HighLevel OAuth refresh state read failed safely");
    }
  }

  async function failClaim(
    identity: Every8dGhlOAuthRefreshIdentity,
    claim: Every8dGhlOAuthRefreshClaim,
    failureClass: Every8dGhlOAuthRefreshFailureClass
  ): Promise<void> {
    try {
      const failed = await dependencies.repository.failRefresh({
        ...identity,
        priorCredentialRevision: claim.credentialRevision,
        refreshLeaseId: claim.refreshLeaseId,
        failureClass
      });
      dependencies.log.warn({
        event: "every8d_ghl_oauth_refresh_terminal_failure",
        failureClass,
        persisted: failed
      }, "EVERY8D HighLevel OAuth refresh entered terminal failure handling");
      if (!failed) await readStateSafely(identity);
    } catch {
      dependencies.log.warn({
        event: "every8d_ghl_oauth_refresh_failure_rpc_failed",
        failureClass
      }, "EVERY8D HighLevel OAuth refresh failure RPC failed safely");
    }
  }

  async function recoverStaleLease(result: Every8dGhlOAuthRefreshPassResult): Promise<void> {
    const now = new Date(dependencies.now()).toISOString();
    const staleLease = await dependencies.repository.findExpiredRefreshLease({
      marketplaceAppId: dependencies.config.marketplaceAppId,
      oauthClientId: dependencies.config.oauthClientId,
      expectedLocationId: dependencies.config.expectedLocationId,
      conversationProviderId: dependencies.config.conversationProviderId,
      marketplaceVersionId: dependencies.config.marketplaceVersionId,
      expiredBefore: now
    });
    if (!staleLease) return;

    result.staleLeaseFound = true;
    const identity = identityFromRow(staleLease);
    const claim = await dependencies.repository.claimRefresh(identity);
    dependencies.log.warn({
      event: "every8d_ghl_oauth_refresh_stale_lease_recovery",
      claimReturned: claim !== null
    }, "EVERY8D HighLevel OAuth stale refresh lease recovery attempted");

    if (claim) {
      result.failureClass = "credential_persistence_failed";
      await failClaim(identity, claim, "credential_persistence_failed");
    } else {
      await readStateSafely(identity);
    }
  }

  async function processClaim(
    candidate: Every8dGhlOAuthRefreshCandidate,
    identity: Every8dGhlOAuthRefreshIdentity,
    claim: Every8dGhlOAuthRefreshClaim,
    result: Every8dGhlOAuthRefreshPassResult
  ): Promise<void> {
    if (
      claim.installationId !== identity.installationId
      || claim.installationGeneration !== identity.installationGeneration
      || !sameScopeSet(claim.grantedScopes, candidate.granted_scopes)
      || !sameScopeSet(claim.grantedScopes, dependencies.config.requiredScopes)
      || !dependencies.config.encryptionKeys.has(claim.encryptionKeyVersion)
    ) {
      result.failureClass = "credential_persistence_failed";
      await failClaim(identity, claim, "credential_persistence_failed");
      return;
    }

    let plaintextRefreshToken: string;
    try {
      plaintextRefreshToken = dependencies.decryptToken({
        ciphertext: claim.refreshTokenCiphertext,
        expectedKeyVersion: claim.encryptionKeyVersion,
        keys: dependencies.config.encryptionKeys,
        context: tokenContext(identity, "refresh_token")
      });
    } catch {
      result.failureClass = "credential_persistence_failed";
      await failClaim(identity, claim, "credential_persistence_failed");
      return;
    }

    let refreshed: Every8dGhlOAuthRefreshResult;
    try {
      refreshed = await dependencies.exchangeRefreshToken({
        refreshToken: plaintextRefreshToken,
        config: dependencies.config,
        claimedScopes: claim.grantedScopes,
        expectedLocationId: identity.locationId,
        expectedCompanyId: identity.companyId
      });
      dependencies.log.info({
        event: "every8d_ghl_oauth_refresh_http_classified",
        httpClass: "success"
      }, "EVERY8D HighLevel OAuth refresh response classified");
    } catch (error) {
      const failureClass = error instanceof Every8dGhlOAuthRefreshClientError
        ? error.failureClass
        : "refresh_outcome_unknown";
      result.failureClass = failureClass;
      dependencies.log.warn({
        event: "every8d_ghl_oauth_refresh_http_classified",
        httpClass: failureClass
      }, "EVERY8D HighLevel OAuth refresh response classified");
      await failClaim(identity, claim, failureClass);
      return;
    }

    try {
      const access = dependencies.encryptToken({
        plaintext: refreshed.accessToken,
        activeKeyVersion: dependencies.config.activeKeyVersion,
        keys: dependencies.config.encryptionKeys,
        context: tokenContext(identity, "access_token")
      });
      const refresh = dependencies.encryptToken({
        plaintext: refreshed.refreshToken,
        activeKeyVersion: dependencies.config.activeKeyVersion,
        keys: dependencies.config.encryptionKeys,
        context: tokenContext(identity, "refresh_token")
      });
      const finalized = await dependencies.repository.finalizeRefresh({
        ...identity,
        priorCredentialRevision: claim.credentialRevision,
        refreshLeaseId: claim.refreshLeaseId,
        accessTokenCiphertext: access.ciphertext,
        refreshTokenCiphertext: refresh.ciphertext,
        encryptionKeyVersion: dependencies.config.activeKeyVersion,
        tokenExpiresAt: new Date(dependencies.now() + refreshed.expiresIn * 1000).toISOString(),
        grantedScopes: refreshed.scopes
      });
      result.finalized = finalized;
      dependencies.log.info({
        event: "every8d_ghl_oauth_refresh_finalize",
        finalized
      }, "EVERY8D HighLevel OAuth refresh finalize completed");
      if (!finalized) await readStateSafely(identity);
    } catch {
      result.failureClass = "credential_persistence_failed";
      await failClaim(identity, claim, "credential_persistence_failed");
    }
  }

  return {
    isEnabled,

    async runOnce(): Promise<Every8dGhlOAuthRefreshPassResult> {
      const result = emptyPassResult();
      if (!isEnabled()) return result;

      assertEvery8dGhlOAuthRefreshConfig(dependencies.config);
      dependencies.log.info({ event: "every8d_ghl_oauth_refresh_scan_started" },
        "EVERY8D HighLevel OAuth refresh scan started");

      await recoverStaleLease(result);
      const candidate = await dependencies.repository.findRefreshCandidate({
        marketplaceAppId: dependencies.config.marketplaceAppId,
        oauthClientId: dependencies.config.oauthClientId,
        expectedLocationId: dependencies.config.expectedLocationId,
        conversationProviderId: dependencies.config.conversationProviderId,
        marketplaceVersionId: dependencies.config.marketplaceVersionId,
        refreshDueBefore: new Date(dependencies.now() + refreshDueWindowMs).toISOString()
      });
      result.candidateFound = candidate !== null;
      dependencies.log.info({
        event: "every8d_ghl_oauth_refresh_candidates_found",
        candidateCount: candidate ? 1 : 0
      }, "EVERY8D HighLevel OAuth refresh candidates selected");

      if (candidate
        && sameScopeSet(candidate.granted_scopes, dependencies.config.requiredScopes)
        && dependencies.config.encryptionKeys.has(candidate.encryption_key_version)) {
        const identity = identityFromRow(candidate);
        const claim = await dependencies.repository.claimRefresh(identity);
        result.claimWon = claim !== null;
        dependencies.log.info({
          event: "every8d_ghl_oauth_refresh_claim",
          claimResult: claim ? "won" : "lost"
        }, "EVERY8D HighLevel OAuth refresh claim completed");
        if (claim) await processClaim(candidate, identity, claim, result);
      } else if (candidate) {
        dependencies.log.warn({
          event: "every8d_ghl_oauth_refresh_preclaim_rejected",
          reason: sameScopeSet(candidate.granted_scopes, dependencies.config.requiredScopes)
            ? "unknown_key_version" : "scope_mismatch"
        }, "EVERY8D HighLevel OAuth refresh candidate rejected before claim");
      }

      dependencies.log.info({
        event: "every8d_ghl_oauth_refresh_scan_completed",
        staleLeaseFound: result.staleLeaseFound,
        candidateCount: result.candidateFound ? 1 : 0,
        claimResult: result.claimWon ? "won" : "none",
        finalized: result.finalized,
        failureClass: result.failureClass
      }, "EVERY8D HighLevel OAuth refresh scan completed");
      return result;
    }
  };
}

const refreshConfig = readEvery8dGhlOAuthConfig();

export const every8dGhlOAuthRefreshService = createEvery8dGhlOAuthRefreshService({
  config: refreshConfig,
  repository: every8dGhlOAuthRepository,
  exchangeRefreshToken: (input) => refreshEvery8dGhlOAuthToken(input),
  now: Date.now,
  log: logger,
  decryptToken: decryptEvery8dGhlOAuthToken,
  encryptToken: encryptEvery8dGhlOAuthToken
});
