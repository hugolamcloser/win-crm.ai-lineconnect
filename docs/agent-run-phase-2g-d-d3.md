# Agent run — Phase 2G-D Gate D3 implementation

## Task identification

- GitHub task: Phase 2G-D D3 controlled HighLevel lifecycle evidence implementation.
- Approved branch: `codex/phase-2g-d3-lifecycle-evidence`.
- Authority level: Level 3 implementation, test, commit, push, and Draft PR only.
- Started at: 2026-09-22.
- Last updated at: 2026-09-22.

## Task objective

Represent the controlled EVERY8D Connect HighLevel INSTALL, UNINSTALL, retry, and code-only callback evidence without weakening immutable company/tenant ownership. Do not change production state, provider activation, OAuth enablement, EVERY8D transport, SMS, or LINE behavior.

## Current hypothesis

The existing D1 atomic provisioning RPC and generation compare-and-swap design already own installation identity and retry convergence. D3 only needs to validate the observed signed contract, wire eligible INSTALL events to that RPC, and make UNINSTALL recover immutable company ownership from the exact stored row.

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
| Retry deliveries preserve their event `webhookId`; separate lifecycle events use different values. | Supplied controlled D3 observations | `webhookId` is event metadata, not installation identity; no new schema is needed. |
| Direct Marketplace callback carried code but no state. | Supplied controlled D3 observation | Existing fail-closed callback validation must remain unchanged. |

## Commands executed and results

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git fetch origin` | Refresh authoritative main | Passed | Branch created from `c5d7e043137423b6f3de17e17ef75ebbbc2c0860`. |
| `npm run typecheck` | Type safety | Passed after one compile-only narrowing correction | No runtime contract correction loop was needed. |
| Focused Node test run | Lifecycle/repository/callback behavior | Passed, 40 tests before one final retry assertion | Exact observed shapes and retry behavior covered; the final full run includes the added assertion. |
| `npm test` | Full repository regression suite | Passed, 531 tests | 531 passed; 0 failed, skipped, cancelled, or todo. |
| Local PostgreSQL 17 probe | Find disposable database runner | Unavailable | Client is installed, but no local server or Docker runtime exists; hosted CI owns the real PostgreSQL 17 run. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Reuse the D1 atomic RPC and row generation | Accepted | No event-dedup table is needed for safe lifecycle convergence. |
| Resolve UNINSTALL company from exact stored ownership | Accepted | Payload company/install type can remain absent without cross-tenant inference. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Store `webhookId` as installation identity | INSTALL and UNINSTALL have different IDs; retries only establish delivery/event identity. |
| Add a convenience event-dedup migration | Existing row uniqueness, atomic provisioning, and generation compare-and-swap already satisfy the required behavior. |
| Accept code-only OAuth callback | Would weaken CSRF/browser binding and permit exchange without valid state. |
| Select or activate the Conversation Provider | Installation success is not provider activation and this task forbids the change. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `src/routes/every8dGhlMarketplaceWebhook.ts` | Parse observed version and event ID; export parser seam. | Keeps signature verification first and accepts observed field presence. |
| `src/services/every8dGhlMarketplaceLifecycleService.ts` | Event-specific validation; exact version policy; INSTALL provisioning; stored-owner UNINSTALL input. | Enables only exact signed Location lifecycle transitions when runtime configuration is deliberately enabled. |
| `src/services/every8dGhlOAuthRepository.ts` | Exact non-NULL stored-company UNINSTALL lookup and stored-company compare-and-swap. | Removes reliance on absent UNINSTALL company evidence. |
| `test/every8dGhlMarketplaceWebhook.test.cjs` | Exact D3 fixtures and lifecycle retry/isolation tests. | Test-only. |
| `test/every8dGhlOAuthRepository.test.cjs` | Stored-company, ambiguity, client/provider/location isolation tests. | Test-only. |
| `test/every8dGhlOAuthRoute.test.cjs` | Code-only callback rejection test. | Test-only. |
| `docs/phase-2g-d-company-ownership.md` | D3 evidence and contract documentation. | Documentation only. |
| `docs/agent-run-phase-2g-d-d3.md` | This evidence log. | Documentation only. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | Final run. |
| `npm test` | Passed | 531 passed; 0 failed, skipped, cancelled, or todo. |
| `npm run build` | Passed | Final run. |
| `git diff --check` | Passed | Only expected LF-to-CRLF working-copy notices. |
| PostgreSQL 17 ownership/concurrency suite | Pending hosted CI | Local Docker/server unavailable; no production database was contacted. |

## Budget and stop-rule status

- Active coding tasks: one.
- Implementation correction loops used: one compile-time type narrowing correction.
- Reviewer correction loops used: zero.
- Repeated errors or failed approaches: none.
- Stop rule triggered: no.

## Unresolved decisions

None in D3 scope. A separate controlled OAuth-initiation design must resolve the observed missing-state Marketplace path before OAuth can be enabled.

## Recommended next action

Complete final local validation, open a Draft PR, wait for hosted CI including PostgreSQL 17, and stop for re-audit without merge or deployment.
