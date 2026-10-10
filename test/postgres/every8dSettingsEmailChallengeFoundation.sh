#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly database=wincrm_test
readonly owner_role=c3a_migration_owner
readonly migration=supabase/migrations/202610060001_every8d_settings_email_challenge_foundation.sql
readonly rollback=supabase/rollback/202610060001_every8d_settings_email_challenge_foundation.sql
readonly proof=test/postgres/every8dSettingsEmailChallengeFoundation.sql
readonly run_id="${RANDOM}${RANDOM}"
readonly app_prefix="c3b_${run_id}"
readonly admin_db="c3b_admin_${run_id}"
readonly grant_db="c3b_grant_${run_id}"
readonly history_db="c3b_history_${run_id}"
readonly missing_pgcrypto_db="c3b_missing_pgcrypto_${run_id}"
readonly wrong_pgcrypto_schema_db="c3b_wrong_pgcrypto_schema_${run_id}"
readonly missing_digest_signature_db="c3b_missing_digest_signature_${run_id}"
readonly wait_seconds=30
readonly actor_seconds=50
tmp_dir=$(mktemp -d)
declare -a background_pids=()

psql_db() {
  local db=$1
  shift
  timeout --signal=TERM "${actor_seconds}s" docker exec \
    -e "PGOPTIONS=-c statement_timeout=45s -c lock_timeout=35s" \
    -i "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 \
    -v VERBOSITY=terse -U postgres -d "$db" "$@"
}

psql_owner_db() {
  local db=$1
  shift
  timeout --signal=TERM "${actor_seconds}s" docker exec \
    -e "PGOPTIONS=-c role=$owner_role -c statement_timeout=45s -c lock_timeout=35s" \
    -i "$POSTGRES_CONTAINER_ID" \
    psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$db" "$@"
}

psql_app() {
  local app=$1
  shift
  timeout --signal=TERM "${actor_seconds}s" docker exec -e "PGAPPNAME=$app" \
    -e "PGOPTIONS=-c role=$owner_role -c statement_timeout=45s -c lock_timeout=35s" -i \
    "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse \
    -U postgres -d "$database" "$@"
}

cleanup() {
  local original_status=$?
  psql_db "$database" -Atqc "select pg_terminate_backend(pid)
    from pg_stat_activity where application_name like '${app_prefix}\_%' escape '\\'
      and pid<>pg_backend_pid()" >/dev/null 2>&1 || true
  for pid in "${background_pids[@]}"; do
    kill "$pid" >/dev/null 2>&1 || true
    if wait_for_process_exit "$pid" 'cleanup process exit' >/dev/null 2>&1; then
      wait "$pid" >/dev/null 2>&1 || true
    else
      original_status=1
    fi
  done
  for db in "$admin_db" "$grant_db" "$history_db" "$missing_pgcrypto_db" \
    "$wrong_pgcrypto_schema_db" "$missing_digest_signature_db"; do
    psql_db postgres -c "drop database if exists $db with (force)" >/dev/null 2>&1 || true
  done
  rm -rf "$tmp_dir"
  local remaining=0
  remaining=$(psql_db "$database" -Atqc "select count(*) from pg_stat_activity
    where application_name like '${app_prefix}\_%' escape '\\'" 2>/dev/null \
    | tr -d '\r') || remaining=cleanup_query_failed
  if [[ "$remaining" != 0 ]]; then
    echo "FAIL: cleanup left $remaining C3b test backends" >&2
    original_status=1
  fi
  trap - EXIT
  exit "$original_status"
}
trap cleanup EXIT

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

assert_query_in_db() {
  local db=$1 query=$2 label=$3
  [[ "$(psql_db "$db" -Atqc "$query" | tr -d '\r')" == t ]] || {
    echo "FAIL: $label" >&2
    exit 1
  }
}

assert_no_c3b_objects() {
  local db=$1 label=$2
  assert_query_in_db "$db" "select
      to_regclass('public.every8d_settings_auth_challenges') is null
      and to_regclass('public.every8d_settings_auth_challenge_failures') is null
      and to_regprocedure(
        'public.is_every8d_settings_canonical_email_v1(text)') is null
      and to_regprocedure(
        'public.every8d_settings_email_lock_word_v1(text)') is null" "$label"
}

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

wait_for_process_exit() {
  local pid=$1 label=$2 deadline=$((SECONDS+wait_seconds))
  while (( SECONDS < deadline )); do
    if ! kill -0 "$pid" 2>/dev/null; then return; fi
    sleep 0.1
  done
  echo "FAIL: timed out waiting for $label" >&2
  return 1
}

backend_pid() {
  local app=$1
  psql_db "$database" -Atqc "select pid from pg_stat_activity
    where application_name='$app' order by pid limit 1" | tr -d '\r'
}

capture_lock_evidence() {
  local label=$1
  echo "LOCK EVIDENCE: $label"
  psql_db "$database" -c "select pid,application_name,state,wait_event_type,wait_event,
      pg_blocking_pids(pid) blockers
    from pg_stat_activity
    where application_name like '${app_prefix}\_%' escape '\\'
    order by application_name"
  psql_db "$database" -c "select a.application_name,l.pid,l.locktype,
      coalesce(c.relname,'') relation,l.mode,l.granted,l.classid,l.objid
    from pg_locks l join pg_stat_activity a on a.pid=l.pid
    left join pg_class c on c.oid=l.relation
    where a.application_name like '${app_prefix}\_%' escape '\\'
    order by a.application_name,l.granted,l.locktype,l.mode"
}

terminate_app() {
  local app=$1
  psql_db "$database" -Atqc "select pg_terminate_backend(pid)
    from pg_stat_activity where application_name='$app'" >/dev/null
}

assert_file_contains() {
  local file=$1 expected=$2 label=$3
  grep -Fq "$expected" "$file" || {
    echo "FAIL: $label" >&2
    sed -E 's/(token|password|secret)([^[:space:]]*)/<REDACTED>/Ig' "$file" >&2
    exit 1
  }
}

start_barrier() {
  active_barrier_app=$1
  local lock_key=$2 label=$3
  psql_app "$active_barrier_app" -c "select pg_advisory_lock($lock_key);select pg_sleep(90)" \
    >"$tmp_dir/$active_barrier_app.out" 2>"$tmp_dir/$active_barrier_app.err" &
  active_barrier_pid=$!
  background_pids+=("$active_barrier_pid")
  wait_for_backend "$active_barrier_app" \
    "wait_event_type='Timeout' and wait_event='PgSleep'" "$label" "$active_barrier_pid"
}

release_barrier() {
  terminate_app "$active_barrier_app"
  wait_for_process_exit "$active_barrier_pid" 'barrier process exit'
  set +e
  wait "$active_barrier_pid"
  set -e
}

wait_success() {
  local pid=$1 label=$2
  wait_for_process_exit "$pid" "$label"
  if ! wait "$pid"; then
    echo "FAIL: $label" >&2
    return 1
  fi
}

wait_expected_failure() {
  local pid=$1 error_file=$2 expected=$3 label=$4 status
  wait_for_process_exit "$pid" "$label"
  set +e
  wait "$pid"
  status=$?
  set -e
  if [[ $status -eq 0 ]]; then
    echo "FAIL: $label unexpectedly succeeded" >&2
    return 1
  fi
  assert_file_contains "$error_file" "$expected" "$label"
}

wait_allow_failure() {
  local pid=$1 label=$2
  wait_for_process_exit "$pid" "$label"
  set +e
  wait "$pid"
  set -e
  return 0
}

wait_capture_status() {
  local pid=$1 label=$2
  wait_for_process_exit "$pid" "$label"
  set +e
  wait "$pid"
  waited_status=$?
  set -e
}

# The source database is the completed C3a proof database. Mirror Supabase's
# disposable pgcrypto placement before any C3b migration execution. This setup
# verifies the production dependency contract without changing migration history.
psql_db "$database" -qc "
  create schema if not exists extensions;
  grant usage on schema extensions to $owner_role;"
pgcrypto_schema=$(psql_db "$database" -Atqc "select n.nspname
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  where e.extname='pgcrypto'" | tr -d '\r')
if [[ "$pgcrypto_schema" == public ]]; then
  psql_db "$database" -qc "alter extension pgcrypto set schema extensions"
elif [[ "$pgcrypto_schema" != extensions ]]; then
  echo "FAIL: disposable pgcrypto must begin in public or extensions" >&2
  exit 1
fi
assert_query "select
    (select n.nspname='extensions' from pg_extension e
      join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto')
    and to_regprocedure('extensions.digest(bytea,text)') is not null
    and to_regprocedure('public.digest(bytea,text)') is null" \
  'disposable pgcrypto mirrors production extensions schema'

# Clone the production-compatible C3a source to prove dependency and data
# preflight behavior without mutating or weakening C3a.
for db in "$admin_db" "$grant_db" "$history_db" "$missing_pgcrypto_db" \
  "$wrong_pgcrypto_schema_db" "$missing_digest_signature_db"; do
  psql_db postgres -qc "create database $db template $database"
done

psql_db "$missing_pgcrypto_db" -qc "drop extension pgcrypto"
expect_failure 'C3b-1 migration requires pgcrypto extension' missing_pgcrypto \
  psql_owner_db "$missing_pgcrypto_db" <"$migration"
assert_no_c3b_objects "$missing_pgcrypto_db" \
  'missing pgcrypto failure leaves no C3b objects'

psql_db "$wrong_pgcrypto_schema_db" -qc \
  "alter extension pgcrypto set schema public"
assert_query_in_db "$wrong_pgcrypto_schema_db" "select
    to_regprocedure('public.digest(bytea,text)') is not null
    and to_regprocedure('extensions.digest(bytea,text)') is null" \
  'wrong-schema fixture exposes only public.digest'
expect_failure 'C3b-1 migration requires pgcrypto extension in extensions schema' \
  wrong_pgcrypto_schema psql_owner_db "$wrong_pgcrypto_schema_db" <"$migration"
assert_no_c3b_objects "$wrong_pgcrypto_schema_db" \
  'wrong pgcrypto schema failure leaves no C3b objects'

psql_db "$missing_digest_signature_db" -qc "
  alter extension pgcrypto drop function extensions.digest(bytea,text);
  drop function extensions.digest(bytea,text);"
assert_query_in_db "$missing_digest_signature_db" "select
    (select n.nspname='extensions' from pg_extension e
      join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto')
    and to_regprocedure('extensions.digest(bytea,text)') is null
    and to_regprocedure('extensions.digest(text,text)') is not null" \
  'missing-signature fixture preserves pgcrypto but removes exact overload'
expect_failure 'C3b-1 migration requires extensions.digest(bytea,text)' \
  missing_digest_signature psql_owner_db "$missing_digest_signature_db" <"$migration"
assert_no_c3b_objects "$missing_digest_signature_db" \
  'missing digest signature failure leaves no C3b objects'

psql_owner_db "$admin_db" -qc "
  alter table public.every8d_settings_administrators
    disable trigger protect_every8d_settings_administrator;
  update public.every8d_settings_administrators set normalized_email='bad..local@example.com'
  where id=(select id from public.every8d_settings_administrators
    where revoked_at is null limit 1);
  alter table public.every8d_settings_administrators
    enable trigger protect_every8d_settings_administrator;"
expect_failure 'non-canonical active administrator email' incompatible_admin \
  psql_owner_db "$admin_db" <"$migration"

psql_owner_db "$grant_db" -qc "
  alter table public.every8d_settings_enrollment_grants
    disable trigger protect_every8d_settings_enrollment_grant;
  update public.every8d_settings_enrollment_grants
  set pinned_normalized_email='bad..local@example.com',created_at=clock_timestamp(),
      expires_at=clock_timestamp()+interval '10 minutes',consumed_at=null,
      revoked_at=null,revocation_reason=null,method='operator_initial',
      oauth_bootstrap_reference=null,installer_user_hmac=null,
      installer_user_hmac_key_version=null,operator_issuer='issuer',
      operator_approver='approver',operator_case_reference='C3B',operator_reason='proof'
  where id=(select id from public.every8d_settings_enrollment_grants limit 1);
  alter table public.every8d_settings_enrollment_grants
    enable trigger protect_every8d_settings_enrollment_grant;"
expect_failure 'non-canonical live pinned grant email' incompatible_grant \
  psql_owner_db "$grant_db" <"$migration"

# The same incompatible values are permitted when historical, and a live
# callback grant with no pinned email is intentionally outside the email scan.
psql_owner_db "$history_db" -qc "
  alter table public.every8d_settings_administrators
    disable trigger protect_every8d_settings_administrator;
  update public.every8d_settings_administrators
  set normalized_email='bad..history@example.com',revoked_at=clock_timestamp(),
      revocation_reason='historical'
  where id=(select id from public.every8d_settings_administrators limit 1);
  alter table public.every8d_settings_administrators
    enable trigger protect_every8d_settings_administrator;
  alter table public.every8d_settings_enrollment_grants
    disable trigger protect_every8d_settings_enrollment_grant;
  update public.every8d_settings_enrollment_grants
  set pinned_normalized_email='bad..history@example.com',
      consumed_at=least(clock_timestamp(),expires_at-interval '1 second'),
      revoked_at=null,revocation_reason=null
  where id=(select id from public.every8d_settings_enrollment_grants
    where created_at<expires_at-interval '1 second' limit 1);
  alter table public.every8d_settings_enrollment_grants
    enable trigger protect_every8d_settings_enrollment_grant;"
psql_owner_db "$history_db" <"$migration" >/dev/null
psql_owner_db "$history_db" <"$rollback" >/dev/null

# Apply once as the same non-BYPASSRLS owner used by C3a, then run contract proof.
psql_owner_db "$database" <"$migration" >/dev/null
psql_db "$database" <"$proof" >"$tmp_dir/proof.out"

# The immediate append trigger normally rejects pre-delivery failures. Bypass only
# that trigger inside a transaction to prove the deferred ledger invariant also
# refuses a five-attempt chronology that raw owner DML tries to commit.
expect_failure 'failure ledger is inconsistent' five_failures_before_delivery \
  psql_owner_db "$database" <<'SQL'
begin;
insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) values(
  '6b240000-0000-4000-8000-000000000099',decode(repeat('99',32),'hex'),'login',
  'chronology@example.com','k1:'||repeat('9',64),decode(repeat('98',32),'hex'),
  'otp-v1',statement_timestamp()-interval '1 minute',
  statement_timestamp()+interval '9 minutes'
);
update public.every8d_settings_auth_challenges
set delivery_succeeded_at=created_at+interval '10 seconds'
where id='6b240000-0000-4000-8000-000000000099';
alter table public.every8d_settings_auth_challenge_failures
  disable trigger protect_every8d_settings_auth_challenge_failure;
insert into public.every8d_settings_auth_challenge_failures(
  challenge_id,attempt_number,failed_at
)
select '6b240000-0000-4000-8000-000000000099',n,
  case when n<5 then c.created_at+n*interval '1 second'
       else c.delivery_succeeded_at+interval '1 second' end
from generate_series(1,5) n
cross join public.every8d_settings_auth_challenges c
where c.id='6b240000-0000-4000-8000-000000000099';
commit;
SQL
assert_query "select not exists(select 1 from public.every8d_settings_auth_challenges
  where id='6b240000-0000-4000-8000-000000000099')" \
  'failed chronology transaction rolled back completely'

# Prove the exact namespace/vector independently of the transactional proof.
assert_query "select public.every8d_settings_email_lock_word_v1(
  'k1:'||repeat('0',64))=-1872983711" 'advisory projection fixed vector'

# Create one persistent synthetic parent and six login identities. The consumed
# grants are C3a history; the three live grants drive enrollment races.
psql_db "$database" -qc "
  insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id)
  values('6b200000-0000-4000-8000-000000000001','c3b-race-location',
    'c3b-race-line-provider','c3b-race-line-channel');
  insert into public.ghl_marketplace_installations(
    id,app_namespace,marketplace_app_id,oauth_client_id,tenant_id,location_id,
    company_id,conversation_provider_id,channel,provider,status,installation_generation,
    access_token_ciphertext,refresh_token_ciphertext,encryption_key_version,
    token_expires_at,granted_scopes,credential_revision,credential_state,
    latest_lifecycle_event_at,latest_lifecycle_event_id,latest_lifecycle_event_type,
    latest_lifecycle_version_id
  ) select '6b200000-0000-4000-8000-000000000002','every8d_connect',
    r.marketplace_app_id,r.oauth_client_id,'6b200000-0000-4000-8000-000000000001',
    'c3b-race-location','c3b-race-company',r.conversation_provider_id,'sms','every8d',
    'pending',1,null,null,null,null,'{}'::text[],0,'none',clock_timestamp(),
    'c3b_race_install','INSTALL',v.marketplace_version_id
  from public.ghl_marketplace_app_registrations r
  join public.ghl_marketplace_app_version_registrations v using(app_namespace)
  where r.app_namespace='every8d_connect' limit 1;
  insert into public.every8d_settings_enrollment_grants(
    id,token_hash,installation_id,installation_generation,method,
    pinned_normalized_email,operator_issuer,operator_approver,
    operator_case_reference,operator_reason,created_at,expires_at,consumed_at
  ) select ('6b210000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    decode(lpad(to_hex(100+n),64,'0'),'hex'),
    '6b200000-0000-4000-8000-000000000002',1,'operator_initial',
    (array['requestfirst@example.com','resendrace@example.com',
      'deliveryrace@example.com','scrubresend@example.com',
      'rollbackresend@example.com','resendfirst@example.com'])[n],
    'c3b-issuer','c3b-approver','C3B-RACE-'||n,'C3b race fixture',
    clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '10 minutes',
    clock_timestamp()-interval '1 minute'
  from generate_series(1,6) n;
  insert into public.every8d_settings_administrators(
    id,installation_id,installation_generation,normalized_email,email_pseudonym,
    enrollment_method,enrollment_grant_id
  ) select ('6b220000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    '6b200000-0000-4000-8000-000000000002',1,
    (array['requestfirst@example.com','resendrace@example.com',
      'deliveryrace@example.com','scrubresend@example.com',
      'rollbackresend@example.com','resendfirst@example.com'])[n],
    'k1:'||repeat(to_hex(n),64),'operator_initial',
    ('6b210000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
  from generate_series(1,6) n;
  insert into public.every8d_settings_enrollment_grants(
    id,token_hash,installation_id,installation_generation,method,
    pinned_normalized_email,operator_issuer,operator_approver,
    operator_case_reference,operator_reason,created_at,expires_at
  ) values
    ('6b230000-0000-4000-8000-000000000001',decode(repeat('71',32),'hex'),
      '6b200000-0000-4000-8000-000000000002',1,'operator_initial',
      'revoke-race@example.com','c3b-issuer','c3b-approver','C3B-REVOKE',
      'C3b revoke race',clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '12 minutes'),
    ('6b230000-0000-4000-8000-000000000002',decode(repeat('72',32),'hex'),
      '6b200000-0000-4000-8000-000000000002',1,'operator_initial',
      'consume-race@example.com','c3b-issuer','c3b-approver','C3B-CONSUME',
      'C3b consume race',clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '12 minutes'),
    ('6b230000-0000-4000-8000-000000000003',decode(repeat('73',32),'hex'),
      '6b200000-0000-4000-8000-000000000002',1,'operator_initial',
      'parent-order@example.com','c3b-issuer','c3b-approver','C3B-PARENT',
      'C3b parent ordering',clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '12 minutes'),
    ('6b230000-0000-4000-8000-000000000004',decode(repeat('74',32),'hex'),
      '6b200000-0000-4000-8000-000000000002',1,'operator_initial',
      'enroll-request-first@example.com','c3b-issuer','c3b-approver','C3B-ERF',
      'C3b enrollment request first',clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '12 minutes'),
    ('6b230000-0000-4000-8000-000000000005',decode(repeat('75',32),'hex'),
      '6b200000-0000-4000-8000-000000000002',1,'operator_initial',
      'enroll-rollback-first@example.com','c3b-issuer','c3b-approver','C3B-ERB',
      'C3b enrollment rollback first',clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '12 minutes'),
    ('6b230000-0000-4000-8000-000000000006',decode(repeat('76',32),'hex'),
      '6b200000-0000-4000-8000-000000000002',1,'operator_initial',
      'enroll-verify-first@example.com','c3b-issuer','c3b-approver','C3B-EVF',
      'C3b enrollment verification first',clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '12 minutes'),
    ('6b230000-0000-4000-8000-000000000007',decode(repeat('77',32),'hex'),
      '6b200000-0000-4000-8000-000000000002',1,'operator_initial',
      'enroll-verify-rollback@example.com','c3b-issuer','c3b-approver','C3B-EVR',
      'C3b enrollment verification rollback first',clock_timestamp()-interval '1 minute',
      clock_timestamp()+interval '12 minutes');"

# Rollback-first/login-request-second: hold the challenge relation so the real
# rollback is observable after parent locks and before C3b DDL.
blocker_app="${app_prefix}_rb_req_blocker"
rollback_app="${app_prefix}_rb_req_rollback"
request_app="${app_prefix}_rb_req_request"
psql_app "$blocker_app" -c "begin;lock table public.every8d_settings_auth_challenges
  in row share mode;select pg_sleep(90)" >"$tmp_dir/$blocker_app.out" \
  2>"$tmp_dir/$blocker_app.err" &
blocker_pid=$!; background_pids+=("$blocker_pid")
wait_for_backend "$blocker_app" "wait_event_type='Timeout' and wait_event='PgSleep'" \
  'rollback-first request child blocker' "$blocker_pid"
psql_app "$rollback_app" <"$rollback" >"$tmp_dir/$rollback_app.out" \
  2>"$tmp_dir/$rollback_app.err" &
rollback_pid=$!; background_pids+=("$rollback_pid")
blocker_backend=$(backend_pid "$blocker_app")
wait_for_backend "$rollback_app" "wait_event_type='Lock' and wait_event='relation'
  and $blocker_backend=any(pg_blocking_pids(pid))" \
  'rollback waiting after parent-first locks' "$rollback_pid"
rollback_backend=$(backend_pid "$rollback_app")
psql_app "$request_app" -Atqc "select count(*) from
  public.request_every8d_settings_login_challenge_v1('requestfirst@example.com',
  'k1:'||repeat('1',64),array['k1:'||repeat('1',64)],decode(repeat('91',32),'hex'),
  decode(repeat('92',32),'hex'),'otp-v1')" >"$tmp_dir/$request_app.out" \
  2>"$tmp_dir/$request_app.err" &
request_pid=$!; background_pids+=("$request_pid")
wait_for_backend "$request_app" "wait_event_type='Lock' and wait_event='relation'
  and $rollback_backend=any(pg_blocking_pids(pid))" \
  'login request blocked behind rollback parent lock' "$request_pid"
capture_lock_evidence 'rollback first / login request second'
terminate_app "$blocker_app"
wait_allow_failure "$blocker_pid" 'rollback-first request blocker exit'
wait_success "$rollback_pid" 'rollback-first rollback did not complete'
wait_capture_status "$request_pid" 'rollback-first login request exit'
request_status=$waited_status
[[ $request_status -ne 0 ]] || { echo 'FAIL: request survived completed rollback' >&2; exit 1; }
psql_owner_db "$database" <"$migration" >/dev/null

# Seed isolated rows for the remaining races. All direct challenge rows satisfy
# the same trigger/state constraints as RPC-created rows.
psql_owner_db "$database" -qc "
  insert into public.every8d_settings_auth_challenges(
    id,request_token_hash,purpose,enrollment_grant_id,normalized_email,
    email_pseudonym,otp_hmac,otp_hmac_key_version,created_at,expires_at
  ) values
    ('6b240000-0000-4000-8000-000000000101',decode(repeat('a1',32),'hex'),'login',null,
      'correct-correct@example.com','k1:'||repeat('a',64),decode(repeat('b1',32),'hex'),
      'otp-v1',statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes'),
    ('6b240000-0000-4000-8000-000000000102',decode(repeat('a2',32),'hex'),'login',null,
      'correct-wrong@example.com','k1:'||repeat('b',64),decode(repeat('b2',32),'hex'),
      'otp-v1',statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes'),
    ('6b240000-0000-4000-8000-000000000103',decode(repeat('a3',32),'hex'),'login',null,
      'correct-fifth@example.com','k1:'||repeat('c',64),decode(repeat('b3',32),'hex'),
      'otp-v1',statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes'),
    ('6b240000-0000-4000-8000-000000000104',decode(repeat('a4',32),'hex'),'enrollment',
      '6b230000-0000-4000-8000-000000000002','consume-race@example.com',
      'k1:'||repeat('d',64),decode(repeat('b4',32),'hex'),'otp-v1',
      statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes'),
    ('6b240000-0000-4000-8000-000000000105',decode(repeat('a5',32),'hex'),'login',null,
      'deliveryrace@example.com','k1:'||repeat('3',64),decode(repeat('b5',32),'hex'),
      'otp-v1',statement_timestamp()-interval '2 minutes',statement_timestamp()+interval '8 minutes'),
    ('6b240000-0000-4000-8000-000000000106',decode(repeat('a6',32),'hex'),'login',null,
      'cleanup-verify@example.com','k1:'||repeat('e',64),decode(repeat('b6',32),'hex'),
      'otp-v1',statement_timestamp()-interval '31 days 11 minutes',
      statement_timestamp()-interval '31 days 1 minute'),
    ('6b240000-0000-4000-8000-000000000110',decode(repeat('aa',32),'hex'),'login',null,
      'resendrace@example.com','k1:'||repeat('2',64),decode(repeat('ba',32),'hex'),
      'otp-v1',statement_timestamp()-interval '2 minutes',statement_timestamp()+interval '8 minutes'),
    ('6b240000-0000-4000-8000-000000000111',decode(repeat('ab',32),'hex'),'login',null,
      'rollbackresend@example.com','k1:'||repeat('5',64),decode(repeat('bb',32),'hex'),
      'otp-v1',statement_timestamp()-interval '2 minutes',statement_timestamp()+interval '8 minutes'),
    ('6b240000-0000-4000-8000-000000000112',decode(repeat('ac',32),'hex'),'login',null,
      'discovery@example.com','k1:'||repeat('8',64),decode(repeat('bc',32),'hex'),
      'otp-v1',statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes'),
    ('6b240000-0000-4000-8000-000000000114',decode(repeat('ae',32),'hex'),'login',null,
      'terminal@example.com','k1:'||repeat('7',64),decode(repeat('be',32),'hex'),
      'otp-v1',statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes'),
    ('6b240000-0000-4000-8000-000000000115',decode(repeat('af',32),'hex'),'login',null,
      'resendfirst@example.com','k1:'||repeat('6',64),decode(repeat('bf',32),'hex'),
      'otp-v1',statement_timestamp()-interval '2 minutes',statement_timestamp()+interval '8 minutes'),
    ('6b240000-0000-4000-8000-000000000116',decode(repeat('b0',32),'hex'),'enrollment',
      '6b230000-0000-4000-8000-000000000006','enroll-verify-first@example.com',
      'k1:'||repeat('2b',32),decode(repeat('c0',32),'hex'),'otp-v1',
      statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes'),
    ('6b240000-0000-4000-8000-000000000117',decode(repeat('b1',32),'hex'),'enrollment',
      '6b230000-0000-4000-8000-000000000007','enroll-verify-rollback@example.com',
      'k1:'||repeat('2c',32),decode(repeat('c1',32),'hex'),'otp-v1',
      statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes'),
    ('6b240000-0000-4000-8000-000000000118',decode(repeat('b2',32),'hex'),'login',null,
      'login-verify-first@example.com','k1:'||repeat('3a',32),decode(repeat('c2',32),'hex'),
      'otp-v1',statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes'),
    ('6b240000-0000-4000-8000-000000000119',decode(repeat('b3',32),'hex'),'login',null,
      'login-verify-rollback@example.com','k1:'||repeat('3b',32),decode(repeat('c3',32),'hex'),
      'otp-v1',statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes');
  update public.every8d_settings_auth_challenges
  set delivery_succeeded_at=created_at+interval '10 seconds'
  where id in (
    '6b240000-0000-4000-8000-000000000101',
    '6b240000-0000-4000-8000-000000000102',
    '6b240000-0000-4000-8000-000000000103',
    '6b240000-0000-4000-8000-000000000104',
    '6b240000-0000-4000-8000-000000000110',
    '6b240000-0000-4000-8000-000000000111',
    '6b240000-0000-4000-8000-000000000112',
    '6b240000-0000-4000-8000-000000000114',
    '6b240000-0000-4000-8000-000000000115',
    '6b240000-0000-4000-8000-000000000116',
    '6b240000-0000-4000-8000-000000000117',
    '6b240000-0000-4000-8000-000000000118',
    '6b240000-0000-4000-8000-000000000119'
  );
  insert into public.every8d_settings_auth_challenges(
    id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
    otp_hmac_key_version,created_at,expires_at
  ) values('6b240000-0000-4000-8000-000000000113',decode(repeat('ad',32),'hex'),'login',
    'scrubbed@example.com','k1:'||repeat('0',64),decode(repeat('bd',32),'hex'),'otp-v1',
    statement_timestamp()-interval '12 minutes',statement_timestamp()-interval '2 minutes');
  update public.every8d_settings_auth_challenges
  set normalized_email=null,email_scrubbed_at=clock_timestamp()
  where id='6b240000-0000-4000-8000-000000000113';
  update public.every8d_settings_auth_challenges set verified_at=clock_timestamp()
    where id='6b240000-0000-4000-8000-000000000114';
  insert into public.every8d_settings_auth_challenge_failures(
    challenge_id,attempt_number,failed_at)
  select '6b240000-0000-4000-8000-000000000103',n,
    clock_timestamp()-interval '40 seconds'+n*interval '1 second'
  from generate_series(1,4) n;"

# Remaining deterministic concurrency scenarios are below.

# 1. Simultaneous login resend: the first transaction wins; the second waits on
# the identity advisory lock and then observes the committed 60-second limit.
start_barrier "${app_prefix}_simresend_barrier" 991201 'simultaneous resend barrier'
first_app="${app_prefix}_simresend_first"
second_app="${app_prefix}_simresend_second"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select count(*) from public.request_every8d_settings_login_challenge_v1(
  'resendrace@example.com','k1:'||repeat('2',64),array['k1:'||repeat('2',64)],
  decode(repeat('c1',32),'hex'),decode(repeat('d1',32),'hex'),'otp-v1');
select pg_advisory_xact_lock(991201);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'first simultaneous resend holding identity authority' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app "$second_app" -Atqc "select count(*) from
  public.request_every8d_settings_login_challenge_v1('resendrace@example.com',
  'k1:'||repeat('2',64),array['k1:'||repeat('2',64)],decode(repeat('c2',32),'hex'),
  decode(repeat('d2',32),'hex'),'otp-v1')" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock' and wait_event='advisory'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'second simultaneous resend blocked by first' "$second_pid"
capture_lock_evidence 'simultaneous resend'
release_barrier
wait_success "$first_pid" 'first simultaneous resend failed'
wait_expected_failure "$second_pid" "$tmp_dir/$second_app.err" \
  'EVERY8D settings challenge rate limit exceeded' 'second simultaneous resend result'
assert_query "select
  (select supersession_reason='resend' from public.every8d_settings_auth_challenges
    where id='6b240000-0000-4000-8000-000000000110')
  and (select count(*)=1 from public.every8d_settings_auth_challenges
    where request_token_hash=decode(repeat('c1',32),'hex') and superseded_at is null)
  and not exists(select 1 from public.every8d_settings_auth_challenges
    where request_token_hash=decode(repeat('c2',32),'hex'))" \
  'simultaneous resend has one committed replacement'

# 2. Correct/correct verification: one verifier wins and the waiter returns
# generic false without appending a failure.
start_barrier "${app_prefix}_correct_correct_barrier" 991202 'correct/correct barrier'
first_app="${app_prefix}_correct_correct_first"
second_app="${app_prefix}_correct_correct_second"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000101',decode(repeat('a1',32),'hex'),
  'login',null,'correct-correct@example.com',array['k1:'||repeat('a',64)],
  decode(repeat('b1',32),'hex'));
select pg_advisory_xact_lock(991202);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'correct/correct first verifier' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app "$second_app" -Atqc "select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000101',decode(repeat('a1',32),'hex'),
  'login',null,'correct-correct@example.com',array['k1:'||repeat('a',64)],
  decode(repeat('b1',32),'hex'))" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock' and wait_event='advisory'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'correct/correct second verifier blocked' "$second_pid"
capture_lock_evidence 'correct OTP vs correct OTP'
release_barrier
wait_success "$first_pid" 'correct/correct first verifier failed'
wait_success "$second_pid" 'correct/correct second verifier failed'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$first_app.out")" == t ]]
[[ "$(tr -d '[:space:]' <"$tmp_dir/$second_app.out")" == f ]]
assert_query "select verified_at is not null and not exists(select 1
  from public.every8d_settings_auth_challenge_failures f where f.challenge_id=c.id)
  from public.every8d_settings_auth_challenges c
  where c.id='6b240000-0000-4000-8000-000000000101'" \
  'correct/correct has one winner and no failure'

# 3. Correct/wrong verification: the wrong contender cannot append after the
# correct result commits.
start_barrier "${app_prefix}_correct_wrong_barrier" 991203 'correct/wrong barrier'
first_app="${app_prefix}_correct_wrong_correct"
second_app="${app_prefix}_correct_wrong_wrong"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000102',decode(repeat('a2',32),'hex'),
  'login',null,'correct-wrong@example.com',array['k1:'||repeat('b',64)],
  decode(repeat('b2',32),'hex'));
select pg_advisory_xact_lock(991203);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'correct/wrong correct verifier' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app "$second_app" -Atqc "select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000102',decode(repeat('a2',32),'hex'),
  'login',null,'correct-wrong@example.com',array['k1:'||repeat('b',64)],
  decode(repeat('ff',32),'hex'))" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock' and wait_event='advisory'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'wrong verifier blocked by correct verifier' "$second_pid"
capture_lock_evidence 'correct OTP vs wrong OTP'
release_barrier
wait_success "$first_pid" 'correct/wrong correct verifier failed'
wait_success "$second_pid" 'correct/wrong wrong verifier failed'
assert_query "select verified_at is not null and not exists(select 1
  from public.every8d_settings_auth_challenge_failures f where f.challenge_id=c.id)
  from public.every8d_settings_auth_challenges c
  where c.id='6b240000-0000-4000-8000-000000000102'" \
  'correct/wrong preserves verified authority without failure'

# 4. Correct/fifth-failure: four committed failures remain, but the blocked
# fifth contender cannot lock a challenge after correct verification wins.
start_barrier "${app_prefix}_correct_fifth_barrier" 991204 'correct/fifth barrier'
first_app="${app_prefix}_correct_fifth_correct"
second_app="${app_prefix}_correct_fifth_wrong"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000103',decode(repeat('a3',32),'hex'),
  'login',null,'correct-fifth@example.com',array['k1:'||repeat('c',64)],
  decode(repeat('b3',32),'hex'));
select pg_advisory_xact_lock(991204);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'correct/fifth correct verifier' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app "$second_app" -Atqc "select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000103',decode(repeat('a3',32),'hex'),
  'login',null,'correct-fifth@example.com',array['k1:'||repeat('c',64)],
  decode(repeat('ff',32),'hex'))" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock' and wait_event='advisory'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'fifth failure blocked by correct verifier' "$second_pid"
capture_lock_evidence 'correct OTP vs fifth wrong attempt'
release_barrier
wait_success "$first_pid" 'correct/fifth correct verifier failed'
wait_success "$second_pid" 'correct/fifth wrong verifier failed'
assert_query "select verified_at is not null and locked_at is null
  and (select count(*)=4 from public.every8d_settings_auth_challenge_failures f
    where f.challenge_id=c.id)
  from public.every8d_settings_auth_challenges c
  where c.id='6b240000-0000-4000-8000-000000000103'" \
  'correct/fifth preserves four failures and verified winner'

# 5. Grant revocation versus enrollment request. The request holds the grant
# row through insert; revocation waits, then invalidates the committed sibling.
start_barrier "${app_prefix}_revoke_request_barrier" 991205 'revoke/request barrier'
first_app="${app_prefix}_revoke_request_request"
second_app="${app_prefix}_revoke_request_revoke"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select count(*) from public.request_every8d_settings_enrollment_challenge_v1(
  '6b230000-0000-4000-8000-000000000001','revoke-race@example.com',
  'k1:'||repeat('1a',32),array['k1:'||repeat('1a',32)],
  decode(repeat('c3',32),'hex'),decode(repeat('d3',32),'hex'),'otp-v1');
select pg_advisory_xact_lock(991205);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'enrollment request holding grant row' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app "$second_app" -Atqc "update public.every8d_settings_enrollment_grants
  set revoked_at=clock_timestamp(),revocation_reason='c3b_race'
  where id='6b230000-0000-4000-8000-000000000001' returning 1" \
  >"$tmp_dir/$second_app.out" 2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'grant revocation blocked by enrollment request' "$second_pid"
capture_lock_evidence 'grant revocation vs enrollment challenge request'
release_barrier
wait_success "$first_pid" 'enrollment request failed in revocation race'
wait_success "$second_pid" 'grant revocation failed after request'
assert_query "select g.revoked_at is not null and c.supersession_reason='grant_revoked'
  and c.normalized_email is null
  from public.every8d_settings_enrollment_grants g
  join public.every8d_settings_auth_challenges c on c.enrollment_grant_id=g.id
  where g.id='6b230000-0000-4000-8000-000000000001'" \
  'revocation supersedes the serialized request'

# 6. Grant consumption versus verification. Verification holds a grant SHARE
# lock; consumption waits and then preserves the verified winner.
start_barrier "${app_prefix}_consume_verify_barrier" 991206 'consume/verify barrier'
first_app="${app_prefix}_consume_verify_verify"
second_app="${app_prefix}_consume_verify_consume"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000104',decode(repeat('a4',32),'hex'),
  'enrollment','6b230000-0000-4000-8000-000000000002','consume-race@example.com',
  array['k1:'||repeat('d',64)],decode(repeat('b4',32),'hex'));
select pg_advisory_xact_lock(991206);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'verification holding grant share lock' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app "$second_app" -Atqc "update public.every8d_settings_enrollment_grants
  set consumed_at=clock_timestamp()
  where id='6b230000-0000-4000-8000-000000000002' returning 1" \
  >"$tmp_dir/$second_app.out" 2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'grant consumption blocked by verification' "$second_pid"
capture_lock_evidence 'grant consumption vs verification'
release_barrier
wait_success "$first_pid" 'enrollment verification failed'
wait_success "$second_pid" 'grant consumption failed'
assert_query "select g.consumed_at is not null and c.verified_at is not null
  and c.superseded_at is null and c.normalized_email is not null
  from public.every8d_settings_enrollment_grants g
  join public.every8d_settings_auth_challenges c on c.enrollment_grant_id=g.id
  where g.id='6b230000-0000-4000-8000-000000000002'" \
  'consumption preserves the verified winner'

# 7. Delivery recording versus resend. The resend reaches the exact old row and
# waits for delivery recording before superseding it and inserting replacement.
start_barrier "${app_prefix}_delivery_resend_barrier" 991207 'delivery/resend barrier'
first_app="${app_prefix}_delivery_resend_delivery"
second_app="${app_prefix}_delivery_resend_resend"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.record_every8d_settings_challenge_delivery_v1(
  decode(repeat('a5',32),'hex'),true,null);
select pg_advisory_xact_lock(991207);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'delivery result holding challenge row' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app "$second_app" -Atqc "select count(*) from
  public.request_every8d_settings_login_challenge_v1('deliveryrace@example.com',
  'k1:'||repeat('3',64),array['k1:'||repeat('3',64)],decode(repeat('c4',32),'hex'),
  decode(repeat('d4',32),'hex'),'otp-v1')" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'resend blocked by delivery result row lock' "$second_pid"
capture_lock_evidence 'delivery-result recording vs resend'
release_barrier
wait_success "$first_pid" 'delivery recording failed'
wait_success "$second_pid" 'resend after delivery failed'
assert_query "select delivery_succeeded_at is not null and supersession_reason='resend'
  from public.every8d_settings_auth_challenges
  where id='6b240000-0000-4000-8000-000000000105'" \
  'delivery result and resend serialize to delivered/superseded history'

# 8. Cleanup versus verification. Verification retains the expired row lock;
# SKIP LOCKED cleanup deterministically skips it, then deletes it after release.
start_barrier "${app_prefix}_cleanup_verify_barrier" 991208 'cleanup/verify barrier'
first_app="${app_prefix}_cleanup_verify_verify"
second_app="${app_prefix}_cleanup_verify_cleanup"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000106',decode(repeat('a6',32),'hex'),
  'login',null,'cleanup-verify@example.com',array['k1:'||repeat('e',64)],
  decode(repeat('b6',32),'hex'));
select pg_advisory_xact_lock(991208);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'expired verification holding cleanup candidate' "$first_pid"
psql_app "$second_app" -Atqc "select deleted_count from
  public.cleanup_every8d_settings_auth_challenges_v1(1)" \
  >"$tmp_dir/$second_app.out" 2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_process_exit "$second_pid" 'cleanup SKIP LOCKED completion'
wait_success "$second_pid" 'cleanup/verification skip-locked call failed'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$second_app.out")" == 0 ]]
capture_lock_evidence 'cleanup vs verification (SKIP LOCKED)'
release_barrier
wait_success "$first_pid" 'expired verification transaction failed'
assert_query "select deleted_count=1 from
  public.cleanup_every8d_settings_auth_challenges_v1(1)" \
  'cleanup deletes candidate after verification releases it'

# 9. Expiry scrub versus verification. Verification discovers the pre-scrub
# row, then blocks on the scrub update and returns false after revalidation.
psql_owner_db "$database" -qc "insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) values('6b240000-0000-4000-8000-000000000107',decode(repeat('a7',32),'hex'),
  'login','scrub-verify@example.com','k1:'||repeat('f',64),decode(repeat('b7',32),'hex'),
  'otp-v1',statement_timestamp()-interval '12 minutes',statement_timestamp()-interval '2 minutes')"
start_barrier "${app_prefix}_scrub_verify_barrier" 991209 'scrub/verify barrier'
first_app="${app_prefix}_scrub_verify_scrub"
second_app="${app_prefix}_scrub_verify_verify"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.scrub_expired_every8d_settings_challenge_emails_v1(1);
select pg_advisory_xact_lock(991209);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'expiry scrub holding challenge row' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app "$second_app" -Atqc "select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000107',decode(repeat('a7',32),'hex'),
  'login',null,'scrub-verify@example.com',array['k1:'||repeat('f',64)],
  decode(repeat('b7',32),'hex'))" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'verification blocked by expiry scrub' "$second_pid"
capture_lock_evidence 'expiry email scrub vs verification'
release_barrier
wait_success "$first_pid" 'expiry scrub failed'
wait_success "$second_pid" 'verification after scrub failed unexpectedly'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$second_app.out")" == f ]]
assert_query "select normalized_email is null and verified_at is null
  from public.every8d_settings_auth_challenges
  where id='6b240000-0000-4000-8000-000000000107'" \
  'scrubbed challenge cannot verify'

# 10. Expiry scrub versus resend. The expired row is outside resend mutation;
# the replacement completes while the scrub transaction remains open.
psql_owner_db "$database" -qc "insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) values('6b240000-0000-4000-8000-000000000108',decode(repeat('a8',32),'hex'),
  'login','scrubresend@example.com','k1:'||repeat('4',64),decode(repeat('b8',32),'hex'),
  'otp-v1',statement_timestamp()-interval '12 minutes',statement_timestamp()-interval '2 minutes')"
start_barrier "${app_prefix}_scrub_resend_barrier" 991210 'scrub/resend barrier'
first_app="${app_prefix}_scrub_resend_scrub"
second_app="${app_prefix}_scrub_resend_resend"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.scrub_expired_every8d_settings_challenge_emails_v1(1);
select pg_advisory_xact_lock(991210);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'scrub/resend scrub transaction' "$first_pid"
psql_app "$second_app" -Atqc "select count(*) from
  public.request_every8d_settings_login_challenge_v1('scrubresend@example.com',
  'k1:'||repeat('4',64),array['k1:'||repeat('4',64)],decode(repeat('c5',32),'hex'),
  decode(repeat('d5',32),'hex'),'otp-v1')" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_process_exit "$second_pid" 'resend independent of expired scrub row'
wait_success "$second_pid" 'resend during expiry scrub failed'
capture_lock_evidence 'expiry email scrub vs resend (nonblocking)'
release_barrier
wait_success "$first_pid" 'scrub/resend scrub failed'
assert_query "select exists(select 1 from public.every8d_settings_auth_challenges
    where request_token_hash=decode(repeat('c5',32),'hex'))
  and (select normalized_email is null from public.every8d_settings_auth_challenges
    where id='6b240000-0000-4000-8000-000000000108')" \
  'scrub and resend preserve both outcomes'

# 11. Expiry scrub versus cleanup. Cleanup SKIP LOCKED must not delete the row
# while scrub holds it, then may delete after scrub commits.
psql_owner_db "$database" -qc "insert into public.every8d_settings_auth_challenges(
  id,request_token_hash,purpose,normalized_email,email_pseudonym,otp_hmac,
  otp_hmac_key_version,created_at,expires_at
) values('6b240000-0000-4000-8000-000000000109',decode(repeat('a9',32),'hex'),
  'login','scrub-cleanup@example.com','k1:'||repeat('9',64),decode(repeat('b9',32),'hex'),
  'otp-v1',statement_timestamp()-interval '31 days 11 minutes',
  statement_timestamp()-interval '31 days 1 minute')"
start_barrier "${app_prefix}_scrub_cleanup_barrier" 991211 'scrub/cleanup barrier'
first_app="${app_prefix}_scrub_cleanup_scrub"
second_app="${app_prefix}_scrub_cleanup_cleanup"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.scrub_expired_every8d_settings_challenge_emails_v1(1);
select pg_advisory_xact_lock(991211);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'scrub/cleanup scrub transaction' "$first_pid"
psql_app "$second_app" -Atqc "select deleted_count from
  public.cleanup_every8d_settings_auth_challenges_v1(1)" \
  >"$tmp_dir/$second_app.out" 2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_process_exit "$second_pid" 'cleanup skip locked scrub row'
wait_success "$second_pid" 'cleanup during scrub failed'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$second_app.out")" == 0 ]]
capture_lock_evidence 'expiry email scrub vs cleanup (SKIP LOCKED)'
release_barrier
wait_success "$first_pid" 'scrub/cleanup scrub failed'
assert_query "select deleted_count=1 from
  public.cleanup_every8d_settings_auth_challenges_v1(1)" \
  'cleanup deletes scrubbed history after release'

# 12. Login request first / rollback second. The request holds the parent
# relation hierarchy; rollback waits at its first ACCESS EXCLUSIVE lock and then
# refuses on the populated guard after the request commits.
start_barrier "${app_prefix}_request_rb_barrier" 991212 'request/rollback barrier'
first_app="${app_prefix}_request_rb_request"
second_app="${app_prefix}_request_rb_rollback"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select count(*) from public.request_every8d_settings_login_challenge_v1(
  'requestfirst@example.com','k1:'||repeat('1',64),array['k1:'||repeat('1',64)],
  decode(repeat('c6',32),'hex'),decode(repeat('d6',32),'hex'),'otp-v1');
select pg_advisory_xact_lock(991212);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'login request holding parent relations' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app "$second_app" <"$rollback" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock' and wait_event='relation'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'rollback blocked by login request' "$second_pid"
capture_lock_evidence 'login request first / rollback second'
release_barrier
wait_success "$first_pid" 'login request before rollback failed'
wait_expected_failure "$second_pid" "$tmp_dir/$second_app.err" \
  'C3b-1 rollback refused: challenge rows exist' 'rollback after login request'
assert_query "select exists(select 1 from public.every8d_settings_auth_challenges
  where request_token_hash=decode(repeat('c6',32),'hex'))" \
  'login request commits before guarded rollback refusal'

# 13 was proved before fixture seeding: rollback first / login request second.

# 14. Login resend first / rollback second.
start_barrier "${app_prefix}_resend_rb_barrier" 991214 'resend/rollback barrier'
first_app="${app_prefix}_resend_rb_resend"
second_app="${app_prefix}_resend_rb_rollback"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select count(*) from public.request_every8d_settings_login_challenge_v1(
  'resendfirst@example.com','k1:'||repeat('6',64),array['k1:'||repeat('6',64)],
  decode(repeat('c7',32),'hex'),decode(repeat('d7',32),'hex'),'otp-v1');
select pg_advisory_xact_lock(991214);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'login resend holding parent relations' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app "$second_app" <"$rollback" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock' and wait_event='relation'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'rollback blocked by login resend' "$second_pid"
capture_lock_evidence 'login resend first / rollback second'
release_barrier
wait_success "$first_pid" 'login resend before rollback failed'
wait_expected_failure "$second_pid" "$tmp_dir/$second_app.err" \
  'C3b-1 rollback refused: challenge rows exist' 'rollback after login resend'
assert_query "select
  (select supersession_reason='resend' from public.every8d_settings_auth_challenges
    where id='6b240000-0000-4000-8000-000000000115')
  and exists(select 1 from public.every8d_settings_auth_challenges
    where request_token_hash=decode(repeat('c7',32),'hex'))" \
  'resend commits before guarded rollback refusal'

# 15. Rollback first / login resend second. A child relation blocker pauses the
# real rollback after it owns all parent locks. The resend waits on the parent;
# populated guard then rolls rollback back and the resend succeeds.
blocker_app="${app_prefix}_rb_resend_blocker"
rollback_app="${app_prefix}_rb_resend_rollback"
request_app="${app_prefix}_rb_resend_resend"
psql_app "$blocker_app" -c "begin;lock table public.every8d_settings_auth_challenges
  in row share mode;select pg_sleep(90)" >"$tmp_dir/$blocker_app.out" \
  2>"$tmp_dir/$blocker_app.err" &
blocker_pid=$!; background_pids+=("$blocker_pid")
wait_for_backend "$blocker_app" "wait_event_type='Timeout' and wait_event='PgSleep'" \
  'rollback-first resend child blocker' "$blocker_pid"
psql_app "$rollback_app" <"$rollback" >"$tmp_dir/$rollback_app.out" \
  2>"$tmp_dir/$rollback_app.err" &
rollback_pid=$!; background_pids+=("$rollback_pid")
blocker_backend=$(backend_pid "$blocker_app")
wait_for_backend "$rollback_app" "wait_event_type='Lock' and wait_event='relation'
  and $blocker_backend=any(pg_blocking_pids(pid))" \
  'rollback-first resend waits at child after parent locks' "$rollback_pid"
rollback_backend=$(backend_pid "$rollback_app")
psql_app "$request_app" -Atqc "select count(*) from
  public.request_every8d_settings_login_challenge_v1('rollbackresend@example.com',
  'k1:'||repeat('5',64),array['k1:'||repeat('5',64)],decode(repeat('c8',32),'hex'),
  decode(repeat('d8',32),'hex'),'otp-v1')" >"$tmp_dir/$request_app.out" \
  2>"$tmp_dir/$request_app.err" &
request_pid=$!; background_pids+=("$request_pid")
wait_for_backend "$request_app" "wait_event_type='Lock' and wait_event='relation'
  and $rollback_backend=any(pg_blocking_pids(pid))" \
  'login resend blocked behind rollback parent lock' "$request_pid"
capture_lock_evidence 'rollback first / login resend second'
terminate_app "$blocker_app"
wait_allow_failure "$blocker_pid" 'rollback-first resend blocker exit'
wait_expected_failure "$rollback_pid" "$tmp_dir/$rollback_app.err" \
  'C3b-1 rollback refused: challenge rows exist' 'rollback-first populated guard'
wait_success "$request_pid" 'login resend after rollback refusal failed'
assert_query "select exists(select 1 from public.every8d_settings_auth_challenges
  where request_token_hash=decode(repeat('c8',32),'hex'))" \
  'login resend proceeds only after rollback releases parent locks'

# 16. Request-hash discovery is one autocommit statement. Keep the same backend
# connected through a FIFO, prove it is idle with no challenge relation lock,
# then prove later parent access can block without re-acquiring the child.
discovery_app="${app_prefix}_discovery_client"
parent_app="${app_prefix}_discovery_parent"
discovery_fifo="$tmp_dir/discovery.fifo"
mkfifo "$discovery_fifo"
psql_app "$discovery_app" -Atq <"$discovery_fifo" >"$tmp_dir/$discovery_app.out" \
  2>"$tmp_dir/$discovery_app.err" &
discovery_pid=$!; background_pids+=("$discovery_pid")
exec 3>"$discovery_fifo"
printf '%s\n' "select count(*) from public.discover_every8d_settings_challenge_v1(
  decode(repeat('ac',32),'hex'),'login');" >&3
wait_for_backend "$discovery_app" "state='idle'" \
  'discovery autocommit release point' "$discovery_pid"
discovery_backend=$(backend_pid "$discovery_app")
assert_query "select not exists(select 1 from pg_locks
  where pid=$discovery_backend and relation=
    'public.every8d_settings_auth_challenges'::regclass)" \
  'discovery releases challenge relation lock at autocommit'
psql_app "$parent_app" -Atq <<'SQL' >"$tmp_dir/$parent_app.out" 2>"$tmp_dir/$parent_app.err" &
begin;
lock table public.ghl_marketplace_installations in access exclusive mode;
select pg_sleep(90);
SQL
parent_pid=$!; background_pids+=("$parent_pid")
wait_for_backend "$parent_app" "wait_event_type='Timeout' and wait_event='PgSleep'" \
  'discovery parent blocker' "$parent_pid"
parent_backend=$(backend_pid "$parent_app")
printf '%s\n' 'begin; lock table public.ghl_marketplace_installations in row share mode;' >&3
wait_for_backend "$discovery_app" "wait_event_type='Lock' and wait_event='relation'
  and $parent_backend=any(pg_blocking_pids(pid))" \
  'post-discovery parent access blocked' "$discovery_pid"
assert_query "select not exists(select 1 from pg_locks
  where pid=$discovery_backend and relation=
    'public.every8d_settings_auth_challenges'::regclass)" \
  'post-discovery parent wait holds no child relation lock'
capture_lock_evidence 'request discovery lock release before parent access'
terminate_app "$parent_app"
wait_allow_failure "$parent_pid" 'discovery parent blocker exit'
printf '%s\n' 'rollback;' '\q' >&3
exec 3>&-
wait_success "$discovery_pid" 'discovery FIFO session failed'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$discovery_app.out")" == 1 ]]

# 17. Unknown, scrubbed, and terminal handles return no identity and acquire no
# advisory authority. Keep each discovery transaction observable during PgSleep.
assert_query "select
  (select count(*)=0 from public.discover_every8d_settings_challenge_v1(
    decode(repeat('ff',32),'hex'),'login'))
  and (select count(*)=0 from public.discover_every8d_settings_challenge_v1(
    decode(repeat('ad',32),'hex'),'login'))
  and (select count(*)=0 from public.discover_every8d_settings_challenge_v1(
    decode(repeat('ae',32),'hex'),'login'))" \
  'unknown, scrubbed, and terminal handles disclose no identity'
declare -a authority_apps=()
declare -a authority_shell_pids=()
for authority_case in unknown scrubbed terminal; do
  authority_app="${app_prefix}_noauthority_${authority_case}"
  case "$authority_case" in
    unknown) authority_hash=ff;;
    scrubbed) authority_hash=ad;;
    terminal) authority_hash=ae;;
  esac
  psql_app "$authority_app" -Atqc "begin;select count(*) from
    public.discover_every8d_settings_challenge_v1(
      decode(repeat('$authority_hash',32),'hex'),'login');select pg_sleep(90)" \
    >"$tmp_dir/$authority_app.out" 2>"$tmp_dir/$authority_app.err" &
  authority_pid=$!; background_pids+=("$authority_pid")
  authority_apps+=("$authority_app")
  authority_shell_pids+=("$authority_pid")
  wait_for_backend "$authority_app" "wait_event_type='Timeout' and wait_event='PgSleep'" \
    "$authority_case no-authority observation" "$authority_pid"
done
assert_query "select not exists(select 1 from pg_locks l
  join pg_stat_activity a on a.pid=l.pid
  where a.application_name like '${app_prefix}\_noauthority\_%' escape '\\'
    and l.locktype='advisory')" \
  'non-usable handles acquire no advisory locks'
capture_lock_evidence 'unknown/scrubbed/terminal handle no authority'
for authority_index in "${!authority_apps[@]}"; do
  terminate_app "${authority_apps[$authority_index]}"
  wait_allow_failure "${authority_shell_pids[$authority_index]}" \
    'no-authority observer exit'
done

# 18. Parent-first enrollment ordering. The request blocks on the installation
# row before locking the grant, so a grant revocation completes independently.
parent_app="${app_prefix}_parent_order_parent"
request_app="${app_prefix}_parent_order_request"
grant_app="${app_prefix}_parent_order_grant"
psql_app "$parent_app" -Atq <<'SQL' >"$tmp_dir/$parent_app.out" 2>"$tmp_dir/$parent_app.err" &
begin;
select id from public.ghl_marketplace_installations
where id='6b200000-0000-4000-8000-000000000002' for update;
select pg_sleep(90);
SQL
parent_pid=$!; background_pids+=("$parent_pid")
wait_for_backend "$parent_app" "wait_event_type='Timeout' and wait_event='PgSleep'" \
  'parent-first installation blocker' "$parent_pid"
parent_backend=$(backend_pid "$parent_app")
psql_app "$request_app" -Atqc "select count(*) from
  public.request_every8d_settings_enrollment_challenge_v1(
  '6b230000-0000-4000-8000-000000000003','parent-order@example.com',
  'k1:'||repeat('2a',32),array['k1:'||repeat('2a',32)],decode(repeat('c9',32),'hex'),
  decode(repeat('d9',32),'hex'),'otp-v1')" >"$tmp_dir/$request_app.out" \
  2>"$tmp_dir/$request_app.err" &
request_pid=$!; background_pids+=("$request_pid")
wait_for_backend "$request_app" "wait_event_type='Lock'
  and $parent_backend=any(pg_blocking_pids(pid))" \
  'enrollment request blocked at installation parent' "$request_pid"
psql_app "$grant_app" -Atqc "update public.every8d_settings_enrollment_grants
  set revoked_at=clock_timestamp(),revocation_reason='c3b_parent_order'
  where id='6b230000-0000-4000-8000-000000000003' returning 1" \
  >"$tmp_dir/$grant_app.out" 2>"$tmp_dir/$grant_app.err" &
grant_pid=$!; background_pids+=("$grant_pid")
wait_for_process_exit "$grant_pid" 'grant update while request waits on parent'
wait_success "$grant_pid" 'grant update was blocked behind child ordering'
capture_lock_evidence 'grant lifecycle parent-first ordering'
terminate_app "$parent_app"
wait_allow_failure "$parent_pid" 'parent-order blocker exit'
wait_expected_failure "$request_pid" "$tmp_dir/$request_app.err" \
  'EVERY8D enrollment grant is not usable' 'request revalidation after parent release'
assert_query "select revoked_at is not null from public.every8d_settings_enrollment_grants
  where id='6b230000-0000-4000-8000-000000000003'" \
  'parent-first request permits independent grant transition before child lock'

# 19. Enrollment request first / rollback second. The completed request mutation
# holds the explicit installation-first relation hierarchy until commit.
start_barrier "${app_prefix}_enreq_rb_barrier" 991219 \
  'enrollment request/rollback barrier'
first_app="${app_prefix}_enreq_rb_request"
second_app="${app_prefix}_enreq_rb_rollback"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select count(*) from public.request_every8d_settings_enrollment_challenge_v1(
  '6b230000-0000-4000-8000-000000000004','enroll-request-first@example.com',
  'k1:'||repeat('2d',32),array['k1:'||repeat('2d',32)],decode(repeat('d0',32),'hex'),
  decode(repeat('e0',32),'hex'),'otp-v1');
select pg_advisory_xact_lock(991219);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'enrollment request holding parent-first relations' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app "$second_app" <"$rollback" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock' and wait_event='relation'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'rollback blocked by enrollment request' "$second_pid"
capture_lock_evidence 'enrollment request first / rollback second'
release_barrier
wait_success "$first_pid" 'enrollment request before rollback failed'
wait_expected_failure "$second_pid" "$tmp_dir/$second_app.err" \
  'C3b-1 rollback refused: challenge rows exist' 'rollback after enrollment request'
assert_query "select exists(select 1 from public.every8d_settings_auth_challenges
  where request_token_hash=decode(repeat('d0',32),'hex'))" \
  'enrollment request commits before rollback refusal'

# 20. Rollback first / enrollment request second. A challenge relation blocker
# pauses rollback after its parent locks; the request blocks on installations
# without first retaining a grant/challenge relation lock.
blocker_app="${app_prefix}_rb_enreq_blocker"
rollback_app="${app_prefix}_rb_enreq_rollback"
request_app="${app_prefix}_rb_enreq_request"
psql_app "$blocker_app" -c "begin;lock table public.every8d_settings_auth_challenges
  in row share mode;select pg_sleep(90)" >"$tmp_dir/$blocker_app.out" \
  2>"$tmp_dir/$blocker_app.err" &
blocker_pid=$!; background_pids+=("$blocker_pid")
wait_for_backend "$blocker_app" "wait_event_type='Timeout' and wait_event='PgSleep'" \
  'rollback-first enrollment request child blocker' "$blocker_pid"
psql_app "$rollback_app" <"$rollback" >"$tmp_dir/$rollback_app.out" \
  2>"$tmp_dir/$rollback_app.err" &
rollback_pid=$!; background_pids+=("$rollback_pid")
blocker_backend=$(backend_pid "$blocker_app")
wait_for_backend "$rollback_app" "wait_event_type='Lock' and wait_event='relation'
  and $blocker_backend=any(pg_blocking_pids(pid))" \
  'rollback-first enrollment request waits after parent locks' "$rollback_pid"
rollback_backend=$(backend_pid "$rollback_app")
psql_app "$request_app" -Atqc "select count(*) from
  public.request_every8d_settings_enrollment_challenge_v1(
  '6b230000-0000-4000-8000-000000000005','enroll-rollback-first@example.com',
  'k1:'||repeat('2e',32),array['k1:'||repeat('2e',32)],decode(repeat('d1',32),'hex'),
  decode(repeat('e1',32),'hex'),'otp-v1')" >"$tmp_dir/$request_app.out" \
  2>"$tmp_dir/$request_app.err" &
request_pid=$!; background_pids+=("$request_pid")
wait_for_backend "$request_app" "wait_event_type='Lock' and wait_event='relation'
  and $rollback_backend=any(pg_blocking_pids(pid))" \
  'enrollment request blocked at rollback installation lock' "$request_pid"
request_backend=$(backend_pid "$request_app")
assert_query "select exists(select 1 from pg_locks where pid=$request_backend
    and not granted and relation='public.ghl_marketplace_installations'::regclass
    and mode='RowShareLock')
  and not exists(select 1 from pg_locks where pid=$request_backend
  and relation in ('public.every8d_settings_enrollment_grants'::regclass,
    'public.every8d_settings_auth_challenges'::regclass,
    'public.every8d_settings_auth_challenge_failures'::regclass))" \
  'blocked enrollment request waits at parent and has no child relation lock'
capture_lock_evidence 'rollback first / enrollment request second'
terminate_app "$blocker_app"
wait_allow_failure "$blocker_pid" 'rollback-first enrollment request blocker exit'
wait_expected_failure "$rollback_pid" "$tmp_dir/$rollback_app.err" \
  'C3b-1 rollback refused: challenge rows exist' 'rollback before enrollment request'
wait_success "$request_pid" 'enrollment request after rollback refusal failed'
assert_query "select exists(select 1 from public.every8d_settings_auth_challenges
  where request_token_hash=decode(repeat('d1',32),'hex'))" \
  'enrollment request proceeds after rollback releases parent locks'

# 21. Enrollment verification first / rollback second. Discovery is a separate
# committed statement; only the parent-first mutation remains open.
verify_discovery_app="${app_prefix}_enverify_rb_discovery"
psql_app "$verify_discovery_app" -Atqc "select count(*) from
  public.discover_every8d_settings_challenge_v1(decode(repeat('b0',32),'hex'),'enrollment')" \
  >"$tmp_dir/$verify_discovery_app.out" 2>"$tmp_dir/$verify_discovery_app.err"
[[ "$(tr -d '[:space:]' <"$tmp_dir/$verify_discovery_app.out")" == 1 ]]
start_barrier "${app_prefix}_enverify_rb_barrier" 991221 \
  'enrollment verification/rollback barrier'
first_app="${app_prefix}_enverify_rb_verify"
second_app="${app_prefix}_enverify_rb_rollback"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000116',decode(repeat('b0',32),'hex'),
  'enrollment','6b230000-0000-4000-8000-000000000006',
  'enroll-verify-first@example.com',array['k1:'||repeat('2b',32)],
  decode(repeat('c0',32),'hex'));
select pg_advisory_xact_lock(991221);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'enrollment verification holding parent-first relations' "$first_pid"
first_backend=$(backend_pid "$first_app")
psql_app "$second_app" <"$rollback" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock' and wait_event='relation'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'rollback blocked by enrollment verification' "$second_pid"
capture_lock_evidence 'enrollment verification first / rollback second'
release_barrier
wait_success "$first_pid" 'enrollment verification before rollback failed'
wait_expected_failure "$second_pid" "$tmp_dir/$second_app.err" \
  'C3b-1 rollback refused: challenge rows exist' 'rollback after enrollment verification'
assert_query "select verified_at is not null from public.every8d_settings_auth_challenges
  where id='6b240000-0000-4000-8000-000000000116'" \
  'enrollment verification commits before rollback refusal'

# 22. Rollback first / enrollment verification second. Discovery completes
# before rollback starts; the mutation then blocks at installations and holds no
# child relation lock while rollback owns the parent hierarchy.
verify_discovery_app="${app_prefix}_rb_enverify_discovery"
psql_app "$verify_discovery_app" -Atqc "select count(*) from
  public.discover_every8d_settings_challenge_v1(decode(repeat('b1',32),'hex'),'enrollment')" \
  >"$tmp_dir/$verify_discovery_app.out" 2>"$tmp_dir/$verify_discovery_app.err"
[[ "$(tr -d '[:space:]' <"$tmp_dir/$verify_discovery_app.out")" == 1 ]]
blocker_app="${app_prefix}_rb_enverify_blocker"
rollback_app="${app_prefix}_rb_enverify_rollback"
verify_app="${app_prefix}_rb_enverify_verify"
psql_app "$blocker_app" -c "begin;lock table public.every8d_settings_auth_challenges
  in row share mode;select pg_sleep(90)" >"$tmp_dir/$blocker_app.out" \
  2>"$tmp_dir/$blocker_app.err" &
blocker_pid=$!; background_pids+=("$blocker_pid")
wait_for_backend "$blocker_app" "wait_event_type='Timeout' and wait_event='PgSleep'" \
  'rollback-first enrollment verification child blocker' "$blocker_pid"
psql_app "$rollback_app" <"$rollback" >"$tmp_dir/$rollback_app.out" \
  2>"$tmp_dir/$rollback_app.err" &
rollback_pid=$!; background_pids+=("$rollback_pid")
blocker_backend=$(backend_pid "$blocker_app")
wait_for_backend "$rollback_app" "wait_event_type='Lock' and wait_event='relation'
  and $blocker_backend=any(pg_blocking_pids(pid))" \
  'rollback-first enrollment verification waits after parent locks' "$rollback_pid"
rollback_backend=$(backend_pid "$rollback_app")
psql_app "$verify_app" -Atqc "select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000117',decode(repeat('b1',32),'hex'),
  'enrollment','6b230000-0000-4000-8000-000000000007',
  'enroll-verify-rollback@example.com',array['k1:'||repeat('2c',32)],
  decode(repeat('c1',32),'hex'))" >"$tmp_dir/$verify_app.out" \
  2>"$tmp_dir/$verify_app.err" &
verify_pid=$!; background_pids+=("$verify_pid")
wait_for_backend "$verify_app" "wait_event_type='Lock' and wait_event='relation'
  and $rollback_backend=any(pg_blocking_pids(pid))" \
  'enrollment verification blocked at rollback installation lock' "$verify_pid"
verify_backend=$(backend_pid "$verify_app")
assert_query "select exists(select 1 from pg_locks where pid=$verify_backend
    and not granted and relation='public.ghl_marketplace_installations'::regclass
    and mode='RowShareLock')
  and not exists(select 1 from pg_locks where pid=$verify_backend
  and relation in ('public.every8d_settings_enrollment_grants'::regclass,
    'public.every8d_settings_auth_challenges'::regclass,
    'public.every8d_settings_auth_challenge_failures'::regclass))" \
  'blocked enrollment verification waits at parent and has no child relation lock'
capture_lock_evidence 'rollback first / enrollment verification second'
terminate_app "$blocker_app"
wait_allow_failure "$blocker_pid" 'rollback-first enrollment verification blocker exit'
wait_expected_failure "$rollback_pid" "$tmp_dir/$rollback_app.err" \
  'C3b-1 rollback refused: challenge rows exist' 'rollback before enrollment verification'
wait_success "$verify_pid" 'enrollment verification after rollback refusal failed'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$verify_app.out")" == t ]]
assert_query "select verified_at is not null from public.every8d_settings_auth_challenges
  where id='6b240000-0000-4000-8000-000000000117'" \
  'enrollment verification proceeds after rollback releases parent locks'

# 23. Fresh-backend login verification first / rollback second. The real login
# primitive fires challenge protection, then pauses on an advisory barrier while
# holding only its legitimate challenge/failure relation state. Rollback must
# pass the grants lock and wait at challenges; any trigger-time grants dependency
# fails the explicit lock assertion.
start_barrier "${app_prefix}_loginverify_rb_barrier" 991223 \
  'login verification/rollback barrier'
first_app="${app_prefix}_loginverify_rb_verify"
second_app="${app_prefix}_loginverify_rb_rollback"
psql_app "$first_app" -Atq <<'SQL' >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
begin;
select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000118',decode(repeat('b2',32),'hex'),
  'login',null,'login-verify-first@example.com',array['k1:'||repeat('3a',32)],
  decode(repeat('c2',32),'hex'));
select pg_advisory_xact_lock(991223);
commit;
SQL
first_pid=$!; background_pids+=("$first_pid")
wait_for_backend "$first_app" "wait_event_type='Lock' and wait_event='advisory'" \
  'fresh login verification holding challenge state' "$first_pid"
first_backend=$(backend_pid "$first_app")
assert_query "select exists(select 1 from pg_stat_activity
    where pid=$first_backend and application_name='$first_app'
      and backend_start>clock_timestamp()-interval '1 minute')
  and not exists(select 1 from pg_locks where pid=$first_backend
    and relation='public.every8d_settings_enrollment_grants'::regclass)" \
  'fresh login verifier acquires no enrollment-grants relation lock'
psql_app "$second_app" <"$rollback" >"$tmp_dir/$second_app.out" \
  2>"$tmp_dir/$second_app.err" &
second_pid=$!; background_pids+=("$second_pid")
wait_for_backend "$second_app" "wait_event_type='Lock' and wait_event='relation'
  and $first_backend=any(pg_blocking_pids(pid))" \
  'rollback passes grants and waits on fresh login verification challenge lock' "$second_pid"
second_backend=$(backend_pid "$second_app")
assert_query "select exists(select 1 from pg_locks
    where pid=$second_backend and granted
      and relation='public.every8d_settings_enrollment_grants'::regclass
      and mode='AccessExclusiveLock')
  and exists(select 1 from pg_locks
    where pid=$second_backend and not granted
      and relation='public.every8d_settings_auth_challenges'::regclass
      and mode='AccessExclusiveLock')" \
  'rollback owns grants and waits at challenges behind login verification'
capture_lock_evidence 'fresh login verification first / rollback second'
release_barrier
wait_success "$first_pid" 'fresh login verification before rollback failed'
wait_expected_failure "$second_pid" "$tmp_dir/$second_app.err" \
  'C3b-1 rollback refused: challenge rows exist' 'rollback after fresh login verification'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$first_app.out")" == t ]]
assert_query "select verified_at is not null from public.every8d_settings_auth_challenges
  where id='6b240000-0000-4000-8000-000000000118'" \
  'fresh login verification commits before rollback refusal'

# 24. Rollback first / fresh-backend login verification second. A challenge
# blocker pauses rollback after it owns the parent-first grants lock. The real
# login primitive must wait at challenges without ever touching grants; after
# the populated rollback refuses, verification proceeds normally.
blocker_app="${app_prefix}_rb_loginverify_blocker"
rollback_app="${app_prefix}_rb_loginverify_rollback"
verify_app="${app_prefix}_rb_loginverify_verify"
psql_app "$blocker_app" -c "begin;lock table public.every8d_settings_auth_challenges
  in row share mode;select pg_sleep(90)" >"$tmp_dir/$blocker_app.out" \
  2>"$tmp_dir/$blocker_app.err" &
blocker_pid=$!; background_pids+=("$blocker_pid")
wait_for_backend "$blocker_app" "wait_event_type='Timeout' and wait_event='PgSleep'" \
  'rollback-first login verification child blocker' "$blocker_pid"
psql_app "$rollback_app" <"$rollback" >"$tmp_dir/$rollback_app.out" \
  2>"$tmp_dir/$rollback_app.err" &
rollback_pid=$!; background_pids+=("$rollback_pid")
blocker_backend=$(backend_pid "$blocker_app")
wait_for_backend "$rollback_app" "wait_event_type='Lock' and wait_event='relation'
  and $blocker_backend=any(pg_blocking_pids(pid))" \
  'rollback-first login verification waits after parent locks' "$rollback_pid"
rollback_backend=$(backend_pid "$rollback_app")
psql_app "$verify_app" -Atqc "select public.verify_every8d_settings_challenge_v1(
  '6b240000-0000-4000-8000-000000000119',decode(repeat('b3',32),'hex'),
  'login',null,'login-verify-rollback@example.com',array['k1:'||repeat('3b',32)],
  decode(repeat('c3',32),'hex'))" >"$tmp_dir/$verify_app.out" \
  2>"$tmp_dir/$verify_app.err" &
verify_pid=$!; background_pids+=("$verify_pid")
wait_for_backend "$verify_app" "wait_event_type='Lock' and wait_event='relation'
  and $rollback_backend=any(pg_blocking_pids(pid))" \
  'fresh login verification waits behind rollback at challenges' "$verify_pid"
verify_backend=$(backend_pid "$verify_app")
assert_query "select exists(select 1 from pg_stat_activity
    where pid=$verify_backend and application_name='$verify_app'
      and backend_start>clock_timestamp()-interval '1 minute')
  and exists(select 1 from pg_locks where pid=$verify_backend and not granted
    and relation='public.every8d_settings_auth_challenges'::regclass
    and mode='RowExclusiveLock')
  and not exists(select 1 from pg_locks where pid=$verify_backend
    and relation='public.every8d_settings_enrollment_grants'::regclass)" \
  'fresh login verifier waits at challenges with no grants relation dependency'
capture_lock_evidence 'rollback first / fresh login verification second'
terminate_app "$blocker_app"
wait_allow_failure "$blocker_pid" 'rollback-first login verification blocker exit'
wait_expected_failure "$rollback_pid" "$tmp_dir/$rollback_app.err" \
  'C3b-1 rollback refused: challenge rows exist' 'rollback before fresh login verification'
wait_success "$verify_pid" 'fresh login verification after rollback refusal failed'
[[ "$(tr -d '[:space:]' <"$tmp_dir/$verify_app.out")" == t ]]
assert_query "select verified_at is not null from public.every8d_settings_auth_challenges
  where id='6b240000-0000-4000-8000-000000000119'" \
  'fresh login verification proceeds after rollback releases challenge locks'

# Populated rollback must refuse before any destructive DDL.
expect_failure 'C3b-1 rollback refused: challenge rows exist' populated_rollback \
  psql_owner_db "$database" <"$rollback"
assert_query "select to_regclass('public.every8d_settings_auth_challenges') is not null
  and to_regclass('public.every8d_settings_administrators') is not null
  and exists(select 1 from public.every8d_settings_auth_challenges)" \
  'populated rollback preserves C3b and C3a'

# Remove every harness-owned C3b row child-first under the private cleanup flag,
# then prove empty guarded rollback and reapplication.
psql_owner_db "$database" -qc "
  begin;
  select set_config('wincrm.c3b_cleanup','on',true);
  delete from public.every8d_settings_auth_challenge_failures;
  delete from public.every8d_settings_auth_challenges;
  commit;"
assert_query "select not exists(select 1 from public.every8d_settings_auth_challenges)
  and not exists(select 1 from public.every8d_settings_auth_challenge_failures)" \
  'cleanup removed all race fixtures child-first'
psql_owner_db "$database" <"$rollback" >/dev/null
assert_query "select to_regclass('public.every8d_settings_auth_challenges') is null
  and to_regclass('public.every8d_settings_administrators') is not null
  and to_regclass('public.every8d_provider_configurations') is not null
  and to_regclass('public.ghl_marketplace_oauth_bootstraps') is not null" \
  'empty rollback removes only C3b objects'
psql_owner_db "$database" <"$migration" >/dev/null

remaining=$(psql_db "$database" -Atqc "select count(*) from pg_stat_activity
  where application_name like '${app_prefix}\_%' escape '\\'" | tr -d '\r')
[[ "$remaining" == 0 ]] || { echo "FAIL: $remaining C3b test backends remain" >&2; exit 1; }
echo 'EVERY8D C3b-1 complete PostgreSQL 17 proof and frozen concurrency matrix passed'
