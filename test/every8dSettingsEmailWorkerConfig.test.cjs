const assert = require("node:assert/strict");
const test = require("node:test");
const {
  readEvery8dSettingsEmailWorkerConfig: read,
  Every8dSettingsEmailWorkerConfigurationError: WorkerError
} = require("../dist/config/every8dSettingsEmailWorker");
const { Every8dSettingsAuthConfigurationError: AuthError } = require("../dist/config/every8dSettingsAuth");
const { normalizeEvery8dSettingsEmail } = require("../dist/services/every8dSettingsAuthPrimitives");

const flags = ["EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED", "EVERY8D_SETTINGS_AUTH_HTTP_ENABLED",
  "EVERY8D_SETTINGS_AUTH_EMAIL_DISPATCH_ENABLED"];
const provider = "EVERY8D_SETTINGS_AUTH_EMAIL_PROVIDER";
const sender = "EVERY8D_SETTINGS_AUTH_EMAIL_FROM";
const encryptionActive = "EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_ACTIVE_KEY_VERSION";
const encryptionKeys = "EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_KEYS";
// Public synthetic test bytes only; never read configuration from the host environment.
const encoded = (byte) => Buffer.alloc(32, byte).toString("base64url");
function environment(overrides = {}) {
  return {
    ...Object.fromEntries(flags.map((flag) => [flag, "true"])),
    EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_ACTIVE_KEY_VERSION: "email",
    EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_KEYS: JSON.stringify({ email: encoded(1) }),
    EVERY8D_SETTINGS_OTP_HMAC_ACTIVE_KEY_VERSION: "otp",
    EVERY8D_SETTINGS_OTP_HMAC_KEYS: JSON.stringify({ otp: encoded(2) }),
    [encryptionActive]: "enc",
    [encryptionKeys]: JSON.stringify({ enc: encoded(3) }),
    [provider]: "test-only",
    [sender]: "Sender+auth@example.test",
    ...overrides
  };
}
function fixtureRegistry() {
  const calls = { lookup: 0, readiness: 0, factory: 0, send: 0 };
  const entry = Object.freeze({ parseReadiness() {
    calls.readiness++;
    return Object.freeze({ createClient() {
      calls.factory++;
      return Object.freeze({ async send() { calls.send++; return { outcome: "outcome_unknown" }; } });
    } });
  } });
  const registry = new Proxy(Object.freeze({ "test-only": entry }), {
    getOwnPropertyDescriptor(target, key) { calls.lookup++; return Reflect.getOwnPropertyDescriptor(target, key); }
  });
  return { calls, entry, registry };
}
const forbiddenRegistry = new Proxy({}, {
  get() { assert.fail("disabled configuration accessed registry"); },
  getOwnPropertyDescriptor() { assert.fail("disabled configuration looked up provider"); }
});

for (let mask = 0; mask < 8; mask++) {
  test(`gate combination ${mask.toString(2).padStart(3, "0")} validates without operational resources`, () => {
    const values = Object.fromEntries(flags.map((flag, index) => [flag, String(Boolean(mask & (1 << index)))]));
    const { calls, entry, registry } = fixtureRegistry();
    const result = read(environment(values), mask === 7 ? registry : forbiddenRegistry);
    assert.equal(result.status, mask === 7 ? "operational" : "disabled");
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.auth), true);
    assert.deepEqual([result.auth.enabled, result.auth.httpEnabled, result.auth.emailDispatchEnabled],
      flags.map((_, index) => Boolean(mask & (1 << index))));
    if (mask === 7) {
      assert.equal(result.registration, entry);
      assert.equal(result.emailOutboxEncryption, result.auth.emailOutboxEncryption);
    } else {
      assert.equal(Object.hasOwn(result, "registration"), false);
    }
    assert.deepEqual(calls, { lookup: mask === 7 ? 1 : 0, readiness: 0, factory: 0, send: 0 });
  });
}

for (const flag of flags) {
  test(`${flag} retains exact grammar independently`, () => {
    for (const value of [undefined, "", "false", "true"]) {
      const input = environment(Object.fromEntries(flags.map((name) => [name, "false"])));
      if (value === undefined) delete input[flag]; else input[flag] = value;
      const result = read(input, forbiddenRegistry);
      assert.equal(result.auth[["enabled", "httpEnabled", "emailDispatchEnabled"][flags.indexOf(flag)]], value === "true");
    }
    for (const value of ["TRUE", "False", " true", "true ", " false", "false ", " ", "\t", "\n",
      "0", "1", "yes", "on", "null", "undefined", 0, 1, false, true, null]) {
      assert.throws(() => read(environment({ [flags[0]]: "false", [flag]: value }), forbiddenRegistry),
        (error) => error instanceof AuthError && error.category === "invalid_feature_flag");
    }
  });
}

test("all three flags are read independently before the gate is evaluated", () => {
  const seen = [];
  const source = new Proxy({}, { get(_target, name) {
    if (flags.includes(name)) { seen.push(name); return "false"; }
    return undefined;
  } });
  assert.equal(read(source, forbiddenRegistry).status, "disabled");
  assert.deepEqual(seen, flags);
});

test("challenges true still requires complete HMAC when HTTP or dispatch is false", () => {
  for (const http of ["false", "true"]) for (const dispatch of ["false", "true"]) {
    assert.throws(() => read({ [flags[0]]: "true", [flags[1]]: http, [flags[2]]: dispatch }),
      (error) => error instanceof AuthError && error.category === "incomplete_hmac_configuration");
  }
  assert.throws(() => read({ EVERY8D_SETTINGS_OTP_HMAC_ACTIVE_KEY_VERSION: "partial" }), AuthError);
});

test("optional provider and sender are independent and dormant without registry resolution", () => {
  for (const input of [{}, { [provider]: "unknown" }, { [sender]: "LocalCase@example.test" },
    { [provider]: "unknown", [sender]: "LocalCase@example.test" }]) {
    const result = read(input, forbiddenRegistry);
    assert.equal(result.status, "disabled");
    assert.equal(result.providerId, input[provider]);
    assert.equal(result.canonicalSender, input[sender]);
  }
});

test("provider ID has only the frozen string/nonempty/lowercase/32-character contract", () => {
  for (const value of ["", "UPPER", "mixedCase", "a".repeat(33), 1, false, {}, null]) {
    assert.throws(() => read({ [provider]: value }, forbiddenRegistry), WorkerError);
  }
  // These are identities, not executable paths/URLs. No additional character grammar or repair.
  for (const value of ["a", "a".repeat(32), "a.b-c_1", "a/b", " a ", "123", "x:y", "é"]) {
    assert.equal(read({ [provider]: value }, forbiddenRegistry).providerId, value);
  }
});

test("operational configuration requires provider, sender and existing encryption", () => {
  for (const names of [[provider], [sender], [encryptionActive, encryptionKeys]]) {
    const input = environment();
    for (const name of names) delete input[name];
    const { registry, calls } = fixtureRegistry();
    assert.throws(() => read(input, registry), WorkerError);
    assert.deepEqual(calls, { lookup: 0, readiness: 0, factory: 0, send: 0 });
  }
});

test("unknown IDs fail operational membership including prototype properties and fake names", () => {
  for (const value of ["unknown", "fake", "test", "test-only", "constructor", "__proto__", "tostring"]) {
    assert.throws(() => read(environment({ [provider]: value })), WorkerError);
    assert.equal(read({ [provider]: value }).status, "disabled");
  }
});

test("supplied malformed encryption remains the existing auth parser's responsibility in either gate state", () => {
  const malformed = [
    { [encryptionActive]: undefined },
    { [encryptionKeys]: "" },
    { [encryptionKeys]: "{}" },
    { [encryptionActive]: "missing" },
    { [encryptionKeys]: JSON.stringify({ enc: encoded(3) + "=" }) },
    { [encryptionKeys]: `{"enc":"${encoded(3)}","enc":"${encoded(4)}"}` },
    { [encryptionKeys]: `{"enc":"${encoded(3)}","\\u0065nc":"${encoded(4)}"}` },
    { [encryptionKeys]: JSON.stringify({ enc: encoded(3), old: encoded(3) }) },
    { [encryptionKeys]: JSON.stringify({ enc: encoded(1) }) },
    { [encryptionKeys]: JSON.stringify({ enc: encoded(2) }) },
    { [encryptionKeys]: JSON.stringify({ enc: encoded(3), historical: encoded(1) }) },
    { [encryptionKeys]: JSON.stringify({ enc: encoded(3), ["x".repeat(64)]: encoded(4) }) },
    { [encryptionKeys]: " ".repeat(16385) + "{}" }
  ];
  for (const enabled of ["false", "true"]) for (const invalid of malformed) {
    assert.throws(() => read(environment({ [flags[0]]: enabled, ...invalid })),
      (error) => error instanceof AuthError && error.category === "invalid_keyring");
  }
});

test("existing encryption historical versions, defensive copies and bounds remain available", () => {
  const { registry } = fixtureRegistry();
  const input = environment({ [encryptionKeys]: JSON.stringify({ enc: encoded(3), "old.v-1": encoded(4) }) });
  const result = read(input, registry);
  const encryption = result.emailOutboxEncryption;
  assert.equal(encryption, result.auth.emailOutboxEncryption);
  assert.deepEqual(encryption.keys.versions(), ["enc", "old.v-1"]);
  encryption.keys.get("old.v-1").fill(0);
  assert.equal(encryption.keys.get("old.v-1").toString("base64url"), encoded(4));
  const entries = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [i === 0 ? "enc" : `v${i}`, encoded(i + 3)]));
  assert.equal(read(environment({ [encryptionKeys]: JSON.stringify(entries) }), registry).emailOutboxEncryption.keys.versions().length, 64);
  entries.extra = encoded(70);
  assert.throws(() => read(environment({ [encryptionKeys]: JSON.stringify(entries) }), registry), AuthError);
});

test("canonical sender retains the email authority's actual case, syntax and length bounds", () => {
  const domain = ["a".repeat(63), "b".repeat(63), "c".repeat(61)].join(".");
  for (const value of ["LocalCase@example.test", "a+b@example.test", "x@localhost",
    "!#$%&'*+-/=?^_`{|}~@example.test", "a".repeat(64) + "@" + domain]) {
    assert.equal(normalizeEvery8dSettingsEmail(value), value);
    assert.equal(read({ [sender]: value }, forbiddenRegistry).canonicalSender, value);
  }
  assert.equal(("a".repeat(64) + "@" + domain).length, 254);
});

test("sender requiring normalization is rejected rather than repaired", () => {
  for (const value of ["LocalCase@EXAMPLE.TEST", " x@example.test", "x@example.test ", "\tx@example.test\t"]) {
    assert.notEqual(normalizeEvery8dSettingsEmail(value), value);
    assert.throws(() => read({ [sender]: value }, forbiddenRegistry), WorkerError);
  }
});

test("malformed supplied sender rejects while disabled and operational", () => {
  const invalid = ["", "Display <x@example.test>", "x@example.test\r\nBcc: y@example.test",
    "x@example.test\n", "x@example.test\r", "x@example.test,y@example.test", "x@example.test; y@example.test",
    '"quoted"@example.test', "x@example.test (comment)", "x@example.test\0", "x@@example.test",
    "a".repeat(65) + "@example.test", "x@" + "a".repeat(64),
    "a".repeat(64) + "@" + ["a".repeat(63), "b".repeat(63), "c".repeat(62)].join("."), null, 1, {}];
  for (const value of invalid) {
    assert.throws(() => read({ [sender]: value }, forbiddenRegistry), WorkerError);
    assert.throws(() => read(environment({ [sender]: value }), forbiddenRegistry), WorkerError);
  }
});

test("configuration errors never echo provider or sender input", () => {
  for (const input of [{ [provider]: "PRIVATE_INVALID_PROVIDER" }, { [sender]: "private@example.test\n" }]) {
    assert.throws(() => read(input), (error) => {
      assert.equal(error.message, "EVERY8D settings email worker configuration is incomplete or invalid");
      assert.equal(Object.values(input).some((value) => error.stack.includes(value)), false);
      return true;
    });
  }
});
