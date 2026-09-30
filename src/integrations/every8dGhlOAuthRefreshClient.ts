import type { Every8dGhlOAuthConfig } from "../config/every8dGhlOAuth";
import type { Every8dGhlOAuthRefreshFailureClass } from "../services/every8dGhlOAuthRepository";

export const every8dGhlOAuthRefreshTimeoutMs = 15_000;
export const every8dGhlOAuthRefreshMaximumResponseBytes = 64 * 1024;
const maximumExpiresInSeconds = 31 * 24 * 60 * 60;
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

type RefreshClientFailureClass = Extract<
  Every8dGhlOAuthRefreshFailureClass,
  "invalid_grant" | "token_response_rejected" | "refresh_outcome_unknown"
>;

export class Every8dGhlOAuthRefreshClientError extends Error {
  readonly failureClass: RefreshClientFailureClass;

  constructor(failureClass: RefreshClientFailureClass) {
    super("HighLevel OAuth refresh failed");
    this.name = "Every8dGhlOAuthRefreshClientError";
    this.failureClass = failureClass;
  }
}

export type Every8dGhlOAuthRefreshResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
};

type TimeoutHandle = ReturnType<typeof setTimeout>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizedSet(values: string[]): string[] | null {
  if (values.some((value) => !value || value !== value.trim() || /\s/.test(value))) return null;
  const sorted = [...new Set(values)].sort();
  return sorted.length === values.length ? sorted : null;
}

function parseScope(value: unknown): string[] | null {
  if (typeof value !== "string" || !value || value !== value.trim()) return null;
  return normalizedSet(value.split(/\s+/));
}

function readAlias(
  record: Record<string, unknown>,
  snakeName: string,
  camelName: string
): { present: boolean; value: unknown; conflict: boolean } {
  const snakePresent = Object.prototype.hasOwnProperty.call(record, snakeName);
  const camelPresent = Object.prototype.hasOwnProperty.call(record, camelName);
  if (!snakePresent && !camelPresent) return { present: false, value: undefined, conflict: false };
  const snakeValue = record[snakeName];
  const camelValue = record[camelName];
  const valuesAgree = Object.is(snakeValue, camelValue)
    || (Array.isArray(snakeValue) && Array.isArray(camelValue)
      && snakeValue.length === camelValue.length
      && snakeValue.every((value, index) => value === camelValue[index]));
  return {
    present: true,
    value: snakePresent ? snakeValue : camelValue,
    conflict: snakePresent && camelPresent && !valuesAgree
  };
}

function validOpaqueToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function optionalExactIdentity(
  record: Record<string, unknown>,
  snakeName: string,
  camelName: string,
  expected: string
): boolean {
  const alias = readAlias(record, snakeName, camelName);
  return !alias.conflict && (!alias.present || (validOpaqueToken(alias.value) && alias.value === expected));
}

function optionalBooleanAliasIsSafe(
  record: Record<string, unknown>,
  snakeName: string,
  camelName: string
): boolean {
  const alias = readAlias(record, snakeName, camelName);
  return !alias.conflict && (!alias.present || alias.value === false);
}

function validateRefreshResponse(input: {
  parsed: unknown;
  config: Every8dGhlOAuthConfig;
  claimedScopes: string[];
  expectedLocationId: string;
  expectedCompanyId: string;
}): Every8dGhlOAuthRefreshResult {
  const record = asRecord(input.parsed);
  if (!record) throw new Every8dGhlOAuthRefreshClientError("refresh_outcome_unknown");

  const accessToken = readAlias(record, "access_token", "accessToken");
  const refreshToken = readAlias(record, "refresh_token", "refreshToken");
  const expiresIn = readAlias(record, "expires_in", "expiresIn");
  const tokenType = readAlias(record, "token_type", "tokenType");
  if (!accessToken.present || !refreshToken.present || !expiresIn.present
    || !Object.prototype.hasOwnProperty.call(record, "scope")) {
    throw new Every8dGhlOAuthRefreshClientError("refresh_outcome_unknown");
  }

  const scopes = parseScope(record.scope);
  if (accessToken.conflict || refreshToken.conflict || expiresIn.conflict || tokenType.conflict
    || !validOpaqueToken(accessToken.value) || !validOpaqueToken(refreshToken.value)
    || typeof expiresIn.value !== "number" || !Number.isSafeInteger(expiresIn.value)
    || expiresIn.value < 1 || expiresIn.value > maximumExpiresInSeconds
    || scopes === null) {
    throw new Every8dGhlOAuthRefreshClientError("token_response_rejected");
  }

  const claimedScopes = normalizedSet(input.claimedScopes);
  const configuredScopes = normalizedSet(input.config.requiredScopes);
  const approvedLocations = readAlias(record, "approved_locations", "approvedLocations");
  if (
    (tokenType.present && tokenType.value !== "Bearer")
    || !claimedScopes || !configuredScopes
    || !sameStrings(scopes, claimedScopes) || !sameStrings(scopes, configuredScopes)
    || !optionalExactIdentity(record, "user_type", "userType", "Location")
    || !optionalExactIdentity(record, "location_id", "locationId", input.expectedLocationId)
    || !optionalExactIdentity(record, "company_id", "companyId", input.expectedCompanyId)
    || !optionalExactIdentity(record, "app_id", "appId", input.config.marketplaceAppId)
    || approvedLocations.conflict
    || (approvedLocations.present && (
      !Array.isArray(approvedLocations.value)
      || approvedLocations.value.length !== 1
      || approvedLocations.value[0] !== input.expectedLocationId
    ))
    || !optionalBooleanAliasIsSafe(record, "is_bulk_installation", "isBulkInstallation")
    || !optionalBooleanAliasIsSafe(record, "install_to_future_locations", "installToFutureLocations")
    || !optionalBooleanAliasIsSafe(record, "approve_all_locations", "approveAllLocations")
  ) {
    throw new Every8dGhlOAuthRefreshClientError("token_response_rejected");
  }

  return {
    accessToken: accessToken.value,
    refreshToken: refreshToken.value,
    expiresIn: expiresIn.value,
    scopes
  };
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteCount += value.byteLength;
    if (byteCount > every8dGhlOAuthRefreshMaximumResponseBytes) {
      await reader.cancel();
      throw new Every8dGhlOAuthRefreshClientError("refresh_outcome_unknown");
    }
    chunks.push(value);
  }

  try {
    return fatalUtf8Decoder.decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  } catch {
    throw new Every8dGhlOAuthRefreshClientError("refresh_outcome_unknown");
  }
}

export async function refreshEvery8dGhlOAuthToken(input: {
  refreshToken: string;
  config: Every8dGhlOAuthConfig;
  claimedScopes: string[];
  expectedLocationId: string;
  expectedCompanyId: string;
  fetchImpl?: typeof fetch;
  setTimeoutImpl?: (callback: () => void, milliseconds: number) => TimeoutHandle;
  clearTimeoutImpl?: (handle: TimeoutHandle) => void;
}): Promise<Every8dGhlOAuthRefreshResult> {
  const controller = new AbortController();
  const setTimeoutImpl = input.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = input.clearTimeoutImpl ?? clearTimeout;
  const timeout = setTimeoutImpl(() => controller.abort(), every8dGhlOAuthRefreshTimeoutMs);

  try {
    const response = await (input.fetchImpl ?? fetch)(input.config.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: input.config.oauthClientId,
        client_secret: input.config.oauthClientSecret,
        grant_type: "refresh_token",
        refresh_token: input.refreshToken
      }),
      signal: controller.signal,
      redirect: "error"
    });
    const responseText = await readBoundedResponse(response);

    if (!response.ok) {
      if (response.status === 400) {
        try {
          const record = asRecord(JSON.parse(responseText) as unknown);
          if (record?.error === "invalid_grant") {
            throw new Every8dGhlOAuthRefreshClientError("invalid_grant");
          }
        } catch (error) {
          if (error instanceof Every8dGhlOAuthRefreshClientError) throw error;
        }
      }
      throw new Every8dGhlOAuthRefreshClientError("refresh_outcome_unknown");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText) as unknown;
    } catch {
      throw new Every8dGhlOAuthRefreshClientError("refresh_outcome_unknown");
    }
    return validateRefreshResponse({ ...input, parsed });
  } catch (error) {
    if (error instanceof Every8dGhlOAuthRefreshClientError) throw error;
    throw new Every8dGhlOAuthRefreshClientError("refresh_outcome_unknown");
  } finally {
    clearTimeoutImpl(timeout);
  }
}
