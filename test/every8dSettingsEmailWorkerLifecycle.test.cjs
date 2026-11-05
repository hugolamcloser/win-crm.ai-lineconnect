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
  assert.ok(p.events.indexOf('recovery')<p.events.indexOf('purge')&&p.events.indexOf('purge')<p.events.indexOf('ready'));
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
  for(const delay of [900,1800,3600,7200,9000,9000]){assert.equal(h.telemetry.at(-1).delayMs,delay);await h.advance(delay);}
  fail=false;await h.advance(9000);assert.equal(h.telemetry.at(-1).event,'poll_wait');assert.equal(h.telemetry.at(-1).delayMs,1000);await h.close();
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
test('shutdown during provider aborts worker but submitted transport retains original deadline and one unknown finalization',async()=>{
  const pending=deferred();const h=fixture({provider:()=>pending.promise});h.runtime.start();await tick();
  const stop=h.runtime.stop();await tick();assert.equal(h.finals.length,1);assert.equal(h.finals[0].input_provider_outcome,'outcome_unknown');
  assert.equal(h.providerSignals[0].aborted,false);await h.advance(9999);assert.equal(h.providerSignals[0].aborted,false);
  await h.advance(1);assert.equal(h.providerSignals[0].aborted,true);assert.equal((await stop).drained,true);
  pending.resolve({outcome:'accepted',evidence:'authoritative_acceptance',providerMessageId:'late-secret-id'});await tick();
  assert.equal(h.events.filter(e=>e==='provider').length,1);assert.equal(h.finals.length,1);assert.equal(h.finals[0].input_non_acceptance_proven,false);
});
test('provider completes during drain without new deadline or replay',async()=>{
  const pending=deferred();const h=fixture({provider:()=>pending.promise});h.runtime.start();await tick();
  await h.advance(7000);const stop=h.runtime.stop();await tick();await h.advance(1000);pending.resolve({outcome:'outcome_unknown'});await tick();
  assert.equal((await stop).drained,true);assert.equal(h.providerSignals[0].aborted,false);assert.equal(h.finals.length,1);
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
  assert.equal(new Set(seen).size,seen.length);assert.ok(h.telemetry.every(e=>Object.keys(e).every(k=>['component','event','delayMs','reason'].includes(k))));
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
