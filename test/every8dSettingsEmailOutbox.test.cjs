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


function beginTerminalRow(state, disposition, count, deadline) {
  return { ...F.responses().beginSend, state, terminal_disposition: disposition, attempt_count: count,
    lease_id: null, attempt_started_at: null, provider_deadline_at: null, lease_expires_at: null,
    terminal_at: F.NOW, delivery_deadline_at: deadline };
}
for (const [name, state, disposition, count, deadline] of [
  ["EXPIRED with a full window", "EXPIRED", "expired_pre_send", 0, F.DEADLINE],
  ["CANCELLED after the deadline", "CANCELLED", "cancelled_pre_send", 0, F.AVAILABLE],
  ["retry deadline exhausted with a full window", "FAILED_TERMINAL", "retry_deadline_exhausted", 1, F.DEADLINE]
]) {
  test(`beginSend R1 reviewer counterexample: ${name}`, async () => {
    const { repo, calls } = F.repository({ data: [beginTerminalRow(state, disposition, count, deadline)], error: null });
    violation(await repo.beginSend(F.inputs().beginSend));
    assert.equal(calls.length, 1);
  });
}


// Literal deadlines differ by one microsecond around the frozen ten-second boundary.
const beginWindows = [
  ["full window by one microsecond", "2026-10-26T00:00:10.000002Z"],
  ["exact window equality", "2026-10-26T00:00:10.000001Z"],
  ["window exhausted by one microsecond", "2026-10-26T00:00:10.000000Z"]
];
for (const [state, disposition, count, expected] of [
  ["EXPIRED", "expired_pre_send", 0, [false, true, true]],
  ["CANCELLED", "cancelled_pre_send", 0, [true, false, false]],
  ["FAILED_TERMINAL", "retry_deadline_exhausted", 1, [false, true, true]],
  ["FAILED_TERMINAL", "retry_deadline_exhausted", 2, [false, true, true]],
  ["FAILED_TERMINAL", "retry_unusable", 1, [true, true, true]],
  ["FAILED_TERMINAL", "retry_unusable", 2, [true, true, true]]
]) {
  for (const [index, [name, deadline]] of beginWindows.entries()) {
    test("beginSend R1 boundary: " + disposition + " count " + count + " / " + name, async () => {
      const { repo } = F.repository({ data: [beginTerminalRow(state, disposition, count, deadline)], error: null });
      const result = await repo.beginSend(F.inputs().beginSend);
      if (expected[index]) {
        assert.ok(result.outcome === "applied", "valid terminal receipt applied");
        assert.ok(result.receipt.state === state && result.receipt.attemptCount === count &&
          result.receipt.terminalDisposition === disposition, "terminal classification preserved");
      } else violation(result);
    });
  }
}
for (const [state, disposition, deadline, counts] of [
  ["EXPIRED", "expired_pre_send", F.PROVIDER, [-1, 1, 2, 3, 4]],
  ["CANCELLED", "cancelled_pre_send", F.DEADLINE, [-1, 1, 2, 3, 4]],
  ["FAILED_TERMINAL", "retry_deadline_exhausted", F.PROVIDER, [-1, 0, 3, 4]],
  ["FAILED_TERMINAL", "retry_unusable", F.DEADLINE, [-1, 0, 3, 4]]
]) {
  for (const count of counts) {
    test("beginSend R1 invalid terminal count: " + disposition + " / " + count, async () => {
      const { repo } = F.repository({ data: [beginTerminalRow(state, disposition, count, deadline)], error: null });
      violation(await repo.beginSend(F.inputs().beginSend));
    });
  }
}
for (const [state, disposition, count] of [
  ["EXPIRED", "cancelled_pre_send", 0], ["CANCELLED", "expired_pre_send", 0],
  ["FAILED_TERMINAL", "expired_pre_send", 0], ["EXPIRED", "retry_unusable", 1],
  ["FAILED_TERMINAL", "sender_unavailable_pre_send", 0],
  ["FAILED_TERMINAL", "provider_rejected", 1], ["FAILED_TERMINAL", "retry_budget_exhausted", 3],
  ["ACCEPTED", "accepted", 1], ["DELIVERY_OUTCOME_UNKNOWN", "delivery_outcome_unknown", 1],
  ["PENDING", null, 0], ["RETRY_WAIT", null, 1], ["LEASED", null, 0]
]) {
  test("beginSend R1 invalid terminal family: " + state + " / " + disposition, async () => {
    const { repo } = F.repository({ data: [beginTerminalRow(state, disposition, count, F.PROVIDER)], error: null });
    violation(await repo.beginSend(F.inputs().beginSend));
  });
}
for (const [field, value] of [
  ["lease_id", F.LEASE], ["attempt_started_at", F.NOW], ["provider_deadline_at", F.PROVIDER],
  ["lease_expires_at", F.EXPIRES], ["terminal_at", null], ["terminal_at", F.RESOLVED]
]) {
  test("beginSend R1 terminal shape remains closed: " + field + " / " + (value === null ? "null" : "timestamp or identity"), async () => {
    const row = { ...beginTerminalRow("EXPIRED", "expired_pre_send", 0, F.PROVIDER), [field]: value };
    const { repo } = F.repository({ data: [row], error: null });
    violation(await repo.beginSend(F.inputs().beginSend));
  });
}
for (const count of [1, 2, 3]) {
  test("beginSend R1 SENDING positive control count " + count, async () => {
    const { repo } = F.repository({ data: [{ ...F.responses().beginSend, attempt_count: count }], error: null });
    const result = await repo.beginSend(F.inputs().beginSend);
    assert.ok(result.outcome === "applied", "valid send authority applied");
    assert.ok(result.receipt.attemptCount === count && result.receipt.leaseId === F.LEASE && result.receipt.fence === "1" &&
      result.receipt.terminalAt === null && result.receipt.terminalDisposition === null &&
      result.receipt.attemptStartedAt === F.NOW && result.receipt.dbNow === F.NOW &&
      result.receipt.providerDeadlineAt === F.PROVIDER && result.receipt.leaseExpiresAt === F.EXPIRES &&
      result.receipt.deliveryDeadlineAt === F.DEADLINE, "send authority preserved");
  });
}
for (const [name, mutation] of [
  ["zero attempts", { attempt_count: 0 }], ["fourth attempt", { attempt_count: 4 }],
  ["lease identity", { lease_id: F.OTHER }], ["fence identity", { fence: "2" }],
  ["terminal disposition", { terminal_disposition: "accepted" }], ["terminal timestamp", { terminal_at: F.NOW }],
  ["attempt start", { attempt_started_at: F.RESOLVED }],
  ["short provider duration", { provider_deadline_at: "2026-10-26T00:00:10.000000Z" }],
  ["long provider duration", { provider_deadline_at: "2026-10-26T00:00:10.000002Z" }],
  ["lease equality", { lease_expires_at: F.PROVIDER }],
  ["delivery equality", { delivery_deadline_at: F.PROVIDER }]
]) {
  test("beginSend R1 SENDING rejects changed " + name, async () => {
    const { repo } = F.repository({ data: [{ ...F.responses().beginSend, ...mutation }], error: null });
    violation(await repo.beginSend(F.inputs().beginSend));
  });
}
