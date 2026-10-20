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

## Hosted grant-expiry correction (2026-10-20)

This section supersedes earlier hosted-proof and next-action status statements.
PR: #114 (https://github.com/hugolamcloser/win-crm.ai-lineconnect/pull/114).
Retest run: 39339894456; failed postgres-concurrency job: 118358549603.

- validate: SUCCESS.
- postgres-concurrency: FAILURE.
- Failed step: Prove EVERY8D settings auth orchestration, ACLs, and guarded rollback.
- Terminating C3b-3 error: EVERY8D operator enrollment grant expiry is invalid.
- Exit code: 3. Hosted failed-step metadata and the exact error/exit evidence
  were independently inspected read-only; no CI rerun occurred.

Before editing, fetch and local/remote PR checks confirmed clean worktree,
branch codex/c3b3-settings-auth-orchestration-implementation, pushed/local HEAD
5f0441f0d820ce84600810f0cbb9df954befb07e, two commits over authoritative base
64d2418ab592e710d92eaa58ddd6b570f7473585, and an OPEN, unmerged PR #114.
The failure was discovered by actual hosted PostgreSQL 17 execution, not by
any production access or deployment.

### New explicit owner authorization and exhaustion

The owner explicitly authorizes ONE additional C3b-3 hosted-CI correction cycle,
limited strictly to fixing the PostgreSQL proof-fixture grant-expiry failures
discovered in PR #114 retest. This authorization DOES NOT permit runtime
authority changes, production changes, migration authority changes, rollback
authority changes, deployment, merge, Railway changes, settings-auth activation,
key creation, GHL_SMS_PHASE_2F_ENABLED changes, email or SMS, LINE changes,
C3c work, or any later correction cycle.

This is a NEW authorization, not an extension of the old F1-F4 exception.
It is exhausted when this one grant-expiry correction cycle is completed;
no carry-forward authority is inferred. One new local commit is authorized
only after local checks; push, CI rerun, merge, and deployment are not authorized.
Independent delta review must precede any separately authorized push.

### Authoritative contract and confirmed fixture-only root cause

The unchanged C3a issue_every8d_settings_operator_enrollment_grant_v1 checks
finite input_expires_at and, after parent eligibility and tuple locking, captures
its OWN issued_at := clock_timestamp(). It requires issued_at<input_expires_at
and input_expires_at<=issued_at+interval '15 minutes'. The retained row check
also bounds expiry against created_at, which is the persisted issued_at.
The unchanged C3b-1/v2 enrollment request requires at least two minutes of
remaining grant lifetime and sets challenge expiry to the exact minimum of
created_at+10 minutes and the actual grant expiry.

Root cause: positive proof fixtures requested operator enrollment grants beyond
the authoritative 15-minute maximum. No runtime or contract defect was found;
no source, production migration, rollback, workflow, or shell file changed.

### Complete issuer audit and decision matrix

All 51 SQL issuer call sites were parsed with balanced arguments and inspected,
including loops and the variable expiry expression. The complete shell proof
has ZERO operator issuer calls. Loops expand these sites into 121 grant
issuances; seven invalid positive call sites generate eight invalid grants.
No deliberate invalid-ISSUER-expiry negative calls exist in these two files.
Tokens 2405/2406 intentionally issue valid one-minute grants, then expect
ENROLLMENT REQUEST rejection for less than two minutes remaining; they are
not invalid grant-issuance setup and remain unchanged.

Every row below is subject to the same authoritative requirement:
finite expiry and 0<expires_at-issued_at<=15 minutes. Lines refer to the
pre-correction SQL; no lines were added to or removed from that SQL file.

| SQL line | Fixture/case | Original expiry expression | Issuer classification | Why the value exists / preserved proof purpose | Minimum safe replacement |
| --- | --- | --- | --- | --- | --- |
| 343 | 'C3B3-ENROLL' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'orchestration proof' | Unchanged |
| 347 | 'C3B3-LOGIN' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'login identity proof' | Unchanged |
| 428 | 'C3B3-RATE-GRANT' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'grant rate boundary' | Unchanged |
| 508 | 'C3B3-RECENT-FAILURE-'\|\|token_n | pg_catalog.clock_timestamp()+interval '20 minutes' | INVALID positive | 'recent failure login boundary' | pg_catalog.clock_timestamp()+interval '14 minutes' |
| 518 | 'C3B3-RECENT-FAILURE-3003' | clock_timestamp()+interval '20 minutes' | INVALID positive | 'recent failure enrollment boundary' | clock_timestamp()+interval '14 minutes' |
| 524 | 'C3B3-RECENT-FAILURE-3004' | clock_timestamp()+interval '20 minutes' | INVALID positive | 'recent failure enrollment boundary' | clock_timestamp()+interval '14 minutes' |
| 664 | 'C3B3-WRAPPER-RATE-'\|\|i | pg_catalog.clock_timestamp()+interval '12 minutes' | VALID issuer input | 'wrapper rate identity' | Unchanged |
| 746 | 'C3B3-WRAPPER-GRANT-PASS' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'grant wrapper boundary' | Unchanged |
| 750 | 'C3B3-WRAPPER-GRANT-REFUSE' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'grant wrapper boundary' | Unchanged |
| 789 | 'C3B3-PARITY-V1' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'v1 parity identity' | Unchanged |
| 796 | 'C3B3-PARITY-V2' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'v2 parity identity' | Unchanged |
| 845 | 'C3B3-PARITY-ENROLL-LONG-V1' | :'parity_enroll_window_captured_at'::timestamptz+interval '20 minutes' | INVALID positive | 'enrollment parity' | clock_timestamp()+interval '14 minutes' |
| 850 | 'C3B3-PARITY-ENROLL-LONG-V2' | :'parity_enroll_window_captured_at'::timestamptz+interval '20 minutes' | INVALID positive | 'enrollment parity' | clock_timestamp()+interval '14 minutes' |
| 855 | 'C3B3-PARITY-ENROLL-SHORT-V1' | :'parity_enroll_window_captured_at'::timestamptz+interval '5 minutes' | VALID issuer input | 'enrollment parity' | Unchanged |
| 860 | 'C3B3-PARITY-ENROLL-SHORT-V2' | :'parity_enroll_window_captured_at'::timestamptz+interval '5 minutes' | VALID issuer input | 'enrollment parity' | Unchanged |
| 1101 | 'C3B3-PARITY-ALIAS-V1' | clock_timestamp()+interval '14 minutes' | VALID issuer input | 'alias parity' | Unchanged |
| 1105 | 'C3B3-PARITY-ALIAS-V2' | clock_timestamp()+interval '14 minutes' | VALID issuer input | 'alias parity' | Unchanged |
| 1133 | 'C3B3-PARITY-ELIGIBILITY-'\|\|token_n | expiry | VALID issuer input | 'eligibility parity' | Unchanged |
| 1328 | 'C3B3-PARITY-RATE-'\|\|token_n | pg_catalog.clock_timestamp()+interval '14 minutes' | VALID issuer input | 'matched enrollment rate parity' | Unchanged |
| 1340 | 'C3B3-PARITY-RATE-HISTORY-'\|\|token_n | pg_catalog.clock_timestamp()+interval '14 minutes' | VALID issuer input | 'isolated hourly parity history' | Unchanged |
| 1353 | 'C3B3-PARITY-RATE-HISTORY-'\|\|token_n | pg_catalog.clock_timestamp()+interval '14 minutes' | VALID issuer input | 'isolated daily parity history' | Unchanged |
| 1581 | 'C3B3-PARITY-FAILURE-2521' | clock_timestamp()+interval '14 minutes' | VALID issuer input | 'failure parity' | Unchanged |
| 1586 | 'C3B3-PARITY-FAILURE-2522' | clock_timestamp()+interval '14 minutes' | VALID issuer input | 'failure parity' | Unchanged |
| 1672 | 'C3B3-PARITY-ENROLL-RESEND-V1' | clock_timestamp()+interval '20 minutes' | INVALID positive | 'enrollment resend parity' | clock_timestamp()+interval '14 minutes' |
| 1676 | 'C3B3-PARITY-ENROLL-RESEND-V2' | clock_timestamp()+interval '20 minutes' | INVALID positive | 'enrollment resend parity' | clock_timestamp()+interval '14 minutes' |
| 1698 | 'C3B3-PARITY-RESEND-V1' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'resend parity' | Unchanged |
| 1705 | 'C3B3-PARITY-RESEND-V2' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'resend parity' | Unchanged |
| 1815 | 'C3B3-ORPHAN-EXPLICIT' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'orphan supersession' | Unchanged |
| 1852 | 'C3B3-DISCOVER-GRANT' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'discover mutate verify' | Unchanged |
| 1876 | 'C3B3-DISCOVER-ADMIN' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'discover mutate verify' | Unchanged |
| 1937 | 'C3B3-FIVE' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'failure ledger identity' | Unchanged |
| 1969 | 'C3B3-COLLISION' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'collision identity' | Unchanged |
| 2048 | 'C3B3-LIFECYCLE-ONLY' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'independent invalidation' | Unchanged |
| 2075 | 'C3B3-GENERATION-ONLY' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'independent invalidation' | Unchanged |
| 2105 | 'C3B3-EXPIRY-BEFORE' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'expiry boundary' | Unchanged |
| 2131 | 'C3B3-CONCURRENT-CORRECT' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'v2 concurrency proof' | Unchanged |
| 2138 | 'C3B3-CONCURRENT-FIFTH' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'v2 fifth failure proof' | Unchanged |
| 2145 | 'C3B3-ADMIN-RACE' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'v2 admin race proof' | Unchanged |
| 2152 | 'C3B3-LIFECYCLE-RACE' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'v2 lifecycle race proof' | Unchanged |
| 2159 | 'C3B3-GRANT-RACE' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'v2 grant race proof' | Unchanged |
| 2163 | 'C3B3-GRANT-CONSUME' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'v2 grant consume race' | Unchanged |
| 2167 | 'C3B3-REQUEST-DISCOVERY' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'request discovery race' | Unchanged |
| 2174 | 'C3B3-RESEND-RACE' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'resend serialization race' | Unchanged |
| 2181 | 'C3B3-EXPIRY-RACE' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'expiry scrub race' | Unchanged |
| 2188 | 'C3B3-CONCURRENT-WRONG' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'wrong/wrong race' | Unchanged |
| 2195 | 'C3B3-CONCURRENT-MIXED' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'correct/wrong race' | Unchanged |
| 2202 | 'C3B3-RESEND-VERIFY' | clock_timestamp()+interval '12 minutes' | VALID issuer input | 'resend/verify race' | Unchanged |
| 2292 | 'C3B3-PARITY-CONCURRENCY-'\|\|token_n | pg_catalog.clock_timestamp()+interval '14 minutes' | VALID issuer input | 'matched enrollment concurrency parity' | Unchanged |
| 2310 | 'C3B3-PARITY-DELIVERY-RESEND-'\|\|token_n | pg_catalog.clock_timestamp()+interval '14 minutes' | VALID issuer input | 'matched delivery resend concurrency parity' | Unchanged |
| 2385 | 'C3B3-PARENT-ORDER-V1' | clock_timestamp()+interval '14 minutes' | VALID issuer input | 'parent ordering parity' | Unchanged |
| 2390 | 'C3B3-PARENT-ORDER-V2' | clock_timestamp()+interval '14 minutes' | VALID issuer input | 'parent ordering parity' | Unchanged |

The affected groups and their preserved semantics are:

| Fixture | Original expiry | Why it exists | Minimum safe replacement | Proof semantic preserved |
| --- | --- | --- | --- | --- |
| 3001..3002 login identities | fresh clock+20m | Redeem administrator authority for failure-boundary identities | fresh clock+14m | Valid redemption; nine allowed / ten refused login wrapper requests |
| 3003..3004 enrollment | fresh clock+20m | Keep grant LIVE during historical challenge/failure setup and request boundary | fresh clock+14m | Two-minute usable grant minimum; F3 enrollment nine/ten boundary and F2/R05 parity |
| 2101/2102 long-grant pair | shared captured clock+20m | Ensure grant outlives challenge's ten-minute TTL | fresh clock+14m | Exact challenge expiry=created_at+10m AND least(created_at+10m,grant.expires_at) |
| 2201/2202 resend pair | fresh clock+20m | Authority for initial request and explicit resend after 60 seconds | fresh clock+14m | Resend supersession/scrub, new authoritative PENDING challenge, exact expiry formula |

### Captured timestamps, minimum lifetimes, and unchanged proof claims

Only the seven invalid issuer expiry arguments changed. The long-grant pair
now uses a fresh clock for each issuer call: the shared captured timestamp
is still the creation-window lower bound, but its age is no longer part of
the long-grant lifetime. Four minutes separate the intended fourteen-minute
grant from the ten-minute challenge TTL under normal bounded local setup.
The exact equality assertions at the long-grant and least(...) comparisons
are byte-for-byte unchanged; the proof still rejects a grant-bounded result
for the long pair.

The short pair 2103/2104 retains the common captured clock+5m intentionally:
matching grant-expiry instants are useful shared-window evidence. It is captured
immediately before four issuer calls and the four request calls, without a
sleep or concurrent lock holder in between. The five-minute window leaves
three minutes above the two-minute usable-request minimum under normal setup,
and stays below the ten-minute challenge TTL and fifteen-minute issuer maximum.
The exact grant-bound and least(...) assertions are unchanged.
The whole SQL proof runs through one psql_db invocation bounded by 60 seconds
(with a 55-second statement timeout). A successful proof invocation therefore
leaves the short pair more than four minutes after its fresh five-minute
capture, safely above the two-minute request minimum; the fourteen-minute
long pair retains more than thirteen minutes, above the ten-minute TTL.

All other positive sites use fresh +12m or +14m, or the per-iteration expiry
variable set immediately before each issuer call to +14m (or deliberately +1m
for the request-negative pair). The issuer captures its own later time, so
normal statement delay reduces these effective lifetimes rather than exceeding
the maximum; none uses an exact fifteen-minute upper boundary. Source review
establishes these intended margins, not an executable timing guarantee.

The repaired recent-failure grants leave fourteen minutes for immediate
redemption/setup, the at-least-two-minute enrollment minimum, and actual
persisted delivery/failure chronology. Their historical challenge expiries
continue to use least(created_at+10m,grant.expires_at); all ledger logic,
counts, and F3/F2 R05 assertions are unchanged.
The resend grants leave roughly thirteen minutes after the existing 61-second
shell wait, retaining margin above two minutes and above the challenge's TTL.
The shell's 60-second rule, bounded commands, resend requests, supersession
checks, and all concurrency fixtures are unchanged. No assertion or proof
claim was weakened; no old history interval of 20 minutes was replaced.
A reverse-replacement audit recovered the exact original SQL, confirming that
only these seven expiry arguments differ from the pushed version.

### Local validation and truthful executable-proof status

| Local gate | Result |
| --- | --- |
| npm run typecheck | PASS |
| node --test test/every8dSettingsAuthOrchestration.test.cjs | PASS, 15/15 |
| npm test | PASS, 696/696 |
| npm run build | PASS |
| git diff --check | PASS |
| bash -n test/postgres/every8dSettingsAuthOrchestration.sh | PASS |

All six local gates passed. Final source/argument audit passed for all 51 SQL
call sites, their loop bounds, and the zero shell calls. The eight issuer-loop
multiplicities are 2, 6, 18, 16, 4, 16, 12, and 4: together with the other
43 single calls, they account for 121 grant issuances.
No implementation correction loop or independent reviewer correction was
needed within this one authorized grant-expiry cycle.
No local or external PostgreSQL connection was attempted. Local executable
PostgreSQL 17 proof remains UNAVAILABLE for the previously recorded missing
server catalog/disposable-cluster limitation. Node tests, static source audit,
and Bash syntax do not establish PostgreSQL migration/rollback/concurrency
success. No hosted success is claimed after this local correction.

HOSTED POSTGRESQL 17 EXECUTABLE PROOF:
FAILED_RETEST / GRANT_EXPIRY_REMEDIATION_PENDING_RETEST

### Review, rollback, and safety

Only test/postgres/every8dSettingsAuthOrchestration.sql and this run log changed.
Rollback is a revert of this focused follow-up; no runtime, schema, rollback
authority, or data rollback is needed. This single grant-expiry cycle stops
for independent delta review with one unpushed new commit. At the completed local handoff, this ONE grant-expiry correction cycle's
write authority is exhausted. Any later correction requires NEW explicit owner
authorization; the old exception is not extended.
No production access, external migration, Railway change, key creation,
settings-auth activation, GHL_SMS_PHASE_2F_ENABLED change, email/SMS, LINE
change, C3c, merge, deployment, CI rerun, or push occurred in this cycle.

## Hosted alias-isolation correction (2026-10-20)

This section supersedes earlier hosted status and next-action statements.
PR: #114. Latest hosted run: 39359193572.
Pushed/local starting HEAD: 70887e9001d9710d1fd13c641f75a478cb7f3077.
Authoritative base: 64d2418ab592e710d92eaa58ddd6b570f7473585.
Read-only identity checks without fetch confirmed the exact worktree, branch,
clean worktree/index, matching remote HEAD, three pushed commits, ten changed
PR files, and an OPEN, unmerged PR before editing.

### Latest hosted evidence and diagnosis

- validate: SUCCESS (job 118421080832).
- postgres-concurrency: FAILURE (job 118421081414).
- All PostgreSQL proof stages before the final C3b-3 proof: SUCCESS.
- Failed step: Prove EVERY8D settings auth orchestration, ACLs, and guarded rollback.
- Actual terminating error: no rows returned for \gset.
- psql exit code: 3.
- Hosted step results and narrowly filtered error/exit lines were independently
  inspected read-only; no workflow was rerun.

The previous grant-expiry remediation was effective: execution passed those
issuer setups and reached the later main enrollment request. The remaining
failure is proof fixture alias contamination; runtime/security authority is
not implicated. The frozen rate helper rejects ANY challenge with a matching
input alias in the preceding 60 seconds, without email, grant, purpose, or
terminal-state scoping. The runtime core correctly catches the rate rejection
and returns zero rows, which cannot populate the positive enrollment gset.
No hosted PostgreSQL PASS exists yet.

### Narrow new owner authorization

Exactly ONE additional C3b-3 hosted-CI correction cycle is authorized ONLY for:
(1) V12/main-enrollment alias isolation and (2) short-enrollment-parity/orphan-
login alias isolation, including directly necessary synchronized fixture
references/assertions, a shell value only if synchronization requires it,
and this run-log update. Isolating either side of each collision is expressly
allowed. Any NEW blocker outside these two confirmed collisions requires STOP
FOR REVIEW without a fix.

This does NOT authorize runtime authority, migration, rollback, contract,
ACL/security, CI workflow, package/runtime configuration, unrelated cleanup,
production, Railway, merge, deployment, settings-auth activation, HMAC key
creation, GHL_SMS_PHASE_2F_ENABLED changes, email/SMS, LINE, C3c, or any later
correction cycle. No production/merge/deployment authority is implied.
This is not an extension of any prior exception. This new write authorization
is exhausted once the one correction commit is created. No push or CI rerun
is authorized; independent delta review must precede any separate push grant.

### Confirmed collisions and smallest fixture-only changes

| Collision | Earlier fixture alias before correction | Later positive fixture | Scoped correction |
| --- | --- | --- | --- |
| 1 | V12 v1 canonical k1: + repeat('1',64), duplicated in its alias array | Main enrollment uses the same canonical alias and expects one row via gset enrollment_ | Change ONLY the earlier V12 v1 canonical value and both duplicate array entries to k1: + repeat('c3b3e001',8) |
| 2 | Short-enrollment v1 canonical k1: + repeat('a',63) + '1' | Orphan administrator and shell login request reuse that alias inside the 60-second window | Change ONLY the earlier short v1 request's canonical/array values and expected metadata to k1: + repeat('c3b3a001',8) |

Each replacement digest is exactly 64 lowercase hexadecimal characters. The
new aliases were absent from both proof sources before editing, including
comparison with the existing repeated-hex literal values. After editing,
each new expression appears exactly three times in its own earlier fixture
reference set; neither appears in the shell or later main/orphan sequences.
Dynamic numeric lpad/to_hex fixture values retain their separate zero-padded
forms. This is a scoped namespace/reference audit, not a broad unrelated
collision-cleanup exercise. No third independent blocker was discovered in
this scoped audit.

V12 retains its unchanged k0 historical alias, both identical k1 duplicate
entries, valid normalization grammar, grant/token/OTP inputs, and matched
acceptance assertion. The short-grant parity fixture retains its exact grant,
challenge inputs, expected metadata structure, exact ten-minute/least(...)
formula tests and exact grant-bounded expiry assertion.

The later main enrollment request and every dependent delivery/discovery/
verification/replay reference remain byte-for-byte unchanged, including its
fixed UUID, one-row success/gset expectation, capability/OTP inputs and grant
authority. The orphan SQL administrator redemption, shell initial login,
pending-delivery verification, explicit resend and supersession assertions
also remain byte-for-byte unchanged and synchronized with each other. The
existing sleep 30 plus sleep 31 (61 seconds) and frozen 60-second resend rule
are unchanged. No shell edit is necessary because the earlier colliding
short-enrollment alias was isolated instead.

A reverse-replacement audit recovers the exact original SQL by restoring just
the six changed alias expressions. This proves no other SQL expression,
assertion, gset, UUID, token/OTP value, grant authority, or behavior was edited.
No runtime, rate-limit, migration, rollback, ACL/security, contract, or CI
workflow changed. No assertion was weakened, no positive path was converted
to a negative path, no gset was removed, and no collision-wait sleep was added.

### Local validation and executable-proof status

| Local gate | Actual result |
| --- | --- |
| node --test test/every8dSettingsAuthOrchestration.test.cjs | PASS, 15/15 |
| npm test | PASS, 696/696 |
| npm run typecheck | PASS |
| npm run build | PASS |
| git diff --check | PASS |
| bash -n test/postgres/every8dSettingsAuthOrchestration.sh | PASS |
| Scoped alias/reference and reverse-replacement audit | PASS |

All requested local gates passed. The static audit found exactly three new
references per corrected fixture, no stale alias in either corrected reference
set, no new alias outside those sets, and byte-for-byte preservation of every
other SQL expression and the entire synchronized shell harness. The whole
correction cycle used no additional implementation or reviewer correction
loop. This one write authorization is exhausted at creation of the correction
commit; no later correction authority carries forward. The local handoff stops
for independent delta review and a separately authorized hosted retest.
Local PostgreSQL executable proof remains UNAVAILABLE for the previously
recorded missing server-catalog/disposable-cluster limitation. No local or
external PostgreSQL connection was attempted. Node tests, source checks and
shell syntax do not establish PostgreSQL migration/rollback/concurrency PASS.

HOSTED POSTGRESQL 17 EXECUTABLE PROOF:
FAILED_RETEST / ALIAS_ISOLATION_REMEDIATION_PENDING_RETEST

HOSTED_POSTGRESQL_PROOF:
RETEST_REQUIRED

### Review, rollback, and safety

Only test/postgres/every8dSettingsAuthOrchestration.sql and this run log changed.
Rollback is a revert of these scoped fixture/documentation changes; no schema,
runtime, rollback authority or external data action is needed. One focused
local commit follows passing validation, then STOP for independent delta review.
Remote PR HEAD must remain 70887e9001d9710d1fd13c641f75a478cb7f3077.
No push, CI rerun, amend, force push, merge, deployment, production access,
external migration, Railway change, settings activation, key creation, feature-
flag change, email/SMS, LINE change, or C3c occurred in this correction cycle.

## Hosted grant-token namespace correction (2026-10-20)

This section supersedes earlier hosted-proof status and next-action statements.
Latest hosted run: 39363082107. PR #114 pushed HEAD:
f26caa051fe0d7e2463a4b78e524741cb9358bd4.
Authoritative base: 64d2418ab592e710d92eaa58ddd6b570f7473585.
Before editing, read-only checks without fetch confirmed the exact worktree,
branch, matching local/remote/PR HEAD, clean worktree/index, four pushed commits,
and an OPEN, unmerged PR. No subsequent local commit existed.

### Hosted evidence and confirmed same-class root cause

- validate: SUCCESS (job 118433526443).
- postgres-concurrency: FAILURE (job 118433526189).
- Failed step: Prove EVERY8D settings auth orchestration, ACLs, and guarded rollback.
- First terminating error: duplicate key value violates unique constraint
  every8d_settings_enrollment_grants_token_hash_key.
- Observed duplicate: decode(repeat('d2',32),'hex'), C3B3-ADMIN-RACE.
- Confirmed latent collisions: d3/C3B3-LIFECYCLE-RACE and d4/C3B3-GRANT-RACE.
- psql exit code: 3. All preceding PostgreSQL proof stages succeeded.

Hosted step outcomes and narrowly filtered error/exit evidence were independently
inspected read-only. The previous alias-isolation correction was effective: the proof
progressed beyond the prior main enrollment gset failure to this later issuance.
No hosted PostgreSQL PASS exists yet.

The shared hosted database retains intentionally committed C3a concurrency
consumed/revoked grant history. Global uniqueness on
public.every8d_settings_enrollment_grants.token_hash correctly includes those
historical rows. The later C3b-3 fixtures incorrectly reused three grant tokens.
This is a C3b-3 proof namespace defect; no runtime/database-authority defect
was found. Earlier rows, global uniqueness, and all frozen authority remain
untouched. No history deletion, cleanup, or truncation was added.

### Exact one-cycle owner authorization

Exactly ONE additional correction cycle is authorized only for the d2, d3,
and d4 C3b-3 enrollment-grant token collisions: ADMIN-RACE issuance/redemption,
LIFECYCLE-RACE issuance/redemption, and GRANT-RACE issuance/runtime request/
shell revocation selector. Table-specific collision verification and this run
log are also authorized. Only those seven token references may change.

No runtime authority, unique constraint, migration, rollback, C3a/C3b-1,
contract, ACL/security/definer, CI workflow, unrelated fixture, production,
Railway, merge state, deployment, C3c, settings activation, key creation,
GHL_SMS_PHASE_2F_ENABLED, email/SMS, LINE, or later correction cycle is
authorized. A new blocker requiring any other change means STOP FOR REVIEW.
This is a new narrow authorization, not a carry-forward exception. It is
exhausted once the single correction commit is created. No push or CI rerun
is authorized, and no merge/deployment/production authority is implied.

### Dedicated deterministic grant-token namespace and exact synchronization

| Fixture | Old grant hash | New synthetic 32-byte grant hash | Authorized references |
| --- | --- | --- | --- |
| C3B3-ADMIN-RACE | decode(repeat('d2',32),'hex') | decode(repeat('c3b300d2',8),'hex') | SQL issuer + SQL redemption (2) |
| C3B3-LIFECYCLE-RACE | decode(repeat('d3',32),'hex') | decode(repeat('c3b300d3',8),'hex') | SQL issuer + SQL redemption (2) |
| C3B3-GRANT-RACE | decode(repeat('d4',32),'hex') | decode(repeat('c3b300d4',8),'hex') | SQL issuer + SQL runtime request + shell grant-revocation selector (3) |

Each seed is eight hex digits repeated eight times: 64 hex characters, exactly
32 bytes. All three are distinct and absent from both pre-correction grant
sets. Replacement is anchored to the exact grant-authority contexts rather
than a global d2/d3/d4 replacement. The new expressions occur only at the
2+2+3 authorized references. Restoring just those expressions recovers the
exact original SQL and shell bytes, proving all unrelated byte-pattern uses
are unchanged, including the shell rollback challenge's d2 OTP HMAC.
All emails, UUIDs, administrator aliases, request-token hashes, OTP/session
values, ordering, transaction boundaries, advisory locks, waits, lifecycle
behavior, and assertions remain identical.

### Complete table-specific token audit

Only public.every8d_settings_enrollment_grants.token_hash is compared. Matching
values in request-token, OTP, session, or other namespaces are not collisions.
All 51 C3b-3 operator issuer sites are parsed for their token argument and the
eight numeric loops expanded, including local token_hash assignments. This
produces 121 planned grant hashes, all distinct. There are no other C3b-3
direct grant inserts or shell issuer calls.

Earlier retained set: 26 distinct grant hashes, reconstructed from the earlier
proof sources and their committed successful shell paths:

- C3a repeated-byte grant values (13): a1, b1, c9, ca, cb, d2, d3, d4, cd,
  cf, da, db, f8. The d2/d3/d4 operation-first races commit consumed history;
  lifecycle-first e5/e6/e7 calls fail, and the delayed cc issuance fails.
- C3b-1 repeated-byte grant values (7): 71 through 77.
- C3b-1 zero-padded numeric grant values (6): to_hex(101) through to_hex(106),
  each left-padded to 64 hex digits.
- Both earlier standalone SQL proofs end in rollback, so their transactional
  rows are not incorrectly added to the retained set. Other byte values in
  earlier sessions/OTPs/challenges are excluded by table identity.

The pre-correction intersection is EXACTLY d2, d3, d4, matching the authorized
scope; no fourth collision or intra-C3b-3 duplicate was found. The selected
namespaced replacements are absent from all 121 planned and 26 retained
pre-correction hashes. Final reconstruction after the seven changes confirms:
121 planned hashes, 121 distinct; 26 retained earlier hashes; cross-stage
intersection ZERO; intra-C3b-3 duplicates ZERO. Each replacement is issued
exactly once and used only at its authorized synchronized references. The
complete table-specific collision audit passed; no new blocker was found.

### Local validation and truthful executable status

| Local gate | Actual result |
| --- | --- |
| node --test test/every8dSettingsAuthOrchestration.test.cjs | PASS, 15/15 |
| npm test | PASS, 696/696 |
| npm run typecheck | PASS |
| npm run build | PASS |
| git diff --check | PASS |
| bash -n test/postgres/every8dSettingsAuthOrchestration.sh | PASS |
| Exact seven-reference synchronization audit | PASS, 2+2+3 references |
| Complete grant-table intersection audit | PASS, 121 vs 26, intersection 0 |
| Unrelated d2/d3/d4 uses / reverse-source audit | PASS, all other source bytes unchanged |

All requested local gates passed. No implementation correction loop or
independent reviewer correction was needed within this one authorized cycle.
Creation of the one local correction commit exhausts this write authorization;
no later correction authority carries forward. Stop for independent delta
review and a separately authorized push/retest.
Local PostgreSQL executable proof remains UNAVAILABLE for the previously
recorded missing server-catalog/disposable-cluster limitation. No local or
external PostgreSQL connection was attempted. Local Node/static/shell checks
do not establish executable PostgreSQL migration/rollback/concurrency success.

HOSTED POSTGRESQL 17 EXECUTABLE PROOF:
FAILED_RETEST / GRANT_TOKEN_NAMESPACE_REMEDIATION_PENDING_RETEST

HOSTED_POSTGRESQL_PROOF:
RETEST_REQUIRED

### Review, rollback, and safety

Only the C3b-3 SQL proof, its synchronized shell selector, and this run log
changed. Rollback is a revert of these three scoped files, not a database,
runtime, migration-authority, or rollback-authority change. One local commit
follows passing checks and zero intersection, then STOP for independent delta
review. Remote PR HEAD must remain f26caa051fe0d7e2463a4b78e524741cb9358bd4;
no new hosted CI run is triggered because this correction is not pushed.
No production access, external migration, Railway change, HMAC key creation,
settings activation, feature-flag change, email/SMS, LINE, C3c, merge,
deployment, force push, amend, CI rerun, or push occurred in this cycle.

## Hosted ambiguous-column correction (2026-10-20)

This section supersedes earlier hosted-proof and next-action status statements.
PR #114 pushed/local starting HEAD: be01423d30e3d0d00c793bcdc9ea498cdddedcda.
Authoritative base: 64d2418ab592e710d92eaa58ddd6b570f7473585.
Before editing, read-only checks without fetch verified the exact worktree,
branch, matching local/remote/PR HEAD, clean worktree/index, no later local
commit, and an OPEN, unmerged PR containing five pushed commits.

### Latest hosted failure and confirmed diagnosis

- Latest hosted run: 39366597465.
- validate: SUCCESS (job 118444752531).
- postgres-concurrency: FAILURE (job 118444752704).
- Failed step: Prove EVERY8D settings auth orchestration, ACLs, and guarded rollback.
- Terminating error: column reference "expires_at" is ambiguous at character 612.
- Failing assertion: v1/v2 enrollment resends preserve supersession, scrub,
  insertion, and expiry semantics.
- Process exit code: 1.

The exact error, assertion label and exit evidence were independently inspected
from narrowly filtered hosted logs, read-only. Diagnosis: one proof assertion
qualification defect. The joined challenge c and enrollment grant g relations
both expose created_at and expires_at; the unqualified expression cannot bind
them uniquely. Both intended challenge-column references require c qualification.
Runtime authority and migration/rollback authority are not implicated. The
previous alias-isolation and d2/d3/d4 grant-token corrections were effective:
the proof progressed to this later shell resend assertion. No hosted PASS is
claimed; actual PostgreSQL execution remains RETEST_REQUIRED after correction.

### Exact one-cycle authorization and source delta

The owner authorizes exactly ONE additional correction cycle only for this
single joined assertion in test/postgres/every8dSettingsAuthOrchestration.sh,
plus this truthful run log and necessary local validation. Exactly two source
qualifications are allowed: expires_at -> c.expires_at and created_at ->
c.created_at in that expression only.

Old expression:
expires_at=least(created_at+interval '10 minutes',g.expires_at)

New expression:
c.expires_at=least(c.created_at+interval '10 minutes',g.expires_at)

No other shell proof, SQL proof, runtime/source service, migration, rollback,
contract, ACL, CI workflow, production, merge, deployment, Railway, C3c,
settings activation, HMAC key, Phase2F, email/SMS, LINE, or later correction
cycle is authorized. A new blocker requiring any other change means STOP
FOR REVIEW. No push or CI rerun is authorized. This narrow write authorization
is exhausted once the single correction commit is created; no carry-forward
exception or merge/deployment/production authority is implied.

### Exact-delta, semantics, and same-class recheck

The shell source edit changes ONE line by adding exactly two c. prefixes
(four characters). Reversing that single expression replacement reproduces
the original shell byte-for-byte. All query structure, joins, filters,
bool_and/count assertions, request/grant fixture values, shell helpers,
transaction/concurrency ordering, advisory locks and waits remain unchanged.

The assertion still requires count(*)=2 for the v1/v2 replacement enrollment
challenges, purpose enrollment, no supersession, no delivery outcome, and
exact challenge expiry equal to least(challenge creation+10m,grant expiry).
The preceding supersession/scrub assertion also remains unchanged. No success
became optional and no assertion was weakened.

The independent same-class audit found zero additional defective SQL statements
and precisely two ambiguous references in this one shell expression, with no
latent same-class failures. The local recheck confirms zero unqualified
created_at/expires_at identifiers remain in this joined subquery. Existing
matching SQL parity formulas already qualify the challenge columns. SQL proof
is unchanged; every other shell byte is unchanged, so this correction introduces
no additional ambiguity. No unrelated qualification cleanup was performed.

### Local validation and truthful executable-proof status

| Local gate | Actual result |
| --- | --- |
| node --test test/every8dSettingsAuthOrchestration.test.cjs | PASS, 15/15 |
| npm test | PASS, 696/696 |
| npm run typecheck | PASS |
| npm run build | PASS |
| git diff --check | PASS |
| bash -n test/postgres/every8dSettingsAuthOrchestration.sh | PASS |
| Exact two-qualification source audit | PASS, one line, two c. prefixes |
| SQL proof unchanged | PASS, byte-for-byte |
| No unrelated shell change / joined ambiguity recheck | PASS, zero other byte changes; zero remaining unqualified shared timestamps |

All requested local checks passed. No additional implementation or reviewer
correction loop was needed. Creation of this one correction commit exhausts
the narrow write authorization. Stop for independent delta review and a
separately authorized push/retest; no later correction authority carries forward.
Local PostgreSQL executable proof remains UNAVAILABLE for the previously
recorded missing server-catalog/disposable-cluster limitation. No local or
external PostgreSQL connection was attempted. Node tests, static source audit,
and Bash syntax are not executable PostgreSQL migration/rollback/concurrency
proof and do not establish hosted success.

HOSTED POSTGRESQL 17 EXECUTABLE PROOF:
FAILED_RETEST / AMBIGUOUS_COLUMN_REMEDIATION_PENDING_RETEST

HOSTED_POSTGRESQL_PROOF:
RETEST_REQUIRED

### Review, rollback, and safety

Only the C3b-3 shell proof's one expression and this run log changed. Rollback
is a revert of these two files; no runtime/schema/data or authority rollback
is needed. One focused unpushed local commit follows exact-scope validation,
then STOP for independent delta review. Remote PR HEAD must remain
be01423d30e3d0d00c793bcdc9ea498cdddedcda; no automatic CI run is triggered
for the new local commit. No production/Railway access, external migration,
key creation, settings activation, Phase2F change, email/SMS, LINE, C3c,
merge, deployment, amend, force push, manual CI rerun, or push occurred.
