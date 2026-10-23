# C3c-2a independent-review R1–R3 maintenance remediation

## Current snapshot: local proof PASS; hosted re-review gate pending

2026-10-23. One focused remediation cycle was explicitly authorized for R1 exact
function source, R2 internal constraint-trigger state, and R3 cross-schema routine
body callers. Focused proofs passed before the full matrix. Fresh exact-image
C3c-2a, ten DB regressions, typecheck, 696/696 application tests (zero skipped),
and build all passed. This records local evidence before commit/push; new hosted
CI must still pass at the correction head. PR #116 remains DO NOT MERGE pending
hosted proof and independent re-review. No independent re-review started here.

At entry, fetch/remote and PR checks pinned main/base to
`ef50706d0787bdb5414cc52d7b3f40898138fbd6`, local/remote/PR reviewed head to
`d6f7b4ae5bf2214f3ae39390bd54ac32038ad302`, the existing seven-file PR,
open/unmerged PR #116, and a clean phase worktree on
`codex/c3c2a-settings-session-db-authority`. The phase worktree is
`C:\Users\User\.codex\worktrees\c3c2a-settings-session-db-authority\win-crm.ai-lineconnect-pilot00`.

The correction changes only migration maintenance projections, rollback
maintenance projections/body-reference guard, shell fixture replay/focused
entry, Python proof transport/negatives, and this log. The nine complete CREATE
FUNCTION blocks were compared byte-for-byte against the reviewed Git head and
are unchanged. SQL behavior proof, CI, TypeScript, relation inventory, C3a
redemption, runtime ACLs, lock graph and all runtime/session semantics are
unchanged. No production access or changes. No C3c-2b/C3c-3 work.

## R1: literal function source and semantic-CR proof

All six migration/rollback prerequisite/target/pre-post projections changed from
`replace(p.prosrc,chr(13),'')` to literal `p.prosrc`. `prosqlbody::text` remains
separately fingerprinted. No CR/CRLF/LF source normalization remains in the
production projections. The only unsafe projection retained in the proof helper
is explicitly the OLD-contract counterexample, never the new contract.

Prerequisite replay now pipes `git show HEAD:<migration>` canonical LF Git-object
bytes to the synthetic non-superuser migration owner. The Python helper reads SQL
as exact bytes, decodes UTF-8 without universal-newline conversion, and sends
encoded bytes to psql without OS newline rewriting. Production preflight
continues to reject different literal stored bodies; a future production body
mismatch requires a future readiness decision, not normalization.

The disposable `public.is_every8d_settings_email_pseudonym_v1(text)` negative
inserts an ACTUAL chr(13) inside the regex immediately before `$`. It verifies
stored source contains CR, removing CR reproduces the original source, a normal
`k1:` plus 64 hex characters changes from accepted to rejected, and appending CR
changes to accepted. This is not a backslash-r string. All metadata is retained.
The old full unsafe fingerprint collides with the canonical baseline; the new
exact full fingerprint differs:

| Source fixture | Full function fingerprint |
| --- | --- |
| Canonical baseline / old unsafe projection of semantic-CR tamper | d3a726234333158db9649a6946611eb1 |
| New exact projection of semantic-CR tamper | 747be7280ea5ba442f9d4439e6f45e18 |
| Separate ordinary `select false` source tamper | 1ad05161bb6680d000ab237a846a5be5 |

Both ordinary and semantic-CR variants were exercised against real migration
and real rollback. Each refuses with SQLSTATE 55000 and exact sanitized message
`C3c-2a frozen prerequisite manifest mismatch`. Apply leaves zero target
functions; rollback retains all nine. Exact before/after authority/catalog/ACL,
namespace and all eight prerequisite-relation row snapshots are unchanged;
neither operation repairs source, ownership, ACL or data.

## R2: complete internal-trigger inventory and portable projection

Inventory ran before projection design on all eight relations. There are 36
internal triggers, all with nonzero tgconstraint; none was silently omitted.
All are foreign-key enforcement triggers, normally enabled `O`, nondeferrable,
and not initially deferred. All have empty tgattr/tgargs, zero tgnargs, NULL
qualification and transition tables. Existing noninternal trigger fingerprints,
including application deferred integrity triggers, remain unchanged.

The following is the complete inventory grouped into two-trigger pairs. All
constraint schemas are public and trigger functions are in pg_catalog. A check
pair is `"RI_FKey_check_ins"()` (tgtype=5) plus `"RI_FKey_check_upd"()` (17).
A restrict pair is `"RI_FKey_restrict_del"()` (9) plus
`"RI_FKey_restrict_upd"()` (17). Each listed row represents exactly two triggers.

| Protected relation | Constraint | Function pair | Referenced-side/other relation |
| --- | --- | --- | --- |
| every8d_settings_administrators | every8d_settings_administrators_enrollment_grant_fk | check (5,17) | every8d_settings_enrollment_grants |
| every8d_settings_administrators | every8d_settings_administrators_installation_fk | check (5,17) | ghl_marketplace_installations |
| every8d_settings_administrators | every8d_settings_sessions_administrator_snapshot_fk | restrict (9,17) | every8d_settings_sessions |
| every8d_settings_auth_challenge_failures | every8d_settings_auth_challenge_failures_challenge_fk | check (5,17) | every8d_settings_auth_challenges |
| every8d_settings_auth_challenges | every8d_settings_auth_challenge_failures_challenge_fk | restrict (9,17) | every8d_settings_auth_challenge_failures |
| every8d_settings_auth_challenges | every8d_settings_auth_challenges_grant_fk | check (5,17) | every8d_settings_enrollment_grants |
| every8d_settings_enrollment_grants | every8d_settings_administrators_enrollment_grant_fk | restrict (9,17) | every8d_settings_administrators |
| every8d_settings_enrollment_grants | every8d_settings_auth_challenges_grant_fk | restrict (9,17) | every8d_settings_auth_challenges |
| every8d_settings_enrollment_grants | every8d_settings_enrollment_grants_installation_fk | check (5,17) | ghl_marketplace_installations |
| every8d_settings_sessions | every8d_settings_sessions_administrator_snapshot_fk | check (5,17) | every8d_settings_administrators |
| ghl_marketplace_app_registrations | ghl_marketplace_app_version_registrations_app_namespace_fkey | restrict (9,17) | ghl_marketplace_app_version_registrations |
| ghl_marketplace_app_version_registrations | ghl_marketplace_app_version_registrations_app_namespace_fkey | check (5,17) | ghl_marketplace_app_registrations |
| ghl_marketplace_installations | every8d_provider_configurations_installation_fk | restrict (9,17) | every8d_provider_configurations |
| ghl_marketplace_installations | every8d_settings_administrators_installation_fk | restrict (9,17) | every8d_settings_administrators |
| ghl_marketplace_installations | every8d_settings_enrollment_grants_installation_fk | restrict (9,17) | every8d_settings_enrollment_grants |
| ghl_marketplace_installations | ghl_marketplace_installations_tenant_location_fkey | check (5,17) | tenants |
| ghl_marketplace_installations | ghl_marketplace_oauth_bootstraps_claimed_installation_id_fkey | restrict (9,17) | ghl_marketplace_oauth_bootstraps |
| ghl_marketplace_installations | ghl_marketplace_oauth_states_installation_id_fkey | restrict (9,17) | ghl_marketplace_oauth_states |

The new component covers ALL internal triggers (LEFT JOIN to constraints, so an
unexpected internal trigger without tgconstraint is also represented). Stable
fields: constraint schema/name/type/definition; origin/referenced relation schema
and name; trigger-function schema/name/identity arguments; tgtype, tgenabled,
tgdeferrable, tginitdeferred; boolean constraint/parent presence; referenced
relation and supporting index schema/name/definition; resolved attribute names;
argument count/bytes; qualification expression; transition-table names. Complete
identity arrays are deterministically sorted using C collation.

No trigger/constraint/relation/index OID or generated internal trigger name is
hashed. OIDs are used only to resolve stable identity/definitions; presence flags
are booleans. All four relation projections are byte-identical. The proof helper
extracts the real projection rather than maintaining a divergent copy. Existing
noninternal triggers, constraints, indexes, policies, ACLs and RLS remain covered.

All eight relations have internal triggers, so these eight hashes legitimately
change. Only these expected relation values were regenerated; all 59 expected
function hashes and the nine target hashes remain unchanged.

| Relation | Reviewed fingerprint | New fingerprint |
| --- | --- | --- |
| every8d_settings_administrators | c58ea3ff3db89c32b25ed161c37aa0f2 | 22310a057aae8c919d5f133686b06c12 |
| every8d_settings_auth_challenge_failures | 7b5f0c6c56f2b797f22a1dd19d1e3c8f | 1c3aa7ad43c10fbeaa3da35919c5f603 |
| every8d_settings_auth_challenges | 6f362a21a96a0f360aebb417b57ca9ef | ad3214c353186228d0f17e2f115f15fb |
| every8d_settings_enrollment_grants | bf19608234370a50bca909698fcc7377 | 2bc87966915bd44aa80793cc9bb1b3d7 |
| every8d_settings_sessions | 0e5ac76c83c5f7808766beda9b28468e | 3ea40301cf1743c7fc3f33e754db1705 |
| ghl_marketplace_app_registrations | f48407c15dd6a42693863a1c76bf152b | 0360ec6e4309027f40c03b1087c17b53 |
| ghl_marketplace_app_version_registrations | 85926308542ac4083b81298e36c44c29 | 5b6cc4f57acd2edd376949b63d579574 |
| ghl_marketplace_installations | 0ecccbc62f508531b12c8a1c67379292 | b29aca9663dc2fefce200a5b21518ec9 |

Negative: programmatically locate the internal INSERT check on
`public.every8d_settings_sessions`, constraint
`every8d_settings_sessions_administrator_snapshot_fk`, function
`pg_catalog."RI_FKey_check_ins"()`, tgtype=5. Assert internal/nonzero constraint
and normal `O`, disable exactly its catalog-resolved generated name as disposable
postgres, confirm `D`, then run real apply or rollback. The sessions fingerprint
changes from `3ea40301cf1743c7fc3f33e754db1705` to
`fb74c97615d7e8f2538f096ecae8ca4b`. Both operations refuse 55000 with the exact
prerequisite-manifest message. Apply creates zero targets; rollback retains nine.
Trigger stays D until fixture disposal; no authority/data/ACL repair or partial
DDL occurs. Other prerequisite state remains byte-identical by catalog snapshot.

## R3: conservative cross-schema later-routine refusal

The original pg_depend guard is retained unchanged. Before any REVOKE/DROP,
rollback also scans pg_proc.prosrc for every non-target routine in every schema
except information_schema and names matching `^pg_` (catalog, temp/toast/system).
This includes public, extensions, and any later user schema; there is no public
allowlist. All pg_proc kinds/languages are included, covering functions,
procedures and PL/pgSQL dynamic strings. Only the nine exact public target
regprocedure identities are excluded, allowing wrappers to call cores.

The search uses C-collation lowercase source and literal substring matching of
each of all nine complete target names. Quoted/uppercase direct names are caught;
conservative textual false-positive refusal is intentional. It does not claim
to infer arbitrary obfuscated/generated routine names. Fixed refusal is 55000,
`C3c-2a rollback refused: later routine body reference`; no bodies/catalog dumps
appear in runtime errors.

| Real later fixture in NON-public c3c2a_later_guard | Explicit pg_depend target edge | Refusal |
| --- | --- | --- |
| atomic_caller(), SQL BEGIN ATOMIC | present | Existing unexpected-dependency guard, 55000 |
| string_body_caller(), SQL string-literal body | ABSENT | New later-routine-body guard, 55000 |
| dynamic_caller(), PL/pgSQL procedure with uppercase dynamic direct name | ABSENT | New later-routine-body guard, 55000 |

Each calls/references runtime_revoke_every8d_settings_session_v1(bytea). Catalog
edge proof explicitly checks pg_proc caller objid -> pg_proc target refobjid.
Every refusal retains all nine targets and caller; full source/owner/ACL/catalog
and prerequisite row snapshots remain unchanged, with no partial DROP. The
original public BEGIN ATOMIC later-dependency test is also retained and passes.

## Focused, cross-platform and complete current validation

Focused mode ran first in a FRESH network-isolated postgres:17-bookworm container
and passed all nine new maintenance scenarios before the expensive matrix.
Then full mode ran in ANOTHER FRESH container. Both report PostgreSQL 17.11
(Debian 17.11-1.pgdg12+2), image digest
`sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27`.
Synthetic roles and non-superuser/non-BYPASSRLS common owner, template0, UTF8,
C collate/ctype, privileged pgcrypto placement and prior migration ordering
match the existing harness. pgcrypto/digest remain postgres-owned in extensions.

Separate fresh Windows native PostgreSQL 17.11 and exact-image Linux fixtures
replayed the SAME canonical Git SQL. Complete normalized relation/function
fields and hashes are identical across platforms, including all 36 internal
trigger identities/states. All 59 function hashes equal the reviewed canonical
baseline. Meaningful literal-CR and internal-enabled-state differences are
explicitly distinguished by the new executable negatives above. No equality is
claimed for fixtures that intentionally store different literal source bytes.

| Current validation | Result |
| --- | --- |
| Bootstrap / exact prerequisite manifests / structural behavior | PASS |
| Lifecycle normal common owner + anon/authenticated/service_role/postgres tamper | PASS; mismatches reject, zero targets |
| Prior function source/body/owner, ordinary trigger, table ACL, RLS/policy role, schema CREATE, target conflict negatives | PASS |
| Enrollment/login exact-one/auth/logout behavior | PASS |
| Runtime concurrency matrix | 28/28 PASS (including both expiry cases; two isolation case groups separate) |
| Both real login/session expiry after deterministic wait | PASS; current DB time revalidated, authority unchanged after rejection |
| READ COMMITTED; RR/SERIALIZABLE | RC succeeds; both unsupported levels refuse without mutation |
| Creator/login both orders; same/different installations | PASS |
| Lifecycle/administrator revocation/auth/logout races, both orders | PASS |
| Actual deferred COMMIT failure / session collision | PASS; no partial authority |
| Clean empty rollback / exact nine drops / reapply | PASS |
| Definition / owner / ACL / unexpected dependency / later dependency rollback refusals | PASS |
| Populated administrator / session / consumed challenge rollback refusals | PASS |
| Bounded maintenance-lock refusal | PASS, expected 55P03, no destructive DDL/data change |
| R1 exact-source and semantic-CR apply/rollback negatives | 4/4 PASS |
| R2 internal session-FK trigger apply/rollback negatives | 2/2 PASS |
| R3 tracked SQL / untracked SQL / untracked PL/pgSQL later callers | 3/3 PASS |
| Unexpected SQL error/deadlock/lock/statement/process timeout or retry | NONE |
| Surviving proof backends / clone databases after focused and full runs | 0 / 0 |
| npm run typecheck | PASS, fresh |
| npm test | 696/696 PASS; zero failed/cancelled/skipped/todo, fresh |
| npm run build | PASS, fresh |

After complete PG17 PASS, ten regressions ran from another fresh exact-image
PG17.11 container with literal CI pre-harness staging and CI order. Canonical
LF Git-object scripts were copied to temporary files OUTSIDE the repository,
asserted CR-free and SHA-256-identical, and run with cwd at the current worktree.
Tracked old scripts, Git line-ending settings and .gitattributes are unchanged.

| Existing script actually executed; SQL proof completed | Exit/result |
| --- | --- |
| test/postgres/ghlSmsOutboundClaimConcurrency.sh | 0 / PASS |
| test/postgres/ghlSmsControlledLiveAuthorizationConcurrency.sh | 0 / PASS |
| test/postgres/ghlMarketplaceOwnership.sh | 0 / PASS |
| test/postgres/ghlMarketplaceLifecycleOrdering.sh | 0 / PASS |
| test/postgres/ghlPublicOAuthBootstrap.sh | 0 / PASS |
| test/postgres/ghlOAuthRefreshFoundation.sh | 0 / PASS |
| test/postgres/every8dProviderConfigurations.sh | 0 / PASS |
| test/postgres/every8dSettingsAuthFoundation.sh | 0 / PASS |
| test/postgres/every8dSettingsEmailChallengeFoundation.sh | 0 / PASS |
| test/postgres/every8dSettingsAuthOrchestration.sh | 0 / PASS |

10/10 PASS; no unexpected deadlock, lock/process timeout or launcher failure.
Final regression query: {"other_client_backends":0,"nonbuiltin_databases":0}.
Every temporary Linux container/anonymous volume was removed; the Windows
comparison server was stopped. Probe scripts, canonical copies and raw evidence
remain outside Git under
`C:\Users\User\AppData\Local\Temp\wincrm-c3c2a-r123-20261023`.
Principal logs: inventory.json, linux/windows-hashes.json, linux/windows-fields.json,
relation-diff.json, focused.log, full.log, both clean-state files, ten regression
logs/results.tsv/final-cleanup.json, typecheck.log, npm-test.log, build.log.

## Correction artifacts and delivery boundary

Only five existing C3c-2a files change in this correction: migration, rollback,
shell proof, Python proof and this evidence log. The full PR still contains
exactly its existing seven authorized files. No temporary utility is staged.
The nine runtime/core CREATE FUNCTION blocks are exact reviewed Git bytes.
The expected relation values below supersede the reviewed migration/rollback
immutable evidence. Staged/committed Git bytes must equal these candidates:

| Artifact path | Git blob SHA | Exact bytes | SHA-256 |
| --- | --- | ---: | --- |
| supabase/migrations/202610220001_every8d_settings_session_consumption.sql | 315cc15888adc1edd96cf1ca2b8f0ef2b0171375 | 55648 | 616917fc8bc64221689b6c804939dc555777af355e866095a136355bb247153b |
| supabase/rollback/202610220001_every8d_settings_session_consumption.sql | 2b47b98e2460e92d557423b8d64a3663ca7cba45 | 37832 | 3b7edf499e855fdb9efe2743422218517633f196d9b266444849333624f50d9b |
| test/postgres/every8dSettingsSessionConsumption.sh | 0d4c96627e3ad4ba7c41ed03bb4f1736bff51b3d | 5360 | a126d097ff90f3bed572d285960b2b9c1a5b21343cfabcec5763a77449d08e3c |
| test/postgres/every8dSettingsSessionConsumption.sql | 7333539900f6c8121d46e39bfa69db015adad19a | 22611 | b84470d32f66e753a4732e635476620e36c2b6518f1d6d7a757350cc1cf67cb1 |
| test/postgres/every8dSettingsSessionConsumptionConcurrency.py | ab2aaffaeaa54e3ec2d6cadbc9c739984c019960 | 61127 | 150f9cb3532349bdd0aff9f805d9cf29246c80135e8b2b17fabc2ecc6377d04c |

No merge/deployment/production migration/manual live smoke test was authorized
or performed. Correction commit/push updates SAME PR #116. New head, committed
artifact verification, hosted run ID and both job/step conclusions will be
reported after observation in the PR/delivery response; this local snapshot
does not claim future CI success. If hosted CI fails, STOP FOR REVIEW with no
additional correction. Success next gate is INDEPENDENT_C3C_2A_RE_REVIEW.
C3c-2b and C3c-3 remain NOT_STARTED_NOT_AUTHORIZED. PRODUCTION_CHANGES: NONE.

---

The following evidence is historical and superseded by the current snapshot.

# C3c-2a settings session database authority: fingerprint portability validation

## Current validation snapshot: canonical LF regressions 10/10 PASS

**2026-10-23: local validation PASS; new hosted CI required after push.** The
user authorized one final validation-only retry of the unchanged portability
candidate. That retry is **1/1 used**, with all ten existing DB regression
harnesses completing their SQL proofs and exiting zero. The prior CRLF launcher
error occurred before SQL and was not a database regression failure.

Only this evidence log changed during this retry. No application, migration,
rollback or proof logic changed. The frozen candidate, its complete exact-image
C3c-2a proof and its current application checks remain byte-identical and valid.
Independent implementation review has not begun. The new hosted run must pass
both jobs before that next gate is available; run #123 is not final evidence.

### Canonical LF execution, without repository line-ending changes

Before validation, fresh fetch and PR inspection confirmed branch/worktree,
open/unmerged PR #116, authorized main/base
`ef50706d0787bdb5414cc52d7b3f40898138fbd6`, and committed PR/local/remote head
`d4c68fd16146442085aa5c5b3f80f2baee254895`. Only the expected four tracked files
were modified, and the complete correction diff/candidate hashes were checked.

For each unchanged regression script, Python read raw canonical bytes with
`git show HEAD:<path>` and wrote those exact bytes to a temporary file outside
the repository. Every temporary copy was checked for zero CR bytes, exact byte
identity, committed blob identity and SHA-256. Linux rechecked these bytes before
execution. Bash executed the temporary file while its cwd remained the current
repository root, so relative migrations/proofs resolved to the current worktree.

No tracked regression script was modified, no LF rewrite was committed, no
.gitattributes/autocrlf setting changed, and no CRLF-tolerance code was added.
No temporary copy or probe utility is included in the correction commit.

### Fresh CI-equivalent regression environment

A new disposable `postgres:17-bookworm` container with a fresh anonymous data
volume was used, separate from every preceding C3c-2a environment. Runtime:
**PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2)**. Image digest:
`sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27`,
the exact hosted image. Runtime version number was asserted to equal 170011.

The temporary runner extracted the literal synthetic-role and pre-harness
migration-staging shell blocks from the unchanged CI workflow. It created anon,
authenticated and service_role, applied the same migration chain/exclusions,
then ran the ten harnesses in CI order. Subsequent owner/bootstrap state was
established by the unchanged harnesses as in CI. The container had no external
network and no production access. No previously mutated database was reused.

| Actual script executed from canonical temporary bytes | SQL proof / exit |
| --- | --- |
| test/postgres/ghlSmsOutboundClaimConcurrency.sh | PASS / 0 |
| test/postgres/ghlSmsControlledLiveAuthorizationConcurrency.sh | PASS / 0 |
| test/postgres/ghlMarketplaceOwnership.sh | PASS / 0 |
| test/postgres/ghlMarketplaceLifecycleOrdering.sh | PASS / 0 |
| test/postgres/ghlPublicOAuthBootstrap.sh | PASS / 0 |
| test/postgres/ghlOAuthRefreshFoundation.sh | PASS / 0 |
| test/postgres/every8dProviderConfigurations.sh | PASS / 0 |
| test/postgres/every8dSettingsAuthFoundation.sh | PASS / 0 |
| test/postgres/every8dSettingsEmailChallengeFoundation.sh | PASS / 0 |
| test/postgres/every8dSettingsAuthOrchestration.sh | PASS / 0 |

**10/10 PASS.** Each individual log contains its actual SQL proof completion
marker, and its process exit status is recorded separately. No CRLF launcher
error, unexpected deadlock/lock timeout or process timeout occurred. All
harnesses terminated cleanly. A final query verified no unwanted backends or
clone databases before dropping wincrm_test, then returned:

```json
{"other_client_backends":0,"nonbuiltin_databases":0}
```

The EXIT trap removed the container and its anonymous volume. An independent
Docker listing confirmed the validation container no longer exists.

Evidence root:
`C:\Users\User\AppData\Local\Temp\wincrm-c3c2a-lf-validation-20261023`:
`canonical-scripts.json`, `tracked-before.json`, `regressions.log`,
`results.tsv`, `regression-results.json`, ten individual `regression-*.log`
files, `version.txt`, `final-cleanup.json` and the container cleanup log. All
temporary runner/scripts and evidence remain outside the repository.

### Frozen fingerprint correction and retained current-candidate validation

Classification remains **FINGERPRINT_PORTABILITY_DEFECT**. Only
`public.ghl_marketplace_installations` differed: old expected
`b51b7119009f94ec32233dd2208e0619`, exact-image raw actual
`ad6b58125b107a455ffcb60966eaa892`. The exact unstable field was polroles in
its three server policies: Windows service_role OID 16386 versus Linux 16387.
Both represent the same service_role. All 59 function and other seven relation
fingerprints matched. Sorted exact role-name normalization yields the same
portable hash `0ecccbc62f508531b12c8a1c67379292` on both environments.

The existing correction normalizes only that representation in migration and
rollback preflight/postflight; all other policy definition/security fields stay
fingerprinted. Nine bodies/signatures, ACLs, lock order and runtime semantics are
unchanged. The proven policy-role, prior-owner/source, lifecycle-owner, trigger,
ACL, RLS/schema and target-conflict negatives remain intact.

| Existing current-candidate result, preserved without rerun | Result |
| --- | --- |
| Complete fresh exact-image C3c-2a PG17 proof | PASS |
| Runtime concurrency including both expiry cases | 28/28 PASS |
| Isolation / creator-login / lifecycle-revocation / auth-logout | PASS |
| Collision / deferred failure / complete rollback matrix | PASS |
| Security negatives / no unexpected deadlock or timeout | PASS |
| npm run typecheck | PASS |
| npm test | 696/696 PASS; zero failed/cancelled/skipped/todo |
| npm run build | PASS |

All tracked files were hashed before this validation authorization and compared
after the ten regressions: no tracked byte changed. Only this log is now updated.
Under user section H, application checks were therefore retained, not repeated
for noise. The complete C3c-2a suite was not rerun or redesigned under section I.

### Correction commit artifacts and delivery gate

The correction comprises exactly migration, rollback, focused Python negative
proof and this log. CI staging, the ten regression scripts, SQL behavior proof,
shell orchestration and TypeScript remain unchanged. Commit/push target is the
existing branch and PR #116; no squash, new PR, merge, production operation or
C3c-2b/C3c-3 work is authorized.

| Artifact | Git blob SHA | Exact bytes | SHA-256 |
| --- | --- | --- | --- |
| supabase/migrations/202610220001_every8d_settings_session_consumption.sql | 16d26ea37d6e5c30688265fcc6e761201fd6b9f3 | 52699 | 146b747bdde1f2d1bdf1220c6e3ff09e9211d048a15066a770f46fab3f7496d7 |
| supabase/rollback/202610220001_every8d_settings_session_consumption.sql | 5c82ab9360c5e7af00bd530ae98514fda02ab5ed | 33059 | 519ddb18875705291a24523f35bedfb3107e77eee0165b0dd45d00e1126bf243 |
| test/postgres/every8dSettingsSessionConsumptionConcurrency.py | 0bf7076580ee5b409b872bc2313995b9d10b500f | 51039 | 2cf145b8ea84475a1248c46a49f47f031ea86cfd09ff094787fc33d9b55396b3 |

These are the exact unchanged candidate values. The correction commit supersedes
the previous PR migration blob d524df1908572dc08ccfc1b5fccfe2caba3cf95a and
rollback blob 4a3933bb1ec06ba91963f2fc27e80b0cb213700a and their prior byte/hash
evidence. Exact staged and committed Git bytes must match the table; any
difference must be explained before delivery.

This snapshot is recorded before committing/pushing. Final correction commit,
new PR head, new hosted run ID, both job conclusions and the C3c-2a step result
are reported in the delivery response/PR after observation; this avoids a
self-referential commit identifier or claiming CI success before it happens.
Both validate and postgres-concurrency must succeed at the new head. If either
fails, stop without another correction. Independent review begins only at the
next gate after green CI; no review has been started here.

PRODUCTION_CHANGES: NONE. C3c-2b and C3c-3: NOT_STARTED_NOT_AUTHORIZED.

Prior stopped attempts below are historical and superseded by this validation
retry; the CRLF launcher failure is not evidence of a database regression.

## Historical result: one hosted-CI correction cycle stopped at regression launch

**2026-10-23: INCOMPLETE — STOP FOR REVIEW.** The single authorized hosted-CI
correction cycle is **1/1 used**. The exact hosted manifest defect was reproduced,
isolated, classified and narrowly corrected locally. The full fresh exact-image
C3c-2a suite passes, including 28 concurrency cases and all rollback/security
negatives. Typecheck, 696/696 application tests and build pass. However, the first
existing DB regression could not launch because this agent invoked its existing
Windows CRLF checkout directly with Linux Bash. User section L requires stopping
at a failed regression gate. No retry, further correction, commit or push occurred.
No new hosted run was triggered; independent review has not begun.

### Coordinates and confirmed hosted failure

- Repository hugolamcloser/win-crm.ai-lineconnect; PR #116 verified OPEN/unmerged.
- Fresh fetch: origin/main/base remains
  `ef50706d0787bdb5414cc52d7b3f40898138fbd6`.
- Local HEAD, branch remote and PR head remain
  `d4c68fd16146442085aa5c5b3f80f2baee254895` on
  `codex/c3c2a-settings-session-db-authority`. Worktree was clean before this cycle.
- Run 39897317702 / #123: validate SUCCESS; postgres-concurrency job
  120230634115 FAILURE. All prior DB stages through C3b-3 succeeded. C3c-2a
  reached both pgcrypto/common-owner bootstrap PASS markers, then raised 55000
  `C3c-2a frozen prerequisite manifest mismatch` before target creation.

### Exact hosted reproduction and machine-readable difference

The existing WSL2 Docker engine ran a fresh isolated `postgres:17-bookworm`
container. Its image digest exactly matches hosted run #123:
`sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27`.
Both runtimes report PostgreSQL **17.11 (Debian 17.11-1.pgdg12+2)**.

The committed shell harness was invoked unchanged and reproduced the exact
55000 failure (exit 3). Separate fresh prerequisite replays reused its exact
template0/UTF8/LC_COLLATE=C/LC_CTYPE=C database creation, synthetic roles,
non-superuser/non-BYPASSRLS common owner, privileged pgcrypto placement and
migration order. Temporary read-only probes mechanically extracted the committed
preflight SELECT expressions under its normal owner/search_path. No expected
hash was changed before collecting the difference.

Machine-readable original manifest difference:

```json
{
  "relations": {
    "expected_count": 8,
    "actual_count": 8,
    "missing": [],
    "unexpected": [],
    "differing": [{
      "key": "ghl_marketplace_installations",
      "expected": "b51b7119009f94ec32233dd2208e0619",
      "actual": "ad6b58125b107a455ffcb60966eaa892"
    }]
  },
  "functions": {
    "expected_count": 59,
    "actual_count": 59,
    "missing": [],
    "unexpected": [],
    "differing": []
  }
}
```

A newly initialized Windows PG17.11 baseline independently reproduced all
committed expected hashes. Comparing every underlying normalized field against
the exact-image replay found ONLY `polroles[0]` in these three policies:

| Policy | Windows stored OID | Exact-image stored OID | Actual role in both |
| --- | --- | --- | --- |
| marketplace_installations_server_insert | 16386 | 16387 | service_role |
| marketplace_installations_server_select | 16386 | 16387 | service_role |
| marketplace_installations_server_update | 16386 | 16387 | service_role |

Both role mappings were queried directly; service_role is non-superuser and
non-BYPASSRLS in both fixtures. The common owner also retains its required
attributes. Numeric role OIDs are allocated by each cluster and do not express a
different policy grantee. All remaining relation fields match exactly: kind,
persistence, RLS/FORCE RLS, replica identity/options, normalized table/column
ACLs, columns/types/defaults/collations, constraints, indexes, trigger definitions
and enabled states, policy names/commands/permissiveness/qualifications/checks.
All 59 function signatures and complete normalized function field arrays match.

Classification: **FINGERPRINT_PORTABILITY_DEFECT**. The defect is raw role OIDs
retained inside policy JSON, despite the intended exclusion of cluster-local
object identifiers. No actual prerequisite authority drift was observed.

### Narrow local correction

Only `polroles` representation changes: each OID resolves to its exact role name,
with explicit PUBLIC for OID zero, sorted under COLLATE C. The rest of each policy
JSON remains intact. Migration and rollback preflight/postflight use the same
normalization. Only the installation relation's expected hash changes to
`0ecccbc62f508531b12c8a1c67379292`; the other seven relation hashes and all 59
prerequisite function hashes remain unchanged.

Before editing the SQL artifacts, temporary normalized probes from fresh Windows
and exact-image prerequisite databases produced identical manifests AND every
normalized field. No wholesale hash replacement or superficial existence check
was used. A reverse-substitution check proves the SQL files otherwise exactly
match the reviewed head: nine function bodies/signatures, owner/lifecycle guards,
SECURITY DEFINER/search_path, lock graph, ACLs, READ COMMITTED/exact-one/expiry and
session behavior are untouched. No prerequisite definitions were modified.

Focused proof additions require real refusal for a policy grantee changed to
anon, a prior settings function owned by postgres, and an actual prior helper
body changed to return false. Existing metadata/trigger/ACL/RLS/schema/conflict,
dependency, populated rollback and maintenance-lock negatives remain intact.
No permanent diagnostic dump was added to production errors. Temporary catalog
diagnostics contain object names/hashes/static catalog fields, no auth rows or
credential data.

### Fresh exact-image validation

A new container/cluster, separate from diagnosis, ran the corrected complete
C3c-2a shell path once. Runtime version was explicitly required to equal 170011.

| Gate | Current result |
| --- | --- |
| Bootstrap / exact prerequisite manifest / structural / behavior | PASS |
| Runtime concurrency | **28/28 PASS**; both expiry cases included |
| Isolation / creator-login / lifecycle-revocation / auth-logout | PASS |
| Deferred COMMIT and session collision atomicity | PASS |
| Lifecycle-v2 wrong owner | PASS refusal for anon/authenticated/service_role/postgres; zero targets and unchanged prerequisites |
| Prior settings wrong owner / actual prior source change | PASS refusal |
| Disabled prerequisite trigger / widened auth ACL / RLS drift | PASS refusal |
| Policy grantee changed to anon | PASS refusal: normalized role identities remain security-significant |
| Untrusted schema CREATE / target conflict / target ACL tamper | PASS refusal |
| Dependency / later dependency / populated rollback | PASS refusal |
| Clean rollback/reapply / maintenance-lock refusal | PASS |
| Unexpected SQL/deadlock/lock/statement/process/barrier timeout | None; only explicitly expected bounded maintenance 55P03 |
| Full exact-image C3c-2a result | **PASS**; final harness PASS and zero surviving harness backends |
| Ten existing DB regressions | **INCOMPLETE: 0/10 completed**, first script launch failed before SQL |
| npm run typecheck | PASS |
| npm test | **696 tests, 696 pass, 0 fail/cancelled/skipped/todo** |
| npm run build | PASS |

The first legacy regression was invoked from the physical Windows checkout
under Linux Bash and failed before its PostgreSQL calls:

```text
test/postgres/ghlSmsOutboundClaimConcurrency.sh: line 2: $'\r': command not found
test/postgres/ghlSmsOutboundClaimConcurrency.sh: line 3: set: pipefail
: invalid option name
```

Diagnosis: the tracked legacy shell files have CRLF working-tree bytes on
Windows, while hosted Git checkout supplies LF. This invocation did not use LF
source bytes as a Linux checkout would. It is a local regression-launch setup
defect, not evidence of a database SQL/security regression. It nevertheless
leaves the required ten-regression gate unmet. No LF export/retry, unrelated file
change or second correction was performed after this failure.

Evidence root:
`C:\Users\User\AppData\Local\Temp\wincrm-c3c2a-hosted-ci-20261023`:
`manifest-diff.json`, `field-diff.json`, `normalized-diff.json`, Windows/Linux
original and normalized manifest/field JSON, `linux-original.log`,
`linux-final.log`, `exact-final.log`, the first regression log and npm logs.
The final container EXIT trap removed its container and anonymous volume on
failure. The diagnosis container/volume were explicitly removed; the comparison
Windows server is stopped. No task containers/backends remain. No production
access, deployment, environment change, credentials or provider action occurred.

### Candidate immutable evidence and delivery state

These are **uncommitted candidate** byte values, superseding the previous local
artifact values only. The unchanged PR still contains the prior committed bytes
at d4c68fd; no candidate value is represented as committed PR evidence.

| Artifact | Candidate Git blob hash | Bytes | SHA-256 |
| --- | --- | --- | --- |
| supabase/migrations/202610220001_every8d_settings_session_consumption.sql | 16d26ea37d6e5c30688265fcc6e761201fd6b9f3 | 52699 | 146b747bdde1f2d1bdf1220c6e3ff09e9211d048a15066a770f46fab3f7496d7 |
| supabase/rollback/202610220001_every8d_settings_session_consumption.sql | 5c82ab9360c5e7af00bd530ae98514fda02ab5ed | 33059 | 519ddb18875705291a24523f35bedfb3107e77eee0165b0dd45d00e1126bf243 |
| test/postgres/every8dSettingsSessionConsumptionConcurrency.py | 0bf7076580ee5b409b872bc2313995b9d10b500f | 51039 | 2cf145b8ea84475a1248c46a49f47f031ea86cfd09ff094787fc33d9b55396b3 |

The superseded local migration values were blob d524df1908572dc08ccfc1b5fccfe2caba3cf95a,
51981 bytes, SHA-256 d8246cadfb9589f95cd8b56c269418f648b664eaeac080cd1e76912f77a2b354.
The superseded local rollback values were blob 4a3933bb1ec06ba91963f2fc27e80b0cb213700a,
32341 bytes, SHA-256 45353d8936b9d94207f9e7eb75911c8bcbccee0a30e8007b71804f84362646bb.
Those prior values remain the current PR's immutable evidence until a reviewed
candidate is committed and pushed.

Exactly four local files differ: migration, rollback, focused Python proof and
this evidence log. CI, shell orchestration, SQL behavior proof and TypeScript
remain unchanged. Old/new PR head are both
`d4c68fd16146442085aa5c5b3f80f2baee254895`; correction commit NONE; push NONE.
PR #116 remains open/unmerged but **NOT_READY_FOR_REVIEW**. No new hosted run;
39897317702 still has validate SUCCESS / postgres-concurrency FAILURE. Independent
review, C3c-2b and C3c-3 were not started.

```text
C3C_2A_HOSTED_CI_CORRECTION: INCOMPLETE
C3C_2A_PR: NOT_READY_FOR_REVIEW
C3C_2B: NOT_AUTHORIZED
PRODUCTION_CHANGES: NONE
```

STOP FOR REVIEW under the user's section L; no additional correction is inferred.

## Historical result: complete fresh PG17 proof and final regressions PASS

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
