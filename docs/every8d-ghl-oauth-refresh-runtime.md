# EVERY8D Connect HighLevel OAuth refresh runtime (C1b)

## Scope and safety boundary

C1b provides background-only HighLevel OAuth credential refresh for the one
configured EVERY8D Connect Location installation. It does not add request-time
refresh, a provider-runtime credential resolver, provider activation, EVERY8D
API access, SMS, SafeSay, or LINE behavior. It adds no database migration and
uses the C1a claim/finalize/fail RPCs without a weaker wrapper.

The runtime is gated by both immutable process flags:

- `EVERY8D_GHL_OAUTH_ENABLED=true`
- `EVERY8D_GHL_OAUTH_REFRESH_ENABLED=true`

The refresh flag defaults to `false`. When it is false, startup creates no
refresh timer and performs no refresh candidate query, RPC, decryption,
randomness, or HighLevel request. Configuration changes require a process
restart or redeploy.

## Background state machine

The service first probes for an expired `refreshing` lease belonging to the
exact configured app, client, provider, version, and Location. The probe is
ciphertext-free. It calls the normal C1a claim RPC with the complete immutable
installation identity and never contacts HighLevel from this recovery path.
The RPC atomically burns an ambiguous expired lease to `reauth_required` with
`refresh_outcome_unknown` and scrubs both credentials. A later minimal read is
observability only.

After stale-lease recovery, the service selects at most one ordinary candidate:

- namespace `every8d_connect`, channel `sms`, provider `every8d`;
- exact configured Marketplace app, OAuth client, Conversation Provider,
  Marketplace version, and expected Location;
- latest lifecycle `INSTALL`, with status `pending` or `active`;
- present company identity, positive credential revision, and state `usable`;
- expiry at or before the process clock plus five minutes;
- ordered by expiry and then installation ID.

The selection does not return token ciphertext. Before claim, the stored scope
set must exactly equal the configured scope set and the stored encryption key
version must exist locally. The process-clock cutoff is only an optimization;
`claim_every8d_ghl_oauth_refresh_v1` is the authoritative due/winner decision.
Only a non-null claim may contact HighLevel. Multi-replica exclusion is the C1a
row lock and CAS, not process-local state.

A successful claim changes `usable -> refreshing` at revision `N` and returns
the exact generation, revision, lease, encrypted refresh token, key version,
and scopes. The runtime decrypts only that claimed ciphertext with the claimed
key version. It never re-reads token material after claim.

On provider success, both returned rotating credentials are encrypted under
the configured active key and passed together to
`finalize_every8d_ghl_oauth_refresh_v1` with the exact claim revision and lease.
Successful finalize atomically advances `N -> N+1`, returns to `usable`, and
clears lease/failure state. A false CAS is not retried: the runtime performs a
minimal state read only and leaves the database authoritative. UNINSTALL,
reauthorization, generation, stale-lease, and duplicate-finalize races therefore
remain fail closed.

## Scheduler and shutdown

The enabled reconciler waits a random 5–15 seconds before its first pass. It
uses recursive `setTimeout`, scheduling the next pass only after the previous
pass finishes, at 60 seconds plus 0–10 seconds jitter. One process-local
in-flight promise is shared by concurrent triggers, so scans cannot overlap in
one process. Each pass handles at most one ordinary refresh candidate.

Empty passes make no network call. Pass errors and timer-triggered promise
rejections are caught and logged with sanitized classifications; they do not
crash Express or become unhandled rejections.

Shutdown clears future refresh timers and waits up to 20 seconds for the current
pass. It does not intentionally abort a token request already emitted merely
because shutdown started. The request retains its independent 15-second
timeout. If the process dies after claim or transmission, it never replays that
lease; later stale-lease recovery performs the C1a ambiguity burn.

## HighLevel request and response contract

The client makes exactly one `POST` to the configured, approved HighLevel OAuth
token endpoint with `application/x-www-form-urlencoded` fields
`client_id`, `client_secret`, `grant_type=refresh_token`, and `refresh_token`.
Redirect following is disabled, the timeout is 15 seconds, the response is
bounded to 64 KiB, and automatic retry is forbidden.

The response must be strict UTF-8 JSON object data. Documented snake-case fields
are accepted; selected camel-case compatibility aliases are accepted only when
duplicate aliases agree. Validation requires:

- non-empty, untrimmed `access_token` and rotating `refresh_token` strings;
- safe-integer `expires_in` from 1 through 2,678,400 seconds;
- optional `token_type`, which must be `Bearer` when present;
- required space-separated `scope`, with exact normalized set equality against
  both the claim and configured requirements;
- optional `userType=Location`, exact claimed `locationId` and `companyId`, and
  exact configured `appId` when those fields are present.

Absent optional identity fields are accepted; no identity is synthesized from
undocumented fields. If `approvedLocations` is present it must contain only the
exact claimed Location. Bulk, all-location, or future-location authority flags
must not be true.

## No-retry failure contract

Before claim, invalid configuration, a missing stored key version, scope
mismatch, or a lost claim causes no provider request and no failure RPC. The
stored usable credential remains unchanged.

After claim, local decryption/key failures use
`credential_persistence_failed`. After request transmission:

| Outcome | Persistent failure class |
| --- | --- |
| Exact HTTP 400 `invalid_grant` | `invalid_grant` |
| Complete 200 rejected by token, identity, or scope policy | `token_response_rejected` |
| Partial/malformed/oversized/non-JSON/invalid UTF-8 200 | `refresh_outcome_unknown` |
| Other 4xx, 429, 5xx, timeout, reset, redirect, or uncertain transmission | `refresh_outcome_unknown` |
| Successful provider response followed by encryption or persistence exception | `credential_persistence_failed` |

Every class is terminal under C1a: accepted failure transitions to
`reauth_required` and scrubs the credential pair. There is no provider retry.
If the failure RPC itself fails, the lease remains `refreshing`; stale-lease
recovery later burns the ambiguous lease. A false finalize is only re-read and
is never followed by provider replay.

## Observability and secrecy

Sanitized structured events cover scan start/completion, candidate count,
claim won/lost, provider outcome classification, finalize result, terminal
failure, stale-lease recovery, and observed `reauth_required` state. Logs never
include access tokens, refresh tokens, ciphertext, encryption keys, client
secrets, request bodies, response bodies, or authorization headers.

## Background-only consequences and C6

There is no request-time rescue in C1b. If an access token expires before the
next successful background pass, a future provider request using that token
would fail until background refresh succeeds or reauthorization occurs. If a
Railway process sleeps or restarts during the refresh window, the startup jitter
delays the next scan; an unfinished durable lease is not replayed and eventually
burns as ambiguous.

Background-only refresh is sufficient for C1b while the EVERY8D provider is
pending/inactive because no provider runtime consumes these credentials. A
future C6 provider-runtime authentication resolver is still required before
provider activation so every request resolves the exact tenant/Location
credential and safely handles expiry and `reauth_required` state.

## Rollout and rollback

C1b code should first deploy with `EVERY8D_GHL_OAUTH_REFRESH_ENABLED=false`.
Enabling the flag is a separate production authorization and requires a
restart/redeploy. Observe only sanitized scan, claim, finalize, and failure
events during rollout.

Rollback is configuration-first: set the refresh flag to `false` and
restart/redeploy, which removes all refresh timers and side effects. Code may
then be reverted independently. Do not roll back the already-applied C1a
foundation after refresh evidence exists; its guarded rollback intentionally
refuses that state.
