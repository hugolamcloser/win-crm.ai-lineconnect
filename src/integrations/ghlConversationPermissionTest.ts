import { env, requireEnvValue } from "../config/env";
import {
  getConfiguredGhlOAuthStatus,
  getConfiguredGhlOAuthTokenClaims,
  getGhlAuthContext
} from "../services/ghlOAuthService";
import {
  findLatestLineProfileWithGhlContact,
  findLatestLineProfileWithGhlContactForLocation
} from "../services/repository";
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
  expires_at?: string | null;
};

type InboundPayloadMatrixVariant = {
  name: string;
  type: "SMS" | "Custom" | "CUSTOM";
  sendConversationProviderId: boolean;
  message: string;
};

type InboundPayloadMatrixResult = {
  variant: string;
  endpoint: string;
  method: "POST";
  auth_mode: "oauth";
  authClass: string | null;
  request_body: unknown;
  statusCode?: number;
  canonicalCode?: string;
  responseBody?: unknown;
  ghl_message_id?: string;
  ghl_conversation_id?: string;
  ok: boolean;
  error?: string;
};

const requiredConversationScopes = [
  "conversations.readonly",
  "conversations.write",
  "conversations/message.readonly",
  "conversations/message.write"
];
const requiredContactScopes = ["contacts.readonly", "contacts.write"];

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

function extractGhlMessageIds(responseBody: unknown): { ghl_message_id?: string; ghl_conversation_id?: string } {
  return {
    ghl_message_id:
      getNestedString(responseBody, "id") ??
      getNestedString(responseBody, "_id") ??
      getNestedString(responseBody, "messageId") ??
      getNestedString(responseBody, "message", "id") ??
      getNestedString(responseBody, "message", "_id") ??
      getNestedString(responseBody, "data", "id") ??
      getNestedString(responseBody, "data", "messageId"),
    ghl_conversation_id:
      getNestedString(responseBody, "conversationId") ??
      getNestedString(responseBody, "conversation_id") ??
      getNestedString(responseBody, "conversation", "id") ??
      getNestedString(responseBody, "conversation", "_id") ??
      getNestedString(responseBody, "data", "conversationId") ??
      getNestedString(responseBody, "data", "conversation_id")
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

function isPayloadMatrixAuthClassError(result: InboundPayloadMatrixResult): boolean {
  const bodyText = JSON.stringify(result.responseBody ?? {}).toLowerCase();
  return result.statusCode === 401 && bodyText.includes("authclass");
}

function hasScopes(scopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.every((scope) => scopes.includes(scope));
}

function missingScopes(scopes: string[], requiredScopes: string[]): string[] {
  return requiredScopes.filter((scope) => !scopes.includes(scope));
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

async function getSafeOAuthDiagnostics(): Promise<{
  auth: Awaited<ReturnType<typeof getGhlAuthContext>>;
  token: TokenDiagnostics;
}> {
  const locationId = requireEnvValue("GHL_LOCATION_ID", env.GHL_LOCATION_ID);
  const auth = await getGhlAuthContext(locationId, { allowPrivateFallback: false });
  const claims = await getConfiguredGhlOAuthTokenClaims();

  return {
    auth,
    token: {
      auth_mode: "oauth",
      authClass: claims.authClass,
      authClassId: claims.authClassId,
      primaryAuthClassId: claims.primaryAuthClassId,
      source: claims.source,
      channel: claims.channel,
      location_id: claims.location_id,
      company_id: claims.company_id,
      scopes: claims.oauthMeta.scopes,
      expires_at: claims.expires_at
    }
  };
}

function buildMatrixConclusion(results: InboundPayloadMatrixResult[]) {
  const recommended = results.find((result) => result.ok);

  if (recommended) {
    const requestBody = getRecord(recommended.request_body);
    const type = getString(requestBody?.type) ?? "SMS";
    const sendConversationProviderId = Boolean(requestBody && "conversationProviderId" in requestBody);

    return {
      recommended_variant: recommended.variant,
      env_recommendation: {
        GHL_INBOUND_MESSAGE_TYPE: type,
        GHL_SEND_CONVERSATION_PROVIDER_ID: sendConversationProviderId ? "true" : "false"
      },
      conclusion: "At least one inbound payload variant was accepted. Use the recommended variant only after reviewing the debug message created in HighLevel."
    };
  }

  if (results.length > 0 && results.every(isPayloadMatrixAuthClassError)) {
    return {
      recommended_variant: null,
      conclusion:
        "Payload shape is probably not the blocker. The stored OAuth token authClass is not allowed by HighLevel to call /conversations/messages/inbound for this app/install.",
      recommended_next_action:
        "Compare the working Win-CRM app token claims/authClass/install type against this app, or recreate/install the marketplace app in the same way as the working app."
    };
  }

  return {
    recommended_variant: null,
    conclusion:
      "No inbound payload variant succeeded. Inspect each statusCode, canonicalCode, and responseBody to separate payload validation, provider access, and OAuth authClass failures.",
    recommended_next_action:
      "If responses differ across variants, use the closest validation response to guide the production payload. If they are all auth errors, compare token authClass/install type with the working app."
  };
}

async function postInboundPayloadMatrixVariant(input: {
  variant: InboundPayloadMatrixVariant;
  accessToken: string;
  token: TokenDiagnostics;
  locationId: string;
  contactId: string;
  lineUserId: string;
  conversationProviderId: string;
  timestamp: number;
}): Promise<InboundPayloadMatrixResult> {
  const endpoint = "/conversations/messages/inbound";
  const requestBody = {
    locationId: input.locationId,
    contactId: input.contactId,
    type: input.variant.type,
    message: input.variant.message,
    ...(input.variant.sendConversationProviderId ? { conversationProviderId: input.conversationProviderId } : {}),
    externalMessageId: `debug-inbound-payload-matrix:${input.variant.name}:${input.timestamp}`,
    externalConversationId: `line:${input.lineUserId}`
  };

  try {
    const response = await fetch(`${env.GHL_API_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Version: requireEnvValue("GHL_API_VERSION", env.GHL_API_VERSION),
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    const responseText = redactSensitiveText(await response.text());
    const responseBody = redactSecrets(parseResponseBody(responseText));
    const { canonicalCode } = getGhlErrorDetails(responseBody);
    const ids = extractGhlMessageIds(responseBody);

    return {
      variant: input.variant.name,
      endpoint,
      method: "POST",
      auth_mode: "oauth",
      authClass: input.token.authClass,
      request_body: redactRequestBody(requestBody),
      statusCode: response.status,
      canonicalCode,
      responseBody,
      ...ids,
      ok: response.ok
    };
  } catch (error) {
    return {
      variant: input.variant.name,
      endpoint,
      method: "POST",
      auth_mode: "oauth",
      authClass: input.token.authClass,
      request_body: redactRequestBody(requestBody),
      error: error instanceof Error ? error.message : String(error),
      ok: false
    };
  }
}

export async function testGhlInboundPayloadMatrix() {
  const locationId = requireEnvValue("GHL_LOCATION_ID", env.GHL_LOCATION_ID);
  const conversationProviderId = requireEnvValue("GHL_CUSTOM_PROVIDER_ID", env.GHL_CUSTOM_PROVIDER_ID);
  const profile = await findLatestLineProfileWithGhlContactForLocation(locationId);

  if (!profile?.line_user_id || !profile.ghl_contact_id) {
    return {
      ok: false,
      error: "no_existing_line_profile_contact_id",
      message:
        "No line_profiles row for the configured GHL_LOCATION_ID with line_user_id and ghl_contact_id was found. This diagnostic will not create or update contacts."
    };
  }

  const { auth, token } = await getSafeOAuthDiagnostics();
  const variants: InboundPayloadMatrixVariant[] = [
    {
      name: "A_sms_with_conversationProviderId",
      type: "SMS",
      sendConversationProviderId: true,
      message: "[debug] inbound payload matrix SMS with conversationProviderId"
    },
    {
      name: "B_Custom_with_conversationProviderId",
      type: "Custom",
      sendConversationProviderId: true,
      message: "[debug] inbound payload matrix Custom with conversationProviderId"
    },
    {
      name: "C_CUSTOM_with_conversationProviderId",
      type: "CUSTOM",
      sendConversationProviderId: true,
      message: "[debug] inbound payload matrix CUSTOM with conversationProviderId"
    },
    {
      name: "D_sms_without_conversationProviderId",
      type: "SMS",
      sendConversationProviderId: false,
      message: "[debug] inbound payload matrix SMS without conversationProviderId"
    }
  ];
  const timestamp = Date.now();
  const results: InboundPayloadMatrixResult[] = [];

  for (const variant of variants) {
    results.push(
      await postInboundPayloadMatrixVariant({
        variant,
        accessToken: auth.accessToken,
        token,
        locationId,
        contactId: profile.ghl_contact_id,
        lineUserId: profile.line_user_id,
        conversationProviderId,
        timestamp
      })
    );
  }

  return {
    ok: true,
    token_claims: {
      authClass: token.authClass,
      authClassId: token.authClassId,
      primaryAuthClassId: token.primaryAuthClassId,
      source: token.source,
      channel: token.channel,
      location_id: token.location_id,
      company_id: token.company_id,
      scopes: token.scopes,
      expires_at: token.expires_at
    },
    profile: {
      line_profile_id: profile.id,
      line_user_id: profile.line_user_id,
      ghl_contact_id: profile.ghl_contact_id
    },
    tests: results,
    ...buildMatrixConclusion(results)
  };
}

export async function getGhlTokenInstallSummary() {
  const status = await getConfiguredGhlOAuthStatus();
  const claims = await getConfiguredGhlOAuthTokenClaims();
  const scopes = claims.oauthMeta.scopes.length > 0 ? claims.oauthMeta.scopes : status.scopes;
  const requiredConversationScopesPresent = hasScopes(scopes, requiredConversationScopes);
  const requiredContactScopesPresent = hasScopes(scopes, requiredContactScopes);
  let conclusion = "Stored OAuth token is present. Review authClass and scopes against the inbound conversation provider API requirements.";

  if (!status.token_present) {
    conclusion = "No stored OAuth token exists for the configured GHL_LOCATION_ID.";
  } else if (claims.authClass === "Company") {
    conclusion =
      "Token is Company authClass. If HighLevel requires Location/Sub-Account authClass for inbound conversation provider API, this token will keep failing even with correct scopes.";
  } else if (!requiredConversationScopesPresent || !requiredContactScopesPresent) {
    conclusion = "Stored OAuth token is missing one or more required conversation/contact scopes.";
  }

  return {
    token_present: status.token_present,
    location_id: status.token_present ? status.location_id : null,
    company_id: status.token_present ? status.company_id : null,
    authClass: claims.authClass,
    authClassId: claims.authClassId,
    primaryAuthClassId: claims.primaryAuthClassId,
    source: claims.source,
    channel: claims.channel,
    scopes,
    expires_at: status.expires_at,
    required_conversation_scopes_present: requiredConversationScopesPresent,
    missing_conversation_scopes: missingScopes(scopes, requiredConversationScopes),
    required_contact_scopes_present: requiredContactScopesPresent,
    missing_contact_scopes: missingScopes(scopes, requiredContactScopes),
    conclusion
  };
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
