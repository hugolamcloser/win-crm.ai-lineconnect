import type { Every8dSettingsAuthPurpose } from "../services/every8dSettingsAuthPrimitives";
import type {
  Every8dSettingsEmailDeliveryFailureClass,
  Every8dSettingsEmailDeliveryRequest,
  Every8dSettingsEmailDeliveryResult
} from "./every8dSettingsAuthEmailDelivery";

export type Every8dSettingsAuthRepositoryFailureCategory =
  | "repository_unavailable"
  | "repository_contract_violation";

export type Every8dSettingsAuthRepositoryFailure = Readonly<{
  outcome: "failure";
  category: Every8dSettingsAuthRepositoryFailureCategory;
}>;

export type Every8dSettingsChallengeCreationMetadata = Readonly<{
  challengeId: string;
  createdAt: Date;
  expiresAt: Date;
}>;

export type Every8dSettingsLiveChallengeMetadata = Readonly<{
  challengeId: string;
  enrollmentGrantId: string | null;
  normalizedEmail: string;
  emailPseudonym: string;
  otpHmacKeyVersion: string;
}>;

export type Every8dSettingsChallengeRequestRepositoryResult =
  | Readonly<{ outcome: "prepared"; challenge: Every8dSettingsChallengeCreationMetadata }>
  | Readonly<{ outcome: "not_prepared" }>
  | Every8dSettingsAuthRepositoryFailure;

export type Every8dSettingsChallengeDeliveryRepositoryResult =
  | Readonly<{ outcome: "recorded" }>
  | Readonly<{ outcome: "not_recorded" }>
  | Every8dSettingsAuthRepositoryFailure;

export type Every8dSettingsChallengeDiscoveryRepositoryResult =
  | Readonly<{ outcome: "discovered"; challenge: Every8dSettingsLiveChallengeMetadata }>
  | Readonly<{ outcome: "not_found" }>
  | Every8dSettingsAuthRepositoryFailure;

export type Every8dSettingsChallengeVerificationRepositoryResult =
  | Readonly<{ outcome: "verified" }>
  | Readonly<{ outcome: "rejected" }>
  | Every8dSettingsAuthRepositoryFailure;

export type Every8dSettingsAuthRepository = Readonly<{
  requestEnrollmentChallenge(input: Readonly<{
    enrollmentGrantTokenHash: Buffer;
    challengeId: string;
    normalizedEmail: string;
    emailPseudonym: string;
    emailPseudonymAliases: readonly string[];
    requestTokenHash: Buffer;
    otpHmac: Buffer;
    otpHmacKeyVersion: string;
  }>): Promise<Every8dSettingsChallengeRequestRepositoryResult>;

  requestLoginChallenge(input: Readonly<{
    challengeId: string;
    normalizedEmail: string;
    emailPseudonym: string;
    emailPseudonymAliases: readonly string[];
    requestTokenHash: Buffer;
    otpHmac: Buffer;
    otpHmacKeyVersion: string;
  }>): Promise<Every8dSettingsChallengeRequestRepositoryResult>;

  recordChallengeDelivery(input: Readonly<{
    requestTokenHash: Buffer;
    succeeded: boolean;
    failureClass: Every8dSettingsEmailDeliveryFailureClass | null;
  }>): Promise<Every8dSettingsChallengeDeliveryRepositoryResult>;

  discoverLiveChallenge(input: Readonly<{
    requestTokenHash: Buffer;
    purpose: Every8dSettingsAuthPurpose;
  }>): Promise<Every8dSettingsChallengeDiscoveryRepositoryResult>;

  verifyChallenge(input: Readonly<{
    requestTokenHash: Buffer;
    purpose: Every8dSettingsAuthPurpose;
    emailPseudonymAliases: readonly string[];
    candidateOtpHmac: Buffer;
  }>): Promise<Every8dSettingsChallengeVerificationRepositoryResult>;
}>;

export type Every8dSettingsChallengeDeliveryHandle = Readonly<{
  requestTokenHash: Buffer;
}>;

export type Every8dSettingsPreparedChallenge = Readonly<{
  challengeId: string;
  purpose: Every8dSettingsAuthPurpose;
  createdAt: Date;
  expiresAt: Date;
  requestCapability: string;
  deliveryRequest: Readonly<Every8dSettingsEmailDeliveryRequest>;
  deliveryHandle: Every8dSettingsChallengeDeliveryHandle;
}>;

export type Every8dSettingsChallengeRequestAccepted = Readonly<{
  outcome: "accepted";
  deliveryCommand: Every8dSettingsPreparedChallenge | null;
}>;

export type Every8dSettingsAuthDisabled = Readonly<{ outcome: "disabled" }>;
export type Every8dSettingsChallengeRecorded = Readonly<{ outcome: "recorded" }>;
export type Every8dSettingsChallengeNotRecorded = Readonly<{ outcome: "not_recorded" }>;
export type Every8dSettingsChallengeRejected = Readonly<{ outcome: "rejected" }>;
export type Every8dSettingsAuthUnavailable = Readonly<{ outcome: "unavailable" }>;
export type Every8dSettingsVerifiedChallenge = Readonly<{
  outcome: "verified";
  challengeId: string;
  purpose: Every8dSettingsAuthPurpose;
}>;

export type Every8dSettingsAuthService = Readonly<{
  requestEnrollmentChallenge(input: Readonly<{
    enrollmentGrantTokenHash: Buffer;
    email: unknown;
  }>): Promise<Every8dSettingsAuthDisabled | Every8dSettingsChallengeRequestAccepted>;

  requestLoginChallenge(input: Readonly<{
    email: unknown;
  }>): Promise<Every8dSettingsAuthDisabled | Every8dSettingsChallengeRequestAccepted>;

  recordChallengeDelivery(input: Readonly<{
    deliveryHandle: Every8dSettingsChallengeDeliveryHandle;
    result: Every8dSettingsEmailDeliveryResult;
  }>): Promise<
    Every8dSettingsAuthDisabled |
    Every8dSettingsChallengeRecorded |
    Every8dSettingsChallengeNotRecorded |
    Every8dSettingsAuthUnavailable
  >;

  verifyChallenge(input: Readonly<{
    requestCapability: unknown;
    purpose: Every8dSettingsAuthPurpose;
    otp: unknown;
  }>): Promise<
    Every8dSettingsAuthDisabled |
    Every8dSettingsChallengeRejected |
    Every8dSettingsAuthUnavailable |
    Every8dSettingsVerifiedChallenge
  >;
}>;
