import crypto from "node:crypto";
import { TextDecoder } from "node:util";
import type { Every8dSettingsAuthHmacKeyring } from "../config/every8dSettingsAuth";
import { isEvery8dSettingsEmailOutboxKeyVersion } from "../config/every8dSettingsEmailOutbox";
import type { Every8dSettingsEmailOutboxEncryptionConfig } from "../config/every8dSettingsEmailOutbox";
import { formatEvery8dSettingsOtp, normalizeEvery8dSettingsEmail, parseEvery8dSettingsOtp } from "./every8dSettingsAuthPrimitives";
import { readValidatedEvery8dSettingsEmailOutboxClaim } from "./every8dSettingsEmailOutboxRepository";
import type { Every8dSettingsEmailOutboxClaimReceipt, Every8dSettingsEmailOutboxContext,
  Every8dSettingsEmailOutboxEncryptedPayload, Every8dSettingsEmailOutboxPayload } from "../types/every8dSettingsEmailOutbox";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const jobPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const domain = Buffer.from("wincrm/every8d/settings/auth-email-outbox/aad/v1", "utf8");
export class Every8dSettingsEmailPayloadUnavailableError extends Error {
  readonly category = "payload_unavailable";
  constructor() {
    super("EVERY8D settings email payload unavailable");
    this.name = "Every8dSettingsEmailPayloadUnavailableError";
  }
}
function unavailable(): never { throw new Every8dSettingsEmailPayloadUnavailableError(); }
function exact(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === names.length && names.every((name) => Object.prototype.hasOwnProperty.call(value, name));
}
function lp(bytes: Buffer): Buffer {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length);
  return Buffer.concat([prefix, bytes]);
}
function u16(value: number): Buffer {
  const result = Buffer.alloc(2); result.writeUInt16BE(value); return result;
}
function contextBytes(input: Every8dSettingsEmailOutboxContext): Buffer {
  if (!exact(input, ["jobId", "challengeId", "requestTokenHash", "purpose", "envelopeVersion",
    "payloadVersion", "templateVersion", "encryptionKeyVersion"]) ||
    typeof input.jobId !== "string" || input.jobId.length !== 36 || !jobPattern.test(input.jobId) ||
    typeof input.challengeId !== "string" || input.challengeId.length !== 36 || !uuidPattern.test(input.challengeId) ||
    !Buffer.isBuffer(input.requestTokenHash) || input.requestTokenHash.length !== 32 ||
    (input.purpose !== "login" && input.purpose !== "enrollment") || input.envelopeVersion !== 1 ||
    input.payloadVersion !== 1 || input.templateVersion !== 1 ||
    !isEvery8dSettingsEmailOutboxKeyVersion(input.encryptionKeyVersion)) return unavailable();
  return Buffer.concat([lp(domain), u16(input.envelopeVersion), lp(Buffer.from(input.encryptionKeyVersion, "utf8")),
    Buffer.from(input.jobId.replace(/-/g, ""), "hex"), Buffer.from(input.challengeId.replace(/-/g, ""), "hex"),
    Buffer.from(input.requestTokenHash), lp(Buffer.from(input.purpose, "utf8")), u16(input.templateVersion), u16(input.payloadVersion)]);
}
export function encodeEvery8dSettingsEmailOutboxAad(input: Every8dSettingsEmailOutboxContext): Buffer {
  try { return contextBytes(input); } catch { return unavailable(); }
}

function payloadText(input: Every8dSettingsEmailOutboxPayload): string {
  if (!exact(input, ["recipient", "displayOtp"]) || typeof input.recipient !== "string" ||
    input.recipient !== normalizeEvery8dSettingsEmail(input.recipient) ||
    Buffer.byteLength(input.recipient, "ascii") > 254 || !/^[\x00-\x7f]+$/.test(input.recipient) ||
    typeof input.displayOtp !== "string" || input.displayOtp.length !== 9 ||
    formatEvery8dSettingsOtp(parseEvery8dSettingsOtp(input.displayOtp)) !== input.displayOtp) return unavailable();
  const raw = JSON.stringify({ v: 1, recipient: input.recipient, displayOtp: input.displayOtp });
  if (Buffer.byteLength(raw, "utf8") > 512) return unavailable();
  return raw;
}
function frozenEncrypted(input: Every8dSettingsEmailOutboxEncryptedPayload): Every8dSettingsEmailOutboxEncryptedPayload {
  const nonce = Buffer.from(input.nonce), ciphertext = Buffer.from(input.ciphertext), tag = Buffer.from(input.authenticationTag);
  const version = input.encryptionKeyVersion;
  return Object.freeze({ envelopeVersion: 1 as const, payloadVersion: 1 as const, templateVersion: 1 as const,
    encryptionKeyVersion: version, get nonce() { return Buffer.from(nonce); },
    get ciphertext() { return Buffer.from(ciphertext); }, get authenticationTag() { return Buffer.from(tag); } });
}
function binaryEnvelope(input: Every8dSettingsEmailOutboxEncryptedPayload): void {
  if (!exact(input, ["envelopeVersion", "payloadVersion", "templateVersion", "encryptionKeyVersion", "nonce", "ciphertext", "authenticationTag"]) ||
    input.envelopeVersion !== 1 || input.payloadVersion !== 1 || input.templateVersion !== 1 ||
    !isEvery8dSettingsEmailOutboxKeyVersion(input.encryptionKeyVersion) ||
    !Buffer.isBuffer(input.nonce) || input.nonce.length !== 12 ||
    !Buffer.isBuffer(input.authenticationTag) || input.authenticationTag.length !== 16 ||
    !Buffer.isBuffer(input.ciphertext) || input.ciphertext.length < 1 || input.ciphertext.length > 512) unavailable();
}
export function serializeEvery8dSettingsEmailOutboxEnvelope(input: Every8dSettingsEmailOutboxEncryptedPayload): string {
  try {
    binaryEnvelope(input);
    const raw = JSON.stringify({ v: 1, alg: "A256GCM", keyVersion: input.encryptionKeyVersion,
      payloadVersion: 1, templateVersion: 1, nonce: input.nonce.toString("base64url"),
      ciphertext: input.ciphertext.toString("base64url"), tag: input.authenticationTag.toString("base64url") });
    if (Buffer.byteLength(raw, "utf8") > 1024) unavailable();
    return raw;
  } catch { return unavailable(); }
}
function base64(value: unknown, minimum: number, maximum: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return unavailable();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < minimum || bytes.length > maximum || bytes.toString("base64url") !== value) return unavailable();
  return bytes;
}
export function parseEvery8dSettingsEmailOutboxEnvelope(raw: unknown): Every8dSettingsEmailOutboxEncryptedPayload {
  try {
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 1024) return unavailable();
    const parsed: unknown = JSON.parse(raw);
    if (!exact(parsed, ["v", "alg", "keyVersion", "payloadVersion", "templateVersion", "nonce", "ciphertext", "tag"]) ||
      parsed.v !== 1 || parsed.alg !== "A256GCM" || parsed.payloadVersion !== 1 || parsed.templateVersion !== 1 ||
      !isEvery8dSettingsEmailOutboxKeyVersion(parsed.keyVersion)) return unavailable();
    const result = frozenEncrypted({ envelopeVersion: 1, payloadVersion: 1, templateVersion: 1,
      encryptionKeyVersion: parsed.keyVersion, nonce: base64(parsed.nonce, 12, 12),
      ciphertext: base64(parsed.ciphertext, 1, 512), authenticationTag: base64(parsed.tag, 16, 16) });
    // Re-serialization rejects duplicate members, order/escape/whitespace/BOM variants.
    if (serializeEvery8dSettingsEmailOutboxEnvelope(result) !== raw) return unavailable();
    return result;
  } catch { return unavailable(); }
}

export function encryptEvery8dSettingsEmailOutboxPayload(
  input: Omit<Every8dSettingsEmailOutboxContext, "encryptionKeyVersion">,
  payload: Every8dSettingsEmailOutboxPayload,
  config: Every8dSettingsEmailOutboxEncryptionConfig
): Every8dSettingsEmailOutboxEncryptedPayload {
  let key: Buffer | undefined, plaintext: Buffer | undefined;
  try {
    if (!exact(input, ["jobId", "challengeId", "requestTokenHash", "purpose", "envelopeVersion", "payloadVersion", "templateVersion"])) return unavailable();
    const version = config.activeKeyVersion;
    const aad = encodeEvery8dSettingsEmailOutboxAad({ ...input, encryptionKeyVersion: version });
    key = config.keys.get(version);
    if (!Buffer.isBuffer(key) || key.length !== 32) return unavailable();
    key = Buffer.from(key);
    plaintext = Buffer.from(payloadText(payload), "utf8");
    // Production entropy is exclusively internal. There is no nonce parameter or test hook.
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const result = frozenEncrypted({ envelopeVersion: 1, payloadVersion: 1, templateVersion: 1,
      encryptionKeyVersion: version, nonce, ciphertext, authenticationTag: cipher.getAuthTag() });
    serializeEvery8dSettingsEmailOutboxEnvelope(result);
    return result;
  } catch { return unavailable(); }
  finally { key?.fill(0); plaintext?.fill(0); }
}

export function decryptClaimedPayload(
  receipt: Every8dSettingsEmailOutboxClaimReceipt,
  encryptionKeyring: Every8dSettingsAuthHmacKeyring
): Every8dSettingsEmailOutboxPayload {
  let key: Buffer | undefined, chunk: Buffer | undefined, tail: Buffer | undefined, plaintext: Buffer | undefined;
  let canonicalPlaintext: Buffer | undefined;
  try {
    const claim = readValidatedEvery8dSettingsEmailOutboxClaim(receipt);
    if (!claim) return unavailable();
    const envelope = { envelopeVersion: claim.envelopeVersion, payloadVersion: claim.payloadVersion,
      templateVersion: claim.templateVersion, encryptionKeyVersion: claim.encryptionKeyVersion,
      nonce: claim.nonce, ciphertext: claim.ciphertext, authenticationTag: claim.authenticationTag };
    binaryEnvelope(envelope);
    const aad = encodeEvery8dSettingsEmailOutboxAad({ jobId: claim.jobId, challengeId: claim.challengeId,
      requestTokenHash: claim.requestTokenHash, purpose: claim.purpose, envelopeVersion: claim.envelopeVersion,
      payloadVersion: claim.payloadVersion, templateVersion: claim.templateVersion, encryptionKeyVersion: claim.encryptionKeyVersion });
    key = encryptionKeyring.get(claim.encryptionKeyVersion);
    if (!Buffer.isBuffer(key) || key.length !== 32) return unavailable();
    key = Buffer.from(key);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, envelope.nonce, { authTagLength: 16 });
    decipher.setAAD(aad); decipher.setAuthTag(envelope.authenticationTag);
    chunk = decipher.update(envelope.ciphertext);
    tail = decipher.final(); // Authentication must succeed before decode/parse/release.
    plaintext = Buffer.concat([chunk, tail]);
    if (plaintext.length < 1 || plaintext.length > 512) return unavailable();
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    const parsed: unknown = JSON.parse(raw);
    if (!exact(parsed, ["v", "recipient", "displayOtp"]) || parsed.v !== 1 ||
      typeof parsed.recipient !== "string" || typeof parsed.displayOtp !== "string") return unavailable();
    const result = { recipient: parsed.recipient, displayOtp: parsed.displayOtp };
    canonicalPlaintext = Buffer.from(payloadText(result), "utf8");
    // Canonicality belongs to the original authenticated bytes, even if the
    // strict decoder omitted a BOM or JSON parsing normalized a representation.
    if (!plaintext.equals(canonicalPlaintext)) return unavailable();
    return Object.freeze(result);
  } catch { return unavailable(); }
  finally { key?.fill(0); chunk?.fill(0); tail?.fill(0); plaintext?.fill(0); canonicalPlaintext?.fill(0); }
}

export function every8dSettingsEmailProviderIdempotencyKey(jobId: unknown): string {
  if (typeof jobId !== "string" || jobId.length !== 36 || !jobPattern.test(jobId)) return unavailable();
  const value = `wincrm-c3c3-email-v1:${jobId}`;
  if (Buffer.byteLength(value, "ascii") !== 57) return unavailable();
  return value;
}
