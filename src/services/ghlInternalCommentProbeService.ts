import crypto from "node:crypto";
import { isIP } from "node:net";
import {
  createGhlInternalCommentProbe,
  type GhlInternalCommentProbeCase
} from "../integrations/ghlInternalCommentProbeClient";
import { HttpError } from "../middleware/errors";
import {
  getTenantIdsByLocationId,
  hasLineProfileForGhlContactInTenantIds
} from "./repository";

type InternalCommentProbeRequest = {
  locationId: string;
  contactId: string;
  probeCase: GhlInternalCommentProbeCase;
  resourceUrl?: string;
};

export type InternalCommentProbeResponse = {
  ok: boolean;
  probeCase: GhlInternalCommentProbeCase;
  highLevelStatusCode: number;
  highLevelMessageId: string | null;
  highLevelConversationId: string | null;
  messageIdPresent: boolean;
  conversationIdPresent: boolean;
  responseJsonParsed: boolean;
  contactMappingFound: false;
  conversationProviderIdIncluded: false;
  lineApiCalledByProbe: false;
  inboxObservationRequired: true;
  webhookObservationRequired: true;
  errorCategory: "" | "highlevel_rejected";
};

export type InternalCommentProbeExecutionResult = {
  httpStatus: number;
  body: InternalCommentProbeResponse;
};

export type InternalCommentProbeWebhookObservation = {
  eventKind: "provider_callback_candidate" | "outbound_webhook";
  registeredProbeContact: boolean;
  locationIdPresent: boolean;
  contactIdPresent: boolean;
  messageIdPresent: boolean;
  conversationIdPresent: boolean;
  attachmentsPresent: boolean;
  messagePresent: boolean;
};

const activeProbeContactLifetimeMs = 30 * 60 * 1000;
const activeProbeContactDigests = new Map<string, number>();

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getNestedString(payload: Record<string, unknown>, ...path: string[]): string | undefined {
  let current: unknown = payload;

  for (const key of path) {
    const record = getRecord(current);
    if (!record) {
      return undefined;
    }
    current = record[key];
  }

  return getString(current);
}

function getRequiredString(payload: Record<string, unknown>, key: "locationId" | "contactId"): string {
  const value = getString(payload[key]);
  if (!value) {
    throw new HttpError(400, `${key} is required`);
  }
  return value;
}

function getProbeCase(value: unknown): GhlInternalCommentProbeCase {
  if (value === "A" || value === "B" || value === "C") {
    return value;
  }
  throw new HttpError(400, "probeCase must be A, B or C");
}

function validateProbeResourceUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "resourceUrl is required for probe case B or C");
  }

  if (value.length > 2_000) {
    throw new HttpError(400, "resourceUrl must be 2,000 characters or fewer");
  }

  if (/[\u0000-\u0020\u007f]/.test(value)) {
    throw new HttpError(400, "resourceUrl must be percent-encoded and must not contain whitespace");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, "resourceUrl must be a valid absolute URL");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (parsed.protocol !== "https:") {
    throw new HttpError(400, "resourceUrl must use HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new HttpError(400, "resourceUrl must not contain embedded credentials");
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isIP(hostname) !== 0) {
    throw new HttpError(400, "resourceUrl must use a public hostname");
  }

  return value;
}

function normalizeProbeRequest(payload: Record<string, unknown>): InternalCommentProbeRequest {
  const locationId = getRequiredString(payload, "locationId");
  const contactId = getRequiredString(payload, "contactId");
  const probeCase = getProbeCase(payload.probeCase);

  return {
    locationId,
    contactId,
    probeCase,
    ...(probeCase === "B" || probeCase === "C"
      ? { resourceUrl: validateProbeResourceUrl(payload.resourceUrl) }
      : {})
  };
}

function digestContactId(contactId: string): string {
  return crypto.createHash("sha256").update(contactId).digest("hex");
}

function pruneActiveProbeContacts(now = Date.now()): void {
  for (const [digest, expiresAt] of activeProbeContactDigests) {
    if (expiresAt <= now) {
      activeProbeContactDigests.delete(digest);
    }
  }
}

function registerProbeContact(contactId: string): void {
  pruneActiveProbeContacts();
  activeProbeContactDigests.set(digestContactId(contactId), Date.now() + activeProbeContactLifetimeMs);
}

function isRegisteredProbeContact(contactId: string | undefined): boolean {
  if (!contactId) {
    return false;
  }
  pruneActiveProbeContacts();
  return activeProbeContactDigests.has(digestContactId(contactId));
}

export function getInternalCommentProbeWebhookObservation(
  payload: Record<string, unknown>
): InternalCommentProbeWebhookObservation | null {
  const type = getString(payload.type)?.toLowerCase();
  const messageType = (
    getString(payload.messageType) ??
    getNestedString(payload, "message", "type") ??
    getNestedString(payload, "message", "messageType")
  )?.toLowerCase();
  const contactId = getString(payload.contactId) ?? getNestedString(payload, "contact", "id");
  const registeredProbeContact = isRegisteredProbeContact(contactId);
  const message =
    getString(payload.message) ??
    getString(payload.body) ??
    getNestedString(payload, "message", "body") ??
    getNestedString(payload, "message", "text");
  const hasStageZeroMarker = message?.startsWith("Stage 0 InternalComment proof:") ?? false;

  if (!registeredProbeContact && !hasStageZeroMarker) {
    return null;
  }

  const attachments = payload.attachments ?? getRecord(payload.message)?.attachments;
  return {
    eventKind:
      type === "outboundmessage" || messageType === "internalcomment"
        ? "outbound_webhook"
        : "provider_callback_candidate",
    registeredProbeContact,
    locationIdPresent: Boolean(
      getString(payload.locationId) ?? getNestedString(payload, "location", "id")
    ),
    contactIdPresent: Boolean(contactId),
    messageIdPresent: Boolean(
      getString(payload.messageId) ?? getString(payload.id) ?? getNestedString(payload, "message", "id")
    ),
    conversationIdPresent: Boolean(
      getString(payload.conversationId) ?? getNestedString(payload, "conversation", "id")
    ),
    attachmentsPresent: Array.isArray(attachments) && attachments.length > 0,
    messagePresent: Boolean(message)
  };
}

export async function runInternalCommentProbe(
  payload: Record<string, unknown>,
  requestId?: string
): Promise<InternalCommentProbeExecutionResult> {
  const input = normalizeProbeRequest(payload);
  const tenantIds = await getTenantIdsByLocationId(input.locationId);

  if (tenantIds.length === 0) {
    throw new HttpError(409, "Probe location is not available in the isolated service");
  }

  const contactMappingFound = await hasLineProfileForGhlContactInTenantIds(tenantIds, input.contactId);
  if (contactMappingFound) {
    throw new HttpError(409, "Probe contact must not have a LINE profile mapping");
  }

  registerProbeContact(input.contactId);
  const result = await createGhlInternalCommentProbe({
    ...(requestId ? { requestId } : {}),
    ...input
  });

  const upstreamStatusIsSafe = result.statusCode >= 400 && result.statusCode <= 599;
  return {
    httpStatus: result.ok ? 200 : upstreamStatusIsSafe ? result.statusCode : 502,
    body: {
      ok: result.ok,
      probeCase: input.probeCase,
      highLevelStatusCode: result.statusCode,
      highLevelMessageId: result.messageId ?? null,
      highLevelConversationId: result.conversationId ?? null,
      messageIdPresent: Boolean(result.messageId),
      conversationIdPresent: Boolean(result.conversationId),
      responseJsonParsed: result.responseJsonParsed,
      contactMappingFound: false,
      conversationProviderIdIncluded: false,
      lineApiCalledByProbe: false,
      inboxObservationRequired: true,
      webhookObservationRequired: true,
      errorCategory: result.errorCategory ?? ""
    }
  };
}
