\set ON_ERROR_STOP on
\set VERBOSITY terse
-- Disposable PostgreSQL 17 only; synthetic identities, no provider activity.
begin;
create schema c3c2a_proof;
create function c3c2a_proof.assert_true(actual boolean, label text)
returns void language plpgsql as $$ begin
  if actual is distinct from true then raise exception 'C3c-2a proof failed: %',label; end if;
end; $$;
create function c3c2a_proof.hash(label text) returns bytea language sql immutable security definer set search_path=pg_catalog,public
as $$ select extensions.digest(convert_to(label,'UTF8'),'sha256') $$;
create function c3c2a_proof.alias(n integer) returns text language sql immutable
as $$ select 'k1:'||encode(c3c2a_proof.hash('alias-'||n),'hex') $$;
create function c3c2a_proof.reject(statement text, expected_state text, label text)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if sqlstate=expected_state then return; end if;
    raise exception 'C3c-2a unexpected failure in % (state %)',label,sqlstate;
  end;
  raise exception 'C3c-2a accepted forbidden operation: %',label;
end; $$;
create function c3c2a_proof.parent(n integer) returns uuid language plpgsql as $$
declare parent_id uuid; tenant_id_value uuid; begin
  insert into public.ghl_marketplace_app_registrations(
    app_namespace,marketplace_app_id,oauth_client_id,conversation_provider_id,channel,provider)
  values('every8d_connect','c3c2a-proof-app','c3c2a.proof.client','c3c2a-proof-provider','sms','every8d')
  on conflict do nothing;
  insert into public.ghl_marketplace_app_version_registrations(app_namespace,marketplace_version_id)
  values('every8d_connect','c3c2a.proof.version') on conflict do nothing;
  insert into public.tenants(location_id,ghl_provider_id,line_channel_id)
  values('c3c2a-location-'||n,'c3c2a-line-provider','c3c2a-line-channel') returning id into tenant_id_value;
  insert into public.ghl_marketplace_installations(
    app_namespace,marketplace_app_id,oauth_client_id,tenant_id,location_id,company_id,
    conversation_provider_id,channel,provider,status,installation_generation,
    access_token_ciphertext,refresh_token_ciphertext,encryption_key_version,token_expires_at,
    granted_scopes,credential_revision,credential_state,latest_lifecycle_event_at,
    latest_lifecycle_event_id,latest_lifecycle_event_type,latest_lifecycle_version_id)
  select r.app_namespace,r.marketplace_app_id,r.oauth_client_id,tenant_id_value,'c3c2a-location-'||n,
    'c3c2a-company',r.conversation_provider_id,'sms','every8d','pending',1,
    null,null,null,null,'{}'::text[],0,'none',clock_timestamp(),'c3c2a-install-'||n,
    'INSTALL','c3c2a.proof.version'
  from public.ghl_marketplace_app_registrations r where r.app_namespace='every8d_connect'
  returning id into parent_id;
  return parent_id;
end; $$;
create function c3c2a_proof.grant_for(parent_id uuid,email text,tag text,
  grant_method text default 'operator_initial') returns uuid language plpgsql as $$
declare result uuid; begin
  select g.grant_id into strict result from public.issue_every8d_settings_operator_enrollment_grant_v1(
    parent_id,1,email,c3c2a_proof.hash('grant-'||tag),grant_method,clock_timestamp()+interval '12 minutes',
    'synthetic-issuer','synthetic-approver','C3C2A-PROOF','disposable proof') g;
  return result;
end; $$;
create function c3c2a_proof.verified(purpose_value text,email text,alias_value text,tag text,
  grant_id uuid default null) returns uuid language plpgsql as $$
declare result uuid; issued_at timestamptz:=clock_timestamp(); deadline timestamptz; begin
  deadline:=issued_at+interval '10 minutes';
  if grant_id is not null then
    select least(deadline,g.expires_at) into deadline
    from public.every8d_settings_enrollment_grants g where g.id=grant_id;
  end if;
  insert into public.every8d_settings_auth_challenges(request_token_hash,purpose,enrollment_grant_id,
    normalized_email,email_pseudonym,otp_hmac,otp_hmac_key_version,created_at,expires_at)
  values(c3c2a_proof.hash('request-'||tag),purpose_value,grant_id,email,alias_value,
    c3c2a_proof.hash('otp-'||tag),'proof-key',issued_at,deadline) returning id into result;
  perform c3c2a_proof.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
    c3c2a_proof.hash('request-'||tag),true,null),'fixture actual delivery transition');
  -- A prepared VERIFIED row is fixture authority; preserve the real protected transition.
  update public.every8d_settings_auth_challenges set verified_at=clock_timestamp() where id=result;
  return result;
end; $$;
create function c3c2a_proof.enroll(parent_id uuid,email text,n integer,tag text,
  grant_method text default 'operator_initial') returns uuid language plpgsql as $$
declare g uuid; result uuid; begin
  g:=c3c2a_proof.grant_for(parent_id,email,tag,grant_method);
  perform c3c2a_proof.verified('enrollment',email,c3c2a_proof.alias(n),tag,g);
  select a.administrator_id into strict result
  from public.runtime_consume_every8d_settings_enrollment_challenge_v1(
    c3c2a_proof.hash('request-'||tag),array[c3c2a_proof.alias(n)],c3c2a_proof.hash('session-'||tag)) a;
  return result;
end; $$;
create function c3c2a_proof.reject_session() returns trigger language plpgsql as $$
begin raise exception 'synthetic session boundary failure' using errcode='23514'; end; $$;
create function c3c2a_proof.reject_consumption() returns trigger language plpgsql as $$
begin
  if new.consumed_at is not null then
    raise exception 'synthetic challenge boundary failure' using errcode='23514';
  end if;
  return new;
end; $$;
create function c3c2a_proof.reject_commit() returns trigger language plpgsql as $$
begin raise exception 'synthetic deferred failure' using errcode='23514'; end; $$;
-- Fixtures are accessible only inside disposable test databases, never migrations.
grant usage on schema c3c2a_proof to c3a_migration_owner,service_role;
grant execute on all functions in schema c3c2a_proof to c3a_migration_owner,service_role;

\if :{?fixtures_only}
commit;
\quit
\endif

select c3c2a_proof.assert_true(current_setting('server_version_num')::integer/10000=17,'PostgreSQL 17');
select c3c2a_proof.assert_true(not (select rolsuper or rolbypassrls from pg_roles
  where rolname='c3a_migration_owner'),'synthetic owner is neither superuser nor BYPASSRLS');

-- The migration postflight freezes all exact names, signatures, argument/result
-- metadata and ACLs. Independently exercise application-role effective privileges.
select c3c2a_proof.assert_true((select count(*)=9 from pg_proc p
  where p.pronamespace='public'::regnamespace and p.proname in (
    'runtime_discover_every8d_settings_verified_challenge_v1',
    'runtime_consume_every8d_settings_enrollment_challenge_v1',
    'runtime_consume_every8d_settings_login_challenge_v1',
    'runtime_authenticate_every8d_settings_session_v1','runtime_revoke_every8d_settings_session_v1',
    'consume_every8d_settings_enrollment_challenge_core_v1','consume_every8d_settings_login_challenge_core_v1',
    'authenticate_every8d_settings_session_core_v1','revoke_every8d_settings_session_core_v1')),'exact nine functions');
select c3c2a_proof.assert_true(not exists(select 1 from pg_proc p
  cross join (values ('anon'),('authenticated'),('service_role')) r(role_name)
  where p.pronamespace='public'::regnamespace and (p.proname like '%settings%core_v1'
    or p.proname='redeem_every8d_settings_enrollment_grant_v1')
  and has_function_privilege(r.role_name,p.oid,'EXECUTE')),'cores and C3a redemption owner only');
select c3c2a_proof.assert_true(not exists(select 1 from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.pronamespace='public'::regnamespace and p.proname like 'runtime_%settings%'
    and (a.grantee=0 or a.is_grantable or a.grantee in ('anon'::regrole::oid,'authenticated'::regrole::oid))),
  'no PUBLIC/application execution or grant option');

select c3c2a_proof.parent(1) parent_id \gset p1_
select c3c2a_proof.parent(2) parent_id \gset p2_
select c3c2a_proof.enroll(:'p1_parent_id','first@example.invalid',1,'first') administrator_id \gset first_
select c3c2a_proof.enroll(:'p1_parent_id','recovery@example.invalid',2,'recovery','operator_recovery');
select c3c2a_proof.assert_true((select count(*)=1 and bool_and(expires_at-created_at=interval '1 hour')
  from public.every8d_settings_sessions where token_hash=c3c2a_proof.hash('session-first')),
  'operator_initial creates exactly one one-hour session');
select c3c2a_proof.assert_true((select c.normalized_email is null and c.consumed_at=c.email_scrubbed_at
    and c.verified_at<=c.consumed_at and c.consumed_at<c.expires_at and g.consumed_at is not null
  from public.every8d_settings_auth_challenges c join public.every8d_settings_enrollment_grants g
    on g.id=c.enrollment_grant_id where c.request_token_hash=c3c2a_proof.hash('request-first')),
  'grant/admin/session and consumed scrub state commit together');

set local role service_role;
select c3c2a_proof.assert_true((select count(*)=1 from public.runtime_authenticate_every8d_settings_session_v1(
  c3c2a_proof.hash('session-first'))),'service_role gets one minimum principal');
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_authenticate_every8d_settings_session_v1(
  c3c2a_proof.hash('wrong'))),'wrong session hash');
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_authenticate_every8d_settings_session_v1(null)),'null auth');
select c3c2a_proof.assert_true(public.runtime_revoke_every8d_settings_session_v1(null)=false,'null logout');
select c3c2a_proof.assert_true(public.runtime_revoke_every8d_settings_session_v1('\x01'::bytea)=false,'malformed logout');
select c3c2a_proof.assert_true(public.runtime_revoke_every8d_settings_session_v1(c3c2a_proof.hash('absent')),'absent valid logout');
reset role;

-- Enrollment rejects unusable authority without partial mutation. All fixture
-- tampering is confined to savepoints with real protection restored before RPC.
select c3c2a_proof.grant_for(:'p1_parent_id','negative@example.invalid','negative') grant_id \gset neg_
select c3c2a_proof.verified('enrollment','negative@example.invalid',c3c2a_proof.alias(3),'negative',:'neg_grant_id') challenge_id \gset neg_
select c3c2a_proof.assert_true((select count(*)=1 from public.runtime_discover_every8d_settings_verified_challenge_v1(
  c3c2a_proof.hash('request-negative'),'enrollment')),'verified discovery minimum locator');
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_discover_every8d_settings_verified_challenge_v1(
  c3c2a_proof.hash('request-negative'),'login')),'wrong purpose discovery');

do $$ declare aliases text[]; begin
  foreach aliases slice 1 in array array[array['bad'],array[null::text]] loop
    perform c3c2a_proof.assert_true((select count(*)=0 from
      public.runtime_consume_every8d_settings_enrollment_challenge_v1(c3c2a_proof.hash('request-negative'),
        aliases,c3c2a_proof.hash('session-negative'))),'invalid aliases fail closed');
  end loop;
  perform c3c2a_proof.assert_true((select count(*)=0 from
    public.runtime_consume_every8d_settings_enrollment_challenge_v1(c3c2a_proof.hash('request-negative'),
      array[[c3c2a_proof.alias(3)]],c3c2a_proof.hash('session-negative'))),'two-dimensional aliases');
  perform c3c2a_proof.assert_true((select count(*)=0 from
    public.runtime_consume_every8d_settings_enrollment_challenge_v1(c3c2a_proof.hash('request-negative'),
      null,c3c2a_proof.hash('session-negative'))),'null aliases');
  perform c3c2a_proof.assert_true((select count(*)=0 from
    public.runtime_consume_every8d_settings_login_challenge_v1(c3c2a_proof.hash('request-negative'),
      array[c3c2a_proof.alias(3)],c3c2a_proof.hash('session-negative'))),'wrong purpose consume');
end; $$;

savepoint negative_case;
update public.every8d_settings_enrollment_grants set revoked_at=clock_timestamp(),revocation_reason='proof'
where id=:'neg_grant_id';
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_consume_every8d_settings_enrollment_challenge_v1(
  c3c2a_proof.hash('request-negative'),array[c3c2a_proof.alias(3)],c3c2a_proof.hash('session-negative'))),'revoked grant rejected');
rollback to negative_case;

-- Isolated frozen authority predicates, without permanent protection bypass.
do $$ declare test_case text; statement text; result_count integer; begin
  foreach test_case in array array['install_callback','expired','consumed','pinned_mismatch','stale_generation'] loop
    begin
      alter table public.every8d_settings_enrollment_grants disable trigger protect_every8d_settings_enrollment_grant;
      alter table public.every8d_settings_enrollment_grants disable trigger invalidate_every8d_settings_challenges_after_grant_update;
      statement:=case test_case
        when 'install_callback' then 'method=''install_callback'',pinned_normalized_email=null,operator_issuer=null,operator_approver=null,operator_case_reference=null,operator_reason=null,oauth_bootstrap_reference=gen_random_uuid(),installer_user_hmac=repeat(''a'',64),installer_user_hmac_key_version=''proof'''
        when 'expired' then 'created_at=clock_timestamp()-interval ''10 minutes'',expires_at=clock_timestamp()-interval ''1 minute'''
        when 'consumed' then 'consumed_at=clock_timestamp()'
        when 'pinned_mismatch' then 'pinned_normalized_email=''other@example.invalid'''
        when 'stale_generation' then 'installation_generation=2' end;
      execute 'update public.every8d_settings_enrollment_grants set '||statement||' where token_hash=c3c2a_proof.hash(''grant-negative'')';
      alter table public.every8d_settings_enrollment_grants enable trigger protect_every8d_settings_enrollment_grant;
      alter table public.every8d_settings_enrollment_grants enable trigger invalidate_every8d_settings_challenges_after_grant_update;
      select count(*) into result_count from public.runtime_consume_every8d_settings_enrollment_challenge_v1(
        c3c2a_proof.hash('request-negative'),array[c3c2a_proof.alias(3)],c3c2a_proof.hash('session-negative'));
      perform c3c2a_proof.assert_true(result_count=0,'enrollment predicate: '||test_case);
      raise exception using errcode='ZX001';
    exception when sqlstate 'ZX001' then null;
    end;
  end loop;
end; $$;

-- Each injected boundary failure runs the real wrapper, and its subtransaction
-- must restore grant, administrator, session and verified challenge together.
create trigger c3c2a_fail_session before insert on public.every8d_settings_sessions
for each row execute function c3c2a_proof.reject_session();
select c3c2a_proof.reject($q$select * from public.runtime_consume_every8d_settings_enrollment_challenge_v1(
  c3c2a_proof.hash('request-negative'),array[c3c2a_proof.alias(3)],c3c2a_proof.hash('session-negative'))$q$,
  '23514','failure after C3a grant/admin boundary');
drop trigger c3c2a_fail_session on public.every8d_settings_sessions;
create trigger c3c2a_fail_consume before update on public.every8d_settings_auth_challenges
for each row execute function c3c2a_proof.reject_consumption();
select c3c2a_proof.reject($q$select * from public.runtime_consume_every8d_settings_enrollment_challenge_v1(
  c3c2a_proof.hash('request-negative'),array[c3c2a_proof.alias(3)],c3c2a_proof.hash('session-negative'))$q$,
  '23514','failure after session before challenge');
drop trigger c3c2a_fail_consume on public.every8d_settings_auth_challenges;
select c3c2a_proof.reject($q$select * from public.runtime_consume_every8d_settings_enrollment_challenge_v1(
  c3c2a_proof.hash('request-negative'),array[c3c2a_proof.alias(3)],c3c2a_proof.hash('session-first'))$q$,
  '23505','session collision aborts entire consume');
select c3c2a_proof.assert_true((select consumed_at is null from public.every8d_settings_enrollment_grants
    where id=:'neg_grant_id') and not exists(select 1 from public.every8d_settings_administrators
    where enrollment_grant_id=:'neg_grant_id') and not exists(select 1 from public.every8d_settings_sessions
    where token_hash=c3c2a_proof.hash('session-negative'))
  and (select consumed_at is null and normalized_email is not null and verified_at is not null
    from public.every8d_settings_auth_challenges where id=:'neg_challenge_id'),
  'all three failure paths leave all four authority relations unchanged');

-- LOGIN: zero, one, two across installations; complete historical identity.
select c3c2a_proof.verified('login','unknown@example.invalid',c3c2a_proof.alias(4),'zero');
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_consume_every8d_settings_login_challenge_v1(
  c3c2a_proof.hash('request-zero'),array[c3c2a_proof.alias(4)],c3c2a_proof.hash('session-zero'))),'zero eligible');
select c3c2a_proof.verified('login','first@example.invalid',c3c2a_proof.alias(1),'one');
set local role service_role;
select c3c2a_proof.assert_true((select count(*)=1 and bool_and(expires_at-created_at=interval '1 hour')
  from public.runtime_consume_every8d_settings_login_challenge_v1(
  c3c2a_proof.hash('request-one'),array[c3c2a_proof.alias(1)],c3c2a_proof.hash('session-one'))),'exactly one eligible');
reset role;
select c3c2a_proof.enroll(:'p2_parent_id','first@example.invalid',5,'second-install');
select c3c2a_proof.verified('login','first@example.invalid',c3c2a_proof.alias(1),'multiple');
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_consume_every8d_settings_login_challenge_v1(
  c3c2a_proof.hash('request-multiple'),array[c3c2a_proof.alias(1),c3c2a_proof.alias(5)],
  c3c2a_proof.hash('session-multiple'))),'two eligible different installations');
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_consume_every8d_settings_login_challenge_v1(
  c3c2a_proof.hash('request-multiple'),array[c3c2a_proof.alias(1)],c3c2a_proof.hash('session-multiple'))),
  'missing historical alias cannot hide a candidate');
savepoint malformed_history;
alter table public.every8d_settings_administrators disable trigger protect_every8d_settings_administrator;
update public.every8d_settings_administrators set email_pseudonym='legacy-pseudonym'
where enrollment_grant_id=(select id from public.every8d_settings_enrollment_grants
  where token_hash=c3c2a_proof.hash('grant-second-install'));
alter table public.every8d_settings_administrators enable trigger protect_every8d_settings_administrator;
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_consume_every8d_settings_login_challenge_v1(
  c3c2a_proof.hash('request-multiple'),array[c3c2a_proof.alias(1),c3c2a_proof.alias(5)],
  c3c2a_proof.hash('session-multiple'))),'malformed persisted historical pseudonym fails closed');
rollback to malformed_history;

-- Authentication reads never touch or renew durable rows.
select md5(jsonb_agg(to_jsonb(s) order by s.id)::text) before_auth
from public.every8d_settings_sessions s \gset
select count(*) from public.runtime_authenticate_every8d_settings_session_v1(c3c2a_proof.hash('session-first'));
select c3c2a_proof.assert_true((select md5(jsonb_agg(to_jsonb(s) order by s.id)::text)=:'before_auth'
  from public.every8d_settings_sessions s),'authentication has no session mutation');
savepoint auth_rejection;
update public.every8d_settings_administrators set revoked_at=clock_timestamp(),revocation_reason='proof'
where id=:'first_administrator_id';
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_authenticate_every8d_settings_session_v1(
  c3c2a_proof.hash('session-first'))),'revoked administrator');
rollback to auth_rejection;
update public.ghl_marketplace_installations set status='disabled' where id=:'p1_parent_id';
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_authenticate_every8d_settings_session_v1(
  c3c2a_proof.hash('session-first'))),'disabled installation');
rollback to auth_rejection;
alter table public.ghl_marketplace_installations disable trigger protect_ghl_marketplace_installation;
update public.ghl_marketplace_installations set latest_lifecycle_version_id='unregistered.version'
where id=:'p1_parent_id';
alter table public.ghl_marketplace_installations enable trigger protect_ghl_marketplace_installation;
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_authenticate_every8d_settings_session_v1(
  c3c2a_proof.hash('session-first'))),'current version registration mismatch');
rollback to auth_rejection;
alter table public.ghl_marketplace_installations disable trigger protect_ghl_marketplace_installation;
update public.ghl_marketplace_installations set marketplace_app_id='unregistered-app' where id=:'p1_parent_id';
alter table public.ghl_marketplace_installations enable trigger protect_ghl_marketplace_installation;
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_authenticate_every8d_settings_session_v1(
  c3c2a_proof.hash('session-first'))),'current app registration mismatch');
rollback to auth_rejection;

-- LOGOUT preserves terminal evidence, including expired and non-logout rows.
set local role service_role;
select c3c2a_proof.assert_true(public.runtime_revoke_every8d_settings_session_v1(c3c2a_proof.hash('session-first')),
  'first logout returns true');
reset role;
select revoked_at,revocation_reason from public.every8d_settings_sessions
where token_hash=c3c2a_proof.hash('session-first') \gset logout_
select c3c2a_proof.assert_true(:'logout_revocation_reason'='logout','logout reason');
select c3c2a_proof.assert_true(public.runtime_revoke_every8d_settings_session_v1(c3c2a_proof.hash('session-first')),
  'repeated logout true');
select c3c2a_proof.assert_true((select revoked_at=:'logout_revoked_at'::timestamptz and revocation_reason='logout'
  from public.every8d_settings_sessions where token_hash=c3c2a_proof.hash('session-first')),'logout evidence preserved');
select c3c2a_proof.assert_true((select count(*)=0 from public.runtime_authenticate_every8d_settings_session_v1(
  c3c2a_proof.hash('session-first'))),'revoked session');
update public.every8d_settings_sessions set revoked_at=clock_timestamp(),revocation_reason='proof_existing'
where token_hash=c3c2a_proof.hash('session-recovery');
select c3c2a_proof.assert_true(public.runtime_revoke_every8d_settings_session_v1(c3c2a_proof.hash('session-recovery')),
  'non-logout revocation repeated success');
select c3c2a_proof.assert_true((select revocation_reason='proof_existing' from public.every8d_settings_sessions
where token_hash=c3c2a_proof.hash('session-recovery')),'preserve original non-logout evidence');

rollback;
\echo C3c-2a transactional structural/enrollment/login/auth/logout proof PASS
