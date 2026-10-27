'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const contractPath=path.join(root,'docs/every8d-c3c3-email-outbox-contract.md');
const expected='c3ff909bc66fb19398694cb16cc1ad07505e68c2603e73e780c67eaa83c0aeba';
function derive(){
 const bytes=fs.readFileSync(contractPath);if(crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('frozen contract hash mismatch');
 const text=bytes.toString('utf8'),start=text.indexOf('**36. Mandatory PG17 executable proof matrix**'),end=text.indexOf('**37.',start);
 if(start<0||end<0)throw Error('section boundaries missing');
 const section=text.slice(start,end),rows=[];
 for(const line of section.split(/\r?\n/)){
  if(!line.startsWith('|'))continue;
  const parts=line.split('|').map(x=>x.trim());if(parts[1]==='Area'||/^[- ]+$/.test(parts[1]))continue;
  for(const obligation of parts[2].split(';').map(x=>x.trim()))rows.push({id:'S36-'+String(rows.length+1).padStart(3,'0'),area:parts[1],exact_frozen_obligation:obligation});
 }
 if(new Set(rows.map(x=>x.area)).size!==25)throw Error('incomplete frozen matrix extraction');
 return rows;
}
function initial(priorLog){
 const prior=fs.readFileSync(priorLog,'utf8');if(!prior.includes('scenarios=66; independent-session races=25; unexpected deadlocks/timeouts=0'))throw Error('prior fresh combined verdict absent');
 const methods={Enqueue:'basic/races/purge',Orphan:'new/enqueue_cleanup',Claim:'basic/retries/races','Lease/fence':'basic/retries',Begin:'basic/races/begin_recovery','Accepted/rejected/unknown':'outcomes','Retry 1/2':'retries','Retry 3':'retries','Deadline/unusable':'loss_and_recovery/retries','Sender unavailable':'outcomes','Duplicate resolution':'basic/outcomes/retries',Recorder:'outcomes',Recovery:'loss_and_recovery/begin_recovery','Crypto-loss closure':'loss_and_recovery',Purge:'purge/races/purge_cleanup',Cleanup:'purge_cleanup/enqueue_cleanup','Direct owner DML':'negatives',Scrub:'outcomes/loss_and_recovery/retries','Time authority':'begin_recovery',Sequence:'maintenance', 'Guard/epoch':'negatives/maintenance/restart',Fingerprints:'maintenance/restart',Rollback:'maintenance/restart','Atomic maintenance':'restart',Regression:'existing legacy suites'};
 const passes=new Map([
 ['Enqueue|exact duplicate','basic'],['Enqueue|enqueue vs cleanup','enqueue_cleanup'],['Enqueue|post-purge duplicate/new enqueue refusal','purge'],
 ['Claim|PENDING','basic'],['Claim|due retry','retries'],['Claim|non-due retry','retries'],['Claim|SKIP LOCKED','races'],['Claim|concurrent claims','races'],
 ['Begin|One increment','basic'],['Begin|duplicate begin','basic'],['Begin|concurrent begin','races'],['Begin|begin vs lifecycle','races'],['Begin|begin vs expiry','begin_recovery'],['Begin|begin vs recovery','begin_recovery'],
 ['Retry 1/2|Exact 5s/20s arithmetic','retries'],['Retry 1/2|fresh claim/begin','retries'],['Retry 3|Budget exhaustion','retries'],['Retry 3|no fourth send','retries'],['Retry 3|no fabricated challenge class','retries'],
 ['Recorder|True','outcomes'],['Recorder|false','outcomes'],['Recorder|exception','outcomes'],['Recorder|exception rolls back everything','outcomes'],['Recorder|exception followed by expired-SENDING recovery','outcomes'],
 ['Cleanup|FK refusal','purge_cleanup'],['Cleanup|preceding failure-ledger deletion rolls back','purge_cleanup'],['Cleanup|normal recover/purge/cleanup succeeds','purge_cleanup'],
 ['Sequence|exhausted sequence fail-closed','maintenance'],['Sequence|decimal fences above `2^53−1`','maintenance'],
 ['Guard/epoch|Exact singleton','restart'],['Guard/epoch|no application access','negatives'],['Guard/epoch|mutation refusal','negatives'],['Guard/epoch|fresh same-epoch rollback','restart'],['Guard/epoch|epoch mismatch refusal','maintenance'],['Guard/epoch|post-restart rollback refusal','restart'],
 ['Fingerprints|Exact FK delta','postflight'],['Fingerprints|unrelated internal trigger retained','maintenance'],['Fingerprints|FK enabled-state tamper','maintenance'],['Fingerprints|complete postflight fingerprint','postflight'],
 ['Rollback|Fresh unused success','restart'],['Rollback|aborted allocation refusal','maintenance'],['Rollback|later dependencies/body callers','maintenance'],
 ['Atomic maintenance|fresh migration never advances sequence','restart'],['Regression|Existing C3a/C3b/C3c-2 SQL authority/proof suites remain valid','existing legacy suites']
 ]);
 const missing=new Set(['Rollback|populated refusal','Rollback|used-but-purged refusal','Rollback|lock timeout','Atomic maintenance|Lock timeout leaves no partial apply/drop/ACL change','Orphan|explicit supersession under existing limits','Begin|ambiguous acknowledgement','Begin|acknowledgement arriving after provider deadline','Sequence|Concurrent allocations','Sequence|abort gaps']);
 const obligations=derive().map(r=>{const key=r.area+'|'+r.exact_frozen_obligation,status=passes.has(key)?'PASS':missing.has(key)?'MISSING':'PARTIAL';return {...r,scenario_ids:passes.has(key)?['prior66.'+passes.get(key)]:['prior66.'+methods[r.area]],harness_location:'test/postgres/every8dSettingsEmailOutbox'+(passes.get(key)==='restart'||r.area==='Time authority'?'Section36.py':'Concurrency.py')+' :: '+methods[r.area],executed:status!=='MISSING',expected_authority_outcome:r.exact_frozen_obligation+'; required final authority state asserted without protected output',status,evidence_location:status==='MISSING'?null:'docs/agent-run-c3c3-settings-auth-email-outbox.md / prior fresh 66-scenario execution',remaining:status==='PASS'?null:'Needs obligation-specific executable assertion(s); no PASS inferred from source inspection'};});
 const count=s=>obligations.filter(x=>x.status===s).length;
 return {source_contract_sha256:expected,source_section:36,derivation:'Every frozen matrix row, split at every semicolon; compound obligations require all subcases',phase:'initial reconciliation before new tests',prior_execution:{scenarios:66,races:25,evidence_file:priorLog},SECTION36_TOTAL_OBLIGATIONS:obligations.length,SECTION36_EXECUTED:obligations.filter(x=>x.executed).length,SECTION36_PASS:count('PASS'),SECTION36_MISSING:count('MISSING'),SECTION36_PARTIAL:count('PARTIAL'),obligations};
}


function requirements(){
 const map=new Map();const bind=(numbers,...ids)=>{for(const n of numbers)map.set('S36-'+String(n).padStart(3,'0'),[...new Set(ids.flat())]);};
 const basic='baseline.basic',outcomes='baseline.outcomes',retry='baseline.retries',loss='baseline.loss_and_recovery',races='baseline.races',maintenance='baseline.maintenance';
 const identity='enqueue.identity_conflicts',preuse='rollback.fresh_preuse',restart='section36.restart',beginRecovery='section36.begin_recovery',cleanup='section36.enqueue_cleanup';
 const dupFamilies=['accepted','rejected','outcome_unknown','retryable1','retryable2','sender0','sender1','sender2','budget','deadline','unusable','recover_unknown','recover_cancel','recover_expired','recover_retry','begin_cancel','begin_expired','begin_retry'];
 const duplicates=dupFamilies.map(x=>'duplicates.'+x),terminalDuplicates=dupFamilies.filter(x=>!x.startsWith('retryable')).map(x=>'duplicates.'+x),retryDuplicates=['duplicates.retryable1','duplicates.retryable2'];
 const terminalRoutes=[];for(const count of [0,1,2])for(const reason of ['unusable','deadline'])terminalRoutes.push('terminal.begin_LEASED_'+count+'_'+reason);
 for(const [origin,count] of [['PENDING',0],['LEASED',0],['LEASED',1],['LEASED',2],['RETRY_WAIT',1],['RETRY_WAIT',2]])for(const reason of ['unusable','deadline'])terminalRoutes.push('terminal.recover_'+origin+'_'+count+'_'+reason);
 const recorders=['accepted','rejected','outcome_unknown','None','recovery'].flatMap(x=>['False','True'].map(y=>'recorder.mapping_'+x+'_'+y));
 const sender=[0,1,2].flatMap(x=>['False','True'].map(y=>'sender.expiry_'+x+'_'+y));
 const precedence=[1,2,3].map(x=>'retry.precedence_'+x),crypto=[0,1,2].map(x=>'crypto_loss.unusable_'+x);
 const wait=['window','challenge','lease','retention'].map(x=>'time.wait_'+x),units='time.exact_predicate_units',retention='time.retention_equality';
 const seqTamper=['properties','owner','acl','state'].map(x=>'sequence.tamper_'+x),fingerprints=['constraint','owner','acl','body'].map(x=>'fingerprint.'+x);
 const owners=['direct_owner.sending_sender_unavailable','guard.claim_begin','guard.fourth_attempt','guard.purge','guard.enqueue','guard.sending_origins','guard.leased_origins','guard.inactive_PENDING','guard.inactive_RETRY_WAIT'];
 for(const x of ['accepted','rejected','outcome_unknown','not_accepted_retryable'])owners.push('guard.finalize_'+x);
 for(const x of [0,1,2])owners.push('guard.recovery_requeue_'+x);
 for(const x of ['pending','retry_wait','sending'])owners.push('guard.recovery_terminal_'+x);
 for(const x of [0,1])owners.push('guard.begin_unusable_'+x);
 for(const x of ['unusable','deadline'])for(const n of [1,2])owners.push('guard.retry_terminal_'+x+'_'+n);
 for(const [state,counts] of [['PENDING',[0]],['LEASED',[0,1,2]],['SENDING',[1,2,3]],['RETRY_WAIT',[1,2]],['ACCEPTED',[1]],['FAILED_TERMINAL',[1]],['DELIVERY_OUTCOME_UNKNOWN',[1]],['CANCELLED',[0]],['EXPIRED',[0]]])for(const n of counts)owners.push('guard.edges_'+state+'_'+n);
 bind([1],identity,'enqueue.concurrent_duplicate_False','enqueue.concurrent_duplicate_True');bind([2],basic,identity);bind([3],'enqueue.concurrent_duplicate_False','enqueue.concurrent_duplicate_True');bind([4],identity);bind([5],'enqueue.supersession_False','enqueue.supersession_True');bind([6],cleanup);bind([7,8],terminalDuplicates);bind([9,10,11],'orphan.real_supersession');
 bind([12],basic);bind([13,14],retry);bind([15],'claim.deadline','claim.unusable');bind([16],'claim.batch_order','claim.bounded_skip');bind([17,18],races,'claim.bounded_skip');bind([19,20,23],'sequence.concurrent_and_fresh_generation',retryDuplicates,'claim.stale_finalization_False','claim.stale_finalization_True');bind([21],'claim.stale_finalization_False','claim.stale_finalization_True');bind([22],sender,beginRecovery);
 bind([24],basic,'guard.claim_begin');bind([25],basic);bind([26,27],races);bind([28],beginRecovery,'time.wait_challenge','time.wait_window');bind([29],beginRecovery);bind([30],'begin.ambiguous_ack_False','begin.ambiguous_ack_True');bind([31],'begin.late_ack');bind([32],outcomes,'baseline.negatives',recorders,duplicates.slice(0,3));
 bind([33,35,36],retry,retryDuplicates);bind([34],units,retry);bind([37,38,39],retry,precedence,'guard.fourth_attempt');bind([40,42,43],terminalRoutes,precedence);bind([41],units,'time.wait_window','claim.deadline');bind([44],sender,'duplicates.sender0','duplicates.sender1','duplicates.sender2');bind([45],sender,'recorder.mapping_None_False','recorder.mapping_None_True');bind([46,47],sender);bind([48],'direct_owner.sending_sender_unavailable');
 bind([49,52,53],duplicates);bind([50,51],retryDuplicates);bind([54,55],recorders);bind([56,57,58],outcomes);
 bind([59],'guard.recovery_requeue_0','guard.recovery_requeue_1','guard.recovery_requeue_2',terminalRoutes.filter(x=>x.startsWith('terminal.recover_LEASED')));bind([60],'guard.recovery_terminal_sending','recorder.mapping_recovery_False','recorder.mapping_recovery_True');bind([61],terminalRoutes.filter(x=>x.startsWith('terminal.recover')&&x.includes('_0_')));bind([62],terminalRoutes.filter(x=>x.startsWith('terminal.recover')&&!x.includes('_0_')));bind([63],terminalDuplicates,terminalRoutes);
 bind([64,65,66,67],loss,crypto);bind([68],terminalDuplicates);bind([69],units,retention,'baseline.purge','time.wait_retention');bind([70,71],units,retention);bind([72],'purge.duplicate_False','purge.duplicate_True');bind([73],races);bind([74,75,76],races,cleanup);bind([77],owners);bind([78],terminalDuplicates,terminalRoutes,loss,crypto,recorders,precedence);bind([79],units,retention,'begin.late_ack',wait);bind([80,81],wait,beginRecovery);
 bind([82],'sequence.concurrent_and_fresh_generation');bind([83],'sequence.aborted_gap');bind([84,86,101,102],maintenance);bind([85],seqTamper);bind([87],preuse,restart);bind([88,89],'baseline.negatives');bind([90,98,106],preuse,restart);bind([91,92],restart);bind([93],preuse,restart);bind([94,95],maintenance);bind([96],fingerprints);bind([97],preuse);bind([99],'rollback.populated');bind([100],'rollback.used_but_purged');bind([103],seqTamper,fingerprints);bind([104,105],'maintenance.apply_timeout','maintenance.rollback_timeout');bind([107],'regression.all11');
 if(map.size!==107||derive().length!==107)throw Error('107-obligation frozen decomposition changed; stop for review');
 for(const item of derive())if(!map.has(item.id)||!map.get(item.id).length)throw Error('unbound frozen obligation '+item.id);
 return map;
}
function certificate(evidencePath){
 const execution=JSON.parse(fs.readFileSync(evidencePath,'utf8')),bindings=requirements();
 const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
 if(execution.migration_sha256!==digest('supabase/migrations/202610230001_every8d_settings_auth_email_outbox.sql')||execution.harness_sha256!==digest('test/postgres/every8dSettingsEmailOutboxClosure.py'))throw Error('execution is not for current migration/harness');
 for(const [file,hash] of Object.entries(execution.proof_sources_sha256||{}))if(digest(file)!==hash)throw Error('proof source changed after execution: '+file);
 if(!execution.proof_sources_sha256||!execution.cleanup?.regression_resources_zero)throw Error('complete proof-source/regression cleanup evidence absent');
 const receipts=new Map(execution.events.filter(x=>x.executed&&x.status==='PASS').map(x=>[x.scenario_id,x]));
 const obligations=derive().map(item=>{const ids=bindings.get(item.id),found=ids.filter(x=>receipts.has(x)),status=found.length===ids.length?'PASS':found.length?'PARTIAL':'MISSING';return {...item,scenario_ids:ids,harness_locations:[...new Set(found.map(x=>receipts.get(x).harness_location))],executed:found.length===ids.length,expected_authority_outcome:item.exact_frozen_obligation,status,evidence_location:path.relative(root,path.resolve(evidencePath)).replaceAll('\\','/'),executed_assertions:found.flatMap(x=>receipts.get(x).final_authority_assertions),unexecuted_scenario_ids:ids.filter(x=>!receipts.has(x))};});
 const count=status=>obligations.filter(x=>x.status===status).length;
 const result={source_contract_sha256:expected,source_section:36,derivation:'Exact frozen Section-36 table, split at every semicolon; every required executable subcase must have a successful current-run receipt',SECTION36_TOTAL_OBLIGATIONS:107,SECTION36_EXECUTED:obligations.filter(x=>x.executed).length,SECTION36_PASS:count('PASS'),SECTION36_MISSING:count('MISSING'),SECTION36_PARTIAL:count('PARTIAL'),execution:{scenarios:execution.scenarios,races:execution.races,pg_version:execution.pg_version,migration_sha256:execution.migration_sha256,guard_function_fingerprint:execution.guard_function_fingerprint,cleanup:execution.cleanup},proof_method_notes:['Exact timestamp equality is executed against predicates extracted from installed fingerprint-verified SQL with DB-generated T, paired with actual RPC/state and independent-session post-wait proofs; no runtime clock replacement.','A future linked challenge and a valid 24h-retained terminal child cannot coexist under the ten-minute lifetime: the defensive SQL predicate is executed before/equal/after and nearest legal protected DELETE/RPC state is proved.','Purge before retention has no candidate and cannot wait on that candidate; the real old-transaction/parent-wait proof checks the nearest legal ordering and post-lock DB time.'],obligations};
 if(execution.status!=='PASS'||!execution.complete_suite||!execution.cleanup?.harness_backends_zero||!execution.cleanup?.base_databases_zero||execution.scenarios<66||execution.races<25)throw Error('complete clean execution/cleanup verdict absent');
 return result;
}
module.exports={derive,initial,requirements,certificate};
if(require.main===module){
 if(process.argv[2]==='--certificate'){
  const result=certificate(process.argv[3]);const target=process.argv[4]||path.join(root,'docs/every8d-c3c3-section36-coverage-final.json');fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key])=>key.startsWith('SECTION36_')))));
  if(result.SECTION36_MISSING||result.SECTION36_PARTIAL)process.exitCode=1;
 }else{
  const result=initial(process.argv[2]);fs.writeFileSync(path.join(root,'docs/every8d-c3c3-section36-coverage-initial.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({total:result.SECTION36_TOTAL_OBLIGATIONS,previously_pass:result.SECTION36_PASS,missing:result.SECTION36_MISSING,partial:result.SECTION36_PARTIAL}));
 }
}
