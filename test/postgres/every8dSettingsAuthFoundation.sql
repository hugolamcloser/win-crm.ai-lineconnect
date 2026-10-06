\set ON_ERROR_STOP on
\set VERBOSITY terse
-- Disposable PostgreSQL proof only. All identities and hashes are synthetic.
begin;

create function pg_temp.assert_true(actual boolean, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from true then
    raise exception 'C3a proof failed: %', label;
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
    raise exception 'C3a proof unexpected SQLSTATE %: %', sqlstate, label;
  end;
  raise exception 'C3a proof accepted forbidden operation: %', label;
end;
$$;

do $$
begin
  if not exists (
    select 1 from public.ghl_marketplace_app_registrations
    where app_namespace='every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_registrations(
      app_namespace,marketplace_app_id,oauth_client_id,
      conversation_provider_id,channel,provider
    ) values(
      'every8d_connect','c3a-synthetic-app','c3a.synthetic.client',
      'c3a-synthetic-provider','sms','every8d'
    );
  end if;
  if not exists (
    select 1 from public.ghl_marketplace_app_version_registrations
    where app_namespace='every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_version_registrations(
      app_namespace,marketplace_version_id
    ) values('every8d_connect','c3a.synthetic.version');
  end if;
end;
$$;

create temp table c3a_context as
select r.marketplace_app_id, r.oauth_client_id, r.conversation_provider_id,
  v.marketplace_version_id
from public.ghl_marketplace_app_registrations r
join public.ghl_marketplace_app_version_registrations v using (app_namespace)
where r.app_namespace = 'every8d_connect';

create function pg_temp.insert_parent(
  input_id uuid,
  input_tenant_id uuid,
  input_location_id text,
  input_status text default 'pending',
  input_generation integer default 1,
  input_credentials boolean default false
)
returns void language plpgsql as $$
declare
  context c3a_context%rowtype;
begin
  select * into context from c3a_context;
  insert into public.tenants(id, location_id, ghl_provider_id, line_channel_id)
  values (input_tenant_id, input_location_id, 'line-provider-' || input_location_id,
    'line-channel-' || input_location_id);
  insert into public.ghl_marketplace_installations (
    id, app_namespace, marketplace_app_id, oauth_client_id,
    tenant_id, location_id, company_id, conversation_provider_id,
    channel, provider, status, installation_generation,
    access_token_ciphertext, refresh_token_ciphertext, encryption_key_version,
    token_expires_at, granted_scopes, credential_revision, credential_state,
    latest_lifecycle_event_at, latest_lifecycle_event_id,
    latest_lifecycle_event_type, latest_lifecycle_version_id
  ) values (
    input_id, 'every8d_connect', context.marketplace_app_id, context.oauth_client_id,
    input_tenant_id, input_location_id, 'company-' || input_location_id,
    context.conversation_provider_id, 'sms', 'every8d', input_status,
    input_generation,
    case when input_credentials then decode('01', 'hex') else null end,
    case when input_credentials then decode('02', 'hex') else null end,
    case when input_credentials then 'synthetic-v1' else null end,
    case when input_credentials then clock_timestamp() + interval '1 minute' else null end,
    case when input_credentials then array['conversations/message.write'] else '{}'::text[] end,
    case when input_credentials then 1 else 0 end,
    case when input_credentials then 'usable' else 'none' end,
    '2095-01-01T00:00:00Z', 'c3a_install_' || replace(input_id::text, '-', '_'),
    'INSTALL', context.marketplace_version_id
  );
end;
$$;

select pg_temp.assert_true(
  (select array_agg(table_name::text order by table_name) = array[
    'every8d_settings_administrators',
    'every8d_settings_enrollment_grants',
    'every8d_settings_sessions'
  ]::text[]
  from information_schema.tables
  where table_schema = 'public' and table_name like 'every8d_settings_%'),
  'exactly three C3a tables exist'
);

select pg_temp.assert_true(
  (select array_agg(column_name::text order by ordinal_position) = array[
    'id','installation_id','installation_generation','normalized_email',
    'email_pseudonym','enrollment_method','enrollment_grant_id',
    'installer_user_hmac','installer_user_hmac_key_version','created_at',
    'revoked_at','revocation_reason'
  ]::text[] from information_schema.columns
  where table_schema='public' and table_name='every8d_settings_administrators'),
  'administrator columns are exact'
);

select pg_temp.assert_true(
  (select array_agg(column_name::text order by ordinal_position) = array[
    'id','token_hash','installation_id','installation_generation','method',
    'pinned_normalized_email','installer_user_hmac','installer_user_hmac_key_version',
    'oauth_bootstrap_reference','operator_issuer','operator_approver',
    'operator_case_reference','operator_reason','created_at','expires_at',
    'consumed_at','revoked_at','revocation_reason'
  ]::text[] from information_schema.columns
  where table_schema='public' and table_name='every8d_settings_enrollment_grants'),
  'grant columns are exact'
);

select pg_temp.assert_true(
  (select array_agg(column_name::text order by ordinal_position) = array[
    'id','token_hash','administrator_id','installation_id',
    'installation_generation','created_at','expires_at','revoked_at',
    'revocation_reason'
  ]::text[] from information_schema.columns
  where table_schema='public' and table_name='every8d_settings_sessions'),
  'session columns are exact'
);

select pg_temp.assert_true(
  (select not rolsuper and not rolbypassrls
   from pg_roles where rolname='c3a_migration_owner')
  and (select bool_and(c.relowner='c3a_migration_owner'::regrole)
    from pg_class c where c.oid in (
      'public.every8d_settings_administrators'::regclass,
      'public.every8d_settings_enrollment_grants'::regclass,
      'public.every8d_settings_sessions'::regclass
    ))
  and (select bool_and(p.proowner='c3a_migration_owner'::regrole)
    from pg_proc p where p.oid in (
      'public.issue_every8d_settings_install_callback_enrollment_grant_v1(uuid,integer,uuid,bytea,timestamptz,text,text)'::regprocedure,
      'public.redeem_every8d_settings_enrollment_grant_v1(bytea,text,text)'::regprocedure,
      'public.issue_every8d_settings_operator_enrollment_grant_v1(uuid,integer,text,bytea,text,timestamptz,text,text,text,text)'::regprocedure,
      'public.invalidate_every8d_settings_auth_v1()'::regprocedure
    )),
  'C3a owner-definer functions use a non-superuser non-BYPASSRLS owner'
);

select pg_temp.assert_true(
  (select bool_and(relrowsecurity and not relforcerowsecurity)
   from pg_class where oid in (
     'public.every8d_settings_administrators'::regclass,
     'public.every8d_settings_enrollment_grants'::regclass,
     'public.every8d_settings_sessions'::regclass
   )),
  'RLS is enabled and intentionally not forced on every C3a table'
);

select pg_temp.assert_true(
  not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename in (
        'every8d_settings_administrators',
        'every8d_settings_enrollment_grants',
        'every8d_settings_sessions'
      )
  ),
  'C3a installs no RLS policies'
);

select pg_temp.assert_true(
  not exists (
    select 1
    from pg_constraint c
    where c.contype='f'
      and c.conrelid='public.every8d_settings_enrollment_grants'::regclass
      and c.confrelid='public.ghl_marketplace_oauth_bootstraps'::regclass
  ),
  'C3a grant audit provenance has no OAuth bootstrap FK lock dependency'
);

select pg_temp.assert_true(
  not exists (
    select 1 from (values ('anon'),('authenticated'),('service_role')) roles(role_name)
    cross join (values
      ('public.every8d_settings_administrators'),
      ('public.every8d_settings_enrollment_grants'),
      ('public.every8d_settings_sessions')
    ) tables(table_name)
    where has_table_privilege(role_name, table_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) and not exists (
    select 1
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where c.oid in (
      'public.every8d_settings_administrators'::regclass,
      'public.every8d_settings_enrollment_grants'::regclass,
      'public.every8d_settings_sessions'::regclass
    ) and acl.grantee=0
  ),
  'application roles have no C3a table privileges'
);

select pg_temp.assert_true(
  not exists (
    select 1
    from (values ('anon'),('authenticated'),('service_role')) roles(role_name)
    cross join (values
      ('public.assert_every8d_settings_installation_eligible_v1(uuid,integer)'),
      ('public.protect_every8d_settings_enrollment_grant_v1()'),
      ('public.protect_every8d_settings_administrator_v1()'),
      ('public.protect_every8d_settings_session_v1()'),
      ('public.issue_every8d_settings_install_callback_enrollment_grant_v1(uuid,integer,uuid,bytea,timestamptz,text,text)'),
      ('public.redeem_every8d_settings_enrollment_grant_v1(bytea,text,text)'),
      ('public.issue_every8d_settings_operator_enrollment_grant_v1(uuid,integer,text,bytea,text,timestamptz,text,text,text,text)'),
      ('public.invalidate_every8d_settings_auth_v1()')
    ) functions(function_name)
    where has_function_privilege(role_name, function_name, 'EXECUTE')
  ) and not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid in (
      'public.assert_every8d_settings_installation_eligible_v1(uuid,integer)'::regprocedure,
      'public.protect_every8d_settings_enrollment_grant_v1()'::regprocedure,
      'public.protect_every8d_settings_administrator_v1()'::regprocedure,
      'public.protect_every8d_settings_session_v1()'::regprocedure,
      'public.issue_every8d_settings_install_callback_enrollment_grant_v1(uuid,integer,uuid,bytea,timestamptz,text,text)'::regprocedure,
      'public.redeem_every8d_settings_enrollment_grant_v1(bytea,text,text)'::regprocedure,
      'public.issue_every8d_settings_operator_enrollment_grant_v1(uuid,integer,text,bytea,text,timestamptz,text,text,text,text)'::regprocedure,
      'public.invalidate_every8d_settings_auth_v1()'::regprocedure
    ) and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ),
  'all C3a functions are migration-owner-only'
);

select pg_temp.assert_true(
  (select data_type = 'bytea' from information_schema.columns
   where table_schema='public' and table_name='every8d_settings_enrollment_grants'
     and column_name='token_hash')
  and (select data_type = 'bytea' from information_schema.columns
   where table_schema='public' and table_name='every8d_settings_sessions'
     and column_name='token_hash'),
  'token storage is binary hash only'
);

select pg_temp.insert_parent(
  '31000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001', 'c3a-proof-one'
);
select pg_temp.insert_parent(
  '31000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002', 'c3a-proof-two'
);
select pg_temp.insert_parent(
  '31000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000003', 'c3a-proof-disabled', 'disabled'
);
select pg_temp.insert_parent(
  '31000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000004', 'c3a-proof-uninstalled', 'uninstalled'
);
select pg_temp.insert_parent(
  '31000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000005', 'c3a-proof-refresh', 'pending', 1, true
);

create function pg_temp.create_bootstrap(
  input_id uuid,
  input_installation_id uuid,
  input_location_id text,
  input_generation integer,
  input_succeeded boolean
)
returns void language plpgsql as $$
declare
  context c3a_context%rowtype;
  synthetic_hash text := replace(input_id::text, '-', '')
    || replace(input_id::text, '-', '');
begin
  select * into context from c3a_context;
  insert into public.ghl_marketplace_oauth_bootstraps(
    id, marketplace_version_id, expected_location_id,
    target_installation_generation, state_hash, browser_binding_hash,
    redirect_uri, config_fingerprint, status, expires_at,
    authorization_code_ciphertext, authorization_code_key_version,
    claimed_installation_id, claimed_installation_generation
  ) values (
    input_id, context.marketplace_version_id, input_location_id,
    input_generation, synthetic_hash, reverse(synthetic_hash),
    'https://example.invalid/callback', synthetic_hash, 'ready',
    clock_timestamp()+interval '10 minutes', decode('01','hex'),
    'synthetic-v1', input_installation_id, input_generation
  );
  if input_succeeded then
    update public.ghl_marketplace_oauth_bootstraps
    set status='exchanging', exchange_started_at=clock_timestamp()
    where id=input_id;
    update public.ghl_marketplace_oauth_bootstraps
    set status='succeeded', terminal_at=clock_timestamp(),
        authorization_code_ciphertext=null,
        authorization_code_key_version=null
    where id=input_id;
  end if;
end;
$$;

select pg_temp.create_bootstrap(
  '32000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001', 'c3a-proof-one', 1, true
);
select pg_temp.create_bootstrap(
  '32000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000002', 'c3a-proof-two', 1, false
);

select pg_temp.reject($sql$
  insert into public.every8d_settings_enrollment_grants(
    token_hash,installation_id,installation_generation,method,
    oauth_bootstrap_reference,installer_user_hmac,
    installer_user_hmac_key_version,expires_at
  ) values (decode(repeat('41',32),'hex'),
    '31000000-0000-4000-8000-000000000001',1,'install_callback',
    '32900000-0000-4000-8000-000000000001',repeat('a',64),null,
    clock_timestamp()+interval '5 minutes')
$sql$, '23514', 'grant rejects HMAC value/null');
select pg_temp.reject($sql$
  insert into public.every8d_settings_enrollment_grants(
    token_hash,installation_id,installation_generation,method,
    oauth_bootstrap_reference,installer_user_hmac,
    installer_user_hmac_key_version,expires_at
  ) values (decode(repeat('42',32),'hex'),
    '31000000-0000-4000-8000-000000000001',1,'install_callback',
    '32900000-0000-4000-8000-000000000002',null,'synthetic-v1',
    clock_timestamp()+interval '5 minutes')
$sql$, '23514', 'grant rejects HMAC null/value');
select pg_temp.reject($sql$
  insert into public.every8d_settings_enrollment_grants(
    token_hash,installation_id,installation_generation,method,
    pinned_normalized_email,installer_user_hmac,
    installer_user_hmac_key_version,expires_at
  ) values (decode(repeat('43',32),'hex'),
    '31000000-0000-4000-8000-000000000001',1,'operator_initial',
    'mixed@example.invalid',repeat('b',64),'synthetic-v1',
    clock_timestamp()+interval '5 minutes')
$sql$, '23514', 'operator grant rejects callback HMAC provenance');
select pg_temp.reject($sql$
  insert into public.every8d_settings_enrollment_grants(
    token_hash,installation_id,installation_generation,method,
    installer_user_hmac,installer_user_hmac_key_version,expires_at
  ) values (decode(repeat('44',32),'hex'),
    '31000000-0000-4000-8000-000000000001',1,'install_callback',
    repeat('c',64),'synthetic-v1',clock_timestamp()+interval '5 minutes')
$sql$, '23514', 'install callback grant requires bootstrap provenance');

select pg_temp.reject($sql$
  select * from public.issue_every8d_settings_install_callback_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000002',1,
    '32000000-0000-4000-8000-000000000001',decode(repeat('45',32),'hex'),
    clock_timestamp()+interval '5 minutes',repeat('d',64),'synthetic-v1')
$sql$, '23514', 'install callback rejects bootstrap from another installation');
select pg_temp.reject($sql$
  select * from public.issue_every8d_settings_install_callback_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000001',2,
    '32000000-0000-4000-8000-000000000001',decode(repeat('46',32),'hex'),
    clock_timestamp()+interval '5 minutes',repeat('d',64),'synthetic-v1')
$sql$, '23514', 'install callback rejects bootstrap from another generation');
select pg_temp.reject($sql$
  select * from public.issue_every8d_settings_install_callback_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000002',1,
    '32000000-0000-4000-8000-000000000002',decode(repeat('47',32),'hex'),
    clock_timestamp()+interval '5 minutes',repeat('d',64),'synthetic-v1')
$sql$, '23514', 'install callback rejects non-succeeded bootstrap');

select pg_temp.reject($sql$
  select * from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000001', 1, 'admin@example.invalid',
    decode(repeat('01',32),'hex'), 'install_callback', clock_timestamp()+interval '5 minutes',
    'issuer-a','approver-a','CASE-1','synthetic reason')
$sql$, '23514', 'operator RPC rejects install_callback');
select pg_temp.reject($sql$
  select * from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000001', 1, 'admin@example.invalid',
    decode(repeat('02',32),'hex'), 'operator_initial', clock_timestamp()+interval '5 minutes',
    'same','same','CASE-2','synthetic reason')
$sql$, '23514', 'operator RPC enforces dual control');
select pg_temp.reject($sql$
  select * from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000001', 1, 'admin@example.invalid',
    decode(repeat('03',32),'hex'), 'operator_initial', clock_timestamp()+interval '5 minutes',
    'issuer-a','approver-a','', '')
$sql$, '23514', 'operator RPC requires case and reason');
select pg_temp.reject($sql$
  select * from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000001', 2, 'admin@example.invalid',
    decode(repeat('04',32),'hex'), 'operator_initial', clock_timestamp()+interval '5 minutes',
    'issuer-a','approver-a','CASE-4','synthetic reason')
$sql$, '23514', 'operator RPC rejects old or wrong generation');
select pg_temp.reject($sql$
  select * from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000003', 1, 'admin@example.invalid',
    decode(repeat('05',32),'hex'), 'operator_initial', clock_timestamp()+interval '5 minutes',
    'issuer-a','approver-a','CASE-5','synthetic reason')
$sql$, '23514', 'operator RPC rejects disabled installation');
select pg_temp.reject($sql$
  select * from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000004', 1, 'admin@example.invalid',
    decode(repeat('06',32),'hex'), 'operator_initial', clock_timestamp()+interval '5 minutes',
    'issuer-a','approver-a','CASE-6','synthetic reason')
$sql$, '23514', 'operator RPC rejects uninstalled installation');
select pg_temp.reject($sql$
  select * from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000001', 1, 'admin@example.invalid',
    decode('abcd','hex'), 'operator_initial', clock_timestamp()+interval '5 minutes',
    'issuer-a','approver-a','CASE-7','synthetic reason')
$sql$, '23514', 'operator RPC rejects malformed hash');
select pg_temp.reject($sql$
  select * from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000001', 1, 'admin@example.invalid',
    decode(repeat('08',32),'hex'), 'operator_initial', clock_timestamp()+interval '16 minutes',
    'issuer-a','approver-a','CASE-8','synthetic reason')
$sql$, '23514', 'operator RPC rejects expiry over fifteen minutes');

do $$
declare
  callback_grant uuid;
  callback_administrator uuid;
begin
  select grant_id into callback_grant
  from public.issue_every8d_settings_install_callback_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000001',1,
    '32000000-0000-4000-8000-000000000001',decode(repeat('48',32),'hex'),
    clock_timestamp()+interval '10 minutes',repeat('d',64),'synthetic-v1');
  select administrator_id into callback_administrator
  from public.redeem_every8d_settings_enrollment_grant_v1(
    decode(repeat('48',32),'hex'),'callback@example.invalid',
    'pseudo-callback-valid');

  perform pg_temp.assert_true(
    (select a.enrollment_grant_id=callback_grant
      and a.installer_user_hmac=g.installer_user_hmac
      and a.installer_user_hmac_key_version=g.installer_user_hmac_key_version
      and g.consumed_at is not null
      from public.every8d_settings_administrators a
      join public.every8d_settings_enrollment_grants g
        on g.id=a.enrollment_grant_id
      where a.id=callback_administrator),
    'redemption copies callback HMAC provenance from the locked grant');

  perform pg_temp.reject(format($sql$
    insert into public.every8d_settings_administrators(
      installation_id,installation_generation,normalized_email,email_pseudonym,
      enrollment_method,enrollment_grant_id,installer_user_hmac,
      installer_user_hmac_key_version
    ) values ('31000000-0000-4000-8000-000000000001',1,
      'callback@example.invalid','pseudo-callback-one','install_callback',%L,
      repeat('d',64),null)
  $sql$, callback_grant), '23514', 'administrator rejects HMAC value/null');
  perform pg_temp.reject(format($sql$
    insert into public.every8d_settings_administrators(
      installation_id,installation_generation,normalized_email,email_pseudonym,
      enrollment_method,enrollment_grant_id,installer_user_hmac,
      installer_user_hmac_key_version
    ) values ('31000000-0000-4000-8000-000000000001',1,
      'callback@example.invalid','pseudo-callback-two','install_callback',%L,
      null,'synthetic-v1')
  $sql$, callback_grant), '23514', 'administrator rejects HMAC null/value');
  perform pg_temp.reject(format($sql$
    insert into public.every8d_settings_administrators(
      installation_id,installation_generation,normalized_email,email_pseudonym,
      enrollment_method,enrollment_grant_id,installer_user_hmac,
      installer_user_hmac_key_version
    ) values ('31000000-0000-4000-8000-000000000001',1,
      'callback@example.invalid','pseudo-callback-mismatch','install_callback',%L,
      repeat('e',64),'synthetic-v1')
  $sql$, callback_grant), '23514', 'administrator rejects callback HMAC mismatch');

end;
$$;

do $$
declare
  issued_grant uuid;
  redeemed_administrator uuid;
begin
  select grant_id into issued_grant
  from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000002',1,'redeem@example.invalid',
    decode(repeat('49',32),'hex'),'operator_initial',
    clock_timestamp()+interval '10 minutes','issuer-z','approver-z',
    'CASE-REDEEM','one-time redemption proof');
  select administrator_id into redeemed_administrator
  from public.redeem_every8d_settings_enrollment_grant_v1(
    decode(repeat('49',32),'hex'),'redeem@example.invalid','pseudo-redeem');

  perform pg_temp.reject($sql$
    select * from public.redeem_every8d_settings_enrollment_grant_v1(
      decode(repeat('49',32),'hex'),'redeem@example.invalid','pseudo-reuse')
  $sql$, '23514', 'consumed grant cannot be redeemed twice');
  perform pg_temp.reject(format($sql$
    insert into public.every8d_settings_administrators(
      installation_id,installation_generation,normalized_email,email_pseudonym,
      enrollment_method,enrollment_grant_id
    ) values ('31000000-0000-4000-8000-000000000002',1,
      'different@example.invalid','pseudo-different','operator_initial',%L)
  $sql$, issued_grant), '23514', 'same grant cannot bind a different email');

  update public.every8d_settings_administrators
  set revoked_at=clock_timestamp(),revocation_reason='operator_recovery'
  where id=redeemed_administrator;
  perform pg_temp.reject(format($sql$
    insert into public.every8d_settings_administrators(
      installation_id,installation_generation,normalized_email,email_pseudonym,
      enrollment_method,enrollment_grant_id
    ) values ('31000000-0000-4000-8000-000000000002',1,
      'redeem@example.invalid','pseudo-reuse-after-revoke','operator_initial',%L)
  $sql$, issued_grant), '23505', 'revoked administrator does not recycle its grant');
  perform pg_temp.reject($sql$
    select * from public.redeem_every8d_settings_enrollment_grant_v1(
      decode(repeat('49',32),'hex'),'redeem@example.invalid','pseudo-reuse-two')
  $sql$, '23514', 'revoked administrator grant remains consumed');
end;
$$;

do $$
declare
  initial_id uuid;
  recovery_id uuid;
  consumed_id uuid;
  expired_id uuid := '32900000-0000-4000-8000-000000000015';
  other_email_id uuid;
  other_installation_id uuid;
  first_admin_id uuid := '33000000-0000-4000-8000-000000000001';
begin
  insert into public.every8d_settings_enrollment_grants(
    id,token_hash,installation_id,installation_generation,method,
    pinned_normalized_email,operator_issuer,operator_approver,
    operator_case_reference,operator_reason,created_at,expires_at
  ) values (
    expired_id,decode(repeat('10',32),'hex'),
    '31000000-0000-4000-8000-000000000001',1,'operator_initial',
    'admin@example.invalid','issuer-old','approver-old','CASE-OLD',
    'expired history proof',clock_timestamp()-interval '20 minutes',
    clock_timestamp()-interval '10 minutes'
  );
  select grant_id into initial_id
  from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000001', 1, 'admin@example.invalid',
    decode(repeat('11',32),'hex'), 'operator_initial', clock_timestamp()+interval '10 minutes',
    'issuer-a','approver-a','CASE-11','initial enrollment proof');
  select grant_id into other_email_id
  from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000001', 1, 'other@example.invalid',
    decode(repeat('12',32),'hex'), 'operator_initial', clock_timestamp()+interval '10 minutes',
    'issuer-a','approver-a','CASE-12','other email proof');
  select grant_id into other_installation_id
  from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000002', 1, 'admin@example.invalid',
    decode(repeat('13',32),'hex'), 'operator_initial', clock_timestamp()+interval '10 minutes',
    'issuer-a','approver-a','CASE-13','other installation proof');
  select grant_id into recovery_id
  from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000001', 1, 'admin@example.invalid',
    decode(repeat('14',32),'hex'), 'operator_recovery', clock_timestamp()+interval '10 minutes',
    'issuer-b','approver-b','CASE-14','recovery enrollment proof');

  perform pg_temp.assert_true(
    (select revoked_at is not null and revocation_reason='operator_grant_superseded'
     from public.every8d_settings_enrollment_grants where id=initial_id),
    'reissue revokes older matching unused grant');
  perform pg_temp.assert_true(
    (select revoked_at is null from public.every8d_settings_enrollment_grants
     where id=expired_id)
    and
    (select revoked_at is null from public.every8d_settings_enrollment_grants where id=other_email_id)
    and (select revoked_at is null from public.every8d_settings_enrollment_grants where id=other_installation_id),
    'reissue leaves expired, other-email, and other-installation grants unchanged');

  update public.every8d_settings_enrollment_grants
  set consumed_at=clock_timestamp() where id=recovery_id;
  consumed_id := recovery_id;
  insert into public.every8d_settings_administrators(
    id, installation_id, installation_generation, normalized_email,
    email_pseudonym, enrollment_method, enrollment_grant_id
  ) values (
    first_admin_id, '31000000-0000-4000-8000-000000000001', 1,
    'admin@example.invalid', 'pseudo-admin-one', 'operator_recovery', recovery_id
  );

  select grant_id into recovery_id
  from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000001', 1, 'admin@example.invalid',
    decode(repeat('15',32),'hex'), 'operator_recovery', clock_timestamp()+interval '10 minutes',
    'issuer-c','approver-c','CASE-15','duplicate administrator proof');
  perform pg_temp.assert_true(
    (select consumed_at is not null and revoked_at is null
     from public.every8d_settings_enrollment_grants where id=consumed_id),
    'reissue preserves consumed grant history');
  update public.every8d_settings_enrollment_grants
  set consumed_at=clock_timestamp() where id=recovery_id;

  perform pg_temp.reject(format($sql$
    insert into public.every8d_settings_administrators(
      installation_id, installation_generation, normalized_email,
      email_pseudonym, enrollment_method, enrollment_grant_id
    ) values ('31000000-0000-4000-8000-000000000001',1,'admin@example.invalid',
      'pseudo-duplicate','operator_recovery',%L)
  $sql$, recovery_id), '23505', 'active administrator email is unique');

  update public.every8d_settings_administrators
  set revoked_at=clock_timestamp(), revocation_reason='operator_recovery'
  where id=first_admin_id;
  insert into public.every8d_settings_administrators(
    installation_id, installation_generation, normalized_email,
    email_pseudonym, enrollment_method, enrollment_grant_id
  ) values (
    '31000000-0000-4000-8000-000000000001',1,'admin@example.invalid',
    'pseudo-admin-two','operator_recovery',recovery_id
  );
end;
$$;

select pg_temp.assert_true(
  (select count(*)=2 from public.every8d_settings_administrators
   where installation_id='31000000-0000-4000-8000-000000000001'
     and normalized_email='admin@example.invalid')
  and (select count(*)=1 from public.every8d_settings_administrators
   where installation_id='31000000-0000-4000-8000-000000000001'
     and normalized_email='admin@example.invalid' and revoked_at is null),
  'revoked administrator permits deliberate re-enrollment'
);

select pg_temp.reject($sql$
  update public.every8d_settings_administrators
  set normalized_email='changed@example.invalid'
  where installation_id='31000000-0000-4000-8000-000000000001' and revoked_at is null
$sql$, '23514', 'administrator identity is immutable');

do $$
declare
  active_admin uuid;
begin
  select id into active_admin from public.every8d_settings_administrators
  where installation_id='31000000-0000-4000-8000-000000000001' and revoked_at is null;
  insert into public.every8d_settings_sessions(
    token_hash, administrator_id, installation_id, installation_generation, expires_at
  ) values (
    decode(repeat('21',32),'hex'), active_admin,
    '31000000-0000-4000-8000-000000000001',1,clock_timestamp()+interval '30 minutes'
  );
  perform pg_temp.reject(format($sql$
    insert into public.every8d_settings_sessions(
      token_hash,administrator_id,installation_id,installation_generation,expires_at
    ) values (decode(repeat('22',32),'hex'),%L,
      '31000000-0000-4000-8000-000000000002',1,clock_timestamp()+interval '30 minutes')
  $sql$, active_admin), '23514', 'session rejects administrator-installation mismatch');
  perform pg_temp.reject(format($sql$
    insert into public.every8d_settings_sessions(
      token_hash,administrator_id,installation_id,installation_generation,expires_at
    ) values (decode(repeat('23',32),'hex'),%L,
      '31000000-0000-4000-8000-000000000001',1,clock_timestamp()+interval '61 minutes')
  $sql$, active_admin), '23514', 'session rejects lifetime over one hour');
  perform pg_temp.reject(format($sql$
    insert into public.every8d_settings_sessions(
      token_hash,administrator_id,installation_id,installation_generation,expires_at
    ) values (decode(repeat('21',32),'hex'),%L,
      '31000000-0000-4000-8000-000000000001',1,clock_timestamp()+interval '20 minutes')
  $sql$, active_admin), '23505', 'session token hash is unique');
end;
$$;

select pg_temp.reject($sql$
  insert into public.every8d_settings_enrollment_grants(
    token_hash,installation_id,installation_generation,method,expires_at
  ) values (convert_to('plaintext-token','utf8'),
    '31000000-0000-4000-8000-000000000001',1,'install_callback',
    clock_timestamp()+interval '5 minutes')
$sql$, '23514', 'plaintext token cannot satisfy fixed hash storage');

-- Create a settings session on an OAuth-usable parent, then prove an ordinary
-- C1b refresh claim changes refresh state without invoking C3 invalidation.
do $$
declare
  grant_row uuid;
  admin_row uuid := '33000000-0000-4000-8000-000000000005';
  context c3a_context%rowtype;
  claim_result jsonb;
begin
  select * into context from c3a_context;
  select grant_id into grant_row
  from public.issue_every8d_settings_operator_enrollment_grant_v1(
    '31000000-0000-4000-8000-000000000005',1,'refresh@example.invalid',
    decode(repeat('31',32),'hex'),'operator_initial',clock_timestamp()+interval '10 minutes',
    'issuer-r','approver-r','CASE-31','refresh non-interference proof');
  update public.every8d_settings_enrollment_grants set consumed_at=clock_timestamp()
  where id=grant_row;
  insert into public.every8d_settings_administrators(
    id,installation_id,installation_generation,normalized_email,email_pseudonym,
    enrollment_method,enrollment_grant_id
  ) values (admin_row,'31000000-0000-4000-8000-000000000005',1,
    'refresh@example.invalid','pseudo-refresh','operator_initial',grant_row);
  insert into public.every8d_settings_sessions(
    token_hash,administrator_id,installation_id,installation_generation,expires_at
  ) values (decode(repeat('32',32),'hex'),admin_row,
    '31000000-0000-4000-8000-000000000005',1,clock_timestamp()+interval '30 minutes');
  select public.claim_every8d_ghl_oauth_refresh_v1(
    '31000000-0000-4000-8000-000000000005',context.marketplace_app_id,
    context.oauth_client_id,'30000000-0000-4000-8000-000000000005',
    'c3a-proof-refresh','company-c3a-proof-refresh',context.conversation_provider_id,
    context.marketplace_version_id,1
  ) into claim_result;
  perform pg_temp.assert_true(claim_result is not null, 'refresh claim succeeds');
  perform pg_temp.assert_true(
    (select revoked_at is null from public.every8d_settings_sessions
     where administrator_id=admin_row),
    'OAuth refresh does not revoke C3 session');
end;
$$;

rollback;
