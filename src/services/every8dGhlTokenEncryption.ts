import crypto from "node:crypto";

const encryptionAlgorithm = "aes-256-gcm";
const envelopeVersion = 1;
const ivLength = 12;
const tagLength = 16;
const keyVersionPattern = /^[A-Za-z0-9_.-]{1,128}$/;

export type Every8dGhlOAuthEncryptionKeys = ReadonlyMap<string, Buffer>;

export type Every8dGhlOAuthTokenContext = {
  installationId: string;
  installationGeneration: number;
  marketplaceAppId: string;
  oauthClientId: string;
  tenantId: string;
  locationId: string;
  purpose: "access_token" | "refresh_token";
};

type EncryptionEnvelope = {
  version: 1;
  keyVersion: string;
  iv: string;
  ciphertext: string;
  tag: string;
};

function configurationError(): Error {
  return new Error("EVERY8D HighLevel OAuth encryption key configuration is invalid");
}

function decryptionError(): Error {
  return new Error("EVERY8D HighLevel OAuth token decryption failed");
}

function decodeBase64(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");

  if (decoded.length === 0 || decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw configurationError();
  }

  return decoded;
}

export function parseEvery8dGhlOAuthEncryptionKeys(value: string): Every8dGhlOAuthEncryptionKeys {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw configurationError();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw configurationError();
  }

  const entries = Object.entries(parsed as Record<string, unknown>);

  if (entries.length === 0) {
    throw configurationError();
  }

  const keys = new Map<string, Buffer>();

  try {
    for (const [version, encodedKey] of entries) {
      if (!keyVersionPattern.test(version) || typeof encodedKey !== "string") {
        throw configurationError();
      }

      const key = decodeBase64(encodedKey);

      if (key.length !== 32) {
        throw configurationError();
      }

      keys.set(version, key);
    }
  } catch {
    throw configurationError();
  }

  return keys;
}

function buildAad(context: Every8dGhlOAuthTokenContext): Buffer {
  if (!Number.isSafeInteger(context.installationGeneration) || context.installationGeneration <= 0) {
    throw decryptionError();
  }

  return Buffer.from(JSON.stringify({
    version: envelopeVersion,
    installationId: context.installationId,
    installationGeneration: context.installationGeneration,
    marketplaceAppId: context.marketplaceAppId,
    oauthClientId: context.oauthClientId,
    tenantId: context.tenantId,
    locationId: context.locationId,
    purpose: context.purpose
  }), "utf8");
}

function encodeEnvelope(envelope: EncryptionEnvelope): string {
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

function parseEnvelope(value: string): EncryptionEnvelope {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<EncryptionEnvelope>;

    if (
      parsed.version !== envelopeVersion ||
      typeof parsed.keyVersion !== "string" ||
      !keyVersionPattern.test(parsed.keyVersion) ||
      typeof parsed.iv !== "string" ||
      typeof parsed.ciphertext !== "string" ||
      !parsed.ciphertext ||
      typeof parsed.tag !== "string"
    ) {
      throw decryptionError();
    }

    const iv = Buffer.from(parsed.iv, "base64url");
    const tag = Buffer.from(parsed.tag, "base64url");

    if (iv.length !== ivLength || tag.length !== tagLength) {
      throw decryptionError();
    }

    return parsed as EncryptionEnvelope;
  } catch {
    throw decryptionError();
  }
}

export function encryptEvery8dGhlOAuthToken(input: {
  plaintext: string;
  activeKeyVersion: string;
  keys: Every8dGhlOAuthEncryptionKeys;
  context: Every8dGhlOAuthTokenContext;
}): { keyVersion: string; ciphertext: string } {
  const key = input.keys.get(input.activeKeyVersion);

  if (!key || !input.plaintext) {
    throw configurationError();
  }

  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(encryptionAlgorithm, key, iv, { authTagLength: tagLength });
  cipher.setAAD(buildAad(input.context));
  const ciphertext = Buffer.concat([cipher.update(input.plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    keyVersion: input.activeKeyVersion,
    ciphertext: encodeEnvelope({
      version: envelopeVersion,
      keyVersion: input.activeKeyVersion,
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: tag.toString("base64url")
    })
  };
}

export function decryptEvery8dGhlOAuthToken(input: {
  ciphertext: string;
  expectedKeyVersion: string;
  keys: Every8dGhlOAuthEncryptionKeys;
  context: Every8dGhlOAuthTokenContext;
}): string {
  try {
    const envelope = parseEnvelope(input.ciphertext);

    if (envelope.keyVersion !== input.expectedKeyVersion) {
      throw decryptionError();
    }

    const key = input.keys.get(envelope.keyVersion);

    if (!key) {
      throw decryptionError();
    }

    const decipher = crypto.createDecipheriv(
      encryptionAlgorithm,
      key,
      Buffer.from(envelope.iv, "base64url"),
      { authTagLength: tagLength }
    );
    decipher.setAAD(buildAad(input.context));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");

    if (!plaintext) {
      throw decryptionError();
    }

    return plaintext;
  } catch {
    throw decryptionError();
  }
}
