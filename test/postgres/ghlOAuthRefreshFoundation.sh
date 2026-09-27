#!/usr/bin/env bash
set -euo pipefail
: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly database=wincrm_test
readonly migration=supabase/migrations/202609270001_every8d_ghl_oauth_refresh_foundation.sql
readonly rollback=supabase/rollback/202609270001_every8d_ghl_oauth_refresh_foundation.sql
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
psql_query() { docker exec -i "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$database" "$@"; }
psql_app() {
  local app_name=$1
  shift
  docker exec -e PGAPPNAME="$app_name" -i "$POSTGRES_CONTAINER_ID" \
    psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$database" "$@"
}
apply_migration() { psql_query < "$migration"; }
apply_rollback() { psql_query < "$rollback"; }
assert_query() { [[ "$(psql_query -Atqc "$1" | tr -d '\r')" == t ]] || { echo "FAIL: $2" >&2; exit 1; }; }
expect_failure() {
  local expected=$1
  local output=$2
  shift 2
  set +e
  "$@" >"$tmp_dir/$output.out" 2>"$tmp_dir/$output.err"
  local status=$?
  set -e
  [[ $status -ne 0 ]] && grep -q "$expected" "$tmp_dir/$output.err" || {
    echo "FAIL: expected failure containing $expected" >&2; exit 1;
  }
}

assert_query "select to_regprocedure('public.finalize_every8d_oauth_exchange_v1(uuid,text,text,bytea,bytea,text,timestamptz,text[])') is not null
 and not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='ghl_marketplace_installations' and column_name='credential_state')" \
  'requires public OAuth bootstrap and a pre-C1a schema'

# Synthetic pre-C1a fixtures prove deterministic complete/empty backfill and
# fail-closed partial-tuple preflight. No real ciphertext is used or printed.
psql_query -q <<'SQL' >/dev/null
insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id) values
 ('00000000-0000-4000-8000-000000000301','refresh-backfill-usable','line-301','line-channel-301'),
 ('00000000-0000-4000-8000-000000000302','refresh-backfill-none','line-302','line-channel-302'),
 ('00000000-0000-4000-8000-000000000303','refresh-backfill-partial','line-303','line-channel-303'),
 ('00000000-0000-4000-8000-000000000311','refresh-backfill-uninstalled','line-311','line-channel-311');
set role service_role;
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000301',
 'refresh-backfill-usable','refresh-company','oauth-provider','race-version',
 '2026-09-27T01:00:00Z','refresh-backfill-usable-install');
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000302',
 'refresh-backfill-none','refresh-company','oauth-provider','race-version',
 '2026-09-27T01:01:00Z','refresh-backfill-none-install');
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000303',
 'refresh-backfill-partial','refresh-company','oauth-provider','race-version',
 '2026-09-27T01:02:00Z','refresh-backfill-partial-install');
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000311',
 'refresh-backfill-uninstalled','refresh-company','oauth-provider','race-version',
 '2026-09-27T01:03:00Z','refresh-backfill-uninstalled-install');
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'UNINSTALL','oauth-app','oauth-client',null,'refresh-backfill-uninstalled',null,
 'oauth-provider','race-version','2026-09-27T01:04:00Z','refresh-backfill-uninstalled-event');
update public.ghl_marketplace_installations
set access_token_ciphertext=convert_to('synthetic-backfill-access','utf8'),
    refresh_token_ciphertext=convert_to('synthetic-backfill-refresh','utf8'),
    encryption_key_version='synthetic-v1', token_expires_at=clock_timestamp()+interval '1 hour',
    granted_scopes=array['conversations/message.readonly','conversations/message.write',
      'conversations.readonly','conversations.write','locations.readonly']
where location_id='refresh-backfill-usable';
update public.ghl_marketplace_installations
set access_token_ciphertext=convert_to('synthetic-partial-access','utf8'),
    refresh_token_ciphertext=convert_to('synthetic-partial-refresh','utf8'),
    encryption_key_version='synthetic-v1', token_expires_at=clock_timestamp()+interval '1 hour',
    granted_scopes='{}'
where location_id='refresh-backfill-partial';
update public.ghl_marketplace_installations
set access_token_ciphertext=convert_to('synthetic-uninstalled-access','utf8'),
    refresh_token_ciphertext=convert_to('synthetic-uninstalled-refresh','utf8'),
    encryption_key_version='synthetic-v1', token_expires_at=clock_timestamp()+interval '1 hour',
    granted_scopes=array['locations.readonly']
where location_id='refresh-backfill-uninstalled';
reset role;
SQL

expect_failure 'C1a preflight rejected a partial OAuth credential tuple' partial_preflight \
  apply_migration
assert_query "select not exists(select 1 from information_schema.columns where table_schema='public'
 and table_name='ghl_marketplace_installations' and column_name='credential_state')" \
  'partial tuple refusal is transactional'
psql_query -q -c "set role service_role; update public.ghl_marketplace_installations
 set granted_scopes=array['locations.readonly'] where location_id='refresh-backfill-partial';"

expect_failure 'C1a preflight rejected credentials retained by an uninstalled row' uninstalled_preflight \
  apply_migration
assert_query "select not exists(select 1 from information_schema.columns where table_schema='public'
 and table_name='ghl_marketplace_installations' and column_name='credential_state')" \
  'uninstalled credential refusal is transactional'
psql_query -q -c "set role service_role; update public.ghl_marketplace_installations
 set access_token_ciphertext=null, refresh_token_ciphertext=null, encryption_key_version=null,
     token_expires_at=null, granted_scopes='{}'
 where location_id='refresh-backfill-uninstalled';"

psql_query < "$migration" >/dev/null
assert_query "select credential_state='usable' and credential_revision=1
 and convert_from(access_token_ciphertext,'utf8')='synthetic-backfill-access'
 and convert_from(refresh_token_ciphertext,'utf8')='synthetic-backfill-refresh'
 and cardinality(granted_scopes)=5
 from public.ghl_marketplace_installations where location_id='refresh-backfill-usable'" \
  'complete Gate-B tuple backfills to usable revision one without mutation'
assert_query "select credential_state='none' and credential_revision=0
 and access_token_ciphertext is null and refresh_lease_id is null
 from public.ghl_marketplace_installations where location_id='refresh-backfill-none'" \
  'credential-free tuple backfills to none revision zero'

# A clean baseline rollback is safe, preserves credentials, restores v4 exactly,
# and permits reapplication. Later runtime evidence must refuse this rollback.
psql_query < "$rollback" >/dev/null
assert_query "select to_regprocedure('public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer)') is null
 and not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='ghl_marketplace_installations' and column_name='credential_state')
 and convert_from((select access_token_ciphertext from public.ghl_marketplace_installations
   where location_id='refresh-backfill-usable'),'utf8')='synthetic-backfill-access'
 and (select p.proname='protect_ghl_marketplace_installation_v4'
   from pg_trigger t join pg_proc p on p.oid=t.tgfoid
   where t.tgrelid='public.ghl_marketplace_installations'::regclass
     and t.tgname='protect_ghl_marketplace_installation')
 and position('credential_revision' in pg_get_functiondef(
   'public.finalize_every8d_oauth_exchange_v1(uuid,text,text,bytea,bytea,text,timestamptz,text[])'::regprocedure))=0" \
  'clean rollback restores pre-C1a function behavior and preserves ciphertext'
psql_query < "$migration" >/dev/null

# Create independent due credentials through the unchanged lifecycle RPC and
# existing authorization persistence grant. Trigger v5 owns the new metadata.
psql_query -q <<'SQL' >/dev/null
insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id) values
 ('00000000-0000-4000-8000-000000000304','refresh-cas','line-304','line-channel-304'),
 ('00000000-0000-4000-8000-000000000305','refresh-invalid','line-305','line-channel-305'),
 ('00000000-0000-4000-8000-000000000306','refresh-unknown','line-306','line-channel-306'),
 ('00000000-0000-4000-8000-000000000307','refresh-uninstall-first','line-307','line-channel-307'),
 ('00000000-0000-4000-8000-000000000308','refresh-uninstall-last','line-308','line-channel-308'),
 ('00000000-0000-4000-8000-000000000309','refresh-stale','line-309','line-channel-309'),
 ('00000000-0000-4000-8000-000000000310','refresh-auth-finalize','line-310','line-channel-310');
set role service_role;
select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000304','refresh-cas','refresh-company','oauth-provider',
 'race-version','2026-09-27T02:04:00Z','refresh-cas-install');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000305','refresh-invalid','refresh-company','oauth-provider',
 'race-version','2026-09-27T02:05:00Z','refresh-invalid-install');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000306','refresh-unknown','refresh-company','oauth-provider',
 'race-version','2026-09-27T02:06:00Z','refresh-unknown-install');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000307','refresh-uninstall-first','refresh-company','oauth-provider',
 'race-version','2026-09-27T02:07:00Z','refresh-uninstall-first-install');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000308','refresh-uninstall-last','refresh-company','oauth-provider',
 'race-version','2026-09-27T02:08:00Z','refresh-uninstall-last-install');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000309','refresh-stale','refresh-company','oauth-provider',
 'race-version','2026-09-27T02:09:00Z','refresh-stale-install');
select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000310','refresh-auth-finalize','refresh-company','oauth-provider',
 'race-version','2026-09-27T02:10:00Z','refresh-auth-finalize-install');
update public.ghl_marketplace_installations
set access_token_ciphertext=convert_to('synthetic-access-'||location_id,'utf8'),
    refresh_token_ciphertext=convert_to('synthetic-refresh-'||location_id,'utf8'),
    encryption_key_version='synthetic-v1', token_expires_at=clock_timestamp()+interval '1 minute',
    granted_scopes=array['locations.readonly']
where location_id in ('refresh-cas','refresh-invalid','refresh-unknown',
  'refresh-uninstall-first','refresh-uninstall-last','refresh-stale');
reset role;
SQL
assert_query "select count(*)=6 and min(credential_revision)=1 and max(credential_revision)=1
 and bool_and(credential_state='usable') from public.ghl_marketplace_installations
 where location_id like 'refresh-%' and location_id in ('refresh-cas','refresh-invalid','refresh-unknown',
  'refresh-uninstall-first','refresh-uninstall-last','refresh-stale')" \
  'existing authorization persistence initializes usable revision metadata'

cas_id=$(psql_query -Atqc "select id from public.ghl_marketplace_installations where location_id='refresh-cas'" | tr -d '\r')
claim_cas="public.claim_every8d_ghl_oauth_refresh_v1('$cas_id','oauth-app','oauth-client','00000000-0000-4000-8000-000000000304','refresh-cas','refresh-company','oauth-provider','race-version',1)"
psql_app refresh_claim_a -Atq <<SQL >"$tmp_dir/claim-a.out" &
begin; set local role service_role;
select $claim_cas is not null;
select pg_sleep(1);
commit;
SQL
claim_a_pid=$!
sleep 0.2
psql_app refresh_claim_b -Atq -c "set role service_role; select $claim_cas is not null;" >"$tmp_dir/claim-b.out" &
claim_b_pid=$!
wait "$claim_a_pid"; wait "$claim_b_pid"
claim_winners=$(grep -h '^t$' "$tmp_dir"/claim-*.out | wc -l | tr -d ' ')
[[ "$claim_winners" == 1 ]] || { echo 'FAIL: two refresh workers did not produce exactly one claim' >&2; exit 1; }
assert_query "select credential_state='refreshing' and credential_revision=1
 and refresh_lease_id is not null and refresh_started_at is not null
 and refresh_lease_expires_at=refresh_started_at+interval '5 minutes'
 from public.ghl_marketplace_installations where id='$cas_id'" \
  'one credential revision has one five-minute lease'
assert_query "select (set_config('role','service_role',true) is not null)
 and public.claim_every8d_ghl_oauth_refresh_v1('$cas_id','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000304','refresh-cas','refresh-company','oauth-provider',
 'race-version',1) is null" 'second claim while refreshing fails closed'

cas_lease=$(psql_query -Atqc "select refresh_lease_id from public.ghl_marketplace_installations where id='$cas_id'" | tr -d '\r')
assert_query "select (set_config('role','service_role',true) is not null)
 and public.finalize_every8d_ghl_oauth_refresh_v1('$cas_id','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000304','refresh-cas','refresh-company','oauth-provider',
 'race-version',1,1,'$cas_lease',convert_to('new-synthetic-access','utf8'),
 convert_to('new-synthetic-refresh','utf8'),'synthetic-v2',clock_timestamp()+interval '1 hour',
 array['locations.readonly'])" 'exact finalize CAS succeeds once'
assert_query "select credential_state='usable' and credential_revision=2
 and refresh_lease_id is null and last_refreshed_at is not null
 and convert_from(refresh_token_ciphertext,'utf8')='new-synthetic-refresh'
 from public.ghl_marketplace_installations where id='$cas_id'" \
  'finalize atomically replaces both tokens and advances revision once'
assert_query "select (set_config('role','service_role',true) is not null)
 and not public.finalize_every8d_ghl_oauth_refresh_v1('$cas_id','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000304','refresh-cas','refresh-company','oauth-provider',
 'race-version',1,1,'$cas_lease',convert_to('duplicate-access','utf8'),
 convert_to('duplicate-refresh','utf8'),'synthetic-v2',clock_timestamp()+interval '1 hour',
 array['locations.readonly'])" 'old revision and lease cannot finalize twice'

claim_and_fail() {
  local location=$1 tenant=$2 failure=$3
  local installation lease
  installation=$(psql_query -Atqc "select id from public.ghl_marketplace_installations where location_id='$location'" | tr -d '\r')
  psql_query -Atq -c "set role service_role; select public.claim_every8d_ghl_oauth_refresh_v1(
   '$installation','oauth-app','oauth-client','$tenant','$location','refresh-company','oauth-provider','race-version',1) is not null;" \
   >"$tmp_dir/$location-claim.out"
  [[ "$(tr -d '[:space:]' < "$tmp_dir/$location-claim.out")" == t ]] || { echo "FAIL: $location claim" >&2; exit 1; }
  lease=$(psql_query -Atqc "select refresh_lease_id from public.ghl_marketplace_installations where id='$installation'" | tr -d '\r')
  assert_query "select (set_config('role','service_role',true) is not null)
   and public.fail_every8d_ghl_oauth_refresh_v1('$installation','oauth-app','oauth-client',
   '$tenant','$location','refresh-company','oauth-provider','race-version',1,1,'$lease','$failure')" \
   "$failure terminal transition succeeds"
  assert_query "select credential_state='reauth_required' and credential_revision=1
   and refresh_token_ciphertext is null and access_token_ciphertext is null
   and refresh_lease_id is null and refresh_failure_class='$failure'
   from public.ghl_marketplace_installations where id='$installation'" \
   "$failure scrubs the single-use credential and lease"
  assert_query "select (set_config('role','service_role',true) is not null)
   and public.claim_every8d_ghl_oauth_refresh_v1('$installation','oauth-app','oauth-client',
   '$tenant','$location','refresh-company','oauth-provider','race-version',1) is null" \
   "$failure cannot reclaim the same refresh token"
}
claim_and_fail refresh-invalid 00000000-0000-4000-8000-000000000305 invalid_grant
claim_and_fail refresh-unknown 00000000-0000-4000-8000-000000000306 refresh_outcome_unknown

# Expiry is terminalized lazily by the next exact claim and never recycled.
stale_id=$(psql_query -Atqc "select id from public.ghl_marketplace_installations where location_id='refresh-stale'" | tr -d '\r')
psql_query -q -c "set role service_role; select public.claim_every8d_ghl_oauth_refresh_v1(
 '$stale_id','oauth-app','oauth-client','00000000-0000-4000-8000-000000000309','refresh-stale',
 'refresh-company','oauth-provider','race-version',1);" >/dev/null
psql_query -q -c "alter table public.ghl_marketplace_installations
 disable trigger protect_ghl_marketplace_installation;
 update public.ghl_marketplace_installations
 set refresh_started_at=statement_timestamp()-interval '6 minutes',
     refresh_lease_expires_at=statement_timestamp()-interval '1 minute'
 where id='$stale_id';
 alter table public.ghl_marketplace_installations
 enable trigger protect_ghl_marketplace_installation;"
assert_query "select (set_config('role','service_role',true) is not null)
 and public.claim_every8d_ghl_oauth_refresh_v1('$stale_id','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000309','refresh-stale','refresh-company','oauth-provider',
 'race-version',1) is null" 'expired lease cannot be recycled'
assert_query "select credential_state='reauth_required'
 and refresh_failure_class='refresh_outcome_unknown' and refresh_token_ciphertext is null
 and refresh_lease_id is null from public.ghl_marketplace_installations where id='$stale_id'" \
 'expired lease burns ambiguous single-use credentials'

# ORDER 1: claim -> UNINSTALL -> finalize. UNINSTALL advances generation, clears
# credentials/lease, and the old generation can neither finalize nor reclaim.
order1_id=$(psql_query -Atqc "select id from public.ghl_marketplace_installations where location_id='refresh-uninstall-first'" | tr -d '\r')
psql_query -q -c "set role service_role; select public.claim_every8d_ghl_oauth_refresh_v1(
 '$order1_id','oauth-app','oauth-client','00000000-0000-4000-8000-000000000307','refresh-uninstall-first',
 'refresh-company','oauth-provider','race-version',1);" >/dev/null
order1_lease=$(psql_query -Atqc "select refresh_lease_id from public.ghl_marketplace_installations where id='$order1_id'" | tr -d '\r')
psql_query -q -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'UNINSTALL','oauth-app','oauth-client',null,'refresh-uninstall-first',null,'oauth-provider','race-version',
 '2026-09-27T03:07:00Z','refresh-uninstall-first-uninstall');"
assert_query "select (set_config('role','service_role',true) is not null)
 and not public.finalize_every8d_ghl_oauth_refresh_v1('$order1_id','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000307','refresh-uninstall-first','refresh-company','oauth-provider',
 'race-version',1,1,'$order1_lease',convert_to('late-access','utf8'),convert_to('late-refresh','utf8'),
 'synthetic-v2',clock_timestamp()+interval '1 hour',array['locations.readonly'])" \
 'UNINSTALL wins before refresh finalize'
assert_query "select status='uninstalled' and installation_generation=2 and credential_state='none'
 and access_token_ciphertext is null and refresh_token_ciphertext is null and refresh_lease_id is null
 from public.ghl_marketplace_installations where id='$order1_id'" \
 'UNINSTALL-first leaves no credentials or lease'
psql_query -q -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000307','refresh-uninstall-first',
 'refresh-company','oauth-provider','race-version','2026-09-27T03:08:00Z','refresh-uninstall-first-reinstall');"
assert_query "select status='pending' and installation_generation=3 and credential_state='none'
 and credential_revision=1 and refresh_lease_id is null
 from public.ghl_marketplace_installations where id='$order1_id'" \
 'reinstall generation cannot inherit prior refresh authorization'

# ORDER 2: claim -> finalize -> UNINSTALL. The new pair exists for one CAS only,
# then accepted UNINSTALL scrubs it and advances the generation.
order2_id=$(psql_query -Atqc "select id from public.ghl_marketplace_installations where location_id='refresh-uninstall-last'" | tr -d '\r')
psql_query -q -c "set role service_role; select public.claim_every8d_ghl_oauth_refresh_v1(
 '$order2_id','oauth-app','oauth-client','00000000-0000-4000-8000-000000000308','refresh-uninstall-last',
 'refresh-company','oauth-provider','race-version',1);" >/dev/null
order2_lease=$(psql_query -Atqc "select refresh_lease_id from public.ghl_marketplace_installations where id='$order2_id'" | tr -d '\r')
assert_query "select (set_config('role','service_role',true) is not null)
 and public.finalize_every8d_ghl_oauth_refresh_v1('$order2_id','oauth-app','oauth-client',
 '00000000-0000-4000-8000-000000000308','refresh-uninstall-last','refresh-company','oauth-provider',
 'race-version',1,1,'$order2_lease',convert_to('order2-access','utf8'),convert_to('order2-refresh','utf8'),
 'synthetic-v2',clock_timestamp()+interval '1 hour',array['locations.readonly'])" \
 'refresh may finalize before UNINSTALL'
psql_query -q -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'UNINSTALL','oauth-app','oauth-client',null,'refresh-uninstall-last',null,'oauth-provider','race-version',
 '2026-09-27T03:09:00Z','refresh-uninstall-last-uninstall');"
assert_query "select status='uninstalled' and installation_generation=2 and credential_state='none'
 and credential_revision=2 and access_token_ciphertext is null and refresh_token_ciphertext is null
 and refresh_lease_id is null from public.ghl_marketplace_installations where id='$order2_id'" \
  'UNINSTALL after finalize scrubs the newly rotated pair'

# Current authorization-code finalization remains valid and initializes metadata.
psql_query -q <<'SQL' >/dev/null
set role service_role;
select public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','race-version','refresh-auth-finalize',repeat('ab',32),repeat('cd',32),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('3',64),clock_timestamp()+interval '10 minutes',
 convert_to('synthetic-auth-code','utf8'),'synthetic-code-v1');
SQL
auth_bootstrap=$(psql_query -Atqc "select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('ab',32)" | tr -d '\r')
psql_query -q -c "set role service_role; select public.claim_every8d_oauth_exchange_v1(
 '$auth_bootstrap','race-version',repeat('3',64));" >/dev/null
assert_query "select (set_config('role','service_role',true) is not null)
 and public.finalize_every8d_oauth_exchange_v1('$auth_bootstrap','race-version',repeat('3',64),
 convert_to('auth-access','utf8'),convert_to('auth-refresh','utf8'),'synthetic-v1',
 clock_timestamp()+interval '1 hour',array['locations.readonly'])" \
 'deployed authorization-code finalize remains compatible'
assert_query "select credential_state='usable' and credential_revision=1
 and refresh_lease_id is null and refresh_failure_class is null
 from public.ghl_marketplace_installations where location_id='refresh-auth-finalize'" \
 'first authorization finalization initializes refresh metadata'

# RLS and grants: browsers have neither table nor RPC access; service_role may
# execute only the narrow RPCs and has no direct update privilege on new columns.
assert_query "select relrowsecurity from pg_class where oid='public.ghl_marketplace_installations'::regclass" \
  'installation RLS remains enabled'
assert_query "select not has_column_privilege('service_role','public.ghl_marketplace_installations','credential_state','UPDATE')
 and not has_column_privilege('service_role','public.ghl_marketplace_installations','refresh_lease_id','UPDATE')
 and has_function_privilege('service_role','public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer)','EXECUTE')
 and not has_function_privilege('anon','public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer)','EXECUTE')
 and not has_function_privilege('authenticated','public.finalize_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,bytea,bytea,text,timestamptz,text[])','EXECUTE')" \
  'new refresh mutations are service-role RPC-only'
expect_failure 'permission denied' direct_refresh_update psql_query -c \
  "set role service_role; update public.ghl_marketplace_installations set credential_state='none' where id='$cas_id';"

expect_failure 'C1a rollback refused: refresh-runtime evidence exists' rollback_guard apply_rollback
assert_query "select to_regprocedure('public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer)') is not null
 and exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='ghl_marketplace_installations' and column_name='credential_state')" \
  'guarded rollback refusal is atomic'

echo 'HighLevel OAuth refresh foundation PostgreSQL 17 proofs passed'
