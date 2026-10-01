# Agent run log: C2 provider credential foundation

## Security review remediation

- Original C2 commit: `a18220c823058977e2f0f6b3b4135b9bb15d832f`
- Finding: `FOR KEY SHARE` did not conflict with the `FOR NO KEY UPDATE` row
  lock taken by lifecycle status/generation updates.
- Fix: use `FOR SHARE`, the weakest PostgreSQL 17 row lock that conflicts with
  `FOR NO KEY UPDATE`.
- Lock order: parent installation row, then provider configuration row. Future
  C4 mutation RPCs must lock and revalidate the exact parent before touching
  the configuration; the C2 trigger remains a fail-closed backstop.
- Concurrency proof: deterministic two-session coverage in both orderings for
  insert/disable, reconnect/UNINSTALL, and replacement/generation advance,
  with final committed-state assertions.
- Coverage remediation: constraint boundaries, NULL/three-valued-logic cases,
  OAuth registration mismatch, active-parent acceptance, and full anon /
  authenticated / service_role ACL matrices.
- Trigger rename:
  `invalidate_every8d_provider_configuration_after_installation_update` to
  `invalidate_every8d_provider_cfg_after_install_update` (52 bytes).
- PostgreSQL 17.11 remediation result: all six two-session races passed. The
  configuration-first outcomes committed only before lifecycle scrubbed the
  row; the lifecycle-first outcomes rejected the waiting authority mutation.
  Final disabled/uninstalled/stale-generation rows contained no credential
  ciphertext, key version, or enabled SafeSay state.
- Existing PostgreSQL regression result: durable claim, controlled-live,
  Marketplace ownership, public OAuth, and OAuth refresh suites passed. The
  Marketplace lifecycle SQL/order/replay/rollback sections passed; its existing
  FIFO lock observer remains a Windows Git Bash platform limitation. The C2
  suite independently observed the required parent-row lock waits on this host.
- Scope remains C2-only; no runtime TypeScript, environment, Railway, LINE,
  Phase 2F, provider call, or real credential change.

## Task identification

- GitHub task: EVERY8D C2 provider credential foundation implementation
- Approved branch: codex/c2-every8d-provider-credential-foundation
- Authority level: C2 implementation only; local commit authorized, no push/PR/deploy
- Started at: 2026-09-30 Asia/Kuala_Lumpur
- Last updated at: 2026-09-30 Asia/Kuala_Lumpur

## Task objective

Add one forward migration, one guarded rollback, disposable PostgreSQL proofs,
CI execution, and C2 documentation for per-installation EVERY8D provider
credential storage. Preserve all runtime, Railway, Phase 2F, LINE, OAuth, and
production states.

## Current hypothesis

An additive child table plus independent protection and lifecycle invalidation
triggers can enforce the frozen C2 state/generation/revision boundary without
editing the parent lifecycle/OAuth implementation or any TypeScript runtime.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| AGENTS.md | Repository safety/workflow authority | Requires focused schema work and full Node validation |
| .github/workflows/ci.yml | Existing PostgreSQL chain | C2 must run after public OAuth bootstrap and C1a |
| supabase/migrations/202609230001_ghl_marketplace_lifecycle_ordering.sql | Lifecycle identity/order contract | Registered identity and ordered lifecycle are already database-authoritative |
| supabase/migrations/202609230002_every8d_public_oauth_bootstrap.sql | Version/lifecycle v2 contract | Provides registered version and atomic UNINSTALL OAuth scrub |
| supabase/migrations/202609270001_every8d_ghl_oauth_refresh_foundation.sql | C1a protection contract | Parent v5 trigger must remain byte-for-byte unchanged |
| Existing test/postgres shell and SQL files | Disposable proof conventions | PostgreSQL 17 container, owner fixtures, role proofs, guarded rollback pattern |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| Fetched origin/main resolved to 51afdc67d47300cacb21b75b0b572ab57ac97458 | git fetch origin; git rev-parse origin/main | Authority gate passed |
| Managed worktree started detached at the exact base | Worktree creation/status | Created the approved branch locally before edits |
| Current parent trigger is v5 and lifecycle RPC is v2 | Migration inspection | C2 can coexist through a new AFTER trigger; no parent rewrite required |
| CI stages public OAuth then C1a in focused proof scripts | CI and test harness inspection | New C2 proof is ordered after the C1a proof |
| PostgreSQL stores identifiers at a maximum of 63 bytes | PostgreSQL 17 migration execution | The requested lifecycle trigger declaration deterministically stores the 63-byte truncated catalog name; forward and rollback resolve the same object |

## Commands executed and results

No command used production credentials, customer data, provider transport, or a
live external API.

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| git fetch origin | Refresh authoritative remote ref | Passed | Exact SHA verified |
| git rev-parse origin/main | Enforce base gate | 51afdc67d47300cacb21b75b0b572ab57ac97458 | Implementation authorized |
| Managed worktree creation | Isolate from stale checkout | Passed | New worktree at exact base |
| npm run typecheck | Required static validation | Passed | No TypeScript runtime changes |
| npm test | Required regression suite | Passed | 636/636 tests |
| npm run build | Required compilation | Passed | Generated output remains ignored |
| C2 PostgreSQL 17 proof | Schema/security/lifecycle/rollback validation | Passed | Disposable local PostgreSQL 17.11 |
| Existing PostgreSQL chain | Compatibility and concurrency validation | Passed with one host limitation | OAuth/C1a and two existing concurrency proofs passed; lifecycle SQL proof passed |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Additive child table with independent triggers | Implemented and proven | No existing migration or runtime function needs modification |
| Disposable owner fixtures plus application-role ACL checks | Implemented and proven | Proof exercises failure paths without credentials or network |
| PostgreSQL 17 schema-dump comparison | Corrected after first run | PostgreSQL 17 randomizes dump guard tokens; filtering only those tokens gives a stable drift proof |
| Disconnect retention review | Corrected before commit | Disconnect now explicitly rejects simultaneous site URL or timeout mutation |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Composite FK to mutable parent generation | Frozen design explicitly forbids it |
| Runtime resolver, mutation RPC, or provider validation | Reserved for C4/C5 and outside C2 |
| HTTPS regex in SQL | Canonical URL validation belongs to C4 |
| Service-role mutation grant | C2 permits SELECT only |
| Editing existing lifecycle/OAuth triggers | Would expand scope and risk production-proven behavior |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| supabase/migrations/202609300001_every8d_provider_configurations.sql | Add C2 schema/protection/lifecycle invalidation/RLS | Database foundation only; table starts empty |
| supabase/rollback/202609300001_every8d_provider_configurations.sql | Add populated-table rollback guard and C2-only drop order | No effect unless manually invoked |
| test/postgres/every8dProviderConfigurations.sql | Add transactional SQL proofs | Test only |
| test/postgres/every8dProviderConfigurations.sh | Add migration/rollback/schema-drift harness | Test only |
| .github/workflows/ci.yml | Run C2 proof after required chain | CI only |
| docs/every8d-c2-provider-credential-foundation.md | Document C2 design/runtime boundary | Documentation only |
| docs/agent-run-c2-provider-credential-foundation.md | Record implementation evidence | Documentation only |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| npm run typecheck | Passed | TypeScript runtime unchanged |
| npm test | Passed | 636 passed; 0 failed/skipped |
| npm run build | Passed | TypeScript compilation successful |
| C2 PostgreSQL proof | Passed | PostgreSQL 17.11; full schema/ACL/rollback proof plus all six deterministic lifecycle races |
| Public OAuth bootstrap proof | Passed | Existing migration/runtime boundary unchanged |
| OAuth refresh foundation proof | Passed | Existing C1a behavior and concurrency unchanged |
| Durable SMS claim concurrency | Passed | One winner and one durable row |
| Controlled-live authorization concurrency | Passed | Constraints, one winner, and atomic rollback |
| Marketplace lifecycle SQL/order proof | Passed with platform limitation | Stale/replay/rollback passed; existing FIFO observer cannot retain its connection through Git Bash on Windows |
| bash -n test/postgres/every8dProviderConfigurations.sh | Passed | Git for Windows Bash |
| git diff --check | Passed | Complete staged diff |

## Budget and stop-rule status

- Active coding tasks: 1
- Original implementation correction loops used: 2; remediation continuation
  was explicitly authorized after the required stop
- Reviewer correction loops used: 0
- Repeated errors or failed approaches: none; one Windows named-pipe observer
  could not retain/observe the existing two-session lifecycle test connection
- Stop rule triggered: yes during the first remediation session; work resumed
  only through the explicit continuation gate

## Unresolved decisions

None within C2. C3/C4/C5 and runtime/provider activation remain separately
authorized work. The existing Marketplace lifecycle two-connection shell
observer is Linux/Docker-oriented and did not complete through Git Bash against
the local Windows server; its SQL/order/rollback portion passed, and the C2
proof independently covers lifecycle atomicity and scrub rollback.

## Recommended next action

Review the committed C2 diff independently for database/security correctness.
Do not push, open a pull request, deploy, or apply the migration to production
without separate authorization.
