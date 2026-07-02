import { logger } from "../config/logger";
import { createGhlContact, sendInboundMessageToGhl, updateGhlContactLineFields } from "../integrations/ghlClient";
import { getLineProfile } from "../integrations/lineClient";
import type { LineMessage, LineSource, LineWebhookEvent } from "../types/line";
import { getErrorMessage, serializeError } from "../utils/errors";
import { redactSecrets } from "../utils/redaction";
import {
  ensureDefaultTenant,
  linkGhlMapping,
  markWebhookEventProcessed,
  saveMessageEvent,
  saveWebhookEvent,
  upsertLineProfile
} from "./repository";

function getLineUserId(source: LineSource): string | undefined {
  return "userId" in source ? source.userId : undefined;
}

function getLineSourceId(source: LineSource): string {
  if (source.type === "group") {
    return source.groupId;
  }

  if (source.type === "room") {
    return source.roomId;
  }

  return source.userId;
}

function messageToText(message: LineMessage): { text: string; attachments: string[] } {
  if (message.type === "text") {
    return {
      text: message.text,
      attachments: []
    };
  }

  return {
    text: `[LINE ${message.type} message received. Use LINE content APIs to fetch binary payload ${message.id}.]`,
    attachments: []
  };
}

function getLineMessageId(event: LineWebhookEvent): string | undefined {
  return event.message?.id;
}

function getWebhookEventId(event: LineWebhookEvent): string | undefined {
  return event.webhookEventId ?? getLineMessageId(event);
}

export async function processLineWebhookEvent(event: LineWebhookEvent): Promise<{
  status: "processed" | "skipped" | "failed";
  reason?: string;
}> {
  const lineUserId = getLineUserId(event.source);
  const lineMessageId = getLineMessageId(event);
  const webhookEvent = await saveWebhookEvent({
    source: "line",
    eventId: getWebhookEventId(event),
    payload: event
  });

  try {
    const tenantId = await ensureDefaultTenant();

    if (!lineUserId) {
      return { status: "skipped", reason: "LINE event has no userId" };
    }

    if (event.type !== "message" || !event.message) {
      await saveMessageEvent({
        tenantId,
        provider: "line",
        direction: "inbound",
        externalMessageId: event.webhookEventId,
        lineUserId,
        payload: event,
        status: "skipped"
      });
      return { status: "skipped", reason: `Unsupported LINE event type: ${event.type}` };
    }

    const profile = event.source.type === "user" ? await getLineProfile(lineUserId) : null;
    let record = await upsertLineProfile({
      tenantId,
      lineUserId,
      lineSourceType: event.source.type,
      lineSourceId: getLineSourceId(event.source),
      displayName: profile?.displayName,
      pictureUrl: profile?.pictureUrl
    });

    const { text, attachments } = messageToText(event.message);

    try {
      if (!record.ghl_contact_id) {
        const contact = await createGhlContact({
          lineUserId,
          displayName: profile?.displayName ?? undefined,
          pictureUrl: profile?.pictureUrl ?? undefined
        });

        record = await linkGhlMapping({
          tenantId,
          lineUserId,
          ghlContactId: contact.id
        });

        logger.info({ lineUserId, lineMessageId, ghlContactId: contact.id }, "Created GHL contact for LINE user");
      } else {
        try {
          await updateGhlContactLineFields(record.ghl_contact_id, {
            lineUserId,
            displayName: profile?.displayName ?? undefined,
            pictureUrl: profile?.pictureUrl ?? undefined
          });
        } catch (error) {
          logger.warn(
            {
              lineUserId,
              lineMessageId,
              ghlContactId: record.ghl_contact_id,
              error: redactSecrets(serializeError(error))
            },
            "Failed to update optional LINE custom fields on existing GHL contact"
          );
        }
      }

      if (!record.ghl_contact_id) {
        throw new Error("LINE user could not be linked to a GHL contact");
      }

      const response = await sendInboundMessageToGhl({
        contactId: record.ghl_contact_id,
        conversationId: record.ghl_conversation_id ?? undefined,
        externalConversationId: `${record.line_source_type}:${record.line_source_id}:${record.line_user_id}`,
        externalMessageId: event.message.id,
        message: text,
        attachments
      });

      const ghlConversationId = typeof response.conversationId === "string" ? response.conversationId : undefined;

      if (ghlConversationId && ghlConversationId !== record.ghl_conversation_id) {
        await linkGhlMapping({
          tenantId,
          lineUserId,
          ghlConversationId
        });
      }

      await saveMessageEvent({
        tenantId,
        provider: "line",
        direction: "inbound",
        externalMessageId: event.message.id,
        lineUserId,
        ghlMessageId: typeof response.messageId === "string" ? response.messageId : response.id,
        ghlConversationId,
        payload: {
          lineEvent: event,
          ghlResponse: response
        },
        status: "sent"
      });

      return { status: "processed" };
    } catch (error) {
      const serializedError = redactSecrets(serializeError(error));

      logger.error(
        {
          lineUserId,
          lineMessageId,
          error: serializedError
        },
        "Failed to sync LINE inbound message to HighLevel"
      );

      await saveMessageEvent({
        tenantId,
        provider: "line",
        direction: "inbound",
        externalMessageId: event.message.id,
        lineUserId,
        payload: event,
        status: "failed",
        errorMessage: getErrorMessage(error)
      });

      return { status: "failed", reason: getErrorMessage(error) };
    }
  } finally {
    await markWebhookEventProcessed(webhookEvent.id);
  }
}
