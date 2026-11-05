const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {fixture,environment,tick,deferred,EventEmitter,assert} = require('./helpers/every8dSettingsEmailLifecycleFixtures.cjs');
const {emailWorkerDelay,EmailWorkerStopping} = require('../dist/workers/every8dSettingsEmailWorkerRuntime');
const {runEvery8dSettingsEmailWorkerProcess:run} = require('../dist/workers/every8dSettingsEmailWorkerProcess');
const {createEmailWorkerTelemetry} = require('../dist/workers/every8dSettingsEmailWorkerTelemetry');
const unavailable = {data:null,error:{}};
function processHarness(options={}) {
  const events=[], proc=new EventEmitter(), h=fixture({empty:true,...options});
  const result=run({process:proc,loadEnvironment(){
    assert.ok(['SIGINT','SIGTERM','uncaughtException','unhandledRejection'].every(e=>proc.listenerCount(e)===1));
    events.push('environment');return options.env??environment();
  },registry:options.registry??{'test-only':{parseReadiness(){events.push('readiness'); options.onReady?.(proc);return {createClient(){events.push('factory');return h.provider;}};} }},
    createRepository(){events.push('repository');return h.repo;},clock:h.time.clock,random:()=>0,telemetry(e){events.push(e.event);h.telemetry.push(e);options.onTelemetry?.(e,proc);}});
  return {result,proc,h,events};
}

test('disabled executable has no operational imports, timers, factory, repository or network',()=>{
  const main=path.resolve('dist/workers/every8dSettingsEmailWorkerMain.js');
  const code=`const Module=require('module');const load=Module._load;Module._load=function(id,...args){if(/EmailWorkerRuntime|EmailOutboxRepository|supabase|config[\\/]env/.test(id))throw Error('forbidden operational import');return load.call(this,id,...args)};global.fetch=()=>{throw Error('network forbidden')};global.setTimeout=()=>{throw Error('timer forbidden')};require(${JSON.stringify(main)});`;
  // require.main must be the executable: preload the traps instead of importing main.
  const child=spawnSync(process.execPath,['-e',code.replace(`require(${JSON.stringify(main)});`,`const main=${JSON.stringify(main)};process.argv=[process.execPath,main];require('module').runMain(main);`)],
    {encoding:'utf8',env:{PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,NODE_ENV:'test',DOTENV_CONFIG_PATH:path.resolve('.temp/nonexistent-env')}});
  assert.ok(child.status===0 && child.stdout.includes('"event":"disabled"') && child.stderr==='', 'isolated disabled process is inert');
});

test('startup handles signals first; disabled is zero operational construction',async()=>{
  const p=processHarness({env:{},registry:new Proxy({},{get(){assert.fail('registry accessed');},getOwnPropertyDescriptor(){assert.fail('registry accessed');}})});
  assert.deepEqual(await p.result,{exitCode:0,forceExit:false});assert.deepEqual(p.events,['environment','disabled']);assert.deepEqual(p.h.events,[]);
  assert.equal(p.h.time.timers.size,0);assert.equal(p.proc.eventNames().length,0);
});
test('empty production registry fails before readiness, factory, repository and timers',async()=>{
  const p=processHarness({registry:{}});assert.equal((await p.result).exitCode,1);
  assert.deepEqual(p.events,['environment','startup_failed']);assert.equal(p.h.time.timers.size,0);
});
test('startup ordering and barriers; no polling until recovery THEN purge succeed',async()=>{
  const recovery=deferred(),purge=deferred();
  const p=processHarness({recover:()=>recovery.promise,purge:()=>purge.promise});await tick();
  assert.deepEqual(p.events,['environment','readiness','factory','repository']);assert.deepEqual(p.h.events,['recover']);
  recovery.resolve({data:[],error:null});await tick();assert.deepEqual(p.h.events,['recover','purge']);
  purge.resolve({data:[{purged_count:0}],error:null});await tick();assert.deepEqual(p.h.events,['recover','purge','claim']);
  assert.deepEqual(p.h.events.slice(0,3),['recover','purge','claim']);assert.ok(p.events.indexOf('recovery')<p.events.indexOf('ready'));
  p.proc.emit('SIGTERM');assert.deepEqual(await p.result,{exitCode:0,forceExit:false});
});
for(const phase of ['recover','purge']) test(`startup ${phase} failure backs off without claims`,async()=>{
  let fail=true;const h=fixture({empty:true,[phase]:(args,normal)=>fail?unavailable:normal()});h.runtime.start();await tick();
  assert.ok(!h.events.includes('claim'));if(phase==='recover')assert.ok(!h.events.includes('purge'));
  assert.equal(h.telemetry.at(-1).event,'backoff_wait');assert.equal(h.telemetry.at(-1).delayMs,900);
  fail=false;await h.advance(899);assert.ok(!h.events.includes('claim'));await h.advance(1);assert.ok(h.events.includes('claim'));await h.close();
});
for(const [n,tier] of [[1,1000],[2,2000],[3,4000],[4,8000],[5,10000],[12,10000]]) test(`backoff tier ${n}: exact integer 90–100 percent bounds`,()=>{
  assert.equal(emailWorkerDelay(n,()=>0),tier*.9);assert.equal(emailWorkerDelay(n,()=>1-Number.EPSILON),tier);
  for(let i=0;i<1000;i++){const value=emailWorkerDelay(n,()=>i/1000);assert.ok(Number.isInteger(value)&&value>=tier*.9&&value<=tier);}
});
test('normal poll integer jitter is exactly 1000–1200 inclusive',()=>{
  assert.equal(emailWorkerDelay(0,()=>0),1000);assert.equal(emailWorkerDelay(0,()=>1-Number.EPSILON),1200);
  assert.equal(new Set(Array.from({length:201},(_,i)=>emailWorkerDelay(0,()=>(i+.5)/201))).size,201);
});
test('successive failures advance tiers, success resets backoff',async()=>{
  let fail=true;const h=fixture({empty:true,claim:(args,normal)=>fail?unavailable:normal()});h.runtime.start();await tick();
  for(const delay of [900,1800,3600,7200,9000,9000]){assert.equal(h.scheduledDelays.at(-1),delay);await h.advance(delay);}
  fail=false;await h.advance(9000);assert.equal(h.scheduledDelays.at(-1),1000);await h.close();
});
test('only one runBatch while claim/finalize remains pending; maintenance coalesces',async()=>{
  const pending=deferred();const h=fixture({claim:()=>pending.promise});h.runtime.start();await tick();
  await h.advance(14000);assert.equal(h.events.filter(e=>e==='claim').length,1);assert.equal(h.events.filter(e=>e==='recover').length,1);
  pending.resolve({data:[],error:null});await tick();await h.advance(0);
  assert.deepEqual(h.events.slice(3),['recover']);await h.advance(1000);assert.deepEqual(h.events.slice(3),['recover','claim']);assert.equal(h.calls.filter(c=>c.name.includes('recover')).every(c=>c.args.input_batch_size===100),true);await h.close();
});
test('maintenance cadences 5s/60s, one bounded call per pass, missed intervals coalesce',async()=>{
  const h=fixture({empty:true});h.runtime.start();await tick();
  for(let i=0;i<59;i++)await h.advance(1000);
  assert.equal(h.events.filter(e=>e==='purge').length,1);assert.equal(h.events.filter(e=>e==='recover').length,12);
  await h.advance(1000);assert.equal(h.events.filter(e=>e==='purge').length,2);assert.equal(h.events.filter(e=>e==='recover').length,13);
  await h.advance(180000);assert.equal(h.events.filter(e=>e==='purge').length,3);assert.equal(h.events.filter(e=>e==='recover').length,14);
  for(const c of h.calls.filter(c=>/recover|purge/.test(c.name)))assert.equal(c.args.input_batch_size,100);await h.close();
});
test('maintenance never overlaps a maintenance call and recovery failure skips due purge',async()=>{
  let fail=false;const pending=deferred();let hold=false;
  const h=fixture({empty:true,recover:(args,normal)=>hold?pending.promise:fail?unavailable:normal()});h.runtime.start();await tick();
  hold=true;await h.advance(60000);assert.equal(h.events.filter(e=>e==='purge').length,1);
  await h.advance(1000);assert.equal(h.events.filter(e=>e==='recover').length,2);
  hold=false;fail=true;pending.resolve(unavailable);await tick();assert.equal(h.events.filter(e=>e==='purge').length,1);
  fail=false;await h.advance(900);assert.equal(h.events.filter(e=>e==='purge').length,2);await h.close();
});
test('shutdown before start admits no startup maintenance or claim',async()=>{
  const h=fixture();const stopped=h.runtime.stop();h.runtime.start();assert.equal((await stopped).drained,true);assert.deepEqual(h.events,[]);
});
for(const phase of ['recover','purge','claim','begin','finalize'])test(`shutdown during ${phase} retains outstanding repository slot until settlement`,async()=>{
  const pending=deferred();let normal;
  const h=fixture({[phase]:(args,next)=>{normal=next;return pending.promise;}});h.runtime.start();await tick();
  const stop=h.runtime.stop();let ended=false;stop.then(()=>ended=true);await tick();assert.equal(ended,false);
  await h.advance(15000);assert.equal(ended,false);assert.equal(h.events.filter(e=>e===phase).length,1);
  pending.resolve(normal());await tick();assert.equal((await stop).drained,true);
  if(['recover','purge','claim','begin'].includes(phase))assert.ok(!h.events.includes('provider'));
  await h.advance(60000);assert.equal(h.events.filter(e=>e===phase).length,1);
});
test('shutdown before begin admission does not fabricate a repository receipt',async()=>{
  const h=fixture({claim:(args,normal)=>{h.runtime.stop();return normal();}});h.runtime.start();await h.runtime.done;
  assert.deepEqual(h.events,['recover','purge','claim']);assert.equal(h.finals.length,0);
  assert.equal(h.telemetry.some(e=>e.event==='repository_failure'||e.event==='repository_contract_violation'),false);
  assert.ok(new EmailWorkerStopping() instanceof Error);assert.equal('outcome' in new EmailWorkerStopping(),false);
});
test('shutdown after durable SENDING, before acknowledged begin, cannot invoke provider',async()=>{
  const h=fixture({begin:(args,normal)=>{const ack=normal();void h.runtime.stop();return ack;}});h.runtime.start();await h.runtime.done;
  assert.deepEqual(h.events,['recover','purge','claim','begin']);assert.equal(h.finals.length,0);
});
test('R2-1 shutdown immediately aborts the submitted signal, preserves deadline and ignores late acceptance',async()=>{
  const pending=deferred();const h=fixture({provider:()=>pending.promise});h.runtime.start();await tick();
  const submittedSignal=h.providerSignals[0],originalDeadline=h.providerDeadlines[0];
  assert.equal(h.events.filter(e=>e==='provider').length,1);assert.equal(submittedSignal.aborted,false);
  assert.equal(originalDeadline,10000000000n);await h.advance(7000);
  const stop=h.runtime.stop();assert.equal(submittedSignal.aborted,true);await tick();
  assert.equal(h.providerSignals[0],submittedSignal);assert.equal(h.providerDeadlines[0],originalDeadline);
  assert.equal((await stop).drained,true);assert.equal(h.finals.length,1);
  assert.equal(h.finals[0].input_provider_outcome,'outcome_unknown');assert.equal(h.finals[0].input_non_acceptance_proven,false);
  pending.resolve({outcome:'accepted',evidence:'authoritative_acceptance',providerMessageId:'late-secret-id'});await tick();await h.advance(30000);
  assert.equal(h.events.filter(e=>e==='provider').length,1);assert.equal(h.finals.length,1);
  assert.equal(h.finals[0].input_provider_outcome,'outcome_unknown');assert.equal(h.time.timers.size,0);
});
test('provider completes during drain without new deadline or replay',async()=>{
  const pending=deferred();const h=fixture({provider:()=>pending.promise});h.runtime.start();await tick();
  await h.advance(7000);const stop=h.runtime.stop();await tick();await h.advance(1000);pending.resolve({outcome:'outcome_unknown'});await tick();
  assert.equal((await stop).drained,true);assert.equal(h.providerSignals[0].aborted,true);assert.equal(h.finals.length,1);
  assert.equal(h.providerDeadlines[0],10000000000n);
});
for(const phase of ['recover','purge','claim','begin','finalize'])test(`hung ${phase}: watchdog only stops; total drain expires without another attempt`,async()=>{
  const pending=deferred();let normal;
  const h=fixture({[phase]:(args,next)=>{normal=next;return pending.promise;}});h.runtime.start();await tick();
  await h.advance(14999);assert.equal(h.runtime.state,'running');await h.advance(1);assert.equal(h.runtime.state,'stopping');
  const count=h.events.length;await h.advance(19999);assert.equal(h.runtime.state,'stopping');await h.advance(1);
  assert.deepEqual(await h.runtime.done,{reason:'repository_stall',drained:false});assert.equal(h.events.length,count);
  pending.resolve(normal());await tick();assert.equal(h.events.length,count);assert.equal(h.telemetry.at(-1).event,'drain_expired');
});
test('signal drain is bounded to 20s even for a late begin that may have committed',async()=>{
  const pending=deferred();let normal;const h=fixture({begin:(args,next)=>{normal=next;return pending.promise;}});h.runtime.start();await tick();
  const stopped=h.runtime.stop();await h.advance(19999);assert.equal(h.runtime.state,'stopping');await h.advance(1);
  assert.deepEqual(await stopped,{reason:'signal',drained:false});pending.resolve(normal());await tick();assert.ok(!h.events.includes('provider'));assert.equal(h.finals.length,0);
});
test('finalize ambiguity causes repository backoff and never replays provider',async()=>{
  const h=fixture({finalize:()=>unavailable});h.runtime.start();await tick();assert.equal(h.telemetry.at(-1).event,'backoff_wait');
  await h.advance(900);assert.equal(h.events.filter(e=>e==='provider').length,1);assert.equal(h.finals.length,1);await h.close();
});
for(const phase of ['recover','purge','claim','begin','finalize'])test(`${phase} contract violation initiates bounded shutdown`,async()=>{
  const h=fixture({[phase]:()=>({data:[{malformed:true}],error:null})});h.runtime.start();const result=await h.runtime.done;
  assert.equal(result.reason,'repository_contract_violation');assert.equal(result.drained,true);assert.equal(h.telemetry.filter(e=>e.event==='stopping').length,1);
});
test('repeated SIGTERM/SIGINT and fatal handlers start exactly one bounded shutdown',async()=>{
  const pending=deferred();const p=processHarness({claim:()=>pending.promise});await tick();
  p.proc.emit('SIGTERM');p.proc.emit('SIGINT');p.proc.emit('SIGTERM');p.proc.emit('unhandledRejection',new Error('secret raw failure'));await tick();
  assert.equal(p.h.telemetry.filter(e=>e.event==='stopping').length,1);await p.h.advance(20000);
  assert.deepEqual(await p.result,{exitCode:1,forceExit:true});assert.equal(p.proc.eventNames().length,0);pending.resolve({data:[],error:null});await tick();
});
test('signal during readiness prevents lazy factory and repository construction',async()=>{
  const p=processHarness({onReady:p=>p.emit('SIGINT')});assert.equal((await p.result).exitCode,0);
  assert.deepEqual(p.events,['environment','readiness']);
});
test('process failures are safe and nonzero; raw exceptions are never emitted',async()=>{
  const p=processHarness();await tick();p.proc.emit('uncaughtException',new Error('secret-raw-exception'));assert.equal((await p.result).exitCode,1);
  assert.equal(JSON.stringify(p.h.telemetry).includes('secret'),false);
});
test('fresh closed telemetry discards canaries in every forbidden field and exception',async()=>{
  const canary='PRIVATE_CANARY_DO_NOT_EMIT';const seen=[];const emit=createEmailWorkerTelemetry(e=>seen.push(e));
  const fields=['recipient','sender','mailbox','otp','subject','body','providerMessageId','jobId','challengeId','lease','fence','idempotencyKey','ciphertext','nonce','tag','requestHash','keyVersion','credentials','response','exception','stack','cause'];
  for(const field of fields){emit({event:'batch',[field]:canary});emit('batch',{[field]:canary},{[field]:canary});}
  const h=fixture({provider:()=>Promise.reject(Object.assign(new Error(canary),Object.fromEntries(fields.map(f=>[f,canary]))))});h.runtime.start();await tick();await h.close();
  assert.ok(!JSON.stringify([...seen,...h.telemetry]).includes(canary));assert.ok(seen.every(e=>Object.isFrozen(e)&&Object.keys(e).sort().join(',')==='component,event'));
  assert.equal(new Set(seen).size,seen.length);assert.ok(h.telemetry.every(e=>Object.keys(e).every(k=>['component','event','delayMs','reason','suppressedCount'].includes(k))));
});


test('operational executable fails closed with empty registry before operational imports or network',()=>{
  const main=path.resolve('dist/workers/every8dSettingsEmailWorkerMain.js');
  const code=`const Module=require('module');const load=Module._load;Module._load=function(id,...args){if(/EmailWorkerRuntime|EmailOutboxRepository|supabase/.test(id))throw Error('operational import forbidden');return load.call(this,id,...args)};global.fetch=()=>{throw Error('network forbidden')};global.setTimeout=()=>{throw Error('timer forbidden')};process.argv=[process.execPath,${JSON.stringify(main)}];Module.runMain(${JSON.stringify(main)});`;
  const child=spawnSync(process.execPath,['-e',code],{encoding:'utf8',env:{PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,NODE_ENV:'test',...environment()}});
  assert.ok(child.status===1 && child.stderr==='' && child.stdout.trim()==='{"component":"settings_email_worker","event":"startup_failed"}', 'safe fail-closed executable');
});
test('shutdown at ready closes claim admission before first poll',async()=>{
  const p=processHarness({onTelemetry(e,proc){if(e.event==='ready')proc.emit('SIGTERM');}});
  assert.deepEqual(await p.result,{exitCode:0,forceExit:false});assert.deepEqual(p.h.events,['recover','purge']);
});
test('maintenance wake never shortens the 1200ms selected poll delay',async()=>{
  const h=fixture({empty:true,random:()=>1-Number.EPSILON});h.runtime.start();await tick();
  for(let i=0;i<4;i++)await h.advance(1200);
  assert.equal(h.events.filter(e=>e==='claim').length,5);await h.advance(200);
  assert.equal(h.events.filter(e=>e==='recover').length,2);assert.equal(h.events.filter(e=>e==='claim').length,5);
  await h.advance(999);assert.equal(h.events.filter(e=>e==='claim').length,5);await h.advance(1);
  assert.equal(h.events.filter(e=>e==='claim').length,6);await h.close();
});
for(const phase of ['environment','readiness','factory','repository'])test(`startup ${phase} exception emits only safe failure and constructs nothing later`,async()=>{
  const proc=new EventEmitter(),events=[],canary='PRIVATE_STARTUP_CANARY';
  const step=name=>{events.push(name);if(name===phase)throw new Error(canary);};
  const result=await run({process:proc,loadEnvironment(){step('environment');return environment();},
    registry:{'test-only':{parseReadiness(){step('readiness');return {createClient(){step('factory');return {send(){assert.fail('provider invocation');}};}};}}},
    createRepository(){step('repository');assert.fail('repository construction was expected to throw');},telemetry:e=>events.push(e)});
  assert.equal(result.exitCode,1);assert.equal(events.at(-1).event,'startup_failed');assert.ok(!JSON.stringify(events).includes(canary));assert.equal(proc.eventNames().length,0);
});


test('empty claim while a peer owns candidates continues normal polling for later eligible work',async()=>{
  let passes=0;const h=fixture({claim:(args,normal)=>++passes===1?{data:[],error:null}:normal()});
  h.runtime.start();await tick();assert.equal(h.runtime.state,'running');assert.equal(h.events.filter(e=>e==='provider').length,0);
  await h.advance(999);assert.equal(passes,1);await h.advance(1);assert.equal(passes,2);
  assert.equal(h.events.filter(e=>e==='provider').length,1);assert.equal(h.finals.length,1);await h.close();
});

// Drift: startup recovery at 0, purge completes at 1s; ordinary recovery at
// 60s leaves its next due time at 65s while purge becomes due at 61s.
async function driftFixture(options={}) {
  const pending=deferred();let first=true;
  const h=fixture({empty:true,...options,purge:(args,normal)=>{
    if(first){first=false;return pending.promise;}return options.purge?options.purge(args,normal):normal();
  }});
  h.runtime.start();await tick();await h.advance(1000);pending.resolve({data:[{purged_count:0}],error:null});await tick();
  for(let i=0;i<59;i++)await h.advance(1000);
  assert.equal(h.time.clock.nowNs(),60000000000n);assert.equal(h.events.filter(e=>e==='purge').length,1);
  assert.equal(h.events.filter(e=>e==='recover').length,13);return h;
}
test('R2-2 drifted due purge forces another successful recovery in that same pass',async()=>{
  const h=await driftFixture();const count=h.events.length;await h.advance(1000);
  assert.deepEqual(h.events.slice(count),['recover','purge','claim']);
  assert.equal(h.events.filter(e=>e==='recover').length,14);assert.equal(h.events.filter(e=>e==='purge').length,2);
  await h.advance(0);assert.equal(h.events.filter(e=>e==='recover').length,14);assert.equal(h.events.filter(e=>e==='purge').length,2);
  for(const c of h.calls.filter(c=>/recover|purge/.test(c.name)))assert.equal(c.args.input_batch_size,100);await h.close();
});
test('R2-2 failed forced recovery retains purge obligation and retries recovery first after backoff',async()=>{
  let failed=false;const h=await driftFixture({recover:(args,normal)=>failed?unavailable:normal()});failed=true;
  const count=h.events.length;await h.advance(1000);assert.deepEqual(h.events.slice(count),['recover']);
  assert.equal(h.scheduledDelays.at(-1),900);await h.advance(899);assert.deepEqual(h.events.slice(count),['recover']);
  failed=false;await h.advance(1);assert.deepEqual(h.events.slice(count),['recover','recover','purge','claim']);
  await h.advance(0);assert.deepEqual(h.events.slice(count),['recover','recover','purge','claim']);await h.close();
});
for(const disposition of ['violation','stopping'])test(`R2-2 forced recovery ${disposition} admits no purge`,async()=>{
  let activated=false,h;
  h=await driftFixture({recover:(args,normal)=>{
    if(!activated)return normal();
    if(disposition==='violation')return {data:[{malformed:true}],error:null};
    void h.runtime.stop();return normal();
  }});
  activated=true;const count=h.events.length;await h.advance(1000);
  assert.deepEqual(h.events.slice(count),['recover']);assert.equal((await h.runtime.done).drained,true);
  assert.equal(h.events.filter(e=>e==='purge').length,1);
});
test('R2-2 forced recovery stays serial while pending',async()=>{
  const pending=deferred();let hold=false;const h=await driftFixture({recover:(args,normal)=>hold?pending.promise:normal()});
  hold=true;const count=h.events.length;await h.advance(1000);await h.advance(1000);
  assert.deepEqual(h.events.slice(count),['recover']);pending.resolve({data:[],error:null});await tick();
  assert.deepEqual(h.events.slice(count),['recover','purge','claim']);await h.close();
});
test('R2-2 full recovery/purge batches do not cause immediate drain or catch-up calls',async()=>{
  const F=require('./helpers/every8dSettingsEmailOutboxFixtures.cjs');
  const recovered=Array.from({length:100},(_,i)=>({...F.responses().recover,job_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`}));
  const h=fixture({empty:true,recover:()=>({data:recovered,error:null}),purge:()=>({data:[{purged_count:100}],error:null})});
  h.runtime.start();await tick();assert.deepEqual(h.events,['recover','purge','claim']);
  for(let i=0;i<4;i++)await h.advance(1000);
  assert.equal(h.events.filter(e=>e==='recover').length,1);assert.equal(h.events.filter(e=>e==='purge').length,1);
  await h.advance(1000);assert.equal(h.events.filter(e=>e==='recover').length,2);assert.equal(h.events.filter(e=>e==='purge').length,1);await h.close();
});
test('R2-3 60 seconds idle: 61 unchanged claims, zero batch/poll logs, at most three operational records',async()=>{
  const h=fixture({empty:true});h.runtime.start();await tick();
  for(let i=0;i<60;i++){assert.equal(h.scheduledDelays.at(-1),1000);await h.advance(1000);}
  assert.equal(h.events.filter(e=>e==='claim').length,61);assert.equal(h.events.filter(e=>e==='recover').length,13);
  assert.equal(h.events.filter(e=>e==='purge').length,2);
  assert.equal(h.telemetry.filter(e=>e.event==='batch'||e.event==='poll_wait').length,0);
  assert.deepEqual(h.telemetry.map(e=>e.event),['recovery','ready','recovery']);assert.equal(h.telemetry.length,3);
  assert.equal(h.telemetry.at(-1).suppressedCount,12);assert.equal(h.time.timers.size,1);await h.close();
});
test('R2-3 seven failures/backoffs are suppressed; later records aggregate without changing retry schedule',async()=>{
  const h=fixture({empty:true,claim:()=>unavailable});h.runtime.start();await tick();
  for(const delay of [900,1800,3600,7200,9000,9000]){assert.equal(h.scheduledDelays.at(-1),delay);await h.advance(delay);}
  assert.equal(h.events.filter(e=>e==='claim').length,7);assert.equal(h.time.clock.nowNs(),31500000000n);
  assert.equal(h.telemetry.filter(e=>e.event==='repository_failure').length,1);assert.equal(h.telemetry.filter(e=>e.event==='backoff_wait').length,1);
  for(let i=0;i<4;i++){assert.equal(h.scheduledDelays.at(-1),9000);await h.advance(9000);}
  assert.equal(h.events.filter(e=>e==='claim').length,11);assert.equal(h.time.clock.nowNs(),67500000000n);
  for(const category of ['repository_failure','backoff_wait']){
    const records=h.telemetry.filter(e=>e.event===category);assert.equal(records.length,2);assert.equal(records[1].suppressedCount,9);
  }
  assert.equal(h.telemetry.filter(e=>e.event==='backoff_wait').at(-1).delayMs,9000);
  assert.equal(h.events.filter(e=>e==='provider').length,0);assert.equal(h.finals.length,0);await h.close();
});
test('R2-3 passive activity/category suppression uses only monotonic time and no timer',()=>{
  let now=0n;const seen=[];const emit=createEmailWorkerTelemetry(e=>seen.push(e),{nowNs:()=>now,schedule(){assert.fail('telemetry timer');}});
  emit('batch');emit('purge');emit('recovery');emit('repository_failure');emit('backoff_wait',900);
  assert.equal(seen.filter(e=>['batch','purge','recovery'].includes(e.event)).length,1);
  now=59999000000n;emit('batch');emit('repository_failure');emit('backoff_wait',9000);assert.equal(seen.length,3);
  now=60000000000n;emit('batch');emit('repository_failure');emit('backoff_wait',9000);
  assert.equal(seen.length,6);assert.equal(seen[3].suppressedCount,3);assert.equal(seen[4].suppressedCount,1);assert.equal(seen[5].suppressedCount,1);
  assert.ok(seen.every(e=>Object.isFrozen(e)));assert.equal(new Set(seen).size,seen.length);
});
test('R2-3 sink exceptions do not change repository calls, backoff, maintenance or shutdown',async()=>{
  const plain=fixture({empty:true,claim:()=>unavailable}),broken=fixture({empty:true,claim:()=>unavailable,telemetry(){throw Error('PRIVATE_SINK_CANARY');}});
  plain.runtime.start();broken.runtime.start();await tick();
  for(const delay of [900,1800,3600,7200,9000,9000,9000,9000,9000,9000]){await plain.advance(delay);await broken.advance(delay);}
  assert.deepEqual(broken.events,plain.events);assert.deepEqual(broken.scheduledDelays,plain.scheduledDelays);
  assert.equal(broken.finals.length,plain.finals.length);assert.equal(broken.time.timers.size,plain.time.timers.size);
  assert.deepEqual(await broken.close(),await plain.close());
});
test('R2-3 suppressedCount is allowlisted, safely clamped and rejects secret canaries',()=>{
  const canary='PRIVATE_SUPPRESSION_CANARY',seen=[];const emit=createEmailWorkerTelemetry(e=>seen.push(e));
  for(const value of [canary,{recipient:canary},-1,1.5,NaN,Infinity])emit('batch',undefined,undefined,value);
  assert.ok(seen.every(e=>!('suppressedCount' in e)));emit('batch',undefined,undefined,Number.MAX_SAFE_INTEGER);
  assert.equal(seen.at(-1).suppressedCount,2147483647);emit('batch',undefined,undefined,0);assert.equal(seen.at(-1).suppressedCount,0);
  assert.equal(JSON.stringify(seen).includes(canary),false);
  let now=0n;const aggregate=createEmailWorkerTelemetry(e=>seen.push(e),{nowNs:()=>now});
  aggregate('repository_failure',canary,canary,canary);aggregate('repository_failure',canary,canary,{cause:canary});
  now=60000000000n;aggregate('repository_failure');assert.equal(seen.at(-1).suppressedCount,1);
  assert.ok(seen.every(e=>Object.keys(e).every(k=>['component','event','delayMs','reason','suppressedCount'].includes(k))));
  assert.equal(JSON.stringify(seen).includes(canary),false);
});
for(const settlement of ['accepted','deadline','shutdown'])test(`R2-1 provider input abort listener removed on ${settlement}`,async()=>{
  const {getEventListeners}=require('node:events');const targets=new Set(),original=AbortSignal.prototype.addEventListener;
  AbortSignal.prototype.addEventListener=function(type,...args){if(type==='abort')targets.add(this);return original.call(this,type,...args);};
  const pending=deferred();let h;
  try{
    h=fixture(settlement==='accepted'?{}:{provider:()=>pending.promise});h.runtime.start();await tick();
    if(settlement==='deadline')await h.advance(10000);else if(settlement==='shutdown'){void h.runtime.stop();await tick();assert.equal(h.providerSignals[0].aborted,true);}
    assert.equal(targets.size,2);assert.ok([...targets].every(signal=>getEventListeners(signal,'abort').length===0));
    assert.equal(h.events.filter(e=>e==='provider').length,1);assert.equal(h.finals.length,1);
    if(settlement==='deadline')assert.equal(h.providerSignals[0].aborted,true);
  }finally{AbortSignal.prototype.addEventListener=original;if(h){await h.advance(10000);await h.close();}}
});
test('R2-1 an input signal aborted before listener registration is handled without submission or leak',async()=>{
  const {getEventListeners}=require('node:events');const targets=new Set(),original=AbortSignal.prototype.addEventListener;
  let registrations=0,abortedInput=false,h;
  AbortSignal.prototype.addEventListener=function(type,...args){
    if(type==='abort'){
      targets.add(this);registrations++;
      if(registrations===2){void h.runtime.stop();abortedInput=this.aborted;}
    }
    return original.call(this,type,...args);
  };
  try{
    h=fixture();h.runtime.start();await tick();await h.close();
    assert.equal(abortedInput,true);assert.equal(h.events.filter(e=>e==='provider').length,0);assert.equal(h.finals.length,1);
    assert.equal(h.finals[0].input_provider_outcome,'outcome_unknown');assert.equal(h.finals[0].input_non_acceptance_proven,false);
    assert.ok([...targets].every(signal=>getEventListeners(signal,'abort').length===0));
  }finally{AbortSignal.prototype.addEventListener=original;}
});
