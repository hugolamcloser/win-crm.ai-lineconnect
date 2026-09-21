const assert = require("node:assert/strict");
const test = require("node:test");

const {
  decryptEvery8dGhlOAuthToken,
  encryptEvery8dGhlOAuthToken,
  parseEvery8dGhlOAuthEncryptionKeys
} = require("../dist/services/every8dGhlTokenEncryption");

const context = {
  installationId: "10000000-0000-4000-8000-000000000098",
  installationGeneration: 7,
  marketplaceAppId: "every8d-app",
  oauthClientId: "every8d-client",
  tenantId: "00000000-0000-4000-8000-000000000098",
  locationId: "location-98",
  purpose: "access_token"
};
const keyV1 = Buffer.alloc(32, 0x11).toString("base64");
const keyV2 = Buffer.alloc(32, 0x22).toString("base64");

function keys() {
  return parseEvery8dGhlOAuthEncryptionKeys(JSON.stringify({ v1: keyV1, v2: keyV2 }));
}

test("AES-256-GCM token encryption round trips with installation-bound AAD", () => {
  const encrypted = encryptEvery8dGhlOAuthToken({
    plaintext: "synthetic-access-token",
    activeKeyVersion: "v2",
    keys: keys(),
    context
  });

  assert.equal(encrypted.keyVersion, "v2");
  assert.equal(encrypted.ciphertext.includes("synthetic-access-token"), false);
  assert.equal(
    decryptEvery8dGhlOAuthToken({
      ciphertext: encrypted.ciphertext,
      expectedKeyVersion: "v2",
      keys: keys(),
      context
    }),
    "synthetic-access-token"
  );
});

test("token decryption rejects wrong key version, key, AAD, tag, and ciphertext", () => {
  const encrypted = encryptEvery8dGhlOAuthToken({
    plaintext: "synthetic-refresh-token",
    activeKeyVersion: "v1",
    keys: keys(),
    context: { ...context, purpose: "refresh_token" }
  });

  assert.throws(() => decryptEvery8dGhlOAuthToken({
    ciphertext: encrypted.ciphertext,
    expectedKeyVersion: "v2",
    keys: keys(),
    context: { ...context, purpose: "refresh_token" }
  }), /OAuth token decryption failed/);

  const wrongKeys = parseEvery8dGhlOAuthEncryptionKeys(
    JSON.stringify({ v1: Buffer.alloc(32, 0x33).toString("base64") })
  );
  assert.throws(() => decryptEvery8dGhlOAuthToken({
    ciphertext: encrypted.ciphertext,
    expectedKeyVersion: "v1",
    keys: wrongKeys,
    context: { ...context, purpose: "refresh_token" }
  }), /OAuth token decryption failed/);

  assert.throws(() => decryptEvery8dGhlOAuthToken({
    ciphertext: encrypted.ciphertext,
    expectedKeyVersion: "v1",
    keys: keys(),
    context: { ...context, tenantId: "00000000-0000-4000-8000-000000000099", purpose: "refresh_token" }
  }), /OAuth token decryption failed/);

  const envelope = JSON.parse(Buffer.from(encrypted.ciphertext, "base64url").toString("utf8"));
  const modifiedTag = Buffer.from(envelope.tag, "base64url");
  modifiedTag[0] ^= 0xff;
  const tamperedTag = Buffer.from(JSON.stringify({ ...envelope, tag: modifiedTag.toString("base64url") })).toString("base64url");
  assert.throws(() => decryptEvery8dGhlOAuthToken({
    ciphertext: tamperedTag,
    expectedKeyVersion: "v1",
    keys: keys(),
    context: { ...context, purpose: "refresh_token" }
  }), /OAuth token decryption failed/);

  const modifiedCiphertext = Buffer.from(envelope.ciphertext, "base64url");
  modifiedCiphertext[0] ^= 0xff;
  const tamperedCiphertext = Buffer.from(JSON.stringify({
    ...envelope,
    ciphertext: modifiedCiphertext.toString("base64url")
  })).toString("base64url");
  assert.throws(() => decryptEvery8dGhlOAuthToken({
    ciphertext: tamperedCiphertext,
    expectedKeyVersion: "v1",
    keys: keys(),
    context: { ...context, purpose: "refresh_token" }
  }), /OAuth token decryption failed/);
});

test("encryption key parsing rejects malformed and non-32-byte keys without exposing values", () => {
  for (const value of ["not-json", "[]", JSON.stringify({ v1: "bad" })]) {
    assert.throws(
      () => parseEvery8dGhlOAuthEncryptionKeys(value),
      (error) => {
        assert.equal(error.message, "EVERY8D HighLevel OAuth encryption key configuration is invalid");
        assert.equal(error.message.includes(value), false);
        return true;
      }
    );
  }
});
