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
insert into public.ghl_marketplace_app_registrations(
 app_namespace,marketplace_app_id,oauth_client_id,conversation_provider_id,channel,provider
) values ('every8d_connect','oauth-app','oauth-client','oauth-provider','sms','every8d');
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

select pg_temp.assert_true(not has_table_privilege('service_role','public.ghl_marketplace_oauth_bootstraps','SELECT')
 and not has_table_privilege('service_role','public.ghl_marketplace_oauth_bootstraps','INSERT')
 and not has_table_privilege('service_role','public.ghl_marketplace_oauth_bootstraps','UPDATE')
 and not has_table_privilege('service_role','public.ghl_marketplace_oauth_bootstraps','DELETE')
 and not has_table_privilege('anon','public.ghl_marketplace_oauth_bootstraps','SELECT')
 and not has_table_privilege('authenticated','public.ghl_marketplace_oauth_bootstraps','SELECT'),
 'attempt table has no direct runtime or browser access');
rollback;
\echo 'Public OAuth callback/rendezvous PostgreSQL proof passed'
