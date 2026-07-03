import { env, requireEnvValue } from "../config/env";
import { logger } from "../config/logger";
import type {
  GhlContactResponse,
  GhlCreateContactInput,
  GhlInboundMessageInput,
  GhlInboundMessageResponse
} from "../types/ghl";
import { redactSecrets } from "../utils/redaction";
import { forceRefreshGhlAuthContext, getGhlAuthContext, type GhlAuthContext } from "../services/ghlOAuthService";

export class GhlApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody: string;
  public readonly requestPayload?: unknown;
  public readonly path: string;
  public readonly method: string;
  public readonly authMode: string;

  constructor(input: {
    message: string;
    statusCode: number;
    responseBody: string;
    requestPayload?: unknown;
    path: string;
    method: string;
    authMode: string;
  }) {
    super(input.message);
    this.name = "GhlApiError";
    this.statusCode = input.statusCode;
    this.responseBody = input.responseBody;
    this.requestPayload = input.requestPayload;
    this.path = input.path;
    this.method = input.method;
    this.authMode = input.authMode;
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeDisplayName(input: GhlCreateContactInput): string {
  const displayName = input.displayName?.trim();

  if (displayName) {
    return displayName;
  }

  return `LINE User ${input.lineUserId.slice(-8)}`;
}

function splitDisplayName(displayName: string): { firstName: string; lastName?: string } {
  const parts = displayName.split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] ?? displayName,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined
  };
}

function extractContactId(payload: Record<string, unknown>): string {
  const contact = getRecord(payload.contact);
  const contactId =
    getString(payload.id) ??
    getString(payload.contactId) ??
    getString(payload.contact_id) ??
    getString(contact?.id) ??
    getString(contact?.contactId);

  if (!contactId) {
    throw new Error("HighLevel create contact response did not include a contact id");
  }

  return contactId;
}

function buildLineCustomFields(input: GhlCreateContactInput): Array<{ id: string; value: string }> {
  const customFields: Array<{ id: string; value: string }> = [];

  if (env.GHL_LINE_USER_ID_FIELD_ID) {
    customFields.push({
      id: env.GHL_LINE_USER_ID_FIELD_ID,
      value: input.lineUserId
    });
  }

  if (env.GHL_LINE_DISPLAY_NAME_FIELD_ID && input.displayName?.trim()) {
    customFields.push({
      id: env.GHL_LINE_DISPLAY_NAME_FIELD_ID,
      value: input.displayName.trim()
    });
  }

  return customFields;
}

function buildLineTags(lineUserId: string): string[] {
  return ["line", `line:${lineUserId}`];
}

function getTagsFromContactPayload(payload: Record<string, unknown>): string[] {
  const contact = getRecord(payload.contact);
  const tags = Array.isArray(payload.tags) ? payload.tags : Array.isArray(contact?.tags) ? contact.tags : [];

  return tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
}

function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}

function buildLineContactMetadataPayload(input: GhlCreateContactInput, existingTags: string[] = []) {
  const customFields = buildLineCustomFields(input);
  return {
    source: "LINE Official Account",
    tags: uniqueTags([...existingTags, ...buildLineTags(input.lineUserId)]),
    customFields: customFields.length > 0 ? customFields : undefined
  };
}

async function performGhlRequest(
  path: string,
  init: RequestInit | undefined,
  auth: GhlAuthContext
): Promise<Response> {
  return fetch(`${env.GHL_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Version: requireEnvValue("GHL_API_VERSION", env.GHL_API_VERSION),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {})
    }
  });
}

async function ghlRequest<T>(path: string, init?: RequestInit, requestPayload?: unknown): Promise<T> {
  const method = init?.method ?? "GET";
  const locationId = requireEnvValue("GHL_LOCATION_ID", env.GHL_LOCATION_ID);
  let auth = await getGhlAuthContext(locationId);

  logger.debug(
    {
      path,
      method,
      authMode: auth.mode,
      payload: requestPayload ? redactSecrets(requestPayload) : undefined
    },
    "Sending HighLevel API request"
  );

  let response = await performGhlRequest(path, init, auth);

  if (response.status === 401 && auth.mode === "oauth") {
    logger.warn({ path, method }, "HighLevel OAuth request returned 401; refreshing token and retrying once");
    auth = await forceRefreshGhlAuthContext(locationId);
    response = await performGhlRequest(path, init, auth);
  }

  const responseText = await response.text();

  if (!response.ok) {
    throw new GhlApiError({
      message: `HighLevel API ${response.status} ${response.statusText}: ${responseText}`,
      statusCode: response.status,
      responseBody: responseText,
      requestPayload,
      path,
      method,
      authMode: auth.mode
    });
  }

  if (!responseText) {
    return undefined as T;
  }

  return JSON.parse(responseText) as T;
}

export async function createGhlContact(input: GhlCreateContactInput): Promise<GhlContactResponse> {
  const displayName = normalizeDisplayName(input);
  const nameParts = splitDisplayName(displayName);
  const payload = {
    locationId: requireEnvValue("GHL_LOCATION_ID", env.GHL_LOCATION_ID),
    name: displayName,
    firstName: nameParts.firstName,
    lastName: nameParts.lastName,
    ...buildLineContactMetadataPayload(input)
  };

  const response = await ghlRequest<Record<string, unknown>>("/contacts/", {
    method: "POST",
    body: JSON.stringify(payload)
  }, payload);

  return {
    id: extractContactId(response),
    raw: response
  };
}

export async function getGhlContact(contactId: string): Promise<Record<string, unknown>> {
  return ghlRequest<Record<string, unknown>>(`/contacts/${encodeURIComponent(contactId)}`);
}

export async function ensureGhlContactLineMetadata(contactId: string, input: GhlCreateContactInput): Promise<void> {
  let existingTags: string[] = [];

  try {
    existingTags = getTagsFromContactPayload(await getGhlContact(contactId));
  } catch (error) {
    logger.warn(
      {
        contactId,
        lineUserId: input.lineUserId,
        error: error instanceof Error ? error.message : String(error)
      },
      "Could not fetch GHL contact before ensuring LINE tags; sending required LINE tags only"
    );
  }

  const payload = buildLineContactMetadataPayload(input, existingTags);

  await ghlRequest<Record<string, unknown>>(`/contacts/${encodeURIComponent(contactId)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  }, payload);
}

export async function updateGhlContactLineFields(contactId: string, input: GhlCreateContactInput): Promise<void> {
  await ensureGhlContactLineMetadata(contactId, input);
}

export async function sendInboundMessageToGhl(input: GhlInboundMessageInput): Promise<GhlInboundMessageResponse> {
  const payload = {
    locationId: requireEnvValue("GHL_LOCATION_ID", env.GHL_LOCATION_ID),
    contactId: input.contactId,
    conversationId: input.conversationId,
    conversationProviderId: requireEnvValue("GHL_CUSTOM_PROVIDER_ID", env.GHL_CUSTOM_PROVIDER_ID),
    providerId: requireEnvValue("GHL_CUSTOM_PROVIDER_ID", env.GHL_CUSTOM_PROVIDER_ID),
    externalConversationId: input.externalConversationId,
    externalMessageId: input.externalMessageId,
    direction: "inbound",
    type: "CUSTOM",
    message: input.message,
    attachments: input.attachments ?? []
  };

  return ghlRequest<GhlInboundMessageResponse>("/conversations/messages/inbound", {
    method: "POST",
    body: JSON.stringify(payload)
  }, payload);
}

export async function testGhlOAuthToken(): Promise<{
  ok: boolean;
  endpoint: string;
  authMode: string;
  statusCode?: number;
  responseBody?: unknown;
  error?: string;
}> {
  const locationId = requireEnvValue("GHL_LOCATION_ID", env.GHL_LOCATION_ID);
  const endpoint = `/locations/${encodeURIComponent(locationId)}`;

  try {
    let auth = await getGhlAuthContext(locationId, { allowPrivateFallback: false });
    let response = await performGhlRequest(endpoint, { method: "GET" }, auth);

    if (response.status === 401 && auth.mode === "oauth") {
      auth = await forceRefreshGhlAuthContext(locationId);
      response = await performGhlRequest(endpoint, { method: "GET" }, auth);
    }

    const responseText = await response.text();
    let responseBody: unknown = responseText;

    try {
      responseBody = responseText ? JSON.parse(responseText) : undefined;
    } catch {
      responseBody = responseText;
    }

    return {
      ok: response.ok,
      endpoint,
      authMode: auth.mode,
      statusCode: response.status,
      responseBody: redactSecrets(responseBody)
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      authMode: "oauth",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
