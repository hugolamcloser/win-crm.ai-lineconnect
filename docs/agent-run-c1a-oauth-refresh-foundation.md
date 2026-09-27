# Agent run log: C1a OAuth refresh database foundation

## Task identification

- GitHub task: C1a HighLevel OAuth refresh database foundation
- Approved branch: `feature/every8d-ghl-oauth-refresh-db-foundation`
- Authority level: Level 3, Draft PR only; no merge/deploy/migration application
- Started at: 2026-09-27 Asia/Kuala_Lumpur
- Last updated at: 2026-09-27 Asia/Kuala_Lumpur

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
| Existing service role has only legacy credential-column DML | Grant inspection | New refresh columns add no direct DML; refresh transitions are RPC-only. |

## Commands executed and results

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git fetch origin` | Refresh authoritative base | Passed | Exact required SHA verified. |
| `git status --porcelain=v1` | Clean-worktree gate | Passed | No pre-existing changes. |
| `git switch -c ... origin/main` | Exact-base feature branch | Passed | Branch created at authoritative SHA. |
| `npm run typecheck` | Mandatory static validation | Passed | No TypeScript errors. |
| `npm test` | Mandatory Node validation | Passed | 605/605 tests passed. |
| `npm run build` | Mandatory build validation | Passed | TypeScript build completed. |
| Draft PR CI run `36311203401` | First PostgreSQL 17 execution | Failed in test transport | Host migration path was incorrectly passed to container-local `psql -f`; corrected to stdin streaming. |
| Draft PR CI run `36311355457` | Second PostgreSQL 17 execution | Failed in stale-lease fixture | Protection trigger correctly rejected owner fixture timestamp backdating; fixture now disables/re-enables only that trigger around synthetic clock setup. |
| Draft PR CI run `36311489324` | Final permitted PostgreSQL 17 execution | Failed after most C1a proofs | Authorization-code finalize returned success, but the following usable-revision-one assertion failed. The disposable database was destroyed before the resulting row could be inspected. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Extend existing lifecycle/finalize writes through trigger v5 | Implemented | Preserves both deployed function signatures and atomic transactions. |
| Fixed five-minute due window and lease | Implemented | No caller-controlled refresh horizon. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Automatically recycle an expired lease to usable | Could replay a HighLevel refresh token already consumed remotely. |
| Add refresh methods/callers to TypeScript | C1a is database foundation only; runtime belongs to C1b. |
| Replace lifecycle-v2 merely to add fields | Trigger extension preserves its current semantics and reduces rollback risk. |

## Files changed

See the final task report; validation evidence is updated after all checks run.

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | |
| `npm test` | Passed | 605/605. |
| `npm run build` | Passed | |
| PostgreSQL 17 suite | Failed | Final failure: first authorization finalization metadata assertion; prior backfill, rollback/reapply, concurrency, CAS, failure-burn, stale-lease, and UNINSTALL proofs reached/passed. |

## Budget and stop-rule status

- Active coding tasks: 1
- Implementation correction loops used: 2
- Reviewer correction loops used: 0
- Repeated errors or failed approaches: three distinct PostgreSQL harness/assertion failures
- Stop rule triggered: yes; two correction loops exhausted

## Unresolved decisions

The exact post-finalization credential metadata row must be captured and the
failed authorization-finalization compatibility assertion diagnosed in a newly
approved follow-up. C1b runtime, rollout, provider activation, and production
migration remain separately gated work.

## Recommended next action

Keep Draft PR #105 unmerged. Review the final PostgreSQL failure and authorize a
follow-up correction only if desired; do not apply the migration or begin C1b.
