import {
  SmsProviderConfigurationError,
  type SmsProviderConfiguration,
  type SmsProviderConfigService,
} from "./smsProviderConfigService";
import {
  SmsProviderError,
  type OutboundSmsRequest,
  type SmsFailureCode,
  type SmsNormalizedFailure,
  type SmsOutboundFailure,
  type SmsOutboundResult,
  type SmsProvider,
  type SmsProviderName,
} from "../types/sms";

export interface SmsOutboundLogger {
  info(metadata: Record<string, unknown>, message: string): void;
  error(metadata: Record<string, unknown>, message: string): void;
}

export interface SmsProviderFactory {
  create(configuration: SmsProviderConfiguration): SmsProvider;
}

export interface SmsOutboundServiceOptions {
  enabled?: boolean;
  configService: SmsProviderConfigService;
  providerFactories: Partial<Record<SmsProviderName, SmsProviderFactory>>;
  logger: SmsOutboundLogger;
}

function failure(
  code: SmsFailureCode,
  stage: SmsNormalizedFailure["stage"],
): SmsNormalizedFailure {
  return {
    code,
    stage,
    retryable: false,
    retryAttempted: false,
  };
}

function safeIdentity(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

function buildFailureResult(
  request: OutboundSmsRequest,
  normalizedFailure: SmsNormalizedFailure,
  providerAttempts: 0 | 1,
): SmsOutboundFailure {
  return {
    ok: false,
    tenantId: safeIdentity(request.tenantId),
    locationId: safeIdentity(request.locationId),
    provider: safeIdentity(request.provider),
    reference: safeIdentity(request.reference ?? ""),
    providerAttempts,
    failure: normalizedFailure,
  };
}

function validateRequest(
  request: OutboundSmsRequest,
): SmsNormalizedFailure | undefined {
  if (!request.tenantId.trim()) {
    return failure("missing_tenant_id", "request");
  }

  if (!request.locationId.trim()) {
    return failure("missing_location_id", "request");
  }

  if (!request.provider.trim()) {
    return failure("missing_provider", "request");
  }

  const destination = request.destination.trim();
  const destinationDigits = destination.startsWith("+")
    ? destination.slice(1)
    : destination;

  if (
    !destination ||
    !/^\d+$/.test(destinationDigits) ||
    destinationDigits.length < 8 ||
    destinationDigits.length > 15 ||
    /[,;\s\r\n]/.test(destination)
  ) {
    return failure("invalid_destination", "request");
  }

  const messageLength = Array.from(request.message).length;

  if (
    !request.message.trim() ||
    messageLength > 333 ||
    /[\u0000]/.test(request.message)
  ) {
    return failure("invalid_message", "request");
  }

  if (request.reference !== undefined) {
    const reference = request.reference.trim();

    if (
      !reference ||
      reference.length > 128 ||
      /[\u0000\r\n]/.test(reference)
    ) {
      return failure("invalid_reference", "request");
    }
  }

  return undefined;
}

export class SmsOutboundService {
  private readonly enabled: boolean;
  private readonly configService: SmsProviderConfigService;
  private readonly providerFactories: Partial<
    Record<SmsProviderName, SmsProviderFactory>
  >;
  private readonly logger: SmsOutboundLogger;

  constructor(options: SmsOutboundServiceOptions) {
    this.enabled = options.enabled === true;
    this.configService = options.configService;
    this.providerFactories = { ...options.providerFactories };
    this.logger = options.logger;
  }

  async send(request: OutboundSmsRequest): Promise<SmsOutboundResult> {
    if (!this.enabled) {
      return buildFailureResult(
        request,
        failure("service_disabled", "gate"),
        0,
      );
    }

    const requestFailure = validateRequest(request);

    if (requestFailure) {
      return buildFailureResult(request, requestFailure, 0);
    }

    let configuration: SmsProviderConfiguration;

    try {
      configuration = this.configService.resolve({
        tenantId: request.tenantId,
        locationId: request.locationId,
        provider: request.provider,
      });
    } catch (error) {
      const configurationFailure =
        error instanceof SmsProviderConfigurationError
          ? failure(error.code, "configuration")
          : failure("provider_configuration_invalid", "configuration");
      return buildFailureResult(request, configurationFailure, 0);
    }

    const factory = this.providerFactories[configuration.provider];

    if (!factory) {
      return buildFailureResult(
        request,
        failure("unsupported_provider", "configuration"),
        0,
      );
    }

    let provider: SmsProvider;

    try {
      provider = factory.create(configuration);
    } catch {
      return buildFailureResult(
        request,
        failure("provider_configuration_invalid", "configuration"),
        0,
      );
    }

    try {
      const providerResponse = await provider.send({
        destination: request.destination.trim(),
        message: request.message,
        reference: request.reference?.trim(),
      });

      this.logger.info(
        {
          provider: configuration.provider,
          outcome: "accepted",
          providerAttempts: 1,
        },
        "Outbound SMS provider operation completed",
      );

      return {
        ok: true,
        tenantId: request.tenantId.trim(),
        locationId: request.locationId.trim(),
        provider: configuration.provider,
        reference: request.reference?.trim(),
        providerAttempts: 1,
        providerResult: { ...providerResponse.result },
        correlation: {
          ...providerResponse.correlation,
          mr: providerResponse.correlation.mr
            ? [...providerResponse.correlation.mr]
            : undefined,
        },
      };
    } catch (error) {
      const providerFailure =
        error instanceof SmsProviderError
          ? {
              ...error.failure,
              retryable: false as const,
              retryAttempted: false as const,
            }
          : failure("provider_failure", "provider");

      this.logger.error(
        {
          provider: configuration.provider,
          outcome: "failed",
          failureCode: providerFailure.code,
          providerAttempts: 1,
          retryAttempted: false,
        },
        "Outbound SMS provider operation failed",
      );

      return buildFailureResult(request, providerFailure, 1);
    }
  }
}
