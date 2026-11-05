#!/usr/bin/env bash
set -euo pipefail
: "${POSTGRES_CONTAINER_ID:?dedicated disposable PG17 container required}"
readonly database="c3c4a_worker_${RANDOM}${RANDOM}"
psql_db() {
  local db=$1; shift
  timeout --signal=TERM 60s docker exec -i "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$db" "$@"
}
cleanup() {
  local status=$?
  psql_db postgres -qc "drop database if exists $database with (force)" >/dev/null 2>&1 || status=1
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT
[[ "$(psql_db postgres -Atqc "select current_setting('server_version_num')::integer/10000=17")" == t ]]
psql_db postgres <<'SQL' >/dev/null
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  if not exists(select 1 from pg_roles where rolname='c3a_migration_owner') then create role c3a_migration_owner nologin; end if;
end $$;
SQL
psql_db postgres -qc "create database $database owner c3a_migration_owner template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'"
psql_db "$database" -qc 'create schema extensions; create extension pgcrypto with schema extensions; grant usage on schema extensions to c3a_migration_owner'
for source in supabase/migrations/*.sql; do
  [[ "$(basename "$source")" < 202610240000 ]] || continue
  "${GIT_BIN:-git}" show "HEAD:$source" | timeout --signal=TERM 60s docker exec -i -e 'PGOPTIONS=-c role=c3a_migration_owner' "$POSTGRES_CONTAINER_ID" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$database" >/dev/null
done
psql_db "$database" -v fixtures_only=1 < test/postgres/every8dSettingsSessionConsumption.sql >/dev/null
psql_db "$database" < test/postgres/every8dSettingsEmailOutbox.sql >/dev/null
"${NODE_BIN:-node}" test/postgres/every8dSettingsEmailWorkerLifecycle.cjs "$POSTGRES_CONTAINER_ID" "$database"
