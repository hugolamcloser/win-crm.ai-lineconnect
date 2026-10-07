# C3b-1 settings email challenge foundation run log

## Task identification

- GitHub task: C3b-1 EVERY8D Email Challenge DB Foundation — no GitHub issue/PR yet
- Approved branch: `codex/c3b1-every8d-settings-email-challenge-db-foundation`
- Worktree: `C:\Users\User\.codex\worktrees\f8f5\win-crm.ai-lineconnect-pilot00`
- Authoritative base: `9dfb9ab83e159d3f56ff95c8ed4d61eb8b9bb1a5`
- Reviewed implementation: `59f0d920f36c961259d799033ecd582a040ce49e`
- Authority level: Level 3, limited to the remaining C3b-1 HIGH lock-order finding and its direct tests/documentation; no production migration, deployment, PR, C3b-2, or C3b-3
- Started at: 2026-10-06 (Asia/Kuala_Lumpur)
- Last updated at: 2026-10-07 17:14:48 +08:00

## Task objective

Close the one remaining independent re-review HIGH finding without expanding
C3b-1: remove the challenge protection trigger's declaration-time enrollment-
grants dependency, prove the real login verification primitive in both rollback
directions on fresh backends, retain all prior 22 concurrency scenarios, and
revalidate every required Node/PostgreSQL gate. Definition of done is one amended
commit over the authoritative base, a clean worktree, and readiness for another
independent C3b-1 implementation re-review.

## Current hypothesis

The remaining lock inversion is closed by declaring the challenge protection
trigger's enrollment grant variable as `record`, so a fresh non-enrollment
backend cannot resolve the grants table composite type before entering the
trigger body. Catalog proof and two real login-verification/rollback races now
show no grants relation dependency. Final source and staged-diff checks must pass
before the existing single commit is amended.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `AGENTS.md` | Repository governance | Requires small scope, three Node gates, rollback notes, and no production access. |
| `docs/agent-run-log-template.md` | Review finding MEDIUM 4 | Defines the required headings and evidence tables used by this log. |
| `supabase/migrations/202610060001_every8d_settings_email_challenge_foundation.sql` | Findings HIGH 1/2 and MEDIUM 1/2 | Enrollment functions read child relations too early; state edges and batch validation were permissive. |
| `supabase/rollback/202610060001_every8d_settings_email_challenge_foundation.sql` | Rollback compatibility | Preserves installations → grants → administrators → challenges → failures ACCESS EXCLUSIVE order and the populated guard. |
| `test/postgres/every8dSettingsEmailChallengeFoundation.sql` | State/chronology/batch proof | Needed explicit illegal-edge, timestamp rewrite, chronology, and NULL-boundary cases. |
| `test/postgres/every8dSettingsEmailChallengeFoundation.sh` | Concurrency/deadline proof | Needed four enrollment rollback races and local deadlines around all actors and waits. |
| Unchanged PostgreSQL regression scripts | Regression boundary | Required native WSL/Linux execution against the same disposable PostgreSQL 17 chain. |
| All declaration blocks in the C3b migration | Remaining HIGH finding | Audited `%ROWTYPE`, `%TYPE`, table composites, defaults, initialization expressions, and pre-lock helper calls for hidden relation access. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| Reviewed HEAD and parent matched the authorization; initial worktree was clean. | Git verification | Remediation continued from the reviewed checkpoint without rebasing or restarting. |
| A rollback-first trial showed an ungranted grant-relation lock before the installation lock. | `pg_locks` in the new enrollment race | `%ROWTYPE` declaration resolution was itself an early child relation touch; changing enrollment variables to `record` was required. |
| The corrected rollback-first request and verification each waited on `ghl_marketplace_installations` with no grant/challenge/failure relation lock. | Final C3b harness lock snapshots | Demonstrates the child→parent inversion is removed rather than merely hidden by timing. |
| PostgreSQL reported version 17.11. | `SELECT version()` in local WSL2 container | Satisfies the authoritative PostgreSQL-major requirement. |
| Marketplace lifecycle observed backend 904 waiting on row-lock holder 882. | Unchanged lifecycle harness under WSL/Linux | Confirms genuine POSIX FIFO and database lock observation. |
| No production endpoints, credentials, or provider calls were used. | Command and diff review | All validation remained local and disposable. |
| `protect_every8d_settings_auth_challenge_v1()` retained an enrollment-grants `%ROWTYPE` after the earlier enrollment-function fixes. | Independent re-review plus migration audit | A fresh login verification could unexpectedly acquire grants metadata/locks from a non-enrollment trigger path. |
| The trigger now uses `grant_row record`; its grants query remains solely inside the enrollment INSERT branch. | Migration and catalog proof | Removes declaration-time grants access without changing state-edge semantics. |
| Remaining `%ROWTYPE` declarations are challenge-row types in challenge-operating routines; no `%TYPE` declarations or relation-accessing declaration defaults exist. | Full C3b declaration audit | Classified safe because they introduce no installation/grant/administrator relation dependency beyond each routine's explicit challenge operation. |
| Fresh login verifier PID 7477 held challenge/failure locks and no grants lock; rollback PID 7520 held grants and waited on its challenge lock. | Authoritative scenario 23 `pg_stat_activity`/`pg_locks` snapshot | Verification-first serialized at challenges with no child→grant edge. |
| Rollback PID 7590 held grants and waited at challenges; fresh verifier PID 7626 waited for `RowExclusiveLock` on challenges and held no grants lock. | Authoritative scenario 24 `pg_stat_activity`/`pg_locks` snapshot | Rollback-first serialized in the compatible queue with no deadlock. |

## Commands executed and results

No command or output contained production secrets, credentials, tokens, or
customer data.

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git status --short`, branch/HEAD/HEAD^/origin checks | Recover reviewed checkpoint | PASS; HEAD `59f0d920...`, parent/base/origin `9dfb9ab...`, one commit over base | The resumed three-file remediation diff was preserved; no automatic rebase required. |
| `wsl --status`, `wsl -l -v`, `uname -a`, OS/Bash checks | Verify genuine Linux transport | PASS | WSL2 Ubuntu 26.04.1 LTS, Linux 6.18.40.1, Bash 5.3.9. |
| `SELECT version()` | Verify disposable database version | PASS | PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2), 64-bit. |
| `npm run typecheck` | TypeScript validation | PASS, exit 0 | Final remediation source. |
| `npm test` | Full application regression suite | PASS, exit 0 | Initial sandbox run hit localhost `EACCES`; authorized unchanged rerun outside the network sandbox passed 636/636. |
| `npm run build` | Production TypeScript build | PASS, exit 0 | Final remediation source. |
| C3b PostgreSQL proof/harness | Schema, state, chronology, rollback, and concurrency | PASS, exit 0 | All prior 22 scenarios plus two fresh-backend login verification races; catalog assertion and built-in zero-backend cleanup passed. |
| `test/postgres/every8dSettingsAuthFoundation.sh` | C3a regression | PASS, exit 0 | Unchanged harness, PostgreSQL 17.11. |
| `test/postgres/every8dProviderConfigurations.sh` | C2 regression | PASS, exit 0 | Unchanged harness, PostgreSQL 17.11. |
| `test/postgres/ghlPublicOAuthBootstrap.sh` | OAuth bootstrap regression | PASS, exit 0 | Unchanged harness, PostgreSQL 17.11. |
| `test/postgres/ghlOAuthRefreshFoundation.sh` | OAuth refresh regression | PASS, exit 0 | Unchanged harness, PostgreSQL 17.11. |
| `test/postgres/ghlMarketplaceOwnership.sh` | Marketplace ownership regression | PASS, exit 0 | Unchanged harness, PostgreSQL 17.11. |
| `test/postgres/ghlMarketplaceLifecycleOrdering.sh` | Marketplace lifecycle regression | PASS, exit 0 | Unchanged script executed via an uncommitted LF `/tmp` copy under WSL/Linux POSIX; temporary copy removed. |
| `bash -n test/postgres/every8dSettingsEmailChallengeFoundation.sh` | Affected shell syntax | PASS, exit 0 | Native WSL Bash. |
| Interpolated WSL migration-loop attempt | Load disposable base schema | REJECTED before schema mutation | PowerShell consumed a Bash loop variable; setup was rerun as explicit individually bounded migration loads. |
| First fresh-container ownership invocation | Begin authoritative regression chain | REJECTED before schema mutation | WSL stopped the disposable container between calls; final invocations start the exact container in the same bounded WSL command. |
| `git diff --check` | Pre-amend whitespace gate | PASS, exit 0 | Exactly four authorized remediation paths; no whitespace errors or untracked files. |
| `git diff --cached --check` | Staged remediation gate | PASS, exit 0 | Exactly four authorized remediation paths; full cached diff inspected. |
| `git diff --check origin/main...HEAD` | Post-amend diff gate | Pending amendment | Final SHA is recorded in the remediation report; a commit cannot contain its own SHA. |

## Concurrency scenario coverage

All database actors use a unique `c3b_<run-id>_<scenario>_<role>` application
name. Actor statements have a 45-second `statement_timeout`, relation waits a
35-second `lock_timeout`, Docker/psql processes a 50-second shell timeout, and
poll/process/barrier observations a 30-second deadline. The 90-second sleep is
only a bounded transaction holder and is released after observed lock evidence.

| Scenario | Test section and actors | Deterministic barrier / blocking evidence | Final assertion |
| --- | --- | --- | --- |
| 1. Simultaneous resend | `simresend` first/second | Advisory barrier; PID, blockers, wait event, locks | One winner; second hits committed limit. |
| 2. Correct vs correct | `correct_correct` verifiers | Advisory barrier and identity lock queue | Exactly one verification transition. |
| 3. Correct vs wrong | `correct_wrong` verifiers | Advisory barrier and blocker PID | Correct result wins; no late failure append. |
| 4. Correct vs fifth failure | `correct_fifth` verifiers | Advisory barrier and blocker PID | Serialized verified-or-locked legal result. |
| 5. Grant revocation vs request | `revoke_request` actors | Parent/grant row observation | Request/revocation serialize and revalidate. |
| 6. Grant consumption vs verification | `consume_verify` actors | Parent/grant row observation | Verification/consumption serialize. |
| 7. Delivery result vs resend | `delivery_resend` actors | Challenge row blocker evidence | Delivered history is then superseded. |
| 8. Cleanup vs verification | `cleanup_verify` actors | Row lock plus SKIP LOCKED completion | Cleanup skips, then deletes after release. |
| 9. Expiry scrub vs verification | `scrub_verify` actors | Row lock and blocker PID | Scrub commits; verification returns false. |
| 10. Expiry scrub vs resend | `scrub_resend` actors | Observed nonblocking SKIP scope | Both independent outcomes persist. |
| 11. Expiry scrub vs cleanup | `scrub_cleanup` actors | Row lock plus SKIP LOCKED completion | Cleanup skips, then deletes after release. |
| 12. Login request first / rollback second | `request_rb` actors | Advisory holder; rollback relation wait | Request commits; populated rollback refuses. |
| 13. Rollback first / login request second | `rb_req` actors | Child blocker pauses rollback after parent locks | Request waits on rollback; no deadlock. |
| 14. Login resend first / rollback second | `resend_rb` actors | Advisory holder; rollback relation wait | Resend commits; rollback refuses. |
| 15. Rollback first / login resend second | `rb_resend` actors | Child blocker and parent lock evidence | Resend proceeds after rollback refusal. |
| 16. Discovery releases child lock | FIFO discovery and parent actors | Idle autocommit observation and `pg_locks` | Later parent wait holds no challenge lock. |
| 17. Unknown/scrubbed/terminal no authority | Three discovery observers | PgSleep observation and advisory-lock query | No identity result and no advisory lock. |
| 18. Grant lifecycle parent-first | Parent/request/grant actors | Parent row blocker and independent grant update | Request revalidates after parent release. |
| 19. Enrollment request first / rollback second | `enreq_rb` actors | Advisory holder; rollback installation wait | Request commits; rollback refuses. |
| 20. Rollback first / enrollment request second | `rb_enreq` actors | Rollback holds parents; request waits on installation | No child relation lock; request proceeds after refusal. |
| 21. Enrollment verification first / rollback second | discovery then `enverify_rb` actors | Separate discovery commit; rollback installation wait | Verification commits; rollback refuses. |
| 22. Rollback first / enrollment verification second | discovery then `rb_enverify` actors | Rollback holds parents; verifier waits on installation | No child relation lock; verification succeeds after refusal. |
| 23. Fresh login verification first / rollback second | `loginverify_rb` barrier/verifier/rollback | Fresh PID 7477 waits on advisory barrier; rollback PID 7520 holds grants and waits on verifier at challenges | Verifier has no grants relation lock; verification commits, rollback guard refuses, no deadlock. |
| 24. Rollback first / fresh login verification second | `rb_loginverify` blocker/rollback/verifier | Rollback PID 7590 holds grants and queues at challenges; fresh verifier PID 7626 queues `RowExclusiveLock` at challenges | Verifier has no grants relation lock; it succeeds after rollback refusal, no deadlock. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Add explicit parent-first `LOCK TABLE` statements while retaining `%ROWTYPE` variables. | Incomplete in the first trial. | PL/pgSQL row-type resolution requested a grant relation lock before body execution. |
| Replace enrollment mutation row variables with `record` and assert the exact waited-on relation. | PASS in the final fresh-container run. | Request and verification waited on installations and held no child relation lock. |
| Encode state transitions as exact OLD→NEW predicates. | PASS. | Illegal jumps, combined edges, timestamp rewrites, and premature scrub were rejected. |
| Add immediate and deferred delivery chronology checks. | PASS. | Pre-delivery failure/lock/verify/supersession rejected; valid boundary accepted; five-row bypass transaction failed at deferred integrity. |
| Replace the remaining trigger-local enrollment grant `%ROWTYPE` with `record` and exercise the real login verification primitive from fresh backends. | PASS in two independent PostgreSQL 17.11 runs. | Login verification acquired no grants relation lock in either rollback direction. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Depend on planner relation-access order. | It does not freeze relation lock order against rollback. |
| Treat a target timestamp becoming non-null as a legal transition. | It permits multi-edge state jumps and timestamp rewrites. |
| Use arbitrary sleep timing as race correctness evidence. | Correctness uses observed backend state, blockers, wait events, and locks with deadlines. |
| Modify the Marketplace lifecycle regression for Windows. | The authorized requirement was the unchanged script under genuine POSIX/Linux. |
| Keep WSL adapters or LF copies in the repository. | They are test transport artifacts, not C3b-1 product source. |
| Treat cached PL/pgSQL metadata as proof of safety. | Both new race actors use distinct fresh `psql` backends and assert recent backend start time. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `supabase/migrations/202610060001_every8d_settings_email_challenge_foundation.sql` | Replaced the challenge protection trigger's grant `%ROWTYPE` with `record`. | Removes hidden declaration-time grants access from non-enrollment challenge operations. |
| `test/postgres/every8dSettingsEmailChallengeFoundation.sql` | Added catalog proof forbidding the trigger-local enrollment-grants `%ROWTYPE` dependency and requiring `record`. | Test-only. |
| `test/postgres/every8dSettingsEmailChallengeFoundation.sh` | Added two fresh login-verification/rollback directions, no-grants lock assertions, and isolated legal fixtures. | Test-only and CI validation. |
| `docs/agent-run-c3b1-settings-email-challenge-foundation.md` | Recorded the remaining HIGH finding, full declaration audit, fresh-backend evidence, and final gates. | Documentation only. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | Exit 0. |
| `npm test` | Passed | 636/636, exit 0. |
| `npm run build` | Passed | Exit 0. |
| C3b PostgreSQL 17 proof | Passed | PostgreSQL 17.11; 24 deterministic scenarios, static/catalog trigger proof, and zero-backend cleanup assertion. |
| Exact state-machine and chronology proof | Passed | Illegal combined edges, authority timestamp rewrites, premature scrub, and pre-delivery chronology remained rejected. |
| Maintenance batch bounds | Passed | `NULL`, 0, and 501 rejected; 1 and 500 accepted for scrub and cleanup. |
| C3a regression | Passed | Unchanged harness. |
| C2 regression | Passed | Unchanged harness. |
| OAuth bootstrap regression | Passed | Unchanged harness. |
| OAuth refresh regression | Passed | Unchanged harness. |
| Marketplace ownership regression | Passed | Unchanged harness. |
| Marketplace lifecycle regression | Passed | Unchanged script in WSL2/Linux POSIX. |
| Affected shell syntax | Passed | WSL Bash 5.3.9. |
| Disposable infrastructure cleanup | Passed | Harness asserted zero matching backends; exact disposable containers and `/tmp` LF copies removed. |
| Production changes | None | No production access, migration, rollback, provider call, deployment, or credential use. |

## Budget and stop-rule status

- Active coding tasks: one
- Implementation correction loops used: zero in this remediation
- Reviewer correction loops used: the prior correction plus this explicitly authorized final targeted lock remediation
- Repeated errors or failed approaches: one non-mutating WSL interpolation failure and one stopped-container precondition failure; both were environment invocation issues corrected with explicit commands and same-session container startup
- Stop rule triggered: no

## Unresolved decisions

None. The final staged diff, amendment, post-amend SHA/count/status, and diff checks
are mechanical closure gates, not design decisions. The amended commit SHA is
necessarily recorded in the final remediation report because a Git commit cannot
contain its own immutable SHA.

## Recommended next action

After the final diff gates and single-commit amendment pass, request independent
C3b-1 implementation re-review. Do not open a PR, deploy, migrate production, or
begin C3b-2/C3b-3.
