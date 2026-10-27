const assert=require("node:assert/strict");
const test=require("node:test");
const {createEvery8dSettingsEmailOutboxRepository}=require("../dist/services/every8dSettingsEmailOutboxRepository");
const F=require("./helpers/every8dSettingsEmailOutboxFixtures.cjs");
function rejected(result) {assert.ok(result.outcome==="failure" && result.category==="repository_contract_violation","closed contract violation");}
const names={enqueue:"runtime_enqueue_every8d_settings_auth_email_v1",claim:"runtime_claim_every8d_settings_auth_email_v1",
  beginSend:"runtime_begin_every8d_settings_auth_email_send_v1",finalize:"runtime_finalize_every8d_settings_auth_email_v1",
  recover:"runtime_recover_every8d_settings_auth_email_v1",purge:"runtime_purge_every8d_settings_auth_email_v1"};
const keys={enqueue:["input_job_id","input_challenge_id","input_request_token_hash","input_purpose","input_envelope_version","input_payload_version","input_template_version","input_encryption_key_version","input_nonce","input_ciphertext","input_authentication_tag"],
  claim:["input_batch_size"],beginSend:["input_job_id","input_lease_id","input_fence"],
  finalize:["input_job_id","input_lease_id","input_fence","input_attempt_count","input_provider_outcome","input_pre_send_disposition","input_non_acceptance_proven","input_provider_message_id"],recover:["input_batch_size"],purge:["input_batch_size"]};
for(const method of Object.keys(names)) {
  test(`${method}: exact RPC name/argument keys and six-operation closed public surface`,async()=>{
    const {repo,calls}=F.repository({data:[F.responses()[method]],error:null});
    assert.ok(Object.keys(repo).sort().join(",")===Object.keys(names).sort().join(",") && Object.isFrozen(repo));
    const result=await repo[method](F.inputs()[method]);assert.ok(result.outcome==="applied");
    assert.ok(calls.length===1 && calls[0].name===names[method] && Object.keys(calls[0].args).sort().join(",")===keys[method].sort().join(","));
  });
}
for(const gate of ["enabled","httpEnabled","emailDispatchEnabled"]) for(const method of ["claim","beginSend"]) {
  test(`${method}: disabled ${gate} precedes input getters and client construction`,async()=>{
    let reads=0,clients=0;
    const gates={...F.GATES,[gate]:false};
    const repo=createEvery8dSettingsEmailOutboxRepository(gates,()=>{clients+=1;throw new Error("unused client");});
    const input=new Proxy({}, {get(){reads+=1;throw new Error("unused getter");},ownKeys(){reads+=1;throw new Error("unused keys");}});
    const result=await repo[method](input);
    assert.ok(method==="claim"?result.outcome==="applied" && result.receipts.length===0:result.outcome==="not_applied");
    assert.ok(reads===0 && clients===0);
  });
}
for(const method of ["finalize","recover","purge"]) {
  test(`${method}: trusted completion/maintenance remains usable with dispatch and other flags false`,async()=>{
    const {repo,calls}=F.repository({data:[F.responses()[method]],error:null},{enabled:false,httpEnabled:false,emailDispatchEnabled:false});
    const result=await repo[method](F.inputs()[method]);assert.ok(result.outcome==="applied" && calls.length===1);
  });
}
test("repository gates are immutable snapshots and construction starts no client",async()=>{
  const gates={enabled:false,httpEnabled:false,emailDispatchEnabled:false};let calls=0;
  const repo=createEvery8dSettingsEmailOutboxRepository(gates,()=>{calls+=1;throw new Error("unused client");});
  Object.assign(gates,F.GATES);
  const result=await repo.claim({batchSize:1});assert.ok(result.outcome==="applied" && result.receipts.length===0 && calls===0);
});
test("full finalize structural NULL/boolean/provider-ID/count matrix",async(t)=>{
  let valid=0,invalid=0;
  for(const outcome of ["accepted","rejected","not_accepted_retryable","outcome_unknown",null,"sender_unavailable","UNKNOWN"])
    for(const pre of [null,"sender_unavailable","UNKNOWN"]) for(const evidence of [false,true,null,undefined])
      for(const id of [null,"synthetic-provider-id"]) for(const count of [0,1,2,3]) {
        const allowed=(count>=1 && pre===null && evidence===false && outcome==="accepted" && id!==null) ||
          (count>=1 && pre===null && evidence===false && ["rejected","outcome_unknown"].includes(outcome) && id===null) ||
          (count>=1 && pre===null && evidence===true && outcome==="not_accepted_retryable" && id===null) ||
          (count<=2 && pre==="sender_unavailable" && evidence===false && outcome===null && id===null);
        const {repo,calls}=F.repository({data:[],error:null});
        const result=await repo.finalize({...F.inputs().finalize,providerOutcome:outcome,preSendDisposition:pre,
          nonAcceptanceProven:evidence,providerMessageId:id,attemptCount:count});
        if(allowed) {assert.ok(result.outcome==="not_applied" && calls.length===1);valid+=1;}
        else {rejected(result);assert.equal(calls.length,0);invalid+=1;}
      }
  assert.equal(valid,15);assert.equal(invalid,657);t.diagnostic(`finalize input matrix valid=${valid}, invalid=${invalid}`);
});
const outcomes=[];
for(const count of [1,2,3]) for(const recording of ["recorded","not_recorded"]) {
  outcomes.push(["accepted",count,"ACCEPTED","accepted",recording]);
  outcomes.push(["rejected",count,"FAILED_TERMINAL","provider_rejected",recording]);
  outcomes.push(["outcome_unknown",count,"DELIVERY_OUTCOME_UNKNOWN","delivery_outcome_unknown",recording]);
}
for(const count of [0,1,2]) for(const recording of ["recorded","not_recorded"]) outcomes.push([null,count,"FAILED_TERMINAL","sender_unavailable_pre_send",recording]);
for(const count of [1,2]) {
  outcomes.push(["not_accepted_retryable",count,"RETRY_WAIT",null,"not_applicable"]);
  outcomes.push(["not_accepted_retryable",count,"FAILED_TERMINAL","retry_unusable","not_applicable"]);
  outcomes.push(["not_accepted_retryable",count,"FAILED_TERMINAL","retry_deadline_exhausted","not_applicable"]);
}
outcomes.push(["not_accepted_retryable",3,"FAILED_TERMINAL","retry_budget_exhausted","not_applicable"]);
for(const [index,[outcome,count,state,disposition,recording]] of outcomes.entries()) {
  test(`finalize receipt legal family ${index}: duplicate is stable and mismatches rejected`,async()=>{
    const input={...F.inputs().finalize,providerOutcome:outcome,attemptCount:count,preSendDisposition:outcome===null?"sender_unavailable":null,
      nonAcceptanceProven:outcome==="not_accepted_retryable",providerMessageId:outcome==="accepted"?"synthetic-provider-id":null};
    const row={...F.responses().finalize,state,attempt_count:count,terminal_disposition:disposition,
      challenge_recording:recording,provider_message_id:input.providerMessageId,
      terminal_at:state==="RETRY_WAIT"?null:F.RESOLVED,
      available_at:state==="RETRY_WAIT"?(count===1?"2026-10-26T00:00:06.000001Z":"2026-10-26T00:00:21.000001Z"):null};
    const {repo,calls}=F.repository({data:[row],error:null});
    const first=await repo.finalize(input),second=await repo.finalize(input);
    assert.ok(first.outcome==="applied" && second.outcome==="applied" && calls.length===2);
    assert.ok(JSON.stringify(first)===JSON.stringify(second),"stored resolution/schedule/recorder receipt remains unchanged");
    const bad=[{...row,challenge_recording:recording==="not_applicable"?"recorded":"not_applicable"},
      {...row,attempt_count:count===0?1:0},{...row,terminal_at:state==="RETRY_WAIT"?F.NOW:null}];
    for(const value of bad) {const {repo:badRepo}=F.repository({data:[value],error:null});rejected(await badRepo.finalize(input));}
  });
}
for(const field of ["envelope_version","payload_version","template_version"]) for(const value of [0,2,"1",null]) {
  test(`claim rejects invalid ${field} value`,async()=>{
    const {repo}=F.repository({data:[{...F.responses().claim,[field]:value}],error:null});rejected(await repo.claim({batchSize:1}));
  });
}
for(const [index,value] of ["infinity","2026-02-30T00:00:00Z","2026-10-26 00:00:00Z","0000-01-01T00:00:00Z","2026-10-26T24:00:00Z","2026-10-26T00:00:00.0000001Z","2026-10-26T00:00:00Z\n"].entries()) {
  test(`claim rejects malformed authoritative timestamp ${index}`,async()=>{
    const {repo}=F.repository({data:[{...F.responses().claim,db_now:value}],error:null});rejected(await repo.claim({batchSize:1}));
  });
}
for(const field of ["request_token_hash","nonce","ciphertext","authentication_tag"]) {
  test(`claim rejects noncanonical bytea encoding in ${field}`,async()=>{
    for(const value of ["not-bytea","\\x0A","\\x0","\\x",null]) {
      const {repo}=F.repository({data:[{...F.responses().claim,[field]:value}],error:null});rejected(await repo.claim({batchSize:1}));
    }
  });
}
test("claim rejects exact full-provider-window equality",async()=>{
  const {repo}=F.repository({data:[{...F.responses().claim,delivery_deadline_at:F.PROVIDER}],error:null});rejected(await repo.claim({batchSize:1}));
});
for(const field of ["provider_deadline_at","lease_expires_at","delivery_deadline_at"]) {
  test(`begin receipt rejects incomplete provider-window ${field} relationship`,async()=>{
    const row={...F.responses().beginSend,[field]:field==="provider_deadline_at"?F.NOW:F.PROVIDER};
    const {repo}=F.repository({data:[row],error:null});rejected(await repo.beginSend(F.inputs().beginSend));
  });
}
test("claim validates bounded ordering, unique jobs, and defensive receipt buffers",async()=>{
  const first=F.claimRow(),second=F.claimRow(F.encrypted(),{job_id:F.OTHER,challenge_id:"10000000-0000-4000-8000-000000000002",request_token_hash:F.bytea(Buffer.alloc(32,2))});
  const {repo}=F.repository({data:[first,second],error:null});const good=await repo.claim({batchSize:2});
  assert.ok(good.outcome==="applied" && good.receipts.length===2 && Object.isFrozen(good.receipts));
  const snapshot=good.receipts[0].requestTokenHash;good.receipts[0].requestTokenHash.fill(0);
  assert.ok(good.receipts[0].requestTokenHash.equals(snapshot),"validated claim digest is defensively copied");
  for(const rows of [[second,first],[first,first]]) {const {repo:bad}=F.repository({data:rows,error:null});rejected(await bad.claim({batchSize:2}));}
});
