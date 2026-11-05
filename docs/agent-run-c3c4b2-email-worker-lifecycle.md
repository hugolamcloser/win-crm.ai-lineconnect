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

Startup maintenance performs at most one recovery call with batch 100 per pass, followed by one purge call with batch 100 only after recovery success. Failed maintenance backs off without polling; startup readiness requires both successes. Later recovery is due five seconds after completion, purge sixty seconds after completion. Missed intervals coalesce through due times; one pass never drains to empty. No maintenance overlaps a batch or another maintenance call. Maintenance may wake the loop before a poll deadline but cannot shorten its selected 1000–1200ms delay. Repository failures apply integer jitter over inclusive 90–100% of 1000/2000/4000/8000/10000ms tiers; successful work resets the failure tier. Contract violations initiate bounded stopping.

`EmailWorkerStopping` is a distinct application exception without an outcome/receipt. Claim, begin, recovery and purge reject local admission while stopping. Valid engine finalization is allowed during drain once per engine job, never retried or replayed. The facade preserves the exact repository result, including late acknowledgements. Each repository watchdog observes the original promise, initiates stopping after 15 seconds, and does nothing else: no Promise.race, synthetic result, slot release or second attempt. The serial flow remains active until its repository promises settle, even after the application drain has expired.

The first signal closes admission, cancels the single future wait and aborts the worker cancellation signal. Repeated signals reuse the same shutdown. Late claims/begins cannot invoke a provider. The unchanged engine may finalize an already-submitted cancelled attempt as outcome_unknown once; no positive non-acceptance is inferred. A lifecycle provider facade gives the actual submitted adapter a separate abort signal with precisely its original monotonic deadline. Shutdown never gives it another window or shortens that deadline. Drain waits for that original deadline/settlement and durable work, up to a total 20 seconds after stopping. Only total drain expiry permits process exit with unresolved state left to database recovery.

## Validation and commands

All commands operate in the new worktree. Dependencies use the existing lockfile with `npm ci --ignore-scripts --no-audit --no-fund`. No production dependency was added. Run `npm run typecheck`, `npm test`, `npm run build`; focused lifecycle proof uses `node --test test/every8dSettingsEmailWorkerLifecycle.test.cjs`. Existing C3c-4a tests and worker PG17 proof are unchanged. Disposable PG17 containers use `--network none`, no published ports and synthetic fixtures only. The full unchanged C3c-3 harness runs all 107 obligations, 213 scenarios, 47 races and all 11 pinned prerequisite DB regressions; final results and CI run are recorded in the draft PR and delivery report.

Local evidence at implementation commit:

| Check | Result |
| --- | --- |
| Typecheck / build | PASS / PASS |
| Full npm test | PASS: 1,740/1,740; zero failed, skipped or cancelled |
| New lifecycle unit proof | PASS: 50/50 |
| Unchanged C3c-4a engine tests | PASS: 68/68 |
| Unchanged worker PG17 proof | PASS: 8/8 scenarios |
| New lifecycle PG17 proof | PASS: 6/6 scenarios, including restart and competing processes |
| Existing protected files | 277 unchanged against exact base (only package/CI wiring excluded) |
| Protected SQL byte equality | 44/44, including all 30 migration/rollback files |
| Complete 107-obligation PG17 proof / prerequisite regressions | Running at implementation commit; final result required in draft PR and delivery report |

The new lifecycle PG17 bridge wraps SQL function output in a record subquery, including single-column purge output, matching the existing repository RPC contract. An initial test-only aggregate returned scalar purge rows and correctly triggered contract shutdown; this was corrected in the bridge without touching SQL or repository authority. A later fixture-stage failure was narrowed with closed stage diagnostics; the complete six-scenario run subsequently passed without an application change. Stage output never includes SQL, requests, identifiers or raw exceptions.

Detailed local logs, execution/coverage certificates and protected-file inventory are under ignored `.temp`. The unchanged coverage harness can regenerate a tracked certificate; retain the newly generated evidence under `.temp` and restore its baseline tracked bytes before committing. Verify every pre-existing protected source/test/SQL file equals the exact base; only package and CI wiring are intentionally modified. No production provider readiness/network smoke test is applicable because there is no approved provider.

## Budget, exclusions and rollback

- Active tasks: one; no delegated implementation or independent review is claimed.
- Implementation correction: one bounded application correction for lazy imports and poll scheduling; one test-bridge correction. No reviewer correction loop.
- Excluded: real provider, provider credentials, database/migrations/RPC changes, server startup, LINE/SMS/OAuth/Phase2F, Railway, C3c enablement and live delivery.
- Rollback: revert this focused slice. No schema, credential, environment or production rollback is needed.
- Next gate: `INDEPENDENT_C3C_4B_2_IMPLEMENTATION_REVIEW`. Draft PR only; merge authorization is not granted. Stop for user review.
