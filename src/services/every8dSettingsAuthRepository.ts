import { getSupabase } from "../config/supabase";
import type { Every8dSettingsAuthPurpose } from "./every8dSettingsAuthPrimitives";
import { normalizeEvery8dSettingsEmail } from "./every8dSettingsAuthPrimitives";
import type {
  Every8dSettingsAuthRepository,
  Every8dSettingsAuthRepositoryFailure,
  Every8dSettingsChallengeCreationMetadata,
  Every8dSettingsChallengeDiscoveryRepositoryResult,
  Every8dSettingsChallengeRequestRepositoryResult
} from "../types/every8dSettingsAuthOrchestration";
import { every8dSettingsEmailDeliveryFailureClasses } from
  "../types/every8dSettingsAuthEmailDelivery";
import { isEvery8dSettingsAuthKeyVersion } from "../utils/every8dSettingsAuthKeyVersion";

const uuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const pseudonymPattern = /^[A-Za-z0-9_.-]{1,63}:[0-9a-f]{64}$/;
const timestampPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  rpc(name: string, input: Record<string, unknown>): PromiseLike<RpcResponse>;
}>;
type RpcClientGetter = () => RpcClient;

const unavailable = Object.freeze({
  outcome: "failure",
  category: "repository_unavailable"
} as const satisfies Every8dSettingsAuthRepositoryFailure);

const contractViolation = Object.freeze({
  outcome: "failure",
  category: "repository_contract_violation"
} as const satisfies Every8dSettingsAuthRepositoryFailure);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isPurpose(value: unknown): value is Every8dSettingsAuthPurpose {
  return value === "enrollment" || value === "login";
}

function isDigest(value: unknown): value is Buffer {
  return Buffer.isBuffer(value) && value.length === 32;
}

function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && uuidV4Pattern.test(value);
}

function isCanonicalEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return normalizeEvery8dSettingsEmail(value) === value;
  } catch {
    return false;
  }
}

function isPseudonym(value: unknown): value is string {
  return typeof value === "string" && pseudonymPattern.test(value);
}

function isAliases(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 64 &&
    value.every(isPseudonym);
}

function encodeBytea(value: Buffer): string {
  return `\\x${value.toString("hex")}`;
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = timestampPattern.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 15 || offsetMinute > 59
  ) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseCreationRows(
  value: unknown,
  expectedChallengeId: string
): Every8dSettingsChallengeRequestRepositoryResult {
  if (!Array.isArray(value)) return contractViolation;
  if (value.length === 0) return Object.freeze({ outcome: "not_prepared" });
  if (value.length !== 1 || !isRecord(value[0]) || !hasExactKeys(value[0], [
    "challenge_id", "created_at", "expires_at"
  ])) return contractViolation;

  const row = value[0];
  const createdAt = parseTimestamp(row.created_at);
  const expiresAt = parseTimestamp(row.expires_at);
  if (
    !isUuidV4(row.challenge_id) || row.challenge_id !== expectedChallengeId ||
    !createdAt || !expiresAt || createdAt.getTime() >= expiresAt.getTime()
  ) return contractViolation;

  const challenge: Every8dSettingsChallengeCreationMetadata = Object.freeze({
    challengeId: row.challenge_id,
    createdAt,
    expiresAt
  });
  return Object.freeze({ outcome: "prepared", challenge });
}

function parseDiscoveryRows(
  value: unknown,
  purpose: Every8dSettingsAuthPurpose
): Every8dSettingsChallengeDiscoveryRepositoryResult {
  if (!Array.isArray(value)) return contractViolation;
  if (value.length === 0) return Object.freeze({ outcome: "not_found" });
  if (value.length !== 1 || !isRecord(value[0]) || !hasExactKeys(value[0], [
    "challenge_id", "enrollment_grant_id", "normalized_email",
    "email_pseudonym", "otp_hmac_key_version"
  ])) return contractViolation;

  const row = value[0];
  const grantId = row.enrollment_grant_id;
  if (
    !isUuidV4(row.challenge_id) ||
    (purpose === "enrollment" ? !isUuidV4(grantId) : grantId !== null) ||
    !isCanonicalEmail(row.normalized_email) ||
    !isPseudonym(row.email_pseudonym) ||
    typeof row.otp_hmac_key_version !== "string" ||
    !isEvery8dSettingsAuthKeyVersion(row.otp_hmac_key_version)
  ) return contractViolation;

  return Object.freeze({
    outcome: "discovered",
    challenge: Object.freeze({
      challengeId: row.challenge_id,
      enrollmentGrantId: grantId as string | null,
      normalizedEmail: row.normalized_email,
      emailPseudonym: row.email_pseudonym,
      otpHmacKeyVersion: row.otp_hmac_key_version
    })
  });
}

function validRequestInput(input: {
  challengeId: string;
  normalizedEmail: string;
  emailPseudonym: string;
  emailPseudonymAliases: readonly string[];
  requestTokenHash: Buffer;
  otpHmac: Buffer;
  otpHmacKeyVersion: string;
}): boolean {
  return isUuidV4(input.challengeId) &&
    isCanonicalEmail(input.normalizedEmail) &&
    isPseudonym(input.emailPseudonym) &&
    isAliases(input.emailPseudonymAliases) &&
    input.emailPseudonymAliases.includes(input.emailPseudonym) &&
    isDigest(input.requestTokenHash) &&
    isDigest(input.otpHmac) &&
    isEvery8dSettingsAuthKeyVersion(input.otpHmacKeyVersion);
}

async function executeRpc(
  getClient: RpcClientGetter,
  name: string,
  input: Record<string, unknown>
): Promise<RpcResponse | Every8dSettingsAuthRepositoryFailure> {
  try {
    const response = await getClient().rpc(name, input);
    // Supabase may attach transport metadata (for example status/count). Only
    // the RPC payload itself is an exact closed contract.
    if (!isRecord(response) || !("data" in response) || !("error" in response)) {
      return contractViolation;
    }
    if (response.error !== null) return unavailable;
    return { data: response.data, error: null };
  } catch {
    return unavailable;
  }
}

function isFailure(
  value: RpcResponse | Every8dSettingsAuthRepositoryFailure
): value is Every8dSettingsAuthRepositoryFailure {
  return "outcome" in value;
}

export function createEvery8dSettingsAuthRepository(
  getClient: RpcClientGetter = getSupabase as unknown as RpcClientGetter
): Every8dSettingsAuthRepository {
  return Object.freeze({
    async requestEnrollmentChallenge(input) {
      if (!isDigest(input.enrollmentGrantTokenHash) || !validRequestInput(input)) {
        return contractViolation;
      }
      const response = await executeRpc(
        getClient,
        "runtime_request_every8d_settings_enrollment_challenge_v1",
        {
          input_enrollment_grant_token_hash: encodeBytea(input.enrollmentGrantTokenHash),
          input_challenge_id: input.challengeId,
          input_normalized_email: input.normalizedEmail,
          input_email_pseudonym: input.emailPseudonym,
          input_email_pseudonym_aliases: [...input.emailPseudonymAliases],
          input_request_token_hash: encodeBytea(input.requestTokenHash),
          input_otp_hmac: encodeBytea(input.otpHmac),
          input_otp_hmac_key_version: input.otpHmacKeyVersion
        }
      );
      return isFailure(response)
        ? response
        : parseCreationRows(response.data, input.challengeId);
    },

    async requestLoginChallenge(input) {
      if (!validRequestInput(input)) return contractViolation;
      const response = await executeRpc(
        getClient,
        "runtime_request_every8d_settings_login_challenge_v1",
        {
          input_challenge_id: input.challengeId,
          input_normalized_email: input.normalizedEmail,
          input_email_pseudonym: input.emailPseudonym,
          input_email_pseudonym_aliases: [...input.emailPseudonymAliases],
          input_request_token_hash: encodeBytea(input.requestTokenHash),
          input_otp_hmac: encodeBytea(input.otpHmac),
          input_otp_hmac_key_version: input.otpHmacKeyVersion
        }
      );
      return isFailure(response)
        ? response
        : parseCreationRows(response.data, input.challengeId);
    },

    async recordChallengeDelivery(input) {
      if (
        !isDigest(input.requestTokenHash) ||
        typeof input.succeeded !== "boolean" ||
        (input.succeeded && input.failureClass !== null) ||
        (!input.succeeded && !every8dSettingsEmailDeliveryFailureClasses.includes(
          input.failureClass as typeof every8dSettingsEmailDeliveryFailureClasses[number]
        ))
      ) return contractViolation;
      const response = await executeRpc(
        getClient,
        "runtime_record_every8d_settings_challenge_delivery_v1",
        {
          input_request_token_hash: encodeBytea(input.requestTokenHash),
          input_succeeded: input.succeeded,
          input_failure_class: input.failureClass
        }
      );
      if (isFailure(response)) return response;
      if (response.data === true) return Object.freeze({ outcome: "recorded" });
      if (response.data === false) return Object.freeze({ outcome: "not_recorded" });
      return contractViolation;
    },

    async discoverLiveChallenge(input) {
      if (!isDigest(input.requestTokenHash) || !isPurpose(input.purpose)) {
        return contractViolation;
      }
      const response = await executeRpc(
        getClient,
        "runtime_discover_every8d_settings_challenge_v1",
        {
          input_request_token_hash: encodeBytea(input.requestTokenHash),
          input_purpose: input.purpose
        }
      );
      return isFailure(response) ? response : parseDiscoveryRows(response.data, input.purpose);
    },

    async verifyChallenge(input) {
      if (
        !isDigest(input.requestTokenHash) || !isPurpose(input.purpose) ||
        !isAliases(input.emailPseudonymAliases) || !isDigest(input.candidateOtpHmac)
      ) return contractViolation;
      const response = await executeRpc(
        getClient,
        "runtime_verify_every8d_settings_challenge_v1",
        {
          input_request_token_hash: encodeBytea(input.requestTokenHash),
          input_purpose: input.purpose,
          input_email_pseudonym_aliases: [...input.emailPseudonymAliases],
          input_candidate_otp_hmac: encodeBytea(input.candidateOtpHmac)
        }
      );
      if (isFailure(response)) return response;
      if (response.data === true) return Object.freeze({ outcome: "verified" });
      if (response.data === false) return Object.freeze({ outcome: "rejected" });
      return contractViolation;
    }
  });
}
