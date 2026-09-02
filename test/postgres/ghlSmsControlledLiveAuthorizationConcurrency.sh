#!/usr/bin/env bash

set -euo pipefail

: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"

readonly database="wincrm_test"
readonly tenant_id="00000000-0000-4000-8000-000000000090"
readonly location_id="issue-90-location"
readonly contact_id="issue-90-contact"
readonly authorization_id="10000000-0000-4000-8000-000000000090"
readonly revoked_authorization_id="10000000-0000-4000-8000-000000000091"
readonly rollback_authorization_id="10000000-0000-4000-8000-000000000092"
readonly created_to_armed_authorization_id="10000000-0000-4000-8000-000000000093"
readonly created_to_revoked_authorization_id="10000000-0000-4000-8000-000000000094"
readonly armed_to_revoked_authorization_id="10000000-0000-4000-8000-000000000095"
readonly operation_a_id="20000000-0000-4000-8000-000000000090"
readonly operation_b_id="20000000-0000-4000-8000-000000000091"
readonly rollback_operation_id="20000000-0000-4000-8000-000000000092"
readonly destination_fingerprint="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
readonly message_fingerprint="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

race_a_log="$(mktemp)"
race_b_log="$(mktemp)"
rollback_log="$(mktemp)"
race_a_pid=""
race_b_pid=""

cleanup() {
  if [[ -n "$race_a_pid" ]]; then
    kill "$race_a_pid" 2>/dev/null || true
  fi
  if [[ -n "$race_b_pid" ]]; then
    kill "$race_b_pid" 2>/dev/null || true
  fi
  rm -f "$race_a_log" "$race_b_log" "$rollback_log"
}
trap cleanup EXIT

psql_query() {
  docker exec "$POSTGRES_CONTAINER_ID" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" "$@"
}

psql_query -c "
  insert into public.tenants (id, location_id, ghl_provider_id, line_channel_id)
  values ('$tenant_id', '$location_id', 'issue-90-provider', 'issue-90-line-channel');

  insert into public.ghl_sms_outbound_operations (
    id, tenant_id, location_id, ghl_message_id, provider_mode
  ) values
    ('$operation_a_id', '$tenant_id', '$location_id', 'issue-90-message-a', 'controlled_live'),
    ('$operation_b_id', '$tenant_id', '$location_id', 'issue-90-message-b', 'controlled_live'),
    ('$rollback_operation_id', '$tenant_id', '$location_id', 'issue-90-message-rollback', 'controlled_live');

  insert into public.ghl_sms_outbound_operations (
    tenant_id, location_id, ghl_message_id, provider_mode
  ) values (
    '$tenant_id', '$location_id', 'issue-90-existing-mock', 'mock'
  );

  insert into public.ghl_sms_controlled_live_authorizations (
    id,
    tenant_id,
    location_id,
    contact_id,
    destination_fingerprint,
    message_fingerprint,
    state,
    armed_at,
    revoked_at
  ) values
    (
      '$authorization_id', '$tenant_id', '$location_id', '$contact_id',
      '$destination_fingerprint', '$message_fingerprint', 'armed', now(), null
    ),
    (
      '$rollback_authorization_id', '$tenant_id', '$location_id', '$contact_id',
      '$destination_fingerprint', '$message_fingerprint', 'armed', now(), null
    ),
    (
      '$revoked_authorization_id', '$tenant_id', '$location_id', '$contact_id',
      '$destination_fingerprint', '$message_fingerprint', 'revoked', null, now()
    ),
    (
      '$created_to_armed_authorization_id', '$tenant_id', '$location_id', '$contact_id',
      '$destination_fingerprint', '$message_fingerprint', 'created', null, null
    ),
    (
      '$created_to_revoked_authorization_id', '$tenant_id', '$location_id', '$contact_id',
      '$destination_fingerprint', '$message_fingerprint', 'created', null, null
    ),
    (
      '$armed_to_revoked_authorization_id', '$tenant_id', '$location_id', '$contact_id',
      '$destination_fingerprint', '$message_fingerprint', 'armed', now(), null
    );

  update public.ghl_sms_controlled_live_authorizations
  set state = 'armed', armed_at = now()
  where id = '$created_to_armed_authorization_id';

  update public.ghl_sms_controlled_live_authorizations
  set state = 'revoked', revoked_at = now()
  where id = '$created_to_revoked_authorization_id';

  update public.ghl_sms_controlled_live_authorizations
  set state = 'revoked', revoked_at = now()
  where id = '$armed_to_revoked_authorization_id';
"

psql_query -c "
  do \$proof\$
  declare
    rejected boolean;
    candidate text;
  begin
    if not exists (
      select 1
      from pg_catalog.pg_class
      where oid = 'public.ghl_sms_controlled_live_authorizations'::regclass
        and relrowsecurity
    ) then
      raise exception 'controlled-live authorization RLS is not enabled';
    end if;

    if has_table_privilege(
      'anon', 'public.ghl_sms_controlled_live_authorizations', 'SELECT'
    ) or has_table_privilege(
      'anon', 'public.ghl_sms_controlled_live_authorizations', 'INSERT'
    ) or has_table_privilege(
      'anon', 'public.ghl_sms_controlled_live_authorizations', 'UPDATE'
    ) or has_table_privilege(
      'anon', 'public.ghl_sms_controlled_live_authorizations', 'DELETE'
    ) or has_table_privilege(
      'authenticated', 'public.ghl_sms_controlled_live_authorizations', 'SELECT'
    ) or has_table_privilege(
      'authenticated', 'public.ghl_sms_controlled_live_authorizations', 'INSERT'
    ) or has_table_privilege(
      'authenticated', 'public.ghl_sms_controlled_live_authorizations', 'UPDATE'
    ) or has_table_privilege(
      'authenticated', 'public.ghl_sms_controlled_live_authorizations', 'DELETE'
    ) then
      raise exception 'ordinary client role retained authorization table privileges';
    end if;

    if has_function_privilege(
      'anon',
      'public.consume_ghl_sms_controlled_live_authorization_v1(uuid,uuid,uuid,text,text,text,text,text,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.consume_ghl_sms_controlled_live_authorization_v1(uuid,uuid,uuid,text,text,text,text,text,text)',
      'EXECUTE'
    ) or not has_function_privilege(
      'service_role',
      'public.consume_ghl_sms_controlled_live_authorization_v1(uuid,uuid,uuid,text,text,text,text,text,text)',
      'EXECUTE'
    ) then
      raise exception 'controlled-live RPC role privileges are invalid';
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          p.proacl,
          pg_catalog.acldefault('f', p.proowner)
        )
      ) acl
      where p.oid =
        'public.consume_ghl_sms_controlled_live_authorization_v1(uuid,uuid,uuid,text,text,text,text,text,text)'::regprocedure
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'PUBLIC retained controlled-live RPC execution';
    end if;

    if has_function_privilege(
      'anon',
      'public.protect_ghl_sms_controlled_live_authorization_v1()',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.protect_ghl_sms_controlled_live_authorization_v1()',
      'EXECUTE'
    ) then
      raise exception 'ordinary client role retained transition-function execution';
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where p.oid =
        'public.protect_ghl_sms_controlled_live_authorization_v1()'::regprocedure
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'PUBLIC retained transition-function execution';
    end if;

    if not exists (
      select 1 from public.ghl_sms_controlled_live_authorizations
      where id = '$created_to_armed_authorization_id'
        and state = 'armed'
        and armed_at is not null
    ) or not exists (
      select 1 from public.ghl_sms_controlled_live_authorizations
      where id = '$created_to_revoked_authorization_id'
        and state = 'revoked'
        and armed_at is null
        and revoked_at is not null
    ) or not exists (
      select 1 from public.ghl_sms_controlled_live_authorizations
      where id = '$armed_to_revoked_authorization_id'
        and state = 'revoked'
        and armed_at is not null
        and revoked_at is not null
    ) then
      raise exception 'allowed authorization transitions did not persist';
    end if;

    if not exists (
      select 1 from public.ghl_sms_outbound_operations
      where tenant_id = '$tenant_id'
        and ghl_message_id = 'issue-90-existing-mock'
        and provider_mode = 'mock'
    ) then
      raise exception 'existing mock operation did not remain valid';
    end if;

    if not exists (
      select 1 from public.ghl_sms_outbound_operations
      where id = '$operation_a_id' and provider_mode = 'controlled_live'
    ) then
      raise exception 'controlled_live operation mode was not accepted';
    end if;

    foreach candidate in array array['live', 'production', 'default'] loop
      rejected := false;
      begin
        insert into public.ghl_sms_outbound_operations (
          tenant_id, location_id, ghl_message_id, provider_mode
        ) values (
          '$tenant_id', '$location_id', 'unsupported-' || candidate, candidate
        );
      exception when check_violation then
        rejected := true;
      end;
      if not rejected then
        raise exception 'unsupported provider_mode % was accepted', candidate;
      end if;
    end loop;

    rejected := false;
    begin
      insert into public.ghl_sms_controlled_live_authorizations (
        tenant_id, location_id, contact_id,
        destination_fingerprint, message_fingerprint, state
      ) values (
        '$tenant_id', '$location_id', '$contact_id',
        '$destination_fingerprint', '$message_fingerprint', 'consumed'
      );
    exception when check_violation then
      rejected := true;
    end;
    if not rejected then
      raise exception 'inconsistent consumed authorization was accepted';
    end if;

    rejected := false;
    begin
      update public.ghl_sms_controlled_live_authorizations
      set state = 'armed', revoked_at = null, armed_at = now()
      where id = '$revoked_authorization_id';
    exception when sqlstate 'P0001' then
      rejected := true;
    end;
    if not rejected then
      raise exception 'revoked authorization returned to armed';
    end if;

    rejected := false;
    begin
      update public.ghl_sms_controlled_live_authorizations
      set contact_id = 'mutated-contact'
      where id = '$authorization_id';
    exception when sqlstate 'P0001' then
      rejected := true;
    end;
    if not rejected then
      raise exception 'armed authorization scope was mutable';
    end if;
  end
  \$proof\$;
"

psql_query -c "
  create function public.issue_90_hold_authorization_race()
  returns trigger
  language plpgsql
  as \$trigger\$
  begin
    if new.id = '$authorization_id'
      and current_setting('application_name') = 'issue_90_authorization_a' then
      perform pg_sleep(3);
    end if;
    return new;
  end;
  \$trigger\$;

  create trigger issue_90_hold_authorization_race
  before update on public.ghl_sms_controlled_live_authorizations
  for each row execute function public.issue_90_hold_authorization_race();
"

docker exec -e PGAPPNAME=issue_90_authorization_a "$POSTGRES_CONTAINER_ID" \
  psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database" -c "
    select public.consume_ghl_sms_controlled_live_authorization_v1(
      '$authorization_id', '$operation_a_id', '$tenant_id', '$location_id',
      '$contact_id', 'every8d', 'controlled_live',
      '$destination_fingerprint', '$message_fingerprint'
    );
  " >"$race_a_log" 2>&1 &
race_a_pid=$!

race_a_held=false
for _ in $(seq 1 50); do
  if [[ "$(psql_query -Atc "
    select count(*) from pg_stat_activity
    where application_name = 'issue_90_authorization_a'
      and wait_event = 'PgSleep';
  ")" == "1" ]]; then
    race_a_held=true
    break
  fi
  sleep 0.1
done

if [[ "$race_a_held" != "true" ]]; then
  echo "Authorization caller A did not hold the one-time row" >&2
  exit 1
fi

docker exec -e PGAPPNAME=issue_90_authorization_b "$POSTGRES_CONTAINER_ID" \
  psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$database" -c "
    select public.consume_ghl_sms_controlled_live_authorization_v1(
      '$authorization_id', '$operation_b_id', '$tenant_id', '$location_id',
      '$contact_id', 'every8d', 'controlled_live',
      '$destination_fingerprint', '$message_fingerprint'
    );
  " >"$race_b_log" 2>&1 &
race_b_pid=$!

race_b_blocked=false
for _ in $(seq 1 30); do
  if [[ "$(psql_query -Atc "
    select count(*) from pg_stat_activity
    where application_name = 'issue_90_authorization_b'
      and wait_event = 'transactionid';
  ")" == "1" ]]; then
    race_b_blocked=true
    break
  fi
  sleep 0.1
done

if [[ "$race_b_blocked" != "true" ]]; then
  echo "Authorization caller B was not observed waiting on caller A" >&2
  exit 1
fi

set +e
wait "$race_a_pid"
race_a_status=$?
race_a_pid=""
wait "$race_b_pid"
race_b_status=$?
race_b_pid=""
set -e

if [[ "$race_a_status" -ne 0 || "$race_b_status" -ne 0 ]]; then
  echo "Both authorization RPC calls must return a boolean result" >&2
  exit 1
fi

rpc_successes=$(( $(grep -cx 't' "$race_a_log" || true) + $(grep -cx 't' "$race_b_log" || true) ))
rpc_losses=$(( $(grep -cx 'f' "$race_a_log" || true) + $(grep -cx 'f' "$race_b_log" || true) ))

if [[ "$rpc_successes" -ne 1 || "$rpc_losses" -ne 1 ]]; then
  echo "Expected one RPC success and one RPC loss" >&2
  exit 1
fi

psql_query -c "
  drop trigger issue_90_hold_authorization_race
    on public.ghl_sms_controlled_live_authorizations;
  drop function public.issue_90_hold_authorization_race();
"

race_summary="$(psql_query -Atc "
  select
    (select count(*) from public.ghl_sms_controlled_live_authorizations
      where id = '$authorization_id' and state = 'consumed' and consumed_at is not null),
    (select count(*) from public.ghl_sms_outbound_operations
      where id in ('$operation_a_id', '$operation_b_id')
        and send_started_at is not null and provider_attempts = 1),
    (select count(*) from public.ghl_sms_outbound_operations
      where id in ('$operation_a_id', '$operation_b_id')
        and send_started_at is null and provider_attempts = 0),
    (select (consumed_by_operation_id in ('$operation_a_id', '$operation_b_id'))::int
      from public.ghl_sms_controlled_live_authorizations
      where id = '$authorization_id'),
    (select count(*) from public.ghl_sms_outbound_operations outbound_operation
      join public.ghl_sms_controlled_live_authorizations live_authorization
        on live_authorization.consumed_by_operation_id = outbound_operation.id
      where live_authorization.id = '$authorization_id'
        and outbound_operation.send_started_at is not null
        and outbound_operation.provider_attempts = 1);
")"

if [[ "$race_summary" != "1|1|1|1|1" ]]; then
  echo "Controlled-live race evidence was inconsistent: $race_summary" >&2
  exit 1
fi

psql_query -c "
  do \$proof\$
  declare
    rejected boolean;
    winning_operation uuid;
  begin
    select consumed_by_operation_id into winning_operation
    from public.ghl_sms_controlled_live_authorizations
    where id = '$authorization_id';

    rejected := false;
    begin
      insert into public.ghl_sms_controlled_live_authorizations (
        tenant_id,
        location_id,
        contact_id,
        destination_fingerprint,
        message_fingerprint,
        state,
        armed_at,
        consumed_at,
        consumed_by_operation_id
      ) values (
        '$tenant_id',
        '$location_id',
        '$contact_id',
        '$destination_fingerprint',
        '$message_fingerprint',
        'consumed',
        now(),
        now(),
        winning_operation
      );
    exception when unique_violation then
      rejected := true;
    end;
    if not rejected then
      raise exception 'one operation accepted multiple consumed authorizations';
    end if;

    rejected := false;
    begin
      update public.ghl_sms_controlled_live_authorizations
      set state = 'armed', consumed_at = null, consumed_by_operation_id = null
      where id = '$authorization_id';
    exception when sqlstate 'P0001' then
      rejected := true;
    end;
    if not rejected then
      raise exception 'consumed authorization returned to armed';
    end if;

    rejected := false;
    begin
      update public.ghl_sms_controlled_live_authorizations
      set state = 'created', consumed_at = null, consumed_by_operation_id = null
      where id = '$authorization_id';
    exception when sqlstate 'P0001' then
      rejected := true;
    end;
    if not rejected then
      raise exception 'consumed authorization returned to created';
    end if;

    rejected := false;
    begin
      update public.ghl_sms_controlled_live_authorizations
      set state = 'created', revoked_at = null
      where id = '$revoked_authorization_id';
    exception when sqlstate 'P0001' then
      rejected := true;
    end;
    if not rejected then
      raise exception 'revoked authorization returned to created';
    end if;

    rejected := false;
    begin
      update public.ghl_sms_controlled_live_authorizations
      set consumed_at = null
      where id = '$authorization_id';
    exception when sqlstate 'P0001' then
      rejected := true;
    end;
    if not rejected then
      raise exception 'consumed_at was cleared';
    end if;

    rejected := false;
    begin
      update public.ghl_sms_controlled_live_authorizations
      set consumed_by_operation_id = null
      where id = '$authorization_id';
    exception when sqlstate 'P0001' then
      rejected := true;
    end;
    if not rejected then
      raise exception 'consumed operation binding was cleared';
    end if;

    rejected := false;
    begin
      update public.ghl_sms_controlled_live_authorizations
      set consumed_by_operation_id = '$rollback_operation_id'
      where id = '$authorization_id';
    exception when sqlstate 'P0001' then
      rejected := true;
    end;
    if not rejected then
      raise exception 'consumed operation binding was changed';
    end if;

    rejected := false;
    begin
      delete from public.ghl_sms_controlled_live_authorizations
      where id = '$authorization_id';
    exception when sqlstate 'P0001' then
      rejected := true;
    end;
    if not rejected then
      raise exception 'consumed authorization evidence was deleted';
    end if;
  end
  \$proof\$;
"

psql_query -c "
  create function public.issue_90_force_send_start_rollback()
  returns trigger
  language plpgsql
  as \$trigger\$
  begin
    if new.id = '$rollback_operation_id' and new.send_started_at is not null then
      raise exception 'synthetic send-start failure' using errcode = 'P0001';
    end if;
    return new;
  end;
  \$trigger\$;

  create trigger issue_90_force_send_start_rollback
  before update on public.ghl_sms_outbound_operations
  for each row execute function public.issue_90_force_send_start_rollback();
"

set +e
psql_query -c "
  select public.consume_ghl_sms_controlled_live_authorization_v1(
    '$rollback_authorization_id', '$rollback_operation_id', '$tenant_id', '$location_id',
    '$contact_id', 'every8d', 'controlled_live',
    '$destination_fingerprint', '$message_fingerprint'
  );
" >"$rollback_log" 2>&1
rollback_status=$?
set -e

if [[ "$rollback_status" -eq 0 ]]; then
  echo "Synthetic send-start failure unexpectedly committed" >&2
  exit 1
fi

psql_query -c "
  drop trigger issue_90_force_send_start_rollback
    on public.ghl_sms_outbound_operations;
  drop function public.issue_90_force_send_start_rollback();
"

rollback_summary="$(psql_query -Atc "
  select
    (select count(*) from public.ghl_sms_controlled_live_authorizations
      where id = '$rollback_authorization_id'
        and state = 'armed'
        and consumed_at is null
        and consumed_by_operation_id is null),
    (select count(*) from public.ghl_sms_outbound_operations
      where id = '$rollback_operation_id'
        and state = 'processing'
        and send_started_at is null
        and provider_attempts = 0);
")"

if [[ "$rollback_summary" != "1|1" ]]; then
  echo "Atomic rollback evidence was inconsistent: $rollback_summary" >&2
  exit 1
fi

echo "Controlled-live authorization proof passed: constraints, irreversible evidence, one race winner, and atomic rollback."
