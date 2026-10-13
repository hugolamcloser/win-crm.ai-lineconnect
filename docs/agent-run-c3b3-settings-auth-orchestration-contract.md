# C3b-3 settings authentication orchestration contract design run log

## Task identification

- GitHub task: EVERY8D C3b-3 settings auth orchestration contract design
- Approved branch: `codex/c3b3-settings-auth-orchestration-contract`
- Worktree: `C:\Users\User\.codex\worktrees\c3b3-settings-auth-orchestration-contract\win-crm.ai-lineconnect-pilot00`
- Authoritative base: `28f4891863487956a4cdb3b20296b8ed6036f949`
- Initial independently reviewed HEAD: `cbf17e7ea9df679e479fd3a4b7def4c7b5ede366`
- Final re-review examined HEAD: `177213238fcf0658845ed53cadf1c93bf6881767`
- Authority level: design/documentation only; no implementation or production action
- Started at: 2026-10-13 (Asia/Kuala_Lumpur)
- Last updated at: 2026-10-14 (Asia/Kuala_Lumpur)

## Task objective

Freeze the route-free C3b-3 service, repository, primitive-orchestration, and
minimum runtime SQL-wrapper contract before implementation. Resolve stored OTP
key-version authority, delivery/outbox ownership, privilege boundaries,
verification disclosure, and the verified-challenge stopping point without
changing TypeScript, SQL, tests, production configuration, Railway, SMS, or LINE.

## Independent review result

The independent contract review returned
`C3B3_CONTRACT_INDEPENDENT_REVIEW: CHANGES_REQUIRED` with 0 critical, 3 high,
3 medium, 0 low, 0 informational, and 6 blocking findings.

The remediation scope is documentation only and covers:

1. authoritative login administrator/installation revalidation and complete
   verification lock order;
2. an enumeration-safe request result and cross-phase C3c invariant;
3. owner-only request v2 cores behind thin runtime wrappers;
4. exact SQL signatures, migration preflights, runtime locks, and rollback;
5. exact server-side UUIDv4 authority and collision behavior; and
6. accepted orphan PENDING_DELIVERY behavior and expanded proof requirements.

The final independent re-review returned
`C3B3_CONTRACT_FINAL_RE_REVIEW: CHANGES_REQUIRED` with 0 critical, 0 high,
2 medium, 0 low, 0 informational, and 2 blocking findings. Five of the prior six
blocking findings remained closed. This final remediation is limited to:

1. one explicit trusted common owner for all eight functions plus fail-closed
   owner-OID/security/search-path postflight; and
2. one closed two-value repository failure taxonomy plus exhaustive per-method
   repository and service mappings.

### Remediation decisions

| Finding | Contract remediation |
| --- | --- |
| HIGH — login authority/TOCTOU | Adds a four-input owner-only verify core. Login verification uses challenge data only as a locator, deterministically locks candidate installation parents then administrators, relocks the challenge, and revalidates current administrator, generation, lifecycle, registration, and version authority before OTP comparison. |
| HIGH — enumeration safety | Both enabled request methods return only `accepted` plus an optional internal-only command. C3c is bound to one indistinguishable synchronous accepted response regardless of account/admin/grant/preparation state. |
| HIGH — duplicated request authority | Keeps five thin runtime wrappers but moves explicit-UUID request validation, locking, rate limits, resend, and insertion into two new owner-only v2 cores. |
| MEDIUM — signatures/preflight/locks | Freezes all eight named signatures, argument names/order/types/defaults/returns, security/search-path/ACLs, migration preflight, relation locks, runtime row/advisory order, conflict refusal, and rollback order. |
| MEDIUM — UUID authority | Requires server-only Node `crypto.randomUUID()`, canonical lowercase UUIDv4/RFC variant, C3b-2 parser acceptance, and whole-request collision failure without field-only retry. |
| MEDIUM — pending-delivery crash | Explicitly accepts an unverifiable orphan, forbids startup/automatic resend, permits only a new explicit request to supersede it, and retains ordinary expiry/scrub/cleanup behavior. |

### Final re-review remediation decisions

| Finding | Contract remediation |
| --- | --- |
| MEDIUM — runtime-wrapper ownership | Captures `trusted_common_owner_oid` during preflight, requires that owner for all five wrappers and all three cores, and fails the migration unless an eight-OID catalog postflight proves identical owner, exact definer/search-path properties, and distinct ACLs. |
| MEDIUM — closed error/result taxonomy | Permits only `repository_unavailable` and `repository_contract_violation`, discards raw causes, freezes method-specific repository unions, maps expected domain negatives through normal zero-row/null/boolean outcomes, and exhaustively maps every repository result at the service boundary. |

## Current hypothesis

The smallest safe migration surface is eight functions: exactly five
`service_role`-executable thin wrappers and three owner-only security cores for
enrollment request, login request, and verification. PostgreSQL revalidates
current login/grant/install authority and remains the attempt/state-transition
authority. C3b-3 prepares but does not send email. C3c later owns durable
delivery, browser/session behavior, and atomic verified-challenge consumption.
All eight new functions share the captured trusted owner; callable authority
remains limited to five `service_role` wrapper EXECUTEs. Repository failures are
closed to two non-secret categories and never expose raw database objects.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `AGENTS.md` | Repository governance and protected flows | Requires small, tested, secret-safe work and preserves all LINE and deployed routes. |
| `docs/every8d-c3a-settings-auth-foundation.md` | C3a privilege and state boundary | C3a tables/functions are owner-only; grant redemption creates an administrator atomically but is not C3b-3 scope. |
| `docs/every8d-c3b1-settings-email-challenge-foundation.md` | Challenge authority and lock boundary | All C3b-1 functions are owner-only and a later phase must add narrow wrappers. |
| `docs/every8d-c3b2-settings-auth-primitives-contract.md` | Cryptographic and feature-gate authority | Verification must use the stored OTP key version; historical aliases are deterministic; the single flag defaults off. |
| `docs/agent-run-c3b2-settings-auth-primitives.md` | Implemented primitive evidence | Confirms zero-argument CSPRNG generators, strict key selection, stable candidate order, and provider-neutral delivery types. |
| `supabase/migrations/202610020001_every8d_settings_auth_foundation.sql` | C3a SQL, privileges, and lock behavior | Direct tables and all C3a functions deny `service_role`; redemption and session/admin work must stay behind later reviewed wrappers. |
| `supabase/migrations/202610060001_every8d_settings_email_challenge_foundation.sql` | C3b-1 SQL/state machine | Discovery omits OTP key version; request functions generate UUID after requiring UUID-bound HMAC; database owns rate limits, attempts, and fifth lock. |
| `src/config/every8dSettingsAuth.ts` | Configuration API | Only one exact flag exists; keyrings support explicit retained-version lookup and strict safe errors. |
| `src/services/every8dSettingsAuthPrimitives.ts` | Primitive API | Supplies normalization, capability, pseudonym, OTP, UUID decoding, and exact-version HMAC composition. |
| `src/types/every8dSettingsAuthEmailDelivery.ts` | Delivery taxonomy | Defines provider-neutral request/result types and the three exact failure classes, but no provider. |
| `src/services/every8dGhlOAuthRepository.ts` | Narrow repository/RPC precedent | Uses typed methods, strict response schemas, and specific RPC calls; raw database errors need stronger sanitization for auth. |
| `src/services/repository.ts` | Established persistence patterns | Contains direct table and RPC patterns; C3b-3 must use an isolated narrow repository rather than extend a generic surface. |
| Existing service-role migrations | Privilege precedent | Reviewed definer functions are revoked broadly and then granted by exact signature to `service_role`. |
| `docs/agent-run-log-template.md` | Required evidence format | This file follows the project run-log structure. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| Fetched `origin/main` equals the required SHA. | Read-only Git fetch and `git rev-parse origin/main` | Base-drift stop condition did not trigger. |
| C3b-1 request functions accept `otp_hmac` but generate the challenge UUID inside the insert. | C3b-1 migration request functions/table default | A correct C3b-2 UUID-bound HMAC is impossible through those signatures; new request wrappers must accept an explicit random UUID. |
| Discovery returns live metadata but omits `otp_hmac_key_version`. | `discover_every8d_settings_challenge_v1` | A narrow discovery wrapper must add only the stored version; caller-supplied versions and direct table reads are rejected. |
| All C3a/C3b-1 table and function privileges are revoked from `service_role`. | Both foundation migrations | Direct grants cannot be widened; only exact new wrappers receive EXECUTE. |
| C3b-1 request/verify functions already own alias validation, sorted projected advisory locks, rate limits, failure ledger, and state transitions. | C3b-1 migration | TypeScript must compose inputs but never duplicate the database state machine or acquire locks. |
| C3a enrollment grants are bearer capabilities stored as unique 32-byte hashes. | C3a migration | Runtime enrollment request must resolve authority by grant-token hash, not accept browser-selected grant UUID authority. |
| Delivery recording is a one-way pending transition and returns false for no row, expiry, or any terminal/duplicate state. | C3b-1 delivery function | False maps to `not_recorded`; it never causes resend or state inference. |
| The old verifier revalidates challenge/grant state but does not revalidate current login administrator/install authority. | C3b-1 verification function and independent review | A new owner-only verify core must resolve protected metadata internally, lock parents/admins, and revalidate current authority before OTP comparison or failure mutation. |
| The fifth failure trigger locks and scrubs in the insertion transaction. | C3b-1 failure triggers | PostgreSQL alone owns failed-attempt numbering and fifth-attempt locking. |
| There is no outbox/provider implementation in the C3b-2 delivery type. | Delivery type and repository search | C3b-3 must prepare delivery only; C3c owns durable handoff and external send ambiguity. |
| VERIFIED to CONSUMED exists as a protected DB state, but no reviewed runtime atomic consumption/admin/session wrapper exists. | C3a/C3b-1 migrations | C3b-3 stops at a transient internal verified reference; C3c must add the atomic consumption boundary. |
| Challenge rows retain normalized email and pseudonym while live, and administrators bind email/pseudonym to exact installation generation. | C3a/C3b-1 schemas | Login authority can be safely re-resolved without a new durable challenge-to-admin column if candidate parents/admins are deterministically locked and fully revalidated. |
| Existing request and grant paths use parent-before-child ordering; login request takes alias locks before its relations. | C3a/C3b-1 functions | The remediated verify core freezes purpose-specific parent/admin/grant/alias/challenge ordering compatible with resend and lifecycle mutation. |
| Function creation by the migration role would otherwise leave wrapper ownership implicit. | Final independent re-review | All eight exact function OIDs must postflight to the preflight-captured common trusted owner OID; creation defaults are insufficient evidence. |
| Open-ended sanitized-error wording does not constrain future repository implementations. | Final independent re-review | The repository/service contract now permits only two named failure categories, normal domain-negative results, exhaustive mappings, and no raw cause. |

## Commands executed and results

No command or output used production credentials, customer data, production
systems, Railway, email, SMS, or LINE.

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git fetch origin` | Refresh remote refs read-only | PASS | No checkout, rebase, push, or remote mutation. |
| `git rev-parse origin/main` | Verify authoritative base | PASS | Returned `28f4891863487956a4cdb3b20296b8ed6036f949`. |
| Managed worktree creation from exact SHA | Isolate design work | PASS | Created the requested dedicated worktree without touching `da30`. |
| `git switch -c codex/c3b3-settings-auth-orchestration-contract` | Create exact focused branch | PASS | Branch starts at the authoritative SHA. |
| Complete reads of required docs, migrations, configuration, primitives, delivery types, and OAuth repository | Establish contract evidence | PASS | Findings are recorded above and in the contract. |
| Targeted inspection of `src/services/repository.ts` and service-role migration ACL patterns | Compare repository and privilege conventions | PASS | Supports a separate typed auth repository and exact wrapper grants. |
| `npm.cmd ci` | Install the locked local development tree | PASS | Added no dependency or lockfile change; existing audit output reported four advisories outside this documentation gate. |
| `npm.cmd run typecheck` | Required TypeScript validation | PASS | Completed without errors. |
| Sandboxed `npm.cmd test` | Required full regression attempt | ENVIRONMENTAL FAIL | TypeScript could not create ignored `dist/` output in the newly attached worktree (`EPERM`); no assertion ran or failed. |
| Authorized local `npm.cmd test` | Required full regression validation | PASS | 681/681 tests passed; localhost tests used only local test servers. |
| Authorized local `npm.cmd run build` | Required final build validation | PASS | Completed without errors. |
| Remediation `git fetch origin` and coordinate checks | Reconfirm base/reviewed HEAD/branch/cleanliness | PASS | `origin/main` remained the authoritative SHA; reviewed HEAD and branch matched; no rebase occurred. |
| Remediation `npm.cmd run typecheck` | Revalidate documentation-only branch | PASS | Completed without errors. |
| Remediation `npm.cmd test` | Revalidate full regression suite | PASS | 681/681 tests passed. |
| Remediation `npm.cmd run build` | Revalidate repository build | PASS | Completed without errors. |
| Contract/source signature and lock-order audit | Check all review-sensitive authority claims | PASS | Confirmed eight exact new signatures, five runtime grants, three owner cores, v1 parity/deltas, current-authority locks, fixed search paths, and dependency-safe rollback. |
| Remediation `git diff --check` | Check documentation patch whitespace | PASS | No whitespace errors. |
| Final-remediation coordinate check and read-only `git fetch origin` | Verify base, reviewed HEAD, branch, and clean start | PASS | `origin/main` and `HEAD^` equal the required base; HEAD was `177213238fcf0658845ed53cadf1c93bf6881767`. |
| Final-remediation ownership/taxonomy invariant audit | Reject stale/open-ended contract wording and unauthorized paths | PASS | Confirmed the owner OID/postflight, two-category unions, exhaustive mappings, raw-cause discard, and exactly two authorized files. |
| Final-remediation `git diff --check` | Check documentation whitespace | PASS | No whitespace errors. |
| Final-remediation `npm.cmd run typecheck` | Repository-required validation | PASS | Completed without errors. |
| Final-remediation `npm.cmd test` | Full regression validation | PASS | 681/681 tests passed. |
| Final-remediation `npm.cmd run build` | Repository-required build | PASS | Completed without errors. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Reuse existing request functions unchanged | REJECTED | Their generated UUID is unavailable when the caller must derive the UUID-bound OTP HMAC. |
| Put explicit-UUID request state machines directly in runtime wrappers | REJECTED BY REVIEW | It duplicates database authority in `service_role`-callable functions. |
| Add owner-only explicit-UUID enrollment/login cores behind thin wrappers | ACCEPTED FOR REMEDIATION | Keeps exactly five application RPCs while placing validation, locks, rate limits, resend, and insertion in owner-only cores. |
| Return stored key version through narrow live discovery | ACCEPTED FOR CONTRACT | Selects exactly one authoritative retained key without broad reads or caller authority. |
| Delegate runtime verification to a new four-input owner core | ACCEPTED FOR REMEDIATION | Removes caller authority over IDs/email/version and revalidates current login/grant/install authority under locks. |
| Return `accepted` plus an optional internal delivery command | ACCEPTED FOR REMEDIATION | Internal orchestration can deliver when prepared while C3c is required to expose one indistinguishable synchronous accepted response. |
| Inject and call email delivery in C3b-3 | REJECTED | It would establish an unsafe non-durable create/send/result sequence before C3c outbox review. |
| Return a transient verified reference but defer authority consumption | ACCEPTED FOR CONTRACT | Keeps C3b-3 route-free and prevents TypeScript metadata from becoming session/admin authority. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Direct `service_role` table writes or reads | Violates the C3a/C3b-1 privilege boundary and bypasses reviewed state operations. |
| Grant `service_role` EXECUTE on all existing owner functions | Broadens authority beyond runtime need, including maintenance/protection operations. |
| Accept caller-supplied OTP key version | Lets the caller influence key authority and enables unsafe multi-key behavior. |
| Try active and historical OTP keys until one matches | A wrong first key could record a failure and leak rotation behavior. |
| Read challenge table from TypeScript | Requires broad data authority and exposes OTP/state metadata. |
| Pass raw OTP or HMAC key into PostgreSQL | Expands secret exposure and contradicts the C3b-2 application-crypto boundary. |
| Mutate OTP HMAC after challenge creation | Violates immutable challenge identity and creates a partially initialized authority state. |
| Accept enrollment grant UUID as external authority | The C3a grant is a token-hash capability; a UUID alone is not proof of possession. |
| Retry ambiguous request or provider calls automatically | Could supersede a committed challenge or send duplicate OTP email. |
| Treat a TypeScript verified object as durable consumption proof | Cannot recover safely after process failure and bypasses the DB VERIFIED-to-CONSUMED transition. |
| Let the runtime wrapper reproduce request/verify state logic | Security authority belongs in owner-only cores; runtime wrappers must be thin delegates. |
| Return request `prepared` versus `unavailable` | A future route could map the distinction into an account/grant existence oracle. |
| Resume orphan PENDING_DELIVERY rows at startup | The process cannot know whether the pre-crash command was durably handed off; automatic delivery risks duplicate/unauthorized sends. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `docs/every8d-c3b3-settings-auth-orchestration-contract.md` | Freezes C3b-3 ownership, APIs, wrappers, flows, privileges, delivery boundary, and proof plan. | None; documentation only. |
| `docs/agent-run-c3b3-settings-auth-orchestration-contract.md` | Records evidence, decisions, validation, and scope. | None; documentation only. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| Final ownership/taxonomy consistency review | PASS | All eight owner statements, catalog postflight, closed unions, mappings, logging, and proof cases are frozen consistently. |
| Final-remediation `git diff --check` | PASS | No whitespace errors. |
| Final-remediation `npm run typecheck` | PASS | Completed without errors. |
| Final-remediation `npm test` | PASS | 681/681 tests passed. |
| Final-remediation `npm run build` | PASS | Completed without errors. |
| Production DB/provider tests | Not run | Prohibited and unnecessary for this design-only gate. |

## Budget and stop-rule status

- Active coding tasks: one documentation/design task
- Implementation correction loops used: zero
- Reviewer correction loops used: two (initial 3 high/3 medium/6 blocking;
  final 0 high/2 medium/2 blocking)
- Repeated errors or failed approaches: none
- Stop rule triggered: no

## Unresolved decisions

None within the C3b-3 boundary. Raw enrollment-capability transport, durable
outbox implementation, provider behavior, verified-challenge consumption,
administrator/grant composition, and settings-session issuance are explicitly
owned by the later C3c contract and do not authorize implementation here.

## Recommended next action

Perform the final independent re-review of the remediated contract. Do not
implement C3b-3, apply a migration, enable settings auth,
provision keys, deploy, send email/SMS, modify Railway, or change LINE until a
later task is separately authorized.
