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
  companyId: "company-98",
  purpose: "access_token"
};
const keyV1 = Buffer.alloc(32, 0x11).toString("base64");
const keyV2 = Buffer.alloc(32, 0x22).toString("base64");

function keys() {
  return parseEvery8dGhlOAuthEncryptionKeys(JSON.stringify({ v1: keyV1, v2: keyV2 }));
}

function encodeEnvelope(envelope) {
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

function decrypt(ciphertext, overrides = {}) {
  return decryptEvery8dGhlOAuthToken({
    ciphertext,
    expectedKeyVersion: "v2",
    keys: keys(),
    context,
    ...overrides
  });
}

function insertAfterFirstCharacter(value, inserted) {
  return `${value.slice(0, 1)}${inserted}${value.slice(1)}`;
}

const malformedBase64UrlCases = [
  ["appended illegal character", (value) => `${value}!`],
  ["prepended illegal character", (value) => `!${value}`],
  ["embedded whitespace", (value) => insertAfterFirstCharacter(value, " ")],
  ["embedded tab", (value) => insertAfterFirstCharacter(value, "\t")],
  ["embedded carriage return", (value) => insertAfterFirstCharacter(value, "\r")],
  ["embedded line feed", (value) => insertAfterFirstCharacter(value, "\n")],
  ["trailing whitespace", (value) => `${value} `],
  ["padding", (value) => `${value}=`],
  ["standard Base64 plus", (value) => `${value}+`],
  ["standard Base64 slash", (value) => `${value}/`],
  ["impossible length", () => "A"]
];

test("AES-256-GCM token encryption round trips with installation-bound AAD", () => {
  const encrypted = encryptEvery8dGhlOAuthToken({
    plaintext: "synthetic-access-token",
    activeKeyVersion: "v2",
    keys: keys(),
    context
  });

  assert.equal(encrypted.keyVersion, "v2");
  assert.equal(encrypted.ciphertext.includes("synthetic-access-token"), false);
  assert.match(encrypted.ciphertext, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(encrypted.ciphertext.length % 4, 1);

  const envelope = JSON.parse(Buffer.from(encrypted.ciphertext, "base64url").toString("utf8"));
  assert.equal(envelope.version, 2);
  for (const field of ["iv", "tag", "ciphertext"]) {
    assert.match(envelope[field], /^[A-Za-z0-9_-]+$/);
    assert.notEqual(envelope[field].length % 4, 1);
    assert.equal(Buffer.from(envelope[field], "base64url").toString("base64url"), envelope[field]);
  }

  assert.equal(
    decrypt(encrypted.ciphertext),
    "synthetic-access-token"
  );
});

test("token decryption rejects malformed outer Base64URL encodings", () => {
  const encrypted = encryptEvery8dGhlOAuthToken({
    plaintext: "synthetic-access-token",
    activeKeyVersion: "v2",
    keys: keys(),
    context
  });

  for (const [description, mutate] of malformedBase64UrlCases) {
    assert.throws(
      () => decrypt(mutate(encrypted.ciphertext)),
      /OAuth token decryption failed/,
      description
    );
  }
});

test("token decryption independently rejects malformed IV, tag, and ciphertext Base64URL encodings", () => {
  const encrypted = encryptEvery8dGhlOAuthToken({
    plaintext: "synthetic-access-token",
    activeKeyVersion: "v2",
    keys: keys(),
    context
  });
  const envelope = JSON.parse(Buffer.from(encrypted.ciphertext, "base64url").toString("utf8"));

  for (const field of ["iv", "tag", "ciphertext"]) {
    for (const [description, mutate] of malformedBase64UrlCases) {
      const malformedEnvelope = encodeEnvelope({
        ...envelope,
        [field]: mutate(envelope[field])
      });
      assert.throws(
        () => decrypt(malformedEnvelope),
        /OAuth token decryption failed/,
        `${field}: ${description}`
      );
    }
  }
});

test("token decryption rejects malformed envelopes and unknown key versions", () => {
  const encrypted = encryptEvery8dGhlOAuthToken({
    plaintext: "synthetic-access-token",
    activeKeyVersion: "v2",
    keys: keys(),
    context
  });
  const envelope = JSON.parse(Buffer.from(encrypted.ciphertext, "base64url").toString("utf8"));

  assert.throws(
    () => decrypt(encodeEnvelope({ ...envelope, iv: undefined })),
    /OAuth token decryption failed/
  );
  assert.throws(
    () => decrypt(encodeEnvelope({ ...envelope, keyVersion: "unknown" }), { expectedKeyVersion: "unknown" }),
    /OAuth token decryption failed/
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

  assert.throws(() => decryptEvery8dGhlOAuthToken({
    ciphertext: encrypted.ciphertext,
    expectedKeyVersion: "v1",
    keys: keys(),
    context: { ...context, companyId: "company-foreign", purpose: "refresh_token" }
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
