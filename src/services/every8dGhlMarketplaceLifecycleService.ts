import {
  assertEvery8dGhlOAuthConfig,
  readEvery8dGhlOAuthConfig,
  type Every8dGhlOAuthConfig
} from "../config/every8dGhlOAuth";
import {
  every8dGhlOAuthRepository,
  getExactExistingTenantForEvery8d,
  type Every8dGhlExactTenant,
  type Every8dGhlMarketplaceInstallation
} from "./every8dGhlOAuthRepository";

export type Every8dGhlMarketplaceLifecyclePayload = {
  type: string;
  appId?: string;
  versionId?: string;
  installType?: string;
  locationId?: string;
  companyId?: string;
  timestamp: string;
  webhookId: string;
  isBulkInstallation?: boolean;
  installToFutureLocations?: boolean;
  approveAllLocations?: boolean;
};

export type Every8dGhlMarketplaceLifecycleResult = {
  status: "pending" | "active" | "uninstalled";
  installationId: string;
  installationGeneration: number;
};

export class Every8dGhlMarketplaceLifecycleError extends Error {
  readonly code: "lifecycle_disabled" | "lifecycle_rejected" | "tenant_not_exact" | "ownership_conflict";

  constructor(
    code: "lifecycle_disabled" | "lifecycle_rejected" | "tenant_not_exact" | "ownership_conflict",
    message: string
  ) {
    super(message);
    this.name = "Every8dGhlMarketplaceLifecycleError";
    this.code = code;
  }
}

type LifecycleDependencies = {
  config: Every8dGhlOAuthConfig;
  getExactTenant(locationId: string): Promise<Every8dGhlExactTenant | null>;
  applyLifecycleEvent(input: {
    eventType: "INSTALL" | "UNINSTALL";
    marketplaceAppId: string;
    oauthClientId: string;
    tenantId: string | null;
    locationId: string;
    companyId: string | null;
    conversationProviderId: string;
    eventAt: string;
    eventId: string;
  }): Promise<Every8dGhlMarketplaceInstallation>;
};

const exactOwnershipIdentifier = /^[A-Za-z0-9_-]{1,128}$/;

function rejected(): never {
  throw new Every8dGhlMarketplaceLifecycleError(
    "lifecycle_rejected",
    "EVERY8D Connect lifecycle evidence was rejected"
  );
}

function hasForbiddenOwnershipMode(payload: Every8dGhlMarketplaceLifecyclePayload): boolean {
  return payload.isBulkInstallation === true ||
    payload.installToFutureLocations === true ||
    payload.approveAllLocations === true;
}

function configuredMarketplaceVersionId(config: Every8dGhlOAuthConfig): string {
  return new URL(config.installationUrl).pathname.split("/").at(-1) ?? "";
}

function isExactLifecycleInstallation(
  installation: Every8dGhlMarketplaceInstallation,
  input: {
    config: Every8dGhlOAuthConfig;
    tenant?: Every8dGhlExactTenant;
    locationId: string;
    companyId?: string;
  }
): boolean {
  return installation.app_namespace === "every8d_connect" &&
    installation.marketplace_app_id === input.config.marketplaceAppId &&
    installation.oauth_client_id === input.config.oauthClientId &&
    (!input.tenant || installation.tenant_id === input.tenant.id) &&
    installation.location_id === input.locationId &&
    installation.company_id !== null &&
    (!input.companyId || installation.company_id === input.companyId) &&
    installation.conversation_provider_id === input.config.conversationProviderId &&
    installation.channel === "sms" &&
    installation.provider === "every8d" &&
    (installation.status === "pending" ||
      installation.status === "active" ||
      installation.status === "uninstalled");
}

export function createEvery8dGhlMarketplaceLifecycleService(
  dependencies: LifecycleDependencies
): { handle(payload: Every8dGhlMarketplaceLifecyclePayload): Promise<Every8dGhlMarketplaceLifecycleResult> } {
  return {
    async handle(payload) {
      if (!dependencies.config.enabled) {
        throw new Every8dGhlMarketplaceLifecycleError(
          "lifecycle_disabled",
          "EVERY8D Connect lifecycle runtime is disabled"
        );
      }

      try {
        assertEvery8dGhlOAuthConfig(dependencies.config);
      } catch {
        throw new Every8dGhlMarketplaceLifecycleError(
          "lifecycle_disabled",
          "EVERY8D Connect lifecycle runtime configuration is invalid"
        );
      }

      if (
        !dependencies.config.marketplaceAppId ||
        !dependencies.config.oauthClientId ||
        !dependencies.config.conversationProviderId ||
        payload.appId !== dependencies.config.marketplaceAppId ||
        payload.versionId !== configuredMarketplaceVersionId(dependencies.config) ||
        !payload.locationId ||
        !exactOwnershipIdentifier.test(payload.locationId) ||
        hasForbiddenOwnershipMode(payload)
      ) {
        rejected();
      }

      if (payload.type === "INSTALL") {
        if (
          payload.installType !== "Location" ||
          !payload.companyId ||
          !exactOwnershipIdentifier.test(payload.companyId)
        ) {
          rejected();
        }

        const tenant = await dependencies.getExactTenant(payload.locationId);
        if (
          !tenant ||
          tenant.location_id !== payload.locationId ||
          tenant.ghl_provider_id === dependencies.config.conversationProviderId
        ) {
          throw new Every8dGhlMarketplaceLifecycleError(
            "tenant_not_exact",
            "EVERY8D Connect tenant ownership was not exact"
          );
        }

        const installation = await dependencies.applyLifecycleEvent({
          eventType: "INSTALL",
          marketplaceAppId: dependencies.config.marketplaceAppId,
          oauthClientId: dependencies.config.oauthClientId,
          tenantId: tenant.id,
          locationId: payload.locationId,
          companyId: payload.companyId,
          conversationProviderId: dependencies.config.conversationProviderId,
          eventAt: payload.timestamp,
          eventId: payload.webhookId
        });

        if (installation.status === "disabled" || !isExactLifecycleInstallation(installation, {
          config: dependencies.config,
          tenant,
          locationId: payload.locationId,
          companyId: payload.companyId
        })) {
          throw new Every8dGhlMarketplaceLifecycleError(
            "ownership_conflict",
            "EVERY8D Connect installation ownership conflicted"
          );
        }

        return {
          status: installation.status,
          installationId: installation.id,
          installationGeneration: installation.installation_generation
        };
      }

      if (payload.type === "UNINSTALL") {
        const installation = await dependencies.applyLifecycleEvent({
          eventType: "UNINSTALL",
          marketplaceAppId: dependencies.config.marketplaceAppId,
          oauthClientId: dependencies.config.oauthClientId,
          tenantId: null,
          locationId: payload.locationId,
          companyId: null,
          conversationProviderId: dependencies.config.conversationProviderId,
          eventAt: payload.timestamp,
          eventId: payload.webhookId
        });

        if (!installation || installation.status === "disabled" || !isExactLifecycleInstallation(installation, {
          config: dependencies.config,
          locationId: payload.locationId
        })) {
          throw new Every8dGhlMarketplaceLifecycleError(
            "ownership_conflict",
            "EVERY8D Connect installation ownership conflicted"
          );
        }

        return {
          status: installation.status,
          installationId: installation.id,
          installationGeneration: installation.installation_generation
        };
      }

      rejected();
    }
  };
}

export const every8dGhlMarketplaceLifecycleService = createEvery8dGhlMarketplaceLifecycleService({
  config: readEvery8dGhlOAuthConfig(),
  getExactTenant: getExactExistingTenantForEvery8d,
  applyLifecycleEvent: (input) => every8dGhlOAuthRepository.applyLifecycleEvent(input)
});
