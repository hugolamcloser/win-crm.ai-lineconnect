const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "202609030001_contact_reconciliation_dry_run_foundation.sql"),
  "utf8"
);
const repositorySource = fs.readFileSync(
  path.join(__dirname, "..", "src", "services", "contactReconciliationOperationRepository.ts"),
  "utf8"
);

test("dry-run migration defines isolated sanitized operations and two-contact locks", () => {
  assert.match(migration, /create table public\.contact_reconciliation_operations/i);
  assert.match(migration, /create table public\.contact_reconciliation_locks/i);
  assert.match(migration, /primary key \(tenant_id, location_id, contact_id\)/i);
  assert.match(migration, /order by contact_id/i);
  assert.match(migration, /create unique index contact_reconciliation_operations_active_pair_uidx/i);
  assert.match(migration, /least\(master_contact_id, candidate_contact_id\)/i);
  assert.match(migration, /greatest\(master_contact_id, candidate_contact_id\)/i);
  assert.match(migration, /master_contact_id <> candidate_contact_id/i);
  assert.match(migration, /'PLANNED'.*'LOCKED'.*'REVALIDATED'.*'DRY_RUN_READY'.*'FAILED_SAFE'.*'EXPIRED'/s);
  assert.match(migration, /finalized contact reconciliation operation evidence is immutable/i);

  const operationColumns = migration.slice(
    migration.indexOf("create table public.contact_reconciliation_operations"),
    migration.indexOf("create table public.contact_reconciliation_locks")
  );
  for (const forbiddenColumn of [
    /^\s*email\s+/im,
    /^\s*phone\s+/im,
    /^\s*line_user_id\s+/im,
    /^\s*access_token\s+/im,
    /^\s*refresh_token\s+/im,
    /^\s*raw_payload\s+/im,
    /^\s*message_content\s+/im
  ]) {
    assert.doesNotMatch(operationColumns, forbiddenColumn);
  }
});

test("dry-run database boundary is atomic, one-time, exact-context, and service-role constrained", () => {
  assert.match(migration, /create function public\.claim_contact_reconciliation_dry_run_v1/i);
  assert.match(migration, /authorization_consumed_at is null/i);
  assert.match(migration, /expires_at > now\(\)/i);
  assert.match(migration, /tenant_id = p_tenant_id/i);
  assert.match(migration, /location_id = p_location_id/i);
  assert.match(migration, /master_contact_id = p_master_contact_id/i);
  assert.match(migration, /candidate_contact_id = p_candidate_contact_id/i);
  assert.match(migration, /when unique_violation then\s+return false/is);
  assert.match(migration, /revoke all on table public\.contact_reconciliation_operations from service_role/i);
  assert.match(migration, /grant select, insert on table public\.contact_reconciliation_operations to service_role/i);
  assert.doesNotMatch(migration, /grant\s+(?:all|update|delete)[^;]*contact_reconciliation_operations[^;]*service_role/i);
  assert.doesNotMatch(migration, /grant[^;]*contact_reconciliation_locks[^;]*service_role/i);
});

test("operation repository can persist only the isolated audit table and declared state RPCs", () => {
  const tableTargets = [...repositorySource.matchAll(/\.from\("([^"]+)"\)/g)].map((match) => match[1]);
  const rpcTargets = [...repositorySource.matchAll(/\.rpc\("([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual([...new Set(tableTargets)], ["contact_reconciliation_operations"]);
  assert.deepEqual(rpcTargets.sort(), [
    "claim_contact_reconciliation_dry_run_v1",
    "expire_contact_reconciliation_authorization_v1",
    "finalize_contact_reconciliation_dry_run_v1",
    "mark_contact_reconciliation_revalidated_v1"
  ]);
  for (const forbidden of ["line_profiles", "contacts", "conversations", "messages", "providers", "workflows"] ) {
    assert.equal(tableTargets.includes(forbidden), false);
  }
});
