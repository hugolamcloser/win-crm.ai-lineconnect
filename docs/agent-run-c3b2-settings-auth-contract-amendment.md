# C3b-2 settings authentication contract amendment run log

## Task identification

- GitHub task: EVERY8D C3b-2 missing crypto/config contract amendment
- Approved branch: `codex/c3b2-settings-auth-contract-amendment`
- Worktree: `C:\Users\User\.codex\worktrees\cc98\win-crm.ai-lineconnect-pilot00`
- Authoritative base: `3eb0a5067968d210da38331c76631aa246a878ed`
- Authority level: Level 3, limited to design documentation and local public-vector reproduction; no TypeScript, SQL, production, Railway, provider, route, SMS, or LINE changes
- Started at: 2026-10-11 (Asia/Kuala_Lumpur)
- Last updated at: 2026-10-11 (Asia/Kuala_Lumpur)

## Task objective

Freeze the contracts that blocked C3b-2 implementation: HMAC environment names,
key encoding and length, exact OTP HMAC framing, OTP parser behavior, duplicate
JSON-member rejection, deterministic disabled-mode configuration, OTP generation
bit order, and secret-safe configuration errors. Definition of done is one
focused documentation commit over the exact approved base with all supplied
public HMAC and generation vectors independently reproduced.

## Current hypothesis

The amendment is complete when one authoritative C3b-2 contract defines strict,
non-aliased configuration names, duplicate-safe canonical keyrings,
deterministic disabled-mode validation, unambiguous byte framing and generation
ordering, exact OTP parsing, and redacted configuration errors while preserving
every C3b-1 boundary and leaving runtime code untouched.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `AGENTS.md` | Repository governance | Requires a small, documented change, explicit validation, and no production access. |
| `docs/agent-run-log-template.md` | Run-log format | Defines the evidence, command, validation, scope, and next-action sections. |
| `docs/every8d-c3b1-settings-email-challenge-foundation.md` | Existing C3b authority boundary | C3b-1 validates canonical email and stored digest shapes but intentionally does not define TypeScript keyring parsing or HMAC framing. |
| `docs/agent-run-c3b1-settings-email-challenge-foundation.md` | Prior C3b evidence | Confirms the database-only boundary and later-phase exclusions. |
| `docs/agent-run-c3b1-pgcrypto-schema-compatibility.md` | Latest C3b amendment precedent | Confirms the merged pgcrypto remediation and repository run-log conventions. |
| `supabase/migrations/202610060001_every8d_settings_email_challenge_foundation.sql` | Grammar compatibility | Defines the matching key-version grammar, 32-byte OTP HMAC, purposes, canonical email validator, pseudonym shape, and failure taxonomy; it remains unchanged. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| `origin/main` and local detached HEAD both equaled `3eb0a5067968d210da38331c76631aa246a878ed` after a read-only fetch. | Git verification | The amendment started from the exact authorized base. |
| Both public key strings are 43-character canonical unpadded Base64URL and decode to exactly 32 bytes. | Local Node.js calculation | Confirms the frozen key serialization examples satisfy the new keyring contract. |
| The UUID example decodes left-to-right to `00112233445566778899aabbccddeeff`, exactly 16 bytes. | Local Node.js calculation | Confirms RFC/textual/network order without GUID field swapping. |
| The email pseudonym HMAC reproduced `a84dfc16...639ee8`. | Local Node.js `HMAC-SHA256` calculation | Confirms the email domain/NUL/email framing. |
| The login and enrollment OTP HMACs reproduced `1ae747b3...9ecfe` and `e34767af...40dd6`. | Local Node.js `HMAC-SHA256` calculation | Confirms OTP framing and exact purpose separation. |
| Independent review found four blocking contract ambiguities: duplicate JSON names, disabled malformed configuration, OTP generation bit order, and error redaction. | Independent C3b-2 contract review | The amendment was limited to explicit wording and a public generation vector resolving those four findings. |
| Entropy bytes `00 11 22 33 44`, read left-to-right and MSB-first, reproduced canonical OTP `008J4CT4` and display OTP `008J-4CT4`. | Local Node.js bit-group calculation | Confirms the frozen byte-to-symbol generation order. |
| No production secrets, credentials, tokens, customer data, or production systems were used. | Command and diff review | Validation remained local and used only published test vectors. |

## Commands executed and results

No command or output contained production secrets, credentials, tokens, or
customer data. The only key material used was the public test-vector data frozen
by this amendment.

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git fetch origin --prune` | Refresh the authoritative remote reference read-only | PASS | `origin/main` remained the required SHA. |
| Git SHA/status checks | Verify base and cleanliness | PASS | Detached HEAD and `origin/main` matched; worktree was clean. |
| `git switch -c codex/c3b2-settings-auth-contract-amendment origin/main` | Create the focused branch | PASS | Branch started from the exact approved base. |
| Disposable Node.js crypto calculation | Reproduce key decoding, UUID bytes, and HMAC vectors | PASS | Both keys were 43 characters/32 bytes/canonical; all three HMACs matched; purposes differed. |
| Disposable Node.js bit-group calculation | Reproduce the OTP generation vector | PASS | `00 11 22 33 44` produced `008J4CT4` and `008J-4CT4` using left-to-right, MSB-first groups. |
| `git diff --check` | Validate documentation whitespace | PASS | No whitespace errors. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Encode the amendment as one self-contained authoritative C3b-2 contract. | PASS | Later implementation can consume one explicit source without inferring config names or byte framing. |
| Reproduce vectors directly with Node.js built-in crypto and explicit buffer concatenation. | PASS | Results independently match every supplied public vector without production inputs. |
| Resolve only the four independent-review findings without changing existing framing or phase boundaries. | PASS | Duplicate detection, disabled-mode validation, generation order, and redacted errors are now deterministic. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Begin TypeScript implementation alongside the contract. | This gate explicitly authorizes design/documentation only. |
| Add environment entries or generate keys. | The amendment freezes names and encoding only; it must not configure or activate any runtime. |
| Modify the C3b-1 migration or rollback. | Database behavior is already frozen and outside this amendment. |
| Add an existing-document cross-reference. | Two new documents are sufficient; avoiding a third changed path keeps the amendment smaller. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `docs/every8d-c3b2-settings-auth-primitives-contract.md` | Freezes feature-flag semantics, exact HMAC configuration/keyrings, email pseudonym framing, OTP parser/UUID/HMAC framing, rotation, and public vectors. | None; documentation only. |
| `docs/agent-run-c3b2-settings-auth-contract-amendment.md` | Records scope, evidence, validation, and review handoff. | None; documentation only. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| Public email-pseudonym vector | Passed | Exact expected lowercase hexadecimal output reproduced. |
| Public OTP login vector | Passed | Exact expected 32-byte HMAC reproduced. |
| Public OTP enrollment vector | Passed | Exact expected 32-byte HMAC reproduced. |
| Public OTP generation vector | Passed | `00 11 22 33 44` reproduced `008J4CT4` and display form `008J-4CT4`. |
| Purpose separation | Passed | Login and enrollment results differ. |
| Key canonicality and size | Passed | Both are canonical 43-character unpadded Base64URL and decode to 32 bytes. |
| UUID byte order | Passed | Exact 16-byte left-to-right network-order sequence reproduced. |
| `git diff --check` | Passed | No whitespace errors. |
| `npm run typecheck` | Not run | No TypeScript or configuration code changed. |
| `npm test` | Not run | No executable or test code changed. |
| `npm run build` | Not run | No build inputs changed. |
| Production changes | None | No production, Railway, provider, route, database, SMS, email, or LINE access/change occurred. |

## Budget and stop-rule status

- Active coding tasks: zero; this task is documentation-only
- Implementation correction loops used: zero
- Reviewer correction loops used: zero
- Repeated errors or failed approaches: none
- Stop rule triggered: no

## Unresolved decisions

None. The amendment explicitly resolves the original C3b-2 contract gaps and
all four blocking findings from independent review.

## Recommended next action

Request independent re-review of the amended focused local contract commit. Do
not push, open a PR, implement TypeScript, modify SQL, deploy, change Railway,
create production keys, or begin C3b-3 until separately authorized after
re-review.
