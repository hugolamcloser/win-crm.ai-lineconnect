import crypto from "node:crypto";

const ghlEd25519PublicKey = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

const ghlLegacyRsaPublicKey = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpv
uxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF
3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKU
J062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXp
IocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzN
h/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhC
HULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJ
PQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAyk
T1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

function decodeSignature(signature: string): Buffer {
  return Buffer.from(signature.replace(/^sha256=/i, "").trim(), "base64");
}

function decodeCanonicalEd25519Signature(signature: string): Buffer {
  if (signature !== signature.trim()) {
    throw new Error("Invalid Ed25519 signature encoding");
  }

  const encoded = signature.replace(/^sha256=/i, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("Invalid Ed25519 signature encoding");
  }

  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== encoded) {
    throw new Error("Invalid Ed25519 signature encoding");
  }

  return decoded;
}

export function verifyEd25519Signature(input: {
  rawBody: Buffer;
  signature: string;
  publicKey: crypto.KeyLike;
}): boolean {
  try {
    return crypto.verify(
      null,
      input.rawBody,
      input.publicKey,
      decodeCanonicalEd25519Signature(input.signature)
    );
  } catch {
    return false;
  }
}

export function verifyGhlEd25519Signature(input: {
  rawBody: Buffer;
  ghlSignature?: string;
}): boolean {
  try {
    if (!input.ghlSignature || input.ghlSignature === "N/A") {
      return false;
    }

    return verifyEd25519Signature({
      rawBody: input.rawBody,
      signature: input.ghlSignature,
      publicKey: ghlEd25519PublicKey
    });
  } catch {
    return false;
  }
}

export function verifyGhlWebhookSignature(input: {
  rawBody: Buffer;
  ghlSignature?: string;
  legacySignature?: string;
}): boolean {
  try {
    if (input.ghlSignature && input.ghlSignature !== "N/A") {
      return verifyGhlEd25519Signature(input);
    }

    if (input.legacySignature && input.legacySignature !== "N/A") {
      const verifier = crypto.createVerify("SHA256");
      verifier.update(input.rawBody);
      verifier.end();
      return verifier.verify(ghlLegacyRsaPublicKey, decodeSignature(input.legacySignature));
    }
  } catch {
    return false;
  }

  return false;
}
