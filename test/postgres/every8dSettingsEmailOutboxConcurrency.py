#!/usr/bin/env python3
"""Dedicated C3c-3 disposable PG17 proof. No production inputs or provider calls."""
import argparse
import json
import os
import re
import struct
import subprocess
import time
import uuid
from pathlib import Path
from every8dSettingsSessionConsumptionConcurrency import Harness, Failure, OWNER, quote

ROOT=Path(__file__).resolve().parents[2]
MIGRATION=ROOT/'supabase/migrations/202610230001_every8d_settings_auth_email_outbox.sql'
ROLLBACK=ROOT/'supabase/rollback/202610230001_every8d_settings_auth_email_outbox.sql'
POSTFLIGHT=ROOT/'test/postgres/every8dSettingsEmailOutboxPostflight.sql'
TABLE='public.every8d_settings_auth_email_outbox'
SEQ='public.every8d_settings_auth_email_outbox_fence_seq'
STATES=['PENDING','LEASED','SENDING','RETRY_WAIT','ACCEPTED','FAILED_TERMINAL','DELIVERY_OUTCOME_UNKNOWN','CANCELLED','EXPIRED']
TERMINAL=STATES[4:]

class Proof(Harness):
    def __init__(self,args):
        super().__init__(args)
        self.prefix='c3c3_'+str(os.getpid())
        self.template=args.database
        self.scenarios=0
        self.concurrent=0
    def case_db(self,label):
        self.scenarios+=1
        self.db=self.clone('case_'+str(self.scenarios),self.template)
        return self.db
    def finish_case(self,label):
        self.sql('drop database '+self.db,'postgres')
        self.clones.remove(self.db)
        self.db=self.template
        print('PASS '+label,flush=True)
    def row(self,job):
        return json.loads(self.sql('select row_to_json(o) from '+TABLE+' o where job_id='+quote(job)))
    def new(self,purpose='enrollment',enqueue=True):
        self.number+=1
        ch=self.sql('select c3c3_proof.pending('+str(self.number)+','+quote(purpose)+')',role=OWNER)
        job=str(uuid.uuid4())
        args=(f"{quote(job)}::uuid,{quote(ch)}::uuid,c3c2a_proof.hash('outbox-request-{self.number}'),"
              f"{quote(purpose)},1::smallint,1::smallint,1::smallint,'proof-key',"
              "decode(repeat('01',12),'hex'),decode('abcd','hex'),decode(repeat('02',16),'hex')")
        statement='select row_to_json(r) from public.runtime_enqueue_every8d_settings_auth_email_v1('+args+') r'
        if enqueue:
            result=self.sql(statement,role='service_role')
            if not result or json.loads(result)['job_id']!=job: raise Failure('enqueue admission')
        return job,ch,statement
    def claim(self):
        output=self.sql('select row_to_json(r) from public.runtime_claim_every8d_settings_auth_email_v1(1) r',role='service_role')
        return json.loads(output) if output else None
    def begin(self,job,claim):
        return f"select row_to_json(r) from public.runtime_begin_every8d_settings_auth_email_send_v1({quote(job)},{quote(claim['lease_id'])},{quote(claim['fence'])}::bigint) r"
    def finalize(self,job,claim,count,outcome='accepted',provider_id='synthetic-id',pre=None,evidence=False):
        values=[quote(job),quote(claim['lease_id']),quote(claim['fence'])+'::bigint',str(count)+'::smallint',
            'null' if outcome is None else quote(outcome),'null' if pre is None else quote(pre),
            'null' if evidence is None else 'true' if evidence else 'false',
            'null' if provider_id is None else quote(provider_id)]
        return 'select row_to_json(r) from public.runtime_finalize_every8d_settings_auth_email_v1('+','.join(values)+') r'
    def shift(self,job,seconds):
        self.sql(f"select c3c3_proof.shift_job({quote(job)},interval '{seconds} seconds')")
    def reduce_window(self,job,ch,seconds):
        self.sql(f"begin; alter table {TABLE} disable trigger protect_every8d_settings_auth_email_outbox; alter table public.every8d_settings_auth_challenges disable trigger protect_every8d_settings_auth_challenge; update public.every8d_settings_auth_challenges set created_at=stamp.t+interval '{seconds} seconds'-interval '10 minutes',expires_at=stamp.t+interval '{seconds} seconds' from (select clock_timestamp() t) stamp where id={quote(ch)}; update {TABLE} set created_at=created_at-interval '591 seconds',delivery_deadline_at=(select expires_at from public.every8d_settings_auth_challenges where id={quote(ch)}) where job_id={quote(job)}; set constraints all immediate; alter table {TABLE} enable trigger protect_every8d_settings_auth_email_outbox; alter table public.every8d_settings_auth_challenges enable trigger protect_every8d_settings_auth_challenge; commit")
    def recover(self):
        out=self.sql('select coalesce(json_agg(r),\'[]\') from public.runtime_recover_every8d_settings_auth_email_v1(100) r',role='service_role')
        return json.loads(out)
    def sendable(self,purpose='enrollment'):
        job,ch,enqueue=self.new(purpose)
        claim=self.claim()
        if not claim: raise Failure('claim admission')
        begin=json.loads(self.sql(self.begin(job,claim),role='service_role'))
        if begin['state']!='SENDING' or begin['attempt_count']!=1: raise Failure('begin authority')
        return job,ch,enqueue,claim
    def scrub(self,job,state=None,disposition=None):
        row=self.row(job)
        if state and row['state']!=state: raise Failure('truthful terminal state')
        if disposition and row['terminal_disposition']!=disposition: raise Failure('truthful terminal disposition')
        if row['state'] not in TERMINAL or any(row[x] is not None for x in ['encryption_key_version','nonce','ciphertext',
                'authentication_tag','lease_id','leased_at','lease_expires_at','available_at']): raise Failure('atomic terminal scrub')
        if row['terminal_at']!=row['resolved_at']: raise Failure('terminal resolution timestamp')
    def basic(self):
        for purpose in ['enrollment','login']:
            self.case_db('basic')
            job,ch,enqueue=self.new(purpose)
            before=self.row(job)
            if json.loads(self.sql(enqueue,role='service_role'))['state']!='PENDING' or self.row(job)!=before: raise Failure('exact enqueue duplicate')
            other=str(uuid.uuid4())
            if self.sql(enqueue.replace(job,other),role='service_role'): raise Failure('challenge unique conflict')
            if self.sql(enqueue.replace("decode('abcd','hex')","decode('abce','hex')"),role='service_role'): raise Failure('envelope conflict')
            claim=self.claim()
            if not claim or claim['attempt_count']!=0 or not isinstance(claim['fence'],str): raise Failure('claim receipt')
            if int(claim['fence'])<=before['fence_generation']: raise Failure('fresh fence')
            if self.claim(): raise Failure('claim active lease')
            stale=dict(claim,fence=str(int(claim['fence'])-1))
            if self.sql(self.begin(job,stale),role='service_role'): raise Failure('stale begin')
            begin=self.begin(job,claim)
            if not self.sql(begin,role='service_role') or self.sql(begin,role='service_role'): raise Failure('begin duplicate replay')
            final=self.finalize(job,claim,1)
            first=self.sql(final,role='service_role'); frozen=self.row(job)
            if self.sql(final,role='service_role')!=first or self.row(job)!=frozen: raise Failure('accepted duplicate mutated')
            if self.sql(self.finalize(job,claim,1,provider_id='different'),role='service_role'): raise Failure('accepted ID duplicate conflict')
            self.scrub(job,'ACCEPTED','accepted')
            if json.loads(self.sql(enqueue,role='service_role'))['state']!='ACCEPTED': raise Failure('scrub enqueue duplicate')
            self.finish_case('enqueue/claim/begin/accepted duplicates '+purpose)
    def outcomes(self):
        for outcome,state,disp in [('accepted','ACCEPTED','accepted'),('rejected','FAILED_TERMINAL','provider_rejected'),
                ('outcome_unknown','DELIVERY_OUTCOME_UNKNOWN','delivery_outcome_unknown'),(None,'FAILED_TERMINAL','sender_unavailable_pre_send')]:
            for recorder_false in [False,True]:
                self.case_db('outcome')
                if outcome is None:
                    job,ch,enqueue=self.new(); claim=self.claim(); count=0
                else:
                    job,ch,enqueue,claim=self.sendable(); count=1
                if recorder_false:
                    self.sql(f"select public.runtime_record_every8d_settings_challenge_delivery_v1(request_token_hash,true,null) from {TABLE} where job_id={quote(job)}",role=OWNER)
                final=self.finalize(job,claim,count,outcome,'synthetic-id' if outcome=='accepted' else None,
                    'sender_unavailable' if outcome is None else None)
                receipt=self.sql(final,role='service_role'); before=self.row(job)
                if self.sql(final,role='service_role')!=receipt or self.row(job)!=before: raise Failure('duplicate replay')
                expected='not_recorded' if recorder_false else 'recorded'
                if before['challenge_recording']!=expected: raise Failure('recorder boolean receipt')
                self.scrub(job,state,disp)
                for conflict in ['accepted','rejected','outcome_unknown','not_accepted_retryable',None]:
                    if conflict==outcome: continue
                    query=self.finalize(job,claim,count if conflict is None else max(1,count),conflict,
                        'conflict' if conflict=='accepted' else None,'sender_unavailable' if conflict is None else None,
                        conflict=='not_accepted_retryable')
                    if self.sql(query,role='service_role'): raise Failure('conflicting duplicate')
                self.finish_case('all truthful outcomes, duplicate compatibility, recorder '+expected)
        self.case_db('exception')
        job,ch,enqueue,claim=self.sendable(); before=self.row(job)
        self.sql('create trigger synthetic_recorder_failure before update on public.every8d_settings_auth_challenges for each row execute function c3c3_proof.reject_record()')
        self.sql(self.finalize(job,claim,1),role='service_role',error='23514')
        if self.row(job)!=before: raise Failure('recorder exception lost atomicity')
        self.sql('drop trigger synthetic_recorder_failure on public.every8d_settings_auth_challenges')
        self.shift(job,31); self.recover(); self.scrub(job,'DELIVERY_OUTCOME_UNKNOWN')
        self.finish_case('recorder exception transaction rollback and truthful recovery')
    def retries(self):
        for stop in ['budget','deadline','unusable']:
            self.case_db('retry')
            job,ch,enqueue,claim=self.sendable()
            for count in [1,2,3]:
                if stop=='deadline' and count==1: self.reduce_window(job,ch,12)
                if stop=='unusable' and count==1:
                    self.sql(f"update public.every8d_settings_auth_challenges set superseded_at=stamp.t,supersession_reason='resend',normalized_email=null,email_scrubbed_at=stamp.t from (select clock_timestamp() t) stamp where id={quote(ch)}",role=OWNER)
                final=self.finalize(job,claim,count,'not_accepted_retryable',None,evidence=True)
                receipt=self.sql(final,role='service_role'); row=self.row(job)
                if not receipt: raise Failure('retry result admission')
                if self.sql(final,role='service_role')!=receipt: raise Failure('retry duplicate schedule changed')
                if row['state']=='FAILED_TERMINAL': break
                delay=5 if count==1 else 20
                self.check(f"select available_at=resolved_at+interval '{delay} seconds' and nonce is not null and challenge_recording='not_applicable' and lease_id is null from {TABLE} where job_id={quote(job)}",'exact retry arithmetic and envelope')
                if self.claim(): raise Failure('early retry claimed')
                self.shift(job,delay+1)
                # After fixture shift compare with the shifted persisted receipt, not the old wall-clock string.
                claim=self.claim()
                if not claim or claim['attempt_count']!=count: raise Failure('retry claim attempts')
                if self.sql(final,role='service_role'): raise Failure('prior retry generation remained compatible')
                if not self.sql(self.begin(job,claim),role='service_role'): raise Failure('retry begin')
            expected={'budget':'retry_budget_exhausted','deadline':'retry_deadline_exhausted','unusable':'retry_unusable'}[stop]
            self.scrub(job,'FAILED_TERMINAL',expected)
            if self.row(job)['challenge_recording']!='not_applicable': raise Failure('fabricated exhaustion recorder')
            if self.claim() or self.sql(self.begin(job,claim),role='service_role'): raise Failure('terminal reopening')
            self.finish_case('retry delays, generation, exhaustion precedence '+stop)
    def loss_and_recovery(self):
        for attempted in [False,True]:
            self.case_db('loss')
            if attempted:
                job,ch,enqueue,claim=self.sendable()
                self.sql(self.finalize(job,claim,1,'not_accepted_retryable',None,evidence=True),role='service_role')
                self.shift(job,6)
            else: job,ch,enqueue=self.new()
            initial_attempts=1 if attempted else 0
            for _ in range(24):
                claim=self.claim()
                if not claim: raise Failure('crypto-loss claim stopped before recovery')
                self.shift(job,31); self.recover(); row=self.row(job)
                if row['state'] in TERMINAL: break
                if row['attempt_count']!=initial_attempts or row['state']!=('RETRY_WAIT' if attempted else 'PENDING'): raise Failure('safe expired lease recovery')
            else: raise Failure('crypto-loss closure unbounded')
            self.scrub(job,'FAILED_TERMINAL' if attempted else 'EXPIRED')
            if row['challenge_recording']!='not_applicable': raise Failure('crypto failure fabricated recorder')
            self.finish_case('repeated no-begin crypto-loss recovery eventually closes '+str(initial_attempts))
        for action in ['begin_unusable','recover_unusable','begin_expired','recover_expired','sending_expired']:
            self.case_db('closure')
            if action=='sending_expired': job,ch,enqueue,claim=self.sendable()
            else: job,ch,enqueue=self.new(); claim=self.claim()
            if 'unusable' in action:
                self.sql(f"update public.every8d_settings_auth_challenges set superseded_at=stamp.t,supersession_reason='resend',normalized_email=null,email_scrubbed_at=stamp.t from (select clock_timestamp() t) stamp where id={quote(ch)}",role=OWNER)
                if action.startswith('recover'): self.shift(job,31)
            elif action=='begin_expired':
                self.reduce_window(job,ch,9)
            else: self.shift(job,601 if action=='recover_expired' else 31)
            if action.startswith('begin'): self.sql(self.begin(job,claim),role='service_role')
            else: self.recover()
            self.scrub(job,'DELIVERY_OUTCOME_UNKNOWN' if action=='sending_expired' else 'CANCELLED' if 'unusable' in action else 'EXPIRED')
            if self.recover(): raise Failure('recovery selected terminal')
            self.finish_case('terminal closure '+action)
    def purge(self):
        for outcome in ['accepted','rejected','outcome_unknown',None,'expired','cancelled']:
            self.case_db('purge')
            if outcome in ['expired','cancelled']:
                job,ch,enqueue=self.new()
                if outcome=='expired': self.shift(job,601)
                else: self.sql(f"update public.every8d_settings_auth_challenges set superseded_at=stamp.t,supersession_reason='resend',normalized_email=null,email_scrubbed_at=stamp.t from (select clock_timestamp() t) stamp where id={quote(ch)}",role=OWNER)
                self.recover()
            elif outcome is None:
                job,ch,enqueue=self.new(); claim=self.claim()
                self.sql(self.finalize(job,claim,0,None,None,'sender_unavailable'),role='service_role')
            else:
                job,ch,enqueue,claim=self.sendable()
                self.sql(self.finalize(job,claim,1,outcome,'synthetic-id' if outcome=='accepted' else None),role='service_role')
            self.scrub(job)
            if self.sql('select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(100)',role='service_role')!='0': raise Failure('premature purge')
            self.sql(f"begin; set local wincrm.c3c3_outbox_operation='purge'; set local wincrm.c3c3_outbox_purge='on'; select set_config('wincrm.c3c3_outbox_decision_at',clock_timestamp()::text,true); delete from {TABLE} where job_id={quote(job)}; commit",role=OWNER,error='23514')
            self.shift(job,86401)
            if self.sql('select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(100)',role='service_role')!='1': raise Failure('eligible terminal purge')
            if self.sql(enqueue,role='service_role'): raise Failure('post-purge resurrection')
            if self.sql(enqueue.replace(job,str(uuid.uuid4())),role='service_role'): raise Failure('post-purge new job')
            self.finish_case('terminal scrub/retention/purge/no-resurrection '+str(outcome))
    def negatives(self):
        self.case_db('negative')
        job,ch,enqueue=self.new()
        before=self.row(job)
        for role in ['anon','authenticated']:
            self.sql('select * from public.runtime_claim_every8d_settings_auth_email_v1(1)',role=role,error='42501')
        for role in ['anon','authenticated','service_role']:
            for statement in [f'select * from {TABLE}',f'select nonce from {TABLE}',f'select nextval({quote(SEQ)})',f'select * from {SEQ}',
                    'select * from public.every8d_settings_auth_email_outbox_installation_guard',
                    'select * from public.claim_every8d_settings_auth_email_core_v1(1)']:
                self.sql(statement,role=role,error='42501')
        for statement in ['truncate '+TABLE,'truncate public.every8d_settings_auth_email_outbox_installation_guard',
                'delete from public.every8d_settings_auth_email_outbox_installation_guard',
                "update public.every8d_settings_auth_email_outbox_installation_guard set guard_id=true",
                f'update {TABLE} set state=state where job_id={quote(job)}',f'delete from {TABLE} where job_id={quote(job)}']:
            self.sql(statement,role=OWNER,error='23514')
        for field,value in [('job_id',quote(str(uuid.uuid4()))),('challenge_id',quote(str(uuid.uuid4()))),
                ('request_token_hash',"decode(repeat('03',32),'hex')"),('attempt_count','2'),('state',"'SENDING'"),
                ('ciphertext',"decode('ffff','hex')"),('delivery_deadline_at',"delivery_deadline_at+interval '1 second'")]:
            self.sql(f"begin; set local wincrm.c3c3_outbox_operation='claim'; update {TABLE} set {field}={value} where job_id={quote(job)}; commit",role=OWNER,error='23514')
        for operation,bounds in [('claim',[0,11,None]),('recover',[0,101,None]),('purge',[0,101,None])]:
            for bound in bounds: self.sql(f'select * from public.runtime_{operation}_every8d_settings_auth_email_v1('+('null' if bound is None else str(bound))+')',role='service_role',error='22023')
        claim=self.claim()
        for outcome in ['accepted','rejected','outcome_unknown','not_accepted_retryable',None,'sender_unavailable','fifth']:
            for pre in [None,'sender_unavailable','bad']:
                for evidence in [None,False,True]:
                    for provider_id in [None,'synthetic-id']:
                        valid=(outcome=='accepted' and pre is None and evidence is False and provider_id is not None
                            or outcome in ['rejected','outcome_unknown'] and pre is None and evidence is False and provider_id is None
                            or outcome=='not_accepted_retryable' and pre is None and evidence is True and provider_id is None
                            or outcome is None and pre=='sender_unavailable' and evidence is False and provider_id is None)
                        if valid: continue
                        self.sql(self.finalize(job,claim,1,outcome,provider_id,pre,evidence),role='service_role',error='22023')
        for provider_id in ['', 'x y','x\t','é','x'*256]:
            self.sql(self.finalize(job,claim,1,provider_id=provider_id),role='service_role',error='22023')
        for level in ['repeatable read','serializable']:
            for query in [enqueue,'select * from public.runtime_claim_every8d_settings_auth_email_v1(1)',
                    self.begin(job,claim),self.finalize(job,claim,1),
                    'select * from public.runtime_recover_every8d_settings_auth_email_v1(1)',
                    'select * from public.runtime_purge_every8d_settings_auth_email_v1(1)']:
                self.sql('begin isolation level '+level+';'+query+';commit',role='service_role',error='25000')
        self.finish_case('ACL/RLS, direct-owner DML, isolation, batch bounds, full finalize NULL/boolean matrix')

    def purge_cleanup_snapshot(self,job,ch):
        # Protected row contents are compared inside the proof, never printed.
        return (f"select md5(jsonb_build_array("
            f"(select to_jsonb(o) from {TABLE} o where o.job_id={quote(job)}),"
            f"(select to_jsonb(c) from public.every8d_settings_auth_challenges c where c.id={quote(ch)}),"
            f"(select jsonb_agg(to_jsonb(f) order by f.id) from public.every8d_settings_auth_challenge_failures f "
            f"where f.challenge_id={quote(ch)}))::text)")

    def purge_cleanup_evidence(self,holder,skipper,relation,mode,label):
        # The NOWAIT probes at the call site prove the particular row is held.
        # This catalog observation independently identifies both real sessions
        # and the granted relation modes, without logging protected identifiers.
        query=f"""select jsonb_build_object(
          'distinct_sessions',(select count(distinct pid)=2 from pg_stat_activity
            where application_name in ({quote(holder.app)},{quote(skipper.app)})),
          'holder_open',(select count(*)=1 from pg_stat_activity
            where application_name={quote(holder.app)} and state='idle in transaction'),
          'skipper_completed_before_release',(select count(*)=1 from pg_stat_activity
            where application_name={quote(skipper.app)} and state='idle in transaction'
              and cardinality(pg_blocking_pids(pid))=0 and wait_event_type='Client'),
          'holder_relation_lock',exists(select 1 from pg_locks l join pg_stat_activity a using(pid)
            where a.application_name={quote(holder.app)} and l.relation={quote(relation)}::regclass
              and l.mode={quote(mode)} and l.granted),
          'skipper_challenge_selection_lock',exists(select 1 from pg_locks l join pg_stat_activity a using(pid)
            where a.application_name={quote(skipper.app)}
              and l.relation='public.every8d_settings_auth_challenges'::regclass
              and l.mode='RowShareLock' and l.granted))"""
        evidence=json.loads(self.sql(query))
        if not all(value is True for value in evidence.values()):
            raise Failure(label+': independent-session lock evidence missing')
        print('PURGE_CLEANUP_LOCK_EVIDENCE '+label+' '+json.dumps(evidence,sort_keys=True),flush=True)

    def purge_cleanup_case(self,kind):
        self.case_db('purge_cleanup'); self.concurrent+=1
        job,ch,enq,claim=self.sendable()
        self.sql(self.finalize(job,claim,1),role='service_role')
        # A nonempty failure ledger makes partial cleanup deletion observable.
        self.sql(f"insert into public.every8d_settings_auth_challenge_failures(challenge_id,attempt_number) "
            f"values({quote(ch)},1)",role=OWNER)
        self.shift(job,31*86400)
        snapshot_query=self.purge_cleanup_snapshot(job,ch)
        before=self.sql(snapshot_query)
        purge='select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(1)'
        cleanup='select deleted_count||\':\'||anomalous_count from public.cleanup_every8d_settings_auth_challenges_v1(100)'
        holder=self.actor('purge_cleanup_'+kind+'_holder',OWNER)
        skipper=self.actor('purge_cleanup_'+kind+'_skipper',OWNER)
        if kind=='purge_first':
            holder.start(purge); holder.ready('1')
            # Explicit bounded negative: the particular challenge and deleted
            # outbox tuple are still held by the uncommitted purge transaction.
            self.sql(f'select id from public.every8d_settings_auth_challenges where id={quote(ch)} for update nowait',
                error='55P03',label='purge holder challenge row NOWAIT refusal')
            self.sql(f'select job_id from {TABLE} where job_id={quote(job)} for update nowait',
                error='55P03',label='purge holder outbox row NOWAIT refusal')
            skipper.start(cleanup); skipper.ready('0:0')
            self.purge_cleanup_evidence(holder,skipper,TABLE,'RowExclusiveLock',kind)
        elif kind=='cleanup_first':
            # Retain the challenge row lock outside the expected FK-refusal
            # savepoint. Only SQLSTATE 23503 is accepted; other errors propagate.
            # The real cleanup's preceding ledger deletion must roll back.
            holder.start(f"select id from public.every8d_settings_auth_challenges where id={quote(ch)} for update; "
                "do $$ begin begin perform * from public.cleanup_every8d_settings_auth_challenges_v1(100); "
                "raise exception 'C3c-3 expected restrictive FK refusal'; "
                "exception when foreign_key_violation then null; end; end; $$")
            holder.ready()
            holder.send(snapshot_query+"; select 'C3C2A_READY';")
            holder.ready(before)
            self.sql(f'select id from public.every8d_settings_auth_challenges where id={quote(ch)} for update nowait',
                error='55P03',label='cleanup holder challenge row NOWAIT refusal')
            skipper.start(purge); skipper.ready('0')
            self.purge_cleanup_evidence(holder,skipper,'public.every8d_settings_auth_challenges','RowShareLock',kind)
        else:
            holder.start(f'select job_id from {TABLE} where job_id={quote(job)} for update'); holder.ready()
            self.sql(f'select job_id from {TABLE} where job_id={quote(job)} for update nowait',
                error='55P03',label='outbox holder row NOWAIT refusal')
            skipper.start(purge); skipper.ready('0')
            # Purge got the challenge before skipping the held outbox tuple.
            self.sql(f'select id from public.every8d_settings_auth_challenges where id={quote(ch)} for update nowait',
                error='55P03',label='purge selected challenge before outbox skip')
            self.purge_cleanup_evidence(holder,skipper,TABLE,'RowShareLock',kind)
        # This barrier is reached while the holder is still open. A waiting
        # implementation cannot pass it; the original timeouts are unchanged.
        skipper.send(snapshot_query+"; select 'C3C2A_READY';")
        skipper.ready(before)
        skipper.finish()
        if self.sql(snapshot_query)!=before:
            raise Failure('SKIP LOCKED invocation committed partial authority mutation')
        holder.finish()
        if kind!='purge_first':
            # The unchanged cleanup must refuse atomically while the child is retained.
            self.sql(cleanup,role=OWNER,error='23503',label='post-release restrictive cleanup FK refusal')
            if self.sql(snapshot_query)!=before:
                raise Failure('FK refusal partially deleted challenge/failure-ledger/outbox')
            if self.sql(purge,role='service_role')!='1':
                raise Failure('post-release eligible outbox purge')
        self.check(f"select not exists(select 1 from {TABLE} where job_id={quote(job)}) "
            f"and exists(select 1 from public.every8d_settings_auth_challenges where id={quote(ch)}) "
            f"and (select count(*)=1 from public.every8d_settings_auth_challenge_failures where challenge_id={quote(ch)})",
            'purge deletes only child; challenge and ledger retained')
        if self.sql(cleanup,role=OWNER)!='1:0':
            raise Failure('post-release normal cleanup count')
        self.check(f"select not exists(select 1 from {TABLE} where job_id={quote(job)}) "
            f"and not exists(select 1 from public.every8d_settings_auth_challenges where id={quote(ch)}) "
            f"and not exists(select 1 from public.every8d_settings_auth_challenge_failures where challenge_id={quote(ch)})",
            'final purge/cleanup authority absent with no partial deletion')
        self.finish_case('purge_cleanup '+kind+': bounded skip, exact counts, atomic FK refusal, final authority')

    def purge_cleanup(self):
        for kind in ['purge_first','cleanup_first','outbox_locked']:
            self.purge_cleanup_case(kind)

    def races(self):
        # Separate transactions, explicit barriers, both winner orders.
        for kind in ['duplicate_enqueue','duplicate_begin','duplicate_finalize','recover_finalize','supersede_enqueue','lifecycle_begin','purge_finalize']:
            for reverse in [False,True]:
                self.case_db('race'); self.concurrent+=1
                if kind=='duplicate_enqueue':
                    job,ch,enq=self.new(enqueue=False); first_sql=second_sql='select count(*) from ('+enq+') q'; expected=('1','1')
                elif kind=='supersede_enqueue':
                    job,ch,enq=self.new(enqueue=False)
                    first_sql='select count(*) from ('+enq+') q'
                    second_sql=f"update public.every8d_settings_auth_challenges set superseded_at=stamp.t,supersession_reason='resend',normalized_email=null,email_scrubbed_at=stamp.t from (select clock_timestamp() t) stamp where id={quote(ch)}"
                    expected=('1',None)
                elif kind=='duplicate_begin':
                    job,ch,enq=self.new(); claim=self.claim(); first_sql=second_sql='select count(*) from ('+self.begin(job,claim)+') q'; expected=('1','0')
                elif kind=='duplicate_finalize':
                    job,ch,enq,claim=self.sendable(); first_sql=second_sql='select count(*) from ('+self.finalize(job,claim,1)+') q'; expected=('1','1')
                elif kind=='recover_finalize':
                    job,ch,enq,claim=self.sendable(); self.shift(job,31)
                    first_sql='select count(*) from public.runtime_recover_every8d_settings_auth_email_v1(1)'
                    second_sql='select count(*) from ('+self.finalize(job,claim,1)+') q'; expected=('1','0')
                elif kind=='lifecycle_begin':
                    job,ch,enq=self.new(); claim=self.claim()
                    parent=self.sql(f'select g.installation_id from public.every8d_settings_enrollment_grants g join public.every8d_settings_auth_challenges c on c.enrollment_grant_id=g.id where c.id={quote(ch)}')
                    first_sql='select count(*) from ('+self.begin(job,claim)+') q'
                    second_sql=f"update public.ghl_marketplace_installations set status='disabled' where id={quote(parent)}"; expected=('1',None)
                else:
                    job,ch,enq,claim=self.sendable(); self.sql(self.finalize(job,claim,1),role='service_role'); self.shift(job,31*86400)
                    first_sql='select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(1)'
                    second_sql='select count(*) from ('+self.finalize(job,claim,1)+') q'
                    expected=('1','0')
                pair=[first_sql,second_sql]
                if reverse and kind not in ['duplicate_begin','duplicate_finalize','duplicate_enqueue']: pair.reverse()
                a=self.actor('race_'+str(self.concurrent)+'_a',OWNER); b=self.actor('race_'+str(self.concurrent)+'_b',OWNER)
                a.start(pair[0]); a.ready(None)
                b.start(pair[1])
                # SKIP LOCKED operations may complete immediately; blocking operations must expose real waits.
                skip=(kind in ['recover_finalize','purge_finalize'] and reverse)
                if not skip: self.blocked(b,a,'C3c-3 '+kind+' '+str(reverse))
                a.finish(); b.ready(None); b.finish()
                if kind in ['duplicate_begin','duplicate_finalize']:
                    row=self.row(job)
                    if row['attempt_count']!=1: raise Failure('concurrent operation double-counted attempt')
                if kind=='recover_finalize': self.scrub(job,'DELIVERY_OUTCOME_UNKNOWN')
                if kind=='lifecycle_begin':
                    row=self.row(job)
                    if reverse: self.scrub(job,'CANCELLED')
                    elif row['state']!='SENDING': raise Failure('begin/lifecycle winner order')
                self.finish_case('independent-session race '+kind+' reverse='+str(reverse))
        self.purge_cleanup()
        # Concurrent claims use SKIP LOCKED with a bounded unfilled prefix.
        self.case_db('claim_race'); self.concurrent+=1
        job,ch,enq=self.new()
        a=self.actor('claim_a','service_role'); b=self.actor('claim_b','service_role')
        a.start('select count(*) from public.runtime_claim_every8d_settings_auth_email_v1(1)'); a.ready('1')
        b.start('select count(*) from public.runtime_claim_every8d_settings_auth_email_v1(1)'); b.ready('0'); b.finish(); a.finish()
        if self.row(job)['attempt_count']!=0: raise Failure('claim incremented attempts')
        self.finish_case('concurrent claims and SKIP LOCKED bounded prefix')

    def maintenance(self):
        # Pure unused database: no fixture routines with C3c-3 body references.
        for label,change in [
            ('sequence_abort',f'begin; select nextval({quote(SEQ)}); rollback'),
            ('sequence_properties',f'alter sequence {SEQ} cache 2'),
            ('sequence_acl',f'grant usage on sequence {SEQ} to service_role'),
            ('epoch_mismatch',"alter table public.every8d_settings_auth_email_outbox_installation_guard disable trigger protect_every8d_settings_auth_email_outbox_guard; update public.every8d_settings_auth_email_outbox_installation_guard set migration_postmaster_started_at=migration_postmaster_started_at-interval '1 second'; alter table public.every8d_settings_auth_email_outbox_installation_guard enable trigger protect_every8d_settings_auth_email_outbox_guard"),
            ('new_fk_trigger_state',"do $$ declare n name; begin select tgname into strict n from pg_trigger where tgrelid='public.every8d_settings_auth_challenges'::regclass and tgconstraint=(select oid from pg_constraint where conname='e8d_settings_email_outbox_challenge_fk' and conrelid='public.every8d_settings_auth_email_outbox'::regclass) and tgtype=9; execute format('alter table public.every8d_settings_auth_challenges disable trigger %I',n); end $$"),
            ('old_fk_trigger_state',"do $$ declare n name; begin select tgname into strict n from pg_trigger where tgrelid='public.every8d_settings_sessions'::regclass and tgisinternal and tgtype=5; execute format('alter table public.every8d_settings_sessions disable trigger %I',n); end $$"),
            ('cross_schema_string',"create schema later; create function later.caller() returns integer language plpgsql as $$ begin execute 'select count(*) from public.RUNTIME_CLAIM_EVERY8D_SETTINGS_AUTH_EMAIL_V1(1)'; return 0; end $$"),
            ('cross_schema_procedure',"create schema later; create procedure later.caller() language plpgsql as $$ begin execute 'select count(*) from public.RUNTIME_CLAIM_EVERY8D_SETTINGS_AUTH_EMAIL_V1(1)'; end $$"),
            ('catalog_caller',"create schema later; create function later.caller() returns integer language sql begin atomic select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(1); end"),
        ]:
            self.scenarios+=1
            db=self.clone('maintenance_'+str(self.scenarios))
            self.sql(MIGRATION.read_bytes().decode(),db,OWNER)
            self.sql(change,db)
            before=self.boundary(db)
            self.sql(ROLLBACK.read_bytes().decode(),db,OWNER,error='55000',label=label)
            if self.boundary(db)!=before: raise Failure('non-atomic rollback refusal '+label)
            self.sql('drop database '+db,'postgres'); self.clones.remove(db)
            print('PASS rollback refusal '+label,flush=True)
        self.case_db('large_fence')
        self.sql(f'select setval({quote(SEQ)},9007199254740993,false)')
        job,ch,enq=self.new(); claim=self.claim()
        if claim['fence']!='9007199254740994': raise Failure('bigint precision')
        self.finish_case('decimal fence above 2^53')
        self.case_db('exhausted')
        self.sql(f'select setval({quote(SEQ)},9223372036854775807,true)')
        job,ch,enq=self.new(enqueue=False)
        self.sql(enq,role='service_role',error='2200H')
        self.check(f'select count(*)=0 from {TABLE}','sequence exhaustion must fail closed')
        self.finish_case('sequence exhausted fail-closed')


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--database',required=True); parser.add_argument('--prerequisite',required=True)
    parser.add_argument('--container',required=True)
    parser.add_argument('--purge-cleanup-only',action='store_true')
    args=parser.parse_args(); args.native_psql=None; args.native_port=0
    if not all(re.fullmatch(r'c3c3_[a-z0-9_]+',x) for x in [args.database,args.prerequisite]): parser.error('dedicated disposable DB names required')
    h=Proof(args)
    try:
        if args.purge_cleanup_only:
            h.purge_cleanup()
        else:
            h.basic(); h.outcomes(); h.retries(); h.loss_and_recovery(); h.purge(); h.negatives(); h.races(); h.maintenance()
        print(f'C3c-3 PG17 '+('focused purge_cleanup' if args.purge_cleanup_only else 'full')+f' PASS: scenarios={h.scenarios}; independent-session races={h.concurrent}; unexpected deadlocks/timeouts=0',flush=True)
    except Failure as exc:
        print('FAIL '+str(exc),flush=True)
        raise SystemExit(1)
    finally: h.cleanup()

if __name__=='__main__': main()
