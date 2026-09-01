import { createHmac } from "node:crypto";

export type HmacFingerprintDomain = "destination" | "message";

export function hmacSha256Fingerprint(
  secret: string,
  domain: HmacFingerprintDomain,
  value: string,
): string {
  if (!secret) {
    throw new Error("HMAC fingerprint secret is required");
  }

  return createHmac("sha256", secret)
    .update(`${domain}:v1:`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}
