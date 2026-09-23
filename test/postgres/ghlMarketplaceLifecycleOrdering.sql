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

insert into public.tenants(id, location_id, ghl_provider_id, line_channel_id)
values (
  '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-line-provider', 'issue102-line-channel'
);

set local role service_role;

select pg_temp.reject($q$select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  null, 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T14:20:53.728Z', 'missing-type')$q$, '23514', 'missing event type');

-- INSTALL A -> UNINSTALL B -> stale retry INSTALL A.
select * from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-app', 'issue102-client', '00000000-0000-4000-8000-000000000103',
  'issue102-location', 'issue102-company', 'issue102-provider',
  '2026-09-22T14:20:53.728Z', 'install-a'
);
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

rollback;
\echo 'Marketplace lifecycle ordering SQL proof passed'
