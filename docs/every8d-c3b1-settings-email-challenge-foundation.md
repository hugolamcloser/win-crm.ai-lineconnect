# EVERY8D C3b-1 settings email challenge foundation

## Boundary

C3b-1 is a database-only foundation. It stores request and OTP digests, enforces
challenge authority transitions, serializes accepted email-pseudonym aliases,
and retains an append-only failure ledger. It does not create administrators or
settings sessions, normalize email in TypeScript, send email, parse keyrings,
expose routes, call EVERY8D, or provide application-role execute grants.

The two new tables are:

- `every8d_settings_auth_challenges`
- `every8d_settings_auth_challenge_failures`

Both have RLS enabled without FORCE RLS, have zero policies, and deny all table
privileges to `PUBLIC`, `anon`, `authenticated`, and `service_role`. All C3b-1
functions are owner-only. A later reviewed phase must add narrow runtime wrappers.

## Canonical identity

`is_every8d_settings_canonical_email_v1(text)` validates but never transforms.
It accepts only the frozen ASCII dot-atom local-part and already-lowercase DNS
label contract under `COLLATE "C"`. Active C3a administrator emails and live,
unconsumed pinned grant emails are checked once, at one captured migration time.
Incompatible active data aborts the whole migration; historical data is not
rewritten.

Email history uses pseudonyms in `<version>:<64 lowercase hex>` form. Accepted
aliases are validated before locking, deduplicated byte-for-byte, projected with
SHA-256 over the frozen domain separator, deduplicated again by signed lock word,
sorted ascending, and locked with namespace `1163278404`. Full pseudonyms remain
the history-query predicates, so a projected collision only adds serialization.

## Authority and failure ledger

The challenge checks and protection trigger admit only pending-delivery, live,
delivery-failed, locked, superseded, verified, and consumed combinations. Expiry
is derived and exclusive. Authority changes at or after expiry are rejected.
Expired pending/live/verified rows may have only their email fields scrubbed and
cannot regain authority.

Failures are append-only attempts 1 through 5. Each insert locks its challenge
and must equal the existing ledger count plus one. Attempt five sets `locked_at`
and scrubs the email in the same transaction. Deferred constraint triggers prove
at commit that attempts are contiguous and ordered, five failures exist exactly
when the challenge is locked, and the fifth timestamp equals `locked_at`.

## Owner-only operations

The migration provides owner-only primitives for enrollment requests, login
requests, delivery recording, nonlocking handle discovery, verification,
expired-email scrubbing, and 30-day cleanup. Request functions apply the frozen
creation and failure windows while all accepted aliases are locked. Verification
compares the supplied 32-byte HMAC with PostgreSQL `bytea` equality while holding
the challenge row lock; no constant-time claim is made.

Enrollment requests lock installation parent, then grant, then pseudonym aliases,
then challenge history. Login requests lock aliases, installation relation,
administrator relation, challenge relation, then failure relation. Discovery is
a separate nonlocking primitive so callers can end that short transaction before
entering a lock-ordered request or verification transaction.

Grant revocation or consumption supersedes only unexpired pending/live enrollment
siblings. A verified/consumed winner and all other terminal or expired history are
preserved, which keeps the boundary compatible with the later C3c atomic wrapper.

## Concurrency proof

The PostgreSQL 17 harness uses unique `c3b_<run-id>_<scenario>_<role>` application
names, transaction-scoped advisory barriers, bounded wait loops, and native Linux
FIFOs. It records backend IDs, `pg_blocking_pids`, wait events, and relevant
`pg_locks` before releasing each barrier. The frozen matrix covers simultaneous
resend; correct/correct, correct/wrong, and correct/fifth verification; grant
revocation/request and consumption/verification; delivery/resend; cleanup/verify;
all three scrub races; both request/rollback and resend/rollback directions;
discovery relation-lock release; non-authoritative handles; and parent-first grant
lifecycle ordering. `SKIP LOCKED` scenarios prove bounded nonblocking behavior,
then retry after the conflicting transaction releases its row.

The harness trap terminates only its exact application-name prefix, waits for its
own local processes, removes its `mktemp` directory and cloned databases, and
fails if any matching PostgreSQL backend remains.

## Retention and rollback

`scrub_expired_every8d_settings_challenge_emails_v1(integer)` captures one time,
locks at most 500 rows ordered by `(expires_at,id)` with `SKIP LOCKED`, and changes
only `normalized_email` and `email_scrubbed_at`.

`cleanup_every8d_settings_auth_challenges_v1(integer)` locks at most 500 rows by
effective terminal time and deletes failure rows before challenge rows after 30
days. It returns deleted and anomalous counts. There is no scheduler in C3b-1.

Rollback takes the frozen parent-first ACCESS EXCLUSIVE locks and refuses before
destructive DDL when either C3b table contains a row. It uses neither CASCADE nor
data deletion and removes only C3b-owned objects.
