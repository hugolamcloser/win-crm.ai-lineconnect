#!/usr/bin/env python3
"""Disposable PG17 proof barriers using independent psql sessions; stdlib only."""
from pathlib import Path
import argparse
import json
import os
import queue
import re
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/202610220001_every8d_settings_session_consumption.sql'
ROLLBACK = ROOT / 'supabase/rollback/202610220001_every8d_settings_session_consumption.sql'
PROOF = ROOT / 'test/postgres/every8dSettingsSessionConsumption.sql'
OWNER = 'c3a_migration_owner'
TARGETS = [
    'runtime_discover_every8d_settings_verified_challenge_v1',
    'runtime_consume_every8d_settings_enrollment_challenge_v1',
    'runtime_consume_every8d_settings_login_challenge_v1',
    'runtime_authenticate_every8d_settings_session_v1',
    'runtime_revoke_every8d_settings_session_v1',
    'consume_every8d_settings_enrollment_challenge_core_v1',
    'consume_every8d_settings_login_challenge_core_v1',
    'authenticate_every8d_settings_session_core_v1',
    'revoke_every8d_settings_session_core_v1',
]


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def hashed(tag):
    return 'c3c2a_proof.hash(' + quote(tag) + ')'


def aliases(number):
    return f'array[c3c2a_proof.alias({number})]'


class Failure(RuntimeError):
    pass


class Harness:
    def __init__(self, args):
        self.args = args
        self.db = args.database
        self.prefix = 'c3c2a_' + str(os.getpid())
        self.number = 10000
        self.actors = []
        self.clones = []
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}

    def command(self, db, role=None, app=None):
        options = '-c statement_timeout=55s -c lock_timeout=35s'
        if role:
            options += ' -c role=' + role
        env = dict(self.env)
        if self.args.native_psql:
            # Local proof never consumes ambient hosts, pooler URLs or credentials.
            env['PGOPTIONS'] = options
            if app:
                env['PGAPPNAME'] = app
            cmd = [self.args.native_psql, '-h', '127.0.0.1', '-p', str(self.args.native_port)]
        else:
            cmd = ['docker', 'exec', '-i', '-e', 'PGOPTIONS=' + options]
            if app:
                cmd += ['-e', 'PGAPPNAME=' + app]
            cmd += [self.args.container, 'psql']
        return cmd + ['-X', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1',
                      '-v', 'VERBOSITY=sqlstate', '-Atq'], env

    def sql(self, statement, db=None, role=None, error=None, label='SQL', error_message=None):
        cmd, env = self.command(db or self.db, role)
        if error_message is not None:
            statement = '\\set VERBOSITY verbose\n' + statement
        try:
            result = subprocess.run(cmd, input=statement, text=True, encoding='utf-8',
                                    capture_output=True, env=env, timeout=60)
        except subprocess.TimeoutExpired as exc:
            raise Failure(label + ': process timeout') from exc
        state = re.search(r'ERROR:\s+([0-9A-Z]{5})\b', result.stderr)
        if error:
            if result.returncode == 0 or not state or state[1] != error:
                raise Failure(label + ': expected failure contract not observed')
            if error_message is not None:
                message = re.search(r'ERROR:\s+' + re.escape(error) + r': ([^\r\n]+)', result.stderr)
                if not message or message[1] != error_message:
                    raise Failure(label + ': expected refusal message not observed')
        elif result.returncode or result.stderr.strip():
            raise Failure(label + ': unexpected database failure ' + (state[1] if state else 'unknown'))
        return result.stdout.strip()

    def check(self, query, label, db=None):
        if self.sql(query, db) != 't':
            raise Failure(label)

    def case(self, label):
        self.number += 1
        return self.number, label + '_' + str(self.number)

    def parent(self, number):
        return self.sql(f'select c3c2a_proof.parent({number})')

    def grant(self, parent, email, tag):
        return self.sql('select c3c2a_proof.grant_for(' + ','.join(map(quote, [parent, email, tag])) + ')')

    def verified(self, purpose, email, number, tag, grant=None):
        args = [quote(purpose), quote(email), f'c3c2a_proof.alias({number})', quote(tag)]
        if grant:
            args.append(quote(grant))
        return self.sql('select c3c2a_proof.verified(' + ','.join(args) + ')')

    def enroll(self, parent, email, number, tag):
        return self.sql(f'select c3c2a_proof.enroll({quote(parent)},{quote(email)},{number},{quote(tag)})')

    def consume(self, purpose, number, request, session=None):
        return (f'select count(*) from public.runtime_consume_every8d_settings_{purpose}_challenge_v1('
                f'{hashed("request-" + request)},{aliases(number)},{hashed("session-" + (session or request))})')

    def auth(self, session):
        return 'select count(*) from public.runtime_authenticate_every8d_settings_session_v1(' + hashed('session-' + session) + ')'

    def revoke(self, session):
        return 'select public.runtime_revoke_every8d_settings_session_v1(' + hashed('session-' + session) + ')'

    def actor(self, label, role='service_role'):
        actor = Actor(self, label, role)
        self.actors.append(actor)
        return actor

    def until(self, predicate, label, seconds=12):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if predicate():
                return
            if any(a.process.poll() not in (None, 0) for a in self.actors):
                raise Failure(label + ': actor exited unexpectedly')
            time.sleep(0.04)
        raise Failure(label + ': barrier timeout')

    def blocked(self, waiter, blocker, label):
        self.until(lambda: self.sql(f"select exists(select 1 from pg_stat_activity a "
            f"join pg_stat_activity b on b.application_name={quote(blocker.app)} "
            f"where a.application_name={quote(waiter.app)} and b.pid=any(pg_blocking_pids(a.pid)))") == 't', label)
        evidence = self.sql(f"""select jsonb_build_object(
          'actors',(select jsonb_agg(jsonb_build_object('pid',a.pid,'actor',a.application_name,
            'state',a.state,'wait_event_type',a.wait_event_type,'wait_event',a.wait_event,
            'blocking_pids',pg_blocking_pids(a.pid)) order by a.application_name)
            from pg_stat_activity a where a.application_name like '{self.prefix}%'),
          'locks',(select jsonb_agg(jsonb_build_object('pid',l.pid,'locktype',l.locktype,
            'mode',l.mode,'granted',l.granted,'relation',l.relation::regclass::text,
            'classid',l.classid,'objid',l.objid) order by l.pid,l.locktype,l.mode)
            from pg_locks l join pg_stat_activity a using(pid)
            where a.application_name like '{self.prefix}%'
              and l.locktype in ('advisory','tuple','transactionid')))""")
        print('BARRIER ' + label + ' ' + evidence, flush=True)

    def snapshot(self, db=None):
        tables = ['every8d_settings_enrollment_grants', 'every8d_settings_administrators',
                  'every8d_settings_sessions', 'every8d_settings_auth_challenges',
                  'every8d_settings_auth_challenge_failures']
        return self.sql('select md5(jsonb_build_array(' + ','.join(
            f"(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from public.{t} t)" for t in tables) + ')::text)', db)

    def clone(self, suffix, template=None):
        name = self.prefix + '_' + suffix
        self.sql(f'create database {name} owner {OWNER} template {template or self.args.prerequisite}', 'postgres')
        self.clones.append(name)
        return name

    def install(self, db):
        self.sql(MIGRATION.read_text(encoding='utf-8'), db, OWNER, label='migration apply')

    def boundary(self, db):
        # Independent whole-public-schema/ACL/default-ACL projection. Only the
        # nine explicitly authorized function names are excluded.
        return self.sql("""select md5(jsonb_build_array(
          (select jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relowner,c.relacl,
            c.relrowsecurity,c.relforcerowsecurity) order by c.oid)
            from pg_class c where c.relnamespace='public'::regnamespace),
          (select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a
            join pg_class c on c.oid=a.attrelid where c.relnamespace='public'::regnamespace),
          (select jsonb_agg(to_jsonb(d) order by d.oid) from pg_attrdef d join pg_class c
            on c.oid=d.adrelid where c.relnamespace='public'::regnamespace),
          (select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t join pg_class c
            on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace),
          (select jsonb_agg(to_jsonb(k) order by k.oid) from pg_constraint k
            where k.connamespace='public'::regnamespace),
          (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
          (select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d),
          (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
            where p.pronamespace='public'::regnamespace and p.proname not in ("""
            + ','.join(map(quote, TARGETS)) + ')))::text)', db)

    def target_count(self, count, db):
        self.check("select count(*)=" + str(count) + " from pg_proc where pronamespace='public'::regnamespace and proname in ("
                   + ','.join(map(quote, TARGETS)) + ')', 'exact target count ' + str(count), db)

    def prerequisite_owners(self):
        signature = 'public.apply_every8d_ghl_marketplace_lifecycle_v2(text,text,text,uuid,text,text,text,text,timestamptz,text)'
        parent_state = """select md5(jsonb_build_array(
          (select jsonb_agg(to_jsonb(t) order by t.id) from public.ghl_marketplace_installations t),
          (select jsonb_agg(to_jsonb(t) order by t.app_namespace) from public.ghl_marketplace_app_registrations t),
          (select jsonb_agg(to_jsonb(t) order by t.app_namespace,t.marketplace_version_id)
            from public.ghl_marketplace_app_version_registrations t))::text)"""
        normal = self.clone('owner_trusted')
        self.check(f"select proowner=(select relowner from pg_class where oid='public.ghl_marketplace_installations'::regclass) "
                   f"from pg_proc where oid={quote(signature)}::regprocedure", 'normal lifecycle common owner', normal)
        before, boundary, parents = self.snapshot(normal), self.boundary(normal), self.sql(parent_state, normal)
        self.install(normal)
        self.target_count(9, normal)
        if (self.snapshot(normal), self.boundary(normal), self.sql(parent_state, normal)) != (before, boundary, parents):
            raise Failure('trusted-owner apply changed prerequisite authority')
        print('PASS lifecycle trusted common owner: migration proceeds; prerequisites unchanged', flush=True)
        for role in ('anon', 'authenticated', 'service_role', 'postgres'):
            db = self.clone('owner_' + role)
            # Disposable negative fixture only; the migration never repairs ownership.
            self.sql(f'alter function {signature} owner to {role}', db)
            before, boundary, parents = self.snapshot(db), self.boundary(db), self.sql(parent_state, db)
            self.sql(MIGRATION.read_text(encoding='utf-8'), db, OWNER, error='42501', label='lifecycle owner ' + role)
            self.target_count(0, db)
            if (self.snapshot(db), self.boundary(db), self.sql(parent_state, db)) != (before, boundary, parents):
                raise Failure('owner refusal changed prerequisite authority: ' + role)
            print('PASS lifecycle owner ' + role + ': rejected; zero targets; prerequisites unchanged', flush=True)

    def creator_login(self):
        for different in (False, True):
            number, tag = self.case('creator_first_diff' if different else 'creator_first_same')
            parent = self.parent(number)
            email = tag + '@example.invalid'
            if different:
                self.enroll(parent, email, number, tag + '_existing')
            creator_parent = self.parent(number + 100000) if different else parent
            grant = self.grant(creator_parent, email, tag + '_creator')
            self.verified('enrollment', email, number, tag + '_creator', grant)
            self.verified('login', email, number, tag + '_login')
            creator = self.actor(tag + '_creator')
            creator.start(self.consume('enrollment', number, tag + '_creator'))
            creator.ready('1')
            login = self.actor(tag + '_login')
            login.start(self.consume('login', number, tag + '_login'))
            self.blocked(login, creator, tag + ': login waits on creator alias')
            creator.finish()
            login.ready('0' if different else '1')
            login.finish()
            self.check('select ' + ('not ' if different else '') + 'exists(select 1 from public.every8d_settings_sessions '
                       'where token_hash=' + hashed('session-' + tag + '_login') + ')', tag + ': fresh post-wait candidate set')
            print('PASS ' + tag + ': creator commit visible after alias wait', flush=True)

            number, tag = self.case('login_first_diff' if different else 'login_first_same')
            parent = self.parent(number)
            email = tag + '@example.invalid'
            self.enroll(parent, email, number, tag + '_existing')
            creator_parent = self.parent(number + 100000) if different else parent
            grant = self.grant(creator_parent, email, tag + '_creator')
            self.verified('enrollment', email, number, tag + '_creator', grant)
            self.verified('login', email, number, tag + '_login')
            login = self.actor(tag + '_login')
            login.start(self.consume('login', number, tag + '_login'))
            login.ready('1')
            creator = self.actor(tag + '_creator')
            creator.start(self.consume('enrollment', number, tag + '_creator'))
            self.blocked(creator, login, tag + ': creation waits through login commit')
            self.check('select consumed_at is null from public.every8d_settings_enrollment_grants '
                       'where id=' + quote(grant), tag + ': no premature authority')
            login.finish()
            creator.ready('1' if different else '0')
            creator.finish()
            print('PASS ' + tag + ': creation serialized through exact-one commit', flush=True)

    def consume_races(self):
        for kind in ('same_challenge', 'same_grant', 'same_installation_email'):
            number, tag = self.case(kind)
            parent = self.parent(number)
            email = tag + '@example.invalid'
            grant = self.grant(parent, email, tag + '_a')
            self.verified('enrollment', email, number, tag + '_a', grant)
            second_tag = tag + '_a'
            if kind != 'same_challenge':
                second_tag = tag + '_b'
                second_grant = grant
                if kind == 'same_installation_email':
                    # Independent legal grants: do not let operator reissue mask serialization.
                    second_grant = self.sql(f"""insert into public.every8d_settings_enrollment_grants(
                      token_hash,installation_id,installation_generation,method,pinned_normalized_email,
                      operator_issuer,operator_approver,operator_case_reference,operator_reason,created_at,expires_at)
                      select {hashed('grant-'+second_tag)},installation_id,installation_generation,method,
                        pinned_normalized_email,operator_issuer,operator_approver,operator_case_reference,
                        operator_reason,created_at,expires_at from public.every8d_settings_enrollment_grants
                      where id={quote(grant)} returning id""")
                self.verified('enrollment', email, number, second_tag, second_grant)
            first = self.actor(tag + '_a')
            first.start(self.consume('enrollment', number, tag + '_a'))
            first.ready('1')
            second = self.actor(tag + '_b')
            second.start(self.consume('enrollment', number, second_tag, tag + '_loser'))
            self.blocked(second, first, tag)
            first.finish()
            second.ready('0')
            second.finish()
            self.check(f'select count(*)=1 from public.every8d_settings_administrators where installation_id={quote(parent)} '
                       f'and normalized_email={quote(email)}', tag)
            print('PASS ' + tag + ': one enrollment authority winner', flush=True)
        number, tag = self.case('login_challenge_race')
        parent = self.parent(number)
        email = tag + '@example.invalid'
        self.enroll(parent, email, number, tag + '_existing')
        self.verified('login', email, number, tag)
        first = self.actor(tag + '_a')
        first.start(self.consume('login', number, tag, tag + '_a'))
        first.ready('1')
        second = self.actor(tag + '_b')
        second.start(self.consume('login', number, tag, tag + '_b'))
        self.blocked(second, first, tag)
        first.finish()
        second.ready('0')
        second.finish()
        print('PASS same login challenge: one authority winner', flush=True)

    def isolation(self):
        for purpose in ('enrollment', 'login'):
            number, tag = self.case('isolation_' + purpose)
            parent = self.parent(number)
            email = tag + '@example.invalid'
            grant = self.grant(parent, email, tag) if purpose == 'enrollment' else None
            if purpose == 'login':
                self.enroll(parent, email, number, tag + '_existing')
            self.verified(purpose, email, number, tag, grant)
            before = self.snapshot()
            for level in ('repeatable read', 'serializable'):
                self.sql('begin isolation level ' + level + '; set local role service_role; '
                         + self.consume(purpose, number, tag) + '; commit;', error='25000', label=tag + ' ' + level)
                if self.snapshot() != before:
                    raise Failure(tag + ': unsupported isolation mutated authority')
            self.check('select (' + self.consume(purpose, number, tag) + ')=1', tag + ': READ COMMITTED supported')
            print('PASS ' + tag + ': real wrappers refuse RR/SERIALIZABLE before mutation; RC succeeds', flush=True)

    def lifecycle(self, kind, parent, tag):
        if kind == 'disable':
            return f"update public.ghl_marketplace_installations set status='disabled' where id={quote(parent)}"
        if kind == 'generation':
            return f'update public.ghl_marketplace_installations set installation_generation=2 where id={quote(parent)}'
        return f"""select public.apply_every8d_ghl_marketplace_lifecycle_v2(
          'UNINSTALL',r.marketplace_app_id,r.oauth_client_id,null,i.location_id,null,
          r.conversation_provider_id,i.latest_lifecycle_version_id,clock_timestamp(),{quote(tag)})
          from public.ghl_marketplace_installations i join public.ghl_marketplace_app_registrations r
            on r.app_namespace=i.app_namespace where i.id={quote(parent)}"""

    def lifecycle_races(self):
        for operation in ('login', 'auth'):
            for kind in ('disable', 'uninstall', 'generation'):
                for parent_first in (False, True):
                    number, tag = self.case(operation + '_' + kind + ('_parent_first' if parent_first else '_operation_first'))
                    parent = self.parent(number)
                    email = tag + '@example.invalid'
                    self.enroll(parent, email, number, tag + '_existing')
                    self.verified('login', email, number, tag)
                    op = self.consume('login', number, tag) if operation == 'login' else self.auth(tag + '_existing')
                    lifecycle = self.lifecycle(kind, parent, tag)
                    first = self.actor(tag + '_first', None if parent_first else 'service_role')
                    first.start(lifecycle if parent_first else op)
                    first.ready(None if parent_first else '1')
                    second = self.actor(tag + '_second', 'service_role' if parent_first else None)
                    second.start(op if parent_first else lifecycle)
                    self.blocked(second, first, tag)
                    first.finish()
                    second.ready('0' if parent_first else None)
                    second.finish()
                    self.check('select (' + self.auth(tag + '_existing') + ')=0', tag + ': auth after lifecycle')
                    if parent_first:
                        self.check('select consumed_at is null from public.every8d_settings_auth_challenges '
                                   'where request_token_hash=' + hashed('request-' + tag), tag + ': no login mutation')
                    print('PASS ' + tag + ': parent-before-admin/session serialization', flush=True)

    def administrator_races(self):
        for operation in ('login', 'auth'):
            for revoke_first in (False, True):
                number, tag = self.case(operation + '_admin_revoke_' + str(revoke_first))
                parent = self.parent(number)
                email = tag + '@example.invalid'
                admin = self.enroll(parent, email, number, tag + '_existing')
                self.verified('login', email, number, tag)
                op = self.consume('login', number, tag) if operation == 'login' else self.auth(tag + '_existing')
                revoke = f"update public.every8d_settings_administrators set revoked_at=clock_timestamp(),revocation_reason='proof_revoke' where id={quote(admin)}"
                first = self.actor(tag + '_first', None if revoke_first else 'service_role')
                first.start(revoke if revoke_first else op)
                first.ready(None if revoke_first else '1')
                second = self.actor(tag + '_second', 'service_role' if revoke_first else None)
                second.start(op if revoke_first else revoke)
                self.blocked(second, first, tag)
                first.finish()
                second.ready('0' if revoke_first else None)
                second.finish()
                self.check('select (' + self.auth(tag + '_existing') + ')=0', tag + ': revoked administrator')
                print('PASS ' + tag, flush=True)

    def auth_logout_races(self):
        for logout_first in (False, True):
            number, tag = self.case('auth_logout_' + str(logout_first))
            parent = self.parent(number)
            self.enroll(parent, tag + '@example.invalid', number, tag)
            first = self.actor(tag + '_first')
            first.start(self.revoke(tag) if logout_first else self.auth(tag))
            first.ready('t' if logout_first else '1')
            second = self.actor(tag + '_second')
            second.start(self.auth(tag) if logout_first else self.revoke(tag))
            self.blocked(second, first, tag)
            first.finish()
            second.ready('0' if logout_first else 't')
            second.finish()
            self.check('select (' + self.auth(tag) + ')=0', tag + ': revocation durable')
            print('PASS ' + tag, flush=True)

    def expiry_races(self):
        for operation in ('login', 'auth'):
            if any(actor.process.poll() is None for actor in self.actors):
                raise Failure('expiry fixture setup requires all earlier actors to have exited')
            isolated_setup = """select not exists(select 1 from pg_stat_activity
              where datname=current_database() and backend_type='client backend'
                and pid<>pg_backend_pid())"""
            self.check(isolated_setup, 'expiry fixture setup has no concurrent actor or transaction')
            number, tag = self.case(operation + '_expiry')
            parent = self.parent(number)
            self.enroll(parent, tag + '@example.invalid', number, tag + '_existing')
            challenge = self.verified('login', tag + '@example.invalid', number, tag)
            if operation == 'login':
                expected_expiry = self.sql(f"""begin;
                  alter table public.every8d_settings_auth_challenges disable trigger protect_every8d_settings_auth_challenge;
                  update public.every8d_settings_auth_challenges c
                    set expires_at=t.decision_at,created_at=t.decision_at-interval '10 minutes'
                    from (select clock_timestamp()+interval '2 seconds' as decision_at) t where c.id={quote(challenge)}
                    returning c.expires_at::text;
                  commit;""", label=tag + ': fixture commit with deferred integrity enabled')
                # COMMIT discharges the deferred integrity events. Re-enable in
                # a new connection/transaction before creating any race actor.
                self.sql('alter table public.every8d_settings_auth_challenges enable trigger protect_every8d_settings_auth_challenge',
                         label=tag + ': separate protection re-enable')
                barrier_sql = 'select public.lock_every8d_settings_email_pseudonyms_v1(' + aliases(number) + ')'
                expired = 'select clock_timestamp()>=expires_at from public.every8d_settings_auth_challenges where id=' + quote(challenge)
                op = self.consume('login', number, tag)
            else:
                expected_expiry = self.sql("""begin;
                  alter table public.every8d_settings_sessions disable trigger protect_every8d_settings_session;
                  update public.every8d_settings_sessions s set expires_at=t.decision_at,created_at=t.decision_at-interval '1 hour'
                    from (select clock_timestamp()+interval '2 seconds' as decision_at) t where s.token_hash="""
                    + hashed('session-' + tag + '_existing') + """ returning s.expires_at::text;
                  commit;""", label=tag + ': session fixture commit')
                self.sql('alter table public.every8d_settings_sessions enable trigger protect_every8d_settings_session',
                         label=tag + ': separate session protection re-enable')
                barrier_sql = 'select 1 from public.every8d_settings_sessions where token_hash=' + hashed('session-' + tag + '_existing') + ' for update'
                expired = 'select clock_timestamp()>=expires_at from public.every8d_settings_sessions where token_hash=' + hashed('session-' + tag + '_existing')
                op = self.auth(tag + '_existing')
            # Every sql() call opens and closes an independent psql connection.
            # These assertions observe committed setup from another session.
            self.check(isolated_setup, tag + ': no setup transaction remains open')
            self.check("""select (select count(t.oid)=5 and bool_and(t.tgenabled='O'
                and t.tgdeferrable=e.deferred and t.tginitdeferred=e.deferred)
              from (values
                ('every8d_settings_auth_challenges','protect_every8d_settings_auth_challenge',false),
                ('every8d_settings_sessions','protect_every8d_settings_session',false),
                ('every8d_settings_auth_challenge_failures','protect_every8d_settings_auth_challenge_failure',false),
                ('every8d_settings_auth_challenges','assert_every8d_settings_challenge_row_integrity',true),
                ('every8d_settings_auth_challenge_failures','assert_every8d_settings_failure_ledger_integrity',true)
              ) e(relation_name,trigger_name,deferred)
              left join pg_trigger t on t.tgrelid=to_regclass('public.'||e.relation_name) and t.tgname=e.trigger_name)
              and not exists(select 1 from pg_trigger t where t.tgconstraint<>0 and t.tgenabled<>'O'
                and t.tgrelid in ('public.every8d_settings_enrollment_grants'::regclass,
                  'public.every8d_settings_administrators'::regclass,'public.every8d_settings_sessions'::regclass,
                  'public.every8d_settings_auth_challenges'::regclass,'public.every8d_settings_auth_challenge_failures'::regclass))""",
                       tag + ': normal protection and all integrity trigger states before race')
            challenge_deadline = (f'and c.expires_at={quote(expected_expiry)}::timestamptz'
                                  if operation == 'login' else '')
            self.check(f"""select exists(select 1 from public.every8d_settings_auth_challenges c
              where c.id={quote(challenge)} and c.request_token_hash={hashed('request-' + tag)}
                and c.purpose='login' and c.enrollment_grant_id is null
                and c.verified_at is not null and c.delivery_succeeded_at is not null
                and c.delivery_failed_at is null and c.locked_at is null and c.superseded_at is null
                and c.consumed_at is null and c.email_scrubbed_at is null
                and c.normalized_email={quote(tag + '@example.invalid')}
                and public.is_every8d_settings_canonical_email_v1(c.normalized_email)
                and c.email_pseudonym=c3c2a_proof.alias({number})
                and c.created_at<=c.delivery_succeeded_at and c.delivery_succeeded_at<=c.verified_at
                and c.verified_at<c.expires_at and clock_timestamp()<c.expires_at
                and c.expires_at=c.created_at+interval '10 minutes' {challenge_deadline}
                and not exists(select 1 from public.every8d_settings_auth_challenge_failures f where f.challenge_id=c.id))""",
                       tag + ': committed VERIFIED challenge identity, delivery, deadline and ledger integrity')
            if operation == 'auth':
                self.check(f"""select exists(select 1 from public.every8d_settings_sessions s
                  where s.token_hash={hashed('session-' + tag + '_existing')}
                    and s.expires_at={quote(expected_expiry)}::timestamptz
                    and s.created_at=s.expires_at-interval '1 hour' and s.revoked_at is null
                    and clock_timestamp()<s.expires_at)""", tag + ': committed near-expiry session')
            self.check('select not (' + expired + ')', tag + ': valid committed live fixture')
            print('FIXTURE_READY ' + tag + ': committed; protection and deferred integrity enabled; no setup/runtime actors', flush=True)
            before = self.snapshot()
            barrier = self.actor(tag + '_barrier', OWNER)
            barrier.start(barrier_sql)
            barrier.ready()
            operation_actor = self.actor(tag + '_operation')
            operation_actor.start(op)
            self.blocked(operation_actor, barrier, tag)
            self.until(lambda: self.sql(expired) == 't', tag + ': database expiry')
            barrier.finish()
            operation_actor.ready('0')
            operation_actor.finish()
            if self.snapshot() != before:
                raise Failure(tag + ': expiry rejection mutated authority')
            state_query = f"""select jsonb_build_object('scenario',{quote(tag)},
              'challenge',(select jsonb_build_object('purpose',c.purpose,'verified',c.verified_at is not null,
                'consumed',c.consumed_at is not null,'email_retained',c.normalized_email is not null,
                'scrubbed',c.email_scrubbed_at is not null,'expired',clock_timestamp()>=c.expires_at,
                'linked_grant',c.enrollment_grant_id is not null) from public.every8d_settings_auth_challenges c
                where c.id={quote(challenge)}),
              'fixture_grant',(select jsonb_build_object('rows',count(*),'consumed',count(*) filter(where consumed_at is not null),
                'revoked',count(*) filter(where revoked_at is not null)) from public.every8d_settings_enrollment_grants
                where token_hash={hashed('grant-' + tag + '_existing')}),
              'administrators',(select jsonb_build_object('rows',count(*),'active',count(*) filter(where revoked_at is null))
                from public.every8d_settings_administrators where normalized_email={quote(tag + '@example.invalid')}),
              'sessions',(select jsonb_build_object('rows',count(*),'expired',count(*) filter(where clock_timestamp()>=expires_at),
                'revoked',count(*) filter(where revoked_at is not null),
                'active_unexpired',count(*) filter(where revoked_at is null and clock_timestamp()<expires_at))
                from public.every8d_settings_sessions where administrator_id in (
                  select id from public.every8d_settings_administrators where normalized_email={quote(tag + '@example.invalid')})),
              'new_sessions',(select count(*) from public.every8d_settings_sessions
                where token_hash={hashed('session-' + tag)}))"""
            print('EXPIRY_STATE ' + self.sql(state_query), flush=True)
            if operation == 'auth':
                self.check(self.revoke(tag + '_existing'), tag + ': expired logout succeeds')
                self.check('select revoked_at is not null and revocation_reason=\'logout\' from public.every8d_settings_sessions '
                           'where token_hash=' + hashed('session-' + tag + '_existing'), tag + ': expired logout persisted')
                print('POST_LOGOUT_STATE ' + self.sql(state_query), flush=True)
            print('PASS ' + tag + ': decision time after wait; authority unchanged after rejection', flush=True)

    def atomic_failures(self):
        number, tag = self.case('deferred_commit')
        parent = self.parent(number)
        email = tag + '@example.invalid'
        grant = self.grant(parent, email, tag)
        self.verified('enrollment', email, number, tag, grant)
        before = self.snapshot()
        self.sql('create constraint trigger c3c2a_deferred_failure after insert on public.every8d_settings_sessions '
                 'deferrable initially deferred for each row execute function c3c2a_proof.reject_commit()')
        try:
            self.sql('begin; set local role service_role; ' + self.consume('enrollment', number, tag)
                     + '; commit;', error='23514', label='actual COMMIT failure')
        finally:
            self.sql('drop trigger c3c2a_deferred_failure on public.every8d_settings_sessions')
        if self.snapshot() != before:
            raise Failure('deferred COMMIT failure left partial authority')
        print('PASS actual deferred COMMIT failure: all authority unchanged', flush=True)
        number, tag = self.case('login_collision')
        parent = self.parent(number)
        self.enroll(parent, tag + '@example.invalid', number, tag + '_existing')
        self.verified('login', tag + '@example.invalid', number, tag)
        before = self.snapshot()
        self.sql(self.consume('login', number, tag, tag + '_existing'), error='23505', label='login session collision')
        if self.snapshot() != before:
            raise Failure('login collision left partial authority')
        print('PASS login session collision: no challenge/session mutation', flush=True)

    def rollback_preflight(self):
        # Successful rollback must never reuse a foundation harness's data.
        empty = self.clone('empty')
        before = self.snapshot(empty)
        boundary = self.boundary(empty)
        self.install(empty)
        if self.snapshot(empty) != before or self.boundary(empty) != boundary:
            raise Failure('migration changed prior schema/privileges or created data')
        self.sql(ROLLBACK.read_text(encoding='utf-8'), empty, OWNER, label='empty pre-use rollback')
        self.target_count(0, empty)
        if self.boundary(empty) != boundary:
            raise Failure('empty rollback changed prior authority or privileges')
        self.check("select to_regprocedure('public.redeem_every8d_settings_enrollment_grant_v1(bytea,text,text)') is not null "
            "and to_regprocedure('public.protect_ghl_marketplace_installation_v5()') is not null "
            "and to_regprocedure('public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)') is not null",
            'rollback retains C3a/C3b/lifecycle authority', empty)
        self.install(empty)  # Reapply rechecks every frozen prerequisite manifest.
        print('PASS separate clean database: apply, empty rollback, exact nine removed, reapply', flush=True)
        fixtures = PROOF.read_text(encoding='utf-8').split('\\if :{?fixtures_only}')[0] + '\ncommit;'
        self.sql(fixtures, empty)
        cases = {
            'definition': "alter function public.runtime_revoke_every8d_settings_session_v1(bytea) cost 42",
            'owner': "alter function public.runtime_revoke_every8d_settings_session_v1(bytea) owner to postgres",
            'acl': "grant execute on function public.runtime_revoke_every8d_settings_session_v1(bytea) to anon",
            'dependency': "create view c3c2a_proof.dependency as select * from public.runtime_authenticate_every8d_settings_session_v1('\\x'::bytea)",
            'later': "create function public.c3c2a_later_dependency() returns boolean language sql begin atomic select public.runtime_revoke_every8d_settings_session_v1('\\x'::bytea); end",
            'administrator': "select c3c2a_proof.parent(700001) as p \\gset\nselect c3c2a_proof.grant_for(:'p','rollback@example.invalid','rollback_admin'); select * from public.redeem_every8d_settings_enrollment_grant_v1(c3c2a_proof.hash('grant-rollback_admin'),'rollback@example.invalid',c3c2a_proof.alias(700001))",
            'session': "select c3c2a_proof.enroll(c3c2a_proof.parent(700002),'rollback_session@example.invalid',700002,'rollback_session')",
            'consumed': "select c3c2a_proof.verified('login','rollback_consumed@example.invalid',c3c2a_proof.alias(700003),'rollback_consumed'); update public.every8d_settings_auth_challenges c set consumed_at=t.decision_at,normalized_email=null,email_scrubbed_at=t.decision_at from (select clock_timestamp() as decision_at) t where c.request_token_hash=c3c2a_proof.hash('request-rollback_consumed')",
        }
        for label, fixture in cases.items():
            db = self.clone('refuse_' + label, empty)
            self.sql(fixture, db)
            before = self.snapshot(db)
            if label == 'owner':
                function_catalog = "select md5(jsonb_agg(to_jsonb(p) order by p.oid)::text) from pg_proc p where p.pronamespace='public'::regnamespace"
                authority_before = self.boundary(db), self.sql(function_catalog, db)
            self.sql(ROLLBACK.read_text(encoding='utf-8'), db, OWNER,
                     error='42501' if label == 'owner' else '55000', label='rollback refuses ' + label,
                     error_message='C3c-2a prior settings authority owner mismatch' if label == 'owner' else None)
            if self.snapshot(db) != before:
                raise Failure('rollback refusal mutated data: ' + label)
            self.target_count(9, db)
            if label == 'owner':
                if (self.boundary(db), self.sql(function_catalog, db)) != authority_before:
                    raise Failure('owner refusal changed prerequisite/target authority, metadata or ACL')
                self.check("select proowner='postgres'::regrole from pg_proc where oid="
                           "'public.runtime_revoke_every8d_settings_session_v1(bytea)'::regprocedure",
                           'rollback preserves intentionally tampered target owner', db)
                self.check("select to_regprocedure('public.redeem_every8d_settings_enrollment_grant_v1(bytea,text,text)') is not null "
                           "and to_regprocedure('public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)') is not null "
                           "and to_regprocedure('public.apply_every8d_ghl_marketplace_lifecycle_v2(text,text,text,uuid,text,text,text,text,timestamptz,text)') is not null",
                           'owner refusal retains C3a/C3b/lifecycle authority', db)
                print('PASS owner refusal: nonzero exit; 42501 exact ownership message; nine targets; tampered postgres owner, ACL/catalog and rows unchanged', flush=True)
            print('PASS rollback refuses ' + label + ' before destructive DDL', flush=True)
        tamper_cases = {
            'prior_body': "alter function public.redeem_every8d_settings_enrollment_grant_v1(bytea,text,text) cost 42",
            'prior_source': "create or replace function public.is_every8d_settings_email_pseudonym_v1(input_value text) returns boolean language sql immutable strict parallel safe set search_path=pg_catalog,public as 'select false'",
            'prior_owner': "alter function public.is_every8d_settings_email_pseudonym_v1(text) owner to postgres",
            'prior_trigger': "alter table public.every8d_settings_sessions disable trigger protect_every8d_settings_session",
            'table_acl': "grant select on public.every8d_settings_sessions to service_role",
            'rls': "alter table public.every8d_settings_auth_challenges disable row level security",
            'policy_role': "alter policy marketplace_installations_server_select on public.ghl_marketplace_installations to anon",
            'schema': "grant create on schema public to anon",
            'target_conflict': "create function public.runtime_revoke_every8d_settings_session_v1(text) returns boolean language sql as 'select true'",
        }
        for label, fixture in tamper_cases.items():
            db = self.clone('preflight_' + label)
            self.sql(fixture, db, OWNER if label == 'target_conflict' else None)
            if label == 'target_conflict':
                conflict_valid = """select exists(select 1 from pg_proc p
                  where p.oid=to_regprocedure('public.runtime_revoke_every8d_settings_session_v1(text)')
                    and p.prokind='f' and p.proowner='c3a_migration_owner'::regrole
                    and p.proowner=(select relowner from pg_class where oid='public.ghl_marketplace_installations'::regclass))"""
                frozen_signatures = [
                    'runtime_discover_every8d_settings_verified_challenge_v1(bytea,text)',
                    'runtime_consume_every8d_settings_enrollment_challenge_v1(bytea,text[],bytea)',
                    'runtime_consume_every8d_settings_login_challenge_v1(bytea,text[],bytea)',
                    'runtime_authenticate_every8d_settings_session_v1(bytea)',
                    'runtime_revoke_every8d_settings_session_v1(bytea)',
                    'consume_every8d_settings_enrollment_challenge_core_v1(bytea,text[],bytea)',
                    'consume_every8d_settings_login_challenge_core_v1(bytea,text[],bytea)',
                    'authenticate_every8d_settings_session_core_v1(bytea)',
                    'revoke_every8d_settings_session_core_v1(bytea)',
                ]
                no_frozen_targets = 'select bool_and(to_regprocedure(signature) is null) from (values ' + ','.join(
                    '(' + quote('public.' + signature) + ')' for signature in frozen_signatures) + ') t(signature)'
                self.check(conflict_valid, 'conflicting text overload has exact trusted common owner', db)
                self.check(no_frozen_targets, 'no exact frozen target signature exists before conflict proof', db)
                conflict_catalog = """select md5(jsonb_build_array(
                  (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p where p.pronamespace='public'::regnamespace),
                  (select jsonb_agg(to_jsonb(n) order by n.oid) from pg_namespace n where n.nspname in ('public','extensions')))::text)"""
                conflict_before = self.boundary(db), self.sql(conflict_catalog, db)
            before = self.snapshot(db)
            expected = '42501' if label in ('table_acl', 'schema', 'prior_owner') else ('42723' if label == 'target_conflict' else '55000')
            self.sql(MIGRATION.read_text(encoding='utf-8'), db, OWNER, error=expected, label='preflight ' + label,
                     error_message='C3c-2a target function conflict' if label == 'target_conflict' else None)
            if self.snapshot(db) != before:
                raise Failure('preflight refusal changed data: ' + label)
            if label != 'target_conflict':
                self.target_count(0, db)
            else:
                self.check(no_frozen_targets, 'zero exact frozen targets after conflict refusal', db)
                self.check(conflict_valid, 'conflicting overload and trusted owner retained after refusal', db)
                if (self.boundary(db), self.sql(conflict_catalog, db)) != conflict_before:
                    raise Failure('target-conflict refusal changed schema, privileges or function authority')
                print('PASS target conflict: trusted-owner text overload; exact 42723 conflict message; zero exact targets; overload/catalog/ACL/data unchanged', flush=True)
            print('PASS fail-closed prerequisite ' + label, flush=True)
        old_db = self.db
        self.db = empty
        try:
            holder = self.actor('rollback_maintenance_holder', None)
            holder.start('lock table public.ghl_marketplace_installations in row exclusive mode')
            holder.ready()
            before = self.snapshot()
            # Explicitly expected maintenance refusal, never a runtime domain result.
            self.sql(ROLLBACK.read_text(encoding='utf-8'), role=OWNER, error='55P03', label='expected maintenance lock refusal')
            holder.finish()
            if self.snapshot() != before:
                raise Failure('maintenance refusal mutated data')
            self.target_count(9, empty)
        finally:
            self.db = old_db
        print('PASS rollback refuses unavailable maintenance lock before destructive DDL', flush=True)

    def cleanup(self):
        failed = False
        for actor in self.actors:
            if actor.process.poll() is None:
                try:
                    actor.finish(commit=False)
                except (Failure, OSError):
                    failed = True
        self.sql(f"select pg_terminate_backend(pid) from pg_stat_activity where application_name like '{self.prefix}%' "
                 "and pid<>pg_backend_pid()")
        self.check(f"select not exists(select 1 from pg_stat_activity where application_name like '{self.prefix}%')",
                   'zero surviving harness backends')
        for db in reversed(self.clones):
            self.sql(f'drop database {db}', 'postgres')
        if failed:
            raise Failure('an actor did not terminate cleanly')
        print('PASS zero surviving harness backends', flush=True)


class Actor:
    def __init__(self, harness, label, role):
        self.app = (harness.prefix + '_' + label)[:63]
        cmd, env = harness.command(harness.db, role, self.app)
        self.process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1, env=env)
        self.output = queue.Queue()
        self.errors = []
        self.threads = [
            threading.Thread(target=lambda: [self.output.put(line.strip()) for line in self.process.stdout], daemon=True),
            threading.Thread(target=lambda: self.errors.extend(self.process.stderr.readlines()), daemon=True),
        ]
        for thread in self.threads:
            thread.start()

    def send(self, statement):
        self.process.stdin.write(statement + '\n')
        self.process.stdin.flush()

    def start(self, statement):
        self.send("begin isolation level read committed; " + statement + "; select 'C3C2A_READY';")

    def ready(self, expected=None):
        values = []
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try:
                value = self.output.get(timeout=0.05)
            except queue.Empty:
                if self.process.poll() is not None:
                    raise Failure(self.app + ': actor exited before barrier')
                continue
            if value == 'C3C2A_READY':
                if expected is not None and (not values or values[-1] != expected):
                    raise Failure(self.app + ': unexpected authoritative result')
                if self.errors:
                    raise Failure(self.app + ': unexpected database error')
                return
            if value:
                values.append(value)
        raise Failure(self.app + ': process/barrier timeout')

    def finish(self, commit=True):
        self.send(('commit;' if commit else 'rollback;') + '\n\\q')
        self.process.stdin.close()
        try:
            status = self.process.wait(timeout=15)
        except subprocess.TimeoutExpired as exc:
            self.process.kill()
            self.process.wait()
            raise Failure(self.app + ': process timeout') from exc
        for thread in self.threads:
            thread.join(timeout=1)
        if status or self.errors:
            raise Failure(self.app + ': database actor failed; no retry')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', required=True)
    parser.add_argument('--prerequisite', required=True)
    parser.add_argument('--container', default=os.environ.get('POSTGRES_CONTAINER_ID'))
    parser.add_argument('--native-psql', default=os.environ.get('C3C2A_NATIVE_PSQL'))
    parser.add_argument('--native-port', type=int, default=55432)
    args = parser.parse_args()
    if not args.container and not args.native_psql:
        parser.error('disposable container or native loopback runtime required')
    if not all(re.fullmatch(r'c3c2a_[a-z0-9_]+', name) for name in [args.database, args.prerequisite]):
        parser.error('only dedicated c3c2a disposable databases are accepted')
    harness = Harness(args)
    try:
        harness.check("select current_setting('server_version_num')::integer/10000=17", 'PostgreSQL 17 required')
        harness.prerequisite_owners()
        harness.creator_login()
        harness.consume_races()
        harness.isolation()
        harness.lifecycle_races()
        harness.administrator_races()
        harness.auth_logout_races()
        harness.expiry_races()
        harness.atomic_failures()
        harness.rollback_preflight()
        print('PASS no unexpected deadlock, lock/statement/process timeout, or retry', flush=True)
    finally:
        harness.cleanup()


if __name__ == '__main__':
    try:
        main()
    except Failure as exc:
        raise SystemExit('FAIL ' + str(exc))
