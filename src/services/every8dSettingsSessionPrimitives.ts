import crypto from "node:crypto";

const credentialPattern = /^[A-Za-z0-9_-]{43}$/;

export function parseEvery8dSettingsSessionCredential(value: unknown): Buffer {
  if (typeof value !== "string" || !credentialPattern.test(value)) {
    throw new Error("EVERY8D settings session credential is invalid");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    throw new Error("EVERY8D settings session credential is invalid");
  }
  return decoded;
}

export function generateEvery8dSettingsSessionCredential(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashEvery8dSettingsSessionCredential(value: unknown): Buffer {
  return crypto.createHash("sha256")
    .update(parseEvery8dSettingsSessionCredential(value)).digest();
}
