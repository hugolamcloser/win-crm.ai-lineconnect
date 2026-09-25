import crypto from "node:crypto";
import { z } from "zod";
import type { Every8dGhlOAuthConfig } from "../config/every8dGhlOAuth";

const statePurpose = "every8d_public_oauth_state_v1";
const hmacDomain = "wincrm/every8d/oauth-state-auth/v1";
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const hashPattern = /^[0-9a-f]{64}$/;
const identifierPattern = /^[A-Za-z0-9_.-]{1,256}$/;
const maximumStateLength = 4096;

const statePayloadSchema = z.object({
  version: z.literal(1),
  purpose: z.literal(statePurpose),
  keyVersion: z.string().regex(identifierPattern),
  nonce: z.string().regex(base64UrlPattern).refine((value) => decodeCanonical(value)?.length === 32),
  appNamespace: z.literal("every8d_connect"),
  marketplaceVersionId: z.string().regex(identifierPattern),
  redirectUri: z.string().url().max(2048),
  configFingerprint: z.string().regex(hashPattern),
  expectedLocationId: z.string().regex(identifierPattern),
  browserBindingHash: z.string().regex(hashPattern),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive()
}).strict();

export type Every8dPublicOAuthState = z.infer<typeof statePayloadSchema>;

function stateError(): Error {
  return new Error("EVERY8D public OAuth state is invalid");
}

function decodeCanonical(value: string): Buffer | null {
  if (!value || !base64UrlPattern.test(value) || value.length % 4 === 1) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length > 0 && decoded.toString("base64url") === value ? decoded : null;
}

function canonicalPayload(payload: Every8dPublicOAuthState): string {
  return JSON.stringify({
    version: payload.version,
    purpose: payload.purpose,
    keyVersion: payload.keyVersion,
    nonce: payload.nonce,
    appNamespace: payload.appNamespace,
    marketplaceVersionId: payload.marketplaceVersionId,
    redirectUri: payload.redirectUri,
    configFingerprint: payload.configFingerprint,
    expectedLocationId: payload.expectedLocationId,
    browserBindingHash: payload.browserBindingHash,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt
  });
}

function stateKey(config: Every8dGhlOAuthConfig, keyVersion: string): Buffer {
  const encryptionKey = config.encryptionKeys.get(keyVersion);
  if (!encryptionKey) throw stateError();
  return Buffer.from(crypto.hkdfSync("sha256", encryptionKey, Buffer.alloc(0), hmacDomain, 32));
}

function sign(encodedPayload: string, config: Every8dGhlOAuthConfig, keyVersion: string): Buffer {
  return crypto.createHmac("sha256", stateKey(config, keyVersion)).update(encodedPayload, "ascii").digest();
}

export function createEvery8dPublicOAuthState(input: {
  config: Every8dGhlOAuthConfig;
  configFingerprint: string;
  nonce: Buffer;
  browserBindingHash: string;
  now: number;
}): { state: string; payload: Every8dPublicOAuthState } {
  if (input.nonce.length !== 32 || !hashPattern.test(input.configFingerprint)
    || !hashPattern.test(input.browserBindingHash)) throw stateError();
  const issuedAt = Math.floor(input.now / 1000);
  const payload = statePayloadSchema.parse({
    version: 1,
    purpose: statePurpose,
    keyVersion: input.config.activeKeyVersion,
    nonce: input.nonce.toString("base64url"),
    appNamespace: "every8d_connect",
    marketplaceVersionId: input.config.marketplaceVersionId,
    redirectUri: input.config.redirectUri,
    configFingerprint: input.configFingerprint,
    expectedLocationId: input.config.expectedLocationId,
    browserBindingHash: input.browserBindingHash,
    issuedAt,
    expiresAt: issuedAt + input.config.stateTtlSeconds
  });
  const encodedPayload = Buffer.from(canonicalPayload(payload), "utf8").toString("base64url");
  const state = `${encodedPayload}.${sign(encodedPayload, input.config, payload.keyVersion).toString("base64url")}`;
  if (state.length > maximumStateLength) throw stateError();
  return { state, payload };
}

export function verifyEvery8dPublicOAuthState(input: {
  state: string;
  browserBindingHash: string;
  config: Every8dGhlOAuthConfig;
  configFingerprint: string;
  now: number;
}): Every8dPublicOAuthState {
  try {
    if (!input.state || input.state.length > maximumStateLength || !hashPattern.test(input.browserBindingHash)) {
      throw stateError();
    }
    const parts = input.state.split(".");
    if (parts.length !== 2) throw stateError();
    const payloadBytes = decodeCanonical(parts[0]!);
    const providedMac = decodeCanonical(parts[1]!);
    if (!payloadBytes || !providedMac || providedMac.length !== 32) throw stateError();
    const raw = payloadBytes.toString("utf8");
    const untrusted = JSON.parse(raw) as unknown;
    if (!untrusted || typeof untrusted !== "object" || Array.isArray(untrusted)
      || typeof (untrusted as { keyVersion?: unknown }).keyVersion !== "string"
      || !identifierPattern.test((untrusted as { keyVersion: string }).keyVersion)) throw stateError();
    const expectedMac = sign(parts[0]!, input.config, (untrusted as { keyVersion: string }).keyVersion);
    if (!crypto.timingSafeEqual(providedMac, expectedMac)) throw stateError();
    const payload = statePayloadSchema.parse(untrusted);
    if (canonicalPayload(payload) !== raw) throw stateError();
    const now = Math.floor(input.now / 1000);
    if (payload.issuedAt > now || payload.expiresAt <= now || payload.expiresAt <= payload.issuedAt
      || payload.expiresAt - payload.issuedAt !== input.config.stateTtlSeconds
      || payload.marketplaceVersionId !== input.config.marketplaceVersionId
      || payload.redirectUri !== input.config.redirectUri
      || payload.configFingerprint !== input.configFingerprint
      || payload.expectedLocationId !== input.config.expectedLocationId
      || payload.browserBindingHash !== input.browserBindingHash) {
      throw stateError();
    }
    return payload;
  } catch {
    throw stateError();
  }
}
