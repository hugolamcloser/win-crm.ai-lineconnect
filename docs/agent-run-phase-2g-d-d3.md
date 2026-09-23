# Agent run — Phase 2G-D Gate D3 implementation

## Task identification

- GitHub task: Phase 2G-D D3 controlled HighLevel lifecycle evidence implementation.
- Approved branch: `codex/phase-2g-d3-lifecycle-evidence`.
- Authority level: Level 3 implementation, test, commit, push, and Draft PR only.
- Started at: 2026-09-22.
- Last updated at: 2026-09-23 (second repair).

## Task objective

Repair the controlled EVERY8D Connect HighLevel INSTALL/UNINSTALL replay boundary so signed event chronology, exact replay, status changes, and generation changes are durable and atomic in PostgreSQL. Preserve the code-only callback rejection and all ownership, OAuth, LINE, SMS, and production safety boundaries.

## Current hypothesis

The D3 ordering RPC needs two database-owned prerequisites: a migration-time chronology fence for every pre-D3 row and an immutable registration for the exact app/client/Conversation Provider/channel identity. Keeping both additive and enforcing them inside the same row-locking security-definer boundary prevents stale upgrade reversal and caller-invented first ownership without introducing another installation identity or event table.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `src/services/every8dGhlMarketplaceLifecycleService.ts` | Lifecycle policy | D1 still required unobserved fields and blocked INSTALL provisioning. |
| `src/services/every8dGhlOAuthRepository.ts` | Persistence identity and concurrency | Atomic INSTALL already exists; UNINSTALL previously trusted payload company. |
| `supabase/migrations/202609220001_ghl_marketplace_company_ownership.sql` | Ownership guarantees | Company is immutable after binding; the RPC is idempotent and concurrency-safe. |
| `test/postgres/ghlMarketplaceOwnership.sh` | Real database proof | Hosted CI already exercises duplicate/concurrent provisioning and generation convergence on PostgreSQL 17. |
| `src/routes/every8dGhlOAuth.ts` | Callback safety | Query validation already rejects a missing state before token exchange. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| INSTALL includes Location install type and company; UNINSTALL omits both. | Supplied controlled D3 payloads | Event-type-specific validation is required. |
| `appNamespace` and stable installation identity are absent. | Supplied controlled D3 payloads | Namespace remains internal; row identity stays database-owned. |
| Retry deliveries preserve their event `webhookId`; separate lifecycle events use different values. | Supplied controlled D3 observations | `webhookId` participates in exact replay identity but never installation identity. |
| Stale opposite events can arrive after a newer transition. | Final read-only D3 re-audit | The database must compare signed timestamps under the same row lock used for status/generation mutation. |
| Direct Marketplace callback carried code but no state. | Supplied controlled D3 observation | Existing fail-closed callback validation must remain unchanged. |
| Pre-D3 rows have no chronology watermark. | Final D3 re-audit | D3 must establish an explicit migration-time fence before stale historical events can be considered. |
| The ordered RPC accepted caller-supplied first-install identity. | Final D3 re-audit | App/client/Conversation Provider/channel/provider ownership must be registered outside `service_role` authority. |
| SQL CHECK accepted partial watermark tuples through three-valued NULL behavior. | Final D3 re-audit | The persistent check and trigger must explicitly require all NULL or all present. |
| The original race used process overlap plus sleep. | Final D3 re-audit | An observer must prove the blocked backend and its blocker before lock release. |

## Second-repair design

- Pre-existing rows receive an `INTERNAL_BASELINE` at `transaction_timestamp()`. The namespaced ID is constrained to their row UUID, current status, and generation. It is synthetic migration state, never represented as a HighLevel webhook.
- One owner-managed `ghl_marketplace_app_registrations` row pins the `every8d_connect` app, OAuth client, Conversation Provider, `sms` channel, and `every8d` provider. Consistent D1 ownership is pinned during migration; an empty table remains fail closed until owner registration. Browser roles and `service_role` have no registration table privileges.
- The lifecycle watermark check and trigger explicitly accept only an all-NULL tuple or an all-present, finite, valid tuple. All six partial combinations have executable rejection proofs.
- The concurrency harness holds A open through a FIFO, captures A and B backend PIDs, requires `wait_event_type = 'Lock'` plus `pg_blocking_pids(B)` containing A, and only then sends `COMMIT` to A.
- Rollback permits exact synthetic baselines but refuses any authoritative post-D3 `INSTALL` or `UNINSTALL` evidence. It never removes installation, OAuth, token, or audit rows.

## Commands executed and results

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git fetch origin` | Refresh authoritative main | Passed | Branch created from `c5d7e043137423b6f3de17e17ef75ebbbc2c0860`. |
| `npm run typecheck` | Type safety | Passed after one compile-only narrowing correction | No runtime contract correction loop was needed. |
| Focused Node test run | Lifecycle/repository/callback behavior | Passed, 41 tests | Exact observed shapes, event forwarding, replay, stale reversal, and equal-time ambiguity are covered. |
| `npm test` | Full repository regression suite | Passed, 529 tests | 529 passed; 0 failed, skipped, cancelled, or todo. |
| First-repair local PostgreSQL 17 probe | Find disposable database runner | Unavailable | Client tools were installed, but there was no local server or Docker runtime. |
| First-repair hosted PostgreSQL 17 run `35805822829` | First D3 migration execution | Failed before lifecycle assertions | PostgreSQL rejects regex repetition bound `{1,256}`; replaced with `char_length` plus the same character allowlist. |
| First-repair hosted CI run `35805997246` | Corrected validation before final re-audit | Passed | `validate` passed in 21s; PostgreSQL 17 `postgres-concurrency` passed in 50s. This predates the second-repair changes. |
| Second-repair `npm run typecheck` | Type safety after registration/baseline changes | Passed | No TypeScript errors. |
| Second-repair `npm test` | Full local regression suite | Passed, 529 tests | 529 passed; 0 failed, skipped, cancelled, or todo. |
| Second-repair `npm run build` | Production TypeScript build | Passed | Build completed with no error. |
| Second-repair `git diff --check` | Patch whitespace | Passed | Only expected working-copy line-ending notices. |
| Second-repair PostgreSQL 17 probe | Find a genuine local database runner | Unavailable | Docker is not installed; the PostgreSQL 17.11 command-line-tools package lacks `share/postgres.bki`, so `initdb` cannot create a disposable cluster. Hosted CI remains the supported executable database path. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Add timestamp/ID/type watermark columns to the ownership row | Accepted | Row uniqueness remains installation identity while one lock serializes chronology and transition state. |
| Replace split INSTALL/UNINSTALL mutations with one ordered RPC | Accepted | Exact retry, stale delivery, and concurrent opposite events share one transactional decision. |
| Resolve UNINSTALL company from exact stored ownership | Accepted | Payload company/install type can remain absent without cross-tenant inference. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Store `webhookId` as installation identity | INSTALL and UNINSTALL have different IDs; retries only establish delivery/event identity. |
| Keep using the unordered D1 provisioning RPC | It can reactivate an uninstalled row before signed event chronology is compared. |
| Use only an in-memory lock or TypeScript compare-and-swap | It does not survive restart, multiple Railway instances, or response loss. |
| Order events by `webhookId` | Observed IDs are random UUIDs and establish identity, not chronology. |
| Accept code-only OAuth callback | Would weaken CSRF/browser binding and permit exchange without valid state. |
| Select or activate the Conversation Provider | Installation success is not provider activation and this task forbids the change. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `src/routes/every8dGhlMarketplaceWebhook.ts` | Require strict calendar-valid RFC 3339 timestamp and event ID. | Rejects missing/malformed chronology before lifecycle mutation. |
| `src/services/every8dGhlMarketplaceLifecycleService.ts` | Route both event types through one ordered repository operation. | Preserves event-specific ownership validation while allowing stale events to return current state. |
| `src/services/every8dGhlOAuthRepository.ts` | Call only the ordered lifecycle RPC; remove the split read/update uninstall path. | Eliminates process-local arrival-order decisions. |
| `supabase/migrations/202609230001_ghl_marketplace_lifecycle_ordering.sql` | Add registered identity authority, pre-D3 internal baseline, strict watermark, v3 integrity trigger, and atomic ordered lifecycle function. | Prevents stale upgrade reversal and caller-invented first ownership while preserving post-D3 ordering. |
| `supabase/rollback/202609230001_ghl_marketplace_lifecycle_ordering.sql` | Permit exact synthetic-baseline rollback and refuse rollback after authoritative lifecycle evidence. | Removes only additive D3 objects without deleting retained rows or accepted HighLevel chronology. |
| `test/every8dGhlMarketplaceWebhook.test.cjs` | Strict evidence, exact replay, stale reversal, equal-time ambiguity, and generation proofs. | Test-only. |
| `test/every8dGhlOAuthRepository.test.cjs` | Ordered RPC adapter proof. | Test-only. |
| `test/postgres/ghlMarketplaceLifecycleOrdering.sql` | Executable registered-identity, strict watermark, lifecycle chronology, and privilege proof. | Test-only. |
| `test/postgres/ghlMarketplaceLifecycleOrdering.sh` | Pre-D3 migration fence, guarded rollback/reapply, and observed two-connection lock-wait proof. | Test-only. |
| `test/postgres/ghlMarketplaceOwnership.sh` | Temporarily removes/reapplies D3 around historical D1 rollback proofs. | Test-only. |
| `.github/workflows/ci.yml` | Run the focused lifecycle PostgreSQL proof in hosted CI. | CI-only. |
| `test/every8dGhlOAuthRoute.test.cjs` | Code-only callback rejection test. | Test-only. |
| `docs/phase-2g-d-company-ownership.md` | D3 evidence and contract documentation. | Documentation only. |
| `docs/agent-run-phase-2g-d-d3.md` | This evidence log. | Documentation only. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | Replay-repair working tree. |
| `npm test` | Passed | 529 passed; 0 failed, skipped, cancelled, or todo. |
| `npm run build` | Passed | Final run. |
| `git diff --check` | Passed | Only expected LF-to-CRLF working-copy notices. |
| Hosted `validate` | Pending for second repair | First-repair run `35805997246` passed but does not validate this repair. |
| PostgreSQL 17 ownership/concurrency suite | Pending for second repair | First-repair run `35805997246` passed but predates the baseline, registration, strict-tuple, and observed-lock changes. |

## Budget and stop-rule status

- Active coding tasks: one.
- Implementation correction loops used: one hosted PostgreSQL syntax correction (`{1,256}` to `char_length` plus allowlist).
- Reviewer correction loops used: zero.
- Repeated errors or failed approaches: none.
- Stop rule triggered: no.

## Unresolved decisions

None in D3 scope. A separate controlled OAuth-initiation design must resolve the observed missing-state Marketplace path before OAuth can be enabled.

## Recommended next action

Stop for final re-audit of existing Draft PR #102 without merge, deployment, provider activation, OAuth enablement, or production migration.
