# C3c-4b-1 strict worker configuration and provider-registry boundary

## Task identification

- GitHub task: explicit user authorization for C3c-4b-1 only; separate draft PR for independent review.
- Approved branch: `codex/c3c4b1-email-worker-config`.
- Dedicated worktree: `.temp/c3c4b1` inside the chat's original worktree; unrelated worktrees remain untouched.
- Exact base: `3b79e42132355ab355b177cd3322b16fb32e3762`.
- Authority: Level 3; no merge, deployment, production access, credentials or live delivery.
- Started / updated: 2026-11-05, Asia/Kuala_Lumpur.

## Task objective and pre-implementation plan

Implement only provider-neutral configuration parsing and the static registry boundary. The plan was explained before coding: reuse existing auth/HMAC/encryption parsing; validate optional provider and canonical sender even while disabled; evaluate the exact three-flag conjunction; require encryption, sender, provider and exact registry membership only for operational admission. Keep readiness parsing and lazy client construction as separate, uninvoked type contracts. Add focused tests and this log; run all mandatory npm checks and unchanged PG17 proofs.

Assumptions: `operational` describes configuration admission only. It is neither provider readiness nor a running worker. There is no approved production adapter, so the default registry cannot admit operational configuration. Explicit injected registries are for network-free tests only in this slice.

Affected files are exactly the two requested production modules, two new focused test files and this run log. The risks are accepting repaired input, bypassing existing parser rules, or constructing resources before admission. Tests exercise those boundaries. Existing startup and all existing implementation/test files remain unchanged. No dependency or database change is needed.

## Files inspected and authorities

| Source | Finding |
| --- | --- |
| `AGENTS.md`, pilot plan and run-log template | Focused phase, protected flows, mandatory validation; no merge/deploy/production authority. |
| `docs/every8d-c3c-settings-auth-contract.md`, especially sections 16-20 | Independent strict flags, complete three-flag worker gate, canonical sender and lowercase provider identity, no defaults or startup secrets. |
| `docs/every8d-c3c3-email-outbox-contract.md`, especially items 20, 27, 32-33 | Existing encryption parser, repository-owned results and retry/lease authority remain frozen. |
| `docs/agent-run-c3c4a-email-worker-engine.md`, worker, provider contract, renderer and focused tests | Confirmed SENDING, final one-millisecond guard, immutable result snapshots, one send/finalize and crypto-failure recovery remain untouched. |
| Auth config, email primitive, encryption config and existing tests | All three flags already parse independently. Email preserves local-part case, lowercases domains, and trims boundary spaces/tabs; new sender parsing must require equality with the original input. |
| CI and existing PG17 harnesses | Existing jobs already prove worker scenarios, all 107 obligations and prerequisite regressions. No CI edits needed. |

## Evidence discovered

| Evidence | Source | Impact |
| --- | --- | --- |
| Fetched remote main equals exact required base | `git fetch origin main` and `git rev-parse origin/main` | Safe to branch from the frozen base; no rebase or changed authority. |
| PR #119 merged at required SHA | GitHub PR metadata | C3c-4a is the baseline. |
| CI #134, run `41419297213`, push event, exact base SHA, completed/success | [Baseline run](https://github.com/hugolamcloser/win-crm.ai-lineconnect/actions/runs/41419297213) and job metadata | `validate`, `postgres-concurrency`, `postgres-email-outbox` all succeeded before implementation. |

## Implementation and changed files

| File | Change | Runtime impact |
| --- | --- | --- |
| `src/config/every8dSettingsEmailWorker.ts` | Pure strict admission with frozen disabled/operational discriminated results and generic safe errors | Only explicitly called; no startup wiring or IO. Reuses the exact parsed encryption object. |
| `src/services/every8dSettingsEmailProviderRegistry.ts` | Frozen empty production registry, exact own-property lookup, future readiness/parser and lazy client type boundary | No runtime adapter or factory implementation; no readiness parser/client invocation. |
| `test/every8dSettingsEmailWorkerConfig.test.cjs` | Gate, grammar, dormant/missing/malformed config, sender, encryption and dependency-injection proofs | Synthetic local test configuration only. |
| `test/every8dSettingsEmailProviderRegistry.test.cjs` | Empty immutable registry, exact injection lookup and isolated operational-resource traps | No fake production adapter or provider network. |
| This log | Scope, decisions, proof and rollback evidence | Documentation only. |

The provider identity validator adds no regex or character grammar: it checks only string, nonempty, at most 32 characters, and equality with lowercase. It never trims, folds or repairs the returned identifier. Unusual lowercase identifiers are dormant data unless they exactly match an approved static entry. They are never interpreted as URLs, paths, imports or executable code.

Canonical sender validation requires original equality with the unchanged normalization primitive. Existing local-part case, single-label domains, permitted atom characters, 64-character local-part and 254-character total bounds are preserved. Noncanonical domains/whitespace, display names, CR/LF, multiple addresses, quoted alternatives and injection inputs reject.

Disabled admission happens after supplied configuration validation and before any registry access. No repository, worker, timer, polling, claim, recovery, purge, provider readiness/factory/client or send is constructed or invoked. Operational admission also calls no readiness parser or client factory. This slice introduces no lifecycle/admission cancellation or repository-result/timeout abstraction; it cannot fabricate database receipts or free ambiguous-write authority.

## Commands executed and validation summary

| Check | Result / evidence |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS: locked dependencies only; package/lock files unchanged. Sandbox filesystem denial required running dependency setup with normal local permissions. |
| `npm run typecheck` | PASS. |
| New focused tests | PASS: 26/26, all eight Boolean combinations, independent strict flag parsing, dormant validation, exact membership, zero readiness/factory/send calls. |
| `npm test` | PASS: 1,690/1,690, zero failed/skipped/cancelled. Existing HTTP tests needed loopback permission after sandbox EACCES; no test/application correction was needed. |
| `npm run build` | PASS. |
| Unchanged worker/auth/crypto focused tests | PASS: 205/205, including all 68 C3c-4a tests. |
| Worker PG17 proof | PASS: all eight real-repository scenarios. |
| Full unchanged C3c-3 PG17 proof | PASS: 107/107 obligations, zero missing/partial; 213 scenarios, 47 independent-session races, zero unexpected deadlocks/timeouts; all 11 pinned prerequisite DB regressions pass. PostgreSQL 17; no surviving harness backends, proof databases or regression resources. |
| Protected byte equality | PASS: 114 existing protected files, including all 44 tracked SQL files, equal the exact base's checkout-filtered bytes. All 30 migration/rollback files are included. No existing source, authority, proof, startup, CI, package or lock file changed. |
| `git diff --check` | PASS before commit. |

Local detailed test/proof logs, execution certificate, coverage certificate and protected-file SHA-256 inventory are retained under ignored `.temp/c3c4b1-*` artifacts. The unchanged harness regenerates an existing coverage report; its new certificate was retained in `.temp` and the original report restored byte-for-byte before the final protected-file comparison. Generated Python bytecode was removed. Existing PostgreSQL harnesses are unmodified. Windows CRLF shell files are copied with LF endings only into ignored temporary runner files. An initial piped-bash invocation consumed its script through Docker stdin and produced no evidence; it was discarded and replaced with normal file-based execution. Disposable PG17 containers have no external network or published ports and are removed on exit. No production database is involved.

## Approaches, rejected scope and budget

- Active coding tasks: one.
- Implementation correction loops: zero; initial application implementation and focused tests pass.
- Reviewer correction loops: zero; independent review remains the next gate.
- Test-environment adjustments: normal local permissions for locked dependency setup/loopback tests/WSL; LF temporary shell runners. No authority or application change to accommodate the environment.
- Rejected: provider-ID regex, normalized sender acceptance, duplicated encryption parser, default sender/provider, environment-selected code/URLs/credentials, production fake adapters, eager factories and readiness invocation.
- Excluded by authorization: runtime/entrypoint, scheduling, polling, recovery/purge orchestration, signals, watchdog, shutdown/drain, Railway configuration, real provider selection and all production activity.
- No schema decision or scope expansion was required.

## Rollback, limitations and next action

Revert the single focused slice commit to remove these five new files. No database, deployment, environment, credential or production rollback is required. No live provider, live email, production action or manual production smoke test was performed; manual smoke testing is inapplicable to this unconnected boundary. Provider readiness and lifecycle behavior are not implemented or tested as runtime features.

Next gate: `INDEPENDENT_C3C_4B_1_IMPLEMENTATION_REVIEW`. Open the delivery PR as draft and stop for user review. Merge authorization is not granted.
