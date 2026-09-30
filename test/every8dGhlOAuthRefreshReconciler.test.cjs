const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createEvery8dGhlOAuthRefreshReconciler,
  every8dGhlOAuthRefreshIntervalMs,
  every8dGhlOAuthRefreshShutdownDrainMs,
  every8dGhlOAuthRefreshStartupMaximumMs,
  every8dGhlOAuthRefreshStartupMinimumMs
} = require("../dist/services/every8dGhlOAuthRefreshReconciler");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(overrides = {}) {
  const timers = [];
  const cleared = [];
  const randomCalls = [];
  const logs = [];
  let passes = 0;
  const runtime = {
    isEnabled: () => overrides.enabled ?? true,
    async runOnce() {
      passes += 1;
      if (overrides.runOnce) return overrides.runOnce();
    }
  };
  const reconciler = createEvery8dGhlOAuthRefreshReconciler({
    runtime,
    log: {
      info(data, message) { logs.push({ level: "info", data, message }); },
      warn(data, message) { logs.push({ level: "warn", data, message }); }
    },
    randomInt(minimum, maximumExclusive) {
      if (overrides.randomError) throw new Error("synthetic timer failure");
      randomCalls.push([minimum, maximumExclusive]);
      return overrides.randomValues?.shift() ?? minimum;
    },
    setTimeoutImpl(callback, milliseconds) {
      const timer = { callback, milliseconds, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl(timer) { cleared.push(timer); }
  });
  return { reconciler, timers, cleared, randomCalls, logs, passes: () => passes };
}

test("default-off refresh reconciler creates zero timer and uses zero randomness", async () => {
  const h = harness({ enabled: false });
  assert.equal(h.reconciler.start(), false);
  await h.reconciler.trigger();
  assert.equal(h.timers.length, 0);
  assert.equal(h.randomCalls.length, 0);
  assert.equal(h.passes(), 0);
});

test("startup and recurring delays use the exact jitter ranges and recurse after completion", async () => {
  const h = harness({ randomValues: [12_345, 4_321] });
  assert.equal(h.reconciler.start(), true);
  assert.deepEqual(h.randomCalls[0], [every8dGhlOAuthRefreshStartupMinimumMs,
    every8dGhlOAuthRefreshStartupMaximumMs + 1]);
  assert.equal(h.timers[0].milliseconds, 12_345);
  h.timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.passes(), 1);
  assert.deepEqual(h.randomCalls[1], [0, 10_001]);
  assert.equal(h.timers[1].milliseconds, every8dGhlOAuthRefreshIntervalMs + 4_321);
  await h.reconciler.stopAndDrain();
});

test("multiple triggers share one in-flight pass and never overlap", async () => {
  const gate = deferred();
  let active = 0;
  let maximumActive = 0;
  const h = harness({ async runOnce() {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await gate.promise;
    active -= 1;
  } });
  const first = h.reconciler.trigger();
  const second = h.reconciler.trigger();
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(h.passes(), 1);
  gate.resolve();
  await first;
  assert.equal(maximumActive, 1);
});

test("empty scans and scan exceptions are contained without unhandled rejection", async () => {
  const empty = harness({ runOnce: async () => undefined });
  await empty.reconciler.trigger();
  assert.equal(empty.passes(), 1);

  const failed = harness({ runOnce: async () => { throw new Error("synthetic scan failure"); } });
  await failed.reconciler.trigger();
  assert.equal(failed.passes(), 1);
  assert.ok(failed.logs.some((entry) => entry.data.event === "every8d_ghl_oauth_refresh_timer_error"));
});

test("timer setup errors are contained and cannot crash startup", () => {
  const h = harness({ randomError: true });
  assert.equal(h.reconciler.start(), false);
  assert.equal(h.timers.length, 0);
  assert.ok(h.logs.some((entry) => entry.data.event === "every8d_ghl_oauth_refresh_timer_error"));
});

test("shutdown clears future timers, drains the current pass, and never aborts it", async () => {
  const gate = deferred();
  const h = harness({ randomValues: [5_000], runOnce: async () => gate.promise });
  h.reconciler.start();
  const active = h.reconciler.trigger();
  await Promise.resolve();
  const draining = h.reconciler.stopAndDrain();
  assert.ok(h.cleared.includes(h.timers[0]));
  assert.ok(h.timers.some((timer) => timer.milliseconds === every8dGhlOAuthRefreshShutdownDrainMs));
  assert.equal(h.passes(), 1);
  gate.resolve();
  await Promise.all([active, draining]);
  assert.equal(h.passes(), 1);
});
