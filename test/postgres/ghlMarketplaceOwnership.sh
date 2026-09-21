#!/usr/bin/env bash
set -euo pipefail

# Destructive schema proofs belong only in the disposable CI database.
: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly database=wincrm_test
readonly migration=supabase/migrations/202609170001_ghl_marketplace_ownership.sql
readonly rollback=supabase/rollback/202609170001_ghl_marketplace_ownership.sql
readonly tenant=00000000-0000-4000-8000-000000000095
readonly installation=10000000-0000-4000-8000-000000000095
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
protected_fingerprint() {
  # Hash synthetic data internally; never print token columns or row contents.
  psql_query -Atqc "select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text, '')) from public.tenants t;
    select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text, '')) from public.ghl_oauth_tokens t;
    select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text, '')) from public.ghl_sms_outbound_operations t;
    select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text, '')) from public.ghl_sms_controlled_live_authorizations t;"
}
wait_for_sleep() {
  for _ in {1..100}; do
    if [[ "$(psql_query -Atqc "select exists(select 1 from pg_stat_activity where application_name = '$1' and wait_event = 'PgSleep')" | tr -d '\r')" == t ]]; then return; fi
    sleep 0.05
  done
  echo "FAIL: race session did not acquire its lock" >&2; exit 1
}

assert_query "select current_database() = 'wincrm_test' and
  not exists(select 1 from public.ghl_marketplace_installations) and
  not exists(select 1 from public.ghl_marketplace_oauth_states)" 'requires empty new schema'
before=$(protected_fingerprint)
readonly before
psql_query < test/postgres/ghlMarketplaceOwnership.sql > "$proof_log"
echo 'Ownership, credentials, state lifecycle, RLS and role proof passed'
expect_failure "$migration" 'already exists'
assert_query "select not exists(select 1 from public.ghl_marketplace_installations)" 'reapplication preserves schema'

psql_query -q -c "insert into public.tenants(id, location_id, ghl_provider_id, line_channel_id)
  values ('$tenant', 'issue95-location', 'issue95-line-provider', 'issue95-line-channel');
  insert into public.ghl_marketplace_installations(id, marketplace_app_id, oauth_client_id, tenant_id, location_id, conversation_provider_id)
  values ('$installation', 'issue95-app', 'issue95-client', '$tenant', 'issue95-location', 'issue95-every8d-provider');"
expect_failure "$rollback" 'marketplace rollback refused: preserve nonempty ownership schema'
assert_query "select count(*) = 1 from public.ghl_marketplace_installations" 'populated installation retained'
psql_query -q -c "insert into public.ghl_marketplace_oauth_states
  (installation_id, installation_generation, state_hash, browser_binding_hash, redirect_uri, expires_at)
  values ('$installation', 1, repeat('9', 64), repeat('8', 64), 'https://example.invalid/callback', now() + interval '5 minutes');"
expect_failure "$rollback" 'marketplace rollback refused: preserve nonempty ownership schema'
assert_query "select count(*) = 1 from public.ghl_marketplace_oauth_states" 'populated state retained'

# Two real connections contend for one state. Conditional UPDATE returns one winner.
psql_query -Atq > "$race_a_log" <<'SQL' &
set application_name = 'issue95-consume-a';
set statement_timeout = '10s';
begin;
set local role service_role;
with consumed as (update public.ghl_marketplace_oauth_states set consumed_at = clock_timestamp()
  where state_hash = repeat('9', 64) and consumed_at is null and revoked_at is null returning id)
select count(*) from consumed;
select pg_sleep(2);
commit;
SQL
race_a_pid=$!
wait_for_sleep issue95-consume-a
psql_query -Atq > "$race_b_log" <<'SQL' &
set statement_timeout = '10s';
set role service_role;
with consumed as (update public.ghl_marketplace_oauth_states set consumed_at = clock_timestamp()
  where state_hash = repeat('9', 64) and consumed_at is null and revoked_at is null returning id)
select count(*) from consumed;
SQL
race_b_pid=$!
wait "$race_a_pid"; race_a_pid=""
wait "$race_b_pid"; race_b_pid=""
[[ "$(tr -d '[:space:]' < "$race_a_log")" == 1 && "$(tr -d '[:space:]' < "$race_b_log")" == 0 ]] || { echo 'FAIL: state race must have one winner' >&2; exit 1; }

# Generation changes serialize against consumption, including an uncommitted reinstall.
psql_query -q -c "insert into public.ghl_marketplace_oauth_states
  (installation_id, installation_generation, state_hash, browser_binding_hash, redirect_uri, expires_at)
  values ('$installation', 1, repeat('7', 64), repeat('8', 64), 'https://example.invalid/callback', now() + interval '5 minutes');"
psql_query -Atq > "$race_a_log" <<SQL &
set application_name = 'issue95-reinstall';
set statement_timeout = '10s';
begin;
set local role service_role;
update public.ghl_marketplace_installations set installation_generation = 2 where id = '$installation';
select pg_sleep(2);
commit;
SQL
race_a_pid=$!
wait_for_sleep issue95-reinstall
if psql_query -q -c "set statement_timeout = '10s'; set role service_role;
  update public.ghl_marketplace_oauth_states set consumed_at = clock_timestamp()
  where state_hash = repeat('7', 64) and consumed_at is null and revoked_at is null;" > "$race_b_log" 2>&1; then
  echo 'FAIL: stale state consumed during reinstall' >&2; exit 1
fi
wait "$race_a_pid"; race_a_pid=""
grep -Fq 'OAuth state installation, generation, or expiry is ineligible' "$race_b_log"
assert_query "select consumed_at is null from public.ghl_marketplace_oauth_states where state_hash = repeat('7', 64)" 'stale state remains unused'
echo 'Single-use and reinstall concurrency proofs passed'

# Owner-only cleanup of these exact synthetic rows, never service-role deletion.
psql_query -q -c "delete from public.ghl_marketplace_oauth_states where installation_id = '$installation';
  delete from public.ghl_marketplace_installations where id = '$installation';
  delete from public.tenants where id = '$tenant';"

# An unexpected dependency must abort all drops, not trigger CASCADE or partial removal.
psql_query -q -c 'create view public.issue95_rollback_dependency as select id from public.ghl_marketplace_installations;'
expect_failure "$rollback" 'depend on it'
assert_query "select to_regclass('public.ghl_marketplace_oauth_states') is not null
  and to_regclass('public.ghl_marketplace_installations') is not null" 'failed rollback is atomic'
psql_query -q -c 'drop view public.issue95_rollback_dependency;'
psql_query < "$rollback" > "$proof_log"
assert_query "select to_regclass('public.ghl_marketplace_installations') is null
  and to_regclass('public.ghl_marketplace_oauth_states') is null
  and to_regprocedure('public.protect_ghl_marketplace_installation_v1()') is null
  and to_regprocedure('public.protect_ghl_marketplace_oauth_state_v1()') is null
  and not exists(select 1 from pg_constraint where conrelid = 'public.tenants'::regclass and conname = 'tenants_marketplace_id_location_key')" 'empty rollback removes only owned objects'

# Inject a late name collision: earlier DDL must roll back as one transaction.
psql_query -q -c 'create view public.ghl_marketplace_oauth_states as select 1 as issue95_collision;'
expect_failure "$migration" 'already exists'
assert_query "select to_regclass('public.ghl_marketplace_installations') is null
  and to_regprocedure('public.protect_ghl_marketplace_installation_v1()') is null
  and not exists(select 1 from pg_constraint where conrelid = 'public.tenants'::regclass and conname = 'tenants_marketplace_id_location_key')" 'failed forward migration is atomic'
psql_query -q -c 'drop view public.ghl_marketplace_oauth_states;'
psql_query < "$migration" > "$proof_log"
[[ "$before" == "$(protected_fingerprint)" ]] || { echo 'FAIL: protected LINE/SMS data changed' >&2; exit 1; }
echo 'Marketplace ownership PostgreSQL proof passed; guarded rollback and transactional failure verified'
