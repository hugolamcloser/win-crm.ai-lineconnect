\set ON_ERROR_STOP on
begin;

create function pg_temp.assert_true(value boolean, message text)
returns void language plpgsql as $$
begin
  if value is not true then raise exception 'FAIL: %', message; end if;
end;
$$;

create function pg_temp.reject(statement text, expected_state text, message text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
    raise exception 'FAIL: expected rejection for %', message;
  exception when others then
    if sqlstate = 'P0001' and position('FAIL:' in sqlerrm) = 1 then raise; end if;
    if sqlstate <> expected_state then
      raise exception 'FAIL: % returned %, expected %', message, sqlstate, expected_state;
    end if;
  end;
end;
$$;

insert into public.tenants(id, location_id, ghl_provider_id, line_channel_id) values
  ('00000000-0000-4000-8000-000000000201', 'oauth-location-a', 'line-provider-a', 'line-channel-a'),
  ('00000000-0000-4000-8000-000000000202', 'oauth-location-b', 'line-provider-b', 'line-channel-b');
insert into public.ghl_marketplace_app_registrations(
  app_namespace, marketplace_app_id, oauth_client_id, conversation_provider_id, channel, provider
) values ('every8d_connect', 'oauth-app', 'oauth-client', 'oauth-provider', 'sms', 'every8d');

-- Owner-only future rollout gate. The migration itself inserts no version.
insert into public.ghl_marketplace_app_version_registrations(app_namespace, marketplace_version_id)
values ('every8d_connect', 'oauth-version');

set local role service_role;
select pg_temp.reject($q$select * from public.ghl_marketplace_app_version_registrations$q$, '42501',
  'service role cannot read approved version ownership');
select pg_temp.reject($q$insert into public.ghl_marketplace_app_version_registrations
  values ('every8d_connect', 'invented-version')$q$,
  '42501', 'service role cannot invent version ownership');
reset role;
select pg_temp.reject($q$update public.ghl_marketplace_app_version_registrations
  set marketplace_version_id = 'changed-version'$q$, '23514', 'approved version is immutable');

-- INSTALL -> callback.
select * from public.create_every8d_public_oauth_bootstrap_v1(
  'oauth-app', 'oauth-client', 'oauth-provider', 'oauth-version', repeat('1',64), repeat('a',64),
  'https://oauth.example.invalid/oauth/every8d-connect/callback', repeat('f',64), 600
);
select pg_temp.reject($q$select * from public.create_every8d_public_oauth_bootstrap_v1(
  'oauth-app', 'oauth-client', 'oauth-provider', 'oauth-version', repeat('2',64), repeat('b',64),
  'https://oauth.example.invalid/oauth/every8d-connect/callback', repeat('f',64), 600)$q$,
  'P0001', 'per-context active bootstrap cap is atomic');

select pg_temp.assert_true(
  (public.apply_every8d_ghl_marketplace_lifecycle_v2(
    'INSTALL', 'oauth-app', 'oauth-client', '00000000-0000-4000-8000-000000000201',
    'oauth-location-a', 'oauth-company', 'oauth-provider', 'oauth-version',
    '2026-09-23T12:00:00Z', 'install-a')->>'outcome') = 'applied',
  'INSTALL is newly applied');
select pg_temp.assert_true((select claimed_installation_id is not null
  and claimed_installation_generation = 1 and status = 'awaiting_callback'
  from public.ghl_marketplace_oauth_bootstraps where state_hash = repeat('1',64)),
  'INSTALL-first claims exact generation while awaiting callback');

select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
  (select id from public.ghl_marketplace_oauth_bootstraps where state_hash = repeat('1',64)),
  repeat('1',64), repeat('a',64),
  'https://oauth.example.invalid/oauth/every8d-connect/callback', repeat('f',64),
  convert_to('encrypted-code-a','utf8'), 'code-v1') = 'ready',
  'INSTALL-first callback converges to ready');
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
  (select id from public.ghl_marketplace_oauth_bootstraps where state_hash = repeat('1',64)),
  repeat('1',64), repeat('a',64),
  'https://oauth.example.invalid/oauth/every8d-connect/callback', repeat('f',64),
  convert_to('duplicate-code','utf8'), 'code-v1') is null,
  'duplicate callback cannot replace accepted code');

select pg_temp.assert_true(public.claim_every8d_oauth_exchange_v1(
  (select id from public.ghl_marketplace_oauth_bootstraps where state_hash = repeat('1',64)),
  'oauth-version', repeat('f',64)) is not null,
  'ready exchange has one claimant');
select pg_temp.assert_true(public.claim_every8d_oauth_exchange_v1(
  (select id from public.ghl_marketplace_oauth_bootstraps where state_hash = repeat('1',64)),
  'oauth-version', repeat('f',64)) is null,
  'second exchange claimant loses');
select pg_temp.assert_true(public.finalize_every8d_oauth_exchange_v1(
  (select id from public.ghl_marketplace_oauth_bootstraps where state_hash = repeat('1',64)),
  'oauth-version', repeat('f',64), convert_to('encrypted-access','utf8'),
  convert_to('encrypted-refresh','utf8'), 'token-v1', clock_timestamp() + interval '1 hour',
  array['locations.readonly']), 'credential persistence and attempt success commit atomically');
select pg_temp.assert_true((select status = 'succeeded' and authorization_code_ciphertext is null
  and authorization_code_key_version is null from public.ghl_marketplace_oauth_bootstraps
  where state_hash = repeat('1',64)), 'terminal success scrubs authorization code');

-- callback -> INSTALL, replay/stale discrimination, and ready invalidation.
select * from public.create_every8d_public_oauth_bootstrap_v1(
  'oauth-app', 'oauth-client', 'oauth-provider', 'oauth-version', repeat('2',64), repeat('b',64),
  'https://oauth.example.invalid/oauth/every8d-connect/callback', repeat('f',64), 600
);
select pg_temp.assert_true(public.accept_every8d_public_oauth_callback_v1(
  (select id from public.ghl_marketplace_oauth_bootstraps where state_hash = repeat('2',64)),
  repeat('2',64), repeat('b',64),
  'https://oauth.example.invalid/oauth/every8d-connect/callback', repeat('f',64),
  convert_to('encrypted-code-b','utf8'), 'code-v1') = 'waiting_install',
  'callback-first waits durably for INSTALL');
select pg_temp.assert_true(
  (public.apply_every8d_ghl_marketplace_lifecycle_v2(
    'INSTALL', 'oauth-app', 'oauth-client', '00000000-0000-4000-8000-000000000202',
    'oauth-location-b', 'oauth-company', 'oauth-provider', 'oauth-version',
    '2026-09-23T13:00:00Z', 'install-b')->>'outcome') = 'applied'
  and (select status = 'ready' from public.ghl_marketplace_oauth_bootstraps
    where state_hash = repeat('2',64)), 'callback-first INSTALL converges to ready');
select pg_temp.assert_true(
  (public.apply_every8d_ghl_marketplace_lifecycle_v2(
    'INSTALL', 'oauth-app', 'oauth-client', '00000000-0000-4000-8000-000000000202',
    'oauth-location-b', 'oauth-company', 'oauth-provider', 'oauth-version',
    '2026-09-23T13:00:00Z', 'install-b')->>'outcome') = 'exact_replay'
  and (select status = 'ready' from public.ghl_marketplace_oauth_bootstraps
    where state_hash = repeat('2',64)), 'exact INSTALL replay does not duplicate rendezvous');
select pg_temp.assert_true(
  (public.apply_every8d_ghl_marketplace_lifecycle_v2(
    'UNINSTALL', 'oauth-app', 'oauth-client', null, 'oauth-location-b', null,
    'oauth-provider', 'oauth-version', '2026-09-23T12:59:00Z', 'stale-uninstall')->>'outcome')
      = 'stale_ignored'
  and (select status = 'ready' from public.ghl_marketplace_oauth_bootstraps
    where state_hash = repeat('2',64)), 'stale lifecycle event causes zero bootstrap mutation');
select pg_temp.reject($q$select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'UNINSTALL', 'oauth-app', 'oauth-client', null, 'oauth-location-b', null,
  'oauth-provider', 'oauth-version', '2026-09-23T13:00:00Z', 'equal-conflict')$q$,
  '23514', 'equal-time lifecycle conflict fails closed');

select pg_temp.assert_true(
  (public.apply_every8d_ghl_marketplace_lifecycle_v2(
    'UNINSTALL', 'oauth-app', 'oauth-client', null, 'oauth-location-b', null,
    'oauth-provider', 'oauth-version', '2026-09-23T13:10:00Z', 'uninstall-b')->>'outcome') = 'applied'
  and (select status = 'failed' and failure_class = 'lifecycle_invalidated'
    and authorization_code_ciphertext is null from public.ghl_marketplace_oauth_bootstraps
    where state_hash = repeat('2',64)), 'UNINSTALL invalidates ready attempt and scrubs code');

-- Reinstall generation isolation; stale exact UNINSTALL cannot revoke the later attempt.
select * from public.create_every8d_public_oauth_bootstrap_v1(
  'oauth-app', 'oauth-client', 'oauth-provider', 'oauth-version', repeat('3',64), repeat('c',64),
  'https://oauth.example.invalid/oauth/every8d-connect/callback', repeat('f',64), 600
);
select pg_temp.assert_true(
  (public.apply_every8d_ghl_marketplace_lifecycle_v2(
    'INSTALL', 'oauth-app', 'oauth-client', '00000000-0000-4000-8000-000000000202',
    'oauth-location-b', 'oauth-company', 'oauth-provider', 'oauth-version',
    '2026-09-23T13:20:00Z', 'reinstall-b')->>'outcome') = 'applied'
  and (select claimed_installation_generation = 3 and status = 'awaiting_callback'
    from public.ghl_marketplace_oauth_bootstraps where state_hash = repeat('3',64)),
  'reinstall creates and claims a new isolated generation');
select pg_temp.assert_true(
  (public.apply_every8d_ghl_marketplace_lifecycle_v2(
    'UNINSTALL', 'oauth-app', 'oauth-client', null, 'oauth-location-b', null,
    'oauth-provider', 'oauth-version', '2026-09-23T13:10:00Z', 'uninstall-b')->>'outcome')
      = 'stale_ignored'
  and (select status = 'awaiting_callback' from public.ghl_marketplace_oauth_bootstraps
    where state_hash = repeat('3',64)), 'old UNINSTALL replay cannot revoke new generation');
select pg_temp.assert_true(
  (public.apply_every8d_ghl_marketplace_lifecycle_v2(
    'UNINSTALL', 'oauth-app', 'oauth-client', null, 'oauth-location-b', null,
    'oauth-provider', 'oauth-version', '2026-09-23T13:30:00Z', 'uninstall-c')->>'outcome') = 'applied'
  and (select status = 'failed' from public.ghl_marketplace_oauth_bootstraps
    where state_hash = repeat('3',64)), 'UNINSTALL before callback invalidates claimed attempt');

-- Callback stored without INSTALL is also invalidated; old ciphertext cannot migrate.
select * from public.create_every8d_public_oauth_bootstrap_v1(
  'oauth-app', 'oauth-client', 'oauth-provider', 'oauth-version', repeat('4',64), repeat('d',64),
  'https://oauth.example.invalid/oauth/every8d-connect/callback', repeat('f',64), 600
);
select public.accept_every8d_public_oauth_callback_v1(
  (select id from public.ghl_marketplace_oauth_bootstraps where state_hash = repeat('4',64)),
  repeat('4',64), repeat('d',64),
  'https://oauth.example.invalid/oauth/every8d-connect/callback', repeat('f',64),
  convert_to('encrypted-code-d','utf8'), 'code-v1');
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'UNINSTALL', 'oauth-app', 'oauth-client', null, 'oauth-location-b', null,
  'oauth-provider', 'oauth-version', '2026-09-23T13:40:00Z', 'uninstall-d');
select pg_temp.assert_true((select status = 'failed' and authorization_code_ciphertext is null
  from public.ghl_marketplace_oauth_bootstraps where state_hash = repeat('4',64)),
  'UNINSTALL after code storage invalidates unclaimed waiting attempt');

-- Exact version and privilege boundaries.
select pg_temp.reject($q$select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'INSTALL', 'oauth-app', 'oauth-client', '00000000-0000-4000-8000-000000000202',
  'oauth-location-b', 'oauth-company', 'oauth-provider', 'wrong-version',
  '2026-09-23T14:00:00Z', 'wrong-version')$q$, '23514', 'signed version must match owner approval');
select pg_temp.assert_true(
  not has_table_privilege('service_role', 'public.ghl_marketplace_oauth_bootstraps', 'SELECT')
  and not has_table_privilege('anon', 'public.ghl_marketplace_oauth_bootstraps', 'SELECT')
  and not has_table_privilege('authenticated', 'public.ghl_marketplace_oauth_bootstraps', 'SELECT'),
  'bootstrap table has no broad service or browser access');

reset role;

-- Crash fixtures: expired waiting/ready and stale exchanging are terminalized and scrubbed.
alter table public.ghl_marketplace_oauth_bootstraps disable trigger protect_ghl_marketplace_oauth_bootstrap;
insert into public.ghl_marketplace_oauth_bootstraps(
  app_namespace, marketplace_version_id, state_hash, browser_binding_hash, redirect_uri,
  config_fingerprint, status, created_at, expires_at, callback_received_at,
  authorization_code_ciphertext, authorization_code_key_version, claimed_installation_id,
  claimed_installation_generation, exchange_started_at
) values
('every8d_connect','oauth-version',repeat('5',64),repeat('e',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),'waiting_install',
 clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '1 minute',
 clock_timestamp()-interval '9 minutes',convert_to('code-e','utf8'),'code-v1',null,null,null),
('every8d_connect','oauth-version',repeat('6',64),repeat('f',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('f',64),'exchanging',
 clock_timestamp()-interval '10 minutes',clock_timestamp()+interval '1 minute',
 clock_timestamp()-interval '9 minutes',convert_to('code-f','utf8'),'code-v1',
 (select id from public.ghl_marketplace_installations where location_id='oauth-location-a'),1,
 clock_timestamp()-interval '3 minutes');
alter table public.ghl_marketplace_oauth_bootstraps enable trigger protect_ghl_marketplace_oauth_bootstrap;
set local role service_role;
select * from public.list_every8d_oauth_recoverable_v1('oauth-version', repeat('f',64), 8);
reset role;
select pg_temp.assert_true((select bool_and(status='failed' and authorization_code_ciphertext is null)
  from public.ghl_marketplace_oauth_bootstraps where state_hash in (repeat('5',64),repeat('6',64))),
  'crash recovery terminalizes expired waiting and stale exchanging without replay');

rollback;
\echo 'Public OAuth bootstrap/rendezvous PostgreSQL proof passed'
