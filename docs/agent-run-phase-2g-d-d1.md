# Agent run — Phase 2G-D Gate D1

## Task and authority

- GitHub issue: [#100](https://github.com/hugolamcloser/win-crm.ai-lineconnect/issues/100).
- Branch: `codex/issue-100-phase-2g-d-company-ownership`.
- Base: refreshed `origin/main` at `9c91ff9021379fa73febd4647c1233e9d169aa14`; the branch was created directly from that ref without updating the user's stale local main first.
- Authority: additive immutable company ownership, minimum lifecycle/provisioning foundation, tests, documentation, commit/push, and one Draft PR.
- Not authorized: production migration/configuration, HighLevel changes, app installation, OAuth, provider/Delivery URL activation, EVERY8D access, SMS operation/authorization access, or SMS.

## Implemented boundary

- Nullable staged `company_id`; no inferred/backfilled ownership.
- Immutable non-NULL company binding and least-privilege service-role columns.
- One server-only PostgreSQL atomic provisioning primitive with duplicate/concurrency and reinstall semantics.
- Repository adapter for the primitive; lifecycle INSTALL remains blocked pending D3 signed-payload proof.
- Exact company-bound UNINSTALL lookup.
- NULL-company OAuth ineligibility and exact token-response company equality.
- Exact company predicate on credential persistence.
- AES-256-GCM AAD includes company; envelope version 2 rejects the pre-company format.
- Runtime callback remains `/oauth/every8d-connect/callback`; D2 must correct the stale Marketplace redirect without an alias.

## TDD seams and evidence

The approved seams were token encryption, OAuth runtime/repository, lifecycle service/router, and real PostgreSQL migration/provisioning behavior. Each new behavior began red:

- wrong-company AAD initially decrypted;
- token company was not persisted or compared;
- the repository lacked the atomic provisioning adapter;
- lifecycle UNINSTALL did not require company;
- envelope format still reported version 1; and
- the disposable database lacked `company_id` and the provisioning function.

Each slice was implemented minimally and rerun green before continuing. External network activity remained mocked; the database proof used only the disposable local PostgreSQL 17 `wincrm_test` database on loopback with synthetic fixtures.

## Validation record

Final results before the Draft PR was opened:

- `npm run typecheck`: passed.
- `npm test`: passed, 504 tests, 0 failed, 0 skipped.
- `npm run build`: passed.
- `git diff --check`: passed; only Windows line-ending notices were emitted.
- PostgreSQL 17 ownership/concurrency/rollback runner: passed. It proved staged NULL compatibility, exact company binding, immutable ownership, service-role/browser restrictions, two-connection provisioning convergence, duplicate idempotency, multi-location company ownership, company mismatch refusal, uninstall/reinstall generation safety, stale-state rejection, D1 rollback refusal/preservation, D1 empty-evidence rollback, Phase 2G-A rollback coexistence, transactional failure, and protected LINE/SMS fingerprints.

## Production and external-state statement

No production database connection or migration, Railway change, HighLevel setting change, Marketplace install, OAuth exchange, provider activation, Delivery URL, EVERY8D request, SMS operation/authorization access, or SMS send occurred.
