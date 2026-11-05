const assert = require("node:assert/strict");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const { every8dSettingsEmailProviderRegistry: registry,
  lookupEvery8dSettingsEmailProvider: lookup } = require("../dist/services/every8dSettingsEmailProviderRegistry");

test("production registry is empty, frozen, and has no environment-selectable fake", () => {
  assert.deepEqual(Reflect.ownKeys(registry), []);
  assert.equal(Object.isFrozen(registry), true);
  for (const id of ["fake", "test", "test-only", "constructor", "__proto__", "tostring", "unknown"]) {
    assert.equal(lookup(id), undefined);
  }
  assert.equal(Reflect.set(registry, "fake", {}), false);
});

test("exact injected registration lookup never invokes readiness or constructs a client", () => {
  const entry = Object.freeze({ parseReadiness() { assert.fail("readiness was invoked"); } });
  const injected = Object.freeze({ approved: entry });
  assert.equal(lookup("approved", injected), entry);
  for (const id of ["APPROVED", " approved", "approved ", "constructor", "__proto__"]) {
    assert.equal(lookup(id, injected), undefined);
  }
  assert.equal(lookup("inherited", Object.create({ inherited: entry })), undefined);
  assert.equal(lookup("approved"), undefined);
});

test("isolated config import and all disabled gates allocate no runtime/network resources", () => {
  // Child process isolation keeps module/global traps out of existing regression tests.
  execFileSync(process.execPath, ["-e", `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const originalLoad = Module._load;
    const forbidden = /(?:https?|net|tls|dns|undici|supabase|OutboxRepository|EmailWorker$|EmailOutboxCrypto|EmailTemplate)/;
    Module._load = function(id, ...args) {
      if (forbidden.test(id) && id !== './dist/config/every8dSettingsEmailWorker') assert.fail('operational module loaded');
      return originalLoad.call(this, id, ...args);
    };
    for (const name of ['fetch', 'setTimeout', 'setInterval', 'setImmediate']) {
      globalThis[name] = () => assert.fail('operational resource constructed');
    }
    const crypto = require('node:crypto');
    crypto.randomBytes = () => assert.fail('startup key generation');
    const {readEvery8dSettingsEmailWorkerConfig: read} = require('./dist/config/every8dSettingsEmailWorker');
    const registry = new Proxy({}, {
      get() { assert.fail('provider access'); },
      getOwnPropertyDescriptor() { assert.fail('provider lookup'); }
    });
    const flags = ['CHALLENGES', 'HTTP', 'EMAIL_DISPATCH'];
    for (let mask=0; mask<7; mask++) {
      const env = Object.fromEntries(flags.map((name, i) => ['EVERY8D_SETTINGS_AUTH_'+name+'_ENABLED', String(Boolean(mask & (1 << i)))]));
      env.EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_ACTIVE_KEY_VERSION='email';
      env.EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_KEYS=JSON.stringify({email:Buffer.alloc(32,1).toString('base64url')});
      env.EVERY8D_SETTINGS_OTP_HMAC_ACTIVE_KEY_VERSION='otp';
      env.EVERY8D_SETTINGS_OTP_HMAC_KEYS=JSON.stringify({otp:Buffer.alloc(32,2).toString('base64url')});
      env.EVERY8D_SETTINGS_AUTH_EMAIL_PROVIDER='unknown';
      env.EVERY8D_SETTINGS_AUTH_EMAIL_FROM='Sender@example.test';
      assert.equal(read(env, registry).status, 'disabled');
      env.EVERY8D_SETTINGS_AUTH_EMAIL_FROM=' Sender@example.test';
      assert.throws(() => read(env, registry));
    }
  `], { cwd: require("node:path").resolve(__dirname, ".."), stdio: "pipe", timeout: 10000 });
});
