# C3b-1 pgcrypto schema compatibility remediation run log

## Task identification

- GitHub task: C3b-1 production preflight remediation — pgcrypto schema compatibility
- Approved branch: `codex/c3b1-pgcrypto-schema-compatibility`
- Worktree: `C:\Users\User\.codex\worktrees\db56\win-crm.ai-lineconnect-pilot00`
- Authoritative base: `57e0fc8984063619c0490726c85f4aff9e9b11d4`
- Authority level: Level 3, limited to C3b-1 migration dependency verification, disposable proof infrastructure, and documentation; no production access or mutation
- Started at: 2026-10-10 (Asia/Kuala_Lumpur)
- Last updated at: 2026-10-10 (Asia/Kuala_Lumpur)

## Task objective

Remove the production incompatibility caused by `public.digest`, require the
actual Supabase pgcrypto placement and exact digest signature before C3b object
creation, and prove success and all requested fail-closed cases on disposable
PostgreSQL 17 without changing historical migration or rollback ownership.

## Current hypothesis

An extension-catalog precondition followed by a static `extensions.digest` call
closes both the compatibility and search-path risks. Disposable clones can prove
missing extension, wrong schema, and missing overload failures independently.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `supabase/migrations/202610060001_every8d_settings_email_challenge_foundation.sql` | Production blocker | Advisory projection called `public.digest` and had no pgcrypto placement precondition. |
| `supabase/migrations/202607020001_initial_schema.sql` | Historical boundary | Installs pgcrypto without a schema; must remain unchanged. |
| `supabase/rollback/202610060001_every8d_settings_email_challenge_foundation.sql` | Ownership review | Does not own, move, or remove pgcrypto; no change required. |
| `test/postgres/every8dSettingsEmailChallengeFoundation.sh` | Disposable setup and concurrency proof | C3b runs after C3a and can safely mirror Supabase placement before C3b execution. |
| `test/postgres/every8dSettingsEmailChallengeFoundation.sql` | Contract proof | Already checked the signed lock word but not the digest schema or full hash. |
| `.github/workflows/ci.yml` | CI ordering | Runs the C3b harness last; no workflow change is required when setup remains C3b-local. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| Production pgcrypto is version 1.3 in `extensions`, with `extensions.digest(bytea,text)` and no `public.digest(bytea,text)`. | Human-supplied read-only production evidence | Current merged migration is blocked; explicit `extensions.digest` is required. |
| The disposable chain initially installs pgcrypto through the historical migration. | Migration and CI inspection | C3b-local disposable setup must move the extension without editing history. |
| Rollback removes only C3b-owned functions, triggers, and tables. | Rollback inspection | pgcrypto remediation requires no rollback change. |
| The remediated migration blob is `c4a3456907c1948534fdd9198c93365c7da365fc`; SHA-256 is `d22587f45215e6bf2dd17524d49d2a79d7d309001580d8c0c90247948f7cfc14`. | Final local hash calculation | The former frozen blob and SHA-256 are obsolete after this remediation. |

## Commands executed and results

No command or output contained production secrets, credentials, tokens, or
customer data. No production system was accessed.

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| Git base/status verification and `git fetch origin main` | Confirm authoritative base | PASS | `HEAD` and `origin/main` were `57e0fc8984063619c0490726c85f4aff9e9b11d4`; checkout was clean. |
| `git switch -c codex/c3b1-pgcrypto-schema-compatibility origin/main` | Create focused branch | PASS | Branch tracks the verified current main. |
| `npm ci` | Install locked development dependencies in the fresh worktree | PASS | 138 packages installed; no dependency files changed. Audit findings were not auto-fixed because that is outside scope. |
| `npm run typecheck` | TypeScript validation | PASS | Exit 0. |
| `npm test` | Full application regression suite | PASS | Authorized localhost rerun passed 636/636; the first sandboxed attempt had 38 localhost `EACCES` failures and no assertion failures. |
| `npm run build` | Production TypeScript build | PASS | Exit 0. |
| Native WSL/Linux PostgreSQL 17 regression script | Run required database matrix | PASS | WSL2 Linux 6.18, Bash 5.3.9, PostgreSQL 17.11; exact disposable container removed on exit. |
| C3b PostgreSQL proof/harness | Dependency, schema, state, rollback, and concurrency proof | PASS | Correct-schema pass; missing extension, public-schema extension, and missing exact overload all failed closed before C3b object creation; all 24 scenarios passed. |
| `every8dSettingsAuthFoundation.sh` | C3a regression | PASS | Unchanged harness under native WSL/Linux. |
| `every8dProviderConfigurations.sh` | C2 regression | PASS | Unchanged harness under native WSL/Linux. |
| `ghlPublicOAuthBootstrap.sh` | OAuth bootstrap regression | PASS | Unchanged harness. |
| `ghlOAuthRefreshFoundation.sh` | OAuth refresh regression | PASS | Unchanged harness. |
| `ghlMarketplaceOwnership.sh` | Marketplace ownership regression | PASS | Unchanged harness. |
| `ghlMarketplaceLifecycleOrdering.sh` | Marketplace lifecycle regression | PASS | Unchanged harness; observed PostgreSQL backend 956 waiting on row-lock holder 934. |
| `bash -n` for all seven database harnesses | Native Bash syntax | PASS | LF-only disposable copies; no repository transport artifacts retained. |
| `git diff --check` | Whitespace validation | PASS | No errors. |
| Historical migration and rollback diff checks | Confirm scope boundary | PASS | Both are unchanged relative to `origin/main`. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Catalog-check extension identity/schema/signature, then call `extensions.digest` statically. | PASS. | Avoids dynamic SQL and search-path resolution; the PostgreSQL proof verified source qualification and exact vectors. |
| Build independent disposable database clones for each dependency failure. | PASS. | Each negative fixture aborted before C3b object creation without weakening the passing database. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Modify `202607020001_initial_schema.sql`. | It is historical/applied migration history. |
| Install or move pgcrypto in the C3b production migration. | The migration must verify, not mutate, the production dependency. |
| Resolve `digest` through `search_path` or dynamic SQL. | It would reintroduce schema ambiguity and attacker-controlled resolution risk. |
| Modify rollback. | C3b does not own pgcrypto, so rollback has nothing new to reverse. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `supabase/migrations/202610060001_every8d_settings_email_challenge_foundation.sql` | Added fail-closed pgcrypto precondition and explicit `extensions.digest`. | Migration aborts before C3b objects when the dependency contract is absent. |
| `test/postgres/every8dSettingsEmailChallengeFoundation.sh` | Mirrors Supabase placement and adds three isolated negative dependency fixtures. | Disposable proof only. |
| `test/postgres/every8dSettingsEmailChallengeFoundation.sql` | Proves schema, source qualification, hash vector, and lack of public dependency. | Disposable proof only. |
| `docs/every8d-c3b1-settings-email-challenge-foundation.md` | Documents the dependency contract. | Documentation only. |
| `docs/agent-run-c3b1-pgcrypto-schema-compatibility.md` | Records remediation evidence and gates. | Documentation only. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | Exit 0. |
| `npm test` | Passed | 636/636, exit 0 with localhost access. |
| `npm run build` | Passed | Exit 0. |
| C3b PostgreSQL 17 proof | Passed | PostgreSQL 17.11; exact dependency pass/fail matrix, full hash and signed vector, 24 deterministic concurrency scenarios, guarded rollback, and zero-backend cleanup. |
| C3a regression | Passed | Unchanged harness. |
| C2 regression | Passed | Unchanged harness. |
| OAuth bootstrap regression | Passed | Unchanged harness. |
| OAuth refresh regression | Passed | Unchanged harness. |
| Marketplace ownership regression | Passed | Unchanged harness. |
| Marketplace lifecycle regression | Passed | Unchanged harness under native Linux/POSIX with observed row-lock wait. |
| Bash syntax | Passed | All seven database harnesses parsed under Bash 5.3.9. |
| `git diff --check` | Passed | No whitespace errors. |
| Production changes | None | No production access, migration, rollback, provider call, deployment, Railway change, or credential use. |

## Budget and stop-rule status

- Active coding tasks: one
- Implementation correction loops used: zero
- Reviewer correction loops used: zero
- Repeated errors or failed approaches: none; one sandbox-only WSL denial and one sandbox-only localhost denial were resolved by authorized local execution without source changes
- Stop rule triggered: no

## Unresolved decisions

None.

## Recommended next action

Request independent remediation review of the focused local commit. Do not push,
open a PR, deploy, apply the migration, or begin C3b-2/C3b-3 without a separate
instruction.
