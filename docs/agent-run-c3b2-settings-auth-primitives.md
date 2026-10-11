# C3b-2 settings authentication primitives implementation run log

## Task identification

- GitHub task: EVERY8D C3b-2 settings auth TypeScript primitives implementation
- Approved branch: `codex/c3b2-settings-auth-primitives`
- Worktree: `C:\Users\User\.codex\worktrees\da30\win-crm.ai-lineconnect-pilot00`
- Authoritative base: `6f3d369bda14f25d9239d717d38d6e282f5d0172`
- Authority level: Level 3, limited to pure C3b-2 TypeScript primitives, tests, and this run log
- Started at: 2026-10-11 (Asia/Kuala_Lumpur)
- Last updated at: 2026-10-12 (Asia/Kuala_Lumpur)

## Task objective

Implement the frozen C3b-2 configuration, email normalization, request
capability, email-pseudonym HMAC, OTP, UUID, OTP-HMAC, key-rotation, and
provider-independent email-delivery contracts. Keep the feature disabled and
add no route, database write, session, provider, email, EVERY8D, SMS, LINE,
Railway, or production behavior.

## Current hypothesis

The smallest safe implementation is four isolated concerns: strict configuration
parsing, a shared key-version validator, pure cryptographic/normalization
primitives, and provider-independent delivery types. The modules are not
imported by the live application, and focused CJS tests exercise all frozen
public vectors and negative boundaries.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `AGENTS.md` | Repository governance | Requires small, tested, secret-safe changes and preserves existing routes and channel behavior. |
| `docs/every8d-c3b2-settings-auth-primitives-contract.md` | Authoritative implementation contract | Freezes exact environment names, parsing rules, byte framing, vectors, and non-scope. |
| `docs/every8d-c3b1-settings-email-challenge-foundation.md` | C3b-1 boundary | Confirms C3b-2 must remain database-write-free and provider-free. |
| `docs/agent-run-c3b2-settings-auth-contract-amendment.md` | Prior contract evidence | Confirms all public vectors and the four resolved ambiguity areas. |
| `supabase/migrations/202610060001_every8d_settings_email_challenge_foundation.sql` | SQL grammar and taxonomy parity | Defines matching canonical email, key-version, digest-size, purpose, pseudonym, and delivery-failure constraints. |
| `src/config/every8dGhlOAuth.ts` | Configuration convention | Uses dedicated configuration types and generic safe errors. |
| `src/services/every8dGhlTokenEncryption.ts` | Keyring/canonical encoding convention | Demonstrates built-in crypto use and strict decoded-size checks. |
| `src/services/every8dGhlOAuthStateAuth.ts` | HMAC/canonical encoding convention | Demonstrates canonical Base64URL round trips and fail-closed historical key selection. |
| Existing `test/every8dGhl*.test.cjs` files | Test convention and regression boundary | Tests consume compiled CommonJS output through Node's built-in test runner. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| `origin/main` equaled `6f3d369bda14f25d9239d717d38d6e282f5d0172` after a read-only fetch. | Git verification | Work began from the exact authorized base. |
| A JSON object cannot retain duplicate-member evidence after normal `JSON.parse`. | Contract plus parser tests | The implementation scans and decodes each raw member name into a `Set` before constructing the key map. |
| The C3b-1 SQL local-part and DNS-label expressions can be represented exactly with ASCII TypeScript regular expressions after domain lowercasing. | Migration inspection | TypeScript output matches the SQL canonical grammar without provider or Unicode rewrites. |
| Public entropy `00 11 22 33 44` produces `008J4CT4` when bits are read left-to-right and MSB-first. | Focused test | Confirms exact generation order and display `008J-4CT4`. |
| Public pseudonym and OTP HMAC vectors reproduce exactly. | Focused test | Confirms domain separators, NUL placement, UUID order, purpose separation, and no trailing framing bytes. |
| The repository test suite includes localhost HTTP integration tests. | Initial sandboxed `npm test` | The restricted run failed only those tests with `EACCES`; an authorized localhost-capable rerun passed all 669 tests. |
| The C3b-1 PostgreSQL harness requires `POSTGRES_CONTAINER_ID` and a Docker executable. | Harness and local tool inspection | The proof was not run because neither prerequisite was available; no database was accessed. |
| Independent implementation review returned 0 critical, 1 high, 2 medium, and 1 low finding, with three blocking findings. | Independent review result | Remediation was limited to entropy authority, keyring encapsulation, scanner proof, shared grammar, and requested negative tests. |
| Remediation was interrupted by the Codex usage limit with intentional local edits present. | Preserved worktree inspection on 2026-10-12 | Work resumed from the dirty worktree after inspecting status, unstaged diff, cached diff, HEAD, branch, and the unchanged authoritative base; no edit was reset, restored, stashed, or overwritten. |

## Implementation decisions

- The feature flag accepts only absent, empty, exact `false`, and exact `true`
  according to the frozen semantics. It is never enabled by source defaults.
- HMAC environment presence uses own-property checks. Any supplied subset or
  any present empty value fails closed, including while disabled.
- The keyring parser implements the JSON object/string grammar directly and
  uses `JSON.parse` only on one already-delimited JSON string token at a time.
  Decoded member names are checked for duplicates before any map entry is set.
- Every configuration exception exposes exactly
  `EVERY8D settings auth configuration is incomplete or invalid`; optional
  categories contain no input data.
- The official request-capability and OTP generators unconditionally call
  Node's `crypto.randomBytes(32)` and `crypto.randomBytes(5)` respectively and
  accept no entropy argument. The OTP vector uses a separately named pure
  five-byte encoder; capability parsing and hashing use fixed fixtures.
- Validated HMAC keys are owned by an unexported keyring implementation with a
  private `Map`. Only `has`, defensive-copy `get`, and fresh-array `versions`
  operations are exposed; configuration objects are frozen.
- Configuration parsing and explicit runtime key selection use one shared
  key-version validator without changing the frozen grammar.
- Active-key helpers are separate from explicit-version helpers. New work can
  use the active helpers, while later historical verification and alias
  reconstruction can select an exact retained version and fail closed when it
  is absent.
- Historical pseudonym candidates are returned in stable key-version order;
  database locking and alias orchestration remain C3b-3 scope.
- The email-delivery interface contains no implementation or network behavior.

## Commands executed and results

No command or output used production credentials, customer data, or production
systems. All key material was frozen public test data or locally generated test
data.

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git fetch origin` and SHA/status checks | Verify authoritative base | PASS | `origin/main` matched the required SHA; the isolated worktree was clean and detached. |
| `git switch -c codex/c3b2-settings-auth-primitives origin/main` | Create focused branch | PASS | Branch starts at the exact required base. |
| `npm.cmd ci` | Install locked development dependencies | PASS | No dependency or lockfile change was made. Existing audit output reported four dependency advisories; remediation is outside C3b-2 scope. |
| `npm.cmd run typecheck` | TypeScript validation | PASS | Initial implementation compiled without errors. |
| `node --test test/every8dSettingsAuthPrimitives.test.cjs` | Focused primitive validation | PASS | 33/33 after correcting one test-only redaction assertion. |
| Sandboxed `npm.cmd test` | Full regression attempt | ENVIRONMENTAL FAIL | 631 passed; 38 localhost HTTP tests failed with sandbox `EACCES`, not assertions. |
| Authorized localhost-capable `npm.cmd test` | Full regression validation | PASS | 669/669 tests passed. |
| Focused settings-auth and OAuth command | Relevant regression validation | PASS | 93/93 tests passed. |
| PostgreSQL harness prerequisite inspection | Determine whether disposable C3b proof was practical | NOT RUN | Harness requires Docker and `POSTGRES_CONTAINER_ID`; Docker was unavailable. No production or local database was contacted. |
| Preserved worktree/status/diff inspection and read-only `git fetch origin` | Resume remediation without losing partial edits and recheck base | PASS | Dirty remediation edits were preserved; cached diff was empty; branch and old reviewed HEAD were correct; `origin/main` still matched the authoritative base. |
| `node --test test/every8dSettingsAuthPrimitives.test.cjs` | Remediated focused primitive validation | PASS | 45/45 tests passed, including entropy, mutability, scanner, and added security-boundary cases. |
| Authorized localhost-capable `npm.cmd test` | Remediated full regression validation | PASS | 681/681 tests passed. |
| Focused settings-auth and OAuth command | Remediated relevant regression validation | PASS | 105/105 tests passed. |
| `npm.cmd run typecheck` and `npm.cmd run build` | Remediated TypeScript/build validation | PASS | Both completed without errors after the implementation changes. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Parse the narrow JSON keyring grammar with a cursor and decoded-name set. | PASS | Exact and escaped duplicate names fail before map materialization. |
| Use only Node built-in crypto and buffers. | PASS | No production dependency was added; all frozen vectors match. |
| Keep primitives unreferenced by application startup. | PASS | Existing routes and provider flows remain unchanged and the feature remains inactive. |
| Run the full suite in the default sandbox. | Environmental failure | Localhost connections were denied; the same suite passed with localhost access. |
| Resume the interrupted remediation from the preserved dirty worktree. | PASS | The partial edits were reviewed in place and completed without reset, branch switching, or a replacement worktree. |
| Replace mutable keyring exposure with a private-storage abstraction and defensive copies. | PASS | Runtime tests show no `Map` or mutator surface, and mutations of returned buffers cannot alter later pseudonym or OTP HMAC authority. |
| Expand the raw JSON scanner proof with valid punctuation, escaped-equivalent duplicates, malformed tokens, nested values, and prototype-sensitive names. | PASS | Every duplicate or malformed case returns only the exact generic safe configuration error. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Use `JSON.parse(rawKeyring)` as the keyring parser. | It discards duplicate-member evidence before validation. |
| Add a JSON parser dependency. | The frozen narrow grammar is small enough to validate safely without a new production dependency. |
| Trim or case-fold feature-flag or key-version values. | The authoritative contract permits no extra accepted forms. |
| Wire configuration or helpers into routes/startup. | Runtime activation and orchestration belong to later gates. |
| Run the PostgreSQL proof against an inferred server/container. | The required disposable Docker target was unavailable, and production/database access is outside scope. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `src/config/every8dSettingsAuth.ts` | Adds exact flag/HMAC configuration, duplicate-safe strict keyring parser, safe configuration error, and encapsulated defensive-copy keyring authority. | None until a later gate imports it. |
| `src/services/every8dSettingsAuthPrimitives.ts` | Adds pure email, capability, pseudonym, OTP, UUID, and HMAC primitives plus rotation helpers; official generators use direct Node CSPRNG calls with no injection surface. | None until a later gate imports it. |
| `src/types/every8dSettingsAuthEmailDelivery.ts` | Adds provider-independent delivery request/result/interface and frozen failure taxonomy. | Type/module only; no provider or call. |
| `src/utils/every8dSettingsAuthKeyVersion.ts` | Provides the single shared frozen key-version grammar validator used by configuration and primitives. | Pure validation only. |
| `test/every8dSettingsAuthPrimitives.test.cjs` | Adds focused positive, negative, boundary, redaction, frozen-vector, scanner-adversarial, entropy-authority, and mutation-resistance tests. | Test only. |
| `docs/agent-run-c3b2-settings-auth-primitives.md` | Records implementation decisions, scope, and evidence. | Documentation only. |

## Vector and contract evidence

| Check | Result |
| --- | --- |
| Email pseudonym `k1` vector | `k1:a84dfc16aa086bfa11b69876adab6d5f7da2cf9c10aca8b6789703b035639ee8` |
| OTP generation vector | `00 11 22 33 44` -> `008J4CT4` -> `008J-4CT4` |
| UUID vector | `00112233-4455-6677-8899-aabbccddeeff` -> `00112233445566778899aabbccddeeff` |
| Login OTP HMAC | `1ae747b37e3bef979980cb106e880da4a3f88e61aa1409c4f50290f70d29ecfe` |
| Enrollment OTP HMAC | `e34767afbcde553162adbb76925dc0f7426422474d8d4b4bd2b557c806240dd6` |
| Purpose separation | PASS; frozen login and enrollment digests differ. |
| Challenge separation | PASS; changing the UUID changes the digest. |
| Missing selected version | PASS; throws before derivation. |
| Request capability | 32 bytes -> 43 canonical Base64URL characters -> 32-byte SHA-256 digest. |
| SQL email grammar parity | PASS for canonical, transform, rejection, and length-boundary cases. |
| Duplicate JSON member rejection | PASS for exact and escape-equivalent duplicate member names. |
| Secret reflection | PASS; malformed encoded key and raw keyring text are absent from the exact generic error. |
| Entropy authority | PASS; public generators are zero-argument APIs and use direct 32-byte/5-byte Node CSPRNG calls. |
| Key authority mutation resistance | PASS; returned buffers are copies and cannot change later lookup, pseudonym HMAC, or OTP HMAC output. |
| Scanner adversarial matrix | PASS for whitespace, escaped punctuation, `__proto__`, exact/escaped duplicates, malformed escapes/strings/tokens, trailing JSON, and invalid value/root types. |
| Additional security boundaries | PASS for own-property `undefined`, `+`/`/` Base64 rejection, noncanonical pseudonym email, invalid OTP purpose, DEL email rejection, minimum address, and capability pad bits. |

## Explicit non-scope confirmation

- SQL migration modified: no
- Rollback SQL modified: no
- Database write or production database access: no
- Express route, cookie, CSRF, session, administrator, or grant creation: no
- Email provider, network call, SMTP, Gmail, LC Email, or outbox: no
- EVERY8D provider call or SMS behavior change: no
- LINE behavior change: no
- Railway or production environment change: no
- `EVERY8D_SETTINGS_AUTH_CHALLENGES_ENABLED` enabled: no
- `GHL_SMS_PHASE_2F_ENABLED` changed: no
- C3b-3 work started: no

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | PASS | Final rerun is recorded before commit. |
| Focused C3b-2 suite | PASS | 45/45. |
| Relevant C3b-2/OAuth suites | PASS | 105/105. |
| `npm test` | PASS | 681/681 with localhost access. |
| `npm run build` | PASS | Final rerun is recorded before commit. |
| C3b PostgreSQL proof | Not run | Docker/container prerequisite unavailable; no SQL changed. |
| `git diff --check` | PASS | Final staged check is recorded before commit. |

## Budget and stop-rule status

- Active coding tasks: one
- Implementation correction loops used: one test-only assertion correction during initial implementation; no contract correction
- Reviewer correction loops used: one, addressing the independent review's 1 high, 2 medium, and 1 low findings
- Repeated errors or failed approaches: none
- Stop rule triggered: no

## Unresolved decisions

None. The PostgreSQL proof was optional for this pure TypeScript gate and could
not run locally without inventing a database/container target.

## Recommended next action

Request independent C3b-2 implementation re-review of the single focused local
commit. Do not push, open a PR, merge, deploy, activate settings auth, access
production, or begin C3b-3.
