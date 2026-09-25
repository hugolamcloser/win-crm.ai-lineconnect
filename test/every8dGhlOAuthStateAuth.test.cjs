const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { getEvery8dGhlOAuthConfigFingerprint } = require("../dist/config/every8dGhlOAuth");
const { createEvery8dPublicOAuthState, verifyEvery8dPublicOAuthState } = require("../dist/services/every8dGhlOAuthStateAuth");
const { parseEvery8dGhlOAuthEncryptionKeys } = require("../dist/services/every8dGhlTokenEncryption");

const now = Date.parse("2026-09-23T12:00:00Z");
const rawKey = Buffer.alloc(32, 0x61);
function config(overrides = {}) { return {
  enabled: true, marketplaceAppId: "app-98", oauthClientId: "client-98", oauthClientSecret: "secret",
  redirectUri: "https://oauth.example.invalid/oauth/every8d-connect/callback",
  installationUrl: "https://app.gohighlevel.com/v2/location/location-98/integration/app-98/versions/version-98",
  installationUrlSha256: "a".repeat(64), marketplaceVersionId: "version-98", expectedLocationId: "location-98",
  tokenUrl: "https://services.leadconnectorhq.com/oauth/token", conversationProviderId: "provider-98",
  requiredScopes: ["locations.readonly"], stateTtlSeconds: 600, activeKeyVersion: "key-v1",
  encryptionKeys: parseEvery8dGhlOAuthEncryptionKeys(JSON.stringify({ "key-v1": rawKey.toString("base64") })), ...overrides
}; }
function make(c = config(), at = now) {
  const fingerprint = getEvery8dGhlOAuthConfigFingerprint(c);
  const created = createEvery8dPublicOAuthState({ config: c, configFingerprint: fingerprint,
    nonce: Buffer.alloc(32, 0x31), browserBindingHash: "b".repeat(64), now: at });
  return { ...created, fingerprint, config: c };
}
function resign(payload, raw = JSON.stringify(payload)) {
  const encoded = Buffer.from(raw).toString("base64url");
  const key = Buffer.from(crypto.hkdfSync("sha256", rawKey, Buffer.alloc(0), "wincrm/every8d/oauth-state-auth/v1", 32));
  const mac = crypto.createHmac("sha256", key).update(encoded, "ascii").digest("base64url");
  return `${encoded}.${mac}`;
}
function verify(created, overrides = {}) {
  return verifyEvery8dPublicOAuthState({ state: created.state, browserBindingHash: "b".repeat(64),
    config: created.config, configFingerprint: created.fingerprint, now, ...overrides });
}

test("state uses a strict canonical versioned HMAC envelope and round trips", () => {
  const created = make();
  assert.equal(verify(created).expectedLocationId, "location-98");
  assert.equal(created.state.includes("="), false);
});

test("state rejects wrong HMAC, tampered payload, malformed base64url, and noncanonical payload", () => {
  const created = make();
  const [payload, mac] = created.state.split(".");
  assert.throws(() => verify({ ...created, state: `${payload}.${mac.slice(0, -1)}A` }));
  assert.throws(() => verify({ ...created, state: `${payload.slice(0, -1)}A.${mac}` }));
  assert.throws(() => verify({ ...created, state: "%%%.." }));
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.throws(() => verify({ ...created, state: resign(decoded, ` ${JSON.stringify(decoded)}`) }));
});

for (const [name, mutate] of [
  ["wrong key version", (p) => { p.keyVersion = "unknown"; }],
  ["wrong purpose", (p) => { p.purpose = "wrong"; }],
  ["unknown field", (p) => { p.extra = true; }],
  ["expired", (p) => { p.issuedAt -= 601; p.expiresAt -= 601; }],
  ["future iat", (p) => { p.issuedAt += 1; p.expiresAt += 1; }],
  ["redirect drift", (p) => { p.redirectUri = "https://oauth.example.invalid/other"; }],
  ["expected Location drift", (p) => { p.expectedLocationId = "location-99"; }],
  ["fingerprint drift", (p) => { p.configFingerprint = "c".repeat(64); }]
]) test(`state rejects ${name}`, () => {
  const created = make(); const payload = structuredClone(created.payload); mutate(payload);
  assert.throws(() => verify({ ...created, state: resign(payload) }));
});

test("state rejects wrong browser binding and live configuration drift", () => {
  const created = make();
  assert.throws(() => verify(created, { browserBindingHash: "d".repeat(64) }));
  const drift = config({ expectedLocationId: "location-99" });
  assert.throws(() => verify(created, { config: drift, configFingerprint: getEvery8dGhlOAuthConfigFingerprint(drift) }));
});
