const assert = require("node:assert/strict");
const test = require("node:test");

const {
  Every8dSettingsAuthConfigurationError,
  every8dSettingsAuthConfigurationErrorMessage,
  parseEvery8dSettingsAuthHmacKeyring,
  readEvery8dSettingsAuthConfig
} = require("../dist/config/every8dSettingsAuth");
const {
  decodeEvery8dSettingsChallengeUuid,
  deriveActiveEvery8dSettingsEmailPseudonym,
  deriveActiveEvery8dSettingsOtpHmac,
  deriveEvery8dSettingsEmailPseudonym,
  deriveEvery8dSettingsEmailPseudonyms,
  deriveEvery8dSettingsOtpHmac,
  encodeEvery8dSettingsOtp,
  every8dSettingsOtpAlphabet,
  formatEvery8dSettingsOtp,
  generateEvery8dSettingsOtp,
  generateEvery8dSettingsRequestCapability,
  hashEvery8dSettingsRequestCapability,
  normalizeEvery8dSettingsEmail,
  parseEvery8dSettingsOtp,
  parseEvery8dSettingsRequestCapability
} = require("../dist/services/every8dSettingsAuthPrimitives");
const {
  every8dSettingsEmailDeliveryFailureClasses
} = require("../dist/types/every8dSettingsAuthEmailDelivery");

const emailKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const otpKey = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";

function completeEnvironment(overrides = {}) {
  return {
    EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: "true",
    EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_ACTIVE_KEY_VERSION: "k1",
    EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_KEYS: JSON.stringify({ k1: emailKey }),
    EVERY8D_SETTINGS_OTP_HMAC_ACTIVE_KEY_VERSION: "otp-v1",
    EVERY8D_SETTINGS_OTP_HMAC_KEYS: JSON.stringify({ "otp-v1": otpKey }),
    ...overrides
  };
}

function assertConfigurationError(action, excludedValues = []) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof Every8dSettingsAuthConfigurationError, true);
    assert.equal(error.message, every8dSettingsAuthConfigurationErrorMessage);
    assert.equal(error.message, "EVERY8D settings auth configuration is incomplete or invalid");
    for (const value of excludedValues) assert.equal(error.message.includes(value), false);
    return true;
  });
}

test("feature flag exact absent, empty, false, and true semantics", () => {
  assert.equal(readEvery8dSettingsAuthConfig({}).enabled, false);
  assert.equal(readEvery8dSettingsAuthConfig({ EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: "" }).enabled, false);
  assert.equal(readEvery8dSettingsAuthConfig({ EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: "false" }).enabled, false);
  assert.equal(readEvery8dSettingsAuthConfig(completeEnvironment()).enabled, true);
});

test("feature flag rejects uppercase and whitespace variants", () => {
  for (const value of ["TRUE", " true", "true ", " ", "False"]) {
    assertConfigurationError(() => readEvery8dSettingsAuthConfig({
      EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: value
    }));
  }
});

test("disabled mode accepts no HMAC variables", () => {
  const config = readEvery8dSettingsAuthConfig({});
  assert.deepEqual(config, { enabled: false, emailPseudonymHmac: null, otpHmac: null });
});

test("disabled mode validates a complete HMAC configuration without enabling", () => {
  const config = readEvery8dSettingsAuthConfig(completeEnvironment({
    EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: "false"
  }));
  assert.equal(config.enabled, false);
  assert.equal(config.emailPseudonymHmac.activeKeyVersion, "k1");
  assert.equal(config.emailPseudonymHmac.keys.get("k1").length, 32);
  assert.equal(config.otpHmac.activeKeyVersion, "otp-v1");
  assert.equal(config.otpHmac.keys.get("otp-v1").length, 32);
});

test("partial HMAC configuration is rejected in disabled and enabled modes", () => {
  const partial = {
    EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_ACTIVE_KEY_VERSION: "k1"
  };
  assertConfigurationError(() => readEvery8dSettingsAuthConfig(partial));
  assertConfigurationError(() => readEvery8dSettingsAuthConfig({
    EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: "true",
    ...partial
  }));
});

test("enabled mode rejects missing HMAC configuration", () => {
  assertConfigurationError(() => readEvery8dSettingsAuthConfig({
    EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: "true"
  }));
});

test("present empty HMAC configuration is supplied and invalid", () => {
  assertConfigurationError(() => readEvery8dSettingsAuthConfig(completeEnvironment({
    EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: "false",
    EVERY8D_SETTINGS_OTP_HMAC_KEYS: ""
  })));
});

test("an own HMAC environment property with undefined value is supplied and invalid", () => {
  const environment = completeEnvironment({
    EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: "false",
    EVERY8D_SETTINGS_OTP_HMAC_KEYS: undefined
  });
  assert.equal(Object.hasOwn(environment, "EVERY8D_SETTINGS_OTP_HMAC_KEYS"), true);
  assertConfigurationError(() => readEvery8dSettingsAuthConfig(environment));
});

test("malformed HMAC configuration is rejected while disabled", () => {
  const rawSecret = "malformed-keyring-secret-value";
  assertConfigurationError(() => readEvery8dSettingsAuthConfig(completeEnvironment({
    EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: "false",
    EVERY8D_SETTINGS_OTP_HMAC_KEYS: rawSecret
  })), [rawSecret]);
});

test("valid complete enabled configuration is accepted", () => {
  const config = readEvery8dSettingsAuthConfig(completeEnvironment());
  assert.equal(config.enabled, true);
  assert.equal(config.emailPseudonymHmac.keys.get("k1").toString("base64url"), emailKey);
  assert.equal(config.otpHmac.keys.get("otp-v1").toString("base64url"), otpKey);
});

test("keyring parser accepts only non-empty plain string-valued objects", () => {
  assert.deepEqual(
    parseEvery8dSettingsAuthHmacKeyring(JSON.stringify({ k1: emailKey })).versions(),
    ["k1"]
  );
  for (const value of ["{}", "[]", "null", "7", "true", '"scalar"', '{"k1":{"nested":"value"}}']) {
    assertConfigurationError(() => parseEvery8dSettingsAuthHmacKeyring(value), [value]);
  }
});

test("keyring parser rejects invalid versions and encoded-key shapes", () => {
  const invalidEntries = [
    ["bad version", emailKey],
    ["k1", "A".repeat(42)],
    ["k1", "A".repeat(44)],
    ["k1", `${"A".repeat(42)}=`],
    ["k1", `${"A".repeat(42)}+`],
    ["k1", `${"A".repeat(42)}/`],
    ["k1", `${emailKey.slice(0, -1)}9`]
  ];
  for (const [version, key] of invalidEntries) {
    const raw = JSON.stringify({ [version]: key });
    assertConfigurationError(() => parseEvery8dSettingsAuthHmacKeyring(raw), [key, raw]);
  }
});

test("keyring scanner accepts JSON token whitespace and decoded canonical string escapes", () => {
  const escapedCanonicalKey = `\\u0041${emailKey.slice(1)}`;
  const raw = ` \n { \t "k1" \r : \n "${escapedCanonicalKey}" \t } \r\n`;
  const keyring = parseEvery8dSettingsAuthHmacKeyring(raw);
  assert.deepEqual(keyring.versions(), ["k1"]);
  assert.equal(keyring.get("k1").toString("base64url"), emailKey);
});

test("keyring scanner handles valid JSON string punctuation before normal key validation", () => {
  const syntacticallyValidValues = [
    'value-with-escaped-quote-"',
    "value-with-escaped-backslash-\\",
    "value,with,commas",
    "value:with:colons",
    "value{with}braces",
    'combined-"-\\-,:-{-}'
  ];
  for (const value of syntacticallyValidValues) {
    const raw = JSON.stringify({ k1: value });
    assert.doesNotThrow(() => JSON.parse(raw));
    assertConfigurationError(() => parseEvery8dSettingsAuthHmacKeyring(raw), [raw, value]);
  }
});

test("keyring scanner safely accepts __proto__ as an ordinary valid key version", () => {
  const raw = `{"__proto__":"${emailKey}"}`;
  const keyring = parseEvery8dSettingsAuthHmacKeyring(raw);
  assert.equal(keyring.has("__proto__"), true);
  assert.deepEqual(keyring.versions(), ["__proto__"]);
  assert.equal(keyring.get("__proto__").toString("base64url"), emailKey);
  assert.equal(Object.prototype.polluted, undefined);
});

test("keyring duplicate detection precedes final object materialization", () => {
  const otherKey = Buffer.alloc(32, 0x7f).toString("base64url");
  const duplicate = `{"k1":"${emailKey}","k1":"${otherKey}"}`;
  assert.equal(JSON.parse(duplicate).k1, otherKey);
  assertConfigurationError(() => parseEvery8dSettingsAuthHmacKeyring(duplicate), [emailKey, otherKey, duplicate]);

  const escapedDuplicate = `{"k1":"${emailKey}","k\\u0031":"${otherKey}"}`;
  assertConfigurationError(() => parseEvery8dSettingsAuthHmacKeyring(escapedDuplicate), [escapedDuplicate]);

  const punctuationDuplicate =
    `{"k1":"value,{:}","k1":"other-value}:,"}`;
  assertConfigurationError(
    () => parseEvery8dSettingsAuthHmacKeyring(punctuationDuplicate),
    [punctuationDuplicate]
  );
});

test("keyring scanner rejects malformed JSON with only the generic safe error", () => {
  const malformedValues = [
    `{"k\\q":"${emailKey}"}`,
    `{"k1":"value\\q"}`,
    `{"k\\u12G4":"${emailKey}"}`,
    '{"k1',
    '{"k1":"unterminated',
    `{"k1" "${emailKey}"}`,
    `{"k1":"${emailKey}" "k2":"${otpKey}"}`,
    `{"k1":"${emailKey}",}`,
    `{"k1":"${emailKey}"}{"k2":"${otpKey}"}`,
    "[]",
    "null",
    '"scalar"',
    "7",
    `{"k1":{"nested":"${emailKey}"}}`,
    `{"k1":["${emailKey}"]}`,
    '{"k1":true}',
    `{{"k1":"${emailKey}"}}`,
    `{"k1":"${emailKey}"]`
  ];
  for (const raw of malformedValues) {
    assertConfigurationError(() => parseEvery8dSettingsAuthHmacKeyring(raw), [raw]);
  }
});

test("configuration rejects an active version absent from its keyring", () => {
  assertConfigurationError(() => readEvery8dSettingsAuthConfig(completeEnvironment({
    EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_ACTIVE_KEY_VERSION: "missing"
  })));
});

test("configuration errors expose only the exact generic message", () => {
  const encodedSecret = Buffer.alloc(32, 0xaa).toString("base64url");
  const rawKeyring = `{"bad version":"${encodedSecret}"}`;
  assertConfigurationError(
    () => parseEvery8dSettingsAuthHmacKeyring(rawKeyring),
    [encodedSecret, rawKeyring, "bad version"]
  );
});

test("validated keyrings expose no Map or mutation authority and return defensive copies", () => {
  const keyring = parseEvery8dSettingsAuthHmacKeyring(JSON.stringify({
    k1: emailKey,
    "otp-v1": otpKey
  }));
  assert.equal(keyring instanceof Map, false);
  assert.equal(Object.isFrozen(keyring), true);
  assert.equal(Object.isFrozen(Object.getPrototypeOf(keyring)), true);
  assert.equal(keyring.set, undefined);
  assert.equal(keyring.delete, undefined);
  assert.equal(keyring.clear, undefined);
  assert.deepEqual(Object.getOwnPropertyNames(keyring), []);

  const versions = keyring.versions();
  versions.splice(0, versions.length, "attacker-version");
  assert.deepEqual(keyring.versions(), ["k1", "otp-v1"]);

  const firstLookup = keyring.get("k1");
  firstLookup.fill(0xff);
  assert.equal(keyring.get("k1").toString("base64url"), emailKey);
});

test("validated configuration prevents replacement of frozen key authority", () => {
  const config = readEvery8dSettingsAuthConfig(completeEnvironment());
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.emailPseudonymHmac), true);
  assert.equal(Object.isFrozen(config.otpHmac), true);
  assert.equal(Reflect.set(config.emailPseudonymHmac, "keys", new Map()), false);
  assert.equal(Reflect.set(config.emailPseudonymHmac, "activeKeyVersion", "attacker"), false);
  assert.equal(config.emailPseudonymHmac.activeKeyVersion, "k1");
  assert.equal(config.emailPseudonymHmac.keys.get("k1").toString("base64url"), emailKey);
});

test("email normalization preserves local case and lowercases the domain", () => {
  assert.equal(normalizeEvery8dSettingsEmail("Alice@EXAMPLE.COM"), "Alice@example.com");
  assert.equal(normalizeEvery8dSettingsEmail("A!#$%&'*+/=?^_`{|}~-z@example.com"), "A!#$%&'*+/=?^_`{|}~-z@example.com");
});

test("email normalization trims only surrounding ASCII SP and HTAB", () => {
  assert.equal(normalizeEvery8dSettingsEmail(" \tAlice@example.com\t "), "Alice@example.com");
  for (const value of [
    "Alice @example.com",
    "Alice@exam ple.com",
    "Alice\t@example.com",
    "Alice@example.com\n",
    "\rAlice@example.com",
    "Alice\u00a0@example.com",
    "Alíce@example.com",
    "Alice\x7f@example.com",
    "Alice@example.com\x7f"
  ]) assert.throws(() => normalizeEvery8dSettingsEmail(value));
  assert.throws(() => normalizeEvery8dSettingsEmail(7));
});

test("email normalization accepts the exact minimum valid address boundary", () => {
  assert.equal(normalizeEvery8dSettingsEmail("a@b"), "a@b");
  for (const value of ["@b", "a@", "a", "@", ""]) {
    assert.throws(() => normalizeEvery8dSettingsEmail(value), JSON.stringify(value));
  }
});

test("email normalization enforces dot-atom and DNS label grammar", () => {
  for (const value of [
    ".Alice@example.com",
    "Alice.@example.com",
    "Alice..Smith@example.com",
    "Alice@@example.com",
    "Alice@example.com.",
    "Alice@example..com",
    "Alice@-example.com",
    "Alice@example-.com",
    '"Alice"@example.com'
  ]) assert.throws(() => normalizeEvery8dSettingsEmail(value), value);
});

test("email normalization enforces local, label, domain, and address boundaries", () => {
  assert.equal(normalizeEvery8dSettingsEmail(`${"a".repeat(64)}@x.com`).length, 70);
  assert.throws(() => normalizeEvery8dSettingsEmail(`${"a".repeat(65)}@x.com`));
  assert.doesNotThrow(() => normalizeEvery8dSettingsEmail(`a@${"b".repeat(63)}.com`));
  assert.throws(() => normalizeEvery8dSettingsEmail(`a@${"b".repeat(64)}.com`));

  const domain252 = ["a".repeat(63), "b".repeat(63), "c".repeat(63), "d".repeat(60)].join(".");
  assert.equal(domain252.length, 252);
  assert.equal(normalizeEvery8dSettingsEmail(`a@${domain252}`).length, 254);
  const domain253 = ["a".repeat(63), "b".repeat(63), "c".repeat(63), "d".repeat(61)].join(".");
  assert.equal(domain253.length, 253);
  assert.throws(() => normalizeEvery8dSettingsEmail(`a@${domain253}`));
});

test("official request capability generation exposes no entropy injection and encodes canonically", () => {
  let injectedEntropyCalled = false;
  const capability = generateEvery8dSettingsRequestCapability(() => {
    injectedEntropyCalled = true;
    return Buffer.alloc(32);
  });
  assert.equal(generateEvery8dSettingsRequestCapability.length, 0);
  assert.equal(injectedEntropyCalled, false);
  assert.equal(capability.length, 43);
  assert.match(capability, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(parseEvery8dSettingsRequestCapability(capability).length, 32);
});

test("request capability parser rejects padding, alternate, malformed, and noncanonical encodings", () => {
  for (const value of [
    `${emailKey}=`,
    `${emailKey.slice(0, -1)}+`,
    `${emailKey.slice(0, -1)}/`,
    emailKey.slice(0, -1),
    `${emailKey.slice(0, -1)}9`,
    ` ${emailKey}`,
    emailKey.toUpperCase() + "A"
  ]) assert.throws(() => parseEvery8dSettingsRequestCapability(value), value);
});

test("request capability hash matches the fixed SHA-256 vector", () => {
  const hash = hashEvery8dSettingsRequestCapability(emailKey);
  assert.equal(hash.length, 32);
  assert.equal(hash.toString("hex"), "630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd");
});

test("email pseudonym reproduces the frozen vector", () => {
  const keyring = parseEvery8dSettingsAuthHmacKeyring(JSON.stringify({ k1: emailKey }));
  assert.equal(
    deriveEvery8dSettingsEmailPseudonym({
      normalizedEmail: "Alice@example.com",
      keyVersion: "k1",
      keyring
    }),
    "k1:a84dfc16aa086bfa11b69876adab6d5f7da2cf9c10aca8b6789703b035639ee8"
  );
});

test("email pseudonym authority requires an already canonical normalized email", () => {
  const keyring = parseEvery8dSettingsAuthHmacKeyring(JSON.stringify({ k1: emailKey }));
  for (const normalizedEmail of [
    "Alice@EXAMPLE.COM",
    " Alice@example.com",
    "Alice@example.com\t"
  ]) {
    assert.throws(() => deriveEvery8dSettingsEmailPseudonym({
      normalizedEmail,
      keyVersion: "k1",
      keyring
    }));
  }
});

test("mutating a returned key Buffer cannot change later pseudonym authority", () => {
  const keyring = parseEvery8dSettingsAuthHmacKeyring(JSON.stringify({ k1: emailKey }));
  const before = deriveEvery8dSettingsEmailPseudonym({
    normalizedEmail: "Alice@example.com", keyVersion: "k1", keyring
  });
  keyring.get("k1").fill(0);
  const after = deriveEvery8dSettingsEmailPseudonym({
    normalizedEmail: "Alice@example.com", keyVersion: "k1", keyring
  });
  assert.equal(after, before);
  assert.equal(
    after,
    "k1:a84dfc16aa086bfa11b69876adab6d5f7da2cf9c10aca8b6789703b035639ee8"
  );
});

test("email pseudonyms are lowercase, identity-sensitive, key-sensitive, and deterministically ordered", () => {
  const keyring = parseEvery8dSettingsAuthHmacKeyring(JSON.stringify({
    z2: Buffer.alloc(32, 0x22).toString("base64url"),
    a1: Buffer.alloc(32, 0x11).toString("base64url")
  }));
  const aliases = deriveEvery8dSettingsEmailPseudonyms({ normalizedEmail: "Alice@example.com", keyring });
  assert.deepEqual(aliases.map((alias) => alias.split(":")[0]), ["a1", "z2"]);
  for (const alias of aliases) assert.match(alias, /^[A-Za-z0-9_.-]+:[0-9a-f]{64}$/);
  assert.notEqual(aliases[0], aliases[1]);
  assert.notEqual(
    deriveEvery8dSettingsEmailPseudonym({ normalizedEmail: "Alice@example.com", keyVersion: "a1", keyring }),
    deriveEvery8dSettingsEmailPseudonym({ normalizedEmail: "alice@example.com", keyVersion: "a1", keyring })
  );
  assert.throws(() => deriveEvery8dSettingsEmailPseudonym({
    normalizedEmail: "Alice@example.com", keyVersion: "missing", keyring
  }));
  assert.equal(
    deriveActiveEvery8dSettingsEmailPseudonym({
      normalizedEmail: "Alice@example.com",
      hmacConfig: { activeKeyVersion: "z2", keys: keyring }
    }),
    aliases[1]
  );
});

test("OTP generation reproduces the frozen MSB-first vector", () => {
  const entropy = Buffer.from("0011223344", "hex");
  assert.equal(encodeEvery8dSettingsOtp(entropy), "008J4CT4");
  assert.equal(formatEvery8dSettingsOtp(encodeEvery8dSettingsOtp(entropy)), "008J-4CT4");
});

test("official OTP generation exposes no entropy injection and uses the frozen alphabet", () => {
  let injectedEntropyCalled = false;
  const otp = generateEvery8dSettingsOtp(() => {
    injectedEntropyCalled = true;
    return Buffer.alloc(5);
  });
  assert.equal(generateEvery8dSettingsOtp.length, 0);
  assert.equal(injectedEntropyCalled, false);
  assert.equal(otp.length, 8);
  assert.match(otp, /^[0-9A-HJKMNP-TV-Z]{8}$/);
});

test("OTP parser accepts only canonical and exact display forms with valid ASCII case", () => {
  assert.equal(parseEvery8dSettingsOtp("008J4CT4"), "008J4CT4");
  assert.equal(parseEvery8dSettingsOtp("008J-4CT4"), "008J4CT4");
  assert.equal(parseEvery8dSettingsOtp("008j4ct4"), "008J4CT4");
  assert.equal(parseEvery8dSettingsOtp("0a8J4cT4"), "0A8J4CT4");
});

test("OTP parser rejects ambiguous symbols without substitution", () => {
  for (const character of ["O", "o", "I", "i", "L", "l", "U", "u"]) {
    assert.throws(() => parseEvery8dSettingsOtp(`${character}1234567`), character);
  }
});

test("OTP parser rejects whitespace, Unicode, punctuation, bad dashes, and malformed lengths", () => {
  for (const value of [
    " 008J4CT4",
    "008J4CT4 ",
    "008J\t4CT4",
    "008J\n4CT4",
    "008J–4CT4",
    "008J_4CT4",
    "008-J4CT4",
    "008J--4CT4",
    "008J4CT",
    "008J4CT44",
    "008J-4CT"
  ]) assert.throws(() => parseEvery8dSettingsOtp(value), JSON.stringify(value));
});

test("challenge UUID decoding reproduces RFC textual/network order", () => {
  assert.equal(
    decodeEvery8dSettingsChallengeUuid("00112233-4455-6677-8899-aabbccddeeff").toString("hex"),
    "00112233445566778899aabbccddeeff"
  );
  assert.equal(
    decodeEvery8dSettingsChallengeUuid("00112233-4455-6677-8899-AABBCCDDEEFF").toString("hex"),
    "00112233445566778899aabbccddeeff"
  );
});

test("challenge UUID decoding rejects noncanonical textual forms", () => {
  for (const value of [
    "{00112233-4455-6677-8899-aabbccddeeff}",
    "urn:uuid:00112233-4455-6677-8899-aabbccddeeff",
    "00112233445566778899aabbccddeeff",
    " 00112233-4455-6677-8899-aabbccddeeff",
    "00112233-4455-6677-8899-aabbccddeefg"
  ]) assert.throws(() => decodeEvery8dSettingsChallengeUuid(value), value);
});

test("OTP HMAC reproduces frozen login and enrollment vectors", () => {
  const keyring = parseEvery8dSettingsAuthHmacKeyring(JSON.stringify({ "otp-v1": otpKey }));
  const input = {
    challengeId: "00112233-4455-6677-8899-aabbccddeeff",
    otp: "0123-4567",
    keyVersion: "otp-v1",
    keyring
  };
  const login = deriveEvery8dSettingsOtpHmac({ ...input, purpose: "login" });
  const enrollment = deriveEvery8dSettingsOtpHmac({ ...input, purpose: "enrollment" });
  assert.equal(login.length, 32);
  assert.equal(login.toString("hex"), "1ae747b37e3bef979980cb106e880da4a3f88e61aa1409c4f50290f70d29ecfe");
  assert.equal(enrollment.toString("hex"), "e34767afbcde553162adbb76925dc0f7426422474d8d4b4bd2b557c806240dd6");
  assert.notDeepEqual(login, enrollment);
});

test("OTP HMAC rejects an invalid purpose at runtime", () => {
  const keyring = parseEvery8dSettingsAuthHmacKeyring(JSON.stringify({ "otp-v1": otpKey }));
  assert.throws(() => deriveEvery8dSettingsOtpHmac({
    purpose: "reset",
    challengeId: "00112233-4455-6677-8899-aabbccddeeff",
    otp: "01234567",
    keyVersion: "otp-v1",
    keyring
  }));
});

test("mutating a returned key Buffer cannot change later OTP HMAC authority", () => {
  const keyring = parseEvery8dSettingsAuthHmacKeyring(JSON.stringify({ "otp-v1": otpKey }));
  const input = {
    purpose: "login",
    challengeId: "00112233-4455-6677-8899-aabbccddeeff",
    otp: "01234567",
    keyVersion: "otp-v1",
    keyring
  };
  const before = deriveEvery8dSettingsOtpHmac(input);
  keyring.get("otp-v1").fill(0);
  const after = deriveEvery8dSettingsOtpHmac(input);
  assert.deepEqual(after, before);
  assert.equal(after.toString("hex"), "1ae747b37e3bef979980cb106e880da4a3f88e61aa1409c4f50290f70d29ecfe");
});

test("OTP HMAC separates challenge UUIDs and keys and fails closed on missing versions", () => {
  const keyring = parseEvery8dSettingsAuthHmacKeyring(JSON.stringify({
    "otp-v1": otpKey,
    "otp-v2": Buffer.alloc(32, 0x55).toString("base64url")
  }));
  const base = {
    purpose: "login",
    challengeId: "00112233-4455-6677-8899-aabbccddeeff",
    otp: "01234567",
    keyVersion: "otp-v1",
    keyring
  };
  const original = deriveEvery8dSettingsOtpHmac(base);
  assert.notDeepEqual(original, deriveEvery8dSettingsOtpHmac({
    ...base, challengeId: "10112233-4455-6677-8899-aabbccddeeff"
  }));
  assert.notDeepEqual(original, deriveEvery8dSettingsOtpHmac({ ...base, keyVersion: "otp-v2" }));
  assert.throws(() => deriveEvery8dSettingsOtpHmac({ ...base, keyVersion: "missing" }));
  const active = deriveActiveEvery8dSettingsOtpHmac({
    purpose: base.purpose,
    challengeId: base.challengeId,
    otp: base.otp,
    hmacConfig: { activeKeyVersion: "otp-v2", keys: keyring }
  });
  assert.equal(active.keyVersion, "otp-v2");
  assert.deepEqual(active.hmac, deriveEvery8dSettingsOtpHmac({ ...base, keyVersion: "otp-v2" }));
});

test("email-delivery failure taxonomy is limited to the frozen values", () => {
  assert.deepEqual(every8dSettingsEmailDeliveryFailureClasses, [
    "provider_rejected",
    "delivery_outcome_unknown",
    "sender_unavailable"
  ]);
});
