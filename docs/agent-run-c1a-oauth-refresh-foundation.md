# Agent run log: C1a OAuth refresh database foundation

## Task identification

- GitHub task: C1a HighLevel OAuth refresh database foundation
- Approved branch: `feature/every8d-ghl-oauth-refresh-db-foundation`
- Authority level: Level 3, Draft PR only; no merge/deploy/migration application
- Started at: 2026-09-27 Asia/Kuala_Lumpur
- Last updated at: 2026-09-28 Asia/Kuala_Lumpur

## Task objective

Add only the PostgreSQL state machine, CAS/lease RPCs, guarded rollback,
PostgreSQL 17 proofs, and focused documentation required before a future
HighLevel rotating-refresh-token runtime.

## Current hypothesis

A row-locked `usable -> refreshing` claim with exact generation/revision/lease
CAS, terminal ambiguity burn, and atomic lifecycle scrubbing prevents two
Railway workers from replaying one rotating refresh token.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `supabase/migrations/202609230002_every8d_public_oauth_bootstrap.sql` | Preserve Gate-B contracts | Lifecycle-v2 and authorization finalization already lock/update the installation atomically. |
| `src/services/every8dGhlOAuthRepository.ts` | Check row contract | Strict full-row parsing requires additive C1a fields in its schema. |
| `test/postgres/ghlPublicOAuthBootstrap.sh` | Extend concurrency proof | Leaves the post-D3 OAuth bootstrap applied for the C1a runner. |
| `.github/workflows/ci.yml` | PostgreSQL 17 execution | Disposable PostgreSQL 17 service is the supported proof environment. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| `origin/main` is `4981878fd448d70e1a6d2d239ab6a2f8a238a69d` | Mandatory drift gate | Implementation branch created directly from the authoritative remote commit. |
| Local `main` was stale and worktree/index were clean | Git inspection | Stale local branch was not used. |
| Existing credential constraint permits complete token fields with empty scopes | Schema inspection | C1a preflight explicitly rejects this partial authorization tuple. |
| Pre-C1a service role has no table-wide installation UPDATE; it has column UPDATE on exactly five credential columns | Authoritative migration-chain and normalized ACL inspection | C1a and its rollback must preserve that exact least-privilege state. |
| The refresh test reused a globally unique OAuth state from the preceding suite | PostgreSQL 17 CI evidence plus fixture search | The target callback was correctly rejected; a distinct synthetic state/binding pair isolates the C1a authorization-finalization proof. |
| Strict post-C1a-only parsing creates a deploy-order deadlock | Repository schema and Gate-B write-path inspection | The application parser now accepts exact complete pre-C1a or post-C1a rows while rejecting partial and unknown shapes. |
| Caller-supplied failure class survived an already-expired exact lease | Failure RPC inspection | Expired failure now always persists `refresh_outcome_unknown`; unexpired failures preserve the enumerated input. |

## Authoritative final technical-head evidence

| Evidence | Result |
| --- | --- |
| PR head | `7de9ee47fbadd0bf4271dc17b004e63dc634cebe` |
| Exact-head GitHub CI run | `36324660987` |
| `validate` job | SUCCESS |
| `postgres-concurrency` job | SUCCESS |
| Node tests | 607/607 passed; 0 failed |
| Typecheck | PASS |
| Build | PASS |

## Commands executed and results

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git fetch origin` | Refresh authoritative base | Passed | Exact required SHA verified. |
| `git status --porcelain=v1` | Clean-worktree gate | Passed | No pre-existing changes. |
| `git switch -c ... origin/main` | Exact-base feature branch | Passed | Branch created at authoritative SHA. |
| `npm run typecheck` | Mandatory static validation | Passed | No TypeScript errors. |
| `npm test` | Initial implementation Node validation | Passed | Historical result: 605/605 tests passed. |
| `npm run build` | Mandatory build validation | Passed | TypeScript build completed. |
| Draft PR CI run `36321629096` | Verify stale lease and grant correction | Failed at authorization compatibility | All proofs through stale lease and both UNINSTALL orders passed; isolated the remaining authorization fixture issue. |
| Draft PR CI run `36321910760` | Verify explicit authorization metadata finalization | Failed at the same target-row assertion | Confirmed the finalizer was not the cause; fixture inspection found collision with an earlier globally unique OAuth state. |
| Draft PR CI run `36322112626` | Final PostgreSQL 17 and Node validation | Passed | All PostgreSQL concurrency/invariant/rollback suites and Node validation passed. |
| `git fetch origin` plus exact branch/PR/worktree checks | Final blocker repair drift gate | Passed | Base `4981878...`, prior head `5669b1c...`, Draft/Open/Unmerged PR #105, authorized branch, clean worktree. |
| `npm run typecheck` | Final blocker repair static validation | Passed | Dual-shape model compiles without callers assuming C1a fields. |
| `npm test` | Final blocker repair Node validation | Passed | 607/607 tests passed, including exact pre/post and malformed/partial parser cases. |
| `npm run build` | Final blocker repair build validation | Passed | TypeScript build completed. |
| `bash -n test/postgres/ghlOAuthRefreshFoundation.sh` | Shell syntax validation | Passed | The strengthened PostgreSQL proof script parses cleanly. |
| GitHub CI run `36324660987` at exact head `7de9ee47fbadd0bf4271dc17b004e63dc634cebe` | Authoritative exact-head validation | Passed | `validate`: SUCCESS; `postgres-concurrency`: SUCCESS; Node: 607/607 passed, 0 failed; typecheck: PASS; build: PASS. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Extend existing lifecycle writes through trigger v5 and explicitly replace authorization finalization | Implemented | Preserves deployed signatures/checks, initializes metadata deterministically, and lets reauthorization invalidate an older refresh lease atomically. |
| Fixed five-minute due window and lease | Implemented | No caller-controlled refresh horizon. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Automatically recycle an expired lease to usable | Could replay a HighLevel refresh token already consumed remotely. |
| Add refresh methods/callers to TypeScript | C1a is database foundation only; runtime belongs to C1b. |
| Replace lifecycle-v2 merely to add fields | Trigger extension preserves its current semantics and reduces rollback risk. |

## Overall PR files changed

| File | Focused change |
| --- | --- |
| `.github/workflows/ci.yml` | Runs the dedicated C1a PostgreSQL 17 proof separately from the generic migration loop while preserving required failure behavior. |
| `docs/agent-run-c1a-oauth-refresh-foundation.md` | Run evidence, validation history, and exact overall PR changed-files accounting. |
| `docs/every8d-ghl-oauth-refresh-foundation.md` | Required rollout sequence and repaired semantics. |
| `src/services/every8dGhlOAuthRepository.ts` | Explicit strict pre/post-C1a installation types and compatibility parser. |
| `supabase/migrations/202609270001_every8d_ghl_oauth_refresh_foundation.sql` | Expired failure-class canonicalization. |
| `supabase/rollback/202609270001_every8d_ghl_oauth_refresh_foundation.sql` | Exact five-column base UPDATE ACL restoration. |
| `test/every8dGhlOAuthRepository.test.cjs` | Exact dual-shape acceptance and malformed/partial rejection proofs. |
| `test/postgres/ghlOAuthRefreshFoundation.sh` | ACL/definition equality, expired fail/finalize, deterministic stale lease, and reauthorization proofs. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | Final blocker repair local validation. |
| `npm test` | Passed | 607/607 in final blocker repair local validation. |
| `npm run build` | Passed | Final blocker repair local validation. |
| PostgreSQL 17 suite | Exact-head CI gate | Full migration chain plus backfill, rollback/reapply, ACL/function equality, two-session claim, CAS, all terminal failure classes, expired failure/finalize, deterministic stale lease, reauthorization, UNINSTALL races, RLS/grants, and rollback guard. |

## Budget and stop-rule status

- Active coding tasks: 1
- Implementation correction loops used in the authorized continuation: 2
- Reviewer correction loops used: 1
- Repeated errors or failed approaches: authorization target-row assertion repeated until the globally unique state collision was identified from materially new CI evidence
- Stop rule triggered: no; the final correction was evidence-driven and the full suite passed

## Unresolved decisions

None for C1a review. C1b runtime, rollout, provider activation, and production
migration remain separately gated work.

## Recommended next action

Review Draft PR #105. Keep it unmerged; do not apply the migration or begin C1b.

## Security self-review

- Rotating-token replay/two workers: one row lock, one lease, one revision; the
  second claim receives no work.
- Expired or ambiguous leases: terminal `reauth_required`, sanitized
  `refresh_outcome_unknown`, credential scrub, no replay; expired failure input
  cannot override the ambiguity classification.
- `invalid_grant`: terminal credential scrub; reauthorization is required.
- Late finalize/stale generation: exact generation, revision, and lease CAS;
  UNINSTALL or reauthorization invalidates the prior claim.
- UNINSTALL/reinstallation: both race orders proved; accepted UNINSTALL leaves
  no credentials or lease, and a new generation inherits no authorization.
- Ownership/version/tenant: exact app, client, tenant, Location, company,
  provider, signed version, lifecycle, and generation are revalidated under the
  row lock.
- Direct DML/RLS: browser roles have no access; `service_role` cannot update
  refresh or protected lifecycle/ownership columns directly, retains only the
  five pre-C1a credential-column UPDATE grants, and uses the three narrow
  refresh RPCs.
- Secret handling: SQL never decrypts or returns plaintext; tests use synthetic
  ciphertext and do not print credential values.
- Rollback: refuses revisions above baseline, lease/refreshing evidence,
  reauthorization-required state, success timestamps, and failure evidence.
- Isolation: no LINE, provider activation, EVERY8D API, SMS, Railway, flag, or
  production database path changed.
