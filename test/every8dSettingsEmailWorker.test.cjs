const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("../dist/services/every8dSettingsEmailOutboxCrypto");
const { createEvery8dSettingsEmailWorker: worker } = require("../dist/services/every8dSettingsEmailWorker");
const { renderEvery8dSettingsEmail: render } = require("../dist/services/every8dSettingsEmailTemplate");
const { validateEvery8dSettingsEmailProviderResult: validate } = require("../dist/types/every8dSettingsEmailProvider");
const { parseEvery8dSettingsEmailOutboxKeyring: keyring } = require("../dist/config/every8dSettingsEmailOutbox");
const F = require("./helpers/every8dSettingsEmailOutboxFixtures.cjs");
const { deferred, fakeProvider, fakeClock } = require("./helpers/every8dSettingsEmailFakeProvider.cjs");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(options = {}) {
  const time = fakeClock(), events = [], finalInputs = [];
  const keys = keyring(JSON.stringify({ enc: Buffer.alloc(32, 7).toString("base64url") }));
  const payload = { recipient: "fixture@example.invalid", displayOtp: "2345-6789" };
  const rows = Array.from({ length: options.count ?? 1 }, (_, index) => {
    const context = { ...F.context(), jobId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` };
    const envelope = crypto.encryptEvery8dSettingsEmailOutboxPayload(context, payload, { activeKeyVersion: "enc", keys });
    return F.claimRow(envelope, { job_id: context.jobId, ...options.claimOverrides });
  });
  const fake = options.fake ?? fakeProvider(options.scenario, (input) => {
    events.push("provider");
    assert.ok(events.includes("begin_confirmed"), "begin receipt precedes provider");
    assert.ok(Object.keys(input).sort().join(",") === "body,canonicalSender,deadlineMonotonicNs,idempotencyKey,recipient,signal,subject", "narrow send input");
    assert.ok(input.recipient === payload.recipient && input.body.includes(payload.displayOtp) && !input.subject.includes(payload.displayOtp), "decrypted fixed content");
    options.observe?.(input);
  });
  const { repo, calls } = F.repository(async (name, args) => {
    if (name.includes("runtime_claim_")) {
      events.push("claim");
      if (options.claim) return options.claim(args, rows);
      return { data: rows, error: null };
    }
    if (name.includes("runtime_begin_")) {
      events.push("begin");
      if (options.begin) {
        const result = await options.begin(args);
        events.push("begin_confirmed");
        return result;
      }
      events.push("begin_confirmed");
      return { data: [{ ...F.responses().beginSend, job_id: args.input_job_id, ...options.beginOverrides }], error: null };
    }
    if (name.includes("runtime_finalize_")) {
      events.push("finalize"); finalInputs.push(args);
      if (options.finalize) return options.finalize(args);
      let state = "DELIVERY_OUTCOME_UNKNOWN", disposition = "delivery_outcome_unknown";
      if (args.input_provider_outcome === "accepted") { state = "ACCEPTED"; disposition = "accepted"; }
      if (args.input_provider_outcome === "rejected") { state = "FAILED_TERMINAL"; disposition = "provider_rejected"; }
      if (args.input_pre_send_disposition) { state = "FAILED_TERMINAL"; disposition = "sender_unavailable_pre_send"; }
      if (args.input_provider_outcome === "not_accepted_retryable") { state = "RETRY_WAIT"; disposition = null; }
      return { data: [{ ...F.responses().finalize, job_id: args.input_job_id, attempt_count: args.input_attempt_count,
        state, terminal_disposition: disposition, provider_message_id: args.input_provider_message_id,
        terminal_at: state === "RETRY_WAIT" ? null : F.RESOLVED,
        available_at: state === "RETRY_WAIT" ? "2026-10-26T00:00:06.000001Z" : null,
        challenge_recording: state === "RETRY_WAIT" ? "not_applicable" : "recorded" }], error: null };
    }
    throw new Error("unexpected repository operation");
  });
  const dependencies = { repository: repo, encryptionKeyring: options.missingKey ? keyring(JSON.stringify({ current: Buffer.alloc(32, 8).toString("base64url") })) : keys,
    sender: options.sender ?? { status: "available", canonicalSender: "settings@example.invalid", adapter: fake.adapter }, clock: time.clock };
  const engine = worker(dependencies);
  return { engine, dependencies, repo, rows, calls, events, finalInputs, fake, time };
}
function outcome(result, expected, finalization = "confirmed") {
  assert.ok(result.outcome === "completed" && result.diagnostics.length === 1 &&
    result.diagnostics[0].category === expected && result.diagnostics[0].finalization === finalization, "closed expected result");
}

test("one-shot claims exactly ten, constructs without work, and processes ten concurrently", async () => {
  const h = setup({ count: 10, scenario: "late" });
  assert.equal(h.calls.length, 0);
  const running = h.engine.runBatch(); await tick();
  assert.ok(h.calls[0].args.input_batch_size === 10 && h.fake.stats.calls === 10, "ten concurrent provider calls rather than serialized leases");
  assert.equal((await h.engine.runBatch()).outcome, "busy");
  assert.equal((await worker(h.dependencies).runBatch()).outcome, "busy");
  assert.equal(h.calls.filter((c) => c.name.includes("runtime_claim_")).length, 1);
  h.fake.complete(); const result = await running;
  assert.ok(result.diagnostics.length === 10 && result.diagnostics.every((d) => d.category === "accepted" && d.finalization === "confirmed"));
  assert.ok(h.fake.stats.calls === 10 && h.finalInputs.length === 10 && h.time.timers.size === 0);
});
test("claim ambiguity, thrown transport and malformed/oversized/duplicate batch confer no authority", async () => {
  for (const claim of [() => ({ data: null, error: {} }), () => { throw new Error("synthetic raw failure"); },
    (args, rows) => ({ data: Array(11).fill(rows[0]), error: null }),
    (args, rows) => ({ data: [rows[0], rows[0]], error: null }),
    (args, rows) => ({ data: [{ ...rows[0], fence: "0" }], error: null })]) {
    const h = setup({ claim }); assert.equal((await h.engine.runBatch()).outcome, "claim_unavailable");
    assert.ok(h.fake.stats.calls === 0 && h.finalInputs.length === 0 && h.events.join(",") === "claim");
  }
});
test("busy guard covers pending claim and finalization, and releases after completion", async () => {
  const barrier = deferred(), h = setup({ claim: async (args, rows) => { await barrier.promise; return { data: rows, error: null }; } });
  const running = h.engine.runBatch(); await tick();
  assert.equal((await h.engine.runBatch()).outcome, "busy"); assert.equal(h.fake.stats.calls, 0);
  barrier.resolve(); await running;
  const finalBarrier = deferred(), k = setup({ finalize: () => finalBarrier.promise });
  const second = k.engine.runBatch(); await tick(); assert.equal((await k.engine.runBatch()).outcome, "busy");
  finalBarrier.resolve({ data: null, error: {} }); await second;
  assert.ok((await h.engine.runBatch()).outcome === "completed");
});
for (const scenario of ["accepted", "rejected", "non_acceptance", "not_started", "unknown", "invalid_id", "429", "503", "reset", "throw_before", "throw_after"]) {
  test(`provider result mapping and at-most-once: ${scenario}`, async () => {
    const h = setup({ scenario });
    const expected = scenario === "accepted" || scenario === "rejected" ? scenario :
      ["non_acceptance", "not_started"].includes(scenario) ? "not_accepted_retryable" : "outcome_unknown";
    outcome(await h.engine.runBatch(), expected);
    assert.ok(h.fake.stats.calls === 1 && h.finalInputs.length === 1);
    const input = h.finalInputs[0];
    assert.ok(input.input_provider_outcome === expected && input.input_attempt_count === 1 &&
      input.input_non_acceptance_proven === (expected === "not_accepted_retryable") && input.input_pre_send_disposition === null);
    assert.ok(input.input_job_id === F.JOB && input.input_lease_id === F.LEASE && input.input_fence === "1");
    assert.ok(expected === "accepted" ? input.input_provider_message_id === "synthetic-provider-id" : input.input_provider_message_id === null);
  });
}
for (const mutation of ["tag", "ciphertext", "missing_key"]) test(`crypto failure ${mutation} leaves LEASED without begin/provider/finalize`, async () => {
  const h = setup({ missingKey: mutation === "missing_key" });
  if (mutation === "tag") h.rows[0].authentication_tag = F.bytea(Buffer.alloc(16, 9));
  if (mutation === "ciphertext") h.rows[0].ciphertext = F.bytea(Buffer.from([1]));
  outcome(await h.engine.runBatch(), "payload_unavailable", "not_attempted");
  assert.ok(h.events.join(",") === "claim" && h.fake.stats.calls === 0 && h.finalInputs.length === 0);
});
test("claim and begin receipts must originate from existing strict repository", async () => {
  const h = setup();
  const realClaim = await h.repo.claim({ batchSize: 1 });
  const forgedClaim = { ...realClaim.receipts[0] };
  const forged = worker({ ...h.dependencies, repository: { ...h.repo, claim: async () => ({ outcome: "applied", receipts: [forgedClaim] }) } });
  assert.equal((await forged.runBatch()).outcome, "claim_unavailable");
  const receipt = await h.repo.beginSend(F.inputs().beginSend);
  for (const bad of [{ ...receipt.receipt }, null, {}]) {
    const engine = worker({ ...h.dependencies, repository: { ...h.repo, beginSend: async () => ({ outcome: "applied", receipt: bad }) } });
    outcome(await engine.runBatch(), "authority_unavailable", "not_attempted");
  }
  assert.ok(h.fake.stats.calls === 0 && h.finalInputs.length === 0);
});
for (const kind of ["ambiguous", "not_applied", "invalid", "stale", "wrong_lease", "terminal", "count_skipped", "count_replayed"]) test(`begin ${kind} means zero provider calls`, async () => {
  const begin = () => {
    if (kind === "ambiguous") return { data: null, error: {} };
    if (kind === "not_applied") return { data: [], error: null };
    const row = { ...F.responses().beginSend };
    if (kind === "invalid") row.provider_deadline_at = F.NOW;
    if (kind === "stale") row.fence = "2";
    if (kind === "wrong_lease") row.lease_id = F.CHALLENGE;
    if (kind === "count_skipped") row.attempt_count = 2;
    if (kind === "count_replayed") row.attempt_count = 0;
    if (kind === "terminal") Object.assign(row, { state: "CANCELLED", attempt_count: 0, lease_id: null,
      attempt_started_at: null, provider_deadline_at: null, lease_expires_at: null, terminal_disposition: "cancelled_pre_send", terminal_at: F.NOW });
    return { data: [row], error: null };
  };
  const h = setup({ begin }); outcome(await h.engine.runBatch(), "authority_unavailable", "not_attempted");
  assert.ok(h.fake.stats.calls === 0 && h.finalInputs.length === 0 && h.events.filter((e) => e === "begin").length === 1);
});
test("pending begin holds provider at zero and confirms no DB operation is open across send", async () => {
  const barrier = deferred(), h = setup({ begin: () => barrier.promise });
  const running = h.engine.runBatch(); await tick(); assert.equal(h.fake.stats.calls, 0);
  barrier.resolve({ data: [F.responses().beginSend], error: null }); outcome(await running, "accepted");
  assert.ok(h.events.join(",") === "claim,begin,begin_confirmed,provider,finalize");
});
test("attempt count must be exactly claimed plus one for retries too", async () => {
  const h = setup({ claimOverrides: { attempt_count: 1 }, beginOverrides: { attempt_count: 2 } });
  outcome(await h.engine.runBatch(), "accepted"); assert.equal(h.finalInputs[0].input_attempt_count, 2);
});
for (const elapsed of [10000000000n, 10000000001n]) test(`late begin acknowledgement ${elapsed} forbids provider and finalization`, async () => {
  let h;
  h = setup({ begin: () => { h.time.elapseNs(elapsed); return { data: [F.responses().beginSend], error: null }; } });
  outcome(await h.engine.runBatch(), "local_budget_exhausted", "not_attempted");
  assert.ok(h.fake.stats.calls === 0 && h.finalInputs.length === 0);
});
test("begin RPC duration is subtracted and timer never rounded up", async () => {
  let h, deadline;
  h = setup({ scenario: "late", observe: (input) => { deadline = input.deadlineMonotonicNs; },
    begin: () => { h.time.elapseNs(2500000001n); return { data: [F.responses().beginSend], error: null }; } });
  const running = h.engine.runBatch(); await tick();
  assert.ok(deadline === 10000000000n && h.fake.stats.calls === 1);
  h.time.advanceNs(7498999999n); await tick(); assert.equal(h.finalInputs.length, 0);
  h.time.advanceNs(1n); outcome(await running, "outcome_unknown");
  assert.ok(h.fake.stats.aborts === 1 && h.time.timers.size === 0);
  h.fake.complete(); await tick(); assert.equal(h.finalInputs.length, 1);
});
test("elapsed claim/processing guard only reduces lease permission", async () => {
  let h;
  h = setup({ claim: (args, rows) => { h.time.elapseNs(30000000000n); return { data: rows, error: null }; } });
  outcome(await h.engine.runBatch(), "local_budget_exhausted", "not_attempted");
  assert.ok(h.fake.stats.calls === 0 && h.events.join(",") === "claim");
});
for (const scenario of ["timeout", "late", "abort"]) test(`deadline abort and ignored late completion: ${scenario}`, async () => {
  const h = setup({ scenario }); const running = h.engine.runBatch(); await tick();
  h.time.advanceNs(10000000000n); outcome(await running, "outcome_unknown");
  h.fake.complete(); await tick();
  assert.ok(h.fake.stats.calls === 1 && h.fake.stats.aborts === 1 && h.finalInputs.length === 1);
});
test("result delivered at deadline loses even before timer callback executes", async () => {
  const h = setup({ scenario: "late" }); const running = h.engine.runBatch(); await tick();
  h.time.elapseNs(10000000000n); h.fake.complete(); outcome(await running, "outcome_unknown");
});
test("explicit cancellation before send leaves lease; after submission finalizes unknown once", async () => {
  const before = new AbortController(); before.abort(); const h = setup();
  outcome(await h.engine.runBatch(before.signal), "cancelled_pre_send", "not_attempted");
  assert.equal(h.fake.stats.calls, 0);
  const after = new AbortController(), k = setup({ scenario: "abort" });
  const running = k.engine.runBatch(after.signal); await tick(); after.abort();
  outcome(await running, "outcome_unknown"); assert.ok(k.finalInputs.length === 1 && k.fake.stats.calls === 1);
});
test("cancellation during begin leaves confirmed SENDING without provider/finalize", async () => {
  const cancel = new AbortController(), h = setup({ begin: () => { cancel.abort(); return { data: [F.responses().beginSend], error: null }; } });
  outcome(await h.engine.runBatch(cancel.signal), "local_budget_exhausted", "not_attempted");
  assert.ok(h.fake.stats.calls === 0 && h.finalInputs.length === 0);
});
test("sender-unavailable needs positive local selection; crypto failure never becomes sender-unavailable", async () => {
  const sender = { status: "unavailable", evidence: "no_approved_provider" };
  const h = setup({ sender }); outcome(await h.engine.runBatch(), "sender_unavailable");
  assert.ok(h.events.join(",") === "claim,finalize" && h.finalInputs[0].input_attempt_count === 0 && h.finalInputs[0].input_provider_outcome === null);
  const k = setup({ sender, missingKey: true }); outcome(await k.engine.runBatch(), "payload_unavailable", "not_attempted");
  for (const selection of [{ status: "indeterminate" }, { status: "unavailable", evidence: "ambiguous" },
    { status: "available", canonicalSender: "bad sender", adapter: h.fake.adapter }]) {
    const p = setup({ sender: selection }); await p.engine.runBatch();
    assert.ok(p.fake.stats.calls === 0 && p.finalInputs.length === 0 && !p.events.includes("begin"));
  }
});
for (const finalize of [() => ({ data: null, error: {} }), () => { throw new Error("synthetic raw finalize failure"); },
  () => ({ data: [{ bad: true }], error: null }), () => ({ data: [], error: null })]) test("ambiguous finalize never resends or retries finalization", async () => {
  const h = setup({ finalize }); outcome(await h.engine.runBatch(), "accepted", "unconfirmed");
  await tick(); assert.ok(h.fake.stats.calls === 1 && h.finalInputs.length === 1);
});
test("stable idempotency uses the exact C3c-3 helper and excludes attempt/lease/fence", async () => {
  let key;
  const h = setup({ observe: (input) => { key = input.idempotencyKey; } }); await h.engine.runBatch();
  assert.ok(key === crypto.every8dSettingsEmailProviderIdempotencyKey(F.JOB));
  let retryKey;
  const k = setup({ claimOverrides: { attempt_count: 1, fence: "2" }, beginOverrides: { attempt_count: 2, fence: "2" }, observe: (input) => { retryKey = input.idempotencyKey; } });
  await k.engine.runBatch(); assert.ok(key === retryKey);
});
test("fixed v1 enrollment/login render plain text and floor durable expiry", () => {
  for (const purpose of ["enrollment", "login"]) {
    const rendered = render({ purpose, templateVersion: 1, displayOtp: "2345-6789", deliveryDeadlineAt: F.DEADLINE, subject: "untrusted", html: "<script>" });
    assert.ok(rendered.body.includes("2026-10-26T00:10:00.000Z") && !rendered.subject.includes("2345-6789") && !rendered.body.includes("http") && !rendered.body.includes("<"));
    assert.ok(Object.keys(rendered).sort().join(",") === "body,subject");
  }
  for (const change of [{ purpose: "dynamic" }, { templateVersion: 2 }, { displayOtp: "<script>" }, { deliveryDeadlineAt: "invalid" }]) {
    assert.throws(() => render({ purpose: "login", templateVersion: 1, displayOtp: "2345-6789", deliveryDeadlineAt: F.DEADLINE, ...change }), (error) => error.message === "Settings email template unavailable");
  }
});
test("closed evidence and frozen provider-message-ID contract fail conservatively", () => {
  for (const id of ["", "space id", "id\n", "é", "x".repeat(256), null])
    assert.ok(validate({ outcome: "accepted", evidence: "authoritative_acceptance", providerMessageId: id }).outcome === "outcome_unknown");
  for (const id of ["!", "~".repeat(255)]) assert.ok(validate({ outcome: "accepted", evidence: "authoritative_acceptance", providerMessageId: id }).outcome === "accepted");
  for (const value of [{ outcome: "rejected", status: 429 }, { outcome: "rejected", evidence: "timeout" },
    { outcome: "not_accepted_retryable", evidence: true }, { outcome: "not_accepted_retryable", evidence: { kind: "http_status", status: 503 } },
    { outcome: "accepted", providerMessageId: "id" }, new Proxy({}, { ownKeys() { throw new Error("synthetic sensitive response"); } })])
    assert.ok(validate(value).outcome === "outcome_unknown");
});
test("safe diagnostics serialize no sensitive material and failures never log", async () => {
  const captured = [], original = {};
  for (const name of ["log", "warn", "error", "info", "debug"]) { original[name] = console[name]; console[name] = () => captured.push("unexpected logging"); }
  try {
    const sentinel = "fixture@example.invalid 2345-6789 synthetic-provider-id private-response";
    const fake = { stats: {}, adapter: { send: async () => { throw new Error(sentinel, { cause: { recipient: sentinel } }); } } };
    const h = setup({ fake }); const result = await h.engine.runBatch();
    outcome(result, "outcome_unknown");
    const safe = JSON.stringify(result);
    assert.ok(!safe.includes("fixture") && !safe.includes("2345") && !safe.includes("synthetic") && !safe.includes(F.JOB) && !safe.includes(F.LEASE));
    assert.ok(result.diagnostics.every((d) => Object.keys(d).sort().join(",") === "category,finalization"));
    assert.equal(captured.length, 0);
  } finally { for (const name of Object.keys(original)) console[name] = original[name]; }
});
test("application boundary has no recorder, retry schedule, production wiring, provider or generic DB facility", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/services/every8dSettingsEmailWorker.ts"), "utf8");
  assert.ok(!/recordChallenge|runtime_record|\.recover\(|\.purge\(|\.enqueue\(|setInterval|process\.env|process\.on|fetch\(|supabase\.from|5000|20000/.test(source));
  for (const file of ["../src/server.ts", "../src/app.ts"]) assert.ok(!fs.readFileSync(path.join(__dirname, file), "utf8").includes("every8dSettingsEmailWorker"));
});

test("last instant local exhaustion before invocation leaves SENDING for recovery", async () => {
  const h = setup();
  const clock = { ...h.time.clock, schedule(delay, callback) {
    h.time.elapseNs(10000000000n);
    return h.time.clock.schedule(delay, callback);
  } };
  const engine = worker({ ...h.dependencies, clock });
  outcome(await engine.runBatch(), "local_budget_exhausted", "not_attempted");
  assert.ok(h.fake.stats.calls === 0 && h.finalInputs.length === 0 && h.time.timers.size === 0);
});
test("local timer failure before submission never invents provider authority", async () => {
  const h = setup();
  const engine = worker({ ...h.dependencies, clock: { ...h.time.clock, schedule() { throw new Error("synthetic timer failure"); } } });
  outcome(await engine.runBatch(), "local_budget_exhausted", "not_attempted");
  assert.ok(h.fake.stats.calls === 0 && h.finalInputs.length === 0);
});
test("malformed authenticated plaintext is a crypto failure with no durable disposition", async () => {
  const nodeCrypto = require("node:crypto");
  for (const raw of ['{"v":1,"recipient":"fixture@example.invalid","displayOtp":"INVALID"}',
    '{"v":1,"recipient":"invalid email","displayOtp":"2345-6789"}',
    '{"v":1,"recipient":"fixture@example.invalid","displayOtp":"2345-6789","extra":true}']) {
    const h = setup(), nonce = Buffer.alloc(12, 10), key = h.dependencies.encryptionKeyring.get("enc");
    const bytes = Buffer.from(raw);
    try {
      const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(crypto.encodeEvery8dSettingsEmailOutboxAad({ ...F.context(), encryptionKeyVersion: "enc" }));
      h.rows[0].nonce = F.bytea(nonce);
      h.rows[0].ciphertext = F.bytea(Buffer.concat([cipher.update(bytes), cipher.final()]));
      h.rows[0].authentication_tag = F.bytea(cipher.getAuthTag());
    } finally { key.fill(0); bytes.fill(0); nonce.fill(0); }
    outcome(await h.engine.runBatch(), "payload_unavailable", "not_attempted");
    assert.ok(h.events.join(",") === "claim" && h.fake.stats.calls === 0 && h.finalInputs.length === 0);
  }
});
test("decryption is attempted once per lease and no worker-owned plaintext buffer is allocated", async () => {
  const h = setup({ scenario: "late" }); let keyReads = 0;
  const engine = worker({ ...h.dependencies, encryptionKeyring: { get(version) { keyReads += 1; return h.dependencies.encryptionKeyring.get(version); } } });
  const running = engine.runBatch(); await tick(); h.time.advanceNs(10000000000n); await running;
  assert.equal(keyReads, 1);
  const source = fs.readFileSync(path.join(__dirname, "../src/services/every8dSettingsEmailWorker.ts"), "utf8");
  assert.ok(!/Buffer\.(from|alloc|concat)/.test(source) && source.includes("finally { input = undefined; }"));
  h.fake.fail(); await tick(); assert.equal(h.finalInputs.length, 1);
});
