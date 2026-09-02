import {
  SMS_PROVIDERS,
  type SmsFailureCode,
  type SmsProviderName,
} from "../types/sms";

export interface Every8dSmsProviderCredentials {
  siteUrl: string;
  uid: string;
  password: string;
  timeoutMs: number;
}

export interface Every8dSmsProviderConfiguration {
  configurationId: string;
  tenantId: string;
  locationId: string;
  provider: "every8d";
  providerMode?: "mock" | "controlled_live";
  enabled: boolean;
  credentials: Every8dSmsProviderCredentials;
}

export type SmsProviderConfiguration = Every8dSmsProviderConfiguration;

export interface SmsProviderConfigurationSelector {
  tenantId: string;
  locationId: string;
  provider: string;
}

export class SmsProviderConfigurationError extends Error {
  readonly code: SmsFailureCode;

  constructor(code: SmsFailureCode) {
    super(`SMS provider configuration resolution failed: ${code}`);
    this.name = "SmsProviderConfigurationError";
    this.code = code;
  }
}

function normalizedRequired(value: string, code: SmsFailureCode): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new SmsProviderConfigurationError(code);
  }

  return normalized;
}

function isSupportedProvider(provider: string): provider is SmsProviderName {
  return SMS_PROVIDERS.some((candidate) => candidate === provider);
}

export class SmsProviderConfigService {
  private readonly configurations: SmsProviderConfiguration[];

  constructor(configurations: readonly SmsProviderConfiguration[]) {
    this.configurations = configurations.map((configuration) => ({
      ...configuration,
      credentials: { ...configuration.credentials },
    }));
  }

  resolve(
    selector: SmsProviderConfigurationSelector,
  ): SmsProviderConfiguration {
    const tenantId = normalizedRequired(selector.tenantId, "missing_tenant_id");
    const locationId = normalizedRequired(
      selector.locationId,
      "missing_location_id",
    );
    const provider = normalizedRequired(selector.provider, "missing_provider");

    if (!isSupportedProvider(provider)) {
      throw new SmsProviderConfigurationError("unsupported_provider");
    }

    const providerMatches = this.configurations.filter(
      (configuration) => configuration.provider === provider,
    );
    const exactMatches = providerMatches.filter(
      (configuration) =>
        configuration.tenantId === tenantId &&
        configuration.locationId === locationId,
    );

    if (exactMatches.length > 1) {
      throw new SmsProviderConfigurationError("ambiguous_configuration");
    }

    if (exactMatches.length === 1) {
      const configuration = exactMatches[0];

      if (!configuration.enabled) {
        throw new SmsProviderConfigurationError("configuration_disabled");
      }

      return {
        ...configuration,
        credentials: { ...configuration.credentials },
      };
    }

    const sameTenant = providerMatches.filter(
      (configuration) => configuration.tenantId === tenantId,
    );
    const sameLocation = providerMatches.filter(
      (configuration) => configuration.locationId === locationId,
    );

    if (sameTenant.length > 0 && sameLocation.length > 0) {
      throw new SmsProviderConfigurationError("ambiguous_configuration");
    }

    if (sameLocation.length > 0) {
      throw new SmsProviderConfigurationError("tenant_mismatch");
    }

    if (sameTenant.length > 0) {
      throw new SmsProviderConfigurationError("location_mismatch");
    }

    throw new SmsProviderConfigurationError("configuration_not_found");
  }
}
