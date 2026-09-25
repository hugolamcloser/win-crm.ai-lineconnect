import crypto from "node:crypto";
import type { Every8dGhlOAuthEncryptionKeys } from "./every8dGhlTokenEncryption";

const algorithm = "aes-256-gcm";
const envelopeVersion = 1;
const ivLength = 12;
const tagLength = 16;
const keyVersionPattern = /^[A-Za-z0-9_.-]{1,128}$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const envelopeKeys = ["version", "purpose", "keyVersion", "iv", "ciphertext", "tag"] as const;
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export type Every8dAuthorizationCodeContext = {
  appNamespace: "every8d_connect";
  stateHash: string;
  marketplaceVersionId: string;
  redirectUri: string;
  configFingerprint: string;
  expectedLocationId: string;
};

type Envelope = {
  version: 1;
  purpose: "pending_authorization_code";
  keyVersion: string;
  iv: string;
  ciphertext: string;
  tag: string;
};

function encryptionError(): Error {
  return new Error("EVERY8D pending authorization code encryption failed");
}

function aad(context: Every8dAuthorizationCodeContext): Buffer {
  if (
    context.appNamespace !== "every8d_connect" ||
    !/^[0-9a-f]{64}$/.test(context.stateHash) ||
    !/^[0-9a-f]{64}$/.test(context.configFingerprint) ||
    !/^[A-Za-z0-9_.-]{1,256}$/.test(context.marketplaceVersionId) ||
    !/^[A-Za-z0-9_.-]{1,256}$/.test(context.expectedLocationId)
  ) {
    throw encryptionError();
  }

  return Buffer.from(JSON.stringify({
    envelopeVersion,
    purpose: "pending_authorization_code",
    appNamespace: context.appNamespace,
    stateHash: context.stateHash,
    marketplaceVersionId: context.marketplaceVersionId,
    redirectUri: context.redirectUri,
    configFingerprint: context.configFingerprint,
    expectedLocationId: context.expectedLocationId
  }), "utf8");
}

function decode(value: string): Buffer {
  if (!value || !base64UrlPattern.test(value) || value.length % 4 === 1) {
    throw encryptionError();
  }
  const decoded = Buffer.from(value, "base64url");
  if (!decoded.length || decoded.toString("base64url") !== value) throw encryptionError();
  return decoded;
}

function parseEnvelope(value: string): Envelope {
  try {
    const decodedEnvelope = decode(value);
    const decodedJson = fatalUtf8Decoder.decode(decodedEnvelope);
    const parsed = JSON.parse(decodedJson) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.getPrototypeOf(parsed) !== Object.prototype ||
      Object.keys(parsed).length !== envelopeKeys.length ||
      !envelopeKeys.every((key) => Object.prototype.hasOwnProperty.call(parsed, key))
    ) {
      throw encryptionError();
    }
    const candidate = parsed as Partial<Envelope>;
    if (
      candidate.version !== envelopeVersion ||
      candidate.purpose !== "pending_authorization_code" ||
      typeof candidate.keyVersion !== "string" ||
      !keyVersionPattern.test(candidate.keyVersion) ||
      typeof candidate.iv !== "string" ||
      typeof candidate.ciphertext !== "string" ||
      typeof candidate.tag !== "string"
    ) {
      throw encryptionError();
    }
    if (decode(candidate.iv).length !== ivLength || decode(candidate.tag).length !== tagLength) {
      throw encryptionError();
    }
    decode(candidate.ciphertext);
    const canonical: Envelope = {
      version: envelopeVersion,
      purpose: "pending_authorization_code",
      keyVersion: candidate.keyVersion,
      iv: candidate.iv,
      ciphertext: candidate.ciphertext,
      tag: candidate.tag
    };
    if (!decodedEnvelope.equals(Buffer.from(JSON.stringify(canonical), "utf8"))) {
      throw encryptionError();
    }
    return canonical;
  } catch {
    throw encryptionError();
  }
}

export function encryptEvery8dAuthorizationCode(input: {
  plaintext: string;
  activeKeyVersion: string;
  keys: Every8dGhlOAuthEncryptionKeys;
  context: Every8dAuthorizationCodeContext;
}): { keyVersion: string; ciphertext: string } {
  const key = input.keys.get(input.activeKeyVersion);
  if (!key || !input.plaintext || !keyVersionPattern.test(input.activeKeyVersion)) {
    throw encryptionError();
  }

  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(algorithm, key, iv, { authTagLength: tagLength });
  cipher.setAAD(aad(input.context));
  const encrypted = Buffer.concat([cipher.update(input.plaintext, "utf8"), cipher.final()]);
  const envelope: Envelope = {
    version: envelopeVersion,
    purpose: "pending_authorization_code",
    keyVersion: input.activeKeyVersion,
    iv: iv.toString("base64url"),
    ciphertext: encrypted.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url")
  };
  return {
    keyVersion: input.activeKeyVersion,
    ciphertext: Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")
  };
}

export function decryptEvery8dAuthorizationCode(input: {
  ciphertext: string;
  expectedKeyVersion: string;
  keys: Every8dGhlOAuthEncryptionKeys;
  context: Every8dAuthorizationCodeContext;
}): string {
  try {
    const envelope = parseEnvelope(input.ciphertext);
    if (envelope.keyVersion !== input.expectedKeyVersion) throw encryptionError();
    const key = input.keys.get(envelope.keyVersion);
    if (!key) throw encryptionError();
    const decipher = crypto.createDecipheriv(algorithm, key, decode(envelope.iv), {
      authTagLength: tagLength
    });
    decipher.setAAD(aad(input.context));
    decipher.setAuthTag(decode(envelope.tag));
    const plaintext = Buffer.concat([
      decipher.update(decode(envelope.ciphertext)),
      decipher.final()
    ]).toString("utf8");
    if (!plaintext) throw encryptionError();
    return plaintext;
  } catch {
    throw encryptionError();
  }
}
