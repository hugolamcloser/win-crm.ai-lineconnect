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
  exception
    when sqlstate 'P0001' then raise;
    when others then
      if sqlstate <> expected_state then
        raise exception 'FAIL: % returned SQLSTATE %, expected %', message, sqlstate, expected_state;
      end if;
  end;
end;
$$;

create function pg_temp.reject_message(
  statement text,
  expected_state text,
  expected_message text,
  message text
)
returns void language plpgsql as $$
begin
  begin
    execute statement;
    raise exception 'FAIL: expected rejection for %', message;
  exception
    when sqlstate 'P0001' then raise;
    when others then
      if sqlstate <> expected_state or position(expected_message in sqlerrm) = 0 then
        raise exception 'FAIL: % returned SQLSTATE % and message %, expected % containing %',
          message, sqlstate, sqlerrm, expected_state, expected_message;
      end if;
  end;
end;
$$;

insert into public.tenants(id, location_id, ghl_provider_id, line_channel_id)
values (
  '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-line-provider', 'issue102-line-channel'
);

insert into public.ghl_marketplace_app_registrations (
  app_namespace, marketplace_app_id, oauth_client_id,
  conversation_provider_id, channel, provider
) values (
  'every8d_connect', 'issue102-app', 'issue102-client',
  'issue102-provider', 'sms', 'every8d'
);

set local role service_role;

select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  null, 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T14:20:53.728Z', 'missing-type')$q$, '23514', 'missing event type');

-- Only the owner-registered app/client/conversation-provider identity may create
-- the first row. Each rejected attempt leaves zero installation ownership behind.
select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'wrong-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T14:20:53.728Z', 'wrong-first-app')$q$, '23514', 'unregistered first app');
select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'wrong-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T14:20:53.728Z', 'wrong-first-client')$q$, '23514', 'unregistered first OAuth client');
select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'wrong-provider',
  '2026-09-22T14:20:53.728Z', 'wrong-first-conversation-provider')$q$, '23514',
  'unregistered first Conversation Provider');
select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'wrong-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T14:20:53.728Z', 'wrong-first-location')$q$, '23503',
  'first install location is not the exact tenant location');
select pg_temp.reject($q$insert into public.ghl_marketplace_installations(
  marketplace_app_id, oauth_client_id, tenant_id, location_id, company_id,
  conversation_provider_id, channel, provider
) values (
  'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider', 'line', 'every8d'
)$q$, '42501', 'service role cannot invent a first-install channel');
select pg_temp.reject($q$insert into public.ghl_marketplace_installations(
  marketplace_app_id, oauth_client_id, tenant_id, location_id, company_id,
  conversation_provider_id, channel, provider
) values (
  'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider', 'sms', 'line'
)$q$, '42501', 'service role cannot invent a first-install provider');
select pg_temp.reject($q$update public.ghl_marketplace_app_registrations
  set oauth_client_id = 'wrong-client' where app_namespace = 'every8d_connect'$q$, '42501',
  'service role cannot rewrite the approved registration');
reset role;
select pg_temp.reject_message($q$update public.ghl_marketplace_app_registrations
  set oauth_client_id = 'wrong-client' where app_namespace = 'every8d_connect'$q$, '23514',
  'marketplace app registration is immutable', 'owner DML cannot rewrite the approved registration');
set local role service_role;
select pg_temp.assert_true(
  (select count(*) = 0 from public.ghl_marketplace_installations),
  'all unregistered or mismatched first-install attempts create zero rows'
);

-- INSTALL A -> UNINSTALL B -> stale retry INSTALL A.
select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T14:20:53.728Z', 'install-a'
);

-- The persistent constraint and trigger both require an all-null or all-present
-- watermark. First prove the trigger's explicit rejection, then disable only
-- that trigger inside this disposable transaction and prove the CHECK rejects
-- every partial tuple independently.
reset role;
select pg_temp.reject_message($q$update public.ghl_marketplace_installations set
  latest_lifecycle_event_at = '2026-09-22T14:21:00Z',
  latest_lifecycle_event_id = null, latest_lifecycle_event_type = null
  where marketplace_app_id = 'issue102-app'$q$, '23514',
  'marketplace lifecycle watermark must be entirely null or entirely present',
  'trigger rejects a partial lifecycle watermark');
alter table public.ghl_marketplace_installations
  disable trigger protect_ghl_marketplace_installation;
select pg_temp.reject($q$update public.ghl_marketplace_installations set
  latest_lifecycle_event_at = '2026-09-22T14:21:00Z',
  latest_lifecycle_event_id = null, latest_lifecycle_event_type = null
  where marketplace_app_id = 'issue102-app'$q$, '23514', 'timestamp-only watermark');
select pg_temp.reject($q$update public.ghl_marketplace_installations set
  latest_lifecycle_event_at = null,
  latest_lifecycle_event_id = 'partial-id', latest_lifecycle_event_type = null
  where marketplace_app_id = 'issue102-app'$q$, '23514', 'ID-only watermark');
select pg_temp.reject($q$update public.ghl_marketplace_installations set
  latest_lifecycle_event_at = null,
  latest_lifecycle_event_id = null, latest_lifecycle_event_type = 'INSTALL'
  where marketplace_app_id = 'issue102-app'$q$, '23514', 'type-only watermark');
select pg_temp.reject($q$update public.ghl_marketplace_installations set
  latest_lifecycle_event_at = '2026-09-22T14:21:00Z',
  latest_lifecycle_event_id = 'partial-id', latest_lifecycle_event_type = null
  where marketplace_app_id = 'issue102-app'$q$, '23514', 'timestamp-plus-ID watermark');
select pg_temp.reject($q$update public.ghl_marketplace_installations set
  latest_lifecycle_event_at = '2026-09-22T14:21:00Z',
  latest_lifecycle_event_id = null, latest_lifecycle_event_type = 'INSTALL'
  where marketplace_app_id = 'issue102-app'$q$, '23514', 'timestamp-plus-type watermark');
select pg_temp.reject($q$update public.ghl_marketplace_installations set
  latest_lifecycle_event_at = null,
  latest_lifecycle_event_id = 'partial-id', latest_lifecycle_event_type = 'INSTALL'
  where marketplace_app_id = 'issue102-app'$q$, '23514', 'ID-plus-type watermark');
select pg_temp.reject($q$update public.ghl_marketplace_installations set
  latest_lifecycle_event_at = 'infinity', latest_lifecycle_event_id = 'infinite-time',
  latest_lifecycle_event_type = 'INSTALL' where marketplace_app_id = 'issue102-app'$q$,
  '23514', 'non-finite watermark timestamp');
select pg_temp.reject($q$update public.ghl_marketplace_installations set
  latest_lifecycle_event_at = '2026-09-22T14:21:00Z', latest_lifecycle_event_id = 'bad/type',
  latest_lifecycle_event_type = 'INSTALL' where marketplace_app_id = 'issue102-app'$q$,
  '23514', 'malformed watermark ID');
select pg_temp.reject($q$update public.ghl_marketplace_installations set
  latest_lifecycle_event_at = '2026-09-22T14:21:00Z', latest_lifecycle_event_id = 'bad-type',
  latest_lifecycle_event_type = 'OTHER' where marketplace_app_id = 'issue102-app'$q$,
  '23514', 'unsupported watermark type');
alter table public.ghl_marketplace_installations
  enable trigger protect_ghl_marketplace_installation;
set local role service_role;

select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'UNINSTALL', 'issue102-app', 'issue102-client', null,
  'issue102-location', null, 'issue102-provider',
  '2026-09-22T14:35:55.549Z', 'uninstall-b'
);
select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T14:20:53.728Z', 'install-a'
);
select pg_temp.assert_true(
  (select status = 'uninstalled' and installation_generation = 2
    and latest_lifecycle_event_at = '2026-09-22T14:35:55.549Z'::timestamptz
    and latest_lifecycle_event_id = 'uninstall-b'
    and latest_lifecycle_event_type = 'UNINSTALL'
   from public.ghl_marketplace_installations where marketplace_app_id = 'issue102-app'),
  'stale INSTALL A cannot reverse UNINSTALL B or increment generation'
);

-- Legitimate reinstall C -> stale retry UNINSTALL B.
select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T14:50:00.000Z', 'install-c'
);
select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'UNINSTALL', 'issue102-app', 'issue102-client', null,
  'issue102-location', null, 'issue102-provider',
  '2026-09-22T14:35:55.549Z', 'uninstall-b'
);
select pg_temp.assert_true(
  (select status = 'pending' and installation_generation = 3
    and latest_lifecycle_event_at = '2026-09-22T14:50:00.000Z'::timestamptz
    and latest_lifecycle_event_id = 'install-c'
    and latest_lifecycle_event_type = 'INSTALL'
   from public.ghl_marketplace_installations where marketplace_app_id = 'issue102-app'),
  'stale UNINSTALL B cannot reverse reinstall C or increment generation'
);

-- Exact retry after a committed/lost response converges without another transition.
select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T14:50:00.000Z', 'install-c'
);
select pg_temp.assert_true(
  (select status = 'pending' and installation_generation = 3
   from public.ghl_marketplace_installations where marketplace_app_id = 'issue102-app'),
  'exact INSTALL replay is idempotent after response loss'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.ghl_marketplace_installations
    where marketplace_app_id = 'issue102-app' and location_id = 'issue102-location'),
  'exact INSTALL replay cannot create a duplicate installation row'
);

select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'UNINSTALL', 'issue102-app', 'issue102-client', null,
  'issue102-location', null, 'issue102-provider',
  '2026-09-22T15:00:00.000Z', 'uninstall-d'
);
select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'UNINSTALL', 'issue102-app', 'issue102-client', null,
  'issue102-location', null, 'issue102-provider',
  '2026-09-22T15:00:00.000Z', 'uninstall-d'
);
select pg_temp.assert_true(
  (select status = 'uninstalled' and installation_generation = 4
   from public.ghl_marketplace_installations where marketplace_app_id = 'issue102-app'),
  'exact UNINSTALL replay is idempotent after response loss'
);

-- Equal-time distinct or contradictory evidence fails closed with zero mutation.
select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'UNINSTALL', 'issue102-app', 'issue102-client', null,
  'issue102-location', null, 'issue102-provider',
  '2026-09-22T15:00:00.000Z', 'different-event')$q$, '23514', 'equal timestamp different ID');
select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T15:00:00.000Z', 'uninstall-d')$q$, '23514', 'equal timestamp contradictory type');
select pg_temp.assert_true(
  (select status = 'uninstalled' and installation_generation = 4
    and latest_lifecycle_event_id = 'uninstall-d' and latest_lifecycle_event_type = 'UNINSTALL'
   from public.ghl_marketplace_installations where marketplace_app_id = 'issue102-app'),
  'equal-time ambiguity leaves state and generation unchanged'
);

-- Older distinct evidence is stale even when its ID is new.
select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T14:55:00.000Z', 'older-distinct-install'
);
select pg_temp.assert_true(
  (select status = 'uninstalled' and installation_generation = 4
    and latest_lifecycle_event_id = 'uninstall-d'
   from public.ghl_marketplace_installations where marketplace_app_id = 'issue102-app'),
  'older distinct lifecycle evidence cannot reverse current state'
);

-- Existing exact ownership protections remain part of the database boundary.
select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'wrong-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T16:00:00.000Z', 'wrong-client')$q$, '23514', 'wrong client');
select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'wrong-provider',
  '2026-09-22T16:00:00.000Z', 'wrong-provider')$q$, '23514', 'wrong provider');
select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'wrong-company', 'issue102-provider',
  '2026-09-22T16:00:00.000Z', 'wrong-company')$q$, '23514', 'wrong company');
select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'UNINSTALL', 'wrong-app', 'issue102-client', null,
  'issue102-location', null, 'issue102-provider',
  '2026-09-22T16:00:00.000Z', 'wrong-app')$q$, '23514', 'wrong app');
select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'UNINSTALL', 'issue102-app', 'issue102-client', null,
  'wrong-location', null, 'issue102-provider',
  '2026-09-22T16:00:00.000Z', 'wrong-location')$q$, '23514', 'wrong location');

reset role;
select pg_temp.assert_true(
  not has_function_privilege('anon',
    'public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)', 'EXECUTE')
  and has_function_privilege('service_role',
    'public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('service_role',
    'public.provision_every8d_ghl_marketplace_installation_v1(text,text,uuid,text,text,text)', 'EXECUTE'),
  'only service_role can execute the ordered lifecycle RPC and the unsafe D1 RPC is retired'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.ghl_marketplace_app_registrations', 'SELECT')
  and not has_table_privilege('anon', 'public.ghl_marketplace_app_registrations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.ghl_marketplace_app_registrations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.ghl_marketplace_app_registrations', 'INSERT')
  and not has_table_privilege('service_role', 'public.ghl_marketplace_app_registrations', 'SELECT')
  and not has_table_privilege('service_role', 'public.ghl_marketplace_app_registrations', 'INSERT')
  and not has_table_privilege('service_role', 'public.ghl_marketplace_app_registrations', 'UPDATE')
  and not has_table_privilege('service_role', 'public.ghl_marketplace_app_registrations', 'DELETE'),
  'browser roles have zero registration access and service_role cannot read or mutate registration'
);
select pg_temp.assert_true(
  (select convalidated from pg_constraint
   where conrelid = 'public.ghl_marketplace_installations'::regclass
     and conname = 'ghl_marketplace_installations_lifecycle_watermark_check'),
  'all-null or all-present lifecycle watermark constraint is validated'
);

rollback;
\echo 'Marketplace lifecycle ordering SQL proof passed'
