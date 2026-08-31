# Agent run log — Issue #87

## Task identification

- GitHub task: Issue #87 — Phase 2E SMS runtime readiness
- Approved branch: `codex/issue-87-sms-runtime-readiness`
- Authority level: Level 3 narrow implementation, excluding commit, push, PR creation, deployment, database mutation outside disposable CI, Railway changes, provider credentials/network access, SMS sends, controlled-live activation, or SafeSay testing
- Started at: 2026-08-21
- Last updated at: 2026-08-21

## Task objective

Add an isolated PostgreSQL 17 GitHub Actions job that applies the complete migration chain and empirically proves one-winner SMS operation claims, plus strict Taiwan-mobile normalization for the signed native HighLevel SMS callback. Preserve the existing raw-body signature boundary, durable idempotency state machine, and mock-only EVERY8D path.

## Current hypothesis

The smallest safe implementation is a separate disposable PostgreSQL service-container job and a pure Taiwan-specific normalizer. The signed route can normalize only after Ed25519 verification, and the mock service can compare canonical E.164 identities while passing only national format to the existing provider abstraction.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Existing CI boundary | The existing `validate` job can remain unchanged while a separate PostgreSQL job is added. |
| `supabase/migrations/*.sql` | Disposable migration-chain requirements | Migrations are filename ordered; `anon` and `authenticated` roles must exist before the chain reaches its revokes. |
| `supabase/migrations/202608190001_ghl_sms_outbound_operations.sql` | Claim identity and constraint | The unique identity is `(tenant_id, location_id, ghl_message_id)` and `provider_mode` remains mock-only. |
| `src/routes/ghlSmsProviderWebhook.ts` | Signature and payload-validation order | Exact raw bytes are verified before Zod payload parsing, so post-verification normalization is possible without changing signed bytes. |
| `src/services/ghlSmsProviderOutboundService.ts` | Allowlist and provider wire form | The approved destination was compared as a raw national string and passed directly to the mock-only provider abstraction. |
| `test/ghlSmsProviderOutbound.test.cjs` | Existing route, mock, and idempotency evidence | Existing tests already cover signature rejection, durable duplicates, one attempt, mock transport enforcement, zero fetch, and LINE isolation. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| Target Supabase PostgreSQL major version is 17. | Approved Issue #87 implementation instruction | CI uses exactly `postgres:17-bookworm`. |
| `job.services.<service_id>.id` exposes a service-container ID. | GitHub Actions job-context documentation | Workflow steps can use `docker exec` without exposing a database port or remote connection. |
| The Phase 2D unique constraint is the actual database concurrency boundary. | Phase 2D migration | The proof uses two overlapping plain inserts and requires SQLSTATE `23505` from the loser. |
| The route verifies `req.rawBody` before parsing `req.body`. | Signed SMS route | Normalization does not mutate or precede signature verification. |

## Commands executed and results

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git status --short --branch` and revision checks | Confirm branch/base/clean start | Passed | Branch started clean at the same commit as `origin/main`. |
| `npm run typecheck` | Validate TypeScript changes | Passed | No type errors. |
| `npm test` | Validate full repository behavior | Passed | 397 passed, 0 failed, including new normalization/callback tests and existing LINE coverage. |
| Git for Windows `bash -n test/postgres/ghlSmsOutboundClaimConcurrency.sh` | Validate shell syntax without requiring PostgreSQL | Passed | The real transaction proof remains a CI-only check. |
| `npm run build` | Validate production build | Passed | TypeScript production build completed. |
| `git diff --check` | Validate patch whitespace | Passed | No whitespace errors; only expected Windows line-ending notices. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Dedicated PostgreSQL 17 service-container job | Implemented | Production Supabase and the existing validation job remain isolated from the proof. |
| Observe Claim A sleeping and Claim B waiting on a transaction ID lock | Implemented | The script requires real overlap before accepting the one-winner result. |
| Strict two-form Taiwan normalizer | Implemented | National and unformatted E.164 forms share one canonical identity and one national wire form. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| JavaScript simulation of SQLSTATE `23505` | Does not empirically prove PostgreSQL uniqueness under overlap. |
| Local or production Supabase migration application | Not authorized; CI must be disposable and remote-production-free. |
| Separator stripping or generic international normalization | Would accept ambiguous or out-of-scope inputs. |
| Modifying the Phase 2D migration or repository state machine | Neither is required for the approved Phase 2E scope. |
| Controlled-live configuration or transport changes | Explicitly excluded from Phase 2E. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Adds the isolated PostgreSQL 17 migration/concurrency job. | CI only; existing `validate` job is unchanged. |
| `test/postgres/ghlSmsOutboundClaimConcurrency.sh` | Adds a real overlapping insert proof with exact success, `23505`, and row-count assertions. | CI test only. |
| `src/utils/taiwanPhone.ts` | Adds a pure strict Taiwan-mobile normalizer. | Additive Taiwan SMS utility. |
| `src/routes/ghlSmsProviderWebhook.ts` | Accepts and normalizes the two approved phone forms after signature verification. | Signed SMS route only. |
| `src/services/ghlSmsProviderOutboundService.ts` | Compares canonical allowlist identities and passes only national format to the provider abstraction. | Default-off mock-only SMS path only. |
| `test/taiwanPhoneNormalization.test.cjs` | Adds focused normalizer acceptance/rejection tests. | Test only. |
| `test/ghlSmsProviderOutbound.test.cjs` | Adds post-signature normalization, equivalence, invalid no-activity, national wire-form, and zero-fetch evidence. | Test only. |
| `docs/agent-run-issue-87.md` | Records sanitized Phase 2E implementation evidence. | None. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | No type errors. |
| `npm test` | Passed | 397 passed, 0 failed. |
| `npm run build` | Passed | TypeScript production build completed. |
| `git diff --check` | Passed | No whitespace errors; only expected Windows line-ending notices. |
| PostgreSQL concurrency job | Not run locally | Requires execution by GitHub Actions against its disposable service container. |

## Budget and stop-rule status

- Active coding tasks: one
- Implementation correction loops used: zero
- Reviewer correction loops used: zero
- Repeated errors or failed approaches: none
- Stop rule triggered: no

## Unresolved decisions

- GitHub Actions must execute the new PostgreSQL job to prove that the service container starts, all migrations apply, Claim B is genuinely blocked by unresolved Claim A, exactly one insert succeeds, the loser reports SQLSTATE `23505`, and exactly one durable row remains.
- No migration was applied to local, staging, production, or remote Supabase during this implementation.

## Recommended next action

Review the uncommitted diff for Draft PR readiness, then authorize a Draft PR separately so GitHub Actions can execute the disposable PostgreSQL proof. Do not activate controlled-live SMS or apply the Phase 2D migration to production as part of Phase 2E.
