# C3c-4c-1 unregistered Resend adapter run log

## Task and exact base

- Task and authority: C3c-4c-1 only, per the pasted implementation authorization.
- Repository: `hugolamcloser/win-crm.ai-lineconnect`.
- Base: `ba03020684ac626af7e65ec67ee9cfa1d3cc273b`. Freshly fetched `origin/main` and `FETCH_HEAD` matched.
- Branch: `codex/c3c4c1-resend-adapter-foundation`, created in a new clean Codex-managed worktree at the exact base.
- Base CI: [CI #140, run 41994845997, attempt 1](https://github.com/hugolamcloser/win-crm.ai-lineconnect/actions/runs/41994845997/attempts/1). GitHub reported it as the latest main run. Its head matched the base and `validate`, `postgres-concurrency` and `postgres-email-outbox` succeeded.
- Date: 2026-11-12, Asia/Kuala Lumpur.

## Scope and risk

The plan before editing used the pasted C3c-4c contract, the repository AGENTS and run-log template, and the frozen C3c-4a/4b run logs and source. The finished adapter was also checked against the C3c-3 outbox and settings-auth contracts. Resend's published endpoint, error and idempotency documentation confirmed the status/name combinations and provider key bound. The slice adds a pure parser and an unregistered, explicitly constructed adapter. It assumes the frozen engine supplies the rendered plaintext, canonical sender, recipient, exact idempotency key and original monotonic deadline.

The main risks were an extra POST, unsafe delivery inference, missed cancellation and sensitive diagnostics. The adapter uses one fixed one-use HTTPS request, bounded streamed evidence, a single result settlement and a payload-free fatal observer. The test transport traps external network entry. Exact request values are asserted without printing them. A regression verifies that an observable Content-Length contradiction latches fatal before a later interruption.

## Changed files

| File | Change |
| --- | --- |
| `src/config/every8dSettingsEmailResend.ts` | Pure byte-bounded parser with a fixed value-free error |
| `src/services/every8dSettingsEmailResendProvider.ts` | Frozen unregistered adapter, fixed HTTPS destination and closed evidence |
| `test/every8dSettingsEmailResendConfig.test.cjs` | Credential shape, preservation and canary tests |
| `test/every8dSettingsEmailResendProvider.test.cjs` | Network-free request, response, timing, cleanup and canary tests |
| `docs/every8d-c3c4c-resend-provider-contract.md` | Frozen request, response, fatal and activation boundaries |
| `docs/agent-run-c3c4c-email-provider.md` | Validation, scope and rollback evidence |

## Validation

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | 1,878 PASS, zero failures, skips or cancellations. Base 1,756 plus 122 focused Resend cases |
| `npm run build` | PASS |
| `node --test test/every8dSettingsEmailResendConfig.test.cjs` | 22 PASS |
| `node --test test/every8dSettingsEmailResendProvider.test.cjs` | 100 PASS |
| `node --test test/every8dSettingsEmailWorker.test.cjs` | 68 PASS |
| `node --test test/every8dSettingsEmailWorkerLifecycle.test.cjs` | 66 PASS |
| `bash test/postgres/every8dSettingsEmailWorker.sh` | PG17, 8 of 8 real-repository scenarios PASS |
| `bash test/postgres/every8dSettingsEmailWorkerLifecycle.sh` | PG17, 6 of 6 real-repository scenarios PASS |
| `bash test/postgres/every8dSettingsEmailOutboxSection36.sh` | PG17, 107 of 107 obligations PASS, 213 scenarios and 47 races |
| Pinned prerequisite database regressions within the C3c-3 proof | 11 of 11 PASS |
| Protected path comparison against the exact base | All 288 pre-existing tracked paths, including all 44 SQL files, match the base. Only the six paths above were added |

Local application validation used Node 24 and the existing lockfile. The PostgreSQL proof ran in a new disposable PG17 container with Docker networking disabled and synthetic fixtures. The scratch runner used CRLF-normalized copies of the unchanged shell scripts and stored output in ignored `.temp`. Earlier runner invocations produced empty logs and then hit the disposable-container naming guard. Neither was counted. The full proof's generated coverage artifact was retained in scratch and the protected tracked certificate restored to the exact base bytes.

The draft PR carries the automatic implementation-head CI evidence, including its SHA, attempt and all three required jobs. Recording that run in PR metadata keeps the validated commit fixed. The implementation gate ends at independent C3c-4c-1 review.

## Production and rollback

The production provider registry is empty. C3c-4c-2 activation, credential pre-gating and lifecycle bridging are outside this slice. Database authority, worker/config/lifecycle, flags, package files, CI wiring and production Railway configuration remain at their existing state. Zero real credentials, provider requests, live mail, production access, migrations, deployment or merge were used. Live-provider and production smoke tests are outside the approved proof.

Revert the focused commit to remove the adapter, parser, tests and documents. No database, deployment, credentials or environment rollback is required. The draft branch and managed worktree are retained.
