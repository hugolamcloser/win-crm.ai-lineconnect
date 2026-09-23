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
race_a_pid=""
race_b_pid=""
cleanup() {
  if [[ -n "$race_a_pid" ]]; then kill "$race_a_pid" 2>/dev/null || true; fi
  if [[ -n "$race_b_pid" ]]; then kill "$race_b_pid" 2>/dev/null || true; fi
  rm -f "$proof_log" "$race_a_log" "$race_b_log"
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
wait_for_sleep() {
  for _ in {1..100}; do
    if [[ "$(psql_query -Atqc "select exists(select 1 from pg_stat_activity where application_name = '$1' and wait_event = 'PgSleep')" | tr -d '\r')" == t ]]; then return; fi
    sleep 0.05
  done
  echo 'FAIL: race session did not acquire its lock' >&2; exit 1
}

assert_query "select current_database() = 'wincrm_test'
  and not exists(select 1 from public.ghl_marketplace_installations)" 'requires empty Marketplace installation table'

psql_query < test/postgres/ghlMarketplaceLifecycleOrdering.sql > "$proof_log"
echo 'Lifecycle stale/replay/equal-time/ownership proof passed'

psql_query -q -c "insert into public.tenants(id, location_id, ghl_provider_id, line_channel_id)
  values ('$tenant', 'issue102-race-location', 'issue102-line-provider', 'issue102-line-channel');
  set role service_role;
  select count(*) from public.apply_every8d_ghl_marketplace_lifecycle_v1(
    'INSTALL', 'issue102-race-app', 'issue102-race-client', '$tenant',
    'issue102-race-location', 'issue102-race-company', 'issue102-race-provider',
    '2026-09-22T14:20:00Z', 'race-install-a');
  select count(*) from public.apply_every8d_ghl_marketplace_lifecycle_v1(
    'UNINSTALL', 'issue102-race-app', 'issue102-race-client', null,
    'issue102-race-location', null, 'issue102-race-provider',
    '2026-09-22T14:35:00Z', 'race-uninstall-b');"

expect_failure "$rollback" 'lifecycle ordering rollback refused: preserve accepted lifecycle evidence'
assert_query "select status = 'uninstalled' and installation_generation = 2
  and latest_lifecycle_event_id = 'race-uninstall-b'
  from public.ghl_marketplace_installations where marketplace_app_id = 'issue102-race-app'" 'failed rollback preserves lifecycle evidence'

# A newer reinstall holds the row lock while an older distinct uninstall waits.
# Whichever request arrived at the process first, the durable timestamp order wins.
psql_query -Atq > "$race_a_log" <<SQL &
set application_name = 'issue102-newer-install';
set statement_timeout = '10s';
begin;
set local role service_role;
select count(*) from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'INSTALL', 'issue102-race-app', 'issue102-race-client', '$tenant',
  'issue102-race-location', 'issue102-race-company', 'issue102-race-provider',
  '2026-09-22T14:50:00Z', 'race-install-c');
select pg_sleep(2);
commit;
SQL
race_a_pid=$!
wait_for_sleep issue102-newer-install
psql_query -Atq > "$race_b_log" <<SQL &
set statement_timeout = '10s';
set role service_role;
select count(*) from public.apply_every8d_ghl_marketplace_lifecycle_v1(
  'UNINSTALL', 'issue102-race-app', 'issue102-race-client', null,
  'issue102-race-location', null, 'issue102-race-provider',
  '2026-09-22T14:40:00Z', 'race-older-distinct-uninstall');
SQL
race_b_pid=$!
wait "$race_a_pid"; race_a_pid=""
wait "$race_b_pid"; race_b_pid=""
[[ "$(tr -d '[:space:]' < "$race_a_log")" == 1 && "$(tr -d '[:space:]' < "$race_b_log")" == 1 ]] || {
  echo 'FAIL: lifecycle contenders did not both converge' >&2; exit 1;
}
assert_query "select status = 'pending' and installation_generation = 3
  and latest_lifecycle_event_at = '2026-09-22T14:50:00Z'::timestamptz
  and latest_lifecycle_event_id = 'race-install-c'
  and latest_lifecycle_event_type = 'INSTALL'
  from public.ghl_marketplace_installations where marketplace_app_id = 'issue102-race-app'" 'newest concurrent lifecycle event wins deterministically'
echo 'Two-connection lifecycle ordering proof passed'

psql_query -q -c "delete from public.ghl_marketplace_installations where marketplace_app_id = 'issue102-race-app';
  delete from public.tenants where id = '$tenant';"
psql_query < "$rollback" > "$proof_log"
assert_query "select not exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ghl_marketplace_installations'
      and column_name = 'latest_lifecycle_event_at')
  and to_regprocedure('public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)') is null" 'empty guarded rollback removes only D3 objects'
psql_query < "$migration" > "$proof_log"
assert_query "select exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ghl_marketplace_installations'
      and column_name = 'latest_lifecycle_event_at')
  and to_regprocedure('public.apply_every8d_ghl_marketplace_lifecycle_v1(text,text,text,uuid,text,text,text,timestamptz,text)') is not null" 'D3 migration reapplies after guarded rollback'
echo 'Marketplace lifecycle ordering PostgreSQL proof passed; guarded rollback and concurrency verified'
