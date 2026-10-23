import type { Every8dSettingsAuthConfig } from "../config/every8dSettingsAuth";
import type { Every8dSettingsAuthService } from "../types/every8dSettingsAuthOrchestration";
import type {
  Every8dSettingsSessionRepository, Every8dSettingsSessionService
} from "../types/every8dSettingsSession";
import {
  deriveEvery8dSettingsEmailPseudonyms, hashEvery8dSettingsRequestCapability
} from "./every8dSettingsAuthPrimitives";
import { createEvery8dSettingsAuthService } from "./every8dSettingsAuthService";
import { createEvery8dSettingsSessionRepository } from "./every8dSettingsSessionRepository";
import {
  generateEvery8dSettingsSessionCredential, hashEvery8dSettingsSessionCredential
} from "./every8dSettingsSessionPrimitives";

const disabled = Object.freeze({ outcome: "disabled" } as const);
const unavailable = Object.freeze({ outcome: "unavailable" } as const);
const rejected = Object.freeze({ outcome: "rejected" } as const);
const unauthorized = Object.freeze({ outcome: "unauthorized" } as const);
const pseudonymPattern = /^[A-Za-z0-9_.-]{1,63}:[0-9a-f]{64}$/;

type Dependencies = Readonly<{
  repositoryFactory?: () => Every8dSettingsSessionRepository;
  verifierFactory?: () => Pick<Every8dSettingsAuthService, "verifyChallenge">;
  credentialFactory?: () => string;
}>;

export function createEvery8dSettingsSessionService(
  config: Every8dSettingsAuthConfig, dependencies: Dependencies = {}
): Every8dSettingsSessionService {
  return Object.freeze({
    async verifyAndConsume(input) {
      if (!config.enabled || !config.httpEnabled) return disabled;
      try {
        const purpose = input.purpose;
        if (purpose !== "enrollment" && purpose !== "login") return rejected;
        const verificationInput = {
          purpose, requestCapability: input.requestCapability, otp: input.otp
        };
        const verifier = dependencies.verifierFactory
          ? dependencies.verifierFactory() : createEvery8dSettingsAuthService(config);
        const verified = await verifier.verifyChallenge(verificationInput);
        if (verified.outcome === "rejected") return rejected;
        if (verified.outcome !== "verified") return unavailable;

        const requestTokenHash = hashEvery8dSettingsRequestCapability(
          verificationInput.requestCapability
        );
        const repository = (dependencies.repositoryFactory ?? createEvery8dSettingsSessionRepository)();
        const discovery = await repository.discoverVerifiedChallenge({ requestTokenHash, purpose });
        if (discovery.outcome === "not_found") return rejected;
        if (discovery.outcome !== "discovered") return unavailable;
        const challenge = discovery.challenge;
        if (challenge.challengeId !== verified.challengeId || challenge.purpose !== verified.purpose ||
          challenge.purpose !== purpose || !config.emailPseudonymHmac
        ) return unavailable;

        const aliases = [...new Set(deriveEvery8dSettingsEmailPseudonyms({
          normalizedEmail: challenge.normalizedEmail,
          keyring: config.emailPseudonymHmac.keys
        }))];
        if (aliases.length < 1 || aliases.length > 64 ||
          !aliases.every((alias) => alias.trim() === alias && pseudonymPattern.test(alias)) ||
          !aliases.includes(challenge.emailPseudonym)
        ) return unavailable;

        const sessionCredential = (dependencies.credentialFactory ??
          generateEvery8dSettingsSessionCredential)();
        const sessionTokenHash = hashEvery8dSettingsSessionCredential(sessionCredential);
        const consumeInput = { requestTokenHash, emailPseudonymAliases: aliases, sessionTokenHash };
        const consumed = purpose === "enrollment"
          ? await repository.consumeEnrollmentChallenge(consumeInput)
          : await repository.consumeLoginChallenge(consumeInput);
        if (consumed.outcome === "not_consumed") return rejected;
        if (consumed.outcome !== "consumed") return unavailable;
        const session = consumed.session;
        // The sole credential-bearing result follows confirmed durable issuance.
        return Object.freeze({
          outcome: "session_issued", sessionCredential,
          administratorId: session.administratorId,
          installationId: session.installationId,
          installationGeneration: session.installationGeneration,
          createdAt: new Date(session.createdAt.getTime()),
          expiresAt: new Date(session.expiresAt.getTime())
        });
      } catch { return unavailable; }
    },
    async authenticateSession(input) {
      if (!config.enabled || !config.httpEnabled) return disabled;
      let sessionTokenHash: Buffer;
      try { sessionTokenHash = hashEvery8dSettingsSessionCredential(input.sessionCredential); }
      catch { return unauthorized; }
      try {
        const repository = (dependencies.repositoryFactory ?? createEvery8dSettingsSessionRepository)();
        const result = await repository.authenticateSession({ sessionTokenHash });
        if (result.outcome === "unauthorized") return unauthorized;
        if (result.outcome !== "authenticated") return unavailable;
        return Object.freeze({ outcome: "authenticated", principal: Object.freeze({
          administratorId: result.principal.administratorId,
          installationId: result.principal.installationId,
          installationGeneration: result.principal.installationGeneration,
          expiresAt: new Date(result.principal.expiresAt.getTime())
        }) });
      } catch { return unavailable; }
    },
    async revokeSession(input) {
      if (!config.enabled || !config.httpEnabled) return disabled;
      let sessionTokenHash: Buffer;
      try { sessionTokenHash = hashEvery8dSettingsSessionCredential(input.sessionCredential); }
      catch { return unauthorized; }
      try {
        const repository = (dependencies.repositoryFactory ?? createEvery8dSettingsSessionRepository)();
        const result = await repository.revokeSession({ sessionTokenHash });
        return result.outcome === "revoked" ? Object.freeze({ outcome: "revoked" }) : unavailable;
      } catch { return unavailable; }
    }
  });
}
