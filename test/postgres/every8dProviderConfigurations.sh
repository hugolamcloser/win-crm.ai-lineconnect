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
      and tgname = left(
        'invalidate_every8d_provider_configuration_after_installation_update', 63
      )
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
