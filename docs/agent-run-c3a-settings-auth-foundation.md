# Agent run: C3a settings authentication foundation

## Task identification

- GitHub task: C3a local implementation and independent-review remediation; no
  GitHub issue or pull request was created.
- Approved branch: `codex/c3a-every8d-settings-auth-foundation`
- Authority level: Level 3 reduced by explicit authorization to local C3a
  migration, rollback, proof, CI, and documentation changes only; no push, PR,
  merge, deploy, production migration, Railway, Phase 2F, provider, SMS, or LINE
  action.
- Started at: 2026-10-05 (Asia/Kuala Lumpur)
- Last updated at: 2026-10-05 (Asia/Kuala Lumpur)

## Task objective

Build the database-only C3a administrator, enrollment-grant, and settings-session
foundation on frozen base `45c45056e4f77396be57ecb87e73df526a2180d0`,
then close one authorized independent-review remediation cycle on reviewed
commit `219999edef772d92979a1ac6223b0d88ec902bbc`.

Definition of done for remediation:

- close all eight security findings and the run-log/coverage deficiencies;
- preserve C1/C2 and all LINE/SMS/runtime behavior;
- prove the corrected contracts on PostgreSQL 17 plus required regressions;
- run typecheck, unit tests, build, shell syntax, and `git diff --check`;
- create one new local commit only after all required validation passes.

## Current hypothesis

The smallest safe remediation is to make one grant globally single-use, split
callback and operator provenance structurally, validate immutable succeeded
bootstrap evidence through an owner-only callback issuer, redeem grants through
a parent-first owner-only primitive, remove the rollback-causing bootstrap FK,
and use enabled/non-forced RLS with an explicit common non-bypass owner and zero
application access.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `supabase/migrations/202610020001_every8d_settings_auth_foundation.sql` | C3a production schema and functions | Reviewed commit allowed grant reuse, nullable-pair bypass, mixed provenance, child-first redemption, FORCE-RLS owner dependence, and pre-lock issuance time. |
| `supabase/rollback/202610020001_every8d_settings_auth_foundation.sql` | C3a rollback graph | Parent-first correction was present, but the grant-to-bootstrap FK left an implicit bootstrap dependency. |
| `supabase/migrations/202609230002_every8d_public_oauth_bootstrap.sql` | Existing bootstrap invariants | Succeeded bootstrap context, claim, and terminal evidence are immutable; a plain read can validate provenance without a bootstrap row lock. |
| `supabase/migrations/202609270001_every8d_ghl_oauth_refresh_foundation.sql` | C1b non-interference | Refresh fields do not need to activate C3 lifecycle invalidation. |
| `supabase/migrations/202609300001_every8d_provider_configurations.sql` | C2 coexistence | C2 production objects remain out of scope. |
| `supabase/rollback/202609300001_every8d_provider_configurations.sql` | Separate maintenance review | Existing C2 rollback has a separate child-first/parent-trigger lock-order concern; it is not changed here. |
| `test/postgres/every8dSettingsAuthFoundation.sql` | Contract/ACL proof | Initial proof did not cover all reviewed negative and terminal cases. |
| `test/postgres/every8dSettingsAuthFoundation.sh` | PostgreSQL 17 race/rollback proof | Initial races did not prove parent-first redemption, non-bypass ownership, or all three populated rollback guards. |
| `.github/workflows/ci.yml` | CI gate | Existing PostgreSQL 17 job already invokes the C3a harness without skipping or continuing on error; no CI edit is required. |
| `docs/agent-run-log-template.md` | Required governance format | The original run log did not use the prescribed structure. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| Independent result was `C3A_CODE_REVIEW: CHANGES_REQUIRED`. | Authorized remediation request | Prior implementation must remain recorded as failed review; commit `219999e` is immutable. |
| Succeeded OAuth bootstrap identity and terminal state cannot be rebound. | OAuth bootstrap protection trigger | Supports a narrow callback issuer using a non-locking terminal read before the parent lock. |
| The C3a bootstrap FK is not required for application access control. | C3a ACL model | UUID can remain immutable audit evidence while protected issuance supplies trust and removes rollback FK locking. |
| FORCE RLS with no policies depends on superuser/BYPASSRLS behavior. | PostgreSQL ownership model and initial proof | Final model uses enabled/non-forced RLS, common ownership, no policies, and no application privileges. |
| PostgreSQL 17 server binaries are not part of the installed command-line tools. | Local environment inspection | A local PostgreSQL 17.11 installer/runtime was located for isolated validation; no production connection is used. |

## Commands executed and results

Do not include commands or output containing secrets, credentials, tokens, or
customer data.

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git status --short`, branch/HEAD/parent checks | Verify authoritative worktree | PASS before edits; clean, expected branch and SHAs | Work continued only in the authorized worktree. |
| `git fetch origin --prune`; `git rev-parse origin/main` | Detect base drift | PASS; `origin/main=45c45056e4f77396be57ecb87e73df526a2180d0` | No rebase or reset performed. |
| `bash -n test/postgres/every8dSettingsAuthFoundation.sh` | Shell syntax | PASS during remediation; final rerun required | No shell parse errors. |
| `git diff --check 219999e...` | Whitespace validation | PASS during remediation; final rerun required | Git emitted only line-ending conversion warnings. |
| C3a PostgreSQL 17.11 harness | Required remediation proof | PASS | Includes non-bypass ownership, all new races, callback/redemption cases, and rollback guards. |
| Public OAuth, OAuth refresh, and C2 harnesses | Regression evidence | PASS | Each completed against the isolated local PostgreSQL 17.11 server. |
| Marketplace ownership harness | Lifecycle regression evidence | PASS | Ownership, lifecycle state, concurrency, and guarded rollback assertions passed. |
| Marketplace lifecycle ordering harness | Lifecycle regression evidence | SQL assertions passed; Windows observer limitation reproduced | Baseline, stale/replay, chronology, registration, watermark, and rollback-guard assertions completed before the known Git Bash background/FIFO handoff limitation; no backend remained. |
| `npm run typecheck` | Type safety | PASS | No TypeScript diagnostics. |
| `npm test` | Full unit/integration test suite | PASS — 636/636 | Initial sandbox-only `dist/` write denial was rerun with scoped worktree write access. |
| `npm run build` | Production build | PASS | Standalone build completed. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Add global uniqueness on administrator grant ID | Implemented | Revocation cannot make a grant reusable; concurrency has a database backstop. |
| Keep bootstrap UUID but replace FK trust with protected issuance | Implemented | Generation-bound provenance and rollback lock-order goals can coexist without C1 changes. |
| Add parent-first redemption function | Implemented | Discovery can remain non-locking while all authority is revalidated after parent then grant locking. |
| Replace FORCE RLS with common-owner, non-forced RLS | Implemented | Definer operations no longer require superuser/BYPASSRLS and application ACLs remain empty. |
| Expand deterministic race and rollback proofs | Implemented in harness | Backend identity, `pg_blocking_pids`, wait events, and `pg_locks` are used at correctness barriers. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Amend reviewed commit `219999e` | Authorization requires the reviewed commit to remain immutable. |
| Retain bootstrap FK and impose a new global OAuth/C3 rollback order | Would expand into C1 coordination and retain an avoidable implicit relation dependency. |
| Retain FORCE RLS and assume production runs as `postgres` | Not portable and was a reviewed fail-open risk. |
| Grant callback or redemption functions to browser/application roles | C3a is database foundation only; verification/runtime authority belongs to later phases. |
| Patch the C2 rollback | Explicitly out of scope; recorded as separate maintenance. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `supabase/migrations/202610020001_every8d_settings_auth_foundation.sql` | Adds single-use grant enforcement, disjoint provenance, owner checks, callback issuance, parent-first redemption, non-forced RLS, and post-lock issuance time. | Database-only C3a contract; no function is application-callable. |
| `supabase/rollback/202610020001_every8d_settings_auth_foundation.sql` | Drops the two new C3a functions while preserving parent-first guarded rollback. | C3a-only empty-schema rollback. |
| `test/postgres/every8dSettingsAuthFoundation.sql` | Expands constraints, ACL/RLS, callback, redemption, reuse, HMAC, and terminal-history cases. | Test-only. |
| `test/postgres/every8dSettingsAuthFoundation.sh` | Adds non-bypass owner, redemption races, delayed-lock, lifecycle-generation, dependency, and rollback-refusal proofs. | Test-only. |
| `docs/every8d-c3a-settings-auth-foundation.md` | Aligns design and proof claims with remediation. | Documentation only. |
| `docs/agent-run-c3a-settings-auth-foundation.md` | Reworks this record to the required template and preserves review history. | Documentation only. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | PASS | No diagnostics. |
| `npm test` | PASS | 636 passed; 0 failed, cancelled, skipped, or todo. |
| `npm run build` | PASS | Standalone TypeScript build completed. |
| C3a PostgreSQL 17 proof | PASS | PostgreSQL 17.11; complete new contract/race/rollback suite passed. |
| C2 PostgreSQL regression | PASS | Provider configuration proof completed. |
| Public OAuth regression | PASS | Bootstrap, rollback, rendezvous, and concurrency proof completed. |
| OAuth refresh regression | PASS | Foundation, CAS, rollback, and concurrency proof completed. |
| Marketplace lifecycle proofs | PARTIAL HOST LIMITATION | Ownership harness passed. Lifecycle SQL assertions passed; the unchanged Windows Git Bash FIFO/background observer handoff then stopped the legacy shell runner with no backend left active. |
| Shell syntax | PASS | `bash -n` completed after final edits. |
| `git diff --check` | PASS | Only line-ending conversion warnings; no whitespace errors. |

## Budget and stop-rule status

- Active coding tasks: one, C3a independent-review remediation.
- Implementation correction loops used: one initial implementation correction
  for rollback order; no second implementation task.
- Reviewer correction loops used: one authorized independent-review remediation.
- Repeated errors or failed approaches: the command-line-only PostgreSQL install
  lacked server catalog files, so an existing local PostgreSQL 17.11 installer
  was extracted to an isolated temporary runtime. Two harness-fixture issues
  were corrected: a duplicate synthetic token hash and Git Bash rewriting a
  slash field separator passed to Windows `psql.exe`. Neither affected
  production SQL.
- Stop rule triggered: no. A new material defect would stop this cycle rather
  than trigger another correction loop.

## Unresolved decisions

- The Windows Git Bash FIFO/background-observer limitation may remain a
  host-specific non-blocking limitation because the underlying lifecycle SQL
  assertions passed and no backend remained active.
- **SEPARATE_C2_MAINTENANCE_FINDING:** the existing C2 rollback acquires child
  locks before the parent lock implicitly required by its parent trigger drop.
  This remediation neither introduces nor worsens that path. Its owner is a
  separate C2 maintenance task.
- No production migration decision is part of this task.

## Recommended next action

Perform the required base-to-head and remediation-only security diff review,
create one new local commit on top of
`219999edef772d92979a1ac6223b0d88ec902bbc`, and stop for independent
re-review without pushing or opening a pull request.
