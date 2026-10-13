# EVERY8D C3b-3 settings authentication orchestration contract

## Status and authority

This document freezes the remediated C3b-3 design contract only. It does not
authorize TypeScript implementation, SQL migration authoring or application,
routes, email delivery, administrator or session creation, settings-auth
activation, Railway changes, production keys, SMS, or LINE changes.

The authoritative base is
`28f4891863487956a4cdb3b20296b8ed6036f949`. C3a and C3b-1 remain the durable
database-state authorities. C3b-2 remains the configuration and cryptographic
primitive authority. C3b-3 is route-free orchestration plus the minimum narrow
runtime bridge required to request, discover, record delivery for, and verify
challenges.

## Responsibility boundary

C3b-3 owns:

1. preparing and persisting enrollment and login challenges;
2. recording one challenge-delivery result;
3. non-authoritative internal discovery for candidate OTP HMAC preparation;
4. invoking an authoritative owner-only verification core;
5. exact typed repository methods, strict result validation, sanitized errors,
   feature-gate enforcement, and C3b-2 primitive composition; and
6. the design of the minimum SQL authority boundary described here.

C3b-3 does not own Express routes, HTTP status codes, cookies, CSRF, browser
sessions, enrollment-grant issuance or redemption, administrator creation,
verified-challenge consumption, settings-session issuance, an email provider,
a durable outbox, scheduler jobs, Custom Page API/UI, Railway configuration,
production key creation, SMS, or LINE. C3c owns those later HTTP, delivery,
consumption, administrator, and session contracts.

## Architecture inventory

The C3b-3 migration adds eight functions total:

- exactly five application-callable runtime wrappers; and
- exactly three owner-only security/state cores.

The wrappers are deliberately thin. They do not reproduce request or
verification state machines. The owner cores contain all request and verify
authority. Existing C3a/C3b-1 functions and migrations remain unchanged.

The migration preflight captures one `trusted_common_owner_oid`: the owner OID
shared by the required C3a/C3b-1 relations/functions and the current trusted
migration role. That exact role owns all eight new functions. Ownership is not
inferred from function-creation defaults and is distinct from EXECUTE authority.

| New function | Required owner |
| --- | --- |
| `runtime_request_every8d_settings_enrollment_challenge_v1` | `trusted_common_owner_oid` |
| `runtime_request_every8d_settings_login_challenge_v1` | `trusted_common_owner_oid` |
| `runtime_record_every8d_settings_challenge_delivery_v1` | `trusted_common_owner_oid` |
| `runtime_discover_every8d_settings_challenge_v1` | `trusted_common_owner_oid` |
| `runtime_verify_every8d_settings_challenge_v1` | `trusted_common_owner_oid` |
| `request_every8d_settings_enrollment_challenge_core_v2` | `trusted_common_owner_oid` |
| `request_every8d_settings_login_challenge_core_v2` | `trusted_common_owner_oid` |
| `verify_every8d_settings_challenge_core_v2` | `trusted_common_owner_oid` |

### Application-callable `service_role` surface

All argument names below are authoritative because Supabase RPC binds named
arguments. Unless explicitly stated, there are no defaults.

#### Runtime enrollment request

```sql
public.runtime_request_every8d_settings_enrollment_challenge_v1(
  input_enrollment_grant_token_hash bytea,
  input_challenge_id uuid,
  input_normalized_email text,
  input_email_pseudonym text,
  input_email_pseudonym_aliases text[],
  input_request_token_hash bytea,
  input_otp_hmac bytea,
  input_otp_hmac_key_version text
)
returns table(
  challenge_id uuid,
  created_at timestamptz,
  expires_at timestamptz
)
```

All three return columns are non-null for the one prepared row; zero rows is the
normal nondisclosing no-preparation result. The function is owned by
`trusted_common_owner_oid`, is `LANGUAGE sql`, `SECURITY DEFINER`, and has
`SET search_path = pg_catalog, public`. It contains only a schema-qualified call
to the owner enrollment core with arguments forwarded unchanged. EXECUTE is
granted only to `service_role`.

#### Runtime login request

```sql
public.runtime_request_every8d_settings_login_challenge_v1(
  input_challenge_id uuid,
  input_normalized_email text,
  input_email_pseudonym text,
  input_email_pseudonym_aliases text[],
  input_request_token_hash bytea,
  input_otp_hmac bytea,
  input_otp_hmac_key_version text
)
returns table(
  challenge_id uuid,
  created_at timestamptz,
  expires_at timestamptz
)
```

All return columns are non-null for the one prepared row; zero rows is the
normal nondisclosing no-preparation result. It is owned by
`trusted_common_owner_oid`, is `LANGUAGE sql`, `SECURITY DEFINER`, has
`SET search_path = pg_catalog, public`, delegates only to the owner login core,
and grants EXECUTE only to `service_role`.

#### Runtime delivery recording

```sql
public.runtime_record_every8d_settings_challenge_delivery_v1(
  input_request_token_hash bytea,
  input_succeeded boolean,
  input_failure_class text default null
)
returns boolean
```

The non-null boolean is returned unchanged from the existing owner-only
`record_every8d_settings_challenge_delivery_v1`. The wrapper is `LANGUAGE sql`,
`SECURITY DEFINER`, is owned by `trusted_common_owner_oid`, has
`SET search_path = pg_catalog, public`, and grants EXECUTE only to
`service_role`.

#### Runtime live discovery

```sql
public.runtime_discover_every8d_settings_challenge_v1(
  input_request_token_hash bytea,
  input_purpose text
)
returns table(
  challenge_id uuid,
  enrollment_grant_id uuid,
  normalized_email text,
  email_pseudonym text,
  otp_hmac_key_version text
)
```

`enrollment_grant_id` is nullable for login and non-null for enrollment. The
other four columns are non-null in a returned row. The function is
owned by `trusted_common_owner_oid`, is `LANGUAGE sql`, `SECURITY DEFINER`, and has
`SET search_path = pg_catalog, public`. It applies the exact live predicate
frozen under discovery and grants EXECUTE only to `service_role`.

#### Runtime verification

```sql
public.runtime_verify_every8d_settings_challenge_v1(
  input_request_token_hash bytea,
  input_purpose text,
  input_email_pseudonym_aliases text[],
  input_candidate_otp_hmac bytea
)
returns boolean
```

The non-null boolean is returned unchanged from the new owner verify core. The
wrapper is owned by `trusted_common_owner_oid`, is `LANGUAGE sql`,
`SECURITY DEFINER`, has
`SET search_path = pg_catalog, public`, forwards only these four inputs, and
grants EXECUTE only to `service_role`.

### Owner-only core surface

The three cores are `LANGUAGE plpgsql`, `SECURITY DEFINER`, owned by the exact
captured `trusted_common_owner_oid`, and have
`SET search_path = pg_catalog, public`. Revoke all privileges on them from
`PUBLIC`, `anon`, `authenticated`, and `service_role`. No application role gets
EXECUTE.

#### Enrollment request core

```sql
public.request_every8d_settings_enrollment_challenge_core_v2(
  input_enrollment_grant_token_hash bytea,
  input_challenge_id uuid,
  input_normalized_email text,
  input_email_pseudonym text,
  input_email_pseudonym_aliases text[],
  input_request_token_hash bytea,
  input_otp_hmac bytea,
  input_otp_hmac_key_version text
)
returns table(
  challenge_id uuid,
  created_at timestamptz,
  expires_at timestamptz
)
```

All return columns are non-null for the one prepared row; zero rows is the
normal nondisclosing no-preparation result. There are no defaults. The function
owner is exactly `trusted_common_owner_oid`.

#### Login request core

```sql
public.request_every8d_settings_login_challenge_core_v2(
  input_challenge_id uuid,
  input_normalized_email text,
  input_email_pseudonym text,
  input_email_pseudonym_aliases text[],
  input_request_token_hash bytea,
  input_otp_hmac bytea,
  input_otp_hmac_key_version text
)
returns table(
  challenge_id uuid,
  created_at timestamptz,
  expires_at timestamptz
)
```

All return columns are non-null for the one prepared row; zero rows is the
normal nondisclosing no-preparation result. There are no defaults. The function
owner is exactly `trusted_common_owner_oid`.

#### Verification core

```sql
public.verify_every8d_settings_challenge_core_v2(
  input_request_token_hash bytea,
  input_purpose text,
  input_email_pseudonym_aliases text[],
  input_candidate_otp_hmac bytea
)
returns boolean
```

The return is a non-null boolean. There are no defaults. The function owner is
exactly `trusted_common_owner_oid`. The caller supplies no
challenge UUID, enrollment-grant UUID, normalized email, administrator UUID,
installation identity, or stored OTP key version as authority. The core resolves
all protected metadata internally. Discovery's challenge UUID is used by
TypeScript only to construct the UUID-bound candidate HMAC.

## Owner request-core contracts

### Shared static validation and UUID authority

Both cores reject before authority mutation unless:

- the supplied challenge UUID is non-null and its canonical PostgreSQL text is
  lowercase hyphenated `8-4-4-4-12`, version 4, and RFC variant (`8`, `9`, `a`,
  or `b` in the variant nibble);
- normalized email passes
  `is_every8d_settings_canonical_email_v1`;
- the active pseudonym passes `is_every8d_settings_email_pseudonym_v1`;
- aliases are non-null with cardinality `1..64`, every alias is valid, and the
  active pseudonym is an exact member;
- request-token hash and OTP HMAC are each exactly 32 bytes; and
- OTP key version matches `^[A-Za-z0-9_.-]{1,63}$` under `COLLATE "C"`.

The enrollment core additionally requires an exact 32-byte enrollment-grant
token hash. Invalid static input raises a check-violation-class error, which the
repository sanitizes and the service suppresses into its enumeration-safe
accepted result.

C3b-3 generates the UUID server-side with exactly Node `crypto.randomUUID()`.
The result must be lowercase canonical text, UUID version 4, RFC variant, and
must pass `decodeEvery8dSettingsChallengeUuid`. No browser/caller UUID, injected
production UUID factory, predictable fallback, manual bit construction, or GUID
endian conversion is allowed.

The challenge primary key and request-token-hash unique key are final collision
backstops. Either collision aborts the whole request transaction, including any
resend supersession in that transaction. C3b-3 does not retry only the UUID,
capability, or insert. It never silently regenerates after an ambiguous result.
A later whole request requires a fresh explicit invocation and all-new UUID,
capability, and OTP.

### Enrollment request core authority and order

The enrollment core performs this exact sequence:

1. perform all shared static validation, including the 32-byte grant hash;
2. acquire relation locks in this order:
   `ghl_marketplace_installations` `ROW SHARE`,
   `every8d_settings_enrollment_grants` `ROW SHARE`,
   `every8d_settings_auth_challenges` `ROW EXCLUSIVE`, then
   `every8d_settings_auth_challenge_failures` `ROW SHARE`;
3. perform a nonlocking unique lookup by
   `every8d_settings_enrollment_grants.token_hash` solely to discover grant UUID,
   installation UUID, and installation generation; absence returns zero rows;
4. lock the exact installation parent row `FOR SHARE` and return zero rows if
   absent or no longer eligible;
5. relock/reload the discovered grant row `FOR UPDATE`, requiring its UUID,
   token hash, installation UUID, and generation to match the preliminary row;
6. call the existing installation-eligibility authority for that exact parent
   and generation while the parent lock is held;
7. capture exactly one `requested_at := clock_timestamp()`;
8. require the grant to be unrevoked, unconsumed, unexpired, to retain at least
   two minutes at `requested_at`, and, when pinned, to match normalized email;
   an unusable grant returns zero rows;
9. call the existing alias-lock function with the exact complete alias array;
   it validates before locking, deduplicates exact aliases and projected words,
   sorts signed lock words ascending, and takes advisory namespace `1163278404`;
10. evaluate existing 60-second, one-hour, 24-hour, per-grant, and recent-failure
    rate limits using the same aliases, grant UUID, and `requested_at`; a reached
    expected limit returns zero rows;
11. supersede only matching live, unfailed, unlocked, unverified, unconsumed
    enrollment challenges for that grant and aliases, setting reason `resend`,
    scrubbing email, and using exactly `requested_at`;
12. insert one PENDING_DELIVERY row with the explicit UUID and immutable supplied
    digests/version; and
13. set `created_at = requested_at` and
    `expires_at = least(requested_at + interval '10 minutes', grant.expires_at)`
    and return exactly the inserted UUID/creation/expiry.

The preliminary grant lookup is never authority. Only the parent-locked,
grant-locked revalidation authorizes insertion. Revocation/consumption that wins
the grant-row race produces the same normal zero-row no-preparation result;
verification/request that locks first linearizes before that later transition.

### Login request core authority and order

The login core performs this exact sequence:

1. perform all shared static validation;
2. acquire the complete alias advisory-lock set through the existing lock
   function;
3. acquire relation locks in this order:
   `ghl_marketplace_installations` `ROW SHARE`,
   `every8d_settings_administrators` `ROW SHARE`,
   `every8d_settings_auth_challenges` `ROW SHARE`, then
   `every8d_settings_auth_challenge_failures` `ROW SHARE`;
4. perform a nonlocking lookup of candidate active administrator UUIDs and
   their exact installation UUID/generation where normalized email equals the
   input and the stored pseudonym is an exact alias; this list is a locator,
   never authority;
5. in an explicit loop ordered by installation UUID then generation, lock each
   distinct candidate installation row `FOR SHARE`;
6. in an explicit loop ordered by administrator UUID, lock each candidate
   administrator row `FOR SHARE`;
7. capture exactly one `requested_at := clock_timestamp()`;
8. require at least one already locked administrator still to be unrevoked,
   still to match the exact normalized email and aliases, and still to bind an
   already locked exact installation/generation; require that parent to remain
   an EVERY8D SMS installation with current `INSTALL` lifecycle, `pending` or
   `active` status, non-null company, exact current generation, and valid
   current registration/version eligibility; otherwise return zero rows;
9. evaluate the existing email-alias and recent-failure rate limits with null
   grant UUID and `requested_at`; a reached expected limit returns zero rows;
10. supersede only matching live, unfailed, unlocked, unverified, unconsumed login
   challenges for the aliases, setting reason `resend`, scrubbing email, and
   using exactly `requested_at`;
11. insert one PENDING_DELIVERY row with the explicit UUID and immutable supplied
   digests/version; and
12. set `created_at = requested_at` and
   `expires_at = requested_at + interval '10 minutes'` and return exactly the
   inserted UUID/creation/expiry.

An administrator revocation or installation lifecycle/generation mutation that
wins its row-lock race causes the final locked revalidation to reject. A request
that wins all required share locks may linearize before that later mutation.
New candidates appearing after the preliminary lookup may be ignored and cause
only a safe zero-row no-preparation result.

No administrator, installation, or grant identifier is returned or disclosed
to the browser boundary.

### V1/v2 parity

Except for the explicit deltas below, the owner request cores preserve the
existing v1 security behavior exactly for canonical
email/pseudonym/key-version validation, alias validation and advisory locks,
relation-lock modes/order, rate-limit windows and thresholds, resend selection
and scrub fields, PENDING_DELIVERY insertion, timestamp capture points, expiry
formulas, returned metadata, enrollment eligibility, and the v1 login
lifecycle/status predicates.

There are exactly four functional deltas:

1. a trusted server-generated UUID is supplied and inserted instead of using the
   table default; and
2. enrollment authority begins with a 32-byte grant token hash, then resolves
   and relocks the grant, instead of accepting a caller-selected grant UUID; and
3. login request authorization is strengthened from the v1 nonlocking existence
   check to deterministic parent-first installation/administrator row locks,
   locked revalidation, and the full existing installation registration/version
   eligibility assertion. This is an intentional security delta, not accidental
   request-state-machine drift; and
4. expected nondisclosing request negatives—no eligible login identity,
   absent/unusable enrollment grant, failed current eligibility, or reached rate
   limit—return zero rows instead of propagating the v1 exception. Static
   contract violations and unexpected database failures remain errors. This
   delta supplies the frozen `not_prepared` repository result without SQL-message
   inspection.

The implementation proof must execute v1/v2 parity scenarios for every
unchanged validation, rate-limit, resend, expiry, state, and concurrency rule.

## Alias and cryptographic request orchestration

Both service request methods check the feature flag first. When disabled, they
return `disabled` before input processing, entropy, repository calls, or delivery
preparation.

When enabled, enrollment and login normalize email using C3b-2, derive the
active pseudonym, derive candidates for every retained email-pseudonym key
version, order them by ascending ASCII key-version order, deduplicate exact
pseudonym strings while retaining first occurrence, and require the active
pseudonym to remain present. TypeScript acquires no database lock.

The service then generates a UUID with `crypto.randomUUID()`, a 32-byte request
capability, and one eight-symbol OTP. It hashes the capability, formats the OTP,
and derives one HMAC using the active OTP key/version, exact purpose, generated
UUID, and canonical OTP. It calls the corresponding runtime request wrapper
exactly once.

The exact alias array is passed to PostgreSQL. PostgreSQL owns validation,
deduplication, signed lock-word projection and ordering, advisory locking, rate
limits, and resend transitions. Application code must not acquire advisory
locks or reimplement those decisions.

The successful internal preparation has exactly this route-free shape:

```ts
type Every8dSettingsPreparedChallenge = Readonly<{
  challengeId: string;
  purpose: Every8dSettingsAuthPurpose;
  createdAt: Date;
  expiresAt: Date;
  requestCapability: string;
  deliveryRequest: Readonly<Every8dSettingsEmailDeliveryRequest>;
  deliveryHandle: Readonly<{ requestTokenHash: Buffer }>;
}>;
```

`requestCapability`, `deliveryRequest.displayOtp`, and the delivery-handle hash
are secrets. The handle owns a defensive Buffer copy. C3b-3 returns this value
once to its in-process C3c caller and retains no copy in a cache, singleton,
retry queue, timer, or log. Its local references live only for that invocation;
C3c later owns any approved durable capability/outbox treatment. C3b-3 persists
only the capability hash, OTP HMAC, and key version and cannot retrieve the raw
capability or OTP later.

## Enumeration-safe request boundary

When enabled, both `requestLoginChallenge` and `requestEnrollmentChallenge`
return one internal shape:

```ts
type Every8dSettingsChallengeRequestAccepted = Readonly<{
  outcome: "accepted";
  deliveryCommand: Every8dSettingsPreparedChallenge | null;
}>;
```

`deliveryCommand` is internal-only and non-null only when persistence prepared a
challenge. Invalid email/grant input, nonexistent or unusable grant, nonexistent
administrator/account, rate limit, collision, `repository_unavailable`, or
`repository_contract_violation` all produce the same `outcome: "accepted"`
with `deliveryCommand: null`. The service does not expose `prepared`,
`unavailable`, a repository category, or an existence-bearing reason field for
request methods.

Cross-phase invariant: a future C3c route must emit one indistinguishable
synchronous accepted status, body shape, headers, and request-class cookie
behavior regardless of whether an administrator, account, or grant exists,
whether a challenge was prepared, whether delivery will occur, whether the
repository was unavailable, or whether its successful payload violated the
contract. It must never serialize the optional internal command or branch any
external response property from the command/category. Exact HTTP values remain
C3c design scope.

Internal monitoring may record only a fixed operation name, one of the two
closed repository categories, and a coarse success/failure outcome, provided no
prohibited value is included. Timing equalization, abuse controls, and route
response mechanics are C3c scope, but C3b-3 must not return raw SQL errors,
identifiers, expiry, lock state, attempt count, stored key version, or repository
category through the request service result.

## Discovery and stored key rotation

Discovery is internal, nonlocking, and non-authoritative. It accepts only the
32-byte request-token hash and exact purpose. It returns at most one row whose
request hash/purpose match, normalized email is present, delivery succeeded,
delivery did not fail, no lock/supersession/verification/consumption exists, and
expiry is greater than `clock_timestamp()`.

The only returned metadata is challenge UUID, nullable enrollment-grant UUID,
normalized email, stored email pseudonym, and stored OTP HMAC key version. It
never returns OTP HMAC, request hash, failure count, or state timestamps. None
of this metadata is browser/client output.

The stored `otp_hmac_key_version` comes only from the protected challenge row.
TypeScript selects exactly that version from the retained OTP keyring. It never
accepts a browser/client version, falls back to the active version, or tries
multiple OTP keys. A missing stored version produces sanitized internal
unavailability, no verification RPC, and no failed attempt.

Discovery's challenge UUID is only HMAC-preparation metadata. Any state may
change after discovery. The owner verify core re-resolves and revalidates all
authority. Stale discovery yields generic rejection or unavailability and can
never authorize a state transition.

## Owner verification-core contract

### Common validation and authoritative challenge checks

The verify core first requires purpose exactly `enrollment` or `login`, a
32-byte request hash, a 32-byte candidate OTP HMAC, and a valid complete alias
array of cardinality `1..64`. Invalid static input returns `false` without a
failure-ledger mutation.

For both purposes, the core performs a nonlocking challenge lookup by unique
request-token hash and purpose solely to discover protected metadata needed for
parent-first ordering. It later locks the authoritative challenge row and
revalidates request hash, purpose, grant nullability, normalized email,
pseudonym alias membership, delivered-only state, no delivery failure, no lock,
no supersession, no prior verification/consumption, and unexpired status. The
candidate HMAC comparison occurs only after all current purpose-specific
authority checks succeed.

`decided_at := clock_timestamp()` is captured exactly once immediately after
the authoritative challenge row is locked. Success updates `verified_at` to
that value. A wrong HMAC first rechecks the existing one-hour alias failure cap,
then appends exactly the next attempt with `failed_at = decided_at`. Existing
triggers remain the sole authority for contiguous attempts and atomic fifth
failure locking/scrubbing.

### Enrollment verification lock and authority order

The enrollment branch performs this exact order:

1. static input/alias validation;
2. relation locks:
   `ghl_marketplace_installations` `ROW SHARE`,
   `every8d_settings_enrollment_grants` `ROW SHARE`,
   `every8d_settings_auth_challenges` `ROW EXCLUSIVE`, then
   `every8d_settings_auth_challenge_failures` `ROW EXCLUSIVE`;
3. nonlocking challenge lookup by request hash and `enrollment` purpose to
   discover challenge/grant/email/pseudonym metadata;
4. nonlocking grant lookup by the discovered grant UUID solely to discover its
   parent identity;
5. exact installation parent row `FOR SHARE`;
6. exact grant row `FOR SHARE`;
7. current installation/generation eligibility revalidation and grant
   revalidation: same UUID, same locked installation UUID/generation as the
   preliminary locators, unrevoked, unconsumed, unexpired, and, when pinned,
   pinned normalized email equal to the protected challenge normalized email;
8. complete alias advisory locks through the existing sorted lock function;
9. authoritative challenge row `FOR UPDATE` selected by request hash and then
   fully revalidated against the already locked grant and input purpose/aliases;
10. capture `decided_at`, recheck grant/installation time-sensitive state,
    compare OTP HMAC, and perform exactly one verified transition or one failure
    append as allowed by existing rate/fifth-failure rules.

Grant revocation or consumption that locks first causes rejection. Verification
that holds the grant share lock first may linearize before the later grant
transition. Resend uses the same parent/grant then alias/challenge order.

### Login verification lock and authority order

The login branch performs this exact order:

1. static input/alias validation;
2. acquire the complete alias advisory-lock set;
3. relation locks:
   `ghl_marketplace_installations` `ROW SHARE`,
   `every8d_settings_administrators` `ROW SHARE`,
   `every8d_settings_auth_challenges` `ROW EXCLUSIVE`, then
   `every8d_settings_auth_challenge_failures` `ROW EXCLUSIVE`;
4. nonlocking challenge lookup by request hash and `login` purpose to discover
   normalized email and stored pseudonym solely as locators;
5. nonlocking lookup of candidate active administrator UUIDs and their exact
   installation UUID/generation where normalized email matches and both stored
   challenge/admin pseudonyms are exact members of the supplied alias set;
6. in an explicit loop ordered by installation UUID then generation, lock each
   distinct candidate installation row `FOR SHARE`;
7. in an explicit loop ordered by administrator UUID, lock each preliminary
   candidate administrator row `FOR SHARE`;
8. lock the authoritative challenge row selected by request hash `FOR UPDATE`;
9. capture `decided_at` and fully revalidate the challenge live-state fields;
10. require at least one of the already locked administrator rows still to be
    unrevoked, to retain the exact challenge normalized email and alias-bound
    pseudonym, and to bind the exact currently locked installation/generation;
11. require that installation still has current `INSTALL` lifecycle,
    `pending` or `active` status, non-null company, exact current generation,
    EVERY8D/SMS identity, and current registration/version eligibility; and
12. only then compare OTP HMAC and perform one verified transition or allowed
    failure append.

The candidate lists are locators, never authority. Newly inserted candidates
after preliminary discovery may be ignored, causing safe false rejection.
Revocation/lifecycle mutation that wins a row lock causes final revalidation to
fail. Verification that wins the share locks can linearize before a later
revocation/disable/generation transition. Supported administrator-revocation and
future C3c mutation paths must lock installation parent before administrator,
matching C3a parent-first behavior. No verification can succeed only because an
administrator was valid at request or discovery time.

Alias locking serializes login verification with login resend/supersession.
Challenge-row and failure-ledger locking serializes concurrent correct/wrong and
fifth-failure races. Relation locks coexist with rollback by causing one side to
wait or fail under its lock timeout rather than observe partially removed
authority.

## Verification orchestration and disclosure

The route-free service verification sequence is:

1. feature check; disabled returns `disabled` with zero side effects;
2. validate purpose, parse/hash raw request capability, and normalize OTP;
3. call discovery once;
4. no row maps to `rejected`;
5. validate discovery shape and select exactly its stored OTP key version;
6. derive the candidate HMAC using discovery UUID and reconstruct the complete
   historical email-pseudonym alias array from discovery normalized email;
7. require the discovery pseudonym to be in that array;
8. call the four-argument runtime verify wrapper exactly once; and
9. map database `true` to an internal verified reference and `false` to
   `rejected`.

Malformed capability/purpose/OTP maps to the same internal `rejected` outcome
and causes no DB mutation. TypeScript never counts attempts,
locks challenges, verifies administrator/grant/install authority, or duplicates
terminal-state logic.

The service never reveals administrator/account/grant/challenge existence,
expiry, locked/superseded state, attempt number, stored key version, SQLSTATE,
function/constraint name, raw SQL message, or database error object.

On success, C3b-3 may return an immutable internal reference containing
challenge UUID and purpose only. It deliberately omits normalized email,
pseudonym, grant UUID, key version, and request hash. It is not a bearer token or
durable authority. C3c must add an atomic owner-core contract that relocks the
VERIFIED challenge and consumes it with grant/admin/session behavior in one
transaction.

## Delivery boundary and crash behavior

C3b-3 does not accept or call an `Every8dSettingsEmailDelivery` implementation.
It only prepares an `Every8dSettingsEmailDeliveryRequest`-compatible command.
C3c owns durable outbox persistence, sender/provider selection, dispatch leases,
actual delivery, recovery, and provider idempotency.

This crash window is explicitly accepted:

1. C3b-3 commits a PENDING_DELIVERY challenge; and
2. the process crashes before C3c durably records or sends its command.

The orphan is not delivered, cannot verify because `delivery_succeeded_at` is
absent, is never automatically sent or retried, is not scanned at startup, and
is not resumed after an ambiguous restart. A later explicit challenge request
may supersede it under existing resend/rate-limit rules; otherwise it expires.
Existing C3b-1 scrubbing later removes expired normalized identity, and existing
cleanup remains separately scheduled maintenance. C3b-3 owns no scheduler.

Delivery results remain exactly:

- unambiguous provider acceptance -> success;
- definitive rejection -> `provider_rejected`;
- no usable sender before an attempted send -> `sender_unavailable`; and
- a send that may have crossed the provider boundary without authoritative
  result -> terminal `delivery_outcome_unknown`.

`delivery_outcome_unknown` is terminal and never retried. A new email requires a
new explicitly requested challenge. The record service calls the runtime wrapper
once. Database `true` maps to `recorded`; database `false` maps to
`not_recorded`, including duplicate, expired, missing, or terminal results. No
retry loop, state inference, reopen, or resend follows `false` or an ambiguous
repository error.

## Feature flag

The only flag is `EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED`. There is no alias or
second activation flag. When disabled, every service method returns `disabled`
before input validation, entropy, repository/client calls, delivery preparation,
database access, or verification mutation. Import and construction cause no
database/delivery action. Strict C3b-2 configuration validation may still reject
supplied malformed/partial HMAC configuration; it never activates the feature.

## TypeScript repository API

The repository exposes exactly five typed methods and no generic RPC method.
Its failure taxonomy is closed and exhaustive:

```ts
type Every8dSettingsAuthRepositoryFailureCategory =
  | "repository_unavailable"
  | "repository_contract_violation";

type RepositoryFailure = Readonly<{
  outcome: "failure";
  category: Every8dSettingsAuthRepositoryFailureCategory;
}>;

type RequestRepositoryResult =
  | Readonly<{ outcome: "prepared"; challenge: ChallengeCreationMetadata }>
  | Readonly<{ outcome: "not_prepared" }>
  | RepositoryFailure;

type DeliveryRepositoryResult =
  | Readonly<{ outcome: "recorded" }>
  | Readonly<{ outcome: "not_recorded" }>
  | RepositoryFailure;

type DiscoveryRepositoryResult =
  | Readonly<{ outcome: "discovered"; challenge: LiveChallengeMetadata }>
  | Readonly<{ outcome: "not_found" }>
  | RepositoryFailure;

type VerificationRepositoryResult =
  | Readonly<{ outcome: "verified" }>
  | Readonly<{ outcome: "rejected" }>
  | RepositoryFailure;

type Every8dSettingsAuthRepository = {
  requestEnrollmentChallenge(input: {
    enrollmentGrantTokenHash: Buffer;
    challengeId: string;
    normalizedEmail: string;
    emailPseudonym: string;
    emailPseudonymAliases: readonly string[];
    requestTokenHash: Buffer;
    otpHmac: Buffer;
    otpHmacKeyVersion: string;
  }): Promise<RequestRepositoryResult>;

  requestLoginChallenge(input: {
    challengeId: string;
    normalizedEmail: string;
    emailPseudonym: string;
    emailPseudonymAliases: readonly string[];
    requestTokenHash: Buffer;
    otpHmac: Buffer;
    otpHmacKeyVersion: string;
  }): Promise<RequestRepositoryResult>;

  recordChallengeDelivery(input: {
    requestTokenHash: Buffer;
    succeeded: boolean;
    failureClass: Every8dSettingsEmailDeliveryFailureClass | null;
  }): Promise<DeliveryRepositoryResult>;

  discoverLiveChallenge(input: {
    requestTokenHash: Buffer;
    purpose: Every8dSettingsAuthPurpose;
  }): Promise<DiscoveryRepositoryResult>;

  verifyChallenge(input: {
    requestTokenHash: Buffer;
    purpose: Every8dSettingsAuthPurpose;
    emailPseudonymAliases: readonly string[];
    candidateOtpHmac: Buffer;
  }): Promise<VerificationRepositoryResult>;
};
```

`ChallengeCreationMetadata` is exactly non-null challenge UUID, creation time,
and expiry. `LiveChallengeMetadata` is exactly the five discovery columns with
only `enrollmentGrantId` nullable. Repository input validation covers UUIDv4,
byte lengths, purpose, aliases, failure class, and key-version grammar.
Repository output validation maps zero request rows to `not_prepared`, one valid
row to `prepared`, and multiple rows or any malformed successful payload to
`repository_contract_violation`.

PostgreSQL `bytea` uses one canonical lowercase `\\x` hex encoding boundary.
The only repository failure meanings are:

- `repository_unavailable`: RPC/database transport failure, timeout,
  disconnect, database execution error, database-returned error, or any other
  failure to produce a trustworthy normal result; and
- `repository_contract_violation`: transport completed successfully but the
  purportedly successful payload violates the frozen repository contract,
  including wrong cardinality, a missing field, invalid field type or shape, or
  an impossible representation.

No repository method exposes or throws an `unknown` category, free-form
`string`, raw `Error`, Supabase error, or SQL error to orchestration. Underlying
database/RPC causes are discarded completely, not retained in a service-facing
object or nested cause. The two category values contain no raw message,
SQLSTATE, input, email, pseudonym, request/grant hash, challenge identifier,
OTP, key, HMAC, function name, constraint name, or existence distinction.

### Repository result matrix

| Method | Normal results | Failure results | No other result |
| --- | --- | --- | --- |
| `requestEnrollmentChallenge` | one valid row -> `prepared`; zero rows -> `not_prepared` | `repository_unavailable`; `repository_contract_violation` | Required |
| `requestLoginChallenge` | one valid row -> `prepared`; zero rows -> `not_prepared` | `repository_unavailable`; `repository_contract_violation` | Required |
| `recordChallengeDelivery` | DB `true` -> `recorded`; DB `false` -> `not_recorded` | either category remains `failure` | Required |
| `discoverLiveChallenge` | one valid row -> `discovered`; no row -> `not_found` | either category remains `failure` | Required |
| `verifyChallenge` | DB `true` -> `verified`; DB `false` -> `rejected` | either category remains `failure` | Required |

Expected domain-negative states are normal SQL/RPC results, never exceptions
that require message inspection. The request wrappers/cores return zero rows for
no eligible login identity, an absent/unusable enrollment grant, or another
nondisclosing no-preparation decision. Discovery returns no row for an absent or
non-live challenge. Delivery and verification return `false` for their frozen
negative states. Unexpected execution/transport failures alone map to
`repository_unavailable`; malformed successful payloads alone map to
`repository_contract_violation`.

If an existing owner-only helper signals a frozen expected negative internally,
the new owner core contains and translates that signal to its normal zero-row or
boolean result by the exact reviewed helper contract; neither wrapper nor
repository may parse exception message text to infer domain state.

## Route-free service API

```ts
type Disabled = Readonly<{ outcome: "disabled" }>;
type Recorded = Readonly<{ outcome: "recorded" }>;
type NotRecorded = Readonly<{ outcome: "not_recorded" }>;
type Rejected = Readonly<{ outcome: "rejected" }>;
type Unavailable = Readonly<{ outcome: "unavailable" }>;
type VerifiedChallenge = Readonly<{
  outcome: "verified";
  challengeId: string;
  purpose: Every8dSettingsAuthPurpose;
}>;

requestEnrollmentChallenge(input: {
  enrollmentGrantTokenHash: Buffer;
  email: unknown;
}): Promise<Disabled | Every8dSettingsChallengeRequestAccepted>

requestLoginChallenge(input: {
  email: unknown;
}): Promise<Disabled | Every8dSettingsChallengeRequestAccepted>

recordChallengeDelivery(input: {
  deliveryHandle: Every8dSettingsChallengeDeliveryHandle;
  result: Every8dSettingsEmailDeliveryResult;
}): Promise<Disabled | Recorded | NotRecorded | Unavailable>

verifyChallenge(input: {
  requestCapability: unknown;
  purpose: Every8dSettingsAuthPurpose;
  otp: unknown;
}): Promise<Disabled | Rejected | Unavailable | VerifiedChallenge>
```

There are no Express request/response objects, HTTP status codes, cookies, or
CSRF types. Request methods have no externally consumable failure distinction.
Discovery is private to verification. There is no OTP/capability retrieval,
challenge listing, attempt inspection, or generic persistence escape hatch.

### Exhaustive service mapping

Request enrollment and login map repository results exactly as follows:

| Repository result | Service result |
| --- | --- |
| `prepared` | `{ outcome: "accepted", deliveryCommand: Every8dSettingsPreparedChallenge }` |
| `not_prepared` | `{ outcome: "accepted", deliveryCommand: null }` |
| failure / `repository_unavailable` | `{ outcome: "accepted", deliveryCommand: null }` |
| failure / `repository_contract_violation` | `{ outcome: "accepted", deliveryCommand: null }` |

This mapping intentionally suppresses operational distinctions to preserve the
synchronous non-enumeration boundary. Monitoring may record only the closed
non-secret category and cannot alter the service result.

Delivery recording maps `recorded` to `{ outcome: "recorded" }`,
`not_recorded` to `{ outcome: "not_recorded" }`, and either repository failure
category to `{ outcome: "unavailable" }`. It performs no automatic repository
retry and no provider resend.

Verification discovery maps `discovered` to continued candidate preparation,
`not_found` to `{ outcome: "rejected" }`, and either repository failure category
to `{ outcome: "unavailable" }`. A retained OTP key version absent after a valid
discovery also maps to `unavailable`; the service tries no other key and exposes
no more specific category.

The verification RPC maps `verified` to `VerifiedChallenge`, `rejected` to
`{ outcome: "rejected" }`, and either repository failure category to
`{ outcome: "unavailable" }`. No other verification result exists.

A future C3c verification route may internally receive `verified`, `rejected`,
or `unavailable`, but must not expose repository/database internals or
existence-bearing detail. Its precise HTTP mapping remains C3c contract scope.
These per-method mappings are exhaustive; no service method invents another
outcome or passes a repository category through its return value.

## Migration contract

The migration begins exactly with:

```sql
begin;
set local lock_timeout = '5s';
```

It then takes `SHARE ROW EXCLUSIVE` relation locks in this exact order:

1. `public.ghl_marketplace_installations`;
2. `public.every8d_settings_enrollment_grants`;
3. `public.every8d_settings_administrators`;
4. `public.every8d_settings_auth_challenges`; and
5. `public.every8d_settings_auth_challenge_failures`.

Before creating any authority, it fails closed unless:

- database encoding is exactly UTF8;
- required relations exist:
  `ghl_marketplace_installations`, `ghl_marketplace_app_registrations`,
  `ghl_marketplace_app_version_registrations`,
  `every8d_settings_enrollment_grants`, `every8d_settings_administrators`,
  `every8d_settings_sessions`, `every8d_settings_auth_challenges`, and
  `every8d_settings_auth_challenge_failures`;
- those relations have the expected one common trusted owner where established
  by C3a/C3b-1, the current trusted migration role is that owner, and the
  migration captures that exact role OID as `trusted_common_owner_oid` before
  creating any function;
- roles `anon`, `authenticated`, and `service_role` exist before any REVOKE or
  GRANT is attempted;
- required existing exact signatures exist with that owner and exact security
  properties/search path:
  `assert_every8d_settings_installation_eligible_v1(uuid,integer)` definer,
  `is_every8d_settings_canonical_email_v1(text)` invoker,
  `is_every8d_settings_email_pseudonym_v1(text)` invoker,
  `every8d_settings_email_lock_word_v1(text)` invoker,
  `lock_every8d_settings_email_pseudonyms_v1(text[])` definer,
  `assert_every8d_settings_challenge_rate_limits_v1(text[],uuid,timestamptz)`
  definer, and
  `record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)` definer;
- every dependency in the preceding list has exactly
  `SET search_path = pg_catalog, public`; no absent, reordered, additional, or
  user-controlled search-path entry is accepted;
- these exact security-relevant trigger-function signatures exist, have the
  common owner, are definer functions, and use fixed `pg_catalog, public`
  search path:
  `protect_every8d_settings_enrollment_grant_v1()`,
  `protect_every8d_settings_administrator_v1()`,
  `invalidate_every8d_settings_auth_v1()`,
  `protect_every8d_settings_auth_challenge_v1()`,
  `protect_every8d_settings_auth_challenge_failure_v1()`,
  `lock_every8d_settings_challenge_on_fifth_failure_v1()`,
  `assert_every8d_settings_challenge_integrity_v1()`, and
  `invalidate_every8d_settings_challenges_for_grant_v1()`;
- the exact protection, lifecycle/grant-invalidation, fifth-failure, and both
  deferred integrity triggers exist on their expected relations, are enabled,
  and target those exact functions;
- direct table privileges and existing owner-function EXECUTE remain absent for
  `PUBLIC`, `anon`, `authenticated`, and `service_role`, with RLS enabled and no
  policies on all C3a/C3b-1 tables; and
- neither `PUBLIC` nor `anon`, `authenticated`, or `service_role` has `CREATE`
  on schema `public`.

Each of the eight target names must have zero existing overloads in schema
`public`; checking only the intended signature is insufficient. Any target name
or exact signature already present causes conflict refusal before DDL. The
migration does not use `CREATE OR REPLACE`; reapplication therefore fails closed
without changing privileges or definitions.

After creation, it revokes all eight functions from `PUBLIC`, `anon`,
`authenticated`, and `service_role`, then grants EXECUTE on exactly the five
runtime signatures to `service_role`.

Before commit, a fail-closed `pg_catalog` postflight must resolve all eight exact
signature OIDs and prove:

1. all eight OIDs exist and each exact signature resolves once;
2. every `pg_proc.proowner` is identical;
3. that one owner OID equals captured `trusted_common_owner_oid`;
4. all eight have `prosecdef = true` (`SECURITY DEFINER`);
5. every `proconfig` encodes exactly `search_path=pg_catalog, public`, with no
   absent, reordered, additional, or user-controlled entry;
6. none is owned by `service_role`, `anon`, `authenticated`, or any untrusted
   role; `PUBLIC` is not an owning role and receives no privilege; and
7. ACLs expose exactly five wrapper EXECUTEs to `service_role`, no core EXECUTE
   to `service_role`, and no EXECUTE to `PUBLIC`, `anon`, or `authenticated`.

Any missing OID, owner mismatch, property mismatch, or ACL mismatch raises and
rolls back the entire migration. The migration does not rely on PostgreSQL's
creation-owner default. It adds no table grant, policy, column, constraint,
index, trigger, or row.

Production application, if later authorized, is manual and migration-specific.
`supabase db push` is not an authorized production strategy. The flag stays off
through migration and dormant-code rollout.

## Privilege summary

- All eight new functions: owned by exactly `trusted_common_owner_oid`.
- `service_role`: owns none and has EXECUTE on exactly five runtime wrappers.
- Owner cores: no `service_role`, `PUBLIC`, `anon`, or `authenticated` EXECUTE.
- Existing C3a/C3b-1 owner functions: unchanged and not directly executable by
  `service_role`.
- C3a/C3b-1 tables: no direct application grants.
- RLS: remains enabled, unforced, and policy-free; trusted definer ownership is
  the table-access mechanism.

## Rollback contract

Rollback is transactional, sets `lock_timeout = '5s'`, revokes EXECUTE on all
five runtime wrappers from `service_role`, `PUBLIC`, `anon`, and `authenticated`,
then drops exact signatures without `CASCADE` in this dependency-safe order:

1. `runtime_verify_every8d_settings_challenge_v1(bytea,text,text[],bytea)`;
2. `runtime_discover_every8d_settings_challenge_v1(bytea,text)`;
3. `runtime_record_every8d_settings_challenge_delivery_v1(bytea,boolean,text)`;
4. `runtime_request_every8d_settings_login_challenge_v1(uuid,text,text,text[],bytea,bytea,text)`;
5. `runtime_request_every8d_settings_enrollment_challenge_v1(bytea,uuid,text,text,text[],bytea,bytea,text)`;
6. `verify_every8d_settings_challenge_core_v2(bytea,text,text[],bytea)`;
7. `request_every8d_settings_login_challenge_core_v2(uuid,text,text,text[],bytea,bytea,text)`; and
8. `request_every8d_settings_enrollment_challenge_core_v2(bytea,uuid,text,text,text[],bytea,bytea,text)`.

Rollback verifies expected ownership before revocation/drop and refuses an
unexpected dependency or definition. It uses no `CASCADE`, `DELETE`, or
`TRUNCATE`, needs no populated-row guard because the functions own no rows, and
preserves all C3a/C3b-1 functions, triggers, tables, challenges, failures,
administrators, grants, and sessions.

## Secrets and logging

Never log or include in errors the raw request capability, raw OTP, HMAC keys,
OTP HMAC, grant token/hash, normalized email, email pseudonym, request-token
hash, challenge/grant/admin/session identifier, stored key version, OAuth token,
provider credential, RPC arguments, SQLSTATE, database message, or raw response.

The only repository failure metadata values permitted are exactly
`repository_unavailable` and `repository_contract_violation`. No free-form or
third category is allowed. The only optional operational metadata is a fixed
operation name, one of those two closed categories, and a coarse success/failure
outcome, and only when it contains no prohibited identity or secret value.

Do not log a raw error message, SQLSTATE, function argument, RPC payload,
Supabase error object, SQL error object, or nested cause. Raw database/RPC causes
are discarded completely at the repository boundary and never reach a default
serializer, service-facing structure, or structured logger. Attempt number is
not logged.

## Later implementation proof plan

### TypeScript proof

- Real C3b-2 primitive orchestration with a mocked narrow repository for both
  request types, stored-key verification, historical aliases, and purpose
  separation.
- `crypto.randomUUID()` output is lowercase canonical v4/RFC variant, accepted
  by the C3b-2 UUID parser, generated server-side only, and has no injectable
  production factory or fallback.
- Disabled mode causes zero input, entropy, repository, delivery, or mutation
  operations.
- Every valid/invalid request disposition returns `accepted` and only varies the
  internal optional command; a future external adapter fixture maps every case
  to the same status/body/header/cookie contract.
- Repository RPC names, exact named arguments, canonical bytea encoding, strict
  return schemas, null/no-row/false mappings, and raw-error suppression.
- Repository transport error, database/RPC error, timeout, and disconnect each
  map only to `repository_unavailable`; malformed successful payload, wrong
  cardinality, missing field, unexpected field type/shape, and impossible
  representation each map only to `repository_contract_violation`.
- No raw database message, SQLSTATE, Supabase/SQL error object, raw cause,
  argument, or RPC payload escapes the repository or appears in logs.
- Request mapping proves: prepared -> accepted/command; no identity, invalid or
  unusable grant, repository unavailable, and repository contract violation ->
  accepted/null; the future external status/body/headers/cookie fixture is
  identical for all cases.
- Delivery mapping proves: true -> recorded; false -> not_recorded; either
  repository failure -> unavailable; and no retry or provider resend.
- Discovery/verification mapping proves: discovery row continues; no row ->
  rejected; either discovery failure -> unavailable; missing retained OTP key ->
  unavailable; verify true -> verified; verify false -> rejected; either verify
  failure -> unavailable; and no raw error disclosure.
- Stored OTP version exact selection, missing-version fail closed, no try-all,
  malformed input, delivery outcomes, duplicate false, and no retries.
- Secret-redaction tests cover primitive, repository, service, and structured
  logging paths.
- Run `npm run typecheck`, focused tests, `npm test`, and `npm run build`.

### PostgreSQL 17 disposable-database proof

Migration/ACL proof:

- every listed preflight failure: missing/wrong-owner relation, missing or
  wrong-security/search-path function, missing/disabled trigger, non-UTF8,
  widened ACL/RLS policy, untrusted public CREATE, and conflicting target name;
- exact eight signatures, argument names/order/types/defaults and returns; all
  eight OIDs have one owner OID equal to captured `trusted_common_owner_oid`;
  wrapper owners equal core owners; `service_role` owns none; and every function
  has exact definer mode and fixed search path;
- exactly five `service_role` EXECUTE grants, zero core EXECUTE grants, zero
  direct table grants, and no `PUBLIC`/`anon`/`authenticated` runtime access;
- reapplication conflict refusal and no privilege widening.

Request proof:

- valid enrollment and login; invalid/nonexistent grant and no-account generic
  behavior; grant-token-hash resolution; pinned-email mismatch; revoked admin;
  stale generation; disabled/uninstalled installation; historical pseudonym
  rotation; every rate limit; and resend supersession;
- v1/v2 parity for all unchanged validations, time capture, expiry, rate-limit
  thresholds/decisions, supersession, and concurrency behavior, plus proof that
  the explicit expected-negative delta returns zero rows without message parsing;
- request/discovery races prove discovery sees either no row or a complete
  committed live row, never partial authority.

UUID/capability proof:

- explicit v4/RFC UUID acceptance and wrong-version/variant rejection;
- UUID primary-key and request-capability-hash collision roll back all
  supersession/insertion effects;
- no field-only retry and no retry after ambiguous RPC result.

Delivery proof:

- success, `provider_rejected`, `sender_unavailable`, terminal
  `delivery_outcome_unknown`, duplicate result, and no retry;
- crash after committed challenge before durable delivery leaves an
  unverifiable orphan, startup performs no resend, explicit later request safely
  supersedes under rate limits, and ordinary expiry/scrub behavior remains.

Discovery/verification proof:

- request/discovery and discovery/verify races; correct/incorrect OTP; missing
  stored key; exact stored-version selection; no try-all; purpose separation;
  five failures; concurrent fifth failure; verify replay; expiry; supersession;
  grant revoke/consume races;
- login verify races against administrator revocation, installation disable,
  uninstall, generation change, concurrent resend, expiry, concurrent correct
  verification, concurrent wrong verification, and concurrent fifth failure;
- backend/lock evidence proves no success relies only on stale discovered or
  request-time administrator authority and confirms the exact relation, parent,
  administrator/grant, alias, challenge, and failure ordering.

Enumeration proof:

- prepared, invalid input, no administrator/account/grant, rate limit,
  collision, sanitized DB error, and ambiguous RPC result all map to the same
  future external accepted fixture with no existence-bearing field/message.

Rollback proof:

- clean rollback, populated-row preservation, exact dependency-safe removal,
  no destructive data action, no `CASCADE`, and complete C3a/C3b-1 preservation.

No production database or provider is used.

## Production and phase boundary

No production action is authorized. A later approved rollout must apply the
reviewed wrapper/core migration manually, prove ACLs, deploy dormant code with
the flag false, and complete C3c outbox, consumption, administrator, and session
contracts before a separate activation decision. Keys are provisioned only
through an approved secret channel.

Challenge consumption, enrollment-grant redemption, administrator creation, and
settings-session issuance remain C3c. Durable outbox/provider integration remains
C3c. A transient C3b-3 verified reference cannot replace those atomic database
contracts.

## Contract resolution

The initial independent review's three high and three medium blocking findings
remain resolved. The final re-review's two medium blocking ambiguities are also
resolved: all eight new functions have one explicit trusted common owner with a
fail-closed owner-OID/property postflight, and repository/service failures use
one closed two-value taxonomy with exhaustive per-method mappings.

There are no unresolved C3b-3 security or concurrency contract questions. The
contract is ready for final independent re-review and does not authorize
implementation.
