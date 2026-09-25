#!/usr/bin/env bash
set -euo pipefail
: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly database=wincrm_test
readonly migration=supabase/migrations/202609230002_every8d_public_oauth_bootstrap.sql
readonly rollback=supabase/rollback/202609230002_every8d_public_oauth_bootstrap.sql
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
psql_query() { docker exec -i "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$database" "$@"; }
psql_app() {
  local app_name=$1
  shift
  docker exec -e PGAPPNAME="$app_name" -i "$POSTGRES_CONTAINER_ID" \
    psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$database" "$@"
}
assert_query() { [[ "$(psql_query -Atqc "$1" | tr -d '\r')" == t ]] || { echo "FAIL: $2" >&2; exit 1; }; }
wait_for_activity() {
  local app_name=$1
  local wait_kind=$2
  local message=$3
  for _ in {1..80}; do
    if [[ "$(psql_query -Atqc "select exists(select 1 from pg_stat_activity where application_name='$app_name' and wait_event_type='$wait_kind')" | tr -d '\r')" == t ]]; then
      return 0
    fi
    sleep 0.1
  done
  echo "FAIL: $message" >&2
  exit 1
}
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
 id,app_namespace,marketplace_app_id,oauth_client_id,tenant_id,location_id,company_id,
 conversation_provider_id,channel,provider,status,latest_lifecycle_event_at,
 latest_lifecycle_event_id,latest_lifecycle_event_type
) values ('10000000-0000-4000-8000-000000000299','every8d_connect','baseline-app','baseline-client','00000000-0000-4000-8000-000000000299',
 'baseline-location','baseline-company','baseline-provider','sms','every8d','pending',
 '2026-09-23T00:00:00Z','internal_d3_baseline_10000000-0000-4000-8000-000000000299_pending_g1','INTERNAL_BASELINE');
alter table public.ghl_marketplace_installations enable trigger protect_ghl_marketplace_installation;
insert into public.ghl_marketplace_app_registrations(
 app_namespace,marketplace_app_id,oauth_client_id,conversation_provider_id,channel,provider
) values ('every8d_connect','oauth-app','oauth-client','oauth-provider','sms','every8d');
SQL
psql_query < "$migration" >/dev/null
assert_query "select latest_lifecycle_version_id is null from public.ghl_marketplace_installations where location_id='baseline-location'" \
  'forward keeps INTERNAL_BASELINE lifecycle version null'

# Each rollback guard is independently proven.
psql_query -q -c "insert into public.ghl_marketplace_app_version_registrations values ('every8d_connect','guard-version');"
expect_rollback_refusal 'version registration evidence exists'
psql_query -q -c "alter table public.ghl_marketplace_app_version_registrations disable trigger protect_ghl_marketplace_app_version_registration; delete from public.ghl_marketplace_app_version_registrations; alter table public.ghl_marketplace_app_version_registrations enable trigger protect_ghl_marketplace_app_version_registration;"

psql_query -q -c "insert into public.ghl_marketplace_oauth_bootstraps(app_namespace,marketplace_version_id,expected_location_id,target_installation_generation,state_hash,browser_binding_hash,redirect_uri,config_fingerprint,status,expires_at,authorization_code_ciphertext,authorization_code_key_version) values ('every8d_connect','guard-version','guard-location',1,repeat('a',64),repeat('b',64),'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('c',64),'waiting_install',clock_timestamp()+interval '10 minutes',convert_to('guard-code','utf8'),'code-v1');"
expect_rollback_refusal 'durable OAuth attempt evidence exists'
psql_query -q -c "delete from public.ghl_marketplace_oauth_bootstraps;"

psql_query -q -c "alter table public.ghl_marketplace_installations disable trigger protect_ghl_marketplace_installation; update public.ghl_marketplace_installations set latest_lifecycle_version_id='guard-version', latest_lifecycle_event_type='INSTALL' where location_id='baseline-location'; alter table public.ghl_marketplace_installations enable trigger protect_ghl_marketplace_installation;"
expect_rollback_refusal 'lifecycle version evidence exists'
psql_query -q -c "alter table public.ghl_marketplace_installations disable trigger protect_ghl_marketplace_installation; update public.ghl_marketplace_installations set latest_lifecycle_version_id=null, latest_lifecycle_event_type='INTERNAL_BASELINE' where location_id='baseline-location'; alter table public.ghl_marketplace_installations enable trigger protect_ghl_marketplace_installation;"

# Clean rollback restores the D3 boundary exactly enough to reapply.
psql_query < "$rollback" >/dev/null
assert_query "select to_regclass('public.ghl_marketplace_oauth_bootstraps') is null
 and to_regclass('public.ghl_marketplace_app_version_registrations') is null
 and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ghl_marketplace_installations' and column_name='latest_lifecycle_version_id')
 and has_function_privilege('service_role','public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)','EXECUTE')" \
  'clean rollback restores D3 objects and privilege boundary'
assert_query "select count(*)=1
 and bool_and(marketplace_app_id='oauth-app' and oauth_client_id='oauth-client'
  and conversation_provider_id='oauth-provider' and channel='sms' and provider='every8d')
 and (select tgenabled='O' from pg_trigger
      where tgrelid='public.ghl_marketplace_app_registrations'::regclass
        and tgname='protect_ghl_marketplace_app_registration')
 from public.ghl_marketplace_app_registrations
 where app_namespace='every8d_connect'" \
  'clean rollback preserves the immutable D3 owner registration and protection trigger'
psql_query < "$migration" >/dev/null
psql_query < test/postgres/ghlPublicOAuthBootstrap.sql >/dev/null
echo 'Forward, guarded rollback, reapply, privilege, generation, and cross-location proofs passed'

# Committed fixtures for multi-connection races.
psql_query -q <<'SQL'
insert into public.ghl_marketplace_app_version_registrations values ('every8d_connect','race-version');
insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id)
values
 ('00000000-0000-4000-8000-000000000211','race-location','race-line','race-channel'),
 ('00000000-0000-4000-8000-000000000212','callback-first-location','callback-first-line','callback-first-channel'),
 ('00000000-0000-4000-8000-000000000213','install-first-location','install-first-line','install-first-channel'),
 ('00000000-0000-4000-8000-000000000214','recovery-wait-location','recovery-wait-line','recovery-wait-channel'),
 ('00000000-0000-4000-8000-000000000215','recovery-ready-location','recovery-ready-line','recovery-ready-channel'),
 ('00000000-0000-4000-8000-000000000216','recovery-stale-location','recovery-stale-line','recovery-stale-channel'),
 ('00000000-0000-4000-8000-000000000217','claim-burn-location','claim-burn-line','claim-burn-channel');
SQL

# True first-install race: callback owns the shared Location lock and INSTALL blocks.
psql_app callback_first_holder -Atq <<'SQL' >"$tmp_dir/callback-first-holder.out" &
begin; set local role service_role;
select public.accept_every8d_public_oauth_callback_v1(
 'oauth-app','oauth-client','oauth-provider','race-version','callback-first-location',repeat('1',64),repeat('2',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('3',64),clock_timestamp()+interval '10 minutes',
 convert_to('callback-first-code','utf8'),'code-v1');
select pg_sleep(8); commit;
SQL
callback_first_holder_pid=$!
wait_for_activity callback_first_holder Timeout 'callback-first holder did not reach controlled pg_sleep barrier'
psql_app callback_first_waiter -Atq -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000212','callback-first-location','callback-first-company','oauth-provider','race-version','2026-09-23T14:00:00Z','callback-first-install');" >"$tmp_dir/callback-first-waiter.out" &
callback_first_waiter_pid=$!
wait_for_activity callback_first_waiter Lock 'callback-first INSTALL did not block on the shared Location lock'
wait "$callback_first_holder_pid"
wait "$callback_first_waiter_pid"
assert_query "select count(*)=1 and bool_and(i.installation_generation=1 and b.status='ready'
 and b.target_installation_generation=1 and b.claimed_installation_id=i.id)
 from public.ghl_marketplace_installations i join public.ghl_marketplace_oauth_bootstraps b
 on b.expected_location_id=i.location_id where i.location_id='callback-first-location'" \
  'callback-first concurrent order commits generation one ready without stranded waiting_install'

# True first-install race: INSTALL owns the same Location lock and callback blocks.
psql_app install_first_holder -Atq <<'SQL' >"$tmp_dir/install-first-holder.out" &
begin; set local role service_role;
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
 'INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000213','install-first-location',
 'install-first-company','oauth-provider','race-version','2026-09-23T14:10:00Z','install-first-install');
select pg_sleep(8); commit;
SQL
install_first_holder_pid=$!
wait_for_activity install_first_holder Timeout 'install-first holder did not reach controlled pg_sleep barrier'
psql_app install_first_waiter -Atq -c "set role service_role; select public.accept_every8d_public_oauth_callback_v1('oauth-app','oauth-client','oauth-provider','race-version','install-first-location',repeat('4',64),repeat('5',64),'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('3',64),clock_timestamp()+interval '10 minutes',convert_to('install-first-code','utf8'),'code-v1');" >"$tmp_dir/install-first-waiter.out" &
install_first_waiter_pid=$!
wait_for_activity install_first_waiter Lock 'install-first callback did not block on the shared Location lock'
wait "$install_first_holder_pid"
wait "$install_first_waiter_pid"
assert_query "select count(*)=1 and bool_and(i.installation_generation=1 and b.status='ready'
 and b.target_installation_generation=1 and b.claimed_installation_id=i.id)
 from public.ghl_marketplace_installations i join public.ghl_marketplace_oauth_bootstraps b
 on b.expected_location_id=i.location_id where i.location_id='install-first-location'" \
  'install-first concurrent order admits callback directly ready for generation one'

# Real committed crash/recovery fixtures use fresh psql processes for every step.
psql_app recovery_wait_callback -Atq -c "set role service_role; select public.accept_every8d_public_oauth_callback_v1('oauth-app','oauth-client','oauth-provider','race-version','recovery-wait-location',repeat('6',64),repeat('7',64),'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('3',64),clock_timestamp()+interval '10 minutes',convert_to('recovery-wait-code','utf8'),'code-v1');" >/dev/null
assert_query "select status='waiting_install' from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('6',64)" \
  'committed callback survives session exit as waiting_install'
psql_app recovery_wait_install -Atq -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000214','recovery-wait-location','recovery-wait-company','oauth-provider','race-version','2026-09-23T14:20:00Z','recovery-wait-install');" >/dev/null
assert_query "select status='ready' and claimed_installation_generation=1 from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('6',64)" \
  'later INSTALL promotes committed waiting_install evidence to exact-generation ready'

psql_app recovery_ready_install -Atq -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000215','recovery-ready-location','recovery-ready-company','oauth-provider','race-version','2026-09-23T14:30:00Z','recovery-ready-install');" >/dev/null
psql_app recovery_ready_callback -Atq -c "set role service_role; select public.accept_every8d_public_oauth_callback_v1('oauth-app','oauth-client','oauth-provider','race-version','recovery-ready-location',repeat('8',64),repeat('9',64),'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('3',64),clock_timestamp()+interval '10 minutes',convert_to('recovery-ready-code','utf8'),'code-v1');" >/dev/null
recovery_ready_id=$(psql_query -Atqc "select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('8',64)" | tr -d '\r')
psql_app recovery_ready_list -Atq -c "set role service_role; select public.list_every8d_oauth_recoverable_v1('race-version',repeat('3',64),16);" >"$tmp_dir/recovery-ready-list.out"
grep -q "$recovery_ready_id" "$tmp_dir/recovery-ready-list.out" || { echo 'FAIL: fresh recovery session did not list committed ready attempt' >&2; exit 1; }
psql_app recovery_ready_claim -Atq -c "set role service_role; select public.claim_every8d_oauth_exchange_v1('$recovery_ready_id','race-version',repeat('3',64));" >/dev/null
assert_query "select status='exchanging' from public.ghl_marketplace_oauth_bootstraps where id='$recovery_ready_id'" \
  'fresh recovery session claims committed ready attempt exactly once'

psql_app recovery_stale_install -Atq -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000216','recovery-stale-location','recovery-stale-company','oauth-provider','race-version','2026-09-23T14:40:00Z','recovery-stale-install');" >/dev/null
psql_query -q <<'SQL'
alter table public.ghl_marketplace_oauth_bootstraps disable trigger protect_ghl_marketplace_oauth_bootstrap;
insert into public.ghl_marketplace_oauth_bootstraps(
 app_namespace,marketplace_version_id,expected_location_id,target_installation_generation,
 state_hash,browser_binding_hash,redirect_uri,config_fingerprint,status,created_at,expires_at,
 callback_received_at,authorization_code_ciphertext,authorization_code_key_version,
 claimed_installation_id,claimed_installation_generation,exchange_started_at
) select 'every8d_connect','race-version','recovery-stale-location',1,repeat('a',64),repeat('b',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('3',64),'exchanging',
 clock_timestamp()-interval '5 minutes',clock_timestamp()+interval '5 minutes',
 clock_timestamp()-interval '5 minutes',convert_to('stale-code','utf8'),'code-v1',id,1,
 clock_timestamp()-interval '3 minutes'
 from public.ghl_marketplace_installations where location_id='recovery-stale-location';
alter table public.ghl_marketplace_oauth_bootstraps enable trigger protect_ghl_marketplace_oauth_bootstrap;
SQL
recovery_stale_id=$(psql_query -Atqc "select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('a',64)" | tr -d '\r')
psql_app recovery_stale_scan -Atq -c "set role service_role; select public.list_every8d_oauth_recoverable_v1('race-version',repeat('3',64),16);" >/dev/null
assert_query "select status='failed' and failure_class='exchange_outcome_unknown'
 and authorization_code_ciphertext is null and authorization_code_key_version is null
 from public.ghl_marketplace_oauth_bootstraps where id='$recovery_stale_id'" \
  'stale exchanging recovery burns generation and scrubs code envelope'
psql_app recovery_stale_rescan -Atq -c "set role service_role; select public.list_every8d_oauth_recoverable_v1('race-version',repeat('3',64),16);" >"$tmp_dir/recovery-stale-list.out"
! grep -q "$recovery_stale_id" "$tmp_dir/recovery-stale-list.out" || { echo 'FAIL: failed stale exchange remained recoverable' >&2; exit 1; }
[[ "$(psql_app recovery_stale_claim -Atq -c "set role service_role; select public.claim_every8d_oauth_exchange_v1('$recovery_stale_id','race-version',repeat('3',64)) is null;" | tr -d '\r')" == t ]] || { echo 'FAIL: stale exchanged code was claimable again' >&2; exit 1; }

# The claim RPC independently rechecks generation-burn evidence before ready -> exchanging.
psql_app claim_burn_install -Atq -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000217','claim-burn-location','claim-burn-company','oauth-provider','race-version','2026-09-23T14:50:00Z','claim-burn-install');" >/dev/null
psql_app claim_burn_callback -Atq -c "set role service_role; select public.accept_every8d_public_oauth_callback_v1('oauth-app','oauth-client','oauth-provider','race-version','claim-burn-location',repeat('e',64),repeat('f',64),'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('3',64),clock_timestamp()+interval '10 minutes',convert_to('claim-burn-code','utf8'),'code-v1');" >/dev/null
claim_burn_ready_id=$(psql_query -Atqc "select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('e',64)" | tr -d '\r')
psql_query -q <<'SQL'
alter table public.ghl_marketplace_oauth_bootstraps disable trigger protect_ghl_marketplace_oauth_bootstrap;
insert into public.ghl_marketplace_oauth_bootstraps(
 app_namespace,marketplace_version_id,expected_location_id,target_installation_generation,
 state_hash,browser_binding_hash,redirect_uri,config_fingerprint,status,created_at,expires_at,
 callback_received_at,claimed_installation_id,claimed_installation_generation,
 exchange_started_at,terminal_at,failure_class
) select 'every8d_connect','race-version','claim-burn-location',1,repeat('f',64),repeat('0',64),
 'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('3',64),'failed',
 clock_timestamp()-interval '1 minute',clock_timestamp()+interval '9 minutes',
 clock_timestamp()-interval '1 minute',id,1,clock_timestamp()-interval '30 seconds',
 clock_timestamp(),'credential_persistence_failed'
 from public.ghl_marketplace_installations where location_id='claim-burn-location';
alter table public.ghl_marketplace_oauth_bootstraps enable trigger protect_ghl_marketplace_oauth_bootstrap;
SQL
[[ "$(psql_app claim_burn_attempt -Atq -c "set role service_role; select public.claim_every8d_oauth_exchange_v1('$claim_burn_ready_id','race-version',repeat('3',64)) is null;" | tr -d '\r')" == t ]] || { echo 'FAIL: exchange claim ignored generation-burn evidence' >&2; exit 1; }
assert_query "select status='ready' and authorization_code_ciphertext is not null from public.ghl_marketplace_oauth_bootstraps where id='$claim_burn_ready_id'" \
  'generation-burn claim rejection performs zero state movement'

# Same authenticated-state callback replay: exactly one durable winner and immutable ciphertext.
for suffix in a b; do
  code="code-$suffix"
  psql_query -Atq -c "set role service_role; select public.accept_every8d_public_oauth_callback_v1(
   'oauth-app','oauth-client','oauth-provider','race-version','race-location',repeat('7',64),repeat('8',64),
   'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('9',64),clock_timestamp()+interval '10 minutes',
   convert_to('$code','utf8'),'code-v1') is not null;" >"$tmp_dir/callback-$suffix.out" &
done
wait
callback_winners=$(grep -l '^t' "$tmp_dir"/callback-*.out | wc -l | tr -d ' ')
[[ "$callback_winners" == 1 ]] || { echo 'FAIL: same-state callbacks did not produce one winner' >&2; exit 1; }
assert_query "select count(*)=1 and (select convert_from(authorization_code_ciphertext,'utf8') from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('7',64)) in ('code-a','code-b') from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('7',64)" \
  'same-state callback cannot replace ciphertext'

bootstrap_id=$(psql_query -Atqc "select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('7',64)" | tr -d '\r')
psql_query -q -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000211','race-location','race-company','oauth-provider','race-version','2026-09-23T15:00:00Z','race-install');"
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
psql_query -Atq -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2('UNINSTALL','oauth-app','oauth-client',null,'race-location',null,'oauth-provider','race-version','2026-09-23T15:10:00Z','race-uninstall');" >"$tmp_dir/uninstall-after-finalize.out" &
uninstall_pid=$!
wait "$finalize_pid"; wait "$uninstall_pid"
assert_query "select status='uninstalled' and access_token_ciphertext is null from public.ghl_marketplace_installations where location_id='race-location'" \
  'UNINSTALL after finalization leaves no usable credentials'

# UNINSTALL first, then finalization: attempt is invalidated and finalization loses.
callback_json=$(psql_query -Atqc "set role service_role; select public.accept_every8d_public_oauth_callback_v1('oauth-app','oauth-client','oauth-provider','race-version','race-location',repeat('c',64),repeat('d',64),'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('9',64),clock_timestamp()+interval '10 minutes',convert_to('reinstall-code','utf8'),'code-v1');" | tr -d '\r')
[[ "$callback_json" == *'targetInstallationGeneration": 3'* ]] || { echo 'FAIL: reinstall callback did not target generation 3' >&2; exit 1; }
psql_query -q -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2('INSTALL','oauth-app','oauth-client','00000000-0000-4000-8000-000000000211','race-location','race-company','oauth-provider','race-version','2026-09-23T15:20:00Z','race-reinstall');"
reinstall_id=$(psql_query -Atqc "select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('c',64)" | tr -d '\r')
psql_query -q -c "set role service_role; select public.claim_every8d_oauth_exchange_v1('$reinstall_id','race-version',repeat('9',64));"
psql_query -Atq <<SQL >"$tmp_dir/uninstall-first.out" &
begin; set local role service_role;
select public.apply_every8d_ghl_marketplace_lifecycle_v2('UNINSTALL','oauth-app','oauth-client',null,'race-location',null,'oauth-provider','race-version','2026-09-23T15:30:00Z','race-uninstall-2');
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
