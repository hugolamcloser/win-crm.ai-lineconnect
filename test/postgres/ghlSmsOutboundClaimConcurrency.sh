#!/usr/bin/env bash

set -euo pipefail

: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"

readonly database="wincrm_test"
readonly tenant_id="00000000-0000-4000-8000-000000000087"
readonly location_id="issue-87-location"
readonly ghl_message_id="issue-87-message"

claim_a_log="$(mktemp)"
claim_b_log="$(mktemp)"
claim_a_pid=""
claim_b_pid=""

cleanup() {
  if [[ -n "$claim_a_pid" ]]; then
    kill "$claim_a_pid" 2>/dev/null || true
  fi
  if [[ -n "$claim_b_pid" ]]; then
    kill "$claim_b_pid" 2>/dev/null || true
  fi
  rm -f "$claim_a_log" "$claim_b_log"
}
trap cleanup EXIT

psql_query() {
  docker exec "$POSTGRES_CONTAINER_ID" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" "$@"
}

psql_query -c "
  insert into public.tenants (id, location_id, ghl_provider_id, line_channel_id)
  values ('$tenant_id', '$location_id', 'issue-87-provider', 'issue-87-line-channel');
"

docker exec -i -e PGAPPNAME=issue_87_claim_a "$POSTGRES_CONTAINER_ID" \
  psql -X -v ON_ERROR_STOP=1 --set=VERBOSITY=verbose \
  -U postgres -d "$database" >"$claim_a_log" 2>&1 <<SQL &
begin;
insert into public.ghl_sms_outbound_operations (
  tenant_id,
  location_id,
  ghl_message_id
)
values ('$tenant_id', '$location_id', '$ghl_message_id');
select pg_sleep(4);
commit;
SQL
claim_a_pid=$!

claim_a_held=false
for _ in $(seq 1 50); do
  if [[ "$(psql_query -Atc "
    select count(*)
    from pg_stat_activity
    where application_name = 'issue_87_claim_a'
      and wait_event = 'PgSleep';
  ")" == "1" ]]; then
    claim_a_held=true
    break
  fi
  sleep 0.1
done

if [[ "$claim_a_held" != "true" ]]; then
  echo "Claim A did not reach the held, uncommitted state" >&2
  exit 1
fi

docker exec -e PGAPPNAME=issue_87_claim_b "$POSTGRES_CONTAINER_ID" \
  psql -X -v ON_ERROR_STOP=1 --set=VERBOSITY=verbose \
  -U postgres -d "$database" -c "
    insert into public.ghl_sms_outbound_operations (
      tenant_id,
      location_id,
      ghl_message_id
    )
    values ('$tenant_id', '$location_id', '$ghl_message_id');
  " >"$claim_b_log" 2>&1 &
claim_b_pid=$!

claim_b_blocked=false
for _ in $(seq 1 30); do
  if [[ "$(psql_query -Atc "
    select count(*)
    from pg_stat_activity
    where application_name = 'issue_87_claim_b'
      and wait_event = 'transactionid';
  ")" == "1" ]]; then
    claim_b_blocked=true
    break
  fi
  sleep 0.1
done

if [[ "$claim_b_blocked" != "true" ]]; then
  echo "Claim B was not observed waiting on Claim A's unresolved transaction" >&2
  exit 1
fi

set +e
wait "$claim_a_pid"
claim_a_status=$?
claim_a_pid=""
wait "$claim_b_pid"
claim_b_status=$?
claim_b_pid=""
set -e

successful_claims=0
if [[ "$claim_a_status" -eq 0 ]]; then
  successful_claims=$((successful_claims + 1))
fi
if [[ "$claim_b_status" -eq 0 ]]; then
  successful_claims=$((successful_claims + 1))
fi

conflicting_claims=0
if grep -Eq 'ERROR:[[:space:]]+23505:' "$claim_a_log"; then
  conflicting_claims=$((conflicting_claims + 1))
fi
if grep -Eq 'ERROR:[[:space:]]+23505:' "$claim_b_log"; then
  conflicting_claims=$((conflicting_claims + 1))
fi

row_count="$(psql_query -Atc "
  select count(*)
  from public.ghl_sms_outbound_operations
  where tenant_id = '$tenant_id'
    and location_id = '$location_id'
    and ghl_message_id = '$ghl_message_id';
")"

if [[ "$successful_claims" -ne 1 ]]; then
  echo "Expected exactly one successful claim, received $successful_claims" >&2
  exit 1
fi

if [[ "$conflicting_claims" -ne 1 ]]; then
  echo "Expected exactly one SQLSTATE 23505 conflict, received $conflicting_claims" >&2
  exit 1
fi

if [[ "$row_count" != "1" ]]; then
  echo "Expected exactly one durable claim row, received $row_count" >&2
  exit 1
fi

echo "Concurrency proof passed: one winner, one SQLSTATE 23505, one durable row."
