// Explicitly invoked disposable PG17 proof; never part of application startup.
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
const { createEvery8dSettingsEmailOutboxRepository } = require("../../dist/services/every8dSettingsEmailOutboxRepository");
const { createEvery8dSettingsEmailWorker } = require("../../dist/services/every8dSettingsEmailWorker");
const { encryptEvery8dSettingsEmailOutboxPayload } = require("../../dist/services/every8dSettingsEmailOutboxCrypto");
const { parseEvery8dSettingsEmailOutboxKeyring } = require("../../dist/config/every8dSettingsEmailOutbox");
const { fakeProvider, fakeClock } = require("../helpers/every8dSettingsEmailFakeProvider.cjs");
const [container, template] = process.argv.slice(2);
if (!/^(?:c3c4a-[a-z0-9-]+|[0-9a-f]{64})$/.test(container ?? "") || !/^c3c4a_worker_[0-9]+$/.test(template ?? "")) throw new Error("dedicated test container/database required");
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
let database = template;
function sql(statement, role = null, db = database) {
  const args = ["exec", "-i", container, "psql", "-X", "-Atq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-U", "postgres", "-d", db];
  const executable = process.platform === "win32" ? "wsl.exe" : "docker";
  const prefix = process.platform === "win32" ? ["-d", "Ubuntu", "-u", "root", "--", "docker"] : [];
  try {
    return execFileSync(executable, [...prefix, ...args], {
      input: (role ? `set role ${role};` : "") + statement,
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60000
    }).trim();
  } catch { throw new Error("disposable PG17 proof operation failed"); }
}
const rpcNames = new Set(["runtime_enqueue_every8d_settings_auth_email_v1", "runtime_claim_every8d_settings_auth_email_v1",
  "runtime_begin_every8d_settings_auth_email_send_v1", "runtime_finalize_every8d_settings_auth_email_v1"]);
function rpcSql(name, args) {
  assert.ok(rpcNames.has(name), "proof RPC allowlist");
  const small = new Set(["input_envelope_version", "input_payload_version", "input_template_version", "input_attempt_count"]);
  const binary = new Set(["input_request_token_hash", "input_nonce", "input_ciphertext", "input_authentication_tag"]);
  const parameters = Object.entries(args).map(([key, value]) => {
    assert.ok(/^input_[a-z_]+$/.test(key));
    let literal = value === null ? "null" : typeof value === "boolean" || typeof value === "number" ? String(value) : quote(value);
    if (small.has(key)) literal += "::smallint";
    if (binary.has(key)) literal += "::bytea";
    if (key === "input_fence") literal += "::bigint";
    return key + " => " + literal;
  }).join(",");
  return JSON.parse(sql(`select coalesce(json_agg(r),'[]') from public.${name}(${parameters}) r`, "service_role"));
}
(async () => {
  const keys = parseEvery8dSettingsEmailOutboxKeyring(JSON.stringify({ enc: Buffer.alloc(32, 7).toString("base64url") }));
  const cases = ["accepted", "invalid_id", "begin_lost", "begin_late", "stale_fence", "crypto_failure", "finalize_lost", "non_acceptance"];
  let completed = 0;
  for (const scenario of cases) {
    database = template + "_" + completed;
    sql(`create database ${database} template ${template}`, null, "postgres");
    try {
      const time = fakeClock(); let begins = 0, finals = 0;
      const repo = createEvery8dSettingsEmailOutboxRepository({ enabled: true, httpEnabled: true, emailDispatchEnabled: true }, () => ({
        async rpc(name, args) {
          if (name.includes("runtime_begin_")) {
            begins += 1;
            if (scenario === "stale_fence") args = { ...args, input_fence: String(BigInt(args.input_fence) - 1n) };
          }
          if (name.includes("runtime_finalize_")) finals += 1;
          const data = rpcSql(name, args);
          if ((scenario === "begin_lost" && name.includes("runtime_begin_")) ||
            (scenario === "finalize_lost" && name.includes("runtime_finalize_"))) return { data: null, error: {} };
          if (scenario === "begin_late" && name.includes("runtime_begin_")) time.elapseNs(10000000000n);
          return { data, error: null };
        }
      }));
      const fixture = JSON.parse(sql("select json_build_object('challengeId',c3c3_proof.pending(20001),'hash',encode(c3c2a_proof.hash('outbox-request-20001'),'hex'))", "c3a_migration_owner"));
      const context = { jobId: randomUUID(), challengeId: fixture.challengeId, requestTokenHash: Buffer.from(fixture.hash, "hex"),
        purpose: "enrollment", envelopeVersion: 1, payloadVersion: 1, templateVersion: 1 };
      const envelope = encryptEvery8dSettingsEmailOutboxPayload(context,
        { recipient: "outbox-20001@example.invalid", displayOtp: "2345-6789" }, { activeKeyVersion: "enc", keys });
      const enqueued = await repo.enqueue({ ...context, ...envelope });
      assert.ok(enqueued.outcome === "applied", "real enqueue receipt");
      const fake = fakeProvider(scenario === "non_acceptance" ? scenario : scenario === "invalid_id" ? scenario : "accepted", () => {
        // Separate autocommitted session: durable SENDING already visible, no RPC transaction open.
        assert.ok(sql(`select state='SENDING' and attempt_count=1 from public.every8d_settings_auth_email_outbox where job_id=${quote(context.jobId)}`) === "t");
        assert.ok(sql("select count(*)=0 from pg_stat_activity where pid<>pg_backend_pid() and backend_type='client backend' and xact_start is not null") === "t");
      });
      const engine = createEvery8dSettingsEmailWorker({ repository: repo,
        encryptionKeyring: scenario === "crypto_failure" ? parseEvery8dSettingsEmailOutboxKeyring(JSON.stringify({ other: Buffer.alloc(32, 8).toString("base64url") })) : keys,
        sender: { status: "available", canonicalSender: "settings@example.invalid", adapter: fake.adapter }, clock: time.clock });
      const result = await engine.runBatch();
      const row = JSON.parse(sql(`select json_build_object('state',state,'attempts',attempt_count,'scrubbed',ciphertext is null,'retryDelay',extract(epoch from (available_at-resolved_at))) from public.every8d_settings_auth_email_outbox where job_id=${quote(context.jobId)}`));
      const noProvider = ["begin_lost", "begin_late", "stale_fence", "crypto_failure"].includes(scenario);
      assert.ok(fake.stats.calls === (noProvider ? 0 : 1) && finals === (noProvider ? 0 : 1), "one provider and one finalize maximum");
      assert.ok(begins === (scenario === "crypto_failure" ? 0 : 1));
      const expected = ["begin_lost", "begin_late"].includes(scenario) ? "SENDING" :
        ["stale_fence", "crypto_failure"].includes(scenario) ? "LEASED" : scenario === "invalid_id" ? "DELIVERY_OUTCOME_UNKNOWN" :
        scenario === "non_acceptance" ? "RETRY_WAIT" : "ACCEPTED";
      assert.ok(row.state === expected, "truthful durable result");
      if (expected === "ACCEPTED" || expected === "DELIVERY_OUTCOME_UNKNOWN") assert.ok(row.scrubbed);
      if (expected === "RETRY_WAIT") assert.ok(row.retryDelay === 5, "DB alone sets retry timing");
      if (scenario === "finalize_lost") assert.ok(result.diagnostics[0].finalization === "unconfirmed");
      console.log("PASS worker PG17 " + scenario);
      completed += 1;
    } finally { sql(`drop database ${database} with (force)`, null, "postgres"); }
  }
  console.log("PASS worker real-repository scenarios=" + completed);
})().catch(() => { console.error("FAIL worker disposable PG17 proof"); process.exitCode = 1; });
