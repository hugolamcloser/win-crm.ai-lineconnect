import crypto from "node:crypto";
import type { Every8dSettingsAuthConfig } from "../config/every8dSettingsAuth";
import type { Every8dSettingsAuthPurpose } from "./every8dSettingsAuthPrimitives";
import {
  decodeEvery8dSettingsChallengeUuid,
  deriveActiveEvery8dSettingsEmailPseudonym,
  deriveActiveEvery8dSettingsOtpHmac,
  deriveEvery8dSettingsEmailPseudonyms,
  deriveEvery8dSettingsOtpHmac,
  formatEvery8dSettingsOtp,
  generateEvery8dSettingsOtp,
  generateEvery8dSettingsRequestCapability,
  hashEvery8dSettingsRequestCapability,
  normalizeEvery8dSettingsEmail,
  parseEvery8dSettingsOtp
} from "./every8dSettingsAuthPrimitives";
import { createEvery8dSettingsAuthRepository } from "./every8dSettingsAuthRepository";
import type {
  Every8dSettingsAuthRepository,
  Every8dSettingsAuthService,
  Every8dSettingsChallengeRequestAccepted,
  Every8dSettingsPreparedChallenge
} from "../types/every8dSettingsAuthOrchestration";

const disabled = Object.freeze({ outcome: "disabled" } as const);
const acceptedWithoutDelivery = Object.freeze({
  outcome: "accepted",
  deliveryCommand: null
} as const satisfies Every8dSettingsChallengeRequestAccepted);
const unavailable = Object.freeze({ outcome: "unavailable" } as const);
const rejected = Object.freeze({ outcome: "rejected" } as const);

const canonicalUuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type RepositoryFactory = () => Every8dSettingsAuthRepository;

function isPurpose(value: unknown): value is Every8dSettingsAuthPurpose {
  return value === "enrollment" || value === "login";
}

function deriveAliases(input: {
  normalizedEmail: string;
  config: NonNullable<Every8dSettingsAuthConfig["emailPseudonymHmac"]>;
}): { active: string; aliases: string[] } {
  const active = deriveActiveEvery8dSettingsEmailPseudonym({
    normalizedEmail: input.normalizedEmail,
    hmacConfig: input.config
  });
  const derived = deriveEvery8dSettingsEmailPseudonyms({
    normalizedEmail: input.normalizedEmail,
    keyring: input.config.keys
  });
  const aliases = [...new Set(derived)];
  if (!aliases.includes(active)) throw new Error("EVERY8D settings auth aliases are invalid");
  return { active, aliases };
}

function createChallengeUuid(): string {
  const challengeId = crypto.randomUUID();
  if (!canonicalUuidV4Pattern.test(challengeId)) {
    throw new Error("EVERY8D settings auth challenge UUID is invalid");
  }
  decodeEvery8dSettingsChallengeUuid(challengeId);
  return challengeId;
}

function freezePreparedChallenge(input: {
  challengeId: string;
  purpose: Every8dSettingsAuthPurpose;
  createdAt: Date;
  expiresAt: Date;
  requestCapability: string;
  normalizedEmail: string;
  displayOtp: string;
  requestTokenHash: Buffer;
}): Every8dSettingsPreparedChallenge {
  const createdAt = new Date(input.createdAt.getTime());
  const expiresAt = new Date(input.expiresAt.getTime());
  return Object.freeze({
    challengeId: input.challengeId,
    purpose: input.purpose,
    createdAt,
    expiresAt,
    requestCapability: input.requestCapability,
    deliveryRequest: Object.freeze({
      recipient: input.normalizedEmail,
      purpose: input.purpose,
      displayOtp: input.displayOtp,
      expiresAt: new Date(expiresAt.getTime())
    }),
    deliveryHandle: Object.freeze({ requestTokenHash: Buffer.from(input.requestTokenHash) })
  });
}

export function createEvery8dSettingsAuthService(
  config: Every8dSettingsAuthConfig,
  repositoryFactory: RepositoryFactory = createEvery8dSettingsAuthRepository
): Every8dSettingsAuthService {
  async function requestChallenge(input: {
    purpose: Every8dSettingsAuthPurpose;
    email: unknown;
    enrollmentGrantTokenHash?: Buffer;
  }): Promise<typeof disabled | Every8dSettingsChallengeRequestAccepted> {
    if (!config.enabled) return disabled;

    try {
      if (!config.emailPseudonymHmac || !config.otpHmac) return acceptedWithoutDelivery;
      if (
        input.purpose === "enrollment" &&
        (!Buffer.isBuffer(input.enrollmentGrantTokenHash) ||
          input.enrollmentGrantTokenHash.length !== 32)
      ) return acceptedWithoutDelivery;

      const normalizedEmail = normalizeEvery8dSettingsEmail(input.email);
      const { active: emailPseudonym, aliases: emailPseudonymAliases } = deriveAliases({
        normalizedEmail,
        config: config.emailPseudonymHmac
      });
      const challengeId = createChallengeUuid();
      const requestCapability = generateEvery8dSettingsRequestCapability();
      const requestTokenHash = hashEvery8dSettingsRequestCapability(requestCapability);
      const otp = generateEvery8dSettingsOtp();
      const displayOtp = formatEvery8dSettingsOtp(otp);
      const otpAuthority = deriveActiveEvery8dSettingsOtpHmac({
        purpose: input.purpose,
        challengeId,
        otp,
        hmacConfig: config.otpHmac
      });

      const repository = repositoryFactory();
      const result = input.purpose === "enrollment"
        ? await repository.requestEnrollmentChallenge({
          enrollmentGrantTokenHash: Buffer.from(input.enrollmentGrantTokenHash!),
          challengeId,
          normalizedEmail,
          emailPseudonym,
          emailPseudonymAliases,
          requestTokenHash: Buffer.from(requestTokenHash),
          otpHmac: Buffer.from(otpAuthority.hmac),
          otpHmacKeyVersion: otpAuthority.keyVersion
        })
        : await repository.requestLoginChallenge({
          challengeId,
          normalizedEmail,
          emailPseudonym,
          emailPseudonymAliases,
          requestTokenHash: Buffer.from(requestTokenHash),
          otpHmac: Buffer.from(otpAuthority.hmac),
          otpHmacKeyVersion: otpAuthority.keyVersion
        });

      if (result.outcome !== "prepared") return acceptedWithoutDelivery;
      return Object.freeze({
        outcome: "accepted",
        deliveryCommand: freezePreparedChallenge({
          challengeId: result.challenge.challengeId,
          purpose: input.purpose,
          createdAt: result.challenge.createdAt,
          expiresAt: result.challenge.expiresAt,
          requestCapability,
          normalizedEmail,
          displayOtp,
          requestTokenHash
        })
      });
    } catch {
      return acceptedWithoutDelivery;
    }
  }

  return Object.freeze({
    async requestEnrollmentChallenge(input) {
      if (!config.enabled) return disabled;
      return requestChallenge({
        purpose: "enrollment",
        email: input.email,
        enrollmentGrantTokenHash: input.enrollmentGrantTokenHash
      });
    },

    async requestLoginChallenge(input) {
      if (!config.enabled) return disabled;
      return requestChallenge({ purpose: "login", email: input.email });
    },

    async recordChallengeDelivery(input) {
      if (!config.enabled) return disabled;
      try {
        if (
          !Buffer.isBuffer(input.deliveryHandle.requestTokenHash) ||
          input.deliveryHandle.requestTokenHash.length !== 32 ||
          typeof input.result !== "object" || input.result === null ||
          typeof input.result.delivered !== "boolean"
        ) return unavailable;

        const succeeded = input.result.delivered;
        const failureClass = input.result.delivered ? null : input.result.failureClass;
        const result = await repositoryFactory().recordChallengeDelivery({
          requestTokenHash: Buffer.from(input.deliveryHandle.requestTokenHash),
          succeeded,
          failureClass
        });
        if (result.outcome === "recorded") return Object.freeze({ outcome: "recorded" });
        if (result.outcome === "not_recorded") {
          return Object.freeze({ outcome: "not_recorded" });
        }
        return unavailable;
      } catch {
        return unavailable;
      }
    },

    async verifyChallenge(input) {
      if (!config.enabled) return disabled;

      if (!isPurpose(input.purpose)) return rejected;

      let requestTokenHash: Buffer;
      let canonicalOtp: string;
      try {
        requestTokenHash = hashEvery8dSettingsRequestCapability(input.requestCapability);
        canonicalOtp = parseEvery8dSettingsOtp(input.otp);
      } catch {
        return rejected;
      }

      let repository: Every8dSettingsAuthRepository;
      try {
        repository = repositoryFactory();
        const discovery = await repository.discoverLiveChallenge({
          requestTokenHash: Buffer.from(requestTokenHash),
          purpose: input.purpose
        });
        if (discovery.outcome === "not_found") return rejected;
        if (discovery.outcome === "failure") return unavailable;
        if (!config.otpHmac || !config.emailPseudonymHmac) return unavailable;

        const storedVersion = discovery.challenge.otpHmacKeyVersion;
        if (!config.otpHmac.keys.has(storedVersion)) return unavailable;

        const candidateOtpHmac = deriveEvery8dSettingsOtpHmac({
          purpose: input.purpose,
          challengeId: discovery.challenge.challengeId,
          otp: canonicalOtp,
          keyVersion: storedVersion,
          keyring: config.otpHmac.keys
        });
        const aliases = [...new Set(deriveEvery8dSettingsEmailPseudonyms({
          normalizedEmail: discovery.challenge.normalizedEmail,
          keyring: config.emailPseudonymHmac.keys
        }))];
        if (!aliases.includes(discovery.challenge.emailPseudonym)) return unavailable;

        const verification = await repository.verifyChallenge({
          requestTokenHash: Buffer.from(requestTokenHash),
          purpose: input.purpose,
          emailPseudonymAliases: aliases,
          candidateOtpHmac: Buffer.from(candidateOtpHmac)
        });
        if (verification.outcome === "verified") {
          return Object.freeze({
            outcome: "verified",
            challengeId: discovery.challenge.challengeId,
            purpose: input.purpose
          });
        }
        if (verification.outcome === "rejected") return rejected;
        return unavailable;
      } catch {
        return unavailable;
      }
    }
  });
}
