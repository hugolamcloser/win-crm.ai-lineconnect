# Agent run log — Issue #90

## Task identification

- GitHub task: Issue #90 — Phase 2F-A controlled-live SMS infrastructure and one-time authorization foundation
- Approved branch: `codex/issue-90-phase2fa-controlled-live-foundation`
- Authority level: Level 3 implementation only, excluding commit, push, PR creation, production migrations, Supabase/Railway mutation, network activation, provider credentials, EVERY8D requests, SMS sends, HighLevel provider configuration, and SafeSay testing
- Started at: 2026-09-01
- Last updated at: 2026-09-01

## Task objective

Add forward-only controlled-live schema, durable one-time authorization, atomic authorization-consume/send-start, HMAC-scoped approval, tenant-bound provider plumbing, application tests, disposable PostgreSQL 17 concurrency evidence, and a no-activation runbook. Preserve the existing signed native HighLevel callback, Phase 2C mock route, Phase 2B manual runner, LINE behavior, and all protected systems.

## Current hypothesis

The smallest safe path is a server-selected Phase 2F branch inside the existing native outbound service. It retains the Phase 2C branch unchanged when Phase 2F is disabled, claims a distinct `controlled_live` operation, computes keyed fingerprints, and requires one successful PostgreSQL RPC before runtime credentials or provider construction are reachable.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `supabase/migrations/202608190001_ghl_sms_outbound_operations.sql` | Existing operation state contract | Provider mode was mock-only; failed states required send-start and one attempt. The file remains unchanged. |
| `src/services/ghlSmsProviderOutboundService.ts` | Native outbound architecture | Signature and payload checks occur in the route; the service owns tenant resolution, durable claim, send-start, provider service, and finalization. |
| `src/services/repository.ts` | Persistence conventions | Existing operations use service-role Supabase access and exact compare-and-set filters. |
| `src/integrations/every8dSmsProvider.ts` | Reuse boundary | The existing Phase 2B controlled transport and EVERY8D client/provider can be reused behind a Phase 2F tenant-bound factory. |
| `.github/workflows/ci.yml` | PostgreSQL 17 proof | The existing Phase 2E job applies the full chain and runs a real overlapping claim test. |
| `test/ghlSmsProviderOutbound.test.cjs` | Protected Phase 2C evidence | Existing tests prove signature ordering, mock-only delivery, no fetch, idempotency, LINE isolation, and startup no-send behavior. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| PR #88 merged at `aa94c590eb7b600485b61b1be3b159c047a2c5cc`. | GitHub preflight | The requested base and `origin/main` matched exactly. |
| Issue #87 is closed; Issues #89, #90, and #76 are open. | GitHub preflight | Predecessor and separation conditions passed. |
| GitHub reports Issue #90 parent as Issue #89. | GitHub issue hierarchy | Confirms the Phase 2F-A sub-issue link. |
| Overseas cloud access is acceptable when all fixed outbound IPv4 addresses are whitelisted by EVERY8D. | Sanitized provider support evidence supplied in Issue #90 | Railway static IP assignment and whitelist confirmation remain prerequisites for 2F-B; `NETWORK_CONFIRMED` stays false. |
| Docker/PostgreSQL executables are unavailable locally. | Local tool inspection | SQL concurrency remains an empirical GitHub Actions check; shell syntax is still validated locally. |
| Final security audit found HMAC inputs shared one namespace. | Issue #90 final audit | Added versioned `destination:v1:` and `message:v1:` domain separation with a fixed-vector test. |
| Final security audit found the operation binding was not independently unique. | Issue #90 final audit | Added a named unique constraint and disposable-PostgreSQL proof that one operation cannot retain two consumed authorizations. |
| PostgreSQL functions inherit PUBLIC execute by default. | Issue #90 final audit | Explicitly revoked RPC and transition-function execution from PUBLIC/anon/authenticated, granted only RPC execution to `service_role`, and added ACL/RLS assertions. |

## Commands executed and results

No command or output included secrets, credentials, tokens, customer data, production database access, or provider requests.

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| Git/GitHub preflight queries | Verify base, branch, clean tree, PR/issue states, and hierarchy | Passed | All Issue #90 prerequisites were satisfied. |
| Focused build and Node test commands | Run red/green slices at config, migration, repository, service, and factory seams | Passed after implementation | Synthetic dependencies only; controlled-live tests kept `global.fetch` at zero. |
| Git for Windows `bash -n` on both PostgreSQL scripts | Validate shell syntax | Passed | Real PostgreSQL execution remains CI-only. |
| `npm run typecheck` | Final TypeScript validation | Passed | No type errors. |
| `npm test` | Final full repository validation | Passed | 414 passed, 0 failed. |
| `npm run build` | Final production build | Passed | TypeScript production build completed. |
| `git diff --check` | Final whitespace validation | Passed | No whitespace errors; expected Windows line-ending notices only. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Vertical TDD at public config/fingerprint, repository, service, factory, and PostgreSQL seams | Implemented | Fail-closed behavior is observable without mocking private implementation details. |
| Keep Phase 2B transport reuse inside the existing integration module | Implemented | Protected Phase 2B/2C static guards remain green while Issue #90 reuses the established transport. |
| One versioned security-definer RPC with authorization update followed by exact operation update | Implemented | One armed row grants one permission; a later operation failure aborts the statement and rolls authorization consumption back. |
| Test-only PostgreSQL lock and failure triggers in disposable CI | Implemented | CI can observe a real waiter and force proof that both sides roll back together. |
| Versioned HMAC domain separation and unique operation binding | Implemented during final audit | Destination/message namespaces cannot collide, and durable evidence remains one authorization per operation. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Modify the existing `202608190001` migration | Issue #90 requires forward migrations only. |
| Plain SHA-256 hashes or stored phone/message values | Offline guessing risk and explicit privacy prohibition. |
| Process-local authorization locks | Cannot provide durable one-winner behavior across instances. |
| Mark send-start separately in application code | Would permit authorization consumption and send permission to diverge. |
| Reuse Phase 2B activation flags or expose callback-selected mode/provider | Violates the dedicated Phase 2F authorization boundary. |
| Apply migrations or test against production Supabase | Not authorized and unnecessary for disposable CI proof. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `.env.example` | Documents default-off Phase 2F gates, exact scope, HMAC secret, and runtime-only EVERY8D settings. | None until separately configured. |
| `.github/workflows/ci.yml` | Adds a synthetic `service_role` and the additive controlled-live PostgreSQL proof step. | CI only. |
| `supabase/migrations/202609010001_ghl_sms_controlled_live_mode.sql` | Widens mode and narrowly updates state consistency. | Forward migration only; unapplied. |
| `supabase/migrations/202609010002_ghl_sms_controlled_live_authorizations.sql` | Adds one-time authorization evidence, unique operation binding, transition trigger, RLS, least-privilege grants, and atomic RPC. | Forward migration only; unapplied. |
| `src/config/env.ts` | Adds Phase 2F presence-report keys without loading provider credentials into central config. | Presence reporting only. |
| `src/config/every8dPhase2f.ts` | Adds fail-closed authorization and deferred provider config readers. | Default-off Phase 2F only. |
| `src/utils/hmacFingerprint.ts` | Adds versioned domain-separated keyed HMAC-SHA256 fingerprinting. | Phase 2F only. |
| `src/services/repository.ts` | Adds controlled-live claim, RPC, and pre/post-send finalization operations. | Phase 2F only. |
| `src/services/ghlSmsProviderOutboundService.ts` | Adds the approval-gated controlled-live branch before the unchanged mock branch. | Default-off Phase 2F only. |
| `src/services/smsProviderConfigService.ts` | Carries explicit mock/controlled-live mode in provider configuration. | Additive optional field. |
| `src/integrations/every8dSmsProvider.ts` | Adds the tenant-bound Phase 2F factory around the established transport/provider. | Constructed only after RPC success. |
| `test/ghlSmsControlledLive.test.cjs` | Adds config, HMAC, gate, single-use, factory, outcome, zero-fetch, and isolation tests. | Test only. |
| `test/ghlSmsOutboundPersistence.test.cjs` | Adds forward migration and repository RPC/finalization contract tests. | Test only. |
| `test/postgres/ghlSmsControlledLiveAuthorizationConcurrency.sh` | Adds real PostgreSQL constraint, race, transition, binding, and rollback proof. | Disposable CI only. |
| `docs/phase-2f-controlled-live-runbook.md` | Documents no-activation operation and 2F-B prerequisites. | None. |
| `docs/agent-run-issue-90.md` | Records sanitized implementation evidence. | None. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | No type errors. |
| `npm test` | Passed | 414 passed, 0 failed, including protected Phase 2B, Phase 2C, LINE, and startup coverage. |
| `npm run build` | Passed | TypeScript production build completed. |
| `git diff --check` | Passed | No whitespace errors; expected Windows line-ending notices only. |
| PostgreSQL concurrency job | Pending GitHub CI | Disposable PostgreSQL 17 only; no production connection. |

## Budget and stop-rule status

- Active coding tasks: one
- Implementation correction loops used: two (kept Phase 2B transport reuse behind the existing integration-module static boundary; added final-audit HMAC/ACL/uniqueness hardening)
- Reviewer correction loops used: zero
- Repeated errors or failed approaches: none
- Stop rule triggered: no

## Unresolved decisions

- GitHub Actions must empirically apply the full migration chain and execute both PostgreSQL concurrency proofs.
- Any future migration application, Railway static outbound IP change, EVERY8D whitelist exchange, authorization provisioning/arming, environment activation, or one-message live execution requires separate approval.

## Recommended next action

Review the uncommitted implementation for Draft PR readiness, then—only after approval—commit/push and open a Draft PR so disposable PostgreSQL 17 CI can provide the remaining empirical evidence. Do not activate or send.
