\set ON_ERROR_STOP on
\set VERBOSITY terse
-- Only synthetic fixtures in disposable wincrm_test. No provider/network calls.
begin;

create function pg_temp.assert_true(actual boolean, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from true then
    raise exception 'company ownership proof failed: %', label;
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
    raise exception 'company ownership proof unexpected SQLSTATE %: %', sqlstate, label;
  end;
  raise exception 'company ownership proof accepted forbidden operation: %', label;
end;
$$;

select pg_temp.assert_true(
  exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ghl_marketplace_installations'
      and column_name = 'company_id' and is_nullable = 'YES'),
  'nullable staged company ownership column exists'
);
select pg_temp.assert_true(
  to_regprocedure('public.provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text)') is not null,
  'atomic provisioning function exists'
);

insert into public.tenants (id, location_id, ghl_provider_id, line_channel_id) values
  ('00000000-0000-4000-8000-000000000100', 'issue100-location-a', 'issue100-line-a', 'issue100-channel-a'),
  ('00000000-0000-4000-8000-000000000101', 'issue100-location-b', 'issue100-line-b', 'issue100-channel-b');

-- Existing pre-D1 rows remain representable without invented ownership.
insert into public.ghl_marketplace_installations (
  id, marketplace_app_id, oauth_client_id, tenant_id, location_id, conversation_provider_id
) values (
  '10000000-0000-4000-8000-000000000100', 'issue100-app', 'issue100-client',
  '00000000-0000-4000-8000-000000000100', 'issue100-location-a', 'issue100-provider'
);
select pg_temp.assert_true(
  (select company_id is null from public.ghl_marketplace_installations
    where id = '10000000-0000-4000-8000-000000000100'),
  'legacy row remains nullable without false backfill'
);

-- Service role cannot invent ownership through direct INSERT or company UPDATE.
set local role service_role;
select pg_temp.reject($q$insert into public.ghl_marketplace_installations
  (marketplace_app_id, oauth_client_id, tenant_id, location_id, company_id, conversation_provider_id)
  values ('issue100-direct', 'issue100-direct', '00000000-0000-4000-8000-000000000101',
    'issue100-location-b', 'issue100-company', 'issue100-provider')$q$, '42501', 'direct service insert');
select pg_temp.reject($q$update public.ghl_marketplace_installations set company_id = 'issue100-company'
  where id = '10000000-0000-4000-8000-000000000100'$q$, '42501', 'direct company binding');

-- The narrow SECURITY DEFINER RPC is the only service-role ownership transition.
select * from public.provision_every8d_ghl_marketplace_installation_v1(
  'issue100-app', 'issue100-client', '00000000-0000-4000-8000-000000000100',
  'issue100-location-a', 'issue100-company', 'issue100-provider'
);
select pg_temp.assert_true(
  (select company_id = 'issue100-company' and status = 'pending' and installation_generation = 1
    from public.ghl_marketplace_installations where id = '10000000-0000-4000-8000-000000000100'),
  'authoritative company binds without changing generation'
);

-- Duplicate same evidence is idempotent; conflicting evidence fails.
select * from public.provision_every8d_ghl_marketplace_installation_v1(
  'issue100-app', 'issue100-client', '00000000-0000-4000-8000-000000000100',
  'issue100-location-a', 'issue100-company', 'issue100-provider'
);
select pg_temp.assert_true(
  (select count(*) = 1 and min(installation_generation) = 1
    from public.ghl_marketplace_installations
    where marketplace_app_id = 'issue100-app' and location_id = 'issue100-location-a'),
  'duplicate provisioning preserves one row and generation'
);
select pg_temp.reject($q$select * from public.provision_every8d_ghl_marketplace_installation_v1(
  'issue100-app', 'issue100-client', '00000000-0000-4000-8000-000000000100',
  'issue100-location-a', 'foreign-company', 'issue100-provider')$q$, '23514', 'different company');
select pg_temp.reject($q$select * from public.provision_every8d_ghl_marketplace_installation_v1(
  'issue100-app', 'foreign-client', '00000000-0000-4000-8000-000000000100',
  'issue100-location-a', 'issue100-company', 'issue100-provider')$q$, '23514', 'different client');
select pg_temp.reject($q$select * from public.provision_every8d_ghl_marketplace_installation_v1(
  'issue100-app', 'issue100-client', '00000000-0000-4000-8000-000000000100',
  'issue100-location-b', 'issue100-company', 'issue100-provider')$q$, '23503', 'cross-bound tenant/location');

-- One company may own multiple exact tenant/location rows.
select * from public.provision_every8d_ghl_marketplace_installation_v1(
  'issue100-app', 'issue100-client', '00000000-0000-4000-8000-000000000101',
  'issue100-location-b', 'issue100-company', 'issue100-provider'
);
select pg_temp.assert_true(
  (select count(*) = 2 from public.ghl_marketplace_installations
    where marketplace_app_id = 'issue100-app' and company_id = 'issue100-company'),
  'same company owns multiple exact locations'
);

-- Exact credential writes cannot cross company ownership.
with changed as (
  update public.ghl_marketplace_installations
    set access_token_ciphertext = decode('aa', 'hex'), refresh_token_ciphertext = decode('bb', 'hex'),
      encryption_key_version = 'synthetic-v1', token_expires_at = now() + interval '1 hour',
      granted_scopes = array['locations.readonly']
  where id = '10000000-0000-4000-8000-000000000100' and company_id = 'foreign-company'
  returning id
)
select pg_temp.assert_true((select count(*) = 0 from changed), 'different company exact update has no winner');

-- Old state/generation cannot revive across uninstall and authoritative reactivation.
insert into public.ghl_marketplace_oauth_states (
  installation_id, installation_generation, state_hash, browser_binding_hash, redirect_uri, expires_at
) values (
  '10000000-0000-4000-8000-000000000100', 1, repeat('4', 64), repeat('5', 64),
  'https://example.invalid/oauth/every8d-connect/callback', now() + interval '5 minutes'
);
update public.ghl_marketplace_installations
  set status = 'uninstalled', installation_generation = 2
  where id = '10000000-0000-4000-8000-000000000100' and company_id = 'issue100-company';
select * from public.provision_every8d_ghl_marketplace_installation_v1(
  'issue100-app', 'issue100-client', '00000000-0000-4000-8000-000000000100',
  'issue100-location-a', 'issue100-company', 'issue100-provider'
);
select pg_temp.assert_true(
  (select status = 'pending' and installation_generation = 3
    from public.ghl_marketplace_installations where id = '10000000-0000-4000-8000-000000000100'),
  'reinstall advances generation exactly once'
);
select pg_temp.reject($q$update public.ghl_marketplace_oauth_states set consumed_at = now()
  where state_hash = repeat('4', 64)$q$, '23514', 'old state after company-bound reinstall');
reset role;

-- Even the database owner cannot rewrite a bound company through ordinary row mutation.
select pg_temp.reject($q$update public.ghl_marketplace_installations set company_id = 'foreign-company'
  where id = '10000000-0000-4000-8000-000000000100'$q$, '23514', 'immutable company owner');

select pg_temp.assert_true(
  not has_table_privilege('service_role', 'public.ghl_marketplace_installations', 'INSERT')
  and not has_table_privilege('service_role', 'public.ghl_marketplace_installations', 'UPDATE')
  and has_column_privilege('service_role', 'public.ghl_marketplace_installations', 'status', 'UPDATE')
  and not has_column_privilege('service_role', 'public.ghl_marketplace_installations', 'company_id', 'UPDATE'),
  'service role retains least-privilege mutable columns only'
);
select pg_temp.assert_true(
  not has_function_privilege('anon',
    'public.provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text)', 'EXECUTE')
  and has_function_privilege('service_role',
    'public.provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text)', 'EXECUTE'),
  'provisioning RPC is server-only'
);

rollback;
\echo 'Marketplace company ownership SQL proof passed'
