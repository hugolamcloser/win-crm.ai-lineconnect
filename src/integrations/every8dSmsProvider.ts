import {
  Every8dClient,
  Every8dClientError,
  type Every8dLogger,
  type Every8dTransport,
} from "./every8dClient";
import type { SmsProviderFactory } from "../services/smsOutboundService";
import type {
  Every8dSmsProviderConfiguration,
  SmsProviderConfiguration,
} from "../services/smsProviderConfigService";
import {
  SmsProviderError,
  type SmsFailureCode,
  type SmsNormalizedFailure,
  type SmsProvider,
  type SmsProviderSendInput,
  type SmsProviderSendResult,
} from "../types/sms";

export const EVERY8D_MOCK_TRANSPORT_KIND = "every8d_mock_only" as const;

export interface Every8dMockOnlyTransport extends Every8dTransport {
  readonly kind: typeof EVERY8D_MOCK_TRANSPORT_KIND;
}

export interface Every8dSmsProviderFactoryOptions {
  transport: Every8dMockOnlyTransport;
  logger: Every8dLogger;
}

function mappedFailureCode(error: Every8dClientError): SmsFailureCode {
  switch (error.code) {
    case "invalid_configuration":
      return "provider_configuration_invalid";
    case "invalid_request":
      return "provider_failure";
    case "http_failure":
      return "http_failure";
    case "provider_failure":
      return "provider_rejected";
    case "malformed_response":
      return "malformed_provider_response";
    case "timeout":
      return "timeout";
    case "network_failure":
      return "network_failure";
  }
}

function mapClientError(error: Every8dClientError): SmsNormalizedFailure {
  return {
    code: mappedFailureCode(error),
    stage: "provider",
    retryable: false,
    retryAttempted: false,
    providerOperation: error.operation,
    httpStatus: error.httpStatus,
    providerStatus: error.providerStatus,
  };
}

class Every8dSmsProvider implements SmsProvider {
  private readonly configuration: Every8dSmsProviderConfiguration;
  private readonly transport: Every8dMockOnlyTransport;
  private readonly logger: Every8dLogger;

  constructor(
    configuration: Every8dSmsProviderConfiguration,
    transport: Every8dMockOnlyTransport,
    logger: Every8dLogger,
  ) {
    this.configuration = configuration;
    this.transport = transport;
    this.logger = logger;
  }

  async send(input: SmsProviderSendInput): Promise<SmsProviderSendResult> {
    try {
      const client = new Every8dClient(
        this.configuration.credentials,
        this.transport,
        this.logger,
      );
      const authentication = await client.authenticate();
      const send = await client.sendSms({
        token: authentication.token,
        recipient: input.destination,
        message: input.message,
      });

      return {
        provider: "every8d",
        result: {
          httpStatus: send.httpStatus,
          sentCount: send.sentCount,
          unsentCount: send.unsentCount,
          cost: send.cost,
        },
        correlation: {
          batchId: send.batchId,
          bid: send.batchId,
          bidSource: "batch_id",
        },
      };
    } catch (error) {
      if (error instanceof Every8dClientError) {
        throw new SmsProviderError(mapClientError(error));
      }

      throw new SmsProviderError({
        code: "provider_failure",
        stage: "provider",
        retryable: false,
        retryAttempted: false,
      });
    }
  }
}

export class Every8dSmsProviderFactory implements SmsProviderFactory {
  private readonly transport: Every8dMockOnlyTransport;
  private readonly logger: Every8dLogger;

  constructor(options: Every8dSmsProviderFactoryOptions) {
    if (options.transport.kind !== EVERY8D_MOCK_TRANSPORT_KIND) {
      throw new Error(
        "Phase 2A EVERY8D adapter requires a mock-only transport",
      );
    }

    this.transport = options.transport;
    this.logger = options.logger;
  }

  create(configuration: SmsProviderConfiguration): SmsProvider {
    if (configuration.provider !== "every8d") {
      throw new Error(
        "EVERY8D adapter received an unsupported provider configuration",
      );
    }

    return new Every8dSmsProvider(configuration, this.transport, this.logger);
  }
}
