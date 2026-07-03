import { env, requireEnvValue } from "../config/env";
import { logger } from "../config/logger";
import { redactSecrets } from "../utils/redaction";
import {
  ensureDefaultTenant,
  getGhlOAuthToken,
  getGhlOAuthTokenStatus,
  upsertGhlOAuthToken,
  type GhlOAuthTokenRecord
} from "./repository";

const tokenRefreshSkewMs = 5 * 60 * 1000;

type GhlOAuthTokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  expires_at?: string;
  scope?: string;
  scopes?: string[] | string;
  token_type?: string;
  locationId?: string;
  location_id?: string;
  companyId?: string;
  company_id?: string;
  [key: string]: unknown;
};

export type GhlAuthContext = {
  mode: "oauth" | "private_integration";
  accessToken: string;
  locationId: string;
};

export class GhlOAuthError extends Error {
  public readonly statusCode?: number;
  public readonly responseBody?: string;
  public readonly requestPayload?: unknown;

  constructor(message: string, statusCode?: number, responseBody?: string, requestPayload?: unknown) {
    super(message);
    this.name = "GhlOAuthError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.requestPayload = requestPayload;
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function parseScopes(payload: GhlOAuthTokenPayload): string[] {
  if (Array.isArray(payload.scopes)) {
    return payload.scopes.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0);
  }

  const scopes = getString(payload.scopes) ?? getString(payload.scope);
  return scopes ? scopes.split(/\s+/).filter(Boolean) : [];
}

function getExpiresAt(payload: GhlOAuthTokenPayload): string {
  const explicitExpiresAt = getString(payload.expires_at);

  if (explicitExpiresAt) {
    return new Date(explicitExpiresAt).toISOString();
  }

  const expiresIn = getNumber(payload.expires_in) ?? 3600;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function isExpiredOrClose(token: GhlOAuthTokenRecord): boolean {
  return new Date(token.expires_at).getTime() <= Date.now() + tokenRefreshSkewMs;
}

function buildTokenRequestBody(entries: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(entries)) {
    if (value) {
      body.set(key, value);
    }
  }

  return body;
}

async function requestOAuthToken(entries: Record<string, string>): Promise<GhlOAuthTokenPayload> {
  const body = buildTokenRequestBody(entries);
  const requestPayload = Object.fromEntries(body.entries());

  logger.info(
    {
      tokenUrl: env.GHL_OAUTH_TOKEN_URL,
      grantType: entries.grant_type,
      payload: redactSecrets(requestPayload)
    },
    "Requesting HighLevel OAuth token"
  );

  const response = await fetch(env.GHL_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new GhlOAuthError(
      `HighLevel OAuth ${response.status} ${response.statusText}: ${responseBody}`,
      response.status,
      responseBody,
      requestPayload
    );
  }

  return responseBody ? (JSON.parse(responseBody) as GhlOAuthTokenPayload) : {};
}

async function saveTokenPayload(
  payload: GhlOAuthTokenPayload,
  fallbackLocationId: string,
  fallbackRefreshToken?: string
): Promise<GhlOAuthTokenRecord> {
  const accessToken = getString(payload.access_token);
  const refreshToken = getString(payload.refresh_token) ?? fallbackRefreshToken;
  const locationId = getString(payload.locationId) ?? getString(payload.location_id) ?? fallbackLocationId;

  if (!accessToken) {
    throw new GhlOAuthError("HighLevel OAuth response did not include access_token");
  }

  if (!refreshToken) {
    throw new GhlOAuthError("HighLevel OAuth response did not include refresh_token");
  }

  if (!locationId) {
    throw new GhlOAuthError("HighLevel OAuth response did not include locationId");
  }

  const tenantId = locationId === env.GHL_LOCATION_ID ? await ensureDefaultTenant() : undefined;

  return upsertGhlOAuthToken({
    tenantId,
    locationId,
    companyId: getString(payload.companyId) ?? getString(payload.company_id),
    accessToken,
    refreshToken,
    expiresAt: getExpiresAt(payload),
    scopes: parseScopes(payload),
    tokenType: getString(payload.token_type)
  });
}

export async function exchangeGhlAuthorizationCode(
  code: string
): Promise<Awaited<ReturnType<typeof getGhlOAuthTokenStatus>>> {
  const payload = await requestOAuthToken({
    grant_type: "authorization_code",
    code,
    client_id: requireEnvValue("GHL_OAUTH_CLIENT_ID", env.GHL_OAUTH_CLIENT_ID),
    client_secret: requireEnvValue("GHL_OAUTH_CLIENT_SECRET", env.GHL_OAUTH_CLIENT_SECRET),
    redirect_uri: requireEnvValue("GHL_OAUTH_REDIRECT_URI", env.GHL_OAUTH_REDIRECT_URI)
  });

  const token = await saveTokenPayload(payload, env.GHL_LOCATION_ID);
  return getGhlOAuthTokenStatus(token.location_id);
}

export async function refreshGhlOAuthToken(locationId = env.GHL_LOCATION_ID): Promise<GhlOAuthTokenRecord> {
  const token = await getGhlOAuthToken(locationId);

  if (!token) {
    throw new GhlOAuthError(`No HighLevel OAuth token is stored for location ${locationId}`);
  }

  const payload = await requestOAuthToken({
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
    client_id: requireEnvValue("GHL_OAUTH_CLIENT_ID", env.GHL_OAUTH_CLIENT_ID),
    client_secret: requireEnvValue("GHL_OAUTH_CLIENT_SECRET", env.GHL_OAUTH_CLIENT_SECRET)
  });

  return saveTokenPayload(payload, token.location_id, token.refresh_token);
}

export async function getGhlAuthContext(
  locationId = env.GHL_LOCATION_ID,
  options: { allowPrivateFallback?: boolean } = {}
): Promise<GhlAuthContext> {
  let token = await getGhlOAuthToken(locationId);

  if (token && isExpiredOrClose(token)) {
    token = await refreshGhlOAuthToken(locationId);
  }

  if (token) {
    return {
      mode: "oauth",
      accessToken: token.access_token,
      locationId: token.location_id
    };
  }

  if ((options.allowPrivateFallback ?? true) && env.GHL_ALLOW_PRIVATE_TOKEN_FALLBACK && env.GHL_PRIVATE_INTEGRATION_TOKEN) {
    logger.warn(
      { locationId },
      "Using optional GHL private integration token fallback because no OAuth token is stored"
    );
    return {
      mode: "private_integration",
      accessToken: env.GHL_PRIVATE_INTEGRATION_TOKEN,
      locationId
    };
  }

  throw new GhlOAuthError(
    `No HighLevel OAuth token is stored for location ${locationId}. Install the marketplace app and complete /oauth/callback first.`
  );
}

export async function forceRefreshGhlAuthContext(locationId = env.GHL_LOCATION_ID): Promise<GhlAuthContext> {
  const token = await refreshGhlOAuthToken(locationId);

  return {
    mode: "oauth",
    accessToken: token.access_token,
    locationId: token.location_id
  };
}

export async function getConfiguredGhlOAuthStatus() {
  return getGhlOAuthTokenStatus(requireEnvValue("GHL_LOCATION_ID", env.GHL_LOCATION_ID));
}
