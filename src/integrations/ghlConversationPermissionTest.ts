import { env, requireEnvValue } from "../config/env";
import { getConfiguredGhlOAuthTokenClaims, getGhlAuthContext } from "../services/ghlOAuthService";
import { findLatestLineProfileWithGhlContact } from "../services/repository";
import { redactSecrets, redactSensitiveText } from "../utils/redaction";

type PermissionTestResult = {
  name: string;
  endpoint: string;
  method: "GET" | "POST";
  auth_mode: "oauth";
  token_authClass: string | null;
  authClassId: string | null;
  primaryAuthClassId: string | null;
  source: string | null;
  channel: string | null;
  location_id: string | null;
  company_id: string | null;
  scopes: string[];
  request_body?: unknown;
  statusCode?: number;
  canonicalCode?: string;
  message?: string;
  response_body?: unknown;
  error?: string;
  ok: boolean;
};

type TokenDiagnostics = {
  auth_mode: "oauth";
  authClass: string | null;
  authClassId: string | null;
  primaryAuthClassId: string | null;
  source: string | null;
  channel: string | null;
  location_id: string | null;
  company_id: string | null;
  scopes: string[];
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getNestedString(payload: unknown, ...path: string[]): string | undefined {
  let current = payload;

  for (const key of path) {
    const record = getRecord(current);

    if (!record || !(key in record)) {
      return undefined;
    }

    current = record[key];
  }

  return getString(current);
}

function parseResponseBody(responseText: string): unknown {
  if (!responseText) {
    return undefined;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

function getGhlErrorDetails(responseBody: unknown): { canonicalCode?: string; message?: string } {
  return {
    canonicalCode:
      getNestedString(responseBody, "canonicalCode") ??
      getNestedString(responseBody, "error", "canonicalCode") ??
      getNestedString(responseBody, "meta", "canonicalCode"),
    message:
      getNestedString(responseBody, "message") ??
      getNestedString(responseBody, "error", "message") ??
      getNestedString(responseBody, "msg")
  };
}

function redactRequestBody(payload: Record<string, unknown> | undefined): unknown {
  if (!payload) {
    return undefined;
  }

  return redactSecrets({
    ...payload,
    ...(typeof payload.message === "string" ? { message: "[redacted]" } : {})
  });
}

function isAuthClassError(result: PermissionTestResult): boolean {
  const message = `${result.message ?? ""} ${JSON.stringify(result.response_body ?? {})}`.toLowerCase();
  return result.statusCode === 401 && message.includes("authclass");
}

function buildConclusion(results: PermissionTestResult[]) {
  const searchResult = results.find((result) => result.name === "conversation_search");
  const postResults = results.filter((result) => result.method === "POST");
  const acceptedPost = postResults.find((result) => result.ok);

  if (acceptedPost) {
    return {
      summary: "One inbound message payload variant was accepted by HighLevel.",
      production_payload_variant: acceptedPost.name,
      recommended_action: `Use the ${acceptedPost.name} payload variant in production.`
    };
  }

  if (searchResult?.ok && postResults.length > 0 && postResults.every(isAuthClassError)) {
    return {
      summary:
        "OAuth can read conversations, but this OAuth authClass cannot call the inbound message API.",
      production_payload_variant: null,
      recommended_action:
        "Escalate to HighLevel support or app configuration: the stored OAuth token has conversation read access but is blocked from POST /conversations/messages/inbound."
    };
  }

  if (results.length > 0 && results.every((result) => !result.ok)) {
    return {
      summary: "OAuth token cannot access conversation APIs with the tested requests.",
      production_payload_variant: null,
      recommended_action:
        "Verify the Marketplace app install, location binding, OAuth authClass, and conversation scopes."
    };
  }

  return {
    summary:
      "No inbound payload variant was accepted. Inspect the per-request status codes and response bodies for whether HighLevel reached payload validation or rejected auth/provider access.",
    production_payload_variant: null,
    recommended_action:
      "Use the statusCode, canonicalCode, and response_body fields to distinguish payload validation from authClass/provider access failures."
  };
}

async function performDiagnosticRequest(input: {
  name: string;
  endpoint: string;
  method: "GET" | "POST";
  accessToken: string;
  token: TokenDiagnostics;
  requestBody?: Record<string, unknown>;
}): Promise<PermissionTestResult> {
  try {
    const response = await fetch(`${env.GHL_API_BASE_URL}${input.endpoint}`, {
      method: input.method,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Version: requireEnvValue("GHL_API_VERSION", env.GHL_API_VERSION),
        Accept: "application/json",
        ...(input.requestBody ? { "Content-Type": "application/json" } : {})
      },
      body: input.requestBody ? JSON.stringify(input.requestBody) : undefined
    });
    const responseText = redactSensitiveText(await response.text());
    const responseBody = redactSecrets(parseResponseBody(responseText));
    const { canonicalCode, message } = getGhlErrorDetails(responseBody);

    return {
      name: input.name,
      endpoint: input.endpoint,
      method: input.method,
      auth_mode: input.token.auth_mode,
      token_authClass: input.token.authClass,
      authClassId: input.token.authClassId,
      primaryAuthClassId: input.token.primaryAuthClassId,
      source: input.token.source,
      channel: input.token.channel,
      location_id: input.token.location_id,
      company_id: input.token.company_id,
      scopes: input.token.scopes,
      request_body: redactRequestBody(input.requestBody),
      statusCode: response.status,
      canonicalCode,
      message,
      response_body: responseBody,
      ok: response.ok
    };
  } catch (error) {
    return {
      name: input.name,
      endpoint: input.endpoint,
      method: input.method,
      auth_mode: input.token.auth_mode,
      token_authClass: input.token.authClass,
      authClassId: input.token.authClassId,
      primaryAuthClassId: input.token.primaryAuthClassId,
      source: input.token.source,
      channel: input.token.channel,
      location_id: input.token.location_id,
      company_id: input.token.company_id,
      scopes: input.token.scopes,
      request_body: redactRequestBody(input.requestBody),
      error: error instanceof Error ? error.message : String(error),
      ok: false
    };
  }
}

export async function testGhlConversationPermissions() {
  const locationId = requireEnvValue("GHL_LOCATION_ID", env.GHL_LOCATION_ID);
  const conversationProviderId = requireEnvValue("GHL_CUSTOM_PROVIDER_ID", env.GHL_CUSTOM_PROVIDER_ID);
  const profile = await findLatestLineProfileWithGhlContact();

  if (!profile?.ghl_contact_id) {
    return {
      ok: false,
      error: "no_existing_line_profile_contact_id",
      message:
        "No line_profiles row with an existing ghl_contact_id was found. This diagnostic will not create a debug contact."
    };
  }

  const auth = await getGhlAuthContext(locationId, { allowPrivateFallback: false });
  const claims = await getConfiguredGhlOAuthTokenClaims();
  const token: TokenDiagnostics = {
    auth_mode: "oauth",
    authClass: claims.authClass,
    authClassId: claims.authClassId,
    primaryAuthClassId: claims.primaryAuthClassId,
    source: claims.source,
    channel: claims.channel,
    location_id: claims.location_id,
    company_id: claims.company_id,
    scopes: claims.oauthMeta.scopes
  };
  const contactId = profile.ghl_contact_id;
  const timestamp = Date.now();
  const baseMessagePayload = {
    contactId,
    locationId,
    externalConversationId: `debug-conversation-permission:${locationId}:${contactId}`,
    message: "HighLevel conversation permission diagnostic. Ignore.",
    attachments: []
  };
  const searchParams = new URLSearchParams({ locationId });

  const tests = await Promise.all([
    performDiagnosticRequest({
      name: "conversation_search",
      endpoint: `/conversations/search?${searchParams.toString()}`,
      method: "GET",
      accessToken: auth.accessToken,
      token
    }),
    performDiagnosticRequest({
      name: "inbound_sms_with_conversation_provider_id",
      endpoint: "/conversations/messages/inbound",
      method: "POST",
      accessToken: auth.accessToken,
      token,
      requestBody: {
        ...baseMessagePayload,
        conversationProviderId,
        externalMessageId: `debug-conversation-permission:sms-provider:${timestamp}`,
        type: "SMS"
      }
    }),
    performDiagnosticRequest({
      name: "inbound_sms_without_conversation_provider_id",
      endpoint: "/conversations/messages/inbound",
      method: "POST",
      accessToken: auth.accessToken,
      token,
      requestBody: {
        ...baseMessagePayload,
        externalMessageId: `debug-conversation-permission:sms-no-provider:${timestamp}`,
        type: "SMS"
      }
    }),
    performDiagnosticRequest({
      name: "inbound_custom_with_conversation_provider_id",
      endpoint: "/conversations/messages/inbound",
      method: "POST",
      accessToken: auth.accessToken,
      token,
      requestBody: {
        ...baseMessagePayload,
        conversationProviderId,
        externalMessageId: `debug-conversation-permission:custom-provider:${timestamp}`,
        type: "CUSTOM"
      }
    })
  ]);

  return {
    ok: true,
    contact_source: {
      line_profile_id: profile.id,
      line_user_id: profile.line_user_id,
      contactId
    },
    token,
    tests,
    conclusion: buildConclusion(tests)
  };
}
