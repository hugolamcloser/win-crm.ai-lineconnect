#!/usr/bin/env bash
set -euo pipefail
: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly database=wincrm_test
readonly migration=supabase/migrations/202609230002_every8d_public_oauth_bootstrap.sql
readonly rollback=supabase/rollback/202609230002_every8d_public_oauth_bootstrap.sql
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
psql_query() { docker exec -i "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$database" "$@"; }
assert_query() { [[ "$(psql_query -Atqc "$1" | tr -d '\r')" == t ]] || { echo "FAIL: $2" >&2; exit 1; }; }
expect_rollback_refusal() {
  local expected=$1
  set +e
  psql_query < "$rollback" >"$tmp_dir/rollback.out" 2>"$tmp_dir/rollback.err"
  local status=$?
  set -e
  [[ $status -ne 0 ]] && grep -q "$expected" "$tmp_dir/rollback.err" || {
    echo "FAIL: rollback did not refuse $expected" >&2; exit 1;
  }
}

assert_query "select to_regclass('public.ghl_marketplace_app_version_registrations') is null" 'requires D3 boundary'

# Existing INTERNAL_BASELINE evidence survives forward with a null lifecycle version.
psql_query -q <<'SQL'
insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id)
values ('00000000-0000-4000-8000-000000000299','baseline-location','baseline-line','baseline-channel');
alter table public.ghl_marketplace_installations disable trigger protect_ghl_marketplace_installation;
insert into public.ghl_marketplace_installations(
 app_namespace,marketplace_app_id,oauth_client_id,tenant_id,location_id,company_id,
 conversation_provider_id,channel,provider,status,latest_lifecycle_event_at,
 latest_lifecycle_event_id,latest_lifecycle_event_type
) values ('every8d_connect','baseline-app','baseline-client','00000000-0000-4000-8000-000000000299',
 'baseline-location','baseline-company','baseline-provider','sms','every8d','pending',
 '2026-09-23T00:00:00Z','baseline-event','INTERNAL_BASELINE');
alter table public.ghl_marketplace_installations enable trigger protect_ghl_marketplace_installation;
SQL
psql_query < "$migration" >/dev/null
assert_query "select latest_lifecycle_version_id is null from public.ghl_marketplace_installations where location_id='baseline-location'" \
  'forward keeps INTERNAL_BASELINE lifecycle version null'

# Each rollback guard is independently proven.
psql_query -q -c "insert into public.ghl_marketplace_app_registrations(app_namespace,marketplace_app_id,oauth_client_id,conversation_provider_id,channel,provider) values ('every8d_connect','guard-app','guard-client','guard-provider','sms','every8d'); insert into public.ghl_marketplace_app_version_registrations values ('every8d_connect','guard-version');"
expect_rollback_refusal 'version registration evidence exists'
psql_query -q -c "alter table public.ghl_marketplace_app_version_registrations disable trigger protect_ghl_marketplace_app_version_registration; delete from public.ghl_marketplace_app_version_registrations; alter table public.ghl_marketplace_app_version_registrations enable trigger protect_ghl_marketplace_app_version_registration;"

psql_query -q -c "insert into public.ghl_marketplace_oauth_bootstraps(app_namespace,marketplace_version_id,expected_location_id,target_installation_generation,state_hash,browser_binding_hash,redirect_uri,config_fingerprint,status,expires_at,authorization_code_ciphertext,authorization_code_key_version) values ('every8d_connect','guard-version','guard-location',1,repeat('a',64),repeat('b',64),'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('c',64),'waiting_install',clock_timestamp()+interval '10 minutes',convert_to('guard-code','utf8'),'code-v1');"
expect_rollback_refusal 'durable OAuth attempt evidence exists'
psql_query -q -c "delete from public.ghl_marketplace_oauth_bootstraps;"

psql_query -q -c "alter table public.ghl_marketplace_installations disable trigger protect_ghl_marketplace_installation; update public.ghl_marketplace_installations set latest_lifecycle_version_id='guard-version', latest_lifecycle_event_type='INSTALL' where location_id='baseline-location'; alter table public.ghl_marketplace_installations enable trigger protect_ghl_marketplace_installation;"
expect_rollback_refusal 'lifecycle version evidence exists'
psql_query -q -c "alter table public.ghl_marketplace_installations disable trigger protect_ghl_marketplace_installation; update public.ghl_marketplace_installations set latest_lifecycle_version_id=null, latest_lifecycle_event_type='INTERNAL_BASELINE' where location_id='baseline-location'; alter table public.ghl_marketplace_installations enable trigger protect_ghl_marketplace_installation; delete from public.ghl_marketplace_app_registrations where app_namespace='every8d_connect';"

# Clean rollback restores the D3 boundary exactly enough to reapply.
psql_query < "$rollback" >/dev/null
assert_query "select to_regclass('public.ghl_marketplace_oauth_bootstraps') is null
 and to_regclass('public.ghl_marketplace_app_version_registrations') is null
 and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ghl_marketplace_installations' and column_name='latest_lifecycle_version_id')
 and has_function_privilege('service_role','public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)','EXECUTE')" \
  'clean rollback restores D3 objects and privilege boundary'
psql_query < "$migration" >/dev/null
psql_query < test/postgres/ghlPublicOAuthBootstrap.sql >/dev/null
echo 'Forward, guarded rollback, reapply, privilege, generation, and cross-location proofs passed'

# Committed fixtures for multi-connection races.
psql_query -q <<'SQL'
insert into public.ghl_marketplace_app_registrations(app_namespace,marketplace_app_id,oauth_client_id,conversation_provider_id,channel,provider)
values ('every8d_connect','race-app','race-client','race-provider','sms','every8d');
insert into public.ghl_marketplace_app_version_registrations values ('every8d_connect','race-version');
insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id)
values ('00000000-0000-4000-8000-000000000211','race-location','race-line','race-channel');
SQL

# Same authenticated-state callback replay: exactly one durable winner and immutable ciphertext.
for suffix in a b; do
  code="code-$suffix"
  psql_query -Atq -c "set role service_role; select public.accept_every8d_public_oauth_callback_v1(
   'race-app','race-client','race-provider','race-version','race-location',repeat('7',64),repeat('8',64),
   'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('9',64),clock_timestamp()+interval '10 minutes',
   convert_to('$code','utf8'),'code-v1') is not null;" >"$tmp_dir/callback-$suffix.out" &
done
wait
callback_winners=$(grep -l '^t' "$tmp_dir"/callback-*.out | wc -l | tr -d ' ')
[[ "$callback_winners" == 1 ]] || { echo 'FAIL: same-state callbacks did not produce one winner' >&2; exit 1; }
assert_query "select count(*)=1 and (select convert_from(authorization_code_ciphertext,'utf8') from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('7',64)) in ('code-a','code-b') from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('7',64)" \
  'same-state callback cannot replace ciphertext'

bootstrap_id=$(psql_query -Atqc "select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('7',64)" | tr -d '\r')
psql_query -q -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','race-app','race-client','00000000-0000-4000-8000-000000000211','race-location','race-company','race-provider','race-version','2026-09-23T15:00:00Z','race-install');"
assert_query "select status='ready' and target_installation_generation=1 and claimed_installation_generation=1 from public.ghl_marketplace_oauth_bootstraps where id='$bootstrap_id'" \
  'callback/INSTALL rendezvous reaches exact generation'

for suffix in a b; do
  psql_query -Atq -c "set role service_role; select public.claim_every8d_oauth_exchange_v1('$bootstrap_id','race-version',repeat('9',64)) is not null;" >"$tmp_dir/claim-$suffix.out" &
done
wait
claim_winners=$(grep -l '^t' "$tmp_dir"/claim-*.out | wc -l | tr -d ' ')
[[ "$claim_winners" == 1 ]] || { echo 'FAIL: exchange claim did not produce one winner' >&2; exit 1; }

# Finalization first, then concurrent UNINSTALL: credentials are cleared by UNINSTALL.
psql_query -Atq <<SQL >"$tmp_dir/finalize-first.out" &
begin; set local role service_role;
select public.finalize_every8d_oauth_exchange_v1('$bootstrap_id','race-version',repeat('9',64),convert_to('access','utf8'),convert_to('refresh','utf8'),'token-v1',clock_timestamp()+interval '1 hour',array['locations.readonly']);
select pg_sleep(1); commit;
SQL
finalize_pid=$!
sleep 0.2
psql_query -Atq -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2('UNINSTALL','race-app','race-client',null,'race-location',null,'race-provider','race-version','2026-09-23T15:10:00Z','race-uninstall');" >"$tmp_dir/uninstall-after-finalize.out" &
uninstall_pid=$!
wait "$finalize_pid"; wait "$uninstall_pid"
assert_query "select status='uninstalled' and access_token_ciphertext is null from public.ghl_marketplace_installations where location_id='race-location'" \
  'UNINSTALL after finalization leaves no usable credentials'

# UNINSTALL first, then finalization: attempt is invalidated and finalization loses.
callback_json=$(psql_query -Atqc "set role service_role; select public.accept_every8d_public_oauth_callback_v1('race-app','race-client','race-provider','race-version','race-location',repeat('c',64),repeat('d',64),'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('9',64),clock_timestamp()+interval '10 minutes',convert_to('reinstall-code','utf8'),'code-v1');" | tr -d '\r')
[[ "$callback_json" == *'targetInstallationGeneration": 3'* ]] || { echo 'FAIL: reinstall callback did not target generation 3' >&2; exit 1; }
psql_query -q -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','race-app','race-client','00000000-0000-4000-8000-000000000211','race-location','race-company','race-provider','race-version','2026-09-23T15:20:00Z','race-reinstall');"
reinstall_id=$(psql_query -Atqc "select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('c',64)" | tr -d '\r')
psql_query -q -c "set role service_role; select public.claim_every8d_oauth_exchange_v1('$reinstall_id','race-version',repeat('9',64));"
psql_query -Atq <<SQL >"$tmp_dir/uninstall-first.out" &
begin; set local role service_role;
select public.apply_every8d_ghl_marketplace_lifecycle_v2('UNINSTALL','race-app','race-client',null,'race-location',null,'race-provider','race-version','2026-09-23T15:30:00Z','race-uninstall-2');
select pg_sleep(1); commit;
SQL
uninstall_first_pid=$!
sleep 0.2
psql_query -Atq -c "set role service_role; select public.finalize_every8d_oauth_exchange_v1('$reinstall_id','race-version',repeat('9',64),convert_to('access','utf8'),convert_to('refresh','utf8'),'token-v1',clock_timestamp()+interval '1 hour',array['locations.readonly']);" >"$tmp_dir/finalize-after-uninstall.out" &
finalize_after_pid=$!
wait "$uninstall_first_pid"; wait "$finalize_after_pid"
[[ "$(tr -d '[:space:]' < "$tmp_dir/finalize-after-uninstall.out")" == f ]] || { echo 'FAIL: finalization succeeded after UNINSTALL' >&2; exit 1; }
assert_query "select status='failed' and failure_class='lifecycle_invalidated' and authorization_code_ciphertext is null from public.ghl_marketplace_oauth_bootstraps where id='$reinstall_id'" \
  'UNINSTALL-first race invalidates and scrubs the exact generation'
echo 'Public OAuth PostgreSQL 17 concurrency proofs passed'
