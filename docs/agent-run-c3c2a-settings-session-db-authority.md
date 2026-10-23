# C3c-2a settings session database authority: implemented for review

## Current result: complete fresh PG17 proof and final regressions PASS

**2026-10-23: PASS — independent C3c-2a implementation review required.** The
single additional target-conflict fixture correction is **1/1 used**. The fresh
complete suite, all ten existing DB regressions, and final repository validation
now pass. Only the focused Python target-conflict case and this evidence log
changed during this cycle. Migration/rollback/function bodies, application code,
shell orchestration and CI bytes were preserved from the prior authorized draft.

### Target-conflict fixture and refusal: PASS

- Conflicting signature:
  `public.runtime_revoke_every8d_settings_session_v1(text)` (not the frozen bytea
  signature). The prior fixture created it as postgres and hit the earlier 42501
  owner guard. The corrected fixture uses the existing `sql(..., role=OWNER)`
  connection; no ALTER OWNER is used.
- Before migration, executable catalog assertions require that exact text
  function, `prokind='f'`, owner `c3a_migration_owner`, equality with the trusted
  common prerequisite relation owner, and absence of all nine exact frozen
  target signatures (including the bytea revoke signature).
- The real migration executes as the normal synthetic migration owner. It
  passes earlier owner prerequisites and reaches the dedicated conflict guard:
  **nonzero exit, SQLSTATE 42723, exact message `C3c-2a target function conflict`**.
  The proof does not accept 42501 or arbitrary errors for this scenario.
- After refusal, **zero exact intended targets** exist. The intentional text
  overload remains with its trusted owner. Full public function/schema catalog,
  prior relation/column/trigger/constraint/policy/default-ACL boundary and five
  settings data snapshots match. No partial function creation, ACL grant,
  privilege change, prerequisite repair or auth-data mutation survives.

Actual output:

```text
PASS target conflict: trusted-owner text overload; exact 42723 conflict message; zero exact targets; overload/catalog/ACL/data unchanged
PASS fail-closed prerequisite target_conflict
```

### Maintenance-lock refusal: PASS

An independent actor obtains ROW EXCLUSIVE on
`public.ghl_marketplace_installations` and remains in its transaction after the
ready marker. The real rollback, as the normal owner, attempts its frozen SHARE
maintenance locks with `lock_timeout='5s'`. It refuses with the explicitly
expected **55P03**; the server diagnostic is `canceling statement due to lock
timeout`. The holder then commits. Exact nine-target retention and unchanged
data snapshots pass. No partial destructive DDL or deadlock occurred. This one
bounded expected maintenance timeout is not an unexpected runtime timeout.

### Complete coherent PG17 run: PASS

New PostgreSQL **17.11** cluster and synthetic roles, loopback only, no failed
fixture reused:
`C:\Users\User\AppData\Local\Temp\wincrm-c3c2a-target-conflict-20261023`.
The complete shell harness ran once and exited zero. `focused.log` contains
barriers, fixture checks, aggregate expiry states and the final PASS;
`server.log` contains expected negative diagnostics. No retries were used.

| Required proof | Current result |
| --- | --- |
| Pgcrypto bootstrap | PASS; extension owner postgres, digest owner postgres, schema extensions, exact bytea/text dependency and extension membership true. No ownership transfer. |
| C3a/C3b common-owner prerequisites | PASS under non-superuser/non-BYPASSRLS c3a_migration_owner. |
| Initial migration / structural / behavior | PASS; exact nine functions, five runtime wrappers/four owner cores, frozen signatures/metadata/ACLs, enrollment/login/auth/logout and atomicity. No new production relation/trigger/index/constraint. |
| Lifecycle authority | Trusted common owner proceeds. anon/authenticated/service_role/postgres mismatches fail closed with zero targets and unchanged prerequisite data/catalog, including tampered ownership. No repair. |
| Preflight tamper | Prior body/trigger/table ACL/RLS/schema and owner-aligned target conflict all PASS refusal. |
| Concurrency | **28 completed runtime barrier cases**: creator/login both orders and same/different installations; same challenge/grant/installation-email consume races; lifecycle/admin/session revocation/auth/logout; both expiry cases. Maintenance refusal is additional, not counted in 28. |
| Isolation | Both consumption wrappers succeed under READ COMMITTED. RR and SERIALIZABLE refuse with 25000 before mutation. |
| Creator/login | Complete alias serialization and post-wait committed candidate visibility PASS in both orders, same and different installations. |
| Lifecycle/revocation | Disable, real UNINSTALL, generation, administrator revocation and auth/logout races PASS in both orders. |
| Expiry setup | Both isolated synthetic UPDATE transactions commit with deferred integrity enabled. Ordinary protection is re-enabled separately; committed visibility, validity, normal pg_trigger states and absence of setup transactions are checked before actors. No 42601 or 55006. |
| Expiry runtime | Real login/auth wrappers reach observed waits, valid before wait, database expiry reached before release, return zero, unchanged snapshots. No stale authority or partial mutation. |
| Deferred COMMIT / collision | Actual deferred COMMIT rejection and login session-token collision PASS; no partial grant/admin/session/challenge mutation. |
| Deadlock/timeouts | No unexpected SQL error, deadlock, lock/statement/process/barrier timeout or retry. Only the deliberately expected bounded maintenance 55P03 occurs. |
| Cleanup | Harness reports zero surviving backends; independent query confirms zero other clients and zero c3c2a_% databases. Final regression databases are also disposed and the fresh server stopped. |

Expiry states after rejection (all values from aggregate runtime output):

| State | Login expiry | Authentication expiry |
| --- | --- | --- |
| Challenge | login, VERIFIED, expired, unconsumed, email retained, unscrubbed, no linked grant | login, VERIFIED, unexpired, unconsumed, email retained, unscrubbed, no linked grant |
| Fixture grant | 1 pre-existing consumed/unrevoked, unchanged | Same |
| Administrator | 1 pre-existing active; none created | Same |
| Session | 1 pre-existing valid/unrevoked; 0 new | 1 pre-existing expired/unrevoked; 0 active-unexpired; 0 new |
| Partial mutation | None | None |

The subsequent intended logout in the auth-expiry case succeeds and persists
revoked_at/reason logout. That final session is expired and revoked, with zero
active-unexpired/new sessions.

### All rollback cases: PASS

| Case | Result |
| --- | --- |
| Clean/pre-use | PASS; removes exactly nine targets, preserves prior authority, reapply PASS. |
| Populated administrator | PASS refusal; nine targets and data preserved. |
| Populated session | PASS refusal; nine targets and data preserved. |
| Consumed challenge | PASS refusal; nine targets and data preserved. |
| Target definition tamper | PASS refusal; nine targets and data preserved. |
| Target owner tamper | PASS nonzero 42501/exact `C3c-2a prior settings authority owner mismatch`; nine targets retained, tampered postgres owner unchanged, full catalog/ACL/prior authority/data preserved. |
| Target ACL tamper | PASS refusal; nine targets and data preserved. |
| Unexpected view dependency | PASS refusal; nine targets and data preserved. |
| Later SQL-body dependency | PASS refusal; nine targets and data preserved. |
| Maintenance locking unavailable | PASS expected bounded 55P03, no partial DDL/data mutation, nine targets retained. |

### Fresh final regression gate: PASS

Only after complete C3c-2a PG17 PASS, a new disposable `wincrm_test` database was
seeded through D3, and these ten unchanged existing harnesses ran in order:

| Harness | Result |
| --- | --- |
| ghlSmsOutboundClaimConcurrency | PASS |
| ghlSmsControlledLiveAuthorizationConcurrency | PASS |
| ghlMarketplaceOwnership | PASS |
| ghlMarketplaceLifecycleOrdering | PASS |
| ghlPublicOAuthBootstrap | PASS |
| ghlOAuthRefreshFoundation | PASS |
| every8dProviderConfigurations | PASS |
| every8dSettingsAuthFoundation | PASS |
| every8dSettingsEmailChallengeFoundation | PASS |
| every8dSettingsAuthOrchestration | PASS |

`regressions.log` and individual `regression-*.log` files in the fresh temporary
root record these results. No historical pass is substituted. Final application
validation also ran after complete PG17 success:

- `npm run typecheck`: PASS.
- `npm test`: **696 tests, 696 pass, 0 fail/cancelled/skipped/todo**.
- `npm run build`: PASS.
- Python AST syntax, this-cycle method scope, unchanged protected bytes and Git
  whitespace validation: PASS.

### Artifact and delivery evidence

Authorized base/head before the delivery commit:
`ef50706d0787bdb5414cc52d7b3f40898138fbd6`;
branch `codex/c3c2a-settings-session-db-authority`.
Fresh origin/main fetch still matches the authorized base. Frozen contract blob
remains `8da38c47f40749219ca7b0260bd3722c198f4346`.

The seven-file implementation diff consists only of the migration, guarded
rollback, SQL behavior proof, shell orchestration, Python concurrency proof,
this run log, and the minimum existing CI staging for the new isolated proof.
No TypeScript or prior migration/rollback changes; C3a redemption remains intact.

| Artifact path | Git blob SHA | Exact bytes | SHA-256 |
| --- | --- | --- | --- |
| supabase/migrations/202610220001_every8d_settings_session_consumption.sql | d524df1908572dc08ccfc1b5fccfe2caba3cf95a | 51981 | d8246cadfb9589f95cd8b56c269418f648b664eaeac080cd1e76912f77a2b354 |
| supabase/rollback/202610220001_every8d_settings_session_consumption.sql | 4a3933bb1ec06ba91963f2fc27e80b0cb213700a | 32341 | 45353d8936b9d94207f9e7eb75911c8bcbccee0a30e8007b71804f84362646bb |
| test/postgres/every8dSettingsSessionConsumption.sql | 7333539900f6c8121d46e39bfa69db015adad19a | 22611 | b84470d32f66e753a4732e635476620e36c2b6518f1d6d7a757350cc1cf67cb1 |
| test/postgres/every8dSettingsSessionConsumption.sh | 130821f5e520370474beba55f8670063d522d235 | 4885 | f5e045fd3f2119cf91d017df6fa667b19b874651d13dab8b06ae881bd577ffda |
| test/postgres/every8dSettingsSessionConsumptionConcurrency.py | 45cafa8931807d9acb1dc9a5cfc91f33c18eb17a | 50544 | 2c7431842c63a52bd0ca58ea88fdaaa8ca9d38510dac35f643133f949efcfd99 |

This evidence snapshot is written before the authorized delivery commit. Exact
staged/committed SQL and proof bytes are checked against this table. The final
commit SHA, push outcome, unmerged PR URL and hosted CI status are reported in
the delivery response rather than introducing a self-referential commit hash.

No production database, deployment, credentials or provider activity was used.
Production/manual environment smoke tests were not performed or authorized.
C3c-2b and C3c-3 remain NOT_STARTED_NOT_AUTHORIZED. No merge is authorized.
Next gate: **INDEPENDENT_C3C_2A_IMPLEMENTATION_REVIEW**.

```text
C3C_2A_TARGET_CONFLICT_PROOF: PASS
C3C_2A_ROLLBACK_PROOF: PASS
C3C_2A_BLOCKER_REMEDIATION: PASS
C3C_2A_DATABASE_AUTHORITY: IMPLEMENTED_FOR_REVIEW
C3C_2A_LOCAL_PG17_PROOF: PASS
C3C_2B: NOT_STARTED_NOT_AUTHORIZED
C3C_3: NOT_STARTED_NOT_AUTHORIZED
PRODUCTION_CHANGES: NONE
NEXT_GATE: INDEPENDENT_C3C_2A_IMPLEMENTATION_REVIEW
```

Prior incomplete attempts below are historical; they are not current final
validation evidence.

## Historical result: authorized rollback owner-proof correction

**2026-10-23: INCOMPLETE — STOP FOR REVIEW.** The one narrow rollback
owner-tamper proof correction is **1/1 used**. The corrected owner proof and all
eight rollback refusal cases passed. The fresh complete suite then stopped at a
new preflight target-conflict expectation mismatch. No further correction was
made. Final regressions, commit, push and PR remain gated on complete PG17 PASS.

### Rollback owner-tamper proof: PASS

Only the proof helper and this evidence log changed in this cycle. No rollback,
migration, shell, CI, application code or frozen contract was modified.

The disposable fixture changes the owner of
`public.runtime_revoke_every8d_settings_session_v1(bytea)` to `postgres`.
The earliest authoritative guard is the shared public settings-function
ownership check in rollback lines 62-65, which emits:

```text
SQLSTATE 42501
C3c-2a prior settings authority owner mismatch
```

The owner case now expects 42501 instead of the later guard's 55000. A narrowly
optional exact-message check enables verbose psql errors only for that call and
requires nonzero execution failure, exact SQLSTATE, and exact stable message.
Arbitrary failures are not accepted. All other cases keep their prior error
expectations. No guards were reordered or weakened.

After refusal, actual assertions established:

- All nine targets remain; complete public function catalog snapshots match,
  including owner, body/metadata and ACL. No wrapper/core was dropped or repaired.
- The deliberately tampered function remains owned by postgres.
- The full prior authority boundary matches, including C3a/C3b/lifecycle
  functions, relation/trigger/constraint/policy metadata and default ACLs.
- All five settings relation data snapshots match: grants, administrators,
  sessions, challenges and challenge failure ledger. No data mutation or partial
  destructive DDL was observed.
- Explicit exact-signature checks retain C3a redemption, C3b verification and
  lifecycle-v2 authority.

Actual output:

```text
PASS owner refusal: nonzero exit; 42501 exact ownership message; nine targets; tampered postgres owner, ACL/catalog and rows unchanged
PASS rollback refuses owner before destructive DDL
```

### Rollback case results in this fresh run

| Case | Result |
| --- | --- |
| Clean/pre-use rollback | PASS; exact nine removed, prior authority retained, reapply PASS. |
| Populated administrator | PASS; refusal, unchanged five-table snapshot, nine targets retained. |
| Populated session | PASS; refusal, unchanged snapshot, nine targets retained. |
| Consumed challenge | PASS; refusal, unchanged snapshot, nine targets retained. |
| Target definition tamper | PASS; refusal, unchanged snapshot, nine targets retained. |
| Target owner tamper | PASS; exact 42501/message and strengthened postconditions above. |
| Target ACL tamper | PASS; refusal, unchanged snapshot, nine targets retained. |
| Unexpected view dependency | PASS; refusal, unchanged snapshot, nine targets retained. |
| Later SQL-body dependency | PASS; refusal, unchanged snapshot, nine targets retained. |
| Maintenance lock unavailable | NOT REACHED; new preflight proof failure precedes this case. |

### New failure: preflight target-conflict expected SQLSTATE mismatch

```text
PASS fail-closed prerequisite prior_body
PASS fail-closed prerequisite prior_trigger
PASS fail-closed prerequisite table_acl
PASS fail-closed prerequisite rls
PASS fail-closed prerequisite schema
PASS zero surviving harness backends
FAIL preflight target_conflict: expected failure contract not observed
```

Diagnosis: the unchanged `target_conflict` fixture creates the text overload
`public.runtime_revoke_every8d_settings_session_v1(text)` using the bootstrap
postgres connection. Its owner is therefore postgres rather than the synthetic
trusted common owner. The unchanged migration's shared prior settings-owner
guard (lines 62-65) detects this first and emits **42501**, with server diagnostic
`C3c-2a prior settings authority owner mismatch`. The unchanged proof expects
**42723** from the later target-conflict guard (line 128). The actual early
fail-closed behavior does not satisfy that proof expectation. Post-refusal
assertions for this case were not reached; no completed target-conflict proof is
claimed. This is newly reached and outside the single owner-rollback correction.

No implementation/security bypass was observed, but the full proof is not PASS.
No new correction, fixture ownership change, migration change or guard reorder
was attempted. STOP FOR REVIEW.

### Complete fresh attempt and final gates

The complete shell proof ran once against a new PostgreSQL **17.11** cluster,
loopback-only, with newly created synthetic roles:
`C:\Users\User\AppData\Local\Temp\wincrm-c3c2a-rollback-contract-20261023`.
`focused.log` records all results/barriers; `server.log` records the exact
diagnostic; `before/` preserves all seven draft files before this cycle.

| Gate | Current result |
| --- | --- |
| Pgcrypto bootstrap / common-owner prerequisites | PASS; extension and digest owners postgres, extensions schema, exact dependency true; prior C3a/C3b migrations PASS. |
| Initial structural/preflight / transactional behavior | PASS. Later preflight prior-body/trigger/ACL/RLS/schema refusals PASS; target-conflict proof FAIL. |
| Lifecycle ownership | Trusted common owner PASS; anon/authenticated/service_role/postgres mismatch rejected, zero targets and unchanged prerequisites. |
| Concurrency | **28 completed barrier cases**; creator/login both orders, same/different installation, consume, lifecycle, administrator/session revocation, auth/logout and both expiry scenarios PASS. |
| Isolation | READ COMMITTED succeeds for both wrappers; RR/SERIALIZABLE refuse without mutation. |
| Expiry | Both committed fixtures retain normal protection/deferred-integrity trigger state before actors; valid before wait, DB expiry reached before release; real wrappers return zero and snapshots unchanged. |
| Exact expiry state | Login: VERIFIED/expired/unconsumed, retained email, no linked grant; existing grant 1 consumed/unrevoked, administrator 1 active, existing session 1 valid, new sessions 0. Auth: VERIFIED/unexpired/unconsumed challenge, same grant/admin counts, existing session 1 expired/unrevoked, active unexpired 0, new 0; intended subsequent logout revokes that session. No partial mutation. |
| Atomic failures | Deferred COMMIT rejection and session collision PASS without partial authority. |
| Unexpected deadlock/timeout | None; no lock, statement, process or barrier timeout. The new SQLSTATE expectation mismatch prevents full success. |
| Full C3c-2a PG17 suite | **FAIL / INCOMPLETE** at preflight target-conflict proof. |
| Ten existing DB regressions | Not run: user section I requires complete PG17 PASS first. |
| Typecheck / npm test / build | Not run under the same gate; no current application test count claimed. Historical 696 is not final evidence. |
| Cleanup | Zero surviving harness backends reported; independent query found zero other clients and zero c3c2a_% databases; fresh server stopped. |
| Scope | This cycle changes Python sql()/rollback owner-proof only and evidence; migration/rollback/shell/SQL behavior/CI bytes preserved. Full draft scope remains seven authorized files. |
| Head/base | ef50706d0787bdb5414cc52d7b3f40898138fbd6 on codex/c3c2a-settings-session-db-authority. |
| Commit/push/PR/hosted CI | None; existing draft remains uncommitted/unpushed, PR not ready. |
| Production / later phases | NONE; C3c-2b and C3c-3 not started/not authorized. |

Unchanged SQL draft byte evidence (not committed artifact evidence):

| Path | Draft Git blob hash | Bytes | SHA-256 |
| --- | --- | --- | --- |
| supabase/migrations/202610220001_every8d_settings_session_consumption.sql | d524df1908572dc08ccfc1b5fccfe2caba3cf95a | 51981 | d8246cadfb9589f95cd8b56c269418f648b664eaeac080cd1e76912f77a2b354 |
| supabase/rollback/202610220001_every8d_settings_session_consumption.sql | 4a3933bb1ec06ba91963f2fc27e80b0cb213700a | 32341 | 45353d8936b9d94207f9e7eb75911c8bcbccee0a30e8007b71804f84362646bb |

```text
C3C_2A_ROLLBACK_PROOF_CORRECTION: INCOMPLETE
C3C_2A_PR: NOT_READY
C3C_2B: NOT_AUTHORIZED
```

The narrowly corrected rollback owner proof passes. Overall required delivery
remains incomplete because of the newly reached target-conflict proof failure.

## Historical result: authorized expiry-fixture transaction correction

**2026-10-23: INCOMPLETE — STOP FOR REVIEW.** The single additional
fixture-only correction is **1/1 used**. Both expiry scenarios now PASS, but the
fresh complete proof reaches a new rollback owner-tamper error-contract failure.
The user's section K stop rule applies. No further correction, final regression
run, commit, push, or PR was performed.

### Expiry fixture transaction boundaries: PASS

The previous shape was `BEGIN; DISABLE protection; UPDATE; ENABLE protection;
COMMIT`. The challenge UPDATE queued the DEFERRABLE INITIALLY DEFERRED
`assert_every8d_settings_challenge_row_integrity` event; the same-transaction
ALTER TABLE ENABLE failed with SQLSTATE 55006 before the deferred event ran.

Only `expiry_races()` in the Python proof changed this cycle. Each synthetic
UPDATE now commits first. A separate psql connection/autocommit statement
re-enables protection before any barrier/runtime actor starts. The login fixture
temporarily disables only `protect_every8d_settings_auth_challenge`; the analogous
session fixture temporarily disables only `protect_every8d_settings_session`.
No deferred integrity trigger is disabled, no replication-role bypass is used,
and both setup commits succeeded with normal deferred integrity checking.

Separate-session assertions verified no live earlier actor or open setup
transaction, committed fixture visibility, exact ID/request identity/purpose,
VERIFIED and successful delivery state, canonical retained email/alias, null
consumed/locked/superseded values, empty failure ledger, ordered timestamps,
exact intended near-future expiry and original ten-minute/one-hour lifetime.
Before each race, pg_trigger assertions required the five relevant ordinary and
deferred integrity triggers to be normally enabled (`tgenabled='O'`) with their
expected deferrability, and no disabled constraint trigger on the five settings
relations. Both cases emitted FIXTURE_READY only after these assertions passed.

### Real expiry runtime proof: PASS (2/2)

Both real runtime wrappers reached their barriers. The committed fixture was
live before the wait, blocking was established through pg_blocking_pids/pg_locks,
the observer waited for current database time to reach expiry, and the barrier
was then released. Each wrapper returned zero rows. Exact authority snapshots
before/after rejection matched; there was no partial mutation. The unchanged
`AS decision_at` / `t.decision_at` syntax produced no 42601, and the corrected
transaction boundaries produced no 55006.

| State after rejection | Login challenge expiry | Existing session expiry |
| --- | --- | --- |
| Challenge | login, VERIFIED, expired, unconsumed, email retained, unscrubbed, no linked grant | login, VERIFIED, unexpired, unconsumed, email retained, unscrubbed, no linked grant |
| Fixture enrollment grant | One pre-existing consumed, unrevoked grant; unchanged | One pre-existing consumed, unrevoked grant; unchanged |
| Administrators | One pre-existing active administrator; none created | One pre-existing active administrator; none created |
| Sessions | One pre-existing unexpired/unrevoked session; zero new sessions | One pre-existing expired/unrevoked session, zero active unexpired sessions; zero new sessions |
| Partial authority from rejected call | None | None |

After the session-expiry rejection/snapshot check, the intended logout succeeded
and persisted `revoked_at` with reason `logout`. Its final session count remained
one, expired and revoked; active-unexpired and new-session counts remained zero.

### New failure: rollback owner-tamper expected SQLSTATE mismatch

The fresh run completed clean empty rollback/reapply and definition-tamper
refusal, then stopped with:

```text
PASS separate clean database: apply, empty rollback, exact nine removed, reapply
PASS rollback refuses definition before destructive DDL
PASS zero surviving harness backends
FAIL rollback refuses owner: expected failure contract not observed
```

The owner fixture transfers only the disposable target
`runtime_revoke_every8d_settings_session_v1(bytea)` to postgres. The harness
unconditionally expects 55000 for this rollback refusal. The server instead
reports `C3c-2a prior settings authority owner mismatch`: the earlier shared
preflight tests all public `%every8d_settings%` function owners and raises
**42501** at rollback lines 62-65. This includes the newly tampered target and
runs before the later target-specific owner/ACL guard (55000). Thus rollback
refuses early, but the proof's expected error contract is not met. This is a
newly reached proof/guard-order mismatch, not permission to revise either file.
The subsequent per-case snapshot/target-count assertions were not reached;
no claim is made that this owner case completed its refusal proof.

No migration, rollback, function body, lock graph, frozen behavior, TypeScript,
shell harness or CI file changed in this cycle. The failure is diagnosed only.

### Fresh run evidence and delivery gates

Fresh PostgreSQL **17.11**, new data directory and roles, loopback only:
`C:\Users\User\AppData\Local\Temp\wincrm-c3c2a-expiry-boundary-20261023`.
The complete shell proof was invoked once; `focused.log` contains the full
barrier evidence and aggregate EXPIRY_STATE / POST_LOGOUT_STATE output, and
`server.log` contains the refusal diagnostic. No failed fixture was reused.

| Required result | This fresh attempt |
| --- | --- |
| Pgcrypto bootstrap | PASS; extension/digest owners postgres, schema extensions, exact dependency true; no ownership transfer. |
| Common-owner C3a/C3b prerequisites | PASS. |
| Structural/preflight / behavior SQL | PASS for initial migration and transactional enrollment/login/auth/logout behavior. Later preflight tamper matrix not reached. |
| Lifecycle owner proof | Trusted owner proceeds; anon/authenticated/service_role/postgres mismatches reject, zero targets and unchanged prerequisite data/catalog authority. |
| Completed concurrency cases | **28 barrier cases**, including both expiry cases. |
| Isolation | Both consume wrappers succeed under READ COMMITTED; RR and SERIALIZABLE refuse without mutation. |
| Creator/login | Both orderings and same/different installation scenarios PASS. |
| Lifecycle/revocation/auth/logout | Completed disable, uninstall, generation, administrator-revocation and auth/logout races PASS. |
| Atomic failure proof | Actual deferred COMMIT rejection and login session collision PASS, no partial authority. |
| Deadlocks/timeouts | None unexpected; no lock, statement, process or barrier timeout. New rollback error-contract mismatch remains a suite failure. |
| Clean pre-use rollback | PASS; exact nine removed, prerequisites retained, reapply PASS. |
| Tampered/populated rollback | Definition tamper PASS; owner tamper fails expected error contract. ACL/dependency/later/populated cases and maintenance refusal not reached. |
| Complete C3c-2a PG17 result | **FAIL / INCOMPLETE** at rollback owner-tamper proof. |
| Ten existing DB regressions | Not rerun: user section J requires complete PG17 PASS first. |
| Typecheck / npm test / build | Not rerun under the same gate; historical 696/696 is not current final evidence. |
| Cleanup | Harness reports zero surviving backends; independent catalog check finds zero other client backends and zero c3c2a_% databases; disposable server stopped. |
| Branch / head / base | codex/c3c2a-settings-session-db-authority; head/base ef50706d0787bdb5414cc52d7b3f40898138fbd6. |
| Current cycle scope | Python expiry method and this evidence log only; prior draft SQL/shell/CI/behavior-proof bytes preserved. |
| Delivery | Seven authorized draft files remain uncommitted/unpushed; no PR opened, no hosted CI triggered. |
| Production / later phases | No production action; C3c-2b and C3c-3 not started/not authorized. |

```text
C3C_2A_EXPIRY_FIXTURE_REMEDIATION: INCOMPLETE
C3C_2A_PR: NOT_READY
C3C_2B: NOT_AUTHORIZED
```

The expiry fixture repair itself passes. Overall delivery remains incomplete
because of the new rollback-proof failure. STOP FOR REVIEW; no additional
correction cycle is inferred.

## Historical result: final authorized proof-bootstrap attempt

**2026-10-22: INCOMPLETE — STOP FOR REVIEW.** The user authorized one final
test/bootstrap-only correction. That attempt is **1/1 used**. Bootstrap and the
lifecycle-owner blocker proof now pass, but the expiry fixture raises a new
55006 error. Section M requires stopping; no further correction was made.

### PGCRYPTO BOOTSTRAP: PASS

The previous inconsistent fixture installed pgcrypto as `c3a_migration_owner`
while trusted-extension member `digest(bytea,text)` belonged to `postgres`.
It then attempted relocation as the synthetic owner and failed.

Only `test/postgres/every8dSettingsSessionConsumption.sh` changed for this attempt:

1. A fresh disposable database is created with the synthetic settings owner.
2. The privileged disposable `postgres` connection installs pgcrypto before the
   prerequisite migration loop. No extension/member ownership transfer occurs.
3. Before C3b-1, that same bootstrap connection ensures `extensions`, grants
   schema USAGE to the synthetic settings owner, and moves pgcrypto from public
   to extensions using the existing C3b-1 harness pattern.
4. An executable check verifies the exact `extensions.digest(bytea,text)`
   signature, bytea return type, pgcrypto extension membership (`deptype='e'`),
   expected extension schema, and absence of the old public overload.
5. All prior settings migrations and C3c-2a still execute under the synthetic
   non-superuser/non-BYPASSRLS settings authority owner.

Actual fresh PG17 output:

```json
{"schema":"extensions","digest_owner":"postgres","extension_owner":"postgres","exact_digest_dependency":true}
```

Both extension and digest owners are `postgres`; neither needs to match settings
authority. C3a/C3b prerequisite application and the new C3c-2a migration plus
transactional behavior SQL completed successfully. Migration/rollback bytes
were not changed and contain no extension-owner-equals-settings-owner requirement.

### BLOCKER 1: PASS in the fresh executable proof

- Normal lifecycle-v2 owner equals the trusted common relation owner: migration
  proceeded, nine targets existed, prerequisite rows/catalog boundary unchanged.
- Lifecycle-v2 owner tampered to **anon**: migration failed closed; **zero** of
  the nine target functions existed after rejection.
- The prerequisite row snapshots and complete prior catalog boundary were
  identical after refusal, including the intentionally tampered function owner.
  No repair occurred; the fixture was later disposed.
- Additional mismatches to authenticated, service_role and postgres also
  rejected with zero targets and unchanged prerequisites.
- The exact common-owner lifecycle check and prior metadata fingerprints are
  unchanged from the previous remediation.

### BLOCKER 2: syntax correction preserved; expiry proof still FAIL

The previous 42601 cause was bare `at` as the derived column alias. The current
`AS decision_at` / `t.decision_at` SQL remained byte-for-byte unchanged in this
attempt and parsed past that previous failure. No 42601 occurred.

The first login-expiry fixture then failed at the protection-trigger re-enable:

```text
test/postgres/every8dSettingsSessionConsumptionConcurrency.py:424
ALTER TABLE public.every8d_settings_auth_challenges
  ENABLE TRIGGER protect_every8d_settings_auth_challenge;

SQLSTATE 55006
cannot ALTER TABLE "every8d_settings_auth_challenges" because it has pending trigger events
```

Diagnosis: the preceding fixture UPDATE queues the existing
`assert_every8d_settings_challenge_row_integrity` constraint trigger, which is
DEFERRABLE INITIALLY DEFERRED (C3b-1 migration lines 814-817). The fixture then
attempts ALTER TABLE in the same transaction before those events have completed.
PostgreSQL rejects that DDL. Classification: **new expiry proof-fixture defect**,
not a demonstrated runtime consume/auth failure or contract contradiction.

No helper/production correction was attempted. The fixture transaction failed
before COMMIT and before the expiry barrier or real expiry runtime call.
Consequently the required post-expiry challenge/grant/administrator/session
state and rejection result are **NOT ESTABLISHED**. There are **0 completed
expiry cases**. A read-only observer collected no post-expiry state because the
cases did not reach that point. Harness cleanup disposed all proof databases;
that disposal is not counted as an expiry authority proof.

### Full fresh run and final delivery gate

| Required result | This attempt |
| --- | --- |
| Fresh environment | New PostgreSQL 17.11 data directory, synthetic roles, loopback only. No failed fixture was reused. |
| Pgcrypto bootstrap / exact dependency | PASS; owners/schema/check recorded above. |
| Structural/preflight / behavior SQL | Initial migration and transactional structure/enrollment/login/auth/logout behavior proof PASS. |
| Lifecycle trusted owner / anon tamper | PASS; rejected migration left zero targets and unchanged prerequisites. |
| Completed concurrency case count | **26** completed barrier cases; both expiry cases incomplete/unexecuted. |
| READ COMMITTED / RR / SERIALIZABLE | Both consume wrappers succeeded in RC; RR and SERIALIZABLE refused with unchanged authority snapshots. |
| Creator/login proof | Both orders and same/different installation cases passed, including post-wait committed-candidate visibility. |
| Lifecycle and revocation races | Disable, real UNINSTALL, generation, admin revoke and auth/logout races passed in both orders. |
| Deadlocks/timeouts | No unexpected deadlock or lock/statement/process timeout in completed cases. Full suite nevertheless FAILS on 55006. |
| Complete PG17 suite | **FAIL at first expiry fixture; no success claim.** |
| Deferred COMMIT failure / dedicated login collision | Not reached. |
| Clean/pre-use and populated/tampered rollback | Not reached in this fresh run; prior historical results are not substituted. |
| Ten existing DB regressions | Not rerun: section L permits only after complete PG17 PASS. |
| Typecheck / application test count / build | Not rerun for the same gate. Historical 696/696, typecheck/build results below are not current final evidence. |
| Cleanup | Zero other client backends and no remaining `c3c2a_%` databases verified; fresh server stopped. |
| Changed-file scope this attempt | Shell proof bootstrap and this evidence log only. No focused Python helper changes. |
| Preserved bytes | Migration, rollback, all nine function bodies, existing behavior SQL, concurrency helper and CI unchanged this attempt. |
| Commit / push / PR / hosted CI | None. Branch HEAD remains `ef50706d0787bdb5414cc52d7b3f40898138fbd6`. |
| Production / C3c-2b / C3c-3 | NONE / NOT_STARTED_NOT_AUTHORIZED / NOT_STARTED_NOT_AUTHORIZED. |

The original seven draft files remain uncommitted on
`codex/c3c2a-settings-session-db-authority`. No unrelated tracked modification
appeared. Shell syntax and `git diff --check` passed. Current shell working-file
evidence: 4885 bytes; SHA-256
`f5e045fd3f2119cf91d017df6fa667b19b874651d13dab8b06ae881bd577ffda`.

Current local evidence directory:
`C:\Users\User\AppData\Local\Temp\wincrm-c3c2a-bootstrap-final-20261022`.
`focused.log` records the actual owner, isolation and 26 barrier results;
`server.log` supplies the exact 55006 error; `before/` preserves this attempt's
starting draft. No committed artifact evidence exists.

```text
C3C_2A_PROOF_BOOTSTRAP_REMEDIATION: INCOMPLETE
C3C_2A_BLOCKER_REMEDIATION: INCOMPLETE
C3C_2A_LOCAL_PG17_PROOF: FAIL_EXPIRY_FIXTURE_55006
C3C_2A_PR: NOT_READY
C3C_2B: NOT_AUTHORIZED
C3C_3: NOT_STARTED_NOT_AUTHORIZED
PRODUCTION_CHANGES: NONE
NEXT_GATE: REVIEW_EXPIRY_FIXTURE_PENDING_TRIGGER_FAILURE
```

## Previous result: one additional authorized remediation cycle (historical)

**2026-10-22: INCOMPLETE — STOP FOR REVIEW.** The user explicitly authorized
one additional cycle beyond the ordinary 2/2 budget, limited to the two reported
blockers. That exception is now **1/1 used**. A new prerequisite bootstrap
failure stopped validation; no additional correction was attempted.

Before edits, the branch/worktree/HEAD and all five recorded SQL/proof artifact
hashes matched the preceding report exactly. The existing tracked CI diff was
unchanged and no unrelated tracked modification appeared. The previous local
server was confirmed stopped. Original draft bytes were preserved in the new
temporary evidence directory; no drafted work was discarded.

### Blocker 1: lifecycle-v2 trusted owner

- Previous faulty predicate checked ownership only for settings-named functions:
  `(p.proname like '%every8d_settings%' or
  p.proname='every8d_settings_email_lock_word_v1') and p.proowner<>trusted_owner`.
  Lifecycle-v2 was outside that predicate, and owner-normalized ACL fingerprints
  did not recover its concrete owner identity.
- The migration and its duplicated rollback prerequisite now require the exact
  lifecycle-v2 regprocedure to have `p.prokind='f'` and
  **`p.proowner=trusted_owner`**, where `trusted_owner` is the same verified common
  relation owner. They also explicitly check SECURITY DEFINER, fixed search_path,
  PL/pgSQL, volatility, null-input, parallel and leakproof metadata. The existing
  full fingerprint still checks exact signature/arguments/return/ACL/body metadata.
- Neither artifact alters lifecycle-v2 or repairs its ownership. No production
  `ALTER OWNER` was added.
- Focused real migration tests were added for the normal common owner and
  mismatches to anon/authenticated/service_role/postgres, including zero-target
  and unchanged prerequisite data/schema assertions.
- **Actual ownership-tamper result this cycle: NOT REACHED.** The new bootstrap
  error occurred before C3c-2a migration application. The number remaining after
  an expected rejected migration is therefore **NOT ESTABLISHED**; zero target
  functions from an unexecuted migration is not treated as a successful refusal.

### Blocker 2: expiry fixture syntax

- Exact cause: bare `at` was used as the column alias in
  `(select clock_timestamp()+interval '2 seconds' at) t`; PostgreSQL parsed the
  incomplete syntax and returned 42601.
- Exact correction: use `AS decision_at` and `t.decision_at` in both expiry
  fixtures and the already-reported matching consumed-challenge fixture.
- The same real wrappers, two-second DB-time boundary, barriers and zero-row
  result assertions remain. Added assertions require a committed live fixture
  before the wait and identical auth-relation snapshots after expiry rejection,
  before the separately intended expired-session logout mutation.
- **Repaired expiry result / post-rejection data state: NOT REACHED / UNPROVEN**
  in the fresh run. No expired-authority success claim is made.

### New failure and diagnosis

The test-only prerequisite setup was changed to create authority under the
synthetic common owner from the outset, without repairing an existing lifecycle
function's owner. Clones retain that database owner. This is needed for the
strict ownership precondition, but the setup change introduced a new proof defect:

```text
test/postgres/every8dSettingsSessionConsumption.sh:55-56
psql_owner ...
  create schema extensions;
  alter extension pgcrypto set schema extensions;

ERROR: must be owner of function digest
```

The fresh run stopped while moving pgcrypto, before C3b-1 and before any C3c-2a
application/proof. A separate minimal disposable metadata fixture confirmed:

| Object | Actual owner |
| --- | --- |
| pgcrypto extension installed by the synthetic DB owner | `c3a_migration_owner` |
| extension member `public.digest(bytea,text)` | `postgres` |

Thus extension ownership did not supply the member-function ownership required
by that relocation statement. Classification: **proof/harness bootstrap ownership
defect introduced by the remediation's fixture setup**, not a proven frozen
contract contradiction. The statement was not retried or worked around. The
diagnostic database was dropped after the metadata query.

The diagnosing-bugs skill was read. Its reproduction/hypothesis phases reused
the already-confirmed prior owner-tamper and SQL-parser repros; broader hypothesis
exploration was omitted because the user restricted this cycle to those exact
known causes. The new failure was diagnosed with object metadata only.

### Fresh validation and delivery status

| Required item | Current-cycle result |
| --- | --- |
| Environment | Fresh PostgreSQL 17.11 cluster, new data directory, loopback only; synthetic non-superuser owner. |
| Full C3c-2a PG17 proof | **FAIL during prerequisite bootstrap**; exact error above. |
| Migration/owner-tamper structural proof | Not reached. |
| Full behavior SQL / concurrency harness | Not reached; **0 completed concurrency cases this cycle**. |
| Isolation / creator-login / lifecycle / auth / logout / expiry | Not reached this cycle. Earlier results below are historical only. |
| Clean and populated/tampered rollback proof | Not reached this cycle. |
| Deadlocks / lock, statement or process timeouts | None observed before setup failed; complete runtime proof is not established. |
| Backend/database cleanup | Zero other client backends and no remaining `c3c2a_%` databases confirmed after cleanup. Fresh server stopped. |
| Existing ten DB regressions | Not rerun after the new failure, per the mandatory stop rule. Prior attempt passed all ten. |
| Typecheck / application tests / build | Not rerun this cycle; no final commit attempted. Prior attempt passed typecheck, 696 tests and build. |
| Static checks | Shell and Python syntax passed; `git diff --check` passed. |
| Scope | Five remediation files: migration, rollback, focused shell/Python proofs, this log. Same seven total draft files remain uncommitted. |
| Invariants | All nine SQL function bodies byte-equivalent after text reading; original behavior SQL and CI file unchanged in this cycle. C3a/application TypeScript unchanged. |
| Commit / push / PR / hosted CI | None; branch HEAD remains `ef50706d0787bdb5414cc52d7b3f40898138fbd6`. |
| Production / C3c-2b / C3c-3 | No production changes; both later slices unstarted and unauthorized. |

Current evidence directory:
`C:\Users\User\AppData\Local\Temp\wincrm-c3c2a-remediation-20261022`.
`focused.log` contains the failed fresh run; `before/` preserves pre-remediation
draft bytes. These are disposable local evidence, not committed artifacts.

| Remediated draft path | Bytes | SHA-256 of current working bytes |
| --- | ---: | --- |
| `supabase/migrations/202610220001_every8d_settings_session_consumption.sql` | 51981 | `d8246cadfb9589f95cd8b56c269418f648b664eaeac080cd1e76912f77a2b354` |
| `supabase/rollback/202610220001_every8d_settings_session_consumption.sql` | 32341 | `45353d8936b9d94207f9e7eb75911c8bcbccee0a30e8007b71804f84362646bb` |
| `test/postgres/every8dSettingsSessionConsumption.sh` | 2885 | `db6651fc6a7ef6d08111f4107a533eae9196fb57f14ca5d21ea934ce337c0468` |
| `test/postgres/every8dSettingsSessionConsumptionConcurrency.py` | 38618 | `56c14309185f970a776622d27a19f8d53fa3d28d9d6112a39592ad750e0f2f76` |

```text
C3C_2A_BLOCKER_REMEDIATION: INCOMPLETE
C3C_2A_LOCAL_PG17_PROOF: FAIL_PREREQUISITE_BOOTSTRAP
C3C_2A_PR: NOT_OPENED_OR_NOT_READY
C3C_2B: NOT_AUTHORIZED
C3C_3: NOT_STARTED_NOT_AUTHORIZED
PRODUCTION_CHANGES: NONE
NEXT_GATE: REVIEW_NEW_PROOF_BOOTSTRAP_FAILURE
```

## Previous attempt record (historical; current result above supersedes it)

## Task identification

- Task: implement C3c-2a only, from the user's attached authorization.
- Base and unchanged branch HEAD: `ef50706d0787bdb5414cc52d7b3f40898138fbd6`.
- Branch: `codex/c3c2a-settings-session-db-authority`.
- Worktree: `C:\Users\User\.codex\worktrees\c3c2a-settings-session-db-authority\win-crm.ai-lineconnect-pilot00`.
- Date: 2026-10-22, Asia/Kuala_Lumpur.
- Authority: local/disposable database implementation/proof only, with commit,
  push and an unmerged PR conditional on clean local proof.
- State: **DRAFT, UNCOMMITTED, STOPPED_FOR_REVIEW**. Not implementation approval.

## Task objective

Add the nine frozen settings challenge consumption/session authority functions,
guarded pre-use rollback, focused PostgreSQL 17 proofs, and minimal CI staging.
Application TypeScript, LINE, production, C3c-2b and C3c-3 remain outside scope.

## Current hypothesis and blocking evidence

The draft authority passed the completed transactional and concurrency cases.
Subsequent stop-state diagnosis also confirmed a separate **implementation
defect** in prerequisite ownership validation: the draft migration accepted a
clean synthetic prerequisite clone after lifecycle-v2's owner was changed to
`anon`. The function fingerprint normalizes the owner's ACL identity, while
the explicit owner check covers settings-named functions only. Consequently,
ownership drift in `apply_every8d_ghl_marketplace_lifecycle_v2` is not rejected.
The duplicated prerequisite guard in migration and rollback needs review.
The disposable tamper clone was dropped after the audit; no correction was made.

The integrated proof stopped at its first expiry fixture, before deferred
COMMIT failure and rollback-refusal cases were reached. Its SQL uses the bare
alias `at` in `(select clock_timestamp()+interval '2 seconds' at) t`, which
PostgreSQL parses as incomplete syntax. A separate read-only parse check
reproduced `42601`. This specific failing step is a **proof/harness defect**.
The ownership audit above independently demonstrates an implementation defect.
Neither finding establishes a frozen-contract contradiction.

Affected helper locations: lines 396, 406 and 482 in
`test/postgres/every8dSettingsSessionConsumptionConcurrency.py`. The first is
the executed failure; the other two contain the same uncorrected syntax pattern.
The likely next correction is an explicit non-keyword column alias and matching
references, followed by the full proof. That correction was **not made** because
the two permitted implementation correction loops had already been used.

## Files inspected

| File | Reason / finding |
| --- | --- |
| `AGENTS.md` and user-supplied global working agreements | Planning, scope, proof requirements and correction-loop stop rule. |
| `docs/every8d-c3c-settings-auth-contract.md` | Frozen consumption/session boundary; verified expected Git blob. |
| C3a, C3b-1 and C3b-3 migrations and rollback | Existing protected redemption, challenge transitions, locks and ownership conventions. |
| Existing PostgreSQL harnesses | Synthetic owner, isolated databases, rollback and independent-session conventions. |
| `.github/workflows/ci.yml` | New proof must follow C3b-3 and be excluded from the earlier wildcard apply. |
| `docs/taiwan-sms-pilot-plan.md`, `docs/agent-run-log-template.md` | Pilot boundaries and evidence format. |

## Evidence discovered

| Evidence | Result |
| --- | --- |
| Fresh `git fetch origin` before worktree creation | `origin/main` exactly `ef50706d0787bdb5414cc52d7b3f40898138fbd6`. |
| Frozen contract blob | Exactly `8da38c47f40749219ca7b0260bd3722c198f4346`. |
| Migration ID / later authority check | No existing `202610220001` migration or later settings/lifecycle authority on that main. |
| New phase worktree and exact branch | Created from the exact required base; historical/C3b-3/C3c-1 worktrees untouched. |
| Native installed PostgreSQL | Client present, server catalog files missing; not usable for initdb. |
| Disposable runtime | Official EDB PostgreSQL 17.11 portable runtime, initialized in temporary storage, loopback `127.0.0.1:55432`; no production connection. |
| Trusted owner | Synthetic `c3a_migration_owner`, NOSUPERUSER/NOBYPASSRLS/NOCREATEDB/NOCREATEROLE. |
| Migration and manual empty rollback | Applied on clean synthetic prerequisites; rollback succeeded in a separate clean database. |
| Prior authority fingerprints | 59 existing public functions plus the eight frozen relation definitions/ACLs/protections are checked. |
| Function authority | Nine functions; five runtime wrappers owner/service_role only, four owner cores owner only; fixed search path and exact catalog fingerprints. |
| Working-tree validation | `git diff --check` passed; no application TypeScript edits. |

## Commands executed and results

No production configuration, secrets, provider credentials, customer data,
Railway, Supabase production endpoint, live message or email operation was used.

| Command / proof | Result |
| --- | --- |
| `npm ci --ignore-scripts` | Existing lockfile installed; no dependency changes. |
| `npm run typecheck` | PASS. |
| `npm test` | PASS: 696/696. |
| `npm run build` | PASS. |
| Git Bash `bash -n test/postgres/every8dSettingsSessionConsumption.sh` | PASS. |
| Clean prerequisite chain, new migration, separate clean empty rollback | PASS on PostgreSQL 17.11. |
| `every8dSettingsSessionConsumption.sql` | PASS transactionally, then rolled back its fixtures. |
| Full new `.sh` harness | **FAIL** in expiry fixture SQL with `42601`; no retry/normalization. |
| Harness backend cleanup | PASS: zero surviving C3c-2a harness actors. |
| Read-only syntax reproduction | CONFIRMED incomplete bare `at` alias syntax. |
| Disposable lifecycle-v2 owner tamper audit | **FAIL:** preflight accepted owner `anon`; implementation blocker. |
| Existing database regressions | PASS: all ten unchanged CI database harnesses, listed below. |

Local proof output is preserved outside the repository in
`C:\Users\User\AppData\Local\Temp\wincrm-c3c2a-pg17\focused.log`.
It contains scenario names, backend PIDs, `pg_locks`, wait events and
`pg_blocking_pids` evidence. All fixture values are synthetic.

The unchanged regression sequence passed: durable SMS claim concurrency;
controlled-live authorization concurrency; Marketplace ownership;
Marketplace lifecycle ordering; OAuth bootstrap; OAuth refresh foundation;
EVERY8D provider configuration foundation; C3a settings auth foundation;
C3b-1 settings email challenge foundation; C3b-3 settings auth orchestration.
C3b-2 and protected application/LINE regression coverage are included in the
696 passing application tests. The original scripts were not edited.

## Completed behavior and concurrency evidence

- Enrollment: operator_initial/recovery success; exact one-hour expiry;
  consumption/scrubbing; purpose, malformed aliases, callback, expiry,
  revocation, already-consumed, pinned identity and stale-generation rejection.
- Enrollment atomic failures: session hash collision, failure after C3a
  grant/administrator creation, and failure after session insertion all left
  grant/administrator/session/challenge authority unchanged.
- Login: zero/one/two eligible; multiple installations; missing historical alias;
  malformed historical pseudonym; one winner for the same challenge.
- Creator/login barriers: both acquisition orders, same and different
  installations. Login waiting for the creator saw the committed new
  administrator; a now-multiple eligible set rejected. Creation waiting for
  login could not mutate authority before login commit.
- Enrollment races: same challenge, same grant/competing challenges, and same
  installation/email with independent legal grants each had one authority winner.
- Isolation: both real consume wrappers refused REPEATABLE READ and SERIALIZABLE
  with fixed `25000`; snapshots of all auth relations remained unchanged.
  READ COMMITTED succeeded for both wrappers.
- Login/auth lifecycle races: disable, real lifecycle-v2 UNINSTALL and generation
  advance, each with both winner orders, passed parent-first serialization.
- Login/auth administrator revocation races passed in both winner orders.
- Auth/logout races passed in both winner orders.
- Authentication: minimum principal, wrong/null hash, revoked administrator,
  disabled installation, version/application registration mismatch, revoked
  session, and session no-touch/no-renewal assertions passed.
- Logout: first/repeated, valid absent hash, malformed/null input, preserved
  existing non-logout revocation and immutable timestamp/reason passed.
- No unexpected deadlock or runtime lock/statement/process timeout occurred in
  completed scenarios. The suite nevertheless **does not pass** because of the
  syntax error.

Not completed: login/session expiry waits, expired-session logout, actual deferred
COMMIT-failure proof, dedicated login hash-collision proof, automated whole-schema
boundary proof and the complete guarded rollback/preflight refusal matrices.
Do not infer those passed from the draft test code or earlier manual empty rollback.

## Approaches attempted and correction-loop budget

| Approach | Outcome / new evidence |
| --- | --- |
| Installed client initdb | Failed because `postgres.bki` was absent; portable official runtime supplied the missing server files. |
| Initial behavior proof | Fixture hash helper lacked service_role access to extensions; corrected test-only helper execution context. **Correction loop 1.** |
| Next behavior proof | Expired-grant fixture violated existing fifteen-minute maximum; corrected fixture chronology. **Correction loop 2.** |
| Full behavior proof | PASS after those two corrections. |
| Integrated independent-session proof | Completed 26 race cases and both isolation matrices; stopped at expiry fixture parser error. No third correction. |
| Unchanged regression scripts via Windows adapter | Initial adapter PATH then named-pipe transport problems; only the untracked local adapter was adjusted. No existing regression file was changed. |

## Rejected approaches

- No extra production functions, tables, triggers, indexes, runtime hooks or
  replacement of C3a redemption.
- No silent third correction loop, false PASS, premature commit/push/PR,
  automatic retry, weakened regression, or production fallback.

## Files changed

| File | Change / runtime impact |
| --- | --- |
| `supabase/migrations/202610220001_every8d_settings_session_consumption.sql` | Draft nine-function database authority and frozen pre/postflight; not deployed. |
| `supabase/rollback/202610220001_every8d_settings_session_consumption.sql` | Draft conservative pre-use rollback; not production executed. |
| `test/postgres/every8dSettingsSessionConsumption.sql` | Transactional synthetic structure/behavior and fixture surface. |
| `test/postgres/every8dSettingsSessionConsumption.sh` | Dedicated clean PG17 environment and proof staging. |
| `test/postgres/every8dSettingsSessionConsumptionConcurrency.py` | Scoped stdlib independent-session barrier/rollback coordinator; known fixture syntax defect. |
| `.github/workflows/ci.yml` | Exclude new migration from early wildcard; append dedicated proof after C3b-3. Not hosted executed. |
| This run log | Required stop/status/evidence record. |

## Draft artifact evidence (NOT committed artifact evidence)

All values below describe exact current working-file bytes. No implementation
commit exists; none of these is claimed to be an immutable committed artifact.

| Path | Bytes | Working-file Git blob hash | SHA-256 of working bytes |
| --- | ---: | --- | --- |
| `supabase/migrations/202610220001_every8d_settings_session_consumption.sql` | 51173 | `bb5784ea49332aeb644c9284b30b65e3e9062930` | `dbfe3fefc5089d3f37c9bddc3f468f8c4c961914e81f0ae2c1311bb330afd40f` |
| `supabase/rollback/202610220001_every8d_settings_session_consumption.sql` | 31533 | `462a92848c7224a718276525ae358bbb36ad65c8` | `0f3c08ac0af6627ee1ee9602c74aa4ceb2059ef21e1256031fe47921d34a467d` |
| `test/postgres/every8dSettingsSessionConsumption.sql` | 22611 | `7333539900f6c8121d46e39bfa69db015adad19a` | `b84470d32f66e753a4732e635476620e36c2b6518f1d6d7a757350cc1cf67cb1` |
| `test/postgres/every8dSettingsSessionConsumption.sh` | 3299 | `506384c514b54ff048b87be055c6754f90b5f2f8` | `1a6826a63182621867fb70ea5abb4973926cf4f354b076963bff5b9d004467a7` |
| `test/postgres/every8dSettingsSessionConsumptionConcurrency.py` | 35945 | `d636e96365b64a4dc798c7ec7706fe44e3868f84` | `8dfe37a9c330d2f131d799d8138d8e48a8f07be1615f1a05dc49173e7a7db98c` |

## Exact draft nine-function inventory

```text
public.runtime_discover_every8d_settings_verified_challenge_v1(bytea,text)
public.runtime_consume_every8d_settings_enrollment_challenge_v1(bytea,text[],bytea)
public.runtime_consume_every8d_settings_login_challenge_v1(bytea,text[],bytea)
public.runtime_authenticate_every8d_settings_session_v1(bytea)
public.runtime_revoke_every8d_settings_session_v1(bytea)
public.consume_every8d_settings_enrollment_challenge_core_v1(bytea,text[],bytea)
public.consume_every8d_settings_login_challenge_core_v1(bytea,text[],bytea)
public.authenticate_every8d_settings_session_core_v1(bytea)
public.revoke_every8d_settings_session_core_v1(bytea)
```

## Budget, stop rule and next action

- Active coding tasks: one; implementation now stopped.
- Implementation correction loops: **2/2 used** (fixture corrections above).
- Reviewer correction loops: **0/1 used**; independent implementation review not started.
- Trigger: AGENTS.md says, "Use at most two implementation correction loops."
- Remaining defects: expiry/consumed fixture bare SQL alias (proof/harness), and
  insufficient prior lifecycle authority ownership validation (implementation).
- No known material frozen-contract contradiction; complete conformance is unproven.
- Required decision: review both defects and authorize a further bounded
  correction/validation loop before additional implementation changes.
- Commit/push/PR/hosted CI: **NOT DONE** because local proof is not clean.
- Base HEAD unchanged; C3a redemption and application TypeScript unchanged.
- Production changes: **NONE**. No feature activation or live traffic.
- C3c-2b and C3c-3: **NOT_STARTED_NOT_AUTHORIZED**.

```text
C3C_2A_DATABASE_AUTHORITY: DRAFT_STOPPED_FOR_REVIEW
C3C_2A_LOCAL_PG17_PROOF: FAIL_HARNESS_AND_PREREQUISITE_OWNER_GUARD
C3C_2A_PR: NOT_OPENED_LOCAL_GATE_FAILED
C3C_2B: NOT_STARTED_NOT_AUTHORIZED
C3C_3: NOT_STARTED_NOT_AUTHORIZED
PRODUCTION_CHANGES: NONE
NEXT_GATE: REVIEW_DEFECTS_AND_CORRECTION_BUDGET
```

## Required 31-item result report

| # | Requested evidence | Result |
| ---: | --- | --- |
| 1 | Base SHA | `ef50706d0787bdb5414cc52d7b3f40898138fbd6`. |
| 2 | Branch | `codex/c3c2a-settings-session-db-authority`. |
| 3 | Worktree | Exact phase worktree recorded above. |
| 4 | Changed files | Seven in-scope draft files, listed above. |
| 5 | Migration path/blob/bytes/SHA-256 | Exact draft path and working-byte evidence above; **no committed blob exists**. |
| 6 | Rollback path/blob/bytes/SHA-256 | Exact draft path and working-byte evidence above; **no committed blob exists**. |
| 7 | Exact nine functions | All nine full schema-qualified signatures listed above; created only in disposable proof databases. |
| 8 | Frozen-contract deviation | Confirmed nonconformance: prerequisite lifecycle ownership drift is accepted. No intentional contract redesign. |
| 9 | Preflight summary | Fresh base/contract/migration-ID/later-authority checks passed; tampered lifecycle ownership refusal failed. |
| 10 | ACL/owner/search path | Nine new functions have intended runtime/core grants and fixed `pg_catalog, public`; prior lifecycle ownership validation is defective. |
| 11 | Enrollment proof | Completed success/rejection, collision, injected immediate-boundary failure and concurrency cases passed; actual deferred COMMIT proof not reached. |
| 12 | Login proof | Zero/one/multiple, historical identity and challenge race passed; expiry and dedicated login collision proof not reached. |
| 13 | READ COMMITTED/isolation | Both wrappers: RC succeeds; RR and SERIALIZABLE refuse with unchanged authority state. |
| 14 | Creator/login concurrency | Both winner orders, same/different installations passed; post-wait committed candidate visibility demonstrated. |
| 15 | Lifecycle/revocation races | Login/auth vs disable/UNINSTALL/generation and administrator revocation passed in both orders. |
| 16 | Session auth | Completed minimum-principal, rejection/no-touch and lifecycle/revocation races passed; expiry proof not reached. |
| 17 | Logout | Basic idempotence/evidence/invalid-input and both auth/revoke race orders passed; expired-session case not reached. |
| 18 | Deadlock/timeout | No unexpected runtime deadlock/timeouts in completed cases; full suite fails on fixture syntax. Zero surviving harness actors. |
| 19 | Rollback proof | Manual separate-clean empty rollback passed; integrated guarded refusal matrix not reached. |
| 20 | Prior regression | All ten unchanged database harnesses and all 696 application tests passed; typecheck/build passed. |
| 21 | CI changes | Seven added lines, one replaced line: wildcard exclusion and dedicated step after C3b-3. |
| 22 | Local proof status | **FAIL / INCOMPLETE**: harness parser defect and confirmed prerequisite-owner implementation defect. |
| 23 | Commit SHA | None for implementation; branch HEAD remains exact base SHA. |
| 24 | Push result | Not attempted: clean local gate was not met. |
| 25 | PR number/link | None opened. |
| 26 | Hosted CI run/status | Not run; no push or PR. |
| 27 | Runtime TypeScript changes? | No. |
| 28 | Schema relation changes? | No new/altered relations in the draft migration; only nine functions. |
| 29 | Production changes? | None. |
| 30 | C3c-2b started? | No; not authorized. C3c-3 also not started. |
| 31 | Blockers? | Two defects above; 2/2 correction loops used. Review and bounded correction authorization required. |

No production or live LINE/SMS/email manual smoke test was run or authorized.
The draft is not ready for independent implementation approval or activation.
