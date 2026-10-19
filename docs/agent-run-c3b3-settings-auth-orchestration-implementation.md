# EVERY8D C3b-3 settings-auth orchestration implementation run log

## Task identification

- GitHub task: EVERY8D C3b-3 settings auth orchestration implementation
- Authoritative base: `64d2418ab592e710d92eaa58ddd6b570f7473585`
- Approved branch: `codex/c3b3-settings-auth-orchestration-implementation`
- Worktree: `C:\Users\User\.codex\worktrees\c3b3-settings-auth-orchestration-implementation\win-crm.ai-lineconnect-pilot00`
- Independently reviewed implementation HEAD: `acbe208c09d696ced8522fdba75196268d16a00e`
- Round-2 reviewed HEAD: `0b5052e03dc3efc2f4a87e423d38d84470fb6b72`
- Final-gate reviewed HEAD: `7534d51a3b33476a8b6a4d828cbcb009c9660ca5`
- Final-approval reviewed HEAD: `c08841b41f8e01be73144678c798ce49ce33c1cd`
- F2 final-approval reviewed HEAD: `4a8cfcedb74fc06c052d2bd988de2639e91941c1`
- Authority level: C3b-3 implementation/remediation only; no push, PR, deploy, production action, or C3c
- Started at: 2026-10-14 (Asia/Kuala_Lumpur)
- Last updated at: 2026-10-16 (Asia/Kuala_Lumpur)
- Scope: C3b-3 only; C3c was not started.

## Task objective

Implement the frozen C3b-3 route-free settings-auth orchestration contract with
exactly five runtime wrappers, three owner-only cores, a narrow five-operation
repository, complete TypeScript and PostgreSQL proofs, and PostgreSQL 17 CI
wiring. Round 2 closes only the reviewed timestamp-offset, rollback-identity,
PostgreSQL proof-matrix, repository-test, and run-log gaps. The final F1-F4
remediation corrects the rollback body baseline, adds enrollment creation,
expiry, resend, and recent-failure wrapper evidence, and records the current
governance exception. This final F2 closure adds the previously missing matched
enrollment validation, rate-boundary, and concurrency parity evidence. The F2
final correction repairs masked hourly/daily fixtures, separates four
registration/status/lifecycle predicates, and adds matched delivery/resend and
parent-first lifecycle races.

## Current hypothesis

The smallest safe surface remains eight SQL functions. Only the five wrappers
are executable by `service_role`; PostgreSQL remains the exclusive state-machine
authority. Round 2 hardens validation and proof coverage without changing the
merged contract, runtime authority, routes, LINE, production configuration, or
feature flags.

## Independent review history

The first independent implementation review returned:

- CRITICAL: 0
- HIGH: 2
- MEDIUM: 5
- LOW: 2
- BLOCKING: 6

The first remediation closed the login-authority, expected-negative,
preflight/ACL, response-validation, rollback dependency, and initial proof gaps.

The final re-review returned:

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 4
- LOW: 2
- INFORMATIONAL: 1
- BLOCKING: 4

The second remediation attempted to close those four findings. The subsequent
final implementation gate at reviewed HEAD
`7534d51a3b33476a8b6a4d828cbcb009c9660ca5` identified four remaining blockers:
F1 rollback body hashes omitted the stored terminating LF; F2 enrollment parity
used loose expiry evidence and login rather than enrollment resend evidence; F3
recent-failure translation was not traversed through runtime request wrappers;
and F4 the reviewer-loop governance state was not recorded accurately. This
final remediation is limited to those four findings.

The subsequent final approval review at reviewed HEAD
`c08841b41f8e01be73144678c798ce49ce33c1cd` returned:

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 1
- LOW: 2
- INFORMATIONAL: 1
- BLOCKING: 1

F1 rollback identity, F3 recent-failure runtime translation, F4 governance, and
the runtime/repository regression review were closed. The one remaining F2
finding was that matched enrollment v1/runtime evidence did not yet trace every
unchanged validation, rate-limit, and concurrency rule. The already-authorized
one-time C3b-3 reviewer-loop exception covers this closure; no new exception was
requested or recorded.

The subsequent independent F2 final approval review at reviewed HEAD
`4a8cfcedb74fc06c052d2bd988de2639e91941c1` returned:

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 3
- LOW: 2
- INFORMATIONAL: 1
- BLOCKING: 3

The three blockers remained within the already-known F2 obligation: R02/R03
were masked by the current-grant cap, application registration and
status/lifecycle authority predicates were not isolated, and delivery/resend
plus parent-first lifecycle concurrency did not yet have matched v1/runtime
actors. The existing one-time closure exception covers this correction; no new
exception was created or claimed.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `AGENTS.md` | Governance and protected flows | Requires focused, secret-safe changes and all three local validation gates. |
| `docs/every8d-c3b3-settings-auth-orchestration-contract.md` | Frozen authority | Confirms exactly eight functions, exact mappings, lock order, and proof obligations. |
| `docs/agent-run-c3b3-settings-auth-orchestration-contract.md` | Contract evidence | Confirms no unresolved C3b-3 security/concurrency question. |
| `src/services/every8dSettingsAuthRepository.ts` | Timestamp/repository boundary | Numeric offsets required a PostgreSQL-compatible 15:59 maximum. |
| `supabase/rollback/202610140001_every8d_settings_auth_orchestration.sql` | Guarded removal | All behavior/security-relevant `pg_proc` identity must be frozen before revoke. |
| `test/every8dSettingsAuthOrchestration.test.cjs` | Repository/service proof | All five methods needed complete response/error/rejection matrices. |
| `test/postgres/every8dSettingsAuthOrchestration.sql` | Database behavior proof | Parity, wrapper limits, stale discovery, expiry, and separate lifecycle/generation proofs were expanded. |
| `test/postgres/every8dSettingsAuthOrchestration.sh` | Race/rollback proof | Added genuine races and atomic property-tamper refusals. |
| `.github/workflows/ci.yml` | Hosted proof ordering | PostgreSQL 17 already runs C3a, C3b-1, then C3b-3 exactly once. |
| `docs/agent-run-log-template.md` | Required structure | This log now follows the template sections. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| `origin/main` equals the authoritative base; reviewed HEAD was clean and one commit over base. | Git precheck | No precondition drift, rebase, branch, or worktree change. |
| PostgreSQL numeric displacement stops at 15:59. | Reviewed PostgreSQL 17 finding | `+/-16:00` and `+/-23:59` now fail as repository contract violations. |
| Rollback froze body/result but not every catalog property. | Rollback audit | Guard now checks kind, return/set shape, all argument metadata/defaults, language, owner, security, volatility, strictness, parallelism, leakproof state, search path, and body. |
| Some synthetic proof fixtures inserted delivery state directly. | Round-2 harness audit | Synthetic challenge rows were removed or replaced where they bypassed the real delivery transition; applicable pending fixtures now use the runtime delivery bridge, and the orphan is committed through the runtime request wrapper. |
| The rollback body hashes matched bodies only after removing the final LF. | Final F1 independent hash derivation | `prosrc` retains the leading and terminating LF; canonicalization removes CR only, so all eight baselines were recomputed from the literal migration bodies. |
| Enrollment parity originally asserted only a loose expiry bound and used login resend fixtures. | Final F2 audit against the frozen parity section | The F1-F4 remediation added matched long/short expiry and enrollment resend cases, but the later final approval review correctly found that validation, all rate boundaries, and enrollment concurrency were still not matched end to end. |
| Matched enrollment validation/rate/concurrency traceability remained incomplete. | Final approval review at `c08841b41f8e01be73144678c798ce49ce33c1cd` | The first F2 closure added V01-V12, E01-E07, R01-R05, and C01-C05 without changing runtime authority. |
| R02/R03 history used the current request grant, masking hourly refusal and making the nine-row daily pass fixture invalid under the three-per-grant cap. | F2 final approval review at `4a8cfcedb74fc06c052d2bd988de2639e91941c1` | R02 history now uses one separate grant per identity; R03 distributes history over four grants per identity. SQL assertions prove the request grant has zero prior rows and stricter windows/failures remain below threshold. |
| Application registration was absent as an isolated case and status/lifecycle were conflated. | F2 final approval review | E05 changes only the registration relationship, E06 only version registration, E08 only status, and E09 only lifecycle; protection/invalidation triggers are restored before calls and savepoints restore all fixture state. |
| Delivery/resend and parent-first lifecycle concurrency parity were missing. | F2 final approval review | C06 runs both legal winner orders with real pending rows and delivery authorities; C07 blocks both request versions at separately locked parents, proves child grants remain lockable, then invokes the reviewed lifecycle authority and proves post-transition revalidation rejects stale authority. |
| The recent-failure threshold had helper-level evidence only. | Final F3 audit | Both affected runtime request wrappers now prove nine failures prepare and ten failures return zero rows while other request limits remain below threshold. |
| CI prerequisite order and single C3b-3 application are already correct. | Workflow audit | No round-2 workflow change is needed and no prior proof is weakened. |

## Commands executed and results

No command or output used production credentials, customer data, production
systems, Railway, email, SMS, or LINE.

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git fetch origin` and coordinate checks | Verify base, branch, HEAD, cleanliness, and history | PASS | F2 final correction started from exact reviewed HEAD `4a8cfcedb74fc06c052d2bd988de2639e91941c1`, clean and one commit over base. |
| Complete contract reads | Reconfirm frozen behavior | PASS | No ambiguity found. |
| `npm run typecheck` | TypeScript validation | PASS | Completed without errors after the F2 final correction edits. |
| Focused C3b-3 test | Repository/service validation | PASS | 15/15 tests passed after the F2 final correction edits. |
| `npm test` | Full repository validation | PASS | 696/696 tests passed after the F2 final correction edits. |
| `npm run build` | Compile current source | PASS | Completed after the F2 final correction edits. |
| `git diff --check` | Whitespace validation | PASS | No errors after the F2 final correction edits. |
| Git Bash syntax check | Validate shell harness | PASS | `bash -n` completed without errors after the F2 final correction edits. |
| PostgreSQL 17 executable proof | Run disposable migration/race/rollback proof | UNAVAILABLE | No safe local server; no external database contacted. |
| Migration-body MD5 derivation | Recompute all eight rollback baselines from literal migration bodies | PASS | CR-only normalization retained both boundary LF characters; all values matched the final-gate reviewer values. |

## Final F1 canonical rollback identities

The derivation reads the UTF-8 text literally between each migration
`AS $$`/`$$;` delimiter, excludes the delimiters, removes every carriage-return
character exactly as the rollback guard does, retains the leading and
terminating LF stored in `pg_proc.prosrc`, and computes MD5 over those canonical
UTF-8 bytes. The independently recomputed baselines are:

| Function | Canonical body MD5 |
| --- | --- |
| `runtime_request_every8d_settings_enrollment_challenge_v1` | `8dbacb2e70fd6889ff0f3ecb4fb8a007` |
| `runtime_request_every8d_settings_login_challenge_v1` | `f3c0565962423369d967d43f49890b5a` |
| `runtime_record_every8d_settings_challenge_delivery_v1` | `f430dd79d662e5f153efd79deff73529` |
| `runtime_discover_every8d_settings_challenge_v1` | `1ebb4631133d210ffa477b47edf04b89` |
| `runtime_verify_every8d_settings_challenge_v1` | `847a9a7b369a4a8d44792e920a79878f` |
| `request_every8d_settings_enrollment_challenge_core_v2` | `b6d7fe686a0dece0bcc8724f90a210b5` |
| `request_every8d_settings_login_challenge_core_v2` | `ce5468a69ccd8af369045a16359a57f9` |
| `verify_every8d_settings_challenge_core_v2` | `598326fff45f553210619f009513057f` |

## Final F2 enrollment parity coverage matrix

Every row below invokes the real C3b-1 enrollment request and the real C3b-3
runtime enrollment request. `Matched` means equivalent independent grants,
emails, pseudonyms, history, and authoritative state; it never means calling a
shared helper in place of either request path. For expected negatives, v1's
frozen exception and v2's frozen zero-row representation are asserted without
message parsing.

| Contract rule | V1 executable proof | V2/runtime executable proof | Matched fixture? | Assertion | Status |
| --- | --- | --- | --- | --- | --- |
| Canonical normalized email | V01 v1 call | V01 runtime call | Yes | Both reject static input with `23514` | Covered |
| Active pseudonym validity | V02 v1 call | V02 runtime call | Yes | Both reject | Covered |
| Active pseudonym belongs to aliases | V03 v1 call | V03 runtime call | Yes | Both reject | Covered |
| Alias array is non-null | V04 v1 call | V04 runtime call | Yes | Both reject | Covered |
| Alias cardinality minimum 1 | V05 v1 call | V05 runtime call | Yes | Both reject empty arrays | Covered |
| Alias cardinality maximum 64 | V06 v1 call | V06 runtime call | Yes | Both reject 65 aliases | Covered |
| Every alias is non-null | V07 v1 call | V07 runtime call | Yes | Both reject a null member | Covered |
| Every alias is a valid pseudonym | V08 v1 call | V08 runtime call | Yes | Both reject malformed members | Covered |
| Request-token digest is 32 bytes | V09 v1 call | V09 runtime call | Yes | Both reject 31 bytes | Covered |
| OTP HMAC digest is 32 bytes | V10 v1 call | V10 runtime call | Yes | Both reject 31 bytes | Covered |
| OTP key-version grammar | V11 v1 call | V11 runtime call | Yes | Both reject forbidden characters | Covered |
| Valid historical/duplicate aliases and alias-lock deduplication | V12 v1 prepared row | V12 runtime prepared row | Yes | Both accept and create exactly once | Covered |
| Grant unrevoked | E01 v1 revoked grant | E01 runtime revoked grant | Yes | v1 `23514`; v2 zero rows | Covered |
| Grant unconsumed | E02 v1 consumed grant | E02 runtime consumed grant | Yes | v1 `23514`; v2 zero rows | Covered |
| Grant retains at least two minutes | E03 v1 short grant | E03 runtime short grant | Yes | v1 `23514`; v2 zero rows | Covered |
| Pinned normalized email | E04 v1 mismatch | E04 runtime mismatch | Yes | v1 `23514`; v2 zero rows | Covered |
| Application-registration relationship eligibility | E05 v1 call after isolated registration mismatch | E05 runtime call after same mismatch | Yes; version/status/lifecycle and grants remain valid | v1 `23514`; v2 zero rows | Covered |
| Version-registration eligibility | E06 v1 unregistered-version call | E06 runtime unregistered-version call | Yes; application registration/status/lifecycle remain valid | v1 `23514`; v2 zero rows | Covered |
| Current installation generation | E07 v1 stale-generation call | E07 runtime stale-generation call | Yes, one savepoint state | v1 `23514`; v2 zero rows | Covered |
| Installation status eligibility | E08 v1 disabled-status call | E08 runtime disabled-status call | Yes; lifecycle remains `INSTALL`, and grants are proven live | v1 `23514`; v2 zero rows | Covered |
| Installation lifecycle eligibility | E09 v1 non-`INSTALL` call | E09 runtime non-`INSTALL` call | Yes; status remains `pending`, and grants are proven live | v1 `23514`; v2 zero rows | Covered |
| Exclusive 60-second request window | R01 v1 last/refused calls | R01 runtime last/refused calls | Yes | One row at last allowed; v1 `P0001`/v2 zero at first refused | Covered |
| Three requests per hour | R02 v1 last/refused calls | R02 runtime last/refused calls | Yes; alias history is on separate grants and request-grant prior count is zero | Third prepares; fourth refuses while recent/failure/grant predicates remain below threshold | Covered |
| Ten requests per 24 hours | R03 v1 last/refused calls | R03 runtime last/refused calls | Yes; 9/10 alias rows are distributed 3/3/3[/1] over separate grants | Tenth prepares; eleventh refuses while recent/hourly/failure/request-grant predicates remain below threshold | Covered |
| Three requests per grant | R04 v1 last/refused calls | R04 runtime last/refused calls | Yes | Third prepares; fourth refuses | Covered |
| Ten recent failures per hour | R05 v1 nine/ten calls | Existing runtime enrollment nine/ten calls | Yes, two historical challenges each | Nine prepares; ten refuses | Covered |
| Concurrent same-alias requests on distinct grants serialize | C01 independent v1 actors | C01 independent runtime actors | Yes | Advisory-lock blocker evidence; one row per pair, stale request rejected | Covered |
| Grant revocation wins request race | C02 v1 actors | C02 runtime actors | Yes | Blocker evidence; no challenge | Covered |
| Grant consumption wins request race | C03 v1 actors | C03 runtime actors | Yes | Blocker evidence; no challenge | Covered |
| Request wins grant-revocation race | C04 v1 actors | C04 runtime actors | Yes | Request commits first; both later superseded `grant_revoked` | Covered |
| Request wins grant-consumption race | C05 v1 actors | C05 runtime actors | Yes | Request commits first; both later superseded `grant_consumed` | Covered |
| Delivery/resend serialization | C06a/C06b owner delivery + v1 resend actors | C06a/C06b runtime delivery + runtime resend actors | Yes; real request-created pending rows | Blocker PIDs prove both winner orders; delivered rows may be superseded, and post-supersession delivery returns false without revival | Covered |
| Parent-first installation/grant lifecycle ordering and locked revalidation | C07 v1 lifecycle/request actors | C07 runtime lifecycle/request actors | Yes; separate eligible parents/grants | Requests block on parent owners; `FOR UPDATE NOWAIT` child probes succeed before release; lifecycle commit revokes grants and both stale requests create no row | Covered |
| PENDING_DELIVERY insertion, returned/stored timestamps, email, pseudonym | Existing matched long/short v1 cases | Existing matched long/short runtime cases | Yes | Stored/returned metadata and state predicates | Covered |
| Exact grant-bounded expiry | Existing long/short v1 cases | Existing long/short runtime cases | Yes | `least(created_at + 10 minutes, grant.expires_at)` in both branches | Covered |
| Enrollment resend, selection, scrub, and supersession | Committed v1 resend sequence | Committed runtime resend sequence | Yes | Prior eligible rows scrubbed/superseded; one new pending row each | Covered |

Frozen mechanics are traced separately and intentionally not compared as equal:

- D01: v2 accepts the trusted explicit UUID; v1 uses the table default.
- D02: v2 starts from the 32-byte grant token hash and relocks the resolved
  grant; v1 accepts the grant UUID.
- D03: expected nondisclosing negatives are v1 exceptions and v2 zero rows.

No additional delta or non-frozen behavior mismatch was found. Static UUID
validation and grant-token-digest validation remain executable v2-only proofs
because they exist solely as D01/D02 mechanics, not unchanged v1 inputs.

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Tighten the existing parser offset bound | ACCEPTED | Preserves calendar validation and matches PostgreSQL 17. |
| Freeze complete `pg_proc` identity in one pre-revoke guard | ACCEPTED | Any tamper aborts before privileges/functions change. |
| Exercise rate limits through C3b-3 wrappers | ACCEPTED | Proof source now traverses both runtime paths for the recent-failure nine/ten boundary in addition to the existing request-window and per-grant boundaries. |
| Use bounded concurrent actors with blocker evidence | ACCEPTED | C01-C07 use separate backends, transaction barriers, blocker PIDs, legal-state assertions, and a child-lock probe for parent-first ordering. |
| Insert delivered synthetic rows directly | REJECTED DURING ROUND 2 | Bypassed the real transition; corrected to use the delivery wrapper. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Change the merged contract or add a ninth helper | Not authorized or required. |
| Rely only on `new Date` | Accepts representations outside the PostgreSQL RPC contract. |
| Prove limits only through the C3b-1 helper | Does not prove C3b-3 zero-row translation. |
| Simulate concurrency sequentially | Does not prove lock serialization. |
| Revoke before validating rollback identity | Risks partial authority removal. |
| Use Supabase, Railway, or another external database | Explicitly prohibited. |

## Changed files

| File | Change | Runtime impact |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Runs C3b-3 after retained C3a/C3b-1 PostgreSQL 17 proofs. | Hosted test only. |
| `docs/agent-run-c3b3-settings-auth-orchestration-implementation.md` | Records implementation and both remediation rounds. | None. |
| `src/services/every8dSettingsAuthRepository.ts` | Narrow repository; round 2 caps numeric timestamp offsets at 15:59. | Rejects impossible successful RPC timestamps. |
| `src/services/every8dSettingsAuthService.ts` | Route-free orchestration. | Dormant while the existing feature flag is off. |
| `src/types/every8dSettingsAuthOrchestration.ts` | Closed repository/service types. | Compile-time only. |
| `supabase/migrations/202610140001_every8d_settings_auth_orchestration.sql` | Five wrappers and three cores with frozen pre/postflight. | Not externally applied. |
| `supabase/rollback/202610140001_every8d_settings_auth_orchestration.sql` | Complete pre-revoke identity guard and exact drop order. | Not externally applied. |
| `test/every8dSettingsAuthOrchestration.test.cjs` | Service and method-complete repository matrices. | Test only. |
| `test/postgres/every8dSettingsAuthOrchestration.sh` | Preflight, race, and rollback tamper harness. | Test only. |
| `test/postgres/every8dSettingsAuthOrchestration.sql` | ACL, parity, limit, mutation, expiry, and fixture proof. | Test only. |

## Architecture and database

The implementation adds a route-free orchestration layer over the existing
C3b-2 primitives and a dedicated repository with five named operations. It does
not add HTTP routes, cookies, CSRF handling, browser sessions, provider calls,
email delivery, durable outbox behavior, challenge consumption, grant
redemption, administrator creation, settings-session issuance, provider
credentials, SMS behavior, or LINE behavior.

The migration adds exactly eight `SECURITY DEFINER` functions with fixed
`search_path = pg_catalog, public`, all owned by the captured trusted common
owner:

- Runtime wrappers granted to `service_role`:
  - `runtime_request_every8d_settings_enrollment_challenge_v1`
  - `runtime_request_every8d_settings_login_challenge_v1`
  - `runtime_record_every8d_settings_challenge_delivery_v1`
  - `runtime_discover_every8d_settings_challenge_v1`
  - `runtime_verify_every8d_settings_challenge_v1`
- Owner-only cores:
  - `request_every8d_settings_enrollment_challenge_core_v2`
  - `request_every8d_settings_login_challenge_core_v2`
  - `verify_every8d_settings_challenge_core_v2`

The migration uses the frozen relation-lock order, performs fail-closed
relation/owner/role/function/exact-trigger/RLS/table-and-column-ACL/schema/target-name preflight, and
performs exact owner, security, search-path, inventory, and ACL postflight.
Only the five wrappers receive `service_role` EXECUTE. No core EXECUTE, direct
table grant, or new policy is added.

The transactional rollback validates inventory, ownership, argument and return
definitions, function-body identities, ACL state, and dependencies before any
runtime EXECUTE revoke. Only after every guard passes does it revoke the five
wrapper grants and drop the eight exact signatures in the frozen dependency-safe
order, without `CASCADE`, `DELETE`, or `TRUNCATE`.
C3a and C3b-1 objects and populated rows are preserved.

## Repository and service

The repository exposes only request enrollment, request login, record delivery,
discover, and verify operations. Successful payloads, including calendar-valid
timestamps, are validated strictly.
Failures are closed to `repository_unavailable` and
`repository_contract_violation`; raw Supabase/database errors, SQLSTATE,
messages, arguments, and payloads are discarded.

The service checks `EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED` before input
normalization, entropy, repository construction, or persistence. Requests use
`crypto.randomUUID()` and the existing C3b-2 capability, OTP, HMAC, email, and
pseudonym primitives. Request failures remain non-enumerating
`accepted + null`. Verification discovers protected metadata, selects only the
stored OTP key version, derives all historical aliases, and invokes verification
once. No key try-all or automatic repository retry exists.

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | PASS | Completed without errors after the F2 final correction. |
| Focused C3b-3 tests | PASS | 15/15 tests passed after the F2 final correction. |
| `npm test` | PASS | 696/696 tests passed after the F2 final correction. |
| `npm run build` | PASS | Completed after the F2 final correction. |
| `bash -n test/postgres/every8dSettingsAuthOrchestration.sh` | PASS | Git Bash syntax check passed. |
| `git diff --check` | PASS | No whitespace errors at the current remediation state. |
| Local PostgreSQL 17 executable proof | UNAVAILABLE | No safe disposable local server exists. |
| Hosted PostgreSQL 17 executable proof | PENDING_PR_CI | No push or hosted CI run is authorized. |

The PostgreSQL proof source covers migration preflight/refusal (including wrong
trigger timing/events/constraint identity and column ACL widening), exact
function metadata and ACLs, matched enrollment and login v1/v2 request parity,
exact long- and short-grant enrollment expiry, enrollment and login resend
semantics, and runtime-wrapper request/rate boundaries including recent failures,
request/delivery/discovery/verification behavior, UUID and capability
collisions, resend supersession, fifth-failure behavior, matched v1/v2
enrollment request/revocation/consumption concurrency, matched delivery/resend
winner-order concurrency, matched parent-first lifecycle/grant ordering and
locked revalidation, direct v2 verification concurrency,
request/discovery publication, stale discovery, grant revoke/consume,
administrator revocation, expiry scrub, lifecycle/generation races, populated
rollback, altered-body/result refusal, dependency refusal, and ownership
refusal. It is wired after the retained C3a/C3b-1 proofs in the existing
PostgreSQL 17 `postgres-concurrency` CI job; no earlier proof is removed or
bypassed. This proof source has only received local static/shell validation;
hosted execution is still pending.

## PostgreSQL availability and CI

A safe disposable local PostgreSQL 17 server was not available. Docker is
absent. PostgreSQL 17 client/server binaries are installed locally, but the
installation lacks the server catalog required by `initdb`, so no disposable
cluster could be initialized safely. No local PostgreSQL execution result is
claimed. The hosted PostgreSQL 17 CI proof remains pending until a later,
separately authorized push runs CI.

LOCAL POSTGRESQL 17 EXECUTABLE PROOF:
UNAVAILABLE

HOSTED POSTGRESQL 17 EXECUTABLE PROOF:
PENDING_PR_CI

## Safety and production status

- No production, Supabase production, Railway, or other external database was
  accessed.
- No migration was applied outside disposable test design.
- Railway was not changed.
- No HMAC or provider key was created.
- `EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED` remains false/absent; it was not
  enabled or changed.
- `GHL_SMS_PHASE_2F_ENABLED` was not changed and remains false.
- No email or SMS was sent.
- LINE code and behavior were not changed.
- No provider was activated and no credentials were added.
- C3c was not started.

## Budget and stop-rule status

- Active coding tasks: one C3b-3 remediation task
- Implementation correction loops used: more than the normal project limit
- Reviewer correction loops used: the normal reviewer-correction-loop limit had
  already been exceeded before the explicit exception below was authorized
- Repeated errors or failed approaches: one sandbox-only build permission error, resolved by the approved repository-local execution path; no repeated code failure
- Historical sequence: the loop-limit excess is retained as historical fact and
  is not erased or retroactively authorized

The project owner supplied this current, one-time explicit exception during the
final F1-F4 remediation; it did not exist during earlier correction cycles:

> C3b-3 implementation is authorized to exceed the normal reviewer-correction-loop
> limit solely to close the already-identified F1–F4 blockers from the final gate.
> This exception is limited to C3b-3 implementation, does not authorize scope
> expansion, and does not carry forward to C3c or any later phase.

This exception now authorizes only the final correction/review cycle needed to
close the already-identified F1-F4 blockers. It applies solely to the remainder
of C3b-3 implementation closure and does not rewrite the prior history.

## Unresolved decisions

None within C3b-3. Hosted PostgreSQL 17 execution remains pending until a later
authorized push/PR CI run. Accepted non-blocking maintainability tradeoffs are
duplicated login authorization SQL, raw `Buffer` digest branding, and duplicated
request plumbing. They do not add authority and are intentionally outside this
remediation. C3c remains unstarted.

## Recommended next action

Perform the final independent approval review, then run the pending hosted
PostgreSQL 17 proof only through a later authorized PR CI flow. Do not push,
open a PR, deploy, enable settings auth, create keys, or apply the migration
externally in this task.

## Hosted CI failure and focused fixture remediation (2026-10-19)

This section supersedes earlier PENDING_PR_CI and pre-PR next-action statements.
PR: #114 (https://github.com/hugolamcloser/win-crm.ai-lineconnect/pull/114).
Initial pushed/reviewed HEAD: 40da875bdddfc00bceedcd2bb7f8fdccdbf61a67.
Authoritative origin/main: 64d2418ab592e710d92eaa58ddd6b570f7473585.
The exact branch and local/remote HEAD were verified after fetching origin;
the worktree was clean before editing. The owner explicitly authorized this
focused hosted-proof remediation and one new local commit, without a push,
CI rerun, runtime authority change, merge, deployment, or external migration.

Initial hosted CI, run 39204772721, postgres job 117905112514:

- validate: SUCCESS.
- postgres-concurrency: FAILURE.
- Failed step: Prove EVERY8D settings auth orchestration, ACLs, and guarded rollback.
- First terminating error: EVERY8D settings challenge failure append is invalid.
- Exit code: 3.
- All earlier proof steps passed, including C3a and C3b-1.

The failure was discovered only by real hosted PostgreSQL 17 execution.
It was not a production/runtime deployment. Hosted job step results and the
narrowly filtered error/exit lines were independently inspected read-only.

### Independently confirmed root cause and append audit

The frozen C3b-1 protect_every8d_settings_auth_challenge_failure_v1 trigger
requires an existing LIVE, unexpired challenge, attempt_number=existing_count+1,
at most five attempts, failed_at>=delivery_succeeded_at, and failed_at<expires_at.
The fifth-failure trigger alone sets locked_at and scrubs the email; deferred
integrity requires sequential attempts, nondecreasing times, and the lock time
to equal the fifth failure. These functions and their protections are unchanged.

runtime_record_every8d_settings_challenge_delivery_v1 delegates to the frozen
C3b-1 delivery function, which persists clock_timestamp(), not created_at.
The 7b305000...8004 helper fixture instead used the older captured creation
baseline, placing failures five to six minutes before actual delivery. This
is a proof-fixture defect; no runtime defect was found in the failing path.

All four manual append sites in the C3b-3 SQL and the complete shell harness
were audited. The later 7b360000...0002 concurrency fixture also subtracted ten
seconds from the current clock after fresh delivery and a two-second sleep;
it could fail the same chronology predicate. Both used set-based inserts
whose attempt order should not be relied on. The runtime F3 and R05/F2 parity
fixtures already used bounded sequential loops and post-delivery wall time;
no pre-delivery defect was found there. They now share the same row-derived
fixture mechanism to make the chronology explicit at every C3b-3 append site.
The C3b-3 shell harness contains no manual failure appends.

The other manual appends in the retained C3b-1 SQL/shell were inspected:
its SQL intentionally rejects delivery-minus-one-second, then accepts exact
delivery time; its shell intentionally rejects malformed chronology within
an expected-failure transaction, and its concurrency setup records historical
delivery (created_at+10 seconds) before its four historical failures. These
are established proofs, not additional C3b-3 defects; they were not changed.

### Smallest safe correction and proof preservation

Only the C3b-3 SQL proof and this log changed. A pg_temp invoker helper reads
and locks the actual challenge row, asserts LIVE state and delivery before
expiry, and appends each next attempt in a separate loop statement, capped
at five. Each failed_at equals the actual persisted delivery_succeeded_at.
C3b-1 explicitly permits equality and nondecreasing timestamps; this avoids
inventing pre-delivery or future times that could interfere with later
verification races. Postconditions assert exact sequential attempts, valid
expiry chronology, and the database-owned fifth lock/email scrub.

The frozen helper baseline now explicitly checks nine failures as allowed,
then appends only the fifth attempt to the second challenge and checks ten
as refused at the same frozen rate baseline. Existing runtime login/enrollment
nine/ten assertions, F3 wrapper boundary, R05 enrollment v1/v2 F2 parity,
and fifth-failure concurrency proof remain intact. No trigger is bypassed,
disabled, or altered by the correction; no locked_at is forced.

### Local remediation validation

| Local gate | Result |
| --- | --- |
| npm run typecheck | PASS |
| node --test test/every8dSettingsAuthOrchestration.test.cjs | PASS, 15/15 |
| npm test | PASS, 696/696 |
| npm run build | PASS |
| git diff --check | PASS |
| bash -n test/postgres/every8dSettingsAuthOrchestration.sh | PASS |

All requested gates passed. Diff inspection then caught and corrected a
text-replacement error in the new helper's dollar-quote delimiters; the full
local gate set was repeated after that correction. A static delimiter/manual-
append audit also passed; it is not an executable PostgreSQL result.
Implementation correction loops used for this follow-up: one. No independent
reviewer correction loop or PostgreSQL retest was performed in this task.
The exact final delta is ready for the separately requested independent review.
Local PostgreSQL 17 executable proof remains UNAVAILABLE: the previously
inspected installation lacks the server catalog needed for a disposable
cluster. No PostgreSQL connection, external database, or production access
was attempted for this remediation. Static and Node checks do not establish
PostgreSQL migration/rollback/concurrency success.

HOSTED POSTGRESQL 17 EXECUTABLE PROOF:
FAILED_INITIAL_RUN / REMEDIATION_PENDING_RETEST

### Review, rollback, and safety

One focused new commit is authorized after the requested local gates pass.
Do not amend the pushed commit or push this follow-up before independent delta
review. No CI rerun is authorized in this task. Rollback consists only of
reverting these two test/documentation file changes; no runtime/schema/data
rollback is needed. The original hosted failure remains unresolved by
executable proof until a later separately authorized hosted retest.

No production DB access, external migration, Railway change, key creation,
settings-auth activation, feature-flag change, email/SMS, LINE change, C3c,
merge, deployment, branch deletion, or worktree deletion occurred.
