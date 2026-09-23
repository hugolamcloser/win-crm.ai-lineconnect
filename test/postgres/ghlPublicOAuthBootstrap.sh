#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly database=wincrm_test
readonly migration=supabase/migrations/202609230002_every8d_public_oauth_bootstrap.sql
readonly rollback=supabase/rollback/202609230002_every8d_public_oauth_bootstrap.sql
proof_log=$(mktemp)
race_dir=$(mktemp -d)
cleanup() {
  rm -f "$proof_log"
  rm -rf "$race_dir"
}
trap cleanup EXIT
psql_query() {
  docker exec -i "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse \
    -U postgres -d "$database" "$@"
}
assert_query() {
  [[ "$(psql_query -Atqc "$1" | tr -d '\r')" == t ]] || { echo "FAIL: $2" >&2; exit 1; }
}

assert_query "select to_regclass('public.ghl_marketplace_app_version_registrations') is null" \
  'requires the pre-public-bootstrap D3 boundary'
psql_query < "$migration" > "$proof_log"
assert_query "select to_regclass('public.ghl_marketplace_oauth_bootstraps') is not null
  and not exists(select 1 from public.ghl_marketplace_app_version_registrations)
  and exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='ghl_marketplace_installations' and column_name='latest_lifecycle_version_id')" \
  'forward migration creates objects without inventing owner version identity'
psql_query < "$rollback" > "$proof_log"
assert_query "select to_regclass('public.ghl_marketplace_oauth_bootstraps') is null
  and to_regclass('public.ghl_marketplace_app_version_registrations') is null
  and not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='ghl_marketplace_installations' and column_name='latest_lifecycle_version_id')" \
  'unused rollback removes only additive public-bootstrap objects'
psql_query < "$migration" > "$proof_log"
psql_query < test/postgres/ghlPublicOAuthBootstrap.sql > "$proof_log"
echo 'Forward/rollback/reapply and focused bootstrap SQL proofs passed'

# Committed synthetic fixtures for real multi-connection proofs.
psql_query -q -c "insert into public.ghl_marketplace_app_registrations(
    app_namespace, marketplace_app_id, oauth_client_id, conversation_provider_id, channel, provider
  ) values ('every8d_connect','race-app','race-client','race-provider','sms','every8d');
  insert into public.ghl_marketplace_app_version_registrations(app_namespace, marketplace_version_id)
  values ('every8d_connect','race-version');
  insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id) values
  ('00000000-0000-4000-8000-000000000211','race-location','race-line-provider','race-line-channel');"

# Admission uses a transaction advisory lock: exactly one concurrent creator wins.
for suffix in a b; do
  (
    set +e
    psql_query -Atq -c "set role service_role; select id from public.create_every8d_public_oauth_bootstrap_v1(
      'race-app','race-client','race-provider','race-version',
      repeat('$([[ "$suffix" == a ]] && echo 7 || echo 8)',64),
      repeat('$([[ "$suffix" == a ]] && echo a || echo b)',64),
      'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('9',64),600);" \
      > "$race_dir/admission-$suffix.out" 2> "$race_dir/admission-$suffix.err"
    echo $? > "$race_dir/admission-$suffix.status"
  ) &
done
wait
admission_successes=$(grep -l '^0$' "$race_dir"/admission-*.status | wc -l | tr -d ' ')
[[ "$admission_successes" == 1 ]] || { echo 'FAIL: concurrent admission did not produce one winner' >&2; exit 1; }
assert_query "select count(*)=1 from public.ghl_marketplace_oauth_bootstraps
  where app_namespace='every8d_connect' and status='awaiting_callback'" \
  'concurrent global/context admission cap creates one row'

state_hash=$(psql_query -Atqc "select state_hash from public.ghl_marketplace_oauth_bootstraps
  where status='awaiting_callback'" | tr -d '\r')
binding_hash=$(psql_query -Atqc "select browser_binding_hash from public.ghl_marketplace_oauth_bootstraps
  where state_hash='$state_hash'" | tr -d '\r')
bootstrap_id=$(psql_query -Atqc "select id from public.ghl_marketplace_oauth_bootstraps
  where state_hash='$state_hash'" | tr -d '\r')

# Callback and signed INSTALL start simultaneously and converge under row locks.
psql_query -Atq -c "set role service_role; select public.accept_every8d_public_oauth_callback_v1(
  '$bootstrap_id','$state_hash','$binding_hash',
  'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('9',64),
  convert_to('encrypted-race-code','utf8'),'code-v1');" > "$race_dir/callback.out" &
callback_pid=$!
psql_query -Atq -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'INSTALL','race-app','race-client','00000000-0000-4000-8000-000000000211',
  'race-location','race-company','race-provider','race-version',
  '2026-09-23T15:00:00Z','race-install');" > "$race_dir/install.out" &
install_pid=$!
wait "$callback_pid"
wait "$install_pid"
assert_query "select status='ready' and claimed_installation_generation=1
  and authorization_code_ciphertext is not null
  from public.ghl_marketplace_oauth_bootstraps where id='$bootstrap_id'" \
  'concurrent INSTALL/callback converges to exact ready generation'

# Two real connections race ready -> exchanging; exactly one returns a claim.
for suffix in a b; do
  psql_query -Atq -c "set role service_role; select
    public.claim_every8d_oauth_exchange_v1('$bootstrap_id','race-version',repeat('9',64)) is not null;" \
    > "$race_dir/claim-$suffix.out" &
done
wait
claim_winners=$(grep -l '^t' "$race_dir"/claim-*.out | wc -l | tr -d ' ')
[[ "$claim_winners" == 1 ]] || { echo 'FAIL: ready exchange did not produce one winner' >&2; exit 1; }
psql_query -q -c "set role service_role; select public.fail_every8d_oauth_bootstrap_v1(
  '$bootstrap_id','exchange_outcome_unknown');"

# Prepare an exchanging attempt, then force finalization to hold the shared lock
# order before UNINSTALL. UNINSTALL must clear credentials after finalization.
psql_query -q -c "set role service_role;
  select id from public.create_every8d_public_oauth_bootstrap_v1(
    'race-app','race-client','race-provider','race-version',repeat('c',64),repeat('d',64),
    'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('9',64),600);
  select public.accept_every8d_public_oauth_callback_v1(
    (select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('c',64)),
    repeat('c',64),repeat('d',64),'https://oauth.example.invalid/oauth/every8d-connect/callback',
    repeat('9',64),convert_to('encrypted-finalize-first','utf8'),'code-v1');
  select public.apply_every8d_ghl_marketplace_lifecycle_v2(
    'INSTALL','race-app','race-client','00000000-0000-4000-8000-000000000211',
    'race-location','race-company','race-provider','race-version',
    '2026-09-23T15:10:00Z','race-install-refresh');
  select public.claim_every8d_oauth_exchange_v1(
    (select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('c',64)),
    'race-version',repeat('9',64));"
finalize_id=$(psql_query -Atqc "select id from public.ghl_marketplace_oauth_bootstraps
  where state_hash=repeat('c',64)" | tr -d '\r')
psql_query -Atq > "$race_dir/finalize-first.out" <<SQL &
begin;
set local role service_role;
select public.finalize_every8d_oauth_exchange_v1(
  '$finalize_id','race-version',repeat('9',64),convert_to('access','utf8'),convert_to('refresh','utf8'),
  'token-v1',clock_timestamp()+interval '1 hour',array['locations.readonly']);
select pg_sleep(1);
commit;
SQL
finalize_pid=$!
sleep 0.2
psql_query -Atq -c "set role service_role; select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'UNINSTALL','race-app','race-client',null,'race-location',null,'race-provider','race-version',
  '2026-09-23T15:20:00Z','race-uninstall-finalize-first');" > "$race_dir/uninstall-after-finalize.out" &
uninstall_pid=$!
wait "$finalize_pid"
wait "$uninstall_pid"
assert_query "select i.status='uninstalled' and i.access_token_ciphertext is null
  and b.status='succeeded' and b.authorization_code_ciphertext is null
  from public.ghl_marketplace_installations i
  join public.ghl_marketplace_oauth_bootstraps b on b.id='$finalize_id'
  where i.location_id='race-location'" 'finalize-first/UNINSTALL race leaves no usable credentials'

# Reverse lock order: UNINSTALL holds installation then attempt; finalization
# waits and must return false after lifecycle invalidation.
psql_query -q -c "set role service_role;
  select id from public.create_every8d_public_oauth_bootstrap_v1(
    'race-app','race-client','race-provider','race-version',repeat('e',64),repeat('f',64),
    'https://oauth.example.invalid/oauth/every8d-connect/callback',repeat('9',64),600);
  select public.apply_every8d_ghl_marketplace_lifecycle_v2(
    'INSTALL','race-app','race-client','00000000-0000-4000-8000-000000000211',
    'race-location','race-company','race-provider','race-version',
    '2026-09-23T15:30:00Z','race-reinstall');
  select public.accept_every8d_public_oauth_callback_v1(
    (select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('e',64)),
    repeat('e',64),repeat('f',64),'https://oauth.example.invalid/oauth/every8d-connect/callback',
    repeat('9',64),convert_to('encrypted-uninstall-first','utf8'),'code-v1');
  select public.claim_every8d_oauth_exchange_v1(
    (select id from public.ghl_marketplace_oauth_bootstraps where state_hash=repeat('e',64)),
    'race-version',repeat('9',64));"
uninstall_first_id=$(psql_query -Atqc "select id from public.ghl_marketplace_oauth_bootstraps
  where state_hash=repeat('e',64)" | tr -d '\r')
psql_query -Atq > "$race_dir/uninstall-first.out" <<SQL &
begin;
set local role service_role;
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'UNINSTALL','race-app','race-client',null,'race-location',null,'race-provider','race-version',
  '2026-09-23T15:40:00Z','race-uninstall-first');
select pg_sleep(1);
commit;
SQL
uninstall_first_pid=$!
sleep 0.2
psql_query -Atq -c "set role service_role; select public.finalize_every8d_oauth_exchange_v1(
  '$uninstall_first_id','race-version',repeat('9',64),convert_to('access','utf8'),convert_to('refresh','utf8'),
  'token-v1',clock_timestamp()+interval '1 hour',array['locations.readonly']);" \
  > "$race_dir/finalize-after-uninstall.out" &
finalize_after_pid=$!
wait "$uninstall_first_pid"
wait "$finalize_after_pid"
[[ "$(tr -d '[:space:]' < "$race_dir/finalize-after-uninstall.out")" == f ]] || {
  echo 'FAIL: finalization succeeded after UNINSTALL invalidation' >&2; exit 1;
}
assert_query "select i.status='uninstalled' and i.access_token_ciphertext is null
  and b.status='failed' and b.failure_class='lifecycle_invalidated'
  and b.authorization_code_ciphertext is null
  from public.ghl_marketplace_installations i
  join public.ghl_marketplace_oauth_bootstraps b on b.id='$uninstall_first_id'
  where i.location_id='race-location'" 'UNINSTALL-first/finalize race fails closed and scrubs code'

echo 'Public OAuth PostgreSQL 17 concurrency proofs passed'
