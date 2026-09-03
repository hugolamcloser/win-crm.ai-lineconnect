#!/usr/bin/env bash

set -euo pipefail

: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID is required}"

readonly database="wincrm_test"
readonly tenant_id="00000000-0000-4000-8000-000000000094"
readonly foreign_tenant_id="00000000-0000-4000-8000-000000000095"
readonly location_id="reconciliation-dry-run-location"
readonly operation_a="00000000-0000-4000-8000-0000000000a1"
readonly operation_b="00000000-0000-4000-8000-0000000000b2"
readonly operation_reversed="00000000-0000-4000-8000-0000000000f6"
readonly operation_expired="00000000-0000-4000-8000-0000000000c3"
readonly operation_abandoned="00000000-0000-4000-8000-0000000000d4"
readonly operation_blocked="00000000-0000-4000-8000-0000000000e5"
readonly master_contact="reconciliation-master"
readonly candidate_contact="reconciliation-candidate"
readonly other_contact="reconciliation-other"

claim_a_log="$(mktemp)"
claim_b_log="$(mktemp)"
claim_a_pid=""
claim_b_pid=""

cleanup() {
  if [[ -n "$claim_a_pid" ]]; then kill "$claim_a_pid" 2>/dev/null || true; fi
  if [[ -n "$claim_b_pid" ]]; then kill "$claim_b_pid" 2>/dev/null || true; fi
  rm -f "$claim_a_log" "$claim_b_log"
}
trap cleanup EXIT

psql_query() {
  docker exec "$POSTGRES_CONTAINER_ID" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" "$@"
}

psql_query -c "
  insert into public.tenants (id, location_id, ghl_provider_id, line_channel_id)
  values
    ('$tenant_id', '$location_id', 'reconciliation-provider', 'reconciliation-line'),
    ('$foreign_tenant_id', 'foreign-location', 'foreign-provider', 'foreign-line');

  insert into public.contact_reconciliation_operations (
    id, tenant_id, location_id, master_contact_id, candidate_contact_id, identity_type,
    line_identity_fingerprint, reconciliation_identity_fingerprint, preview_key_fingerprint,
    authorization_token_fingerprint, authorization_binding_fingerprint,
    mapping_snapshot_fingerprint, master_snapshot_fingerprint, candidate_snapshot_fingerprint,
    field_policy_fingerprint, initial_semantic_fingerprint, created_at, expires_at
  )
  values
    ('$operation_a', '$tenant_id', '$location_id', '$master_contact', '$candidate_contact', 'email',
      repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('d', 64), repeat('e', 64),
      repeat('f', 64), repeat('1', 64), repeat('2', 64), repeat('3', 64), repeat('4', 64), now(), now() + interval '1 hour'),
    ('$operation_b', '$tenant_id', '$location_id', '$candidate_contact', '$other_contact', 'email',
      repeat('5', 64), repeat('6', 64), repeat('7', 64), repeat('8', 64), repeat('9', 64),
      repeat('0', 64), repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('d', 64), now(), now() + interval '1 hour'),
    ('$operation_expired', '$tenant_id', '$location_id', 'expired-master', 'expired-candidate', 'email',
      repeat('1', 64), repeat('2', 64), repeat('3', 64), repeat('4', 64), repeat('5', 64),
      repeat('6', 64), repeat('7', 64), repeat('8', 64), repeat('9', 64), repeat('a', 64), now() - interval '2 minutes', now() - interval '1 minute'),
    ('$operation_abandoned', '$tenant_id', '$location_id', 'abandoned-master', 'abandoned-candidate', 'email',
      repeat('b', 64), repeat('c', 64), repeat('d', 64), repeat('e', 64), repeat('f', 64),
      repeat('0', 64), repeat('1', 64), repeat('2', 64), repeat('3', 64), repeat('4', 64), now(), now() + interval '1 hour'),
    ('$operation_blocked', '$tenant_id', '$location_id', 'abandoned-candidate', 'other-contact', 'email',
      repeat('5', 64), repeat('6', 64), repeat('7', 64), repeat('f', 64), repeat('0', 64),
      repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('d', 64), repeat('e', 64), now(), now() + interval '1 hour');

  insert into public.contact_reconciliation_operations (
    id, tenant_id, location_id, master_contact_id, candidate_contact_id, identity_type,
    line_identity_fingerprint, reconciliation_identity_fingerprint, preview_key_fingerprint,
    authorization_token_fingerprint, authorization_binding_fingerprint,
    mapping_snapshot_fingerprint, master_snapshot_fingerprint, candidate_snapshot_fingerprint,
    field_policy_fingerprint, initial_semantic_fingerprint, created_at, expires_at
  ) values (
    '$operation_reversed', '$tenant_id', '$location_id', '$candidate_contact', '$master_contact', 'email',
    repeat('1', 64), repeat('2', 64), repeat('3', 64), repeat('6', 64), repeat('7', 64),
    repeat('6', 64), repeat('7', 64), repeat('8', 64), repeat('9', 64), repeat('a', 64), now(), now() + interval '1 hour'
  ) on conflict do nothing;

  insert into public.contact_reconciliation_locks (
    tenant_id, location_id, contact_id, operation_id, expires_at
  ) values (
    '$tenant_id', '$location_id', 'abandoned-candidate', '$operation_abandoned', now() - interval '1 minute'
  );
"

docker exec -i -e PGAPPNAME=reconciliation_claim_a "$POSTGRES_CONTAINER_ID" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" >"$claim_a_log" 2>&1 <<SQL &
begin;
select public.claim_contact_reconciliation_dry_run_v1(
  '$operation_a', '$tenant_id', '$location_id', '$master_contact', '$candidate_contact',
  repeat('d', 64), repeat('e', 64)
);
select pg_sleep(4);
commit;
SQL
claim_a_pid=$!

claim_a_held=false
for _ in $(seq 1 50); do
  if [[ "$(psql_query -Atc "
    select count(*) from pg_stat_activity
    where application_name = 'reconciliation_claim_a' and wait_event = 'PgSleep';
  ")" == "1" ]]; then
    claim_a_held=true
    break
  fi
  sleep 0.1
done

if [[ "$claim_a_held" != "true" ]]; then
  echo "First reconciliation claim did not reach its held transaction" >&2
  exit 1
fi

docker exec -e PGAPPNAME=reconciliation_claim_b "$POSTGRES_CONTAINER_ID" \
  psql -X -v ON_ERROR_STOP=1 -At -U postgres -d "$database" -c "
    select public.claim_contact_reconciliation_dry_run_v1(
      '$operation_b', '$tenant_id', '$location_id', '$candidate_contact', '$other_contact',
      repeat('8', 64), repeat('9', 64)
    );
  " >"$claim_b_log" 2>&1 &
claim_b_pid=$!

claim_b_blocked=false
for _ in $(seq 1 30); do
  if [[ "$(psql_query -Atc "
    select count(*) from pg_stat_activity
    where application_name = 'reconciliation_claim_b' and wait_event_type = 'Lock';
  ")" == "1" ]]; then
    claim_b_blocked=true
    break
  fi
  sleep 0.1
done

if [[ "$claim_b_blocked" != "true" ]]; then
  echo "Overlapping reconciliation pair was not observed waiting on the same sorted locks" >&2
  exit 1
fi

wait "$claim_a_pid"
claim_a_pid=""
wait "$claim_b_pid"
claim_b_pid=""

if ! grep -Eq '^f$' "$claim_b_log"; then
  echo "Expected the overlapping concurrent pair to lose its claim" >&2
  exit 1
fi

locked_operations="$(psql_query -Atc "
  select count(*) from public.contact_reconciliation_operations
  where id in ('$operation_a', '$operation_b') and state = 'LOCKED';
")"
lock_rows="$(psql_query -Atc "
  select count(*) from public.contact_reconciliation_locks
  where operation_id = '$operation_a';
")"
reversed_pair_operations="$(psql_query -Atc "
  select count(*) from public.contact_reconciliation_operations
  where id = '$operation_reversed';
")"
duplicate_claim="$(psql_query -Atc "
  select public.claim_contact_reconciliation_dry_run_v1(
    '$operation_a', '$tenant_id', '$location_id', '$master_contact', '$candidate_contact',
    repeat('d', 64), repeat('e', 64)
  );
")"
foreign_context_claim="$(psql_query -Atc "
  select public.claim_contact_reconciliation_dry_run_v1(
    '$operation_b', '$foreign_tenant_id', 'foreign-location', '$candidate_contact', '$other_contact',
    repeat('8', 64), repeat('9', 64)
  );
")"
expired_claim="$(psql_query -Atc "
  select public.claim_contact_reconciliation_dry_run_v1(
    '$operation_expired', '$tenant_id', '$location_id', 'expired-master', 'expired-candidate',
    repeat('4', 64), repeat('5', 64)
  );
")"
abandoned_lock_claim="$(psql_query -Atc "
  select public.claim_contact_reconciliation_dry_run_v1(
    '$operation_blocked', '$tenant_id', '$location_id', 'abandoned-candidate', 'other-contact',
    repeat('f', 64), repeat('0', 64)
  );
")"

if [[ "$locked_operations" != "1" || "$lock_rows" != "2" || "$reversed_pair_operations" != "0" ]]; then
  echo "Expected one winning operation holding exactly two contact locks" >&2
  exit 1
fi

if [[ "$duplicate_claim" != "f" || "$foreign_context_claim" != "f" || "$expired_claim" != "f" || "$abandoned_lock_claim" != "f" ]]; then
  echo "Expected duplicate, foreign-context, expired, and abandoned-lock claims to fail closed" >&2
  exit 1
fi

echo "Reconciliation concurrency proof passed: one pair winner, reversed-pair deduplication, deterministic overlapping contention, one-time authorization, exact context, and fail-closed abandoned locks."
