// Deterministic test-only adapter. No network and no production registry.
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fakeProvider(scenario = "accepted", observe = () => {}) {
  const pending = deferred();
  const stats = { calls: 0, emissions: 0, aborts: 0 };
  const accepted = { outcome: "accepted", evidence: "authoritative_acceptance", providerMessageId: "synthetic-provider-id" };
  const adapter = Object.freeze({
    async send(input) {
      stats.calls += 1;
      observe(input);
      if (scenario === "throw_before") throw new Error("synthetic sensitive transport failure");
      stats.emissions += 1;
      if (["timeout", "late", "abort"].includes(scenario)) {
        // Retain only cancellation context, never recipient/OTP/body/request.
        const signal = input.signal;
        input = undefined;
        const aborted = () => { stats.aborts += 1; if (scenario === "abort") pending.reject(new Error("synthetic abort")); };
        signal.addEventListener("abort", aborted, { once: true });
        try { return await pending.promise; }
        finally { signal.removeEventListener("abort", aborted); }
      }
      if (scenario === "throw_after" || scenario === "reset") throw new Error("synthetic reset after possible emission");
      if (scenario === "rejected") return { outcome: "rejected", evidence: "definitive_refusal" };
      if (scenario === "non_acceptance") return { outcome: "not_accepted_retryable", evidence: { kind: "authoritative_non_acceptance" } };
      if (scenario === "not_started") return { outcome: "not_accepted_retryable", evidence: { kind: "transport_not_started" } };
      if (scenario === "unknown") return { outcome: "outcome_unknown" };
      if (scenario === "invalid_id") return { ...accepted, providerMessageId: "bad id" };
      if (scenario === "429" || scenario === "503") return { outcome: "not_accepted_retryable", status: Number(scenario), nonAcceptanceProven: true };
      return accepted;
    }
  });
  return { adapter, stats, complete: (value = accepted) => pending.resolve(value), fail: () => pending.reject(new Error("synthetic late error")) };
}
function fakeClock() {
  let now = 0n;
  const timers = new Set();
  const clock = {
    nowNs: () => now,
    schedule(delayMs, callback) {
      const timer = { at: now + BigInt(delayMs) * 1000000n, callback };
      timers.add(timer);
      return () => timers.delete(timer);
    }
  };
  return { clock, timers,
    advanceNs(ns) { now += ns; for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.callback(); } },
    elapseNs(ns) { now += ns; }
  };
}
module.exports = { deferred, fakeProvider, fakeClock };
