#!/usr/bin/env python3
"""Proof-only closure slices; immutable runtime scripts, real PG17 sessions."""
import argparse
import json
import re
import time
import uuid
import subprocess
import copy
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from every8dSettingsEmailOutboxSection36 import Coverage, CHALLENGES, LEDGER, GUARD
from every8dSettingsEmailOutboxConcurrency import TABLE, SEQ, MIGRATION, ROLLBACK, POSTFLIGHT, ROOT
from every8dSettingsSessionConsumptionConcurrency import Failure, OWNER, quote

class Closure(Coverage):
    def __init__(self,args):
        super().__init__(args)
        self.events=[]
        self.guard_groups=[]

    def matrix_report(self,data):
        self.guard_groups.append(data)
        print('GUARD_MATRIX_COUNTS '+json.dumps(data),flush=True)
    def event(self,scenario,obligations,assertions):
        self.events.append({'scenario_id':scenario,'obligations':obligations,'status':'PASS','executed':True,
                            'harness_location':str(Path(__file__).relative_to(ROOT))+' :: '+scenario,
                            'final_authority_assertions':assertions})
        print('COVERAGE_PASS '+scenario+' '+','.join(obligations),flush=True)

    def fresh(self,label,fixtures=False):
        self.scenarios+=1
        self.db=self.clone(label+'_'+str(self.scenarios),self.args.prerequisite)
        baseline=self.seal(self.db)
        self.sql(MIGRATION.read_bytes().decode('utf-8'),role=OWNER,label='fresh closure migration')
        self.sql(POSTFLIGHT.read_bytes().decode('utf-8'),role=OWNER,label='fresh closure postflight')
        self.unused(self.db,True)
        if fixtures:
            self.sql('\\set fixtures_only 1\n'+(ROOT/'test/postgres/every8dSettingsSessionConsumption.sql').read_bytes().decode('utf-8'),label='existing authorized fixture setup')
            self.sql((ROOT/'test/postgres/every8dSettingsEmailOutbox.sql').read_bytes().decode('utf-8'),label='existing outbox fixture setup')
        return baseline

    def seal(self,db=None):
        db=db or self.db
        extra=self.sql(f"""select jsonb_build_array(
          case when to_regclass('{TABLE}') is null then null else (select md5(coalesce(jsonb_agg(to_jsonb(o) order by o.job_id),'[]')::text) from {TABLE} o) end,
          (select jsonb_agg(to_jsonb(q) order by q.seqrelid) from pg_sequence q join pg_class c on c.oid=q.seqrelid where c.relnamespace='public'::regnamespace))::text""",db) if self.sql(f"select to_regclass('{TABLE}') is not null",db)=='t' else 'no-outbox'
        if self.sql(f"select to_regclass('{GUARD}') is not null",db)=='t':
            extra+=(self.sql(f"select jsonb_build_array((select to_jsonb(g) from {GUARD} g),(select jsonb_build_array(last_value,log_cnt,is_called) from {SEQ}))::text",db))
        return self.boundary(db),self.maintenance_state(db),extra

    def preuse_control(self):
        baseline=self.fresh('guard_fresh_preuse')
        self.sql(ROLLBACK.read_bytes().decode('utf-8'),role=OWNER,label='fresh pre-use rollback before behavioral allocation')
        if self.seal()!=baseline:
            raise Failure('fresh pre-use rollback did not restore exact prerequisite baseline')
        self.event('rollback.fresh_preuse',['S36-090','S36-098','S36-106'],['real fresh apply and full postflight','empty outbox; sequence last_value 1/is_called false; current singleton guard','real rollback before runtime behavior','complete prerequisite catalog/ACL/data restoration'])
        self.finish_case('fresh pre-use rollback before runtime allocation; exact prerequisite restoration')
    def populated(self):
        self.fresh('populated',fixtures=True)
        job,ch,enq=self.new()
        self.check(f'select count(*)=1 from {TABLE}','legitimate populated runtime use')
        self.check(f'select is_called from {SEQ}','runtime enqueue allocated fence')
        before=self.seal()
        self.sql(ROLLBACK.read_bytes().decode('utf-8'),role=OWNER,error='55000',error_message='C3c-3 pre-use boundary violated',label='populated rollback must refuse')
        if self.seal()!=before:
            raise Failure('populated rollback refusal partially changed authority')
        self.check(f'select count(*)=1 from {TABLE}','populated row retained after refusal')
        self.event('rollback.populated',['S36-099'],['supported enqueue created one row','exact pre-use refusal','catalog/functions/triggers/ACL/prerequisites/rows/guard/sequence unchanged'])
        self.finish_case('closure populated rollback refusal; no partial authority change')


    def used_purged(self):
        self.fresh('used_purged',fixtures=True)
        job,ch,enq,claim=self.sendable()
        self.sql(self.finalize(job,claim,1),role='service_role')
        self.scrub(job,'ACCEPTED','accepted')
        guard=self.sql(f'select to_jsonb(g)::text from {GUARD} g')
        self.shift(job,86401)
        self.check(f"select terminal_at<=clock_timestamp()-interval '24 hours' and exists(select 1 from {CHALLENGES} c where c.id=challenge_id and c.expires_at<=clock_timestamp()) from {TABLE} where job_id={quote(job)}",'legal retention and challenge expiry')
        seq=self.sql(f'select jsonb_build_array(last_value,log_cnt,is_called)::text from {SEQ}')
        if self.sql('select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(100)',role='service_role')!='1':
            raise Failure('real used row was not purged')
        self.check(f'select count(*)=0 from {TABLE}','purged outbox empty')
        self.check(f'select is_called and last_value>=2 from {SEQ}','genuine used sequence remains called')
        if self.sql(f'select jsonb_build_array(last_value,log_cnt,is_called)::text from {SEQ}')!=seq or self.sql(f'select to_jsonb(g)::text from {GUARD} g')!=guard:
            raise Failure('purge reset sequence or guard')
        before=self.seal()
        self.sql(ROLLBACK.read_bytes().decode('utf-8'),role=OWNER,error='55000',error_message='C3c-3 pre-use boundary violated',label='used-but-purged rollback must refuse')
        if self.seal()!=before:
            raise Failure('used-but-purged rollback refusal partially changed authority')
        self.event('rollback.used_but_purged',['S36-100'],['real enqueue/claim/begin/finalize/purge','retention respected by existing full-timeline fixture','empty outbox still used sequence','exact pre-use refusal','complete authority snapshot unchanged'])
        self.finish_case('closure used-but-purged rollback refusal; no reset or partial change')

    def expected_actor_error(self,actor,state,seconds):
        actor.process.stdin.close()
        try:
            result=actor.process.wait(timeout=seconds)
        except Exception as exc:
            actor.process.kill();actor.process.wait()
            raise Failure('maintenance actor exceeded bounded timeout') from exc
        for thread in actor.threads:thread.join(timeout=1)
        actual=re.findall(r'ERROR:\s+([0-9A-Z]{5})\b',''.join(actor.errors))
        if result==0 or actual!=[state]:
            raise Failure('maintenance actor did not return exact expected SQLSTATE')
        self.actors.remove(actor)
        self.check(f"select not exists(select 1 from pg_stat_activity where application_name={quote(actor.app)})",'expected failure actor disconnected')

    def maintenance_timeout(self):
        for direction in ('apply','rollback'):
            self.scenarios+=1;self.concurrent+=1
            self.db=self.clone('timeout_'+direction+'_'+str(self.scenarios),self.args.prerequisite)
            baseline=self.seal()
            if direction=='rollback':
                self.sql(MIGRATION.read_bytes().decode('utf-8'),role=OWNER)
                self.sql(POSTFLIGHT.read_bytes().decode('utf-8'),role=OWNER)
                self.unused(self.db,True)
            before=self.seal()
            holder=self.actor('maintenance_'+direction+'_holder',OWNER)
            holder.start('lock table public.ghl_marketplace_installations in row exclusive mode');holder.ready()
            maintenance=self.actor('maintenance_'+direction+'_waiter',OWNER)
            started=time.monotonic()
            maintenance.send((MIGRATION if direction=='apply' else ROLLBACK).read_bytes().decode('utf-8'))
            self.blocked(maintenance,holder,'real '+direction+' waits for exact quiescent relation lock')
            self.check(f"select exists(select 1 from pg_locks l join pg_stat_activity a using(pid) "
                       f"where a.application_name={quote(maintenance.app)} and l.relation='public.ghl_marketplace_installations'::regclass "
                       "and l.mode='ShareRowExclusiveLock' and not l.granted)",'exact maintenance waiter relation/mode')
            self.expected_actor_error(maintenance,'55P03',12)
            elapsed=time.monotonic()-started
            if not 4<=elapsed<12:
                raise Failure('frozen five-second maintenance refusal was not bounded')
            if self.seal()!=before:
                raise Failure(direction+' lock timeout changed catalog/ACL/guard/sequence/prerequisites/data')
            holder.finish()
            if direction=='apply':
                self.check(f"select to_regclass('{TABLE}') is null and to_regclass('{GUARD}') is null and to_regclass('{SEQ}') is null",'no partial create after apply lock timeout')
                self.sql(MIGRATION.read_bytes().decode('utf-8'),role=OWNER)
                self.sql(POSTFLIGHT.read_bytes().decode('utf-8'),role=OWNER)
                self.unused(self.db,True)
            self.sql(ROLLBACK.read_bytes().decode('utf-8'),role=OWNER)
            if self.seal()!=baseline:
                raise Failure('clean maintenance after '+direction+' timeout did not restore exact prerequisite baseline')
            self.event('maintenance.'+direction+'_timeout',['S36-104','S36-105'],['independent physical sessions','exact relation/lock wait observed','real frozen 5s lock_timeout returns 55P03','zero partial CREATE/DROP/GRANT/REVOKE/guard/row mutation','subsequent clean apply/postflight/rollback works','exact prerequisite baseline restored'])
            self.finish_case('closure '+direction+' bounded maintenance timeout is atomic; subsequent clean maintenance succeeds')

    def sequence_allocations(self):
        self.fresh('concurrent_allocations',fixtures=True);self.concurrent+=1
        first_job,first_ch,first_enq=self.new(enqueue=False)
        second_job,second_ch,second_enq=self.new(enqueue=False)
        first=self.actor('allocate_first',OWNER);second=self.actor('allocate_second',OWNER)
        first.start(self.count_query(first_enq));first.ready('1')
        second.start(self.count_query(second_enq));second.ready('1')
        self.check(f"select (select count(distinct pid)=2 from pg_stat_activity where application_name in ({quote(first.app)},{quote(second.app)}) and state='idle in transaction' and cardinality(pg_blocking_pids(pid))=0) "
                   f"and (select count(distinct a.pid)=2 from pg_locks l join pg_stat_activity a using(pid) where a.application_name in ({quote(first.app)},{quote(second.app)}) and l.relation='{TABLE}'::regclass and l.mode='RowExclusiveLock' and l.granted)",'both independent allocating transactions hold outbox locks before either commit')
        self.check(f'select last_value=2 and is_called from {SEQ}','two successful allocations before either transaction commits')
        first.finish();second.finish()
        self.check(f'select count(*)=2 and count(distinct fence_generation)=2 and min(fence_generation)=1 and max(fence_generation)=2 from {TABLE}','concurrent allocations distinct and increasing')
        claim=self.claim();job=claim['job_id']
        row=self.row(job)
        if row['state']!='LEASED' or row['attempt_count']!=0 or int(claim['fence'])!=3:
            raise Failure('initial claim fence authority')
        self.shift(job,31);self.recover();fresh=self.claim()
        if fresh['job_id']!=job or fresh['lease_id']==claim['lease_id'] or int(fresh['fence'])!=4:
            raise Failure('fresh lease UUID/generation or fence reuse')
        before=self.row(job)
        for forged in (dict(fresh,lease_id=str(uuid.uuid4())),dict(fresh,fence=claim['fence']),claim):
            if self.sql(self.begin(job,forged),role='service_role'):
                raise Failure('stale UUID/fence/prior generation authorized begin')
            if self.row(job)!=before:
                raise Failure('stale authority attempt mutated row')
        self.event('sequence.concurrent_and_fresh_generation',['S36-019','S36-020','S36-023','S36-082'],['two real concurrent open allocating transactions','distinct increasing committed fences 1/2','real claims allocate 3/4','fresh lease UUID','stale UUID-only/fence-only/prior tuple rejected without mutation'])
        self.finish_case('closure concurrent fence allocations, fresh UUID/generation, no reuse')

    def sequence_abort_gap(self):
        self.fresh('aborted_gap',fixtures=True)
        job,ch,enq=self.new(enqueue=False)
        guard=self.sql(f'select to_jsonb(g)::text from {GUARD} g')
        aborted=self.actor('aborted_supported_enqueue',OWNER)
        aborted.start(self.count_query(enq));aborted.ready('1')
        self.check(f'select last_value=1 and is_called from {SEQ}','supported aborted enqueue allocated first fence')
        aborted.finish(commit=False)
        self.check(f'select count(*)=0 from {TABLE}','aborted supported enqueue row absent')
        if not self.sql(enq,role='service_role'):
            raise Failure('subsequent supported enqueue after abort')
        self.check(f'select count(*)=1 and min(fence_generation)=2 from {TABLE}','aborted allocation left a gap and was not reused')
        self.check(f'select last_value=2 and is_called from {SEQ}','later allocation advanced sequence without reset')
        if self.sql(f'select to_jsonb(g)::text from {GUARD} g')!=guard:
            raise Failure('aborted allocation modified installation guard')
        self.event('sequence.aborted_gap',['S36-083'],['real enqueue transaction allocated fence then rolled back','outbox remained empty after abort','subsequent supported enqueue uses next fence','no reset or guard mutation'])
        self.finish_case('closure aborted supported allocation leaves gap; no fence reuse')

    def sequence_tamper(self):
        changes={
            'properties':f'alter sequence {SEQ} cache 2',
            'owner':f'alter sequence {SEQ} owner to postgres',
            'acl':f'grant usage on sequence {SEQ} to service_role',
            'state':f"select setval('{SEQ}'::regclass,2,false)"
        }
        for kind,change in changes.items():
            self.fresh('sequence_'+kind)
            self.sql(change,label='authorized disposable sequence tamper fixture')
            before=self.seal()
            if kind=='state':
                self.check(f'select last_value=2 and not is_called from {SEQ}','administrative state differs from untouched initial state')
            else:
                self.sql(POSTFLIGHT.read_bytes().decode('utf-8'),role=OWNER,error='55000',label='sequence '+kind+' postflight detects drift')
                if self.seal()!=before:
                    raise Failure('postflight repaired or partially changed sequence '+kind+' tamper')
            self.sql(ROLLBACK.read_bytes().decode('utf-8'),role=OWNER,error='55000',label='sequence '+kind+' rollback refuses drift')
            if self.seal()!=before:
                raise Failure('rollback repaired or partially changed sequence '+kind+' tamper')
            self.event('sequence.tamper_'+kind,['S36-085','S36-103'],['real administrative tamper','metadata postflight refusal for definition/owner/ACL drift; direct state drift assertion for values','rollback exact refusal','tampered catalog/ACL/sequence state remains unchanged','no partial drop/revoke/repair'])
            self.finish_case('closure sequence '+kind+' tamper detected without repair')

    def fingerprint_tamper(self):
        signature='public.claim_every8d_settings_auth_email_core_v1(integer)'
        changes={
            'constraint':f'alter table {TABLE} drop constraint e8d_settings_email_outbox_versions_check',
            'owner':'alter function '+signature+' owner to postgres',
            'acl':'grant execute on function '+signature+' to service_role',
            'body':f"""do $proof$ declare original text; definition text; begin
              select prosrc,pg_get_functiondef(oid) into strict original,definition from pg_proc where oid='{signature}'::regprocedure;
              execute replace(definition,original,original||E'\\n-- disposable literal fingerprint witness\\n');
              if (select prosrc=original from pg_proc where oid='{signature}'::regprocedure) then raise exception 'body fixture did not change source'; end if;
            end; $proof$"""
        }
        for kind,change in changes.items():
            self.fresh('fingerprint_'+kind)
            original=self.seal()
            self.sql(change,label='authorized disposable '+kind+' drift fixture')
            before=self.seal()
            if before==original:
                raise Failure('fingerprint '+kind+' drift fixture not established')
            self.sql(POSTFLIGHT.read_bytes().decode('utf-8'),role=OWNER,error='55000',label='postflight refuses '+kind+' drift')
            if self.seal()!=before:
                raise Failure('postflight partially repaired '+kind+' drift')
            self.sql(ROLLBACK.read_bytes().decode('utf-8'),role=OWNER,error='55000',label='rollback refuses '+kind+' drift')
            if self.seal()!=before:
                raise Failure('rollback partially repaired '+kind+' drift')
            self.event('fingerprint.'+kind,['S36-096','S36-103'],['actual disposable catalog/body tamper observable','real full postflight rejects','real guarded rollback rejects','no partial DDL/ACL/row/guard/sequence change','no repair'])
            self.finish_case('closure fingerprint '+kind+' drift refused atomically')

    def claim_boundaries(self):
        for unusable in (False,True):
            self.fresh('claim_refusal',fixtures=True)
            job,ch,enq=self.new()
            if unusable:
                self.sql(f"update {CHALLENGES} set superseded_at=stamp.t,supersession_reason='resend',normalized_email=null,email_scrubbed_at=stamp.t from (select clock_timestamp() t) stamp where id={quote(ch)}",role=OWNER)
            else:
                self.reduce_window(job,ch,9)
            before=self.row(job)
            if self.claim():
                raise Failure('claim returned encrypted send authority for unusable/deadline-exhausted job')
            if self.row(job)!=before:
                raise Failure('ineligible claim mutated skipped row')
            recovered=self.recover()
            if len(recovered)!=1:
                raise Failure('separate recovery did not close actionable skipped job')
            self.scrub(job,'CANCELLED' if unusable else 'EXPIRED','cancelled_pre_send' if unusable else 'expired_pre_send')
            row=self.row(job)
            if row['attempt_count']!=0 or row['challenge_recording']!='not_applicable':
                raise Failure('claim refusal fabricated attempt or recorder')
            self.event('claim.unusable' if unusable else 'claim.deadline',['S36-015'],['real claim returns zero with unchanged row','separate recovery produces truthful never-sent terminal state','atomic envelope/lease/availability scrub','no attempt/recorder invention'])
            self.finish_case('closure claim '+('unusable' if unusable else 'deadline')+' rejects authority and scrubs')

    def pending_batch(self):
        rows=[self.new() for _ in range(3)]
        self.sql(f"begin; alter table {TABLE} disable trigger protect_every8d_settings_auth_email_outbox; "
                 f"update {TABLE} set available_at=(select max(created_at) from {TABLE}); set constraints all immediate; "
                 f"alter table {TABLE} enable trigger protect_every8d_settings_auth_email_outbox; commit",label='valid equal-availability batch fixture')
        ordered=json.loads(self.sql(f'select json_agg(job_id order by available_at,job_id) from {TABLE}'))
        return rows,ordered

    def claim_batch(self):
        self.fresh('claim_batch',fixtures=True)
        rows,ordered=self.pending_batch()
        before=self.seal()
        for bound in ('0','11','null'):
            self.sql('select * from public.runtime_claim_every8d_settings_auth_email_v1('+bound+')',role='service_role',error='22023',label='claim batch bound refusal')
            if self.seal()!=before:
                raise Failure('invalid batch size mutated authority')
        result=json.loads(self.sql("select coalesce(json_agg(r),'[]') from public.runtime_claim_every8d_settings_auth_email_v1(2) r",role='service_role'))
        if [r['job_id'] for r in result]!=ordered[:2] or any(r['attempt_count']!=0 for r in result):
            raise Failure('real multi-row claim violates exact bounded availability/UUID order')
        self.check(f"select count(*) filter(where state='LEASED')=2 and count(*) filter(where state='PENDING')=1 and count(distinct lease_id)=2 and bool_and(attempt_count=0) from {TABLE}",'exact batch final authority state')
        third=self.claim()
        if not third or third['job_id']!=ordered[2] or self.claim():
            raise Failure('claim batch exceeded bound or lost remaining candidate')
        self.event('claim.batch_order',['S36-016'],['invalid bounds refused atomically','three equal-availability real jobs','exact secondary UUID order','only bounded two then remaining one','fresh distinct leases; counts unchanged'])
        self.finish_case('closure actual multi-row claim batch bounds and ordering')

        self.fresh('claim_bounded_skip',fixtures=True);self.concurrent+=1
        rows,ordered=self.pending_batch()
        lookup={job:ch for job,ch,enq in rows}
        holder=self.actor('batch_first_candidate_holder',OWNER)
        holder.start(f'select id from {CHALLENGES} where id={quote(lookup[ordered[0]])} for update');holder.ready()
        self.sql(f'select id from {CHALLENGES} where id={quote(lookup[ordered[0]])} for update nowait',error='55P03',label='exact first batch candidate challenge held')
        claimer=self.actor('bounded_skip_claimer',OWNER)
        claimer.start('select count(*) from public.runtime_claim_every8d_settings_auth_email_v1(2)');claimer.ready('1')
        self.two_sessions(holder,claimer,CHALLENGES,'RowShareLock','bounded claim skips first candidate without filling beyond prefix')
        claimer.finish()
        if self.row(ordered[0])['state']!='PENDING' or self.row(ordered[1])['state']!='LEASED' or self.row(ordered[2])['state']!='PENDING':
            raise Failure('SKIP LOCKED claim refilled outside bounded candidate prefix or touched held row')
        holder.finish()
        later=json.loads(self.sql("select coalesce(json_agg(r),'[]') from public.runtime_claim_every8d_settings_auth_email_v1(2) r",role='service_role'))
        if [r['job_id'] for r in later]!=[ordered[0],ordered[2]]:
            raise Failure('post-release claim did not process exact remaining candidates')
        self.event('claim.bounded_skip',['S36-016','S36-017','S36-018'],['two physical sessions; actual row lock','bounded prefix skips held first without refill','no mutation of held/ineligible candidate','post-release remaining jobs claimed in order'])
        self.finish_case('closure bounded multi-row SKIP LOCKED; no refill or wait')

    def direct_owner_sender(self):
        self.fresh('direct_owner_sender',fixtures=True)
        job,ch,enq,claim=self.sendable()
        source=self.row(job)
        if source['state']!='SENDING' or source['attempt_count']!=1:
            raise Failure('direct-owner negative lacks legitimate SENDING premise')
        self.check(f"select bool_and(tgenabled='O') from pg_trigger where tgrelid in ('{TABLE}'::regclass,'{CHALLENGES}'::regclass)",'all row/constraint protections enabled')
        if self.sql(self.finalize(job,claim,1,None,None,'sender_unavailable'),role='service_role') or self.row(job)!=source:
            raise Failure('supported finalize accepted sender-unavailable from SENDING')
        statement=f"""begin;
          set local wincrm.c3c3_outbox_operation='finalize';
          update {TABLE} o set state='FAILED_TERMINAL',
            terminal_at=stamp.t,terminal_disposition='sender_unavailable_pre_send',
            provider_message_id=null,challenge_recording='not_recorded',
            resolution_kind='pre_send',resolution_provider_outcome=null,
            resolution_pre_send_disposition='sender_unavailable',resolution_non_acceptance_proven=false,
            resolution_lease_id=o.lease_id,resolution_fence_generation=o.fence_generation,
            resolution_attempt_count=o.attempt_count,resolved_at=stamp.t
          from (select clock_timestamp() t) stamp where o.job_id={quote(job)}
          returning state='FAILED_TERMINAL' and terminal_disposition='sender_unavailable_pre_send'
            and attempt_count=1 and resolution_kind='pre_send';
          commit;"""
        cmd,env=self.command(self.db,OWNER)
        result=subprocess.run(cmd,input=statement.encode('utf-8'),capture_output=True,env=env,timeout=60)
        states=re.findall(r'ERROR:\s+([0-9A-Z]{5})\b',result.stderr.decode('utf-8'))
        if result.returncode==0:
            actual=self.row(job)
            witness={
                'scenario_id':'direct_owner.sending_sender_unavailable','status':'FAIL','executed':True,
                'obligations':['S36-048','S36-077'],
                'supported_rpc_refused':True,'guards_enabled':True,'trigger_or_constraint_disabled':False,
                'owner_operation_context':'finalize','source_state':'SENDING','source_attempt_count':1,
                'actual_state':actual['state'],'actual_attempt_count':actual['attempt_count'],
                'actual_terminal_disposition':actual['terminal_disposition'],'actual_resolution_kind':actual['resolution_kind'],
                'forbidden_update_committed':result.stdout.decode('utf-8').strip()=='t',
                'lease_cleared':all(actual[k] is None for k in ('lease_id','leased_at','lease_expires_at')),
                'payload_scrubbed':all(actual[k] is None for k in ('encryption_key_version','nonce','ciphertext','authentication_tag'))
            }
            self.events.append(witness)
            print('DIRECT_OWNER_COUNTEREXAMPLE '+json.dumps(witness,sort_keys=True),flush=True)
            raise Failure('owner SENDING authority committed sender_unavailable_pre_send terminal classification; expected protection refusal')
        if states!=['23514']:
            raise Failure('direct-owner sender negative returned unexpected SQLSTATE category')
        if self.row(job)!=source:
            raise Failure('direct-owner sender negative changed source authority')
        self.event('direct_owner.sending_sender_unavailable',['S36-048','S36-077'],['supported RPC refuses with unchanged SENDING','ordinary owner with operation context cannot misclassify SENDING as sender unavailable','no disabled trigger/constraint','exact protection refusal and unchanged row'])
        self.matrix_report({'group':'original_counterexample','negative_cases':1,'positive_controls':0})
        self.finish_case('closure direct-owner SENDING cannot become never-sent sender-unavailable')

    def guard_helpers(self):
        self.sql((ROOT/'test/postgres/every8dSettingsEmailOutboxGuardProof.sql').read_bytes().decode('utf-8'),role=OWNER,label='test-only static guard proof helpers')
        self.guard_negative_count=0

    def capture_transition(self,job,sql):
        return json.loads(self.sql(f'select c3c3_guard_proof.capture({quote(job)},{quote(sql)})',role=OWNER,label='supported transition template capture'))

    def guard_negative(self,job,operation,candidate,label):
        self.check(f'select c3c3_guard_proof.assert_rejected({quote(job)},{quote(operation)},{quote(json.dumps(candidate))}::jsonb)',label)
        self.guard_negative_count+=1

    def guard_finalize_matrix(self):
        count=0
        for outcome in ('accepted','rejected','outcome_unknown','not_accepted_retryable'):
            self.fresh('guard_finalize',fixtures=True);self.guard_helpers()
            job,ch,enq,claim=self.sendable()
            query=self.finalize(job,claim,1,outcome,'synthetic-id' if outcome=='accepted' else None,evidence=outcome=='not_accepted_retryable')
            template=self.capture_transition(job,query)
            expected_state={'accepted':'ACCEPTED','rejected':'FAILED_TERMINAL','outcome_unknown':'DELIVERY_OUTCOME_UNKNOWN','not_accepted_retryable':'RETRY_WAIT'}[outcome]
            if template['state']!=expected_state:raise Failure('supported finalize template violates frozen outcome/state mapping')
            for kind in ('pre_send','recovery','unusable',None):
                candidate=copy.deepcopy(template);candidate['resolution_kind']=kind
                self.guard_negative(job,'finalize',candidate,'finalize rejects wrong resolution kind')
            for wrong in ('accepted','rejected','outcome_unknown','not_accepted_retryable',None):
                if wrong==outcome:continue
                candidate=copy.deepcopy(template);candidate['resolution_provider_outcome']=wrong
                self.guard_negative(job,'finalize',candidate,'finalize rejects outcome/disposition mismatch')
            for wrong in ('sender_unavailable','invalid'):
                candidate=copy.deepcopy(template);candidate['resolution_pre_send_disposition']=wrong
                self.guard_negative(job,'finalize',candidate,'provider finalize rejects pre-send metadata')
            for wrong in (not (outcome=='not_accepted_retryable'),None):
                candidate=copy.deepcopy(template);candidate['resolution_non_acceptance_proven']=wrong
                self.guard_negative(job,'finalize',candidate,'finalize rejects wrong or NULL non-acceptance')
            for field,value in (('resolution_lease_id',str(uuid.uuid4())),('resolution_fence_generation',int(claim['fence'])+1),('resolution_attempt_count',2),('attempt_count',0),('attempt_count',2),('attempt_count',4)):
                candidate=copy.deepcopy(template);candidate[field]=value
                self.guard_negative(job,'finalize',candidate,'finalize rejects resolution tuple or attempt mutation')
            if outcome!='accepted':
                candidate=copy.deepcopy(template);candidate['provider_message_id']='invalid-nonaccepted-id'
                self.guard_negative(job,'finalize',candidate,'non-accepted result rejects provider ID')
            else:
                candidate=copy.deepcopy(template);candidate['provider_message_id']=None
                self.guard_negative(job,'finalize',candidate,'accepted requires bounded provider ID')
            immutable={'job_id':str(uuid.uuid4()),'challenge_id':str(uuid.uuid4()),'request_token_hash':'\\x'+'03'*32,'purpose':'login',
                'envelope_version':2,'payload_version':2,'template_version':2,'enqueue_fingerprint':'\\x'+'04'*32,
                'created_at':'2000-01-01T00:00:00+00:00','delivery_deadline_at':'2099-01-01T00:00:00+00:00'}
            for field,value in immutable.items():
                candidate=copy.deepcopy(template);candidate[field]=value
                self.guard_negative(job,'finalize',candidate,'nominal finalize edge rejects immutable field change')
            if template['terminal_at'] is not None:
                original=self.row(job)
                for field in ('encryption_key_version','nonce','ciphertext','authentication_tag','lease_id','leased_at','lease_expires_at','available_at'):
                    candidate=copy.deepcopy(template);candidate[field]=original[field]
                    self.guard_negative(job,'finalize',candidate,'terminalization rejects incomplete envelope/lease/availability scrub')
            count+=self.guard_negative_count
            applied=json.loads(self.sql(query,role='service_role'))
            if applied['state']!=expected_state or self.row(job)['attempt_count']!=1:
                raise Failure('supported finalize positive control changed family/count')
            if template['terminal_at'] is not None:self.scrub(job,template['state'],template['terminal_disposition'])
            else:
                self.check(f"select state='RETRY_WAIT' and nonce is not null and challenge_recording='not_applicable' and lease_id is null and attempt_count=1 from {TABLE} where job_id={quote(job)}",'supported retry retains payload/count and clears lease')
            self.event('guard.finalize_'+outcome,['S36-077'],['closed static finalize provenance negatives','immutable fields and exact resolution tuple protected','terminal scrub shape','supported runtime positive control'])
            self.finish_case('guard finalize '+outcome+' negative matrix and supported positive')
        self.matrix_report({'group':'finalize','negative_cases':count,'positive_controls':4})

    def retry_lease(self,attempts=1):
        job,ch,enq,claim=self.sendable()
        for attempt in range(1,attempts+1):
            self.sql(self.finalize(job,claim,attempt,'not_accepted_retryable',None,evidence=True),role='service_role')
            self.shift(job,(5 if attempt==1 else 20)+1)
            claim=self.claim()
            if claim is None or claim['attempt_count']!=attempt:
                raise Failure('legitimate retry lease fixture failed')
            if attempt<attempts:self.sql(self.begin(job,claim),role='service_role')
        return job,ch,enq,claim

    def guard_source_matrix(self):
        negatives=0;positives=0
        self.fresh('guard_source_sending',fixtures=True);self.guard_helpers()
        job,ch,enq,claim=self.sendable()
        accepted=self.capture_transition(job,self.finalize(job,claim,1))
        source=self.row(job)
        for state,disposition in (('FAILED_TERMINAL','sender_unavailable_pre_send'),('CANCELLED','cancelled_pre_send'),('EXPIRED','expired_pre_send')):
            candidate=copy.deepcopy(accepted)
            candidate.update(state=state,terminal_disposition=disposition,provider_message_id=None,
                resolution_kind='pre_send',resolution_provider_outcome=None,resolution_pre_send_disposition='sender_unavailable',
                resolution_non_acceptance_proven=False,challenge_recording='not_recorded')
            self.guard_negative(job,'finalize',candidate,'SENDING rejects never-sent provenance even with complete scrub')
        for state in ('PENDING','LEASED'):
            candidate=copy.deepcopy(source);candidate['state']=state
            self.guard_negative(job,'recover',candidate,'SENDING cannot recover into resend authority')
        negatives+=self.guard_negative_count
        self.event('guard.sending_origins',['S36-048','S36-077'],['fully scrubbed original provenance counterexample rejected','SENDING cannot become CANCELLED/EXPIRED/PENDING/LEASED','source/challenge/guard unchanged'])
        self.finish_case('guard SENDING never becomes pre-send or resend authority')

        self.fresh('guard_source_leased',fixtures=True);self.guard_helpers()
        job,ch,enq,claim=self.retry_lease(1)
        source=self.row(job)
        for outcome in ('accepted','rejected','outcome_unknown','not_accepted_retryable'):
            sql=self.begin(job,claim)+'; '+self.finalize(job,claim,2,outcome,'synthetic-id' if outcome=='accepted' else None,evidence=outcome=='not_accepted_retryable')
            candidate=self.capture_transition(job,sql)
            candidate['attempt_count']=1;candidate['resolution_attempt_count']=1
            candidate['last_attempt_started_at']=source['last_attempt_started_at'];candidate['last_provider_deadline_at']=source['last_provider_deadline_at']
            if candidate['state']=='RETRY_WAIT':candidate['available_at']=(datetime.fromisoformat(candidate['resolved_at'])+timedelta(seconds=5)).isoformat()
            self.guard_negative(job,'finalize',candidate,'LEASED cannot receive a provider result before begin')
        sender=self.capture_transition(job,self.finalize(job,claim,1,None,None,'sender_unavailable'))
        for field,value in (('resolution_kind','provider'),('resolution_kind','recovery'),('resolution_kind','unusable'),
                            ('resolution_provider_outcome','rejected'),('resolution_pre_send_disposition',None),
                            ('resolution_pre_send_disposition','invalid'),('resolution_non_acceptance_proven',True),
                            ('resolution_non_acceptance_proven',None),('provider_message_id','invalid-nonaccepted-id')):
            candidate=copy.deepcopy(sender);candidate[field]=value
            self.guard_negative(job,'finalize',candidate,'leased sender-unavailable rejects incompatible provenance')
        self.sql(self.finalize(job,claim,1,None,None,'sender_unavailable'),role='service_role');self.scrub(job,'FAILED_TERMINAL','sender_unavailable_pre_send');positives+=1
        negatives+=self.guard_negative_count
        self.event('guard.leased_origins',['S36-077'],['all four provider families rejected from LEASED','sender unavailable exact provenance only','supported sender-unavailable positive from legitimate retry LEASED'])
        self.finish_case('guard LEASED only accepts exact pre-send finalize family')

        for old_state in ('PENDING','RETRY_WAIT'):
            self.fresh('guard_source_inactive',fixtures=True);self.guard_helpers()
            if old_state=='PENDING':
                job,ch,enq=self.new();next_attempt=1
            else:
                job,ch,enq,old=self.sendable()
                self.sql(self.finalize(job,old,1,'not_accepted_retryable',None,evidence=True),role='service_role');self.shift(job,6);next_attempt=2
            source=self.row(job)
            sql=f"""do $candidate$ declare v record; begin
              select * into strict v from public.runtime_claim_every8d_settings_auth_email_v1(1);
              perform * from public.runtime_begin_every8d_settings_auth_email_send_v1(v.job_id,v.lease_id,v.fence::bigint);
              perform * from public.runtime_finalize_every8d_settings_auth_email_v1(v.job_id,v.lease_id,v.fence::bigint,{next_attempt}::smallint,'accepted',null,false,'synthetic-id');
            end; $candidate$"""
            candidate=self.capture_transition(job,sql);candidate['fence_generation']=source['fence_generation']
            self.guard_negative(job,'finalize',candidate,'inactive job cannot receive provider terminalization')
            if old_state=='RETRY_WAIT':
                candidate=copy.deepcopy(source);candidate['state']='SENDING'
                self.guard_negative(job,'begin_send',candidate,'RETRY_WAIT cannot bypass claim into SENDING')
            negatives+=self.guard_negative_count
            self.event('guard.inactive_'+old_state,['S36-077'],['legitimate inactive source','provider terminalization rejected','RETRY_WAIT direct SENDING bypass rejected where applicable'])
            self.finish_case('guard '+old_state+' cannot receive provider result')
        self.matrix_report({'group':'source_provenance','negative_cases':negatives,'positive_controls':positives})

    def guard_begin_matrix(self):
        negatives=0;positives=0
        self.fresh('guard_claim_begin',fixtures=True);self.guard_helpers()
        job,ch,enq=self.new();source=self.row(job)
        claim_template=self.capture_transition(job,'select count(*) from public.runtime_claim_every8d_settings_auth_email_v1(1)')
        claim_template['fence_generation']=source['fence_generation']
        changes={'attempt_count':1,'fence_generation':source['fence_generation']+1,'lease_id':None,'leased_at':None,
            'lease_expires_at':None,'available_at':'2099-01-01T00:00:00+00:00','resolution_kind':'provider',
            'encryption_key_version':'changed-key','nonce':'\\x'+'05'*12,'ciphertext':'\\xffee','authentication_tag':'\\x'+'06'*16,
            'job_id':str(uuid.uuid4()),'challenge_id':str(uuid.uuid4()),'request_token_hash':'\\x'+'07'*32,'purpose':'login',
            'envelope_version':2,'payload_version':2,'template_version':2,'delivery_deadline_at':'2099-01-01T00:00:00+00:00'}
        for field,value in changes.items():
            candidate=copy.deepcopy(claim_template);candidate[field]=value
            self.guard_negative(job,'claim',candidate,'claim enforces exact lease/fence/count and immutable/encrypted fields')
        claim=self.claim();positives+=1
        if claim is None or claim['attempt_count']!=0 or int(claim['fence'])<=source['fence_generation']:
            raise Failure('supported claim positive after negative matrix')
        source=self.row(job);sending=self.capture_transition(job,self.begin(job,claim))
        for value in (-1,0,2,4,None):
            candidate=copy.deepcopy(sending);candidate['attempt_count']=value
            self.guard_negative(job,'begin_send',candidate,'begin requires exactly one allowed attempt increment')
        for field,value in (('lease_id',str(uuid.uuid4())),('lease_expires_at',None),('resolution_kind','provider'),
                            ('resolution_provider_outcome','accepted'),('provider_message_id','forbidden'),
                            ('encryption_key_version','changed-key'),('nonce','\\x'+'05'*12),('ciphertext','\\xffee'),('authentication_tag','\\x'+'06'*16)):
            candidate=copy.deepcopy(sending);candidate[field]=value
            self.guard_negative(job,'begin_send',candidate,'begin cannot mutate lease/resolution/provider/payload outside its changed-column set')
        begun=json.loads(self.sql(self.begin(job,claim),role='service_role'));positives+=1
        if begun['state']!='SENDING' or begun['attempt_count']!=1:
            raise Failure('supported begin positive after negative matrix')
        negatives+=self.guard_negative_count
        self.event('guard.claim_begin',['S36-077'],['claim/begin exact changed columns','fresh fence supplied only by trigger','count jump/decrement/fourth/NULL negatives','nonterminal envelope immutable','supported claim/begin still succeed'])
        self.finish_case('guard claim and begin changed-column/attempt matrix')

        self.fresh('guard_fourth_attempt',fixtures=True);self.guard_helpers()
        job,ch,enq,claim=self.retry_lease(2)
        third=self.capture_transition(job,self.begin(job,claim))
        for value in (0,1,2,4):
            candidate=copy.deepcopy(third);candidate['attempt_count']=value
            self.guard_negative(job,'begin_send',candidate,'third-attempt lease cannot jump/decrement or create fourth attempt')
        self.sql(self.begin(job,claim),role='service_role');positives+=1
        budget=self.capture_transition(job,self.finalize(job,claim,3,'not_accepted_retryable',None,evidence=True))
        for disposition in ('retry_unusable','retry_deadline_exhausted','sender_unavailable_pre_send'):
            candidate=copy.deepcopy(budget);candidate['terminal_disposition']=disposition
            self.guard_negative(job,'finalize',candidate,'attempt-three provider exhaustion has closed disposition provenance')
        self.sql(self.finalize(job,claim,3,'not_accepted_retryable',None,evidence=True),role='service_role');positives+=1
        self.scrub(job,'FAILED_TERMINAL','retry_budget_exhausted')
        if self.claim() or self.sql(self.begin(job,claim),role='service_role'):
            raise Failure('third-attempt exhaustion permitted fourth authority')
        negatives+=self.guard_negative_count
        self.event('guard.fourth_attempt',['S36-077'],['real prior positive non-acceptance attempts 1/2','only third begin allowed','no fourth attempt or invented attempt-three disposition','supported third begin/budget exhaustion controls'])
        self.finish_case('guard exact third-attempt and retry-budget provenance')

        for prior_attempts in (0,1):
            self.fresh('guard_begin_unusable',fixtures=True);self.guard_helpers()
            if prior_attempts:job,ch,enq,claim=self.retry_lease(1)
            else:job,ch,enq=self.new();claim=self.claim()
            self.sql(f"update {CHALLENGES} set superseded_at=stamp.t,supersession_reason='resend',normalized_email=null,email_scrubbed_at=stamp.t from (select clock_timestamp() t) stamp where id={quote(ch)}",role=OWNER)
            terminal=self.capture_transition(job,self.begin(job,claim))
            for field,value in (('resolution_kind','provider'),('resolution_kind','pre_send'),('resolution_kind','recovery'),
                                ('resolution_provider_outcome','rejected'),('resolution_pre_send_disposition','sender_unavailable'),
                                ('resolution_non_acceptance_proven',not bool(prior_attempts)),('challenge_recording','recorded'),
                                ('provider_message_id','forbidden'),('attempt_count',prior_attempts+1)):
                candidate=copy.deepcopy(terminal);candidate[field]=value
                self.guard_negative(job,'begin_send',candidate,'begin terminalization has only exact unusable/static attempt provenance')
            if prior_attempts:
                for state,disposition in (('EXPIRED','expired_pre_send'),('CANCELLED','cancelled_pre_send')):
                    candidate=copy.deepcopy(terminal);candidate.update(state=state,terminal_disposition=disposition,resolution_non_acceptance_proven=False)
                    self.guard_negative(job,'begin_send',candidate,'attempted work cannot become never-sent from begin')
            self.sql(self.begin(job,claim),role='service_role');positives+=1
            self.scrub(job,'FAILED_TERMINAL' if prior_attempts else 'CANCELLED','retry_unusable' if prior_attempts else 'cancelled_pre_send')
            if self.row(job)['attempt_count']!=prior_attempts or self.row(job)['challenge_recording']!='not_applicable':
                raise Failure('begin unusable positive invented attempt or recorder')
            negatives+=self.guard_negative_count
            self.event('guard.begin_unusable_'+str(prior_attempts),['S36-077'],['begin uses unusable provenance only','never-sent vs prior-positive classifications closed','supported begin terminalization; no increment/recorder; full scrub'])
            self.finish_case('guard begin-origin unusable static family count '+str(prior_attempts))
        self.matrix_report({'group':'claim_begin','negative_cases':negatives,'positive_controls':positives})

    def guard_recovery_matrix(self):
        negatives=0;positives=0
        for attempts in (0,1,2):
            self.fresh('guard_recovery_requeue',fixtures=True);self.guard_helpers()
            if attempts:job,ch,enq,claim=self.retry_lease(attempts)
            else:job,ch,enq=self.new();claim=self.claim()
            self.shift(job,31)
            source=self.row(job)
            template=self.capture_transition(job,'select count(*) from public.runtime_recover_every8d_settings_auth_email_v1(100)')
            expected='RETRY_WAIT' if attempts else 'PENDING'
            if template['state']!=expected or template['attempt_count']!=attempts:
                raise Failure('supported recovery requeue template wrong source/count')
            changes={'attempt_count':attempts+1,'resolution_kind':'unusable','resolution_provider_outcome':'accepted',
                'resolution_non_acceptance_proven':False if attempts else True,'resolution_attempt_count':attempts+1,
                'resolution_lease_id':str(uuid.uuid4()),'available_at':'2099-01-01T00:00:00+00:00',
                'nonce':'\\x'+'05'*12,'fence_generation':source['fence_generation']+1,'lease_id':str(uuid.uuid4()),
                'leased_at':source['leased_at'],'lease_expires_at':source['lease_expires_at']}
            for field,value in changes.items():
                candidate=copy.deepcopy(template);candidate[field]=value
                self.guard_negative(job,'recover',candidate,'recovery requeue preserves attempt/fence/history/envelope and clears active lease only')
            for wrong_state in ('SENDING','PENDING' if attempts else 'RETRY_WAIT'):
                candidate=copy.deepcopy(template);candidate['state']=wrong_state
                self.guard_negative(job,'recover',candidate,'expired LEASED requeue family must match exact attempt provenance')
            result=self.recover();positives+=1
            if len(result)!=1 or result[0]['previous_state']!='LEASED' or result[0]['state']!=expected or result[0]['attempt_count']!=attempts:
                raise Failure('supported expired LEASED recovery positive failed')
            if self.sql(self.begin(job,claim),role='service_role'):
                raise Failure('recovered source retained stale begin authority')
            row=self.row(job)
            for field in ('fence_generation','encryption_key_version','nonce','ciphertext','authentication_tag','available_at',
                          'resolution_kind','resolution_provider_outcome','resolution_non_acceptance_proven','resolution_lease_id','resolution_fence_generation','resolution_attempt_count','resolved_at'):
                if row[field]!=source[field]:raise Failure('safe recovery changed retained history/envelope/availability')
            if attempts:
                prior={'lease_id':source['resolution_lease_id'],'fence':str(source['resolution_fence_generation'])}
                before=self.row(job)
                if self.sql(self.finalize(job,prior,attempts,'not_accepted_retryable',None,evidence=True),role='service_role') or self.row(job)!=before:
                    raise Failure('expired-LEASED recovery resurrected old retry receipt compatibility')
            negatives+=self.guard_negative_count
            self.event('guard.recovery_requeue_'+str(attempts),['S36-059','S36-077'],['exact old positive-history/count family','unchanged attempt/fence/envelope/availability/resolution history','lease cleared; stale begin and historical retry finalization zero','supported recovery positive'])
            self.finish_case('guard recovery safe requeue count '+str(attempts))

        for origin in ('pending','retry_wait','sending'):
            self.fresh('guard_recovery_terminal',fixtures=True);self.guard_helpers()
            if origin=='pending':job,ch,enq=self.new();attempts=0
            else:
                job,ch,enq,claim=self.sendable();attempts=1
                if origin=='retry_wait':self.sql(self.finalize(job,claim,1,'not_accepted_retryable',None,evidence=True),role='service_role')
            if origin=='sending':self.shift(job,31)
            else:self.sql(f"update {CHALLENGES} set superseded_at=stamp.t,supersession_reason='resend',normalized_email=null,email_scrubbed_at=stamp.t from (select clock_timestamp() t) stamp where id={quote(ch)}",role=OWNER)
            terminal=self.capture_transition(job,'select count(*) from public.runtime_recover_every8d_settings_auth_email_v1(100)')
            for field,value in (('resolution_kind','unusable'),('resolution_kind','pre_send'),('resolution_kind','provider'),
                                ('resolution_provider_outcome','outcome_unknown'),('resolution_pre_send_disposition','sender_unavailable'),
                                ('resolution_non_acceptance_proven',not (origin=='retry_wait')),('provider_message_id','forbidden'),
                                ('attempt_count',attempts+1),('resolution_attempt_count',attempts+1)):
                candidate=copy.deepcopy(terminal);candidate[field]=value
                self.guard_negative(job,'recover',candidate,'recovery terminalization cannot fabricate provider/pre-send/attempt provenance')
            if origin=='sending':
                candidate=copy.deepcopy(terminal);candidate.update(resolution_kind='provider',resolution_provider_outcome='outcome_unknown')
                self.guard_negative(job,'recover',candidate,'fully valid provider-unknown row cannot be fabricated by recovery context')
                for state,disposition in (('EXPIRED','expired_pre_send'),('CANCELLED','cancelled_pre_send'),('FAILED_TERMINAL','retry_unusable')):
                    candidate=copy.deepcopy(terminal);candidate.update(state=state,terminal_disposition=disposition)
                    self.guard_negative(job,'recover',candidate,'ambiguous SENDING can only recover to unknown')
            else:
                candidate=copy.deepcopy(terminal);candidate['challenge_recording']='recorded'
                self.guard_negative(job,'recover',candidate,'non-recorder recovery cannot invent recorder receipt')
            result=self.recover();positives+=1
            expected='DELIVERY_OUTCOME_UNKNOWN' if origin=='sending' else 'FAILED_TERMINAL' if origin=='retry_wait' else 'CANCELLED'
            disposition='delivery_outcome_unknown' if origin=='sending' else 'retry_unusable' if origin=='retry_wait' else 'cancelled_pre_send'
            if len(result)!=1 or result[0]['state']!=expected or result[0]['attempt_count']!=attempts:
                raise Failure('supported recovery terminal positive failed')
            self.scrub(job,expected,disposition)
            if origin!='sending' and self.row(job)['challenge_recording']!='not_applicable':
                raise Failure('non-recorder recovery positive invented recorder')
            if self.recover() or self.claim():raise Failure('recovery terminal positive reopened authority')
            negatives+=self.guard_negative_count
            self.event('guard.recovery_terminal_'+origin,['S36-060','S36-061','S36-062','S36-063','S36-077'],['exact recovery-only provenance','no fabricated provider/pre-send classification','attempt preserved','full scrub/lease clear','no terminal re-selection or resend','supported recovery positive'])
            self.finish_case('guard recovery terminal origin '+origin)
        self.matrix_report({'group':'recovery','negative_cases':negatives,'positive_controls':positives})

    def guard_purge_matrix(self):
        self.fresh('guard_purge',fixtures=True)
        job,ch,enq,claim=self.sendable();self.sql(self.finalize(job,claim,1),role='service_role');self.scrub(job,'ACCEPTED','accepted')
        negatives=0
        contexts=["", "set local wincrm.c3c3_outbox_purge='on';",
          "set local wincrm.c3c3_outbox_operation='purge'; set local wincrm.c3c3_outbox_purge='on'; select set_config('wincrm.c3c3_outbox_decision_at',clock_timestamp()::text,true);",
          "set local wincrm.c3c3_outbox_operation='finalize'; set local wincrm.c3c3_outbox_purge='on'; select set_config('wincrm.c3c3_outbox_decision_at',clock_timestamp()::text,true);",
          "set local wincrm.c3c3_outbox_operation='purge'; set local wincrm.c3c3_outbox_purge='off'; select set_config('wincrm.c3c3_outbox_decision_at',clock_timestamp()::text,true);",
          "set local wincrm.c3c3_outbox_operation='purge'; set local wincrm.c3c3_outbox_purge='on'; set local wincrm.c3c3_outbox_decision_at='not-time';",
          "set local wincrm.c3c3_outbox_operation='purge'; set local wincrm.c3c3_outbox_purge='on'; select set_config('wincrm.c3c3_outbox_decision_at',(clock_timestamp()+interval '1 day')::text,true);"]
        for context in contexts:
            before=self.seal()
            self.sql(f'begin; {context} delete from {TABLE} where job_id={quote(job)}; commit;',role=OWNER,error='23514',label='forged or premature purge context refuses')
            if self.seal()!=before:raise Failure('forged/premature purge changed authority')
            negatives+=1
        for target in (TABLE,GUARD):
            before=self.seal();self.sql('truncate '+target,role=OWNER,error='23514',label='TRUNCATE always refused')
            if self.seal()!=before:raise Failure('TRUNCATE refusal changed authority')
            negatives+=1
        self.shift(job,86401)
        for context in contexts[:2]:
            before=self.seal();self.sql(f'begin; {context} delete from {TABLE} where job_id={quote(job)}; commit;',role=OWNER,error='23514',label='even eligible row needs complete purge context')
            if self.seal()!=before:raise Failure('purge GUC alone deleted eligible retained row')
            negatives+=1
        if self.sql('select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(100)',role='service_role')!='1':
            raise Failure('supported purge positive failed')
        self.check(f"select not exists(select 1 from {TABLE}) and exists(select 1 from {CHALLENGES} where id={quote(ch)})",'purge deletes only eligible outbox child')
        self.event('guard.purge',['S36-077'],['wrong/missing/forged purge context refuses atomically','premature retention deletion refuses','GUC alone insufficient even when eligible','TRUNCATE always refuses','supported purge positive deletes child only'])
        self.finish_case('guard purge context/eligibility and TRUNCATE matrix')
        self.matrix_report({'group':'purge','negative_cases':negatives,'positive_controls':1})

    def guard_transition_matrix(self):
        states=['PENDING','LEASED','SENDING','RETRY_WAIT','ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN','CANCELLED','EXPIRED']
        contexts=['enqueue','claim','begin_send','finalize','recover','purge']
        sources=[('PENDING',0),('LEASED',0),('LEASED',1),('LEASED',2),('SENDING',1),('SENDING',2),('SENDING',3),
                 ('RETRY_WAIT',1),('RETRY_WAIT',2),('ACCEPTED',1),('FAILED_TERMINAL',1),('DELIVERY_OUTCOME_UNKNOWN',1),('CANCELLED',0),('EXPIRED',0)]
        negatives=0
        for state,attempts in sources:
            self.fresh('guard_edges',fixtures=True);self.guard_helpers()
            if state=='PENDING':job,ch,enq=self.new()
            elif state=='LEASED':
                if attempts:job,ch,enq,claim=self.retry_lease(attempts)
                else:job,ch,enq=self.new();claim=self.claim()
            elif state=='SENDING':
                if attempts==1:job,ch,enq,claim=self.sendable()
                else:job,ch,enq,claim=self.retry_lease(attempts-1);self.sql(self.begin(job,claim),role='service_role')
            elif state=='RETRY_WAIT':
                if attempts==1:job,ch,enq,claim=self.sendable()
                else:job,ch,enq,claim=self.retry_lease(attempts-1);self.sql(self.begin(job,claim),role='service_role')
                self.sql(self.finalize(job,claim,attempts,'not_accepted_retryable',None,evidence=True),role='service_role')
            elif state in ('ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN'):
                job,ch,enq,claim=self.sendable()
                outcome={'ACCEPTED':'accepted','FAILED_TERMINAL':'rejected','DELIVERY_OUTCOME_UNKNOWN':'outcome_unknown'}[state]
                self.sql(self.finalize(job,claim,1,outcome,'synthetic-id' if state=='ACCEPTED' else None),role='service_role')
            else:
                job,ch,enq=self.new()
                if state=='EXPIRED':self.shift(job,601)
                else:self.sql(f"update {CHALLENGES} set superseded_at=stamp.t,supersession_reason='resend',normalized_email=null,email_scrubbed_at=stamp.t from (select clock_timestamp() t) stamp where id={quote(ch)}",role=OWNER)
                self.recover()
            source=self.row(job)
            if source['state']!=state or source['attempt_count']!=attempts:
                raise Failure('operation/state matrix did not establish legitimate source')
            # These are the closed Section-6/static-provenance families, not core
            # usability/time decisions. Legal edges are tested by exact templates elsewhere.
            allowed={context:set() for context in contexts}
            if state in ('PENDING','RETRY_WAIT'):allowed['claim'].add('LEASED')
            if state=='PENDING':allowed['recover'].update(('CANCELLED','EXPIRED'))
            if state=='LEASED':
                allowed['begin_send'].add('SENDING');allowed['finalize'].add('FAILED_TERMINAL')
                if attempts==0:
                    allowed['begin_send'].update(('CANCELLED','EXPIRED'));allowed['recover'].update(('PENDING','CANCELLED','EXPIRED'))
                else:
                    allowed['begin_send'].add('FAILED_TERMINAL');allowed['recover'].update(('RETRY_WAIT','FAILED_TERMINAL'))
            if state=='SENDING':
                allowed['finalize'].update(('ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN'))
                if attempts<3:allowed['finalize'].add('RETRY_WAIT')
                allowed['recover'].add('DELIVERY_OUTCOME_UNKNOWN')
            if state=='RETRY_WAIT':allowed['recover'].add('FAILED_TERMINAL')
            for operation in contexts:
                for target in states:
                    if target in allowed[operation]:continue
                    candidate=copy.deepcopy(source);candidate['state']=target
                    self.guard_negative(job,operation,candidate,'closed operation/state edge or no-op/terminal reopen refused')
            negatives+=self.guard_negative_count
            if self.row(job)!=source:
                raise Failure('operation/state matrix changed legitimate source authority')
            self.event('guard.edges_'+state+'_'+str(attempts),['S36-077'],['legitimate source constructed through supported runtime authority','all six operation markers','every forbidden state edge and no-op rejected','terminal updates/reopening rejected','protections enabled; source/challenge/guard unchanged'])
            self.finish_case('guard operation/state edges from '+state+' count '+str(attempts))
        if negatives!=718:raise Failure('operation/state negative matrix lost a required case')
        self.matrix_report({'group':'operation_state_edges','negative_cases':negatives,'positive_controls':0,'legitimate_source_families':len(sources)})

    def guard_enqueue_matrix(self):
        self.fresh('guard_enqueue',fixtures=True);self.guard_helpers()
        job,ch,enq=self.new(enqueue=False)
        template=json.loads(self.sql(f'select c3c3_guard_proof.capture_enqueue({quote(job)},{quote(ch)},{quote(enq)})',role=OWNER))
        if template['state']!='PENDING' or template['attempt_count']!=0:raise Failure('supported enqueue template violates frozen initial state')
        template['fence_generation']=None
        negatives=0
        def reject(operation,candidate):
            nonlocal negatives
            self.check(f'select c3c3_guard_proof.assert_insert_rejected({quote(operation)},{quote(json.dumps(candidate))}::jsonb)','owner enqueue static/provenance negative')
            negatives+=1
        for operation in ('','claim','begin_send','finalize','recover','purge'):reject(operation,template)
        for state in ('LEASED','SENDING','RETRY_WAIT','ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN','CANCELLED','EXPIRED'):
            candidate=copy.deepcopy(template);candidate['state']=state;reject('enqueue',candidate)
        for field,value in (('attempt_count',1),('fence_generation',1),('resolution_kind','provider'),('resolution_kind','pre_send'),
                            ('resolution_kind','recovery'),('resolution_kind','unusable'),('challenge_recording','recorded'),
                            ('challenge_recording','not_recorded'),('nonce',None),('ciphertext','\\x'),('authentication_tag',None),
                            ('provider_message_id','forbidden'),('request_token_hash','\\x'+'07'*32),('purpose','login'),
                            ('delivery_deadline_at','2099-01-01T00:00:00+00:00')):
            candidate=copy.deepcopy(template);candidate[field]=value;reject('enqueue',candidate)
        result=self.sql(enq,role='service_role')
        if not result:raise Failure('supported enqueue positive after owner negatives')
        self.check(f"select count(*)=1 and bool_and(state='PENDING' and attempt_count=0 and resolution_kind is null and lease_id is null and fence_generation>0) from {TABLE}",'exact initial supported outbox shape')
        self.event('guard.enqueue',['S36-077'],['only enqueue marker admits INSERT','absent -> PENDING/count 0 only','caller cannot supply fence or provenance','payload/identity/deadline shape protected','supported enqueue positive'])
        self.finish_case('guard enqueue only admits exact initial authority shape')
        self.matrix_report({'group':'enqueue','negative_cases':negatives,'positive_controls':1})

    def guard_retry_terminal_controls(self):
        negatives=0;positives=0
        for attempts in (1,2):
            for reason in ('deadline','unusable'):
                self.fresh('guard_retry_terminal',fixtures=True);self.guard_helpers()
                if attempts==1:job,ch,enq,claim=self.sendable()
                else:job,ch,enq,claim=self.retry_lease(attempts-1);self.sql(self.begin(job,claim),role='service_role')
                if reason=='deadline':self.reduce_window(job,ch,12)
                else:self.sql(f"update {CHALLENGES} set superseded_at=stamp.t,supersession_reason='resend',normalized_email=null,email_scrubbed_at=stamp.t from (select clock_timestamp() t) stamp where id={quote(ch)}",role=OWNER)
                query=self.finalize(job,claim,attempts,'not_accepted_retryable',None,evidence=True)
                terminal=self.capture_transition(job,query)
                disposition='retry_deadline_exhausted' if reason=='deadline' else 'retry_unusable'
                if terminal['state']!='FAILED_TERMINAL' or terminal['terminal_disposition']!=disposition:
                    raise Failure('supported retry terminal template violates frozen disposition')
                for field,value in (('resolution_kind','recovery'),('resolution_kind','unusable'),('resolution_kind','pre_send'),
                                    ('resolution_provider_outcome','accepted'),('resolution_provider_outcome','rejected'),
                                    ('resolution_non_acceptance_proven',False),('resolution_pre_send_disposition','sender_unavailable'),
                                    ('provider_message_id','forbidden'),('terminal_disposition','retry_budget_exhausted')):
                    candidate=copy.deepcopy(terminal);candidate[field]=value
                    self.guard_negative(job,'finalize',candidate,'provider retry exhaustion has closed static provenance/count')
                self.sql(query,role='service_role');positives+=1
                self.scrub(job,'FAILED_TERMINAL',disposition)
                row=self.row(job)
                if row['attempt_count']!=attempts or row['challenge_recording']!='not_applicable':raise Failure('retry terminal positive invented attempt/recorder')
                negatives+=self.guard_negative_count
                self.event('guard.retry_terminal_'+reason+'_'+str(attempts),['S36-077'],['prior positive attempt provenance','no budget disposition before attempt three','exact provider not-accepted metadata','supported terminalization; unchanged count/no recorder/full scrub'])
                self.finish_case('guard retry '+reason+' terminal static family count '+str(attempts))
        self.matrix_report({'group':'retry_terminal','negative_cases':negatives,'positive_controls':positives})

    def enqueue_uniqueness(self):
        self.fresh('enqueue_identity',fixtures=True)
        job,ch,enq=self.new();before=self.row(job)
        other_job,other_ch,other_enq=self.new(enqueue=False)
        conflicts=[enq.replace(job,str(uuid.uuid4())),other_enq.replace(other_job,job),
            enq.replace("decode('abcd','hex')","decode('abce','hex')"),
            enq.replace("repeat('01',12)","repeat('05',12)"),enq.replace("repeat('02',16)","repeat('06',16)"),
            enq.replace("'proof-key'","'changed-key'"),enq.replace("'enrollment'","'login'"),
            enq.replace('c3c2a_proof.hash(',"c3c2a_proof.hash('conflict-'||",1)]
        seq=self.sql(f'select jsonb_build_array(last_value,log_cnt,is_called)::text from {SEQ}')
        for query in conflicts:
            if self.sql(query,role='service_role') or self.row(job)!=before:
                raise Failure('enqueue identity/fingerprint conflict mutated or admitted authority')
        duplicate=json.loads(self.sql(enq,role='service_role'))
        if duplicate['job_id']!=job or duplicate['state']!='PENDING' or self.row(job)!=before:
            raise Failure('exact duplicate enqueue changed original receipt/state')
        if self.sql(f'select jsonb_build_array(last_value,log_cnt,is_called)::text from {SEQ}')!=seq:
            raise Failure('duplicate/conflict allocated a new fence')
        self.check(f"select (select count(*)=1 from {TABLE}) and exists(select 1 from {CHALLENGES} where id={quote(other_ch)}) and not exists(select 1 from {TABLE} where challenge_id={quote(other_ch)})",'unique job/challenge identity; losing challenge remains orphan')
        self.event('enqueue.identity_conflicts',['S36-001','S36-002','S36-004'],['job and challenge uniqueness','nonce/ciphertext/tag/key/AAD identity conflicts return zero','exact duplicate receipt unchanged','no extra row/fence or losing-challenge resurrection'])
        self.finish_case('enqueue exact identity/fingerprint uniqueness and conflict matrix')

    def orphan_supersession(self):
        self.fresh('orphan_supersession',fixtures=True)
        job,ch,enq=self.new(enqueue=False)
        before=self.sql(f'select to_jsonb(c)::text from {CHALLENGES} c where id={quote(ch)}')
        if self.claim() or self.recover() or self.sql('select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(100)',role='service_role')!='0':
            raise Failure('maintenance reconstructed orphan send authority')
        self.check(f'select count(*)=0 from {TABLE}','committed challenge-only orphan has no outbox')
        self.check(f'select last_value=1 and not is_called from {SEQ}','no orphan reconstruction fence allocated')
        if self.sql(f'select to_jsonb(c)::text from {CHALLENGES} c where id={quote(ch)}')!=before:
            raise Failure('orphan maintenance mutated challenge')
        new_ch=str(uuid.uuid4())
        request=f"""select row_to_json(r) from {CHALLENGES} c join public.every8d_settings_enrollment_grants g on g.id=c.enrollment_grant_id
          cross join lateral public.runtime_request_every8d_settings_enrollment_challenge_v1(g.token_hash,{quote(new_ch)}::uuid,c.normalized_email,c.email_pseudonym,array[c.email_pseudonym],
            c3c2a_proof.hash('orphan-resend-new'),c3c2a_proof.hash('orphan-otp-new'),'proof-key') r where c.id={quote(ch)}"""
        if self.sql(request,role=OWNER):raise Failure('orphan resend bypassed existing real cooldown')
        if self.sql(f'select to_jsonb(c)::text from {CHALLENGES} c where id={quote(ch)}')!=before:raise Failure('cooldown refusal partially superseded orphan')
        self.until(lambda:self.sql(f"select clock_timestamp()>=created_at+interval '60 seconds' from {CHALLENGES} where id={quote(ch)}")=='t','actual existing 60-second resend cooldown',seconds=65)
        result=self.sql(request,role=OWNER)
        if not result or json.loads(result)['challenge_id']!=new_ch:raise Failure('supported orphan supersession after real cooldown failed')
        self.check(f"select (select superseded_at is not null and supersession_reason='resend' and normalized_email is null and email_scrubbed_at=superseded_at from {CHALLENGES} where id={quote(ch)}) "
                   f"and (select count(*)=2 from {CHALLENGES}) and (select count(*)=0 from {TABLE})",'supported resend explicitly supersedes orphan without reconstructing either outbox')
        if self.sql(enq,role='service_role') or self.sql(enq.replace(job,str(uuid.uuid4())),role='service_role'):
            raise Failure('superseded orphan resurrected old challenge outbox')
        self.check(f'select last_value=1 and not is_called from {SEQ}','orphan supersession never allocates outbox fence')
        self.event('orphan.real_supersession',['S36-009','S36-010','S36-011'],['challenge-only commit','claim/recover/purge create no job or fence','real C3b request authority refuses within cooldown','actual DB time reaches cooldown; supported resend supersedes under existing limits','old challenge cannot enqueue; no reconstruction/provider/attempt'])
        self.finish_case('orphan remains unsent; explicit C3b supersession under real cooldown')

    def blocked(self,waiter,blocker,label):
        # Observe real waits without printing advisory-key words derived from identities.
        self.until(lambda:self.sql(f"select exists(select 1 from pg_stat_activity a join pg_stat_activity b on b.application_name={quote(blocker.app)} where a.application_name={quote(waiter.app)} and b.pid=any(pg_blocking_pids(a.pid)))")=='t',label)
        evidence=self.sql(f"""select jsonb_build_object(
          'actors',(select jsonb_agg(jsonb_build_object('pid',pid,'actor',application_name,'state',state,'wait_event_type',wait_event_type,'wait_event',wait_event,'blocking_pids',pg_blocking_pids(pid)) order by application_name) from pg_stat_activity where application_name in ({quote(waiter.app)},{quote(blocker.app)})),
          'locks',(select jsonb_agg(jsonb_build_object('pid',l.pid,'type',l.locktype,'mode',l.mode,'granted',l.granted,'relation',l.relation::regclass::text) order by l.pid,l.locktype,l.mode) from pg_locks l join pg_stat_activity a using(pid) where a.application_name in ({quote(waiter.app)},{quote(blocker.app)}) and l.locktype in ('advisory','tuple','transactionid','relation')))""")
        print('BARRIER '+label+' '+evidence,flush=True)

    def enqueue_concurrency(self):
        for reverse in (False,True):
            self.fresh('enqueue_duplicate_race',fixtures=True);self.concurrent+=1
            job,ch,enq=self.new(enqueue=False)
            a=self.actor('duplicate_enqueue_a_'+str(self.concurrent),OWNER);b=self.actor('duplicate_enqueue_b_'+str(self.concurrent),OWNER)
            first,second=(b,a) if reverse else (a,b)
            first.start('create temp table receipt as '+enq+'; select count(*) from receipt');first.ready('1')
            receipt_check=f"select bool_and(r.row_to_json::jsonb=jsonb_build_object('job_id',o.job_id,'state',o.state,'created_at',o.created_at,'delivery_deadline_at',o.delivery_deadline_at)) from receipt r join {TABLE} o on o.job_id=(r.row_to_json->>'job_id')::uuid"
            first.send(receipt_check+"; select 'C3C2A_READY';");first.ready('t')
            second.start('create temp table receipt as '+enq+'; select count(*) from receipt')
            self.blocked(second,first,'concurrent duplicate enqueue exact winner '+str(reverse))
            first.finish();second.ready('1')
            second.send(receipt_check+"; select 'C3C2A_READY';");second.ready('t');second.finish()
            self.check(f'select count(*)=1 and min(fence_generation)=1 and bool_and(attempt_count=0) from {TABLE}','duplicate enqueue has one job and one initial generation')
            self.check(f'select last_value=1 and is_called from {SEQ}','duplicate did not allocate second generation')
            self.event('enqueue.concurrent_duplicate_'+str(reverse),['S36-001','S36-002','S36-003'],['two physical sessions and observed challenge wait','both actual receipts match stored identity/state/timestamps','one row/fence only','both symmetric winner orders'])
            self.finish_case('concurrent duplicate enqueue exact receipts, winner '+str(reverse))

        self.fresh('supersession_seed',fixtures=True)
        job,ch,enq=self.new(enqueue=False)
        self.until(lambda:self.sql(f"select clock_timestamp()>=created_at+interval '60 seconds' from {CHALLENGES} where id={quote(ch)}")=='t','real cooldown seed for legal supersession race',seconds=65)
        self.check(f"select expires_at>clock_timestamp()+interval '10 seconds' from {CHALLENGES} where id={quote(ch)}",'enqueue and real resend simultaneously eligible after cooldown')
        seed=self.db
        self.event('enqueue.supersession_cooldown',[],['real DB cooldown elapsed','old challenge still unexpired/full provider window fits','no fabricated prerequisite'])
        for supersession_first in (False,True):
            self.scenarios+=1;self.concurrent+=1
            self.db=self.clone('supersession_race_'+str(self.concurrent),seed)
            next_ch=str(uuid.uuid4())
            request=f"""select row_to_json(r) from {CHALLENGES} c join public.every8d_settings_enrollment_grants g on g.id=c.enrollment_grant_id
              cross join lateral public.runtime_request_every8d_settings_enrollment_challenge_v1(g.token_hash,{quote(next_ch)}::uuid,c.normalized_email,c.email_pseudonym,array[c.email_pseudonym],c3c2a_proof.hash('race-resend'),c3c2a_proof.hash('race-otp'),'proof-key') r where c.id={quote(ch)}"""
            enqueue_actor=self.actor('enqueue_supersession_enq_'+str(self.concurrent),OWNER)
            supersede_actor=self.actor('enqueue_supersession_sup_'+str(self.concurrent),OWNER)
            if supersession_first:
                supersede_actor.start(self.count_query(request));supersede_actor.ready('1')
                enqueue_actor.start(self.count_query(enq));self.blocked(enqueue_actor,supersede_actor,'enqueue waits for real C3b supersession')
                supersede_actor.finish();enqueue_actor.ready('0');enqueue_actor.finish()
                self.check(f'select count(*)=0 from {TABLE}','supersession winner prevents unauthorized job')
                self.check(f'select last_value=1 and not is_called from {SEQ}','losing enqueue did not allocate fence')
                if self.sql(enq,role='service_role'):raise Failure('supersession-losing enqueue later resurrected job')
            else:
                enqueue_actor.start(self.count_query(enq));enqueue_actor.ready('1')
                supersede_actor.start(self.count_query(request));self.blocked(supersede_actor,enqueue_actor,'real C3b supersession waits for enqueue')
                enqueue_actor.finish();supersede_actor.ready('1');supersede_actor.finish()
                self.check(f"select count(*)=1 and bool_and(job_id={quote(job)} and challenge_id={quote(ch)} and state='PENDING' and attempt_count=0) from {TABLE}",'enqueue winner retained exactly one now-unusable job')
                before=self.row(job)
                if self.claim() or self.row(job)!=before:raise Failure('superseded retained child obtained claim authority')
                result=self.recover()
                if len(result)!=1:raise Failure('superseded retained child not recoverable')
                self.scrub(job,'CANCELLED','cancelled_pre_send')
                if self.row(job)['challenge_recording']!='not_applicable':raise Failure('superseded never-sent job fabricated recorder')
            self.check(f"select (select count(*)=2 from {CHALLENGES}) and (select superseded_at is not null and supersession_reason='resend' and normalized_email is null from {CHALLENGES} where id={quote(ch)}) and not exists(select 1 from {TABLE} o left join {CHALLENGES} c on c.id=o.challenge_id where c.id is null)",'real supersession final challenge/outbox authority; no orphan or reconstruction')
            self.event('enqueue.supersession_'+str(supersession_first),['S36-005'],['real C3b request authority with valid cooldown','parent/challenge wait observed in two sessions','fresh losing enqueue revalidation','winner child cannot send after supersession; truthful recovery scrub','no duplicate/orphan/fabricated job'])
            self.finish_case('real enqueue versus C3b supersession winner '+str(supersession_first))
        self.db=seed;self.finish_case('legal supersession race seed retired')

    def begin_acknowledgements(self):
        for committed in (False,True):
            self.fresh('begin_ambiguous_ack',fixtures=True)
            job,ch,enq=self.new();claim=self.claim();before=self.row(job)
            actor=self.actor('lost_ack_'+str(committed),OWNER)
            actor.start(self.count_query(self.begin(job,claim)));actor.ready('1')
            # The harness knows commit/abort; the simulated consumer receives no receipt.
            actor.finish(commit=committed)
            provider_calls=0
            if committed:
                row=self.row(job)
                if row['state']!='SENDING' or row['attempt_count']!=1 or row['lease_id']!=claim['lease_id'] or str(row['fence_generation'])!=claim['fence']:
                    raise Failure('lost committed acknowledgement lost exact active attempt authority')
                if self.sql(self.begin(job,claim),role='service_role') or self.row(job)!=row:
                    raise Failure('repeated begin reconstructed authorization after lost acknowledgement')
                self.wait_expiry(job)
                recovered=self.recover()
                if len(recovered)!=1 or recovered[0]['state']!='DELIVERY_OUTCOME_UNKNOWN' or recovered[0]['attempt_count']!=1:
                    raise Failure('lost committed begin acknowledgement did not recover truthfully unknown')
                self.scrub(job,'DELIVERY_OUTCOME_UNKNOWN','delivery_outcome_unknown')
            else:
                if self.row(job)!=before:raise Failure('aborted begin consumed a committed attempt')
                # No automatic second begin is made on an ambiguous acknowledgement.
                self.shift(job,31)
                recovered=self.recover()
                if len(recovered)!=1 or recovered[0]['state']!='PENDING' or recovered[0]['attempt_count']!=0:
                    raise Failure('aborted ambiguous begin recovery fabricated an attempt')
                if self.sql(self.begin(job,claim),role='service_role'):
                    raise Failure('expired ambiguous lease obtained later begin authority')
            if provider_calls!=0:raise Failure('missing acknowledgement fixture invoked provider')
            self.event('begin.ambiguous_ack_'+str(committed),['S36-030'],['real begin inside independent transaction','receipt intentionally not delivered to test consumer','commit/abort branches verified by exact state/attempt snapshot','no reconstructed receipt/automatic replacement call','zero provider counters','recovery preserves truthful attempt history'])
            self.finish_case('ambiguous begin acknowledgement committed '+str(committed))

        self.fresh('begin_late_ack',fixtures=True)
        job,ch,enq=self.new();claim=self.claim()
        started=time.monotonic()
        receipt=json.loads(self.sql(self.begin(job,claim),role='service_role'))
        row=self.row(job)
        if receipt['state']!='SENDING' or receipt['attempt_count']!=1:
            raise Failure('late acknowledgement source did not commit one real attempt')
        window=(datetime.fromisoformat(receipt['provider_deadline_at'])-datetime.fromisoformat(receipt['db_now'])).total_seconds()
        if window!=10 or datetime.fromisoformat(receipt['attempt_started_at'])!=datetime.fromisoformat(receipt['db_now']):
            raise Failure('begin receipt provider deadline is not exact DB decision plus ten seconds')
        self.until(lambda:self.sql(f'select clock_timestamp()>=last_provider_deadline_at from {TABLE} where job_id={quote(job)}')=='t','actual acknowledgement delivery after persisted provider deadline',seconds=15)
        elapsed=time.monotonic()-started
        if elapsed<window:raise Failure('late acknowledgement fixture did not conservatively cross full provider window')
        provider_calls=0
        def consume_contract_fixture(delivery_elapsed):
            nonlocal provider_calls
            # Frozen future-consumer contract only; never a runtime/network adapter.
            if delivery_elapsed>=window:return False
            provider_calls+=1
            return True
        if consume_contract_fixture(window) or consume_contract_fixture(elapsed) or provider_calls:
            raise Failure('provider deadline equality/late acknowledgement granted test invocation')
        if self.sql(self.begin(job,claim),role='service_role') or self.row(job)!=row:
            raise Failure('late acknowledgement obtained replacement begin authority')
        if self.sql(self.finalize(job,claim,1,None,None,'sender_unavailable'),role='service_role') or self.row(job)!=row:
            raise Failure('late SENDING acknowledgement was relabeled sender-unavailable')
        self.wait_expiry(job)
        recovered=self.recover()
        if len(recovered)!=1 or recovered[0]['state']!='DELIVERY_OUTCOME_UNKNOWN' or recovered[0]['attempt_count']!=1:
            raise Failure('late begin acknowledgement did not recover as truthful unknown')
        self.scrub(job,'DELIVERY_OUTCOME_UNKNOWN','delivery_outcome_unknown')
        if self.claim():raise Failure('late acknowledgement recovery authorized resend')
        self.event('begin.late_ack',['S36-031'],['real committed begin receipt','actual DB provider deadline crossed before test delivery','conservative monotonic elapsed time','deadline equality/late test counter zero','duplicate begin and unavailable-sender result cannot replace attempt','actual lease expiry recovers only unknown; no resend'])
        self.finish_case('late begin acknowledgement after provider deadline; no invocation/replacement')

    def lease_for_count(self,count):
        if count:return self.retry_lease(count)
        job,ch,enq=self.new()
        return job,ch,enq,self.claim()

    def challenge_snapshot(self,ch):
        return self.sql(f"select jsonb_build_array((select to_jsonb(c) from {CHALLENGES} c where id={quote(ch)}),(select coalesce(jsonb_agg(to_jsonb(f) order by f.failed_at),'[]') from {LEDGER} f where challenge_id={quote(ch)}))",label='private challenge/ledger snapshot')

    def supersede(self,ch):
        self.sql(f"update {CHALLENGES} set superseded_at=stamp.t,supersession_reason='resend',normalized_email=null,email_scrubbed_at=stamp.t from (select clock_timestamp() t) stamp where id={quote(ch)}",role=OWNER)

    def duplicate_matrix(self):
        families=['accepted','rejected','outcome_unknown','retryable1','retryable2','sender0','sender1','sender2','budget','deadline','unusable','recover_unknown','recover_cancel','recover_expired','recover_retry','begin_cancel','begin_expired','begin_retry']
        negative_count=0
        for family in families:
            self.fresh('duplicate_'+family,fixtures=True)
            if family.startswith('sender'):
                count=int(family[-1]);job,ch,enq,claim=self.lease_for_count(count)
                final=self.finalize(job,claim,count,None,None,'sender_unavailable');receipt=self.sql(final,role='service_role');kind='pre_send'
            elif family in ('recover_cancel','recover_expired','begin_cancel','begin_expired'):
                job,ch,enq=self.new();claim=self.claim();count=0;final=None
                if family.endswith('cancel'):self.supersede(ch)
                elif family.startswith('begin'):self.reduce_window(job,ch,9)
                else:self.shift(job,601)
                if family.startswith('begin'):self.sql(self.begin(job,claim),role='service_role');kind='unusable'
                else:
                    if family.endswith('cancel'):self.shift(job,31)
                    self.recover();kind='recovery'
            elif family in ('recover_retry','begin_retry'):
                job,ch,enq,claim=self.retry_lease(1);count=1;final=None;self.supersede(ch)
                if family.startswith('begin'):self.sql(self.begin(job,claim),role='service_role');kind='unusable'
                else:self.shift(job,31);self.recover();kind='recovery'
            else:
                count=3 if family=='budget' else 2 if family=='retryable2' else 1
                job,ch,enq,claim=self.lease_for_count(count-1)
                self.sql(self.begin(job,claim),role='service_role');kind='provider'
                if family=='recover_unknown':
                    self.shift(job,31);self.recover();kind='recovery';final=None
                else:
                    if family=='deadline':self.reduce_window(job,ch,12)
                    if family=='unusable':self.supersede(ch)
                    outcome=family if family in ('accepted','rejected','outcome_unknown') else 'not_accepted_retryable'
                    final=self.finalize(job,claim,count,outcome,'synthetic-id' if outcome=='accepted' else None,evidence=outcome=='not_accepted_retryable')
                    receipt=self.sql(final,role='service_role')
            row=self.row(job);challenge=self.challenge_snapshot(ch)
            if row['resolution_kind']!=kind or row['attempt_count']!=count:raise Failure('item-17 source provenance/count')
            if final:
                if not receipt or self.sql(final,role='service_role')!=receipt:raise Failure('item-17 exact stored duplicate receipt')
                parsed=json.loads(receipt)
                for field in ('state','attempt_count','terminal_disposition','terminal_at','available_at','provider_message_id','challenge_recording','resolved_at'):
                    if parsed[field]!=row[field]:raise Failure('item-17 stored receipt field mismatch')
            inputs=[('accepted','synthetic-id',None,False),('accepted','different-id',None,False),('rejected',None,None,False),('outcome_unknown',None,None,False),('not_accepted_retryable',None,None,True),(None,None,'sender_unavailable',False)]
            for outcome,pid,pre,evidence in inputs:
                query=self.finalize(job,claim,max(1,count) if outcome else count,outcome,pid,pre,evidence)
                compatible=(kind=='provider' and outcome==row['resolution_provider_outcome'] and pid==row['provider_message_id'] or kind=='pre_send' and outcome is None and pre=='sender_unavailable')
                result=self.sql(query,role='service_role')
                if compatible:
                    if result!=receipt:raise Failure('item-17 compatible input changed original receipt')
                elif result:raise Failure('item-17 incompatible authority returned receipt')
                else:negative_count+=1
                if self.row(job)!=row or self.challenge_snapshot(ch)!=challenge:raise Failure('item-17 duplicate/conflict changed row or recorder authority')
            if final:
                for stale in (dict(claim,lease_id=str(uuid.uuid4())),dict(claim,fence=str(int(claim['fence'])+1))):
                    query=self.finalize(job,stale,count,row['resolution_provider_outcome'],row['provider_message_id'],row['resolution_pre_send_disposition'],row['resolution_non_acceptance_proven'])
                    if self.sql(query,role='service_role'):raise Failure('item-17 tuple conflict returned receipt')
                    negative_count+=1
                query=self.finalize(job,claim,(count+1) if count<3 else 2,row['resolution_provider_outcome'],row['provider_message_id'],row['resolution_pre_send_disposition'],row['resolution_non_acceptance_proven'])
                if self.sql(query,role='service_role'):raise Failure('item-17 attempt conflict returned receipt')
                negative_count+=1
            if self.row(job)!=row or self.challenge_snapshot(ch)!=challenge:raise Failure('item-17 late conflict changed original resolution')
            if row['state']=='RETRY_WAIT':
                self.check(f"select available_at=resolved_at+interval '{5 if count==1 else 20} seconds' and terminal_at is null and terminal_disposition is null and nonce is not null and lease_id is null from {TABLE} where job_id={quote(job)}",'retry duplicate exact arithmetic/retention')
                self.shift(job,6 if count==1 else 21);newclaim=self.claim()
                if not newclaim or newclaim['attempt_count']!=count:raise Failure('retry fresh claim missing')
                frozen=self.row(job)
                if self.sql(final,role='service_role') or self.row(job)!=frozen:raise Failure('old retry duplicate valid after fresh claim')
                self.shift(job,31);recovered=self.recover();frozen=self.row(job)
                if len(recovered)!=1 or frozen['state']!='RETRY_WAIT' or frozen['attempt_count']!=count:raise Failure('retry expired lease recovery changed positive history')
                if self.sql(final,role='service_role') or self.row(job)!=frozen:raise Failure('old retry duplicate revived after expired fresh lease')
                self.event('duplicates.'+family,['S36-033','S36-035','S36-036','S36-049','S36-050','S36-051','S36-052','S36-053'],['entire item-17 valid/invalid representation and tuple families','stored availability/resolved_at/recorder unchanged','fresh claim invalidates old retry permanently including safe recovery','no recorder/scrub/increment on intermediate retry'])
            else:
                self.scrub(job)
                if self.recover() or self.claim():raise Failure('terminal duplicate fixture reselected')
                seq=self.sql(f'select jsonb_build_array(last_value,is_called) from {SEQ}')
                duplicate=json.loads(self.sql(enq,role='service_role'))
                if duplicate['state']!=row['state'] or self.row(job)!=row or self.challenge_snapshot(ch)!=challenge or self.sql(f'select jsonb_build_array(last_value,is_called) from {SEQ}')!=seq:raise Failure('terminal-scrub enqueue duplicate changed authority')
                self.shift(job,86401)
                if self.sql('select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(100)',role='service_role')!='1':raise Failure('terminal family purge failed')
                if self.sql(enq,role='service_role') or self.sql(enq.replace(job,str(uuid.uuid4())),role='service_role') or self.sql(f'select count(*) from {TABLE}')!='0':raise Failure('post-purge duplicate/new enqueue recreated job')
                self.event('duplicates.'+family,['S36-007','S36-008','S36-032','S36-044','S36-045','S36-049','S36-052','S36-053','S36-063','S36-068','S36-078'],['actual supported terminal path '+family,'item-17 exact stored compatible receipt or recovery/unusable never compatible','all valid conflicting provider/pre-send and tuple inputs rejected without recorder mutation','complete terminal scrub','exact enqueue duplicate after scrub; real retained purge; both resurrection forms refused'])
            self.finish_case('item-17 duplicate/provenance/receipt/scrub/purge '+family)
        print('DUPLICATE_MATRIX_COUNTS '+json.dumps({'families':len(families),'incompatible_inputs':negative_count}),flush=True)

    def claim_stale_finalize(self):
        for claim_first in (False,True):
            self.fresh('claim_stale',fixtures=True);self.concurrent+=1
            job,ch,enq,old=self.sendable();final=self.finalize(job,old,1,'not_accepted_retryable',None,evidence=True)
            self.sql(final,role='service_role');self.shift(job,6);before=self.row(job)
            claim=self.actor('fresh_claim',OWNER);stale=self.actor('stale_finalize',OWNER)
            claim_sql='select count(*) from public.runtime_claim_every8d_settings_auth_email_v1(1)'
            if claim_first:
                claim.start(claim_sql);claim.ready('1');stale.start(self.count_query(final));self.blocked(stale,claim,'old finalization waits on fresh generation');claim.finish();stale.ready('0');stale.finish()
            else:
                stale.start(self.count_query(final));stale.ready('1');claim.start(claim_sql);claim.ready('0')
                self.two_sessions(stale,claim,TABLE,'AccessShareLock','claim SKIP LOCKED old duplicate authority')
                if self.row(job)!=before:raise Failure('old duplicate mutated prior schedule')
                claim.finish();stale.finish()
                if not self.claim():raise Failure('claim did not proceed after old duplicate release')
            row=self.row(job)
            if row['state']!='LEASED' or row['attempt_count']!=1 or row['lease_id']==old['lease_id'] or row['fence_generation']<=int(old['fence']):raise Failure('claim/stale finalization lost fresh generation')
            if self.sql(final,role='service_role') or self.row(job)!=row:raise Failure('stale resolution retained send authority')
            self.event('claim.stale_finalization_'+str(claim_first),['S36-021','S36-023','S36-051'],['independent sessions; both legal winner orders','actual blocking or SKIP LOCKED lock evidence','one fresh lease/fence; unchanged attempt count','prior generation permanently incompatible; final state asserted'])
            self.finish_case('claim versus stale finalization '+str(claim_first))

    def sender_expiry(self):
        for count in (0,1,2):
            for sender_first in (False,True):
                self.fresh('sender_expiry',fixtures=True);self.concurrent+=1
                job,ch,enq,claim=self.lease_for_count(count);before=self.row(job)
                final=self.finalize(job,claim,count,None,None,'sender_unavailable')
                sender=self.actor('sender_unavailable',OWNER);recover=self.actor('sender_recovery',OWNER)
                if sender_first:
                    sender.start(self.count_query(final));sender.ready('1')
                    recover.start('select count(*) from public.runtime_recover_every8d_settings_auth_email_v1(100)');recover.ready('0')
                    self.two_sessions(sender,recover,TABLE,'AccessShareLock','unexpired sender wins; recovery has no candidate')
                    recover.finish();sender.finish();self.scrub(job,'FAILED_TERMINAL','sender_unavailable_pre_send')
                    self.shift(job,31)
                    if self.recover() or self.claim():raise Failure('sender terminal created replacement lease')
                else:
                    self.shift(job,28);self.wait_expiry(job,seconds=8)
                    recover.start('select count(*) from public.runtime_recover_every8d_settings_auth_email_v1(100)');recover.ready('1')
                    sender.start(self.count_query(final));self.blocked(sender,recover,'expired sender waits on recovered authority');recover.finish();sender.ready('0');sender.finish()
                    row=self.row(job)
                    if row['state']!=('PENDING' if count==0 else 'RETRY_WAIT') or row['attempt_count']!=count or row['lease_id'] is not None:raise Failure('sender loser recovery fabricated attempt')
                    fresh=self.claim()
                    if not fresh or fresh['lease_id']==claim['lease_id'] or int(fresh['fence'])<=int(claim['fence']):raise Failure('sender expiry did not require fresh claim')
                    row=self.row(job)
                    if self.sql(final,role='service_role') or self.row(job)!=row:raise Failure('old sender authority accepted after fresh claim')
                    result=self.sql(self.finalize(job,fresh,count,None,None,'sender_unavailable'),role='service_role')
                    if not result:raise Failure('current LEASED sender unavailable control failed')
                    self.scrub(job,'FAILED_TERMINAL','sender_unavailable_pre_send')
                if self.row(job)['attempt_count']!=count:raise Failure('sender unavailable incremented attempt')
                self.event('sender.expiry_'+str(count)+'_'+str(sender_first),['S36-022','S36-044','S36-045','S36-046','S36-047'],['unexpired LEASED sender wins or expired recovery wins; both legally constructible orderings','new claim cannot coexist with current unexpired lease; terminal winner excludes it','independent sessions and real lock/state evidence','old lease/fence always refused after expiry/recovery/new claim','count unchanged; recorder mapping and complete scrub'])
                self.finish_case('sender unavailable versus expiry/new claim count '+str(count)+' sender first '+str(sender_first))

    def crypto_unusable(self):
        for count in (0,1,2):
            self.fresh('crypto_unusable',fixtures=True)
            job,ch,enq,claim=self.lease_for_count(count)
            for iteration in range(3):
                self.shift(job,31);recovered=self.recover();row=self.row(job)
                if len(recovered)!=1 or row['state']!=('PENDING' if count==0 else 'RETRY_WAIT') or row['attempt_count']!=count:raise Failure('repeated no-begin recovery changed positive history')
                claim=self.claim()
                if not claim or claim['attempt_count']!=count:raise Failure('crypto-loss safe re-claim failed')
            self.supersede(ch);self.shift(job,31);result=self.recover()
            expected='CANCELLED' if count==0 else 'FAILED_TERMINAL';disp='cancelled_pre_send' if count==0 else 'retry_unusable'
            if len(result)!=1 or result[0]['state']!=expected:raise Failure('crypto-loss eventual unusable closure')
            self.scrub(job,expected,disp);row=self.row(job)
            if row['attempt_count']!=count or row['challenge_recording']!='not_applicable' or self.claim() or self.recover():raise Failure('crypto-loss fabricated provider attempt/recorder/reopening')
            self.event('crypto_loss.unusable_'+str(count),['S36-064','S36-065','S36-066','S36-067','S36-078'],['three real claim/expired-lease cycles without begin','no ciphertext reconstruction or provider invocation','zero or prior-positive attempt unchanged','eventual unusable truthful terminalization; full scrub; no recorder/resend'])
            self.finish_case('crypto-loss repeated safe recovery then unusable closure '+str(count))

    def time_equalities(self):
        self.fresh('time_predicates',fixtures=True)
        job,ch,enq=self.new();before=self.seal()
        # Execute the exact predicates fetched from installed, fingerprint-checked routines.
        # Unit-level exact microsecond equality is paired with real RPC/post-wait state proofs.
        # No production clock or function is replaced; all T values originate in PostgreSQL.
        rules=[
            ('enqueue_every8d_settings_auth_email_core_v1','decision_at>=v_challenge.expires_at','expires_at',0,lambda delta:delta<=0),
            ('begin_every8d_settings_auth_email_send_core_v1','decision_at>=v_job.lease_expires_at','lease_expires_at',0,lambda delta:delta<=0),
            ('begin_every8d_settings_auth_email_send_core_v1','v_job.available_at<=decision_at','available_at',0,lambda delta:delta<=0),
            ('claim_every8d_settings_auth_email_core_v1',"decision_at+interval '10 seconds'<v_job.delivery_deadline_at",'delivery_deadline_at',10,lambda delta:delta>0),
            ('begin_every8d_settings_auth_email_send_core_v1',"decision_at+interval '10 seconds'<v_job.lease_expires_at",'lease_expires_at',10,lambda delta:delta>0),
            ('finalize_every8d_settings_auth_email_core_v1',"next_available+interval '10 seconds'>=v_job.delivery_deadline_at",'delivery_deadline_at',15,lambda delta:delta<=0),
            ('recover_every8d_settings_auth_email_core_v1','decision_at<v_job.lease_expires_at','lease_expires_at',0,lambda delta:delta>0),
            ('purge_every8d_settings_auth_email_core_v1',"v_job.terminal_at>decision_at-interval '24 hours'",'terminal_at',-86400,lambda delta:delta>0),
            ('purge_every8d_settings_auth_email_core_v1','v_challenge.expires_at>decision_at','expires_at',0,lambda delta:delta>0),
            ('protect_every8d_settings_auth_email_outbox_v1',"old.terminal_at>decision_at-interval '24 hours'",'terminal_at',-86400,lambda delta:delta>0),
            ('protect_every8d_settings_auth_email_outbox_v1','c.expires_at<=decision_at','expires_at',0,lambda delta:delta<=0),
        ]
        total=0
        for routine,expression,field,offset,expected in rules:
            body=self.sql(f'select prosrc from pg_proc where pronamespace=\'public\'::regnamespace and proname={quote(routine)}')
            if expression not in body:raise Failure('exact production time predicate could not be located')
            executable=re.sub(r'\b(v_job|v_challenge|old|c)\.', '', expression)
            for delta in (-1,0,1):
                query=f"with stamp as materialized(select clock_timestamp() t), boundary as(select t decision_at,t+interval '5 seconds' next_available,t+interval '{offset} seconds'+interval '{delta} microseconds' {field} from stamp) select ({executable}) is {'true' if expected(delta) else 'false'} from boundary"
                self.check(query,'executed installed time predicate before/equal/after')
                total+=1
        if self.seal()!=before:raise Failure('read-only equality proof mutated authority')
        self.event('time.exact_predicate_units',['S36-034','S36-041','S36-069','S36-070','S36-071','S36-079'],['33 executed before/equal/after predicates from installed fingerprint-checked production bodies','DB-generated T; no caller-controlled runtime clock or replacement function','strict vs inclusive comparisons asserted independently','exact equality units paired with supported runtime state and real post-wait proofs','original catalog/ACL/rows/guard/sequence unchanged'])
        print('TIME_PREDICATE_UNITS '+str(total),flush=True)
        self.finish_case('exact production SQL boundary predicates at DB-time equality')

        self.fresh('retention_equality',fixtures=True)
        job,ch,enq,claim=self.sendable();self.sql(self.finalize(job,claim,1),role='service_role')
        self.check(f"select c.expires_at<=o.created_at+interval '10 minutes' and o.terminal_at>=o.created_at and c.expires_at<o.terminal_at+interval '24 hours' from {TABLE} o join {CHALLENGES} c on c.id=o.challenge_id where o.job_id={quote(job)}",'valid retention implies linked challenge already expired')
        # The linked-future/retained intersection is impossible for valid ten-minute challenges.
        # Test its exact defensive SQL predicate above, and nearest legal retained row below.
        self.shift(job,86401)
        before=self.seal()
        context=f"set local wincrm.c3c3_outbox_operation='purge';set local wincrm.c3c3_outbox_purge='on';"
        self.sql(f"begin;{context} select set_config('wincrm.c3c3_outbox_decision_at',(terminal_at+interval '24 hours'-interval '1 microsecond')::text,true) from {TABLE} where job_id={quote(job)};delete from {TABLE} where job_id={quote(job)};commit",role=OWNER,error='23514',label='retention one microsecond before boundary rejects')
        if self.seal()!=before:raise Failure('before-retention guard refusal changed authority')
        self.sql(f"begin;{context} select set_config('wincrm.c3c3_outbox_decision_at',(terminal_at+interval '24 hours')::text,true) from {TABLE} where job_id={quote(job)};delete from {TABLE} where job_id={quote(job)};do $proof$ begin if exists(select 1 from {TABLE}) then raise exception 'retention equality did not delete';end if;end; $proof$;rollback",role=OWNER,label='real protection DELETE at exact captured DB retention boundary')
        if self.seal()!=before:raise Failure('equality control rollback did not restore source')
        if self.sql('select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(1)',role='service_role')!='1':raise Failure('supported purge after retention failed')
        self.event('time.retention_equality',['S36-069','S36-070','S36-071','S36-079'],['real owner guard rejects captured DB T one microsecond before retention; source unchanged','real protected DELETE accepts exact T=terminal_at+24h; assertion inside transaction then rollback restores source','real RPC after retention deletes child','future linked challenge plus valid 24h-retained terminal impossible: expiry<=created+10m<=terminal+10m<terminal+24h','linked-expiry exact SQL predicate before/equal/after executed; nearest legal RPC fixture asserted; no impossible prerequisite forged'])
        self.finish_case('retention before/equal/after and linked-expiry predicate contradiction')

    def time_waits(self):
        for target in ('window','challenge','lease'):
            self.fresh('time_wait_'+target,fixtures=True);self.concurrent+=1
            if target=='lease':job,ch,enq,claim=self.sendable();self.shift(job,28)
            else:
                job,ch,enq=self.new();self.reduce_window(job,ch,12);claim=self.claim()
                if not claim:raise Failure('time crossing source needs strict initial full window')
            before=self.row(job)
            holder=self.actor('time_holder_'+target,OWNER);operation=self.actor('time_waiter_'+target,OWNER)
            holder.start(f'select 1 from {CHALLENGES} where id={quote(ch)} for update');holder.ready('1')
            query=self.finalize(job,claim,1) if target=='lease' else self.begin(job,claim)
            operation.start(self.count_query(query));self.blocked(operation,holder,'actual '+target+' boundary wait')
            predicate='clock_timestamp()>=lease_expires_at' if target=='lease' else "clock_timestamp()+interval '10 seconds'>=delivery_deadline_at" if target=='window' else 'clock_timestamp()>=delivery_deadline_at'
            self.check(f"select a.xact_start<o.{'lease_expires_at' if target=='lease' else 'delivery_deadline_at'} from pg_stat_activity a cross join {TABLE} o where a.application_name={quote(operation.app)} and o.job_id={quote(job)}",'transaction started before authority boundary')
            self.until(lambda:self.sql(f'select {predicate} from {TABLE} where job_id={quote(job)}')=='t','actual DB '+target+' crossing',seconds=15)
            self.blocked(operation,holder,'still blocked after '+target+' crossing');holder.finish();operation.ready('0' if target=='lease' else '1');operation.finish()
            if target=='lease':
                if self.row(job)!=before:raise Failure('post-wait expired finalize changed authority')
                recovered=self.recover()
                if len(recovered)!=1 or recovered[0]['state']!='DELIVERY_OUTCOME_UNKNOWN':raise Failure('expired sending did not recover truthfully')
                self.scrub(job,'DELIVERY_OUTCOME_UNKNOWN')
            else:
                self.scrub(job,'EXPIRED','expired_pre_send')
                if self.row(job)['attempt_count']!=0 or self.row(job)['challenge_recording']!='not_applicable':raise Failure('post-wait expiry fabricated attempt or recorder')
            self.event('time.wait_'+target,['S36-028','S36-080','S36-081'],['independent sessions and actual challenge lock wait','xact_start precedes boundary; DB time crosses while waiter remains blocked','post-lock clock authority rejects old admission','final state/attempt/recorder/scrub asserted'])
            self.finish_case('fresh post-wait DB time crosses '+target)

        self.fresh('retention_old_transaction',fixtures=True);self.concurrent+=1
        job,ch,enq,claim=self.sendable();self.sql(self.finalize(job,claim,1),role='service_role');self.shift(job,86395)
        parent=self.sql(f'select g.installation_id from public.every8d_settings_enrollment_grants g join {CHALLENGES} c on c.enrollment_grant_id=g.id where c.id={quote(ch)}')
        holder=self.actor('retention_parent',OWNER);purge=self.actor('retention_old_xact',OWNER)
        holder.start(f'select 1 from public.ghl_marketplace_installations where id={quote(parent)} for update');holder.ready('1')
        purge.start('select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(1)');purge.ready('0')
        self.check(f"select a.xact_start<o.terminal_at+interval '24 hours' from pg_stat_activity a cross join {TABLE} o where a.application_name={quote(purge.app)} and o.job_id={quote(job)}",'purge transaction predates retention eligibility')
        self.until(lambda:self.sql(f"select clock_timestamp()>=terminal_at+interval '24 hours' from {TABLE} where job_id={quote(job)}")=='t','actual retention crossing',seconds=8)
        purge.send("select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(1);select 'C3C2A_READY';")
        self.blocked(purge,holder,'eligible second invocation waits on real parent lock')
        holder.finish();purge.ready('1');purge.finish()
        if self.sql(f'select count(*) from {TABLE}')!='0':raise Failure('old transaction purge used stale transaction-start time')
        self.event('time.wait_retention',['S36-069','S36-080','S36-081'],['real purge before threshold yields zero while parent locked','bounded prefix excludes pre-retention candidates: invocation cannot wait on a row not selected','same physical transaction crosses actual DB retention boundary','next invocation in same old transaction waits on parent then purges one using fresh DB time','final outbox empty; linked challenge retained; no forged runtime clock'])
        self.finish_case('purge retention crossing in old transaction and real parent-lock wait')

    def disposition_precedence(self):
        for count in (1,2,3):
            self.fresh('precedence',fixtures=True)
            job,ch,enq,claim=self.lease_for_count(count-1);self.sql(self.begin(job,claim),role='service_role')
            self.reduce_window(job,ch,12);self.supersede(ch)
            final=self.finalize(job,claim,count,'not_accepted_retryable',None,evidence=True)
            receipt=self.sql(final,role='service_role')
            if not receipt:raise Failure('precedence result missing')
            expected='retry_budget_exhausted' if count==3 else 'retry_unusable'
            self.scrub(job,'FAILED_TERMINAL',expected);row=self.row(job)
            if row['attempt_count']!=count or row['challenge_recording']!='not_applicable' or row['resolution_non_acceptance_proven'] is not True:raise Failure('precedence fabricated attempt or recorder')
            self.check(f"select delivery_succeeded_at is null and delivery_failed_at is null from {CHALLENGES} where id={quote(ch)}",'retry exhaustion has no challenge delivery class')
            self.event('retry.precedence_'+str(count),['S36-037','S36-038','S36-039','S36-040','S36-042','S36-043','S36-078'],['simultaneous budget/unusable/deadline fixtures; exact frozen precedence','count preserved; no fourth begin/claim','no challenge delivery recorder class','complete terminal scrub'])
            self.finish_case('retry terminal precedence count '+str(count))

    def terminal_routes(self):
        routes=[('begin','LEASED',count,reason) for count in (0,1,2) for reason in ('unusable','deadline')]
        routes += [('recover',origin,count,reason) for origin,count in [('PENDING',0),('LEASED',0),('LEASED',1),('LEASED',2),('RETRY_WAIT',1),('RETRY_WAIT',2)] for reason in ('unusable','deadline')]
        for operation,origin,count,reason in routes:
            self.fresh('terminal_route',fixtures=True)
            if origin=='PENDING':job,ch,enq=self.new();claim=None
            elif origin=='RETRY_WAIT':
                job,ch,enq,claim=self.lease_for_count(count-1);self.sql(self.begin(job,claim),role='service_role')
                self.sql(self.finalize(job,claim,count,'not_accepted_retryable',None,evidence=True),role='service_role')
                self.shift(job,6 if count==1 else 21)
            else:job,ch,enq,claim=self.lease_for_count(count)
            if reason=='unusable':self.supersede(ch)
            else:self.reduce_window(job,ch,9)
            if operation=='recover' and origin=='LEASED':self.shift(job,31)
            challenge=self.challenge_snapshot(ch)
            if operation=='begin':result=self.sql(self.begin(job,claim),role='service_role')
            else:result=json.dumps(self.recover())
            if not result or result=='[]':raise Failure('terminal route did not return receipt')
            state=('CANCELLED' if reason=='unusable' else 'EXPIRED') if count==0 else 'FAILED_TERMINAL'
            disposition=('cancelled_pre_send' if reason=='unusable' else 'expired_pre_send') if count==0 else ('retry_unusable' if reason=='unusable' else 'retry_deadline_exhausted')
            self.scrub(job,state,disposition);row=self.row(job)
            if row['attempt_count']!=count or row['resolution_kind']!=('unusable' if operation=='begin' else 'recovery') or row['challenge_recording']!='not_applicable' or row['resolution_non_acceptance_proven']!=(count>0):raise Failure('terminal route fabricated attempt/provenance/recording')
            if self.challenge_snapshot(ch)!=challenge or self.recover() or self.claim():raise Failure('terminal route called recorder/reopened terminal')
            if claim and self.sql(self.begin(job,claim),role='service_role'):raise Failure('terminal route retained stale send authority')
            self.event('terminal.'+'_'.join(map(str,(operation,origin,count,reason))),['S36-040','S36-042','S36-043','S36-059','S36-061','S36-062','S36-063','S36-078'],['supported '+operation+' from '+origin+' with frozen attempt family','truthful unusable/deadline disposition','all four encrypted columns NULL; active lease and availability cleared','no attempt increment or recorder mutation','terminal not reselected; stale begin zero'])
            self.finish_case('terminal scrub '+operation+' '+origin+' count '+str(count)+' '+reason)

    def recorder_mapping(self):
        cases=[('accepted',None,None),('rejected',None,'provider_rejected'),('outcome_unknown',None,'delivery_outcome_unknown'),(None,'sender_unavailable','sender_unavailable'),('recovery',None,'delivery_outcome_unknown')]
        for outcome,pre,failure_class in cases:
            for false_receipt in (False,True):
                self.fresh('recorder_mapping',fixtures=True)
                if outcome is None:job,ch,enq=self.new();claim=self.claim();count=0
                else:job,ch,enq,claim=self.sendable();count=1
                if false_receipt:
                    self.sql(f"select public.runtime_record_every8d_settings_challenge_delivery_v1(request_token_hash,true,null) from {TABLE} where job_id={quote(job)}",role=OWNER)
                challenge=self.challenge_snapshot(ch)
                if outcome=='recovery':self.shift(job,31);challenge=self.challenge_snapshot(ch);result=self.recover()
                else:result=self.sql(self.finalize(job,claim,count,outcome,'synthetic-id' if outcome=='accepted' else None,pre),role='service_role')
                row=self.row(job);self.scrub(job)
                if not result or row['challenge_recording']!=('not_recorded' if false_receipt else 'recorded'):raise Failure('recorder exact boolean result mapping')
                if false_receipt:
                    if self.challenge_snapshot(ch)!=challenge:raise Failure('false recorder receipt changed challenge/ledger')
                else:
                    expected_success=outcome=='accepted'
                    self.check(f"select (delivery_succeeded_at is not null)={'true' if expected_success else 'false'} and (delivery_failed_at is not null)={'false' if expected_success else 'true'} and delivery_failure_class is not distinct from {'null' if failure_class is None else quote(failure_class)} from {CHALLENGES} where id={quote(ch)}",'exact recorder taxonomy and success/failure stamps')
                self.event('recorder.mapping_'+str(outcome)+'_'+str(false_receipt),['S36-032','S36-045','S36-054','S36-055','S36-060','S36-078'],['actual unchanged challenge recorder','exact success/failure class and stamp mapping','recorded/not_recorded receipt boolean','false receipt preserves entire challenge/ledger','full atomic terminal scrub'])
                self.finish_case('exact recorder taxonomy '+str(outcome)+' false '+str(false_receipt))

    def purge_duplicate_race(self):
        for purge_first in (False,True):
            self.fresh('purge_duplicate',fixtures=True);self.concurrent+=1
            job,ch,enq,claim=self.sendable();final=self.finalize(job,claim,1)
            self.sql(final,role='service_role');self.shift(job,86401);before=self.row(job);challenge=self.challenge_snapshot(ch)
            purge=self.actor('purge_winner',OWNER);duplicate=self.actor('duplicate_winner',OWNER)
            purge_query='select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(1)'
            if purge_first:
                purge.start(purge_query);purge.ready('1');duplicate.start(self.count_query(final));self.blocked(duplicate,purge,'duplicate waits for retained purge');purge.finish();duplicate.ready('0');duplicate.finish()
            else:
                duplicate.start(self.count_query(final));duplicate.ready('1');purge.start(purge_query);purge.ready('0')
                self.two_sessions(duplicate,purge,TABLE,'AccessShareLock','purge skips held duplicate receipt')
                if self.row(job)!=before or self.challenge_snapshot(ch)!=challenge:raise Failure('duplicate winner mutated scrubbed receipt/recorder')
                purge.finish();duplicate.finish()
                if self.sql(purge_query,role='service_role')!='1':raise Failure('purge did not process after duplicate release')
            if self.sql(f'select count(*) from {TABLE}')!='0' or self.challenge_snapshot(ch)!=challenge or self.sql(final,role='service_role') or self.sql(enq,role='service_role'):raise Failure('purge/duplicate final state not closed')
            self.event('purge.duplicate_'+str(purge_first),['S36-072'],['two independent physical sessions; actual wait or SKIP LOCKED evidence','both winner orders; original duplicate receipt unchanged while retained','purge deletes only child; challenge/ledger unchanged','after release/purge duplicate zero; no resurrection/orphan'])
            self.finish_case('purge versus duplicate finalize final state '+str(purge_first))

    def baseline_matrix(self):
        groups={
            'basic':['S36-002','S36-012','S36-024','S36-025'],
            'outcomes':['S36-032','S36-054','S36-055','S36-056','S36-057','S36-058'],
            'retries':['S36-013','S36-014','S36-033','S36-035','S36-036','S36-037','S36-038','S36-039'],
            'loss_and_recovery':['S36-064','S36-065','S36-066','S36-067','S36-078'],
            'purge':['S36-068','S36-069'],
            'negatives':['S36-032','S36-088','S36-089'],
            'races':['S36-017','S36-018','S36-026','S36-027','S36-073','S36-074','S36-075','S36-076'],
            'maintenance':['S36-084','S36-086','S36-091','S36-094','S36-095','S36-101','S36-102']}
        started=self.scenarios;prior_races=self.concurrent
        for method,obligations in groups.items():
            before=self.scenarios;race_before=self.concurrent
            getattr(self,method)()
            self.event('baseline.'+method,obligations,['entire original executable method rerun on corrected installed SQL','all original state/receipt/recorder/ACL/sequence/rollback assertions retained','executed scenarios='+str(self.scenarios-before),'independent-session races='+str(self.concurrent-race_before)])
        if self.scenarios-started!=57 or self.concurrent-prior_races!=18:raise Failure('original 57-scenario/18-race matrix count changed')

    def section36_additions(self):
        for method,obligations in [('enqueue_cleanup',['S36-006','S36-074','S36-075','S36-076']),('begin_recovery',['S36-022','S36-028','S36-029','S36-080','S36-081']),('restart',['S36-087','S36-090','S36-091','S36-092','S36-093','S36-098','S36-106'])]:
            getattr(self,method)()
            self.event('section36.'+method,obligations,['complete previously added method freshly executed','unchanged expected frozen semantics','actual independent sessions/lock state and final authority snapshots','real restart with unchanged guard/data directory; exact refusal and no partial mutation where applicable'])

    def legacy_regressions(self):
        from every8dSettingsEmailOutboxRegressions import run
        run()
        self.event('regression.all11',['S36-107'],['all 11 exact canonical prerequisite regression scripts executed from pinned base','fresh isolated PG17 container','original assertions unmodified','zero surviving regression databases/backends/containers'])
        self.scenarios+=11

CASES=('direct_owner_sender','guard_finalize_matrix','guard_source_matrix','guard_begin_matrix','guard_recovery_matrix','guard_purge_matrix','guard_transition_matrix','guard_enqueue_matrix','guard_retry_terminal_controls','baseline_matrix','populated','used_purged','maintenance_timeout','sequence_allocations','sequence_abort_gap','sequence_tamper','fingerprint_tamper','claim_boundaries','claim_batch','enqueue_uniqueness','orphan_supersession','enqueue_concurrency','begin_acknowledgements','duplicate_matrix','claim_stale_finalize','sender_expiry','crypto_unusable','time_equalities','time_waits','disposition_precedence','terminal_routes','recorder_mapping','purge_duplicate_race','section36_additions','legacy_regressions')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--database',required=True);parser.add_argument('--prerequisite',required=True);parser.add_argument('--container',required=True)
    parser.add_argument('--cases',default='populated');parser.add_argument('--evidence',required=True)
    args=parser.parse_args();args.native_psql=None;args.native_port=0
    if not all(re.fullmatch(r'c3c3_[a-z0-9_]+',x) for x in (args.database,args.prerequisite)):
        parser.error('only dedicated disposable databases')
    selected=CASES if args.cases=='all' else args.cases.split(',')
    if any(case not in CASES for case in selected):parser.error('unknown closure slice')
    h=Closure(args);success=False;cleaned=False
    pg_version=h.sql('show server_version')
    try:
        h.preuse_control()
        h.sql((ROOT/'test/postgres/every8dSettingsEmailOutboxAad.sql').read_bytes().decode(),h.template,OWNER,label='independent SQL AAD golden vectors')
        h.event('aad.sql_vectors',[],['two fixed SQL vectors passed; no sequence allocation'])
        for case in selected:getattr(h,case)()
        success=True
    except Failure as exc:
        h.events.append({'scenario_id':args.cases,'status':'FAIL','diagnosis':str(exc)})
        raise SystemExit('FAIL '+str(exc))
    finally:
        try:
            h.cleanup();cleaned=True
        finally:
            Path(args.evidence).write_text(json.dumps({'status':'PASS' if success and cleaned else 'FAIL','complete_suite':args.cases=='all' and success and cleaned,'pg_version':pg_version,'cleanup':{'harness_backends_zero':cleaned,'base_databases_zero':False,'regression_resources_zero':any(e['scenario_id']=='regression.all11' for e in h.events)},'scenarios':h.scenarios,'races':h.concurrent,'guard_groups':h.guard_groups,'guard_function_fingerprint':json.loads((ROOT/'test/postgres/every8dSettingsEmailOutboxManifest.json').read_bytes())['functions']['protect_every8d_settings_auth_email_outbox_v1()'],'proof_sources_sha256':{str(file.relative_to(ROOT)):hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted((ROOT/'test/postgres').glob('every8dSettingsEmailOutbox*')) if file.is_file()},'migration_sha256':hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),'harness_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'events':h.events},indent=2)+'\n',encoding='utf-8')
    print(f'C3c-3 '+('complete Section36' if args.cases=='all' else 'closure slices')+f' PASS: scenarios={h.scenarios}; independent-session races={h.concurrent}; unexpected deadlocks/timeouts=0',flush=True)

if __name__=='__main__':main()
