const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createEvery8dSettingsEmailWorkerRuntime } = require('../../dist/workers/every8dSettingsEmailWorkerRuntime');
const { parseEvery8dSettingsEmailOutboxKeyring } = require('../../dist/config/every8dSettingsEmailOutbox');
const { encryptEvery8dSettingsEmailOutboxPayload } = require('../../dist/services/every8dSettingsEmailOutboxCrypto');
const F = require('./every8dSettingsEmailOutboxFixtures.cjs');
const { deferred, fakeClock } = require('./every8dSettingsEmailFakeProvider.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function environment() {
  const key = n => Buffer.alloc(32, n).toString('base64url');
  return { EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED: 'true', EVERY8D_SETTINGS_AUTH_HTTP_ENABLED: 'true',
    EVERY8D_SETTINGS_AUTH_EMAIL_DISPATCH_ENABLED: 'true', EVERY8D_SETTINGS_AUTH_EMAIL_PROVIDER: 'test-only',
    EVERY8D_SETTINGS_AUTH_EMAIL_FROM: 'settings@example.invalid',
    EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_ACTIVE_KEY_VERSION: 'email', EVERY8D_SETTINGS_EMAIL_PSEUDONYM_HMAC_KEYS: JSON.stringify({email:key(1)}),
    EVERY8D_SETTINGS_OTP_HMAC_ACTIVE_KEY_VERSION: 'otp', EVERY8D_SETTINGS_OTP_HMAC_KEYS: JSON.stringify({otp:key(2)}),
    EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_ACTIVE_KEY_VERSION: 'enc',
    EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_KEYS: JSON.stringify({enc:key(7)}) };
}
function fixture(options = {}) {
  const time = fakeClock(), events = [], telemetry = [], finals = [], providerSignals = [], providerDeadlines = [], scheduledDelays = [];
  const clock = { ...time.clock, schedule(delay, callback) {
    scheduledDelays.push(delay); return time.clock.schedule(delay, callback);
  }};
  const keys = parseEvery8dSettingsEmailOutboxKeyring(JSON.stringify({ enc: Buffer.alloc(32,7).toString('base64url') }));
  const envelope = encryptEvery8dSettingsEmailOutboxPayload(F.context(),
    {recipient:'secret-recipient@example.invalid',displayOtp:'2345-6789'}, {activeKeyVersion:'enc', keys});
  let claimed = false;
  const {repo, calls} = F.repository(async (name,args) => {
    const operation = name.includes('runtime_claim_') ? 'claim' : name.includes('runtime_begin_') ? 'begin' :
      name.includes('runtime_finalize_') ? 'finalize' : name.includes('runtime_recover_') ? 'recover' : 'purge';
    events.push(operation);
    if (operation === 'finalize') finals.push(args);
    const normal = () => {
      if (operation === 'claim') { const rows = claimed || options.empty ? [] : [F.claimRow(envelope)]; claimed = true; return {data:rows,error:null}; }
      if (operation === 'begin') return {data:[F.responses().beginSend],error:null};
      if (operation === 'finalize') {
        const accepted = args.input_provider_outcome === 'accepted';
        return {data:[{...F.responses().finalize, state:accepted?'ACCEPTED':'DELIVERY_OUTCOME_UNKNOWN',
          terminal_disposition:accepted?'accepted':'delivery_outcome_unknown',provider_message_id:args.input_provider_message_id}], error:null};
      }
      return {data: operation === 'purge' ? [{purged_count:0}] : [],error:null};
    };
    return options[operation] ? options[operation](args,normal) : normal();
  });
  const provider = {send(input) {
    events.push('provider'); providerSignals.push(input.signal); providerDeadlines.push(input.deadlineMonotonicNs);
    return options.provider ? options.provider(input) : Promise.resolve({outcome:'accepted',evidence:'authoritative_acceptance',providerMessageId:'synthetic-provider-id'});
  }};
  const runtime = createEvery8dSettingsEmailWorkerRuntime({repository:repo,encryptionKeyring:keys, provider,
    canonicalSender:'settings@example.invalid',clock,random:options.random??(()=>0),telemetry:e=>{telemetry.push(e);options.telemetry?.(e);}});
  return {runtime,time,clock,events,telemetry,finals,calls,providerSignals,providerDeadlines,scheduledDelays,repo,provider,keys,
    async advance(ms) {time.advanceNs(BigInt(ms)*1000000n);await tick();},
    async close() {const p=runtime.stop();await tick();return p;}};
}
module.exports={fixture,environment,tick,deferred,EventEmitter,assert};
