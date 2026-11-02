# C3c-4a provider-neutral email worker engine

## Task identification

- GitHub task: user-approved C3c-4a implementation; delivered as a separate draft pull request.
- Approved branch: `codex/c3c4a-email-worker-engine`.
- Worktree: `C:\Users\User\source\repos\win-crm.ai-lineconnect-c3c4a-worker`.
- Base: `c5029fb1671848389efc6f6ed689b451c1308401`.
- Required baseline: [CI #131 SUCCESS](https://github.com/hugolamcloser/win-crm.ai-lineconnect/actions/runs/40496397389).
- Authority: Level 3; no merge, deployment, production access or live delivery.
- Started / updated: 2026-11-02, Asia/Kuala_Lumpur.

## Objective, assumptions and smallest safe plan

Implement only the provider-neutral adapter boundary, one-shot durable worker, fixed v1 enrollment/login renderer, and deterministic fake-provider proof. C3c-4 planning is PASS_WITH_TIGHTENINGS as supplied by the user.

Future callers supply a trusted approved sender/provider selection. This slice adds no provider ID parser, registry, credentials, configuration defaults or production wiring. Adapter approval must independently verify that its evidence is authoritative: the neutral worker validates the closed evidence shape, not a vendor's underlying response. HTTP status or arbitrary boolean evidence is insufficient. Provider IDs retain the frozen lowercase/32-character/approved-registry architecture for later operational configuration; no additional ID regex is introduced.

The plan was stated before coding: reuse C3c-3 claim/decryption/idempotency/finalization; add only a pure begin-receipt provenance check to its strict repository; claim ten once and process up to ten concurrently; enforce exactly the next durable attempt, conservative monotonic deadline, at most one provider invocation and at most one finalization. Run focused failures, mandatory npm checks and isolated PG17 proof. No SQL or new dependency is needed.

## Files inspected and findings

| Source | Finding |
| --- | --- |
| `AGENTS.md`, pilot plan and run-log template | Separate phase; preserve LINE/OAuth/Phase2F; no production, merge or deploy. |
| C3c contract and C3c-3 outbox contract | PostgreSQL receipts own leases, attempt windows, retry eligibility and scheduling. |
| Outbox repository, crypto and types | Existing strict parsing, claim provenance, exact AAD, historical-key decryption, and stable idempotency helper can be reused. |
| C3c-3 fixtures and Section-36 harness | Real PG17 proofs can run unchanged in a network-disabled disposable container. |
| Existing CI | A focused worker step can use the existing PG17 service without runtime integration. |

## Implementation and risk

- `src/types/every8dSettingsEmailProvider.ts`: four provider results only; narrow immutable send input and closed acceptance/refusal/non-acceptance evidence. No DB or recorder access. IDs require the unchanged DB message-ID contract (1-255 printable non-space ASCII), without normalization or truncation.
- `src/services/every8dSettingsEmailTemplate.ts`: fixed enrollment/login v1 plain text; no OTP in subject, URLs, HTML, tracking or attachments. Expiry derives from the durable deadline and rounds down to seconds. Product copy remains provisional.
- `src/services/every8dSettingsEmailWorker.ts`: no work at construction; one `claim({batchSize:10})`; shared-repository overlapping invocation guard; concurrent per-job scope; decrypt before begin; validated provenance and exact attempt increment; abortable single provider call with no retry; one chosen result and one finalize maximum. Local elapsed claim/begin/RPC/processing time only shortens DB authority. Exhaustion before invocation leaves SENDING. Late completions cannot gain authority.
- `src/services/every8dSettingsEmailOutboxRepository.ts`: WeakMap provenance for already strictly parsed immutable begin receipts and one pure reader. Existing parsing, RPC names, SQL and authority semantics remain unchanged.
- Test-only fake provider and worker tests cover controlled acceptance/refusal/non-acceptance/ambiguity, status-only failures, before/after emission throws, timeout, reset, cancellation, malformed IDs, receipt failures and timing boundaries.
- PG17 worker proof uses the real repository through a test-only allowlisted psql RPC bridge, existing synthetic fixtures and independently committed sessions. No test bridge is imported by application code.
- CI adds dependency installation/build and the worker PG17 proof before the existing full C3c-3 authority proof.

Main risks are accidentally widening a send window, retaining sensitive references, or replaying ambiguous work. Tests cover those boundaries. Plaintext references are released in per-job finally paths and before finalization; late handlers retain the deadline rather than the request. The worker allocates no mutable plaintext Buffer; existing crypto owns buffer cleanup. Adapters must zero their own mutable buffers in finally and must not retain requests after settlement/cancellation. JavaScript strings and runtime/transport copies cannot be guaranteed erased.

## Commands and validation

| Check | Result / evidence |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS, locked dependencies only; package files unchanged. |
| `npm run typecheck` | PASS after final application changes. |
| `npm test` | PASS: 1,648 tests, zero failed/skipped/cancelled, including 52 focused worker tests and existing LINE/OAuth/Phase2F regressions. |
| `npm run build` | PASS after final application changes. |
| `node --test test/every8dSettingsEmailWorker.test.cjs` | PASS: 52 deterministic focused tests. |
| `bash test/postgres/every8dSettingsEmailWorker.sh` | Eight real-repository PG17 cases passed locally; CI repeats against the final commit. |
| Existing `every8dSettingsEmailOutboxSection36.sh` | Full current 107-obligation execution is required by this PR's `postgres-email-outbox` check; baseline #131 is not substituted for it. Local current execution/certificate retained in ignored `.temp/` artifacts. |
| `git diff --check` and protected-path diff | Required before commit; no migration, rollback, SQL, server/app, Railway or existing LINE/OAuth/Phase2F change. |

The eight PG17 worker cases are accepted, invalid accepted ID, begin commit acknowledgement lost, late begin acknowledgement, stale fence, missing decryption key, finalize acknowledgement lost, and positive non-acceptance. The adapter independently observes committed SENDING and the absence of an outstanding repository transaction before send. Final durable state and terminal scrub are asserted; DB-owned retry delay is observed rather than calculated by the worker.

The focused tests also prove batch ten, concurrent ten, shared-repository overlap refusal, no provider while claim/begin is pending, exact tuple/attempt propagation, terminal/forged/malformed begin refusal, one decryption per lease, malformed authenticated plaintext refusal, timer exhaustion/failure before submission, deadline race and late completion suppression, no retry/finalize replay, exact existing idempotency, closed diagnostics and no logging. All fake transports are network-free.

## Approaches and correction budget

- Implementation correction loops: 2 of 2 used. First corrected the missing-historical-key fixture to a valid nonempty keyring and closed the pre-invocation deadline edge. Second released late-handler request references and added boundary proofs. All mandatory application checks pass.
- Reviewer correction loops: 1 of 1; the user explicitly authorized the R2-only owner cycle recorded below.
- Local harness setup adjustments: new shell files normalized to LF; Docker readiness waits for the final postmaster. Regular WSL user lacked Docker socket permission; dedicated tests use WSL root. No production service was accessed.
- Rejected: provider registry/config parsing, real transport, retry timers, challenge recorder calls, lifecycle polling/recover/purge/signals, new SQL or production startup integration.

## Rollback and remaining limits

Revert the phase commit to remove the new application/test/docs files, CI additions and repository provenance reader. No schema, data migration, key, environment or production rollback is required.

No real provider, live email, production credentials, production smoke test, deployment, scheduler, worker entrypoint or C3c-4b integration was tested or implemented. Manual production smoke tests are not applicable to this unconnected slice. Later operational adapters still require separate review of canonical sender/registry selection, truthful provider evidence, transport cancellation, no hidden retries/redirect replay and buffer disposal.

## Required boundary report

```text
DATABASE_AUTHORITY: UNCHANGED
NEW_DATABASE_MIGRATION: NONE
REAL_EMAIL_PROVIDER: NOT_IMPLEMENTED
WORKER_RUNTIME_ENTRYPOINT: NOT_IMPLEMENTED
PRODUCTION_EMAIL: NOT_POSSIBLE_FROM_THIS_SLICE
PRODUCTION_CHANGES: NONE
NEXT_GATE: INDEPENDENT_C3C_4A_R2_RE_REVIEW
```

Stop for user review after current PR checks pass. No merge or deployment is authorized.

## R2 owner correction: one explicitly authorized cycle

The user authorized corrections for R2-1 and R2-2 only, using this existing owner chat, worktree and branch. Reviewed head: `73f332356bb1479b4587c933537db495c61bdb39`, initial CI #132 SUCCESS. No new worktree, branch switch, history rewrite or scope expansion was authorized or performed.

The pre-code plan identified only the worker, provider result validator, focused tests and this log. The main risks were send permission after scheduling overhead and output construction from getter values different from those validated. The smallest plan was a fresh minimum-one-millisecond guard immediately before invocation, plus immutable field snapshots read once; no authority, transport, configuration or lifecycle changes.

- R2-1: immediately before marking invocation and calling the adapter, require `deadline - clock.nowNs() >= 1000000n` and no cancellation. Scheduling/processing overhead leaving 999999ns, 1ns or zero produces no provider call and no finalization; confirmed SENDING remains for existing DB recovery. Exactly 1000000ns is inclusive and preserves the original deadline. No rounding up, new window or reused authority.
- R2-2: snapshot outcome, evidence and provider message ID once for the accepted shape; snapshot outcome/evidence once for refusal/retry shapes, and kind once for the exact retry evidence object. Validate and freeze only those local snapshots. Preserve exact 1-255 printable non-space ASCII ID rules and the existing closed evidence enums. Getter exceptions and malformed shapes remain outcome_unknown. Vendor truth remains a future adapter responsibility.
- Added 16 deterministic tests. The pre-fix targeted run reproduced seven failures; after correction all 68 focused tests pass. Cases include both sub-millisecond boundaries, exact-one-millisecond and actual-deadline equality, timer cancellation/listener removal, late callback suppression, changing and throwing getters, invalid-first evidence, frozen normalized output and exact worker finalization mappings. Optional synchronous send throw and immediate in-send cancellation are covered without production changes. Existing focused tests are preserved byte-for-byte as a prefix.

| Final local check | Result |
| --- | --- |
| Focused worker tests | PASS: 68/68, no skips/cancellations |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 1,664/1,664 |
| `npm run build` | PASS |
| Worker PG17 proof | PASS: all eight real-repository cases |
| Full unchanged C3c-3 proof | PASS: 107/107 obligations, zero missing/partial; 213 scenarios, 47 races |
| All 11 prerequisite DB regressions | PASS |
| Disposable proof cleanup | PASS: no surviving harness backends, databases or regression resources |
| Protected SQL | 30 files unchanged against canonical base blobs and byte-identical to the original base checkout; no SQL edit or migration |
| Dependencies/startup/LINE/OAuth/Phase2F/Railway | No changes |

Local R2 evidence is retained under ignored `.temp/r2-*` files. One focused child commit is added after the reviewed head and normally pushed to PR #119; corrected-head automatic CI must pass before final completion is reported. Its authoritative result is attached to that PR. No further implementation or reviewer correction cycle is included in this authorization.

Rollback: revert this single R2 correction commit to restore the reviewed implementation. No database, configuration, credentials or production rollback is needed. No real provider, production wiring, C3c-4b integration or production access was implemented or tested. Manual production smoke tests remain inapplicable to this unconnected slice.

Next gate: `INDEPENDENT_C3C_4A_R2_RE_REVIEW`. Merge authorization is not granted. Stop for user review after corrected-head CI.
