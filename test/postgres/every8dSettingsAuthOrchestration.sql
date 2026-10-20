\set ON_ERROR_STOP on
\set VERBOSITY terse
-- Disposable PostgreSQL 17 proof only. All values are synthetic.
begin;

create function pg_temp.assert_true(actual boolean, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from true then
    raise exception 'C3b-3 proof failed: %', label;
  end if;
end;
$$;

create function pg_temp.reject(statement text, expected_state text, label text)
returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise exception 'C3b-3 proof unexpected SQLSTATE %: %', sqlstate, label;
  end;
  raise exception 'C3b-3 proof accepted forbidden operation: %', label;
end;
$$;

create function pg_temp.assert_rate_rejected(
  aliases text[], grant_id uuid, captured_at timestamptz, label text
) returns void language plpgsql as $$
begin
  begin
    perform public.assert_every8d_settings_challenge_rate_limits_v1(
      aliases, grant_id, captured_at
    );
  exception when sqlstate 'P0001' then
    return;
  end;
  raise exception 'C3b-3 proof accepted rate-limited operation: %', label;
end;
$$;

create function pg_temp.append_challenge_failures(
  input_challenge_id uuid, input_failure_count integer
) returns void language plpgsql as $$
declare
  challenge_row public.every8d_settings_auth_challenges%rowtype;
  existing_count integer;
  attempt_n integer;
begin
  select c.* into challenge_row
  from public.every8d_settings_auth_challenges c
  where c.id=input_challenge_id for update of c;
  perform pg_temp.assert_true(
    challenge_row.id is not null and challenge_row.delivery_succeeded_at is not null
    and challenge_row.delivery_failed_at is null and challenge_row.locked_at is null
    and challenge_row.superseded_at is null and challenge_row.verified_at is null
    and challenge_row.consumed_at is null
    and challenge_row.delivery_succeeded_at<challenge_row.expires_at
    and pg_catalog.clock_timestamp()<challenge_row.expires_at,
    'failure fixture must be LIVE with persisted delivery before expiry');
  select count(*)::integer into existing_count
  from public.every8d_settings_auth_challenge_failures f
  where f.challenge_id=input_challenge_id;
  perform pg_temp.assert_true(
    input_failure_count between 1 and 5 and existing_count<input_failure_count,
    'failure fixture appends only the next attempts up to five');

  -- C3b-1 permits failure-equal-delivery and nondecreasing ledger timestamps.
  -- Use the persisted row, never an old capture or an invented future time.
  -- Each INSERT completes its immediate triggers before the next attempt.
  for attempt_n in (existing_count+1)..input_failure_count loop
    insert into public.every8d_settings_auth_challenge_failures(
      challenge_id,attempt_number,failed_at
    ) values (input_challenge_id,attempt_n,challenge_row.delivery_succeeded_at);
  end loop;
  perform pg_temp.assert_true(
    (select count(*)=input_failure_count
      and array_agg(f.attempt_number order by f.attempt_number)
        =array(select generate_series(1,input_failure_count))
      and bool_and(f.failed_at=challenge_row.delivery_succeeded_at
        and f.failed_at<challenge_row.expires_at)
    from public.every8d_settings_auth_challenge_failures f
    where f.challenge_id=input_challenge_id)
    and (select case when input_failure_count=5 then
        c.locked_at=challenge_row.delivery_succeeded_at
        and c.normalized_email is null and c.email_scrubbed_at=c.locked_at
      else c.locked_at is null end
    from public.every8d_settings_auth_challenges c where c.id=input_challenge_id),
    'ordered failure fixture preserves chronology and database-owned fifth lock');
end;
$$;

create function pg_temp.assert_static_enrollment_parity(
  v1_statement text, v2_statement text, label text
) returns void language plpgsql as $$
declare
  v1_rejected boolean := false;
  v2_rejected boolean := false;
begin
  begin
    execute v1_statement;
  exception when sqlstate '23514' then
    v1_rejected := true;
  end;
  begin
    execute v2_statement;
  exception when sqlstate '23514' then
    v2_rejected := true;
  end;
  if not v1_rejected or not v2_rejected then
    raise exception 'C3b-3 static enrollment parity failed: %', label;
  end if;
end;
$$;

create function pg_temp.assert_expected_enrollment_negative_parity(
  v1_statement text, v2_statement text, v1_expected_state text, label text
) returns void language plpgsql as $$
declare
  v1_rejected boolean := false;
  v2_count bigint;
begin
  begin
    execute v1_statement;
  exception when others then
    if sqlstate <> v1_expected_state then
      raise exception 'C3b-3 enrollment parity unexpected v1 SQLSTATE %: %',
        sqlstate, label;
    end if;
    v1_rejected := true;
  end;
  if not v1_rejected then
    raise exception 'C3b-3 enrollment parity accepted v1 negative: %', label;
  end if;
  execute 'select count(*) from (' || v2_statement || ') parity_v2' into v2_count;
  if v2_count <> 0 then
    raise exception 'C3b-3 enrollment parity disclosed v2 negative: %', label;
  end if;
end;
$$;

-- Exact inventory, argument names, authority, and ACLs.
select pg_temp.assert_true((
  select count(*) = 8
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'runtime_request_every8d_settings_enrollment_challenge_v1',
    'runtime_request_every8d_settings_login_challenge_v1',
    'runtime_record_every8d_settings_challenge_delivery_v1',
    'runtime_discover_every8d_settings_challenge_v1',
    'runtime_verify_every8d_settings_challenge_v1',
    'request_every8d_settings_enrollment_challenge_core_v2',
    'request_every8d_settings_login_challenge_core_v2',
    'verify_every8d_settings_challenge_core_v2'
  )
), 'exactly eight target functions');

select pg_temp.assert_true((
  select count(*) = 8
  from (values
    ('public.runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)',
      array['input_enrollment_grant_token_hash','input_challenge_id','input_normalized_email','input_email_pseudonym','input_email_pseudonym_aliases','input_request_token_hash','input_otp_hmac','input_otp_hmac_key_version']::text[], 0),
    ('public.runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)',
      array['input_challenge_id','input_normalized_email','input_email_pseudonym','input_email_pseudonym_aliases','input_request_token_hash','input_otp_hmac','input_otp_hmac_key_version']::text[], 0),
    ('public.runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)',
      array['input_request_token_hash','input_succeeded','input_failure_class']::text[], 1),
    ('public.runtime_discover_every8d_settings_challenge_v1(bytea,text)',
      array['input_request_token_hash','input_purpose']::text[], 0),
    ('public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)',
      array['input_request_token_hash','input_purpose','input_email_pseudonym_aliases','input_candidate_otp_hmac']::text[], 0),
    ('public.request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)',
      array['input_enrollment_grant_token_hash','input_challenge_id','input_normalized_email','input_email_pseudonym','input_email_pseudonym_aliases','input_request_token_hash','input_otp_hmac','input_otp_hmac_key_version']::text[], 0),
    ('public.request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)',
      array['input_challenge_id','input_normalized_email','input_email_pseudonym','input_email_pseudonym_aliases','input_request_token_hash','input_otp_hmac','input_otp_hmac_key_version']::text[], 0),
    ('public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)',
      array['input_request_token_hash','input_purpose','input_email_pseudonym_aliases','input_candidate_otp_hmac']::text[], 0)
  ) expected(signature, input_names, default_count)
  join pg_proc p on p.oid = to_regprocedure(expected.signature)
  where p.proargnames[1:p.pronargs] = expected.input_names
    and p.pronargdefaults = expected.default_count
    and p.prosecdef
    and p.proconfig = array['search_path=pg_catalog, public']::text[]
), 'exact signatures, names, defaults, definer mode, and search path');

select pg_temp.assert_true((
  select count(*) = 8
  from (values
    ('public.runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)',
      'TABLE(challenge_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone)'),
    ('public.runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)',
      'TABLE(challenge_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone)'),
    ('public.runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)',
      'boolean'),
    ('public.runtime_discover_every8d_settings_challenge_v1(bytea,text)',
      'TABLE(challenge_id uuid, enrollment_grant_id uuid, normalized_email text, email_pseudonym text, otp_hmac_key_version text)'),
    ('public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)',
      'boolean'),
    ('public.request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)',
      'TABLE(challenge_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone)'),
    ('public.request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)',
      'TABLE(challenge_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone)'),
    ('public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)',
      'boolean')
  ) expected(signature, result_shape)
  join pg_proc p on p.oid = to_regprocedure(expected.signature)
  where pg_get_function_result(p.oid) = expected.result_shape
), 'exact return shapes');

select pg_temp.assert_true((
  select count(distinct p.proowner) = 1
    and bool_and(p.proowner = ('c3a_migration_owner'::regrole)::oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'runtime_request_every8d_settings_enrollment_challenge_v1',
    'runtime_request_every8d_settings_login_challenge_v1',
    'runtime_record_every8d_settings_challenge_delivery_v1',
    'runtime_discover_every8d_settings_challenge_v1',
    'runtime_verify_every8d_settings_challenge_v1',
    'request_every8d_settings_enrollment_challenge_core_v2',
    'request_every8d_settings_login_challenge_core_v2',
    'verify_every8d_settings_challenge_core_v2'
  )
), 'one trusted common owner');

select pg_temp.assert_true(
  (select count(*) = 5 from (values
    ('public.runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)'),
    ('public.runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)'),
    ('public.runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)'),
    ('public.runtime_discover_every8d_settings_challenge_v1(bytea,text)'),
    ('public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)')
  ) f(signature) where has_function_privilege('service_role', f.signature, 'execute'))
  and not has_function_privilege('service_role',
    'public.request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)','execute')
  and not has_function_privilege('service_role',
    'public.request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)','execute')
  and not has_function_privilege('service_role',
    'public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)','execute'),
  'exactly five service wrapper grants and zero core grants');

select pg_temp.assert_true(not exists (
  select 1
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  where n.nspname='public' and p.proname in (
    'runtime_request_every8d_settings_enrollment_challenge_v1',
    'runtime_request_every8d_settings_login_challenge_v1',
    'runtime_record_every8d_settings_challenge_delivery_v1',
    'runtime_discover_every8d_settings_challenge_v1',
    'runtime_verify_every8d_settings_challenge_v1',
    'request_every8d_settings_enrollment_challenge_core_v2',
    'request_every8d_settings_login_challenge_core_v2',
    'verify_every8d_settings_challenge_core_v2'
  ) and acl.privilege_type='EXECUTE'
    and (acl.grantee=0 or acl.grantee in (
      ('anon'::regrole)::oid,('authenticated'::regrole)::oid))
), 'PUBLIC, anon, and authenticated have zero target execute');

select pg_temp.assert_true(not exists (
  select 1 from (values ('anon'),('authenticated'),('service_role')) r(role_name)
  cross join (values
    ('public.every8d_settings_enrollment_grants'),
    ('public.every8d_settings_administrators'),
    ('public.every8d_settings_sessions'),
    ('public.every8d_settings_auth_challenges'),
    ('public.every8d_settings_auth_challenge_failures')
  ) t(relation_name)
  where has_table_privilege(r.role_name, t.relation_name,
    'select,insert,update,delete,truncate,references,trigger')
) and not exists (
  select 1 from (values ('anon'),('authenticated'),('service_role')) r(role_name)
  cross join (values
    ('public.every8d_settings_enrollment_grants'),
    ('public.every8d_settings_administrators'),
    ('public.every8d_settings_sessions'),
    ('public.every8d_settings_auth_challenges'),
    ('public.every8d_settings_auth_challenge_failures')
  ) t(relation_name)
  where has_any_column_privilege(r.role_name, t.relation_name,
    'select,insert,update,references')
) and not exists (
  select 1 from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
  where c.oid in (
    'public.every8d_settings_enrollment_grants'::regclass,
    'public.every8d_settings_administrators'::regclass,
    'public.every8d_settings_sessions'::regclass,
    'public.every8d_settings_auth_challenges'::regclass,
    'public.every8d_settings_auth_challenge_failures'::regclass
  ) and acl.grantee=0
) and not exists (
  select 1 from pg_attribute a
  cross join lateral aclexplode(a.attacl) acl
  where a.attrelid in (
    'public.every8d_settings_enrollment_grants'::regclass,
    'public.every8d_settings_administrators'::regclass,
    'public.every8d_settings_sessions'::regclass,
    'public.every8d_settings_auth_challenges'::regclass,
    'public.every8d_settings_auth_challenge_failures'::regclass
  ) and a.attnum > 0 and not a.attisdropped and acl.grantee=0
), 'application roles and PUBLIC have zero direct auth-table privileges');

-- One eligible installation with one live enrollment grant and one current admin.
do $$
begin
  if not exists (select 1 from public.ghl_marketplace_app_registrations
      where app_namespace = 'every8d_connect') then
    insert into public.ghl_marketplace_app_registrations(
      app_namespace, marketplace_app_id, oauth_client_id,
      conversation_provider_id, channel, provider
    ) values ('every8d_connect','c3b3-proof-app','c3b3.proof.client',
      'c3b3-proof-provider','sms','every8d');
  end if;
  if not exists (select 1 from public.ghl_marketplace_app_version_registrations
      where app_namespace = 'every8d_connect') then
    insert into public.ghl_marketplace_app_version_registrations(
      app_namespace, marketplace_version_id
    ) values ('every8d_connect','c3b3.proof.version');
  end if;
end;
$$;

insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id)
values('7b300000-0000-4000-8000-000000000001','c3b3-proof-location',
  'c3b3-proof-line-provider','c3b3-proof-line-channel');
insert into public.ghl_marketplace_installations(
  id,app_namespace,marketplace_app_id,oauth_client_id,tenant_id,location_id,
  company_id,conversation_provider_id,channel,provider,status,installation_generation,
  access_token_ciphertext,refresh_token_ciphertext,encryption_key_version,
  token_expires_at,granted_scopes,credential_revision,credential_state,
  latest_lifecycle_event_at,latest_lifecycle_event_id,latest_lifecycle_event_type,
  latest_lifecycle_version_id
)
select '7b300000-0000-4000-8000-000000000002','every8d_connect',
  r.marketplace_app_id,r.oauth_client_id,'7b300000-0000-4000-8000-000000000001',
  'c3b3-proof-location','c3b3-proof-company',r.conversation_provider_id,'sms','every8d',
  'pending',1,null,null,null,null,'{}'::text[],0,'none',clock_timestamp(),
  'c3b3_proof_install','INSTALL',v.marketplace_version_id
from public.ghl_marketplace_app_registrations r
join public.ghl_marketplace_app_version_registrations v using(app_namespace)
where r.app_namespace='every8d_connect' limit 1;

select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'enroll@example.com',
  decode(repeat('81',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-ENROLL','orchestration proof') \gset enroll_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'login@example.com',
  decode(repeat('82',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-LOGIN','login identity proof') \gset login_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('82',32),'hex'),'login@example.com','k1:'||repeat('2',64)) \gset admin_

-- Frozen rate-limit boundaries: 60 seconds is exclusive, while the third
-- hourly, tenth daily, third grant, and tenth failed attempt are rejected.
select clock_timestamp() captured_at \gset rate_
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) values (
  '7b305000-0000-4000-8000-000000000001',decode(repeat('01',32),'hex'),
  'login','rate-recent@example.com','k1:'||repeat('c',64),decode(repeat('02',32),'hex'),
  'otp-v1',:'rate_captured_at'::timestamptz-interval '60 seconds',
  :'rate_captured_at'::timestamptz+interval '9 minutes'
);
select public.assert_every8d_settings_challenge_rate_limits_v1(
  array['k1:'||repeat('c',64)],null,:'rate_captured_at'::timestamptz);
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) values (
  '7b305000-0000-4000-8000-000000000002',decode(repeat('03',32),'hex'),
  'login','rate-recent@example.com','k1:'||repeat('c',64),decode(repeat('04',32),'hex'),
  'otp-v1',:'rate_captured_at'::timestamptz-interval '59 seconds',
  :'rate_captured_at'::timestamptz+interval '9 minutes 1 second'
);
select pg_temp.assert_rate_rejected(array['k1:'||repeat('c',64)],null,
  :'rate_captured_at'::timestamptz,'inside 60-second boundary');

insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
)
select ('7b305000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,
  decode(lpad(to_hex(16+n),64,'0'),'hex'),'login','rate-hour@example.com',
  'k1:'||repeat('d',64),decode(lpad(to_hex(32+n),64,'0'),'hex'),'otp-v1',
  :'rate_captured_at'::timestamptz-n*interval '10 minutes',
  :'rate_captured_at'::timestamptz+(10-n*10)*interval '1 minute'
from generate_series(2,3) n;
select public.assert_every8d_settings_challenge_rate_limits_v1(
  array['k1:'||repeat('d',64)],null,:'rate_captured_at'::timestamptz);
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) values (
  '7b305000-0000-4000-8001-000000000004',decode(repeat('14',32),'hex'),
  'login','rate-hour@example.com','k1:'||repeat('d',64),decode(repeat('24',32),'hex'),
  'otp-v1',:'rate_captured_at'::timestamptz-interval '40 minutes',
  :'rate_captured_at'::timestamptz-interval '30 minutes'
);
select pg_temp.assert_rate_rejected(array['k1:'||repeat('d',64)],null,
  :'rate_captured_at'::timestamptz,'third challenge in one hour');

insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
)
select ('7b305000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid,
  decode(lpad(to_hex(48+n),64,'0'),'hex'),'login','rate-day@example.com',
  'k1:'||repeat('e',64),decode(lpad(to_hex(64+n),64,'0'),'hex'),'otp-v1',
  :'rate_captured_at'::timestamptz-(n+1)*interval '1 hour',
  :'rate_captured_at'::timestamptz-(n+1)*interval '1 hour'+interval '10 minutes'
from generate_series(1,9) n;
select public.assert_every8d_settings_challenge_rate_limits_v1(
  array['k1:'||repeat('e',64)],null,:'rate_captured_at'::timestamptz);
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) values (
  '7b305000-0000-4000-8002-000000000010',decode(repeat('4a',32),'hex'),
  'login','rate-day@example.com','k1:'||repeat('e',64),decode(repeat('5a',32),'hex'),
  'otp-v1',:'rate_captured_at'::timestamptz-interval '11 hours',
  :'rate_captured_at'::timestamptz-interval '10 hours 50 minutes'
);
select pg_temp.assert_rate_rejected(array['k1:'||repeat('e',64)],null,
  :'rate_captured_at'::timestamptz,'tenth challenge in 24 hours');

select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'rate-grant@example.com',
  decode(repeat('83',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-RATE-GRANT','grant rate boundary') \gset rate_grant_
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,enrollment_grant_id,normalized_email,email_pseudonym,
  otp_hmac,otp_hmac_key_version,created_at,expires_at
)
select ('7b305000-0000-4000-8003-'||lpad(n::text,12,'0'))::uuid,
  decode(lpad(to_hex(80+n),64,'0'),'hex'),'enrollment',:'rate_grant_grant_id'::uuid,
  'rate-grant@example.com','k1:'||repeat(to_hex(n),64),
  decode(lpad(to_hex(96+n),64,'0'),'hex'),'otp-v1',captured_at,
  least(captured_at+interval '10 minutes',g.expires_at)
from public.every8d_settings_enrollment_grants g
cross join generate_series(1,2) n
cross join lateral (select clock_timestamp()-n*interval '2 minutes' captured_at) captured
where g.id=:'rate_grant_grant_id'::uuid;
select public.assert_every8d_settings_challenge_rate_limits_v1(
  array['k1:'||repeat('f',64)],:'rate_grant_grant_id'::uuid,clock_timestamp());
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,enrollment_grant_id,normalized_email,email_pseudonym,
  otp_hmac,otp_hmac_key_version,created_at,expires_at
)
select '7b305000-0000-4000-8003-000000000003',decode(repeat('53',32),'hex'),
  'enrollment',g.id,'rate-grant@example.com','k1:'||repeat('3',64),
  decode(repeat('63',32),'hex'),'otp-v1',captured_at,
  least(captured_at+interval '10 minutes',g.expires_at)
from public.every8d_settings_enrollment_grants g
cross join lateral (select clock_timestamp()-interval '6 minutes' captured_at) captured
where g.id=:'rate_grant_grant_id'::uuid;
select pg_temp.assert_rate_rejected(array['k1:'||repeat('f',64)],
  :'rate_grant_grant_id'::uuid,clock_timestamp(),'third challenge for one grant');

insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
)
select ('7b305000-0000-4000-8004-'||lpad(n::text,12,'0'))::uuid,
  decode(lpad(to_hex(112+n),64,'0'),'hex'),'login','rate-failure@example.com',
  'k1:'||repeat('9',64),decode(lpad(to_hex(128+n),64,'0'),'hex'),'otp-v1',
  captured_at,captured_at+interval '10 minutes'
from generate_series(1,2) n
cross join lateral (select :'rate_captured_at'::timestamptz-(n+4)*interval '1 minute' captured_at) captured;
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(lpad(to_hex(112+n),64,'0'),'hex'),true,null),
  'rate-failure fixture delivery recorded') from generate_series(1,2) n;
select pg_temp.append_challenge_failures('7b305000-0000-4000-8004-000000000001',5);
select pg_temp.append_challenge_failures('7b305000-0000-4000-8004-000000000002',4);
select pg_temp.assert_true((select count(*)=9
  from public.every8d_settings_auth_challenge_failures f
  join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
  where c.email_pseudonym='k1:'||repeat('9',64)),
  'frozen helper baseline has exactly nine recent failures');
select public.assert_every8d_settings_challenge_rate_limits_v1(
  array['k1:'||repeat('9',64)],null,:'rate_captured_at'::timestamptz);
select pg_temp.append_challenge_failures('7b305000-0000-4000-8004-000000000002',5);
select pg_temp.assert_true((select count(*)=10
  from public.every8d_settings_auth_challenge_failures f
  join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
  where c.email_pseudonym='k1:'||repeat('9',64)),
  'frozen helper baseline has exactly ten recent failures');
select pg_temp.assert_rate_rejected(array['k1:'||repeat('9',64)],null,
  :'rate_captured_at'::timestamptz,'tenth failed attempt in one hour');

-- Recent-failure boundaries through the actual C3b-3 request paths. Each pass
-- identity has nine failures across two historical challenges; each refusal
-- identity has ten. Two challenge rows remain below the separate hourly and
-- per-grant request thresholds, so the paired result isolates this rule.
do $$
declare
  token_hash bytea;
  email text;
  alias text;
begin
  for token_n in 3001..3002 loop
    token_hash := decode(pg_catalog.lpad(pg_catalog.to_hex(token_n),64,'0'),'hex');
    email := case token_n when 3001 then 'recent-failure-login-pass@example.com'
      else 'recent-failure-login-refuse@example.com' end;
    alias := case token_n when 3001 then 'k1:'||pg_catalog.repeat('1',63)||'a'
      else 'k1:'||pg_catalog.repeat('2',63)||'b' end;
    perform public.issue_every8d_settings_operator_enrollment_grant_v1(
      '7b300000-0000-4000-8000-000000000002',1,email,token_hash,
      'operator_initial',pg_catalog.clock_timestamp()+interval '14 minutes',
      'c3b3-issuer','c3b3-approver','C3B3-RECENT-FAILURE-'||token_n,
      'recent failure login boundary'
    );
    perform public.redeem_every8d_settings_enrollment_grant_v1(token_hash,email,alias);
  end loop;
end;
$$;
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,
  'recent-failure-enroll-pass@example.com',decode(lpad(to_hex(3003),64,'0'),'hex'),
  'operator_initial',clock_timestamp()+interval '14 minutes','c3b3-issuer',
  'c3b3-approver','C3B3-RECENT-FAILURE-3003','recent failure enrollment boundary')
  \gset recent_failure_enroll_pass_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,
  'recent-failure-enroll-refuse@example.com',decode(lpad(to_hex(3004),64,'0'),'hex'),
  'operator_initial',clock_timestamp()+interval '14 minutes','c3b3-issuer',
  'c3b3-approver','C3B3-RECENT-FAILURE-3004','recent failure enrollment boundary')
  \gset recent_failure_enroll_refuse_

insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,enrollment_grant_id,normalized_email,
  email_pseudonym,otp_hmac,otp_hmac_key_version,created_at,expires_at
)
select fixture.id,decode(lpad(to_hex(fixture.hash_n),64,'0'),'hex'),
  fixture.purpose,g.id,fixture.email,fixture.pseudonym,
  decode(lpad(to_hex(fixture.hash_n+100),64,'0'),'hex'),'otp-v1',
  captured_at,case when fixture.purpose='login'
    then captured_at+interval '10 minutes'
    else least(captured_at+interval '10 minutes',g.expires_at) end
from (values
  ('7b304000-0000-4000-8000-000000000001'::uuid,3101,'login',null::integer,
    'recent-failure-login-pass@example.com','k1:'||repeat('1',63)||'a'),
  ('7b304000-0000-4000-8000-000000000002'::uuid,3102,'login',null::integer,
    'recent-failure-login-pass@example.com','k1:'||repeat('1',63)||'a'),
  ('7b304000-0000-4000-8000-000000000003'::uuid,3103,'login',null::integer,
    'recent-failure-login-refuse@example.com','k1:'||repeat('2',63)||'b'),
  ('7b304000-0000-4000-8000-000000000004'::uuid,3104,'login',null::integer,
    'recent-failure-login-refuse@example.com','k1:'||repeat('2',63)||'b'),
  ('7b304000-0000-4000-8000-000000000005'::uuid,3105,'enrollment',3003,
    'recent-failure-enroll-pass@example.com','k1:'||repeat('3',63)||'c'),
  ('7b304000-0000-4000-8000-000000000006'::uuid,3106,'enrollment',3003,
    'recent-failure-enroll-pass@example.com','k1:'||repeat('3',63)||'c'),
  ('7b304000-0000-4000-8000-000000000007'::uuid,3107,'enrollment',3004,
    'recent-failure-enroll-refuse@example.com','k1:'||repeat('4',63)||'d'),
  ('7b304000-0000-4000-8000-000000000008'::uuid,3108,'enrollment',3004,
    'recent-failure-enroll-refuse@example.com','k1:'||repeat('4',63)||'d')
) fixture(id,hash_n,purpose,grant_token_n,email,pseudonym)
left join public.every8d_settings_enrollment_grants g
  on g.token_hash=decode(lpad(to_hex(fixture.grant_token_n),64,'0'),'hex')
cross join lateral (select clock_timestamp()-interval '5 minutes' captured_at) t;
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(lpad(to_hex(hash_n),64,'0'),'hex'),true,null),
  'recent-failure boundary fixture delivery recorded')
from generate_series(3101,3108) hash_n;
do $$
declare
  fixture record;
begin
  for fixture in
    select * from (values
      ('7b304000-0000-4000-8000-000000000001'::uuid,5),
      ('7b304000-0000-4000-8000-000000000002'::uuid,4),
      ('7b304000-0000-4000-8000-000000000003'::uuid,5),
      ('7b304000-0000-4000-8000-000000000004'::uuid,5),
      ('7b304000-0000-4000-8000-000000000005'::uuid,5),
      ('7b304000-0000-4000-8000-000000000006'::uuid,4),
      ('7b304000-0000-4000-8000-000000000007'::uuid,5),
      ('7b304000-0000-4000-8000-000000000008'::uuid,5)
    ) failures(challenge_id,failure_count)
    order by challenge_id
  loop
    perform pg_temp.append_challenge_failures(fixture.challenge_id,fixture.failure_count);
  end loop;
end;
$$;
select pg_temp.assert_true(
  (select count(*)=2 from public.every8d_settings_auth_challenges
    where email_pseudonym='k1:'||repeat('1',63)||'a')
  and (select count(*)=9 from public.every8d_settings_auth_challenge_failures f
    join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
    where c.email_pseudonym='k1:'||repeat('1',63)||'a')
  and (select count(*)=2 from public.every8d_settings_auth_challenges
    where email_pseudonym='k1:'||repeat('2',63)||'b')
  and (select count(*)=10 from public.every8d_settings_auth_challenge_failures f
    join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
    where c.email_pseudonym='k1:'||repeat('2',63)||'b'),
  'login recent-failure fixtures isolate the exact nine/ten boundary');
select pg_temp.assert_true((select count(*)=1 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b304100-0000-4000-8000-000000000001',
    'recent-failure-login-pass@example.com','k1:'||repeat('1',63)||'a',
    array['k1:'||repeat('1',63)||'a'],decode(lpad(to_hex(3201),64,'0'),'hex'),
    decode(lpad(to_hex(3211),64,'0'),'hex'),'otp-v1')),
  'nine recent failures remain the last allowed login wrapper request');
select pg_temp.assert_true((select count(*)=0 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b304100-0000-4000-8000-000000000002',
    'recent-failure-login-refuse@example.com','k1:'||repeat('2',63)||'b',
    array['k1:'||repeat('2',63)||'b'],decode(lpad(to_hex(3202),64,'0'),'hex'),
    decode(lpad(to_hex(3212),64,'0'),'hex'),'otp-v1')),
  'ten recent failures are the first refused zero-row login wrapper request');
select pg_temp.assert_true(
  (select count(*)=2 from public.every8d_settings_auth_challenges
    where enrollment_grant_id=:'recent_failure_enroll_pass_grant_id'::uuid)
  and (select count(*)=9 from public.every8d_settings_auth_challenge_failures f
    join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
    where c.enrollment_grant_id=:'recent_failure_enroll_pass_grant_id'::uuid)
  and (select count(*)=2 from public.every8d_settings_auth_challenges
    where enrollment_grant_id=:'recent_failure_enroll_refuse_grant_id'::uuid)
  and (select count(*)=10 from public.every8d_settings_auth_challenge_failures f
    join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
    where c.enrollment_grant_id=:'recent_failure_enroll_refuse_grant_id'::uuid)
  and (select count(*)=0 from public.every8d_settings_auth_challenges
    where enrollment_grant_id in (:'recent_failure_enroll_pass_grant_id'::uuid,
      :'recent_failure_enroll_refuse_grant_id'::uuid)
      and created_at>clock_timestamp()-interval '60 seconds')
  and (select count(*)=4 from public.every8d_settings_auth_challenges
    where enrollment_grant_id in (:'recent_failure_enroll_pass_grant_id'::uuid,
      :'recent_failure_enroll_refuse_grant_id'::uuid)
      and created_at>clock_timestamp()-interval '1 hour'),
  'enrollment recent-failure fixtures isolate the exact nine/ten boundary');
select pg_temp.assert_true((select count(*)=1 from
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(3003),64,'0'),'hex'),
    '7b304100-0000-4000-8000-000000000003',
    'recent-failure-enroll-pass@example.com','k1:'||repeat('3',63)||'c',
    array['k1:'||repeat('3',63)||'c'],decode(lpad(to_hex(3203),64,'0'),'hex'),
    decode(lpad(to_hex(3213),64,'0'),'hex'),'otp-v1')),
  'nine recent failures remain the last allowed enrollment wrapper request');
select pg_temp.assert_true((select count(*)=0 from
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(3004),64,'0'),'hex'),
    '7b304100-0000-4000-8000-000000000004',
    'recent-failure-enroll-refuse@example.com','k1:'||repeat('4',63)||'d',
    array['k1:'||repeat('4',63)||'d'],decode(lpad(to_hex(3204),64,'0'),'hex'),
    decode(lpad(to_hex(3214),64,'0'),'hex'),'otp-v1')),
  'ten recent failures are the first refused zero-row enrollment wrapper request');

-- The same frozen boundaries are exercised through the C3b-3 runtime request
-- wrappers. Each pass fixture is the last permitted request; each paired
-- refusal fixture is the first request beyond that boundary.
do $$
declare
  i integer;
  token_hash bytea;
  email text;
  alias text;
begin
  for i in 1..6 loop
    token_hash := decode(pg_catalog.lpad(pg_catalog.to_hex(200+i),64,'0'),'hex');
    email := 'wrapper-rate-'||i||'@example.com';
    alias := 'k1:'||pg_catalog.lpad(pg_catalog.to_hex(i),64,'0');
    perform public.issue_every8d_settings_operator_enrollment_grant_v1(
      '7b300000-0000-4000-8000-000000000002',1,email,token_hash,
      'operator_initial',pg_catalog.clock_timestamp()+interval '12 minutes',
      'c3b3-issuer','c3b3-approver','C3B3-WRAPPER-RATE-'||i,'wrapper rate identity'
    );
    perform public.redeem_every8d_settings_enrollment_grant_v1(token_hash,email,alias);
  end loop;
end;
$$;

select clock_timestamp() captured_at \gset wrapper_rate_
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
)
select ('7b3051'||lpad(identity_n::text,2,'0')||'-0000-4000-8'||
    lpad(challenge_n::text,3,'0')||'-'||lpad((identity_n*100+challenge_n)::text,12,'0'))::uuid,
  decode(lpad(to_hex(300+identity_n*20+challenge_n),64,'0'),'hex'),'login',
  'wrapper-rate-'||identity_n||'@example.com',
  'k1:'||lpad(to_hex(identity_n),64,'0'),
  decode(lpad(to_hex(600+identity_n*20+challenge_n),64,'0'),'hex'),'otp-v1',
  :'wrapper_rate_captured_at'::timestamptz-age_delta,
  :'wrapper_rate_captured_at'::timestamptz-age_delta+interval '10 minutes'
from (values
  (1,1,interval '61 seconds'),
  (2,1,interval '59 seconds'),
  (3,1,interval '10 minutes'),(3,2,interval '20 minutes'),
  (4,1,interval '10 minutes'),(4,2,interval '20 minutes'),
  (4,3,interval '30 minutes'),
  (5,1,interval '2 hours'),(5,2,interval '3 hours'),
  (5,3,interval '4 hours'),(5,4,interval '5 hours'),
  (5,5,interval '6 hours'),(5,6,interval '7 hours'),
  (5,7,interval '8 hours'),(5,8,interval '9 hours'),
  (5,9,interval '10 hours'),
  (6,1,interval '2 hours'),(6,2,interval '3 hours'),
  (6,3,interval '4 hours'),(6,4,interval '5 hours'),
  (6,5,interval '6 hours'),(6,6,interval '7 hours'),
  (6,7,interval '8 hours'),(6,8,interval '9 hours'),
  (6,9,interval '10 hours'),(6,10,interval '11 hours')
) fixture(identity_n,challenge_n,age_delta);

select pg_temp.assert_true((select count(*)=1 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b305200-0000-4000-8000-000000000001','wrapper-rate-1@example.com',
    'k1:'||lpad(to_hex(1),64,'0'),array['k1:'||lpad(to_hex(1),64,'0')],
    decode(lpad(to_hex(701),64,'0'),'hex'),decode(lpad(to_hex(801),64,'0'),'hex'),'otp-v1')),
  '60-second last-permitted request passes through C3b-3 wrapper');
select pg_temp.assert_true((select count(*)=0 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b305200-0000-4000-8000-000000000002','wrapper-rate-2@example.com',
    'k1:'||lpad(to_hex(2),64,'0'),array['k1:'||lpad(to_hex(2),64,'0')],
    decode(lpad(to_hex(702),64,'0'),'hex'),decode(lpad(to_hex(802),64,'0'),'hex'),'otp-v1')),
  '60-second first-refused request is zero rows through C3b-3 wrapper');
select pg_temp.assert_true((select count(*)=1 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b305200-0000-4000-8000-000000000003','wrapper-rate-3@example.com',
    'k1:'||lpad(to_hex(3),64,'0'),array['k1:'||lpad(to_hex(3),64,'0')],
    decode(lpad(to_hex(703),64,'0'),'hex'),decode(lpad(to_hex(803),64,'0'),'hex'),'otp-v1')),
  'hourly last-permitted request passes through C3b-3 wrapper');
select pg_temp.assert_true((select count(*)=0 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b305200-0000-4000-8000-000000000004','wrapper-rate-4@example.com',
    'k1:'||lpad(to_hex(4),64,'0'),array['k1:'||lpad(to_hex(4),64,'0')],
    decode(lpad(to_hex(704),64,'0'),'hex'),decode(lpad(to_hex(804),64,'0'),'hex'),'otp-v1')),
  'hourly first-refused request is zero rows through C3b-3 wrapper');
select pg_temp.assert_true((select count(*)=1 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b305200-0000-4000-8000-000000000005','wrapper-rate-5@example.com',
    'k1:'||lpad(to_hex(5),64,'0'),array['k1:'||lpad(to_hex(5),64,'0')],
    decode(lpad(to_hex(705),64,'0'),'hex'),decode(lpad(to_hex(805),64,'0'),'hex'),'otp-v1')),
  'daily last-permitted request passes through C3b-3 wrapper');
select pg_temp.assert_true((select count(*)=0 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b305200-0000-4000-8000-000000000006','wrapper-rate-6@example.com',
    'k1:'||lpad(to_hex(6),64,'0'),array['k1:'||lpad(to_hex(6),64,'0')],
    decode(lpad(to_hex(706),64,'0'),'hex'),decode(lpad(to_hex(806),64,'0'),'hex'),'otp-v1')),
  'daily first-refused request is zero rows through C3b-3 wrapper');
select pg_temp.assert_true((select supersession_reason='resend'
    from public.every8d_settings_auth_challenges
    where id='7b305101-0000-4000-8001-000000000101'),
  'last-permitted resend supersedes through C3b-3 wrapper');

select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'wrapper-grant-pass@example.com',
  decode(lpad(to_hex(901),64,'0'),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-WRAPPER-GRANT-PASS','grant wrapper boundary') \gset wrapper_grant_pass_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'wrapper-grant-refuse@example.com',
  decode(lpad(to_hex(902),64,'0'),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-WRAPPER-GRANT-REFUSE','grant wrapper boundary') \gset wrapper_grant_refuse_
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,enrollment_grant_id,normalized_email,email_pseudonym,
  otp_hmac,otp_hmac_key_version,created_at,expires_at
)
select ('7b305300-0000-4000-8'||lpad(grant_n::text,3,'0')||'-'||
    lpad((grant_n*100+challenge_n)::text,12,'0'))::uuid,
  decode(lpad(to_hex(920+grant_n*10+challenge_n),64,'0'),'hex'),'enrollment',
  case grant_n when 1 then :'wrapper_grant_pass_grant_id'::uuid
    else :'wrapper_grant_refuse_grant_id'::uuid end,
  case grant_n when 1 then 'wrapper-grant-pass@example.com'
    else 'wrapper-grant-refuse@example.com' end,
  'k1:'||lpad(to_hex(30+grant_n*10+challenge_n),64,'0'),
  decode(lpad(to_hex(950+grant_n*10+challenge_n),64,'0'),'hex'),'otp-v1',captured_at,
  least(captured_at+interval '10 minutes',g.expires_at)
from (values (1,1),(1,2),(2,1),(2,2),(2,3)) fixture(grant_n,challenge_n)
join public.every8d_settings_enrollment_grants g on g.id=case grant_n
  when 1 then :'wrapper_grant_pass_grant_id'::uuid
  else :'wrapper_grant_refuse_grant_id'::uuid end
cross join lateral (select clock_timestamp()-(challenge_n+1)*interval '2 minutes' captured_at) t;
select pg_temp.assert_true((select count(*)=1 from
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(901),64,'0'),'hex'),'7b305400-0000-4000-8000-000000000001',
    'wrapper-grant-pass@example.com','k1:'||repeat('a',64),array['k1:'||repeat('a',64)],
    decode(lpad(to_hex(991),64,'0'),'hex'),decode(lpad(to_hex(992),64,'0'),'hex'),'otp-v1')),
  'grant-scoped last-permitted request passes through C3b-3 wrapper');
select pg_temp.assert_true((select count(*)=0 from
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(902),64,'0'),'hex'),'7b305400-0000-4000-8000-000000000002',
    'wrapper-grant-refuse@example.com','k1:'||repeat('b',64),array['k1:'||repeat('b',64)],
    decode(lpad(to_hex(993),64,'0'),'hex'),decode(lpad(to_hex(994),64,'0'),'hex'),'otp-v1')),
  'grant-scoped first-refused request is zero rows through C3b-3 wrapper');

-- V1/V2 request parity: both prepare equivalent login state and preserve the
-- same rate-limit semantics; only v2 accepts the trusted explicit UUID and
-- maps the expected rate negative to zero rows.
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-v1@example.com',
  decode(repeat('84',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-V1','v1 parity identity') \gset parity_v1_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('84',32),'hex'),'parity-v1@example.com',
  'k1:'||repeat('4',63)||'a') \gset parity_v1_admin_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-v2@example.com',
  decode(repeat('85',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-V2','v2 parity identity') \gset parity_v2_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('85',32),'hex'),'parity-v2@example.com',
  'k1:'||repeat('5',63)||'b') \gset parity_v2_admin_
select * from public.request_every8d_settings_login_challenge_v1(
  'parity-v1@example.com','k1:'||repeat('4',63)||'a',
  array['k1:'||repeat('4',63)||'a'],
  decode(repeat('86',32),'hex'),decode(repeat('87',32),'hex'),'otp-v1') \gset parity_v1_ch_
select * from public.runtime_request_every8d_settings_login_challenge_v1(
  '7b306000-0000-4000-8000-000000000001','parity-v2@example.com',
  'k1:'||repeat('5',63)||'b',array['k1:'||repeat('5',63)||'b'],
  decode(repeat('88',32),'hex'),decode(repeat('89',32),'hex'),'otp-v1') \gset parity_v2_ch_
select pg_temp.assert_true((select count(*)=2
  from public.every8d_settings_auth_challenges
  where id in (:'parity_v1_ch_challenge_id'::uuid,:'parity_v2_ch_challenge_id'::uuid)
    and purpose='login' and enrollment_grant_id is null
    and expires_at=created_at+interval '10 minutes'
    and created_at<=clock_timestamp()
    and delivery_succeeded_at is null and delivery_failed_at is null
    and superseded_at is null and verified_at is null and locked_at is null),
  'v1 and v2 preserve login state, creation, expiry, and pending delivery');
select pg_temp.assert_true((select normalized_email='parity-v1@example.com'
    and email_pseudonym='k1:'||repeat('4',63)||'a'
    from public.every8d_settings_auth_challenges
    where id=:'parity_v1_ch_challenge_id'::uuid)
  and (select normalized_email='parity-v2@example.com'
    and email_pseudonym='k1:'||repeat('5',63)||'b'
    from public.every8d_settings_auth_challenges
    where id=:'parity_v2_ch_challenge_id'::uuid),
  'v1 and v2 preserve normalized email and pseudonym semantics');
select pg_temp.reject($sql$select * from public.request_every8d_settings_login_challenge_v1(
  'parity-v1@example.com','k1:'||repeat('4',63)||'a',
  array['k1:'||repeat('4',63)||'a'],
  decode(repeat('8a',32),'hex'),decode(repeat('8b',32),'hex'),'otp-v1')$sql$,
  'P0001','v1 request preserves rate rejection');
select pg_temp.assert_true((select count(*)=0 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b306000-0000-4000-8000-000000000002','parity-v2@example.com',
    'k1:'||repeat('5',63)||'b',array['k1:'||repeat('5',63)||'b'],
    decode(repeat('8c',32),'hex'),decode(repeat('8d',32),'hex'),'otp-v1')),
  'v2 request maps the same rate rejection to zero rows');

-- Matched enrollment v1/v2 creation parity. Long-lived and grant-bounded pairs
-- exercise the exact shared expiry formula while retaining only the frozen
-- UUID and grant-token-hash authority deltas.
select clock_timestamp() captured_at \gset parity_enroll_window_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-enroll-long-v1@example.com',
  decode(lpad(to_hex(2101),64,'0'),'hex'),'operator_initial',
  clock_timestamp()+interval '14 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-ENROLL-LONG-V1','enrollment parity') \gset parity_enroll_long_v1_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-enroll-long-v2@example.com',
  decode(lpad(to_hex(2102),64,'0'),'hex'),'operator_initial',
  clock_timestamp()+interval '14 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-ENROLL-LONG-V2','enrollment parity') \gset parity_enroll_long_v2_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-enroll-short-v1@example.com',
  decode(lpad(to_hex(2103),64,'0'),'hex'),'operator_initial',
  :'parity_enroll_window_captured_at'::timestamptz+interval '5 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-ENROLL-SHORT-V1','enrollment parity') \gset parity_enroll_short_v1_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-enroll-short-v2@example.com',
  decode(lpad(to_hex(2104),64,'0'),'hex'),'operator_initial',
  :'parity_enroll_window_captured_at'::timestamptz+interval '5 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-ENROLL-SHORT-V2','enrollment parity') \gset parity_enroll_short_v2_

select * from public.request_every8d_settings_enrollment_challenge_v1(
  :'parity_enroll_long_v1_grant_id'::uuid,'parity-enroll-long-v1@example.com',
  'k1:'||repeat('6',63)||'c',array['k1:'||repeat('6',63)||'c'],
  decode(lpad(to_hex(2111),64,'0'),'hex'),decode(lpad(to_hex(2121),64,'0'),'hex'),
  'otp-v1') \gset parity_enroll_long_v1_ch_
select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
  decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306200-0000-4000-8000-000000000001',
  'parity-enroll-long-v2@example.com','k1:'||repeat('7',63)||'d',
  array['k1:'||repeat('7',63)||'d'],decode(lpad(to_hex(2112),64,'0'),'hex'),
  decode(lpad(to_hex(2122),64,'0'),'hex'),'otp-v1') \gset parity_enroll_long_v2_ch_
select * from public.request_every8d_settings_enrollment_challenge_v1(
  :'parity_enroll_short_v1_grant_id'::uuid,'parity-enroll-short-v1@example.com',
  'k1:'||repeat('c3b3a001',8),array['k1:'||repeat('c3b3a001',8)],
  decode(lpad(to_hex(2113),64,'0'),'hex'),decode(lpad(to_hex(2123),64,'0'),'hex'),
  'otp-v1') \gset parity_enroll_short_v1_ch_
select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
  decode(lpad(to_hex(2104),64,'0'),'hex'),'7b306200-0000-4000-8000-000000000002',
  'parity-enroll-short-v2@example.com','k1:'||repeat('b',63)||'2',
  array['k1:'||repeat('b',63)||'2'],decode(lpad(to_hex(2114),64,'0'),'hex'),
  decode(lpad(to_hex(2124),64,'0'),'hex'),'otp-v1') \gset parity_enroll_short_v2_ch_
select clock_timestamp() captured_at \gset parity_enroll_finished_

select pg_temp.assert_true((select count(*)=4 and bool_and(
    c.purpose='enrollment' and c.enrollment_grant_id is not null
    and c.created_at>=:'parity_enroll_window_captured_at'::timestamptz
    and c.created_at<=:'parity_enroll_finished_captured_at'::timestamptz
    and c.delivery_succeeded_at is null and c.delivery_failed_at is null
    and c.superseded_at is null and c.verified_at is null and c.locked_at is null)
  from public.every8d_settings_auth_challenges c
  where c.id in (:'parity_enroll_long_v1_ch_challenge_id'::uuid,
    :'parity_enroll_long_v2_ch_challenge_id'::uuid,
    :'parity_enroll_short_v1_ch_challenge_id'::uuid,
    :'parity_enroll_short_v2_ch_challenge_id'::uuid)),
  'v1 and v2 preserve enrollment creation, challenge state, and pending delivery');
select pg_temp.assert_true(
  (select c.created_at=:'parity_enroll_long_v1_ch_created_at'::timestamptz
    and c.expires_at=:'parity_enroll_long_v1_ch_expires_at'::timestamptz
    from public.every8d_settings_auth_challenges c
    where c.id=:'parity_enroll_long_v1_ch_challenge_id'::uuid)
  and (select c.created_at=:'parity_enroll_long_v2_ch_created_at'::timestamptz
    and c.expires_at=:'parity_enroll_long_v2_ch_expires_at'::timestamptz
    from public.every8d_settings_auth_challenges c
    where c.id=:'parity_enroll_long_v2_ch_challenge_id'::uuid)
  and (select c.created_at=:'parity_enroll_short_v1_ch_created_at'::timestamptz
    and c.expires_at=:'parity_enroll_short_v1_ch_expires_at'::timestamptz
    from public.every8d_settings_auth_challenges c
    where c.id=:'parity_enroll_short_v1_ch_challenge_id'::uuid)
  and (select c.created_at=:'parity_enroll_short_v2_ch_created_at'::timestamptz
    and c.expires_at=:'parity_enroll_short_v2_ch_expires_at'::timestamptz
    from public.every8d_settings_auth_challenges c
    where c.id=:'parity_enroll_short_v2_ch_challenge_id'::uuid),
  'v1 and v2 return the exact stored creation and expiry timestamps');
select pg_temp.assert_true((select count(*)=4 and bool_and(
    c.normalized_email=expected.email and c.email_pseudonym=expected.pseudonym)
  from (values
    (:'parity_enroll_long_v1_ch_challenge_id'::uuid,'parity-enroll-long-v1@example.com','k1:'||repeat('6',63)||'c'),
    (:'parity_enroll_long_v2_ch_challenge_id'::uuid,'parity-enroll-long-v2@example.com','k1:'||repeat('7',63)||'d'),
    (:'parity_enroll_short_v1_ch_challenge_id'::uuid,'parity-enroll-short-v1@example.com','k1:'||repeat('c3b3a001',8)),
    (:'parity_enroll_short_v2_ch_challenge_id'::uuid,'parity-enroll-short-v2@example.com','k1:'||repeat('b',63)||'2')
  ) expected(id,email,pseudonym)
  join public.every8d_settings_auth_challenges c on c.id=expected.id),
  'v1 and v2 preserve normalized-email and pseudonym semantics');
select pg_temp.assert_true((select count(*)=2 and bool_and(
    c.expires_at=c.created_at+interval '10 minutes'
    and c.expires_at=least(c.created_at+interval '10 minutes',g.expires_at))
  from public.every8d_settings_auth_challenges c
  join public.every8d_settings_enrollment_grants g on g.id=c.enrollment_grant_id
  where c.id in (:'parity_enroll_long_v1_ch_challenge_id'::uuid,
    :'parity_enroll_long_v2_ch_challenge_id'::uuid)),
  'long-lived grants use the exact ten-minute v1/v2 enrollment expiry formula');
select pg_temp.assert_true((select count(*)=2 and bool_and(
    c.expires_at=g.expires_at
    and c.expires_at=least(c.created_at+interval '10 minutes',g.expires_at))
  from public.every8d_settings_auth_challenges c
  join public.every8d_settings_enrollment_grants g on g.id=c.enrollment_grant_id
  where c.id in (:'parity_enroll_short_v1_ch_challenge_id'::uuid,
    :'parity_enroll_short_v2_ch_challenge_id'::uuid)),
  'short-lived grants use the exact grant-bounded v1/v2 enrollment expiry formula');
select pg_temp.reject($sql$select * from
  public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants
      where token_hash=decode(lpad(to_hex(2101),64,'0'),'hex')),
    'parity-enroll-long-v1@example.com','k1:'||repeat('6',63)||'c',
    array['k1:'||repeat('6',63)||'c'],decode(lpad(to_hex(2151),64,'0'),'hex'),
    decode(lpad(to_hex(2161),64,'0'),'hex'),'otp-v1')$sql$,
  'P0001','v1 enrollment preserves the immediate rate rejection');
select pg_temp.assert_true((select count(*)=0 from
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306200-0000-4000-8000-000000000003',
    'parity-enroll-long-v2@example.com','k1:'||repeat('7',63)||'d',
    array['k1:'||repeat('7',63)||'d'],decode(lpad(to_hex(2152),64,'0'),'hex'),
    decode(lpad(to_hex(2162),64,'0'),'hex'),'otp-v1')),
  'v2 enrollment maps the same immediate rate rejection to zero rows');

-- Complete matched enrollment validation parity. Each case invokes the real
-- C3b-1 v1 request and the C3b-3 runtime path against equivalent valid grants;
-- both must reject the same unchanged static contract before state mutation.
select pg_temp.assert_static_enrollment_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where
      token_hash=decode(lpad(to_hex(2101),64,'0'),'hex')),
    'invalid@Example.com','k1:'||repeat('6',63)||'c',
    array['k1:'||repeat('6',63)||'c'],decode(lpad(to_hex(2251),64,'0'),'hex'),
    decode(lpad(to_hex(2261),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000001',
    'invalid@Example.com','k1:'||repeat('7',63)||'d',
    array['k1:'||repeat('7',63)||'d'],decode(lpad(to_hex(2252),64,'0'),'hex'),
    decode(lpad(to_hex(2262),64,'0'),'hex'),'otp-v1')$v2$,
  'V01 canonical normalized email');
select pg_temp.assert_static_enrollment_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where
      token_hash=decode(lpad(to_hex(2101),64,'0'),'hex')),
    'parity-enroll-long-v1@example.com','not-a-pseudonym',array['not-a-pseudonym'],
    decode(lpad(to_hex(2253),64,'0'),'hex'),decode(lpad(to_hex(2263),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000002',
    'parity-enroll-long-v2@example.com','not-a-pseudonym',array['not-a-pseudonym'],
    decode(lpad(to_hex(2254),64,'0'),'hex'),decode(lpad(to_hex(2264),64,'0'),'hex'),'otp-v1')$v2$,
  'V02 active email pseudonym');
select pg_temp.assert_static_enrollment_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where
      token_hash=decode(lpad(to_hex(2101),64,'0'),'hex')),
    'parity-enroll-long-v1@example.com','k1:'||repeat('6',63)||'c',
    array['k1:'||repeat('e',64)],decode(lpad(to_hex(2255),64,'0'),'hex'),
    decode(lpad(to_hex(2265),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000003',
    'parity-enroll-long-v2@example.com','k1:'||repeat('7',63)||'d',
    array['k1:'||repeat('f',64)],decode(lpad(to_hex(2256),64,'0'),'hex'),
    decode(lpad(to_hex(2266),64,'0'),'hex'),'otp-v1')$v2$,
  'V03 active pseudonym membership');
select pg_temp.assert_static_enrollment_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where
      token_hash=decode(lpad(to_hex(2101),64,'0'),'hex')),
    'parity-enroll-long-v1@example.com','k1:'||repeat('6',63)||'c',null::text[],
    decode(lpad(to_hex(2257),64,'0'),'hex'),decode(lpad(to_hex(2267),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000004',
    'parity-enroll-long-v2@example.com','k1:'||repeat('7',63)||'d',null::text[],
    decode(lpad(to_hex(2258),64,'0'),'hex'),decode(lpad(to_hex(2268),64,'0'),'hex'),'otp-v1')$v2$,
  'V04 aliases non-null');
select pg_temp.assert_static_enrollment_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where
      token_hash=decode(lpad(to_hex(2101),64,'0'),'hex')),
    'parity-enroll-long-v1@example.com','k1:'||repeat('6',63)||'c',array[]::text[],
    decode(lpad(to_hex(2259),64,'0'),'hex'),decode(lpad(to_hex(2269),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000005',
    'parity-enroll-long-v2@example.com','k1:'||repeat('7',63)||'d',array[]::text[],
    decode(lpad(to_hex(2270),64,'0'),'hex'),decode(lpad(to_hex(2271),64,'0'),'hex'),'otp-v1')$v2$,
  'V05 aliases minimum cardinality');
select pg_temp.assert_static_enrollment_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where
      token_hash=decode(lpad(to_hex(2101),64,'0'),'hex')),
    'parity-enroll-long-v1@example.com','k1:'||repeat('6',63)||'c',
    array_fill('k1:'||repeat('6',63)||'c',array[65]),decode(lpad(to_hex(2272),64,'0'),'hex'),
    decode(lpad(to_hex(2273),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000006',
    'parity-enroll-long-v2@example.com','k1:'||repeat('7',63)||'d',
    array_fill('k1:'||repeat('7',63)||'d',array[65]),decode(lpad(to_hex(2274),64,'0'),'hex'),
    decode(lpad(to_hex(2275),64,'0'),'hex'),'otp-v1')$v2$,
  'V06 aliases maximum cardinality');
select pg_temp.assert_static_enrollment_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where
      token_hash=decode(lpad(to_hex(2101),64,'0'),'hex')),
    'parity-enroll-long-v1@example.com','k1:'||repeat('6',63)||'c',
    array['k1:'||repeat('6',63)||'c',null],decode(lpad(to_hex(2276),64,'0'),'hex'),
    decode(lpad(to_hex(2277),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000007',
    'parity-enroll-long-v2@example.com','k1:'||repeat('7',63)||'d',
    array['k1:'||repeat('7',63)||'d',null],decode(lpad(to_hex(2278),64,'0'),'hex'),
    decode(lpad(to_hex(2279),64,'0'),'hex'),'otp-v1')$v2$,
  'V07 aliases reject null members');
select pg_temp.assert_static_enrollment_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where
      token_hash=decode(lpad(to_hex(2101),64,'0'),'hex')),
    'parity-enroll-long-v1@example.com','k1:'||repeat('6',63)||'c',
    array['k1:'||repeat('6',63)||'c','bad'],decode(lpad(to_hex(2280),64,'0'),'hex'),
    decode(lpad(to_hex(2281),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000008',
    'parity-enroll-long-v2@example.com','k1:'||repeat('7',63)||'d',
    array['k1:'||repeat('7',63)||'d','bad'],decode(lpad(to_hex(2282),64,'0'),'hex'),
    decode(lpad(to_hex(2283),64,'0'),'hex'),'otp-v1')$v2$,
  'V08 every alias validates');
select pg_temp.assert_static_enrollment_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where
      token_hash=decode(lpad(to_hex(2101),64,'0'),'hex')),
    'parity-enroll-long-v1@example.com','k1:'||repeat('6',63)||'c',
    array['k1:'||repeat('6',63)||'c'],decode(repeat('01',31),'hex'),
    decode(lpad(to_hex(2284),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000009',
    'parity-enroll-long-v2@example.com','k1:'||repeat('7',63)||'d',
    array['k1:'||repeat('7',63)||'d'],decode(repeat('01',31),'hex'),
    decode(lpad(to_hex(2285),64,'0'),'hex'),'otp-v1')$v2$,
  'V09 request-token digest length');
select pg_temp.assert_static_enrollment_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where
      token_hash=decode(lpad(to_hex(2101),64,'0'),'hex')),
    'parity-enroll-long-v1@example.com','k1:'||repeat('6',63)||'c',
    array['k1:'||repeat('6',63)||'c'],decode(lpad(to_hex(2286),64,'0'),'hex'),
    decode(repeat('02',31),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000010',
    'parity-enroll-long-v2@example.com','k1:'||repeat('7',63)||'d',
    array['k1:'||repeat('7',63)||'d'],decode(lpad(to_hex(2287),64,'0'),'hex'),
    decode(repeat('02',31),'hex'),'otp-v1')$v2$,
  'V10 OTP HMAC digest length');
select pg_temp.assert_static_enrollment_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where
      token_hash=decode(lpad(to_hex(2101),64,'0'),'hex')),
    'parity-enroll-long-v1@example.com','k1:'||repeat('6',63)||'c',
    array['k1:'||repeat('6',63)||'c'],decode(lpad(to_hex(2288),64,'0'),'hex'),
    decode(lpad(to_hex(2289),64,'0'),'hex'),'invalid/key')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2102),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000011',
    'parity-enroll-long-v2@example.com','k1:'||repeat('7',63)||'d',
    array['k1:'||repeat('7',63)||'d'],decode(lpad(to_hex(2290),64,'0'),'hex'),
    decode(lpad(to_hex(2291),64,'0'),'hex'),'invalid/key')$v2$,
  'V11 OTP HMAC key-version grammar');

select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-alias-v1@example.com',
  decode(lpad(to_hex(2301),64,'0'),'hex'),'operator_initial',clock_timestamp()+interval '14 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-ALIAS-V1','alias parity') \gset parity_alias_v1_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-alias-v2@example.com',
  decode(lpad(to_hex(2302),64,'0'),'hex'),'operator_initial',clock_timestamp()+interval '14 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-ALIAS-V2','alias parity') \gset parity_alias_v2_
select * from public.request_every8d_settings_enrollment_challenge_v1(
  :'parity_alias_v1_grant_id'::uuid,'parity-alias-v1@example.com','k1:'||repeat('c3b3e001',8),
  array['k0:'||repeat('2',64),'k1:'||repeat('c3b3e001',8),'k1:'||repeat('c3b3e001',8)],
  decode(lpad(to_hex(2303),64,'0'),'hex'),decode(lpad(to_hex(2304),64,'0'),'hex'),'otp-v1')
  \gset parity_alias_v1_ch_
select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
  decode(lpad(to_hex(2302),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000012',
  'parity-alias-v2@example.com','k1:'||repeat('3',64),
  array['k0:'||repeat('4',64),'k1:'||repeat('3',64),'k1:'||repeat('3',64)],
  decode(lpad(to_hex(2305),64,'0'),'hex'),decode(lpad(to_hex(2306),64,'0'),'hex'),'otp-v1')
  \gset parity_alias_v2_ch_
select pg_temp.assert_true(
  :'parity_alias_v1_ch_challenge_id'::uuid is not null
  and :'parity_alias_v2_ch_challenge_id'::uuid='7b306400-0000-4000-8000-000000000012'::uuid,
  'V12 valid historical and duplicate aliases preserve matched acceptance');

-- Matched enrollment eligibility rejects exercise the same authority state.
-- The error-versus-zero-row surface is the explicit frozen nondisclosure delta.
do $$
declare token_n integer; expiry timestamptz;
begin
  for token_n in 2401..2418 loop
    expiry := pg_catalog.clock_timestamp()+case when token_n in (2405,2406)
      then interval '1 minute' else interval '14 minutes' end;
    perform public.issue_every8d_settings_operator_enrollment_grant_v1(
      '7b300000-0000-4000-8000-000000000002',1,
      'parity-eligibility-'||token_n||'@example.com',
      decode(pg_catalog.lpad(pg_catalog.to_hex(token_n),64,'0'),'hex'),
      'operator_initial',expiry,'c3b3-issuer','c3b3-approver',
      'C3B3-PARITY-ELIGIBILITY-'||token_n,'eligibility parity');
  end loop;
  update public.every8d_settings_enrollment_grants
  set revoked_at=pg_catalog.clock_timestamp(),revocation_reason='c3b3_parity'
  where token_hash in (decode(pg_catalog.lpad(pg_catalog.to_hex(2401),64,'0'),'hex'),
    decode(pg_catalog.lpad(pg_catalog.to_hex(2402),64,'0'),'hex'));
  perform public.redeem_every8d_settings_enrollment_grant_v1(
    decode(pg_catalog.lpad(pg_catalog.to_hex(2403),64,'0'),'hex'),
    'parity-eligibility-2403@example.com','k1:'||pg_catalog.lpad('2403',64,'0'));
  perform public.redeem_every8d_settings_enrollment_grant_v1(
    decode(pg_catalog.lpad(pg_catalog.to_hex(2404),64,'0'),'hex'),
    'parity-eligibility-2404@example.com','k1:'||pg_catalog.lpad('2404',64,'0'));
end;
$$;
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2401),64,'0'),'hex')),
    'parity-eligibility-2401@example.com','k1:'||lpad('2401',64,'0'),array['k1:'||lpad('2401',64,'0')],
    decode(lpad(to_hex(2411),64,'0'),'hex'),decode(lpad(to_hex(2421),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2402),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000013',
    'parity-eligibility-2402@example.com','k1:'||lpad('2402',64,'0'),array['k1:'||lpad('2402',64,'0')],
    decode(lpad(to_hex(2412),64,'0'),'hex'),decode(lpad(to_hex(2422),64,'0'),'hex'),'otp-v1')$v2$,
  '23514','E01 revoked grant');
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2403),64,'0'),'hex')),
    'parity-eligibility-2403@example.com','k1:'||lpad('2403',64,'0'),array['k1:'||lpad('2403',64,'0')],
    decode(lpad(to_hex(2413),64,'0'),'hex'),decode(lpad(to_hex(2423),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2404),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000014',
    'parity-eligibility-2404@example.com','k1:'||lpad('2404',64,'0'),array['k1:'||lpad('2404',64,'0')],
    decode(lpad(to_hex(2414),64,'0'),'hex'),decode(lpad(to_hex(2424),64,'0'),'hex'),'otp-v1')$v2$,
  '23514','E02 consumed grant');
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2405),64,'0'),'hex')),
    'parity-eligibility-2405@example.com','k1:'||lpad('2405',64,'0'),array['k1:'||lpad('2405',64,'0')],
    decode(lpad(to_hex(2415),64,'0'),'hex'),decode(lpad(to_hex(2425),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2406),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000015',
    'parity-eligibility-2406@example.com','k1:'||lpad('2406',64,'0'),array['k1:'||lpad('2406',64,'0')],
    decode(lpad(to_hex(2416),64,'0'),'hex'),decode(lpad(to_hex(2426),64,'0'),'hex'),'otp-v1')$v2$,
  '23514','E03 grant minimum remaining life');
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2407),64,'0'),'hex')),
    'different-v1@example.com','k1:'||lpad('2407',64,'0'),array['k1:'||lpad('2407',64,'0')],
    decode(lpad(to_hex(2417),64,'0'),'hex'),decode(lpad(to_hex(2427),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2408),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000016',
    'different-v2@example.com','k1:'||lpad('2408',64,'0'),array['k1:'||lpad('2408',64,'0')],
    decode(lpad(to_hex(2418),64,'0'),'hex'),decode(lpad(to_hex(2428),64,'0'),'hex'),'otp-v1')$v2$,
  '23514','E04 pinned normalized email');
-- E05 isolates the application-registration join itself. The immutable
-- registration row is changed only inside this disposable savepoint; its
-- protection trigger is re-enabled before either authority path executes.
savepoint parity_enrollment_application_registration;
alter table public.ghl_marketplace_app_registrations
  disable trigger protect_ghl_marketplace_app_registration;
update public.ghl_marketplace_app_registrations
set marketplace_app_id=marketplace_app_id||'-unregistered'
where app_namespace='every8d_connect';
alter table public.ghl_marketplace_app_registrations
  enable trigger protect_ghl_marketplace_app_registration;
select pg_temp.assert_true(
  (select latest_lifecycle_version_id in (select marketplace_version_id
      from public.ghl_marketplace_app_version_registrations
      where app_namespace='every8d_connect')
   from public.ghl_marketplace_installations
   where id='7b300000-0000-4000-8000-000000000002')
  and (select status='pending' and latest_lifecycle_event_type='INSTALL'
   from public.ghl_marketplace_installations
   where id='7b300000-0000-4000-8000-000000000002'),
  'E05 changes only application-registration authority');
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2409),64,'0'),'hex')),
    'parity-eligibility-2409@example.com','k1:'||lpad('2409',64,'0'),array['k1:'||lpad('2409',64,'0')],
    decode(lpad(to_hex(2419),64,'0'),'hex'),decode(lpad(to_hex(2429),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2410),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000017',
    'parity-eligibility-2410@example.com','k1:'||lpad('2410',64,'0'),array['k1:'||lpad('2410',64,'0')],
    decode(lpad(to_hex(2420),64,'0'),'hex'),decode(lpad(to_hex(2430),64,'0'),'hex'),'otp-v1')$v2$,
  '23514','E05 application registration eligibility');
rollback to savepoint parity_enrollment_application_registration;

-- E06 keeps application registration, status, and lifecycle valid while only
-- the installation's registered marketplace version is made ineligible.
savepoint parity_enrollment_version_registration;
update public.ghl_marketplace_installations
set latest_lifecycle_event_at=clock_timestamp(),
  latest_lifecycle_event_id='c3b3_parity_unregistered_version',
  latest_lifecycle_event_type='INSTALL',
  latest_lifecycle_version_id='c3b3.unregistered.version'
where id='7b300000-0000-4000-8000-000000000002';
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2411),64,'0'),'hex')),
    'parity-eligibility-2411@example.com','k1:'||lpad('2411',64,'0'),array['k1:'||lpad('2411',64,'0')],
    decode(lpad(to_hex(2431),64,'0'),'hex'),decode(lpad(to_hex(2441),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2412),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000018',
    'parity-eligibility-2412@example.com','k1:'||lpad('2412',64,'0'),array['k1:'||lpad('2412',64,'0')],
    decode(lpad(to_hex(2432),64,'0'),'hex'),decode(lpad(to_hex(2442),64,'0'),'hex'),'otp-v1')$v2$,
  '23514','E06 version registration eligibility');
rollback to savepoint parity_enrollment_version_registration;

savepoint parity_enrollment_generation;
update public.ghl_marketplace_installations
set installation_generation=2,latest_lifecycle_event_at=clock_timestamp(),
  latest_lifecycle_event_id='c3b3_parity_generation',latest_lifecycle_event_type='INSTALL'
where id='7b300000-0000-4000-8000-000000000002';
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2413),64,'0'),'hex')),
    'parity-eligibility-2413@example.com','k1:'||lpad('2413',64,'0'),array['k1:'||lpad('2413',64,'0')],
    decode(lpad(to_hex(2433),64,'0'),'hex'),decode(lpad(to_hex(2443),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2414),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000019',
    'parity-eligibility-2414@example.com','k1:'||lpad('2414',64,'0'),array['k1:'||lpad('2414',64,'0')],
    decode(lpad(to_hex(2434),64,'0'),'hex'),decode(lpad(to_hex(2444),64,'0'),'hex'),'otp-v1')$v2$,
  '23514','E07 current installation generation');
rollback to savepoint parity_enrollment_generation;

-- E08 disables only status. Suppress the lifecycle invalidation side effect
-- while constructing this isolated negative, then re-enable it before calls.
savepoint parity_enrollment_status;
alter table public.ghl_marketplace_installations
  disable trigger invalidate_every8d_settings_auth_after_install_update;
update public.ghl_marketplace_installations
set status='disabled'
where id='7b300000-0000-4000-8000-000000000002';
alter table public.ghl_marketplace_installations
  enable trigger invalidate_every8d_settings_auth_after_install_update;
select pg_temp.assert_true(
  (select status='disabled' and latest_lifecycle_event_type='INSTALL'
   from public.ghl_marketplace_installations
   where id='7b300000-0000-4000-8000-000000000002')
  and (select count(*)=2 and bool_and(revoked_at is null and consumed_at is null)
   from public.every8d_settings_enrollment_grants
   where token_hash in (decode(lpad(to_hex(2415),64,'0'),'hex'),
     decode(lpad(to_hex(2416),64,'0'),'hex'))),
  'E08 changes only installation status authority');
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2415),64,'0'),'hex')),
    'parity-eligibility-2415@example.com','k1:'||lpad('2415',64,'0'),array['k1:'||lpad('2415',64,'0')],
    decode(lpad(to_hex(2435),64,'0'),'hex'),decode(lpad(to_hex(2445),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2416),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000020',
    'parity-eligibility-2416@example.com','k1:'||lpad('2416',64,'0'),array['k1:'||lpad('2416',64,'0')],
    decode(lpad(to_hex(2436),64,'0'),'hex'),decode(lpad(to_hex(2446),64,'0'),'hex'),'otp-v1')$v2$,
  '23514','E08 disabled installation status');
rollback to savepoint parity_enrollment_status;

-- E09 changes only the lifecycle event type/watermark; status stays pending.
savepoint parity_enrollment_lifecycle;
update public.ghl_marketplace_installations
set latest_lifecycle_event_at=clock_timestamp(),
  latest_lifecycle_event_id='c3b3_parity_non_install',
  latest_lifecycle_event_type='UNINSTALL'
where id='7b300000-0000-4000-8000-000000000002';
select pg_temp.assert_true(
  (select status='pending' and latest_lifecycle_event_type='UNINSTALL'
   from public.ghl_marketplace_installations
   where id='7b300000-0000-4000-8000-000000000002')
  and (select count(*)=2 and bool_and(revoked_at is null and consumed_at is null)
   from public.every8d_settings_enrollment_grants
   where token_hash in (decode(lpad(to_hex(2417),64,'0'),'hex'),
     decode(lpad(to_hex(2418),64,'0'),'hex'))),
  'E09 changes only installation lifecycle authority');
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2417),64,'0'),'hex')),
    'parity-eligibility-2417@example.com','k1:'||lpad('2417',64,'0'),array['k1:'||lpad('2417',64,'0')],
    decode(lpad(to_hex(2437),64,'0'),'hex'),decode(lpad(to_hex(2447),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2418),64,'0'),'hex'),'7b306400-0000-4000-8000-000000000021',
    'parity-eligibility-2418@example.com','k1:'||lpad('2418',64,'0'),array['k1:'||lpad('2418',64,'0')],
    decode(lpad(to_hex(2438),64,'0'),'hex'),decode(lpad(to_hex(2448),64,'0'),'hex'),'otp-v1')$v2$,
  '23514','E09 non-INSTALL lifecycle');
rollback to savepoint parity_enrollment_lifecycle;

-- Complete matched enrollment rate parity. R01-R04 isolate every request
-- history predicate with paired last-allowed and first-refused fixtures.
do $$
declare token_n integer; request_token_n integer; bucket_n integer;
begin
  for token_n in 2501..2516 loop
    perform public.issue_every8d_settings_operator_enrollment_grant_v1(
      '7b300000-0000-4000-8000-000000000002',1,
      'parity-rate-'||token_n||'@example.com',
      decode(pg_catalog.lpad(pg_catalog.to_hex(token_n),64,'0'),'hex'),
      'operator_initial',pg_catalog.clock_timestamp()+interval '14 minutes',
      'c3b3-issuer','c3b3-approver','C3B3-PARITY-RATE-'||token_n,
      'matched enrollment rate parity');
  end loop;
  -- R02 history belongs to separate grants but retains the request alias, so
  -- the hourly predicate is measured without consuming the request-grant cap.
  for token_n in 2551..2554 loop
    request_token_n := token_n-46;
    perform public.issue_every8d_settings_operator_enrollment_grant_v1(
      '7b300000-0000-4000-8000-000000000002',1,
      'parity-rate-history-'||request_token_n||'@example.com',
      decode(pg_catalog.lpad(pg_catalog.to_hex(token_n),64,'0'),'hex'),
      'operator_initial',pg_catalog.clock_timestamp()+interval '14 minutes',
      'c3b3-issuer','c3b3-approver','C3B3-PARITY-RATE-HISTORY-'||token_n,
      'isolated hourly parity history');
  end loop;
  -- R03 uses four history grants per request identity. No history grant owns
  -- more than three rows, and the actual request grant owns none.
  for token_n in 2561..2576 loop
    request_token_n := 2509+((token_n-2561)/4);
    bucket_n := 1+mod(token_n-2561,4);
    perform public.issue_every8d_settings_operator_enrollment_grant_v1(
      '7b300000-0000-4000-8000-000000000002',1,
      'parity-rate-history-'||request_token_n||'-'||bucket_n||'@example.com',
      decode(pg_catalog.lpad(pg_catalog.to_hex(token_n),64,'0'),'hex'),
      'operator_initial',pg_catalog.clock_timestamp()+interval '14 minutes',
      'c3b3-issuer','c3b3-approver','C3B3-PARITY-RATE-HISTORY-'||token_n,
      'isolated daily parity history');
  end loop;
end;
$$;
select clock_timestamp() captured_at \gset parity_rate_
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,enrollment_grant_id,normalized_email,
  email_pseudonym,otp_hmac,otp_hmac_key_version,created_at,expires_at
)
select ('7b3a0000-0000-4000-8'||lpad((fixture.request_token_n-2500)::text,3,'0')||'-'||
    lpad(fixture.challenge_n::text,12,'0'))::uuid,
  decode(lpad(to_hex(260000+fixture.request_token_n*20+fixture.challenge_n),64,'0'),'hex'),
  'enrollment',g.id,fixture.history_email,fixture.history_pseudonym,
  decode(lpad(to_hex(270000+fixture.request_token_n*20+fixture.challenge_n),64,'0'),'hex'),
  'otp-v1',:'parity_rate_captured_at'::timestamptz-fixture.age_delta,
  least(:'parity_rate_captured_at'::timestamptz-fixture.age_delta+interval '10 minutes',
    g.expires_at)
from (
  select token_n request_token_n,token_n grant_token_n,1 challenge_n,
    'parity-rate-'||token_n||'@example.com' history_email,
    'k1:'||lpad(to_hex(token_n),64,'0') history_pseudonym,
    case when token_n in (2501,2502)
      then interval '60 seconds' else interval '30 seconds' end age_delta
  from generate_series(2501,2504) token_n
  union all
  select token_n request_token_n,2551+(token_n-2505) grant_token_n,challenge_n,
    'parity-rate-history-'||token_n||'@example.com' history_email,
    'k1:'||lpad(to_hex(token_n),64,'0') history_pseudonym,
    challenge_n*interval '10 minutes'
  from generate_series(2505,2508) token_n
  cross join lateral generate_series(1,case when token_n in (2505,2506) then 2 else 3 end)
    challenge_n
  union all
  select token_n request_token_n,
    2561+(token_n-2509)*4+((challenge_n-1)/3) grant_token_n,challenge_n,
    'parity-rate-history-'||token_n||'-'||(1+((challenge_n-1)/3))||'@example.com'
      history_email,
    'k1:'||lpad(to_hex(token_n),64,'0') history_pseudonym,
    (challenge_n+1)*interval '1 hour'
  from generate_series(2509,2512) token_n
  cross join lateral generate_series(1,case when token_n in (2509,2510) then 9 else 10 end)
    challenge_n
  union all
  select token_n request_token_n,token_n grant_token_n,challenge_n,
    'parity-rate-'||token_n||'@example.com' history_email,
    'k0:'||lpad(to_hex(token_n*100+challenge_n),64,'0') history_pseudonym,
    (challenge_n+1)*interval '1 hour'
  from generate_series(2513,2516) token_n
  cross join lateral generate_series(1,case when token_n in (2513,2514) then 2 else 3 end)
    challenge_n
) fixture
join public.every8d_settings_enrollment_grants g
  on g.token_hash=decode(lpad(to_hex(fixture.grant_token_n),64,'0'),'hex');

-- Adversarial fixture checks: each row names the intended first predicate and
-- proves all stricter competing predicates remain below their thresholds.
select pg_temp.assert_true(not exists (
  select 1 from generate_series(2501,2504) token_n
  join public.every8d_settings_enrollment_grants g
    on g.token_hash=decode(lpad(to_hex(token_n),64,'0'),'hex')
  cross join lateral (select
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.enrollment_grant_id=g.id) grant_count,
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.email_pseudonym='k1:'||lpad(to_hex(token_n),64,'0')
        and c.created_at>:'parity_rate_captured_at'::timestamptz-interval '60 seconds') recent_count,
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.email_pseudonym='k1:'||lpad(to_hex(token_n),64,'0')
        and c.created_at>:'parity_rate_captured_at'::timestamptz-interval '1 hour') hourly_count,
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.email_pseudonym='k1:'||lpad(to_hex(token_n),64,'0')
        and c.created_at>:'parity_rate_captured_at'::timestamptz-interval '24 hours') daily_count
  ) counts
  where counts.grant_count<>1 or counts.hourly_count<>1 or counts.daily_count<>1
    or counts.recent_count<>case when token_n in (2501,2502) then 0 else 1 end),
  'R01 isolates only the exclusive 60-second predicate');
select pg_temp.assert_true(not exists (
  select 1 from generate_series(2505,2508) token_n
  join public.every8d_settings_enrollment_grants g
    on g.token_hash=decode(lpad(to_hex(token_n),64,'0'),'hex')
  cross join lateral (select
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.enrollment_grant_id=g.id) grant_count,
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.email_pseudonym='k1:'||lpad(to_hex(token_n),64,'0')
        and c.created_at>:'parity_rate_captured_at'::timestamptz-interval '60 seconds') recent_count,
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.email_pseudonym='k1:'||lpad(to_hex(token_n),64,'0')
        and c.created_at>:'parity_rate_captured_at'::timestamptz-interval '1 hour') hourly_count,
    (select count(*) from public.every8d_settings_auth_challenge_failures f
      join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
      where c.email_pseudonym='k1:'||lpad(to_hex(token_n),64,'0')) failure_count
  ) counts
  where counts.grant_count<>0 or counts.recent_count<>0 or counts.failure_count<>0
    or counts.hourly_count<>case when token_n in (2505,2506) then 2 else 3 end),
  'R02 isolates hourly history on non-request grants');
select pg_temp.assert_true(not exists (
  select 1 from generate_series(2509,2512) token_n
  join public.every8d_settings_enrollment_grants g
    on g.token_hash=decode(lpad(to_hex(token_n),64,'0'),'hex')
  cross join lateral (select
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.enrollment_grant_id=g.id) grant_count,
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.email_pseudonym='k1:'||lpad(to_hex(token_n),64,'0')
        and c.created_at>:'parity_rate_captured_at'::timestamptz-interval '60 seconds') recent_count,
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.email_pseudonym='k1:'||lpad(to_hex(token_n),64,'0')
        and c.created_at>:'parity_rate_captured_at'::timestamptz-interval '1 hour') hourly_count,
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.email_pseudonym='k1:'||lpad(to_hex(token_n),64,'0')
        and c.created_at>:'parity_rate_captured_at'::timestamptz-interval '24 hours') daily_count,
    (select count(*) from public.every8d_settings_auth_challenge_failures f
      join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
      where c.email_pseudonym='k1:'||lpad(to_hex(token_n),64,'0')) failure_count
  ) counts
  where counts.grant_count<>0 or counts.recent_count<>0 or counts.hourly_count<>0
    or counts.failure_count<>0
    or counts.daily_count<>case when token_n in (2509,2510) then 9 else 10 end),
  'R03 isolates daily history across capped history grants');
select pg_temp.assert_true(not exists (
  select 1 from generate_series(2513,2516) token_n
  join public.every8d_settings_enrollment_grants g
    on g.token_hash=decode(lpad(to_hex(token_n),64,'0'),'hex')
  cross join lateral (select
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.enrollment_grant_id=g.id) grant_count,
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.email_pseudonym='k1:'||lpad(to_hex(token_n),64,'0')) alias_count,
    (select count(*) from public.every8d_settings_auth_challenge_failures f
      join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
      where c.email_pseudonym='k1:'||lpad(to_hex(token_n),64,'0')) failure_count
  ) counts
  where counts.alias_count<>0 or counts.failure_count<>0
    or counts.grant_count<>case when token_n in (2513,2514) then 2 else 3 end),
  'R04 isolates only the per-grant all-history predicate');

select pg_temp.assert_true((select count(*)=1 from
  public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2501),64,'0'),'hex')),
    'parity-rate-2501@example.com','k1:'||lpad(to_hex(2501),64,'0'),array['k1:'||lpad(to_hex(2501),64,'0')],
    decode(lpad(to_hex(2801),64,'0'),'hex'),decode(lpad(to_hex(2901),64,'0'),'hex'),'otp-v1'))
  and (select count(*)=1 from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2502),64,'0'),'hex'),'7b3a1000-0000-4000-8000-000000000001',
    'parity-rate-2502@example.com','k1:'||lpad(to_hex(2502),64,'0'),array['k1:'||lpad(to_hex(2502),64,'0')],
    decode(lpad(to_hex(2802),64,'0'),'hex'),decode(lpad(to_hex(2902),64,'0'),'hex'),'otp-v1')),
  'R01 60-second last-allowed v1/v2 enrollment requests');
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2503),64,'0'),'hex')),
    'parity-rate-2503@example.com','k1:'||lpad(to_hex(2503),64,'0'),array['k1:'||lpad(to_hex(2503),64,'0')],
    decode(lpad(to_hex(2803),64,'0'),'hex'),decode(lpad(to_hex(2903),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2504),64,'0'),'hex'),'7b3a1000-0000-4000-8000-000000000002',
    'parity-rate-2504@example.com','k1:'||lpad(to_hex(2504),64,'0'),array['k1:'||lpad(to_hex(2504),64,'0')],
    decode(lpad(to_hex(2804),64,'0'),'hex'),decode(lpad(to_hex(2904),64,'0'),'hex'),'otp-v1')$v2$,
  'P0001','R01 60-second first-refused v1/v2 enrollment requests');

select pg_temp.assert_true((select count(*)=1 from
  public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2505),64,'0'),'hex')),
    'parity-rate-2505@example.com','k1:'||lpad(to_hex(2505),64,'0'),array['k1:'||lpad(to_hex(2505),64,'0')],
    decode(lpad(to_hex(2805),64,'0'),'hex'),decode(lpad(to_hex(2905),64,'0'),'hex'),'otp-v1'))
  and (select count(*)=1 from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2506),64,'0'),'hex'),'7b3a1000-0000-4000-8000-000000000003',
    'parity-rate-2506@example.com','k1:'||lpad(to_hex(2506),64,'0'),array['k1:'||lpad(to_hex(2506),64,'0')],
    decode(lpad(to_hex(2806),64,'0'),'hex'),decode(lpad(to_hex(2906),64,'0'),'hex'),'otp-v1')),
  'R02 hourly last-allowed v1/v2 enrollment requests');
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2507),64,'0'),'hex')),
    'parity-rate-2507@example.com','k1:'||lpad(to_hex(2507),64,'0'),array['k1:'||lpad(to_hex(2507),64,'0')],
    decode(lpad(to_hex(2807),64,'0'),'hex'),decode(lpad(to_hex(2907),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2508),64,'0'),'hex'),'7b3a1000-0000-4000-8000-000000000004',
    'parity-rate-2508@example.com','k1:'||lpad(to_hex(2508),64,'0'),array['k1:'||lpad(to_hex(2508),64,'0')],
    decode(lpad(to_hex(2808),64,'0'),'hex'),decode(lpad(to_hex(2908),64,'0'),'hex'),'otp-v1')$v2$,
  'P0001','R02 hourly first-refused v1/v2 enrollment requests');

select pg_temp.assert_true((select count(*)=1 from
  public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2509),64,'0'),'hex')),
    'parity-rate-2509@example.com','k1:'||lpad(to_hex(2509),64,'0'),array['k1:'||lpad(to_hex(2509),64,'0')],
    decode(lpad(to_hex(2809),64,'0'),'hex'),decode(lpad(to_hex(2909),64,'0'),'hex'),'otp-v1'))
  and (select count(*)=1 from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2510),64,'0'),'hex'),'7b3a1000-0000-4000-8000-000000000005',
    'parity-rate-2510@example.com','k1:'||lpad(to_hex(2510),64,'0'),array['k1:'||lpad(to_hex(2510),64,'0')],
    decode(lpad(to_hex(2810),64,'0'),'hex'),decode(lpad(to_hex(2910),64,'0'),'hex'),'otp-v1')),
  'R03 24-hour last-allowed v1/v2 enrollment requests');
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2511),64,'0'),'hex')),
    'parity-rate-2511@example.com','k1:'||lpad(to_hex(2511),64,'0'),array['k1:'||lpad(to_hex(2511),64,'0')],
    decode(lpad(to_hex(2811),64,'0'),'hex'),decode(lpad(to_hex(2911),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2512),64,'0'),'hex'),'7b3a1000-0000-4000-8000-000000000006',
    'parity-rate-2512@example.com','k1:'||lpad(to_hex(2512),64,'0'),array['k1:'||lpad(to_hex(2512),64,'0')],
    decode(lpad(to_hex(2812),64,'0'),'hex'),decode(lpad(to_hex(2912),64,'0'),'hex'),'otp-v1')$v2$,
  'P0001','R03 24-hour first-refused v1/v2 enrollment requests');

select pg_temp.assert_true((select count(*)=1 from
  public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2513),64,'0'),'hex')),
    'parity-rate-2513@example.com','k1:'||lpad(to_hex(2513),64,'0'),array['k1:'||lpad(to_hex(2513),64,'0')],
    decode(lpad(to_hex(2813),64,'0'),'hex'),decode(lpad(to_hex(2913),64,'0'),'hex'),'otp-v1'))
  and (select count(*)=1 from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2514),64,'0'),'hex'),'7b3a1000-0000-4000-8000-000000000007',
    'parity-rate-2514@example.com','k1:'||lpad(to_hex(2514),64,'0'),array['k1:'||lpad(to_hex(2514),64,'0')],
    decode(lpad(to_hex(2814),64,'0'),'hex'),decode(lpad(to_hex(2914),64,'0'),'hex'),'otp-v1')),
  'R04 per-grant last-allowed v1/v2 enrollment requests');
select pg_temp.assert_expected_enrollment_negative_parity(
  $v1$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2515),64,'0'),'hex')),
    'parity-rate-2515@example.com','k1:'||lpad(to_hex(2515),64,'0'),array['k1:'||lpad(to_hex(2515),64,'0')],
    decode(lpad(to_hex(2815),64,'0'),'hex'),decode(lpad(to_hex(2915),64,'0'),'hex'),'otp-v1')$v1$,
  $v2$select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2516),64,'0'),'hex'),'7b3a1000-0000-4000-8000-000000000008',
    'parity-rate-2516@example.com','k1:'||lpad(to_hex(2516),64,'0'),array['k1:'||lpad(to_hex(2516),64,'0')],
    decode(lpad(to_hex(2816),64,'0'),'hex'),decode(lpad(to_hex(2916),64,'0'),'hex'),'otp-v1')$v2$,
  'P0001','R04 per-grant first-refused v1/v2 enrollment requests');

-- R05 adds the v1 half matching the existing runtime nine/ten failure cases.
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-failure-v1-pass@example.com',
  decode(lpad(to_hex(2521),64,'0'),'hex'),'operator_initial',clock_timestamp()+interval '14 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-FAILURE-2521','failure parity')
  \gset parity_failure_v1_pass_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-failure-v1-refuse@example.com',
  decode(lpad(to_hex(2522),64,'0'),'hex'),'operator_initial',clock_timestamp()+interval '14 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-FAILURE-2522','failure parity')
  \gset parity_failure_v1_refuse_
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,enrollment_grant_id,normalized_email,email_pseudonym,
  otp_hmac,otp_hmac_key_version,created_at,expires_at
)
select ('7b3a2000-0000-4000-8'||lpad((token_n-2520)::text,3,'0')||'-'||
    lpad(challenge_n::text,12,'0'))::uuid,
  decode(lpad(to_hex(300000+token_n*10+challenge_n),64,'0'),'hex'),'enrollment',g.id,
  'parity-failure-v1-'||case token_n when 2521 then 'pass' else 'refuse' end||'@example.com',
  'k1:'||lpad(to_hex(token_n),64,'0'),
  decode(lpad(to_hex(310000+token_n*10+challenge_n),64,'0'),'hex'),'otp-v1',captured_at,
  least(captured_at+interval '10 minutes',g.expires_at)
from (values (2521,1),(2521,2),(2522,1),(2522,2)) fixture(token_n,challenge_n)
join public.every8d_settings_enrollment_grants g
  on g.token_hash=decode(lpad(to_hex(token_n),64,'0'),'hex')
cross join lateral (select clock_timestamp()-interval '5 minutes' captured_at) t;
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(lpad(to_hex(300000+token_n*10+challenge_n),64,'0'),'hex'),true,null),
  'R05 v1 parity fixture delivery recorded')
from (values (2521,1),(2521,2),(2522,1),(2522,2)) fixture(token_n,challenge_n);
do $$
declare fixture record;
begin
  for fixture in select * from (values
    ('7b3a2000-0000-4000-8001-000000000001'::uuid,5),
    ('7b3a2000-0000-4000-8001-000000000002'::uuid,4),
    ('7b3a2000-0000-4000-8002-000000000001'::uuid,5),
    ('7b3a2000-0000-4000-8002-000000000002'::uuid,5)
  ) failures(challenge_id,failure_count) loop
    perform pg_temp.append_challenge_failures(fixture.challenge_id,fixture.failure_count);
  end loop;
end;
$$;
select pg_temp.assert_true(not exists (
  select 1 from (values (2521,9),(2522,10)) expected(token_n,failure_count)
  join public.every8d_settings_enrollment_grants g
    on g.token_hash=decode(lpad(to_hex(expected.token_n),64,'0'),'hex')
  cross join lateral (select
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.enrollment_grant_id=g.id) grant_count,
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.email_pseudonym='k1:'||lpad(to_hex(expected.token_n),64,'0')
        and c.created_at>clock_timestamp()-interval '60 seconds') recent_count,
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.email_pseudonym='k1:'||lpad(to_hex(expected.token_n),64,'0')
        and c.created_at>clock_timestamp()-interval '1 hour') hourly_count,
    (select count(*) from public.every8d_settings_auth_challenges c
      where c.email_pseudonym='k1:'||lpad(to_hex(expected.token_n),64,'0')
        and c.created_at>clock_timestamp()-interval '24 hours') daily_count,
    (select count(*) from public.every8d_settings_auth_challenge_failures f
      join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
      where c.email_pseudonym='k1:'||lpad(to_hex(expected.token_n),64,'0')
        and f.failed_at>clock_timestamp()-interval '1 hour') failure_count
  ) counts
  where counts.grant_count<>2 or counts.recent_count<>0
    or counts.hourly_count<>2 or counts.daily_count<>2
    or counts.failure_count<>expected.failure_count),
  'R05 isolates recent failures below all request-history and grant caps');
select pg_temp.assert_true((select count(*)=1 from
  public.request_every8d_settings_enrollment_challenge_v1(
    :'parity_failure_v1_pass_grant_id'::uuid,'parity-failure-v1-pass@example.com',
    'k1:'||lpad(to_hex(2521),64,'0'),array['k1:'||lpad(to_hex(2521),64,'0')],
    decode(lpad(to_hex(3251),64,'0'),'hex'),decode(lpad(to_hex(3252),64,'0'),'hex'),'otp-v1')),
  'R05 nine recent failures are the last-allowed v1 enrollment request');
select pg_temp.reject($sql$select * from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants where token_hash=decode(lpad(to_hex(2522),64,'0'),'hex')),
    'parity-failure-v1-refuse@example.com','k1:'||lpad(to_hex(2522),64,'0'),
    array['k1:'||lpad(to_hex(2522),64,'0')],decode(lpad(to_hex(3253),64,'0'),'hex'),
    decode(lpad(to_hex(3254),64,'0'),'hex'),'otp-v1')$sql$,
  'P0001','R05 ten recent failures are the first-refused v1 enrollment request');
select pg_temp.assert_true(
  (select count(*)=9 from public.every8d_settings_auth_challenge_failures f
    join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
    where c.email_pseudonym='k1:'||lpad(to_hex(2521),64,'0'))
  and (select count(*)=10 from public.every8d_settings_auth_challenge_failures f
    join public.every8d_settings_auth_challenges c on c.id=f.challenge_id
    where c.email_pseudonym='k1:'||lpad(to_hex(2522),64,'0')),
  'R05 matched v1 fixtures preserve the runtime nine/ten failure boundary');

-- Initial enrollment requests for the committed resend parity sequence. The
-- shell harness crosses the common 60-second boundary, invokes v1 and v2 again,
-- and proves equivalent supersession/new-row behavior.
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-enroll-resend-v1@example.com',
  decode(lpad(to_hex(2201),64,'0'),'hex'),'operator_initial',clock_timestamp()+interval '14 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-ENROLL-RESEND-V1','enrollment resend parity') \gset parity_enroll_resend_v1_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-enroll-resend-v2@example.com',
  decode(lpad(to_hex(2202),64,'0'),'hex'),'operator_initial',clock_timestamp()+interval '14 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-ENROLL-RESEND-V2','enrollment resend parity') \gset parity_enroll_resend_v2_
select * from public.request_every8d_settings_enrollment_challenge_v1(
  :'parity_enroll_resend_v1_grant_id'::uuid,'parity-enroll-resend-v1@example.com',
  'k1:'||repeat('c',63)||'3',array['k1:'||repeat('c',63)||'3'],
  decode(lpad(to_hex(2211),64,'0'),'hex'),decode(lpad(to_hex(2212),64,'0'),'hex'),
  'otp-v1') \gset parity_enroll_resend_v1_first_
select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
  decode(lpad(to_hex(2202),64,'0'),'hex'),'7b306300-0000-4000-8000-000000000001',
  'parity-enroll-resend-v2@example.com','k1:'||repeat('d',63)||'4',
  array['k1:'||repeat('d',63)||'4'],decode(lpad(to_hex(2213),64,'0'),'hex'),
  decode(lpad(to_hex(2214),64,'0'),'hex'),'otp-v1') \gset parity_enroll_resend_v2_first_
select pg_temp.assert_true((select count(*)=2 and bool_and(
    purpose='enrollment' and delivery_succeeded_at is null
    and delivery_failed_at is null and superseded_at is null)
  from public.every8d_settings_auth_challenges
  where id in (:'parity_enroll_resend_v1_first_challenge_id'::uuid,
    :'parity_enroll_resend_v2_first_challenge_id'::uuid)),
  'matched v1/v2 enrollment resend sequences begin with authoritative pending rows');

select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-resend-v1@example.com',
  decode(repeat('9d',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-RESEND-V1','resend parity') \gset parity_resend_v1_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('9d',32),'hex'),'parity-resend-v1@example.com',
  'k1:'||repeat('8',63)||'e') \gset parity_resend_v1_admin_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'parity-resend-v2@example.com',
  decode(repeat('9e',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARITY-RESEND-V2','resend parity') \gset parity_resend_v2_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('9e',32),'hex'),'parity-resend-v2@example.com',
  'k1:'||repeat('9',63)||'f') \gset parity_resend_v2_admin_
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
)
select fixture.id,fixture.request_hash,'login',fixture.email,fixture.alias,
  fixture.otp_hmac,'otp-v1',captured_at,captured_at+interval '10 minutes'
from (values
  ('7b306100-0000-4000-8000-000000000001'::uuid,decode(repeat('9f',32),'hex'),
    'parity-resend-v1@example.com','k1:'||repeat('8',63)||'e',decode(repeat('a0',32),'hex')),
  ('7b306100-0000-4000-8000-000000000002'::uuid,decode(repeat('a9',32),'hex'),
    'parity-resend-v2@example.com','k1:'||repeat('9',63)||'f',decode(repeat('aa',32),'hex'))
) fixture(id,request_hash,email,alias,otp_hmac)
cross join lateral (select clock_timestamp()-interval '2 minutes' captured_at) t;
select * from public.request_every8d_settings_login_challenge_v1(
  'parity-resend-v1@example.com','k1:'||repeat('8',63)||'e',
  array['k1:'||repeat('8',63)||'e'],decode(repeat('ab',32),'hex'),
  decode(repeat('ac',32),'hex'),'otp-v1') \gset parity_resend_v1_new_
select * from public.runtime_request_every8d_settings_login_challenge_v1(
  '7b306100-0000-4000-8000-000000000003','parity-resend-v2@example.com',
  'k1:'||repeat('9',63)||'f',array['k1:'||repeat('9',63)||'f'],
  decode(repeat('ad',32),'hex'),decode(repeat('ae',32),'hex'),'otp-v1') \gset parity_resend_v2_new_
select pg_temp.assert_true((select count(*)=2
    and bool_and(superseded_at is not null and supersession_reason='resend'
      and normalized_email is null and email_scrubbed_at=superseded_at)
  from public.every8d_settings_auth_challenges
  where id in ('7b306100-0000-4000-8000-000000000001',
    '7b306100-0000-4000-8000-000000000002')),
  'v1 and v2 preserve resend supersession and email scrub semantics');
select pg_temp.assert_true((select count(*)=2
    and bool_and(superseded_at is null and delivery_succeeded_at is null
      and expires_at=created_at+interval '10 minutes')
  from public.every8d_settings_auth_challenges
  where id in (:'parity_resend_v1_new_challenge_id'::uuid,
    :'parity_resend_v2_new_challenge_id'::uuid)),
  'v1 and v2 preserve new authoritative resend state');

-- Enrollment request resolves only token-hash authority and preserves nondisclosure.
select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
  decode(repeat('81',32),'hex'),'7b310000-0000-4000-8000-000000000001',
  'enroll@example.com','k1:'||repeat('1',64),array['k0:'||repeat('1',64),'k1:'||repeat('1',64)],
  decode(repeat('91',32),'hex'),decode(repeat('a1',32),'hex'),'otp-v2') \gset enrollment_
select pg_temp.assert_true(:'enrollment_challenge_id'::uuid =
  '7b310000-0000-4000-8000-000000000001'::uuid
  and :'enrollment_created_at'::timestamptz is not null
  and :'enrollment_expires_at'::timestamptz is not null,
  'valid enrollment uses supplied UUID and returns a complete row');
select pg_temp.assert_true((select count(*) = 0 from
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(repeat('ff',32),'hex'),'7b310000-0000-4000-8000-000000000002',
    'enroll@example.com','k1:'||repeat('1',64),array['k1:'||repeat('1',64)],
    decode(repeat('92',32),'hex'),decode(repeat('a2',32),'hex'),'otp-v2')),
  'nonexistent grant hash is nondisclosing zero rows');
select pg_temp.assert_true((select count(*) = 0 from
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(repeat('81',32),'hex'),'7b310000-0000-4000-8000-000000000003',
    'mismatch@example.com','k1:'||repeat('3',64),array['k1:'||repeat('3',64)],
    decode(repeat('93',32),'hex'),decode(repeat('a3',32),'hex'),'otp-v2')),
  'pinned email mismatch is nondisclosing zero rows');
select pg_temp.reject($sql$select * from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b310000-0000-3000-8000-000000000004','login@example.com',
    'k1:'||repeat('2',64),array['k1:'||repeat('2',64)],
    decode(repeat('94',32),'hex'),decode(repeat('a4',32),'hex'),'otp-v2')$sql$,
  '23514','wrong UUID version rejected');
select pg_temp.reject($sql$select * from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b310000-0000-4000-7000-000000000005','login@example.com',
    'k1:'||repeat('2',64),array['k1:'||repeat('2',64)],
    decode(repeat('95',32),'hex'),decode(repeat('a5',32),'hex'),'otp-v2')$sql$,
  '23514','wrong UUID variant rejected');

-- Delivery is a one-shot bridge; pending challenges are not discoverable/verifiable.
select pg_temp.assert_true((select count(*) = 0 from
  public.runtime_discover_every8d_settings_challenge_v1(
    decode(repeat('91',32),'hex'),'enrollment')),
  'orphan pending-delivery challenge is undiscoverable');
select pg_temp.assert_true(not public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('91',32),'hex'),'enrollment',array['k0:'||repeat('1',64),'k1:'||repeat('1',64)],
  decode(repeat('a1',32),'hex')),'orphan pending-delivery challenge cannot verify');
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('91',32),'hex'),true,null),'successful delivery records once');
select pg_temp.assert_true(not public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('91',32),'hex'),true,null),'duplicate delivery is false');
select pg_temp.assert_true((select challenge_id = :'enrollment_challenge_id'::uuid
    and enrollment_grant_id = :'enroll_grant_id'::uuid
    and normalized_email = 'enroll@example.com'
    and email_pseudonym = 'k1:'||repeat('1',64)
    and otp_hmac_key_version = 'otp-v2'
  from public.runtime_discover_every8d_settings_challenge_v1(
    decode(repeat('91',32),'hex'),'enrollment')),
  'discovery returns only protected minimum live metadata');
select pg_temp.assert_true(public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('91',32),'hex'),'enrollment',array['k0:'||repeat('1',64),'k1:'||repeat('1',64)],
  decode(repeat('a1',32),'hex')),'correct enrollment OTP verifies');
select pg_temp.assert_true(not public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('91',32),'hex'),'enrollment',array['k1:'||repeat('1',64)],
  decode(repeat('a1',32),'hex')),'verification replay is rejected');

-- The shell harness uses this committed administrator fixture to create a
-- PENDING_DELIVERY orphan through the runtime request wrapper in its own
-- transaction. It then proves that verification cannot consume the orphan and
-- that a later explicit request, after the frozen resend boundary, supersedes
-- it without any automatic delivery or state transition.
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'orphan-explicit@example.com',
  decode(repeat('af',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-ORPHAN-EXPLICIT','orphan supersession') \gset orphan_explicit_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('af',32),'hex'),'orphan-explicit@example.com',
  'k1:'||repeat('a',63)||'1') \gset orphan_explicit_admin_

-- Login request and current administrator authority.
select * from public.runtime_request_every8d_settings_login_challenge_v1(
  '7b320000-0000-4000-8000-000000000001','login@example.com',
  'k1:'||repeat('2',64),array['k0:'||repeat('2',64),'k1:'||repeat('2',64)],
  decode(repeat('96',32),'hex'),decode(repeat('a6',32),'hex'),'otp-v1') \gset login_ch_
select pg_temp.assert_true(:'login_ch_challenge_id'::uuid =
  '7b320000-0000-4000-8000-000000000001'::uuid,'valid login prepared');
select pg_temp.assert_true((select count(*) = 0 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b320000-0000-4000-8000-000000000002','none@example.com',
    'k1:'||repeat('4',64),array['k1:'||repeat('4',64)],
    decode(repeat('97',32),'hex'),decode(repeat('a7',32),'hex'),'otp-v1')),
  'no-account login is nondisclosing zero rows');
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('96',32),'hex'),true,null),'login delivery recorded');
select pg_temp.assert_true(not public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('96',32),'hex'),'login',array['k0:'||repeat('2',64),'k1:'||repeat('2',64)],
  decode(repeat('ff',32),'hex')),'wrong login OTP rejected');
select pg_temp.assert_true((select count(*) = 1 from
  public.every8d_settings_auth_challenge_failures
  where challenge_id = :'login_ch_challenge_id'::uuid),
  'wrong OTP appends exactly one failure');
select pg_temp.assert_true(public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('96',32),'hex'),'login',array['k0:'||repeat('2',64),'k1:'||repeat('2',64)],
  decode(repeat('a6',32),'hex')),'correct login OTP verifies after one failure');

-- Discovery is deliberately non-authoritative. Capture its metadata, mutate
-- protected authority in a separate statement, then prove the stale metadata
-- cannot authorize verification.
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'discover-grant@example.com',
  decode(repeat('b8',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-DISCOVER-GRANT','discover mutate verify') \gset dmv_enroll_grant_
select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
  decode(repeat('b8',32),'hex'),'7b321000-0000-4000-8000-000000000001',
  'discover-grant@example.com','k1:'||repeat('b',63)||'1',
  array['k1:'||repeat('b',63)||'1'],decode(repeat('b9',32),'hex'),
  decode(repeat('ba',32),'hex'),'otp-v1') \gset dmv_enroll_request_
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('b9',32),'hex'),true,null),'discover enrollment delivery recorded');
select * from public.runtime_discover_every8d_settings_challenge_v1(
  decode(repeat('b9',32),'hex'),'enrollment') \gset dmv_enroll_discovery_
select pg_temp.assert_true(:'dmv_enroll_discovery_challenge_id'::uuid=
  :'dmv_enroll_request_challenge_id'::uuid,
  'enrollment metadata is live before authority mutation');
update public.every8d_settings_enrollment_grants
set revoked_at=clock_timestamp(),revocation_reason='discover_then_revoke'
where id=:'dmv_enroll_grant_grant_id'::uuid;
select pg_temp.assert_true(not public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('b9',32),'hex'),'enrollment',
  array[:'dmv_enroll_discovery_email_pseudonym'],decode(repeat('ba',32),'hex')),
  'revoked grant rejects verification using previously discovered metadata');

select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'discover-admin@example.com',
  decode(repeat('bb',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-DISCOVER-ADMIN','discover mutate verify') \gset dmv_login_grant_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('bb',32),'hex'),'discover-admin@example.com',
  'k1:'||repeat('c',63)||'2') \gset dmv_login_admin_
select * from public.runtime_request_every8d_settings_login_challenge_v1(
  '7b321000-0000-4000-8000-000000000002','discover-admin@example.com',
  'k1:'||repeat('c',63)||'2',array['k1:'||repeat('c',63)||'2'],
  decode(repeat('bc',32),'hex'),decode(repeat('bd',32),'hex'),'otp-v1') \gset dmv_login_request_
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('bc',32),'hex'),true,null),'discover login delivery recorded');
select * from public.runtime_discover_every8d_settings_challenge_v1(
  decode(repeat('bc',32),'hex'),'login') \gset dmv_login_discovery_
select pg_temp.assert_true(:'dmv_login_discovery_challenge_id'::uuid=
  :'dmv_login_request_challenge_id'::uuid,
  'login metadata is live before authority mutation');
update public.every8d_settings_administrators
set revoked_at=clock_timestamp(),revocation_reason='discover_then_revoke'
where id=:'dmv_login_admin_administrator_id'::uuid;
select pg_temp.assert_true(not public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('bc',32),'hex'),'login',
  array[:'dmv_login_discovery_email_pseudonym'],decode(repeat('bd',32),'hex')),
  'revoked administrator rejects verification using previously discovered metadata');

-- Revoked administrators and stale installation generations are not authority.
update public.every8d_settings_administrators
set revoked_at=clock_timestamp(), revocation_reason='c3b3_proof'
where id=:'admin_administrator_id';
select pg_temp.assert_true((select count(*) = 0 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b320000-0000-4000-8000-000000000003','login@example.com',
    'k1:'||repeat('2',64),array['k1:'||repeat('2',64)],
    decode(repeat('98',32),'hex'),decode(repeat('a8',32),'hex'),'otp-v1')),
  'revoked administrator cannot prepare login');

-- Four terminal delivery classes and duplicate recording are delegated unchanged.
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
)
select ('7b330000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  decode(lpad(to_hex(160+n),64,'0'),'hex'),'login','delivery'||n||'@example.com',
  'k1:'||repeat(to_hex(n),64),decode(lpad(to_hex(176+n),64,'0'),'hex'),'otp-v1',
  clock_timestamp(),clock_timestamp()+interval '10 minutes'
from generate_series(1,3) n;
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(lpad(to_hex(161),64,'0'),'hex'),false,'provider_rejected'),
  'provider_rejected recorded');
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(lpad(to_hex(162),64,'0'),'hex'),false,'sender_unavailable'),
  'sender_unavailable recorded');
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(lpad(to_hex(163),64,'0'),'hex'),false,'delivery_outcome_unknown'),
  'delivery_outcome_unknown recorded');
select pg_temp.assert_true(not public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(lpad(to_hex(163),64,'0'),'hex'),false,'delivery_outcome_unknown'),
  'failed delivery duplicate is false');

-- Five failed attempts retain existing trigger authority and scrub on attempt five.
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'five@example.com',
  decode(repeat('b0',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-FIVE','failure ledger identity') \gset five_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('b0',32),'hex'),'five@example.com','k1:'||repeat('5',64)) \gset five_admin_
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) select '7b340000-0000-4000-8000-000000000001',decode(repeat('b1',32),'hex'),
  'login','five@example.com','k1:'||repeat('5',64),decode(repeat('b2',32),'hex'),
  'otp-v1',captured_at,captured_at+interval '10 minutes'
from (select clock_timestamp() captured_at) t;
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('b1',32),'hex'),true,null),'fifth-failure fixture delivery recorded');
select public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('b1',32),'hex'),'login',array['k1:'||repeat('5',64)],
  decode(repeat('b3',32),'hex')) from generate_series(1,5);
set constraints all immediate;
set constraints all deferred;
select pg_temp.assert_true((select locked_at is not null and normalized_email is null
    and email_scrubbed_at = locked_at
  from public.every8d_settings_auth_challenges
  where id='7b340000-0000-4000-8000-000000000001'),
  'fifth failure trigger locks and scrubs atomically');
select pg_temp.assert_true((select array_agg(attempt_number order by attempt_number)
    = array[1,2,3,4,5]
  from public.every8d_settings_auth_challenge_failures
  where challenge_id='7b340000-0000-4000-8000-000000000001'),
  'failure attempt numbers remain contiguous');

-- Unique collisions roll back supersession and do not partially regenerate.
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'collision@example.com',
  decode(repeat('c0',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-COLLISION','collision identity') \gset collision_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('c0',32),'hex'),'collision@example.com','k1:'||repeat('6',64)) \gset collision_admin_
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) select '7b350000-0000-4000-8000-000000000001',decode(repeat('c1',32),'hex'),
  'login','collision@example.com','k1:'||repeat('6',64),decode(repeat('c2',32),'hex'),
  'otp-v1',captured_at,captured_at+interval '10 minutes'
from (select clock_timestamp()-interval '2 minutes' captured_at) t;
select pg_temp.reject($sql$select * from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b350000-0000-4000-8000-000000000001','collision@example.com',
    'k1:'||repeat('6',64),array['k1:'||repeat('6',64)],
    decode(repeat('c3',32),'hex'),decode(repeat('c4',32),'hex'),'otp-v1')$sql$,
  '23505','UUID collision rejects whole statement');
select pg_temp.assert_true((select superseded_at is null
  from public.every8d_settings_auth_challenges
  where id='7b350000-0000-4000-8000-000000000001'),
  'collision leaves preexisting row unchanged');
select pg_temp.reject($sql$select * from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b350000-0000-4000-8000-000000000002','collision@example.com',
    'k1:'||repeat('6',64),array['k1:'||repeat('6',64)],
    decode(repeat('c1',32),'hex'),decode(repeat('c5',32),'hex'),'otp-v1')$sql$,
  '23505','request-token-hash collision rejects whole statement');
select pg_temp.assert_true((select superseded_at is null
  from public.every8d_settings_auth_challenges
  where id='7b350000-0000-4000-8000-000000000001'),
  'request-token collision rolls back supersession');
select * from public.runtime_request_every8d_settings_login_challenge_v1(
  '7b350000-0000-4000-8000-000000000003','collision@example.com',
  'k1:'||repeat('6',64),array['k1:'||repeat('6',64)],
  decode(repeat('c6',32),'hex'),decode(repeat('c7',32),'hex'),'otp-v1') \gset resend_
select pg_temp.assert_true((select supersession_reason='resend'
    and normalized_email is null and email_scrubbed_at=superseded_at
  from public.every8d_settings_auth_challenges
  where id='7b350000-0000-4000-8000-000000000001')
  and :'resend_challenge_id'::uuid='7b350000-0000-4000-8000-000000000003'::uuid,
  'later explicit request safely supersedes and inserts once');

-- Lifecycle invalidation and generation invalidation are independent proofs on
-- separate installation parents. Each starts from successfully discovered
-- login metadata and rejects that stale challenge after exactly one authority
-- dimension changes.
insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id) values
  ('7b370000-0000-4000-8000-000000000001','c3b3-lifecycle-only-location',
    'c3b3-lifecycle-only-provider','c3b3-lifecycle-only-line'),
  ('7b370000-0000-4000-8000-000000000003','c3b3-generation-only-location',
    'c3b3-generation-only-provider','c3b3-generation-only-line');
insert into public.ghl_marketplace_installations(
  id,app_namespace,marketplace_app_id,oauth_client_id,tenant_id,location_id,
  company_id,conversation_provider_id,channel,provider,status,installation_generation,
  access_token_ciphertext,refresh_token_ciphertext,encryption_key_version,
  token_expires_at,granted_scopes,credential_revision,credential_state,
  latest_lifecycle_event_at,latest_lifecycle_event_id,latest_lifecycle_event_type,
  latest_lifecycle_version_id
)
select fixture.installation_id,'every8d_connect',r.marketplace_app_id,r.oauth_client_id,
  fixture.tenant_id,fixture.location_id,fixture.company_id,r.conversation_provider_id,
  'sms','every8d','pending',1,null,null,null,null,'{}'::text[],0,'none',clock_timestamp(),
  fixture.event_id,'INSTALL',v.marketplace_version_id
from (values
  ('7b370000-0000-4000-8000-000000000002'::uuid,
    '7b370000-0000-4000-8000-000000000001'::uuid,
    'c3b3-lifecycle-only-location','c3b3-lifecycle-only-company','c3b3_lifecycle_install'),
  ('7b370000-0000-4000-8000-000000000004'::uuid,
    '7b370000-0000-4000-8000-000000000003'::uuid,
    'c3b3-generation-only-location','c3b3-generation-only-company','c3b3_generation_install')
) fixture(installation_id,tenant_id,location_id,company_id,event_id)
join public.ghl_marketplace_app_registrations r on r.app_namespace='every8d_connect'
cross join lateral (select version.marketplace_version_id
  from public.ghl_marketplace_app_version_registrations version
  where version.app_namespace=r.app_namespace
  order by version.marketplace_version_id limit 1) v;

select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b370000-0000-4000-8000-000000000002',1,'lifecycle-only@example.com',
  decode(repeat('0b',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-LIFECYCLE-ONLY','independent invalidation') \gset lifecycle_only_grant_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('0b',32),'hex'),'lifecycle-only@example.com',
  'k1:'||repeat('3',63)||'8') \gset lifecycle_only_admin_
select * from public.runtime_request_every8d_settings_login_challenge_v1(
  '7b371000-0000-4000-8000-000000000001','lifecycle-only@example.com',
  'k1:'||repeat('3',63)||'8',array['k1:'||repeat('3',63)||'8'],
  decode(repeat('0c',32),'hex'),decode(repeat('0d',32),'hex'),'otp-v1') \gset lifecycle_only_ch_
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('0c',32),'hex'),true,null),'lifecycle-only delivery recorded');
select pg_temp.assert_true((select count(*)=1 from
  public.runtime_discover_every8d_settings_challenge_v1(
    decode(repeat('0c',32),'hex'),'login')),
  'lifecycle-only challenge discovered before mutation');
update public.ghl_marketplace_installations
set status='uninstalled',latest_lifecycle_event_at=clock_timestamp(),
  latest_lifecycle_event_id='c3b3_lifecycle_only_uninstall',
  latest_lifecycle_event_type='UNINSTALL'
where id='7b370000-0000-4000-8000-000000000002';
select pg_temp.assert_true(not public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('0c',32),'hex'),'login',array['k1:'||repeat('3',63)||'8'],
  decode(repeat('0d',32),'hex')),
  'lifecycle-only uninstall invalidates stale verification');

select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b370000-0000-4000-8000-000000000004',1,'generation-only@example.com',
  decode(repeat('0e',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-GENERATION-ONLY','independent invalidation') \gset generation_only_grant_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('0e',32),'hex'),'generation-only@example.com',
  'k1:'||repeat('4',63)||'9') \gset generation_only_admin_
select * from public.runtime_request_every8d_settings_login_challenge_v1(
  '7b371000-0000-4000-8000-000000000002','generation-only@example.com',
  'k1:'||repeat('4',63)||'9',array['k1:'||repeat('4',63)||'9'],
  decode(repeat('0f',32),'hex'),decode(repeat('10',32),'hex'),'otp-v1') \gset generation_only_ch_
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('0f',32),'hex'),true,null),'generation-only delivery recorded');
select pg_temp.assert_true((select count(*)=1 from
  public.runtime_discover_every8d_settings_challenge_v1(
    decode(repeat('0f',32),'hex'),'login')),
  'generation-only challenge discovered before mutation');
update public.ghl_marketplace_installations
set installation_generation=2,latest_lifecycle_event_at=clock_timestamp(),
  latest_lifecycle_event_id='c3b3_generation_only_install',
  latest_lifecycle_event_type='INSTALL'
where id='7b370000-0000-4000-8000-000000000004';
select pg_temp.assert_true(not public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('0f',32),'hex'),'login',array['k1:'||repeat('4',63)||'9'],
  decode(repeat('10',32),'hex')),
  'generation-only change invalidates stale verification');

-- Exact expiry predicate: a delivered challenge with expires_at still in the
-- future is eligible. The paired shell fixture below is delivered before its
-- boundary, waits across expires_at, and is rejected at/after that boundary.
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'expiry-before@example.com',
  decode(repeat('11',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-EXPIRY-BEFORE','expiry boundary') \gset expiry_before_grant_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('11',32),'hex'),'expiry-before@example.com',
  'k1:'||repeat('5',63)||'a') \gset expiry_before_admin_
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) select '7b372000-0000-4000-8000-000000000001',decode(repeat('12',32),'hex'),
  'login','expiry-before@example.com','k1:'||repeat('5',63)||'a',
  decode(repeat('13',32),'hex'),'otp-v1',captured_at,captured_at+interval '10 minutes'
from (select clock_timestamp()-interval '9 minutes 50 seconds' captured_at) t;
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('12',32),'hex'),true,null),'before-expiry delivery recorded');
select pg_temp.assert_true((select clock_timestamp()<expires_at
  from public.every8d_settings_auth_challenges
  where id='7b372000-0000-4000-8000-000000000001'),
  'before-expiry fixture is strictly before expires_at');
select pg_temp.assert_true(public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('12',32),'hex'),'login',array['k1:'||repeat('5',63)||'a'],
  decode(repeat('13',32),'hex')),
  'verification succeeds strictly before expires_at');

-- Committed fixtures for the shell harness' deterministic v2 concurrency races.
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'concurrent-correct@example.com',
  decode(repeat('d0',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-CONCURRENT-CORRECT','v2 concurrency proof') \gset cc_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('d0',32),'hex'),'concurrent-correct@example.com',
  'k1:'||repeat('7',64)) \gset cc_admin_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'concurrent-fifth@example.com',
  decode(repeat('d1',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-CONCURRENT-FIFTH','v2 fifth failure proof') \gset cf_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('d1',32),'hex'),'concurrent-fifth@example.com',
  'k1:'||repeat('8',64)) \gset cf_admin_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'admin-race@example.com',
  decode(repeat('d2',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-ADMIN-RACE','v2 admin race proof') \gset ar_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('d2',32),'hex'),'admin-race@example.com',
  'k1:'||repeat('9',64)) \gset ar_admin_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'lifecycle-race@example.com',
  decode(repeat('d3',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-LIFECYCLE-RACE','v2 lifecycle race proof') \gset lr_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('d3',32),'hex'),'lifecycle-race@example.com',
  'k1:'||repeat('a',64)) \gset lr_admin_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'grant-race@example.com',
  decode(repeat('d4',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-GRANT-RACE','v2 grant race proof') \gset gr_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'grant-consume-race@example.com',
  decode(repeat('d5',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-GRANT-CONSUME','v2 grant consume race') \gset gc_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'request-discovery@example.com',
  decode(repeat('d6',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-REQUEST-DISCOVERY','request discovery race') \gset rd_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('d6',32),'hex'),'request-discovery@example.com',
  'k1:'||repeat('c',63)||'2') \gset rd_admin_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'resend-race@example.com',
  decode(repeat('d7',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-RESEND-RACE','resend serialization race') \gset rr_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('d7',32),'hex'),'resend-race@example.com',
  'k1:'||repeat('d',63)||'3') \gset rr_admin_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'expiry-race@example.com',
  decode(repeat('d8',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-EXPIRY-RACE','expiry scrub race') \gset er_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('d8',32),'hex'),'expiry-race@example.com',
  'k1:'||repeat('e',63)||'4') \gset er_admin_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'concurrent-wrong@example.com',
  decode(repeat('d9',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-CONCURRENT-WRONG','wrong/wrong race') \gset cw_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('d9',32),'hex'),'concurrent-wrong@example.com',
  'k1:'||repeat('f',63)||'5') \gset cw_admin_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'concurrent-mixed@example.com',
  decode(repeat('de',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-CONCURRENT-MIXED','correct/wrong race') \gset cm_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('de',32),'hex'),'concurrent-mixed@example.com',
  'k1:'||repeat('1',63)||'6') \gset cm_admin_
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b300000-0000-4000-8000-000000000002',1,'resend-verify@example.com',
  decode(repeat('06',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-RESEND-VERIFY','resend/verify race') \gset rv_
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('06',32),'hex'),'resend-verify@example.com',
  'k1:'||repeat('2',63)||'7') \gset rv_admin_

insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,enrollment_grant_id,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) select fixture.id,fixture.request_token_hash,fixture.purpose,
  fixture.enrollment_grant_id,fixture.normalized_email,fixture.email_pseudonym,
  fixture.otp_hmac,fixture.otp_hmac_key_version,captured_at,
  case when fixture.enrollment_grant_id is null then captured_at+interval '10 minutes'
    else least(captured_at+interval '10 minutes',(select expires_at
      from public.every8d_settings_enrollment_grants
      where id=fixture.enrollment_grant_id)) end
from (values
  ('7b360000-0000-4000-8000-000000000001'::uuid,decode(repeat('e1',32),'hex'),
    'login',null::uuid,'concurrent-correct@example.com','k1:'||repeat('7',64),
    decode(repeat('e2',32),'hex'),'otp-v1'),
  ('7b360000-0000-4000-8000-000000000002'::uuid,decode(repeat('e3',32),'hex'),
    'login',null::uuid,'concurrent-fifth@example.com','k1:'||repeat('8',64),
    decode(repeat('e4',32),'hex'),'otp-v1'),
  ('7b360000-0000-4000-8000-000000000003'::uuid,decode(repeat('e5',32),'hex'),
    'login',null::uuid,'admin-race@example.com','k1:'||repeat('9',64),
    decode(repeat('e6',32),'hex'),'otp-v1'),
  ('7b360000-0000-4000-8000-000000000004'::uuid,decode(repeat('e7',32),'hex'),
    'login',null::uuid,'lifecycle-race@example.com','k1:'||repeat('a',64),
    decode(repeat('e8',32),'hex'),'otp-v1'),
  ('7b360000-0000-4000-8000-000000000006'::uuid,decode(repeat('eb',32),'hex'),
    'enrollment',:'gc_grant_id'::uuid,'grant-consume-race@example.com',
    'k1:'||repeat('b',63)||'1',
    decode(repeat('ec',32),'hex'),'otp-v1'),
  ('7b360000-0000-4000-8000-000000000010'::uuid,decode(repeat('da',32),'hex'),
    'login',null::uuid,'concurrent-wrong@example.com','k1:'||repeat('f',63)||'5',
    decode(repeat('db',32),'hex'),'otp-v1'),
  ('7b360000-0000-4000-8000-000000000011'::uuid,decode(repeat('df',32),'hex'),
    'login',null::uuid,'concurrent-mixed@example.com','k1:'||repeat('1',63)||'6',
    decode(repeat('e0',32),'hex'),'otp-v1')
) fixture(id,request_token_hash,purpose,enrollment_grant_id,normalized_email,
  email_pseudonym,otp_hmac,otp_hmac_key_version)
cross join lateral (select clock_timestamp() captured_at) captured;
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  request_token_hash,true,null),'concurrency fixture delivery recorded')
from (values
  (decode(repeat('e1',32),'hex')),(decode(repeat('e3',32),'hex')),
  (decode(repeat('e5',32),'hex')),(decode(repeat('e7',32),'hex')),
  (decode(repeat('eb',32),'hex')),(decode(repeat('da',32),'hex')),
  (decode(repeat('df',32),'hex'))
) fixture(request_token_hash);

insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) select '7b360000-0000-4000-8000-000000000012',decode(repeat('07',32),'hex'),
  'login','resend-verify@example.com','k1:'||repeat('2',63)||'7',
  decode(repeat('08',32),'hex'),'otp-v1',captured_at,captured_at+interval '10 minutes'
from (select clock_timestamp()-interval '2 minutes' captured_at) captured;
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('07',32),'hex'),true,null),'resend/verify fixture delivery recorded');

insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) select '7b360000-0000-4000-8000-000000000009',decode(repeat('f2',32),'hex'),
  'login','expiry-race@example.com','k1:'||repeat('e',63)||'4',
  decode(repeat('f3',32),'hex'),'otp-v1',captured_at,captured_at+interval '10 minutes'
from (select clock_timestamp()-interval '9 minutes 59 seconds' captured_at) captured;
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('f2',32),'hex'),true,null),'expiry-race fixture delivery recorded');
select pg_sleep(2);

select pg_temp.append_challenge_failures('7b360000-0000-4000-8000-000000000002',4);

select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
  decode(repeat('d4',32),'hex'),'7b360000-0000-4000-8000-000000000005',
  'grant-race@example.com','k1:'||repeat('b',64),array['k1:'||repeat('b',64)],
  decode(repeat('e9',32),'hex'),decode(repeat('ea',32),'hex'),'otp-v1') \gset gr_ch_
select pg_temp.assert_true(public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('e9',32),'hex'),true,null),'grant-race fixture delivery recorded');

-- Matched v1/v2 enrollment concurrency fixtures. The shell harness uses real
-- independent backends for request/request serialization and both lock-race
-- directions for grant revocation and consumption.
do $$
declare token_n integer;
begin
  for token_n in 3301..3312 loop
    perform public.issue_every8d_settings_operator_enrollment_grant_v1(
      '7b300000-0000-4000-8000-000000000002',1,
      'parity-concurrency-'||token_n||'@example.com',
      decode(pg_catalog.lpad(pg_catalog.to_hex(token_n),64,'0'),'hex'),
      'operator_initial',pg_catalog.clock_timestamp()+interval '14 minutes',
      'c3b3-issuer','c3b3-approver','C3B3-PARITY-CONCURRENCY-'||token_n,
      'matched enrollment concurrency parity');
  end loop;
end;
$$;

-- C06 delivery/resend fixtures are created only through the real request
-- authorities. The shell harness waits across the 60-second boundary, then
-- runs both legal winner orders for v1 and runtime/v2.
do $$
declare token_n integer;
begin
  for token_n in 3321..3324 loop
    perform public.issue_every8d_settings_operator_enrollment_grant_v1(
      '7b300000-0000-4000-8000-000000000002',1,
      'parity-delivery-resend-'||token_n||'@example.com',
      decode(pg_catalog.lpad(pg_catalog.to_hex(token_n),64,'0'),'hex'),
      'operator_initial',pg_catalog.clock_timestamp()+interval '14 minutes',
      'c3b3-issuer','c3b3-approver','C3B3-PARITY-DELIVERY-RESEND-'||token_n,
      'matched delivery resend concurrency parity');
  end loop;
end;
$$;
select * from public.request_every8d_settings_enrollment_challenge_v1(
  (select id from public.every8d_settings_enrollment_grants
    where token_hash=decode(lpad(to_hex(3321),64,'0'),'hex')),
  'parity-delivery-resend-3321@example.com','k1:'||lpad(to_hex(3321),64,'0'),
  array['k1:'||lpad(to_hex(3321),64,'0')],decode(lpad(to_hex(3421),64,'0'),'hex'),
  decode(lpad(to_hex(3521),64,'0'),'hex'),'otp-v1');
select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
  decode(lpad(to_hex(3322),64,'0'),'hex'),'7b3b3000-0000-4000-8000-000000000001',
  'parity-delivery-resend-3322@example.com','k1:'||lpad(to_hex(3322),64,'0'),
  array['k1:'||lpad(to_hex(3322),64,'0')],decode(lpad(to_hex(3422),64,'0'),'hex'),
  decode(lpad(to_hex(3522),64,'0'),'hex'),'otp-v1');
select * from public.request_every8d_settings_enrollment_challenge_v1(
  (select id from public.every8d_settings_enrollment_grants
    where token_hash=decode(lpad(to_hex(3323),64,'0'),'hex')),
  'parity-delivery-resend-3323@example.com','k1:'||lpad(to_hex(3323),64,'0'),
  array['k1:'||lpad(to_hex(3323),64,'0')],decode(lpad(to_hex(3423),64,'0'),'hex'),
  decode(lpad(to_hex(3523),64,'0'),'hex'),'otp-v1');
select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
  decode(lpad(to_hex(3324),64,'0'),'hex'),'7b3b3000-0000-4000-8000-000000000002',
  'parity-delivery-resend-3324@example.com','k1:'||lpad(to_hex(3324),64,'0'),
  array['k1:'||lpad(to_hex(3324),64,'0')],decode(lpad(to_hex(3424),64,'0'),'hex'),
  decode(lpad(to_hex(3524),64,'0'),'hex'),'otp-v1');
select pg_temp.assert_true((select count(*)=4 and bool_and(
    purpose='enrollment' and delivery_succeeded_at is null
    and delivery_failed_at is null and superseded_at is null)
  from public.every8d_settings_auth_challenges
  where request_token_hash in (decode(lpad(to_hex(3421),64,'0'),'hex'),
    decode(lpad(to_hex(3422),64,'0'),'hex'),
    decode(lpad(to_hex(3423),64,'0'),'hex'),
    decode(lpad(to_hex(3424),64,'0'),'hex'))),
  'C06 starts from four real committed pending enrollment challenges');

-- C07 uses independent installation parents. A lifecycle actor first takes
-- the parent row lock, pauses before its legal lifecycle update, then commits
-- revocation. Requests must wait at the parent and revalidate afterward.
insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id) values
  ('7b3c0000-0000-4000-8000-000000000001','c3b3-parent-order-v1-location',
    'c3b3-parent-order-v1-provider','c3b3-parent-order-v1-line'),
  ('7b3c0000-0000-4000-8000-000000000003','c3b3-parent-order-v2-location',
    'c3b3-parent-order-v2-provider','c3b3-parent-order-v2-line');
insert into public.ghl_marketplace_installations(
  id,app_namespace,marketplace_app_id,oauth_client_id,tenant_id,location_id,
  company_id,conversation_provider_id,channel,provider,status,installation_generation,
  access_token_ciphertext,refresh_token_ciphertext,encryption_key_version,
  token_expires_at,granted_scopes,credential_revision,credential_state,
  latest_lifecycle_event_at,latest_lifecycle_event_id,latest_lifecycle_event_type,
  latest_lifecycle_version_id
)
select fixture.installation_id,'every8d_connect',r.marketplace_app_id,r.oauth_client_id,
  fixture.tenant_id,fixture.location_id,fixture.company_id,r.conversation_provider_id,
  'sms','every8d','pending',1,null,null,null,null,'{}'::text[],0,'none',clock_timestamp(),
  fixture.event_id,'INSTALL',v.marketplace_version_id
from (values
  ('7b3c0000-0000-4000-8000-000000000002'::uuid,
    '7b3c0000-0000-4000-8000-000000000001'::uuid,
    'c3b3-parent-order-v1-location','c3b3-parent-order-v1-company','c3b3_parent_order_v1_install'),
  ('7b3c0000-0000-4000-8000-000000000004'::uuid,
    '7b3c0000-0000-4000-8000-000000000003'::uuid,
    'c3b3-parent-order-v2-location','c3b3-parent-order-v2-company','c3b3_parent_order_v2_install')
) fixture(installation_id,tenant_id,location_id,company_id,event_id)
join public.ghl_marketplace_app_registrations r on r.app_namespace='every8d_connect'
cross join lateral (select version.marketplace_version_id
  from public.ghl_marketplace_app_version_registrations version
  where version.app_namespace=r.app_namespace
  order by version.marketplace_version_id limit 1) v;
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b3c0000-0000-4000-8000-000000000002',1,
  'parity-parent-order-v1@example.com',decode(lpad(to_hex(3331),64,'0'),'hex'),
  'operator_initial',clock_timestamp()+interval '14 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARENT-ORDER-V1','parent ordering parity');
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '7b3c0000-0000-4000-8000-000000000004',1,
  'parity-parent-order-v2@example.com',decode(lpad(to_hex(3332),64,'0'),'hex'),
  'operator_initial',clock_timestamp()+interval '14 minutes',
  'c3b3-issuer','c3b3-approver','C3B3-PARENT-ORDER-V2','parent ordering parity');

commit;
