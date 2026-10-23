#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly run_id="${RANDOM}${RANDOM}"
readonly prerequisite="c3c2a_prereq_${run_id}"
readonly database="c3c2a_proof_${run_id}"
readonly owner_role=c3a_migration_owner
readonly migration=supabase/migrations/202610220001_every8d_settings_session_consumption.sql
readonly proof=test/postgres/every8dSettingsSessionConsumption.sql

psql_db() {
  local db=$1
  shift
  timeout --signal=TERM 60s docker exec -i "$POSTGRES_CONTAINER_ID" \
    psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$db" "$@"
}

psql_owner() {
  local db=$1
  shift
  timeout --signal=TERM 60s docker exec -i -e "PGOPTIONS=-c role=$owner_role" \
    "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 \
    -v VERBOSITY=terse -U postgres -d "$db" "$@"
}

cleanup() {
  local status=$?
  for db in "$database" "$prerequisite"; do
    psql_db postgres -qc "drop database if exists $db with (force)" >/dev/null 2>&1 || status=1
  done
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

[[ "$(psql_db postgres -Atqc "select current_setting('server_version_num')::integer/10000=17
  and exists(select 1 from pg_roles where rolname='$owner_role'
    and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb)" | tr -d '\r')" == t ]] || {
  echo 'FAIL: PostgreSQL 17 and prior synthetic non-superuser owner required' >&2
  exit 1
}

# A fresh database is essential: prior C3a/C3b harnesses intentionally retain data.
# This repeats prerequisites in an isolated disposable environment; it never
# double-applies C3c-2a through the shared CI wildcard or a template with usage.
psql_db postgres -qc "create database $prerequisite owner $owner_role template template0
  encoding 'UTF8' lc_collate 'C' lc_ctype 'C'"
# Extension installation/placement is privileged disposable bootstrap work, not
# settings authority. Never transfer pgcrypto or member-function ownership.
psql_db "$prerequisite" -qc 'create extension if not exists pgcrypto;' >/dev/null
# Create prerequisite authority as the common owner from the outset. This avoids
# a mixed-owner fixture and never repairs an existing lifecycle function's owner.
for source in supabase/migrations/*.sql; do
  [[ "$(basename "$source")" < 202610220001 ]] || continue
  case "$source" in
    *202610060001*)
      psql_db "$prerequisite" -qc "create schema if not exists extensions;
        grant usage on schema extensions to $owner_role;" >/dev/null
      pgcrypto_schema=$(psql_db "$prerequisite" -Atqc "select n.nspname
        from pg_extension e join pg_namespace n on n.oid=e.extnamespace
        where e.extname='pgcrypto'" | tr -d '\r')
      if [[ "$pgcrypto_schema" == public ]]; then
        psql_db "$prerequisite" -qc 'alter extension pgcrypto set schema extensions;' >/dev/null
      elif [[ "$pgcrypto_schema" != extensions ]]; then
        echo 'FAIL: disposable pgcrypto must begin in public or extensions' >&2
        exit 1
      fi
      [[ "$(psql_db "$prerequisite" -Atqc "select exists(
        select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
        join pg_depend d on d.refclassid='pg_extension'::regclass and d.refobjid=e.oid
          and d.classid='pg_proc'::regclass and d.deptype='e'
        join pg_proc p on p.oid=d.objid
        where e.extname='pgcrypto' and n.nspname='extensions'
          and p.oid=to_regprocedure('extensions.digest(bytea,text)')
          and p.prorettype='bytea'::regtype)
        and to_regprocedure('public.digest(bytea,text)') is null" | tr -d '\r')" == t ]] || {
        echo 'FAIL: exact extensions.digest(bytea,text) dependency required' >&2
        exit 1
      }
      psql_db "$prerequisite" -Atqc "select jsonb_build_object(
        'extension_owner',e.extowner::regrole::text,'digest_owner',p.proowner::regrole::text,
        'schema',n.nspname,'exact_digest_dependency',true)
        from pg_extension e join pg_namespace n on n.oid=e.extnamespace
        join pg_proc p on p.oid='extensions.digest(bytea,text)'::regprocedure
        where e.extname='pgcrypto'"
      echo 'PASS privileged disposable pgcrypto placement and exact digest dependency'
      ;;
  esac
  # Canonical Git-object bytes make stored literal prosrc identical on all hosts.
  # Never normalize characters in stored function source to hide fixture drift.
  git show "HEAD:$source" | psql_owner "$prerequisite" >/dev/null
done
echo 'PASS common-owner C3a/C3b prerequisite migrations'

if [[ "${C3C2A_PROOF_MODE:-full}" == focused ]]; then
  "${PYTHON_BIN:-python3}" test/postgres/every8dSettingsSessionConsumptionConcurrency.py \
    --database "$prerequisite" --prerequisite "$prerequisite" --focused-maintenance
  echo 'C3c-2a focused R1/R2/R3 maintenance proof PASS'
  exit 0
fi

psql_db postgres -qc "create database $database owner $owner_role template $prerequisite"
psql_owner "$database" <"$migration" >/dev/null
psql_db "$database" <"$proof" >/dev/null
echo 'PASS C3c-2a transactional structure/enrollment/login/auth/logout proof'
psql_db "$database" -v fixtures_only=1 <"$proof" >/dev/null

"${PYTHON_BIN:-python3}" test/postgres/every8dSettingsSessionConsumptionConcurrency.py \
  --database "$database" --prerequisite "$prerequisite"

echo 'C3c-2a PostgreSQL 17 structure, behavior, isolation, concurrency and guarded rollback PASS'
