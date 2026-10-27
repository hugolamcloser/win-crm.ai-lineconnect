#!/usr/bin/env bash
set -euo pipefail
: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly owner_role=c3a_migration_owner
readonly run_id="${RANDOM}${RANDOM}"
readonly prerequisite="c3c3_prereq_${run_id}"
readonly unused="c3c3_unused_${run_id}"
readonly runtime="c3c3_runtime_${run_id}"
readonly migration=supabase/migrations/202610230001_every8d_settings_auth_email_outbox.sql
readonly rollback=supabase/rollback/202610230001_every8d_settings_auth_email_outbox.sql
psql_db() {
  local db=$1; shift
  timeout --signal=TERM 60s docker exec -i "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$db" "$@"
}
psql_owner() {
  local db=$1; shift
  timeout --signal=TERM 60s docker exec -i -e "PGOPTIONS=-c role=$owner_role" "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$db" "$@"
}
cleanup() {
  local status=$?
  for db in "$runtime" "$unused" "$prerequisite"; do
    psql_db postgres -qc "drop database if exists $db with (force)" >/dev/null 2>&1 || status=1
  done
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT
[[ "$(psql_db postgres -Atqc "select current_setting('server_version_num')::integer/10000=17")" == t ]] || exit 1
psql_db postgres -Atqc 'select version()'
psql_db postgres <<'SQL' >/dev/null
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  if not exists(select 1 from pg_roles where rolname='c3a_migration_owner') then create role c3a_migration_owner nologin; end if;
end $$;
SQL
psql_db postgres -qc "create database $prerequisite owner $owner_role template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'"
psql_db "$prerequisite" -qc "create schema extensions; create extension pgcrypto with schema extensions; grant usage on schema extensions to $owner_role"
for source in supabase/migrations/*.sql; do
  [[ "$(basename "$source")" < 202610230001 ]] || continue
  "${GIT_BIN:-git}" show "HEAD:$source" | psql_owner "$prerequisite" >/dev/null
done
echo 'PASS canonical prerequisite replay through C3c-2a'
psql_db postgres -qc "create database $unused owner $owner_role template $prerequisite"
if [[ "${C3C3_PROOF_MODE:-full}" == derive ]]; then
  # Metadata-only derivation: no runtime API, nextval, or outbox-row creation.
  cat "$migration" test/postgres/every8dSettingsEmailOutboxDerive.sql | psql_owner "$unused" -Atq
  exit 0
fi
# Fresh pre-use rollback is intentionally before every behavioral fixture.
psql_owner "$unused" < "$migration" >/dev/null
psql_owner "$unused" < "$rollback" >/dev/null
echo 'PASS fresh pre-use rollback before runtime allocation'
psql_db postgres -qc "create database $runtime owner $owner_role template $prerequisite"
psql_owner "$runtime" < "$migration" >/dev/null
# Runtime proof follows only after the unused fixture has completed rollback.
psql_owner "$runtime" < test/postgres/every8dSettingsEmailOutboxAad.sql >/dev/null
echo 'PASS independent SQL AAD golden vectors' 
psql_db "$runtime" -v fixtures_only=1 < test/postgres/every8dSettingsSessionConsumption.sql >/dev/null
psql_db "$runtime" < test/postgres/every8dSettingsEmailOutbox.sql >/dev/null
proof_arguments=()
if [[ "${C3C3_PROOF_MODE:-full}" == purge-cleanup ]]; then
  proof_arguments+=(--purge-cleanup-only)
fi
"${PYTHON_BIN:-python3}" test/postgres/every8dSettingsEmailOutboxConcurrency.py \
  --database "$runtime" --prerequisite "$prerequisite" --container "$POSTGRES_CONTAINER_ID" "${proof_arguments[@]}"
