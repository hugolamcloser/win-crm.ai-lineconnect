#!/usr/bin/env bash
set -euo pipefail
: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly owner_role=c3a_migration_owner
readonly run_id="${RANDOM}${RANDOM}"
readonly prerequisite="c3c3_cov_prereq_${run_id}"
readonly runtime="c3c3_cov_runtime_${run_id}"
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
  for db in "$runtime" "$prerequisite"; do
    psql_db postgres -qc "drop database if exists $db with (force)" >/dev/null 2>&1 || status=1
  done
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT
case "${C3C3_PROOF_MODE:-full}" in
  full|section36|closure) ;;
  *) echo 'FAIL expected full, section36 or closure proof mode'; exit 1 ;;
esac
if [[ "${C3C3_PROOF_MODE:-full}" == full ]]; then
  "${NODE_BIN:-node}" -e "const m=require('./test/postgres/every8dSettingsEmailOutboxCoverageManifest.cjs');if(m.derive().length!==107||m.requirements().size!==107)process.exit(1)"
fi
[[ "$(psql_db postgres -Atqc "select current_setting('server_version_num')::integer/10000=17")" == t ]] || exit 1
psql_db postgres -Atqc 'show server_version'
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
psql_db postgres -qc "create database $runtime owner $owner_role template $prerequisite"
psql_owner "$runtime" < supabase/migrations/202610230001_every8d_settings_auth_email_outbox.sql >/dev/null
psql_owner "$runtime" < test/postgres/every8dSettingsEmailOutboxPostflight.sql >/dev/null
psql_db "$runtime" -v fixtures_only=1 < test/postgres/every8dSettingsSessionConsumption.sql >/dev/null
psql_db "$runtime" < test/postgres/every8dSettingsEmailOutbox.sql >/dev/null
if [[ "${C3C3_PROOF_MODE:-full}" == section36 ]]; then
  "${PYTHON_BIN:-python3}" test/postgres/every8dSettingsEmailOutboxSection36.py \
    --database "$runtime" --prerequisite "$prerequisite" --container "$POSTGRES_CONTAINER_ID"
else
  cases=${C3C3_CLOSURE_CASES:-populated}
  evidence=${C3C3_CLOSURE_EVIDENCE:-docs/every8d-c3c3-section36-execution-final.json}
  if [[ "${C3C3_PROOF_MODE:-full}" == full ]]; then cases=all; fi
  "${PYTHON_BIN:-python3}" test/postgres/every8dSettingsEmailOutboxClosure.py \
    --database "$runtime" --prerequisite "$prerequisite" --container "$POSTGRES_CONTAINER_ID" \
    --cases "$cases" --evidence "$evidence"
  psql_db postgres -qc "drop database $runtime" >/dev/null
  psql_db postgres -qc "drop database $prerequisite" >/dev/null
  [[ "$(psql_db postgres -Atqc "select count(*)=0 from pg_database where datname like 'c3c3_%'")" == t ]] || { echo 'FAIL surviving proof databases'; exit 1; }
  [[ "$(psql_db postgres -Atqc "select count(*)=0 from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid()")" == t ]] || { echo 'FAIL surviving proof backends'; exit 1; }
  "${PYTHON_BIN:-python3}" - "$evidence" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]);data=json.loads(p.read_text());data['cleanup']['base_databases_zero']=True
p.write_text(json.dumps(data,indent=2)+'\n')
PY
  if [[ "${C3C3_PROOF_MODE:-full}" == full ]]; then
    "${NODE_BIN:-node}" test/postgres/every8dSettingsEmailOutboxCoverageManifest.cjs --certificate "$evidence"
    echo 'PASS complete frozen Section36 certificate: 107 executed / 107 PASS / 0 missing / 0 partial'
  fi
fi
