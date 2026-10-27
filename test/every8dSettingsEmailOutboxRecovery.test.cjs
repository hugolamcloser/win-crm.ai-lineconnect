const assert = require("node:assert/strict");
const test = require("node:test");
const F = require("./helpers/every8dSettingsEmailOutboxFixtures.cjs");

// Independent explicit oracle transcribed from the frozen recovery families.
const legal = [
  ["PENDING",0,"EXPIRED","expired_pre_send","not_applicable"],
  ["PENDING",0,"CANCELLED","cancelled_pre_send","not_applicable"],
  ["LEASED",0,"PENDING",null,"not_applicable"],
  ["LEASED",0,"EXPIRED","expired_pre_send","not_applicable"],
  ["LEASED",0,"CANCELLED","cancelled_pre_send","not_applicable"],
  ["LEASED",1,"RETRY_WAIT",null,"not_applicable"],
  ["LEASED",1,"FAILED_TERMINAL","retry_unusable","not_applicable"],
  ["LEASED",1,"FAILED_TERMINAL","retry_deadline_exhausted","not_applicable"],
  ["LEASED",2,"RETRY_WAIT",null,"not_applicable"],
  ["LEASED",2,"FAILED_TERMINAL","retry_unusable","not_applicable"],
  ["LEASED",2,"FAILED_TERMINAL","retry_deadline_exhausted","not_applicable"],
  ["RETRY_WAIT",1,"FAILED_TERMINAL","retry_unusable","not_applicable"],
  ["RETRY_WAIT",1,"FAILED_TERMINAL","retry_deadline_exhausted","not_applicable"],
  ["RETRY_WAIT",2,"FAILED_TERMINAL","retry_unusable","not_applicable"],
  ["RETRY_WAIT",2,"FAILED_TERMINAL","retry_deadline_exhausted","not_applicable"],
  ["SENDING",1,"DELIVERY_OUTCOME_UNKNOWN","delivery_outcome_unknown","recorded"],
  ["SENDING",1,"DELIVERY_OUTCOME_UNKNOWN","delivery_outcome_unknown","not_recorded"],
  ["SENDING",2,"DELIVERY_OUTCOME_UNKNOWN","delivery_outcome_unknown","recorded"],
  ["SENDING",2,"DELIVERY_OUTCOME_UNKNOWN","delivery_outcome_unknown","not_recorded"],
  ["SENDING",3,"DELIVERY_OUTCOME_UNKNOWN","delivery_outcome_unknown","recorded"],
  ["SENDING",3,"DELIVERY_OUTCOME_UNKNOWN","delivery_outcome_unknown","not_recorded"]
];
const allowed = new Set(legal.map((tuple) => JSON.stringify(tuple)));
const states = ["PENDING","LEASED","SENDING","RETRY_WAIT","ACCEPTED","FAILED_TERMINAL","DELIVERY_OUTCOME_UNKNOWN","CANCELLED","EXPIRED","UNKNOWN"];
const dispositions = [null,"accepted","provider_rejected","delivery_outcome_unknown","sender_unavailable_pre_send",
  "retry_budget_exhausted","retry_deadline_exhausted","retry_unusable","cancelled_pre_send","expired_pre_send"];
const recordings = ["not_applicable","recorded","not_recorded","UNKNOWN"];
function rowFor(tuple) {
  const [previous,count,state,disposition,recording] = tuple;
  const terminal = ["ACCEPTED","FAILED_TERMINAL","DELIVERY_OUTCOME_UNKNOWN","CANCELLED","EXPIRED"].includes(state);
  return { ...F.responses().recover, previous_state: previous, attempt_count: count, state,
    terminal_disposition: disposition, challenge_recording: recording,
    terminal_at: terminal ? F.NOW : null, available_at: terminal ? null : F.AVAILABLE };
}
async function invoke(row) {
  const { repo, calls } = F.repository({ data: [row], error: null });
  const result = await repo.recover({ batchSize: 1 });
  assert.equal(calls.length, 1, "one maintenance RPC, no retry");
  return result;
}
function rejected(result) {
  assert.ok(result.outcome === "failure" && result.category === "repository_contract_violation", "closed recovery semantic violation");
  assert.ok(Object.keys(result).sort().join(",") === "category,outcome", "no raw validation diagnostics");
}

test("closed recovery semantics exhaustively match every source/count/result/disposition/recorder combination", async (t) => {
  let valid = 0, invalid = 0;
  for (const previous of states) for (const count of [0,1,2,3]) for (const state of states)
    for (const disposition of dispositions) for (const recording of recordings) {
      const tuple = [previous,count,state,disposition,recording];
      const result = await invoke(rowFor(tuple));
      if (allowed.has(JSON.stringify(tuple))) {
        assert.ok(result.outcome === "applied" && result.receipts.length === 1, "legal recovery family remains accepted");
        const receipt = result.receipts[0];
        assert.ok(receipt.previousState === previous && receipt.state === state && receipt.attemptCount === count,
          "recovery receipt preserves exact source, result and count");
        valid += 1;
      } else { rejected(result); invalid += 1; }
    }
  assert.equal(valid,21); assert.equal(invalid,15979);
  t.diagnostic(`closed recovery matrix: valid=${valid}, invalid=${invalid}; all previous-state families covered`);
});
for (const [index,tuple] of legal.entries()) {
  test(`legal recovery family ${index}: field/timestamp/count/recorder mutations rejected`, async () => {
    const row = rowFor(tuple);
    const terminal = row.terminal_at !== null;
    const badCount = tuple[0] === "PENDING" ? 1 : tuple[0] === "SENDING" ? 0 : tuple[0] === "RETRY_WAIT" ? 0 : 3;
    const bad = [
      { ...row, terminal_disposition: "UNKNOWN" },
      { ...row, terminal_at: terminal ? null : F.NOW },
      { ...row, available_at: terminal ? F.AVAILABLE : null },
      { ...row, challenge_recording: tuple[0] === "SENDING" ? "not_applicable" : "recorded" },
      { ...row, recovered_at: "infinity" },
      { ...row, attempt_count: badCount },
      { ...row, attempt_count: -1 },
      { ...row, attempt_count: 4 },
      { ...row, attempt_count: "1" },
      { ...row, unexpected: true }
    ];
    if (terminal) bad.push({ ...row, terminal_at: F.RESOLVED });
    else bad.push({ ...row, available_at: F.EXPIRES });
    for (const mutated of bad) rejected(await invoke(mutated));
  });
}
test("recovery rejects invalid source types and fractional/missing attempt counts", async () => {
  for (const previous of [null,undefined,{},false,1]) rejected(await invoke({ ...F.responses().recover, previous_state: previous }));
  for (const count of [null,undefined,{},false,0.5,NaN]) rejected(await invoke({ ...F.responses().recover, attempt_count: count }));
});
