import crypto from "node:crypto";
import { env } from "../config/env";
import type { LineProfile } from "../types/line";

const lineApiBaseUrl = "https://api.line.me";

export function verifyLineSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) {
    return false;
  }

  const expected = crypto.createHmac("sha256", env.LINE_CHANNEL_SECRET).update(rawBody).digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

async function lineRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${lineApiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE API ${response.status} ${response.statusText}: ${body}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function getLineProfile(userId: string): Promise<LineProfile | null> {
  try {
    return await lineRequest<LineProfile>(`/v2/bot/profile/${encodeURIComponent(userId)}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      return null;
    }

    throw error;
  }
}

export async function pushLineTextMessage(to: string, text: string): Promise<void> {
  await lineRequest<void>("/v2/bot/message/push", {
    method: "POST",
    body: JSON.stringify({
      to,
      messages: [
        {
          type: "text",
          text
        }
      ]
    })
  });
}
