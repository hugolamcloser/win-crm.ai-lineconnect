# EVERY8D C3a settings authentication foundation

## Purpose and boundary

C3a adds only the database and security foundation for WinCRM-owned access to
the EVERY8D settings surface. It does not add browser routes, login challenges,
OTP, email delivery, a dashboard, provider operations, or application-role
execution rights. C3b and later phases remain out of scope.

The migration creates exactly three C3a tables:

- `public.every8d_settings_administrators`
- `public.every8d_settings_enrollment_grants`
- `public.every8d_settings_sessions`

No migration seed creates an administrator, grant, session, email, token, or
provider configuration.

## Data contracts

### Administrators

An administrator is bound to one installation and one positive installation
generation. The composite identity `(id, installation_id,
installation_generation)` is the snapshot referenced by sessions. A partial
unique index allows only one active administrator for an exact
installation/generation/normalized-email tuple while retaining revoked history
for deliberate re-enrollment.

`enrollment_grant_id` is globally unique. One grant can therefore authorize at
most one administrator over its entire lifetime; revoking the administrator
does not recycle the grant. Protection triggers make identity and provenance
fields immutable and permit only a one-way, reasoned revocation transition.
For callback enrollment, the administrator HMAC pair must match the consumed
grant with null-safe equality. The supported redemption function copies this
pair from the locked grant rather than accepting it from a caller.

### Enrollment grants

A grant belongs to one exact installation and generation and stores only a
unique 32-byte token hash. It expires no later than 15 minutes after creation.
Consumed and revoked are mutually exclusive terminal states, and history cannot
be deleted or reactivated.

The methods have disjoint provenance:

- `install_callback` requires an immutable OAuth-bootstrap audit UUID and a
  structurally valid installer-user HMAC/key-version pair. It has no pinned
  operator email or operator audit fields.
- `operator_initial` and `operator_recovery` require a pinned normalized email,
  distinct issuer and approver, case reference, and reason. They cannot carry a
  bootstrap UUID or installer HMAC fields.

The bootstrap UUID has a unique audit constraint but intentionally has no
foreign key to `ghl_marketplace_oauth_bootstraps`. Callback issuance is instead
validated by the protected function described below. Removing that FK avoids
an implicit bootstrap relation lock during C3a rollback.

### Sessions

A session stores only a unique 32-byte token hash. Its composite foreign key to
`(administrator_id, installation_id, installation_generation)` prevents
cross-installation or cross-generation rebinding. Sessions expire after at
most one hour and use an immutable one-way revocation state.

## Owner-only issuance and redemption

All C3a production functions are `SECURITY DEFINER`, use the fixed
`pg_catalog, public` search path, schema-qualify relations, use no dynamic SQL,
and return only identifiers and timestamps.

### Install-callback issuance

```sql
public.issue_every8d_settings_install_callback_enrollment_grant_v1(
  uuid, integer, uuid, bytea, timestamptz, text, text
)
```

The function reads the referenced bootstrap without a row lock and requires a
terminal `succeeded` EVERY8D bootstrap whose claimed installation, claimed
generation, target generation, expected location, and Marketplace version all
match the requested current eligible installation. Succeeded bootstrap
identity is immutable under the existing OAuth protection trigger. The
function then takes the parent installation lock, serializes use of the exact
bootstrap with an advisory transaction lock, rejects reuse, validates the
post-lock lifetime, and inserts the grant with its audit UUID and HMAC pair.
It is not wired into OAuth runtime in C3a.

The non-locking bootstrap read is deliberate: it validates immutable terminal
evidence without creating a bootstrap-row-to-parent wait cycle. Raw owner DML
is an administrative capability, not a supported issuance path.

### Operator issuance

```sql
public.issue_every8d_settings_operator_enrollment_grant_v1(
  uuid, integer, text, bytea, text, timestamptz, text, text, text, text
)
```

The function accepts only the two operator methods. It validates static input,
locks the exact current eligible installation first, then takes a tuple-scoped
advisory transaction lock for installation/generation/email. Only after both
locks does it capture `issued_at` and validate the requested expiry. This
prevents lock waiting from creating an already-expired grant or inverting
creation/revocation timestamps.

Reissue revokes only matching live, unused, unexpired operator grants. Consumed
or expired history and grants for another email, installation, or generation
remain unchanged.

### One-time redemption

```sql
public.redeem_every8d_settings_enrollment_grant_v1(bytea, text, text)
```

Redemption performs a non-locking hash lookup only to discover the parent,
locks and revalidates the exact eligible parent first, then locks and fully
revalidates the grant. It requires the grant to be live and unexpired. Operator
email must equal the pinned email; callback enrollment accepts the verified
email under the future callback contract. In one transaction it marks the
grant consumed and creates exactly one administrator, copying callback HMAC
provenance from the grant. The unique administrator grant key is the final
concurrency backstop.

The supported runtime lock order is therefore:

1. installation parent
2. optional tuple advisory lock
3. C3 child row

## RLS, ownership, and privileges

RLS is enabled but intentionally not forced on all three tables, and no RLS
policies are installed. Direct table privileges and execution of every C3a
function are revoked from `PUBLIC`, `anon`, `authenticated`, and
`service_role`.

The migration requires the executing migration role to own the existing
Marketplace installation, registration, version-registration, and OAuth
bootstrap tables. Objects created by the migration therefore share one
explicit owner. Non-forced RLS gives that table-owning definer deterministic
access without depending on `SUPERUSER` or `BYPASSRLS`; application roles still
have neither table privileges nor callable functions. The PostgreSQL harness
uses a synthetic non-superuser, non-`BYPASSRLS` owner to exercise operator
issuance, lifecycle invalidation, and rollback guards.

## Lifecycle behavior and coexistence

`invalidate_every8d_settings_auth_after_install_update` listens only to parent
`status` and `installation_generation`. It runs when an installation becomes
disabled or uninstalled, or when generation changes. It revokes active
old-generation administrators, unused live grants, and live sessions. Consumed
grant history and already-terminal rows remain unchanged, repeated application
is idempotent, and rows for a new generation are untouched.

The existing C2 trigger is not altered. C2 and C3 execute in the same parent
transaction, so failure in either trigger rolls back the parent mutation and
the other trigger's effects; correctness does not depend on trigger order.
Ordinary C1b credential, lease, expiry, refresh, revision, and failure-state
changes do not update lifecycle status or generation and do not invoke C3.

## Guarded rollback

The rollback takes its final relation lock modes in this order:

1. `ghl_marketplace_installations` — `ACCESS EXCLUSIVE`
2. `every8d_settings_administrators` — `ACCESS EXCLUSIVE`
3. `every8d_settings_enrollment_grants` — `ACCESS EXCLUSIVE`
4. `every8d_settings_sessions` — `ACCESS EXCLUSIVE`

It then refuses if any C3a row exists, before any destructive DDL. The script
contains no `DELETE`, `TRUNCATE`, or `CASCADE`, removes only the C3a trigger from
the parent, and preserves C1/C2 and lifecycle objects. Because the grant table
has no OAuth-bootstrap FK, dropping it does not require FK-trigger teardown on
the bootstrap relation. The final rollback graph is parent, then C3 children,
then guard, then C3-only DDL.

The C2 rollback has a separately recorded child-first ordering concern. It is
out of scope and is not modified by C3a remediation.

## Proof matrix

The PostgreSQL 17 harness is designed to cover:

- schema, constraints, one-sided HMAC failures, method/provenance separation,
  global one-grant/one-administrator enforcement, and composite session binding;
- successful and rejected callback provenance, including cross-installation,
  cross-generation, and non-succeeded bootstraps;
- one-time redemption, different-email rejection, revocation without grant
  recycling, and concurrent same-grant redemption;
- operator reissue isolation, consumed/expired history, and a delayed-lock
  expiry check using backend lock evidence;
- both parent-first redemption/lifecycle orderings, proving the waiting
  redemption holds no conflicting grant row lock;
- six lifecycle races, repeated lifecycle idempotence, terminal-history
  preservation, and generation-2 preservation;
- C2/C3 failure atomicity and C1b refresh non-interference;
- enabled/non-forced RLS, zero policies, all table ACLs, every C3a function ACL,
  and non-superuser/non-`BYPASSRLS` owner behavior;
- absence of the OAuth-bootstrap FK dependency; and
- empty rollback, separate populated grant/administrator/session refusal, and
  both rollback/lifecycle orderings using `pg_blocking_pids`, backend identity,
  wait events, and `pg_locks` rather than timing as correctness evidence.

No production migration is applied by this work. Railway, Phase 2F, EVERY8D,
SMS, LINE, and production credentials remain untouched.
