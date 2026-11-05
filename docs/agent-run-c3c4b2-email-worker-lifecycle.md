# C3c-4b-2 dedicated email worker lifecycle

## Task identification and objective

- Task: explicit user authorization for C3c-4b-2 only; draft PR for independent implementation review.
- Exact required base/main: `b36f0f9fb0fb24b03c3dad5b940145f6cadcb717`.
- Baseline CI: [CI #136](https://github.com/hugolamcloser/win-crm.ai-lineconnect/actions/runs/41963616791), exact SHA, PASS for `validate`, `postgres-concurrency`, `postgres-email-outbox`.
- New branch: `codex/c3c4b2-worker-lifecycle`.
- New managed worktree: `C:/Users/User/.codex/worktrees/c3c4b2-worker-lifecycle/win-crm.ai-lineconnect-pilot00`.
- Authority: Level 3, one task; no merge, deployment, production access, production configuration, credentials or live delivery.
- Date: 2026-11-05, Asia/Kuala_Lumpur.

## Plan explained before implementation

Goal: operational coordination around the unchanged C3c-4a one-shot engine and C3c-4b-1 parser/registry. Assumptions: only an explicitly injected network-free test registry can admit operational startup; the production registry is empty. Affected files: new lifecycle/process/entrypoint/telemetry modules, focused unit and disposable PG17 proofs, one package command, one CI proof step, this log. Existing channel behavior, engine, crypto, renderer, provider/result types, parser, registry and repository authority remain frozen.

Risks: ambiguous late database acknowledgements, overlapping batches/maintenance, admission after stopping, provider deadlines during drain, sensitive diagnostic output. Smallest implementation: one serial loop, application-only admission refusal, observing repository watchdogs, original provider deadlines, bounded shutdown and fresh allowlisted events. Testing: deterministic clocks/barriers and real subprocesses, real PG17 repository with test-only adapters, unchanged engine and complete 107-obligation/prerequisite proofs, mandatory npm checks and protected-file equality. Rollback: revert this focused change; no database or production rollback.

## Files inspected and evidence

| Authority | Finding |
| --- | --- |
| AGENTS.md, pilot plan, run-log template | Focused phase; mandatory validation; no production, merge or deployment authority. |
| C3c/C3c-3 contracts and C3c-4a/4b-1 run logs | Database owns durable state, retries and recovery; parser and static registry remain unchanged. |
| Existing worker and provider contract | Engine already checks cancellation after claim and confirmed begin, invokes once and finalizes once. Aborting an already-started invocation selects a conservative unknown result. |
| Existing repository and its validators | Receipts remain repository-origin objects. Return each exact promise result unchanged; application stopping must never invent a repository result. |
| Startup import graph | Worker imports the repository, which imports shared environment/Supabase modules. Runtime/repository imports therefore stay behind admission. Disabled executable proves those modules are never imported. |
| CI and PG17 harnesses | Existing jobs already cover all 107 obligations and 11 pinned prerequisite regressions. Add only the dedicated lifecycle PG17 step. |

## Implementation and changed files

| File | Change |
| --- | --- |
| `src/workers/every8dSettingsEmailWorkerRuntime.ts` | Coordinator, lifecycle facade, serialized maintenance/batches, jitter/backoff, observing watchdog, provider deadline isolation, bounded drain. |
| `src/workers/every8dSettingsEmailWorkerProcess.ts` | Signal/error handlers before environment loading; existing parser gate, readiness, lazy provider/repository/runtime construction; safe exits. |
| `src/workers/every8dSettingsEmailWorkerMain.ts` | Dedicated executable; default EMPTY production registry; lazy existing repository import; process exit only on total drain expiry. |
| `src/workers/every8dSettingsEmailWorkerTelemetry.ts` | Closed event/reason vocabulary; fresh frozen objects containing only component/event and validated delay/reason. |
| `package.json` | Add `worker:settings-email`; existing `start` and server startup unchanged; no dependencies. |
| `.github/workflows/ci.yml` | Add lifecycle PG17 proof inside existing outbox job. |
| `test/every8dSettingsEmailWorkerLifecycle.test.cjs` | Deterministic timing, startup, admission, shutdown/stall races, signal repetition, deadlines and canaries; isolated executable checks. |
| `test/helpers/every8dSettingsEmailLifecycleFixtures.cjs` | Synthetic encrypted payloads, existing repository validator, controllable barriers and network-free adapter. |
| `test/postgres/every8dSettingsEmailWorkerLifecycle.cjs` | Real RPC proofs: orderly delivery, lost begin/finalize acknowledgements, abandoned lease, killed worker/restart, two competing worker processes. |
| `test/postgres/every8dSettingsEmailWorkerLifecycle.sh` | Dedicated disposable PG17 setup/cleanup using unchanged migration/fixture chain. |
| This log | Scope, decisions, validation method and rollback. |

## Lifecycle decisions

Startup installs process handlers, loads dotenv, calls the unchanged parser (auth validation, full gate, required encryption/provider/sender, exact registry entry), then calls the readiness parser and lazy factory. Only then does it construct the repository/lifecycle facade and unchanged engine. Disabled returns a safe event with no operational imports, timers, factory or repository. The real empty registry fails operational admission before readiness or provider construction.

Startup maintenance performs at most one recovery call with batch 100 per pass, followed by one purge call with batch 100 only after recovery success. Failed maintenance backs off without polling; startup readiness requires both successes. Later recovery is due five seconds after completion, purge sixty seconds after completion. R2 requires a successful recovery in every due-purge pass, even when the ordinary recovery timer is still in the future; failure retains the pending purge obligation and backs off. Missed intervals coalesce through due times; one pass never drains to empty. No maintenance overlaps a batch or another maintenance call. Maintenance may wake the loop before a poll deadline but cannot shorten its selected 1000–1200ms delay. Repository failures apply integer jitter over inclusive 90–100% of 1000/2000/4000/8000/10000ms tiers; successful work resets the failure tier. Contract violations initiate bounded stopping.

`EmailWorkerStopping` is a distinct application exception without an outcome/receipt. Claim, begin, recovery and purge reject local admission while stopping. Valid engine finalization is allowed during drain once per engine job, never retried or replayed. The facade preserves the exact repository result, including late acknowledgements. Each repository watchdog observes the original promise, initiates stopping after 15 seconds, and does nothing else: no Promise.race, synthetic result, slot release or second attempt. The serial flow remains active until its repository promises settle, even after the application drain has expired.

The first signal closes admission, cancels the single future wait and aborts the worker cancellation signal. Repeated signals reuse the same shutdown. Late claims/begins cannot invoke a provider. The unchanged engine may finalize an already-submitted cancelled attempt as outcome_unknown once; no positive non-acceptance is inferred. The R2 lifecycle facade forwards the existing engine input signal into the signal supplied to the submitted provider, immediately requesting abort on cancellation. Its one-shot settlement selects outcome_unknown, detaches the input listener and ignores late completion. The original monotonic deadline is unchanged; shutdown supplies no fresh deadline or positive non-acceptance proof. Application drain remains bounded to 20 seconds, with outstanding repository slots held until actual settlement or process exit. Only total drain expiry permits process exit with unresolved state left to database recovery.

## Validation and commands

All commands operate in the new worktree. Dependencies use the existing lockfile with `npm ci --ignore-scripts --no-audit --no-fund`. No production dependency was added. Run `npm run typecheck`, `npm test`, `npm run build`; focused lifecycle proof uses `node --test test/every8dSettingsEmailWorkerLifecycle.test.cjs`. Existing C3c-4a tests and worker PG17 proof are unchanged. Disposable PG17 containers use `--network none`, no published ports and synthetic fixtures only. The full unchanged C3c-3 harness runs all 107 obligations, 213 scenarios, 47 races and all 11 pinned prerequisite DB regressions; final results and CI run are recorded in the draft PR and delivery report.

Local evidence at implementation commit:

| Check | Result |
| --- | --- |
| Typecheck / build | PASS / PASS |
| Full npm test | PASS: 1,741/1,741; zero failed, skipped or cancelled |
| New lifecycle unit proof | PASS: 51/51 |
| Unchanged C3c-4a engine tests | PASS: 68/68 |
| Unchanged worker PG17 proof | PASS: 8/8 scenarios |
| New lifecycle PG17 proof | PASS: 6/6 scenarios, including restart and competing processes |
| Existing protected files | 277 unchanged against exact base (only package/CI wiring excluded) |
| Protected SQL byte equality | 44/44, including all 30 migration/rollback files |
| Complete 107-obligation PG17 proof / prerequisite regressions | Running at implementation commit; final result required in draft PR and delivery report |

The new lifecycle PG17 bridge wraps SQL function output in a record subquery, including single-column purge output, matching the existing repository RPC contract. An initial test-only aggregate returned scalar purge rows and correctly triggered contract shutdown; this was corrected in the bridge without touching SQL or repository authority. CI #137 then exposed a separate proof assumption: stopping each competing worker after one batch expected 12 sends, but safe instrumentation reproduced 10 ACCEPTED and two untouched PENDING jobs with worker counts 10 and zero. Bounded SKIP LOCKED intentionally performs no refill; the proof now lets both processes continue through normal poll delays until the shared work is complete, then checks exactly 12 sends and one durable attempt per job. This corrects the test orchestration, not the unchanged worker/repository/SQL. A deterministic empty-claim/later-work regression also proves that ordinary polling continues. Stage output never includes SQL, requests, identifiers or raw exceptions.

Detailed local logs, execution/coverage certificates and protected-file inventory are under ignored `.temp`. The unchanged coverage harness can regenerate a tracked certificate; retain the newly generated evidence under `.temp` and restore its baseline tracked bytes before committing. Verify every pre-existing protected source/test/SQL file equals the exact base; only package and CI wiring are intentionally modified. No production provider readiness/network smoke test is applicable because there is no approved provider.

## Budget, exclusions and rollback

- Active tasks: one; no delegated implementation or independent review is claimed.
- Implementation correction: one bounded application correction for lazy imports and poll scheduling. Proof-only corrections: record-shaped purge bridge and the CI-exposed one-pass competing-worker assumption. No independent reviewer correction loop; independent implementation review remains outstanding.
- Excluded: real provider, provider credentials, database/migrations/RPC changes, server startup, LINE/SMS/OAuth/Phase2F, Railway, C3c enablement and live delivery.
- Rollback: revert this focused slice. No schema, credential, environment or production rollback is needed.
- Next gate: `INDEPENDENT_C3C_4B_2_IMPLEMENTATION_REVIEW`. Draft PR only; merge authorization is not granted. Stop for user review.


## Authorized R2 correction cycle — stopped for scope review

The user authorized one focused cycle for R2-1 (provider abort forwarding), R2-2 (same-pass recovery before due purge) and R2-3 (passive telemetry suppression), limited to the runtime, telemetry, lifecycle unit test, fixture helper and this log. Before editing, a fresh fetch and GitHub metadata confirmed PR #121 OPEN/DRAFT/UNMERGED, local/remote head `e6b9a3407b709608723fee67318712c4a39b761d`, main/base `b36f0f9fb0fb24b03c3dad5b940145f6cadcb717`, a clean tree and prior CI #138/run 41971234908 SUCCESS with all three jobs passing. No material drift was found.

The pre-code plan identified abort/settlement races, maintenance drift and logging side effects as risks. The smallest implementation forwards/removes the input abort listener without changing the engine, requires confirmed recovery in a due-purge pass, and uses the injected monotonic clock for passive 60-second suppression. Rollback is removal/reversion of this focused correction; no database or production rollback is needed.

Only the five allowed files are modified. R2-1 preserves the original deadline, requests abort on the same submitted signal immediately on shutdown, handles an already-aborted input, detaches listeners on every wrapper settlement and keeps one conservative result/finalization. R2-2 forces recovery before a drifted due purge; failure skips purge and retries recovery after ordinary backoff. It adds neither catch-up nor drain-to-empty loops. Watchdog, repository result/slot handling, admission and C3c-4a code are unchanged.

R2-3 uses one shared activity bucket for successful maintenance/nonempty batch activity, one bucket per closed failure category and one for backoff. Lifecycle startup/stop records remain immediate. Empty batches and normal poll waits are not logged. Each bucket emits at most once per 60 monotonic seconds, with an optional aggregate count at the next allowed attempt. State contains only a closed category key, monotonic timestamp and numeric count; no timer or identity/request/provider/exception data. Counts saturate at 2147483647 and the output field is independently allowlisted/clamped. Sink failures cannot change scheduling and still consume the log window.

Exact deterministic bounds: through 60 seconds inclusive, 61 idle claims produce zero batch/poll_wait records and three operational records (activity at 0 and 60 seconds, plus ready); stopping adds only stopping/drained. For the first seven failed claims, unchanged waits of 900/1800/3600/7200/9000/9000ms produce one warning and one backoff record instead of seven each. At 67.5 seconds, 11 total failed claims produce two warning and two backoff records, with suppressedCount 9 on each later record. No failure becomes success and no call/retry is added or removed.

| R2 check | Result |
| --- | --- |
| Updated tests against unchanged runtime | 66 tests: 51 pass, 15 fail; findings reproduced before implementation |
| Focused lifecycle suite after correction | PASS: 66/66 |
| npm run typecheck / npm run build | PASS / PASS |
| Full npm test | PASS: 1756/1756; zero failed/skipped/cancelled |
| Unchanged C3c-4a focused suite | PASS: 68/68 |
| Unchanged worker PG17 | PASS: 8/8 scenarios |
| Unchanged lifecycle PG17 | BLOCKED: proof control depends on telemetry callbacks suppressed by R2-3 |
| Fresh complete 107-obligation/213-scenario/47-race proof and 11 prerequisites | NOT RUN: runner stopped at the lifecycle proof |
| Corrected-head CI / correction commit / push | NONE: stopped before commit or push |

The blocker is in the unchanged `test/postgres/every8dSettingsEmailWorkerLifecycle.cjs`: onePass stops its runtime only from a batch telemetry callback (line 58) and awaits runtime.done (line 59); subprocesses also stop from batch callbacks (line 83). With passive activity suppression those callbacks are intentionally not delivered per batch. The first onePass therefore waits indefinitely despite completed repository/provider work. Its child proof also has a 60-second timeout, so merely waiting for the log window is not a safe orchestration fix.

Sections M/P require the lifecycle PG17 proof to run unchanged and require a stop for scope expansion. Correcting the proof control would modify a file outside the five-file correction scope. No additional production file, database or SQL change is needed, but no such test-only expansion was made. The owned disposable run was interrupted and its specific test container/volume cleaned up. The earlier red unit-test run was also interrupted once to remove an old-behavior wait from test cleanup; no production correction retry was needed.

Required user decision: authorize a narrowly scoped update to the PG17 JavaScript proof orchestration so shutdown is driven by explicit test control/repository completion, independently of telemetry, retaining all six cases and assertions. Then rerun all required proofs and CI before a single correction commit/push. Do not weaken telemetry suppression to satisfy a test-control dependency.

Current delivery state: five allowed files left uncommitted for review; PR #121 stays on the required previous head, OPEN/DRAFT/UNMERGED. No C3c-4c, provider, credentials, external email network, production access/change, deployment or merge. Live-provider/production smoke tests were not performed. No success status is claimed; STOP FOR USER REVIEW.


## R2 continuation — authorized test-only PG17 orchestration expansion

The user explicitly authorized exactly one additional file, `test/postgres/every8dSettingsEmailWorkerLifecycle.cjs`, to remove telemetry-driven proof control while preserving the existing five-file R2 corrections. Before this edit, PR #121 was reverified OPEN/DRAFT/UNMERGED at `e6b9a3407b709608723fee67318712c4a39b761d`, with two PR commits; local/remote heads and main/base still matched. SHA-256 snapshots confirmed all five uncommitted files were preserved before the orchestration change. The earlier blocked-run records above are historical evidence, not current PASS evidence.

The pre-code plan used real repository observations and the existing injected clock seam to recognize the wait after a complete processing pass. The risk was stopping before finalization or admitting another claim. Test-only passControl returns every real validated repository result unchanged, tracks active operations and pending claimed jobs, and recognizes the following scheduled wait only when those operations have settled. Single-pass proofs hold that future wait and request normal shutdown on a microtask after the runtime installs wait cancellation. They assert exactly one claim/pass, no pending work, a drained signal shutdown, and the original recovery/purge/claim ordering. No production API, RPC, receipt, fencing or clock deadline changes are added.

Child processes use the same explicit proof coordination. Restart/one-pass mode stops after one complete pass. Competitors retain real polling waits and continue until the real PostgreSQL condition says all seeded jobs are ACCEPTED, then request normal process shutdown at their own completed-pass boundary. Crash mode retains its explicit synthetic-submission IPC and the parent's intentional SIGKILL. All six scenario branches and all original provider-count/durable-state/attempt/scrubbing assertions remain. Telemetry only records an observation count and deliberately throws a synthetic sink error; no telemetry event stops or advances the proof. Both in-process and child completions assert that no batch telemetry was received, demonstrating progress despite suppression and sink failure.

The complete authorized correction set is now the runtime, telemetry module, lifecycle unit test, fixture helper, PG17 lifecycle JavaScript proof and this log. The PG17 shell runner, package/CI wiring, every SQL/migration/rollback, engine, provider contract, crypto, renderer, parser/registry, server and other channels remain protected. Rollback: revert the single focused correction commit; no database or production rollback. No additional runtime/product scope is authorized or required.

Fresh validation will run from this completed correction state: typecheck, full npm tests, build, lifecycle and unchanged engine focused tests, unchanged worker PG17 8 cases, lifecycle PG17 6 cases, full 107 obligations/213 scenarios/47 races/11 prerequisites, and protected equality including all 44 SQL files. No interrupted run is counted. Only after all required local checks pass may one correction commit be created and pushed; the automatic exact-head CI must then pass on its first observed attempt. Final local and CI evidence will be recorded below and in PR #121 before handoff. No manual CI rerun, merge, deployment, provider selection, credentials, live-provider test, external email or production action is authorized.


Fresh continuation checks completed before the long C3c-3 proof:

| Check from final correction state | Result |
| --- | --- |
| npm run typecheck / npm run build | PASS / PASS |
| Full npm test | PASS: 1756/1756, zero failures/skips/cancellations |
| Focused lifecycle / unchanged C3c-4a engine | PASS: 66/66 and 68/68 |
| Fresh worker PG17 / lifecycle PG17 | PASS: 8/8 and 6/6; interrupted earlier run excluded |
| Lifecycle telemetry independence | All six preserved cases complete with a failing sink and zero batch records; single-pass proofs require exactly one claim/pass |
| Protected files outside six-file correction set | 282 unchanged against the previous head |
| SQL equality | All 44 files byte-identical to both previous head and original main/base |
| Full C3c-3 / prerequisites | Running fresh; no completion claimed until certificate and cleanup succeed |

Fresh logs and certificates use ignored `.temp/r2-final-*` and `.temp/c3c4b2-r2-final-*` artifacts. The local disposable runner removes its exact owned container and anonymous volume on exit. No unrelated worktree, process, file or resource is modified.


## R2 final local validation and delivery gate

Fresh final-state validation completed successfully before any correction commit or push:

| Required check | Final local result |
| --- | --- |
| Typecheck / full npm test / build | PASS / 1756 of 1756 PASS / PASS |
| Focused lifecycle / unchanged engine | 66 of 66 PASS / 68 of 68 PASS |
| Worker PG17 / corrected lifecycle PG17 | 8 of 8 PASS / all six preserved scenarios PASS |
| C3c-3 final execution and coverage | 107 of 107 obligations PASS, zero missing/partial; 213 scenarios; 47 independent-session races |
| Prerequisite DB regressions | All 11 pinned regressions PASS |
| Unexpected deadlocks/timeouts | Zero |
| Fresh certificate cleanup | Zero harness backends, base proof databases and regression resources |
| Protected scope / SQL | 282 files outside the six-file correction set unchanged; all 44 SQL files byte-identical to correction base and original main |
| PG17 lifecycle shell / package / CI wiring | Unchanged |

The interrupted earlier run is not counted. The successful new runner completed with exit code zero; its specific disposable container and anonymous volume were removed on exit. The regenerated tracked coverage certificate was preserved under ignored `.temp/r2-final-section36-coverage.json`, then restored to its exact baseline tracked content. Generated Python bytecode was removed only inside this worktree. SHA-256 snapshots confirm the original four R2 code/test files were preserved throughout this continuation; only the separately authorized PG17 JavaScript proof and run log changed further.

One focused correction commit may now be created on the existing branch and pushed to PR #121. Record its exact SHA and the automatic corrected-head CI run/attempt and all three job results in the PR/delivery report. No manual CI rerun is authorized. The PR must remain OPEN/DRAFT/UNMERGED. Independent review has not been performed by this implementation agent; next gate is `INDEPENDENT_C3C_4B_2_R2_REREVIEW` after all corrected-head jobs pass. No unapproved file or product scope changed. No production access/action, real provider, credentials, external email, live-provider/production smoke test, Railway deployment or merge occurred.
