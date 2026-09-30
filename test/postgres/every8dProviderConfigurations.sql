\set ON_ERROR_STOP on
\set VERBOSITY terse
-- Disposable PostgreSQL proof only. All ciphertext is synthetic and no network is used.
begin;

create function pg_temp.assert_true(actual boolean, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from true then
    raise exception 'C2 proof failed: %', label;
  end if;
end;
$$;

create function pg_temp.reject(statement text, expected_state text, label text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state then
      return;
    end if;
    raise exception 'C2 proof unexpected SQLSTATE %: %', sqlstate, label;
  end;
  raise exception 'C2 proof accepted forbidden operation: %', label;
end;
$$;

do $$
begin
  if not exists (
    select 1 from public.ghl_marketplace_app_registrations
    where app_namespace = 'every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_registrations (
      app_namespace, marketplace_app_id, oauth_client_id,
      conversation_provider_id, channel, provider
    ) values (
      'every8d_connect', 'c2-synthetic-app', 'c2.synthetic.client',
      'c2-synthetic-provider', 'sms', 'every8d'
    );
  end if;

  if not exists (
    select 1 from public.ghl_marketplace_app_version_registrations
    where app_namespace = 'every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_version_registrations (
      app_namespace, marketplace_version_id
    ) values ('every8d_connect', 'c2.synthetic.version');
  end if;
end;
$$;

create temp table c2_context as
select r.marketplace_app_id, r.oauth_client_id, r.conversation_provider_id,
  v.marketplace_version_id
from public.ghl_marketplace_app_registrations r
join public.ghl_marketplace_app_version_registrations v
  using (app_namespace)
where r.app_namespace = 'every8d_connect';

create function pg_temp.insert_parent(
  input_id uuid,
  input_tenant_id uuid,
  input_location_id text,
  input_company_id text,
  input_status text default 'pending',
  input_generation integer default 1,
  input_event_type text default 'INSTALL',
  input_version_override text default null,
  input_app_override text default null,
  input_provider_override text default null
)
returns void
language plpgsql
as $$
declare
  context c2_context%rowtype;
begin
  select * into context from c2_context;
  insert into public.ghl_marketplace_installations (
    id, app_namespace, marketplace_app_id, oauth_client_id,
    tenant_id, location_id, company_id, conversation_provider_id,
    channel, provider, status, installation_generation,
    latest_lifecycle_event_at, latest_lifecycle_event_id,
    latest_lifecycle_event_type, latest_lifecycle_version_id
  ) values (
    input_id, 'every8d_connect', coalesce(input_app_override, context.marketplace_app_id),
    context.oauth_client_id, input_tenant_id, input_location_id, input_company_id,
    coalesce(input_provider_override, context.conversation_provider_id),
    'sms', 'every8d', input_status, input_generation,
    case when input_event_type is null then null else '2090-01-01T00:00:00Z'::timestamptz end,
    case when input_event_type is null then null else 'c2_' || replace(input_id::text, '-', '_') end,
    input_event_type,
    case when input_event_type is null then null
      else coalesce(input_version_override, context.marketplace_version_id) end
  );
end;
$$;

create function pg_temp.insert_configuration(
  input_id uuid,
  input_installation_id uuid,
  input_generation integer,
  input_state text default 'configured'
)
returns void
language sql
as $$
  insert into public.every8d_provider_configurations (
    id, installation_id, installation_generation, site_url,
    credential_state, uid_ciphertext, password_ciphertext,
    encryption_key_version, credential_revision, safesay_event_id
  ) values (
    input_id, input_installation_id, input_generation,
    'synthetic-c2.example.invalid', input_state,
    decode('a1', 'hex'), decode('b2', 'hex'),
    'synthetic-v1', 1, 'event-alpha'
  );
$$;

create function pg_temp.lifecycle(
  input_event_type text,
  input_tenant_id uuid,
  input_location_id text,
  input_company_id text,
  input_event_at timestamptz,
  input_event_id text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  context c2_context%rowtype;
  outcome jsonb;
begin
  select * into context from c2_context;
  select public.apply_every8d_ghl_marketplace_lifecycle_v2(
    input_event_type,
    context.marketplace_app_id,
    context.oauth_client_id,
    case when input_event_type = 'INSTALL' then input_tenant_id else null end,
    input_location_id,
    case when input_event_type = 'INSTALL' then input_company_id else null end,
    context.conversation_provider_id,
    context.marketplace_version_id,
    input_event_at,
    input_event_id
  ) into outcome;
  return outcome;
end;
$$;

-- Schema, columns, ownership, constraints, and deliberately minimal indexes.
select pg_temp.assert_true(
  to_regclass('public.every8d_provider_configurations') is not null,
  'configuration table exists'
);
select pg_temp.assert_true(
  (select count(*) = 19
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'every8d_provider_configurations')
  and not exists (
    values
      ('id', 'uuid'),
      ('installation_id', 'uuid'),
      ('installation_generation', 'integer'),
      ('site_url', 'text'),
      ('timeout_ms', 'integer'),
      ('credential_state', 'text'),
      ('uid_ciphertext', 'bytea'),
      ('password_ciphertext', 'bytea'),
      ('encryption_key_version', 'text'),
      ('credential_revision', 'bigint'),
      ('safesay_enabled', 'boolean'),
      ('safesay_event_id', 'text'),
      ('configured_at', 'timestamp with time zone'),
      ('replaced_at', 'timestamp with time zone'),
      ('disconnected_at', 'timestamp with time zone'),
      ('last_validation_at', 'timestamp with time zone'),
      ('validation_failure_class', 'text'),
      ('created_at', 'timestamp with time zone'),
      ('updated_at', 'timestamp with time zone')
    except
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'every8d_provider_configurations'
  ),
  'exact C2 column names and types'
);
select pg_temp.assert_true(
  (select data_type = 'bytea'
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'every8d_provider_configurations'
     and column_name = 'uid_ciphertext')
  and
  (select data_type = 'bytea'
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'every8d_provider_configurations'
     and column_name = 'password_ciphertext')
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'every8d_provider_configurations'
      and column_name in ('uid', 'username', 'password', 'plain_uid', 'plain_password')
  ),
  'no plaintext UID or password columns'
);
select pg_temp.assert_true(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.every8d_provider_configurations'::regclass
      and conname = 'every8d_provider_configurations_installation_fk'
      and confrelid = 'public.ghl_marketplace_installations'::regclass
      and confupdtype = 'r' and confdeltype = 'r'
  )
  and exists (
    select 1
    from pg_constraint
    where conrelid = 'public.every8d_provider_configurations'::regclass
      and conname = 'every8d_provider_configurations_installation_generation_key'
      and contype = 'u'
  ),
  'restricting parent foreign key and installation-generation uniqueness'
);
select pg_temp.assert_true(
  (select count(*) = 2
   from pg_index
   where indrelid = 'public.every8d_provider_configurations'::regclass),
  'only primary-key and unique installation-generation indexes'
);
select pg_temp.assert_true(
  (select column_default is null
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'every8d_provider_configurations'
     and column_name = 'safesay_event_id'),
  'SafeSay EventID has no global default'
);

insert into public.tenants (id, location_id, ghl_provider_id, line_channel_id)
values
  ('00000000-0000-4000-8000-000000000401', 'c2-state', 'line-401', 'line-channel-401'),
  ('00000000-0000-4000-8000-000000000402', 'c2-wrong-app', 'line-402', 'line-channel-402'),
  ('00000000-0000-4000-8000-000000000403', 'c2-wrong-provider', 'line-403', 'line-channel-403'),
  ('00000000-0000-4000-8000-000000000404', 'c2-no-company', 'line-404', 'line-channel-404'),
  ('00000000-0000-4000-8000-000000000405', 'c2-no-install', 'line-405', 'line-channel-405'),
  ('00000000-0000-4000-8000-000000000406', 'c2-disabled', 'line-406', 'line-channel-406'),
  ('00000000-0000-4000-8000-000000000407', 'c2-uninstalled', 'line-407', 'line-channel-407'),
  ('00000000-0000-4000-8000-000000000408', 'c2-unregistered-version', 'line-408', 'line-channel-408'),
  ('00000000-0000-4000-8000-000000000409', 'c2-lifecycle', 'line-409', 'line-channel-409'),
  ('00000000-0000-4000-8000-000000000410', 'c2-empty-lifecycle', 'line-410', 'line-channel-410'),
  ('00000000-0000-4000-8000-000000000411', 'c2-rollback', 'line-411', 'line-channel-411');

select pg_temp.insert_parent(
  '10000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000401',
  'c2-state', 'c2-company'
);

-- Initial shape, state transitions, validation metadata, and structural revisions.
select pg_temp.reject(
  $q$select pg_temp.insert_configuration(
    '20000000-0000-4000-8000-000000000401',
    '10000000-0000-4000-8000-000000000401', 1, 'validated')$q$,
  '23514', 'initial state must be configured'
);
select pg_temp.reject(
  $q$insert into public.every8d_provider_configurations (
    installation_id, installation_generation, site_url, credential_state,
    uid_ciphertext, password_ciphertext, encryption_key_version, credential_revision
  ) values (
    '10000000-0000-4000-8000-000000000401', 1, 'synthetic-c2.example.invalid',
    'configured', decode('a1','hex'), null, 'synthetic-v1', 1
  )$q$,
  '23514', 'partial credential tuple'
);
select pg_temp.reject(
  $q$insert into public.every8d_provider_configurations (
    installation_id, installation_generation, site_url, credential_state,
    uid_ciphertext, password_ciphertext, encryption_key_version,
    credential_revision, configured_at
  ) values (
    '10000000-0000-4000-8000-000000000401', 1, 'synthetic-c2.example.invalid',
    'configured', decode('a1','hex'), decode('b2','hex'), 'synthetic-v1', 1, 'infinity'
  )$q$,
  '23514', 'non-finite configured timestamp'
);
select pg_temp.insert_configuration(
  '20000000-0000-4000-8000-000000000401',
  '10000000-0000-4000-8000-000000000401', 1
);
select pg_temp.assert_true(
  (select credential_state = 'configured'
    and credential_revision = 1
    and last_validation_at is null
    and disconnected_at is null
   from public.every8d_provider_configurations
   where id = '20000000-0000-4000-8000-000000000401'),
  'configured state is valid at revision one'
);
select pg_temp.reject(
  $q$update public.every8d_provider_configurations
     set credential_state = 'invalid',
         last_validation_at = clock_timestamp()
   where id = '20000000-0000-4000-8000-000000000401'$q$,
  '23514', 'invalid state requires failure class'
);
update public.every8d_provider_configurations
set credential_state = 'validated',
    last_validation_at = clock_timestamp()
where id = '20000000-0000-4000-8000-000000000401';
select pg_temp.assert_true(
  (select credential_state = 'validated'
    and credential_revision = 1
    and last_validation_at is not null
    and validation_failure_class is null
   from public.every8d_provider_configurations
   where id = '20000000-0000-4000-8000-000000000401'),
  'validated state is valid without a revision change'
);
select pg_temp.reject(
  $q$update public.every8d_provider_configurations
     set last_validation_at = 'infinity'
   where id = '20000000-0000-4000-8000-000000000401'$q$,
  '23514', 'non-finite validation timestamp'
);
update public.every8d_provider_configurations
set credential_state = 'invalid',
    last_validation_at = clock_timestamp(),
    validation_failure_class = 'synthetic_rejected'
where id = '20000000-0000-4000-8000-000000000401';
select pg_temp.assert_true(
  (select credential_state = 'invalid'
    and credential_revision = 1
    and validation_failure_class = 'synthetic_rejected'
   from public.every8d_provider_configurations
   where id = '20000000-0000-4000-8000-000000000401'),
  'invalid state accepts structural sanitized failure class'
);
select pg_temp.reject(
  $q$update public.every8d_provider_configurations
     set validation_failure_class = 'Not Sanitized'
   where id = '20000000-0000-4000-8000-000000000401'$q$,
  '23514', 'failure class structure'
);
update public.every8d_provider_configurations
set credential_state = 'configured',
    last_validation_at = null,
    validation_failure_class = null,
    safesay_enabled = true,
    safesay_event_id = 'event-alpha'
where id = '20000000-0000-4000-8000-000000000401';
select pg_temp.assert_true(
  (select credential_revision = 1 and safesay_enabled
   from public.every8d_provider_configurations
   where id = '20000000-0000-4000-8000-000000000401'),
  'SafeSay-only change leaves revision unchanged and permits nonnumeric EventID'
);
select pg_temp.reject(
  $q$update public.every8d_provider_configurations
     set safesay_event_id = null
   where id = '20000000-0000-4000-8000-000000000401'$q$,
  '23514', 'SafeSay enabled requires EventID'
);
select pg_temp.reject(
  $q$update public.every8d_provider_configurations
     set safesay_event_id = ' '
   where id = '20000000-0000-4000-8000-000000000401'$q$,
  '23514', 'blank SafeSay EventID'
);
select pg_temp.reject(
  $q$update public.every8d_provider_configurations
     set site_url = 'synthetic-c2-new.example.invalid',
         replaced_at = clock_timestamp() + interval '1 second'
   where id = '20000000-0000-4000-8000-000000000401'$q$,
  '23514', 'authority mutation revision plus zero'
);
select pg_temp.reject(
  $q$update public.every8d_provider_configurations
     set site_url = 'synthetic-c2-new.example.invalid',
         credential_revision = 3,
         replaced_at = clock_timestamp() + interval '1 second'
   where id = '20000000-0000-4000-8000-000000000401'$q$,
  '23514', 'authority mutation revision plus two'
);
update public.every8d_provider_configurations
set site_url = 'synthetic-c2-new.example.invalid',
    uid_ciphertext = decode('c3', 'hex'),
    password_ciphertext = decode('d4', 'hex'),
    encryption_key_version = 'synthetic-v2',
    credential_revision = 2,
    replaced_at = clock_timestamp() + interval '1 second',
    credential_state = 'configured',
    last_validation_at = null,
    validation_failure_class = null,
    disconnected_at = null
where id = '20000000-0000-4000-8000-000000000401';
select pg_temp.assert_true(
  (select credential_revision = 2
    and credential_state = 'configured'
    and replaced_at is not null
   from public.every8d_provider_configurations
   where id = '20000000-0000-4000-8000-000000000401'),
  'authority replacement advances once and resets validation'
);
select pg_temp.reject(
  $q$update public.every8d_provider_configurations
     set site_url = 'synthetic-disconnect-change.example.invalid',
         credential_state = 'disconnected',
         uid_ciphertext = null,
         password_ciphertext = null,
         encryption_key_version = null,
         credential_revision = 3,
         disconnected_at = clock_timestamp(),
         safesay_enabled = false
   where id = '20000000-0000-4000-8000-000000000401'$q$,
  '23514', 'disconnect retains site URL and timeout authority'
);
update public.every8d_provider_configurations
set credential_state = 'disconnected',
    uid_ciphertext = null,
    password_ciphertext = null,
    encryption_key_version = null,
    credential_revision = 3,
    last_validation_at = null,
    validation_failure_class = null,
    disconnected_at = clock_timestamp(),
    safesay_enabled = false
where id = '20000000-0000-4000-8000-000000000401';
select pg_temp.assert_true(
  (select credential_state = 'disconnected'
    and credential_revision = 3
    and uid_ciphertext is null
    and password_ciphertext is null
    and encryption_key_version is null
    and not safesay_enabled
    and safesay_event_id = 'event-alpha'
   from public.every8d_provider_configurations
   where id = '20000000-0000-4000-8000-000000000401'),
  'disconnect scrubs once, disables SafeSay, and retains EventID'
);
update public.every8d_provider_configurations
set safesay_event_id = 'event-history'
where id = '20000000-0000-4000-8000-000000000401';
select pg_temp.assert_true(
  (select credential_revision = 3 and safesay_event_id = 'event-history'
   from public.every8d_provider_configurations
   where id = '20000000-0000-4000-8000-000000000401'),
  'disconnected SafeSay-only metadata does not increment revision'
);
select pg_temp.reject(
  $q$delete from public.every8d_provider_configurations
   where id = '20000000-0000-4000-8000-000000000401'$q$,
  '23514', 'configuration delete'
);

-- Parent eligibility: exact generation and registration are mandatory.
select pg_temp.reject(
  $q$select pg_temp.insert_configuration(
    '20000000-0000-4000-8000-000000000412',
    '10000000-0000-4000-8000-000000000401', 2)$q$,
  '23514', 'wrong installation generation'
);
select pg_temp.insert_parent(
  '10000000-0000-4000-8000-000000000402',
  '00000000-0000-4000-8000-000000000402',
  'c2-wrong-app', 'c2-company', 'pending', 1, 'INSTALL', null, 'c2-other-app'
);
select pg_temp.reject(
  $q$select pg_temp.insert_configuration(
    '20000000-0000-4000-8000-000000000402',
    '10000000-0000-4000-8000-000000000402', 1)$q$,
  '23514', 'unregistered app identity'
);
select pg_temp.insert_parent(
  '10000000-0000-4000-8000-000000000403',
  '00000000-0000-4000-8000-000000000403',
  'c2-wrong-provider', 'c2-company', 'pending', 1, 'INSTALL', null, null,
  'c2-other-provider'
);
select pg_temp.reject(
  $q$select pg_temp.insert_configuration(
    '20000000-0000-4000-8000-000000000403',
    '10000000-0000-4000-8000-000000000403', 1)$q$,
  '23514', 'unregistered conversation-provider identity'
);
select pg_temp.reject(
  $q$insert into public.ghl_marketplace_installations (
    marketplace_app_id, oauth_client_id, tenant_id, location_id,
    company_id, conversation_provider_id, channel, provider
  ) select marketplace_app_id, oauth_client_id,
    '00000000-0000-4000-8000-000000000403', 'c2-wrong-provider',
    'c2-company', conversation_provider_id, 'line', 'every8d'
  from c2_context$q$,
  '23514', 'wrong parent channel'
);
select pg_temp.reject(
  $q$insert into public.ghl_marketplace_installations (
    marketplace_app_id, oauth_client_id, tenant_id, location_id,
    company_id, conversation_provider_id, channel, provider
  ) select marketplace_app_id, oauth_client_id,
    '00000000-0000-4000-8000-000000000403', 'c2-wrong-provider',
    'c2-company', conversation_provider_id, 'sms', 'other'
  from c2_context$q$,
  '23514', 'wrong parent provider'
);
select pg_temp.insert_parent(
  '10000000-0000-4000-8000-000000000404',
  '00000000-0000-4000-8000-000000000404',
  'c2-no-company', null
);
select pg_temp.reject(
  $q$select pg_temp.insert_configuration(
    '20000000-0000-4000-8000-000000000404',
    '10000000-0000-4000-8000-000000000404', 1)$q$,
  '23514', 'missing company ownership'
);
select pg_temp.insert_parent(
  '10000000-0000-4000-8000-000000000405',
  '00000000-0000-4000-8000-000000000405',
  'c2-no-install', 'c2-company', 'pending', 1, null
);
select pg_temp.reject(
  $q$select pg_temp.insert_configuration(
    '20000000-0000-4000-8000-000000000405',
    '10000000-0000-4000-8000-000000000405', 1)$q$,
  '23514', 'missing INSTALL lifecycle evidence'
);
select pg_temp.insert_parent(
  '10000000-0000-4000-8000-000000000406',
  '00000000-0000-4000-8000-000000000406',
  'c2-disabled', 'c2-company', 'disabled'
);
select pg_temp.reject(
  $q$select pg_temp.insert_configuration(
    '20000000-0000-4000-8000-000000000406',
    '10000000-0000-4000-8000-000000000406', 1)$q$,
  '23514', 'disabled parent'
);
select pg_temp.insert_parent(
  '10000000-0000-4000-8000-000000000407',
  '00000000-0000-4000-8000-000000000407',
  'c2-uninstalled', 'c2-company', 'uninstalled', 1, 'UNINSTALL'
);
select pg_temp.reject(
  $q$select pg_temp.insert_configuration(
    '20000000-0000-4000-8000-000000000407',
    '10000000-0000-4000-8000-000000000407', 1)$q$,
  '23514', 'uninstalled parent'
);
select pg_temp.insert_parent(
  '10000000-0000-4000-8000-000000000408',
  '00000000-0000-4000-8000-000000000408',
  'c2-unregistered-version', 'c2-company', 'pending', 1, 'INSTALL',
  'c2.unregistered.version'
);
select pg_temp.reject(
  $q$select pg_temp.insert_configuration(
    '20000000-0000-4000-8000-000000000408',
    '10000000-0000-4000-8000-000000000408', 1)$q$,
  '23514', 'unregistered lifecycle version'
);

-- RLS, grants, and non-executable trigger functions.
set local role anon;
select pg_temp.reject(
  'select count(*) from public.every8d_provider_configurations',
  '42501', 'anon select'
);
reset role;
set local role authenticated;
select pg_temp.reject(
  'select count(*) from public.every8d_provider_configurations',
  '42501', 'authenticated select'
);
reset role;
set local role service_role;
select pg_temp.assert_true(
  (select count(*) >= 1 from public.every8d_provider_configurations),
  'service role SELECT policy'
);
select pg_temp.reject(
  $q$insert into public.every8d_provider_configurations (
    installation_id, installation_generation, site_url, credential_state,
    uid_ciphertext, password_ciphertext, encryption_key_version, credential_revision
  ) values (
    '10000000-0000-4000-8000-000000000401', 1, 'synthetic-c2.example.invalid',
    'configured', decode('a1','hex'), decode('b2','hex'), 'synthetic-v1', 1
  )$q$,
  '42501', 'service role insert'
);
select pg_temp.reject(
  $q$update public.every8d_provider_configurations
     set safesay_event_id = 'service-change'$q$,
  '42501', 'service role update'
);
select pg_temp.reject(
  'delete from public.every8d_provider_configurations',
  '42501', 'service role delete'
);
reset role;
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.every8d_provider_configurations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.every8d_provider_configurations', 'SELECT')
  and has_table_privilege('service_role', 'public.every8d_provider_configurations', 'SELECT')
  and not has_table_privilege('service_role', 'public.every8d_provider_configurations', 'INSERT')
  and not has_table_privilege('service_role', 'public.every8d_provider_configurations', 'UPDATE')
  and not has_table_privilege('service_role', 'public.every8d_provider_configurations', 'DELETE')
  and not has_function_privilege(
    'anon', 'public.protect_every8d_provider_configuration_v1()', 'EXECUTE')
  and not has_function_privilege(
    'authenticated', 'public.invalidate_every8d_provider_configuration_v1()', 'EXECUTE')
  and not has_function_privilege(
    'service_role', 'public.protect_every8d_provider_configuration_v1()', 'EXECUTE')
  and not has_function_privilege(
    'service_role', 'public.invalidate_every8d_provider_configuration_v1()', 'EXECUTE'),
  'table ACL and trigger function execution boundary'
);

-- Lifecycle with an empty C2 table remains valid.
set local role service_role;
select pg_temp.lifecycle(
  'INSTALL',
  '00000000-0000-4000-8000-000000000410',
  'c2-empty-lifecycle', 'c2-company',
  '2090-02-01T00:00:00Z', 'c2_empty_install'
);
select pg_temp.lifecycle(
  'UNINSTALL', null,
  'c2-empty-lifecycle', null,
  '2090-02-01T00:01:00Z', 'c2_empty_uninstall'
);
reset role;
select pg_temp.assert_true(
  exists (
    select 1 from public.ghl_marketplace_installations
    where location_id = 'c2-empty-lifecycle'
      and status = 'uninstalled'
  )
  and not exists (
    select 1
    from public.every8d_provider_configurations c
    join public.ghl_marketplace_installations i
      on i.id = c.installation_id
    where i.location_id = 'c2-empty-lifecycle'
  ),
  'lifecycle succeeds without a C2 configuration'
);

-- UNINSTALL atomically scrubs OAuth and provider credentials, then replay is inert.
set local role service_role;
select pg_temp.lifecycle(
  'INSTALL',
  '00000000-0000-4000-8000-000000000409',
  'c2-lifecycle', 'c2-company',
  '2090-03-01T00:00:00Z', 'c2_lifecycle_install'
);
update public.ghl_marketplace_installations
set access_token_ciphertext = decode('11', 'hex'),
    refresh_token_ciphertext = decode('22', 'hex'),
    encryption_key_version = 'synthetic-oauth-v1',
    token_expires_at = clock_timestamp() + interval '1 hour',
    granted_scopes = array['locations.readonly']
where location_id = 'c2-lifecycle';
reset role;
insert into public.every8d_provider_configurations (
  id, installation_id, installation_generation, site_url,
  credential_state, uid_ciphertext, password_ciphertext,
  encryption_key_version, credential_revision,
  safesay_enabled, safesay_event_id
)
select
  '20000000-0000-4000-8000-000000000409', id, installation_generation,
  'synthetic-lifecycle.example.invalid', 'configured',
  decode('31', 'hex'), decode('32', 'hex'), 'synthetic-provider-v1', 1,
  true, 'event-lifecycle'
from public.ghl_marketplace_installations
where location_id = 'c2-lifecycle';
set local role service_role;
select pg_temp.lifecycle(
  'UNINSTALL', null,
  'c2-lifecycle', null,
  '2090-03-01T00:01:00Z', 'c2_lifecycle_uninstall'
);
reset role;
select pg_temp.assert_true(
  (select status = 'uninstalled'
    and installation_generation = 2
    and credential_state = 'none'
    and access_token_ciphertext is null
    and refresh_token_ciphertext is null
   from public.ghl_marketplace_installations
   where location_id = 'c2-lifecycle')
  and
  (select credential_state = 'disconnected'
    and credential_revision = 2
    and site_url = 'synthetic-lifecycle.example.invalid'
    and timeout_ms = 10000
    and uid_ciphertext is null
    and password_ciphertext is null
    and encryption_key_version is null
    and not safesay_enabled
    and safesay_event_id = 'event-lifecycle'
   from public.every8d_provider_configurations
   where id = '20000000-0000-4000-8000-000000000409'),
  'UNINSTALL atomically scrubs OAuth/provider credentials and retains EventID'
);
set local role service_role;
select pg_temp.lifecycle(
  'UNINSTALL', null,
  'c2-lifecycle', null,
  '2090-03-01T00:01:00Z', 'c2_lifecycle_uninstall'
);
reset role;
select pg_temp.assert_true(
  (select credential_revision = 2
   from public.every8d_provider_configurations
   where id = '20000000-0000-4000-8000-000000000409'),
  'exact lifecycle replay does not increment disconnected revision'
);
set local role service_role;
select pg_temp.lifecycle(
  'INSTALL',
  '00000000-0000-4000-8000-000000000409',
  'c2-lifecycle', 'c2-company',
  '2090-03-01T00:02:00Z', 'c2_lifecycle_reinstall'
);
reset role;
select pg_temp.assert_true(
  (select status = 'pending' and installation_generation = 3
   from public.ghl_marketplace_installations
   where location_id = 'c2-lifecycle')
  and
  (select installation_generation = 1
    and credential_state = 'disconnected'
    and credential_revision = 2
   from public.every8d_provider_configurations
   where id = '20000000-0000-4000-8000-000000000409')
  and not exists (
    select 1
    from public.every8d_provider_configurations c
    join public.ghl_marketplace_installations i
      on i.id = c.installation_id
    where i.location_id = 'c2-lifecycle'
      and c.installation_generation = 3
  ),
  'generation advance leaves old row disconnected and creates no new credential'
);
select pg_temp.reject(
  $q$update public.every8d_provider_configurations
     set credential_state = 'configured',
         uid_ciphertext = decode('41','hex'),
         password_ciphertext = decode('42','hex'),
         encryption_key_version = 'synthetic-provider-v2',
         credential_revision = 3,
         replaced_at = clock_timestamp() + interval '1 minute',
         disconnected_at = null
   where id = '20000000-0000-4000-8000-000000000409'$q$,
  '23514', 'old generation cannot regain secrets'
);

-- A C2 scrub failure aborts the parent lifecycle and its OAuth scrub.
set local role service_role;
select pg_temp.lifecycle(
  'INSTALL',
  '00000000-0000-4000-8000-000000000411',
  'c2-rollback', 'c2-company',
  '2090-04-01T00:00:00Z', 'c2_rollback_install'
);
update public.ghl_marketplace_installations
set access_token_ciphertext = decode('51', 'hex'),
    refresh_token_ciphertext = decode('52', 'hex'),
    encryption_key_version = 'synthetic-oauth-v1',
    token_expires_at = clock_timestamp() + interval '1 hour',
    granted_scopes = array['locations.readonly']
where location_id = 'c2-rollback';
reset role;
insert into public.every8d_provider_configurations (
  id, installation_id, installation_generation, site_url,
  credential_state, uid_ciphertext, password_ciphertext,
  encryption_key_version, credential_revision, safesay_event_id
)
select
  '20000000-0000-4000-8000-000000000411', id, installation_generation,
  'synthetic-rollback.example.invalid', 'configured',
  decode('61', 'hex'), decode('62', 'hex'), 'synthetic-provider-v1', 1,
  'event-rollback'
from public.ghl_marketplace_installations
where location_id = 'c2-rollback';

create function public.c2_test_reject_provider_scrub()
returns trigger language plpgsql as $$
begin
  if old.id = '20000000-0000-4000-8000-000000000411'::uuid then
    raise exception 'synthetic C2 scrub failure' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger a_c2_test_reject_provider_scrub
before update on public.every8d_provider_configurations
for each row execute function public.c2_test_reject_provider_scrub();

select pg_temp.reject(
  $q$select pg_temp.lifecycle(
    'UNINSTALL', null, 'c2-rollback', null,
    '2090-04-01T00:01:00Z', 'c2_rollback_uninstall')$q$,
  '23514', 'provider scrub failure aborts lifecycle'
);
select pg_temp.assert_true(
  (select status = 'pending'
    and installation_generation = 1
    and credential_state = 'usable'
    and access_token_ciphertext is not null
    and refresh_token_ciphertext is not null
   from public.ghl_marketplace_installations
   where location_id = 'c2-rollback')
  and
  (select credential_state = 'configured'
    and credential_revision = 1
    and uid_ciphertext is not null
    and password_ciphertext is not null
   from public.every8d_provider_configurations
   where id = '20000000-0000-4000-8000-000000000411'),
  'scrub failure rolls back parent lifecycle and both credential sets'
);
drop trigger a_c2_test_reject_provider_scrub
  on public.every8d_provider_configurations;
drop function public.c2_test_reject_provider_scrub();

rollback;
\echo 'EVERY8D C2 provider configuration SQL proof passed'
