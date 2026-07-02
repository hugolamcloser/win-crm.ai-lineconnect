import { env, requireEnvValue } from "../config/env";
import type {
  GhlContactResponse,
  GhlCreateContactInput,
  GhlInboundMessageInput,
  GhlInboundMessageResponse
} from "../types/ghl";

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

async function ghlRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.GHL_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireEnvValue(
        "GHL_PRIVATE_INTEGRATION_TOKEN",
        env.GHL_PRIVATE_INTEGRATION_TOKEN
      )}`,
      Version: requireEnvValue("GHL_API_VERSION", env.GHL_API_VERSION),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {})
    }
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`HighLevel API ${response.status} ${response.statusText}: ${responseText}`);
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
    source: "LINE Official Account"
  };

  const response = await ghlRequest<Record<string, unknown>>("/contacts/", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  return {
    id: extractContactId(response),
    raw: response
  };
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
  });
}
