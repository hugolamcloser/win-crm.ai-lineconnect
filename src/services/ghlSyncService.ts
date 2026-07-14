import { logger } from "../config/logger";
import { pushLineTextMessage } from "../integrations/lineClient";
import { HttpError } from "../middleware/errors";
import type { NormalizedGhlOutboundMessage } from "../types/ghl";
import {
  isLineChannelNotConnectedError,
  resolveLineChannelForOutbound
} from "./lineOutboundChannelService";
import {
  claimGhlOutboundProviderDelivery,
  finalizeGhlOutboundProviderDelivery,
  findLineProfileByGhlIdsForTenantIds,
  findWorkflowOutboundMirrorMessageEventForTenantIds,
  getTenantIdsByLocationId,
  saveMessageEvent,
  type GhlOutboundProviderDeliveryClaimResult
} from "./repository";

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getNestedString(payload: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = payload;

  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return getString(current);
}

function getAttachments(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function normalizeGhlOutboundMessage(payload: Record<string, unknown>): NormalizedGhlOutboundMessage {
  const message =
    getString(payload.message) ??
    getString(payload.body) ??
    getString(payload.text) ??
    getNestedString(payload, ["message", "body"]) ??
    getNestedString(payload, ["message", "text"]);

  if (!message) {
    throw new Error("Outbound GHL webhook did not include a text message");
  }

  return {
    contactId: getString(payload.contactId) ?? getNestedString(payload, ["contact", "id"]),
    locationId:
      getString(payload.locationId) ??
      getString(payload.location_id) ??
      getNestedString(payload, ["location", "id"]) ??
      getNestedString(payload, ["location", "locationId"]),
    conversationId: getString(payload.conversationId) ?? getNestedString(payload, ["conversation", "id"]),
    messageId: getString(payload.messageId) ?? getString(payload.id) ?? getNestedString(payload, ["message", "id"]),
    message,
    attachments: getAttachments(payload.attachments),
    raw: payload
  };
}

async function resolveTenantIdsForGhlOutboundWebhook(message: NormalizedGhlOutboundMessage): Promise<string[]> {
  if (message.locationId) {
    const tenantIds = await getTenantIdsByLocationId(message.locationId);

    if (tenantIds.length > 0) {
      return tenantIds;
    }

    logger.warn(
      {
        locationId: message.locationId,
        contactId: message.contactId,
        conversationId: message.conversationId,
        ghlMessageId: message.messageId
      },
      "Skipped HighLevel outbound provider webhook because no tenant exists for payload locationId"
    );

    return [];
  }

  logger.warn(
    {
      contactId: message.contactId,
      conversationId: message.conversationId,
      ghlMessageId: message.messageId
    },
    "Skipped HighLevel outbound provider webhook because payload locationId is missing"
  );

  return [];
}

async function resolveLineProfileForGhlOutbound(
  tenantIds: string[],
  message: NormalizedGhlOutboundMessage
) {
  const exactMapping = await findLineProfileByGhlIdsForTenantIds(tenantIds, {
    contactId: message.contactId,
    conversationId: message.conversationId
  });

  if (exactMapping || !message.contactId || !message.conversationId) {
    return exactMapping;
  }

  const contactFallback = await findLineProfileByGhlIdsForTenantIds(tenantIds, {
    contactId: message.contactId
  });

  if (contactFallback) {
    logger.info(
      {
        tenantIds,
        tenantId: contactFallback.tenant_id,
        contactId: message.contactId,
        callbackConversationId: message.conversationId,
        storedConversationId: contactFallback.ghl_conversation_id
      },
      "Resolved HighLevel outbound provider callback by unique exact-location contact fallback"
    );
  }

  return contactFallback;
}

export async function processGhlOutboundWebhook(payload: Record<string, unknown>): Promise<{
  status: "processed" | "skipped";
  reason?: string;
}> {
  const message = normalizeGhlOutboundMessage(payload);
  const tenantIds = await resolveTenantIdsForGhlOutboundWebhook(message);

  if (tenantIds.length === 0) {
    return {
      status: "skipped",
      reason: message.locationId ? "No tenant found for locationId" : "Missing locationId"
    };
  }

  logger.info(
    {
      tenantIds,
      tenantCount: tenantIds.length,
      locationId: message.locationId,
      contactId: message.contactId,
      conversationId: message.conversationId,
      ghlMessageId: message.messageId
    },
    "HighLevel outbound provider webhook accepted"
  );

  if (!message.messageId) {
    logger.warn(
      {
        tenantIds,
        locationId: message.locationId,
        contactId: message.contactId,
        conversationId: message.conversationId
      },
      "Skipped HighLevel outbound provider webhook because payload messageId is missing"
    );

    return { status: "skipped", reason: "Missing messageId" };
  }

  const mirroredWorkflowMessage = await findWorkflowOutboundMirrorMessageEventForTenantIds({
    tenantIds,
    ghlMessageId: message.messageId
  });

  if (mirroredWorkflowMessage) {
    const tenantId = mirroredWorkflowMessage.tenant_id;

    await saveMessageEvent({
      tenantId,
      provider: "ghl",
      direction: "outbound",
      externalMessageId: message.messageId ? `ghl-provider-echo:${message.messageId}` : undefined,
      ghlMessageId: message.messageId,
      ghlConversationId: message.conversationId,
      payload,
      status: "skipped",
      errorMessage: "Skipped workflow outbound mirror echo to avoid duplicate LINE delivery",
      requestPayload: {
        source: "ghl_outbound_provider",
        skipReason: "workflow_outbound_mirror_echo",
        mirrorMessageEventId: mirroredWorkflowMessage.id,
        ghlMessageId: message.messageId ?? null,
        conversationId: message.conversationId ?? null,
        contactId: message.contactId ?? null
      }
    });

    logger.warn(
      {
        tenantId,
        contactId: message.contactId,
        conversationId: message.conversationId,
        ghlMessageId: message.messageId,
        mirrorMessageEventId: mirroredWorkflowMessage.id
      },
      "Skipped HighLevel outbound provider webhook because it matches a workflow outbound mirror"
    );

    return { status: "skipped", reason: "Workflow outbound mirror echo" };
  }

  const mapping = await resolveLineProfileForGhlOutbound(tenantIds, message);

  if (!mapping) {
    const [tenantId] = tenantIds;

    await saveMessageEvent({
      tenantId,
      provider: "ghl",
      direction: "outbound",
      externalMessageId: `ghl-provider-unmapped:${message.messageId}`,
      ghlConversationId: message.conversationId,
      payload,
      status: "skipped",
      errorMessage: "No LINE mapping exists for the GHL contact/conversation"
    });

    logger.warn(
      {
        tenantId,
        contactId: message.contactId,
        conversationId: message.conversationId,
        ghlMessageId: message.messageId,
        lineProfileFound: false,
        channelTokenSource: null
      },
      "Skipped HighLevel outbound message because no LINE mapping exists"
    );

    return { status: "skipped", reason: "No LINE mapping found" };
  }

  const tenantId = mapping.tenant_id;

  const lineChannelSelection = await resolveLineChannelForOutbound(tenantId, mapping).catch(async (error) => {
    if (!isLineChannelNotConnectedError(error)) {
      throw error;
    }

    await saveMessageEvent({
      tenantId,
      provider: "ghl",
      direction: "outbound",
      externalMessageId: `ghl-provider-channel-failure:${message.messageId}`,
      lineUserId: mapping.line_user_id,
      ghlMessageId: message.messageId,
      ghlConversationId: message.conversationId,
      payload,
      status: "failed",
      errorMessage: error.message,
      requestPayload: {
        source: "ghl_outbound_provider",
        contactId: message.contactId ?? mapping.ghl_contact_id ?? null,
        conversationId: message.conversationId ?? mapping.ghl_conversation_id ?? null,
        lineChannelId: error.lineChannelId ?? mapping.line_channel_id ?? null,
        channelTokenSource: error.channelTokenSource,
        channelConnected: false
      }
    });

    logger.warn(
      {
        tenantId,
        contactId: message.contactId ?? mapping.ghl_contact_id ?? undefined,
        conversationId: message.conversationId ?? mapping.ghl_conversation_id ?? undefined,
        lineProfileFound: true,
        lineChannelId: error.lineChannelId ?? mapping.line_channel_id ?? undefined,
        channelTokenSource: error.channelTokenSource
      },
      "Blocked HighLevel outbound message because LINE channel is not connected"
    );

    throw new HttpError(409, error.message);
  });

  logger.info(
    {
      tenantId,
      contactId: message.contactId ?? mapping.ghl_contact_id ?? undefined,
      lineProfileFound: true,
      lineChannelId: lineChannelSelection.lineChannelId,
      channelTokenSource: lineChannelSelection.channelTokenSource
    },
    "Selected LINE channel token source for HighLevel outbound message"
  );

  const claimedRequestPayload = {
    source: "ghl_outbound_provider",
    deliveryState: "claimed",
    contactId: message.contactId ?? mapping.ghl_contact_id ?? null,
    conversationId: message.conversationId ?? mapping.ghl_conversation_id ?? null,
    lineChannelId: lineChannelSelection.lineChannelId ?? null,
    channelTokenSource: lineChannelSelection.channelTokenSource,
    channelConnected: true
  };
  let claim: GhlOutboundProviderDeliveryClaimResult;

  try {
    claim = await claimGhlOutboundProviderDelivery({
      tenantId,
      lineUserId: mapping.line_user_id,
      ghlMessageId: message.messageId,
      ghlConversationId: message.conversationId ?? mapping.ghl_conversation_id ?? undefined,
      payload,
      requestPayload: claimedRequestPayload
    });
  } catch (error) {
    logger.error(
      {
        tenantId,
        contactId: message.contactId ?? mapping.ghl_contact_id ?? undefined,
        conversationId: message.conversationId ?? mapping.ghl_conversation_id ?? undefined,
        ghlMessageId: message.messageId,
        errorMessage: error instanceof Error ? error.message : String(error)
      },
      "Failed to claim HighLevel outbound provider delivery"
    );

    throw new HttpError(503, "Unable to claim outbound provider delivery");
  }

  if (!claim.claimed) {
    logger.info(
      {
        tenantId,
        contactId: message.contactId ?? mapping.ghl_contact_id ?? undefined,
        conversationId: message.conversationId ?? mapping.ghl_conversation_id ?? undefined,
        ghlMessageId: message.messageId,
        externalMessageId: claim.externalMessageId
      },
      "Skipped HighLevel outbound provider callback because delivery is already claimed"
    );

    return { status: "skipped", reason: "Already claimed" };
  }

  let lineResult;

  try {
    lineResult = await pushLineTextMessage(
      mapping.line_user_id,
      message.message,
      lineChannelSelection.channelAccessToken
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown LINE push error";

    try {
      await finalizeGhlOutboundProviderDelivery({
        eventId: claim.eventId,
        tenantId,
        status: "failed",
        lineUserId: mapping.line_user_id,
        ghlMessageId: message.messageId,
        ghlConversationId: message.conversationId ?? mapping.ghl_conversation_id ?? undefined,
        errorMessage,
        requestPayload: {
          ...claimedRequestPayload,
          deliveryState: "failed"
        }
      });
    } catch (finalizeError) {
      logger.error(
        {
          tenantId,
          ghlMessageId: message.messageId,
          deliveryClaimEventId: claim.eventId,
          errorMessage: finalizeError instanceof Error ? finalizeError.message : String(finalizeError)
        },
        "Failed to mark outbound provider delivery claim as failed"
      );
    }

    logger.error(
      {
        tenantId,
        contactId: message.contactId ?? mapping.ghl_contact_id ?? undefined,
        conversationId: message.conversationId ?? mapping.ghl_conversation_id ?? undefined,
        ghlMessageId: message.messageId,
        deliveryClaimEventId: claim.eventId,
        errorMessage
      },
      "LINE push failed after outbound provider delivery was claimed; later callbacks will be skipped"
    );

    throw new HttpError(502, "LINE delivery failed after outbound provider claim");
  }

  try {
    await finalizeGhlOutboundProviderDelivery({
      eventId: claim.eventId,
      tenantId,
      status: "sent",
      lineUserId: mapping.line_user_id,
      ghlMessageId: message.messageId,
      ghlConversationId: message.conversationId ?? mapping.ghl_conversation_id ?? undefined,
      requestPayload: {
        ...claimedRequestPayload,
        deliveryState: "sent",
        lineMessageId: lineResult.messageId ?? null
      }
    });
  } catch (error) {
    logger.error(
      {
        tenantId,
        ghlMessageId: message.messageId,
        deliveryClaimEventId: claim.eventId,
        lineMessageId: lineResult.messageId,
        errorMessage: error instanceof Error ? error.message : String(error)
      },
      "LINE push succeeded but outbound provider delivery claim finalization failed; later callbacks will be skipped"
    );

    throw new HttpError(500, "LINE delivery claim finalization failed");
  }

  logger.info(
    {
      lineUserId: mapping.line_user_id,
      contactId: message.contactId,
      conversationId: message.conversationId,
      ghlMessageId: message.messageId,
      deliveryClaimEventId: claim.eventId,
      lineMessageId: lineResult.messageId
    },
    "HighLevel outbound message sent to LINE"
  );

  return { status: "processed" };
}
