// Explicit disposable PG17 lifecycle proof. Test registry/client only; no email transport.
const {execFileSync,fork} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const assert = require('node:assert/strict');
const {createEvery8dSettingsEmailOutboxRepository} = require('../../dist/services/every8dSettingsEmailOutboxRepository');
const {createEvery8dSettingsEmailWorkerRuntime,emailWorkerClock} = require('../../dist/workers/every8dSettingsEmailWorkerRuntime');
const {runEvery8dSettingsEmailWorkerProcess} = require('../../dist/workers/every8dSettingsEmailWorkerProcess');
const {encryptEvery8dSettingsEmailOutboxPayload} = require('../../dist/services/every8dSettingsEmailOutboxCrypto');
const {parseEvery8dSettingsEmailOutboxKeyring} = require('../../dist/config/every8dSettingsEmailOutbox');
const {environment} = require('../helpers/every8dSettingsEmailLifecycleFixtures.cjs');
const [container,template,mode] = process.argv.slice(2);
if(!/^(?:c3c4a-[a-z0-9-]+|[0-9a-f]{64})$/.test(container??'') || !/^c3c4a_worker_[0-9]+(?:_[a-z0-9]+)?$/.test(template??''))throw Error('disposable PG17 inputs required');
let database=template;
let proofStage="initialization";
const quote=s=>"'"+s.replaceAll("'","''")+"'";
function sql(statement,role=null,db=database){
  const executable=process.platform==='win32'?'wsl.exe':'docker';
  const prefix=process.platform==='win32'?['-d','Ubuntu','-u','root','--','docker']:[];
  try{return execFileSync(executable,[...prefix,'exec','-i',container,'psql','-X','-Atq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','postgres','-d',db],
    {input:(role?`set role ${role};`:'')+statement,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000}).trim();}
  catch{proofStage='fixture_sql_failure';throw Error('disposable lifecycle proof SQL failed');}
}
const allowed=new Set(['runtime_enqueue_every8d_settings_auth_email_v1','runtime_claim_every8d_settings_auth_email_v1',
  'runtime_begin_every8d_settings_auth_email_send_v1','runtime_finalize_every8d_settings_auth_email_v1',
  'runtime_recover_every8d_settings_auth_email_v1','runtime_purge_every8d_settings_auth_email_v1']);
function rpc(name,args){
  assert.ok(allowed.has(name),'fixed proof RPCs');
  const small=new Set(['input_envelope_version','input_payload_version','input_template_version','input_attempt_count']);
  const binary=new Set(['input_request_token_hash','input_nonce','input_ciphertext','input_authentication_tag']);
  const parameters=Object.entries(args).map(([key,value])=>{
    assert.ok(/^input_[a-z_]+$/.test(key));
    let literal=value===null?'null':typeof value==='number'||typeof value==='boolean'?String(value):quote(value);
    if(small.has(key))literal+='::smallint';if(binary.has(key))literal+='::bytea';if(key==='input_fence')literal+='::bigint';return key+'=>'+literal;
  }).join(',');
  return JSON.parse(sql(`select coalesce(json_agg(r),'[]') from (select * from public.${name}(${parameters})) r`,'service_role'));
}
const keys=parseEvery8dSettingsEmailOutboxKeyring(JSON.stringify({enc:Buffer.alloc(32,7).toString('base64url')}));
function repository(observe=()=>{}){
  return createEvery8dSettingsEmailOutboxRepository({enabled:true,httpEnabled:true,emailDispatchEnabled:true},()=>({async rpc(name,args){
    const data=rpc(name,args);return observe(name,args,data)??{data,error:null};
  }}));
}
let fixtureNumber=23000;
async function enqueue(repo){
  fixtureNumber++;proofStage="enqueue_fixture";
  const f=JSON.parse(sql(`select json_build_object('challengeId',c3c3_proof.pending(${fixtureNumber}),'hash',encode(c3c2a_proof.hash('outbox-request-${fixtureNumber}'),'hex'))`,'c3a_migration_owner'));
  const context={jobId:randomUUID(),challengeId:f.challengeId,requestTokenHash:Buffer.from(f.hash,'hex'),purpose:'enrollment',envelopeVersion:1,payloadVersion:1,templateVersion:1};
  proofStage="fixture_encryption";
  const envelope=encryptEvery8dSettingsEmailOutboxPayload(context,{recipient:`outbox-${fixtureNumber}@example.invalid`,displayOtp:'2345-6789'},{activeKeyVersion:'enc',keys});
  const result=await repo.enqueue({...context,...envelope});proofStage=result.outcome==='applied'?'fixture_applied':result.outcome==='not_applied'?'fixture_not_applied':result.category==='repository_contract_violation'?'fixture_contract_violation':'fixture_repository_unavailable';assert.equal(result.outcome,'applied');return context.jobId;
}
function state(job){return JSON.parse(sql(`select json_build_object('state',state,'attempts',attempt_count,'scrubbed',ciphertext is null) from public.every8d_settings_auth_email_outbox where job_id=${quote(job)}`));}
// Test-owned observation only: every operation reaches the real repository and
// returns its exact validated result. No RPC, receipt or authority is replaced.
function passControl(repo,shouldStop,onComplete){
  let pending=0,active=0,claims=0,passes=0,passReady=false;
  const operations=[],observed={};
  for(const name of ['claim','beginSend','finalize','recover','purge'])observed[name]=async input=>{
    operations.push(name);active++;
    try{
      const result=await repo[name](input);
      if(name==='claim'){
        claims++;assert.equal(pending,0);pending=result.outcome==='applied'?result.receipts.length:0;
        passReady=pending===0;
      }else if(name==='finalize'||name==='beginSend'&&(result.outcome!=='applied'||result.receipt.state!=='SENDING')){
        pending--;assert.ok(pending>=0);passReady=pending===0;
      }
      return result;
    }finally{active--;}
  };
  return {repository:{enqueue:repo.enqueue,...observed},operations,
    clock:{nowNs:emailWorkerClock.nowNs,schedule(delay,callback){
      // After all claimed jobs reach their final repository boundary, the next
      // wait is scheduled only after runBatch has returned. Hold that future
      // wait when stopping; signal on a microtask after cancelWait is installed.
      if(passReady){
        assert.equal(active,0);passReady=false;passes++;
        if(shouldStop()){queueMicrotask(onComplete);return ()=>{};}
      }
      return emailWorkerClock.schedule(delay,callback);
    }},
    assertComplete(singlePass=false){assert.equal(pending,0);assert.equal(active,0);assert.equal(claims,passes);assert.ok(passes>=1);if(singlePass)assert.equal(passes,1);}
  };
}
async function onePass(repo){
  proofStage="runtime_pass";let sends=0,batchTelemetry=0;
  const control=passControl(repo,()=>true,()=>{void runtime.stop();});
  const runtime=createEvery8dSettingsEmailWorkerRuntime({repository:control.repository,clock:control.clock,encryptionKeyring:keys,canonicalSender:'settings@example.invalid',
    provider:{async send(){sends++;return {outcome:'accepted',evidence:'authoritative_acceptance',providerMessageId:'synthetic-provider-id'};}},
    telemetry(e){if(e.event==='batch')batchTelemetry++;throw Error('synthetic proof telemetry sink failure');}});
  runtime.start();const result=await runtime.done;assert.equal(result.drained,true);assert.equal(result.reason,'signal');
  control.assertComplete(true);assert.deepEqual(control.operations.slice(0,3),['recover','purge','claim']);
  assert.equal(batchTelemetry,0,'single pass completes despite absent batch telemetry and a failing sink');return sends;
}
function child(modeValue){
  const child=fork(__filename,[container,database,modeValue],{stdio:['ignore','ignore','ignore','ipc']});
  let resolveReady,resolveSubmitted,resolveExit,rejectExit;const ready=new Promise(r=>resolveReady=r),submitted=new Promise(r=>resolveSubmitted=r);
  const exited=new Promise((r,j)=>{resolveExit=r;rejectExit=j;});let stats;
  const timeout=setTimeout(()=>{child.kill('SIGKILL');rejectExit(Error('bounded disposable child timeout'));},60000);
  child.on('message',message=>{if(message==='ready')resolveReady();else if(message==='submitted')resolveSubmitted();else if(message?.kind==='stats')stats=message.sends;});
  child.on('error',()=>rejectExit(Error('disposable proof process failed')));
  child.on('exit',(code,signal)=>{clearTimeout(timeout);if(code===0||modeValue==='crash'&&signal==='SIGKILL')resolveExit(stats);else rejectExit(Error('disposable proof process failed'));});
  return {child,ready,submitted,exited};
}
async function childMain(){
  let sends=0,batchTelemetry=0;process.send('ready');await new Promise(r=>process.once('message',r));
  const registry={'test-only':{parseReadiness(){return {createClient(){return {send(){sends++;
    // Test-only submission marker; no request, key, identifier or raw error leaves this process.
    if(mode==='crash'){process.send('submitted');return new Promise(()=>{});}
    return Promise.resolve({outcome:'accepted',evidence:'authoritative_acceptance',providerMessageId:'synthetic-provider-id'});
  }};}};}}};
  const control=passControl(repository(),()=>mode!=='compete'||
    sql("select count(*)=0 from public.every8d_settings_auth_email_outbox where state<>'ACCEPTED'")==='t',()=>process.emit('SIGTERM'));
  const result=await runEvery8dSettingsEmailWorkerProcess({process,loadEnvironment:environment,registry,
    createRepository:()=>control.repository,clock:control.clock,
    telemetry(e){if(e.event==='batch')batchTelemetry++;throw Error('synthetic proof telemetry sink failure');}});
  assert.equal(result.exitCode,0);assert.equal(result.forceExit,false);control.assertComplete(mode!=='compete');
  assert.equal(batchTelemetry,0,'child completion is independent of batch telemetry and sink success');
  process.send({kind:'stats',sends});process.exitCode=result.exitCode;process.disconnect();
}
async function main(){
  let completed=0;
  for(const scenario of ['orderly','lostbegin','lostfinalize','abandonedlease','crashrestart','competitors']){
    database=template+'_'+scenario;sql(`create database ${database} template ${template}`,null,'postgres');
    try{
      const repo=repository(), job=await enqueue(repo);
      proofStage=scenario;
      if(scenario==='orderly'){
        assert.equal(await onePass(repo),1);assert.deepEqual(state(job),{state:'ACCEPTED',attempts:1,scrubbed:true});assert.equal(await onePass(repo),0);
      }else if(scenario==='abandonedlease'){
        assert.equal((await repo.claim({batchSize:10})).receipts.length,1);
        sql(`select c3c3_proof.shift_job(${quote(job)},interval '31 seconds')`);
        assert.equal(await onePass(repo),1);assert.equal(state(job).attempts,1);assert.equal(state(job).state,'ACCEPTED');
      }else if(scenario==='lostbegin'){
        assert.equal(await onePass(repository((name)=>name.includes('runtime_begin_')?{data:null,error:{}}:undefined)),0);
        assert.equal(state(job).state,'SENDING');sql(`select c3c3_proof.shift_job(${quote(job)},interval '31 seconds')`);
        assert.equal(await onePass(repo),0);assert.deepEqual(state(job),{state:'DELIVERY_OUTCOME_UNKNOWN',attempts:1,scrubbed:true});
      }else if(scenario==='lostfinalize'){
        assert.equal(await onePass(repository((name)=>name.includes('runtime_finalize_')?{data:null,error:{}}:undefined)),1);
        assert.equal(await onePass(repo),0);assert.equal(state(job).state,'ACCEPTED');assert.equal(state(job).attempts,1);
      }else if(scenario==='crashrestart'){
        const crashed=child('crash');await crashed.ready;crashed.child.send('go');await crashed.submitted;assert.equal(state(job).state,'SENDING');
        crashed.child.kill('SIGKILL');await crashed.exited;sql(`select c3c3_proof.shift_job(${quote(job)},interval '31 seconds')`);
        const restarted=child('once');await restarted.ready;restarted.child.send('go');assert.equal(await restarted.exited,0);
        assert.deepEqual(state(job),{state:'DELIVERY_OUTCOME_UNKNOWN',attempts:1,scrubbed:true});
      }else{
        for(let i=1;i<12;i++)await enqueue(repo);
        proofStage='competing_processes';
        const first=child('compete'),second=child('compete');await Promise.all([first.ready,second.ready]);first.child.send('go');second.child.send('go');
        const counts=await Promise.all([first.exited,second.exited]);
        assert.equal(counts[0]+counts[1],12);
        assert.equal(sql("select count(*)=12 and bool_and(state='ACCEPTED' and attempt_count=1 and ciphertext is null) from public.every8d_settings_auth_email_outbox"),'t');
      }
      completed++;console.log('PASS lifecycle PG17 '+scenario);
    }finally{sql(`drop database ${database} with (force)`,null,'postgres');}
  }
  console.log('PASS lifecycle real-repository scenarios='+completed);
}
(mode?childMain():main()).catch(()=>{console.error('FAIL disposable PG17 lifecycle proof stage='+proofStage);process.exitCode=1;if(process.connected)process.disconnect();});
