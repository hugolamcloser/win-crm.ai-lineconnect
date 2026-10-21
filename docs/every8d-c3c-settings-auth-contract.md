# EVERY8D C3c settings authentication contract

## 1. Status, authority, and scope

C3b-3 is merged and production `CLOSED_COMPLETE`. C3c contract-freeze review
passed. These are the approved baseline statuses supplied for C3c-1; this
artifact performs no production inspection or operation.

This document is the authoritative frozen C3c architecture contract. C3c-1
creates this documentation artifact only. Requirements below describe future
implementation obligations, not claims that C3c runtime, SQL, browser behavior,
or vendor integration exists or has passed proof.

```text
C3C_CONTRACT:
FROZEN

C3C_IMPLEMENTATION:
NOT_AUTHORIZED_BY_THIS_DOCUMENT

C4:
NOT_STARTED
```

This document does not itself authorize SQL implementation, TypeScript
implementation, routes, deployment, production access, secrets, email sends,
administrator enrollment, settings-auth activation, or C4. Each later
implementation slice and each operational gate requires separate authorization.

Repository: `hugolamcloser/win-crm.ai-lineconnect`.
Authoritative C3c-1 base: `6e1158516b8042e3c60c423cb3e4fd6f6ec32068`
(remote `main`, including merged PR #114).

## 2. Responsibility boundary

| Phase | Responsibility |
| --- | --- |
| C3 | Settings authentication, administrators, settings sessions, durable challenge consumption, browser auth/security infrastructure, and email challenge-delivery infrastructure |
| C4 | EVERY8D/provider account credential management |
| C5 | Credential/provider validation and readiness |
| C6 | HighLevel SMS Provider/outbound activation |
| C7 | First controlled live WinCRM -> EVERY8D SMS |

C4 and later responsibilities must not enter C3c. Email challenge delivery is
C3 infrastructure; it grants no authority to configure EVERY8D credentials or
activate SMS. Required C3 work must close before C4 begins.

## 3. Existing authorities preserved unchanged

The following existing contracts remain authoritative within their boundaries:

| Existing authority | Obligations C3c must preserve |
| --- | --- |
| [C3a foundation](every8d-c3a-settings-auth-foundation.md) | Enrollment-grant authority, administrator provenance, session relation/protection, lifecycle invalidation, and owner-only redemption authority |
| [C3b-1 challenge foundation](every8d-c3b1-settings-email-challenge-foundation.md) | Challenge persistence, delivery/failure transitions, attempt locking, durable challenge rate limits, and verification/consumption state protections |
| [C3b-2 primitives](every8d-c3b2-settings-auth-primitives-contract.md) | Strict configuration parsing, email normalization, email-pseudonym HMAC, OTP generation/parser, OTP HMAC, request capability generation/hash, and key rotation rules |
| [C3b-3 orchestration](every8d-c3b3-settings-auth-orchestration-contract.md) | The exact five narrow `service_role` runtime wrappers and trusted owner state-machine authority |

The five existing C3b-3 runtime wrappers are exactly:

```text
runtime_request_every8d_settings_enrollment_challenge_v1
runtime_request_every8d_settings_login_challenge_v1
runtime_record_every8d_settings_challenge_delivery_v1
runtime_discover_every8d_settings_challenge_v1
runtime_verify_every8d_settings_challenge_v1
```

Their existing signatures, ACLs, owner boundaries, and behavior remain unchanged.
C3c must not widen their ACLs, expose their owner cores, or move durable
state-machine authority into routes. New C3c authority is confined to the
contracts in sections 21-23; it does not create generic administrator, grant,
or session mutation access.

## 4. Browser and trust contract

Settings authentication runs only as a top-level WinCRM HTTPS experience.
Authentication documents deny framing using both required headers:

```text
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
```

HighLevel/Marketplace UI may launch the experience only. HighLevel context is
not authorization authority. New-window launch must use `noopener`/`noreferrer`.

The design permits no iframe authentication, third-party-cookie dependency,
`SameSite=None` dependency, CHIPS dependency, or Storage Access API dependency.
Credentials must not cross `postMessage`, launch URLs, or return URLs. There is
no credential-bearing cross-origin CORS.

The canonical production origin remains deployment configuration. Trusted origin
must not be derived from `Host` or arbitrary forwarded headers. Actual supported
browser and HighLevel/white-label top-level launch proof remains mandatory before
production activation; this contract does not establish that proof.

## 5. Enrollment capability and atomic authority

The external enrollment capability is 32 CSPRNG bytes serialized as canonical,
unpadded Base64URL of exactly 43 characters. Initially, only a controlled
operator process may issue it. There is no public issuer and no automatic OAuth
callback issuance integration in C3c.

Transport is same-origin POST body only. The capability must never appear in a
URL, path, query, fragment, redirect, analytics, or logs. The application strictly
decodes the canonical representation and computes SHA-256 over the decoded
capability bytes. PostgreSQL receives the capability hash only.

The authority flow is:

```text
operator grant
-> C3b-3 enrollment challenge
-> durable encrypted delivery job
-> delivery
-> durable VERIFIED
-> C3c atomic consumption
```

One enrollment consumption transaction must atomically:

1. Revalidate the authoritative `VERIFIED` challenge.
2. Require an allowed operator grant method (`operator_initial` or
   `operator_recovery`).
3. Revalidate installation, generation, and registration eligibility.
4. Revalidate the live, unconsumed grant and pinned identity.
5. Consume the challenge, redeem the grant, create the administrator, and issue
   the settings session together.

A grant UUID, browser installation ID, or TypeScript verified result is never
authority. Existing C3a redemption remains owner-only internal authority. Its
provenance, lifecycle protections, and one-grant/one-administrator constraints
remain in force.

## 6. Login exact-one contract

The trusted login consumption owner core makes the exact-one decision inside
the durable transaction. It must:

1. Resolve protected verified identity as a locator only.
2. Acquire complete validated email-pseudonym alias serialization.
3. Enumerate candidates without `LIMIT 1`.
4. Lock required parent/installation/administrator rows in deterministic order.
5. Lock and revalidate the authoritative `VERIFIED` challenge.
6. Re-evaluate registration, lifecycle, generation, administrator, and identity
   eligibility under those locks.
7. Count the complete eligible set.
8. Issue a session only when the count is exactly one.

Count zero and count greater than one produce the same generic rejection. The
following are forbidden: arbitrary first-row selection, a browser installation
selector as authority, an application-side authoritative count, `LIMIT 1`, or
silently excluding a potential candidate because historical identity material
is unavailable. Missing required historical identity material fails closed.

Every supported C3c administrator-creation path must participate in the same
complete alias serialization protocol through commit. This serialization must
cover concurrent creation as well as consumption; a pre-lock count cannot
establish exact-one authority.

## 7. VERIFIED and CONSUMED contract

The durable authority progression is:

```text
LIVE -> VERIFIED -> CONSUMED
```

Verification and consumption remain separate database transactions. HTTP exposes
no standalone consume continuation. Consumption must rediscover and relock
persistent `VERIFIED` state, never trust in-memory verification success, remain
bound to the original challenge expiry, permit only one authority-creating
winner, and roll back all effects on failure.

For enrollment, challenge consumption, grant redemption, administrator creation,
and session issuance commit together. For login, challenge consumption and
session issuance commit together after exact-one revalidation.

There is no generic runtime escape hatch to create an administrator, redeem a
grant, or issue a session.

## 8. Public HTTP surface and choreography

Exactly eight public endpoints are frozen:

| Method | Path | Narrow purpose |
| --- | --- | --- |
| GET | `/settings/auth` | Top-level authentication document |
| GET | `/settings/auth/csrf` | Browser binding and derived CSRF token bootstrap/read |
| POST | `/settings/auth/enrollment/challenge` | Nondisclosing enrollment challenge request |
| POST | `/settings/auth/enrollment/verify` | Enrollment verification followed by atomic consumption |
| POST | `/settings/auth/login/challenge` | Nondisclosing login challenge request |
| POST | `/settings/auth/login/verify` | Login verification followed by atomic exact-one consumption |
| GET | `/settings/auth/session` | Current durable session authentication |
| POST | `/settings/auth/logout` | Durable session revocation |

There are no public `/enrollment/consume` or `/login/consume` routes, including
under `/settings/auth`.

Successful verify HTTP choreography is exactly:

1. Invoke existing C3b-3 verification once.
2. If durably verified, reconstruct the required aliases and metadata.
3. Generate a fresh session credential.
4. Invoke the new purpose-specific consumption transaction once.
5. Return HTTP success only when consumption/session issuance is confirmed.

A crash after `VERIFIED` but before consumption requires a fresh explicit
challenge. There is no browser resumption endpoint for an arbitrary `VERIFIED`
challenge. Do not automatically retry a write after ambiguous RPC completion.

## 9. HTTP security and parsing

Every POST requires the exact configured HTTPS `Origin` and valid CSRF. Only
`application/json`, optionally with `charset=utf-8`, is accepted. Enforce a
maximum actual body of 8 KiB, reject compressed content, duplicate JSON members,
unknown fields, and query input, and perform no redirects.

Use a dedicated parser/error boundary. Do not inherit the existing global 2 MB
raw-body retention behavior. Parser and error handling must not leak the body
or credentials into global logging or raw error serializers.

Required security headers are:

```text
Cache-Control: no-store
Pragma: no-cache
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

GET routes must not mutate durable authentication authority or renew session
lifetime. Browser binding bootstrap is ephemeral cookie behavior, not durable
authentication authority.

## 10. Public responses and nondisclosure

After structural admission, both challenge request endpoints return exactly:

```text
202
{"status":"accepted"}
```

This applies regardless of unknown identity, unusable grant, malformed credential
value within a valid envelope, durable creation suppression, repository failure,
or internal delivery state. An invalid credential value must not become a
public existence oracle by being reclassified as an invalid envelope.
Pending-cookie and header behavior must remain nondisclosing as well as the
status and body. Timing distributions require proof, not an unmeasured claim.

| Condition | Status | Public body |
| --- | --- | --- |
| Disabled | 404 | `{"error":"not_available"}` |
| Invalid envelope | 400 | `{"error":"invalid_request"}` |
| Origin / CSRF rejection | 403 | `{"error":"request_rejected"}` |
| Oversized | 413 | Fixed generic body |
| Unsupported media | 415 | Fixed generic body |
| Generic edge limit | 429 | `{"error":"try_later"}` |
| Verify/consume/domain/repository negative | 400 | `{"error":"authentication_failed"}` |
| Invalid/unavailable session | 401 | `{"error":"unauthorized"}` |
| Logout persistence unconfirmed | 503 | `{"error":"temporarily_unavailable"}` |

The 413 and 415 bodies must be fixed and generic; no additional body spelling is
frozen here. Internal repository categories must never appear publicly. A
challenge repository failure follows the admitted-request 202 contract above;
it does not use the verify-negative response.

## 11. Session contract

Session credentials are server-generated only: 32 CSPRNG bytes, canonical
unpadded Base64URL, exactly 43 characters, fresh per successful enrollment or
login. The database stores only SHA-256 of decoded credential bytes. A session
credential must never appear in JSON, a URL, localStorage, or logs.

The database controls the issuance timestamp. Expiry is issuance plus exactly
one hour, with no idle touch, sliding renewal, or refresh credential.
Authentication revalidates all of:

- Session hash, expiry, and revocation.
- Administrator active state.
- Installation status and installation generation.
- Registration eligibility.

Future privileged settings mutations must repeat durable authority validation
inside their own transaction. A preceding HTTP session lookup does not authorize
a later mutation against stale lifecycle state.

## 12. Cookie contract

The exact cookie names are:

```text
__Host-wincrm_every8d_settings_session
__Host-wincrm_every8d_settings_browser
__Host-wincrm_every8d_settings_login
__Host-wincrm_every8d_settings_enrollment
```

All applicable cookies require `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`,
and no `Domain` attribute.

| Cookie purpose | Maximum validity |
| --- | --- |
| Pending login/enrollment | 600 seconds |
| Browser CSRF binding | One hour |
| Session | Absolute cookie expiry no later than database session expiry |

Database state and expiry override cookie existence. No receipt-relative
calculation may extend credential validity beyond database expiry.

## 13. CSRF contract

There is no long-lived server CSRF key and no durable CSRF database state.
Browser binding `B` consists of independent 32 random bytes in the HttpOnly,
host-only browser cookie.

The derived CSRF token uses HMAC-SHA256 with key `B` and a versioned,
domain-separated message. The message includes an authenticated/anonymous marker
and, when authenticated, the session-credential hash. Token serialization is
canonical Base64URL, with strict parsing and constant-time comparison.

`/settings/auth/csrf` returns the derived token only, never `B`. Missing or
malformed binding on POST is rejected; a POST must not bootstrap a missing
binding. Rotate browser binding after successful authentication and logout.

Never reuse OTP HMAC keys, pseudonym keys, OAuth secrets, webhook keys, or the
outbox encryption key for CSRF.

## 14. Request-capability contract

The raw request capability exists only in temporary service memory and the
purpose-specific HttpOnly pending cookie. Browser JavaScript never reads it.
PostgreSQL and the outbox receive the request capability hash only. Email
contains the display OTP, never a capability-bearing URL or link.

Request capabilities must never appear in URLs, fragments, redirects, logs,
traces, referrers, analytics, or error reports.

Every admitted request receives the same pending cookie class. When no challenge
was prepared, use an indistinguishable dummy capability. A same-purpose new
request replaces the pending cookie. Cookie existence does not override durable
challenge state or expiry.

## 15. Challenge and outbox atomicity

Initial C3c deliberately uses two commits:

```text
challenge commit -> separate encrypted outbox enqueue commit
```

The accepted fail-closed window is a committed challenge followed by a process
crash before enqueue, leaving an unsent/unverifiable orphan. Never reconstruct
that orphan automatically or startup-scan and send it. Never automatically retry
after ambiguous enqueue completion. A later explicit request may supersede it
under the unchanged frozen challenge limits.

Do not add a combined challenge/outbox preparation bridge in initial C3c. Such
a bridge is deferred: it needs separate contract/proof and is not necessary to
close a security defect.

## 16. Outbox encryption envelope

The independent encryption configuration domain uses exactly:

```text
EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_ACTIVE_KEY_VERSION
EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_KEYS
```

Use AES-256-GCM with:

- 32-byte keys serialized as strict canonical 43-character unpadded Base64URL.
- Strict duplicate JSON-member detection and an active version present in its
  keyring.
- A fresh 12-byte nonce for each payload and a 16-byte authentication tag.
- Exact versioned envelope parsing.

Authenticated linkage/AAD must bind sufficient immutable context, including
outbox/job identity, challenge identity, request hash, purpose, and
template/payload version. Cross-job or cross-purpose ciphertext substitution
must not be accepted.

No C3b-2, OAuth, session, or provider key may be reused. A missing required
historical decryption version fails closed with no provider call or fallback.
Scrub ciphertext immediately on a terminal transition. Retain non-secret
terminal metadata for 24 hours initially.

## 17. Outbox state machine

The initial send progression is:

```text
PENDING -> LEASED -> SENDING

SENDING outcomes:
ACCEPTED
RETRY_WAIT
FAILED_TERMINAL
DELIVERY_OUTCOME_UNKNOWN

Never-sent unusable work:
CANCELLED
EXPIRED
```

Require one outbox job per challenge, immutable request-hash/challenge/purpose
linkage, encrypted recipient/display OTP only, fixed allowlisted templates,
a stable non-secret job-derived idempotency key, fenced leases, database-controlled
deadlines, and terminal ciphertext scrub.

`RETRY_WAIT` permits another attempt only under the proven-not-accepted rule and
the bounds in section 19. An expired `SENDING` becomes
`DELIVERY_OUTCOME_UNKNOWN` and is never automatically resent. `CANCELLED` and
`EXPIRED` are permitted for never-sent unusable work, not as a way to relabel an
ambiguous send as safe to retry.

## 18. Provider-neutral delivery outcomes

The exact adapter outcome taxonomy is:

| Outcome | Required evidence | Automatic retry |
| --- | --- | --- |
| `accepted` | Authoritative provider acceptance and a stable validated provider message ID | Forbidden |
| `rejected` | Definitive refusal | Forbidden |
| `not_accepted_retryable` | Positive evidence that acceptance did not occur | Permitted within frozen bounds |
| `outcome_unknown` | Possible provider-boundary crossing without authoritative result | Forbidden; terminal |

HTTP 429 or 5xx alone is insufficient proof of non-acceptance. A timeout or
reset after possible emission is unknown unless a future vendor contract
provides stronger authoritative evidence. Idempotency keys alone do not replace
this outcome evidence.

Provider responses and errors must never pass raw into routes or logs. No
vendor-specific configuration or credential names are selected here. Concrete
vendor selection and approval remain separate future gates.

## 19. Worker contract and finalization

Frozen initial operational values:

| Setting | Value |
| --- | --- |
| Claim batch | 10 |
| Lease | 30 seconds |
| Provider deadline | 10 seconds |
| Maximum provider-send attempts | 3 |
| Retry delays after proven-not-accepted failures | 5 seconds, then 20 seconds |

Retry remains bounded by challenge/job usability. Claim does not increment the
send-attempt count. Durable `SENDING` must commit before provider invocation.
An ambiguous `SENDING` commit means **do not call the provider**.

Never perform a network call with a database transaction or row lock open.
Expired pre-send leases may be reclaimed; `SENDING` recovery never authorizes
another send. A worker must not knowingly send after lease/deadline expiry.

Finalization must atomically:

1. Validate job, lease, fence, and attempt.
2. Record the provider terminal result.
3. Invoke existing challenge-delivery authority where permitted.
4. Persist a truthful outbox terminal disposition.
5. Scrub terminal payload.

If the challenge delivery recorder returns false, record the truthful mismatch
and disposition. Do not reopen the challenge or claim delivery was recorded.
Duplicate compatible terminal finalization returns the existing receipt without
a second challenge-delivery call. Conflicting terminal finalization is rejected.

## 20. Strict configuration contract

Preserve the existing flag and add the two future C3c flags without activating
any of them:

```text
EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED
EVERY8D_SETTINGS_AUTH_HTTP_ENABLED
EVERY8D_SETTINGS_AUTH_EMAIL_DISPATCH_ENABLED
```

For each flag the grammar is exact: absent, empty, or `false` means false;
`true` means true; any other non-empty value is a configuration error. There
are no implicit truthy values.

```text
HTTP operational gate:
CHALLENGES_ENABLED AND HTTP_ENABLED

Worker operational gate:
CHALLENGES_ENABLED AND HTTP_ENABLED AND EMAIL_DISPATCH_ENABLED
```

The shortened gate labels above refer only to the exact full flag names listed
in this section, not aliases.

Additional future variables and validation:

| Exact variable | Contract |
| --- | --- |
| `EVERY8D_SETTINGS_AUTH_PUBLIC_BASE_URL` | Canonical HTTPS origin; no userinfo, query, or fragment; root path only |
| `EVERY8D_SETTINGS_AUTH_EMAIL_PROVIDER` | Exact lowercase adapter ID, at most 32 characters; must exist in the approved adapter registry when operational |
| `EVERY8D_SETTINGS_AUTH_EMAIL_FROM` | One canonical mailbox; no display name or header injection |
| `EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_ACTIVE_KEY_VERSION` | Active encryption key version present in the separate keyring |
| `EVERY8D_SETTINGS_AUTH_EMAIL_OUTBOX_ENCRYPTION_KEYS` | Strict independently validated encryption keyring under section 16 |

Supplied malformed configuration is invalid even while the feature is disabled
where that configuration group is supplied. Preserve C3b-2 parsing and rotation
rules. No startup secret generation is permitted. These names freeze future
configuration contracts; they do not authorize changing environment values.

## 21. Consumption and session database authority contracts

The following are new, frozen architectural API signatures, not SQL
implementation or migration statements:

```text
runtime_discover_every8d_settings_verified_challenge_v1(bytea,text)

runtime_consume_every8d_settings_enrollment_challenge_v1(
  bytea,
  text[],
  bytea
)

runtime_consume_every8d_settings_login_challenge_v1(
  bytea,
  text[],
  bytea
)

runtime_authenticate_every8d_settings_session_v1(bytea)

runtime_revoke_every8d_settings_session_v1(bytea)
```

| Contract | Narrow purpose and boundary |
| --- | --- |
| Verified challenge discovery | Protected identity/metadata lookup for verified-challenge alias reconstruction; locator only, never consumption authority |
| Enrollment consumption | Purpose-bound atomic challenge/grant/administrator/session transaction from section 5 |
| Login consumption | Purpose-bound atomic exact-one challenge/session transaction from section 6 |
| Session authentication | Hash-based durable session and lifecycle revalidation from section 11, without renewal |
| Session revocation | Hash-based durable revocation; unconfirmed persistence must not be reported as successful logout |

Consumption uses request-capability hash, the complete email-pseudonym alias set,
and the fresh session-credential hash. Raw capabilities and raw session
credentials never enter PostgreSQL. Discovery must not authorize consumption of
stale state; the owner consumption transaction relocks and revalidates it.

## 22. Outbox database authority contracts

The new frozen architectural API names are exactly:

```text
runtime_enqueue_every8d_settings_auth_email_v1
runtime_claim_every8d_settings_auth_email_v1
runtime_begin_every8d_settings_auth_email_send_v1
runtime_finalize_every8d_settings_auth_email_v1
runtime_recover_every8d_settings_auth_email_v1
runtime_purge_every8d_settings_auth_email_v1
```

| Contract | Narrow purpose and boundary |
| --- | --- |
| Enqueue | Unique encrypted job for the committed challenge with immutable linkage; separate commit, no orphan reconstruction |
| Claim | Bounded fenced pre-send lease; no send-attempt increment |
| Begin send | Durable fenced `SENDING` transition before provider invocation |
| Finalize | Atomic truthful result, permitted challenge-delivery recording, disposition, and terminal scrub |
| Recover | Reclaim expired pre-send leases or close ambiguous `SENDING` as unknown; never authorize resend of unknown work |
| Purge | Bounded retention/cleanup respecting terminal scrub, metadata retention, and existing challenge protections |

Exact SQL parameter types for outbox operations may be frozen in C3c-3 contract
implementation review once the concrete migration is authored. They are not
invented here. No migration or rollback SQL is authored in C3c-1.

## 23. Common database security boundary

All future runtime wrappers must be `service_role` callable only where intended,
delegate to trusted owner authority, and use fixed `search_path`. Preserve the
existing trusted-owner boundary and fixed `pg_catalog, public` search path.
Expose no generic table mutation and avoid direct `service_role` table writes.

No application authority is granted directly on owner cores or C3a/C3b tables.
Existing durable state-machine protections, ACLs, RLS, provenance, and lifecycle
invalidation remain intact. Future migrations and guarded rollback require their
own focused approval and executable proof; this artifact changes no schema,
rows, functions, privileges, or rollback files.

## 24. TypeScript boundary

Future C3c modules are conceptually:

- HTTP adapter.
- Session primitives, session repository, and session service.
- Outbox encryption envelope and outbox repository.
- Provider-neutral adapter and worker.
- Strict C3c configuration.
- Fixed security telemetry taxonomy.

Routes compose narrow services; they do not own cryptography or state machines.
There is no generic Supabase/RPC escape hatch and no raw database/provider
exception propagation. Reuse C3b-2 email/OTP/HMAC algorithms without duplication.
This conceptual module inventory creates no runtime files or dependencies.

## 25. Logging and secret safety

C3c inherits the strict existing C3b-3 prohibition. Never log:

- Normalized email, raw grant capability/hash, request capability/hash, OTP,
  OTP HMAC, or email pseudonym.
- HMAC/encryption keys, session credential/hash, CSRF token, or browser binding.
- OAuth tokens, provider credentials, or raw outbox payload.
- Challenge/grant/administrator/session identifiers, stored key versions,
  RPC arguments/payloads, SQLSTATE, database messages, raw database/provider
  responses, raw exceptions, nested causes, or other protected identifiers
  forbidden by C3b-3.

Permitted telemetry is confined to a fixed event name, a closed safe category,
route template, method, status class, coarse latency, and aggregate counts
without identity labels. Preserve the existing repository's exact two failure
categories, `repository_unavailable` and `repository_contract_violation`,
without exposing them publicly or attaching raw causes. The future fixed
security taxonomy must not widen the C3b-3 repository metadata policy.

## 26. Implementation slices and review sequence

This sequence freezes future scope, not permission to start the next slice:

| Slice | Scope |
| --- | --- |
| C3c-1 | Contract artifact only |
| C3c-2 | Consumption/session database authority, guarded rollback, repository/service, and focused SQL/concurrency proof |
| C3c-3 | Durable outbox database authority, envelope crypto, repository/contracts, and focused proof |
| C3c-4 | Provider-neutral worker; concrete provider only after separate vendor selection/approval |
| C3c-5 | Top-level auth page, eight HTTP endpoints, cookies/session middleware, CSRF, and scoped parsing/logging |
| C3c-6 | Integrated PG17, concurrency, failure injection, browser, security, and activation runbook |

Do not begin C4 before required C3 work closes. Each pilot task remains a separate
focused pull request under the [pilot governance](taiwan-sms-pilot-plan.md).

## 27. Mandatory proof matrix

All items below are required future proof. No row asserts that C3c proof has
already passed. PostgreSQL proofs require disposable PostgreSQL 17; browser and
vendor evidence cannot be replaced with source inspection or mock-only claims.

| Proof area | Required evidence |
| --- | --- |
| Existing C3a/C3b regression | Preserve provenance, lifecycle invalidation, grants, session protections, challenge transitions, rate limits, primitives, five wrappers, ACL/owner/search-path boundaries, and existing proof suites |
| Exact-one zero/one/multiple | Complete eligible set: zero and multiple reject identically; exactly one succeeds; no arbitrary first candidate |
| Concurrent administrator creation | Every supported creation path shares complete alias serialization through commit; no phantom exact-one success |
| Lifecycle/revocation races | Registration eligibility, disable/uninstall, generation changes, administrator/session revocation, and consumption/authentication races revalidate under deterministic locks |
| VERIFIED -> CONSUMED exactly once | Concurrent/replayed consumption has one authority winner; original expiry enforced; in-memory success cannot bypass durable state |
| Session hash collision rollback | Collision rolls back challenge, grant, administrator, and session effects as applicable; no partial authority or automatic write retry |
| One-hour session expiry | DB issuance plus exactly one hour; no GET renewal, idle touch, sliding expiry, refresh, or receipt-relative cookie extension |
| Logout/revocation | Durable revocation blocks authentication; ambiguous/unconfirmed persistence yields the frozen 503 response |
| Browser cookies | Exact host-prefixed names/attributes, purpose separation, 600-second pending limit, one-hour binding limit, DB-bounded session expiry, and binding rotation |
| Origin/CSRF | Exact configured HTTPS Origin; strict token/binding parsing, authenticated binding, constant-time comparison, rejection of missing/malformed binding, no POST bootstrap |
| Nondisclosure | Status/body/header/cookie equivalence for prepared, unknown, invalid credential in valid envelope, unusable grant, suppression, repository failure, and internal delivery states |
| Timing distributions | Compare admitted challenge outcomes for identity/existence leakage; do not claim equivalence from identical status/body alone |
| HTTP parsing/security | 8 KiB actual limit, compression/media/charset rules, duplicate/unknown JSON members, query rejection, fixed errors, no redirects, headers, dedicated parser/error boundary, no global raw-body retention |
| Outbox unique enqueue | One job per challenge; immutable linkage; duplicate/ambiguous enqueue does not create a second send path |
| Orphan safety | Crash between challenge/enqueue commits leaves unsent/unverifiable work; no startup reconstruction; explicit supersession respects existing limits |
| Lease fencing | Stale lease/fence/attempt cannot begin or finalize work; expired pre-send reclamation is bounded and does not bypass deadlines |
| Ambiguous send-start | Unconfirmed `SENDING` commit causes zero provider calls; no network call under a DB transaction/row lock |
| Terminal unknown behavior | Possible emission, expired `SENDING`, timeout/reset, and insufficient 429/5xx evidence terminate unknown without automatic resend |
| Worker retry bounds | Only positive non-acceptance evidence permits retry; batch 10, lease 30s, deadline 10s, maximum three sends, delays 5s/20s, usability bounds |
| Atomic finalization | Truthful job result/disposition and allowed challenge delivery recording commit atomically; false recorder result preserved; compatible duplicate returns receipt without second recorder call; conflict rejected |
| Failure injection | Crashes and disconnects at verification/consumption, enqueue, lease, begin-send, provider boundary, finalization, and cleanup commit boundaries preserve conservative authority and retry semantics |
| Encrypted payload scrub | AES-256-GCM linkage/authentication, nonce/tag/envelope validation, substitution rejection, and immediate scrub on every terminal disposition |
| Missing historical encryption key | Fail closed with no provider call, fallback, or payload disclosure |
| Historical identity material | Missing required aliases/keys fail closed instead of silently reducing candidate count; preserve C3b-2 rotation rules |
| Retention/cleanup compatibility | Initial 24-hour non-secret terminal metadata retention, terminal ciphertext scrub, existing challenge expiry/scrub/30-day cleanup, FK/lock ordering, and no authority resurrection |
| Chrome/Firefox/Safari | Actual supported-browser top-level HTTPS, cookies, CSRF, authentication, expiry, logout, and new-window behavior |
| HighLevel top-level launch | Actual HighLevel and white-label launch proof, canonical origin, noopener/noreferrer, and no HighLevel-context authorization |
| Iframe denial | CSP frame-ancestors and X-Frame-Options denial; no third-party-cookie, SameSite=None, CHIPS, Storage Access API, postMessage credential, or cross-origin credential dependency |
| LINE/OAuth/webhook regression | Preserve health, all protected LINE inbound/outbound/workflow/connect routes, attachments, mappings, reconciliation, inbox mirroring, OAuth, and existing webhook behavior; Phase2F unchanged |
| Guarded rollback | Slice-specific dependency/ownership/ACL/data guards, concurrency and populated-state safety, prior-authority preservation, and no destructive or unauthorized production rollback |
| Configuration/telemetry | Strict disabled/enabled parsing and gates, malformed supplied groups rejected, no startup secret generation, fixed telemetry, no secret/raw exception leakage |

## 28. Production boundary

This contract artifact authorizes none of:

- Production migration or production database access.
- Deployment or Railway changes.
- Key generation, secret provisioning, or provider configuration.
- Email sends, operator grant issuance, or administrator enrollment.
- Feature/settings-auth activation.
- Phase2F changes or SMS Provider activation.
- Live SMS or LINE changes.

Every operation above remains a separate future gate. No production credentials,
customer data, live provider calls, or operational configuration are needed for
C3c-1. Actual browser/HighLevel launch proof and separately approved vendor
contracts remain prerequisites where applicable, not completed evidence.

C3c-1 rollback consists of closing the unmerged PR or reverting the single
contract-document commit. It requires no SQL rollback, production action, or
runtime change. Future implementation rollback contracts remain separately gated.

## 29. Final status

C3c architecture is frozen for independent C3c-1 artifact review. This document
implements no C3c runtime or SQL and authorizes no production change, activation,
C4 work, or next-slice execution.

```text
C3C_1_CONTRACT_ARTIFACT:
IMPLEMENTED_FOR_REVIEW

C3C_RUNTIME:
NOT_IMPLEMENTED

C3C_SQL:
NOT_IMPLEMENTED

PRODUCTION_CHANGES:
NONE

NEXT_GATE:
INDEPENDENT_C3C_1_CONTRACT_REVIEW
```
