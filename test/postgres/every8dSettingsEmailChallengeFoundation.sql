\set ON_ERROR_STOP on
\set VERBOSITY terse
-- Disposable PostgreSQL 17 proof only. All values are synthetic.
begin;

create function pg_temp.assert_true(actual boolean, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from true then
    raise exception 'C3b-1 proof failed: %', label;
  end if;
end;
$$;

create function pg_temp.reject(statement text, expected_state text, label text)
returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=expected_state then return; end if;
    raise exception 'C3b-1 proof unexpected SQLSTATE %: %',sqlstate,label;
  end;
  raise exception 'C3b-1 proof accepted forbidden operation: %',label;
end;
$$;

select pg_temp.assert_true(
  (select array_agg(column_name::text order by ordinal_position)=array[
    'id','request_token_hash','purpose','enrollment_grant_id','normalized_email',
    'email_pseudonym','otp_hmac','otp_hmac_key_version','created_at','expires_at',
    'delivery_succeeded_at','delivery_failed_at','delivery_failure_class','locked_at',
    'superseded_at','supersession_reason','verified_at','consumed_at','email_scrubbed_at'
  ]::text[] from information_schema.columns where table_schema='public'
    and table_name='every8d_settings_auth_challenges'),
  'challenge columns are exact');
select pg_temp.assert_true(
  (select array_agg(column_name::text order by ordinal_position)=array[
    'id','challenge_id','attempt_number','failed_at'
  ]::text[] from information_schema.columns where table_schema='public'
    and table_name='every8d_settings_auth_challenge_failures'),
  'failure columns are exact');
select pg_temp.assert_true(
  (select relrowsecurity and not relforcerowsecurity
   from pg_class where oid='public.every8d_settings_auth_challenges'::regclass)
  and (select relrowsecurity and not relforcerowsecurity
   from pg_class where oid='public.every8d_settings_auth_challenge_failures'::regclass)
  and not exists(select 1 from pg_policies where schemaname='public'
    and tablename in ('every8d_settings_auth_challenges',
      'every8d_settings_auth_challenge_failures')),
  'RLS enabled, FORCE disabled, zero policies');
select pg_temp.assert_true(
  not has_table_privilege('anon','public.every8d_settings_auth_challenges','select')
  and not has_table_privilege('authenticated',
    'public.every8d_settings_auth_challenge_failures','insert')
  and not has_table_privilege('service_role',
    'public.every8d_settings_auth_challenges','delete')
  and not has_function_privilege('service_role',
    'public.scrub_expired_every8d_settings_challenge_emails_v1(integer)','execute'),
  'table and function ACL denial');
select pg_temp.assert_true(
  (select count(*)=5 from pg_trigger where not tgisinternal and tgname in (
    'protect_every8d_settings_auth_challenge',
    'protect_every8d_settings_auth_challenge_failure',
    'lock_every8d_settings_challenge_on_fifth_failure',
    'assert_every8d_settings_challenge_row_integrity',
    'assert_every8d_settings_failure_ledger_integrity'
  )) and exists(select 1 from pg_trigger
    where tgname='invalidate_every8d_settings_challenges_after_grant_update'),
  'exact C3b protection and grant trigger names exist');
select pg_temp.assert_true(
  pg_get_functiondef(
    'public.protect_every8d_settings_auth_challenge_v1()'::regprocedure
  ) !~* 'every8d_settings_enrollment_grants[[:space:]]*%[[:space:]]*rowtype'
  and pg_get_functiondef(
    'public.protect_every8d_settings_auth_challenge_v1()'::regprocedure
  ) ~* 'grant_row[[:space:]]+record',
  'challenge protection trigger has no enrollment-grant rowtype dependency');

select pg_temp.assert_true(bool_and(public.is_every8d_settings_canonical_email_v1(v)),
  'canonical valid vectors') from (values
  ('A.Z+tag@example.com'),('x@localhost'),('x@xn--bcher-kva.example'),
  ('!#$%&''*+-/=?^_`{|}~@a1-b.example')
) t(v);
select pg_temp.assert_true(bool_and(not public.is_every8d_settings_canonical_email_v1(v)),
  'canonical invalid vectors') from (values
  ('x@@example.com'),('.x@example.com'),('x.@example.com'),('x..y@example.com'),
  ('"x"@example.com'),('x y@example.com'),(E'x\ty@example.com'),
  ('x@Example.com'),('x@-example.com'),('x@example-.com'),('x@example..com'),
  ('x@İ.example'),('ü@example.com'),('x@example.com ')
) t(v);
select pg_temp.assert_true(
  public.every8d_settings_email_lock_word_v1(
    'k1:'||repeat('0',64))=-1872983711,
  'fixed big-endian signed advisory-lock vector');

-- Create one isolated eligible parent using the already-proven Marketplace schema.
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
      'every8d_connect','c3b-synthetic-app','c3b.synthetic.client',
      'c3b-synthetic-provider','sms','every8d'
    );
  end if;
  if not exists (
    select 1 from public.ghl_marketplace_app_version_registrations
    where app_namespace='every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_version_registrations(
      app_namespace,marketplace_version_id
    ) values('every8d_connect','c3b.synthetic.version');
  end if;
end;
$$;
insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id)
values('6b000000-0000-4000-8000-000000000001','c3b-proof-location',
  'c3b-proof-line-provider','c3b-proof-line-channel');
insert into public.ghl_marketplace_installations(
  id,app_namespace,marketplace_app_id,oauth_client_id,tenant_id,location_id,
  company_id,conversation_provider_id,channel,provider,status,installation_generation,
  access_token_ciphertext,refresh_token_ciphertext,encryption_key_version,
  token_expires_at,granted_scopes,credential_revision,credential_state,
  latest_lifecycle_event_at,latest_lifecycle_event_id,latest_lifecycle_event_type,
  latest_lifecycle_version_id
)
select '6b000000-0000-4000-8000-000000000002','every8d_connect',
  r.marketplace_app_id,r.oauth_client_id,'6b000000-0000-4000-8000-000000000001',
  'c3b-proof-location','c3b-proof-company',r.conversation_provider_id,'sms','every8d',
  'pending',1,null,null,null,null,'{}'::text[],0,'none',
  '2096-01-01T00:00:00Z','c3b_proof_install','INSTALL',v.marketplace_version_id
from public.ghl_marketplace_app_registrations r
join public.ghl_marketplace_app_version_registrations v using(app_namespace)
where r.app_namespace='every8d_connect' limit 1;

-- Enrollment request, delivery, correct verification, and immutable identity.
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '6b000000-0000-4000-8000-000000000002',1,'Admin+Case@example.com',
  decode(repeat('01',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'issuer-c3b','approver-c3b','C3B-1','C3b proof grant') \gset grant_
select challenge_id from public.request_every8d_settings_enrollment_challenge_v1(
  :'grant_grant_id','Admin+Case@example.com','k1:'||repeat('1',64),
  array['k1:'||repeat('1',64)],decode(repeat('02',32),'hex'),
  decode(repeat('03',32),'hex'),'otp-v1') \gset verified_
select pg_temp.assert_true(public.record_every8d_settings_challenge_delivery_v1(
  decode(repeat('02',32),'hex'),true,null),'delivery succeeds');
select pg_temp.assert_true(public.verify_every8d_settings_challenge_v1(
  :'verified_challenge_id',decode(repeat('02',32),'hex'),'enrollment',:'grant_grant_id',
  'Admin+Case@example.com',array['k1:'||repeat('1',64)],decode(repeat('03',32),'hex')),
  'correct HMAC verifies');
select pg_temp.assert_true((select verified_at is not null and consumed_at is null
  from public.every8d_settings_auth_challenges where id=:'verified_challenge_id'),
  'verified state has no C3c consumption');
select pg_temp.reject(format(
  'update public.every8d_settings_auth_challenges set request_token_hash=decode(repeat(''aa'',32),''hex'') where id=%L',
  :'verified_challenge_id'),'23514','request hash immutable');

-- Exact state edges, immutable authority timestamps, and delivery chronology.
insert into public.every8d_settings_auth_challenges(
  request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
)
select decode(repeat('04',32),'hex'),'login','edges@example.com',
  'k1:'||repeat('6',64),decode(repeat('05',32),'hex'),'otp-v1',
  captured_at,captured_at+interval '10 minutes'
from (select clock_timestamp()-interval '1 minute' captured_at) t
returning id \gset edge_
select pg_temp.reject(format(
  'update public.every8d_settings_auth_challenges set verified_at=created_at+interval ''2 seconds'' where id=%L',
  :'edge_id'),'23514','PENDING to VERIFIED rejected');
select pg_temp.reject(format(
  'update public.every8d_settings_auth_challenges set delivery_succeeded_at=created_at+interval ''1 second'', verified_at=created_at+interval ''2 seconds'', consumed_at=created_at+interval ''3 seconds'', normalized_email=null, email_scrubbed_at=created_at+interval ''3 seconds'' where id=%L',
  :'edge_id'),'23514','PENDING to CONSUMED rejected');
select pg_temp.reject(format(
  'update public.every8d_settings_auth_challenges set delivery_succeeded_at=created_at+interval ''1 second'', verified_at=created_at+interval ''2 seconds'' where id=%L',
  :'edge_id'),'23514','combined PENDING delivery and verification edge rejected');
select pg_temp.reject(format(
  'update public.every8d_settings_auth_challenges set normalized_email=null, email_scrubbed_at=expires_at where id=%L',
  :'edge_id'),'23514','premature future expiry scrub rejected');
update public.every8d_settings_auth_challenges
set delivery_succeeded_at=created_at+interval '10 seconds'
where id=:'edge_id';
select pg_temp.reject(format(
  'update public.every8d_settings_auth_challenges set delivery_succeeded_at=delivery_succeeded_at+interval ''1 second'' where id=%L',
  :'edge_id'),'23514','established delivery timestamp rewrite rejected');
select pg_temp.reject(format(
  'update public.every8d_settings_auth_challenges set verified_at=delivery_succeeded_at-interval ''1 second'' where id=%L',
  :'edge_id'),'23514','verification before delivery rejected');
select pg_temp.reject(format(
  'update public.every8d_settings_auth_challenges set locked_at=delivery_succeeded_at-interval ''1 second'', normalized_email=null, email_scrubbed_at=delivery_succeeded_at-interval ''1 second'' where id=%L',
  :'edge_id'),'23514','lock before delivery rejected');
select pg_temp.reject(format(
  'update public.every8d_settings_auth_challenges set superseded_at=delivery_succeeded_at-interval ''1 second'', supersession_reason=''resend'', normalized_email=null, email_scrubbed_at=delivery_succeeded_at-interval ''1 second'' where id=%L',
  :'edge_id'),'23514','LIVE supersession before delivery rejected');
select pg_temp.reject(format(
  'update public.every8d_settings_auth_challenges set verified_at=delivery_succeeded_at+interval ''1 second'', consumed_at=delivery_succeeded_at+interval ''2 seconds'', normalized_email=null, email_scrubbed_at=delivery_succeeded_at+interval ''2 seconds'' where id=%L',
  :'edge_id'),'23514','LIVE to CONSUMED rejected');
select pg_temp.reject(format(
  'insert into public.every8d_settings_auth_challenge_failures(challenge_id,attempt_number,failed_at) values(%L,1,(select delivery_succeeded_at-interval ''1 second'' from public.every8d_settings_auth_challenges where id=%L))',
  :'edge_id',:'edge_id'),'23514','failure before delivery rejected');
insert into public.every8d_settings_auth_challenge_failures(
  challenge_id,attempt_number,failed_at
)
select id,1,delivery_succeeded_at
from public.every8d_settings_auth_challenges where id=:'edge_id';
update public.every8d_settings_auth_challenges
set verified_at=delivery_succeeded_at+interval '1 second'
where id=:'edge_id';
select pg_temp.reject(format(
  'update public.every8d_settings_auth_challenges set verified_at=verified_at+interval ''1 second'' where id=%L',
  :'edge_id'),'23514','established verification timestamp rewrite rejected');
select pg_temp.assert_true((select delivery_succeeded_at <= verified_at
  from public.every8d_settings_auth_challenges where id=:'edge_id'),
  'valid delivery, failure-equal-delivery, and verification chronology accepted');

-- Five mismatches append 1..5 and atomically scrub/lock on attempt five.
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '6b000000-0000-4000-8000-000000000002',1,'lock@example.com',
  decode(repeat('11',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'issuer-c3b','approver-c3b','C3B-LOCK','failure ledger proof') \gset lockgrant_
select challenge_id from public.request_every8d_settings_enrollment_challenge_v1(
  :'lockgrant_grant_id','lock@example.com','k1:'||repeat('2',64),
  array['k1:'||repeat('2',64)],decode(repeat('12',32),'hex'),
  decode(repeat('13',32),'hex'),'otp-v1') \gset locked_
select public.record_every8d_settings_challenge_delivery_v1(
  decode(repeat('12',32),'hex'),true,null);
select public.verify_every8d_settings_challenge_v1(:'locked_challenge_id',
  decode(repeat('12',32),'hex'),'enrollment',:'lockgrant_grant_id','lock@example.com',
  array['k1:'||repeat('2',64)],decode(repeat('ff',32),'hex')) from generate_series(1,5);
set constraints all immediate;
set constraints all deferred;
select pg_temp.assert_true(
  (select array_agg(attempt_number order by attempt_number)=array[1,2,3,4,5]
   from public.every8d_settings_auth_challenge_failures
   where challenge_id=:'locked_challenge_id')
  and (select locked_at is not null and normalized_email is null
    and email_scrubbed_at=locked_at from public.every8d_settings_auth_challenges
    where id=:'locked_challenge_id'),
  'fifth failure is contiguous and atomically locks/scrubs');
select pg_temp.reject(format(
  'update public.every8d_settings_auth_challenge_failures set failed_at=failed_at where challenge_id=%L',
  :'locked_challenge_id'),'23514','failure update rejected');
select pg_temp.reject(format(
  'delete from public.every8d_settings_auth_challenge_failures where challenge_id=%L',
  :'locked_challenge_id'),'23514','standalone failure delete rejected');

-- Grant null->non-null transition supersedes only pending/live siblings.
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '6b000000-0000-4000-8000-000000000002',1,'revoke@example.com',
  decode(repeat('21',32),'hex'),'operator_initial',clock_timestamp()+interval '12 minutes',
  'issuer-c3b','approver-c3b','C3B-REVOKE','grant trigger proof') \gset revoke_
select challenge_id from public.request_every8d_settings_enrollment_challenge_v1(
  :'revoke_grant_id','revoke@example.com','k1:'||repeat('3',64),
  array['k1:'||repeat('3',64)],decode(repeat('22',32),'hex'),
  decode(repeat('23',32),'hex'),'otp-v1') \gset revoke_ch_
update public.every8d_settings_enrollment_grants
set revoked_at=clock_timestamp(),revocation_reason='c3b_proof'
where id=:'revoke_grant_id';
select pg_temp.assert_true((select supersession_reason='grant_revoked'
  and normalized_email is null and email_scrubbed_at=superseded_at
  from public.every8d_settings_auth_challenges where id=:'revoke_ch_challenge_id'),
  'grant revocation supersedes pending sibling');

-- Derived expiry scrub changes only email fields; 30-day cleanup removes child first.
select pg_temp.reject(
  'select public.scrub_expired_every8d_settings_challenge_emails_v1(null)',
  '22023','NULL scrub batch rejected');
select pg_temp.reject(
  'select public.scrub_expired_every8d_settings_challenge_emails_v1(0)',
  '22023','zero scrub batch rejected');
select pg_temp.assert_true(
  public.scrub_expired_every8d_settings_challenge_emails_v1(1)>=0,
  'scrub batch one accepted');
select pg_temp.assert_true(
  public.scrub_expired_every8d_settings_challenge_emails_v1(500)>=0,
  'scrub batch 500 accepted');
select pg_temp.reject(
  'select public.scrub_expired_every8d_settings_challenge_emails_v1(501)',
  '22023','scrub batch 501 rejected');
select pg_temp.reject(
  'select * from public.cleanup_every8d_settings_auth_challenges_v1(null)',
  '22023','NULL cleanup batch rejected');
select pg_temp.reject(
  'select * from public.cleanup_every8d_settings_auth_challenges_v1(0)',
  '22023','zero cleanup batch rejected');
select pg_temp.assert_true(
  (select deleted_count>=0 from public.cleanup_every8d_settings_auth_challenges_v1(1)),
  'cleanup batch one accepted');
select pg_temp.assert_true(
  (select deleted_count>=0 from public.cleanup_every8d_settings_auth_challenges_v1(500)),
  'cleanup batch 500 accepted');
select pg_temp.reject(
  'select * from public.cleanup_every8d_settings_auth_challenges_v1(501)',
  '22023','cleanup batch 501 rejected');
insert into public.every8d_settings_auth_challenges(
  request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
)
select decode(repeat('31',32),'hex'),'login','old@example.com',
  'k1:'||repeat('4',64),decode(repeat('32',32),'hex'),'otp-v1',
  captured_at,captured_at+interval '10 minutes'
from (select clock_timestamp()-interval '31 days 11 minutes' captured_at) t;
select pg_temp.assert_true(
  public.scrub_expired_every8d_settings_challenge_emails_v1(500)>=1,
  'expired email scrub affects expired row');
select pg_temp.assert_true((select normalized_email is null
  and email_scrubbed_at>=expires_at from public.every8d_settings_auth_challenges
  where request_token_hash=decode(repeat('31',32),'hex')),
  'expiry scrub preserves derived state and records time');
select deleted_count,anomalous_count
from public.cleanup_every8d_settings_auth_challenges_v1(500) \gset cleanup_
select pg_temp.assert_true(:cleanup_deleted_count::integer>=1
  and :cleanup_anomalous_count::integer=0,'bounded cleanup reports structurally');

select pg_temp.reject($sql$
  insert into public.every8d_settings_auth_challenges(
    request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
    otp_hmac_key_version,created_at,expires_at,delivery_succeeded_at,delivery_failed_at
  ) values(decode(repeat('41',32),'hex'),'login','bad@example.com',
    'k1:'||repeat('5',64),decode(repeat('42',32),'hex'),'otp-v1',
    clock_timestamp(),clock_timestamp()+interval '10 minutes',
    clock_timestamp(),clock_timestamp())
$sql$,'23514','illegal authority matrix rejected');

rollback;
