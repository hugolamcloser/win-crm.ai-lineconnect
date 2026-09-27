# EVERY8D HighLevel OAuth refresh database foundation (C1a)

## Boundary

C1a changes only the PostgreSQL persistence contract. It does not implement a
working refresh runtime. The distinction is explicit:

- `PERSISTED_REFRESH_TOKEN`: encrypted HighLevel access/refresh credentials are
  durably present and governed by the database state machine.
- `WORKING_REFRESH_RUNTIME`: a future C1b worker decrypts a claimed refresh
  token, calls HighLevel, validates the response, encrypts the rotated pair, and
  finalizes or burns the claim. C1a contains none of this behavior.

No scheduler, reconciler refresh, request-time refresh, token endpoint call,
provider activation, EVERY8D call, or SMS send is enabled. Phase 2F remains
disabled. LINE is not involved.

## Durable state machine

`ghl_marketplace_installations` gains a monotonic `credential_revision` and one
of four `credential_state` values:

- `none`: no encrypted OAuth credentials and no lease or failure authorization.
- `usable`: one complete encrypted credential tuple may be claimed when due.
- `refreshing`: the exact revision is held by one server-generated lease.
- `reauth_required`: a terminal refresh failure or ambiguous outcome burned the
  stored pair; both encrypted tokens and all refresh authority are scrubbed.

Lease identity, start, expiry, sanitized failure class/time, and last successful
refresh time are durable. Check constraints require complete credential, lease,
and failure tuples. The installation protection trigger preserves immutable
ownership, lifecycle chronology, generation safety, and LINE-provider
separation while rejecting malformed refresh transitions.

Existing credential-free rows backfill to `none`, revision `0`. Existing rows
with non-empty encrypted access and refresh tokens, a valid key version, finite
expiry, and non-empty non-blank scopes backfill to `usable`, revision `1`,
without modifying ciphertext. Any partial tuple makes the migration fail before
schema mutation. A pre-C1a row that retained credentials despite accepted
`UNINSTALL` evidence also fails preflight instead of being classified usable.

The authorization-code finalization signature and all of its existing
eligibility checks remain unchanged. Its SQL definition is replaced only to
advance the credential revision, classify the new pair as `usable`, and clear
any older refresh lease atomically with credential persistence. The guarded
rollback restores the exact pre-C1a definition. The legacy direct
credential-persistence signature remains compatible through the installation
protection trigger. Both paths support future reauthorization from
`reauth_required` without replaying a burned token; reauthorization during an
older refresh claim advances the revision and invalidates that lease.

## Claim and due rule

`claim_every8d_ghl_oauth_refresh_v1` accepts the exact installation, app,
OAuth client, tenant, Location, company, Conversation Provider, approved
Marketplace version, and current installation generation. Registration tables
and the locked installation row are authoritative; browser ownership input is
never sufficient.

The due window is fixed in SQL: expiry must be within five minutes or already
past. Callers cannot widen it. A successful row-locked claim changes
`usable -> refreshing`, retains revision `N`, creates a unique UUID lease, and
sets a five-minute lease. It returns only the identifiers, revision, lease,
encrypted refresh token, key version, and scopes required by a future C1b
worker. It never decrypts or returns plaintext.

Two workers serialize on the installation row. Only the first usable revision
can become refreshing; the second receives no claim. A second claim while the
lease is live also returns no claim.

## Single-use rotation and ambiguity

HighLevel refresh tokens are treated as rotating and single-use. A lease is
never returned to `usable`. If a lease expires without a known outcome, the next
exact claim attempt atomically changes it to `reauth_required`, records
`refresh_outcome_unknown`, scrubs both encrypted tokens/key/expiry/scopes, and
returns no claim. A late finalize after lease expiry performs the same burn and
fails. There is no automatic replay.

`fail_every8d_ghl_oauth_refresh_v1` accepts only:

- `invalid_grant`
- `token_response_rejected`
- `refresh_outcome_unknown`
- `credential_persistence_failed`

It requires the exact current generation, revision, and lease. Every accepted
failure is terminal, clears the lease, scrubs the credential pair, and requires
application/user reauthorization. In particular, `invalid_grant` is not retried.

## Finalize CAS

`finalize_every8d_ghl_oauth_refresh_v1` revalidates the same exact ownership,
registration, version, lifecycle, status, generation, prior revision, and lease
under a row lock. A successful CAS replaces both encrypted tokens, key version,
expiry, and exact scopes in one transaction; changes revision `N` to `N + 1`;
returns to `usable`; clears lease/failure state; and records the successful
refresh time. The old durable refresh token ceases to be current in that same
transaction. Duplicate or stale finalization returns false.

## UNINSTALL race

The existing `apply_every8d_ghl_marketplace_lifecycle_v2` signature and ordering
semantics are unchanged. Its existing credential scrub is extended by the
installation trigger in the same transaction:

- Claim, then UNINSTALL, then finalize: UNINSTALL advances/invalidate the
  generation, clears credential and lease authorization, and late finalize
  fails.
- Claim, finalize, then UNINSTALL: finalize may win exactly once, after which
  UNINSTALL clears the newly rotated pair and lease authorization.

Reinstall creates a new generation in `none`; an old generation/revision/lease
cannot finalize or be claimed by it.

## Privileges and rollback

RLS stays enabled. `anon` and `authenticated` receive neither table nor RPC
access. `service_role` receives EXECUTE only on the three narrow refresh RPCs;
no direct update grant exists for refresh columns. Because the historical
table-level installation UPDATE grant would automatically cover additive
columns, C1a narrows it to the five existing authorization-code credential
columns. Functions are `SECURITY DEFINER` with a fixed `pg_catalog, public`
search path.

The guarded rollback restores the pre-C1a v4 installation trigger and removes
only C1a objects. It refuses if any revision advanced beyond the migration
baseline, any lease evidence exists (active or expired), state is `refreshing`
or `reauth_required`, a successful refresh time exists, or refresh failure
evidence exists. It therefore cannot silently discard real refresh-runtime
history.
On a safe rollback, the historical pre-C1a table-level UPDATE grant is restored
only after the evidence guard passes.

Migration: `supabase/migrations/202609270001_every8d_ghl_oauth_refresh_foundation.sql`

Guarded rollback: `supabase/rollback/202609270001_every8d_ghl_oauth_refresh_foundation.sql`

Neither migration nor rollback is applied to production by C1a.
