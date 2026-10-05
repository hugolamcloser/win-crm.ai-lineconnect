# Agent run: C3a settings authentication foundation

## Run identity and authority

- Date: 2026-10-05 (Asia/Kuala Lumpur)
- Repository: `hugolamcloser/win-crm.ai-lineconnect`
- Frozen base: `45c45056e4f77396be57ecb87e73df526a2180d0`
- Branch: `codex/c3a-every8d-settings-auth-foundation`
- Worktree: `C:\Users\User\.codex\worktrees\37c8\win-crm.ai-lineconnect-pilot00`
- Authority: C3a implementation and local validation only, plus one explicit
  narrow correction to the C3a rollback lock order

No push, pull request, merge, deployment, Railway change, production
migration, Phase 2F change, provider call, SMS, or LINE change was authorized
or performed.

## Implemented scope

- Added the C3a forward migration with exactly the administrator,
  enrollment-grant, and session tables.
- Added the owner-only operator grant RPC and lifecycle invalidation trigger.
- Added the guarded C3a rollback.
- Added the PostgreSQL schema/security/transaction/concurrency proof and shell
  runner.
- Registered the C3a proof in the existing PostgreSQL CI job pattern.
- Added this run record and the focused C3a design/operations document.

There are no production TypeScript, package, environment, Railway, OAuth
runtime, C2 migration, Custom Page, OTP, email, LINE, or SMS changes.

## Final-review defect and authorized remediation

Final security review confirmed that the initial rollback draft acquired C3
child locks and only later caused `DROP TRIGGER ... ON
public.ghl_marketplace_installations` to acquire the parent lock. That violated
the frozen parent-to-child order.

PostgreSQL 17 `REL_17_STABLE` source was checked at
[`RemoveTriggerById`](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/commands/trigger.c):
the relation is opened with `AccessExclusiveLock`. The correction takes that
final parent mode first, followed by administrators, grants, and sessions, all
before the empty-table guard and any destructive DDL. The forward migration and
all frozen C3a data/RPC contracts were unchanged.

## PostgreSQL 17.11 evidence

The disposable database was initialized locally with PostgreSQL 17.11 and no
production connection or data. The expanded C3a harness reported:

```text
C3a empty-table rollback proof passed
rollback-first vs disable proved parent-first rollback serialization
disable-first vs rollback proved rollback waits on parent before child locks
rollback-first vs UNINSTALL proved parent-first rollback serialization
UNINSTALL-first vs rollback proved rollback waits on parent before child locks
rollback-first vs generation advance proved parent-first rollback serialization
generation-first vs rollback proved rollback waits on parent before child locks
C3a rollback/lifecycle parent-first concurrency proofs passed
operator reissue concurrency serialized safely
disable operation-first serialized safely
UNINSTALL operation-first serialized safely
generation operation-first serialized safely
disable lifecycle-first serialized safely
UNINSTALL lifecycle-first serialized safely
generation lifecycle-first serialized safely
C2/C3 lifecycle trigger atomic coexistence proofs passed
EVERY8D C3a settings auth PostgreSQL 17 proofs passed
```

The lock-order cases use advisory barriers only to hold deterministic
observation points. Backend application names, wait events,
`pg_blocking_pids`, and granted/ungranted `pg_locks` prove that rollback never
holds a child relation lock while waiting for the parent. This removes the
rollback/lifecycle wait cycle.

The same proof verifies a zero-row fresh C3a application, all table and RPC
contracts, forced RLS, application-role ACL denial, no C3b table, C1b refresh
non-interference, C2/C3 atomic failure in both directions, empty rollback,
populated rollback refusal before destructive DDL, and preservation of C2,
OAuth/lifecycle, LINE, and SMS objects.

Regression chain results:

- Public OAuth bootstrap/rendezvous: PASS.
- OAuth refresh foundation/CAS/concurrency: PASS.
- C2 EVERY8D provider configuration foundation: PASS.
- C3a settings authentication foundation: PASS.
- Marketplace lifecycle: SQL baseline, chronology, replay, registration,
  watermark, and rollback assertions passed. The legacy shell runner then
  encountered its already-documented Windows Git Bash FIFO/background-observer
  limitation at the named-pipe handoff; no C3a backend or transaction remained.

## Node and static evidence

- `npm run typecheck`: PASS.
- `npm test`: PASS — 636 tests, 636 passed, 0 failed, 0 cancelled, 0 skipped,
  0 todo.
- `npm run build`: PASS.
- `bash -n test/postgres/every8dSettingsAuthFoundation.sh`: PASS.
- `git diff --check`: PASS; Git for Windows emitted LF-to-CRLF conversion
  warnings during staging, but no diff whitespace error.

## Rollback and operational boundary

The rollback refuses when any administrator, enrollment-grant, or session row
exists. It does not delete or truncate data to pass the guard and does not use
`CASCADE`. On an empty C3a schema it removes only C3a-owned objects; the C2
lifecycle trigger and C2 table/function/policy remain, as do C1a/C1b,
Marketplace lifecycle v2, LINE, and SMS objects.

No production migration was applied. C3b/C3c/C3d/C3e, browser/dashboard
behavior, OTP/email delivery, provider runtime, and Phase 2F remain out of
scope.
