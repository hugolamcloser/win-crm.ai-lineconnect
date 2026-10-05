#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly database=wincrm_test
readonly migration=supabase/migrations/202610020001_every8d_settings_auth_foundation.sql
readonly rollback=supabase/rollback/202610020001_every8d_settings_auth_foundation.sql
readonly proof=test/postgres/every8dSettingsAuthFoundation.sql
readonly backend_wait_timeout_seconds=30
readonly barrier_safety_timeout_seconds=90
tmp_dir=$(mktemp -d)
declare -a background_pids=()

psql_query() {
  docker exec -i "$POSTGRES_CONTAINER_ID" \
    psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$database" "$@"
}

psql_app() {
  local application_name=$1
  shift
  docker exec -e "PGAPPNAME=$application_name" -i "$POSTGRES_CONTAINER_ID" \
    psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$database" "$@"
}

cleanup() {
  psql_query -Atqc "select pg_terminate_backend(pid)
    from pg_stat_activity
    where application_name like 'c3a\_%' escape '\\'
      and pid <> pg_backend_pid()" >/dev/null 2>&1 || true
  for pid in "${background_pids[@]}"; do
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  done
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

assert_query() {
  [[ "$(psql_query -Atqc "$1" | tr -d '\r')" == t ]] || {
    echo "FAIL: $2" >&2
    exit 1
  }
}

expect_failure() {
  local expected=$1
  local label=$2
  shift 2
  set +e
  "$@" >"$tmp_dir/$label.out" 2>"$tmp_dir/$label.err"
  local status=$?
  set -e
  [[ $status -ne 0 ]] && grep -Fq "$expected" "$tmp_dir/$label.err" || {
    echo "FAIL: expected $label to fail with $expected" >&2
    sed -E 's/(token|password|secret)([^[:space:]]*)/<REDACTED>/Ig' \
      "$tmp_dir/$label.err" >&2
    exit 1
  }
}

schema_dump() {
  docker exec -i "$POSTGRES_CONTAINER_ID" \
    pg_dump --schema-only --no-owner --no-privileges -U postgres -d "$database" |
    sed -e '/^\\restrict /d' -e '/^\\unrestrict /d'
}

capture_boundary() {
  local directory=$1
  psql_query -Atqc "select md5(pg_get_functiondef(
    'public.invalidate_every8d_provider_configuration_v1()'::regprocedure))" |
    tr -d '\r' >"$directory/c2-function.hash"
  psql_query -Atqc "select md5(pg_get_triggerdef(oid,false)) from pg_trigger
    where tgrelid='public.ghl_marketplace_installations'::regclass
      and tgname='invalidate_every8d_provider_cfg_after_install_update'" |
    tr -d '\r' >"$directory/c2-trigger.hash"
  psql_query -Atqc "select md5(pg_get_functiondef(
    'public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer)'::regprocedure))" |
    tr -d '\r' >"$directory/c1b-claim.hash"
}

compare_boundary() {
  local expected=$1 actual=$2
  capture_boundary "$actual"
  for artifact in c2-function c2-trigger c1b-claim; do
    cmp -s "$expected/$artifact.hash" "$actual/$artifact.hash" || {
      echo "FAIL: C3a changed pre-existing $artifact" >&2
      exit 1
    }
  done
}

report_backend() {
  local app=$1
  psql_query -AtF $'\t' -c "select application_name,pid,state,
    coalesce(wait_event_type,'<null>'),coalesce(wait_event,'<null>')
    from pg_stat_activity where application_name='$app' order by pid" >&2 || true
}

wait_for_backend() {
  local app=$1 predicate=$2 label=$3 pid=$4
  local deadline=$((SECONDS + backend_wait_timeout_seconds))
  while (( SECONDS < deadline )); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "FAIL: $label exited early" >&2
      report_backend "$app"
      sed -E 's/(token|password|secret)([^[:space:]]*)/<REDACTED>/Ig' \
        "$tmp_dir/$app.err" >&2 || true
      return 1
    fi
    if [[ "$(psql_query -Atqc "select exists(select 1 from pg_stat_activity a
      where a.application_name='$app' and ($predicate))" | tr -d '\r')" == t ]]; then
      return
    fi
    sleep 0.1
  done
  echo "FAIL: timed out waiting for $label" >&2
  report_backend "$app"
  return 1
}

release_barrier() {
  local barrier_app=$1 barrier_pid=$2
  [[ "$(psql_query -Atqc "select pg_terminate_backend(pid) from pg_stat_activity
    where application_name='$barrier_app'" | tr -d '\r')" == t ]] || {
    echo "FAIL: could not release $barrier_app" >&2
    exit 1
  }
  set +e
  wait "$barrier_pid"
  local status=$?
  set -e
  [[ $status -ne 0 ]] || {
    echo "FAIL: $barrier_app did not terminate as expected" >&2
    exit 1
  }
}

run_race() {
  local label=$1 first_app=$2 first_sql=$3 second_app=$4 second_sql=$5
  local second_outcome=$6 barrier_key=$7 expected_error=${8:-}
  local barrier_app="${first_app}_barrier"

  psql_app "$barrier_app" <<SQL >"$tmp_dir/$barrier_app.out" 2>"$tmp_dir/$barrier_app.err" &
select pg_advisory_lock($barrier_key);
select pg_sleep($barrier_safety_timeout_seconds);
SQL
  local barrier_pid=$!
  background_pids+=("$barrier_pid")
  wait_for_backend "$barrier_app" \
    "a.wait_event_type='Timeout' and a.wait_event='PgSleep'" \
    "$label barrier" "$barrier_pid"

  psql_app "$first_app" -v "c3a_barrier_key=$barrier_key" <"$first_sql" \
    >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
  local first_pid=$!
  background_pids+=("$first_pid")
  wait_for_backend "$first_app" \
    "a.wait_event_type='Lock' and a.query like '%pg_advisory_xact_lock%'" \
    "$label first transaction barrier" "$first_pid"

  psql_app "$second_app" <"$second_sql" \
    >"$tmp_dir/$second_app.out" 2>"$tmp_dir/$second_app.err" &
  local second_pid=$!
  background_pids+=("$second_pid")
  wait_for_backend "$second_app" \
    "a.wait_event_type='Lock' and exists (
      select 1 from pg_stat_activity blocker
      where blocker.application_name='$first_app'
        and blocker.pid=any(pg_blocking_pids(a.pid)))" \
    "$label serialization" "$second_pid"

  release_barrier "$barrier_app" "$barrier_pid"

  set +e
  wait "$first_pid"
  local first_status=$?
  wait "$second_pid"
  local second_status=$?
  set -e
  [[ $first_status -eq 0 ]] || {
    echo "FAIL: $label first transaction failed" >&2
    cat "$tmp_dir/$first_app.err" >&2
    exit 1
  }
  if [[ "$second_outcome" == success ]]; then
    [[ $second_status -eq 0 ]] || {
      echo "FAIL: $label second transaction failed" >&2
      cat "$tmp_dir/$second_app.err" >&2
      exit 1
    }
  else
    [[ $second_status -ne 0 ]] && grep -Fq "$expected_error" "$tmp_dir/$second_app.err" || {
      echo "FAIL: $label did not fail closed with $expected_error" >&2
      cat "$tmp_dir/$second_app.err" >&2
      exit 1
    }
  fi
  echo "$label serialized safely"
}

assert_c3a_rollback_boundary() {
  local label=$1 directory="$tmp_dir/rollback-boundary-$2"
  mkdir -p "$directory"
  assert_query "select
    to_regclass('public.every8d_settings_administrators') is null
    and to_regclass('public.every8d_settings_enrollment_grants') is null
    and to_regclass('public.every8d_settings_sessions') is null
    and not exists(select 1 from pg_trigger
      where tgrelid='public.ghl_marketplace_installations'::regclass
        and tgname='invalidate_every8d_settings_auth_after_install_update')
    and exists(select 1 from pg_trigger
      where tgrelid='public.ghl_marketplace_installations'::regclass
        and tgname='invalidate_every8d_provider_cfg_after_install_update')
    and to_regclass('public.every8d_provider_configurations') is not null
    and exists(select 1 from pg_policies
      where schemaname='public' and tablename='every8d_provider_configurations'
        and policyname='every8d_provider_configurations_service_role_select')
    and to_regclass('public.ghl_marketplace_oauth_states') is not null
    and to_regclass('public.ghl_marketplace_oauth_bootstraps') is not null
    and to_regprocedure(
      'public.apply_every8d_ghl_marketplace_lifecycle_v2(text,text,text,uuid,text,text,text,text,timestamptz,text)'
    ) is not null
    and to_regclass('public.line_channels') is not null
    and to_regclass('public.ghl_sms_outbound_operations') is not null" \
    "$label preserves C2, OAuth, lifecycle, LINE, and SMS objects"
  compare_boundary "$tmp_dir/before" "$directory"
}

assert_rollback_lifecycle_result() {
  local label=$1 installation=$2 expected_status=$3 expected_generation=$4
  assert_query "select i.status='$expected_status'
    and i.installation_generation=$expected_generation
    and c.credential_state='disconnected'
    and c.uid_ciphertext is null and c.password_ciphertext is null
    from public.ghl_marketplace_installations i
    join public.every8d_provider_configurations c on c.installation_id=i.id
    where i.id='$installation'" "$label final lifecycle state"
}

run_rollback_first() {
  local label=$1 prefix=$2 lifecycle_sql=$3 installation=$4
  local expected_status=$5 expected_generation=$6 barrier_key=$7
  local barrier_app="${prefix}_barrier" child_app="${prefix}_child"
  local rollback_app="${prefix}_rollback" lifecycle_app="${prefix}_lifecycle"

  psql_app "$barrier_app" <<SQL >"$tmp_dir/$barrier_app.out" 2>"$tmp_dir/$barrier_app.err" &
select pg_advisory_lock($barrier_key);
select pg_sleep($barrier_safety_timeout_seconds);
SQL
  local barrier_pid=$!
  background_pids+=("$barrier_pid")
  wait_for_backend "$barrier_app" \
    "a.wait_event_type='Timeout' and a.wait_event='PgSleep'" \
    "$label barrier" "$barrier_pid"

  psql_app "$child_app" -v "c3a_barrier_key=$barrier_key" <<'SQL' \
    >"$tmp_dir/$child_app.out" 2>"$tmp_dir/$child_app.err" &
begin;
lock table public.every8d_settings_administrators in access share mode;
select pg_advisory_xact_lock(:c3a_barrier_key);
commit;
SQL
  local child_pid=$!
  background_pids+=("$child_pid")
  wait_for_backend "$child_app" \
    "a.wait_event_type='Lock' and a.query like '%pg_advisory_xact_lock%'" \
    "$label child barrier" "$child_pid"

  psql_app "$rollback_app" <"$rollback" \
    >"$tmp_dir/$rollback_app.out" 2>"$tmp_dir/$rollback_app.err" &
  local rollback_pid=$!
  background_pids+=("$rollback_pid")
  wait_for_backend "$rollback_app" \
    "a.wait_event_type='Lock'
      and exists(select 1 from pg_locks l
        where l.pid=a.pid and l.relation='public.ghl_marketplace_installations'::regclass
          and l.mode='AccessExclusiveLock' and l.granted)
      and exists(select 1 from pg_locks l
        where l.pid=a.pid and l.relation='public.every8d_settings_administrators'::regclass
          and l.mode='AccessExclusiveLock' and not l.granted)" \
    "$label rollback parent-before-child" "$rollback_pid"

  psql_app "$lifecycle_app" <"$lifecycle_sql" \
    >"$tmp_dir/$lifecycle_app.out" 2>"$tmp_dir/$lifecycle_app.err" &
  local lifecycle_pid=$!
  background_pids+=("$lifecycle_pid")
  wait_for_backend "$lifecycle_app" \
    "a.wait_event_type='Lock'
      and exists(select 1 from pg_stat_activity blocker
        where blocker.application_name='$rollback_app'
          and blocker.pid=any(pg_blocking_pids(a.pid)))
      and exists(select 1 from pg_locks l
        where l.pid=a.pid and l.relation='public.ghl_marketplace_installations'::regclass
          and not l.granted)" \
    "$label lifecycle blocked on parent" "$lifecycle_pid"

  release_barrier "$barrier_app" "$barrier_pid"
  set +e
  wait "$child_pid"; local child_status=$?
  wait "$rollback_pid"; local rollback_status=$?
  wait "$lifecycle_pid"; local lifecycle_status=$?
  set -e
  [[ $child_status -eq 0 && $rollback_status -eq 0 && $lifecycle_status -eq 0 ]] || {
    echo "FAIL: $label did not complete safely" >&2
    cat "$tmp_dir/$child_app.err" "$tmp_dir/$rollback_app.err" \
      "$tmp_dir/$lifecycle_app.err" >&2
    exit 1
  }
  assert_c3a_rollback_boundary "$label" "$prefix"
  assert_rollback_lifecycle_result "$label" "$installation" \
    "$expected_status" "$expected_generation"
  echo "$label proved parent-first rollback serialization"
}

run_lifecycle_first() {
  local label=$1 prefix=$2 lifecycle_sql=$3 installation=$4
  local expected_status=$5 expected_generation=$6 barrier_key=$7
  local barrier_app="${prefix}_barrier" lifecycle_app="${prefix}_lifecycle"
  local rollback_app="${prefix}_rollback"

  psql_app "$barrier_app" <<SQL >"$tmp_dir/$barrier_app.out" 2>"$tmp_dir/$barrier_app.err" &
select pg_advisory_lock($barrier_key);
select pg_sleep($barrier_safety_timeout_seconds);
SQL
  local barrier_pid=$!
  background_pids+=("$barrier_pid")
  wait_for_backend "$barrier_app" \
    "a.wait_event_type='Timeout' and a.wait_event='PgSleep'" \
    "$label barrier" "$barrier_pid"

  psql_app "$lifecycle_app" -v "c3a_barrier_key=$barrier_key" <"$lifecycle_sql" \
    >"$tmp_dir/$lifecycle_app.out" 2>"$tmp_dir/$lifecycle_app.err" &
  local lifecycle_pid=$!
  background_pids+=("$lifecycle_pid")
  wait_for_backend "$lifecycle_app" \
    "a.wait_event_type='Lock' and a.query like '%pg_advisory_xact_lock%'" \
    "$label lifecycle barrier" "$lifecycle_pid"

  psql_app "$rollback_app" <"$rollback" \
    >"$tmp_dir/$rollback_app.out" 2>"$tmp_dir/$rollback_app.err" &
  local rollback_pid=$!
  background_pids+=("$rollback_pid")
  wait_for_backend "$rollback_app" \
    "a.wait_event_type='Lock'
      and exists(select 1 from pg_stat_activity blocker
        where blocker.application_name='$lifecycle_app'
          and blocker.pid=any(pg_blocking_pids(a.pid)))
      and exists(select 1 from pg_locks l
        where l.pid=a.pid and l.relation='public.ghl_marketplace_installations'::regclass
          and l.mode='AccessExclusiveLock' and not l.granted)
      and not exists(select 1 from pg_locks l
        where l.pid=a.pid and l.granted and l.relation in (
          'public.every8d_settings_administrators'::regclass,
          'public.every8d_settings_enrollment_grants'::regclass,
          'public.every8d_settings_sessions'::regclass))" \
    "$label rollback waits before child locks" "$rollback_pid"

  release_barrier "$barrier_app" "$barrier_pid"
  set +e
  wait "$lifecycle_pid"; local lifecycle_status=$?
  wait "$rollback_pid"; local rollback_status=$?
  set -e
  [[ $lifecycle_status -eq 0 && $rollback_status -eq 0 ]] || {
    echo "FAIL: $label did not complete safely" >&2
    cat "$tmp_dir/$lifecycle_app.err" "$tmp_dir/$rollback_app.err" >&2
    exit 1
  }
  assert_c3a_rollback_boundary "$label" "$prefix"
  assert_rollback_lifecycle_result "$label" "$installation" \
    "$expected_status" "$expected_generation"
  echo "$label proved rollback waits on parent before child locks"
}

assert_query "select current_database()='wincrm_test'
  and to_regclass('public.every8d_provider_configurations') is not null
  and to_regclass('public.every8d_settings_administrators') is null" \
  'requires C2 and no prior C3a schema'

mkdir "$tmp_dir/before" "$tmp_dir/after-apply" "$tmp_dir/after-rollback"
capture_boundary "$tmp_dir/before"
psql_query <"$migration" >/dev/null
compare_boundary "$tmp_dir/before" "$tmp_dir/after-apply"
assert_query "select
  (select count(*)=0 from public.every8d_settings_administrators)
  and (select count(*)=0 from public.every8d_settings_enrollment_grants)
  and (select count(*)=0 from public.every8d_settings_sessions)" \
  'all C3a tables begin empty'

schema_dump >"$tmp_dir/schema-before-reapply.sql"
expect_failure 'already exists' migration_reapply psql_query <"$migration"
schema_dump >"$tmp_dir/schema-after-reapply.sql"
cmp -s "$tmp_dir/schema-before-reapply.sql" "$tmp_dir/schema-after-reapply.sql" || {
  echo 'FAIL: failed migration reapplication changed schema' >&2
  exit 1
}

psql_query <"$proof" >/dev/null
assert_query "select
  (select count(*)=0 from public.every8d_settings_administrators)
  and (select count(*)=0 from public.every8d_settings_enrollment_grants)
  and (select count(*)=0 from public.every8d_settings_sessions)" \
  'transactional proof leaves C3a tables empty'

psql_query <"$rollback" >/dev/null
assert_query "select to_regclass('public.every8d_settings_administrators') is null
  and to_regclass('public.every8d_settings_enrollment_grants') is null
  and to_regclass('public.every8d_settings_sessions') is null
  and to_regclass('public.every8d_provider_configurations') is not null
  and to_regprocedure('public.invalidate_every8d_provider_configuration_v1()') is not null" \
  'empty rollback removes only C3a objects'
compare_boundary "$tmp_dir/before" "$tmp_dir/after-rollback"
echo 'C3a empty-table rollback proof passed'

psql_query <"$migration" >/dev/null

# Rollback/lifecycle deadlock regression. Each ordering executes the production
# rollback against empty C3a tables. Advisory locks only hold deterministic
# observation points; pg_locks and pg_blocking_pids prove the relation-lock path.
psql_query -q <<'SQL' >/dev/null
do $$
begin
  if not exists (
    select 1 from public.ghl_marketplace_app_registrations
    where app_namespace='every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_registrations(
      app_namespace,marketplace_app_id,oauth_client_id,
      conversation_provider_id,channel,provider
    ) values(
      'every8d_connect','c3a-synthetic-app','c3a.synthetic.client',
      'c3a-synthetic-provider','sms','every8d'
    );
  end if;
  if not exists (
    select 1 from public.ghl_marketplace_app_version_registrations
    where app_namespace='every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_version_registrations(
      app_namespace,marketplace_version_id
    ) values('every8d_connect','c3a.synthetic.version');
  end if;
end;
$$;

create function public.c3a_test_insert_rollback_parent(
  input_id uuid, input_tenant_id uuid, input_location_id text
) returns void language plpgsql set search_path=pg_catalog,public as $$
declare
  registration public.ghl_marketplace_app_registrations%rowtype;
  version public.ghl_marketplace_app_version_registrations%rowtype;
begin
  select * into registration from public.ghl_marketplace_app_registrations
  where app_namespace='every8d_connect';
  select * into version from public.ghl_marketplace_app_version_registrations
  where app_namespace='every8d_connect';
  insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id)
  values(input_tenant_id,input_location_id,
    'line-'||input_location_id,'channel-'||input_location_id);
  insert into public.ghl_marketplace_installations(
    id,app_namespace,marketplace_app_id,oauth_client_id,tenant_id,location_id,
    company_id,conversation_provider_id,channel,provider,status,installation_generation,
    latest_lifecycle_event_at,latest_lifecycle_event_id,latest_lifecycle_event_type,
    latest_lifecycle_version_id
  ) values (
    input_id,'every8d_connect',registration.marketplace_app_id,registration.oauth_client_id,
    input_tenant_id,input_location_id,'company-'||input_location_id,
    registration.conversation_provider_id,'sms','every8d','pending',1,
    clock_timestamp(),'c3a_rollback_'||replace(input_id::text,'-','_'),'INSTALL',
    version.marketplace_version_id
  );
  insert into public.every8d_provider_configurations(
    installation_id,installation_generation,site_url,credential_state,
    uid_ciphertext,password_ciphertext,encryption_key_version,credential_revision
  ) values(input_id,1,'synthetic-c3a.example.invalid','configured',
    decode('01','hex'),decode('02','hex'),'synthetic-v1',1);
end;
$$;

select public.c3a_test_insert_rollback_parent(
  ('51000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'c3a-rollback-race-'||n::text
) from generate_series(1,6) n;

drop function public.c3a_test_insert_rollback_parent(uuid,uuid,text);
SQL

cat >"$tmp_dir/rollback-disable-first.sql" <<'SQL'
begin;
update public.ghl_marketplace_installations set status='disabled'
where id='51000000-0000-4000-8000-000000000001';
commit;
SQL
cat >"$tmp_dir/disable-rollback-first.sql" <<'SQL'
begin;
update public.ghl_marketplace_installations set status='disabled'
where id='51000000-0000-4000-8000-000000000002';
select pg_advisory_xact_lock(:c3a_barrier_key);
commit;
SQL
cat >"$tmp_dir/rollback-uninstall-first.sql" <<'SQL'
begin;
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'UNINSTALL',r.marketplace_app_id,r.oauth_client_id,null,
  'c3a-rollback-race-3',null,r.conversation_provider_id,
  v.marketplace_version_id,clock_timestamp(),'c3a_rollback_uninstall_3')
from public.ghl_marketplace_app_registrations r
join public.ghl_marketplace_app_version_registrations v using(app_namespace)
where r.app_namespace='every8d_connect';
commit;
SQL
cat >"$tmp_dir/uninstall-rollback-first.sql" <<'SQL'
begin;
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'UNINSTALL',r.marketplace_app_id,r.oauth_client_id,null,
  'c3a-rollback-race-4',null,r.conversation_provider_id,
  v.marketplace_version_id,clock_timestamp(),'c3a_rollback_uninstall_4')
from public.ghl_marketplace_app_registrations r
join public.ghl_marketplace_app_version_registrations v using(app_namespace)
where r.app_namespace='every8d_connect';
select pg_advisory_xact_lock(:c3a_barrier_key);
commit;
SQL
cat >"$tmp_dir/rollback-generation-first.sql" <<'SQL'
begin;
update public.ghl_marketplace_installations set installation_generation=2
where id='51000000-0000-4000-8000-000000000005';
commit;
SQL
cat >"$tmp_dir/generation-rollback-first.sql" <<'SQL'
begin;
update public.ghl_marketplace_installations set installation_generation=2
where id='51000000-0000-4000-8000-000000000006';
select pg_advisory_xact_lock(:c3a_barrier_key);
commit;
SQL

run_rollback_first 'rollback-first vs disable' c3a_rb_dis_a \
  "$tmp_dir/rollback-disable-first.sql" \
  51000000-0000-4000-8000-000000000001 disabled 1 9400001
psql_query <"$migration" >/dev/null
run_lifecycle_first 'disable-first vs rollback' c3a_dis_rb_b \
  "$tmp_dir/disable-rollback-first.sql" \
  51000000-0000-4000-8000-000000000002 disabled 1 9400002
psql_query <"$migration" >/dev/null
run_rollback_first 'rollback-first vs UNINSTALL' c3a_rb_uni_a \
  "$tmp_dir/rollback-uninstall-first.sql" \
  51000000-0000-4000-8000-000000000003 uninstalled 2 9400003
psql_query <"$migration" >/dev/null
run_lifecycle_first 'UNINSTALL-first vs rollback' c3a_uni_rb_b \
  "$tmp_dir/uninstall-rollback-first.sql" \
  51000000-0000-4000-8000-000000000004 uninstalled 2 9400004
psql_query <"$migration" >/dev/null
run_rollback_first 'rollback-first vs generation advance' c3a_rb_gen_a \
  "$tmp_dir/rollback-generation-first.sql" \
  51000000-0000-4000-8000-000000000005 pending 2 9400005
psql_query <"$migration" >/dev/null
run_lifecycle_first 'generation-first vs rollback' c3a_gen_rb_b \
  "$tmp_dir/generation-rollback-first.sql" \
  51000000-0000-4000-8000-000000000006 pending 2 9400006
psql_query <"$migration" >/dev/null
echo 'C3a rollback/lifecycle parent-first concurrency proofs passed'

# Committed synthetic parents for lifecycle and reissue races.
psql_query -q <<'SQL' >/dev/null
do $$
begin
  if not exists (
    select 1 from public.ghl_marketplace_app_registrations
    where app_namespace='every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_registrations(
      app_namespace,marketplace_app_id,oauth_client_id,
      conversation_provider_id,channel,provider
    ) values(
      'every8d_connect','c3a-synthetic-app','c3a.synthetic.client',
      'c3a-synthetic-provider','sms','every8d'
    );
  end if;
  if not exists (
    select 1 from public.ghl_marketplace_app_version_registrations
    where app_namespace='every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_version_registrations(
      app_namespace,marketplace_version_id
    ) values('every8d_connect','c3a.synthetic.version');
  end if;
end;
$$;

create function public.c3a_test_insert_parent(
  input_id uuid, input_tenant_id uuid, input_location_id text
) returns void language plpgsql set search_path=pg_catalog,public as $$
declare
  registration public.ghl_marketplace_app_registrations%rowtype;
  version public.ghl_marketplace_app_version_registrations%rowtype;
begin
  select * into registration from public.ghl_marketplace_app_registrations
  where app_namespace='every8d_connect';
  select * into version from public.ghl_marketplace_app_version_registrations
  where app_namespace='every8d_connect';
  insert into public.tenants(id,location_id,ghl_provider_id,line_channel_id)
  values(input_tenant_id,input_location_id,'line-'||input_location_id,'channel-'||input_location_id);
  insert into public.ghl_marketplace_installations(
    id,app_namespace,marketplace_app_id,oauth_client_id,tenant_id,location_id,
    company_id,conversation_provider_id,channel,provider,status,installation_generation,
    latest_lifecycle_event_at,latest_lifecycle_event_id,latest_lifecycle_event_type,
    latest_lifecycle_version_id
  ) values (
    input_id,'every8d_connect',registration.marketplace_app_id,registration.oauth_client_id,
    input_tenant_id,input_location_id,'company-'||input_location_id,
    registration.conversation_provider_id,'sms','every8d','pending',1,
    clock_timestamp(),'c3a_'||replace(input_id::text,'-','_'),'INSTALL',
    version.marketplace_version_id
  );
  insert into public.every8d_provider_configurations(
    installation_id,installation_generation,site_url,credential_state,
    uid_ciphertext,password_ciphertext,encryption_key_version,credential_revision
  ) values(input_id,1,'synthetic-c3a.example.invalid','configured',
    decode('01','hex'),decode('02','hex'),'synthetic-v1',1);
end;
$$;

select public.c3a_test_insert_parent(
  ('41000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'c3a-race-'||n::text
) from generate_series(1,8) n;
SQL

# Same-email operator reissue: the second call must block on the tuple-scoped
# advisory lock, then revoke the first committed unused grant before inserting.
cat >"$tmp_dir/reissue-a.sql" <<'SQL'
begin;
select * from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '41000000-0000-4000-8000-000000000001',1,'race@example.invalid',
  decode(repeat('a1',32),'hex'),'operator_initial',clock_timestamp()+interval '10 minutes',
  'issuer-a','approver-a','CASE-RACE-A','first concurrent issue');
select pg_advisory_xact_lock(:c3a_barrier_key);
commit;
SQL
cat >"$tmp_dir/reissue-b.sql" <<'SQL'
begin;
select * from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '41000000-0000-4000-8000-000000000001',1,'race@example.invalid',
  decode(repeat('b1',32),'hex'),'operator_recovery',clock_timestamp()+interval '10 minutes',
  'issuer-b','approver-b','CASE-RACE-B','second concurrent issue');
commit;
SQL
run_race 'operator reissue concurrency' c3a_reissue_a "$tmp_dir/reissue-a.sql" \
  c3a_reissue_b "$tmp_dir/reissue-b.sql" success 9300001
assert_query "select count(*)=2 and count(*) filter(where revoked_at is null)=1
  and count(*) filter(where token_hash=decode(repeat('b1',32),'hex') and revoked_at is null)=1
  and count(*) filter(where token_hash=decode(repeat('a1',32),'hex')
    and revocation_reason='operator_grant_superseded')=1
  from public.every8d_settings_enrollment_grants
  where installation_id='41000000-0000-4000-8000-000000000001'
    and pinned_normalized_email='race@example.invalid'" \
  'concurrent operator reissue leaves exactly one live newest grant'

make_operation_sql() {
  local file=$1 installation=$2 discriminator=$3 admin=$4 session=$5 barrier=$6
  cat >"$file" <<SQL
begin;
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '$installation',1,'race-$discriminator@example.invalid',
  decode(repeat('$discriminator',32),'hex'),'operator_initial',clock_timestamp()+interval '10 minutes',
  'issuer-$discriminator','approver-$discriminator','CASE-$discriminator','lifecycle race') \gset
update public.every8d_settings_enrollment_grants set consumed_at=clock_timestamp()
where id=:'grant_id';
insert into public.every8d_settings_administrators(
  id,installation_id,installation_generation,normalized_email,email_pseudonym,
  enrollment_method,enrollment_grant_id
) values('$admin','$installation',1,'race-$discriminator@example.invalid',
  'pseudo-$discriminator','operator_initial',:'grant_id');
insert into public.every8d_settings_sessions(
  id,token_hash,administrator_id,installation_id,installation_generation,expires_at
) values('$session',decode(repeat('$discriminator',32),'hex'),'$admin','$installation',1,
  clock_timestamp()+interval '30 minutes');
$(if [[ -n "$barrier" ]]; then echo "select pg_advisory_xact_lock($barrier);"; fi)
commit;
SQL
}

make_disable_sql() {
  local file=$1 installation=$2 barrier=${3:-}
  {
    echo 'begin;'
    echo "update public.ghl_marketplace_installations set status='disabled' where id='$installation';"
    [[ -z "$barrier" ]] || echo "select pg_advisory_xact_lock($barrier);"
    echo 'commit;'
  } >"$file"
}

make_uninstall_sql() {
  local file=$1 installation=$2 location=$3 event=$4 barrier=${5:-}
  cat >"$file" <<SQL
begin;
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'UNINSTALL',r.marketplace_app_id,r.oauth_client_id,null,'$location',null,
  r.conversation_provider_id,v.marketplace_version_id,clock_timestamp(),'$event')
from public.ghl_marketplace_app_registrations r
join public.ghl_marketplace_app_version_registrations v using(app_namespace)
where r.app_namespace='every8d_connect';
$(if [[ -n "$barrier" ]]; then echo "select pg_advisory_xact_lock($barrier);"; fi)
commit;
SQL
}

make_generation_sql() {
  local file=$1 installation=$2 barrier=${3:-}
  {
    echo 'begin;'
    echo "update public.ghl_marketplace_installations set installation_generation=2 where id='$installation';"
    [[ -z "$barrier" ]] || echo "select pg_advisory_xact_lock($barrier);"
    echo 'commit;'
  } >"$file"
}

assert_invalidated() {
  local installation=$1 expected_status=$2 expected_generation=$3 reason=$4
  assert_query "select i.status='$expected_status' and i.installation_generation=$expected_generation
    and c.credential_state='disconnected' and c.uid_ciphertext is null
    and not exists(select 1 from public.every8d_settings_administrators a
      where a.installation_id=i.id and a.installation_generation=1 and a.revoked_at is null)
    and not exists(select 1 from public.every8d_settings_enrollment_grants g
      where g.installation_id=i.id and g.installation_generation=1
        and g.consumed_at is null and g.revoked_at is null)
    and not exists(select 1 from public.every8d_settings_sessions s
      where s.installation_id=i.id and s.installation_generation=1 and s.revoked_at is null)
    and not exists(select 1 from public.every8d_settings_administrators a
      where a.installation_id=i.id and a.revoked_at is not null
        and a.revocation_reason<>'$reason')
    and not exists(select 1 from public.every8d_settings_sessions s
      where s.installation_id=i.id and s.revoked_at is not null
        and s.revocation_reason<>'$reason')
    from public.ghl_marketplace_installations i
    join public.every8d_provider_configurations c on c.installation_id=i.id
    where i.id='$installation'" "$reason final invariant"
}

# Operation first: child creation holds FOR SHARE; lifecycle waits, then revokes.
make_operation_sql "$tmp_dir/disable-operation-first-a.sql" \
  41000000-0000-4000-8000-000000000002 d2 \
  43000000-0000-4000-8000-000000000002 44000000-0000-4000-8000-000000000002 \
  ':c3a_barrier_key'
make_disable_sql "$tmp_dir/disable-operation-first-b.sql" \
  41000000-0000-4000-8000-000000000002
run_race 'disable operation-first' c3a_disable_child_a "$tmp_dir/disable-operation-first-a.sql" \
  c3a_disable_lifecycle_b "$tmp_dir/disable-operation-first-b.sql" success 9300002
assert_invalidated 41000000-0000-4000-8000-000000000002 disabled 1 installation_disabled

make_operation_sql "$tmp_dir/uninstall-operation-first-a.sql" \
  41000000-0000-4000-8000-000000000003 d3 \
  43000000-0000-4000-8000-000000000003 44000000-0000-4000-8000-000000000003 \
  ':c3a_barrier_key'
make_uninstall_sql "$tmp_dir/uninstall-operation-first-b.sql" \
  41000000-0000-4000-8000-000000000003 c3a-race-3 c3a_uninstall_3
run_race 'UNINSTALL operation-first' c3a_uninstall_child_a "$tmp_dir/uninstall-operation-first-a.sql" \
  c3a_uninstall_lifecycle_b "$tmp_dir/uninstall-operation-first-b.sql" success 9300003
assert_invalidated 41000000-0000-4000-8000-000000000003 uninstalled 2 installation_uninstalled

make_operation_sql "$tmp_dir/generation-operation-first-a.sql" \
  41000000-0000-4000-8000-000000000004 d4 \
  43000000-0000-4000-8000-000000000004 44000000-0000-4000-8000-000000000004 \
  ':c3a_barrier_key'
make_generation_sql "$tmp_dir/generation-operation-first-b.sql" \
  41000000-0000-4000-8000-000000000004
run_race 'generation operation-first' c3a_generation_child_a "$tmp_dir/generation-operation-first-a.sql" \
  c3a_generation_lifecycle_b "$tmp_dir/generation-operation-first-b.sql" success 9300004
assert_invalidated 41000000-0000-4000-8000-000000000004 pending 2 installation_generation_changed

# Lifecycle first: lifecycle holds FOR NO KEY UPDATE; child operation waits and
# then rejects the disabled/uninstalled/stale parent after the lifecycle commits.
make_disable_sql "$tmp_dir/disable-lifecycle-first-a.sql" \
  41000000-0000-4000-8000-000000000005 ':c3a_barrier_key'
make_operation_sql "$tmp_dir/disable-lifecycle-first-b.sql" \
  41000000-0000-4000-8000-000000000005 e5 \
  43000000-0000-4000-8000-000000000005 44000000-0000-4000-8000-000000000005 ''
run_race 'disable lifecycle-first' c3a_disable_lifecycle_a "$tmp_dir/disable-lifecycle-first-a.sql" \
  c3a_disable_child_b "$tmp_dir/disable-lifecycle-first-b.sql" failure 9300005 \
  'EVERY8D settings parent is not currently eligible'
assert_invalidated 41000000-0000-4000-8000-000000000005 disabled 1 installation_disabled

make_uninstall_sql "$tmp_dir/uninstall-lifecycle-first-a.sql" \
  41000000-0000-4000-8000-000000000006 c3a-race-6 c3a_uninstall_6 ':c3a_barrier_key'
make_operation_sql "$tmp_dir/uninstall-lifecycle-first-b.sql" \
  41000000-0000-4000-8000-000000000006 e6 \
  43000000-0000-4000-8000-000000000006 44000000-0000-4000-8000-000000000006 ''
run_race 'UNINSTALL lifecycle-first' c3a_uninstall_lifecycle_a "$tmp_dir/uninstall-lifecycle-first-a.sql" \
  c3a_uninstall_child_b "$tmp_dir/uninstall-lifecycle-first-b.sql" failure 9300006 \
  'EVERY8D settings parent is not currently eligible'
assert_invalidated 41000000-0000-4000-8000-000000000006 uninstalled 2 installation_uninstalled

make_generation_sql "$tmp_dir/generation-lifecycle-first-a.sql" \
  41000000-0000-4000-8000-000000000007 ':c3a_barrier_key'
make_operation_sql "$tmp_dir/generation-lifecycle-first-b.sql" \
  41000000-0000-4000-8000-000000000007 e7 \
  43000000-0000-4000-8000-000000000007 44000000-0000-4000-8000-000000000007 ''
run_race 'generation lifecycle-first' c3a_generation_lifecycle_a "$tmp_dir/generation-lifecycle-first-a.sql" \
  c3a_generation_child_b "$tmp_dir/generation-lifecycle-first-b.sql" failure 9300007 \
  'EVERY8D settings parent is not currently eligible'
assert_invalidated 41000000-0000-4000-8000-000000000007 pending 2 installation_generation_changed

# Build live C3 state on parent 8 for cross-trigger atomic failure proofs.
psql_query -q <<'SQL' >/dev/null
select grant_id from public.issue_every8d_settings_operator_enrollment_grant_v1(
  '41000000-0000-4000-8000-000000000008',1,'atomic@example.invalid',
  decode(repeat('f8',32),'hex'),'operator_initial',clock_timestamp()+interval '10 minutes',
  'issuer-f','approver-f','CASE-F8','atomic trigger proof') \gset
update public.every8d_settings_enrollment_grants set consumed_at=clock_timestamp()
where id=:'grant_id';
insert into public.every8d_settings_administrators(
  id,installation_id,installation_generation,normalized_email,email_pseudonym,
  enrollment_method,enrollment_grant_id
) values('43000000-0000-4000-8000-000000000008',
  '41000000-0000-4000-8000-000000000008',1,'atomic@example.invalid',
  'pseudo-f8','operator_initial',:'grant_id');
insert into public.every8d_settings_sessions(
  token_hash,administrator_id,installation_id,installation_generation,expires_at
) values(decode(repeat('f9',32),'hex'),'43000000-0000-4000-8000-000000000008',
  '41000000-0000-4000-8000-000000000008',1,clock_timestamp()+interval '30 minutes');
SQL

psql_query -q <<'SQL' >/dev/null
create function public.c3a_test_fail_c3_update()
returns trigger language plpgsql as $$ begin
  raise exception 'synthetic C3 invalidation failure' using errcode='23514';
end $$;
create trigger aa_c3a_test_fail_c3_update
before update on public.every8d_settings_sessions
for each row execute function public.c3a_test_fail_c3_update();
SQL
expect_failure 'synthetic C3 invalidation failure' c3_failure_abort psql_query -c \
  "update public.ghl_marketplace_installations set status='disabled'
   where id='41000000-0000-4000-8000-000000000008'"
assert_query "select i.status='pending' and c.credential_state='configured'
  and s.revoked_at is null from public.ghl_marketplace_installations i
  join public.every8d_provider_configurations c on c.installation_id=i.id
  join public.every8d_settings_sessions s on s.installation_id=i.id
  where i.id='41000000-0000-4000-8000-000000000008'" \
  'C3 invalidation failure rolls back C2 and parent lifecycle mutation'
psql_query -qc "drop trigger aa_c3a_test_fail_c3_update on public.every8d_settings_sessions;
  drop function public.c3a_test_fail_c3_update();"

psql_query -q <<'SQL' >/dev/null
create function public.c3a_test_fail_c2_update()
returns trigger language plpgsql as $$ begin
  raise exception 'synthetic C2 invalidation failure' using errcode='23514';
end $$;
create trigger aa_c3a_test_fail_c2_update
before update on public.every8d_provider_configurations
for each row execute function public.c3a_test_fail_c2_update();
SQL
expect_failure 'synthetic C2 invalidation failure' c2_failure_abort psql_query -c \
  "update public.ghl_marketplace_installations set status='disabled'
   where id='41000000-0000-4000-8000-000000000008'"
assert_query "select i.status='pending' and c.credential_state='configured'
  and s.revoked_at is null from public.ghl_marketplace_installations i
  join public.every8d_provider_configurations c on c.installation_id=i.id
  join public.every8d_settings_sessions s on s.installation_id=i.id
  where i.id='41000000-0000-4000-8000-000000000008'" \
  'C2 invalidation failure rolls back parent and leaves C3 unchanged'
psql_query -qc "drop trigger aa_c3a_test_fail_c2_update on public.every8d_provider_configurations;
  drop function public.c3a_test_fail_c2_update();"

psql_query -qc "update public.ghl_marketplace_installations set status='disabled'
  where id='41000000-0000-4000-8000-000000000008'"
assert_invalidated 41000000-0000-4000-8000-000000000008 disabled 1 installation_disabled
echo 'C2/C3 lifecycle trigger atomic coexistence proofs passed'

psql_query -qc 'drop function public.c3a_test_insert_parent(uuid,uuid,text)'

schema_dump >"$tmp_dir/schema-before-refused-rollback.sql"
expect_failure 'C3a rollback refused: EVERY8D settings auth rows exist' \
  populated_rollback psql_query <"$rollback"
schema_dump >"$tmp_dir/schema-after-refused-rollback.sql"
cmp -s "$tmp_dir/schema-before-refused-rollback.sql" \
  "$tmp_dir/schema-after-refused-rollback.sql" || {
  echo 'FAIL: populated rollback refusal changed schema' >&2
  exit 1
}
assert_query "select to_regclass('public.every8d_settings_administrators') is not null
  and to_regclass('public.every8d_provider_configurations') is not null
  and exists(select 1 from public.every8d_settings_enrollment_grants)" \
  'populated rollback refusal preserves all C3a and C2 objects'

echo 'EVERY8D C3a settings auth PostgreSQL 17 proofs passed'
