const assert=require("node:assert/strict");
const test=require("node:test");
const crypto=require("node:crypto");
const A=require("../dist/config/every8dSettingsAuth");
const C=require("../dist/services/every8dSettingsEmailOutboxCrypto");
const {createEvery8dSettingsAuthService}=require("../dist/services/every8dSettingsAuthService");
const {createEvery8dSettingsEmailOutboxPreparationService}=require("../dist/services/every8dSettingsEmailOutboxPreparationService");
const F=require("./helpers/every8dSettingsEmailOutboxFixtures.cjs");
function config(extra={}) { return A.readEvery8dSettingsAuthConfig({
  EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED:"true",EVERY8D_SETTINGS_AUTH_HTTP_ENABLED:"true",EVERY8D_SETTINGS_AUTH_EMAIL_DISPATCH_ENABLED:"false",
  EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_ACTIVE_KEY_VERSION:"p",EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_KEYS:JSON.stringify({p:Buffer.alloc(32,1).toString("base64url")}),
  EVERY8D_SETTINGS_OTP_HMAC_ACTIVE_KEY_VERSION:"o",EVERY8D_SETTINGS_OTP_HMAC_KEYS:JSON.stringify({o:Buffer.alloc(32,2).toString("base64url")}),
  EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_ACTIVE_KEY_VERSION:"enc",EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_KEYS:JSON.stringify({enc:Buffer.alloc(32,7).toString("base64url")}),...extra
}); }
function prepared(purpose="enrollment") { return { outcome:"accepted",deliveryCommand:{
  challengeId:F.CHALLENGE,purpose,createdAt:new Date(F.NOW),expiresAt:new Date(F.DEADLINE),
  deliveryRequest:{recipient:"fixture@example.invalid",purpose,displayOtp:"2345-6789",expiresAt:new Date(F.DEADLINE)},
  deliveryHandle:{requestTokenHash:Buffer.alloc(32,1)}
} }; }
const enqueueKeys=["jobId","challengeId","requestTokenHash","purpose","envelopeVersion","payloadVersion","templateVersion","encryptionKeyVersion","nonce","ciphertext","authenticationTag"].sort().join(",");
async function proveEncrypted(input,expected,settings) {
  assert.ok(Object.keys(input).sort().join(",")===enqueueKeys,"only frozen encrypted enqueue fields");
  assert.ok(Buffer.isBuffer(input.requestTokenHash) && input.requestTokenHash.length===32);
  const row=F.claimRow(input,{job_id:input.jobId,challenge_id:input.challengeId,
    request_token_hash:F.bytea(input.requestTokenHash),purpose:input.purpose});
  const {receipt}=await F.parsedClaim(row);
  const result=C.decryptClaimedPayload(receipt,settings.emailOutboxEncryption.keys);
  assert.ok(result.recipient===expected.recipient && result.displayOtp===expected.displayOtp,"encrypted prepared payload round trip");
}
for(const purpose of ["enrollment","login"]) {
  test(`unchanged C3b ${purpose} durable preparation precedes one encryption and one acknowledged enqueue`,async()=>{
    const settings=config(); let prepareCalls=0,enqueueCalls=0,cipherCalls=0,prepareInput,enqueueInput,confirmed,completed=false;
    let confirmPreparation,confirmEnqueue;
    const preparationCommit=new Promise((resolve)=>{confirmPreparation=resolve;});
    const enqueueCommit=new Promise((resolve)=>{confirmEnqueue=resolve;});
    const prepare=async(input)=>{prepareCalls+=1;prepareInput=input;return preparationCommit;};
    const auth=createEvery8dSettingsAuthService(settings,()=>({requestEnrollmentChallenge:prepare,requestLoginChallenge:prepare}));
    const service=createEvery8dSettingsEmailOutboxPreparationService(settings,()=>({enqueue:async(input)=>{enqueueCalls+=1;enqueueInput=input;return enqueueCommit;}}));
    const originalCipher=crypto.createCipheriv;
    crypto.createCipheriv=(...args)=>{cipherCalls+=1;return originalCipher(...args);};
    try {
      const request=purpose==="enrollment"?auth.requestEnrollmentChallenge({email:"fixture@EXAMPLE.INVALID",enrollmentGrantTokenHash:Buffer.alloc(32,9)}):auth.requestLoginChallenge({email:"fixture@EXAMPLE.INVALID"});
      const pipeline=request.then((result)=>{confirmed=result;return service.enqueuePreparedChallenge(result);}).then((result)=>{completed=true;return result;});
      assert.equal(prepareCalls,1);assert.equal(enqueueCalls,0);assert.equal(cipherCalls,0);
      confirmPreparation({outcome:"prepared",challenge:{challengeId:prepareInput.challengeId,createdAt:new Date(F.NOW),expiresAt:new Date(F.DEADLINE)}});
      await new Promise(setImmediate);
      assert.equal(enqueueCalls,1);assert.equal(cipherCalls,1);assert.ok(!completed,"no result before durable enqueue acknowledgement");
      confirmEnqueue({outcome:"applied",receipt:{jobId:enqueueInput.jobId,state:"PENDING",createdAt:F.NOW,deliveryDeadlineAt:F.DEADLINE}});
      const result=await pipeline;
      assert.ok(result.outcome==="applied" && completed && prepareCalls===1 && enqueueCalls===1 && cipherCalls===1);
      await proveEncrypted(enqueueInput,confirmed.deliveryCommand.deliveryRequest,settings);
    } finally {crypto.createCipheriv=originalCipher;}
  });
}
test("raw capability getter is never read or forwarded",async()=>{
  const input=prepared(); let reads=0,calls=0,captured;
  Object.defineProperty(input.deliveryCommand,"requestCapability",{enumerable:true,get(){reads+=1;throw new Error("synthetic protected marker");}});
  const service=createEvery8dSettingsEmailOutboxPreparationService(config(),()=>({enqueue:async(value)=>{calls+=1;captured=value;return {outcome:"not_applied"};}}));
  const result=await service.enqueuePreparedChallenge(input);
  assert.ok(result.outcome==="not_applied" && reads===0 && calls===1);
  assert.ok(Object.keys(captured).sort().join(",")===enqueueKeys);
});
for(const [index,input] of [null,undefined,{}, {outcome:"disabled"},{outcome:"unavailable"},
    {outcome:"accepted",deliveryCommand:null},{outcome:"accepted"},Promise.resolve(prepared())].entries()) {
  test(`suppressed or unconfirmed preparation ${index} has no encryption or enqueue`,async()=>{
    let factories=0,entropy=0;
    const service=createEvery8dSettingsEmailOutboxPreparationService(config(),()=>{factories+=1;throw new Error("unused factory");});
    const original=crypto.randomUUID;crypto.randomUUID=()=>{entropy+=1;return original();};
    try {const result=await service.enqueuePreparedChallenge(input);assert.ok(result.outcome==="not_applied");}
    finally {crypto.randomUUID=original;}
    assert.equal(factories,0);assert.equal(entropy,0);
  });
}
for(const gate of ["EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED","EVERY8D_SETTINGS_AUTH_HTTP_ENABLED"]) {
  test("disabled preparation gate precedes input getters, randomness and client factories",async()=>{
    let factories=0,reads=0,entropy=0;
    const service=createEvery8dSettingsEmailOutboxPreparationService(config({[gate]:"false"}),()=>{factories+=1;throw new Error("unused factory");});
    const input=new Proxy({}, {get(){reads+=1;throw new Error("synthetic protected marker");}});
    const original=crypto.randomUUID;crypto.randomUUID=()=>{entropy+=1;return original();};
    try {const result=await service.enqueuePreparedChallenge(input);assert.ok(result.outcome==="disabled");}
    finally {crypto.randomUUID=original;}
    assert.equal(factories,0);assert.equal(reads,0);assert.equal(entropy,0);
  });
}
test("absent encryption configuration fails before input access or factory creation",async()=>{
  const settings={...config()};delete settings.emailOutboxEncryption;let reads=0,factories=0;
  const service=createEvery8dSettingsEmailOutboxPreparationService(settings,()=>{factories+=1;throw new Error("unused factory");});
  const result=await service.enqueuePreparedChallenge(new Proxy({}, {get(){reads+=1;throw new Error("unused getter");}}));
  assert.ok(result.outcome==="unavailable" && reads===0 && factories===0);
});
const mutations=[
  (p)=>p.challengeId="INVALID",(p)=>p.purpose="unknown",(p)=>p.createdAt=new Date(NaN),
  (p)=>p.expiresAt=new Date(F.NOW),(p)=>p.deliveryRequest.purpose="login",(p)=>p.deliveryRequest.expiresAt=new Date(F.NOW),
  (p)=>p.deliveryHandle.requestTokenHash=Buffer.alloc(31),(p)=>p.deliveryRequest.recipient="fixture@EXAMPLE.invalid",
  (p)=>p.deliveryRequest.displayOtp="23456789",(p)=>p.deliveryRequest=null,(p)=>p.deliveryHandle=null
];
for(const [index,mutate] of mutations.entries()) {
  test(`invalid prepared internal command ${index} never enqueues`,async()=>{
    const input=prepared();mutate(input.deliveryCommand);let calls=0;
    const service=createEvery8dSettingsEmailOutboxPreparationService(config(),()=>({enqueue:async()=>{calls+=1;throw new Error("unused enqueue");}}));
    const result=await service.enqueuePreparedChallenge(input);
    assert.ok(result.outcome==="unavailable" && calls===0);
  });
}
for(const behavior of ["transport","unavailable","violation","not_applied"]) {
  test(`enqueue ${behavior} never causes retry or reconstruction`,async()=>{
    let calls=0;
    const service=createEvery8dSettingsEmailOutboxPreparationService(config(),()=>({enqueue:async()=>{
      calls+=1;if(behavior==="transport")throw new Error("synthetic protected marker");
      if(behavior==="not_applied")return {outcome:"not_applied"};
      return {outcome:"failure",category:behavior==="unavailable"?"repository_unavailable":"repository_contract_violation"};
    }}));
    const result=await service.enqueuePreparedChallenge(prepared());await new Promise(setImmediate);
    assert.equal(calls,1);assert.ok(["unavailable","failure","not_applied"].includes(result.outcome));
    assert.ok(!JSON.stringify(result).includes("synthetic protected marker"),"no raw error leakage");
  });
}
test("enabling email dispatch alone creates no worker, entropy, factory, or network action",()=>{
  let factories=0,entropy=0;
  const original=crypto.randomUUID;crypto.randomUUID=()=>{entropy+=1;return original();};
  try {createEvery8dSettingsEmailOutboxPreparationService(config({EVERY8D_SETTINGS_AUTH_EMAIL_DISPATCH_ENABLED:"true"}),()=>{factories+=1;throw new Error("unused factory");});}
  finally {crypto.randomUUID=original;}
  assert.equal(factories,0);assert.equal(entropy,0);
});
