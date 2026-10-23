import type { Every8dSettingsAuthPurpose } from "../services/every8dSettingsAuthPrimitives";
import type {
  Every8dSettingsAuthDisabled,
  Every8dSettingsAuthRepositoryFailure,
  Every8dSettingsAuthUnavailable,
  Every8dSettingsChallengeRejected
} from "./every8dSettingsAuthOrchestration";

export type Every8dSettingsVerifiedSessionChallenge = Readonly<{
  challengeId: string;
  normalizedEmail: string;
  emailPseudonym: string;
}> & (
  | Readonly<{ purpose: "enrollment"; enrollmentGrantId: string }>
  | Readonly<{ purpose: "login"; enrollmentGrantId: null }>
);

export type Every8dSettingsSessionPrincipal = Readonly<{
  administratorId: string;
  installationId: string;
  installationGeneration: number;
  expiresAt: Date;
}>;

export type Every8dSettingsIssuedSession = Every8dSettingsSessionPrincipal & Readonly<{
  createdAt: Date;
}>;

export type Every8dSettingsVerifiedSessionDiscoveryResult =
  | Readonly<{ outcome: "discovered"; challenge: Every8dSettingsVerifiedSessionChallenge }>
  | Readonly<{ outcome: "not_found" }>
  | Every8dSettingsAuthRepositoryFailure;

export type Every8dSettingsSessionConsumptionResult =
  | Readonly<{ outcome: "consumed"; session: Every8dSettingsIssuedSession }>
  | Readonly<{ outcome: "not_consumed" }>
  | Every8dSettingsAuthRepositoryFailure;

export type Every8dSettingsSessionAuthenticationResult =
  | Readonly<{ outcome: "authenticated"; principal: Every8dSettingsSessionPrincipal }>
  | Readonly<{ outcome: "unauthorized" }>
  | Every8dSettingsAuthRepositoryFailure;

export type Every8dSettingsSessionRevocationResult =
  | Readonly<{ outcome: "revoked" }>
  | Every8dSettingsAuthRepositoryFailure;

export type Every8dSettingsSessionConsumeInput = Readonly<{
  requestTokenHash: Buffer;
  emailPseudonymAliases: readonly string[];
  sessionTokenHash: Buffer;
}>;

export type Every8dSettingsSessionRepository = Readonly<{
  discoverVerifiedChallenge(input: Readonly<{
    requestTokenHash: Buffer;
    purpose: Every8dSettingsAuthPurpose;
  }>): Promise<Every8dSettingsVerifiedSessionDiscoveryResult>;
  consumeEnrollmentChallenge(
    input: Every8dSettingsSessionConsumeInput
  ): Promise<Every8dSettingsSessionConsumptionResult>;
  consumeLoginChallenge(
    input: Every8dSettingsSessionConsumeInput
  ): Promise<Every8dSettingsSessionConsumptionResult>;
  authenticateSession(input: Readonly<{
    sessionTokenHash: Buffer;
  }>): Promise<Every8dSettingsSessionAuthenticationResult>;
  revokeSession(input: Readonly<{
    sessionTokenHash: Buffer;
  }>): Promise<Every8dSettingsSessionRevocationResult>;
}>;

export type Every8dSettingsSessionService = Readonly<{
  verifyAndConsume(input: Readonly<{
    requestCapability: unknown;
    purpose: Every8dSettingsAuthPurpose;
    otp: unknown;
  }>): Promise<
    | Every8dSettingsAuthDisabled
    | Every8dSettingsChallengeRejected
    | Every8dSettingsAuthUnavailable
    | (Every8dSettingsIssuedSession & Readonly<{
      outcome: "session_issued";
      sessionCredential: string;
    }>)
  >;
  authenticateSession(input: Readonly<{ sessionCredential: unknown }>): Promise<
    | Every8dSettingsAuthDisabled
    | Every8dSettingsAuthUnavailable
    | Readonly<{ outcome: "unauthorized" }>
    | Readonly<{ outcome: "authenticated"; principal: Every8dSettingsSessionPrincipal }>
  >;
  revokeSession(input: Readonly<{ sessionCredential: unknown }>): Promise<
    | Every8dSettingsAuthDisabled
    | Every8dSettingsAuthUnavailable
    | Readonly<{ outcome: "unauthorized" }>
    | Readonly<{ outcome: "revoked" }>
  >;
}>;
