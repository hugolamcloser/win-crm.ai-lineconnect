import { env, requireEnvValue } from "../config/env";
import {
  forceRefreshGhlAuthContext,
  getGhlAuthContext,
  type GhlAuthContext
} from "../services/ghlOAuthService";

export type Stage1InitialStatus = "pending" | "delivered";
export type Stage1FinalStatus = "delivered" | "failed";

export type Stage1CustomMessagePayload = {
  type: "Custom";
  contactId: string;
  conversationProviderId: string;
  status: Stage1InitialStatus;
  message?: string;
  attachments?: string[];
};

export type Stage1GhlRequestResult = {
  ok: boolean;
  statusCode: number;
  messageId?: string;
  conversationId?: string;
};

const messagesEndpoint = "/conversations/messages";

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getNestedString(value: unknown, ...path: string[]): string | undefined {
  let current = value;

  for (const key of path) {
    const record = getRecord(current);

    if (!record) {
      return undefined;
    }

    current = record[key];
  }

  return getNonEmptyString(current);
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The probe never needs provider error bodies.
  }
}

async function parseCreatedMessage(response: Response): Promise<{
  messageId?: string;
  conversationId?: string;
}> {
  try {
    const body: unknown = await response.json();

    return {
      messageId:
        getNestedString(body, "messageId") ??
        getNestedString(body, "data", "messageId") ??
        getNestedString(body, "message", "id"),
      conversationId:
        getNestedString(body, "conversationId") ??
        getNestedString(body, "data", "conversationId") ??
        getNestedString(body, "conversation", "id")
    };
  } catch {
    return {};
  }
}

function performRequest(path: string, init: RequestInit, auth: GhlAuthContext): Promise<Response> {
  return fetch(`${env.GHL_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Version: requireEnvValue("STAGE1_GHL_API_VERSION", env.STAGE1_GHL_API_VERSION),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {})
    }
  });
}

async function requestWithOAuthRefresh(
  locationId: string,
  path: string,
  init: RequestInit
): Promise<Response> {
  let auth = await getGhlAuthContext(locationId, { allowPrivateFallback: false });
  let response = await performRequest(path, init, auth);

  if (response.status === 401) {
    await discardResponseBody(response);
    auth = await forceRefreshGhlAuthContext(locationId);
    response = await performRequest(path, init, auth);
  }

  return response;
}

export async function createStage1CustomMessage(
  locationId: string,
  payload: Stage1CustomMessagePayload
): Promise<Stage1GhlRequestResult> {
  const response = await requestWithOAuthRefresh(locationId, messagesEndpoint, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    await discardResponseBody(response);
    return { ok: false, statusCode: response.status };
  }

  const ids = await parseCreatedMessage(response);

  return {
    ok: true,
    statusCode: response.status,
    ...ids
  };
}

export async function updateStage1CustomMessageStatus(
  locationId: string,
  messageId: string,
  status: Stage1FinalStatus
): Promise<Stage1GhlRequestResult> {
  const response = await requestWithOAuthRefresh(
    locationId,
    `${messagesEndpoint}/${encodeURIComponent(messageId)}/status`,
    {
      method: "PUT",
      body: JSON.stringify({ status })
    }
  );

  await discardResponseBody(response);
  return { ok: response.ok, statusCode: response.status };
}
