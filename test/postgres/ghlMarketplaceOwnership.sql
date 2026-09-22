\set ON_ERROR_STOP on
\set VERBOSITY terse
-- Only synthetic fixtures in disposable wincrm_test. No provider/network calls.
begin;

create function pg_temp.assert_true(actual boolean, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from true then
    raise exception 'ownership proof failed: %', label;
  end if;
end;
$$;

create function pg_temp.reject(statement text, expected_state text, label text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise exception 'ownership proof unexpected SQLSTATE %: %', sqlstate, label;
  end;
  raise exception 'ownership proof accepted forbidden operation: %', label;
end;
$$;

insert into public.tenants (id, location_id, ghl_provider_id, line_channel_id)
values ('00000000-0000-4000-8000-000000000095', 'issue95-location', 'issue95-line-provider', 'issue95-line-channel');
insert into public.ghl_oauth_tokens (tenant_id, location_id, access_token, refresh_token, expires_at)
values ('00000000-0000-4000-8000-000000000095', 'issue95-location', 'synthetic-line-access', 'synthetic-line-refresh', now() + interval '1 day');
create temp table original_line_tokens as select * from public.ghl_oauth_tokens;
create temp table original_tenants as select * from public.tenants;
insert into public.ghl_sms_controlled_live_authorizations (
  id, tenant_id, location_id, contact_id, destination_fingerprint, message_fingerprint, state, armed_at
) values (
  '20000000-0000-4000-8000-000000000095', '00000000-0000-4000-8000-000000000095',
  'issue95-location', 'issue95-contact', repeat('a', 64), repeat('b', 64), 'armed', now()
);
create temp table original_authorizations as select * from public.ghl_sms_controlled_live_authorizations;

insert into public.ghl_marketplace_installations (
  id, marketplace_app_id, oauth_client_id, tenant_id, location_id, conversation_provider_id
) values (
  '10000000-0000-4000-8000-000000000095', 'issue95-every8d-app', 'issue95-every8d-client',
  '00000000-0000-4000-8000-000000000095', 'issue95-location', 'issue95-every8d-provider'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.ghl_oauth_tokens where location_id = 'issue95-location')
  and (select count(*) = 1 from public.ghl_marketplace_installations where location_id = 'issue95-location'),
  'LINE and EVERY8D coexist at the same location'
);

select pg_temp.reject($q$insert into public.ghl_marketplace_installations
  (marketplace_app_id, oauth_client_id, tenant_id, location_id, conversation_provider_id)
  values ('issue95-other-app', 'issue95-other-client', '00000000-0000-4000-8000-000000000095', 'wrong-location', 'other-provider')$q$,
  '23503', 'cross-location tenant binding');
select pg_temp.reject($q$insert into public.ghl_marketplace_installations
  (marketplace_app_id, oauth_client_id, tenant_id, location_id, conversation_provider_id)
  values ('issue95-other-app', 'issue95-other-client', '00000000-0000-4000-8000-000000000096', 'issue95-location', 'other-provider')$q$,
  '23503', 'unknown tenant');
select pg_temp.reject($q$insert into public.ghl_marketplace_installations
  (marketplace_app_id, oauth_client_id, tenant_id, location_id, conversation_provider_id)
  values ('issue95-every8d-app', 'issue95-every8d-client', '00000000-0000-4000-8000-000000000095', 'issue95-location', 'other-provider')$q$,
  '23505', 'duplicate app/location');
select pg_temp.reject($q$insert into public.ghl_marketplace_installations
  (marketplace_app_id, oauth_client_id, tenant_id, location_id, conversation_provider_id)
  values ('issue95-other-app', 'issue95-other-client', '00000000-0000-4000-8000-000000000095', 'issue95-location', 'issue95-line-provider')$q$,
  '23514', 'LINE provider reuse');

-- Bind the legacy synthetic row through the D1 server-only ownership transition.
set local role service_role;
select * from public.provision_every8d_ghl_marketplace_installation_v1(
  'issue95-every8d-app', 'issue95-every8d-client', '00000000-0000-4000-8000-000000000095',
  'issue95-location', 'issue95-company', 'issue95-every8d-provider'
);
reset role;

-- Exercise every ownership column, including context that could redirect token use.
do $$
declare assignment text;
begin
  foreach assignment in array array[
    'id = gen_random_uuid()', 'app_namespace = ''line_connect''', 'marketplace_app_id = ''other-app''',
    'oauth_client_id = ''other-client''', 'tenant_id = gen_random_uuid()', 'location_id = ''other-location''',
    'company_id = ''other-company''',
    'conversation_provider_id = ''other-provider''', 'channel = ''line''', 'provider = ''line''',
    'created_at = created_at - interval ''1 second'''
  ] loop
    perform pg_temp.reject('update public.ghl_marketplace_installations set ' || assignment,
      '23514', 'immutable installation ' || assignment);
  end loop;
end;
$$;
select pg_temp.reject($q$update public.ghl_marketplace_installations set access_token_ciphertext = decode('aa', 'hex')$q$,
  '23514', 'partial credential pair');
select pg_temp.reject($q$update public.ghl_marketplace_installations set installation_generation = 3$q$,
  '23514', 'generation skip');

-- Prove actual non-BYPASSRLS service access. Trigger reads must not need grants on LINE tables.
set local role service_role;
select * from public.provision_every8d_ghl_marketplace_installation_v1(
  'issue95-second-app', 'issue95-second-client', '00000000-0000-4000-8000-000000000095',
  'issue95-location', 'issue95-company', 'issue95-second-provider'
);
update public.ghl_marketplace_installations set access_token_ciphertext = decode('aa', 'hex'),
  refresh_token_ciphertext = decode('bb', 'hex'), encryption_key_version = 'synthetic-v1',
  token_expires_at = now() + interval '1 hour', granted_scopes = array['contacts.readonly']
where id = '10000000-0000-4000-8000-000000000095';
select pg_temp.assert_true((select count(*) = 2 from public.ghl_marketplace_installations), 'service role sees its server rows');
select pg_temp.reject('delete from public.ghl_marketplace_installations', '42501', 'service delete denied');
select pg_temp.reject('truncate public.ghl_marketplace_installations', '42501', 'service truncate denied');
select pg_temp.reject('select public.protect_ghl_marketplace_installation_v1()', '42501', 'direct integrity function call denied');
insert into public.ghl_marketplace_oauth_states (
  id, installation_id, installation_generation, state_hash, browser_binding_hash, redirect_uri, expires_at
) values (
  '30000000-0000-4000-8000-000000000095', '10000000-0000-4000-8000-000000000095', 1,
  repeat('c', 64), repeat('d', 64), 'https://example.invalid/oauth/every8d-connect/callback', now() + interval '5 minutes'
);
update public.ghl_marketplace_oauth_states set consumed_at = clock_timestamp()
where id = '30000000-0000-4000-8000-000000000095' and consumed_at is null and revoked_at is null;
select pg_temp.assert_true((select consumed_at is not null from public.ghl_marketplace_oauth_states
  where id = '30000000-0000-4000-8000-000000000095'), 'service state consumption');
select pg_temp.reject('delete from public.ghl_marketplace_oauth_states', '42501', 'service state delete denied');
select pg_temp.reject('truncate public.ghl_marketplace_oauth_states', '42501', 'service state truncate denied');
reset role;

-- No legacy token/provider/armed-authorization writes or identity crossover.
select pg_temp.assert_true(not exists (
  (table public.ghl_oauth_tokens except table original_line_tokens)
  union all (table original_line_tokens except table public.ghl_oauth_tokens)), 'LINE tokens byte-for-byte unchanged');
select pg_temp.assert_true(not exists (
  (table public.tenants except table original_tenants)
  union all (table original_tenants except table public.tenants)), 'tenant provider values unchanged');
select pg_temp.assert_true(not exists (
  (table public.ghl_sms_controlled_live_authorizations except table original_authorizations)
  union all (table original_authorizations except table public.ghl_sms_controlled_live_authorizations)), 'armed evidence unchanged');
select pg_temp.assert_true((select access_token = 'synthetic-line-access' from public.ghl_oauth_tokens
  where location_id = 'issue95-location'), 'legacy location lookup retains LINE token');

do $$
declare assignment text;
begin
  foreach assignment in array array[
    'id = gen_random_uuid()', 'installation_id = gen_random_uuid()', 'installation_generation = 2',
    'state_hash = repeat(''e'', 64)', 'browser_binding_hash = repeat(''f'', 64)',
    'redirect_uri = ''https://other.invalid/callback''', 'created_at = created_at - interval ''1 second''',
    'expires_at = expires_at + interval ''1 second''', 'consumed_at = null',
    'consumed_at = consumed_at + interval ''1 second''', 'revoked_at = now()'
  ] loop
    perform pg_temp.reject('update public.ghl_marketplace_oauth_states set ' || assignment,
      '23514', 'immutable state ' || assignment);
  end loop;
end;
$$;
with reused as (update public.ghl_marketplace_oauth_states set consumed_at = now()
  where state_hash = repeat('c', 64) and consumed_at is null and revoked_at is null returning id)
select pg_temp.assert_true((select count(*) = 0 from reused), 'single-use conditional consume');

create function pg_temp.new_state(hash text, installation uuid default '10000000-0000-4000-8000-000000000095', generation integer default 1)
returns void language sql as $$
  insert into public.ghl_marketplace_oauth_states
    (installation_id, installation_generation, state_hash, browser_binding_hash, redirect_uri, expires_at)
  values (installation, generation, hash, repeat('d', 64), 'https://example.invalid/oauth/every8d-connect/callback', now() + interval '5 minutes');
$$;
select pg_temp.reject($q$select pg_temp.new_state(repeat('c', 64))$q$, '23505', 'unique state hash');
select pg_temp.reject($q$select pg_temp.new_state(repeat('e', 64), gen_random_uuid())$q$, '23503', 'invalid installation');
select pg_temp.reject($q$select pg_temp.new_state(repeat('e', 64), '10000000-0000-4000-8000-000000000095', 2)$q$, '23514', 'stale generation on insert');
select pg_temp.reject($q$select pg_temp.new_state('raw-state-is-not-a-hash')$q$, '23514', 'hash format');
select pg_temp.new_state(repeat('e', 64));
update public.ghl_marketplace_oauth_states set revoked_at = now() where state_hash = repeat('e', 64);
select pg_temp.reject($q$update public.ghl_marketplace_oauth_states set revoked_at = null where state_hash = repeat('e', 64)$q$,
  '23514', 'revocation cannot reset');
select pg_temp.reject($q$update public.ghl_marketplace_oauth_states set consumed_at = now() where state_hash = repeat('e', 64)$q$,
  '23514', 'revoked cannot consume');
select pg_temp.new_state(repeat('f', 64));
update public.ghl_marketplace_installations set installation_generation = 2 where id = '10000000-0000-4000-8000-000000000095';
select pg_temp.reject($q$update public.ghl_marketplace_oauth_states set consumed_at = now() where state_hash = repeat('f', 64)$q$,
  '23514', 'old generation cannot consume');
select pg_temp.reject($q$update public.ghl_marketplace_installations set installation_generation = 1$q$, '23514', 'generation cannot reset');
select pg_temp.new_state(repeat('1', 64), '10000000-0000-4000-8000-000000000095', 2);
update public.ghl_marketplace_installations set status = 'disabled' where id = '10000000-0000-4000-8000-000000000095';
select pg_temp.reject($q$update public.ghl_marketplace_oauth_states set consumed_at = now() where state_hash = repeat('1', 64)$q$,
  '23514', 'disabled installation cannot consume');
select pg_temp.reject($q$select pg_temp.new_state(repeat('2', 64), '10000000-0000-4000-8000-000000000095', 2)$q$,
  '23514', 'disabled installation cannot initiate');
select pg_temp.reject($q$update public.ghl_marketplace_installations set status = 'pending'
  where id = '10000000-0000-4000-8000-000000000095'$q$, '23514', 'reactivation cannot revive old state generation');
update public.ghl_marketplace_installations set status = 'pending', installation_generation = 3
where id = '10000000-0000-4000-8000-000000000095';
select pg_temp.reject($q$update public.ghl_marketplace_oauth_states set consumed_at = now() where state_hash = repeat('1', 64)$q$,
  '23514', 'reactivated installation rejects prior state');

-- A real expiry, including an attempted backdated consume, not a mocked clock.
insert into public.ghl_marketplace_oauth_states
  (installation_id, installation_generation, state_hash, browser_binding_hash, redirect_uri, created_at, expires_at)
values ('10000000-0000-4000-8000-000000000095', 3, repeat('2', 64), repeat('d', 64),
  'https://example.invalid/callback', clock_timestamp(), clock_timestamp() + interval '200 milliseconds');
select pg_sleep(0.25);
select pg_temp.reject($q$update public.ghl_marketplace_oauth_states set consumed_at = created_at where state_hash = repeat('2', 64)$q$,
  '23514', 'expired state rejects backdated consumption');
select pg_temp.reject($q$insert into public.ghl_marketplace_oauth_states
  (installation_id, installation_generation, state_hash, browser_binding_hash, redirect_uri, expires_at, consumed_at)
  values ('10000000-0000-4000-8000-000000000095', 3, repeat('3', 64), repeat('d', 64),
  'https://example.invalid/callback', now() + interval '5 minutes', now())$q$, '23514', 'preconsumed insert');
select pg_temp.reject($q$insert into public.ghl_marketplace_oauth_states
  (installation_id, installation_generation, state_hash, browser_binding_hash, redirect_uri, expires_at)
  values ('10000000-0000-4000-8000-000000000095', 3, repeat('3', 64), repeat('d', 64),
  'http://example.invalid/callback', now() + interval '5 minutes')$q$, '23514', 'non-HTTPS redirect');
select pg_temp.reject($q$insert into public.ghl_marketplace_oauth_states
  (installation_id, installation_generation, state_hash, browser_binding_hash, redirect_uri, expires_at)
  values ('10000000-0000-4000-8000-000000000095', 3, repeat('3', 64), repeat('d', 64),
  'https://example.invalid/callback', now() + interval '16 minutes')$q$, '23514', 'TTL bound');

set local role anon;
select pg_temp.reject('select * from public.ghl_marketplace_installations', '42501', 'anon installations');
select pg_temp.reject('select * from public.ghl_marketplace_oauth_states', '42501', 'anon states');
reset role;
set local role authenticated;
select pg_temp.reject('select * from public.ghl_marketplace_installations', '42501', 'authenticated installations');
select pg_temp.reject('select * from public.ghl_marketplace_oauth_states', '42501', 'authenticated states');
reset role;
select pg_temp.assert_true(not exists (
  select 1 from unnest(array['anon', 'authenticated']) r,
    unnest(array['ghl_marketplace_installations', 'ghl_marketplace_oauth_states']) t,
    unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
  where has_table_privilege(r, 'public.' || t, p)), 'no browser table privileges');
select pg_temp.assert_true((select count(*) = 2 from pg_class
  where oid in ('public.ghl_marketplace_installations'::regclass, 'public.ghl_marketplace_oauth_states'::regclass)
    and relrowsecurity), 'both tables RLS enabled');
-- Prove RLS itself still denies rows if SELECT is accidentally granted later.
grant select on public.ghl_marketplace_installations, public.ghl_marketplace_oauth_states to anon, authenticated;
set local role anon;
select pg_temp.assert_true((select count(*) = 0 from public.ghl_marketplace_installations)
  and (select count(*) = 0 from public.ghl_marketplace_oauth_states), 'anon RLS defense');
reset role;
set local role authenticated;
select pg_temp.assert_true((select count(*) = 0 from public.ghl_marketplace_installations)
  and (select count(*) = 0 from public.ghl_marketplace_oauth_states), 'authenticated RLS defense');
reset role;

rollback;
\echo 'Marketplace ownership SQL proof passed'
