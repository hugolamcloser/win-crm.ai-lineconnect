# Agent run — Phase 2G-D Gate D3 implementation

## Task identification

- GitHub task: Phase 2G-D D3 controlled HighLevel lifecycle evidence implementation.
- Approved branch: `codex/phase-2g-d3-lifecycle-evidence`.
- Authority level: Level 3 implementation, test, commit, push, and Draft PR only.
- Started at: 2026-09-22.
- Last updated at: 2026-09-23.

## Task objective

Repair the controlled EVERY8D Connect HighLevel INSTALL/UNINSTALL replay boundary so signed event chronology, exact replay, status changes, and generation changes are durable and atomic in PostgreSQL. Preserve the code-only callback rejection and all ownership, OAuth, LINE, SMS, and production safety boundaries.

## Current hypothesis

The D1 provisioning RPC owns installation identity but does not persist event chronology, so arrival-order processing can reverse a newer lifecycle transition. A minimal additive watermark on the ownership row plus one row-locking PostgreSQL function can make chronology and mutation atomic without introducing a second installation identity or a separate event table.

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

## Commands executed and results

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git fetch origin` | Refresh authoritative main | Passed | Branch created from `c5d7e043137423b6f3de17e17ef75ebbbc2c0860`. |
| `npm run typecheck` | Type safety | Passed after one compile-only narrowing correction | No runtime contract correction loop was needed. |
| Focused Node test run | Lifecycle/repository/callback behavior | Passed, 41 tests | Exact observed shapes, event forwarding, replay, stale reversal, and equal-time ambiguity are covered. |
| `npm test` | Full repository regression suite | Passed, 529 tests | 529 passed; 0 failed, skipped, cancelled, or todo. |
| Local PostgreSQL 17 probe | Find disposable database runner | Unavailable | Client is installed, but no local server or Docker runtime exists; hosted CI owns the real PostgreSQL 17 run. |
| Hosted PostgreSQL 17 run `35805822829` | First D3 migration execution | Failed before lifecycle assertions | PostgreSQL rejects regex repetition bound `{1,256}`; replaced with `char_length` plus the same character allowlist. |
| Hosted CI run `35805997246` | Corrected final validation | Passed | `validate` passed in 21s; PostgreSQL 17 `postgres-concurrency` passed in 50s, including the two-connection lifecycle race. |

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
| `supabase/migrations/202609230001_ghl_marketplace_lifecycle_ordering.sql` | Add durable watermark, v3 integrity trigger, and atomic ordered lifecycle function. | Makes replay/order decision and state mutation one PostgreSQL transaction. |
| `supabase/rollback/202609230001_ghl_marketplace_lifecycle_ordering.sql` | Refuse rollback when accepted lifecycle evidence exists. | Prevents silent evidence destruction. |
| `test/every8dGhlMarketplaceWebhook.test.cjs` | Strict evidence, exact replay, stale reversal, equal-time ambiguity, and generation proofs. | Test-only. |
| `test/every8dGhlOAuthRepository.test.cjs` | Ordered RPC adapter proof. | Test-only. |
| `test/postgres/ghlMarketplaceLifecycleOrdering.sql` | Executable lifecycle chronology and privilege proof. | Test-only. |
| `test/postgres/ghlMarketplaceLifecycleOrdering.sh` | Guarded rollback and two-real-connection race proof. | Test-only. |
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
| Hosted `validate` | Passed | Run `35805997246`; 529 tests plus typecheck/build. |
| PostgreSQL 17 ownership/concurrency suite | Passed | Run `35805997246`; migration chain, rollback guards, and two-connection lifecycle race passed. |

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
