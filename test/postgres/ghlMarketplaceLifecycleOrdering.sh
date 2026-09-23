#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly database=wincrm_test
readonly migration=supabase/migrations/202609230001_ghl_marketplace_lifecycle_ordering.sql
readonly rollback=supabase/rollback/202609230001_ghl_marketplace_lifecycle_ordering.sql
readonly tenant=00000000-0000-4000-8000-000000000103
proof_log=$(mktemp)
race_a_log=$(mktemp)
race_b_log=$(mktemp)
race_fifo_dir=$(mktemp -d)
race_a_fifo="$race_fifo_dir/session-a"
race_a_pid=""
race_b_pid=""
race_a_fd_open=false
cleanup() {
  if [[ "$race_a_fd_open" == true ]]; then exec 3>&-; fi
  if [[ -n "$race_a_pid" ]]; then kill "$race_a_pid" 2>/dev/null || true; fi
  if [[ -n "$race_b_pid" ]]; then kill "$race_b_pid" 2>/dev/null || true; fi
  rm -f "$proof_log" "$race_a_log" "$race_b_log" "$race_a_fifo"
  rmdir "$race_fifo_dir" 2>/dev/null || true
}
trap cleanup EXIT
psql_query() {
  docker exec -i "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$database" "$@"
}
assert_query() {
  [[ "$(psql_query -Atqc "$1" | tr -d '\r')" == t ]] || { echo "FAIL: $2" >&2; exit 1; }
}
expect_failure() {
  if psql_query < "$1" > "$proof_log" 2>&1; then
    echo "FAIL: expected refusal for $1" >&2; exit 1
  fi
  grep -Fq "$2" "$proof_log" || { echo "FAIL: unexpected refusal for $1" >&2; exit 1; }
}
wait_for_idle_transaction() {
  local application_name=$1
  local backend_pid
  for _ in {1..200}; do
    backend_pid=$(psql_query -Atqc "select coalesce((select pid::text from pg_stat_activity
      where application_name = '$application_name' and state = 'idle in transaction' limit 1), '')" | tr -d '\r')
    if [[ "$backend_pid" =~ ^[0-9]+$ ]]; then echo "$backend_pid"; return; fi
    sleep 0.05
  done
  echo 'FAIL: transaction did not acquire and retain its row lock' >&2; exit 1
}
wait_for_blocked_backend() {
  local application_name=$1
  local blocker_pid=$2
  local backend_pid
  for _ in {1..200}; do
    backend_pid=$(psql_query -Atqc "select coalesce((select blocked.pid::text
      from pg_stat_activity blocked
      where blocked.application_name = '$application_name'
        and blocked.wait_event_type = 'Lock'
        and $blocker_pid = any(pg_blocking_pids(blocked.pid))
      limit 1), '')" | tr -d '\r')
    if [[ "$backend_pid" =~ ^[0-9]+$ ]]; then echo "$backend_pid"; return; fi
    sleep 0.05
  done
  echo 'FAIL: competing lifecycle RPC was not observed waiting on the retained row lock' >&2; exit 1
}

assert_query "select current_database() = 'wincrm_test'
  and not exists(select 1 from public.ghl_marketplace_installations)" 'requires empty Marketplace installation table'

# Recreate the pre-D3 boundary and prove migration-time chronology fences both
# directions without changing either existing state or generation.
psql_query < "$rollback" > "$proof_log"
psql_query -q -c "insert into public.tenants(id, location_id, ghl_provider_id, line_channel_id) values
  ('$tenant', 'issue102-pre-uninstalled', 'issue102-line-provider-a', 'issue102-line-channel-a'),
  ('00000000-0000-4000-8000-000000000104', 'issue102-pre-pending',
    'issue102-line-provider-b', 'issue102-line-channel-b');
  insert into public.ghl_marketplace_installations(
    id, marketplace_app_id, oauth_client_id, tenant_id, location_id, company_id,
    conversation_provider_id, status, installation_generation
  ) values
  ('10000000-0000-4000-8000-000000000103', 'issue102-app', 'issue102-client', '$tenant',
    'issue102-pre-uninstalled', 'issue102-company-a', 'issue102-provider', 'uninstalled', 7),
  ('10000000-0000-4000-8000-000000000104', 'issue102-app', 'issue102-client',
    '00000000-0000-4000-8000-000000000104', 'issue102-pre-pending',
    'issue102-company-b', 'issue102-provider', 'pending', 4);"
psql_query < "$migration" > "$proof_log"
assert_query "select count(*) = 2
    and bool_and(latest_lifecycle_event_at is not null)
    and bool_and(latest_lifecycle_event_type = 'INTERNAL_BASELINE')
    and bool_and(latest_lifecycle_event_id = 'internal_d3_baseline_' || id::text || '_' || status
      || '_g' || installation_generation::text)
  from public.ghl_marketplace_installations
  where marketplace_app_id = 'issue102-app'" 'D3 assigns a row/state/generation-bound synthetic chronology baseline'
assert_query "select marketplace_app_id = 'issue102-app' and oauth_client_id = 'issue102-client'
    and conversation_provider_id = 'issue102-provider' and channel = 'sms' and provider = 'every8d'
  from public.ghl_marketplace_app_registrations where app_namespace = 'every8d_connect'" 'D3 pins one consistent existing ownership identity'
psql_query -q -c "set role service_role;
  select count(*) from public.apply_every8d_ghl_marketplace_lifecycle_v1(
    'INSTALL', 'issue102-app', 'issue102-client', '$tenant',
    'issue102-pre-uninstalled', 'issue102-company-a', 'issue102-provider',
    '2000-01-01T00:00:00Z', 'stale-pre-d3-install');
  select count(*) from public.apply_every8d_ghl_marketplace_lifecycle_v1(
    'UNINSTALL', 'issue102-app', 'issue102-client', null,
    'issue102-pre-pending', null, 'issue102-provider',
    '2000-01-01T00:00:00Z', 'stale-pre-d3-uninstall');"
assert_query "select status = 'uninstalled' and installation_generation = 7
    and latest_lifecycle_event_type = 'INTERNAL_BASELINE'
  from public.ghl_marketplace_installations where id = '10000000-0000-4000-8000-000000000103'" 'stale pre-D3 INSTALL cannot reverse the existing uninstalled generation'
assert_query "select status = 'pending' and installation_generation = 4
    and latest_lifecycle_event_type = 'INTERNAL_BASELINE'
  from public.ghl_marketplace_installations where id = '10000000-0000-4000-8000-000000000104'" 'stale pre-D3 UNINSTALL cannot reverse the existing eligible generation'

# Baseline-only rollback is safe: it removes only D3 metadata and registration,
# never the installation rows or their pre-D3 status/generation.
psql_query < "$rollback" > "$proof_log"
assert_query "select status = 'uninstalled' and installation_generation = 7
    from public.ghl_marketplace_installations where id = '10000000-0000-4000-8000-000000000103'
  and not exists(select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'ghl_marketplace_installations' and column_name = 'latest_lifecycle_event_at')
  and to_regclass('public.ghl_marketplace_app_registrations') is null" 'baseline-only rollback preserves rows and removes only additive D3 objects'

psql_query < "$migration" > "$proof_log"
newer_at=$(psql_query -Atqc "select (latest_lifecycle_event_at + interval '1 second')::text
  from public.ghl_marketplace_installations where id = '10000000-0000-4000-8000-000000000103'" | tr -d '\r')
readonly newer_at
psql_query -q -c "set role service_role;
  select count(*) from public.apply_every8d_ghl_marketplace_lifecycle_v1(
    'INSTALL', 'issue102-app', 'issue102-client', '$tenant',
    'issue102-pre-uninstalled', 'issue102-company-a', 'issue102-provider',
    '$newer_at', 'post-d3-install');
  select count(*) from public.apply_every8d_ghl_marketplace_lifecycle_v1(
    'INSTALL', 'issue102-app', 'issue102-client', '$tenant',
    'issue102-pre-uninstalled', 'issue102-company-a', 'issue102-provider',
    '$newer_at', 'post-d3-install');"
assert_query "select status = 'pending' and installation_generation = 8
    and latest_lifecycle_event_at = '$newer_at'::timestamptz
    and latest_lifecycle_event_id = 'post-d3-install'
    and latest_lifecycle_event_type = 'INSTALL'
  from public.ghl_marketplace_installations where id = '10000000-0000-4000-8000-000000000103'" 'newer post-migration lifecycle event applies exactly once and exact retry is idempotent'
expect_failure "$rollback" 'lifecycle ordering rollback refused: preserve accepted authoritative lifecycle evidence'
echo 'Pre-D3 baseline, stale-event, post-D3 advance, exact-retry and rollback-guard proofs passed'

# Owner-only cleanup of disposable fixtures so the focused transaction proof and
# final rollback/reapply exercise start from a known empty installation table.
psql_query -q -c "delete from public.ghl_marketplace_installations
    where id in ('10000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000104');
  delete from public.tenants where id in ('$tenant', '00000000-0000-4000-8000-000000000104');"
psql_query < "$rollback" > "$proof_log"
psql_query < "$migration" > "$proof_log"

psql_query < test/postgres/ghlMarketplaceLifecycleOrdering.sql > "$proof_log"
echo 'Lifecycle stale/replay/equal-time/registration/watermark proof passed'

# Persist the owner-approved synthetic registration used by the two-connection proof.
psql_query -q -c "insert into public.ghl_marketplace_app_registrations(
    app_namespace, marketplace_app_id, oauth_client_id, conversation_provider_id, channel, provider
  ) values ('every8d_connect', 'issue102-app', 'issue102-client', 'issue102-provider', 'sms', 'every8d');
  insert into public.tenants(id, location_id, ghl_provider_id, line_channel_id)
  values ('$tenant', 'issue102-race-location', 'issue102-line-provider', 'issue102-line-channel');
  set role service_role;
  select count(*) from public.apply_every8d_ghl_marketplace_lifecycle_v1(
    'INSTALL', 'issue102-app', 'issue102-client', '$tenant',
    'issue102-race-location', 'issue102-race-company', 'issue102-provider',
    '2026-09-22T14:20:00Z', 'race-install-a');
  select count(*) from public.apply_every8d_ghl_marketplace_lifecycle_v1(
    'UNINSTALL', 'issue102-app', 'issue102-client', null,
    'issue102-race-location', null, 'issue102-provider',
    '2026-09-22T14:35:00Z', 'race-uninstall-b');"

expect_failure "$rollback" 'lifecycle ordering rollback refused: preserve accepted authoritative lifecycle evidence'
assert_query "select status = 'uninstalled' and installation_generation = 2
  and latest_lifecycle_event_id = 'race-uninstall-b'
  from public.ghl_marketplace_installations where marketplace_app_id = 'issue102-app'
    and location_id = 'issue102-race-location'" 'failed rollback preserves lifecycle evidence'

# Session A applies the newer reinstall and then remains idle in the open
# transaction. Session B invokes the older uninstall. An observer must prove B's
# backend is waiting on A's PostgreSQL lock before this script sends COMMIT to A.
mkfifo "$race_a_fifo"
psql_query -Atq < "$race_a_fifo" > "$race_a_log" 2>&1 &
race_a_pid=$!
exec 3>"$race_a_fifo"
race_a_fd_open=true
printf '%s\n' \
  "set application_name = 'issue102-newer-install';" \
  "set statement_timeout = '10s';" \
  "begin;" \
  "set local role service_role;" \
  "select count(*) from public.apply_every8d_ghl_marketplace_lifecycle_v1('INSTALL', 'issue102-app', 'issue102-client', '$tenant', 'issue102-race-location', 'issue102-race-company', 'issue102-provider', '2026-09-22T14:50:00Z', 'race-install-c');" >&3
race_a_backend_pid=$(wait_for_idle_transaction issue102-newer-install)
readonly race_a_backend_pid

psql_query -Atq > "$race_b_log" 2>&1 <<SQL &
set application_name = 'issue102-older-uninstall';
set statement_timeout = '10s';
set role service_role;
select count(*) from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'UNINSTALL', 'issue102-app', 'issue102-client', null,
  'issue102-race-location', null, 'issue102-provider',
  '2026-09-22T14:40:00Z', 'race-older-distinct-uninstall');
SQL
race_b_pid=$!
race_b_backend_pid=$(wait_for_blocked_backend issue102-older-uninstall "$race_a_backend_pid")
readonly race_b_backend_pid
echo "Observed PostgreSQL backend $race_b_backend_pid waiting on row-lock holder $race_a_backend_pid"

printf '%s\n' 'commit;' '\q' >&3
exec 3>&-
race_a_fd_open=false
wait "$race_a_pid"; race_a_pid=""
wait "$race_b_pid"; race_b_pid=""
[[ "$(tr -d '[:space:]' < "$race_a_log")" == 1 && "$(tr -d '[:space:]' < "$race_b_log")" == 1 ]] || {
  echo 'FAIL: lifecycle contenders did not both converge' >&2; exit 1;
}
assert_query "select status = 'pending' and installation_generation = 3
  and latest_lifecycle_event_at = '2026-09-22T14:50:00Z'::timestamptz
  and latest_lifecycle_event_id = 'race-install-c'
  and latest_lifecycle_event_type = 'INSTALL'
  from public.ghl_marketplace_installations where marketplace_app_id = 'issue102-app'
    and location_id = 'issue102-race-location'" 'newest concurrent lifecycle event wins deterministically'
echo 'Two-connection lifecycle ordering proof passed with observed PostgreSQL lock wait'

psql_query -q -c "delete from public.ghl_marketplace_installations
    where marketplace_app_id = 'issue102-app' and location_id = 'issue102-race-location';
  delete from public.tenants where id = '$tenant';"
psql_query < "$rollback" > "$proof_log"
assert_query "select not exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ghl_marketplace_installations'
      and column_name = 'latest_lifecycle_event_at')
  and to_regclass('public.ghl_marketplace_app_registrations') is null
  and to_regprocedure('public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)') is null" 'empty guarded rollback removes only D3 objects'
psql_query < "$migration" > "$proof_log"
assert_query "select exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ghl_marketplace_installations'
      and column_name = 'latest_lifecycle_event_at')
  and to_regclass('public.ghl_marketplace_app_registrations') is not null
  and to_regprocedure('public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)') is not null" 'D3 migration reapplies after guarded rollback'
echo 'Marketplace lifecycle ordering PostgreSQL proof passed; guarded rollback and deterministic concurrency verified'
