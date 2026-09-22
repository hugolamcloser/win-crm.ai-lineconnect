const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  verifyEd25519Signature,
  verifyGhlEd25519Signature,
  verifyGhlWebhookSignature
} = require("../dist/middleware/ghlWebhookSignature");

test("canonical Ed25519 Base64 signatures verify without changing signed bytes", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const rawBody = Buffer.from('{"type":"INSTALL","appId":"synthetic"}', "utf8");
  const signature = crypto.sign(null, rawBody, privateKey).toString("base64");

  assert.equal(verifyEd25519Signature({ rawBody, signature, publicKey }), true);
  assert.equal(verifyEd25519Signature({ rawBody, signature: `sha256=${signature}`, publicKey }), true);
  assert.equal(verifyEd25519Signature({ rawBody: Buffer.from(`${rawBody}x`), signature, publicKey }), false);
});

test("Ed25519 decoder rejects illegal characters, whitespace, padding, and wrong length", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const rawBody = Buffer.from("synthetic-raw-body", "utf8");
  const signature = crypto.sign(null, rawBody, privateKey).toString("base64");
  const wrongLength = Buffer.alloc(63, 0x41).toString("base64");

  for (const malformed of [
    `${signature.slice(0, 8)}!!${signature.slice(8)}`,
    ` ${signature}`,
    `${signature}\n`,
    signature.replace(/==$/, ""),
    `${signature}=`,
    wrongLength
  ]) {
    assert.equal(verifyEd25519Signature({ rawBody, signature: malformed, publicKey }), false, malformed);
  }
});

test("production wrappers fail closed for missing and malformed signatures while legacy selection remains available", () => {
  const rawBody = Buffer.from("synthetic-raw-body", "utf8");

  assert.equal(verifyGhlEd25519Signature({ rawBody }), false);
  assert.equal(verifyGhlEd25519Signature({ rawBody, ghlSignature: "AQ!!ID" }), false);
  assert.equal(verifyGhlWebhookSignature({ rawBody, ghlSignature: "AQ!!ID" }), false);
  assert.equal(verifyGhlWebhookSignature({ rawBody, legacySignature: "malformed" }), false);
});
