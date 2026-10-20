#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly database=wincrm_test
readonly owner_role=c3a_migration_owner
readonly migration=supabase/migrations/202610140001_every8d_settings_auth_orchestration.sql
readonly rollback=supabase/rollback/202610140001_every8d_settings_auth_orchestration.sql
readonly proof=test/postgres/every8dSettingsAuthOrchestration.sql
readonly run_id="${RANDOM}${RANDOM}"
readonly clone_prefix="c3b3_${run_id}"
readonly app_prefix="c3b3_actor_${run_id}"
readonly wait_seconds=30
tmp_dir=$(mktemp -d)
declare -a clone_dbs=()
declare -a background_pids=()
renamed_anon_role=''

psql_db() {
  local db=$1
  shift
  timeout --signal=TERM 60s docker exec \
    -e "PGOPTIONS=-c statement_timeout=55s -c lock_timeout=35s" \
    -i "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 \
    -v VERBOSITY=terse -U postgres -d "$db" "$@"
}

psql_owner_db() {
  local db=$1
  shift
  timeout --signal=TERM 60s docker exec \
    -e "PGOPTIONS=-c role=$owner_role -c statement_timeout=55s -c lock_timeout=35s" \
    -i "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 \
    -v VERBOSITY=terse -U postgres -d "$db" "$@"
}

psql_app() {
  local role=$1 app=$2
  shift 2
  timeout --signal=TERM 60s docker exec -e "PGAPPNAME=$app" \
    -e "PGOPTIONS=-c role=$role -c statement_timeout=55s -c lock_timeout=35s" \
    -i "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 \
    -v VERBOSITY=terse -U postgres -d "$database" "$@"
}

cleanup() {
  local original_status=$?
  psql_db "$database" -Atqc "select pg_terminate_backend(pid)
    from pg_stat_activity where application_name like '${app_prefix}\_%' escape '\\'
      and pid<>pg_backend_pid()" >/dev/null 2>&1 || true
  for pid in "${background_pids[@]}"; do
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  done
  if [[ -n "$renamed_anon_role" ]]; then
    psql_db postgres -qc "alter role $renamed_anon_role rename to anon" \
      >/dev/null 2>&1 || original_status=1
    renamed_anon_role=''
  fi
  for db in "${clone_dbs[@]}"; do
    psql_db postgres -qc "drop database if exists $db with (force)" >/dev/null 2>&1 || true
  done
  rm -rf "$tmp_dir"
  trap - EXIT
  exit "$original_status"
}
trap cleanup EXIT

wait_for_backend() {
  local app=$1 predicate=$2 label=$3 pid=$4 deadline=$((SECONDS+wait_seconds))
  while (( SECONDS < deadline )); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "FAIL: $label exited early" >&2
      sed -E 's/(token|password|secret)([^[:space:]]*)/<REDACTED>/Ig' \
        "$tmp_dir/$app.err" >&2 || true
      return 1
    fi
    if [[ "$(psql_db "$database" -Atqc "select exists(select 1
      from pg_stat_activity a where a.application_name='$app' and ($predicate))" \
      | tr -d '\r')" == t ]]; then return; fi
    sleep 0.1
  done
  echo "FAIL: timed out waiting for $label" >&2
  psql_db "$database" -c "select pid,application_name,state,wait_event_type,wait_event,
    pg_blocking_pids(pid) from pg_stat_activity
    where application_name like '${app_prefix}\_%' escape '\\'" >&2 || true
  return 1
}

wait_success() {
  local pid=$1 label=$2
  if ! wait "$pid"; then
    echo "FAIL: $label" >&2
    return 1
  fi
}

backend_pid() {
  local app=$1
  psql_db "$database" -Atqc "select pid from pg_stat_activity
    where application_name='$app' order by pid limit 1" | tr -d '\r'
}

start_barrier() {
  active_barrier_app=$1
  local lock_key=$2 label=$3
  psql_app "$owner_role" "$active_barrier_app" \
    -c "select pg_advisory_lock($lock_key);select pg_sleep(50)" \
    >"$tmp_dir/$active_barrier_app.out" 2>"$tmp_dir/$active_barrier_app.err" &
  active_barrier_pid=$!
  background_pids+=("$active_barrier_pid")
  wait_for_backend "$active_barrier_app" \
    "wait_event_type='Timeout' and wait_event='PgSleep'" "$label" "$active_barrier_pid"
}

release_barrier() {
  psql_db "$database" -Atqc "select pg_terminate_backend(pid)
    from pg_stat_activity where application_name='$active_barrier_app'" >/dev/null
  set +e
  wait "$active_barrier_pid"
  set -e
}

assert_false_output() {
  local file=$1 label=$2
  [[ "$(tr -d '[:space:]' <"$file")" == f ]] || {
    echo "FAIL: $label" >&2
    exit 1
  }
}

expect_failure() {
  local expected=$1 label=$2
  shift 2
  set +e
  "$@" >"$tmp_dir/$label.out" 2>"$tmp_dir/$label.err"
  local status=$?
  set -e
  if [[ $status -eq 0 ]] || ! grep -Fq "$expected" "$tmp_dir/$label.err"; then
    echo "FAIL: expected $label to fail with $expected" >&2
    sed -E 's/(token|password|secret)([^[:space:]]*)/<REDACTED>/Ig' \
      "$tmp_dir/$label.err" >&2
    exit 1
  fi
}

assert_query() {
  local query=$1 label=$2
  [[ "$(psql_db "$database" -Atqc "$query" | tr -d '\r')" == t ]] || {
    echo "FAIL: $label" >&2
    exit 1
  }
}

assert_no_targets() {
  local db=$1 label=$2
  [[ "$(psql_db "$db" -Atqc "select not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'runtime_%every8d_settings%challenge%_v1'
       or n.nspname='public' and p.proname in (
         'request_every8d_settings_enrollment_challenge_core_v2',
         'request_every8d_settings_login_challenge_core_v2',
         'verify_every8d_settings_challenge_core_v2'))" | tr -d '\r')" == t ]] || {
    echo "FAIL: $label" >&2
    exit 1
  }
}

assert_targets_intact() {
  local db=$1 label=$2
  [[ "$(psql_db "$db" -Atqc "select
    (select count(*)=8 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in (
        'runtime_request_every8d_settings_enrollment_challenge_v1',
        'runtime_request_every8d_settings_login_challenge_v1',
        'runtime_record_every8d_settings_challenge_delivery_v1',
        'runtime_discover_every8d_settings_challenge_v1',
        'runtime_verify_every8d_settings_challenge_v1',
        'request_every8d_settings_enrollment_challenge_core_v2',
        'request_every8d_settings_login_challenge_core_v2',
        'verify_every8d_settings_challenge_core_v2'))
    and (select count(*)=5 from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where n.nspname='public'
        and p.proname in (
          'runtime_request_every8d_settings_enrollment_challenge_v1',
          'runtime_request_every8d_settings_login_challenge_v1',
          'runtime_record_every8d_settings_challenge_delivery_v1',
          'runtime_discover_every8d_settings_challenge_v1',
          'runtime_verify_every8d_settings_challenge_v1')
        and acl.grantee=('service_role'::regrole)::oid
        and acl.privilege_type='EXECUTE')
    and not exists(select 1 from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where n.nspname='public'
        and p.proname in (
          'request_every8d_settings_enrollment_challenge_core_v2',
          'request_every8d_settings_login_challenge_core_v2',
          'verify_every8d_settings_challenge_core_v2')
        and acl.grantee=('service_role'::regrole)::oid
        and acl.privilege_type='EXECUTE')" | tr -d '\r')" == t ]] || {
    echo "FAIL: $label" >&2
    exit 1
  }
}

clone_database() {
  local suffix=$1
  cloned_db="${clone_prefix}_${suffix}"
  clone_dbs+=("$cloned_db")
  psql_db postgres -qc "create database $cloned_db template $database"
}

# Fail-closed preflight matrix. Each disposable clone starts at the proven C3b-1 state.
non_utf8_db="${clone_prefix}_non_utf8"
clone_dbs+=("$non_utf8_db")
psql_db postgres -qc "create database $non_utf8_db template template0
  encoding 'SQL_ASCII' lc_collate 'C' lc_ctype 'C'"
timeout --signal=TERM 60s docker exec "$POSTGRES_CONTAINER_ID" \
  pg_dump -U postgres --schema-only --clean --if-exists "$database" \
  | timeout --signal=TERM 60s docker exec -i "$POSTGRES_CONTAINER_ID" \
    psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$non_utf8_db" \
    >/dev/null
expect_failure 'C3b-3 migration requires UTF8 database encoding' non_utf8 \
  psql_owner_db "$non_utf8_db" <"$migration"
assert_no_targets "$non_utf8_db" 'non-UTF8 database leaves no C3b-3 target'

clone_database missing_relation
psql_db "$cloned_db" -qc \
  "drop table public.ghl_marketplace_app_version_registrations cascade"
expect_failure 'C3b-3 migration requires all frozen relations' missing_relation \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'missing relation leaves no C3b-3 target'

clone_database wrong_owner
psql_db "$cloned_db" -qc \
  "alter table public.ghl_marketplace_app_registrations owner to postgres"
expect_failure 'C3b-3 migration requires trusted common ownership' wrong_owner \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'wrong owner leaves no C3b-3 target'

clone_database missing_role
renamed_anon_role="c3b3_missing_anon_${run_id}"
psql_db postgres -qc "alter role anon rename to $renamed_anon_role"
expect_failure 'C3b-3 migration requires application roles' missing_role \
  psql_owner_db "$cloned_db" <"$migration"
psql_db postgres -qc "alter role $renamed_anon_role rename to anon"
renamed_anon_role=''
assert_no_targets "$cloned_db" 'missing application role leaves no C3b-3 target'

clone_database wrong_function
psql_db "$cloned_db" -qc \
  "alter function public.is_every8d_settings_canonical_email_v1(text) set search_path=public"
expect_failure 'C3b-3 migration dependency function contract mismatch' wrong_function \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'wrong helper contract leaves no C3b-3 target'

clone_database wrong_security
psql_db "$cloned_db" -qc \
  "alter function public.is_every8d_settings_canonical_email_v1(text) security definer"
expect_failure 'C3b-3 migration dependency function contract mismatch' wrong_security \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'wrong helper security leaves no C3b-3 target'

clone_database missing_function
psql_db "$cloned_db" -qc \
  "drop function public.every8d_settings_email_lock_word_v1(text)"
expect_failure 'C3b-3 migration dependency function contract mismatch' missing_function \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'missing helper leaves no C3b-3 target'

clone_database disabled_trigger
psql_db "$cloned_db" -qc \
  "alter table public.every8d_settings_auth_challenges disable trigger protect_every8d_settings_auth_challenge"
expect_failure 'C3b-3 migration trigger contract mismatch' disabled_trigger \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'disabled trigger leaves no C3b-3 target'

clone_database missing_trigger
psql_db "$cloned_db" -qc \
  "drop trigger protect_every8d_settings_auth_challenge on public.every8d_settings_auth_challenges"
expect_failure 'C3b-3 migration trigger contract mismatch' missing_trigger \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'missing trigger leaves no C3b-3 target'

clone_database wrong_trigger_timing
psql_db "$cloned_db" -qc "drop trigger protect_every8d_settings_auth_challenge
  on public.every8d_settings_auth_challenges;
  create trigger protect_every8d_settings_auth_challenge
  after insert or update or delete on public.every8d_settings_auth_challenges
  for each row execute function public.protect_every8d_settings_auth_challenge_v1()"
expect_failure 'C3b-3 migration trigger contract mismatch' wrong_trigger_timing \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'wrong trigger timing leaves no C3b-3 target'

clone_database wrong_trigger_events
psql_db "$cloned_db" -qc "drop trigger protect_every8d_settings_auth_challenge
  on public.every8d_settings_auth_challenges;
  create trigger protect_every8d_settings_auth_challenge
  before insert on public.every8d_settings_auth_challenges
  for each row execute function public.protect_every8d_settings_auth_challenge_v1()"
expect_failure 'C3b-3 migration trigger contract mismatch' wrong_trigger_events \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'wrong trigger events leave no C3b-3 target'

clone_database wrong_trigger_level
psql_db "$cloned_db" -qc "drop trigger protect_every8d_settings_auth_challenge
  on public.every8d_settings_auth_challenges;
  create trigger protect_every8d_settings_auth_challenge
  before insert or update or delete on public.every8d_settings_auth_challenges
  for each statement execute function public.protect_every8d_settings_auth_challenge_v1()"
expect_failure 'C3b-3 migration trigger contract mismatch' wrong_trigger_level \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'ROW-to-STATEMENT mismatch leaves no C3b-3 target'

clone_database wrong_trigger_deferrability
psql_db "$cloned_db" -qc "drop trigger assert_every8d_settings_challenge_row_integrity
  on public.every8d_settings_auth_challenges;
  create constraint trigger assert_every8d_settings_challenge_row_integrity
  after insert or update or delete on public.every8d_settings_auth_challenges
  for each row execute function public.assert_every8d_settings_challenge_integrity_v1()"
expect_failure 'C3b-3 migration trigger contract mismatch' wrong_trigger_deferrability \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'DEFERRABLE mismatch leaves no C3b-3 target'

clone_database wrong_constraint_identity
psql_db "$cloned_db" -qc "drop trigger assert_every8d_settings_challenge_row_integrity
  on public.every8d_settings_auth_challenges;
  create trigger assert_every8d_settings_challenge_row_integrity
  after insert or update or delete on public.every8d_settings_auth_challenges
  for each row execute function public.assert_every8d_settings_challenge_integrity_v1()"
expect_failure 'C3b-3 migration trigger contract mismatch' wrong_constraint_identity \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'ordinary replacement for constraint trigger leaves no target'

clone_database disabled_rls
psql_db "$cloned_db" -qc \
  "alter table public.every8d_settings_auth_challenges disable row level security"
expect_failure 'C3b-3 migration requires frozen RLS state' disabled_rls \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'disabled RLS leaves no C3b-3 target'

clone_database widened_table
psql_db "$cloned_db" -qc \
  "grant select on public.every8d_settings_auth_challenges to service_role"
expect_failure 'C3b-3 migration refuses widened table privileges' widened_table \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'widened table ACL leaves no C3b-3 target'

clone_database widened_column
psql_db "$cloned_db" -qc \
  "grant select(normalized_email) on public.every8d_settings_auth_challenges to service_role"
expect_failure 'C3b-3 migration refuses widened table privileges' widened_column \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'widened column ACL leaves no C3b-3 target'

clone_database widened_function
psql_db "$cloned_db" -qc \
  "grant execute on function public.record_every8d_settings_challenge_delivery_v1(bytea,boolean,text) to service_role"
expect_failure 'C3b-3 migration refuses widened owner-function execute' widened_function \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'widened function ACL leaves no C3b-3 target'

clone_database unexpected_policy
psql_db "$cloned_db" -qc \
  "create policy c3b3_forbidden_policy on public.every8d_settings_auth_challenges for select to service_role using (true)"
expect_failure 'C3b-3 migration requires frozen RLS state' unexpected_policy \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'unexpected policy leaves no C3b-3 target'

clone_database public_create
psql_db "$cloned_db" -qc "grant create on schema public to service_role"
expect_failure 'C3b-3 migration refuses untrusted CREATE privilege on public' public_create \
  psql_owner_db "$cloned_db" <"$migration"
assert_no_targets "$cloned_db" 'untrusted schema CREATE leaves no C3b-3 target'

clone_database target_conflict
psql_owner_db "$cloned_db" -qc \
  "create function public.runtime_verify_every8d_settings_challenge_v1() returns boolean language sql as 'select false'"
expect_failure 'C3b-3 migration target function conflict' target_conflict \
  psql_owner_db "$cloned_db" <"$migration"

# Apply exactly once, prove refusal on reapplication, then execute behavior/ACL proof.
psql_owner_db "$database" <"$migration" >/dev/null
expect_failure 'C3b-3 migration target function conflict' reapplication \
  psql_owner_db "$database" <"$migration"
psql_db "$database" <"$proof" >"$tmp_dir/proof.out"

# Commit a real runtime-created PENDING_DELIVERY challenge, prove that the
# undelivered row cannot verify, then cross the frozen 60-second resend boundary
# before making the only explicit superseding request. Separate psql processes
# make the commit boundary observable; no delivery bridge or provider transition
# is invoked for either challenge.
orphan_first_app="${app_prefix}_orphan_first"
psql_app service_role "$orphan_first_app" -Atqc "select count(*)=1 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b311000-0000-4000-8000-000000000001','orphan-explicit@example.com',
    'k1:'||repeat('a',63)||'1',array['k1:'||repeat('a',63)||'1'],
    decode(repeat('b4',32),'hex'),decode(repeat('b5',32),'hex'),'otp-v1')" \
  >"$tmp_dir/$orphan_first_app.out"
[[ "$(tr -d '[:space:]' <"$tmp_dir/$orphan_first_app.out")" == t ]] || {
  echo 'FAIL: runtime request did not commit the pending-delivery orphan' >&2
  exit 1
}
assert_query "select delivery_succeeded_at is null and delivery_failed_at is null
    and superseded_at is null and verified_at is null
  from public.every8d_settings_auth_challenges
  where id='7b311000-0000-4000-8000-000000000001'" \
  'runtime-created orphan is committed and remains pending delivery'
orphan_verify_app="${app_prefix}_orphan_verify"
psql_app service_role "$orphan_verify_app" -Atqc "select
  public.runtime_verify_every8d_settings_challenge_v1(
    decode(repeat('b4',32),'hex'),'login',array['k1:'||repeat('a',63)||'1'],
    decode(repeat('b5',32),'hex'))" >"$tmp_dir/$orphan_verify_app.out"
assert_false_output "$tmp_dir/$orphan_verify_app.out" \
  'pending-delivery orphan incorrectly verified'
sleep 30
sleep 31

# The same bounded wait crosses the frozen resend boundary for matched
# enrollment requests created through the actual v1 and v2 paths in the proof
# transaction. Invoke both paths again and compare the authoritative results.
parity_enroll_v1_resend_app="${app_prefix}_parity_enroll_v1_resend"
psql_owner_db "$database" -Atqc "select count(*)=1 from
  public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants
      where token_hash=decode(lpad(to_hex(2201),64,'0'),'hex')),
    'parity-enroll-resend-v1@example.com','k1:'||repeat('c',63)||'3',
    array['k1:'||repeat('c',63)||'3'],decode(lpad(to_hex(2221),64,'0'),'hex'),
    decode(lpad(to_hex(2222),64,'0'),'hex'),'otp-v1')" \
  >"$tmp_dir/$parity_enroll_v1_resend_app.out"
[[ "$(tr -d '[:space:]' <"$tmp_dir/$parity_enroll_v1_resend_app.out")" == t ]] || {
  echo 'FAIL: v1 enrollment resend did not prepare exactly one row' >&2
  exit 1
}
parity_enroll_v2_resend_app="${app_prefix}_parity_enroll_v2_resend"
psql_app service_role "$parity_enroll_v2_resend_app" -Atqc "select count(*)=1 from
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2202),64,'0'),'hex'),
    '7b306300-0000-4000-8000-000000000002',
    'parity-enroll-resend-v2@example.com','k1:'||repeat('d',63)||'4',
    array['k1:'||repeat('d',63)||'4'],decode(lpad(to_hex(2223),64,'0'),'hex'),
    decode(lpad(to_hex(2224),64,'0'),'hex'),'otp-v1')" \
  >"$tmp_dir/$parity_enroll_v2_resend_app.out"
[[ "$(tr -d '[:space:]' <"$tmp_dir/$parity_enroll_v2_resend_app.out")" == t ]] || {
  echo 'FAIL: v2 enrollment resend did not prepare exactly one row' >&2
  exit 1
}
assert_query "select
    (select count(*)=2 and bool_and(superseded_at is not null
      and supersession_reason='resend' and normalized_email is null
      and email_scrubbed_at=superseded_at and delivery_succeeded_at is null
      and delivery_failed_at is null)
     from public.every8d_settings_auth_challenges
     where request_token_hash in (
       decode(lpad(to_hex(2211),64,'0'),'hex'),
       decode(lpad(to_hex(2213),64,'0'),'hex')))
    and
    (select count(*)=2 and bool_and(purpose='enrollment'
      and superseded_at is null and delivery_succeeded_at is null
      and delivery_failed_at is null
      and expires_at=least(created_at+interval '10 minutes',g.expires_at))
     from public.every8d_settings_auth_challenges c
     join public.every8d_settings_enrollment_grants g on g.id=c.enrollment_grant_id
     where c.request_token_hash in (
       decode(lpad(to_hex(2221),64,'0'),'hex'),
       decode(lpad(to_hex(2223),64,'0'),'hex')))" \
  'v1/v2 enrollment resends preserve supersession, scrub, insertion, and expiry semantics'
psql_owner_db "$database" -q <<'SQL'
do $$
begin
  perform 1 from public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants
      where token_hash=decode(lpad(to_hex(2201),64,'0'),'hex')),
    'parity-enroll-resend-v1@example.com','k1:'||repeat('c',63)||'3',
    array['k1:'||repeat('c',63)||'3'],decode(lpad(to_hex(2231),64,'0'),'hex'),
    decode(lpad(to_hex(2232),64,'0'),'hex'),'otp-v1');
  raise exception 'v1 enrollment resend unexpectedly bypassed the rate limit'
    using errcode='23514';
exception when sqlstate 'P0001' then
  null;
end;
$$;
SQL
assert_query "select count(*)=0 from
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(2202),64,'0'),'hex'),
    '7b306300-0000-4000-8000-000000000003',
    'parity-enroll-resend-v2@example.com','k1:'||repeat('d',63)||'4',
    array['k1:'||repeat('d',63)||'4'],decode(lpad(to_hex(2233),64,'0'),'hex'),
    decode(lpad(to_hex(2234),64,'0'),'hex'),'otp-v1')" \
  'v2 enrollment resend maps the matching immediate rate decision to zero rows'

orphan_second_app="${app_prefix}_orphan_second"
psql_app service_role "$orphan_second_app" -Atqc "select count(*)=1 from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b311000-0000-4000-8000-000000000002','orphan-explicit@example.com',
    'k1:'||repeat('a',63)||'1',array['k1:'||repeat('a',63)||'1'],
    decode(repeat('b6',32),'hex'),decode(repeat('b7',32),'hex'),'otp-v1')" \
  >"$tmp_dir/$orphan_second_app.out"
[[ "$(tr -d '[:space:]' <"$tmp_dir/$orphan_second_app.out")" == t ]] || {
  echo 'FAIL: explicit request did not supersede the pending-delivery orphan' >&2
  exit 1
}
assert_query "select
    (select superseded_at is not null and supersession_reason='resend'
      and delivery_succeeded_at is null and delivery_failed_at is null
      and normalized_email is null
     from public.every8d_settings_auth_challenges
     where id='7b311000-0000-4000-8000-000000000001')
    and
    (select delivery_succeeded_at is null and delivery_failed_at is null
      and superseded_at is null and verified_at is null
     from public.every8d_settings_auth_challenges
     where id='7b311000-0000-4000-8000-000000000002')" \
  'later explicit request supersedes the orphan without an automatic transition'

# Matched enrollment request/request parity. Both real v1 and runtime/v2 first
# actors hold their transactions after insertion; paired requests use distinct
# grants but the same alias and are observed blocked on advisory serialization.
start_barrier "${app_prefix}_enroll_pair_barrier" 993320 \
  'matched enrollment request/request barrier'
v1_first_app="${app_prefix}_enroll_v1_first"
v2_first_app="${app_prefix}_enroll_v2_first"
psql_app "$owner_role" "$v1_first_app" -Atq <<'SQL' \
  >"$tmp_dir/$v1_first_app.out" 2>"$tmp_dir/$v1_first_app.err" &
begin;
select * from public.request_every8d_settings_enrollment_challenge_v1(
  (select id from public.every8d_settings_enrollment_grants
    where token_hash=decode(lpad(to_hex(3301),64,'0'),'hex')),
  'parity-concurrency-3301@example.com','k1:'||lpad(to_hex(3301),64,'0'),
  array['k1:'||lpad(to_hex(3301),64,'0')],decode(lpad(to_hex(3401),64,'0'),'hex'),
  decode(lpad(to_hex(3501),64,'0'),'hex'),'otp-v1');
select pg_advisory_xact_lock(993320);
commit;
SQL
v1_first_pid=$!; background_pids+=("$v1_first_pid")
psql_app service_role "$v2_first_app" -Atq <<'SQL' \
  >"$tmp_dir/$v2_first_app.out" 2>"$tmp_dir/$v2_first_app.err" &
begin;
select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
  decode(lpad(to_hex(3302),64,'0'),'hex'),'7b3b0000-0000-4000-8000-000000000001',
  'parity-concurrency-3302@example.com','k1:'||lpad(to_hex(3302),64,'0'),
  array['k1:'||lpad(to_hex(3302),64,'0')],decode(lpad(to_hex(3402),64,'0'),'hex'),
  decode(lpad(to_hex(3502),64,'0'),'hex'),'otp-v1');
select pg_advisory_xact_lock(993320);
commit;
SQL
v2_first_pid=$!; background_pids+=("$v2_first_pid")
wait_for_backend "$v1_first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'v1 enrollment first actor holding authority' "$v1_first_pid"
wait_for_backend "$v2_first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'v2 enrollment first actor holding authority' "$v2_first_pid"
v1_first_backend=$(backend_pid "$v1_first_app")
v2_first_backend=$(backend_pid "$v2_first_app")
v1_second_app="${app_prefix}_enroll_v1_second"
v2_second_app="${app_prefix}_enroll_v2_second"
psql_app "$owner_role" "$v1_second_app" -Atq <<'SQL' \
  >"$tmp_dir/$v1_second_app.out" 2>"$tmp_dir/$v1_second_app.err" &
do $$
declare rejected boolean := false;
begin
  begin
    perform 1 from public.request_every8d_settings_enrollment_challenge_v1(
      (select id from public.every8d_settings_enrollment_grants
        where token_hash=decode(lpad(to_hex(3311),64,'0'),'hex')),
      'parity-concurrency-3311@example.com','k1:'||lpad(to_hex(3301),64,'0'),
      array['k1:'||lpad(to_hex(3301),64,'0')],decode(lpad(to_hex(3403),64,'0'),'hex'),
      decode(lpad(to_hex(3503),64,'0'),'hex'),'otp-v1');
  exception when sqlstate 'P0001' then rejected := true;
  end;
  if not rejected then raise exception 'v1 concurrent request was not rejected'; end if;
end;
$$;
select 'rejected';
SQL
v1_second_pid=$!; background_pids+=("$v1_second_pid")
psql_app service_role "$v2_second_app" -Atqc "select count(*) from
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(3312),64,'0'),'hex'),'7b3b0000-0000-4000-8000-000000000002',
    'parity-concurrency-3312@example.com','k1:'||lpad(to_hex(3302),64,'0'),
    array['k1:'||lpad(to_hex(3302),64,'0')],decode(lpad(to_hex(3404),64,'0'),'hex'),
    decode(lpad(to_hex(3504),64,'0'),'hex'),'otp-v1')" \
  >"$tmp_dir/$v2_second_app.out" 2>"$tmp_dir/$v2_second_app.err" &
v2_second_pid=$!; background_pids+=("$v2_second_pid")
wait_for_backend "$v1_second_app" "wait_event_type='Lock'
  and $v1_first_backend=any(pg_blocking_pids(pid))" \
  'v1 enrollment second request serialized' "$v1_second_pid"
wait_for_backend "$v2_second_app" "wait_event_type='Lock'
  and $v2_first_backend=any(pg_blocking_pids(pid))" \
  'v2 enrollment second request serialized' "$v2_second_pid"
release_barrier
wait_success "$v1_first_pid" 'v1 first enrollment request failed'
wait_success "$v2_first_pid" 'v2 first enrollment request failed'
wait_success "$v1_second_pid" 'v1 second enrollment request failed'
wait_success "$v2_second_pid" 'v2 second enrollment request failed'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$v1_second_app.out")" == rejected ]]
[[ "$(tr -d '[:space:]' <"$tmp_dir/$v2_second_app.out")" == 0 ]]
assert_query "select count(*)=2 and bool_and(request_token_hash in (
    decode(lpad(to_hex(3401),64,'0'),'hex'),decode(lpad(to_hex(3402),64,'0'),'hex')))
  from public.every8d_settings_auth_challenges
  where enrollment_grant_id in (select id from public.every8d_settings_enrollment_grants
    where token_hash in (decode(lpad(to_hex(3301),64,'0'),'hex'),
      decode(lpad(to_hex(3302),64,'0'),'hex')))" \
  'matched v1/v2 enrollment request races each create one authoritative row'

# Grant mutations win first for matched revocation and consumption fixtures.
# Each request backend must wait, then v1 rejects and runtime/v2 returns zero.
start_barrier "${app_prefix}_enroll_mutation_barrier" 993321 \
  'matched enrollment mutation-wins barrier'
declare -a mutation_first_apps=() mutation_first_pids=() mutation_first_backends=()
for token_n in 3303 3304; do
  app="${app_prefix}_revoke_first_${token_n}"
  psql_app "$owner_role" "$app" -Atq <<SQL \
    >"$tmp_dir/$app.out" 2>"$tmp_dir/$app.err" &
begin;
update public.every8d_settings_enrollment_grants
set revoked_at=clock_timestamp(),revocation_reason='c3b3_parity'
where token_hash=decode(lpad(to_hex($token_n),64,'0'),'hex');
select pg_advisory_xact_lock(993321);
commit;
SQL
  mutation_first_apps+=("$app"); mutation_first_pids+=("$!"); background_pids+=("$!")
done
for token_n in 3305 3306; do
  app="${app_prefix}_consume_first_${token_n}"
  psql_app "$owner_role" "$app" -Atq <<SQL \
    >"$tmp_dir/$app.out" 2>"$tmp_dir/$app.err" &
begin;
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(lpad(to_hex($token_n),64,'0'),'hex'),
  'parity-concurrency-$token_n@example.com','k1:'||lpad(to_hex($token_n),64,'0'));
select pg_advisory_xact_lock(993321);
commit;
SQL
  mutation_first_apps+=("$app"); mutation_first_pids+=("$!"); background_pids+=("$!")
done
for i in "${!mutation_first_apps[@]}"; do
  wait_for_backend "${mutation_first_apps[$i]}" \
    "wait_event_type='Lock' and wait_event='advisory'" \
    'grant mutation holding enrollment authority' "${mutation_first_pids[$i]}"
  mutation_first_backends+=("$(backend_pid "${mutation_first_apps[$i]}")")
done
declare -a mutation_second_apps=() mutation_second_pids=()
for token_n in 3303 3305; do
  app="${app_prefix}_v1_after_mutation_${token_n}"
  psql_app "$owner_role" "$app" -Atq <<SQL \
    >"$tmp_dir/$app.out" 2>"$tmp_dir/$app.err" &
do \$\$
declare rejected boolean := false;
begin
  begin
    perform 1 from public.request_every8d_settings_enrollment_challenge_v1(
      (select id from public.every8d_settings_enrollment_grants
        where token_hash=decode(lpad(to_hex($token_n),64,'0'),'hex')),
      'parity-concurrency-$token_n@example.com','k1:'||lpad(to_hex($token_n),64,'0'),
      array['k1:'||lpad(to_hex($token_n),64,'0')],
      decode(lpad(to_hex(360000+$token_n),64,'0'),'hex'),
      decode(lpad(to_hex(370000+$token_n),64,'0'),'hex'),'otp-v1');
  exception when sqlstate '23514' then rejected := true;
  end;
  if not rejected then raise exception 'v1 mutation-wins request was not rejected'; end if;
end;
\$\$;
select 'rejected';
SQL
  mutation_second_apps+=("$app"); mutation_second_pids+=("$!"); background_pids+=("$!")
done
for token_n in 3304 3306; do
  app="${app_prefix}_v2_after_mutation_${token_n}"
  psql_app service_role "$app" -Atqc "select count(*) from
    public.runtime_request_every8d_settings_enrollment_challenge_v1(
      decode(lpad(to_hex($token_n),64,'0'),'hex'),
      ('7b3b1000-0000-4000-8000-'||lpad('$token_n',12,'0'))::uuid,
      'parity-concurrency-$token_n@example.com','k1:'||lpad(to_hex($token_n),64,'0'),
      array['k1:'||lpad(to_hex($token_n),64,'0')],
      decode(lpad(to_hex(360000+$token_n),64,'0'),'hex'),
      decode(lpad(to_hex(370000+$token_n),64,'0'),'hex'),'otp-v1')" \
    >"$tmp_dir/$app.out" 2>"$tmp_dir/$app.err" &
  mutation_second_apps+=("$app"); mutation_second_pids+=("$!"); background_pids+=("$!")
done
mutation_blocker_indices=(0 2 1 3)
for i in "${!mutation_second_apps[@]}"; do
  blocker_index=${mutation_blocker_indices[$i]}
  wait_for_backend "${mutation_second_apps[$i]}" "wait_event_type='Lock'
    and ${mutation_first_backends[$blocker_index]}=any(pg_blocking_pids(pid))" \
    'request serialized behind grant mutation' "${mutation_second_pids[$i]}"
done
release_barrier
for pid in "${mutation_first_pids[@]}"; do wait_success "$pid" 'grant mutation actor failed'; done
for i in "${!mutation_second_pids[@]}"; do
  wait_success "${mutation_second_pids[$i]}" 'request after grant mutation failed'
  output=$(tr -d '[:space:]' <"$tmp_dir/${mutation_second_apps[$i]}.out")
  [[ "$output" == rejected || "$output" == 0 ]]
done
assert_query "select count(*)=0 from public.every8d_settings_auth_challenges
  where enrollment_grant_id in (select id from public.every8d_settings_enrollment_grants
    where token_hash in (decode(lpad(to_hex(3303),64,'0'),'hex'),
      decode(lpad(to_hex(3304),64,'0'),'hex'),decode(lpad(to_hex(3305),64,'0'),'hex'),
      decode(lpad(to_hex(3306),64,'0'),'hex')))" \
  'matched mutation-wins races create no v1 or v2 enrollment challenge'

# Requests win first for matched revocation and consumption fixtures. The later
# mutation actors are observed waiting; after commit both versions retain the
# same linearized creation followed by the same grant invalidation transition.
start_barrier "${app_prefix}_enroll_request_wins_barrier" 993322 \
  'matched enrollment request-wins barrier'
declare -a request_first_apps=() request_first_pids=() request_first_backends=()
for token_n in 3307 3309; do
  app="${app_prefix}_v1_request_first_${token_n}"
  psql_app "$owner_role" "$app" -Atq <<SQL \
    >"$tmp_dir/$app.out" 2>"$tmp_dir/$app.err" &
begin;
select * from public.request_every8d_settings_enrollment_challenge_v1(
  (select id from public.every8d_settings_enrollment_grants
    where token_hash=decode(lpad(to_hex($token_n),64,'0'),'hex')),
  'parity-concurrency-$token_n@example.com','k1:'||lpad(to_hex($token_n),64,'0'),
  array['k1:'||lpad(to_hex($token_n),64,'0')],
  decode(lpad(to_hex(380000+$token_n),64,'0'),'hex'),
  decode(lpad(to_hex(390000+$token_n),64,'0'),'hex'),'otp-v1');
select pg_advisory_xact_lock(993322);
commit;
SQL
  request_first_apps+=("$app"); request_first_pids+=("$!"); background_pids+=("$!")
done
for token_n in 3308 3310; do
  app="${app_prefix}_v2_request_first_${token_n}"
  psql_app service_role "$app" -Atq <<SQL \
    >"$tmp_dir/$app.out" 2>"$tmp_dir/$app.err" &
begin;
select * from public.runtime_request_every8d_settings_enrollment_challenge_v1(
  decode(lpad(to_hex($token_n),64,'0'),'hex'),
  ('7b3b2000-0000-4000-8000-'||lpad('$token_n',12,'0'))::uuid,
  'parity-concurrency-$token_n@example.com','k1:'||lpad(to_hex($token_n),64,'0'),
  array['k1:'||lpad(to_hex($token_n),64,'0')],
  decode(lpad(to_hex(380000+$token_n),64,'0'),'hex'),
  decode(lpad(to_hex(390000+$token_n),64,'0'),'hex'),'otp-v1');
select pg_advisory_xact_lock(993322);
commit;
SQL
  request_first_apps+=("$app"); request_first_pids+=("$!"); background_pids+=("$!")
done
for i in "${!request_first_apps[@]}"; do
  wait_for_backend "${request_first_apps[$i]}" \
    "wait_event_type='Lock' and wait_event='advisory'" \
    'request holding grant authority before mutation' "${request_first_pids[$i]}"
  request_first_backends+=("$(backend_pid "${request_first_apps[$i]}")")
done
declare -a request_second_apps=() request_second_pids=()
for token_n in 3307 3308; do
  app="${app_prefix}_revoke_after_request_${token_n}"
  psql_app "$owner_role" "$app" -Atqc "update public.every8d_settings_enrollment_grants
    set revoked_at=clock_timestamp(),revocation_reason='c3b3_parity'
    where token_hash=decode(lpad(to_hex($token_n),64,'0'),'hex')" \
    >"$tmp_dir/$app.out" 2>"$tmp_dir/$app.err" &
  request_second_apps+=("$app"); request_second_pids+=("$!"); background_pids+=("$!")
done
for token_n in 3309 3310; do
  app="${app_prefix}_consume_after_request_${token_n}"
  psql_app "$owner_role" "$app" -Atqc "select administrator_id from
    public.redeem_every8d_settings_enrollment_grant_v1(
      decode(lpad(to_hex($token_n),64,'0'),'hex'),
      'parity-concurrency-$token_n@example.com','k1:'||lpad(to_hex($token_n),64,'0'))" \
    >"$tmp_dir/$app.out" 2>"$tmp_dir/$app.err" &
  request_second_apps+=("$app"); request_second_pids+=("$!"); background_pids+=("$!")
done
request_blocker_indices=(0 2 1 3)
for i in "${!request_second_apps[@]}"; do
  blocker_index=${request_blocker_indices[$i]}
  wait_for_backend "${request_second_apps[$i]}" "wait_event_type='Lock'
    and ${request_first_backends[$blocker_index]}=any(pg_blocking_pids(pid))" \
    'grant mutation serialized behind request' "${request_second_pids[$i]}"
done
release_barrier
for pid in "${request_first_pids[@]}"; do wait_success "$pid" 'request-wins actor failed'; done
for pid in "${request_second_pids[@]}"; do wait_success "$pid" 'post-request mutation actor failed'; done
assert_query "select count(*)=4
    and count(*) filter (where supersession_reason='grant_revoked')=2
    and count(*) filter (where supersession_reason='grant_consumed')=2
    and bool_and(superseded_at is not null and normalized_email is null
      and email_scrubbed_at=superseded_at)
  from public.every8d_settings_auth_challenges
  where enrollment_grant_id in (select id from public.every8d_settings_enrollment_grants
    where token_hash in (decode(lpad(to_hex(3307),64,'0'),'hex'),
      decode(lpad(to_hex(3308),64,'0'),'hex'),decode(lpad(to_hex(3309),64,'0'),'hex'),
      decode(lpad(to_hex(3310),64,'0'),'hex')))" \
  'matched request-wins races preserve v1/v2 creation and invalidation semantics'

# C06a: delivery wins before resend. Both delivery authorities hold the real
# pending challenge row; paired v1/runtime requests are observed waiting on
# those backends, then supersede the delivered rows after delivery commits.
start_barrier "${app_prefix}_delivery_first_barrier" 993323 \
  'matched delivery-first resend barrier'
v1_delivery_app="${app_prefix}_v1_delivery_first"
v2_delivery_app="${app_prefix}_v2_delivery_first"
psql_app "$owner_role" "$v1_delivery_app" -Atq <<'SQL' \
  >"$tmp_dir/$v1_delivery_app.out" 2>"$tmp_dir/$v1_delivery_app.err" &
begin;
select public.record_every8d_settings_challenge_delivery_v1(
  decode(lpad(to_hex(3421),64,'0'),'hex'),true,null);
select pg_advisory_xact_lock(993323);
commit;
SQL
v1_delivery_pid=$!; background_pids+=("$v1_delivery_pid")
psql_app service_role "$v2_delivery_app" -Atq <<'SQL' \
  >"$tmp_dir/$v2_delivery_app.out" 2>"$tmp_dir/$v2_delivery_app.err" &
begin;
select public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(lpad(to_hex(3422),64,'0'),'hex'),true,null);
select pg_advisory_xact_lock(993323);
commit;
SQL
v2_delivery_pid=$!; background_pids+=("$v2_delivery_pid")
wait_for_backend "$v1_delivery_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'v1 delivery actor holding pending challenge' "$v1_delivery_pid"
wait_for_backend "$v2_delivery_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'v2 delivery actor holding pending challenge' "$v2_delivery_pid"
v1_delivery_backend=$(backend_pid "$v1_delivery_app")
v2_delivery_backend=$(backend_pid "$v2_delivery_app")
v1_resend_app="${app_prefix}_v1_resend_after_delivery"
v2_resend_app="${app_prefix}_v2_resend_after_delivery"
psql_app "$owner_role" "$v1_resend_app" -Atqc "select count(*) from
  public.request_every8d_settings_enrollment_challenge_v1(
    (select id from public.every8d_settings_enrollment_grants
      where token_hash=decode(lpad(to_hex(3321),64,'0'),'hex')),
    'parity-delivery-resend-3321@example.com','k1:'||lpad(to_hex(3321),64,'0'),
    array['k1:'||lpad(to_hex(3321),64,'0')],decode(lpad(to_hex(3425),64,'0'),'hex'),
    decode(lpad(to_hex(3525),64,'0'),'hex'),'otp-v1')" \
  >"$tmp_dir/$v1_resend_app.out" 2>"$tmp_dir/$v1_resend_app.err" &
v1_resend_pid=$!; background_pids+=("$v1_resend_pid")
psql_app service_role "$v2_resend_app" -Atqc "select count(*) from
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(3322),64,'0'),'hex'),
    '7b3b3000-0000-4000-8000-000000000003',
    'parity-delivery-resend-3322@example.com','k1:'||lpad(to_hex(3322),64,'0'),
    array['k1:'||lpad(to_hex(3322),64,'0')],decode(lpad(to_hex(3426),64,'0'),'hex'),
    decode(lpad(to_hex(3526),64,'0'),'hex'),'otp-v1')" \
  >"$tmp_dir/$v2_resend_app.out" 2>"$tmp_dir/$v2_resend_app.err" &
v2_resend_pid=$!; background_pids+=("$v2_resend_pid")
wait_for_backend "$v1_resend_app" "wait_event_type='Lock'
  and $v1_delivery_backend=any(pg_blocking_pids(pid))" \
  'v1 resend serialized behind delivery' "$v1_resend_pid"
wait_for_backend "$v2_resend_app" "wait_event_type='Lock'
  and $v2_delivery_backend=any(pg_blocking_pids(pid))" \
  'v2 resend serialized behind delivery' "$v2_resend_pid"
release_barrier
wait_success "$v1_delivery_pid" 'v1 delivery-first actor failed'
wait_success "$v2_delivery_pid" 'v2 delivery-first actor failed'
wait_success "$v1_resend_pid" 'v1 resend-after-delivery actor failed'
wait_success "$v2_resend_pid" 'v2 resend-after-delivery actor failed'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$v1_delivery_app.out")" == t ]]
[[ "$(tr -d '[:space:]' <"$tmp_dir/$v2_delivery_app.out")" == t ]]
[[ "$(tr -d '[:space:]' <"$tmp_dir/$v1_resend_app.out")" == 1 ]]
[[ "$(tr -d '[:space:]' <"$tmp_dir/$v2_resend_app.out")" == 1 ]]
assert_query "select
  (select count(*)=2 and bool_and(delivery_succeeded_at is not null
      and superseded_at is not null and supersession_reason='resend'
      and normalized_email is null and email_scrubbed_at=superseded_at)
    from public.every8d_settings_auth_challenges
    where request_token_hash in (decode(lpad(to_hex(3421),64,'0'),'hex'),
      decode(lpad(to_hex(3422),64,'0'),'hex')))
  and (select count(*)=2 and bool_and(delivery_succeeded_at is null
      and delivery_failed_at is null and superseded_at is null)
    from public.every8d_settings_auth_challenges
    where request_token_hash in (decode(lpad(to_hex(3425),64,'0'),'hex'),
      decode(lpad(to_hex(3426),64,'0'),'hex')))" \
  'C06 delivery-first outcomes match for v1 and runtime/v2'

# C06b: resend wins before delivery. The request actors hold supersession; the
# legitimate delivery authorities block and then return false without reviving
# either stale challenge.
start_barrier "${app_prefix}_resend_first_barrier" 993324 \
  'matched resend-first delivery barrier'
v1_resend_first_app="${app_prefix}_v1_resend_first"
v2_resend_first_app="${app_prefix}_v2_resend_first"
psql_app "$owner_role" "$v1_resend_first_app" -Atq <<'SQL' \
  >"$tmp_dir/$v1_resend_first_app.out" 2>"$tmp_dir/$v1_resend_first_app.err" &
begin;
select count(*) from public.request_every8d_settings_enrollment_challenge_v1(
  (select id from public.every8d_settings_enrollment_grants
    where token_hash=decode(lpad(to_hex(3323),64,'0'),'hex')),
  'parity-delivery-resend-3323@example.com','k1:'||lpad(to_hex(3323),64,'0'),
  array['k1:'||lpad(to_hex(3323),64,'0')],decode(lpad(to_hex(3427),64,'0'),'hex'),
  decode(lpad(to_hex(3527),64,'0'),'hex'),'otp-v1');
select pg_advisory_xact_lock(993324);
commit;
SQL
v1_resend_first_pid=$!; background_pids+=("$v1_resend_first_pid")
psql_app service_role "$v2_resend_first_app" -Atq <<'SQL' \
  >"$tmp_dir/$v2_resend_first_app.out" 2>"$tmp_dir/$v2_resend_first_app.err" &
begin;
select count(*) from public.runtime_request_every8d_settings_enrollment_challenge_v1(
  decode(lpad(to_hex(3324),64,'0'),'hex'),
  '7b3b3000-0000-4000-8000-000000000004',
  'parity-delivery-resend-3324@example.com','k1:'||lpad(to_hex(3324),64,'0'),
  array['k1:'||lpad(to_hex(3324),64,'0')],decode(lpad(to_hex(3428),64,'0'),'hex'),
  decode(lpad(to_hex(3528),64,'0'),'hex'),'otp-v1');
select pg_advisory_xact_lock(993324);
commit;
SQL
v2_resend_first_pid=$!; background_pids+=("$v2_resend_first_pid")
wait_for_backend "$v1_resend_first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'v1 resend actor holding supersession' "$v1_resend_first_pid"
wait_for_backend "$v2_resend_first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'v2 resend actor holding supersession' "$v2_resend_first_pid"
v1_resend_first_backend=$(backend_pid "$v1_resend_first_app")
v2_resend_first_backend=$(backend_pid "$v2_resend_first_app")
v1_delivery_after_app="${app_prefix}_v1_delivery_after_resend"
v2_delivery_after_app="${app_prefix}_v2_delivery_after_resend"
psql_app "$owner_role" "$v1_delivery_after_app" -Atqc "select
  public.record_every8d_settings_challenge_delivery_v1(
    decode(lpad(to_hex(3423),64,'0'),'hex'),true,null)" \
  >"$tmp_dir/$v1_delivery_after_app.out" 2>"$tmp_dir/$v1_delivery_after_app.err" &
v1_delivery_after_pid=$!; background_pids+=("$v1_delivery_after_pid")
psql_app service_role "$v2_delivery_after_app" -Atqc "select
  public.runtime_record_every8d_settings_challenge_delivery_v1(
    decode(lpad(to_hex(3424),64,'0'),'hex'),true,null)" \
  >"$tmp_dir/$v2_delivery_after_app.out" 2>"$tmp_dir/$v2_delivery_after_app.err" &
v2_delivery_after_pid=$!; background_pids+=("$v2_delivery_after_pid")
wait_for_backend "$v1_delivery_after_app" "wait_event_type='Lock'
  and $v1_resend_first_backend=any(pg_blocking_pids(pid))" \
  'v1 delivery serialized behind resend' "$v1_delivery_after_pid"
wait_for_backend "$v2_delivery_after_app" "wait_event_type='Lock'
  and $v2_resend_first_backend=any(pg_blocking_pids(pid))" \
  'v2 delivery serialized behind resend' "$v2_delivery_after_pid"
release_barrier
wait_success "$v1_resend_first_pid" 'v1 resend-first actor failed'
wait_success "$v2_resend_first_pid" 'v2 resend-first actor failed'
wait_success "$v1_delivery_after_pid" 'v1 delivery-after-resend actor failed'
wait_success "$v2_delivery_after_pid" 'v2 delivery-after-resend actor failed'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$v1_resend_first_app.out")" == 1 ]]
[[ "$(tr -d '[:space:]' <"$tmp_dir/$v2_resend_first_app.out")" == 1 ]]
assert_false_output "$tmp_dir/$v1_delivery_after_app.out" \
  'v1 delivery revived a superseded challenge'
assert_false_output "$tmp_dir/$v2_delivery_after_app.out" \
  'v2 delivery revived a superseded challenge'
assert_query "select
  (select count(*)=2 and bool_and(delivery_succeeded_at is null
      and delivery_failed_at is null and superseded_at is not null
      and supersession_reason='resend' and normalized_email is null)
    from public.every8d_settings_auth_challenges
    where request_token_hash in (decode(lpad(to_hex(3423),64,'0'),'hex'),
      decode(lpad(to_hex(3424),64,'0'),'hex')))
  and (select count(*)=2 and bool_and(delivery_succeeded_at is null
      and delivery_failed_at is null and superseded_at is null)
    from public.every8d_settings_auth_challenges
    where request_token_hash in (decode(lpad(to_hex(3427),64,'0'),'hex'),
      decode(lpad(to_hex(3428),64,'0'),'hex')))" \
  'C06 resend-first outcomes match and stale delivery cannot revive authority'

# C07: legal lifecycle actors lock installation parents before changing them.
# Requests are observed waiting on those parent owners while a NOWAIT child
# probe succeeds, proving neither request reached/locked the grant first.
start_barrier "${app_prefix}_parent_order_barrier" 993325 \
  'matched parent-first lifecycle barrier'
v1_lifecycle_app="${app_prefix}_v1_parent_lifecycle"
v2_lifecycle_app="${app_prefix}_v2_parent_lifecycle"
psql_app "$owner_role" "$v1_lifecycle_app" -Atq <<'SQL' \
  >"$tmp_dir/$v1_lifecycle_app.out" 2>"$tmp_dir/$v1_lifecycle_app.err" &
begin;
select 1 from public.ghl_marketplace_installations
where id='7b3c0000-0000-4000-8000-000000000002' for update;
select pg_advisory_xact_lock(993325);
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'UNINSTALL',i.marketplace_app_id,i.oauth_client_id,null::uuid,i.location_id,
  null::text,i.conversation_provider_id,i.latest_lifecycle_version_id,
  clock_timestamp(),'c3b3_parent_order_v1_uninstall')
from public.ghl_marketplace_installations i
where i.id='7b3c0000-0000-4000-8000-000000000002';
commit;
SQL
v1_lifecycle_pid=$!; background_pids+=("$v1_lifecycle_pid")
psql_app "$owner_role" "$v2_lifecycle_app" -Atq <<'SQL' \
  >"$tmp_dir/$v2_lifecycle_app.out" 2>"$tmp_dir/$v2_lifecycle_app.err" &
begin;
select 1 from public.ghl_marketplace_installations
where id='7b3c0000-0000-4000-8000-000000000004' for update;
select pg_advisory_xact_lock(993325);
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'UNINSTALL',i.marketplace_app_id,i.oauth_client_id,null::uuid,i.location_id,
  null::text,i.conversation_provider_id,i.latest_lifecycle_version_id,
  clock_timestamp(),'c3b3_parent_order_v2_uninstall')
from public.ghl_marketplace_installations i
where i.id='7b3c0000-0000-4000-8000-000000000004';
commit;
SQL
v2_lifecycle_pid=$!; background_pids+=("$v2_lifecycle_pid")
wait_for_backend "$v1_lifecycle_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'v1 lifecycle actor holding parent only' "$v1_lifecycle_pid"
wait_for_backend "$v2_lifecycle_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'v2 lifecycle actor holding parent only' "$v2_lifecycle_pid"
v1_lifecycle_backend=$(backend_pid "$v1_lifecycle_app")
v2_lifecycle_backend=$(backend_pid "$v2_lifecycle_app")
v1_parent_request_app="${app_prefix}_v1_parent_request"
v2_parent_request_app="${app_prefix}_v2_parent_request"
psql_app "$owner_role" "$v1_parent_request_app" -Atq <<'SQL' \
  >"$tmp_dir/$v1_parent_request_app.out" 2>"$tmp_dir/$v1_parent_request_app.err" &
do $$
declare rejected boolean := false;
begin
  begin
    perform 1 from public.request_every8d_settings_enrollment_challenge_v1(
      (select id from public.every8d_settings_enrollment_grants
        where token_hash=decode(lpad(to_hex(3331),64,'0'),'hex')),
      'parity-parent-order-v1@example.com','k1:'||lpad(to_hex(3331),64,'0'),
      array['k1:'||lpad(to_hex(3331),64,'0')],decode(lpad(to_hex(3431),64,'0'),'hex'),
      decode(lpad(to_hex(3531),64,'0'),'hex'),'otp-v1');
  exception when sqlstate '23514' then rejected := true;
  end;
  if not rejected then raise exception 'v1 stale parent authority was accepted'; end if;
end;
$$;
select 'rejected';
SQL
v1_parent_request_pid=$!; background_pids+=("$v1_parent_request_pid")
psql_app service_role "$v2_parent_request_app" -Atqc "select count(*) from
  public.runtime_request_every8d_settings_enrollment_challenge_v1(
    decode(lpad(to_hex(3332),64,'0'),'hex'),
    '7b3b4000-0000-4000-8000-000000000001',
    'parity-parent-order-v2@example.com','k1:'||lpad(to_hex(3332),64,'0'),
    array['k1:'||lpad(to_hex(3332),64,'0')],decode(lpad(to_hex(3432),64,'0'),'hex'),
    decode(lpad(to_hex(3532),64,'0'),'hex'),'otp-v1')" \
  >"$tmp_dir/$v2_parent_request_app.out" 2>"$tmp_dir/$v2_parent_request_app.err" &
v2_parent_request_pid=$!; background_pids+=("$v2_parent_request_pid")
wait_for_backend "$v1_parent_request_app" "wait_event_type='Lock'
  and $v1_lifecycle_backend=any(pg_blocking_pids(pid))" \
  'v1 request blocked on installation parent' "$v1_parent_request_pid"
wait_for_backend "$v2_parent_request_app" "wait_event_type='Lock'
  and $v2_lifecycle_backend=any(pg_blocking_pids(pid))" \
  'v2 request blocked on installation parent' "$v2_parent_request_pid"
assert_query "select count(*)=2 and bool_and(revoked_at is null and consumed_at is null)
  from public.every8d_settings_enrollment_grants
  where token_hash in (decode(lpad(to_hex(3331),64,'0'),'hex'),
    decode(lpad(to_hex(3332),64,'0'),'hex'))" \
  'C07 grant transition has not run while parent barrier is held'
[[ "$(psql_owner_db "$database" -Atqc "begin;select 1 from
  public.every8d_settings_enrollment_grants where
  token_hash=decode(lpad(to_hex(3331),64,'0'),'hex') for update nowait;rollback" \
  | tr -d '[:space:]')" == 1 ]]
[[ "$(psql_owner_db "$database" -Atqc "begin;select 1 from
  public.every8d_settings_enrollment_grants where
  token_hash=decode(lpad(to_hex(3332),64,'0'),'hex') for update nowait;rollback" \
  | tr -d '[:space:]')" == 1 ]]
release_barrier
wait_success "$v1_lifecycle_pid" 'v1 parent lifecycle actor failed'
wait_success "$v2_lifecycle_pid" 'v2 parent lifecycle actor failed'
wait_success "$v1_parent_request_pid" 'v1 parent-revalidation request failed'
wait_success "$v2_parent_request_pid" 'v2 parent-revalidation request failed'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$v1_parent_request_app.out")" == rejected ]]
[[ "$(tr -d '[:space:]' <"$tmp_dir/$v2_parent_request_app.out")" == 0 ]]
assert_query "select
  (select count(*)=2 and bool_and(status='uninstalled'
      and latest_lifecycle_event_type='UNINSTALL')
    from public.ghl_marketplace_installations
    where id in ('7b3c0000-0000-4000-8000-000000000002',
      '7b3c0000-0000-4000-8000-000000000004'))
  and (select count(*)=2 and bool_and(revoked_at is not null
      and revocation_reason='installation_uninstalled')
    from public.every8d_settings_enrollment_grants
    where token_hash in (decode(lpad(to_hex(3331),64,'0'),'hex'),
      decode(lpad(to_hex(3332),64,'0'),'hex')))
  and not exists(select 1 from public.every8d_settings_auth_challenges
    where request_token_hash in (decode(lpad(to_hex(3431),64,'0'),'hex'),
      decode(lpad(to_hex(3432),64,'0'),'hex')))" \
  'C07 parent-first lifecycle commit forces matched locked revalidation rejection'

# Direct v2 concurrency proof. A separate advisory barrier holds the first actor
# after its authority mutation so the second actor is observed waiting on the
# exact row/advisory serialization owned by the orchestration core.
start_barrier "${app_prefix}_correct_barrier" 993301 'correct verification barrier'
first_app="${app_prefix}_correct_first"
second_app="${app_prefix}_correct_second"
psql_app service_role "$first_app" -Atq <<'SQL' \
  >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('e1',32),'hex'),'login',array['k1:'||repeat('7',64)],
  decode(repeat('e2',32),'hex'));
select pg_advisory_xact_lock(993301);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'first correct verifier holding authority' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app service_role "$second_app" -Atqc "select
  public.runtime_verify_every8d_settings_challenge_v1(
    decode(repeat('e1',32),'hex'),'login',array['k1:'||repeat('7',64)],
    decode(repeat('e2',32),'hex'))" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'second correct verifier serialized' "$second_pid"
release_barrier
wait_success "$first_pid" 'first correct verifier failed'
wait_success "$second_pid" 'second correct verifier failed'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$first_app.out")" == t ]]
assert_false_output "$tmp_dir/$second_app.out" \
  'concurrent verification did not produce one winner'
assert_query "select verified_at is not null and not exists(select 1
  from public.every8d_settings_auth_challenge_failures f where f.challenge_id=c.id)
  from public.every8d_settings_auth_challenges c
  where c.id='7b360000-0000-4000-8000-000000000001'" \
  'concurrent correct verification has one winner and no failure'

# Two ordinary wrong verifiers serialize and append two contiguous failures.
start_barrier "${app_prefix}_wrong_barrier" 993310 'wrong/wrong verification barrier'
first_app="${app_prefix}_wrong_first"
second_app="${app_prefix}_wrong_second"
psql_app service_role "$first_app" -Atq <<'SQL' \
  >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('da',32),'hex'),'login',array['k1:'||repeat('f',63)||'5'],
  decode(repeat('dc',32),'hex'));
select pg_advisory_xact_lock(993310);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'first wrong verifier holding challenge authority' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app service_role "$second_app" -Atqc "select
  public.runtime_verify_every8d_settings_challenge_v1(
    decode(repeat('da',32),'hex'),'login',array['k1:'||repeat('f',63)||'5'],
    decode(repeat('dd',32),'hex'))" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'second wrong verifier serialized' "$second_pid"
release_barrier
wait_success "$first_pid" 'first wrong verifier failed'
wait_success "$second_pid" 'second wrong verifier failed'
assert_false_output "$tmp_dir/$first_app.out" 'first ordinary wrong OTP was not rejected'
assert_false_output "$tmp_dir/$second_app.out" 'second ordinary wrong OTP was not rejected'
assert_query "select locked_at is null and (select array_agg(attempt_number order by attempt_number)
    =array[1,2] from public.every8d_settings_auth_challenge_failures f
    where f.challenge_id=c.id)
  from public.every8d_settings_auth_challenges c
  where c.id='7b360000-0000-4000-8000-000000000010'" \
  'wrong/wrong race records exactly two ordered failures'

# Correct and wrong verifiers race on one challenge. The committed correct
# winner is authoritative and the stale wrong actor cannot append a failure.
start_barrier "${app_prefix}_mixed_barrier" 993311 'correct/wrong verification barrier'
first_app="${app_prefix}_mixed_correct"
second_app="${app_prefix}_mixed_wrong"
psql_app service_role "$first_app" -Atq <<'SQL' \
  >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('df',32),'hex'),'login',array['k1:'||repeat('1',63)||'6'],
  decode(repeat('e0',32),'hex'));
select pg_advisory_xact_lock(993311);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'correct actor holding mixed-race authority' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app service_role "$second_app" -Atqc "select
  public.runtime_verify_every8d_settings_challenge_v1(
    decode(repeat('df',32),'hex'),'login',array['k1:'||repeat('1',63)||'6'],
    decode(repeat('05',32),'hex'))" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'wrong actor serialized behind correct actor' "$second_pid"
release_barrier
wait_success "$first_pid" 'mixed correct verifier failed'
wait_success "$second_pid" 'mixed wrong verifier failed'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$first_app.out")" == t ]]
assert_false_output "$tmp_dir/$second_app.out" 'stale wrong actor passed mixed race'
assert_query "select verified_at is not null and not exists(select 1
    from public.every8d_settings_auth_challenge_failures f where f.challenge_id=c.id)
  from public.every8d_settings_auth_challenges c
  where c.id='7b360000-0000-4000-8000-000000000011'" \
  'correct/wrong race has one authoritative success and no stale failure'

# A new explicit request wins the resend/verify race. The verifier starts from
# a previously live delivered challenge, blocks behind supersession, then must
# reject that stale challenge after the request commits.
start_barrier "${app_prefix}_resend_verify_barrier" 993312 'resend/verify barrier'
first_app="${app_prefix}_resend_verify_request"
second_app="${app_prefix}_resend_verify_old"
psql_app service_role "$first_app" -Atq <<'SQL' \
  >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select * from public.runtime_request_every8d_settings_login_challenge_v1(
  '7b360000-0000-4000-8000-000000000013','resend-verify@example.com',
  'k1:'||repeat('2',63)||'7',array['k1:'||repeat('2',63)||'7'],
  decode(repeat('09',32),'hex'),decode(repeat('0a',32),'hex'),'otp-v1');
select pg_advisory_xact_lock(993312);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'resend request holding supersession authority' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app service_role "$second_app" -Atqc "select
  public.runtime_verify_every8d_settings_challenge_v1(
    decode(repeat('07',32),'hex'),'login',array['k1:'||repeat('2',63)||'7'],
    decode(repeat('08',32),'hex'))" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'old verifier serialized behind resend request' "$second_pid"
release_barrier
wait_success "$first_pid" 'resend request actor failed'
wait_success "$second_pid" 'old verifier actor failed'
assert_false_output "$tmp_dir/$second_app.out" 'superseded stale challenge verified'
assert_query "select
    (select superseded_at is not null and supersession_reason='resend'
      and verified_at is null from public.every8d_settings_auth_challenges
      where id='7b360000-0000-4000-8000-000000000012')
    and (select superseded_at is null and delivery_succeeded_at is null
      and delivery_failed_at is null from public.every8d_settings_auth_challenges
      where id='7b360000-0000-4000-8000-000000000013')" \
  'resend/verify race leaves only the explicit new request authoritative'

start_barrier "${app_prefix}_fifth_barrier" 993302 'fifth failure barrier'
first_app="${app_prefix}_fifth_first"
second_app="${app_prefix}_fifth_second"
psql_app service_role "$first_app" -Atq <<'SQL' \
  >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.runtime_verify_every8d_settings_challenge_v1(
  decode(repeat('e3',32),'hex'),'login',array['k1:'||repeat('8',64)],
  decode(repeat('ff',32),'hex'));
select pg_advisory_xact_lock(993302);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'first fifth-failure verifier holding authority' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app service_role "$second_app" -Atqc "select
  public.runtime_verify_every8d_settings_challenge_v1(
    decode(repeat('e3',32),'hex'),'login',array['k1:'||repeat('8',64)],
    decode(repeat('fe',32),'hex'))" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'concurrent fifth failure serialized' "$second_pid"
release_barrier
wait_success "$first_pid" 'first fifth-failure verifier failed'
wait_success "$second_pid" 'second fifth-failure verifier failed'
assert_false_output "$tmp_dir/$first_app.out" 'first wrong OTP was not rejected'
assert_false_output "$tmp_dir/$second_app.out" 'second wrong OTP was not rejected'
assert_query "select locked_at is not null and normalized_email is null
  and (select count(*)=5 from public.every8d_settings_auth_challenge_failures f
    where f.challenge_id=c.id)
  from public.every8d_settings_auth_challenges c
  where c.id='7b360000-0000-4000-8000-000000000002'" \
  'concurrent fifth failure locks once with five contiguous attempts'

# Authority mutation wins: stale discovery/request-time state cannot authorize.
start_barrier "${app_prefix}_admin_barrier" 993303 'administrator revocation barrier'
first_app="${app_prefix}_admin_revoke"
second_app="${app_prefix}_admin_verify"
psql_app "$owner_role" "$first_app" -Atq <<'SQL' \
  >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
update public.every8d_settings_administrators
set revoked_at=clock_timestamp(),revocation_reason='c3b3_race'
where normalized_email='admin-race@example.com';
select pg_advisory_xact_lock(993303);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'administrator revocation holding authority' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app service_role "$second_app" -Atqc "select
  public.runtime_verify_every8d_settings_challenge_v1(
    decode(repeat('e5',32),'hex'),'login',array['k1:'||repeat('9',64)],
    decode(repeat('e6',32),'hex'))" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'verification waiting behind administrator revocation' "$second_pid"
release_barrier
wait_success "$first_pid" 'administrator revocation race failed'
wait_success "$second_pid" 'verification after administrator revocation failed'
assert_false_output "$tmp_dir/$second_app.out" \
  'stale administrator discovery authorized verification'

start_barrier "${app_prefix}_grant_barrier" 993304 'grant revocation barrier'
first_app="${app_prefix}_grant_revoke"
second_app="${app_prefix}_grant_verify"
psql_app "$owner_role" "$first_app" -Atq <<'SQL' \
  >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
update public.every8d_settings_enrollment_grants
set revoked_at=clock_timestamp(),revocation_reason='c3b3_race'
where token_hash=decode(repeat('c3b300d4',8),'hex');
select pg_advisory_xact_lock(993304);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'grant revocation holding authority' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app service_role "$second_app" -Atqc "select
  public.runtime_verify_every8d_settings_challenge_v1(
    decode(repeat('e9',32),'hex'),'enrollment',array['k1:'||repeat('b',64)],
    decode(repeat('ea',32),'hex'))" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'verification waiting behind grant revocation' "$second_pid"
release_barrier
wait_success "$first_pid" 'grant revocation race failed'
wait_success "$second_pid" 'verification after grant revocation failed'
assert_false_output "$tmp_dir/$second_app.out" \
  'stale grant discovery authorized verification'

start_barrier "${app_prefix}_consume_barrier" 993306 'grant consumption barrier'
first_app="${app_prefix}_grant_consume"
second_app="${app_prefix}_consume_verify"
psql_app "$owner_role" "$first_app" -Atq <<'SQL' \
  >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select administrator_id from public.redeem_every8d_settings_enrollment_grant_v1(
  decode(repeat('d5',32),'hex'),'grant-consume-race@example.com',
  'k1:'||repeat('b',63)||'1');
select pg_advisory_xact_lock(993306);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'grant consumption holding authority' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app service_role "$second_app" -Atqc "select
  public.runtime_verify_every8d_settings_challenge_v1(
    decode(repeat('eb',32),'hex'),'enrollment',
    array['k1:'||repeat('b',63)||'1'],decode(repeat('ec',32),'hex'))" \
  >"$tmp_dir/$second_app.out" 2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'verification waiting behind grant consumption' "$second_pid"
release_barrier
wait_success "$first_pid" 'grant consumption race failed'
wait_success "$second_pid" 'verification after grant consumption failed'
assert_false_output "$tmp_dir/$second_app.out" \
  'consumed grant authorized stale verification'
assert_query "select g.consumed_at is not null and c.superseded_at is not null
    and c.supersession_reason='grant_consumed'
  from public.every8d_settings_enrollment_grants g
  join public.every8d_settings_auth_challenges c on c.enrollment_grant_id=g.id
  where g.token_hash=decode(repeat('d5',32),'hex')
    and c.id='7b360000-0000-4000-8000-000000000006'" \
  'grant consumption atomically invalidates the challenge'

# Request plus delivery is unpublished until commit; discovery sees either no
# row or one complete protected metadata row.
start_barrier "${app_prefix}_request_barrier" 993307 'request publication barrier'
first_app="${app_prefix}_request_publish"
psql_app service_role "$first_app" -Atq <<'SQL' \
  >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select * from public.runtime_request_every8d_settings_login_challenge_v1(
  '7b360000-0000-4000-8000-000000000007','request-discovery@example.com',
  'k1:'||repeat('c',63)||'2',array['k1:'||repeat('c',63)||'2'],
  decode(repeat('ed',32),'hex'),decode(repeat('ee',32),'hex'),'otp-v1');
select public.runtime_record_every8d_settings_challenge_delivery_v1(
  decode(repeat('ed',32),'hex'),true,null);
select pg_advisory_xact_lock(993307);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'request transaction holding unpublished delivery' "$first_pid"
[[ "$(psql_app service_role "${app_prefix}_discovery_before" -Atqc "select count(*)
  from public.runtime_discover_every8d_settings_challenge_v1(
    decode(repeat('ed',32),'hex'),'login')" | tr -d '[:space:]')" == 0 ]]
release_barrier
wait_success "$first_pid" 'request publication transaction failed'
assert_query "select count(*)=1 and bool_and(challenge_id=
    '7b360000-0000-4000-8000-000000000007'::uuid
    and enrollment_grant_id is null and normalized_email='request-discovery@example.com'
    and email_pseudonym='k1:'||repeat('c',63)||'2'
    and otp_hmac_key_version='otp-v1')
  from public.runtime_discover_every8d_settings_challenge_v1(
    decode(repeat('ed',32),'hex'),'login')" \
  'committed request publishes one complete discovery row'

# Concurrent requests serialize on the alias lock. The first inserts once;
# the second observes the committed 60-second boundary and returns zero rows.
start_barrier "${app_prefix}_resend_barrier" 993308 'resend serialization barrier'
first_app="${app_prefix}_resend_first"
second_app="${app_prefix}_resend_second"
psql_app service_role "$first_app" -Atq <<'SQL' \
  >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select * from public.runtime_request_every8d_settings_login_challenge_v1(
  '7b360000-0000-4000-8000-000000000008','resend-race@example.com',
  'k1:'||repeat('d',63)||'3',array['k1:'||repeat('d',63)||'3'],
  decode(repeat('ef',32),'hex'),decode(repeat('f0',32),'hex'),'otp-v1');
select pg_advisory_xact_lock(993308);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'first resend request holding alias authority' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app service_role "$second_app" -Atqc "select * from
  public.runtime_request_every8d_settings_login_challenge_v1(
    '7b360000-0000-4000-8000-000000000010','resend-race@example.com',
    'k1:'||repeat('d',63)||'3',array['k1:'||repeat('d',63)||'3'],
    decode(repeat('f1',32),'hex'),decode(repeat('f4',32),'hex'),'otp-v1')" \
  >"$tmp_dir/$second_app.out" 2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'second resend request serialized' "$second_pid"
release_barrier
wait_success "$first_pid" 'first resend request failed'
wait_success "$second_pid" 'second resend request failed'
[[ -z "$(tr -d '[:space:]' <"$tmp_dir/$second_app.out")" ]]
assert_query "select count(*)=1 and bool_and(id=
    '7b360000-0000-4000-8000-000000000008'::uuid)
  from public.every8d_settings_auth_challenges
  where request_token_hash in (
    decode(repeat('ef',32),'hex'),decode(repeat('f1',32),'hex'))" \
  'concurrent resend creates no partial retry row'

# Expiry scrub and verification serialize on the challenge row. Expiry remains
# authoritative even if a caller retained earlier non-authoritative metadata.
assert_query "select clock_timestamp()>=expires_at
  from public.every8d_settings_auth_challenges
  where id='7b360000-0000-4000-8000-000000000009'" \
  'at/after-expiry fixture crossed exact expires_at boundary'
assert_query "select count(*)=0 from
  public.runtime_discover_every8d_settings_challenge_v1(
    decode(repeat('f2',32),'hex'),'login')" \
  'expired challenge is not discoverable'
start_barrier "${app_prefix}_expiry_barrier" 993309 'expiry scrub barrier'
first_app="${app_prefix}_expiry_scrub"
second_app="${app_prefix}_expiry_verify"
psql_app "$owner_role" "$first_app" -Atq <<'SQL' \
  >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.scrub_expired_every8d_settings_challenge_emails_v1(500);
select pg_advisory_xact_lock(993309);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'expiry scrub holding challenge rows' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app service_role "$second_app" -Atqc "select
  public.runtime_verify_every8d_settings_challenge_v1(
    decode(repeat('f2',32),'hex'),'login',
    array['k1:'||repeat('e',63)||'4'],decode(repeat('f3',32),'hex'))" \
  >"$tmp_dir/$second_app.out" 2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'verification waiting behind expiry scrub' "$second_pid"
release_barrier
wait_success "$first_pid" 'expiry scrub race failed'
wait_success "$second_pid" 'verification after expiry scrub failed'
assert_false_output "$tmp_dir/$second_app.out" \
  'expired challenge authorized verification'

assert_query "select count(*)=1 from
  public.runtime_discover_every8d_settings_challenge_v1(
    decode(repeat('e7',32),'hex'),'login')" \
  'lifecycle race begins from discoverable metadata'

start_barrier "${app_prefix}_lifecycle_barrier" 993305 'lifecycle-only barrier'
first_app="${app_prefix}_lifecycle_update"
second_app="${app_prefix}_lifecycle_verify"
psql_app "$owner_role" "$first_app" -Atq <<'SQL' \
  >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
update public.ghl_marketplace_installations
set status='uninstalled',
  latest_lifecycle_event_at=clock_timestamp(),
  latest_lifecycle_event_id='c3b3_lifecycle_race',
  latest_lifecycle_event_type='UNINSTALL'
where id='7b300000-0000-4000-8000-000000000002';
select pg_advisory_xact_lock(993305);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'lifecycle-only update holding parent authority' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app service_role "$second_app" -Atqc "select
  public.runtime_verify_every8d_settings_challenge_v1(
    decode(repeat('e7',32),'hex'),'login',array['k1:'||repeat('a',64)],
    decode(repeat('e8',32),'hex'))" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'verification waiting behind lifecycle-only update' "$second_pid"
release_barrier
wait_success "$first_pid" 'lifecycle-only race failed'
wait_success "$second_pid" 'verification after lifecycle-only invalidation failed'
assert_false_output "$tmp_dir/$second_app.out" \
  'stale lifecycle discovery authorized verification'

# Rollback removes only the exact functions and preserves populated C3b-1 rows.
if grep -Eiq '(^|[[:space:]])(cascade|delete|truncate)([[:space:];]|$)' "$rollback"; then
  echo 'FAIL: C3b-3 rollback contains a destructive or cascading operation' >&2
  exit 1
fi
psql_owner_db "$database" -qc "insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) select '7b390000-0000-4000-8000-000000000001',decode(repeat('d1',32),'hex'),
  'login','rollback@example.com','k1:'||repeat('7',64),decode(repeat('d2',32),'hex'),
  'otp-v1',captured_at,captured_at+interval '10 minutes'
from (select clock_timestamp() captured_at) t"
psql_owner_db "$database" <"$rollback" >/dev/null
assert_no_targets "$database" 'clean rollback removes all eight C3b-3 functions'
assert_query "select exists(select 1 from public.every8d_settings_auth_challenges
    where id='7b390000-0000-4000-8000-000000000001')
  and to_regprocedure('public.request_every8d_settings_enrollment_challenge_v1(uuid,text,text,text[],bytea,bytea,text)') is not null
  and to_regprocedure('public.request_every8d_settings_login_challenge_v1(text,text,text[],bytea,bytea,text)') is not null
  and to_regprocedure('public.verify_every8d_settings_challenge_v1(uuid,bytea,text,uuid,text,text[],bytea)') is not null
  and to_regclass('public.every8d_settings_enrollment_grants') is not null
  and to_regclass('public.every8d_settings_administrators') is not null
  and to_regclass('public.every8d_settings_auth_challenges') is not null
  and to_regclass('public.every8d_settings_auth_challenge_failures') is not null" \
  'clean rollback preserves populated rows and C3a/C3b-1 objects'

# Reapply, then prove every frozen pg_proc identity property, definition,
# dependency, and ownership tamper refuses before any revoke or drop.
psql_owner_db "$database" <"$migration" >/dev/null

clone_database altered_volatility
psql_owner_db "$cloned_db" -qc "alter function
  public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)
  stable"
expect_failure 'C3b-3 rollback refused: target definition mismatch' altered_volatility \
  psql_owner_db "$cloned_db" <"$rollback"
assert_targets_intact "$cloned_db" 'volatility refusal is atomic'

clone_database altered_strictness
psql_owner_db "$cloned_db" -qc "alter function
  public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)
  returns null on null input"
expect_failure 'C3b-3 rollback refused: target definition mismatch' altered_strictness \
  psql_owner_db "$cloned_db" <"$rollback"
assert_targets_intact "$cloned_db" 'strictness refusal is atomic'

clone_database altered_parallel
psql_owner_db "$cloned_db" -qc "alter function
  public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)
  parallel safe"
expect_failure 'C3b-3 rollback refused: target definition mismatch' altered_parallel \
  psql_owner_db "$cloned_db" <"$rollback"
assert_targets_intact "$cloned_db" 'parallel-setting refusal is atomic'

clone_database altered_search_path
psql_owner_db "$cloned_db" -qc "alter function
  public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)
  set search_path=public"
expect_failure 'C3b-3 rollback refused: target definition mismatch' altered_search_path \
  psql_owner_db "$cloned_db" <"$rollback"
assert_targets_intact "$cloned_db" 'search-path refusal is atomic'

clone_database altered_security
psql_owner_db "$cloned_db" -qc "alter function
  public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)
  security invoker"
expect_failure 'C3b-3 rollback refused: target definition mismatch' altered_security \
  psql_owner_db "$cloned_db" <"$rollback"
assert_targets_intact "$cloned_db" 'SECURITY DEFINER refusal is atomic'

clone_database altered_kind
psql_owner_db "$cloned_db" -qc "drop function
  public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea);
  create procedure public.runtime_verify_every8d_settings_challenge_v1(
    input_request_token_hash bytea,input_purpose text,
    input_email_pseudonym_aliases text[],input_candidate_otp_hmac bytea)
  language sql security definer set search_path=pg_catalog,public
  as 'select false';
  revoke all on procedure
    public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)
    from public,anon,authenticated,service_role;
  grant execute on procedure
    public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)
    to service_role"
expect_failure 'C3b-3 rollback refused: target definition mismatch' altered_kind \
  psql_owner_db "$cloned_db" <"$rollback"
assert_targets_intact "$cloned_db" 'function-kind refusal is atomic'

clone_database altered_argument_modes
psql_owner_db "$cloned_db" -qc "drop function
  public.runtime_discover_every8d_settings_challenge_v1(bytea,text);
  create function public.runtime_discover_every8d_settings_challenge_v1(
    input_request_token_hash bytea,input_purpose text,
    out challenge_id uuid,out enrollment_grant_id uuid,out normalized_email text,
    out email_pseudonym text,out otp_hmac_key_version text)
  returns setof record language sql security definer
  set search_path=pg_catalog,public
  as 'select null::uuid,null::uuid,null::text,null::text,null::text';
  revoke all on function
    public.runtime_discover_every8d_settings_challenge_v1(bytea,text)
    from public,anon,authenticated,service_role;
  grant execute on function
    public.runtime_discover_every8d_settings_challenge_v1(bytea,text)
    to service_role"
expect_failure 'C3b-3 rollback refused: target definition mismatch' altered_argument_modes \
  psql_owner_db "$cloned_db" <"$rollback"
assert_targets_intact "$cloned_db" 'argument-mode refusal is atomic'

clone_database altered_body
psql_owner_db "$cloned_db" -qc "create or replace function
  public.runtime_verify_every8d_settings_challenge_v1(
    input_request_token_hash bytea,input_purpose text,
    input_email_pseudonym_aliases text[],input_candidate_otp_hmac bytea)
  returns boolean language sql security definer
  set search_path=pg_catalog,public as 'select false'"
expect_failure 'C3b-3 rollback refused: target definition mismatch' altered_body \
  psql_owner_db "$cloned_db" <"$rollback"
assert_targets_intact "$cloned_db" 'body-identity refusal is atomic'

clone_database altered_result
psql_owner_db "$cloned_db" -qc "drop function
  public.runtime_discover_every8d_settings_challenge_v1(bytea,text);
  create function public.runtime_discover_every8d_settings_challenge_v1(
    input_request_token_hash bytea,input_purpose text)
  returns boolean language sql security definer
  set search_path=pg_catalog,public as 'select false';
  revoke all on function
    public.runtime_discover_every8d_settings_challenge_v1(bytea,text)
    from public,anon,authenticated,service_role;
  grant execute on function
    public.runtime_discover_every8d_settings_challenge_v1(bytea,text)
    to service_role"
expect_failure 'C3b-3 rollback refused: target definition mismatch' altered_result \
  psql_owner_db "$cloned_db" <"$rollback"
assert_targets_intact "$cloned_db" 'result/output refusal is atomic'

psql_owner_db "$database" -qc "create view public.c3b3_dependency_probe as
  select * from public.runtime_discover_every8d_settings_challenge_v1(
    decode(repeat('00',32),'hex'),'login')"
expect_failure 'C3b-3 rollback refused: unexpected target dependency' dependency_refusal \
  psql_owner_db "$database" <"$rollback"
assert_targets_intact "$database" 'external-dependency refusal is atomic'
psql_owner_db "$database" -qc "drop view public.c3b3_dependency_probe"
psql_db "$database" -qc "alter function
  public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)
  owner to postgres"
expect_failure 'C3b-3 rollback refused: target definition mismatch' ownership_refusal \
  psql_owner_db "$database" <"$rollback"
assert_targets_intact "$database" 'ownership refusal is atomic'
psql_db "$database" -qc "alter function
  public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)
  owner to $owner_role"

assert_query "select
  (select count(*)=8 and bool_and(p.proowner=('$owner_role'::regrole)::oid)
      and bool_and(p.prosecdef)
      and bool_and(p.proconfig=array['search_path=pg_catalog, public']::text[])
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'runtime_request_every8d_settings_enrollment_challenge_v1',
      'runtime_request_every8d_settings_login_challenge_v1',
      'runtime_record_every8d_settings_challenge_delivery_v1',
      'runtime_discover_every8d_settings_challenge_v1',
      'runtime_verify_every8d_settings_challenge_v1',
      'request_every8d_settings_enrollment_challenge_core_v2',
      'request_every8d_settings_login_challenge_core_v2',
      'verify_every8d_settings_challenge_core_v2'))
  and (select count(*)=5 from (values
      ('public.runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)'),
      ('public.runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)'),
      ('public.runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)'),
      ('public.runtime_discover_every8d_settings_challenge_v1(bytea,text)'),
      ('public.runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)')
    ) wrapper(signature)
    where has_function_privilege('service_role',wrapper.signature,'execute'))
  and not has_function_privilege('service_role',
    'public.request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)','execute')
  and not has_function_privilege('service_role',
    'public.request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)','execute')
  and not has_function_privilege('service_role',
    'public.verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)','execute')
  and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public' and p.proname like '%every8d_settings%challenge%'
      and acl.privilege_type='EXECUTE'
      and (acl.grantee=0 or acl.grantee in (
        ('anon'::regrole)::oid,('authenticated'::regrole)::oid)))" \
  'C3b-3 remains exact after fail-closed rollback probes'

echo 'EVERY8D C3b-3 PostgreSQL 17 orchestration, ACL, rollback, and preflight proof passed'
