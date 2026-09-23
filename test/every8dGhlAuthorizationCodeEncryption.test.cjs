const assert = require("node:assert/strict");
const test = require("node:test");

const {
  decryptEvery8dAuthorizationCode,
  encryptEvery8dAuthorizationCode
} = require("../dist/services/every8dGhlAuthorizationCodeEncryption");
const { parseEvery8dGhlOAuthEncryptionKeys } = require("../dist/services/every8dGhlTokenEncryption");

const keys = parseEvery8dGhlOAuthEncryptionKeys(JSON.stringify({
  "code-v1": Buffer.alloc(32, 0x61).toString("base64"),
  "code-v2": Buffer.alloc(32, 0x62).toString("base64")
}));
const context = {
  bootstrapId: "20000000-0000-4000-8000-000000000098",
  appNamespace: "every8d_connect",
  stateHash: "a".repeat(64),
  redirectUri: "https://oauth.example.invalid/oauth/every8d-connect/callback",
  configFingerprint: "b".repeat(64)
};

test("authorization code uses a distinct pending_authorization_code envelope and exact AAD", () => {
  const encrypted = encryptEvery8dAuthorizationCode({
    plaintext: "authorization-code-sensitive", activeKeyVersion: "code-v1", keys, context
  });
  assert.equal(encrypted.ciphertext.includes("authorization-code-sensitive"), false);
  const envelope = JSON.parse(Buffer.from(encrypted.ciphertext, "base64url").toString("utf8"));
  assert.equal(envelope.purpose, "pending_authorization_code");
  assert.equal(envelope.version, 1);
  assert.equal(decryptEvery8dAuthorizationCode({
    ciphertext: encrypted.ciphertext, expectedKeyVersion: "code-v1", keys, context
  }), "authorization-code-sensitive");
});

for (const [name, change] of [
  ["bootstrap", { bootstrapId: "foreign-bootstrap" }],
  ["app namespace", { appNamespace: "foreign" }],
  ["state hash", { stateHash: "c".repeat(64) }],
  ["redirect URI", { redirectUri: "https://oauth.example.invalid/other" }],
  ["config fingerprint", { configFingerprint: "d".repeat(64) }]
]) {
  test(`authorization-code decryption fails with wrong ${name} AAD`, () => {
    const encrypted = encryptEvery8dAuthorizationCode({
      plaintext: "authorization-code-sensitive", activeKeyVersion: "code-v1", keys, context
    });
    assert.throws(() => decryptEvery8dAuthorizationCode({
      ciphertext: encrypted.ciphertext, expectedKeyVersion: "code-v1", keys,
      context: { ...context, ...change }
    }), /decryption|encryption failed/);
  });
}

test("authorization-code decryption rejects wrong key version and tampering", () => {
  const encrypted = encryptEvery8dAuthorizationCode({
    plaintext: "authorization-code-sensitive", activeKeyVersion: "code-v1", keys, context
  });
  assert.throws(() => decryptEvery8dAuthorizationCode({
    ciphertext: encrypted.ciphertext, expectedKeyVersion: "code-v2", keys, context
  }));
  const envelope = JSON.parse(Buffer.from(encrypted.ciphertext, "base64url").toString("utf8"));
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${envelope.ciphertext.endsWith("A") ? "B" : "A"}`;
  const tampered = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  assert.throws(() => decryptEvery8dAuthorizationCode({
    ciphertext: tampered, expectedKeyVersion: "code-v1", keys, context
  }));
});
