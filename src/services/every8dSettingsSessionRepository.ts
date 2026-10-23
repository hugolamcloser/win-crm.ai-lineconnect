import { getSupabase } from "../config/supabase";
import { normalizeEvery8dSettingsEmail } from "./every8dSettingsAuthPrimitives";
import type { Every8dSettingsAuthPurpose } from "./every8dSettingsAuthPrimitives";
import type { Every8dSettingsAuthRepositoryFailure } from "../types/every8dSettingsAuthOrchestration";
import type {
  Every8dSettingsSessionRepository,
  Every8dSettingsSessionConsumeInput,
  Every8dSettingsSessionConsumptionResult,
  Every8dSettingsSessionAuthenticationResult,
  Every8dSettingsVerifiedSessionDiscoveryResult
} from "../types/every8dSettingsSession";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pseudonymPattern = /^[A-Za-z0-9_.-]{1,63}:[0-9a-f]{64}$/;
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/;

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  rpc(name: string, input: Record<string, unknown>): PromiseLike<RpcResponse>;
}>;
type RpcClientGetter = () => RpcClient;

const unavailable = Object.freeze({
  outcome: "failure", category: "repository_unavailable"
} as const satisfies Every8dSettingsAuthRepositoryFailure);
const contractViolation = Object.freeze({
  outcome: "failure", category: "repository_contract_violation"
} as const satisfies Every8dSettingsAuthRepositoryFailure);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(row: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(row);
  return actual.length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(row, key)
  );
}

function isDigest(value: unknown): value is Buffer {
  return Buffer.isBuffer(value) && value.length === 32;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && uuidPattern.test(value);
}

function isPurpose(value: unknown): value is Every8dSettingsAuthPurpose {
  return value === "enrollment" || value === "login";
}

function isPseudonym(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && pseudonymPattern.test(value);
}

function isAliases(value: unknown): value is readonly string[] {
  // Array.from makes sparse holes explicit, so they cannot bypass validation.
  return Array.isArray(value) && value.length >= 1 && value.length <= 64 &&
    Array.from(value).every(isPseudonym);
}

function isCanonicalEmail(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value) return false;
  try { return normalizeEvery8dSettingsEmail(value) === value; }
  catch { return false; }
}

function encodeBytea(value: Buffer): string {
  return `\\x${value.toString("hex")}`;
}

function parseTimestamp(value: unknown): {
  date: Date; wholeMilliseconds: number; fraction: string;
} | null {
  if (typeof value !== "string") return null;
  const match = timestampPattern.exec(value);
  if (!match || match[0] !== value) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
    Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 ||
    Number(match[9] ?? 0) > 15 || Number(match[10] ?? 0) > 59
  ) return null;
  const wholeMilliseconds = Date.parse(value.replace(/\.\d+/, ""));
  const date = new Date(value);
  if (!Number.isFinite(wholeMilliseconds) || !Number.isFinite(date.getTime())) return null;
  return { date, wholeMilliseconds, fraction: (match[7] ?? "").replace(/0+$/, "") };
}

function parseDiscovery(
  data: unknown, purpose: Every8dSettingsAuthPurpose
): Every8dSettingsVerifiedSessionDiscoveryResult {
  if (!Array.isArray(data)) return contractViolation;
  if (data.length === 0) return Object.freeze({ outcome: "not_found" });
  if (data.length !== 1 || !isRecord(data[0]) || !hasExactKeys(data[0], [
    "challenge_id", "purpose", "enrollment_grant_id", "normalized_email", "email_pseudonym"
  ])) return contractViolation;
  const row = data[0];
  if (
    !isUuid(row.challenge_id) || !isPurpose(row.purpose) || row.purpose !== purpose ||
    !isCanonicalEmail(row.normalized_email) || !isPseudonym(row.email_pseudonym)
  ) return contractViolation;
  const common = {
    challengeId: row.challenge_id,
    normalizedEmail: row.normalized_email,
    emailPseudonym: row.email_pseudonym
  };
  if (row.purpose === "enrollment" && isUuid(row.enrollment_grant_id)) {
    return Object.freeze({ outcome: "discovered", challenge: Object.freeze({
      ...common, purpose: "enrollment", enrollmentGrantId: row.enrollment_grant_id
    }) });
  }
  if (row.purpose === "login" && row.enrollment_grant_id === null) {
    return Object.freeze({ outcome: "discovered", challenge: Object.freeze({
      ...common, purpose: "login", enrollmentGrantId: null
    }) });
  }
  return contractViolation;
}

function parsePrincipal(row: Record<string, unknown>) {
  const expiresAt = parseTimestamp(row.expires_at);
  if (
    !isUuid(row.administrator_id) || !isUuid(row.installation_id) ||
    typeof row.installation_generation !== "number" ||
    !Number.isInteger(row.installation_generation) || row.installation_generation < 1 ||
    row.installation_generation > 2147483647 || !expiresAt
  ) return null;
  return Object.freeze({
    administratorId: row.administrator_id,
    installationId: row.installation_id,
    installationGeneration: row.installation_generation,
    expiresAt: expiresAt.date
  });
}

function parseConsumption(data: unknown): Every8dSettingsSessionConsumptionResult {
  if (!Array.isArray(data)) return contractViolation;
  if (data.length === 0) return Object.freeze({ outcome: "not_consumed" });
  if (data.length !== 1 || !isRecord(data[0]) || !hasExactKeys(data[0], [
    "administrator_id", "installation_id", "installation_generation", "created_at", "expires_at"
  ])) return contractViolation;
  const row = data[0];
  const principal = parsePrincipal(row);
  const createdAt = parseTimestamp(row.created_at);
  const expiresAt = parseTimestamp(row.expires_at);
  // Preserve sub-millisecond precision for the exact lifetime check, before
  // returning Dates in the same metadata convention as C3b.
  if (!principal || !createdAt || !expiresAt ||
    expiresAt.wholeMilliseconds - createdAt.wholeMilliseconds !== 3600000 ||
    expiresAt.fraction !== createdAt.fraction
  ) return contractViolation;
  return Object.freeze({ outcome: "consumed", session: Object.freeze({
    ...principal, createdAt: createdAt.date
  }) });
}

function parseAuthentication(data: unknown): Every8dSettingsSessionAuthenticationResult {
  if (!Array.isArray(data)) return contractViolation;
  if (data.length === 0) return Object.freeze({ outcome: "unauthorized" });
  if (data.length !== 1 || !isRecord(data[0]) || !hasExactKeys(data[0], [
    "administrator_id", "installation_id", "installation_generation", "expires_at"
  ])) return contractViolation;
  const principal = parsePrincipal(data[0]);
  // Database authentication is authoritative; do not consult a local clock.
  return principal ? Object.freeze({ outcome: "authenticated", principal }) : contractViolation;
}

async function executeRpc(
  getClient: RpcClientGetter, name: string, input: Record<string, unknown>
): Promise<RpcResponse | Every8dSettingsAuthRepositoryFailure> {
  try {
    const response = await getClient().rpc(name, input);
    if (!isRecord(response) || !("data" in response) || !("error" in response)) {
      return contractViolation;
    }
    if (response.error !== null) return unavailable;
    return { data: response.data, error: null };
  } catch { return unavailable; }
}

function isFailure(
  value: RpcResponse | Every8dSettingsAuthRepositoryFailure
): value is Every8dSettingsAuthRepositoryFailure {
  return "outcome" in value;
}

function validConsumeInput(input: Every8dSettingsSessionConsumeInput): boolean {
  return isDigest(input.requestTokenHash) && isDigest(input.sessionTokenHash) &&
    isAliases(input.emailPseudonymAliases);
}

function consumeArguments(input: Every8dSettingsSessionConsumeInput): Record<string, unknown> {
  return {
    input_request_token_hash: encodeBytea(input.requestTokenHash),
    input_email_pseudonym_aliases: [...input.emailPseudonymAliases],
    input_session_token_hash: encodeBytea(input.sessionTokenHash)
  };
}

export function createEvery8dSettingsSessionRepository(
  getClient: RpcClientGetter = getSupabase as unknown as RpcClientGetter
): Every8dSettingsSessionRepository {
  return Object.freeze({
    async discoverVerifiedChallenge(input) {
      if (!isDigest(input.requestTokenHash) || !isPurpose(input.purpose)) return contractViolation;
      const response = await executeRpc(getClient,
        "runtime_discover_every8d_settings_verified_challenge_v1", {
          input_request_token_hash: encodeBytea(input.requestTokenHash), input_purpose: input.purpose
        });
      return isFailure(response) ? response : parseDiscovery(response.data, input.purpose);
    },
    async consumeEnrollmentChallenge(input) {
      if (!validConsumeInput(input)) return contractViolation;
      const response = await executeRpc(getClient,
        "runtime_consume_every8d_settings_enrollment_challenge_v1", consumeArguments(input));
      return isFailure(response) ? response : parseConsumption(response.data);
    },
    async consumeLoginChallenge(input) {
      if (!validConsumeInput(input)) return contractViolation;
      const response = await executeRpc(getClient,
        "runtime_consume_every8d_settings_login_challenge_v1", consumeArguments(input));
      return isFailure(response) ? response : parseConsumption(response.data);
    },
    async authenticateSession(input) {
      if (!isDigest(input.sessionTokenHash)) return contractViolation;
      const response = await executeRpc(getClient,
        "runtime_authenticate_every8d_settings_session_v1", {
          input_session_token_hash: encodeBytea(input.sessionTokenHash)
        });
      return isFailure(response) ? response : parseAuthentication(response.data);
    },
    async revokeSession(input) {
      if (!isDigest(input.sessionTokenHash)) return contractViolation;
      const response = await executeRpc(getClient,
        "runtime_revoke_every8d_settings_session_v1", {
          input_session_token_hash: encodeBytea(input.sessionTokenHash)
        });
      if (isFailure(response)) return response;
      return response.data === true ? Object.freeze({ outcome: "revoked" }) : contractViolation;
    }
  });
}
