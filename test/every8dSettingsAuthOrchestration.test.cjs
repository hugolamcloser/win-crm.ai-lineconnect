const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  createEvery8dSettingsAuthRepository
} = require("../dist/services/every8dSettingsAuthRepository.js");
const {
  createEvery8dSettingsAuthService
} = require("../dist/services/every8dSettingsAuthService.js");
const {
  deriveEvery8dSettingsEmailPseudonym,
  deriveEvery8dSettingsOtpHmac,
  generateEvery8dSettingsRequestCapability,
  hashEvery8dSettingsRequestCapability
} = require("../dist/services/every8dSettingsAuthPrimitives.js");

function keyring(entries, observations = []) {
  const values = new Map(entries.map(([version, key]) => [version, Buffer.from(key)]));
  return Object.freeze({
    has(version) {
      observations.push(["has", version]);
      return values.has(version);
    },
    get(version) {
      observations.push(["get", version]);
      const value = values.get(version);
      return value ? Buffer.from(value) : undefined;
    },
    versions() {
      observations.push(["versions"]);
      return [...values.keys()];
    }
  });
}

const emailOldKey = Buffer.alloc(32, 0x11);
const emailActiveKey = Buffer.alloc(32, 0x22);
const otpOldKey = Buffer.alloc(32, 0x33);
const otpActiveKey = Buffer.alloc(32, 0x44);

function enabledConfig({ otpObservations = [], emailObservations = [] } = {}) {
  return Object.freeze({
    enabled: true,
    emailPseudonymHmac: Object.freeze({
      activeKeyVersion: "email-v2",
      keys: keyring([
        ["email-v2", emailActiveKey],
        ["email-v1", emailOldKey]
      ], emailObservations)
    }),
    otpHmac: Object.freeze({
      activeKeyVersion: "otp-v2",
      keys: keyring([
        ["otp-v2", otpActiveKey],
        ["otp-v1", otpOldKey]
      ], otpObservations)
    })
  });
}

const disabledConfig = Object.freeze({
  enabled: false,
  emailPseudonymHmac: null,
  otpHmac: null
});

function failure(category) {
  return Object.freeze({ outcome: "failure", category });
}

function repository(overrides = {}) {
  return {
    async requestEnrollmentChallenge() { return { outcome: "not_prepared" }; },
    async requestLoginChallenge() { return { outcome: "not_prepared" }; },
    async recordChallengeDelivery() { return { outcome: "not_recorded" }; },
    async discoverLiveChallenge() { return { outcome: "not_found" }; },
    async verifyChallenge() { return { outcome: "rejected" }; },
    ...overrides
  };
}

function prepared(input) {
  return {
    outcome: "prepared",
    challenge: {
      challengeId: input.challengeId,
      createdAt: new Date("2026-10-14T01:00:00.000Z"),
      expiresAt: new Date("2026-10-14T01:10:00.000Z")
    }
  };
}

test("disabled service methods have zero input, entropy, and repository side effects", async () => {
  let repositoryConstructions = 0;
  let emailReads = 0;
  const service = createEvery8dSettingsAuthService(disabledConfig, () => {
    repositoryConstructions += 1;
    return repository();
  });
  const enrollmentInput = {
    enrollmentGrantTokenHash: Buffer.alloc(32),
    get email() {
      emailReads += 1;
      throw new Error("must not read");
    }
  };
  const loginInput = {
    get email() {
      emailReads += 1;
      throw new Error("must not read");
    }
  };

  assert.deepEqual(await service.requestEnrollmentChallenge(enrollmentInput), { outcome: "disabled" });
  assert.deepEqual(await service.requestLoginChallenge(loginInput), { outcome: "disabled" });
  assert.deepEqual(await service.recordChallengeDelivery({
    deliveryHandle: { requestTokenHash: Buffer.alloc(32) },
    result: { delivered: true }
  }), { outcome: "disabled" });
  assert.deepEqual(await service.verifyChallenge({
    requestCapability: "not-read",
    purpose: "login",
    otp: "not-read"
  }), { outcome: "disabled" });
  assert.equal(emailReads, 0);
  assert.equal(repositoryConstructions, 0);
});

test("enrollment preparation uses UUIDv4, capability hash, active OTP key, and historical aliases", async () => {
  let captured;
  let calls = 0;
  const service = createEvery8dSettingsAuthService(enabledConfig(), () => repository({
    async requestEnrollmentChallenge(input) {
      calls += 1;
      captured = input;
      return prepared(input);
    }
  }));

  const result = await service.requestEnrollmentChallenge({
    enrollmentGrantTokenHash: Buffer.alloc(32, 0x55),
    email: "Admin@EXAMPLE.com"
  });
  assert.equal(result.outcome, "accepted");
  assert.ok(result.deliveryCommand);
  assert.equal(calls, 1);
  assert.match(captured.challengeId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(
    captured.requestTokenHash,
    hashEvery8dSettingsRequestCapability(result.deliveryCommand.requestCapability)
  );
  assert.equal(captured.otpHmacKeyVersion, "otp-v2");
  assert.deepEqual(captured.otpHmac, deriveEvery8dSettingsOtpHmac({
    purpose: "enrollment",
    challengeId: captured.challengeId,
    otp: result.deliveryCommand.deliveryRequest.displayOtp,
    keyVersion: "otp-v2",
    keyring: enabledConfig().otpHmac.keys
  }));
  const expectedAliases = ["email-v1", "email-v2"].map((keyVersion) =>
    deriveEvery8dSettingsEmailPseudonym({
      normalizedEmail: "Admin@example.com",
      keyVersion,
      keyring: enabledConfig().emailPseudonymHmac.keys
    }));
  assert.deepEqual(captured.emailPseudonymAliases, expectedAliases);
  assert.equal(captured.emailPseudonym, expectedAliases[1]);
  assert.equal(result.deliveryCommand.deliveryRequest.recipient, "Admin@example.com");
  assert.equal(result.deliveryCommand.purpose, "enrollment");
  assert.notStrictEqual(
    result.deliveryCommand.deliveryHandle.requestTokenHash,
    captured.requestTokenHash
  );
});

test("login prepared and all request negatives remain accepted and non-enumerating", async () => {
  const outcomes = [
    { outcome: "not_prepared" },
    failure("repository_unavailable"),
    failure("repository_contract_violation")
  ];
  for (const repositoryResult of outcomes) {
    let calls = 0;
    const service = createEvery8dSettingsAuthService(enabledConfig(), () => repository({
      async requestLoginChallenge() {
        calls += 1;
        return repositoryResult;
      }
    }));
    assert.deepEqual(await service.requestLoginChallenge({ email: "user@example.com" }), {
      outcome: "accepted",
      deliveryCommand: null
    });
    assert.equal(calls, 1);
  }

  let preparedCalls = 0;
  const preparedService = createEvery8dSettingsAuthService(enabledConfig(), () => repository({
    async requestLoginChallenge(input) {
      preparedCalls += 1;
      return prepared(input);
    }
  }));
  const preparedResult = await preparedService.requestLoginChallenge({ email: "user@example.com" });
  assert.equal(preparedResult.outcome, "accepted");
  assert.ok(preparedResult.deliveryCommand);
  assert.equal(preparedResult.deliveryCommand.purpose, "login");
  assert.equal(preparedCalls, 1);

  let invalidGrantCalls = 0;
  const invalidGrantService = createEvery8dSettingsAuthService(enabledConfig(), () => {
    invalidGrantCalls += 1;
    return repository();
  });
  assert.deepEqual(await invalidGrantService.requestEnrollmentChallenge({
    enrollmentGrantTokenHash: Buffer.alloc(3),
    email: "user@example.com"
  }), { outcome: "accepted", deliveryCommand: null });
  assert.equal(invalidGrantCalls, 0);
});

test("request orchestration performs no automatic retry after repository failure", async () => {
  let calls = 0;
  const service = createEvery8dSettingsAuthService(enabledConfig(), () => repository({
    async requestLoginChallenge() {
      calls += 1;
      return failure("repository_unavailable");
    }
  }));
  assert.deepEqual(await service.requestLoginChallenge({ email: "user@example.com" }), {
    outcome: "accepted",
    deliveryCommand: null
  });
  assert.equal(calls, 1);
});

test("verification uses only the exact stored OTP key and complete historical aliases", async () => {
  const otpObservations = [];
  let verifyInput;
  let discoveryCalls = 0;
  let verifyCalls = 0;
  const config = enabledConfig({ otpObservations });
  const capability = Buffer.alloc(32, 0x66).toString("base64url");
  const challengeId = "12345678-1234-4abc-8abc-1234567890ab";
  const normalizedEmail = "Verify@example.com";
  const storedPseudonym = deriveEvery8dSettingsEmailPseudonym({
    normalizedEmail,
    keyVersion: "email-v1",
    keyring: config.emailPseudonymHmac.keys
  });
  const service = createEvery8dSettingsAuthService(config, () => repository({
    async discoverLiveChallenge() {
      discoveryCalls += 1;
      return {
        outcome: "discovered",
        challenge: {
          challengeId,
          enrollmentGrantId: null,
          normalizedEmail,
          emailPseudonym: storedPseudonym,
          otpHmacKeyVersion: "otp-v1"
        }
      };
    },
    async verifyChallenge(input) {
      verifyCalls += 1;
      verifyInput = input;
      return { outcome: "verified" };
    }
  }));

  assert.deepEqual(await service.verifyChallenge({
    requestCapability: capability,
    purpose: "login",
    otp: "0123-4567"
  }), { outcome: "verified", challengeId, purpose: "login" });
  assert.equal(discoveryCalls, 1);
  assert.equal(verifyCalls, 1);
  assert.deepEqual(otpObservations, [["has", "otp-v1"], ["get", "otp-v1"]]);
  assert.deepEqual(verifyInput.candidateOtpHmac, deriveEvery8dSettingsOtpHmac({
    purpose: "login",
    challengeId,
    otp: "01234567",
    keyVersion: "otp-v1",
    keyring: keyring([["otp-v1", otpOldKey]])
  }));
  assert.equal(verifyInput.emailPseudonymAliases.length, 2);
  assert.ok(verifyInput.emailPseudonymAliases.includes(storedPseudonym));
});

test("missing stored OTP key fails unavailable without try-all or verification", async () => {
  const otpObservations = [];
  let verifyCalls = 0;
  const service = createEvery8dSettingsAuthService(
    enabledConfig({ otpObservations }),
    () => repository({
      async discoverLiveChallenge() {
        return {
          outcome: "discovered",
          challenge: {
            challengeId: "12345678-1234-4abc-8abc-1234567890ab",
            enrollmentGrantId: null,
            normalizedEmail: "user@example.com",
            emailPseudonym: "email-v1:" + "0".repeat(64),
            otpHmacKeyVersion: "removed-key"
          }
        };
      },
      async verifyChallenge() {
        verifyCalls += 1;
        return { outcome: "verified" };
      }
    })
  );
  assert.deepEqual(await service.verifyChallenge({
    requestCapability: Buffer.alloc(32, 0x67).toString("base64url"),
    purpose: "login",
    otp: "01234567"
  }), { outcome: "unavailable" });
  assert.deepEqual(otpObservations, [["has", "removed-key"]]);
  assert.equal(verifyCalls, 0);
});

test("discovery and verification outcomes map exhaustively without retry", async () => {
  const capability = Buffer.alloc(32, 0x68).toString("base64url");
  for (const [discoveryResult, expected] of [
    [{ outcome: "not_found" }, "rejected"],
    [failure("repository_unavailable"), "unavailable"],
    [failure("repository_contract_violation"), "unavailable"]
  ]) {
    let discoveryCalls = 0;
    let verifyCalls = 0;
    const service = createEvery8dSettingsAuthService(enabledConfig(), () => repository({
      async discoverLiveChallenge() { discoveryCalls += 1; return discoveryResult; },
      async verifyChallenge() { verifyCalls += 1; return { outcome: "verified" }; }
    }));
    assert.equal((await service.verifyChallenge({
      requestCapability: capability,
      purpose: "login",
      otp: "01234567"
    })).outcome, expected);
    assert.equal(discoveryCalls, 1);
    assert.equal(verifyCalls, 0);
  }

  for (const [verificationResult, expected] of [
    [{ outcome: "verified" }, "verified"],
    [{ outcome: "rejected" }, "rejected"],
    [failure("repository_unavailable"), "unavailable"],
    [failure("repository_contract_violation"), "unavailable"]
  ]) {
    let verifyCalls = 0;
    const config = enabledConfig();
    const normalizedEmail = "user@example.com";
    const pseudonym = deriveEvery8dSettingsEmailPseudonym({
      normalizedEmail,
      keyVersion: "email-v2",
      keyring: config.emailPseudonymHmac.keys
    });
    const service = createEvery8dSettingsAuthService(config, () => repository({
      async discoverLiveChallenge() {
        return {
          outcome: "discovered",
          challenge: {
            challengeId: "12345678-1234-4abc-8abc-1234567890ab",
            enrollmentGrantId: null,
            normalizedEmail,
            emailPseudonym: pseudonym,
            otpHmacKeyVersion: "otp-v2"
          }
        };
      },
      async verifyChallenge() { verifyCalls += 1; return verificationResult; }
    }));
    assert.equal((await service.verifyChallenge({
      requestCapability: capability,
      purpose: "login",
      otp: "01234567"
    })).outcome, expected);
    assert.equal(verifyCalls, 1);
  }
});

test("malformed verification inputs reject before repository discovery", async () => {
  let constructions = 0;
  const service = createEvery8dSettingsAuthService(enabledConfig(), () => {
    constructions += 1;
    return repository();
  });

  assert.deepEqual(await service.verifyChallenge({
    requestCapability: "invalid",
    purpose: "login",
    otp: "123456"
  }), { outcome: "rejected" });
  assert.deepEqual(await service.verifyChallenge({
    requestCapability: generateEvery8dSettingsRequestCapability(),
    purpose: "login",
    otp: "not-an-otp"
  }), { outcome: "rejected" });
  assert.deepEqual(await service.verifyChallenge({
    requestCapability: generateEvery8dSettingsRequestCapability(),
    purpose: "unexpected",
    otp: "123456"
  }), { outcome: "rejected" });
  assert.equal(constructions, 0);
});

test("delivery maps true, false, and both repository failures without retry", async () => {
  for (const [repositoryResult, expected] of [
    [{ outcome: "recorded" }, "recorded"],
    [{ outcome: "not_recorded" }, "not_recorded"],
    [failure("repository_unavailable"), "unavailable"],
    [failure("repository_contract_violation"), "unavailable"]
  ]) {
    let calls = 0;
    const service = createEvery8dSettingsAuthService(enabledConfig(), () => repository({
      async recordChallengeDelivery() { calls += 1; return repositoryResult; }
    }));
    assert.equal((await service.recordChallengeDelivery({
      deliveryHandle: { requestTokenHash: Buffer.alloc(32, 0x69) },
      result: { delivered: false, failureClass: "provider_rejected" }
    })).outcome, expected);
    assert.equal(calls, 1);
  }
});

test("repository calls exact RPC names and canonical lowercase bytea parameters", async () => {
  const calls = [];
  const client = {
    async rpc(name, input) {
      calls.push({ name, input });
      if (name.includes("request_")) return {
        data: [{
          challenge_id: input.input_challenge_id,
          created_at: "2026-10-14T01:00:00.000+00:00",
          expires_at: "2026-10-14T01:10:00.000+00:00"
        }],
        error: null
      };
      if (name.includes("discover_")) return { data: [], error: null };
      return { data: true, error: null };
    }
  };
  const authRepository = createEvery8dSettingsAuthRepository(() => client);
  assert.deepEqual(Object.keys(authRepository).sort(), [
    "discoverLiveChallenge", "recordChallengeDelivery", "requestEnrollmentChallenge",
    "requestLoginChallenge", "verifyChallenge"
  ]);
  const shared = {
    challengeId: "12345678-1234-4abc-8abc-1234567890ab",
    normalizedEmail: "Admin@example.com",
    emailPseudonym: "k1:" + "a".repeat(64),
    emailPseudonymAliases: ["k1:" + "a".repeat(64)],
    requestTokenHash: Buffer.alloc(32, 0xab),
    otpHmac: Buffer.alloc(32, 0xcd),
    otpHmacKeyVersion: "otp-v1"
  };
  assert.equal((await authRepository.requestEnrollmentChallenge({
    enrollmentGrantTokenHash: Buffer.alloc(32, 0xef), ...shared
  })).outcome, "prepared");
  assert.equal((await authRepository.requestLoginChallenge(shared)).outcome, "prepared");
  assert.equal((await authRepository.recordChallengeDelivery({
    requestTokenHash: Buffer.alloc(32, 1), succeeded: true, failureClass: null
  })).outcome, "recorded");
  assert.equal((await authRepository.discoverLiveChallenge({
    requestTokenHash: Buffer.alloc(32, 2), purpose: "login"
  })).outcome, "not_found");
  assert.equal((await authRepository.verifyChallenge({
    requestTokenHash: Buffer.alloc(32, 3), purpose: "login",
    emailPseudonymAliases: shared.emailPseudonymAliases,
    candidateOtpHmac: Buffer.alloc(32, 4)
  })).outcome, "verified");

  assert.deepEqual(calls.map((call) => call.name), [
    "runtime_request_every8d_settings_enrollment_challenge_v1",
    "runtime_request_every8d_settings_login_challenge_v1",
    "runtime_record_every8d_settings_challenge_delivery_v1",
    "runtime_discover_every8d_settings_challenge_v1",
    "runtime_verify_every8d_settings_challenge_v1"
  ]);
  for (const call of calls) {
    for (const [key, value] of Object.entries(call.input)) {
      if (key.includes("hash") || key.includes("hmac")) {
        if (key.endsWith("key_version")) continue;
        assert.match(value, /^\\x[0-9a-f]{64}$/);
      }
    }
  }
});

test("repository validates successful payloads strictly with a closed two-category taxonomy", async () => {
  const baseInput = {
    challengeId: "12345678-1234-4abc-8abc-1234567890ab",
    normalizedEmail: "user@example.com",
    emailPseudonym: "k1:" + "a".repeat(64),
    emailPseudonymAliases: ["k1:" + "a".repeat(64)],
    requestTokenHash: Buffer.alloc(32),
    otpHmac: Buffer.alloc(32),
    otpHmacKeyVersion: "otp-v1"
  };
  const malformedPayloads = [
    null,
    {},
    [{ challenge_id: baseInput.challengeId }],
    [{
      challenge_id: baseInput.challengeId,
      created_at: "2026-10-14T01:00:00.000+00:00",
      expires_at: "2026-10-14T01:10:00.000+00:00",
      extra: true
    }],
    [{
      challenge_id: baseInput.challengeId,
      created_at: "2026-10-14T01:00:00.000+00:00",
      expires_at: "2026-10-14T01:10:00.000+00:00"
    }, {
      challenge_id: baseInput.challengeId,
      created_at: "2026-10-14T01:00:00.000+00:00",
      expires_at: "2026-10-14T01:10:00.000+00:00"
    }]
  ];
  for (const data of malformedPayloads) {
    const authRepository = createEvery8dSettingsAuthRepository(() => ({
      async rpc() { return { data, error: null }; }
    }));
    assert.deepEqual(await authRepository.requestLoginChallenge(baseInput),
      failure("repository_contract_violation"));
  }

  const categories = new Set();
  const unavailableRepository = createEvery8dSettingsAuthRepository(() => ({
    async rpc() { return { data: null, error: { message: "secret-db-message", code: "XX000" } }; }
  }));
  const unavailableResult = await unavailableRepository.requestLoginChallenge(baseInput);
  categories.add(unavailableResult.category);
  assert.deepEqual(unavailableResult, failure("repository_unavailable"));
  assert.doesNotMatch(JSON.stringify(unavailableResult), /secret-db-message|XX000/);

  const thrownRepository = createEvery8dSettingsAuthRepository(() => ({
    async rpc() { throw new Error("raw transport secret"); }
  }));
  const thrownResult = await thrownRepository.requestLoginChallenge(baseInput);
  categories.add(thrownResult.category);
  assert.deepEqual(thrownResult, failure("repository_unavailable"));
  assert.doesNotMatch(JSON.stringify(thrownResult), /raw transport secret/);
  categories.add("repository_contract_violation");
  assert.deepEqual([...categories].sort(), [
    "repository_contract_violation", "repository_unavailable"
  ]);
});

test("repository validates the complete five-method response matrix", async () => {
  const challengeId = "12345678-1234-4abc-8abc-1234567890ab";
  const grantId = "22345678-1234-4abc-8abc-1234567890ab";
  const alias = "k1:" + "a".repeat(64);
  const requestInput = {
    challengeId,
    normalizedEmail: "user@example.com",
    emailPseudonym: alias,
    emailPseudonymAliases: [alias],
    requestTokenHash: Buffer.alloc(32, 1),
    otpHmac: Buffer.alloc(32, 2),
    otpHmacKeyVersion: "otp-v1"
  };
  const enrollmentInput = {
    enrollmentGrantTokenHash: Buffer.alloc(32, 3),
    ...requestInput
  };
  const deliveryInput = {
    requestTokenHash: Buffer.alloc(32, 4),
    succeeded: true,
    failureClass: null
  };
  const discoveryInput = {
    requestTokenHash: Buffer.alloc(32, 5),
    purpose: "login"
  };
  const verifyInput = {
    requestTokenHash: Buffer.alloc(32, 6),
    purpose: "login",
    emailPseudonymAliases: [alias],
    candidateOtpHmac: Buffer.alloc(32, 7)
  };
  const creationRow = {
    challenge_id: challengeId,
    created_at: "2028-02-29T01:00:00.123+14:30",
    expires_at: "2028-02-29T01:10:00.123+14:30"
  };
  const loginDiscoveryRow = {
    challenge_id: challengeId,
    enrollment_grant_id: null,
    normalized_email: "user@example.com",
    email_pseudonym: alias,
    otp_hmac_key_version: "otp-v1"
  };
  const enrollmentDiscoveryRow = {
    ...loginDiscoveryRow,
    enrollment_grant_id: grantId
  };
  const withResponse = (data, error = null) => createEvery8dSettingsAuthRepository(() => ({
    async rpc() {
      return { data, error, count: null, status: 200, statusText: "OK" };
    }
  }));

  assert.equal((await withResponse([creationRow]).requestEnrollmentChallenge(
    enrollmentInput
  )).outcome, "prepared");
  assert.equal((await withResponse([creationRow]).requestLoginChallenge(
    requestInput
  )).outcome, "prepared");
  assert.equal((await withResponse(true).recordChallengeDelivery(deliveryInput)).outcome,
    "recorded");
  assert.equal((await withResponse(false).recordChallengeDelivery(deliveryInput)).outcome,
    "not_recorded");
  assert.equal((await withResponse([loginDiscoveryRow]).discoverLiveChallenge(
    discoveryInput
  )).outcome, "discovered");
  assert.equal((await withResponse([enrollmentDiscoveryRow]).discoverLiveChallenge({
    ...discoveryInput,
    purpose: "enrollment"
  })).outcome, "discovered");
  assert.equal((await withResponse(true).verifyChallenge(verifyInput)).outcome, "verified");
  assert.equal((await withResponse(false).verifyChallenge(verifyInput)).outcome, "rejected");

  for (const invalidTimestamp of [
    "2026-02-29T01:00:00Z",
    "2028-02-30T01:00:00Z",
    "2026-13-01T01:00:00Z",
    "2026-10-14T24:00:00Z",
    "2026-10-14T01:00:00+24:00",
    "2026-10-14T01:00:00+00:60"
  ]) {
    assert.deepEqual(await withResponse([{
      ...creationRow,
      created_at: invalidTimestamp
    }]).requestLoginChallenge(requestInput), failure("repository_contract_violation"));
  }

  for (const malformed of [null, {}, [creationRow, creationRow], [{
    ...creationRow,
    challenge_id: grantId
  }], [{
    ...creationRow,
    expires_at: creationRow.created_at
  }]]) {
    assert.deepEqual(await withResponse(malformed).requestEnrollmentChallenge(enrollmentInput),
      failure("repository_contract_violation"));
    assert.deepEqual(await withResponse(malformed).requestLoginChallenge(requestInput),
      failure("repository_contract_violation"));
  }

  for (const malformed of [null, 0, "true", {}, []]) {
    assert.deepEqual(await withResponse(malformed).recordChallengeDelivery(deliveryInput),
      failure("repository_contract_violation"));
    assert.deepEqual(await withResponse(malformed).verifyChallenge(verifyInput),
      failure("repository_contract_violation"));
  }

  for (const malformed of [null, {}, [loginDiscoveryRow, loginDiscoveryRow], [{
    ...loginDiscoveryRow,
    extra: true
  }], [{
    ...loginDiscoveryRow,
    normalized_email: " user@example.com"
  }]]) {
    assert.deepEqual(await withResponse(malformed).discoverLiveChallenge(discoveryInput),
      failure("repository_contract_violation"));
  }
  assert.deepEqual(await withResponse([enrollmentDiscoveryRow]).discoverLiveChallenge(
    discoveryInput
  ), failure("repository_contract_violation"));
  assert.deepEqual(await withResponse([loginDiscoveryRow]).discoverLiveChallenge({
    ...discoveryInput,
    purpose: "enrollment"
  }), failure("repository_contract_violation"));

  const rawError = { message: "sensitive database message", code: "XX000" };
  for (const invoke of [
    (value) => value.requestEnrollmentChallenge(enrollmentInput),
    (value) => value.requestLoginChallenge(requestInput),
    (value) => value.recordChallengeDelivery(deliveryInput),
    (value) => value.discoverLiveChallenge(discoveryInput),
    (value) => value.verifyChallenge(verifyInput)
  ]) {
    const result = await invoke(withResponse(null, rawError));
    assert.deepEqual(result, failure("repository_unavailable"));
    assert.doesNotMatch(JSON.stringify(result), /sensitive database message|XX000/);
  }
});

test("repository request methods enforce complete row and PostgreSQL timestamp contracts", async () => {
  const challengeId = "12345678-1234-4abc-8abc-1234567890ab";
  const alias = "k1:" + "a".repeat(64);
  const requestInput = {
    challengeId,
    normalizedEmail: "user@example.com",
    emailPseudonym: alias,
    emailPseudonymAliases: [alias],
    requestTokenHash: Buffer.alloc(32, 1),
    otpHmac: Buffer.alloc(32, 2),
    otpHmacKeyVersion: "otp-v1"
  };
  const enrollmentInput = {
    enrollmentGrantTokenHash: Buffer.alloc(32, 3),
    ...requestInput
  };
  const validRow = {
    challenge_id: challengeId,
    created_at: "2028-02-29T01:00:00.123Z",
    expires_at: "2028-02-29T01:10:00.123Z"
  };
  const repositoryFor = (data, error = null) => createEvery8dSettingsAuthRepository(() => ({
    async rpc() {
      return { data, error, count: 1, status: 200, statusText: "OK" };
    }
  }));
  const methods = [
    ["enrollment", (repo) => repo.requestEnrollmentChallenge(enrollmentInput)],
    ["login", (repo) => repo.requestLoginChallenge(requestInput)]
  ];

  for (const [label, invoke] of methods) {
    assert.equal((await invoke(repositoryFor([validRow]))).outcome, "prepared", label);
    assert.deepEqual(await invoke(repositoryFor([])), { outcome: "not_prepared" }, label);

    for (const data of [
      [validRow, validRow],
      [{ created_at: validRow.created_at, expires_at: validRow.expires_at }],
      [{ challenge_id: challengeId, expires_at: validRow.expires_at }],
      [{ challenge_id: challengeId, created_at: validRow.created_at }],
      [{ ...validRow, challenge_id: 7 }],
      [{ ...validRow, challenge_id: "22345678-1234-4abc-8abc-1234567890ab" }],
      [{ ...validRow, created_at: 1 }],
      [{ ...validRow, expires_at: {} }],
      [{ ...validRow, created_at: "2026-02-29T01:00:00Z" }],
      [{ ...validRow, created_at: "2028-02-30T01:00:00Z" }],
      [{ ...validRow, created_at: "2028-13-01T01:00:00Z" }],
      [{ ...validRow, created_at: "2028-02-29T24:00:00Z" }],
      [{ ...validRow, created_at: "2028-02-29T01:00:00+16:00" }],
      [{ ...validRow, created_at: "2028-02-29T01:00:00-16:00" }],
      [{ ...validRow, created_at: "2028-02-29T01:00:00+23:59" }],
      [{ ...validRow, created_at: "2028-02-29T01:00:00-23:59" }]
    ]) {
      assert.deepEqual(await invoke(repositoryFor(data)),
        failure("repository_contract_violation"), label);
    }

    for (const offset of ["+00:00", "+08:00", "-05:30", "+15:59", "-15:59"]) {
      const row = {
        ...validRow,
        created_at: `2028-02-29T01:00:00.123${offset}`,
        expires_at: `2028-02-29T01:10:00.123${offset}`
      };
      assert.equal((await invoke(repositoryFor([row]))).outcome, "prepared", `${label} ${offset}`);
    }
  }
});

test("repository methods have complete success, malformed, transport, and redaction matrices", async () => {
  const challengeId = "12345678-1234-4abc-8abc-1234567890ab";
  const grantId = "22345678-1234-4abc-8abc-1234567890ab";
  const alias = "k1:" + "a".repeat(64);
  const requestInput = {
    challengeId,
    normalizedEmail: "user@example.com",
    emailPseudonym: alias,
    emailPseudonymAliases: [alias],
    requestTokenHash: Buffer.alloc(32, 1),
    otpHmac: Buffer.alloc(32, 2),
    otpHmacKeyVersion: "otp-v1"
  };
  const enrollmentInput = {
    enrollmentGrantTokenHash: Buffer.alloc(32, 3),
    ...requestInput
  };
  const deliveryInput = {
    requestTokenHash: Buffer.alloc(32, 4),
    succeeded: true,
    failureClass: null
  };
  const discoveryInput = {
    requestTokenHash: Buffer.alloc(32, 5),
    purpose: "login"
  };
  const verifyInput = {
    requestTokenHash: Buffer.alloc(32, 6),
    purpose: "login",
    emailPseudonymAliases: [alias],
    candidateOtpHmac: Buffer.alloc(32, 7)
  };
  const creationRow = {
    challenge_id: challengeId,
    created_at: "2028-02-29T01:00:00Z",
    expires_at: "2028-02-29T01:10:00Z"
  };
  const discoveryRow = {
    challenge_id: challengeId,
    enrollment_grant_id: null,
    normalized_email: "user@example.com",
    email_pseudonym: alias,
    otp_hmac_key_version: "otp-v1"
  };
  const invoke = [
    ["enrollment", (repo) => repo.requestEnrollmentChallenge(enrollmentInput)],
    ["login", (repo) => repo.requestLoginChallenge(requestInput)],
    ["delivery", (repo) => repo.recordChallengeDelivery(deliveryInput)],
    ["discovery", (repo) => repo.discoverLiveChallenge(discoveryInput)],
    ["verify", (repo) => repo.verifyChallenge(verifyInput)]
  ];
  const successPayloads = new Map([
    ["enrollment", [creationRow]],
    ["login", [creationRow]],
    ["delivery", true],
    ["discovery", [discoveryRow]],
    ["verify", true]
  ]);
  const repositoryFor = (data, error = null) => createEvery8dSettingsAuthRepository(() => ({
    async rpc() {
      return { data, error, count: 1, status: 200, statusText: "OK" };
    }
  }));
  const forbidden = /message|stack|name|code|sqlstate|details|hint|cause|sensitive|rpc|input_/i;
  const assertSafeFailure = (result, category, label) => {
    assert.deepEqual(result, failure(category), label);
    assert.deepEqual(Object.keys(result).sort(), ["category", "outcome"], label);
    assert.doesNotMatch(JSON.stringify(result), forbidden, label);
  };

  for (const [label, call] of invoke) {
    const result = await call(repositoryFor(successPayloads.get(label)));
    assert.notEqual(result.outcome, "failure", `${label} metadata-bearing success`);

    const rpcError = {
      message: "sensitive database message",
      stack: "sensitive stack",
      name: "PostgrestError",
      code: "XX000",
      SQLSTATE: "XX000",
      details: "sensitive details",
      hint: "sensitive hint",
      cause: { message: "nested sensitive cause", code: "P0001" },
      rpcArguments: { input_request_token_hash: "sensitive argument" }
    };
    assertSafeFailure(await call(repositoryFor(null, rpcError)),
      "repository_unavailable", `${label} RPC error`);

    const rejected = createEvery8dSettingsAuthRepository(() => ({
      rpc() {
        return Promise.reject(Object.assign(new Error("sensitive transport message"), {
          code: "ECONNRESET",
          SQLSTATE: "08006",
          details: "sensitive transport details",
          hint: "sensitive transport hint",
          cause: { cause: { message: "deep nested sensitive cause" } },
          rpcArguments: { input_otp_hmac: "sensitive argument" }
        }));
      }
    }));
    assertSafeFailure(await call(rejected), "repository_unavailable",
      `${label} rejected Promise`);
  }

  for (const malformed of [null, "true", 1, {}, [], [true]]) {
    assertSafeFailure(await repositoryFor(malformed).recordChallengeDelivery(deliveryInput),
      "repository_contract_violation", "delivery malformed scalar");
    assertSafeFailure(await repositoryFor(malformed).verifyChallenge(verifyInput),
      "repository_contract_violation", "verify malformed scalar");
  }
  assert.equal((await repositoryFor(false).recordChallengeDelivery(deliveryInput)).outcome,
    "not_recorded");
  assert.equal((await repositoryFor(false).verifyChallenge(verifyInput)).outcome, "rejected");

  const discoveryMalformed = [
    null,
    {},
    [discoveryRow, discoveryRow],
    [{ ...discoveryRow, challenge_id: "not-a-uuid" }],
    [{ ...discoveryRow, enrollment_grant_id: grantId }],
    [{ ...discoveryRow, normalized_email: " USER@example.com" }],
    [{ ...discoveryRow, email_pseudonym: "invalid" }],
    [{ ...discoveryRow, otp_hmac_key_version: "bad version" }],
    [{ challenge_id: challengeId }],
    [{ ...discoveryRow, normalized_email: 7 }],
    [{ ...discoveryRow, otp_hmac_key_version: 7 }]
  ];
  for (const malformed of discoveryMalformed) {
    assertSafeFailure(await repositoryFor(malformed).discoverLiveChallenge(discoveryInput),
      "repository_contract_violation", "discovery malformed row");
  }
  assert.equal((await repositoryFor([]).discoverLiveChallenge(discoveryInput)).outcome,
    "not_found");
  assert.equal((await repositoryFor([discoveryRow]).discoverLiveChallenge(discoveryInput)).outcome,
    "discovered");
  assert.equal((await repositoryFor([{ ...discoveryRow, enrollment_grant_id: grantId }])
    .discoverLiveChallenge({ ...discoveryInput, purpose: "enrollment" })).outcome, "discovered");
  assertSafeFailure(await repositoryFor([{
    ...discoveryRow,
    enrollment_grant_id: "not-a-uuid"
  }]).discoverLiveChallenge({ ...discoveryInput, purpose: "enrollment" }),
  "repository_contract_violation", "invalid enrollment grant UUID");

  assertSafeFailure(await repositoryFor([{
    ...creationRow,
    message: "sensitive successful payload message",
    cause: { SQLSTATE: "XX000", details: "sensitive nested successful payload" },
    input_request_token_hash: "sensitive RPC argument"
  }]).requestLoginChallenge(requestInput), "repository_contract_violation",
  "malformed successful payload redaction");

  const malformedEnvelope = createEvery8dSettingsAuthRepository(() => ({
    async rpc() {
      return { data: successPayloads.get("login") };
    }
  }));
  assertSafeFailure(await malformedEnvelope.requestLoginChallenge(requestInput),
    "repository_contract_violation", "missing response error field");
});

test("repository and service never log raw RPC errors or secret inputs", async () => {
  const originalError = console.error;
  const originalWarn = console.warn;
  const observed = [];
  console.error = (...values) => observed.push(values);
  console.warn = (...values) => observed.push(values);
  try {
    const secret = Buffer.alloc(32, 0x77).toString("base64url");
    const service = createEvery8dSettingsAuthService(enabledConfig(), () => repository({
      async discoverLiveChallenge() {
        throw new Error(`raw SQLSTATE XX000 ${secret}`);
      }
    }));
    assert.deepEqual(await service.verifyChallenge({
      requestCapability: secret,
      purpose: "login",
      otp: "01234567"
    }), { outcome: "unavailable" });
    assert.deepEqual(observed, []);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
});
