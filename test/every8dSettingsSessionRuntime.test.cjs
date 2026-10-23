const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { isDeepStrictEqual } = require("node:util");

// Failure diagnostics must never serialize protected result or payload values.
function assertSafeEqual(actual, expected) { assert.ok(isDeepStrictEqual(actual, expected)); }
const {
  readEvery8dSettingsAuthConfig, Every8dSettingsAuthConfigurationError
} = require("../dist/config/every8dSettingsAuth");
const {
  generateEvery8dSettingsSessionCredential: generateCredential,
  parseEvery8dSettingsSessionCredential: parseCredential,
  hashEvery8dSettingsSessionCredential: hashCredential
} = require("../dist/services/every8dSettingsSessionPrimitives");
const {
  createEvery8dSettingsSessionRepository: createRepository
} = require("../dist/services/every8dSettingsSessionRepository");
const {
  createEvery8dSettingsSessionService: createService
} = require("../dist/services/every8dSettingsSessionService");
const { createEvery8dSettingsAuthService } = require("../dist/services/every8dSettingsAuthService");
const {
  deriveEvery8dSettingsEmailPseudonyms, hashEvery8dSettingsRequestCapability
} = require("../dist/services/every8dSettingsAuthPrimitives");

// All key material and identities in this file are synthetic, local-only fixtures.
function config(overrides = {}) {
  return readEvery8dSettingsAuthConfig({
    EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: "true",
    EVERY8D_SETTINGS_AUTH_HTTP_ENABLED: "true",
    EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_ACTIVE_KEY_VERSION: "new",
    EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_KEYS: JSON.stringify({
      old: Buffer.alloc(32, 0x11).toString("base64url"),
      new: Buffer.alloc(32, 0x22).toString("base64url")
    }),
    EVERY8D_SETTINGS_OTP_HMAC_ACTIVE_KEY_VERSION: "otp",
    EVERY8D_SETTINGS_OTP_HMAC_KEYS: JSON.stringify({ otp: Buffer.alloc(32, 0x33).toString("base64url") }),
    ...overrides
  });
}
const challengeId = "11111111-1111-4111-8111-111111111111";
const grantId = "22222222-2222-4222-8222-222222222222";
const administratorId = "33333333-3333-4333-8333-333333333333";
const installationId = "44444444-4444-4444-8444-444444444444";
const normalizedEmail = "Synthetic@example.invalid";
const aliases = deriveEvery8dSettingsEmailPseudonyms({
  normalizedEmail, keyring: config().emailPseudonymHmac.keys
});
const requestTokenHash = Buffer.alloc(32, 0xab);
const sessionTokenHash = Buffer.alloc(32, 0xcd);
const consumeInput = { requestTokenHash, sessionTokenHash, emailPseudonymAliases: aliases };
const failure = (category) => ({ outcome: "failure", category });
const contractViolation = failure("repository_contract_violation");
const unavailable = failure("repository_unavailable");
const repositoryMethods = ["discoverVerifiedChallenge", "consumeEnrollmentChallenge",
  "consumeLoginChallenge", "authenticateSession", "revokeSession"];
const serviceMethods = ["verifyAndConsume", "authenticateSession", "revokeSession"];
const rpcNames = [
  "runtime_discover_every8d_settings_verified_challenge_v1",
  "runtime_consume_every8d_settings_enrollment_challenge_v1",
  "runtime_consume_every8d_settings_login_challenge_v1",
  "runtime_authenticate_every8d_settings_session_v1",
  "runtime_revoke_every8d_settings_session_v1"
];
function discoveryRow(purpose = "enrollment") {
  return { challenge_id: challengeId, purpose,
    enrollment_grant_id: purpose === "enrollment" ? grantId : null,
    normalized_email: normalizedEmail, email_pseudonym: aliases[1] };
}
function consumeRow(overrides = {}) {
  return { administrator_id: administratorId, installation_id: installationId,
    installation_generation: 1, created_at: "2026-10-22T00:00:00.123456Z",
    expires_at: "2026-10-22T01:00:00.123456Z", ...overrides };
}
function authRow(overrides = {}) {
  const { created_at, ...row } = consumeRow();
  return { ...row, ...overrides };
}
function fakeRepository(data, options = {}) {
  const calls = [];
  let constructions = 0;
  const repository = createRepository(() => {
    constructions++;
    if (options.getterThrows) throw new Error("synthetic transport detail");
    return { async rpc(name, args) {
      calls.push({ name, args });
      if (options.throws) throw new Error("synthetic transport detail");
      return options.response !== undefined ? options.response : {
        data, error: options.error === undefined ? null : options.error, status: 200
      };
    } };
  });
  return { repository, calls, constructions: () => constructions };
}
function repositoryInput(method) {
  if (method === "discoverVerifiedChallenge") return { requestTokenHash, purpose: "enrollment" };
  if (method.startsWith("consume")) return consumeInput;
  return { sessionTokenHash };
}
function assertClosedOutcome(result, outcome) {
  assert.deepEqual(Object.keys(result), ['outcome']);
  assert.ok(result.outcome === outcome);
}

for (const [name, field] of [
  ["EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED", "enabled"],
  ["EVERY8D_SETTINGS_AUTH_HTTP_ENABLED", "httpEnabled"],
  ["EVERY8D_SETTINGS_AUTH_EMAIL_DISPATCH_ENABLED", "emailDispatchEnabled"]
]) {
  for (const [label, value, expected] of [
    ["absent", undefined, false], ["empty", "", false], ["false", "false", false], ["true", "true", true]
  ]) test(`${field} exact grammar: ${label}`, () => {
    const environment = { [name]: value };
    const parsed = name.endsWith("CHALLENGES_ENABLED") && expected ? config(environment)
      : readEvery8dSettingsAuthConfig(environment);
    assert.equal(parsed[field], expected);
    assert.ok(Object.isFrozen(parsed));
  });
  for (const value of ["TRUE", "1", "yes", " true", "true ", " false", "false ", " ", "\ttrue"]) {
    test(`${field} rejects non-exact flag ${JSON.stringify(value)}`, () => {
      assert.throws(() => readEvery8dSettingsAuthConfig({ [name]: value }), (error) =>
        error instanceof Every8dSettingsAuthConfigurationError && error.category === "invalid_feature_flag"
      );
    });
  }
}

test("HTTP false does not read absent HMAC material or generate entropy", () => {
  let reads = 0;
  const source = { EVERY8D_SETTINGS_AUTH_HTTP_ENABLED: "false" };
  Object.setPrototypeOf(source, { get EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_KEYS() { reads++; throw Error(); } });
  const parsed = readEvery8dSettingsAuthConfig(source);
  assert.equal(reads, 0);
  assert.equal(parsed.emailPseudonymHmac, null);
});

test("session credentials are fresh canonical 32-byte values and hash decoded bytes", () => {
  const first = generateCredential();
  const second = generateCredential();
  // Boolean comparisons ensure assertion diagnostics cannot print credentials/hashes.
  assert.ok(first !== second);
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(first));
  const decoded = parseCredential(first);
  assert.equal(decoded.length, 32);
  assert.ok(decoded.toString("base64url") === first);
  assert.ok(hashCredential(first).equals(crypto.createHash("sha256").update(decoded).digest()));
  assert.ok(!hashCredential(first).equals(crypto.createHash("sha256").update(first, "utf8").digest()));
});

test("strict session parser rejects malformed and alternate serializations safely", () => {
  const canonical = Buffer.alloc(32).toString("base64url");
  for (const value of [undefined, null, 7, {}, Buffer.alloc(32), "", canonical + "=",
    canonical.slice(1), canonical + "A", " " + canonical, canonical + "\n",
    "+" + canonical.slice(1), "/" + canonical.slice(1), canonical.slice(0, -1) + "B"]) {
    assert.throws(() => parseCredential(value), (error) =>
      error.message === "EVERY8D settings session credential is invalid"
    );
    assert.throws(() => hashCredential(value), (error) =>
      error.message === "EVERY8D settings session credential is invalid"
    );
  }
});

test("repository inventory and all five exact wrapper/argument contracts", async () => {
  const calls = [];
  const responses = [[discoveryRow()], [consumeRow()], [consumeRow()], [authRow()], true];
  const repository = createRepository(() => ({ async rpc(name, args) {
    calls.push({ name, args }); return { data: responses[calls.length - 1], error: null };
  } }));
  assert.deepEqual(Object.keys(repository).sort(), [...repositoryMethods].sort());
  assert.ok(Object.isFrozen(repository));
  for (const method of repositoryMethods) {
    const result = await repository[method](repositoryInput(method));
    assert.ok(Object.isFrozen(result));
    assert.ok(result.outcome !== "failure");
  }
  assert.deepEqual(calls.map((call) => call.name), rpcNames);
  const expectedKeys = [["input_request_token_hash", "input_purpose"],
    ["input_request_token_hash", "input_email_pseudonym_aliases", "input_session_token_hash"],
    ["input_request_token_hash", "input_email_pseudonym_aliases", "input_session_token_hash"],
    ["input_session_token_hash"], ["input_session_token_hash"]];
  calls.forEach(({ args }, index) => {
    assert.deepEqual(Object.keys(args).sort(), expectedKeys[index].sort());
    for (const key of Object.keys(args).filter((key) => key.endsWith("_hash"))) {
      assert.ok(/^\\x[0-9a-f]{64}$/.test(args[key]));
      const expected = key === "input_request_token_hash" ? requestTokenHash : sessionTokenHash;
      assert.ok(args[key] === "\\x" + expected.toString("hex"));
    }
    if (args.input_email_pseudonym_aliases) {
      assert.ok(args.input_email_pseudonym_aliases !== aliases);
      assert.ok(args.input_email_pseudonym_aliases.every((alias, i) => alias === aliases[i]));
    }
  });
});

for (const [method, outcome] of [["discoverVerifiedChallenge", "not_found"],
  ["consumeEnrollmentChallenge", "not_consumed"], ["consumeLoginChallenge", "not_consumed"],
  ["authenticateSession", "unauthorized"]]) {
  test(`${method} zero rows is a closed negative`, async () => {
    const fake = fakeRepository([]);
    assertClosedOutcome(await fake.repository[method](repositoryInput(method)), outcome);
    assert.equal(fake.calls.length, 1);
  });
}

for (const method of repositoryMethods) {
  for (const kind of ["rpc_error", "throw", "client_throw", "missing_response", "missing_data", "missing_error"]) {
    test(`${method} ${kind} fails closed without retry or details`, async () => {
      const opts = kind === "rpc_error" ? { error: { code: "synthetic", message: "private upstream detail" } }
        : kind === "throw" ? { throws: true } : kind === "client_throw" ? { getterThrows: true }
        : { response: kind === "missing_response" ? null : kind === "missing_data" ? { error: null } : { data: true } };
      const fake = fakeRepository(true, opts);
      const expected = ["rpc_error", "throw", "client_throw"].includes(kind) ? unavailable : contractViolation;
      assertSafeEqual(await fake.repository[method](repositoryInput(method)), expected);
      assert.equal(fake.constructions(), 1);
      assert.equal(fake.calls.length, kind === "client_throw" ? 0 : 1);
    });
  }
  for (const digest of [null, "serialized", Buffer.alloc(31), Buffer.alloc(33), new Uint8Array(32)]) {
    test(`${method} rejects invalid digest ${digest === null ? "null" : typeof digest + (digest.length ?? "")}`, async () => {
      const fake = fakeRepository(true);
      const key = method === "discoverVerifiedChallenge" || method.startsWith("consume") ? "requestTokenHash" : "sessionTokenHash";
      assertSafeEqual(await fake.repository[method]({ ...repositoryInput(method), [key]: digest }), contractViolation);
      assert.equal(fake.constructions(), 0);
    });
  }
}

const discoveryMutations = {
  "not array": () => ({}), "two rows": (row) => [row, row], "null row": () => [null],
  "missing key": (row) => { delete row.email_pseudonym; return [row]; },
  "extra key": (row) => [{ ...row, extra: true }],
  "bad UUID": (row) => [{ ...row, challenge_id: "invalid" }],
  "uppercase UUID": (row) => [{ ...row, challenge_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase() }],
  "unknown purpose": (row) => [{ ...row, purpose: "other" }],
  "purpose mismatch": (row) => [{ ...row, purpose: "login", enrollment_grant_id: null }],
  "missing enrollment grant": (row) => [{ ...row, enrollment_grant_id: null }],
  "bad grant": (row) => [{ ...row, enrollment_grant_id: "invalid" }],
  "noncanonical email": (row) => [{ ...row, normalized_email: "Synthetic@EXAMPLE.invalid" }],
  "invalid email": (row) => [{ ...row, normalized_email: "invalid" }],
  "invalid pseudonym": (row) => [{ ...row, email_pseudonym: "invalid" }]
};
for (const [label, mutate] of Object.entries(discoveryMutations)) {
  test(`discovery rejects ${label}`, async () => {
    const fake = fakeRepository(mutate(discoveryRow()));
    assertSafeEqual(await fake.repository.discoverVerifiedChallenge(repositoryInput("discoverVerifiedChallenge")), contractViolation);
    assert.equal(fake.calls.length, 1);
  });
}
test("login discovery requires null grant and exact requested purpose", async () => {
  for (const grant of [null, grantId]) {
    const fake = fakeRepository([{ ...discoveryRow("login"), enrollment_grant_id: grant }]);
    const result = await fake.repository.discoverVerifiedChallenge({ requestTokenHash, purpose: "login" });
    if (grant === null) { assert.equal(result.outcome, "discovered"); assert.equal(result.challenge.purpose, "login"); }
    else assertSafeEqual(result, contractViolation);
  }
  const fake = fakeRepository([]);
  assertSafeEqual(await fake.repository.discoverVerifiedChallenge({ requestTokenHash, purpose: "unexpected" }), contractViolation);
  assert.equal(fake.constructions(), 0);
});

for (const method of ["consumeEnrollmentChallenge", "consumeLoginChallenge"]) {
  for (const [label, value] of [["empty", []], ["oversize", Array(65).fill(aliases[0])],
    ["null", null], ["null member", [null]], ["nested", [[aliases[0]]]],
    ["invalid", ["invalid"]], ["sparse", Array(1)], ["nonarray", { 0: aliases[0], length: 1 }]]) {
    test(`${method} rejects ${label} aliases before client`, async () => {
      const fake = fakeRepository([]);
      assertSafeEqual(await fake.repository[method]({ ...consumeInput, emailPseudonymAliases: value }), contractViolation);
      assert.equal(fake.constructions(), 0);
    });
  }
  test(`${method} accepts exactly 64 aliases and rejects invalid session digest`, async () => {
    const fake = fakeRepository([]);
    assertClosedOutcome(await fake.repository[method]({ ...consumeInput, emailPseudonymAliases: Array(64).fill(aliases[0]) }), "not_consumed");
    assertSafeEqual(await fake.repository[method]({ ...consumeInput, sessionTokenHash: Buffer.alloc(31) }), contractViolation);
    assert.equal(fake.calls.length, 1);
  });
}

const principalMutations = {
  "not array": () => ({}), "two rows": (row) => [row, row], "null row": () => [null],
  "missing key": (row) => { delete row.administrator_id; return [row]; },
  "extra key": (row) => [{ ...row, session_id: grantId }],
  "bad administrator": (row) => [{ ...row, administrator_id: "invalid" }],
  "bad installation": (row) => [{ ...row, installation_id: "invalid" }],
  "zero generation": (row) => [{ ...row, installation_generation: 0 }],
  "negative generation": (row) => [{ ...row, installation_generation: -1 }],
  "fraction generation": (row) => [{ ...row, installation_generation: 1.5 }],
  "string generation": (row) => [{ ...row, installation_generation: "1" }],
  "overflow generation": (row) => [{ ...row, installation_generation: 2147483648 }],
  "NaN generation": (row) => [{ ...row, installation_generation: NaN }],
  "invalid timestamp": (row) => [{ ...row, expires_at: "invalid" }],
  "bad date": (row) => [{ ...row, expires_at: "2026-02-30T01:00:00Z" }],
  "bad month": (row) => [{ ...row, expires_at: "2026-13-01T01:00:00Z" }],
  "bad hour": (row) => [{ ...row, expires_at: "2026-10-22T24:00:00Z" }],
  "bad offset": (row) => [{ ...row, expires_at: "2026-10-22T01:00:00+16:00" }],
  "no timezone": (row) => [{ ...row, expires_at: "2026-10-22T01:00:00" }]
};
for (const method of ["consumeEnrollmentChallenge", "consumeLoginChallenge", "authenticateSession"]) {
  for (const [label, mutate] of Object.entries(principalMutations)) {
    test(`${method} rejects ${label} payload`, async () => {
      const fake = fakeRepository(mutate(method === "authenticateSession" ? authRow() : consumeRow()));
      assertSafeEqual(await fake.repository[method](repositoryInput(method)), contractViolation);
      assert.equal(fake.calls.length, 1);
    });
  }
}
for (const method of ["consumeEnrollmentChallenge", "consumeLoginChallenge"]) {
  for (const [label, values] of [
    ["short", { expires_at: "2026-10-22T00:59:59.123456Z" }],
    ["long", { expires_at: "2026-10-22T01:00:01.123456Z" }],
    ["microsecond mismatch", { expires_at: "2026-10-22T01:00:00.123457Z" }],
    ["reversed", { expires_at: "2026-10-21T23:00:00.123456Z" }],
    ["equal", { expires_at: "2026-10-22T00:00:00.123456Z" }],
    ["bad created", { created_at: "invalid" }]
  ]) test(`${method} rejects ${label} lifetime`, async () => {
    const fake = fakeRepository([consumeRow(values)]);
    assertSafeEqual(await fake.repository[method](consumeInput), contractViolation);
  });
  test(`${method} accepts offset-equivalent one hour and exact closed metadata`, async () => {
    const fake = fakeRepository([consumeRow({ expires_at: "2026-10-22T02:00:00.1234560+01:00" })]);
    const result = await fake.repository[method](consumeInput);
    assert.equal(result.outcome, "consumed");
    assert.deepEqual(Object.keys(result).sort(), ["outcome", "session"]);
    assert.deepEqual(Object.keys(result.session).sort(), ["administratorId", "installationId", "installationGeneration", "createdAt", "expiresAt"].sort());
    assert.ok(Object.isFrozen(result.session));
    assert.equal(result.session.installationGeneration, 1);
    assert.equal(result.session.createdAt.toISOString(), "2026-10-22T00:00:00.123Z");
  });
}

test("repository authentication trusts DB even when timestamp precedes local clock", async () => {
  const fake = fakeRepository([authRow({ expires_at: "2000-01-01T00:00:00Z" })]);
  const result = await fake.repository.authenticateSession({ sessionTokenHash });
  assert.equal(result.outcome, "authenticated");
  assert.deepEqual(Object.keys(result.principal).sort(), ["administratorId", "installationId", "installationGeneration", "expiresAt"].sort());
  assert.ok(Object.isFrozen(result.principal));
  assert.equal(fake.calls.length, 1);
});
for (const [label, value] of [["true", true], ["false", false], ["null", null], ["array", []], ["string", "true"], ["number", 1]]) {
  test(`revoke ${label} has frozen persisted contract`, async () => {
    const fake = fakeRepository(value);
    const result = await fake.repository.revokeSession({ sessionTokenHash });
    if (value === true) assertClosedOutcome(result, "revoked");
    else assertSafeEqual(result, contractViolation);
    assert.equal(fake.calls.length, 1);
  });
}

function serviceFixture(options = {}) {
  const purpose = options.purpose ?? "enrollment";
  const cfg = options.config ?? config();
  const events = [];
  const counters = { verifierFactory: 0, verify: 0, repositoryFactory: 0,
    discover: 0, entropy: 0, enrollment: 0, login: 0, authenticate: 0, revoke: 0 };
  const captures = {};
  const session = { administratorId, installationId, installationGeneration: 1,
    createdAt: new Date("2026-10-22T00:00:00.123Z"), expiresAt: new Date("2026-10-22T01:00:00.123Z") };
  const challenge = { challengeId, purpose, enrollmentGrantId: purpose === "enrollment" ? grantId : null,
    normalizedEmail, emailPseudonym: aliases[1], ...options.challenge };
  const repository = {
    async discoverVerifiedChallenge(input) {
      counters.discover++; events.push("discover"); captures.discovery = input;
      if (options.discoveryThrows) throw Error("synthetic detail");
      return options.discovery ?? { outcome: "discovered", challenge };
    },
    async consumeEnrollmentChallenge(input) { counters.enrollment++; return consume(input, "enrollment"); },
    async consumeLoginChallenge(input) { counters.login++; return consume(input, "login"); },
    async authenticateSession(input) {
      counters.authenticate++; captures.authentication = input;
      if (options.authThrows) throw Error("synthetic detail");
      return options.auth ?? { outcome: "authenticated", principal: {
        administratorId, installationId, installationGeneration: 1, expiresAt: session.expiresAt
      } };
    },
    async revokeSession(input) {
      counters.revoke++; captures.revocation = input;
      if (options.revokeThrows) throw Error("synthetic detail");
      return options.revoke ?? { outcome: "revoked" };
    }
  };
  async function consume(input, label) {
    events.push(label); captures.consume = input;
    if (options.consumeThrows) throw Error("synthetic ambiguous write");
    if (options.consumeDeferred) return options.consumeDeferred;
    return options.consume ?? { outcome: "consumed", session };
  }
  const service = createService(cfg, {
    verifierFactory() {
      counters.verifierFactory++; events.push("verifierFactory");
      return { async verifyChallenge(input) {
        counters.verify++; events.push("verify"); captures.verification = input;
        if (options.verifierThrows) throw Error("synthetic detail");
        return options.verification ?? { outcome: "verified", challengeId, purpose };
      } };
    },
    repositoryFactory() {
      counters.repositoryFactory++; events.push("repositoryFactory");
      if (options.repositoryThrows) throw Error("synthetic detail");
      return repository;
    },
    credentialFactory() {
      counters.entropy++; events.push("entropy");
      if (options.entropyThrows) throw Error("synthetic detail");
      return generateCredential();
    }
  });
  const input = { purpose, requestCapability: Buffer.alloc(32, 0x55).toString("base64url"), otp: "01234567" };
  return { service, counters, captures, input, events };
}

for (const [label, enabled, httpEnabled] of [["challenge", false, true], ["HTTP", true, false]]) {
  test(`${label} disabled gate precedes all getters, hashes, entropy, aliases, and constructors`, async () => {
    const counters = { input: 0, dependencies: 0, secrets: 0, hash: 0, hmac: 0, entropy: 0 };
    const poisonInput = new Proxy({}, { get() { counters.input++; throw Error(); } });
    const poisonDependencies = new Proxy({}, { get() { counters.dependencies++; throw Error(); } });
    const cfg = { enabled, httpEnabled,
      get emailPseudonymHmac() { counters.secrets++; throw Error(); },
      get otpHmac() { counters.secrets++; throw Error(); } };
    const saved = { createHash: crypto.createHash, createHmac: crypto.createHmac, randomBytes: crypto.randomBytes };
    crypto.createHash = () => { counters.hash++; throw Error(); };
    crypto.createHmac = () => { counters.hmac++; throw Error(); };
    crypto.randomBytes = () => { counters.entropy++; throw Error(); };
    try {
      const service = createService(cfg, poisonDependencies);
      for (const method of serviceMethods) assertClosedOutcome(await service[method](poisonInput), "disabled");
      assert.deepEqual(counters, { input: 0, dependencies: 0, secrets: 0, hash: 0, hmac: 0, entropy: 0 });
    } finally { Object.assign(crypto, saved); }
  });
}

test("new service inventory is closed and exposes no standalone consumption", () => {
  const { service } = serviceFixture();
  assert.deepEqual(Object.keys(service).sort(), [...serviceMethods].sort());
  assert.ok(Object.isFrozen(service));
});

for (const [label, options, outcome, discovers] of [
  ["rejected verifier", { verification: { outcome: "rejected" } }, "rejected", 0],
  ["unavailable verifier", { verification: { outcome: "unavailable" } }, "unavailable", 0],
  ["disabled verifier", { verification: { outcome: "disabled" } }, "unavailable", 0],
  ["throwing verifier", { verifierThrows: true }, "unavailable", 0],
  ["missing discovery", { discovery: { outcome: "not_found" } }, "rejected", 1],
  ["unavailable discovery", { discovery: unavailable }, "unavailable", 1],
  ["malformed discovery", { discovery: contractViolation }, "unavailable", 1],
  ["throwing discovery", { discoveryThrows: true }, "unavailable", 1],
  ["throwing repository factory", { repositoryThrows: true }, "unavailable", 0],
  ["challenge mismatch", { challenge: { challengeId: grantId } }, "unavailable", 1],
  ["purpose mismatch", { challenge: { purpose: "login" } }, "unavailable", 1],
  ["verifier purpose mismatch", { verification: { outcome: "verified", challengeId, purpose: "login" } }, "unavailable", 1],
  ["stored alias missing", { challenge: { emailPseudonym: "missing:" + "0".repeat(64) } }, "unavailable", 1],
  ["historical key missing", { config: config({ EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_KEYS:
    JSON.stringify({ new: Buffer.alloc(32, 0x22).toString("base64url") }) }) }, "unavailable", 1],
  ["protected email noncanonical", { challenge: { normalizedEmail: "Synthetic@EXAMPLE.invalid" } }, "unavailable", 1]
]) {
  test(`verify-consume ${label} stops before entropy or consumption`, async () => {
    const fixture = serviceFixture(options);
    const result = await fixture.service.verifyAndConsume(fixture.input);
    assertClosedOutcome(result, outcome);
    assert.equal(fixture.counters.verify, 1);
    assert.equal(fixture.counters.verifierFactory, 1);
    assert.equal(fixture.counters.discover, discovers);
    assert.equal(fixture.counters.entropy, 0);
    assert.equal(fixture.counters.enrollment + fixture.counters.login, 0);
  });
}

test("unexpected purpose is rejected before verifier or repository side effects", async () => {
  const fixture = serviceFixture();
  assertClosedOutcome(await fixture.service.verifyAndConsume({ ...fixture.input, purpose: "unexpected" }), "rejected");
  assert.equal(fixture.counters.verify + fixture.counters.repositoryFactory + fixture.counters.entropy, 0);
});

test("verified evidence with malformed request capability cannot reach repository", async () => {
  const fixture = serviceFixture();
  assertClosedOutcome(await fixture.service.verifyAndConsume({ ...fixture.input, requestCapability: "invalid" }), "unavailable");
  assert.equal(fixture.counters.verify, 1);
  assert.equal(fixture.counters.repositoryFactory, 0);
});

for (const [label, keyring] of [
  ["zero aliases", { versions: () => [], get: () => Buffer.alloc(32) }],
  ["oversize aliases", { versions: () => Array.from({ length: 65 }, (_, i) => `k${i}`), get: () => Buffer.alloc(32) }],
  ["missing key material", { versions: () => ["old", "new"], get: () => undefined }]
]) test(`alias reconstruction rejects ${label} without entropy`, async () => {
  const cfg = config();
  const fixture = serviceFixture({ config: { ...cfg, emailPseudonymHmac: { ...cfg.emailPseudonymHmac, keys: keyring } } });
  assertClosedOutcome(await fixture.service.verifyAndConsume(fixture.input), "unavailable");
  assert.equal(fixture.counters.entropy + fixture.counters.enrollment + fixture.counters.login, 0);
});

for (const purpose of ["enrollment", "login"]) {
  test(`${purpose} succeeds only after verify/discover/entropy/one purpose-specific consume`, async () => {
    const fixture = serviceFixture({ purpose });
    const result = await fixture.service.verifyAndConsume(fixture.input);
    assert.equal(result.outcome, "session_issued");
    assert.ok(Object.isFrozen(result));
    assert.deepEqual(Object.keys(result).sort(), ["outcome", "sessionCredential", "administratorId", "installationId",
      "installationGeneration", "createdAt", "expiresAt"].sort());
    assert.deepEqual(fixture.events, ["verifierFactory", "verify", "repositoryFactory", "discover", "entropy", purpose]);
    assert.deepEqual(fixture.counters, { verifierFactory: 1, verify: 1, repositoryFactory: 1,
      discover: 1, entropy: 1, enrollment: purpose === "enrollment" ? 1 : 0,
      login: purpose === "login" ? 1 : 0, authenticate: 0, revoke: 0 });
    assert.deepEqual(Object.keys(fixture.captures.consume).sort(), ["requestTokenHash", "emailPseudonymAliases", "sessionTokenHash"].sort());
    assert.ok(hashCredential(result.sessionCredential).equals(fixture.captures.consume.sessionTokenHash));
    assert.ok(hashEvery8dSettingsRequestCapability(fixture.input.requestCapability).equals(fixture.captures.discovery.requestTokenHash));
    assert.ok(fixture.captures.consume.emailPseudonymAliases.length === 2);
    assert.ok(aliases.every((alias) => fixture.captures.consume.emailPseudonymAliases.includes(alias)));
    assert.equal(result.administratorId, administratorId);
    assert.equal(result.installationId, installationId);
    assert.equal(result.createdAt.toISOString(), "2026-10-22T00:00:00.123Z");
    assert.equal(result.expiresAt.toISOString(), "2026-10-22T01:00:00.123Z");
  });
  for (const [label, options, outcome] of [
    ["zero", { consume: { outcome: "not_consumed" } }, "rejected"],
    ["unavailable", { consume: unavailable }, "unavailable"],
    ["contract violation", { consume: contractViolation }, "unavailable"],
    ["ambiguous throw", { consumeThrows: true }, "unavailable"]
  ]) test(`${purpose} consume ${label} returns no credential and never retries`, async () => {
    const fixture = serviceFixture({ purpose, ...options });
    assertClosedOutcome(await fixture.service.verifyAndConsume(fixture.input), outcome);
    assert.equal(fixture.counters.verify, 1);
    assert.equal(fixture.counters.discover, 1);
    assert.equal(fixture.counters.entropy, 1);
    assert.equal(fixture.counters.enrollment + fixture.counters.login, 1);
  });
}

test("credential is withheld while consume is pending and discarded on unconfirmed persistence", async () => {
  let complete;
  const consumeDeferred = new Promise((resolve) => { complete = resolve; });
  const fixture = serviceFixture({ consumeDeferred });
  let returned = false;
  const pending = fixture.service.verifyAndConsume(fixture.input).then((result) => { returned = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.counters.entropy, 1);
  assert.equal(fixture.counters.enrollment, 1);
  assert.equal(returned, false);
  complete(unavailable);
  assertClosedOutcome(await pending, "unavailable");
});

test("each consume attempt uses a fresh credential even after a failed attempt", async () => {
  const fixture = serviceFixture({ consume: { outcome: "not_consumed" } });
  await fixture.service.verifyAndConsume(fixture.input);
  const firstHash = Buffer.from(fixture.captures.consume.sessionTokenHash);
  await fixture.service.verifyAndConsume(fixture.input);
  assert.ok(!firstHash.equals(fixture.captures.consume.sessionTokenHash));
  assert.equal(fixture.counters.entropy, 2);
  assert.equal(fixture.counters.enrollment, 2);
});

test("email dispatch flag never gates C3c session operations", async () => {
  for (const flag of ["false", "true"]) {
    const fixture = serviceFixture({ config: config({ EVERY8D_SETTINGS_AUTH_EMAIL_DISPATCH_ENABLED: flag }) });
    assert.equal((await fixture.service.verifyAndConsume(fixture.input)).outcome, "session_issued");
    assert.equal((await fixture.service.authenticateSession({ sessionCredential: generateCredential() })).outcome, "authenticated");
    assertClosedOutcome(await fixture.service.revokeSession({ sessionCredential: generateCredential() }), "revoked");
  }
});

for (const method of ["authenticateSession", "revokeSession"]) {
  test(`${method} malformed credentials have zero repository constructions/calls`, async () => {
    const fixture = serviceFixture();
    for (const sessionCredential of [undefined, null, {}, "invalid", "A".repeat(43) + "=", "A".repeat(42) + "B"]) {
      assertClosedOutcome(await fixture.service[method]({ sessionCredential }), "unauthorized");
    }
    assert.equal(fixture.counters.repositoryFactory, 0);
    assert.equal(fixture.counters.authenticate + fixture.counters.revoke, 0);
  });
  for (const [label, result] of [["unavailable", unavailable], ["contract violation", contractViolation], ["throw", null]]) {
    test(`${method} ${label} has no retry and no credential-bearing result`, async () => {
      const options = method === "authenticateSession"
        ? result ? { auth: result } : { authThrows: true }
        : result ? { revoke: result } : { revokeThrows: true };
      const fixture = serviceFixture(options);
      assertClosedOutcome(await fixture.service[method]({ sessionCredential: generateCredential() }), "unavailable");
      assert.equal(fixture.counters.repositoryFactory, 1);
      assert.equal(fixture.counters.authenticate + fixture.counters.revoke, 1);
      assert.equal(fixture.counters.verify + fixture.counters.discover + fixture.counters.entropy, 0);
    });
  }
}

test("authentication returns exact principal without credential, renewal, or touch", async () => {
  const fixture = serviceFixture();
  const sessionCredential = generateCredential();
  const result = await fixture.service.authenticateSession({ sessionCredential });
  assert.equal(result.outcome, "authenticated");
  assert.deepEqual(Object.keys(result).sort(), ["outcome", "principal"]);
  assert.deepEqual(Object.keys(result.principal).sort(), ["administratorId", "installationId", "installationGeneration", "expiresAt"].sort());
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.principal));
  assert.ok(hashCredential(sessionCredential).equals(fixture.captures.authentication.sessionTokenHash));
  assert.equal(fixture.counters.authenticate, 1);
  assert.equal(fixture.counters.revoke + fixture.counters.enrollment + fixture.counters.login, 0);
});

test("valid unknown credential is unauthorized", async () => {
  const fixture = serviceFixture({ auth: { outcome: "unauthorized" } });
  assertClosedOutcome(await fixture.service.authenticateSession({ sessionCredential: generateCredential() }), "unauthorized");
  assert.equal(fixture.counters.authenticate, 1);
});

test("revocation succeeds only on confirmed persisted revoke, passing only decoded-byte hash", async () => {
  const fixture = serviceFixture();
  const sessionCredential = generateCredential();
  assertClosedOutcome(await fixture.service.revokeSession({ sessionCredential }), "revoked");
  assert.equal(fixture.counters.revoke, 1);
  assert.deepEqual(Object.keys(fixture.captures.revocation), ["sessionTokenHash"]);
  assert.ok(hashCredential(sessionCredential).equals(fixture.captures.revocation.sessionTokenHash));
});

test("real C3b verification remains active with HTTP false and is composed exactly once by C3c", async () => {
  const { createEvery8dSettingsAuthRepository } = require("../dist/services/every8dSettingsAuthRepository");
  const cfg = config({ EVERY8D_SETTINGS_AUTH_HTTP_ENABLED: "false" });
  const c3bCalls = [];
  const c3bRepository = createEvery8dSettingsAuthRepository(() => ({ async rpc(name) {
    c3bCalls.push(name);
    const data = name === "runtime_discover_every8d_settings_challenge_v1" ? [{
      challenge_id: challengeId, enrollment_grant_id: grantId, normalized_email: normalizedEmail,
      email_pseudonym: aliases[1], otp_hmac_key_version: "otp"
    }] : true;
    return { data, error: null };
  } }));
  const c3b = createEvery8dSettingsAuthService(cfg, () => c3bRepository);
  const input = serviceFixture().input;
  assert.equal((await c3b.verifyChallenge(input)).outcome, "verified");
  assert.deepEqual(c3bCalls, ["runtime_discover_every8d_settings_challenge_v1", "runtime_verify_every8d_settings_challenge_v1"]);
  c3bCalls.length = 0;
  const c3cCalls = [];
  const c3cRepository = createRepository(() => ({ async rpc(name) {
    c3cCalls.push(name);
    return { data: name === rpcNames[0] ? [discoveryRow()] : [consumeRow()], error: null };
  } }));
  let verifications = 0;
  const service = createService({ ...cfg, httpEnabled: true }, {
    verifierFactory: () => ({ async verifyChallenge(value) { verifications++; return c3b.verifyChallenge(value); } }),
    repositoryFactory: () => c3cRepository
  });
  assert.equal((await service.verifyAndConsume(input)).outcome, "session_issued");
  assert.equal(verifications, 1);
  assert.deepEqual(c3bCalls, ["runtime_discover_every8d_settings_challenge_v1", "runtime_verify_every8d_settings_challenge_v1"]);
  assert.deepEqual(c3cCalls, [rpcNames[0], rpcNames[1]]);
});

test("discovery success metadata is exact, protected, purpose-linked, and frozen", async () => {
  const fake = fakeRepository([discoveryRow()]);
  const result = await fake.repository.discoverVerifiedChallenge(repositoryInput("discoverVerifiedChallenge"));
  assert.equal(result.outcome, "discovered");
  assert.deepEqual(Object.keys(result).sort(), ["challenge", "outcome"]);
  assert.deepEqual(Object.keys(result.challenge).sort(), ["challengeId", "purpose", "enrollmentGrantId", "normalizedEmail", "emailPseudonym"].sort());
  assert.equal(result.challenge.enrollmentGrantId, grantId);
  assert.ok(result.challenge.normalizedEmail === normalizedEmail);
  assert.ok(result.challenge.emailPseudonym === aliases[1]);
  assert.ok(Object.isFrozen(result.challenge));
});

test("repository rejects terminal newlines in all canonical protected fields", async () => {
  for (const key of ["challenge_id", "enrollment_grant_id", "normalized_email", "email_pseudonym"]) {
    const row = discoveryRow();
    row[key] += "\n";
    const fake = fakeRepository([row]);
    assertSafeEqual(await fake.repository.discoverVerifiedChallenge(repositoryInput("discoverVerifiedChallenge")), contractViolation);
  }
  const fake = fakeRepository([consumeRow({ expires_at: "2026-10-22T01:00:00.123456Z\n" })]);
  assertSafeEqual(await fake.repository.consumeLoginChallenge(consumeInput), contractViolation);
  const invalidAlias = fakeRepository([]);
  assertSafeEqual(await invalidAlias.repository.consumeLoginChallenge({ ...consumeInput,
    emailPseudonymAliases: [aliases[0] + "\n"] }), contractViolation);
  assert.equal(invalidAlias.constructions(), 0);
});

test("no session issuance result is released before durable consume success", async () => {
  let complete;
  const consumeDeferred = new Promise((resolve) => { complete = resolve; });
  const fixture = serviceFixture({ consumeDeferred });
  let returned = false;
  const pending = fixture.service.verifyAndConsume(fixture.input).then((result) => { returned = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(returned, false);
  assert.deepEqual(Object.keys(fixture.captures.consume).sort(), ["requestTokenHash", "emailPseudonymAliases", "sessionTokenHash"].sort());
  complete({ outcome: "consumed", session: { administratorId, installationId, installationGeneration: 1,
    createdAt: new Date("2026-10-22T00:00:00Z"), expiresAt: new Date("2026-10-22T01:00:00Z") } });
  const result = await pending;
  assert.equal(result.outcome, "session_issued");
  assert.ok(hashCredential(result.sessionCredential).equals(fixture.captures.consume.sessionTokenHash));
});

test("default C3c factory composes the unchanged real C3b verification service", async () => {
  const c3bModule = require("../dist/services/every8dSettingsAuthService");
  const original = c3bModule.createEvery8dSettingsAuthService;
  let constructions = 0;
  let repositoryConstructions = 0;
  c3bModule.createEvery8dSettingsAuthService = (cfg) => {
    constructions++;
    return original(cfg, () => ({
      async discoverLiveChallenge() { return { outcome: "not_found" }; }
    }));
  };
  try {
    const service = createService(config(), {
      repositoryFactory() { repositoryConstructions++; throw Error(); }
    });
    assertClosedOutcome(await service.verifyAndConsume(serviceFixture().input), "rejected");
    assert.equal(constructions, 1);
    assert.equal(repositoryConstructions, 0);
  } finally { c3bModule.createEvery8dSettingsAuthService = original; }
});
