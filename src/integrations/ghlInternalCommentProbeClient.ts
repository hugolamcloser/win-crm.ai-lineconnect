import { env, requireEnvValue } from "../config/env";
import { logger } from "../config/logger";
import {
  forceRefreshGhlAuthContext,
  getGhlAuthContext,
  type GhlAuthContext
} from "../services/ghlOAuthService";

export type GhlInternalCommentProbeCase = "A" | "B" | "C";

export type GhlInternalCommentProbeInput = {
  requestId?: string;
  locationId: string;
  contactId: string;
  probeCase: GhlInternalCommentProbeCase;
  resourceUrl?: string;
};

export type GhlInternalCommentProbeResult = {
  ok: boolean;
  statusCode: number;
  authMode: GhlAuthContext["mode"];
  messageId?: string;
  conversationId?: string;
  responseJsonParsed: boolean;
  errorCategory?: "highlevel_rejected";
};

type InternalCommentPayload = {
  type: "InternalComment";
  contactId: string;
  message: string;
  status: "delivered";
  attachments?: string[];
};

const endpoint = "/conversations/messages";
const method = "POST";
const maxResponseBytes = 32 * 1024;

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function getNestedId(value: unknown, ...path: string[]): string | undefined {
  let current = value;

  for (const key of path) {
    const record = getRecord(current);
    if (!record) {
      return undefined;
    }
    current = record[key];
  }

  return normalizeId(current);
}

function extractResponseIds(value: unknown): { messageId?: string; conversationId?: string } {
  return {
    messageId:
      getNestedId(value, "messageId") ??
      getNestedId(value, "id") ??
      getNestedId(value, "message", "id") ??
      getNestedId(value, "data", "messageId") ??
      getNestedId(value, "data", "id"),
    conversationId:
      getNestedId(value, "conversationId") ??
      getNestedId(value, "conversation", "id") ??
      getNestedId(value, "data", "conversationId")
  };
}

function buildPayload(input: GhlInternalCommentProbeInput): InternalCommentPayload {
  if (input.probeCase === "B") {
    if (!input.resourceUrl) {
      throw new Error("InternalComment probe case B requires a resource URL");
    }
    return {
      type: "InternalComment",
      contactId: input.contactId,
      message: `Stage 0 InternalComment proof: clickable HTTPS link\n${input.resourceUrl}`,
      status: "delivered"
    };
  }

  if (input.probeCase === "C") {
    if (!input.resourceUrl) {
      throw new Error("InternalComment probe case C requires a resource URL");
    }
    return {
      type: "InternalComment",
      contactId: input.contactId,
      message: "Stage 0 InternalComment proof: image attachment",
      status: "delivered",
      attachments: [input.resourceUrl]
    };
  }

  return {
    type: "InternalComment",
    contactId: input.contactId,
    message: "Stage 0 InternalComment proof: plain text",
    status: "delivered"
  };
}

async function performRequest(payload: InternalCommentPayload, auth: GhlAuthContext): Promise<Response> {
  return fetch(`${env.GHL_API_BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Version: requireEnvValue("GHL_API_VERSION", env.GHL_API_VERSION),
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A rejected response body is deliberately ignored by this temporary proof.
  }
}

async function parseSafeResponse(response: Response): Promise<{
  responseJsonParsed: boolean;
  messageId?: string;
  conversationId?: string;
}> {
  if (!response.body) {
    return { responseJsonParsed: false };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let responseText = "";
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxResponseBytes) {
      await reader.cancel();
      return { responseJsonParsed: false };
    }

    responseText += decoder.decode(value, { stream: true });
  }
  responseText += decoder.decode();

  if (!responseText) {
    return { responseJsonParsed: false };
  }

  try {
    const parsed: unknown = JSON.parse(responseText);
    const ids = extractResponseIds(parsed);
    return { responseJsonParsed: true, ...ids };
  } catch {
    return { responseJsonParsed: false };
  }
}

function buildLogMetadata(input: GhlInternalCommentProbeInput): Record<string, unknown> {
  return {
    requestId: input.requestId,
    probeCase: input.probeCase,
    selectedMessageType: "InternalComment",
    locationIdPresent: Boolean(input.locationId),
    contactIdPresent: Boolean(input.contactId),
    resourceUrlPresent: Boolean(input.resourceUrl),
    attachmentCount: input.probeCase === "C" ? 1 : 0,
    conversationProviderIdIncluded: false
  };
}

export async function createGhlInternalCommentProbe(
  input: GhlInternalCommentProbeInput
): Promise<GhlInternalCommentProbeResult> {
  const payload = buildPayload(input);

  logger.info(
    {
      endpoint,
      method,
      ...buildLogMetadata(input),
      probeDispatchStatus: "preparing"
    },
    "Preparing isolated HighLevel InternalComment proof"
  );

  let auth = await getGhlAuthContext(input.locationId, { allowPrivateFallback: false });
  let response = await performRequest(payload, auth);

  if (response.status === 401 && auth.mode === "oauth") {
    await discardResponseBody(response);
    auth = await forceRefreshGhlAuthContext(input.locationId);
    response = await performRequest(payload, auth);
  }

  const parsed = await parseSafeResponse(response);

  logger.info(
    {
      endpoint,
      method,
      ...buildLogMetadata(input),
      authMode: auth.mode,
      statusCode: response.status,
      highLevelMessageIdPresent: Boolean(parsed.messageId),
      highLevelConversationIdPresent: Boolean(parsed.conversationId),
      responseJsonParsed: parsed.responseJsonParsed,
      probeDispatchStatus: response.ok ? "accepted" : "rejected"
    },
    "HighLevel InternalComment proof request completed"
  );

  return {
    ok: response.ok,
    statusCode: response.status,
    authMode: auth.mode,
    ...parsed,
    ...(response.ok ? {} : { errorCategory: "highlevel_rejected" as const })
  };
}
