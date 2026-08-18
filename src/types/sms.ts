export const SMS_PROVIDERS = ["every8d"] as const;

export type SmsProviderName = (typeof SMS_PROVIDERS)[number];

export interface OutboundSmsRequest {
  tenantId: string;
  locationId: string;
  provider: string;
  destination: string;
  message: string;
  reference?: string;
}

export interface SmsProviderCorrelation {
  batchId?: string;
  bid?: string;
  bidSource?: "provider" | "batch_id";
  mr?: string[];
}

export interface SmsProviderResult {
  httpStatus?: number;
  providerStatus?: string;
  sentCount?: number;
  unsentCount?: number;
  cost?: string;
}

export interface SmsProviderSendInput {
  destination: string;
  message: string;
  reference?: string;
}

export interface SmsProviderSendResult {
  provider: SmsProviderName;
  result: SmsProviderResult;
  correlation: SmsProviderCorrelation;
}

export interface SmsProvider {
  send(input: SmsProviderSendInput): Promise<SmsProviderSendResult>;
}

export type SmsFailureCode =
  | "service_disabled"
  | "missing_tenant_id"
  | "missing_location_id"
  | "missing_provider"
  | "unsupported_provider"
  | "invalid_destination"
  | "invalid_message"
  | "invalid_reference"
  | "configuration_not_found"
  | "tenant_mismatch"
  | "location_mismatch"
  | "ambiguous_configuration"
  | "configuration_disabled"
  | "provider_configuration_invalid"
  | "provider_rejected"
  | "http_failure"
  | "timeout"
  | "network_failure"
  | "malformed_provider_response"
  | "provider_failure";

export type SmsFailureStage = "gate" | "request" | "configuration" | "provider";

export interface SmsNormalizedFailure {
  code: SmsFailureCode;
  stage: SmsFailureStage;
  retryable: false;
  retryAttempted: false;
  providerOperation?: string;
  httpStatus?: number;
  providerStatus?: string;
}

export class SmsProviderError extends Error {
  readonly failure: SmsNormalizedFailure;

  constructor(failure: SmsNormalizedFailure) {
    super(`SMS provider operation failed: ${failure.code}`);
    this.name = "SmsProviderError";
    this.failure = failure;
  }
}

export interface SmsOutboundSuccess {
  ok: true;
  tenantId: string;
  locationId: string;
  provider: SmsProviderName;
  reference?: string;
  providerAttempts: 1;
  providerResult: SmsProviderResult;
  correlation: SmsProviderCorrelation;
}

export interface SmsOutboundFailure {
  ok: false;
  tenantId?: string;
  locationId?: string;
  provider?: string;
  reference?: string;
  providerAttempts: 0 | 1;
  failure: SmsNormalizedFailure;
  correlation?: SmsProviderCorrelation;
}

export type SmsOutboundResult = SmsOutboundSuccess | SmsOutboundFailure;
