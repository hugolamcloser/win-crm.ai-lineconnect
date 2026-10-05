# EVERY8D C3a settings authentication foundation

## Purpose and boundary

C3a adds the database and security foundation for WinCRM-owned access to the
EVERY8D settings surface. It does not add a browser route, login challenge,
one-time-password flow, email delivery, dashboard, or provider operation.
WinCRM remains the authority that creates an administrator binding and issues a
server-side session after a later phase has validated an enrollment capability.

The migration creates exactly three C3a tables:

- `public.every8d_settings_administrators`
- `public.every8d_settings_enrollment_grants`
- `public.every8d_settings_sessions`

`public.every8d_settings_login_challenges` is deliberately absent. C3b, C3c,
C3d, C3e, and Phase 2F remain out of scope.

## Data contracts

### Administrators

An administrator is bound to one Marketplace installation and its exact
positive installation generation. A partial unique index permits only one
active row per `(installation_id, installation_generation, normalized_email)`;
revoked history is retained so deliberate re-enrollment can create a new row.
The composite unique identity `(id, installation_id,
installation_generation)` is the authorization snapshot referenced by
sessions. Protection triggers keep authority and enrollment fields immutable
and constrain revocation to a valid one-way transition. The table stores a
normalized email plus a non-secret pseudonym, but no plaintext security token.

### Enrollment grants

An enrollment grant belongs to one exact installation and generation and
stores only a unique 32-byte token hash. The schema supports
`install_callback`, `operator_initial`, and `operator_recovery`; the narrow
operator RPC accepts only the two operator methods. Operator grants must pin a
normalized email and record distinct issuer and approver identities, a case
reference, and a reason. All grants expire after at most 15 minutes. Consumed
and revoked states are mutually exclusive, immutable terminal states, so
reissuance retains history instead of deleting it.

### Sessions

A session stores only a unique 32-byte token hash. Its composite foreign key to
`(administrator_id, installation_id, installation_generation)` prevents a
session from crossing either installation or generation boundaries. Sessions
expire after at most one hour and have a structurally constrained one-way
revocation state.

No migration seed inserts an administrator, email, token, grant, session, or
provider configuration. A fresh application was proven to leave all three C3a
tables at zero rows.

## Owner-only operator issuance

The migration installs this owner-only `SECURITY DEFINER` function:

```sql
public.issue_every8d_settings_operator_enrollment_grant_v1(
  uuid, integer, text, bytea, text, timestamptz, text, text, text, text
)
returns table(grant_id uuid, created_at timestamptz, expires_at timestamptz)
```

It uses the fixed `pg_catalog, public` search path and schema-qualified object
references. It rejects `install_callback`, non-32-byte hashes, missing or
malformed pinned email, missing audit fields, identical issuer and approver,
and expiries longer than 15 minutes. It locks and validates the exact eligible
installation and current generation first, then takes a tuple-scoped advisory
transaction lock for the installation/generation/email reissue key. In one
transaction it revokes older, unconsumed, unrevoked, unexpired matching
operator grants and inserts the replacement. It neither deletes history nor
touches another email, installation, or generation, and returns only the grant
identifier and timestamps.

Execution is revoked from `PUBLIC`, `anon`, `authenticated`, and
`service_role`. The database owner is the intended operator. Raw enrollment
tokens are never accepted or stored by this function.

## Lifecycle behavior and lock order

`public.invalidate_every8d_settings_auth_v1()` is installed as an unexposed
`SECURITY DEFINER` trigger function. Trigger
`invalidate_every8d_settings_auth_after_install_update` fires only after an
update of `status` or `installation_generation` when the installation becomes
disabled/uninstalled or its generation changes. It revokes old-generation
sessions, live unused grants, and active administrators atomically. Failures in
either this C3 trigger or the existing C2 trigger abort the parent lifecycle
transaction, so safety does not depend on trigger execution order.

The frozen runtime order is parent installation first, followed by C3 child
rows. The existing C2 trigger
`invalidate_every8d_provider_cfg_after_install_update` remains unchanged and
coexists in the same parent transaction. Ordinary C1b OAuth refresh changes—
including credential revision, refresh lease/state, token expiry, and refresh
metadata—do not update lifecycle status or generation and therefore do not
invoke C3 invalidation.

## RLS and privileges

Row-level security is enabled and forced on all three C3a tables. No browser
policies are installed. All direct table privileges are revoked from
`PUBLIC`, `anon`, `authenticated`, and `service_role`. Execution of the
operator RPC and all helper, protection, and lifecycle `SECURITY DEFINER`
functions is also revoked from those roles.

## Guarded rollback and lock-order remediation

The rollback is intentionally administrative and blocking. It begins a
transaction, sets a bounded lock timeout, and takes locks in exactly this
order:

1. `public.ghl_marketplace_installations` in `ACCESS EXCLUSIVE` mode
2. `public.every8d_settings_administrators` in `ACCESS EXCLUSIVE` mode
3. `public.every8d_settings_enrollment_grants` in `ACCESS EXCLUSIVE` mode
4. `public.every8d_settings_sessions` in `ACCESS EXCLUSIVE` mode

Only after all four locks are held does it refuse if any C3a row exists. Only
an empty database proceeds to drop the exact C3a lifecycle trigger,
protection triggers, tables, RPC, and helper functions. It contains no
`DELETE`, `TRUNCATE`, or `CASCADE`.

Final security review found that the original draft locked the children before
the later `DROP TRIGGER` implicitly acquired its parent lock. That child-first
path could deadlock with a lifecycle transaction. PostgreSQL 17's
[`RemoveTriggerById`](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/commands/trigger.c)
opens the trigger relation with `AccessExclusiveLock`; the PostgreSQL
[`LOCK` documentation](https://www.postgresql.org/docs/17/explicit-locking.html)
defines that as the mode conflicting with every table lock mode. The corrected
rollback therefore obtains the final required parent mode before any child,
eliminating the later lock upgrade.

The PostgreSQL 17 proof runs both orderings for disable, UNINSTALL, and
generation advance. With rollback first, live lock evidence shows rollback
already owns parent `AccessExclusiveLock` before waiting on the first child and
the lifecycle writer waits on that parent. With lifecycle first, rollback waits
for the parent before acquiring any C3 child relation lock. Advisory locks
provide deterministic observation barriers; `pg_blocking_pids`, backend
identity, wait events, and `pg_locks` establish the actual blocking relation.
Bounded timeouts are safety limits only.

Successful rollback removes only C3a objects. The C2 trigger, table, function,
and policy, C1a/C1b OAuth objects, Marketplace lifecycle v2, and representative
LINE/SMS tables are asserted to survive. Empty rollback passes; populated
rollback refuses before destructive DDL and leaves the schema unchanged.

## Validation

The disposable PostgreSQL 17.11 proof covers schema constraints, RLS/ACL,
function exposure, exact installation/generation binding, operator dual
control, grant/session lifetimes, concurrent same-email reissue, six normal
lifecycle orderings, C2/C3 failure atomicity in both directions, C1b
non-interference, guarded rollback, and the six rollback/lifecycle orderings.
The existing public OAuth, OAuth refresh, and C2 PostgreSQL proofs also pass.

No production migration has been applied. Railway, Phase 2F, EVERY8D, SMS,
LINE, and production credentials are outside this work.
