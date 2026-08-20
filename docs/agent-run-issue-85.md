# Agent run log — Issue #85

## Task identification

- GitHub task: Issue #85 — Durable GHL SMS callback idempotency and message correlation foundation
- Approved branch: `codex/issue-85-sms-idempotency-correlation`
- Authority level: Level 3 implementation, excluding commit, push, PR creation, deployment, production schema/data mutation, Railway changes, provider network access, or SMS sends
- Started at: 2026-08-19
- Last updated at: 2026-08-19

## Task objective

Add default-off, mock-only durable idempotency for the signed native HighLevel SMS provider callback. Exactly one database insert claimant may progress, send-start must be persisted before `SmsOutboundService`, every duplicate must perform zero provider activity, and mock EVERY8D correlation must be stored without callback content or credentials.

## Current hypothesis

A narrow `ghl_sms_outbound_operations` table is required because existing `message_events`, `webhook_events`, and the LINE provider-delivery state machine have incompatible identity, state, and privacy semantics. The existing plain-insert plus unique-conflict principle remains appropriate.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `supabase/migrations/202607020001_initial_schema.sql` | Existing event persistence | `message_events` and `webhook_events` are LINE/GHL-sync audit structures, not SMS operation state. |
| `src/services/repository.ts` | Existing atomic claim patterns | Plain insert plus PostgreSQL `23505` is already proven for one-winner claims. |
| `src/services/ghlSmsProviderOutboundService.ts` | Phase 2C callback service | Exact tenant resolution and mock-only SMS boundary already exist; persistence was absent. |
| `src/integrations/every8dSmsProvider.ts` | Provider failure and correlation contract | Returns safe BATCHID/BID correlation and normalized failure codes without retry. |
| `test/ghlSmsProviderOutbound.test.cjs` | Existing signed-route and isolation evidence | Signature/payload gates already prevent invalid requests from reaching the service. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| No local Supabase/Postgres test harness, compose file, or database test script is present. | Repository file/script search | No database was contacted; actual PostgreSQL concurrent execution remains a manual pre-activation validation. |
| EVERY8D timeout, network, HTTP, malformed, and unknown outcomes cannot safely prove non-acceptance. | Existing provider types and focused tests | These outcomes finalize as `ambiguous`; only explicit provider rejection is definitive. |
| BATCHID/BID is returned only after provider acceptance. | Existing provider adapter | A crash before finalization remains non-resendable but may lack durable provider correlation. |

## Commands executed and results

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `npm run typecheck` | Validate TypeScript changes | Passed | No type errors. |
| Focused build and SMS tests | Validate repository/service implementation | Passed | 24 passed, 0 failed. |
| `npm test` | First full-suite validation | One new test expectation failed | Existing transport correctly normalized a generic exception to `network_failure`; the test was corrected to exercise unknown outcome at the service-result boundary. |
| Focused repository test | Validate migration and persistence boundary | Passed | 6 passed, 0 failed; normalized status validation occurs before database access. |
| `npm test` | Final full-suite validation | Passed | 394 passed, 0 failed. |
| `npm run build` | Final production build | Passed | TypeScript production build completed. |
| `git diff --check` | Validate patch whitespace | Passed | No whitespace errors; only expected Windows line-ending notices. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Narrow table plus plain insert/`23505` claim | Implemented | Claim winner is explicit and duplicate cannot authorize sending. |
| Exact send-start and finalization compare-and-set updates | Implemented | Stuck processing and terminal records cannot regain callback send permission. |
| Conservative provider classification | Implemented | Explicit rejection is definitive; all uncertain acceptance outcomes are ambiguous. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Reuse `message_events` or `webhook_events` | LINE/GHL-sync semantics, insufficient states, raw-payload risk, and missing provider correlation. |
| Read before insert | Not concurrency safe. |
| Stale processing reclamation or automatic retry | Could duplicate an already accepted SMS. |
| Production or remote Supabase validation | Not authorized and not required for repository-only migration creation. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `supabase/migrations/202608190001_ghl_sms_outbound_operations.sql` | Adds isolated mock-only SMS operation state and correlation schema. | Migration file only; not applied. |
| `src/services/repository.ts` | Adds atomic claim, send-start CAS, and terminal finalization CAS. | Additive SMS-specific persistence functions. |
| `src/services/ghlSmsProviderOutboundService.ts` | Integrates claim, duplicate no-op, send-start, conservative finalization, and correlation. | Only the default-off signed SMS callback path changes. |
| `test/ghlSmsOutboundPersistence.test.cjs` | Adds migration and repository atomicity/privacy tests. | Test only. |
| `test/ghlSmsProviderOutbound.test.cjs` | Adds concurrency, restart, crash, state, correlation, and privacy proofs. | Test only. |
| `docs/agent-run-issue-85.md` | Records sanitized implementation evidence. | None. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | No type errors. |
| `npm test` | Passed | 394 passed, 0 failed. |
| `npm run build` | Passed | TypeScript production build completed. |
| `git diff --check` | Passed | No whitespace errors; only expected Windows line-ending notices. |

## Budget and stop-rule status

- Active coding tasks: one
- Implementation correction loops used: two
- Reviewer correction loops used: zero
- Repeated errors or failed approaches: none
- Stop rule triggered: no

## Unresolved decisions

- Before live activation, run a disposable PostgreSQL/Supabase proof that two simultaneous identical inserts produce exactly one winner.
- Issue #76 remains responsible for real EVERY8D idempotency and crash-window provider-correlation evidence.
- The migration has not been applied to any Supabase environment.

## Recommended next action

Review the uncommitted diff for Draft PR readiness. Do not apply the migration or activate live SMS.
