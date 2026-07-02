import { env } from "../config/env";
import type { GhlInboundMessageInput, GhlInboundMessageResponse } from "../types/ghl";

async function ghlRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.GHL_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GHL_PRIVATE_INTEGRATION_TOKEN}`,
      Version: env.GHL_API_VERSION,
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

export async function sendInboundMessageToGhl(input: GhlInboundMessageInput): Promise<GhlInboundMessageResponse> {
  const payload = {
    locationId: env.GHL_LOCATION_ID,
    contactId: input.contactId,
    conversationId: input.conversationId,
    conversationProviderId: env.GHL_CUSTOM_PROVIDER_ID,
    providerId: env.GHL_CUSTOM_PROVIDER_ID,
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
