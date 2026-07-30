const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const supabaseConfig = require("../dist/config/supabase");
const repository = require("../dist/services/repository");

test("exact-count mapping helper applies tenant plus one exact identifier and limits returned rows", async () => {
  const calls = [];
  const query = {
    select(columns, options) { calls.push(["select", columns, options]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    async limit(value) {
      calls.push(["limit", value]);
      return { data: [{ id: "profile-a" }, { id: "profile-b" }], error: null, count: 3 };
    }
  };
  const originalGetSupabase = supabaseConfig.getSupabase;
  supabaseConfig.getSupabase = () => ({
    from(table) {
      calls.push(["from", table]);
      return query;
    }
  });

  try {
    const result = await repository.countLineProfilesExactlyForTenant(" tenant-test ", { contactId: " contact-test " });
    assert.equal(result.exactCount, 3);
    assert.equal(result.rows.length, 2);
    assert.deepEqual(calls, [
      ["from", "line_profiles"],
      ["select", "*", { count: "exact" }],
      ["eq", "tenant_id", "tenant-test"],
      ["eq", "ghl_contact_id", "contact-test"],
      ["limit", 2]
    ]);
  } finally {
    supabaseConfig.getSupabase = originalGetSupabase;
  }
});

test("exact-count helper implementation never calls the canonical profile selector", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "services", "repository.ts"), "utf8");
  const start = source.indexOf("export async function countLineProfilesExactlyForTenant");
  const end = source.indexOf("export async function", start + 1);
  const implementation = source.slice(start, end === -1 ? source.length : end);

  assert.ok(start >= 0);
  assert.doesNotMatch(implementation, /findCanonicalLineProfileByLineUser/);
});
