#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"
readonly database=wincrm_test
readonly migration=supabase/migrations/202609300001_every8d_provider_configurations.sql
readonly rollback=supabase/rollback/202609300001_every8d_provider_configurations.sql
readonly proof=test/postgres/every8dProviderConfigurations.sql
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

psql_query() {
  docker exec -i "$POSTGRES_CONTAINER_ID" psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$database" "$@"
}

psql_app() {
  local application_name=$1
  shift
  docker exec -e "PGAPPNAME=$application_name" -i "$POSTGRES_CONTAINER_ID" \
    psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse -U postgres -d "$database" "$@"
}

assert_query() {
  [[ "$(psql_query -Atqc "$1" | tr -d '\r')" == t ]] || {
    echo "FAIL: $2" >&2
    exit 1
  }
}

expect_failure() {
  local expected=$1
  local output=$2
  shift 2
  set +e
  "$@" >"$tmp_dir/$output.out" 2>"$tmp_dir/$output.err"
  local status=$?
  set -e
  [[ $status -ne 0 ]] && grep -Fq "$expected" "$tmp_dir/$output.err" || {
    echo "FAIL: expected failure containing $expected" >&2
    exit 1
  }
}

wait_for_backend_state() {
  local application_name=$1
  local predicate=$2
  local label=$3
  for _ in $(seq 1 160); do
    if [[ "$(psql_query -Atqc "select exists (
      select 1 from pg_stat_activity
      where application_name = '$application_name' and ($predicate)
    )" | tr -d '\r')" == t ]]; then
      return
    fi
    sleep 0.05
  done
  echo "FAIL: timed out waiting for $label ($application_name)" >&2
  exit 1
}

run_serialized_race() {
  local label=$1
  local first_app=$2
  local first_sql=$3
  local second_app=$4
  local second_sql=$5
  local second_outcome=$6

  psql_app "$first_app" -f "$first_sql" \
    >"$tmp_dir/$first_app.out" 2>"$tmp_dir/$first_app.err" &
  local first_pid=$!
  wait_for_backend_state "$first_app" \
    "wait_event_type = 'Timeout' and wait_event = 'PgSleep'" \
    "$label first transaction to hold its parent lock"

  psql_app "$second_app" -f "$second_sql" \
    >"$tmp_dir/$second_app.out" 2>"$tmp_dir/$second_app.err" &
  local second_pid=$!
  wait_for_backend_state "$second_app" \
    "wait_event_type = 'Lock'" \
    "$label second transaction to block on the parent row"

  wait "$first_pid" || {
    echo "FAIL: $label first transaction failed" >&2
    cat "$tmp_dir/$first_app.err" >&2
    exit 1
  }

  set +e
  wait "$second_pid"
  local second_status=$?
  set -e
  if [[ "$second_outcome" == success && $second_status -ne 0 ]]; then
    echo "FAIL: $label second transaction failed" >&2
    cat "$tmp_dir/$second_app.err" >&2
    exit 1
  fi
  if [[ "$second_outcome" == eligibility_failure ]]; then
    [[ $second_status -ne 0 ]] \
      && grep -Fq 'EVERY8D provider configuration parent is not currently eligible' \
        "$tmp_dir/$second_app.err" || {
      echo "FAIL: $label did not fail closed after lifecycle won" >&2
      cat "$tmp_dir/$second_app.err" >&2
      exit 1
    }
  fi
  echo "$label serialized safely"
}

schema_dump() {
  docker exec -i "$POSTGRES_CONTAINER_ID" pg_dump --schema-only --no-owner --no-privileges -U postgres -d "$database" |
    sed -e '/^\\restrict /d' -e '/^\\unrestrict /d'
}

capture_preexisting_boundary() {
  psql_query -Atqc "select md5(pg_get_functiondef(
    'public.protect_ghl_marketplace_installation_v5()'::regprocedure))" | tr -d '\r' >"$1/protect-v5.hash"
  psql_query -Atqc "select md5(pg_get_functiondef(
    'public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer)'::regprocedure))" | tr -d '\r' >"$1/claim-refresh.hash"
  psql_query -Atqc "select md5(pg_get_functiondef(
    'public.finalize_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,bytea,bytea,text,timestamptz,text[])'::regprocedure))" | tr -d '\r' >"$1/finalize-refresh.hash"
  psql_query -Atqc "select md5(pg_get_functiondef(
    'public.fail_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer,bigint,uuid,text)'::regprocedure))" | tr -d '\r' >"$1/fail-refresh.hash"
  psql_query -Atqc "select md5(pg_get_triggerdef(oid, false))
    from pg_trigger
    where tgrelid = 'public.ghl_marketplace_installations'::regclass
      and tgname = 'protect_ghl_marketplace_installation'" | tr -d '\r' >"$1/protect-trigger.hash"
}

compare_preexisting_boundary() {
  local expected=$1
  local actual=$2
  capture_preexisting_boundary "$actual"
  for artifact in protect-v5 claim-refresh finalize-refresh fail-refresh protect-trigger; do
    cmp -s "$expected/$artifact.hash" "$actual/$artifact.hash" || {
      echo "FAIL: C2 changed pre-existing $artifact" >&2
      exit 1
    }
  done
}

assert_query "select current_database() = 'wincrm_test'
  and to_regprocedure(
    'public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer)'
  ) is not null
  and to_regclass('public.every8d_provider_configurations') is null" 'requires the C1a chain and no prior C2 schema'

mkdir "$tmp_dir/before" "$tmp_dir/after-apply" "$tmp_dir/after-rollback"
capture_preexisting_boundary "$tmp_dir/before"

psql_query <"$migration" >/dev/null
compare_preexisting_boundary "$tmp_dir/before" "$tmp_dir/after-apply"
assert_query "select not exists (
  select 1 from public.every8d_provider_configurations
)" 'C2 table begins empty'

schema_dump >"$tmp_dir/schema-before-reapply.sql"
expect_failure 'already exists' migration_reapply psql_query <"$migration"
schema_dump >"$tmp_dir/schema-after-reapply.sql"
cmp -s "$tmp_dir/schema-before-reapply.sql" "$tmp_dir/schema-after-reapply.sql" || {
  echo 'FAIL: failed migration reapplication caused schema drift' >&2
  exit 1
}
echo 'Migration reapplication failed atomically without schema drift'

psql_query <"$proof" >/dev/null
assert_query "select not exists (
  select 1 from public.every8d_provider_configurations
)" 'transactional SQL proof leaves the C2 table empty'

psql_query <"$rollback" >/dev/null
assert_query "select to_regclass('public.every8d_provider_configurations') is null
  and to_regprocedure('public.protect_every8d_provider_configuration_v1()') is null
  and to_regprocedure('public.invalidate_every8d_provider_configuration_v1()') is null
  and to_regprocedure(
    'public.claim_every8d_ghl_oauth_refresh_v1(uuid,text,text,uuid,text,text,text,text,integer)'
  ) is not null
  and to_regprocedure(
    'public.apply_every8d_ghl_marketplace_lifecycle_v2(text,text,text,uuid,text,text,text,text,timestamptz,text)'
  ) is not null" 'empty rollback removes only C2 objects'
compare_preexisting_boundary "$tmp_dir/before" "$tmp_dir/after-rollback"
echo 'Empty guarded rollback preserved lifecycle and OAuth objects'

psql_query <"$migration" >/dev/null
psql_query -q <<'SQL' >/dev/null
create function public.c2_test_lock_eligible_parent(
  input_installation_id uuid,
  input_generation integer
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform 1
  from public.ghl_marketplace_installations i
  join public.ghl_marketplace_app_registrations r
    on r.app_namespace = i.app_namespace
   and r.marketplace_app_id = i.marketplace_app_id
   and r.oauth_client_id = i.oauth_client_id
   and r.conversation_provider_id = i.conversation_provider_id
   and r.channel = i.channel
   and r.provider = i.provider
  join public.ghl_marketplace_app_version_registrations v
    on v.app_namespace = i.app_namespace
   and v.marketplace_version_id = i.latest_lifecycle_version_id
  where i.id = input_installation_id
    and i.installation_generation = input_generation
    and i.app_namespace = 'every8d_connect'
    and i.channel = 'sms'
    and i.provider = 'every8d'
    and i.company_id is not null
    and i.latest_lifecycle_event_type = 'INSTALL'
    and i.status in ('pending', 'active')
  for share of i;

  if not found then
    raise exception 'EVERY8D provider configuration parent is not currently eligible'
      using errcode = '23514';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from public.ghl_marketplace_app_registrations
    where app_namespace = 'every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_registrations (
      app_namespace, marketplace_app_id, oauth_client_id,
      conversation_provider_id, channel, provider
    ) values (
      'every8d_connect', 'c2-race-app', 'c2.race.client',
      'c2-race-provider', 'sms', 'every8d'
    );
  end if;
  if not exists (
    select 1 from public.ghl_marketplace_app_version_registrations
    where app_namespace = 'every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_version_registrations (
      app_namespace, marketplace_version_id
    ) values ('every8d_connect', 'c2.race.version');
  end if;
end;
$$;

insert into public.tenants (id, location_id, ghl_provider_id, line_channel_id)
values
  ('00000000-0000-4000-8000-000000000501', 'c2-race-disable-config-first', 'line-501', 'line-channel-501'),
  ('00000000-0000-4000-8000-000000000502', 'c2-race-disable-lifecycle-first', 'line-502', 'line-channel-502'),
  ('00000000-0000-4000-8000-000000000503', 'c2-race-uninstall-config-first', 'line-503', 'line-channel-503'),
  ('00000000-0000-4000-8000-000000000504', 'c2-race-uninstall-lifecycle-first', 'line-504', 'line-channel-504'),
  ('00000000-0000-4000-8000-000000000505', 'c2-race-generation-config-first', 'line-505', 'line-channel-505'),
  ('00000000-0000-4000-8000-000000000506', 'c2-race-generation-lifecycle-first', 'line-506', 'line-channel-506');

insert into public.ghl_marketplace_installations (
  id, app_namespace, marketplace_app_id, oauth_client_id,
  tenant_id, location_id, company_id, conversation_provider_id,
  channel, provider, status, installation_generation,
  latest_lifecycle_event_at, latest_lifecycle_event_id,
  latest_lifecycle_event_type, latest_lifecycle_version_id
)
select
  ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  r.app_namespace, r.marketplace_app_id, r.oauth_client_id,
  ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  case n
    when 501 then 'c2-race-disable-config-first'
    when 502 then 'c2-race-disable-lifecycle-first'
    when 503 then 'c2-race-uninstall-config-first'
    when 504 then 'c2-race-uninstall-lifecycle-first'
    when 505 then 'c2-race-generation-config-first'
    else 'c2-race-generation-lifecycle-first'
  end,
  'c2-race-company', r.conversation_provider_id,
  r.channel, r.provider, 'pending', 1,
  '2090-06-01T00:00:00Z', 'c2_race_install_' || n,
  'INSTALL', v.marketplace_version_id
from generate_series(501, 506) n
cross join lateral (
  select * from public.ghl_marketplace_app_registrations
  where app_namespace = 'every8d_connect'
  order by marketplace_app_id
  limit 1
) r
cross join lateral (
  select * from public.ghl_marketplace_app_version_registrations
  where app_namespace = 'every8d_connect'
  order by marketplace_version_id
  limit 1
) v;

insert into public.every8d_provider_configurations (
  id, installation_id, installation_generation, site_url,
  credential_state, uid_ciphertext, password_ciphertext,
  encryption_key_version, credential_revision, safesay_enabled, safesay_event_id
)
select
  ('20000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  1, 'synthetic-race.example.invalid', 'configured',
  decode('a1','hex'), decode('b2','hex'), 'synthetic-race-v1', 1,
  true, 'event-race-' || n
from generate_series(503, 506) n;

update public.every8d_provider_configurations
set credential_state = 'disconnected',
    uid_ciphertext = null,
    password_ciphertext = null,
    encryption_key_version = null,
    credential_revision = 2,
    disconnected_at = clock_timestamp(),
    safesay_enabled = false
where id in (
  '20000000-0000-4000-8000-000000000503',
  '20000000-0000-4000-8000-000000000504'
);
SQL

cat >"$tmp_dir/disable-config-first-a.sql" <<'SQL'
begin;
select public.c2_test_lock_eligible_parent(
  '10000000-0000-4000-8000-000000000501', 1);
insert into public.every8d_provider_configurations (
  id, installation_id, installation_generation, site_url,
  credential_state, uid_ciphertext, password_ciphertext,
  encryption_key_version, credential_revision, safesay_event_id
) values (
  '20000000-0000-4000-8000-000000000501',
  '10000000-0000-4000-8000-000000000501', 1,
  'synthetic-race.example.invalid', 'configured',
  decode('a1','hex'), decode('b2','hex'), 'synthetic-race-v1', 1,
  'event-race-501'
);
select pg_sleep(2);
commit;
SQL
cat >"$tmp_dir/disable-config-first-b.sql" <<'SQL'
begin;
update public.ghl_marketplace_installations
set status = 'disabled'
where id = '10000000-0000-4000-8000-000000000501';
commit;
SQL
run_serialized_race 'initial INSERT versus disable (configuration first)' \
  c2_ins_disable_a "$tmp_dir/disable-config-first-a.sql" \
  c2_ins_disable_b "$tmp_dir/disable-config-first-b.sql" success
assert_query "select i.status = 'disabled'
    and c.credential_state = 'disconnected'
    and c.credential_revision = 2
    and c.uid_ciphertext is null and c.password_ciphertext is null
  from public.ghl_marketplace_installations i
  join public.every8d_provider_configurations c on c.installation_id = i.id
  where i.id = '10000000-0000-4000-8000-000000000501'" \
  'configuration-first disable race ends scrubbed'

cat >"$tmp_dir/disable-lifecycle-first-a.sql" <<'SQL'
begin;
update public.ghl_marketplace_installations
set status = 'disabled'
where id = '10000000-0000-4000-8000-000000000502';
select pg_sleep(2);
commit;
SQL
cat >"$tmp_dir/disable-lifecycle-first-b.sql" <<'SQL'
begin;
select public.c2_test_lock_eligible_parent(
  '10000000-0000-4000-8000-000000000502', 1);
insert into public.every8d_provider_configurations (
  id, installation_id, installation_generation, site_url,
  credential_state, uid_ciphertext, password_ciphertext,
  encryption_key_version, credential_revision
) values (
  '20000000-0000-4000-8000-000000000502',
  '10000000-0000-4000-8000-000000000502', 1,
  'synthetic-race.example.invalid', 'configured',
  decode('a1','hex'), decode('b2','hex'), 'synthetic-race-v1', 1
);
commit;
SQL
run_serialized_race 'initial INSERT versus disable (lifecycle first)' \
  c2_disable_ins_a "$tmp_dir/disable-lifecycle-first-a.sql" \
  c2_disable_ins_b "$tmp_dir/disable-lifecycle-first-b.sql" eligibility_failure
assert_query "select i.status = 'disabled'
    and not exists (
      select 1 from public.every8d_provider_configurations c
      where c.installation_id = i.id
    )
  from public.ghl_marketplace_installations i
  where i.id = '10000000-0000-4000-8000-000000000502'" \
  'lifecycle-first disable race rejects the insert'

cat >"$tmp_dir/uninstall-config-first-a.sql" <<'SQL'
begin;
select public.c2_test_lock_eligible_parent(
  '10000000-0000-4000-8000-000000000503', 1);
update public.every8d_provider_configurations
set credential_state = 'configured',
    uid_ciphertext = decode('c3','hex'),
    password_ciphertext = decode('d4','hex'),
    encryption_key_version = 'synthetic-race-v2',
    credential_revision = 3,
    replaced_at = clock_timestamp(),
    disconnected_at = null
where id = '20000000-0000-4000-8000-000000000503';
select pg_sleep(2);
commit;
SQL
cat >"$tmp_dir/uninstall-config-first-b.sql" <<'SQL'
select r.marketplace_app_id, r.oauth_client_id, r.conversation_provider_id,
  v.marketplace_version_id
from public.ghl_marketplace_app_registrations r
join public.ghl_marketplace_app_version_registrations v
  using (app_namespace)
where r.app_namespace = 'every8d_connect'
order by r.marketplace_app_id, v.marketplace_version_id
limit 1
\gset c2_
begin;
set local role service_role;
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'UNINSTALL',
  :'c2_marketplace_app_id', :'c2_oauth_client_id',
  null, 'c2-race-uninstall-config-first', null,
  :'c2_conversation_provider_id', :'c2_marketplace_version_id',
  '2090-06-01T00:01:00Z', 'c2_race_uninstall_503'
);
commit;
SQL
run_serialized_race 'reconnect versus UNINSTALL (configuration first)' \
  c2_reconnect_un_a "$tmp_dir/uninstall-config-first-a.sql" \
  c2_reconnect_un_b "$tmp_dir/uninstall-config-first-b.sql" success
assert_query "select i.status = 'uninstalled'
    and i.installation_generation = 2
    and c.credential_state = 'disconnected'
    and c.credential_revision = 4
    and c.uid_ciphertext is null and c.password_ciphertext is null
    and not c.safesay_enabled and c.safesay_event_id = 'event-race-503'
  from public.ghl_marketplace_installations i
  join public.every8d_provider_configurations c on c.installation_id = i.id
  where i.id = '10000000-0000-4000-8000-000000000503'" \
  'configuration-first UNINSTALL race ends scrubbed'

cat >"$tmp_dir/uninstall-lifecycle-first-a.sql" <<'SQL'
select r.marketplace_app_id, r.oauth_client_id, r.conversation_provider_id,
  v.marketplace_version_id
from public.ghl_marketplace_app_registrations r
join public.ghl_marketplace_app_version_registrations v
  using (app_namespace)
where r.app_namespace = 'every8d_connect'
order by r.marketplace_app_id, v.marketplace_version_id
limit 1
\gset c2_
begin;
set local role service_role;
select public.apply_every8d_ghl_marketplace_lifecycle_v2(
  'UNINSTALL',
  :'c2_marketplace_app_id', :'c2_oauth_client_id',
  null, 'c2-race-uninstall-lifecycle-first', null,
  :'c2_conversation_provider_id', :'c2_marketplace_version_id',
  '2090-06-01T00:01:00Z', 'c2_race_uninstall_504'
);
reset role;
select pg_sleep(2);
commit;
SQL
cat >"$tmp_dir/uninstall-lifecycle-first-b.sql" <<'SQL'
begin;
select public.c2_test_lock_eligible_parent(
  '10000000-0000-4000-8000-000000000504', 1);
update public.every8d_provider_configurations
set credential_state = 'configured',
    uid_ciphertext = decode('c3','hex'),
    password_ciphertext = decode('d4','hex'),
    encryption_key_version = 'synthetic-race-v2',
    credential_revision = 3,
    replaced_at = clock_timestamp(),
    disconnected_at = null
where id = '20000000-0000-4000-8000-000000000504';
commit;
SQL
run_serialized_race 'reconnect versus UNINSTALL (lifecycle first)' \
  c2_un_reconnect_a "$tmp_dir/uninstall-lifecycle-first-a.sql" \
  c2_un_reconnect_b "$tmp_dir/uninstall-lifecycle-first-b.sql" eligibility_failure
assert_query "select i.status = 'uninstalled'
    and i.installation_generation = 2
    and c.credential_state = 'disconnected'
    and c.credential_revision = 2
    and c.uid_ciphertext is null and c.password_ciphertext is null
    and c.safesay_event_id = 'event-race-504'
  from public.ghl_marketplace_installations i
  join public.every8d_provider_configurations c on c.installation_id = i.id
  where i.id = '10000000-0000-4000-8000-000000000504'" \
  'lifecycle-first UNINSTALL race rejects reconnect'

cat >"$tmp_dir/generation-config-first-a.sql" <<'SQL'
begin;
select public.c2_test_lock_eligible_parent(
  '10000000-0000-4000-8000-000000000505', 1);
update public.every8d_provider_configurations
set site_url = 'synthetic-race-replaced.example.invalid',
    uid_ciphertext = decode('c3','hex'),
    password_ciphertext = decode('d4','hex'),
    encryption_key_version = 'synthetic-race-v2',
    credential_revision = 2,
    replaced_at = clock_timestamp()
where id = '20000000-0000-4000-8000-000000000505';
select pg_sleep(2);
commit;
SQL
cat >"$tmp_dir/generation-config-first-b.sql" <<'SQL'
begin;
update public.ghl_marketplace_installations
set installation_generation = 2
where id = '10000000-0000-4000-8000-000000000505';
commit;
SQL
run_serialized_race 'authority replacement versus generation advance (configuration first)' \
  c2_replace_gen_a "$tmp_dir/generation-config-first-a.sql" \
  c2_replace_gen_b "$tmp_dir/generation-config-first-b.sql" success
assert_query "select i.installation_generation = 2
    and c.installation_generation = 1
    and c.credential_state = 'disconnected'
    and c.credential_revision = 3
    and c.uid_ciphertext is null and c.password_ciphertext is null
  from public.ghl_marketplace_installations i
  join public.every8d_provider_configurations c on c.installation_id = i.id
  where i.id = '10000000-0000-4000-8000-000000000505'" \
  'configuration-first generation race scrubs old generation'

cat >"$tmp_dir/generation-lifecycle-first-a.sql" <<'SQL'
begin;
update public.ghl_marketplace_installations
set installation_generation = 2
where id = '10000000-0000-4000-8000-000000000506';
select pg_sleep(2);
commit;
SQL
cat >"$tmp_dir/generation-lifecycle-first-b.sql" <<'SQL'
begin;
select public.c2_test_lock_eligible_parent(
  '10000000-0000-4000-8000-000000000506', 1);
update public.every8d_provider_configurations
set site_url = 'synthetic-race-replaced.example.invalid',
    uid_ciphertext = decode('c3','hex'),
    password_ciphertext = decode('d4','hex'),
    encryption_key_version = 'synthetic-race-v2',
    credential_revision = 2,
    replaced_at = clock_timestamp()
where id = '20000000-0000-4000-8000-000000000506';
commit;
SQL
run_serialized_race 'authority replacement versus generation advance (lifecycle first)' \
  c2_gen_replace_a "$tmp_dir/generation-lifecycle-first-a.sql" \
  c2_gen_replace_b "$tmp_dir/generation-lifecycle-first-b.sql" eligibility_failure
assert_query "select i.installation_generation = 2
    and c.installation_generation = 1
    and c.credential_state = 'disconnected'
    and c.credential_revision = 2
    and c.uid_ciphertext is null and c.password_ciphertext is null
  from public.ghl_marketplace_installations i
  join public.every8d_provider_configurations c on c.installation_id = i.id
  where i.id = '10000000-0000-4000-8000-000000000506'" \
  'lifecycle-first generation race rejects replacement'

assert_query "select not exists (
  select 1
  from public.every8d_provider_configurations c
  join public.ghl_marketplace_installations i on i.id = c.installation_id
  where i.location_id like 'c2-race-%'
    and (i.status not in ('pending', 'active')
      or c.installation_generation <> i.installation_generation)
    and (c.credential_state <> 'disconnected'
      or c.uid_ciphertext is not null
      or c.password_ciphertext is not null
      or c.encryption_key_version is not null
      or c.safesay_enabled)
)" 'all committed race outcomes are free of stale or ineligible secrets'
psql_query -qc 'drop function public.c2_test_lock_eligible_parent(uuid, integer)'
echo 'Deterministic C2 parent-before-configuration concurrency races passed'

psql_query -q <<'SQL' >/dev/null
do $$
begin
  if not exists (
    select 1 from public.ghl_marketplace_app_registrations
    where app_namespace = 'every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_registrations (
      app_namespace, marketplace_app_id, oauth_client_id,
      conversation_provider_id, channel, provider
    ) values (
      'every8d_connect', 'c2-rollback-app', 'c2.rollback.client',
      'c2-rollback-provider', 'sms', 'every8d'
    );
  end if;
  if not exists (
    select 1 from public.ghl_marketplace_app_version_registrations
    where app_namespace = 'every8d_connect'
  ) then
    insert into public.ghl_marketplace_app_version_registrations (
      app_namespace, marketplace_version_id
    ) values ('every8d_connect', 'c2.rollback.version');
  end if;
end;
$$;

insert into public.tenants (
  id, location_id, ghl_provider_id, line_channel_id
) values (
  '00000000-0000-4000-8000-000000000499',
  'c2-populated-rollback', 'line-499', 'line-channel-499'
);

insert into public.ghl_marketplace_installations (
  id, app_namespace, marketplace_app_id, oauth_client_id,
  tenant_id, location_id, company_id, conversation_provider_id,
  channel, provider, status, installation_generation,
  latest_lifecycle_event_at, latest_lifecycle_event_id,
  latest_lifecycle_event_type, latest_lifecycle_version_id
)
select
  '10000000-0000-4000-8000-000000000499',
  r.app_namespace, r.marketplace_app_id, r.oauth_client_id,
  '00000000-0000-4000-8000-000000000499',
  'c2-populated-rollback', 'c2-company', r.conversation_provider_id,
  r.channel, r.provider, 'pending', 1,
  '2090-05-01T00:00:00Z', 'c2_populated_rollback_install',
  'INSTALL', v.marketplace_version_id
from public.ghl_marketplace_app_registrations r
join public.ghl_marketplace_app_version_registrations v
  using (app_namespace)
where r.app_namespace = 'every8d_connect';

insert into public.every8d_provider_configurations (
  installation_id, installation_generation, site_url,
  credential_state, uid_ciphertext, password_ciphertext,
  encryption_key_version, credential_revision, safesay_event_id
) values (
  '10000000-0000-4000-8000-000000000499', 1,
  'synthetic-populated.example.invalid', 'configured',
  decode('71', 'hex'), decode('72', 'hex'),
  'synthetic-v1', 1, 'event-populated'
);
SQL

schema_dump >"$tmp_dir/schema-before-refused-rollback.sql"
expect_failure 'C2 rollback refused: EVERY8D provider configuration rows exist' populated_rollback psql_query <"$rollback"
schema_dump >"$tmp_dir/schema-after-refused-rollback.sql"
cmp -s "$tmp_dir/schema-before-refused-rollback.sql" "$tmp_dir/schema-after-refused-rollback.sql" || {
  echo 'FAIL: populated rollback refusal changed schema objects' >&2
  exit 1
}
assert_query "select count(*) = 1
  from public.every8d_provider_configurations
  where credential_state = 'configured'
    and uid_ciphertext is not null
    and password_ciphertext is not null
  and exists (
    select 1 from pg_trigger
    where tgrelid = 'public.ghl_marketplace_installations'::regclass
      and tgname = 'invalidate_every8d_provider_cfg_after_install_update'
      and not tgisinternal
  )
  and exists (
    select 1 from pg_trigger
    where tgrelid = 'public.every8d_provider_configurations'::regclass
      and tgname = 'protect_every8d_provider_configuration'
      and not tgisinternal
  )
  and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'every8d_provider_configurations'
      and policyname = 'every8d_provider_configurations_service_role_select'
  )" 'populated rollback refusal leaves every C2 object and row intact'
compare_preexisting_boundary "$tmp_dir/before" "$tmp_dir/after-rollback"

echo 'EVERY8D C2 provider configuration PostgreSQL 17 proofs passed'
