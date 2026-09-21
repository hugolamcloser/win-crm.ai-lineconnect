import {
  assertEvery8dGhlOAuthConfig,
  readEvery8dGhlOAuthConfig,
  type Every8dGhlOAuthConfig
} from "../config/every8dGhlOAuth";
import {
  getExactExistingTenantForEvery8d,
  uninstallEvery8dGhlMarketplaceInstallation,
  type Every8dGhlExactTenant
} from "./every8dGhlOAuthRepository";

export type Every8dGhlMarketplaceLifecyclePayload = {
  type: string;
  appId?: string;
  appNamespace?: string;
  installType?: string;
  locationId?: string;
  companyId?: string;
  isBulkInstallation?: boolean;
  installToFutureLocations?: boolean;
  approveAllLocations?: boolean;
};

export type Every8dGhlMarketplaceLifecycleResult = {
  status: "pending" | "uninstalled";
  installationId: string;
  installationGeneration: number;
};

export class Every8dGhlMarketplaceLifecycleError extends Error {
  readonly code: "lifecycle_disabled" | "lifecycle_rejected" | "tenant_not_exact" | "provisioning_blocked" | "ownership_conflict";

  constructor(
    code: "lifecycle_disabled" | "lifecycle_rejected" | "tenant_not_exact" | "provisioning_blocked" | "ownership_conflict",
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
  uninstallInstallation(input: {
    marketplaceAppId: string;
    oauthClientId: string;
    locationId: string;
    conversationProviderId: string;
  }): Promise<{ id: string; status: string; installation_generation: number } | null>;
};

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
        payload.appNamespace !== "every8d_connect" ||
        payload.installType !== "Location" ||
        !payload.locationId ||
        hasForbiddenOwnershipMode(payload)
      ) {
        rejected();
      }

      if (payload.type === "INSTALL") {
        if (!payload.companyId) rejected();

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

        // The signed event provides companyId, but the approved installation table has no
        // immutable company binding. Do not discard that evidence or route it through the
        // legacy LINE onboarding tables. Provisioning stays blocked pending an additive design.
        throw new Every8dGhlMarketplaceLifecycleError(
          "provisioning_blocked",
          "EVERY8D Connect installation provisioning requires an approved company binding"
        );
      }

      if (payload.type === "UNINSTALL") {
        const installation = await dependencies.uninstallInstallation({
          marketplaceAppId: dependencies.config.marketplaceAppId,
          oauthClientId: dependencies.config.oauthClientId,
          locationId: payload.locationId,
          conversationProviderId: dependencies.config.conversationProviderId
        });

        if (!installation || installation.status !== "uninstalled") {
          throw new Every8dGhlMarketplaceLifecycleError(
            "ownership_conflict",
            "EVERY8D Connect installation ownership conflicted"
          );
        }

        return {
          status: "uninstalled",
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
  uninstallInstallation: uninstallEvery8dGhlMarketplaceInstallation
});
