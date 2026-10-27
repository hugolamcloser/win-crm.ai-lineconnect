const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const C = require("../dist/services/every8dSettingsEmailOutboxCrypto");
const K = require("../dist/config/every8dSettingsEmailOutbox");
const A = require("../dist/config/every8dSettingsAuth");
const F = require("./helpers/every8dSettingsEmailOutboxFixtures.cjs");
const golden = require("./fixtures/every8dSettingsEmailOutboxAad.json");
const keyBytes = Buffer.alloc(32,7); // Synthetic test material only.
const encodedKey = keyBytes.toString("base64url");
const payload = Object.freeze({ recipient: "fixture@example.invalid", displayOtp: "2345-6789" });
function keys(entries = { enc: encodedKey }) { return K.parseEvery8dSettingsEmailOutboxKeyring(JSON.stringify(entries)); }
function config(entries) { return Object.freeze({ activeKeyVersion: "enc", keys: keys(entries) }); }
function encryption() { return C.encryptEvery8dSettingsEmailOutboxPayload(F.context(),payload,config()); }
function safeFailure(action) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof C.Every8dSettingsEmailPayloadUnavailableError, "uniform payload-unavailable type");
    assert.ok(error.message === "EVERY8D settings email payload unavailable", "uniform sanitized message");
    assert.ok(!Object.prototype.hasOwnProperty.call(error,"cause"), "no raw nested cause");
    return true;
  });
}
function configFailure(action) {
  assert.throws(action,(error)=>{
    assert.ok(error.message === "EVERY8D settings email outbox configuration is invalid" ||
      error.message === "EVERY8D settings auth configuration is incomplete or invalid", "sanitized configuration error");
    assert.ok(!Object.prototype.hasOwnProperty.call(error,"cause")); return true;
  });
}
function environment(extra = {}) { return {
  EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: "true", EVERY8D_SETTINGS_AUTH_HTTP_ENABLED: "true",
  EVERY8D_SETTINGS_AUTH_EMAIL_DISPATCH_ENABLED: "false",
  EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_ACTIVE_KEY_VERSION: "p1",
  EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_KEYS: JSON.stringify({ p1: Buffer.alloc(32,1).toString("base64url"), p0: Buffer.alloc(32,4).toString("base64url") }),
  EVERY8D_SETTINGS_OTP_HMAC_ACTIVE_KEY_VERSION: "o1",
  EVERY8D_SETTINGS_OTP_HMAC_KEYS: JSON.stringify({ o1: Buffer.alloc(32,2).toString("base64url"), o0: Buffer.alloc(32,5).toString("base64url") }),
  EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_ACTIVE_KEY_VERSION: "enc",
  EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_KEYS: JSON.stringify({ enc: encodedKey, historical: Buffer.alloc(32,6).toString("base64url") }),
  ...extra
}; }

// Test-only reference sealing. It is not exported or reachable from production APIs.
function sealTestBytes(bytes) {
  const nonce = Buffer.alloc(12,11);
  const aad = C.encodeEvery8dSettingsEmailOutboxAad({ ...F.context(), encryptionKeyVersion: "enc" });
  const cipher = crypto.createCipheriv("aes-256-gcm",keyBytes,nonce,{authTagLength:16});
  cipher.setAAD(aad);
  return { envelopeVersion:1,payloadVersion:1,templateVersion:1,encryptionKeyVersion:"enc",nonce,
    ciphertext:Buffer.concat([cipher.update(bytes),cipher.final()]),authenticationTag:cipher.getAuthTag() };
}

test("keyring accepts bounded canonical keys and defensively encapsulates buffers",()=>{
  const ring = keys(); const copy = ring.get("enc"); copy.fill(0);
  assert.ok(ring.get("enc").equals(keyBytes),"key buffer defensive copy");
  const versions = ring.versions(); versions.length=0;
  assert.ok(ring.has("enc") && ring.versions().length===1 && Object.isFrozen(ring));
  assert.ok(Object.getOwnPropertyNames(ring).length===0,"no key material in public properties");
});
for (const [index,version] of ["", "a".repeat(64)," spaced","spaced ","bad\n","bad:key","\u00e9"].entries()) {
  test(`keyring rejects strict version grammar case ${index}`,()=>configFailure(()=>keys({[version]:encodedKey})));
}
for (const version of ["A".repeat(63),"_.-","__proto__"]) {
  test("keyring accepts complete valid version grammar boundary",()=>assert.ok(keys({[version]:encodedKey}).has(version)));
}
const malformedKeyrings = ["", "{}", "[]", "null", "false", '{"enc":null}', '{"enc":{}}', '{"enc":1}',
  JSON.stringify({enc:"A".repeat(42)}),JSON.stringify({enc:"A".repeat(44)}),JSON.stringify({enc:encodedKey+"="}),
  JSON.stringify({enc:encodedKey.slice(0,-1)+"B"}),JSON.stringify({enc:"+".repeat(43)}),
  '{"enc":"'+encodedKey+'","enc":"'+encodedKey+'"}',
  '{"enc":"'+encodedKey+'","\\u0065nc":"'+encodedKey+'"}',
  JSON.stringify({enc:encodedKey})+" trailing",JSON.stringify({enc:encodedKey,other:encodedKey})];
for (const [index,raw] of malformedKeyrings.entries()) {
  test(`keyring rejects malformed/duplicate/noncanonical configuration ${index}`,()=>configFailure(()=>K.parseEvery8dSettingsEmailOutboxKeyring(raw)));
}
test("keyring enforces exact raw UTF8 size and entry-count boundaries",()=>{
  const raw = JSON.stringify({enc:encodedKey});
  assert.ok(K.parseEvery8dSettingsEmailOutboxKeyring(raw.padEnd(16384," ")).has("enc"));
  configFailure(()=>K.parseEvery8dSettingsEmailOutboxKeyring(raw.padEnd(16385," ")));
  const entries = Object.fromEntries(Array.from({length:64},(_,i)=>["v"+i,Buffer.alloc(32,i).toString("base64url")]));
  assert.ok(keys(entries).versions().length===64);
  entries.v64=Buffer.alloc(32,64).toString("base64url"); configFailure(()=>keys(entries));
});
test("optional outbox group remains dormant, supplied partial/invalid group fails with flags disabled",()=>{
  assert.ok(A.readEvery8dSettingsAuthConfig({}).emailOutboxEncryption===undefined);
  for (const extra of [
    { EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_ACTIVE_KEY_VERSION:"enc" },
    { EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_KEYS:JSON.stringify({enc:encodedKey}) },
    { EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_ACTIVE_KEY_VERSION:"missing",EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_KEYS:JSON.stringify({enc:encodedKey}) }
  ]) configFailure(()=>A.readEvery8dSettingsAuthConfig(extra));
  assert.ok(A.readEvery8dSettingsAuthConfig(environment()).emailOutboxEncryption.keys.has("historical"));
});
for (const value of [1,2,4,5]) {
  test("outbox group rejects reuse of every current/historical HMAC key",()=>{
    configFailure(()=>A.readEvery8dSettingsAuthConfig(environment({
      EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_KEYS:JSON.stringify({enc:Buffer.alloc(32,value).toString("base64url")})
    })));
  });
}
test("supplied outbox group also rejects cross-domain historical HMAC reuse",()=>{
  configFailure(()=>A.readEvery8dSettingsAuthConfig(environment({
    EVERY8D_SETTINGS_OTP_HMAC_KEYS:JSON.stringify({o1:Buffer.alloc(32,2).toString("base64url"),o0:Buffer.alloc(32,4).toString("base64url")})
  })));
});
for (const [index,vector] of golden.entries()) {
  test(`independent TypeScript AAD encoder equals binary-spec golden vector ${index}`,()=>{
    const {requestTokenHashHex,expectedHex,...context}=vector;
    const bytes=C.encodeEvery8dSettingsEmailOutboxAad({...context,requestTokenHash:Buffer.from(requestTokenHashHex,"hex")});
    assert.ok(bytes.toString("hex")===expectedHex,"binary AAD exact golden equality");
  });
}
test("production encryption owns fresh nonce entropy, exact tag, canonical envelope and defensive copies",()=>{
  const first=encryption(), second=encryption();
  assert.ok(first.nonce.length===12 && first.authenticationTag.length===16 && !first.nonce.equals(second.nonce));
  const serialized=C.serializeEvery8dSettingsEmailOutboxEnvelope(first);
  const decoded=C.parseEvery8dSettingsEmailOutboxEnvelope(serialized);
  assert.ok(C.serializeEvery8dSettingsEmailOutboxEnvelope(decoded)===serialized);
  first.nonce.fill(0); first.ciphertext.fill(0); first.authenticationTag.fill(0);
  assert.ok(C.serializeEvery8dSettingsEmailOutboxEnvelope(first)===serialized,"envelope buffers defensive copies");
  assert.ok(C.encryptEvery8dSettingsEmailOutboxPayload.length===3,"no runtime nonce injection parameter");
  safeFailure(()=>C.encryptEvery8dSettingsEmailOutboxPayload({...F.context(),nonce:Buffer.alloc(12)},payload,config()));
});
test("authenticated round trip releases only immutable canonical payload after a validated claim",async()=>{
  const {receipt,calls}=await F.parsedClaim(F.claimRow(encryption()));
  const result=C.decryptClaimedPayload(receipt,keys());
  assert.ok(result.recipient===payload.recipient && result.displayOtp===payload.displayOtp && Object.isFrozen(result));
  assert.ok(Object.keys(result).sort().join(",")==="displayOtp,recipient" && calls.length===1);
  safeFailure(()=>C.decryptClaimedPayload({...receipt},keys()));
});
for (const member of ["nonce","ciphertext","authenticationTag"]) {
  test(`GCM ${member} authentication failure never follows up the claim`,async()=>{
    const envelope={...encryption()}; envelope[member]=Buffer.from(envelope[member]); envelope[member][0]^=1;
    const {receipt,calls}=await F.parsedClaim(F.claimRow(envelope));
    safeFailure(()=>C.decryptClaimedPayload(receipt,keys()));
    assert.ok(calls.length===1 && calls[0].name==="runtime_claim_every8d_settings_auth_email_v1","no begin/finalize/provider follow-up");
  });
}
for (const [index,overrides] of [
  {job_id:F.OTHER},{challenge_id:"10000000-0000-4000-8000-000000000002"},
  {request_token_hash:F.bytea(Buffer.alloc(32,8))},{purpose:"login"},{encryption_key_version:"renamed"}
].entries()) {
  test(`AAD context substitution ${index} fails authentication`,async()=>{
    const {receipt,calls}=await F.parsedClaim(F.claimRow(encryption(),overrides));
    // A same-byte test-only key lookup isolates AAD binding from key-selection failure.
    safeFailure(()=>C.decryptClaimedPayload(receipt,{get:()=>Buffer.from(keyBytes)})); assert.equal(calls.length,1);
  });
}
test("wrong or missing historical key produces the same no-send failure",async()=>{
  const {receipt,calls}=await F.parsedClaim(F.claimRow(encryption()));
  safeFailure(()=>C.decryptClaimedPayload(receipt,keys({other:Buffer.alloc(32,8).toString("base64url")})));
  safeFailure(()=>C.decryptClaimedPayload(receipt,keys({enc:Buffer.alloc(32,9).toString("base64url")})));
  assert.equal(calls.length,1);
});
test("exact 57-byte idempotency key is stable across retries and distinct across jobs",()=>{
  const first=C.every8dSettingsEmailProviderIdempotencyKey(F.JOB);
  assert.ok(first==="wincrm-c3c3-email-v1:"+F.JOB && Buffer.byteLength(first,"ascii")===57);
  assert.ok(first===C.every8dSettingsEmailProviderIdempotencyKey(F.JOB));
  assert.ok(first!==C.every8dSettingsEmailProviderIdempotencyKey(F.OTHER));
  for (const value of [F.JOB.toUpperCase()," "+F.JOB,F.JOB+"\n",null,1]) {
    // This UUID vector contains only digits; uppercase identity needs an actual hex letter.
    if (value===F.JOB) continue;
    safeFailure(()=>C.every8dSettingsEmailProviderIdempotencyKey(value));
  }
  safeFailure(()=>C.every8dSettingsEmailProviderIdempotencyKey("ABCDEF00-0000-4000-8000-000000000001"));
});
test("canonical envelope rejects unknown/duplicate/alternate/malformed serializations",()=>{
  const raw=C.serializeEvery8dSettingsEmailOutboxEnvelope(encryption()), value=JSON.parse(raw);
  const bad=["\ufeff"+raw," "+raw,raw+"\n",raw.replace('{"v":1,','{"v":1,"v":1,'),
    JSON.stringify({...value,unknown:true}),JSON.stringify({...value,v:2}),JSON.stringify({...value,alg:"other"}),
    JSON.stringify({...value,nonce:value.nonce+"="}),JSON.stringify({...value,tag:value.tag+"="}),
    JSON.stringify({...value,ciphertext:""}),JSON.stringify({...value,nonce:"A".repeat(15)}),
    " ".repeat(1025),JSON.stringify({...value,ciphertext:Buffer.alloc(513).toString("base64url")})];
  for(const altered of bad) safeFailure(()=>C.parseEvery8dSettingsEmailOutboxEnvelope(altered));
});
const canonical=JSON.stringify({v:1,...payload});
const malformedPayloads=[" "+canonical,canonical+"\n",canonical.replace('{"v":1,','{"v":1,"v":1,'),
  JSON.stringify({...JSON.parse(canonical),unknown:true}),JSON.stringify({recipient:payload.recipient,v:1,displayOtp:payload.displayOtp}),
  JSON.stringify({v:2,...payload}),JSON.stringify({v:1,...payload,displayOtp:"invalid"}),
  JSON.stringify({v:1,...payload,recipient:" fixture@example.invalid"}),Buffer.from([0xc0,0xaf])];
for(const [index,raw] of malformedPayloads.entries()) {
  test(`authenticated noncanonical decrypted payload ${index} is rejected`,async()=>{
    const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw,"utf8");
    const {receipt,calls}=await F.parsedClaim(F.claimRow(sealTestBytes(bytes)));
    safeFailure(()=>C.decryptClaimedPayload(receipt,keys())); assert.equal(calls.length,1);
  });
}
test("authenticated UTF8 BOM prefix is rejected as noncanonical plaintext bytes",async()=>{
  const bytes=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(canonical,"utf8")]);
  const {receipt,calls}=await F.parsedClaim(F.claimRow(sealTestBytes(bytes)));
  safeFailure(()=>C.decryptClaimedPayload(receipt,keys())); assert.equal(calls.length,1);
});


for (const purpose of ["enrollment","login"]) {
  test(`exact canonical ${purpose} payload remains valid at the original-byte boundary`,async()=>{
    const context={...F.context(),purpose};
    const envelope=C.encryptEvery8dSettingsEmailOutboxPayload(context,payload,config());
    const {receipt,calls}=await F.parsedClaim(F.claimRow(envelope,{purpose}));
    const result=C.decryptClaimedPayload(receipt,keys());
    assert.ok(result.recipient===payload.recipient && result.displayOtp===payload.displayOtp && Object.isFrozen(result));
    assert.ok(envelope.ciphertext.length===Buffer.byteLength(JSON.stringify({v:1,...payload}),"utf8"));
    assert.equal(calls.length,1);
  });
}
test("maximum canonical recipient and permitted payload bound remain valid",async()=>{
  const recipient="a".repeat(64)+"@"+["a".repeat(63),"b".repeat(63),"c".repeat(61)].join(".");
  const maximum={recipient,displayOtp:payload.displayOtp};
  assert.equal(Buffer.byteLength(recipient,"ascii"),254);
  const envelope=C.encryptEvery8dSettingsEmailOutboxPayload(F.context(),maximum,config());
  const {receipt}=await F.parsedClaim(F.claimRow(envelope));
  const result=C.decryptClaimedPayload(receipt,keys());
  assert.ok(result.recipient===recipient && result.displayOtp===maximum.displayOtp);
  assert.ok(envelope.ciphertext.length<=512,"largest valid recipient stays within frozen payload bound");
});
const byteNegatives=[
  ["UTF8 BOM",Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(canonical)])],
  ["leading ASCII whitespace"," "+canonical],
  ["trailing ASCII whitespace",canonical+" \r\n"],
  ["separator formatting whitespace",canonical.replace(":",": ").replace(",",",\t")],
  ["different key order",JSON.stringify({recipient:payload.recipient,displayOtp:payload.displayOtp,v:1})],
  ["duplicate v",canonical.replace('{"v":1,','{"v":1,"v":1,')],
  ["duplicate recipient",canonical.replace('"recipient":','"recipient":'+JSON.stringify(payload.recipient)+',"recipient":')],
  ["duplicate displayOtp",canonical.slice(0,-1)+',"displayOtp":'+JSON.stringify(payload.displayOtp)+'}'],
  ["unknown member",canonical.slice(0,-1)+',"unknown":true}'],
  ["trailing JSON",canonical+"{}"],
  ["invalid UTF8",Buffer.from([0xc0,0xaf])],
  ["malformed JSON",canonical.slice(0,-1)],
  ["noncanonical recipient",JSON.stringify({v:1,...payload,recipient:"fixture@EXAMPLE.invalid"})],
  ["noncanonical OTP",JSON.stringify({v:1,...payload,displayOtp:"abcd-efgh"})],
  ["alternate value escaping",canonical.replace("fixture","\\u0066ixture")],
  ["alternate key escaping",canonical.replace('"v"','"\\u0076"')],
  ["alternate decimal spelling",canonical.replace('"v":1,','"v":1.0,')],
  ["alternate exponent spelling",canonical.replace('"v":1,','"v":1e0,')],
  ["trailing NUL",Buffer.concat([Buffer.from(canonical),Buffer.from([0])])],
  ["leading tab","\t"+canonical],
  ["truncated UTF8",Buffer.from([0xe2,0x80])],
  ["recipient spaces",JSON.stringify({v:1,...payload,recipient:" "+payload.recipient})],
  ["missing OTP separator",JSON.stringify({v:1,...payload,displayOtp:"23456789"})],
  ["different payload version",JSON.stringify({v:2,...payload})],
  ["array payload","["+canonical+"]"],
  ["wrong version type",canonical.replace('"v":1,','"v":"1",')]
];
for(const [label,value] of byteNegatives) {
  test(`canonical authenticated bytes reject ${label}`,async()=>{
    const original=Buffer.isBuffer(value)?value:Buffer.from(value,"utf8");
    const snapshot=Buffer.from(original);
    const {receipt,calls}=await F.parsedClaim(F.claimRow(sealTestBytes(original)));
    safeFailure(()=>C.decryptClaimedPayload(receipt,keys()));
    assert.ok(original.equals(snapshot),"caller-owned reference fixture is not normalized or mutated");
    assert.ok(calls.length===1 && calls[0].name==="runtime_claim_every8d_settings_auth_email_v1","no follow-up send authority");
  });
}
test("BOM logical equivalence cannot replace original authenticated-byte equality",async()=>{
  const original=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(canonical)]);
  const decoded=new (require("node:util").TextDecoder)("utf-8",{fatal:true}).decode(original);
  assert.ok(decoded===canonical && !original.equals(Buffer.from(canonical,"utf8")),"normalized string equality differs from byte equality");
  const {receipt}=await F.parsedClaim(F.claimRow(sealTestBytes(original)));
  safeFailure(()=>C.decryptClaimedPayload(receipt,keys()));
});
test("oversized authenticated payload cannot enter a validated claim or release plaintext",async()=>{
  const oversized=Buffer.from(canonical.padEnd(513," "),"utf8");
  assert.ok(oversized.length>512);
  const row=F.claimRow(sealTestBytes(oversized));
  const {repo,calls}=F.repository({data:[row],error:null});
  const result=await repo.claim({batchSize:1});
  assert.ok(result.outcome==="failure" && result.category==="repository_contract_violation","envelope/ciphertext bound rejects before decryption");
  safeFailure(()=>C.decryptClaimedPayload(row,keys()));
  assert.equal(calls.length,1);
});
test("failed GCM authentication precedes JSON parsing and any payload release",async()=>{
  const envelope=sealTestBytes(Buffer.from(canonical)); envelope.authenticationTag[0]^=1;
  const {receipt}=await F.parsedClaim(F.claimRow(envelope)); const ring=keys();
  const originalParse=JSON.parse; let parsed=0;
  JSON.parse=(...args)=>{parsed+=1;return originalParse(...args);};
  try { safeFailure(()=>C.decryptClaimedPayload(receipt,ring)); }
  finally { JSON.parse=originalParse; }
  assert.equal(parsed,0,"unauthenticated plaintext never reaches JSON parsing");
});
