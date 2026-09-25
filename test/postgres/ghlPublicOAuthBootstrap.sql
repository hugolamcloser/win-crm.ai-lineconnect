\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(value boolean, message text) returns void language plpgsql as $$
begin if value is not true then raise exception 'FAIL: %', message; end if; end $$;
create function pg_temp.reject(statement text, expected_state text, message text) returns void language plpgsql as $$
begin
  begin execute statement; raise exception 'FAIL: expected rejection for %', message;
  exception when others then
    if sqlstate = 'P0001' and position('FAIL:' in sqlerrm) = 1 then raise; end if;
    if sqlstate <> expected_state then raise exception 'FAIL: % returned %, expected %', message, sqlstate, expected_state; end if;
  end;
end $$;

insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id) values
 ('00000000-0000-4000-8000-000000000201','oauth-location-a','line-a','line-channel-a'),
 ('00000000-0000-4000-8000-000000000202','oauth-location-b','line-b','line-channel-b');
insert into public.ghl_marketplace_app_version_registrations values ('every8d_connect','oauth-version');

-- Owner registration is immutable and unavailable to every runtime/browser role.
select pg_temp.reject($q$update public.ghl_marketplace_app_version_registrations set marketplace_version_id='changed'$q$,
 '23514','owner version UPDATE rejected');
select pg_temp.reject($q$delete from public.ghl_marketplace_app_version_registrations$q$,
 '23514','owner version DELETE rejected');
select pg_temp.assert_true(not has_table_privilege('service_role','public.ghl_marketplace_app_version_registrations','SELECT')
 and not has_table_privilege('service_role','public.ghl_marketplace_app_version_registrations','INSERT')
 and not has_table_privilege('service_role','public.ghl_marketplace_app_version_registrations','UPDATE')
 and not has_table_privilege('service_role','public.ghl_marketplace_app_version_registrations','DELETE')
 and not has_table_privilege('anon','public.ghl_marketplace_app_version_registrations','SELECT')
 and not has_table_privilege('authenticated','public.ghl_marketplace_app_version_registrations','SELECT'),
 'owner version table has no runtime or browser DML');
select pg_temp.assert_true((select bool_and(
 not has_function_privilege('anon',p.oid,'EXECUTE')
 and not has_function_privilege('authenticated',p.oid,'EXECUTE')
 and has_function_privilege('service_role',p.oid,'EXECUTE'))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in (
  'apply_every8d_ghl_marketplace_lifecycle_v2','accept_every8d_public_oauth_callback_v1',
  'list_every8d_oauth_recoverable_v1','claim_every8d_oauth_exchange_v1',
  'fail_every8d_oauth_bootstrap_v1','finalize_every8d_oauth_exchange_v1',
  'get_every8d_oauth_bootstrap_status_v1'
 )) and not has_function_privilege('service_role',
 'public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)','EXECUTE'),
 'browser roles cannot execute feature RPCs and service role has only intended generation');

-- Callback first: durable evidence begins here and targets the next first INSTALL generation.
select pg_temp.assert_true((public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('1',64),repeat('a',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',
 convert_to('code-a','utf8'),'code-v1')->>'status')='waiting_install','callback creates waiting attempt');
select pg_temp.assert_true((select target_installation_generation=1 and expected_location_id='oauth-location-a'
 from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('1',64)),
 'first callback targets generation one at pinned Location');

-- Location B INSTALL/UNINSTALL, exact replay, and stale evidence have zero effect on Location A waiting attempt.
select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000202','oauth-location-b','company-b','oauth-provider','oauth-version',
 '2026-09-23T12:00:00Z','install-b');
select pg_temp.assert_true((select status='waiting_install' from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('1',64)),
 'Location B INSTALL cannot claim or change Location A waiting attempt');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('UNINSTALL','oauth-app','oauth-client',null,
 'oauth-location-b',null,'oauth-provider','oauth-version','2026-09-23T12:10:00Z','uninstall-b');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('UNINSTALL','oauth-app','oauth-client',null,
 'oauth-location-b',null,'oauth-provider','oauth-version','2026-09-23T12:10:00Z','uninstall-b');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000202','oauth-location-b','company-b','oauth-provider','oauth-version',
 '2026-09-23T12:05:00Z','stale-b');
select pg_temp.assert_true((select status='waiting_install' and authorization_code_ciphertext is not null
 from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('1',64)),
 'Location B uninstall replay/stale evidence cannot fail or scrub Location A waiting attempt');

-- Exact Location A INSTALL claims the exact target generation.
select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000201','oauth-location-a','company-a','oauth-provider','oauth-version',
 '2026-09-23T12:20:00Z','install-a');
select pg_temp.assert_true((select status='ready' and claimed_installation_generation=1
 from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('1',64)),
 'Location A INSTALL claims exact generation one');

-- A newer legitimate callback supersedes ready evidence atomically; replay cannot replace ciphertext.
select pg_temp.assert_true((public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('2',64),repeat('b',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',
 convert_to('code-new','utf8'),'code-v1')->>'status')='ready','new callback supersedes ready candidate');
select pg_temp.assert_true((select status='failed' and failure_class='callback_superseded'
 and authorization_code_ciphertext is null from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('1',64)),
 'superseded code is atomically scrubbed');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('2',64),repeat('b',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',
 convert_to('replacement','utf8'),'code-v1') is null,'same-state callback replay loses');
select pg_temp.assert_true((select convert_from(authorization_code_ciphertext,'utf8')='code-new'
 from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('2',64)),
 'callback replay cannot replace ciphertext');

select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000202','oauth-location-b','company-b','oauth-provider','oauth-version',
 '2026-09-23T12:30:00Z','reinstall-b');
select pg_temp.assert_true((select status='ready' from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('2',64)),
 'Location B INSTALL cannot change Location A ready attempt');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('UNINSTALL','oauth-app','oauth-client',null,
 'oauth-location-b',null,'oauth-provider','oauth-version','2026-09-23T12:40:00Z','uninstall-b2');
select pg_temp.assert_true((select status='ready' and authorization_code_ciphertext is not null
 from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('2',64)),
 'Location B UNINSTALL cannot fail or scrub Location A ready attempt');
select pg_temp.assert_true(public.claim_every8d_oauth_exchange_v1(
 (select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('2',64)),
 'oauth-version',repeat('f',64)) is not null,'ready to exchanging has one winner');
select pg_temp.assert_true(public.claim_every8d_oauth_exchange_v1(
 (select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('2',64)),
 'oauth-version',repeat('f',64)) is null,'second exchange claimant loses');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000202','oauth-location-b','company-b','oauth-provider','oauth-version',
 '2026-09-23T12:50:00Z','reinstall-b2');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('UNINSTALL','oauth-app','oauth-client',null,
 'oauth-location-b',null,'oauth-provider','oauth-version','2026-09-23T13:00:00Z','uninstall-b3');
select pg_temp.assert_true((select status='exchanging' and authorization_code_ciphertext is not null
 from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('2',64)),
 'Location B UNINSTALL cannot fail or scrub Location A exchanging attempt');

-- Exact A UNINSTALL invalidates only pre-UNINSTALL generation one.
select public.apply_every8d_ghl_marketplace_lifecycle_v2('UNINSTALL','oauth-app','oauth-client',null,
 'oauth-location-a',null,'oauth-provider','oauth-version','2026-09-23T13:10:00Z','uninstall-a');
select pg_temp.assert_true((select status='failed' and failure_class='lifecycle_invalidated'
 and authorization_code_ciphertext is null from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('2',64)),
 'exact Location and invalidated generation scope UNINSTALL');

-- After uninstall generation two, callback deterministically targets reinstall generation three.
select pg_temp.assert_true((public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('3',64),repeat('c',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',
 convert_to('code-reinstall','utf8'),'code-v1')->>'targetInstallationGeneration')='3',
 'uninstalled lifecycle targets only next reinstall generation');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000201','oauth-location-a','company-a','oauth-provider','oauth-version',
 '2026-09-23T13:20:00Z','reinstall-a');
select pg_temp.assert_true((select status='ready' and claimed_installation_generation=3
 from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('3',64)),
 'reinstall rendezvous binds only generation three');

-- Required NULL inputs fail closed at the SECURITY DEFINER boundary with zero mutation.
select id as gen3_id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('3',64) \gset
create temp table oauth_invalid_input_snapshot as
 select jsonb_agg(to_jsonb(b) order by b.id) as attempts
 from public.ghl_marketplace_oauth_bootstraps b;
set local role service_role;
select pg_temp.reject($q$select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 null,'oauth-app','oauth-client','00000000-0000-4000-8000-000000000201','oauth-location-a',
 'company-a','oauth-provider','oauth-version','2026-09-23T14:00:00Z','null-event-type')$q$,
 '23514','NULL lifecycle event type');
select pg_temp.reject($q$select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL',null,'oauth-client','00000000-0000-4000-8000-000000000201','oauth-location-a',
 'company-a','oauth-provider','oauth-version','2026-09-23T14:00:00Z','null-app')$q$,
 '23514','NULL lifecycle Marketplace app ID');
select pg_temp.reject($q$select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app',null,'00000000-0000-4000-8000-000000000201','oauth-location-a',
 'company-a','oauth-provider','oauth-version','2026-09-23T14:00:00Z','null-client')$q$,
 '23514','NULL lifecycle OAuth client ID');
select pg_temp.reject($q$select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000201',null,
 'company-a','oauth-provider','oauth-version','2026-09-23T14:00:00Z','null-location')$q$,
 '23514','NULL lifecycle Location ID');
select pg_temp.reject($q$select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000201','oauth-location-a',
 'company-a',null,'oauth-version','2026-09-23T14:00:00Z','null-provider')$q$,
 '23514','NULL lifecycle Conversation Provider ID');
select pg_temp.reject($q$select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000201','oauth-location-a',
 'company-a','oauth-provider',null,'2026-09-23T14:00:00Z','null-version')$q$,
 '23514','NULL lifecycle Marketplace version ID');
select pg_temp.reject($q$select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000201','oauth-location-a',
 'company-a','oauth-provider','oauth-version',null,'null-event-time')$q$,
 '23514','NULL lifecycle event timestamp');
select pg_temp.reject($q$select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000201','oauth-location-a',
 'company-a','oauth-provider','oauth-version','2026-09-23T14:00:00Z',null)$q$,
 '23514','NULL lifecycle event ID');
select pg_temp.reject($q$select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client',null,'oauth-location-a','company-a','oauth-provider',
 'oauth-version','2026-09-23T14:00:00Z','null-tenant')$q$,
 '23514','NULL INSTALL tenant ID');
select pg_temp.reject($q$select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000201','oauth-location-a',
 null,'oauth-provider','oauth-version','2026-09-23T14:00:00Z','null-company')$q$,
 '23514','NULL INSTALL company ID');
reset role;
select pg_temp.assert_true(
 (select count(*)=2 from public.ghl_marketplace_installations
  where location_id in ('oauth-location-a','oauth-location-b'))
 and (select count(*)=3 from public.ghl_marketplace_oauth_bootstraps)
 and (select latest_lifecycle_event_id='reinstall-a' and installation_generation=3
      from public.ghl_marketplace_installations where location_id='oauth-location-a'),
 'invalid lifecycle NULL inputs perform zero installation or bootstrap mutation');

set local role service_role;
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 null,'oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('8',64),repeat('9',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',convert_to('code','utf8'),'code-v1') is null,'NULL callback app ID');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app',null,'oauth-provider','oauth-version','oauth-location-a',repeat('8',64),repeat('9',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',convert_to('code','utf8'),'code-v1') is null,'NULL callback OAuth client ID');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client',null,'oauth-version','oauth-location-a',repeat('8',64),repeat('9',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',convert_to('code','utf8'),'code-v1') is null,'NULL callback provider ID');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider',null,'oauth-location-a',repeat('8',64),repeat('9',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',convert_to('code','utf8'),'code-v1') is null,'NULL callback version');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version',null,repeat('8',64),repeat('9',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',convert_to('code','utf8'),'code-v1') is null,'NULL callback Location');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',null,repeat('9',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',convert_to('code','utf8'),'code-v1') is null,'NULL callback state hash');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('8',64),null,
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',convert_to('code','utf8'),'code-v1') is null,'NULL callback binding hash');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('8',64),repeat('9',64),
 null,repeat('f',64),clock_timestamp()+interval '10 minutes',convert_to('code','utf8'),'code-v1') is null,'NULL callback redirect URI');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('8',64),repeat('9',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',null,clock_timestamp()+interval '10 minutes',convert_to('code','utf8'),'code-v1') is null,'NULL callback fingerprint');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('8',64),repeat('9',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),null,convert_to('code','utf8'),'code-v1') is null,'NULL callback expiry');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('8',64),repeat('9',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',null,'code-v1') is null,'NULL callback ciphertext');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('8',64),repeat('9',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',convert_to('code','utf8'),null) is null,'NULL callback key version');
reset role;
select pg_temp.assert_true((select count(*)=3 from public.ghl_marketplace_oauth_bootstraps),
 'invalid callback inputs create no durable attempts');

set local role service_role;
select pg_temp.assert_true(public.claim_every8d_oauth_exchange_v1(null,'oauth-version',repeat('f',64)) is null,
 'NULL exchange bootstrap ID');
select pg_temp.assert_true(public.claim_every8d_oauth_exchange_v1(
 :'gen3_id'::uuid,null,repeat('f',64)) is null,
 'NULL exchange version');
select pg_temp.assert_true(public.claim_every8d_oauth_exchange_v1(
 :'gen3_id'::uuid,'oauth-version',null) is null,
 'NULL exchange fingerprint');
select pg_temp.assert_true((select count(*)=0 from public.list_every8d_oauth_recoverable_v1(
 null,repeat('f',64),8)),'NULL recovery version');
select pg_temp.assert_true((select count(*)=0 from public.list_every8d_oauth_recoverable_v1(
 'oauth-version',null,8)),'NULL recovery fingerprint');
select pg_temp.assert_true(not public.fail_every8d_oauth_bootstrap_v1(null,'configuration_drift'),
 'NULL failure bootstrap ID');
select pg_temp.assert_true(not public.fail_every8d_oauth_bootstrap_v1(:'gen3_id'::uuid,null),
 'NULL failure class');
reset role;
select pg_temp.assert_true(
 (select status='ready' from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('3',64))
 and (select attempts=(select jsonb_agg(to_jsonb(b) order by b.id)
                       from public.ghl_marketplace_oauth_bootstraps b)
      from oauth_invalid_input_snapshot),
 'invalid exchange/recovery identity/failure inputs perform zero state movement or cleanup');

-- Recovery-limit proof uses a truly expired progressing attempt. Create it through the
-- production callback boundary, then reconstruct only its timestamps as the test owner;
-- the immutable bootstrap trigger remains enabled and validates the replacement INSERT.
set local role service_role;
select pg_temp.assert_true((public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-recovery-canary',
 repeat('6',64),repeat('7',64),'https://oauth.example.invalid/oauth/every8d-connect/callback',
 repeat('f',64),clock_timestamp()+interval '10 minutes',
 convert_to('recovery-limit-canary','utf8'),'code-v1')->>'status')='waiting_install',
 'recovery-limit canary starts through production callback as waiting_install');
reset role;
select id as recovery_limit_canary_id from public.ghl_marketplace_oauth_bootstraps
 where state_hash=repeat('6',64) \gset
with canary as (
 delete from public.ghl_marketplace_oauth_bootstraps
 where id=:'recovery_limit_canary_id'::uuid
 returning *
)
insert into public.ghl_marketplace_oauth_bootstraps (
 id,app_namespace,marketplace_version_id,expected_location_id,target_installation_generation,
 state_hash,browser_binding_hash,redirect_uri,config_fingerprint,status,created_at,expires_at,
 callback_received_at,authorization_code_ciphertext,authorization_code_key_version,
 claimed_installation_id,claimed_installation_generation,exchange_started_at,terminal_at,failure_class
)
select id,app_namespace,marketplace_version_id,expected_location_id,target_installation_generation,
 state_hash,browser_binding_hash,redirect_uri,config_fingerprint,status,
 clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '5 minutes',
 clock_timestamp()-interval '10 minutes',authorization_code_ciphertext,authorization_code_key_version,
 claimed_installation_id,claimed_installation_generation,exchange_started_at,terminal_at,failure_class
from canary;
select pg_temp.assert_true((select status='waiting_install'
 and expires_at <= clock_timestamp()
 and authorization_code_ciphertext is not null
 and authorization_code_key_version is not null
 and exchange_started_at is null and terminal_at is null and failure_class is null
 from public.ghl_marketplace_oauth_bootstraps where id=:'recovery_limit_canary_id'::uuid),
 'recovery-limit canary satisfies the production expired-progressing cleanup predicate');

create temp table oauth_recovery_limit_snapshot as
 select id,status,failure_class,authorization_code_ciphertext,authorization_code_key_version,
        exchange_started_at,terminal_at,expires_at
 from public.ghl_marketplace_oauth_bootstraps where id=:'recovery_limit_canary_id'::uuid;
create temp table oauth_recovery_limit_all_attempts_snapshot as
 select jsonb_agg(to_jsonb(b) order by b.id) as attempts
 from public.ghl_marketplace_oauth_bootstraps b;
create temp table oauth_recovery_limit_other_attempts_snapshot as
 select jsonb_agg(to_jsonb(b) order by b.id) as attempts
 from public.ghl_marketplace_oauth_bootstraps b
 where b.id<>:'recovery_limit_canary_id'::uuid;
create function pg_temp.assert_recovery_limit_unchanged(message text) returns void language plpgsql as $$
begin
 perform pg_temp.assert_true(
  (select row(b.id,b.status,b.failure_class,b.authorization_code_ciphertext,
              b.authorization_code_key_version,b.exchange_started_at,b.terminal_at,b.expires_at)
          is not distinct from
          row(s.id,s.status,s.failure_class,s.authorization_code_ciphertext,
              s.authorization_code_key_version,s.exchange_started_at,s.terminal_at,s.expires_at)
   from public.ghl_marketplace_oauth_bootstraps b
   cross join pg_temp.oauth_recovery_limit_snapshot s
   where b.id=s.id)
  and (select s.attempts=(select jsonb_agg(to_jsonb(b) order by b.id)
                          from public.ghl_marketplace_oauth_bootstraps b)
       from pg_temp.oauth_recovery_limit_all_attempts_snapshot s),
  message);
end $$;

set local role service_role;
select pg_temp.assert_true((select count(*)=0 from public.list_every8d_oauth_recoverable_v1(
 'oauth-version',repeat('f',64),null)),'NULL recovery limit');
reset role;
select pg_temp.assert_recovery_limit_unchanged('NULL recovery limit performs zero cleanup or unrelated mutation');
set local role service_role;
select pg_temp.assert_true((select count(*)=0 from public.list_every8d_oauth_recoverable_v1(
 'oauth-version',repeat('f',64),0)),'zero recovery limit');
reset role;
select pg_temp.assert_recovery_limit_unchanged('zero recovery limit performs zero cleanup or unrelated mutation');
set local role service_role;
select pg_temp.assert_true((select count(*)=0 from public.list_every8d_oauth_recoverable_v1(
 'oauth-version',repeat('f',64),-1)),'negative recovery limit');
reset role;
select pg_temp.assert_recovery_limit_unchanged('negative recovery limit performs zero cleanup or unrelated mutation');
set local role service_role;
select pg_temp.assert_true((select count(*)=0 from public.list_every8d_oauth_recoverable_v1(
 'oauth-version',repeat('f',64),17)),'recovery limit above maximum');
reset role;
select pg_temp.assert_recovery_limit_unchanged('above-maximum recovery limit performs zero cleanup or unrelated mutation');

-- Positive control: the same RPC with a valid limit must clean the same canary.
set local role service_role;
select pg_temp.assert_true((select array_agg(id order by id)=array[:'gen3_id'::uuid]
 from public.list_every8d_oauth_recoverable_v1(
  'oauth-version',repeat('f',64),8) as recovered(id)),
 'valid recovery limit returns the existing unexpired ready attempt');
reset role;
select pg_temp.assert_true(
 (select b.id=s.id and b.status='failed' and b.failure_class='bootstrap_expired'
   and b.authorization_code_ciphertext is null and b.authorization_code_key_version is null
   and b.exchange_started_at is null and b.terminal_at is not null
   and s.status='waiting_install' and s.failure_class is null
   and s.authorization_code_ciphertext is not null and s.authorization_code_key_version is not null
   and s.terminal_at is null and b.expires_at=s.expires_at
  from public.ghl_marketplace_oauth_bootstraps b
  cross join oauth_recovery_limit_snapshot s where b.id=s.id)
 and (select s.attempts=(select jsonb_agg(to_jsonb(b) order by b.id)
                         from public.ghl_marketplace_oauth_bootstraps b
                         where b.id<>:'recovery_limit_canary_id'::uuid)
      from oauth_recovery_limit_other_attempts_snapshot s),
 'valid recovery limit terminalizes and scrubs only the expired canary');

-- A deterministic failure permits a fresh authenticated state/code in the same generation.
set local role service_role;
select pg_temp.assert_true(public.claim_every8d_oauth_exchange_v1(
 :'gen3_id'::uuid,
 'oauth-version',repeat('f',64)) is not null,'deterministic fixture claimed');
select pg_temp.assert_true(public.fail_every8d_oauth_bootstrap_v1(
 :'gen3_id'::uuid,
 'invalid_grant'),'deterministic invalid_grant recorded');
select pg_temp.assert_true((public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('4',64),repeat('d',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',
 convert_to('fresh-code','utf8'),'code-v1')->>'status')='ready','fresh code admitted after deterministic failure');
reset role;
select id as gen4_id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('4',64) \gset
set local role service_role;
select pg_temp.assert_true(public.claim_every8d_oauth_exchange_v1(
 :'gen4_id'::uuid,
 'oauth-version',repeat('f',64)) is not null,'fresh deterministic-recovery code claimed');
reset role;

-- Invalid finalization arguments leave the exchanging attempt and installation credentials unchanged.
set local role service_role;
select pg_temp.assert_true(not public.finalize_every8d_oauth_exchange_v1(null,'oauth-version',repeat('f',64),convert_to('a','utf8'),convert_to('r','utf8'),'token-v1',clock_timestamp()+interval '1 hour',array['locations.readonly']),'NULL finalize bootstrap ID');
select pg_temp.assert_true(not public.finalize_every8d_oauth_exchange_v1(:'gen4_id'::uuid,null,repeat('f',64),convert_to('a','utf8'),convert_to('r','utf8'),'token-v1',clock_timestamp()+interval '1 hour',array['locations.readonly']),'NULL finalize version');
select pg_temp.assert_true(not public.finalize_every8d_oauth_exchange_v1(:'gen4_id'::uuid,'oauth-version',null,convert_to('a','utf8'),convert_to('r','utf8'),'token-v1',clock_timestamp()+interval '1 hour',array['locations.readonly']),'NULL finalize fingerprint');
select pg_temp.assert_true(not public.finalize_every8d_oauth_exchange_v1(:'gen4_id'::uuid,'oauth-version',repeat('f',64),null,convert_to('r','utf8'),'token-v1',clock_timestamp()+interval '1 hour',array['locations.readonly']),'NULL access ciphertext');
select pg_temp.assert_true(not public.finalize_every8d_oauth_exchange_v1(:'gen4_id'::uuid,'oauth-version',repeat('f',64),convert_to('a','utf8'),null,'token-v1',clock_timestamp()+interval '1 hour',array['locations.readonly']),'NULL refresh ciphertext');
select pg_temp.assert_true(not public.finalize_every8d_oauth_exchange_v1(:'gen4_id'::uuid,'oauth-version',repeat('f',64),convert_to('a','utf8'),convert_to('r','utf8'),null,clock_timestamp()+interval '1 hour',array['locations.readonly']),'NULL encryption key version');
select pg_temp.assert_true(not public.finalize_every8d_oauth_exchange_v1(:'gen4_id'::uuid,'oauth-version',repeat('f',64),convert_to('a','utf8'),convert_to('r','utf8'),'token-v1',null,array['locations.readonly']),'NULL token expiry');
select pg_temp.assert_true(not public.finalize_every8d_oauth_exchange_v1(:'gen4_id'::uuid,'oauth-version',repeat('f',64),convert_to('a','utf8'),convert_to('r','utf8'),'token-v1','infinity'::timestamptz,array['locations.readonly']),'non-finite token expiry');
select pg_temp.assert_true(not public.finalize_every8d_oauth_exchange_v1(:'gen4_id'::uuid,'oauth-version',repeat('f',64),convert_to('a','utf8'),convert_to('r','utf8'),'token-v1',clock_timestamp()-interval '1 second',array['locations.readonly']),'past token expiry');
select pg_temp.assert_true(not public.finalize_every8d_oauth_exchange_v1(:'gen4_id'::uuid,'oauth-version',repeat('f',64),convert_to('a','utf8'),convert_to('r','utf8'),'token-v1',clock_timestamp()+interval '1 hour',null),'NULL scopes');
select pg_temp.assert_true(not public.finalize_every8d_oauth_exchange_v1(:'gen4_id'::uuid,'oauth-version',repeat('f',64),convert_to('a','utf8'),convert_to('r','utf8'),'token-v1',clock_timestamp()+interval '1 hour',array['locations.readonly',null]::text[]),'NULL scope member');
select pg_temp.assert_true(not public.finalize_every8d_oauth_exchange_v1(:'gen4_id'::uuid,'oauth-version',repeat('f',64),convert_to('a','utf8'),convert_to('r','utf8'),'token-v1',clock_timestamp()+interval '1 hour',array[' ']),'blank scope member');
reset role;
select pg_temp.assert_true((select status='exchanging' and authorization_code_ciphertext is not null
 from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('4',64))
 and (select access_token_ciphertext is null and refresh_token_ciphertext is null
 from public.ghl_marketplace_installations where location_id='oauth-location-a'),
 'invalid finalization performs zero credential or attempt mutation');

-- Ambiguous exchange evidence burns the generation and rejects a fresh callback.
set local role service_role;
select pg_temp.assert_true(public.fail_every8d_oauth_bootstrap_v1(
 :'gen4_id'::uuid,
 'exchange_outcome_unknown'),'ambiguous outcome recorded');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','oauth-version','oauth-location-a',repeat('5',64),repeat('e',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),clock_timestamp()+interval '10 minutes',
 convert_to('must-not-admit','utf8'),'code-v1') is null,'ambiguous generation rejects fresh callback');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('5',64)),
 'ambiguous generation rejection creates no attempt');

select pg_temp.assert_true(not has_table_privilege('service_role','public.ghl_marketplace_oauth_bootstraps','SELECT')
 and not has_table_privilege('service_role','public.ghl_marketplace_oauth_bootstraps','INSERT')
 and not has_table_privilege('service_role','public.ghl_marketplace_oauth_bootstraps','UPDATE')
 and not has_table_privilege('service_role','public.ghl_marketplace_oauth_bootstraps','DELETE')
 and not has_table_privilege('anon','public.ghl_marketplace_oauth_bootstraps','SELECT')
 and not has_table_privilege('authenticated','public.ghl_marketplace_oauth_bootstraps','SELECT'),
 'attempt table has no direct runtime or browser access');
rollback;
\echo 'Public OAuth callback/rendezvous PostgreSQL proof passed'
