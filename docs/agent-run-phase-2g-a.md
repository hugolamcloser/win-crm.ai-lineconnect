# Agent run — Phase 2G-A

## Task identification

- GitHub task: [#95](https://github.com/hugolamcloser/win-crm.ai-lineconnect/issues/95).
- Approved branch: `codex/issue-95-phase-2g-a-marketplace-ownership-schema`.
- Authority: explicit user approval to implement schema/tests/docs, commit, push, and open a Draft PR; no merge, production action, activation, provider request, or send.
- Started / updated: 2026-09-21.
- Verified planning/implementation base: `a612da23dc4b4dce3af7a9b049fccb07df0e9ad7` (`origin/main`). Working tree clean before branch creation.

## Task objective

Implement Issue #95's two-table ownership foundation, guarded rollback, PostgreSQL proof, CI wiring, and architecture/attribution documentation. Preserve all runtime behavior and production state. Completion requires local validation and a reviewable Draft PR.

## Current hypothesis

The existing repository/service/project can host a separate EVERY8D Marketplace identity safely when persistence binds explicit app/client/tenant/location/provider ownership and never reuses the LINE token store. Schema alone cannot establish message-level HighLevel provider attribution or complete OAuth security.

## Files inspected

| Source | Finding / purpose |
| --- | --- |
| `AGENTS.md`, `docs/taiwan-sms-pilot-plan.md`, related Phase 2F docs | Scope, protected runtime flows, separate phase governance, no-production boundary. |
| Issue #95 | Approved schema, attribution limitation, tests and rollback acceptance criteria. Latest user approval supersedes its original governance-only stop. |
| `supabase/migrations/*.sql` | Legacy tokens unique by location; tenants need one additive composite unique constraint; SMS operations/authorization definitions preserved. |
| `src/services/repository.ts`, `src/routes/oauth.ts`, SMS provider services | Existing LINE ownership/helpers must not become EVERY8D persistence. No source edits. |
| `package.json`, `.github/workflows/ci.yml`, existing PostgreSQL runners | Existing npm checks and PostgreSQL 17 concurrency harness reused. |
| `docs/agent-run-log-template.md` | Evidence format. |

## Evidence discovered

| Evidence | Impact |
| --- | --- |
| Legacy location-scoped token helpers | New EVERY8D installation store is separate; synthetic credential updates leave LINE bytes unchanged. |
| Current official HighLevel v3 docs | Provider callback lacks app/provider identity; GET response ownership fields optional and GET scope mapping unresolved. Future dispatch remains blocked. References and decision in `phase-2g-marketplace-ownership.md`. |
| Installed PostgreSQL tools lack server data files | Used a separate portable PostgreSQL 17.11 distribution and disposable cluster; no installed service or production connection touched. |

## Commands executed and results

| Command / action | Result |
| --- | --- |
| `git fetch origin main`, status and SHA checks | Clean base verified, approved branch created from latest verified origin/main. |
| First SQL proof before migration | Expected failure: new installation relation absent. |
| Migration and coexistence proof | First insert exposed PostgreSQL regex repetition limit; bounded client-ID length now uses a separate length check. Proof then passed. |
| Full new SQL assertions | Passed ownership, credential pair, state context/terminal lifecycle, expiry, roles/RLS, preserved tenant/token/armed-fixture data. |
| Review regression: reactivation | New proof reproduced old-state revival if reactivation retained its generation. Added mandatory generation increment on reactivation and reran the ownership proof. |
| Existing PostgreSQL SMS claim runner | Passed: one winner, one uniqueness rejection, one durable row. |
| Existing controlled-live authorization runner | Passed constraints, evidence immutability, race winner, atomic rollback, using synthetic authorization fixtures only. |
| New Marketplace runner | Passed SQL assertions, state/reinstall races, empty rollback, populated rollback refusal, dependency rollback, late migration failure, protected-data fingerprints. |
| `npm run typecheck` | Passed. |
| `npm test` | Passed: 416 tests, 0 failures, 0 skipped. Provider calls mocked by existing tests. |
| `npm run build` | Passed. |
| `git diff --check`, `git diff --cached --check` | Passed; staged scope contains exactly the seven approved files. |

## Approaches attempted

| Approach | Outcome |
| --- | --- |
| Test-first coexistence tracer | Demonstrated expected missing-table failure, then real PostgreSQL success. Added adversarial behavior/role/rollback/concurrency proofs. |
| Installed PostgreSQL initialization | Missing `share/postgres.bki`; switched to official PostgreSQL-linked EDB portable binaries in a unique temporary directory. |
| Local execution of unchanged Docker-oriented scripts | Docker unavailable. Temporary shell transport adapter maps only `docker exec ... psql` to the disposable loopback PostgreSQL 17.11 instance. Real transactions/connections and all original assertions run; no SQL simulation. Git Bash required its own `/usr/bin` in temporary PATH. |

Local database: `wincrm_test`, loopback port 55495, synthetic roles `anon`, `authenticated`, and non-BYPASSRLS `service_role`. No production credentials, records, or connections. Local Node.js 24.14.0 satisfies `>=22`; CI pins Node.js 22 and PostgreSQL 17 in Docker. Hosted CI results are separate from local proof results.

## Rejected approaches and reasons

- Reusing LINE tokens/provider configuration: violates explicit ownership boundary.
- Dispatch based only on signed location/URL: insufficient provider attribution.
- Production tests/migrations or real provider calls: expressly unauthorized.
- Destructive rollback/CASCADE: ownership and authorization evidence must be preserved.
- New runtime modules or dependencies: unnecessary for schema-only scope.

## Files changed

| File | Change / runtime impact |
| --- | --- |
| `supabase/migrations/202609170001_ghl_marketplace_ownership.sql` | Additive tables/constraints/triggers/RLS; no seeds or runtime integration. |
| `supabase/rollback/202609170001_ghl_marketplace_ownership.sql` | Transactional empty-only rollback, not auto-discovered. |
| `test/postgres/ghlMarketplaceOwnership.sql` | Synthetic real-database assertions. |
| `test/postgres/ghlMarketplaceOwnership.sh` | Disposable proof orchestration and concurrent connections. |
| `.github/workflows/ci.yml` | One new proof step after existing concurrency tests. |
| `docs/phase-2g-marketplace-ownership.md` | Schema/security/rollback decisions and unresolved attribution gate. |
| `docs/agent-run-phase-2g-a.md` | This evidence record. |

## Validation summary

Local npm checks: all pass, 416 tests. All three PostgreSQL proof runners pass against real PostgreSQL 17.11; the new runner passed again after the reactivation guard. Diff review confirms exactly seven approved files, no runtime or route changes, no production activation, no real credentials, no broad/browser grants, no LINE token/provider writes, and no destructive populated-schema rollback. Hosted CI status is separate and reported with the Draft PR.

Not tested: production Supabase/Railway/HighLevel, OAuth exchange/refresh, actual encryption, live provider attribution, EVERY8D network behavior or handset delivery. These are intentionally outside this phase.

## Budget and stop-rule status

- Active coding tasks: one.
- Implementation correction loops used: one (PostgreSQL regex bound).
- Reviewer correction loops used: one (reactivation generation guard and shell failure propagation).
- Environment setup failures: missing installed PostgreSQL server data; local Git Bash PATH fixed with a temporary adapter. Neither required production access.
- Stop rule: stop for review after Draft PR; no merge, production migration, or activation.

## Unresolved decisions

HighLevel/API contract owner must establish GET-message scope and provider-field availability before dispatch work. Hugo must separately approve production schema application and later OAuth/provider phases. No UI, environment-variable, or database action is required from Hugo for this schema PR review.

## Recommended next action

Review the Draft PR and database evidence. Keep production unchanged. No SMS was sent and the currently armed production authorization was not accessed, altered, or consumed.
