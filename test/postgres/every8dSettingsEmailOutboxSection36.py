#!/usr/bin/env python3
"""Section-36 additions only; real PG17 sessions/restart, synthetic fixtures."""
import argparse
import json
import re
import subprocess
import time
from every8dSettingsEmailOutboxConcurrency import Proof, TABLE, SEQ, MIGRATION, ROLLBACK, POSTFLIGHT
from every8dSettingsSessionConsumptionConcurrency import Failure, OWNER, quote

CHALLENGES = 'public.every8d_settings_auth_challenges'
LEDGER = 'public.every8d_settings_auth_challenge_failures'
GUARD = 'public.every8d_settings_auth_email_outbox_installation_guard'
CLEANUP = "select deleted_count||':'||anomalous_count from public.cleanup_every8d_settings_auth_challenges_v1(100)"
RECOVER = 'select count(*) from public.runtime_recover_every8d_settings_auth_email_v1(100)'

class Coverage(Proof):
    def count_query(self, statement):
        return 'select count(*) from (' + statement + ') r'

    def authority_absent(self, job, challenge):
        self.check(f"select not exists(select 1 from {TABLE} where job_id={quote(job)}) "
                   f"and not exists(select 1 from {CHALLENGES} where id={quote(challenge)}) "
                   f"and not exists(select 1 from {LEDGER} where challenge_id={quote(challenge)}) "
                   f"and not exists(select 1 from {TABLE} o left join {CHALLENGES} c on c.id=o.challenge_id where c.id is null)",
                   'no orphan, duplicate, partial ledger or resurrection')

    def two_sessions(self, holder, other, relation, holder_mode, label):
        self.check(f"select (select count(distinct pid)=2 from pg_stat_activity where application_name in "
                   f"({quote(holder.app)},{quote(other.app)})) and exists(select 1 from pg_locks l "
                   f"join pg_stat_activity a using(pid) where a.application_name={quote(holder.app)} "
                   f"and l.relation={quote(relation)}::regclass and l.mode={quote(holder_mode)} and l.granted) "
                   f"and exists(select 1 from pg_stat_activity where application_name={quote(other.app)} "
                   "and state='idle in transaction' and cardinality(pg_blocking_pids(pid))=0)", label)
        print('LOCK_EVIDENCE '+label+': distinct physical sessions; holder lock; peer completed before release', flush=True)

    def enqueue_cleanup(self):
        for order in ('cleanup_first', 'enqueue_rejects_first', 'enqueue_child_first'):
            self.case_db('enqueue_cleanup'); self.concurrent += 1
            job, ch, enqueue = self.new(enqueue=False)
            if order != 'enqueue_child_first':
                self.sql(f'select public.runtime_record_every8d_settings_challenge_delivery_v1(request_token_hash,true,null) from {CHALLENGES} where id={quote(ch)}', role=OWNER)
                self.sql(f'insert into {LEDGER}(challenge_id,attempt_number) values({quote(ch)},1)', role=OWNER, label='valid LIVE ledger fixture')
                # Valid expired prerequisite: move its full existing timeline together.
                # No outbox exists. This is fixture setup, not a replacement cleanup.
                self.sql(f"begin; alter table {CHALLENGES} disable trigger protect_every8d_settings_auth_challenge; "
                         f"alter table {LEDGER} disable trigger protect_every8d_settings_auth_challenge_failure; "
                         f"update {LEDGER} set failed_at=failed_at-interval '31 days' where challenge_id={quote(ch)}; "
                         f"update {CHALLENGES} set created_at=created_at-interval '31 days',expires_at=expires_at-interval '31 days',delivery_succeeded_at=delivery_succeeded_at-interval '31 days' where id={quote(ch)}; "
                         f"set constraints all immediate; alter table {LEDGER} enable trigger protect_every8d_settings_auth_challenge_failure; "
                         f"alter table {CHALLENGES} enable trigger protect_every8d_settings_auth_challenge; commit", label="expired prerequisite time fixture")
                self.check(f"select expires_at<=clock_timestamp()-interval '30 days' and consumed_at is null "
                           f"and locked_at is null and superseded_at is null and delivery_failed_at is null "
                           f"from {CHALLENGES} where id={quote(ch)}", 'actual expiry cleanup eligibility')
            before = self.sql(self.purge_cleanup_snapshot(job, ch))
            first = self.actor('enqueue_cleanup_'+order+'_first', OWNER)
            second = self.actor('enqueue_cleanup_'+order+'_second', OWNER)
            if order == 'cleanup_first':
                first.start(CLEANUP); first.ready('1:0')
                self.sql(f'select id from {CHALLENGES} where id={quote(ch)} for update nowait', error='55P03', label='cleanup deletion holds challenge')
                second.start(self.count_query(enqueue))
                self.blocked(second, first, 'enqueue waits for real cleanup deletion')
                first.finish(); second.ready('0'); second.finish()
                self.authority_absent(job, ch)
                if self.sql(enqueue, role='service_role'):
                    raise Failure('deleted challenge resurrected through enqueue')
            else:
                first.start(self.count_query(enqueue)); first.ready('1' if order == 'enqueue_child_first' else '0')
                self.sql(f'select id from {CHALLENGES} where id={quote(ch)} for update nowait', error='55P03', label='enqueue authority challenge lock')
                second.start(CLEANUP); second.ready('0:0')
                self.two_sessions(first, second, CHALLENGES, 'RowShareLock', order)
                if order == 'enqueue_rejects_first':
                    second.send(self.purge_cleanup_snapshot(job, ch)+"; select 'C3C2A_READY';"); second.ready(before)
                second.finish(); first.finish()
                if order == 'enqueue_rejects_first':
                    if self.sql(self.purge_cleanup_snapshot(job, ch)) != before:
                        raise Failure('rejected enqueue or skipped cleanup mutated authority')
                    if self.sql(CLEANUP, role=OWNER) != '1:0':
                        raise Failure('eligible cleanup after enqueue lock release')
                    self.authority_absent(job, ch)
                else:
                    self.sql(f'select public.runtime_record_every8d_settings_challenge_delivery_v1(request_token_hash,true,null) from {CHALLENGES} where id={quote(ch)}', role=OWNER)
                    self.sql(f'insert into {LEDGER}(challenge_id,attempt_number) values({quote(ch)},1)', role=OWNER, label='valid retained-child LIVE ledger fixture')
                    self.check(f"select (select count(*)=1 from {TABLE} where job_id={quote(job)} and challenge_id={quote(ch)}) "
                               f"and (select count(*)=1 from {CHALLENGES} where id={quote(ch)}) "
                               f"and (select count(*)=1 from {LEDGER} where challenge_id={quote(ch)})", 'one retained child; challenge and ledger intact')
                    self.shift(job, 31*86400)
                    retained = self.sql(self.purge_cleanup_snapshot(job, ch))
                    self.sql(CLEANUP, role=OWNER, error='23503', label='retained enqueue child restrictive FK')
                    if self.sql(self.purge_cleanup_snapshot(job, ch)) != retained:
                        raise Failure('cleanup FK refusal lost preceding ledger deletion atomicity')
                    self.recover(); self.scrub(job, 'EXPIRED', 'expired_pre_send')
                    self.shift(job, 86401)
                    if self.sql('select purged_count from public.runtime_purge_every8d_settings_auth_email_v1(1)', role='service_role') != '1':
                        raise Failure('normal child purge before challenge cleanup')
                    if self.sql(CLEANUP, role=OWNER) != '1:0':
                        raise Failure('normal ledger/challenge cleanup after retained child purge')
                    self.authority_absent(job, ch)
            print('FINAL_AUTHORITY '+order+': challenge=0; ledger=0; outbox=0; orphans=0', flush=True)
            self.finish_case('enqueue vs cleanup '+order)

    def wait_expiry(self, job, seconds=35):
        self.until(lambda: self.sql(f'select clock_timestamp()>=lease_expires_at from {TABLE} where job_id={quote(job)}') == 't',
                   'real DB clock reaches persisted lease expiry', seconds=seconds)

    def begin_recovery(self):
        self.case_db('begin_wins'); self.concurrent += 1
        job, ch, enqueue = self.new(); claim = self.claim()
        before = self.row(job)
        begin = self.actor('begin_wins_begin', OWNER); recover = self.actor('begin_wins_recovery', OWNER)
        begin.start(self.count_query(self.begin(job, claim))); begin.ready('1')
        self.sql(f'select job_id from {TABLE} where job_id={quote(job)} for update nowait', error='55P03', label='begin active authority lock')
        begin.send(f"select state='SENDING' and attempt_count=1 and lease_id={quote(claim['lease_id'])} "
                   f"and fence_generation={quote(claim['fence'])}::bigint from {TABLE} where job_id={quote(job)}; select 'C3C2A_READY';")
        begin.ready('t')
        recover.start(RECOVER); recover.ready('0')
        self.two_sessions(begin, recover, TABLE, 'RowExclusiveLock', 'begin wins before recoverability')
        recover.finish(); begin.finish()
        row = self.row(job)
        if row['state'] != 'SENDING' or row['attempt_count'] != 1 or row['lease_id'] != claim['lease_id'] or str(row['fence_generation']) != claim['fence']:
            raise Failure('begin winner lost exactly one active attempt authority')
        if row['lease_expires_at'] != before['lease_expires_at'] or self.recover() or self.row(job) != row:
            raise Failure('unexpired SENDING mutated by recovery')
        self.wait_expiry(job)
        result = self.recover()
        if len(result) != 1 or result[0]['previous_state'] != 'SENDING' or result[0]['attempt_count'] != 1:
            raise Failure('expired sending recovery source/count')
        self.scrub(job, 'DELIVERY_OUTCOME_UNKNOWN', 'delivery_outcome_unknown')
        if self.row(job)['attempt_count'] != 1 or self.claim() or self.sql(self.begin(job, claim), role='service_role'):
            raise Failure('sending recovery fabricated resend authority')
        self.finish_case('begin wins; real lease expiry yields only unknown; no resend')

        for prior_attempts in (0, 1):
            self.case_db('recovery_wins'); self.concurrent += 1
            if prior_attempts:
                job, ch, enqueue, prior = self.sendable()
                self.sql(self.finalize(job, prior, 1, 'not_accepted_retryable', None, evidence=True), role='service_role')
                self.shift(job, 6); claim = self.claim()
            else:
                job, ch, enqueue = self.new(); claim = self.claim()
            self.shift(job, 28)
            before = self.row(job)
            self.wait_expiry(job, seconds=8)
            recover = self.actor('recovery_wins_'+str(prior_attempts), OWNER)
            begin = self.actor('stale_begin_'+str(prior_attempts), OWNER)
            recover.start(RECOVER); recover.ready('1')
            self.sql(f'select job_id from {TABLE} where job_id={quote(job)} for update nowait', error='55P03', label='recovery owns expired generation')
            expected = 'RETRY_WAIT' if prior_attempts else 'PENDING'
            recover.send(f"select state={quote(expected)} and attempt_count={prior_attempts} and lease_id is null "
                         f"and leased_at is null and lease_expires_at is null from {TABLE} where job_id={quote(job)}; select 'C3C2A_READY';")
            recover.ready('t')
            begin.start(self.count_query(self.begin(job, claim)))
            self.blocked(begin, recover, 'stale begin waits for expired lease recovery')
            recover.finish(); begin.ready('0'); begin.finish()
            row = self.row(job)
            if row['state'] != expected or row['attempt_count'] != prior_attempts or any(row[f] is not None for f in ('lease_id','leased_at','lease_expires_at')):
                raise Failure('expired leased recovery authority/count')
            for field in ('fence_generation','nonce','ciphertext','authentication_tag','last_attempt_started_at','last_provider_deadline_at'):
                if row[field] != before[field]:
                    raise Failure('expired lease recovery invented provider attempt or changed retained envelope')
            if self.sql(self.begin(job, claim), role='service_role'):
                raise Failure('stale lease/fence returned send authorization')
            self.finish_case('recovery wins expired LEASED count='+str(prior_attempts)+'; stale begin zero')

        self.case_db('expiry_crossing'); self.concurrent += 1
        job, ch, enqueue = self.new(); claim = self.claim(); self.shift(job, 24)
        before = self.row(job)
        holder = self.actor('expiry_challenge_holder', OWNER); begin = self.actor('begin_crosses_expiry', OWNER)
        holder.start(f'select id from {CHALLENGES} where id={quote(ch)} for update'); holder.ready()
        begin.start(self.count_query(self.begin(job, claim)))
        self.blocked(begin, holder, 'begin started unexpired and waits on challenge')
        self.check(f"select a.xact_start<o.lease_expires_at and clock_timestamp()<o.lease_expires_at "
                   f"from pg_stat_activity a cross join {TABLE} o where a.application_name={quote(begin.app)} "
                   f"and o.job_id={quote(job)}", 'begin transaction and observed wait precede expiry')
        self.wait_expiry(job, seconds=10)
        recover = self.actor('recovery_skips_held_expired', OWNER)
        recover.start(RECOVER); recover.ready('0')
        self.two_sessions(holder, recover, CHALLENGES, 'RowShareLock', 'expired recovery skips held challenge')
        self.blocked(begin, holder, 'begin still waits after DB lease expiry')
        recover.finish(); holder.finish(); begin.ready('0'); begin.finish()
        if self.row(job) != before:
            raise Failure('post-wait expired begin mutated or authorized stale attempt')
        result = self.recover()
        if len(result) != 1 or result[0]['previous_state'] != 'LEASED' or result[0]['state'] != 'PENDING' or result[0]['attempt_count'] != 0:
            raise Failure('post-wait expired lease safe recovery')
        if self.sql(self.begin(job, claim), role='service_role'):
            raise Failure('expiry crossing left stale send authority')
        self.finish_case('begin lock wait crosses actual expiry; fresh clock rejects; recovery safe')

    def unused(self, db, same_epoch):
        self.check(f"select (select count(*)=0 from {TABLE}) and (select last_value=1 and not is_called from {SEQ}) "
                   f"and (select count(*)=1 from {GUARD}) and (select guard_id and "
                   f"(migration_postmaster_started_at=pg_postmaster_start_time())={'true' if same_epoch else 'false'} from {GUARD})",
                   'empty unused singleton with required actual epoch relation', db)

    def restart(self):
        self.scenarios += 1
        control = self.clone('same_epoch_control', self.args.prerequisite)
        before = self.boundary(control), self.maintenance_state(control)
        self.sql(MIGRATION.read_bytes().decode('utf-8'), control, OWNER)
        self.sql(POSTFLIGHT.read_bytes().decode('utf-8'), control, OWNER)
        self.unused(control, True)
        self.sql(ROLLBACK.read_bytes().decode('utf-8'), control, OWNER)
        if (self.boundary(control), self.maintenance_state(control)) != before:
            raise Failure('same-epoch rollback failed exact prerequisite restoration')
        self.sql('drop database '+control, 'postgres'); self.clones.remove(control)
        print('PASS separate fresh same-epoch pre-use rollback control', flush=True)

        self.scenarios += 1
        db = self.clone('real_restart', self.args.prerequisite)
        self.sql(MIGRATION.read_bytes().decode('utf-8'), db, OWNER)
        self.sql(POSTFLIGHT.read_bytes().decode('utf-8'), db, OWNER)
        self.unused(db, True)
        old_epoch = self.sql(f'select migration_postmaster_started_at::text from {GUARD}', db)
        data = f"select md5(jsonb_build_array((select to_jsonb(g) from {GUARD} g),(select jsonb_build_array(last_value,log_cnt,is_called) from {SEQ}))::text)"
        before = self.boundary(db), self.maintenance_state(db), self.sql(data, db)
        self.check("select count(*)=0 from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid()", 'no live proof actor before restart', 'postgres')
        identity = self.sql('select system_identifier::text from pg_control_system()', db)
        try:
            restarted = subprocess.run(['docker','restart','--time','10',self.args.container], capture_output=True, text=True, timeout=30)
        except subprocess.TimeoutExpired as exc:
            raise Failure('real container restart timed out') from exc
        if restarted.returncode:
            raise Failure('real container restart failed')
        deadline = time.monotonic()+30
        while time.monotonic()<deadline:
            ready = subprocess.run(['docker','exec',self.args.container,'pg_isready','-U','postgres','-d',db], capture_output=True, timeout=5)
            if ready.returncode == 0:
                break
            time.sleep(.1)
        else:
            raise Failure('restarted postmaster failed bounded health check')
        self.unused(db, False)
        if self.sql('select system_identifier::text from pg_control_system()', db) != identity:
            raise Failure('restart did not preserve same data directory')
        if self.sql(f'select migration_postmaster_started_at::text from {GUARD}', db) != old_epoch:
            raise Failure('restart proof altered stored guard metadata')
        new_epoch = self.sql('select pg_postmaster_start_time()::text', db)
        self.sql(ROLLBACK.read_bytes().decode('utf-8'), db, OWNER, error='55000', error_message='C3c-3 server epoch guard mismatch', label='actual post-restart pre-use rollback refusal')
        self.unused(db, False)
        if (self.boundary(db), self.maintenance_state(db), self.sql(data, db)) != before:
            raise Failure('restart rollback refusal partially changed catalog/ACL/prerequisites/guard/sequence')
        print('RESTART_EVIDENCE '+json.dumps({'pg_version':self.sql('show server_version',db),'stored_epoch':old_epoch,'actual_postmaster_epoch':new_epoch,'epochs_differ':old_epoch!=new_epoch,'same_data_directory':True,'exact_refusal':'55000 server epoch guard mismatch','partial_changes':False}),flush=True)
        self.sql('drop database '+db, 'postgres'); self.clones.remove(db)
        print('PASS actual postmaster restart; unused pre-use rollback refused atomically',flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--database',required=True); parser.add_argument('--prerequisite',required=True)
    parser.add_argument('--container',required=True); parser.add_argument('--prior-scenarios',type=int,default=0); parser.add_argument('--prior-races',type=int,default=0)
    args=parser.parse_args(); args.native_psql=None; args.native_port=0
    if not all(re.fullmatch(r'c3c3_[a-z0-9_]+',x) for x in (args.database,args.prerequisite)):
        parser.error('dedicated disposable database names required')
    h=Coverage(args)
    try:
        h.enqueue_cleanup(); h.begin_recovery(); h.restart()
        print(f'C3c-3 section36 additions PASS: scenarios={h.scenarios}; independent-session races={h.concurrent}; unexpected deadlocks/timeouts=0',flush=True)
        if args.prior_scenarios:
            print(f'C3c-3 complete combined PG17 PASS: scenarios={args.prior_scenarios+h.scenarios}; independent-session races={args.prior_races+h.concurrent}; unexpected deadlocks/timeouts=0',flush=True)
    except Failure as exc:
        raise SystemExit('FAIL '+str(exc))
    finally:
        h.cleanup()

if __name__=='__main__':
    main()
