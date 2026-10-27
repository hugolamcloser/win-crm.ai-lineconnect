const assert = require("node:assert/strict");
const test = require("node:test");
const { createEvery8dSettingsEmailOutboxRepository } = require("../dist/services/every8dSettingsEmailOutboxRepository");

// Malformed transport structure is distinct from an RPC error/transport exception.
// The existing settings-auth repositories classify malformed outer responses as
// repository_contract_violation. No credentials, provider calls or retries exist.
test("malformed RPC outer result must use the existing contract-violation category", async () => {
  let calls = 0;
  const repository = createEvery8dSettingsEmailOutboxRepository(
    { enabled: false, httpEnabled: false, emailDispatchEnabled: false },
    () => ({ rpc: async () => { calls += 1; return null; } })
  );
  const result = await repository.purge({ batchSize: 1 });
  assert.equal(calls, 1, "trusted maintenance makes one RPC even with dispatch disabled");
  assert.deepEqual(result, { outcome: "failure", category: "repository_contract_violation" });
});


const F = require("./helpers/every8dSettingsEmailOutboxFixtures.cjs");
const methods = ["enqueue", "claim", "beginSend", "finalize", "recover", "purge"];
function violation(result) {
  assert.ok(result.outcome === "failure" && result.category === "repository_contract_violation", "closed contract-violation result");
  assert.ok(Object.keys(result).sort().join(",") === "category,outcome", "failure has no raw diagnostic fields");
}
function unavailable(result) {
  assert.ok(result.outcome === "failure" && result.category === "repository_unavailable", "closed unavailable result");
  assert.ok(Object.keys(result).sort().join(",") === "category,outcome", "failure has no raw diagnostic fields");
}
for (const method of methods) {
  test(`${method}: client acquisition failure is unavailable`, async () => {
    const repo = createEvery8dSettingsEmailOutboxRepository(F.GATES, () => { throw new Error("synthetic protected marker"); });
    unavailable(await repo[method](F.inputs()[method]));
  });
  test(`${method}: invocation rejection is unavailable without retry`, async () => {
    const { repo, calls } = F.repository(() => { throw new Error("synthetic protected marker"); });
    unavailable(await repo[method](F.inputs()[method])); assert.equal(calls.length, 1);
  });
  test(`${method}: returned RPC error is unavailable`, async () => {
    const { repo, calls } = F.repository({ data: null, error: { message: "synthetic protected marker", code: "synthetic" } });
    unavailable(await repo[method](F.inputs()[method])); assert.equal(calls.length, 1);
  });
  for (const [index, outer] of [null, undefined, false, 1, "invalid", [], {}, { data: [] },
      { error: null }, { payload: [], error: null }, { data: [], err: null }].entries()) {
    test(`${method}: malformed outer structure ${index} is a contract violation`, async () => {
      const { repo, calls } = F.repository(outer); violation(await repo[method](F.inputs()[method])); assert.equal(calls.length, 1);
    });
  }
  test(`${method}: successfully returned throwing field is a contract violation`, async () => {
    const outer = { error: null, get data() { throw new Error("synthetic protected marker"); } };
    const { repo } = F.repository(outer); violation(await repo[method](F.inputs()[method]));
  });
  test(`${method}: valid response retains SDK metadata compatibility`, async () => {
    const { repo, calls } = F.repository({ data: [F.responses()[method]], error: null, status: 200, statusText: "OK", count: null });
    const result = await repo[method](F.inputs()[method]); assert.ok(result.outcome === "applied", "valid result applied"); assert.equal(calls.length, 1);
  });
  test(`${method}: empty result cardinality follows the frozen operation`, async () => {
    const { repo } = F.repository({ data: [], error: null }); const result = await repo[method](F.inputs()[method]);
    if (method === "purge") violation(result);
    else if (["claim", "recover"].includes(method)) assert.ok(result.outcome === "applied" && result.receipts.length === 0);
    else assert.ok(result.outcome === "not_applied");
  });
  test(`${method}: excessive return cardinality is a contract violation`, async () => {
    const { repo } = F.repository({ data: [F.responses()[method], F.responses()[method]], error: null });
    violation(await repo[method](F.inputs()[method]));
  });
  for (const [index, data] of [null, {}, "invalid", [null], [false], ["invalid"], Array(1)].entries()) {
    test(`${method}: malformed row container ${index} is a contract violation`, async () => {
      const { repo } = F.repository({ data, error: null }); violation(await repo[method](F.inputs()[method]));
    });
  }
  for (const key of Object.keys(F.responses()[method])) {
    for (const mutation of ["missing", "invalid"]) {
      test(`${method}: ${key} ${mutation} is a contract violation`, async () => {
        const row = { ...F.responses()[method] }; if (mutation === "missing") delete row[key]; else row[key] = {};
        const { repo } = F.repository({ data: [row], error: null }); violation(await repo[method](F.inputs()[method]));
      });
    }
  }
  test(`${method}: extra receipt field is a contract violation`, async () => {
    const { repo } = F.repository({ data: [{ ...F.responses()[method], unexpected: "synthetic protected marker" }], error: null });
    violation(await repo[method](F.inputs()[method]));
  });
}
for (const method of ["enqueue", "beginSend", "finalize"]) {
  test(`${method}: receipt job identity must match the request`, async () => {
    const { repo } = F.repository({ data: [{ ...F.responses()[method], job_id: F.OTHER }], error: null });
    violation(await repo[method](F.inputs()[method]));
  });
}
for (const [method, field, value] of [["claim", "lease_id", null], ["beginSend", "lease_id", null],
    ["beginSend", "terminal_at", F.NOW], ["finalize", "available_at", F.NOW], ["recover", "terminal_at", F.NOW]]) {
  test(`${method}: inconsistent state-dependent ${field} NULL shape`, async () => {
    const { repo } = F.repository({ data: [{ ...F.responses()[method], [field]: value }], error: null });
    violation(await repo[method](F.inputs()[method]));
  });
}
const badFences = ["0", "-1", "+1", "01", "1.0", "1e3", " 1", "1 ", "1\n", "9223372036854775808", 1, 9007199254740992, null, undefined, ""];
for (const [index, fence] of badFences.entries()) {
  for (const method of ["beginSend", "finalize"]) {
    test(`${method}: invalid decimal input fence ${index}`, async () => {
      const { repo, calls } = F.repository({ data: [F.responses()[method]], error: null });
      violation(await repo[method]({ ...F.inputs()[method], fence })); assert.equal(calls.length, 0);
    });
  }
  for (const method of ["claim", "beginSend"]) {
    test(`${method}: invalid decimal returned fence ${index}`, async () => {
      const { repo } = F.repository({ data: [{ ...F.responses()[method], fence }], error: null });
      violation(await repo[method](F.inputs()[method]));
    });
  }
}
for (const fence of ["1", "9007199254740993", "9223372036854775807"]) {
  for (const method of ["claim", "beginSend", "finalize"]) {
    test(`${method}: valid canonical decimal fence precision case`, async () => {
      const row = { ...F.responses()[method] }; if (method !== "finalize") row.fence = fence;
      const input = { ...F.inputs()[method] }; if (method !== "claim") input.fence = fence;
      const { repo, calls } = F.repository({ data: [row], error: null }); const result = await repo[method](input);
      assert.ok(result.outcome === "applied");
      if (method !== "claim") assert.ok(calls[0].args.input_fence === fence && typeof calls[0].args.input_fence === "string");
    });
  }
}


test("recover: PENDING cannot have a previously recorded provider attempt", async () => {
  const row = { ...F.responses().recover, previous_state: "PENDING", state: "FAILED_TERMINAL", attempt_count: 1,
    terminal_disposition: "retry_unusable", terminal_at: F.NOW, available_at: null };
  const { repo, calls } = F.repository({ data: [row], error: null });
  const result = await repo.recover({ batchSize: 1 });
  assert.equal(calls.length, 1);
  // Frozen section 16: PENDING has zero attempts. Section 22: recovery never increments.
  // Assert only safe categories; do not print protected receipt fields on failure.
  violation(result);
});
