# Current status: local implementation and 107-obligation proof closure PASS; independent review required

This snapshot records the authorized local guard correction and final local delivery gates. The one unmerged PR and its FIRST hosted CI result are reported by GitHub and in the task's delivery response after this snapshot. No merge/deployment/activation/provider sending is authorized.

## Current correction and provenance

Classification: RUNTIME_SQL_AUTHORITY_DEFECT. Before correction, the exact ordinary owner DML counterexample committed SENDING/count 1 -> FAILED_TERMINAL/sender_unavailable_pre_send/resolution_kind pre_send under finalize marker, while the supported RPC refused it. Protections were enabled. Both the original update and a fully scrubbed equivalent now refuse atomically with 23514 and unchanged source authority.

The migration protection function now admits only closed static operation/source/count/provenance families. Finalize requires SENDING provider provenance for accepted/rejected/unknown/retryable/retry exhaustion, or LEASED pre_send sender-unavailable provenance. Begin admits exactly one LEASED->SENDING increment or frozen unusable terminalization. Recovery preserves attempts and prior positive history, admits only frozen requeue/terminal families, and never fabricates adapter outcome or pre-send evidence. Claim/enqueue retain fresh sequence fencing and exact allowed field changes; terminal input must be completely scrubbed; purge eligibility and TRUNCATE refusal remain intact. Parent locks, lifecycle, post-wait clocks, retry precedence and recorder decisions remain in unchanged owner cores.

## Complete fresh execution

| Gate | Actual final result |
| --- | --- |
| Exact frozen Section 36 decomposition | 107 obligations / all 25 areas |
| Executed / PASS / MISSING / PARTIAL | 107 / 107 / 0 / 0 |
| Complete clean C3c-3 PG17 suite | 213 scenarios / 47 independent-session races PASS |
| PostgreSQL | 17.11 (Debian 17.11-1.pgdg12+2) |
| Direct-owner negative cases / supported positive controls | 1,091 / 23 PASS |
| Fresh pre-use apply/postflight/empty/unused/same-epoch/rollback | PASS before behavioral allocation; exact prerequisite restoration |
| Populated / used-but-purged / aborted allocation rollback refusal | PASS; no partial changes |
| Later dependency / routine-body caller / administrative drift refusal | PASS; no partial changes |
| Apply and rollback bounded maintenance lock timeout | Both expected 55P03 at frozen five-second bound; exact snapshots unchanged; clean subsequent maintenance succeeds |
| Same-epoch unused control | Rollback succeeds; exact prerequisite baseline restored |
| Actual restart | Same data directory; stored epoch 2026-10-27 02:40:13.701946+00; actual epoch 2026-10-27 02:58:49.630668+00 |
| Post-restart unused rollback | 55000 server epoch guard mismatch; empty outbox, unused sequence and all objects/ACL/guard/prerequisites unchanged |
| Unexpected deadlocks / lock, statement or actor timeouts | 0 / 0 |
| Surviving proof sessions / databases / containers | 0 / 0 / 0 |
| Existing canonical prerequisite DB regressions | 11/11 PASS in complete final execution |
| Final focused application | 564/564 PASS; no skipped/cancelled/todo |
| Included repository / recovery / crypto / preparation / remaining application | 343 / 23 / 92 / 30 / 76 PASS |
| Final typecheck / build | PASS / PASS |
| Final npm | 1,525/1,525 PASS; no skipped/cancelled/todo |
| Final SQL/TS AAD | 2 SQL vectors, 2 TS vectors, direct byte equality 2/2 PASS; helper transaction rolled back; no fence allocation |

The certificate is generated from every semicolon-separated frozen obligation and requires ALL mapped subcase receipts, the current migration/harness/proof-source hashes, complete-suite verdict and resource cleanup. It does not infer execution from code inspection. Exact timestamp-equality units execute predicates fetched from installed fingerprint-checked SQL with DB-generated T; actual RPC/state proofs and real post-wait crossings accompany them. No runtime clock is replaced. A future linked challenge cannot coexist with a valid 24-hour retained terminal child under the ten-minute challenge lifetime; the exact defensive predicate and nearest legal actual row/operation are tested rather than forging that impossible fixture. Purge's bounded selector cannot wait on a pre-retention candidate it excluded; the nearest legal old-transaction/parent-wait ordering proves fresh time use.

## Integrity and delivery boundary

Exactly four original protected artifacts changed: migration protection body plus its literal fingerprint; that exact fingerprint literal only in rollback, postflight and JSON implementation manifest. The other 56 original protected artifacts are byte-identical. The freshly derived protection fingerprint is 748d827b62aeab8dd2eb867544a2eb84; the other function/relation fingerprints are unchanged. Migration SHA-256 is 13d1243e45ffccf31cb2823875d42a2a782697ac252bd56fb1992cc7db804dc6, 165,510 bytes, Git blob dbbebe41f4ebdafb8e72a8aac675d1b6040353c5. Guarded rollback logic was not changed.

Frozen contract SHA-256 remains C3FF909BC66FB19398694CB16CC1AD07505E68C2603E73E780C67EAA83C0AEBA. TypeScript runtime was not changed by this correction. Original C3c-3 crypto/config/repository/preparation implementation is included and revalidated. The dedicated CI checkout retains the pinned base for exact canonical regression objects; its overall budget covers the expanded suite, without changing individual proof timeouts.

Final staged diff inspection retains three pre-existing trailing-whitespace lines: migration lines 1009 and 1421 (unchanged owner-core definition bytes) and original proof entrypoint line 59. They are deliberately not reformatted because this cycle must preserve those protected artifacts/fingerprints. No new whitespace defect was introduced by the guard correction.

Machine-readable evidence: every8d-c3c3-section36-coverage-final.json, every8d-c3c3-section36-execution-final.json, every8d-c3c3-guard-correction-integrity.json and every8d-c3c3-final-local-validation.json. The complete local process log is C:/Users/User/AppData/Local/Temp/c3c3-complete-final-run.log. Earlier snapshots below and the initial/progress JSON artifacts are historical, not current completion claims.

PRODUCTION_CHANGES: NONE. No production DB, keys, Railway, HTTP/email-dispatch activation, provider send, LINE/SMS/Phase2F change. C3c-4/C3c-5 not started and not authorized. Next gate is independent C3c-3 implementation review after first hosted CI observation.

# Historical progress during the authorized guard correction: authorized direct-owner guard correction and Section-36 closure in progress

Goal: close the confirmed RUNTIME_SQL_AUTHORITY_DEFECT in the existing outbox protection function, preserve the frozen contract and all owner-core authority, and execute all 107 derived obligations before delivery. The isolated branch and pinned main remain at the authorized base. Risk is incorrect static admission or over-rejection of supported transitions; rollback is reverting this focused draft before use, with the exact guarded pre-use SQL retained. No operational migration, production change, sending, activation, later phase, merge or deployment is authorized.

Affected runtime surface is the protection function body in the C3c-3 migration only. Direct consequences are one freshly derived literal function fingerprint in that migration, guarded rollback, postflight and JSON implementation manifest. All other protected artifacts must remain byte-identical. Proof-only changes are the closure harness, dedicated guard SQL, coverage manifest, entrypoint/wiring and evidence.

The exact original owner counterexample succeeded against the saved defective migration: SENDING/count 1 to FAILED_TERMINAL/sender_unavailable_pre_send under finalize operation context. The supported RPC refused it. This is runtime SQL authority failure, not a test expectation or contract ambiguity. The corrected guard uses closed operation/source/count/provenance families and per-family changed-column allowlists. It adds no parent locks or duplicate lifecycle/time/retry decisions. Terminal input must supply complete scrub. The same owner counterexample now fails atomically.

Derived from fresh disposable PG17, the corrected protection fingerprint is 748d827b62aeab8dd2eb867544a2eb84 (formerly bbe137f4f6d5009669cfea8636cc5c7e). The other function and relation fingerprints did not change. Scope audit confirms the only migration change outside the protection body is that one literal; rollback and postflight changes are the same literal only. The original 60-file baseline now intentionally differs in four artifacts: migration, rollback literal, postflight literal and JSON manifest literal; the other 56 remain unchanged. The frozen artifact remains unchanged. Fresh pre-use apply/postflight/empty/unused/guard/rollback/exact restoration runs before every closure slice's separate runtime fixtures.

Expanded static owner matrix currently executed 1,090 negative cases plus the original counterexample, and 23 supported runtime positive controls. Exact current final-tree counts remain subject to the complete clean rerun. Additional closure work includes 18 item-17 receipt families, enqueue identity/supersession/concurrency, real missing/late begin acknowledgement, sender expiry/new generation and repeated crypto-loss closure. No final 107/107 claim, commit, push or PR yet.

Proof-only fixture corrections: count-zero LEASED setup now uses supported enqueue/claim, since the existing retry helper starts with SENDING; provider-result conflict probes use legal input count shapes to test zero-row authority refusal rather than expected 22023 argument rejection. No expected frozen semantics or runtime behavior changed. Equality proofs distinguish executable exact installed-SQL predicate units from actual RPC/post-wait integration; production clocks are never replaced.

Additional proof-only corrections/evidence: a generated test DO block lost one dollar quote during text insertion; named quoting corrected its syntax, with identical expected retention semantics. Retry-wait deadline fixtures age the entire authorized synthetic timeline before narrowing the deadline so prior provider timestamps remain valid. The original 57-scenario matrix and both strengthened purge/finalize winner orders passed on corrected SQL; all 11 canonical unchanged regressions passed. The incremental launcher subsequently encountered a shell-read error because its entrypoint was edited while still executing. This is wiring only, not a DB authority failure; no incremental full-run success is claimed. All disposable resources were removed. The complete final run uses stable source files, captures source hashes, executes all cases and regressions, then requires zero remaining DBs/backends before certificate generation. Individual actor/lock/statement timeouts are unchanged; the dedicated CI job's overall budget accommodates the expanded matrix and real cooldown/expiry waits.

# Historical stop before current authorization: final proof-closure cycle stopped on direct-owner state-machine counterexample

The complete frozen matrix was first extracted into 107 individually auditable semicolon-separated obligations across all 25 areas: 44 previously PASS, 9 MISSING, 54 PARTIAL. New proof-only slices executed 19 unique scenarios / 4 independent-session races: 18 PASS and one actual owner-transition guard counterexample. Supported finalize correctly refused sender-unavailable from SENDING, but ordinary owner DML under finalize context committed SENDING/count 1 -> FAILED_TERMINAL/sender_unavailable_pre_send/resolution_kind pre_send, with all triggers and constraints enabled and no guard bypass. The terminal trigger branch admits SENDING -> FAILED_TERMINAL without constraining this pre-send provenance to LEASED. Frozen section 19 permits sender-unavailable only from current LEASED authority.

Stopped under the human authorization's section S, without runtime correction. Current diagnostic coverage is 57 PASS / 3 MISSING / 47 PARTIAL; no complete closure certificate, new full-suite PASS, commit, push, PR or hosted CI. All original 60 protected artifacts are byte-identical; runtime SQL, TypeScript runtime and frozen contract changes are NO. Prior 66-scenario/25-race and application validations remain preserved, not substituted for final validation. All current disposable containers were removed. The detailed counterexample and executed proof receipts are recorded below and in the new coverage/execution JSON artifacts.

# Historical status before the final Section-36 closure cycle

The three authorized additions executed successfully, with 9 new scenarios and 7 new races. The complete current original-plus-additions harness passed freshly: 66 scenarios / 25 independent-session races, zero unexpected deadlocks/timeouts, zero remaining proof databases/backends, and container removed. Actual postmaster restart refused unused pre-use rollback with exact epoch-mismatch refusal and no catalog/ACL/data/guard/sequence changes; separate same-epoch rollback succeeded. All 60 original protected artifacts remain byte-identical; no runtime or frozen-contract change.

Final focused application 564/564, full npm 1525/1525, typecheck and build passed again. Final legacy DB regressions are recorded in the final snapshot below. The prior coverage audit was incomplete: section 36 also explicitly requires populated/used-but-purged rollback refusals and atomic maintenance lock-timeout cases which are not executable C3c-3 cases in this tree. The narrow current authority permits only the named three additions, so these other cases were not added. This is an uncovered mandatory-proof issue, not a demonstrated runtime/rollback defect. No all-section-36 completion claim, commit, push, PR or hosted CI. Historical snapshots below are superseded where applicable.

# Historical status before authorized three-case PG17 coverage completion

The canonical plaintext correction passed its exact BOM regression and all 92 crypto tests. Original authenticated bytes are now compared with reconstructed canonical UTF8 bytes before immutable plaintext values can be returned. Combined C3c-3 application proof passed 564/564; full npm test passed 1525/1525; typecheck and build passed. Both SQL AAD vectors exactly equal their TypeScript and fixed-vector counterparts. All eleven existing DB regression scripts passed; zero proof databases/backends remained and the disposable container was removed. All 60 protected DB/proof/frozen artifacts are byte-identical; prior 57-scenario / 18-race PG17 PASS is preserved for the current harness only.

Final frozen-matrix reconciliation found a delivery-blocking proof coverage gap, rather than a demonstrated runtime SQL defect. Section 36 separately requires post-restart rollback refusal, enqueue versus cleanup and begin versus recovery; the current harness has no executable cases for these. Its epoch_mismatch test edits the stored timestamp, which does not establish behavior across an actual server restart. The final section-36 reconciliation had explicitly remained pending in prior snapshots. Current authorization forbids any PG harness/authority changes, so none were made to fill this gap. Stop for user review before commit/push/PR/hosted CI. No production or later-phase activity. The cycle details below supersede historical snapshots.

# Historical status before canonical-byte correction: recovery matrix passed; canonical-plaintext crypto defect required review

The authorized closed recovery validator passed its exact reproducer, 21 legal and 15,979 illegal transition combinations, 242 additional invalid mutations, and all 23 recovery tests. The 343-test repository classification suite passed again. Continuing the original crypto proof produced 59/60 PASS and one NEW material defect: authenticated UTF-8 BOM-prefixed plaintext is accepted because TextDecoder removes the prefix before canonical serialization comparison. Under the current authorization's section N, stopped without changing crypto behavior. All 60 protected DB/proof artifacts remain byte-identical; prior PG17 57-scenario/18-race PASS preserved. No production changes, commit, push, PR or hosted CI. Historical snapshots below are superseded by this latest paragraph and the final report where applicable.

# Historical status before the closed recovery-parser correction

The authorized shared-helper correction passed the original reproduction and 342 focused six-parser classification tests. Further semantic proof confirmed a NEW recover-receipt contract defect: previous_state=PENDING with attempt_count=1 is accepted as applied. Frozen sections 16 and 22 require PENDING count zero and recovery never increments. Under the current authorization's section I, stopped without correcting the new defect. DB_AUTHORITY_CHANGED: NO (60 protected artifacts byte-identical); prior fresh PG17 57-scenario/18-race PASS preserved. No production changes, commit, push, PR or hosted CI. The chronological snapshots below are historical where superseded by this paragraph and the final report.

# Historical status before the repository-classification correction

The authorized purge_cleanup proof correction passed, and its complete fresh current PG17 harness rerun passed (57 scenarios / 18 independent-session races). Original TypeScript implementation then continued. Typecheck and build passed, but the first focused application regression failed: a malformed outer RPC result is misclassified as repository_unavailable instead of repository_contract_violation. Under the user's additional-authorization section I, the task stopped without correcting this new defect. No commit/push/PR/hosted CI or production change. The chronological evidence below includes prior stops and is superseded by this latest status where applicable.

# C3c-3 isolated implementation run - stopped incomplete

## Task identification

- Date: 2026-10-26 (Asia/Kuala_Lumpur).
- Approved branch: `codex/c3c3-settings-auth-email-outbox`.
- Worktree: `C:\Users\User\source\repos\win-crm.ai-lineconnect-c3c3-email-outbox`.
- Project reused: win-crm.ai-lineconnect-pilot00. No new Codex Project created.
- Base and current HEAD: `0817596034b69c1badca2fdac1bf56b0490e4a3d`.
- Authority: the implementation authorization supplied in chat plus the exact approved frozen contract; the candidate's historical lack-of-authorization wording does not supersede that authorization.

## Task objective and plan

Implement only the frozen durable settings-auth email outbox database authority and envelope boundary. Build DB authority and guarded rollback first; prove fresh pre-use rollback before any runtime allocation; then complete the entire PG17 matrix, crypto/config/repository/preparation modules, application proof, regressions and CI. No production, LINE, provider, C3c-4 or C3c-5 work.

Affected scope: the exact migration/rollback, five new TypeScript modules, narrow existing auth-config extension, dedicated SQL/shell/Python and application proofs, CI wiring, raw contract artifact and this evidence log. No existing rows require migration/backfill. No production dependencies planned.

Principal risks: parent/challenge/outbox lock ordering; post-wait time admission; stale leases/fences; exact finalize duplicate/NULL matrix; retry provenance; truthful recorder mapping; atomic terminal scrub; conservative same-epoch rollback. Rollback is only the frozen guarded unused same-epoch path, with separate review required after use/discontinuity/refusal.

## Verified entry gates

- Supplied contract path: `C:\Users\User\Downloads\Pasted markdown(20261026-050632).md`.
- Exact SHA-256: `C3FF909BC66FB19398694CB16CC1AD07505E68C2603E73E780C67EAA83C0AEBA`.
- Byte length: 96,851. All numbered sections 1-42 were read.
- Repository raw-byte copy has the same SHA-256. No rewriting/line-ending normalization.
- `git fetch origin` succeeded with required local filesystem access; fetched origin/main equals the pinned base exactly.
- Connected GitHub metadata: PR #117 merged, merge commit exactly the pinned base.
- Requested branch and worktree were absent before creation; new worktree started at the pinned base with no prior implementation.
- Migration slot 202610230001 was unused before creation.
- Historical worktrees and original checkout changes were not modified.

## Files inspected and findings

| Source | Finding |
| --- | --- |
| Frozen 42-section contract | Sole technical implementation specification |
| AGENTS.md and pilot plan | Focused scope, two correction loops, mandatory checks, no production/merge/deploy |
| C3c-2a migration/rollback | Literal stored-source and internal-trigger projection; exact eight-relation, 59 prior-function and nine target-function baselines |
| C3b challenge migration/orchestration | Existing recorder and cleanup preserved; cleanup selects challenges using SKIP LOCKED |
| Existing C3b service/config/types | Prepared challenge command, existing canonicalization and repository conventions; no modifications |
| Existing C3c-2a proof/transport | Reused fixture and independent psql-session transport without editing old scripts |
| CI and package.json | Existing postgres:17-bookworm, Node 22 and required npm checks inspected; not modified |

## Current hypothesis / exact stopping failure

The second runtime validation reached `purge_cleanup`, winner order False, and failed its expected-blocking barrier after the bounded barrier deadline. The harness expected cleanup to wait behind purge; the unchanged cleanup implementation uses `FOR UPDATE SKIP LOCKED` and can complete immediately instead. This is an unresolved concurrency-proof harness failure. A corrected proof must explicitly verify the SKIP LOCKED outcome and subsequent cleanup behavior, rather than requiring a nonexistent wait. No blanket deadlock-freedom or complete-matrix claim is justified.

Observed final failure: `FAIL C3c-3 purge_cleanup False: barrier timeout`.

The run then reported zero surviving harness backends. A separate administrative check confirmed zero databases named c3c3_% and zero sessions named c3c3_% after shell/Python cleanup.

## Commands / validation evidence

| Check | Actual result |
| --- | --- |
| Canonical prerequisite replay | PASS through C3c-2a, common synthetic non-superuser owner |
| Exact image | Fresh disposable `postgres:17-bookworm`; no published ports; network disabled |
| PostgreSQL | 17.11 (Debian 17.11-1.pgdg12+2), x86_64 Linux |
| Metadata derivation | Exact draft SQL only; no runtime RPC/nextval; literal manifests recorded |
| Migration preflight/postflight | PASS in fresh unused fixtures |
| Fresh pre-use rollback | PASS before every runtime behavioral run; empty outbox, last_value=1/is_called=false, valid current epoch guard, exact prerequisites restored |
| Runtime/state proof | INCOMPLETE: 42 completed scenario labels before the 43rd attempted scenario's barrier failure |
| Concurrency | 14 scenario labels completed; 15th attempted scenario failed; full matrix not complete |
| Unexpected deadlock / SQL lock or statement timeout | None observed in completed cases; one unexpected harness barrier timeout is a proof failure |
| Recorder true/false | PASS for the four applicable outcome branches |
| Recorder exception | PASS: complete finalization rollback; later expired-SENDING recovery closes unknown |
| Retry schedule/exhaustion | PASS: 5s/20s, fresh generations, three-attempt budget, deadline and unusable precedence; no exhaustion recorder |
| Crypto-loss DB closure | PASS: repeated no-begin claim/expired-lease recovery eventually closes/scrubs for counts 0 and 1; actual crypto not yet implemented |
| Terminal scrub/purge/no-resurrection | PASS for six tested terminal paths; complete temporal/race matrix still pending |
| ACL / owner negatives | Tested wrapper/core/table/column/sequence denials, guarded direct DML/TRUNCATE, isolation and batch bounds PASS; full matrix still pending |
| Finalize structural matrix | Invalid NULL/boolean/outcome/provider-ID combinations exercised; tested duplicate branches PASS |
| Same-epoch rollback | PASS for fresh unused fixture |
| Restart/epoch mismatch / full maintenance negatives | NOT EXECUTED: run stopped before this stage |
| SQL AAD | Encoder drafted and compiled; golden equality proof NOT EXECUTED |
| AES/keyring/TypeScript AAD/repository/preparation/flags | NOT IMPLEMENTED |
| Existing DB regressions | NOT RUN: focused C3c-3 proof has not passed |
| npm run typecheck | NOT RUN under the approved validation order |
| npm test / application count | NOT RUN; no C3c-3 application tests created |
| npm run build | NOT RUN under the approved validation order |
| Commit / push / PR / hosted CI | NOT PERFORMED; local validation prerequisite not satisfied |

## Database draft inventory

Two tables: `public.every8d_settings_auth_email_outbox`, `public.every8d_settings_auth_email_outbox_installation_guard`.
One bigint fence sequence: `public.every8d_settings_auth_email_outbox_fence_seq`.
Fifteen functions: six runtime wrappers, six owner cores, one AAD helper, two protection functions.
Four explicit triggers, seven indexes, four generated challenge-FK triggers. No extra runtime API or application-authority table. Both new tables have RLS enabled and zero policies. The six wrappers alone grant service_role EXECUTE; cores/helper/protection functions are owner-only. No application table/column or sequence access. Definer search paths fixed to pg_catalog, public. These are draft definitions with partial executable proof, not final implementation approval.

### Six wrapper signatures (draft)

- `public.runtime_enqueue_every8d_settings_auth_email_v1(input_job_id uuid,input_challenge_id uuid,input_request_token_hash bytea,input_purpose text, input_envelope_version smallint,input_payload_version smallint,input_template_version smallint, input_encryption_key_version text,input_nonce bytea,input_ciphertext bytea,input_authentication_tag bytea)`
- `public.runtime_claim_every8d_settings_auth_email_v1(input_batch_size integer)`
- `public.runtime_begin_every8d_settings_auth_email_send_v1(input_job_id uuid,input_lease_id uuid,input_fence bigint)`
- `public.runtime_finalize_every8d_settings_auth_email_v1(input_job_id uuid,input_lease_id uuid,input_fence bigint,input_attempt_count smallint, input_provider_outcome text,input_pre_send_disposition text,input_non_acceptance_proven boolean, input_provider_message_id text)`
- `public.runtime_recover_every8d_settings_auth_email_v1(input_batch_size integer)`
- `public.runtime_purge_every8d_settings_auth_email_v1(input_batch_size integer)`

### Six core signatures (draft)

- `public.enqueue_every8d_settings_auth_email_core_v1(input_job_id uuid,input_challenge_id uuid,input_request_token_hash bytea,input_purpose text, input_envelope_version smallint,input_payload_version smallint,input_template_version smallint, input_encryption_key_version text,input_nonce bytea,input_ciphertext bytea,input_authentication_tag bytea)`
- `public.claim_every8d_settings_auth_email_core_v1(input_batch_size integer)`
- `public.begin_every8d_settings_auth_email_send_core_v1(input_job_id uuid,input_lease_id uuid,input_fence bigint)`
- `public.finalize_every8d_settings_auth_email_core_v1(input_job_id uuid,input_lease_id uuid,input_fence bigint,input_attempt_count smallint, input_provider_outcome text,input_pre_send_disposition text,input_non_acceptance_proven boolean, input_provider_message_id text)`
- `public.recover_every8d_settings_auth_email_core_v1(input_batch_size integer)`
- `public.purge_every8d_settings_auth_email_core_v1(input_batch_size integer)`

## Approaches, corrections and stop-rule status

- Used literal prerequisite projections rather than inferred hashes or normalized stored source.
- Derived new literal metadata fingerprints in metadata-only disposable PG17; derived source is recorded separately from formal proof.
- Retained existing C3b/C3c-2 files byte-for-byte; imported existing session proof transport without modifying it.
- Local environment setup required Windows Git for canonical Git-object replay from a Windows worktree under WSL, and explicit UTF-8 proof-source encoding.
- First implementation correction: parenthesized a PL/pgSQL CASE expression after exact syntax diagnostics; added an explicit required non-NULL pre-send field guard. Compilation then passed in a new fixture.
- Second correction cycle: disposable time-shift fixture drained deferred integrity checks before re-enabling protections. Recorder exception/recovery and retry/closure proofs then passed.
- Latest proof still fails the purge/cleanup barrier. AGENTS.md line 140 says: "Use at most two implementation correction loops." Stopped for review before another correction cycle.
- One active coding task; no subagents, reviewer cycle, hosted CI run, merge or deploy.
- No genuine contradiction in the frozen contract has been established. The remaining failure is in proof expectations and prevents declaring completion.

## Complete current changed-file list

All listed files are new, uncommitted drafts. No tracked existing implementation file changed.

- `docs/every8d-c3c3-email-outbox-contract.md`
- `supabase/migrations/202610230001_every8d_settings_auth_email_outbox.sql`
- `supabase/rollback/202610230001_every8d_settings_auth_email_outbox.sql`
- `test/postgres/every8dSettingsEmailOutbox.sh`
- `test/postgres/every8dSettingsEmailOutbox.sql`
- `test/postgres/every8dSettingsEmailOutboxConcurrency.py`
- `test/postgres/every8dSettingsEmailOutboxDerive.sql`
- `test/postgres/every8dSettingsEmailOutboxManifest.json`
- `test/postgres/every8dSettingsEmailOutboxPostflight.sql`
- `docs/agent-run-c3c3-settings-auth-email-outbox.md`

## Draft byte evidence (not committed artifact evidence)

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `docs/every8d-c3c3-email-outbox-contract.md` | 96851 | `C3FF909BC66FB19398694CB16CC1AD07505E68C2603E73E780C67EAA83C0AEBA` |
| `supabase/migrations/202610230001_every8d_settings_auth_email_outbox.sql` | 160239 | `634F43DC4AAB65EAF261833AFDA882E791231D90DE46810E53E6492ED97F8B47` |
| `supabase/rollback/202610230001_every8d_settings_auth_email_outbox.sql` | 73538 | `0015570670E2FBE20314EBBB4E0175D31A57581D2EB7CB346F457D1F1E7F4513` |
| `test/postgres/every8dSettingsEmailOutbox.sh` | 3451 | `973EE9BB354C0E7700A27D16F681C08FD0DD01167998D6B70B9DAE7E84BE1024` |
| `test/postgres/every8dSettingsEmailOutbox.sql` | 3716 | `706BC6F2CE5A2313EF3656658DA51F36EE1681F5927EA9A39A71B29D35ED25B3` |
| `test/postgres/every8dSettingsEmailOutboxConcurrency.py` | 30821 | `948704D03D83C4D4BBD2BC574BDCA4EDFAF076D365F037D92D4D0B9CA18307AC` |
| `test/postgres/every8dSettingsEmailOutboxDerive.sql` | 5793 | `00BED9B615BE7987160636C6729849FFB8D464DA9A7190224C50F4C337DD0B9F` |
| `test/postgres/every8dSettingsEmailOutboxManifest.json` | 2110 | `3A9735BFCC05CFF8ADAA5D30A40D0C5D5F0F24FF9CCA0E97F8E5C877A084A961` |
| `test/postgres/every8dSettingsEmailOutboxPostflight.sql` | 40850 | `91737E140DC2DDACD8B4F6FA9BC124F5AAB7EF414C313F6A340B37564497D429` |

No committed Git blob evidence exists for these artifacts. The required principal TypeScript/application artifacts do not exist. Before a future commit, protect the exact contract bytes against Git text conversion and verify the committed blob's SHA-256; do not normalize the approved file.

## Required final-report state

Pinned base / final HEAD: `0817596034b69c1badca2fdac1bf56b0490e4a3d`. Worktree is not clean because the authorized drafts are untracked. No implementation commit, PR number/link, hosted run ID or job conclusions exist. C3c-2a production was not applied by this task; production state was not inspected. No Railway/config/database/provider/LINE/Phase2F production action was performed.

Remaining scope: correct and complete the entire PG17 matrix under further correction authority; finish the five TypeScript modules and narrow config extension; add every crypto/application proof; wire CI; run unchanged DB regressions and npm checks; review full diff and immutable artifact evidence; only then commit/push/open one unmerged PR and observe its first hosted CI run.

Recommended next action: independent review of this stop and authorization for a further local correction cycle. Continue from this worktree and the preserved frozen contract; do not recreate the task or change its contract.

```text
C3C_3_IMPLEMENTATION: INCOMPLETE
C3C_3_PR: NOT_READY_FOR_REVIEW
C3C_3_LOCAL_PG17_PROOF: INCOMPLETE_BARRIER_FAILURE
C3C_3_CRYPTO_APPLICATION_PROOF: NOT_STARTED
C3C_3_HOSTED_CI: NOT_RUN
C3C_4: NOT_AUTHORIZED
C3C_5: NOT_AUTHORIZED
PRODUCTION_CHANGES: NONE
NEXT_GATE: USER_REVIEW_OF_LOCAL_PROOF_STOP
```

## Additional local correction - verified diagnosis before editing

The human user explicitly authorized one additional local correction cycle limited to the diagnosed purge_cleanup expectation mismatch and directly necessary proof assertions. This supersedes the two-loop limit only for that correction. Any new material failure after the corrected focused case requires diagnosis and a stop without another correction.

Re-fetched origin/main: still `0817596034b69c1badca2fdac1bf56b0490e4a3d`. Frozen artifact hash remains exactly `C3FF909BC66FB19398694CB16CC1AD07505E68C2603E73E780C67EAA83C0AEBA`.

Before editing, inspected the exact generic `races()` purge_cleanup branch, actual purge core, unchanged C3b cleanup, frozen sections 24/25/36 and prior independent-session transport. No CONTEXT.md or ADR file was found in the repository inventory. The prior recorded original failure and a minimal new probe provide the feedback loop; a second artificial barrier timeout was unnecessary because the live probe directly established that the old blocking predicate is false.

Diagnosis: `PROOF_HARNESS_EXPECTATION_MISMATCH`.

- Old expectation: after actor A invokes purge and holds its transaction open, actor B's cleanup must appear in A's `pg_blocking_pids` relation before A commits. The generic harness called `blocked(B,A)`.
- Frozen behavior: section 24 requires SKIP LOCKED for bounded purge candidate processing; section 25 orders challenge before outbox; section 36 requires purge versus cleanup proof. It does not require every such race to block.
- Runtime purge SQL: challenge `FOR UPDATE SKIP LOCKED`, then outbox `FOR UPDATE SKIP LOCKED`; candidate prefix is bounded. No mismatch identified in the inspected runtime paths.
- Existing cleanup SQL: its challenge selection uses `FOR UPDATE SKIP LOCKED`, before failure-ledger deletion and restrictive-FK challenge deletion.
- Actual pre-edit probe: actor A ran real purge, received purged_count=1, and remained idle in transaction holding the challenge row lock and uncommitted outbox deletion. An independent challenge `FOR UPDATE NOWAIT` probe refused with the expected SQLSTATE 55P03. A held granted RowShareLock on challenges and RowExclusiveLock on outbox. Actor B ran real cleanup and completed while A remained open; B was idle in transaction with zero blocking PIDs. Its old count(*) query returned 1 because it counted the single result row; actual deleted_count was 0. A protected three-relation snapshot remained equal while A held its locks. After A committed, cleanup returned deleted_count=1.
- Safe observed lock evidence: holder_idle=true; skipper_idle=true; skipper_blocked=false; holder_challenge_relation_lock=true; holder_outbox_delete_relation_lock=true. No job/challenge IDs or protected payloads were logged.
- Pre-edit probe result: confirmed immediate skip, not mandatory blocking; no partial visible authority mutation; normal cleanup after release; zero surviving actor sessions and disposable proof databases.

Authority baseline SHA-256 before proof-only edits:

| Artifact | SHA-256 |
| --- | --- |
| Migration | 634F43DC4AAB65EAF261833AFDA882E791231D90DE46810E53E6492ED97F8B47 |
| Rollback | 0015570670E2FBE20314EBBB4E0175D31A57581D2EB7CB346F457D1F1E7F4513 |
| Original harness | 948704D03D83C4D4BBD2BC574BDCA4EDFAF076D365F037D92D4D0B9CA18307AC |
| Original shell entry | 973EE9BB354C0E7700A27D16F681C08FD0DD01167998D6B70B9DAE7E84BE1024 |

Correction plan: change only the dedicated Python proof, its shell focused-mode entry, and this log. Assert real counts, observed held-row locks, bounded skip completion before holder release, unchanged challenge/failure-ledger/outbox snapshots, atomic expected FK refusal and successful processing after release. Test both challenge contention directions plus outbox-row-only contention. Runtime and frozen contract remain unchanged. Rollback for the correction is to revert only these proof assertions/entry changes. No existing application behavior is affected.

### Additional correction: focused result

Changed only `test/postgres/every8dSettingsEmailOutboxConcurrency.py`, `test/postgres/every8dSettingsEmailOutbox.sh` and this run log. The generic purge_cleanup blocking expectation was replaced by three dedicated independent-session cases; the case remains part of the full suite and is also selectable with `C3C3_PROOF_MODE=purge-cleanup`. No timeout was increased, no failure became a warning, and no lock/final-state assertion was removed without a stricter replacement.

Focused command: `C3C3_PROOF_MODE=purge-cleanup GIT_BIN=git.exe PYTHONDONTWRITEBYTECODE=1 POSTGRES_CONTAINER_ID=<dedicated-disposable-container> bash test/postgres/every8dSettingsEmailOutbox.sh` (under WSL Ubuntu with the isolated worktree as CWD).

Result: PASS, three scenarios / three independent-session races, PostgreSQL 17.11 from exact image postgres:17-bookworm. Fresh pre-use rollback ran and passed first. Each case observed distinct live sessions, holder idle in transaction, correct granted relation lock, skipper challenge-selection RowShareLock, and skipper idle/unblocked before holder release. Exact deletion counts were asserted, not result-row cardinality. Expected NOWAIT SQLSTATE 55P03 probes established particular challenge/outbox row ownership. The skipped actor's own protected-row snapshot and the externally visible post-commit snapshot both matched the baseline. Cleanup's expected SQLSTATE 23503 rolled back failure-ledger deletion atomically. After release, purge removed only the outbox; normal cleanup then deleted exactly one challenge and its ledger row. Final counts for the tested outbox/challenge/failure ledger were zero. No provider call occurred.

Safe lock evidence in each case: distinct_sessions=true; holder_open=true; holder_relation_lock=true; skipper_challenge_selection_lock=true; skipper_completed_before_release=true. Completion used the existing actor-ready deadline while the holder remained open; it did not depend on sleep scheduling. Unexpected deadlocks/timeouts: zero. Python actor cleanup reported zero surviving backends; shell cleanup dropped all disposable proof databases.

Migration, rollback and frozen-contract SHA-256 values were independently rechecked after the focused correction and equal their pre-edit baselines exactly. Complete fresh full-harness rerun is next; historical runtime PASS is not being substituted for it.

### Additional correction: complete fresh current PG17 harness result

A separate newly initialized, network-isolated exact `postgres:17-bookworm` container ran the full current harness, starting from canonical Git-object prerequisite replay and successful fresh unused pre-use rollback. Result: PASS, 57 scenario labels / 18 independent-session races, zero unexpected deadlocks/timeouts. Every previously implemented migration, state, retry, recorder, scrub, purge, negative-input and concurrency case ran again. All three corrected purge_cleanup cases passed again in the full run. Nine maintenance negatives passed (aborted sequence allocation, sequence properties, sequence ACL, epoch mismatch, new FK trigger state, old FK trigger state, cross-schema string body, cross-schema procedure, catalog caller), as did large decimal fences and exhausted-sequence fail-closed behavior. Python cleanup reported zero surviving harness backends. Independent post-run queries returned zero c3c3_% databases and zero c3c3_% actor sessions.

This result covers the complete current harness; final section-36/37 coverage reconciliation is still required before review delivery. It is not a substitute for unimplemented obligations. The original authorization now continues into the five TypeScript modules, narrow auth config extension, and focused crypto/application proof, followed by unchanged DB regressions and required npm checks. No new authorization is being requested for those original steps.

Application implementation plan: preserve existing C3b config semantics when encryption configuration is absent; strictly parse an independently bounded encryption keyring and compare every configured historical HMAC key; implement independently encoded binary AAD and authenticated canonical payload/envelope validation; return exactly six repository operations with precision-safe decimal fences and immutable gate snapshots; add route-free preparation with no worker/provider/network action. No production dependency is added. Risks are parser/shape holes, key-domain reuse, plaintext release before GCM authentication, imprecise fences and incidental activation. Tests will cover the complete frozen crypto/application matrix, independently generated AAD vectors and existing config/session regressions. Reverting the new modules and narrow config change is the application rollback; frozen DB authority remains unchanged.

## New material failure after corrected proof - mandatory stop

Classification: APPLICATION_CONTRACT_DEFECT / repository failure taxonomy.

Reproduction: `npm run build`, then `node --test test/every8dSettingsEmailOutbox.test.cjs`. Build passed. Focused application result: one test, zero pass, one fail, zero skipped/cancelled. The mock RPC returns null as its outer response object. Trusted purge maintenance was invoked with all three flags false; the test confirmed exactly one RPC before checking the category.

Expected: `{ outcome: "failure", category: "repository_contract_violation" }`.
Actual: `{ outcome: "failure", category: "repository_unavailable" }`.

Exact cause: `src/services/every8dSettingsEmailOutboxRepository.ts` line 220 calls the throwing `record()` validator inside the same try/catch used for transport errors. `record(null)` throws `InvalidContract`; line 223's catch maps that internal structural-validation failure to unavailable. All six repository methods share this helper, so the cause is shared; only purge was executed in the focused reproducer. The existing C3b repository lines 192-193 and C3c-2 session repository lines 179-180 explicitly classify a non-record outer response as contract violation. Frozen section 32 requires the existing closed taxonomy and defensive return-shape validation. No database error or transport rejection occurred in this reproducer.

No correction was made after this finding. The user's additional-authorization section I explicitly requires diagnosis and STOP FOR REVIEW for any new application-contract defect. The first hosted-CI boundary was never reached.

### Correction scope and unchanged authority

The authorized purge_cleanup correction itself changed only the Python concurrency proof, shell focused-mode entry and evidence log. After its focused and full proof passed, original implementation authorization was used for the five TypeScript modules and the narrow settings-auth config integration. The preparation service accepts only a confirmed unchanged-C3b preparation result via enqueuePreparedChallenge; the caller retains the separate challenge commit/capability. The service validates the internal command, does not enumerate/read the raw capability, encrypts once and enqueues once. This is a draft implementation choice within the route-free boundary, not an HTTP/worker composition.

Also drafted after the PG17 rerun: two fixed binary-spec golden AAD fixtures, an independent SQL encoder assertion step, and the focused application regression. The new SQL AAD step was NOT EXECUTED before the application stop. No claim is made that the new golden vectors, actual crypto, keyring, all repository parsers, preparation composition or full section-36/37 coverage passed. CI wiring and remaining proof matrices are unfinished.

Frozen contract SHA-256 remains C3FF909BC66FB19398694CB16CC1AD07505E68C2603E73E780C67EAA83C0AEBA.
Migration SHA-256 remains 634F43DC4AAB65EAF261833AFDA882E791231D90DE46810E53E6492ED97F8B47.
Rollback SHA-256 remains 0015570670E2FBE20314EBBB4E0175D31A57581D2EB7CB346F457D1F1E7F4513.
No runtime SQL, old cleanup, frozen artifact, state/RPC/lock/ACL/retry/crypto contract was changed by this correction cycle.

### Required correction report

| Area | Latest result |
| --- | --- |
| PURGE_CLEANUP diagnosis | Old mandatory-block barrier was wrong; both real selection paths use SKIP LOCKED; old count(*) hid deleted_count=0 |
| Actual lock evidence | Distinct sessions; holder open; expected granted relation modes; NOWAIT proves held rows; skipper completed/unblocked before holder release |
| Focused result | PASS: three cases, exact counts/snapshots, expected FK refusal atomic, eventual challenge/ledger/outbox absence |
| Focused deadlocks/timeouts | Zero unexpected; fixed NOWAIT 55P03 and FK 23503 negatives explicitly expected |
| Full fresh current PG17 harness | PASS: 57 scenarios, 18 independent-session races, zero unexpected deadlocks/timeouts |
| Full implemented case groups rerun | Enqueue/login/enrollment, claims/fences, begin duplicates, four outcomes/duplicates, recorder true/false/exception, retries/exhaustion, crypto-loss DB closure, recovery/terminal scrub, purge/no resurrection, ACL/input/isolation negatives, all implemented races, nine maintenance negatives, large fence and sequence exhaustion |
| Final frozen proof coverage | Not complete; final coverage audit and remaining obligations still pending; later-added SQL AAD golden step unexecuted |
| Proof cleanup | Both containers independently reported zero c3c3_% databases and zero c3c3_% actor sessions before disposal |
| TypeScript/crypto/config/repository/preparation | Five modules and narrow config integration drafted; not accepted as contract-complete |
| Typecheck | PASS |
| Build | PASS |
| Focused application test | FAIL: 0/1, malformed RPC outer-result taxonomy; exact root cause above |
| Full npm test | NOT RUN after mandatory stop |
| Existing DB regressions | NOT RUN after mandatory stop |
| Commit/push/PR/hosted CI | NOT PERFORMED |
| Current HEAD | 0817596034b69c1badca2fdac1bf56b0490e4a3d |
| Working tree clean | No; preserved uncommitted authorized drafts |
| Production / C3c-4 / C3c-5 | No production changes; later phases not started/not authorized |

### Complete current changed-file list and uncommitted byte evidence

All files remain uncommitted. Existing tracked change is limited to src/config/every8dSettingsAuth.ts. No committed Git blob evidence exists, and no all-proof-PASS claim is made.

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `docs/every8d-c3c3-email-outbox-contract.md` | 96851 | `C3FF909BC66FB19398694CB16CC1AD07505E68C2603E73E780C67EAA83C0AEBA` |
| `src/config/every8dSettingsAuth.ts` | 10027 | `5D87ACBD60ACCFED376D965C30CDE7D426A10E8E14765AA52A2EA77B8F22CEC7` |
| `src/config/every8dSettingsEmailOutbox.ts` | 7186 | `653C710C05551873E257B3D22A02B001E2C93961070CF8A4E2C3665A2AA77CF0` |
| `src/services/every8dSettingsEmailOutboxCrypto.ts` | 11582 | `1D016630FC892698EDA6888DBD138706B7670412B24980E631EDD7B2A345DFC0` |
| `src/services/every8dSettingsEmailOutboxRepository.ts` | 22461 | `A3D67571EE0465D6D4825ED28EFBD12732880543178F38568F3CDDCD0837242E` |
| `src/services/every8dSettingsEmailOutboxPreparationService.ts` | 4776 | `C299D17A75FAF9E6D259EC5FEAABB02FE06EF8A65BAC5CD4E86ED39F228D7DE6` |
| `src/types/every8dSettingsEmailOutbox.ts` | 4908 | `90EC29C819A8A194B6EC67864D20A429AAFF84529054430077AAD35BC75717C6` |
| `supabase/migrations/202610230001_every8d_settings_auth_email_outbox.sql` | 160239 | `634F43DC4AAB65EAF261833AFDA882E791231D90DE46810E53E6492ED97F8B47` |
| `supabase/rollback/202610230001_every8d_settings_auth_email_outbox.sql` | 73538 | `0015570670E2FBE20314EBBB4E0175D31A57581D2EB7CB346F457D1F1E7F4513` |
| `test/every8dSettingsEmailOutbox.test.cjs` | 1021 | `CB562601989863CF0202FD6B4EBDAA1BE600AC1D7603AFE7A2290F6CE40902DA` |
| `test/fixtures/every8dSettingsEmailOutboxAad.json` | 1498 | `F04A751ED4212E0A9B2DEAC94C6B0750A25068020D86F0D6B049E1884008482D` |
| `test/postgres/every8dSettingsEmailOutbox.sh` | 3729 | `14BDCB6662C8913B43CC56E4E175AE4AF70DA5E33266AD18CBA830967F988ED8` |
| `test/postgres/every8dSettingsEmailOutbox.sql` | 3716 | `706BC6F2CE5A2313EF3656658DA51F36EE1681F5927EA9A39A71B29D35ED25B3` |
| `test/postgres/every8dSettingsEmailOutboxAad.sql` | 1650 | `66B9517B247B6D0873F9805C8EC538224E17F245DA8EC698B9306D0C98DD4811` |
| `test/postgres/every8dSettingsEmailOutboxConcurrency.py` | 38200 | `7E1688ED237A3E72AD1E366659F38386875E0087BB2B481CCECF750E4C34C5DA` |
| `test/postgres/every8dSettingsEmailOutboxDerive.sql` | 5793 | `00BED9B615BE7987160636C6729849FFB8D464DA9A7190224C50F4C337DD0B9F` |
| `test/postgres/every8dSettingsEmailOutboxManifest.json` | 2110 | `3A9735BFCC05CFF8ADAA5D30A40D0C5D5F0F24FF9CCA0E97F8E5C877A084A961` |
| `test/postgres/every8dSettingsEmailOutboxPostflight.sql` | 40850 | `91737E140DC2DDACD8B4F6FA9BC124F5AAB7EF414C313F6A340B37564497D429` |

The nineteenth changed file is this evidence log, `docs/agent-run-c3c3-settings-auth-email-outbox.md`; it has no self-referential hash.

Next gate: user review of the new malformed-RPC failure-category defect. No further correction is performed under the current authorization.

```text
C3C_3_EXTRA_LOCAL_CORRECTION: INCOMPLETE
C3C_3_PURGE_CLEANUP_PROOF: PASS
C3C_3_IMPLEMENTATION: INCOMPLETE
C3C_3_PR: NOT_READY_FOR_REVIEW
C3C_4: NOT_AUTHORIZED
C3C_5: NOT_AUTHORIZED
PRODUCTION_CHANGES: NONE
```

## Repository-classification correction authorization and initial reproduction

The user authorized one additional narrow local cycle for the malformed-RPC error classification and directly affected application proof. No third category, retries, raw diagnostics, signature/result/state change or DB/proof artifact change is authorized. A new material runtime defect requires diagnosis and STOP without correction; deterministic test setup/data issues may be corrected with explicit evidence.

At entry, fetched origin/main and worktree HEAD both equal 0817596034b69c1badca2fdac1bf56b0490e4a3d. Captured SHA-256 for 60 files spanning every Supabase artifact, every PG proof artifact, the frozen contract, and the fixed AAD fixture. DB_AUTHORITY_CHANGED: NO. Prior PG17 57-scenario / 18-race PASS is retained as the prior run's evidence and is not being reinterpreted as covering unexecuted obligations.

Re-ran the existing focused reproduction before editing: same expected category mismatch, one test / one failure. All six repository methods were inspected and invoke the one shared helper, then parse their operation-specific cardinality/receipt inside their existing contract-violation catches.

Smallest correction: isolate client acquisition and awaited RPC invocation in a repository_unavailable catch; after successful invocation, independently parse/validate the outer response in a repository_contract_violation catch. A normally returned RPC error remains unavailable. No message matching, nested causes, diagnostics or retry was introduced. Only the shared helper block changed; the six names, exact RPC arguments, individual parsers and public results remain unchanged. Restoring that block is the correction rollback. Next validation: existing reproduction first, then focused six-parser classification, then the original unfinished crypto/preparation/proof and regression work.

## Repository-classification correction result and new mandatory stop

### Exact correction and six-method review

Previous flow: getClient().rpc and record(response) were inside the same unavailable catch. A returned null caused the structural validator to throw InvalidContract, which was caught as transport unavailability.

Current flow: one try/catch covers only client acquisition and awaited invocation; failures there return repository_unavailable. A second try/catch handles the successfully returned outer response and its data/error presence; structural validation failures return repository_contract_violation. Normally returned non-null RPC error remains unavailable. No string matching, third category, diagnostic exposure or retry. No names, parameter shapes, receipt definitions, public results or individual parser logic changed. enqueue, claim, beginSend, finalize, recover and purge all share the corrected helper and retain their existing per-operation validation catches.

Changed in this cycle: shared helper in src/services/every8dSettingsEmailOutboxRepository.ts; expanded test/every8dSettingsEmailOutbox.test.cjs; new test/helpers/every8dSettingsEmailOutboxFixtures.cjs; this evidence log. There was no unrelated refactor.

### Focused classification results

- Existing reproduction re-run before editing: FAIL with the known unavailable/contract-violation mismatch.
- npm run build after correction: PASS.
- Existing reproduction re-run first after build: PASS, one test.
- Expanded focused six-method classification invocation: PASS, 342/342; zero failures/skips/cancellations.
- Each method covered client acquisition failure and invocation rejection (unavailable), returned RPC error (unavailable), eleven malformed outer structures including null/missing/wrong keys (contract violation), returned throwing field (contract violation), SDK transport metadata compatibility, valid and empty results, excessive cardinality, malformed containers/sparse array, every receipt field missing/invalid, and extra receipt fields.
- Also covered request/receipt job mismatch where the request contains job identity; state-dependent NULL errors; invalid input and returned fence decimals; canonical minimum, maximum and a value above 2^53. Inputs with invalid fences produced zero calls; invocation paths performed exactly one call. Successful Supabase status/count metadata remains accepted, as in the existing repository boundary; receipt rows remain closed.
- Only fixed labels, categories and booleans were used in failure assertions; protected payloads and database diagnostics were not logged.

### NEW material failure - recover previous-state/attempt consistency

Test: test/every8dSettingsEmailOutbox.test.cjs line 126, "recover: PENDING cannot have a previously recorded provider attempt".

Reproduction command: node --test --test-name-pattern='PENDING cannot have a previously recorded provider attempt' test/every8dSettingsEmailOutbox.test.cjs.

Result: FAIL, one test / zero pass / one fail. A separate sanitized diagnostic confirmed actual outcome=applied, accepted_receipt_count=1, rpc_calls=1. No raw receipt was printed.

Malformed, but individually well-typed, receipt fields:

- previous_state = PENDING
- state = FAILED_TERMINAL
- attempt_count = 1
- terminal_disposition = retry_unusable
- terminal_at = recovered_at; availability NULL; recording not_applicable

Expected: repository_contract_violation, because frozen section 16 restricts PENDING to zero attempts and section 22 forbids recovery from incrementing attempts. An attempted retry-failure receipt cannot truthfully come from PENDING.

Exact cause: parseRecover at src/services/every8dSettingsEmailOutboxRepository.ts line 196 checks previous_state against the nonterminal vocabulary and attempt_count against generic 0..3. Its terminal branch validates destination/disposition/count combinations but never checks the source state's attempt range. Thus the impossible PENDING/count=1 source is accepted. This is a new semantic parser/runtime-validation defect, not a test-data typo or deterministic setup issue. The shared classification fix correctly remains separate from this missing semantic guard.

No correction was performed after discovery. User authorization section I requires diagnosis, preservation and STOP FOR REVIEW for any new material implementation defect. Existing SQL authority was neither reopened nor changed.

### Database preservation

DB_AUTHORITY_CHANGED: NO.

Recomputed every recorded hash after the failure: all 60 Supabase / PostgreSQL proof / frozen contract / fixed AAD artifacts exactly match this cycle's entry baseline. No files were added beneath the protected DB/proof directories. Frozen contract SHA-256 remains C3FF909BC66FB19398694CB16CC1AD07505E68C2603E73E780C67EAA83C0AEBA. Prior fresh PG17 PASS (57 scenarios / 18 independent-session races / zero unexpected deadlocks/timeouts / zero surviving proof databases/backends) is preserved. No PG17 state-machine rerun was performed for this pure TypeScript correction, as instructed. This does not newly claim completion of earlier unexecuted frozen coverage obligations or SQL/TS AAD vectors.

### Required next report snapshot

| Requested area | Actual latest result |
| --- | --- |
| Current classification defect | Corrected by isolated invocation/parsing catches; original regression PASS |
| Focused classification | 342/342 PASS across all six methods, no retry/diagnostic leakage |
| New material defect | recover parser accepts impossible PENDING/count=1 recovery receipt; separate focused regression 0/1 FAIL; not corrected |
| DB authority files changed | NO; 60 baseline artifacts byte-identical |
| Prior PG17 PASS | PRESERVED, 57 scenarios / 18 races; no rerun for pure TS change |
| Keyring/AES-GCM tests | Unfinished / not executed in this cycle |
| SQL/TS AAD vectors | Fixed fixtures remain unchanged; equality execution still unfinished |
| Malformed payload/envelope, crypto-failure no-send, idempotency | Implementation drafts exist; full crypto proof not executed |
| Fence precision | Focused repository decimal tests PASS, including above 2^53 and signed-bigint maximum |
| Preparation-service tests | Not reached before mandatory stop |
| Complete focused test result | Incomplete: expanded classification run 342 PASS; separate new semantic regression 1 FAIL; no final combined run |
| Existing relevant DB regressions | Not run after mandatory stop |
| Typecheck | Prior PASS; not re-run in this cycle before stop |
| Build | PASS after shared-helper correction |
| npm test full suite | Not run after mandatory stop |
| HEAD / commit | 0817596034b69c1badca2fdac1bf56b0490e4a3d; no implementation commit |
| PR / first hosted CI | None / not run |
| Working tree | Not clean; authorized uncommitted implementation/test drafts preserved |
| Production changes | NONE |
| C3c-4 / C3c-5 | Not started; NOT AUTHORIZED |

No container/backend was created by this correction cycle. All previously created disposable proof containers were already removed. No live provider/client was constructed; all application transport responses in these tests were synthetic injected fixtures.

Current cycle artifact evidence (uncommitted; no committed Git blob evidence):

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `src/services/every8dSettingsEmailOutboxRepository.ts` | 22541 | `E664149D51CE68635B7F951E0A8CDCBDC7AA7EDF47E0CED301692DD725E25C0E` |
| `test/every8dSettingsEmailOutbox.test.cjs` | 8379 | `B859321A903D34135DE6911D636C545C432BD85C5AAB212F1EDB80866F4DAEC1` |
| `test/helpers/every8dSettingsEmailOutboxFixtures.cjs` | 4076 | `5C39F25D220A87EA960CB56CBF98A05895A95B9771FB8AB0106B78EDD85F3712` |

Next gate: user review of the NEW recovery receipt source-state/attempt-count defect. Do not apply an additional runtime correction under the current authorization.

```text
C3C_3_REPOSITORY_CLASSIFICATION_CORRECTION: INCOMPLETE
C3C_3_IMPLEMENTATION: INCOMPLETE
C3C_3_PR: NOT_READY_FOR_REVIEW
PRODUCTION_CHANGES: NONE
C3C_4: NOT_AUTHORIZED
C3C_5: NOT_AUTHORIZED
```

## Closed recovery-parser correction - authorization and plan

The user authorized one narrow local correction for the confirmed recovery semantic validator defect, with no database/proof/frozen-file changes. A new material semantic defect after this correction requires diagnosis and STOP. Deterministic test-data/setup corrections are allowed only without changing runtime behavior or contract interpretation.

Fetched origin/main and worktree HEAD remain the pinned 0817596034b69c1badca2fdac1bf56b0490e4a3d. Rechecked the existing 60 protected DB/PG/frozen/AAD hashes before editing: every file matched. Re-ran the exact known reproducer before editing: same single-test failure.

Old parser: checked previous_state vocabulary and a generic 0..3 count, then destination shape; this admitted previous_state=PENDING, count=1, FAILED_TERMINAL/retry_unusable even though PENDING requires zero and recovery never increments. The correction adds one private closed family table and predicate covering PENDING count0; LEASED count0; LEASED count1..2; RETRY_WAIT count1..2; SENDING count1..3. Each binds exact output state/disposition pairs and recorder activity. Terminal previous states, budget-exhaustion invention, no-op RETRY_WAIT and all other transitions are rejected. Existing exact keys, UUID, timestamp and terminal/nonterminal NULL/availability rules remain enforced. No public API/signature/result or RPC/classification helper changed.

Risk: rejecting a valid frozen receipt. Validation plan: exact reproducer first after build, exhaustive valid/invalid source/count/destination/disposition/recorder matrix plus field/timestamp mutations, then all existing 342 classification tests. Rollback is confined to the internal validator and parser call; no DB file is involved. One returned attempt count cannot prove a separate unreturned old/new value; the parser enforces source-state preservation bounds and the unchanged DB remains the authority for actual count preservation.

## Closed recovery correction - verified results and NEW crypto stop

### Recovery defect and exact correction

The previous parser accepted previous_state=PENDING, attempt_count=1, state=FAILED_TERMINAL, terminal_disposition=retry_unusable. It checked only a generic 0..3 attempt count, source vocabulary and destination shape. This could not be produced by frozen recovery authority.

Added one private recoveryFamilies table and validRecoverySemantics predicate. The five disjoint families bind source state and preserved attempt bounds to exact destination/disposition/recorder combinations. PENDING count0 permits only EXPIRED/expired_pre_send or CANCELLED/cancelled_pre_send. LEASED count0 additionally permits safe PENDING; LEASED count1..2 permits RETRY_WAIT or retry-unusable/deadline terminalization. RETRY_WAIT count1..2 permits only those two retry terminalizations, never a no-op. SENDING count1..3 permits only DELIVERY_OUTCOME_UNKNOWN/delivery_outcome_unknown with recorded/not_recorded. All other families require not_applicable recording. Terminal previous states, budget-exhaustion invention, resend states and count-bound violations are rejected. Existing exact fields, timestamp and terminal/availability checks are preserved. No public API, RPC, signature, result or classification helper changed.

Exact reproducer: re-ran red before editing, then PASS after build. Source-state preservation is validated from the count returned in the receipt; there is no separate old/new count field to compare and no new API/history was invented.

### Recovery semantic matrix and repository regression results

- Recovery test file: 23/23 PASS, zero skipped/cancelled.
- Exhaustive cross-product: 16,000 combinations across all nine real previous/result states plus UNKNOWN, counts 0..3, ten dispositions including NULL and four recorder values.
- Legal combinations accepted: 21.
- Illegal combinations rejected: 15,979.
- Additional field/time/count/recorder/type/unknown-field negative mutations: 242, all rejected.
- Every PENDING, LEASED zero/prior-attempt, RETRY_WAIT, SENDING and terminal/unknown previous-state family was covered. Exact count and source/result receipt values were retained on valid rows.
- Repository classification suite after the matrix: 343/343 PASS (the original 342 plus the now-fixed exact recovery reproducer). All six methods retain invocation failures as repository_unavailable and malformed/semantically impossible receipts as repository_contract_violation.
- Build after the correction: PASS.

Current-cycle changed files: src/services/every8dSettingsEmailOutboxRepository.ts (only the internal recovery predicate/parser), new test/every8dSettingsEmailOutboxRecovery.test.cjs, new test/every8dSettingsEmailOutboxCrypto.test.cjs for the original unfinished crypto proof, and this run log. Existing classification test and fixture helper were reused unchanged in this cycle. No correction to another runtime module was applied.

### Original crypto/application work continued

Added and ran 60 crypto/keyring/envelope/payload tests with synthetic test material only. Result: 59 PASS, one FAIL, zero skipped/cancelled. Completed positive/negative coverage includes strict keyring versions, malformed/duplicate/escaped-duplicate JSON members, canonical Base64URL and 32-byte decode, 16-KiB / 64-key boundaries, defensive key copies, absent/partial/disabled configuration, every configured current/historical HMAC cross-domain reuse, two independently encoded TypeScript AAD golden vectors, fresh nonce/exact tag and no runtime nonce parameter, validated-claim authenticated round trip, nonce/ciphertext/tag tamper, five AAD substitutions, wrong/missing historical keys, no follow-up RPC on crypto failure, exact stable 57-byte idempotency key, malformed/noncanonical envelope variants, and nine authenticated malformed/noncanonical plaintext cases.

The test-only deterministic reference sealer exists only in the .test.cjs file, is not exported and is not imported by production code. It introduces no production entropy bypass. Payload comparisons/errors use fixed labels and booleans; recipient/OTP/key/ciphertext/request-hash/job identifiers were not printed.

SQL/TypeScript AAD equality remains incomplete: the two TypeScript vectors passed, but SQL vector execution was not reached before the mandatory stop. Preparation-service proof, remaining application-matrix work, existing DB regressions and final full validation were not reached. No historical PASS is substituted for these obligations.

### NEW material defect: authenticated BOM-prefixed plaintext accepted

Failing test: test/every8dSettingsEmailOutboxCrypto.test.cjs line 185, authenticated UTF8 BOM prefix is rejected as noncanonical plaintext bytes.

The synthetic fixture sealed UTF-8 bytes beginning EF BB BF followed by otherwise canonical version-1 payload JSON. The GCM nonce/tag/AAD and repository-validated claim were valid. Expected: uniform payload_unavailable failure, no plaintext release. Actual: decryptClaimedPayload returned normally, so assert.throws failed with "Missing expected exception." This is not a typo or setup failure: the actual authenticated plaintext bytes are noncanonical under frozen section 30's requirement that the decrypted serialization itself be canonical.

Root cause: src/services/every8dSettingsEmailOutboxCrypto.ts line 160 uses new TextDecoder("utf-8", { fatal: true }).decode(plaintext). Default BOM handling removes a leading UTF-8 BOM. Line 165 then compares the reserialized payload only with this normalized string, so the byte prefix is no longer observable and the check passes. GCM authentication itself succeeded correctly; the canonical-plaintext validation boundary was bypassed.

A separate safe decoder probe confirmed source_has_utf8_bom=true, default_decoder_removes_bom=true, decoded_string_canonical_comparison_cannot_see_prefix=true. No plaintext contents were logged. No begin/finalize/provider RPC was called by the decrypt primitive; this proof used only one synthetic claim result.

No crypto correction was made. This is a new runtime-semantic/contract defect outside the authorized recovery-parser correction. User section N requires diagnosis, evidence preservation and STOP FOR REVIEW.

### Database and delivery boundaries

DB_AUTHORITY_CHANGED: NO.
Protected artifacts rehashed after discovery: 60/60 byte-identical, no additions beneath the protected DB/proof directories. Frozen contract SHA-256 remains C3FF909BC66FB19398694CB16CC1AD07505E68C2603E73E780C67EAA83C0AEBA. Prior fresh PG17 PASS (57 scenarios, 18 independent-session races, zero unexpected deadlocks/timeouts, zero surviving proof backends/databases) remains preserved. No SQL, migration, rollback, function, constraint, trigger, PG harness or frozen artifact was changed. No PG container/session was created during this cycle.

### Required next-report snapshot

| Area | Latest actual result |
| --- | --- |
| Recovery correction | Closed five-family semantic validator; exact reproducer PASS |
| Valid / invalid recovery combinations | 21 valid / 15,979 invalid; plus 242 negative field/type/time mutations |
| Recovery semantic tests | 23/23 PASS; all previous-state families |
| Repository classification / six methods | 343/343 PASS; classification fix preserved |
| Protected DB artifacts | 60/60 byte-identical; DB change NO |
| Prior PG17 result | PASS_PRESERVED, 57 scenarios / 18 races; no rerun |
| Keyring proof | Passed implemented strict parser, bounds, historical/current cross-domain and defensive-copy cases |
| Crypto/application proof | 59/60 PASS; NEW canonical-BOM plaintext defect not corrected |
| TypeScript AAD golden vectors | 2 PASS; SQL equality execution still pending |
| Preparation service / remaining focused proof | Not reached before mandatory stop |
| Focused files executed | Repository 343 PASS; recovery 23 PASS; crypto 59 PASS / 1 FAIL; 426 tests across three separate invocations, 425 PASS / 1 FAIL; no final combined invocation |
| Existing DB regressions | Not run after mandatory stop |
| Typecheck | Prior PASS; not re-run in this cycle before stop |
| Build | PASS after recovery correction |
| npm test full suite | Not run after mandatory stop |
| Final HEAD | 0817596034b69c1badca2fdac1bf56b0490e4a3d |
| Commit / PR / first hosted CI | None / none / not run |
| Working tree | Not clean; uncommitted authorized implementation/tests preserved |
| Production | NONE |
| C3c-4 / C3c-5 | Not started / NOT AUTHORIZED |

Current-cycle principal uncommitted byte evidence:

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `src/services/every8dSettingsEmailOutboxRepository.ts` | 23309 | `03113F6885FAC7244D407BF1D04BC41F8234DC0F92130970BBEA2D24EAD1FEE3` |
| `src/services/every8dSettingsEmailOutboxCrypto.ts` | 11582 | `1D016630FC892698EDA6888DBD138706B7670412B24980E631EDD7B2A345DFC0` |
| `test/every8dSettingsEmailOutboxRecovery.test.cjs` | 5781 | `417CE9535D633859100223B27205E9D87A3F60EAAB8A2134F83D69A790B970CA` |
| `test/every8dSettingsEmailOutboxCrypto.test.cjs` | 12972 | `4D56D3BE712BED1B667841DB109BD7683A68F4AB378E74572CF5FA89310A5CD6` |

The crypto runtime module remains the same bytes as before this correction cycle. No committed Git blob evidence exists because all-local-validation gates have not passed.

Next gate: user review of the NEW authenticated plaintext BOM/canonicality defect. No additional semantic correction is performed under the current authorization.

```text
C3C_3_RECOVERY_PARSER_CORRECTION: INCOMPLETE
C3C_3_IMPLEMENTATION: INCOMPLETE
C3C_3_PR: NOT_READY_FOR_REVIEW
PRODUCTION_CHANGES: NONE
C3C_4: NOT_AUTHORIZED
C3C_5: NOT_AUTHORIZED
```

## Canonical plaintext byte correction - authorization and plan

The user authorized one narrow local cycle for canonical plaintext byte validation and direct crypto/application tests. Formats, AAD, keyring, recipient/OTP rules, versions and all DB/proof/frozen artifacts remain unchanged. New material semantic defects require diagnosis and STOP without correction; deterministic fixture typos alone may be corrected and documented.

Entry: origin/main and worktree HEAD remain 0817596034b69c1badca2fdac1bf56b0490e4a3d. All 60 protected artifact hashes matched before editing. The exact authenticated-BOM regression was re-run before coding and reproduced the known missing-exception failure.

Old behavior: authenticated plaintext was strictly decoded with the default TextDecoder BOM handling, then compared as a string against canonical JSON. Because the decoder removed a leading BOM, comparison no longer examined the actual authenticated serialization.

Smallest correction in decryptClaimedPayload: preserve original authenticated plaintext; authenticate before decode; retain strict UTF8/schema/canonical recipient/OTP/size validation; encode payloadText(result) as canonical UTF8 bytes; require plaintext.equals(canonicalPlaintext) before returning the immutable payload. Clear the new private canonical buffer with existing plaintext/key/chunk buffers in finally. Decoder BOM handling is no longer the canonicality boundary. No format/AAD/public API changed. Application rollback is limited to this comparison/private-buffer block. Risk is rejecting valid canonical payloads; prove canonical enrollment/login/maximum-recipient positives and the required negative byte matrix, then the complete focused suites and original remaining work.

## Canonical byte correction - completed local evidence and review stop

### Defect, correction and exact boundary

The original authenticated-BOM reproducer failed before editing: GCM authentication was valid but default TextDecoder removed EF BB BF, so decoded-string equality accepted noncanonical original bytes. The only runtime correction in this cycle is in src/services/every8dSettingsEmailOutboxCrypto.ts: retain the original authenticated plaintext buffer, encode the schema-validated canonical serialization into a private buffer, require Buffer.equals byte equality, then return frozen recipient/displayOtp values. Authentication/finalization precedes decoding/parsing. Strict UTF8, size/schema/normalization checks and uniform sanitized payload_unavailable errors remain. Both plaintext buffers and the existing temporary buffers are cleared in finally. No key, envelope, payload field/order/version, AAD, nonce, tag or algorithm change.

Rollback: remove only the added canonical buffer/equality/finally block to return to the previous implementation; that would restore the known defect and is not recommended. No existing LINE route or deployment behavior was changed.

### Focused proof results

- Exact BOM regression: PASS after reproducing RED; normal canonical roundtrip PASS.
- Crypto: 92/92 PASS, including AES256GCM authentication before parse, tamper/keyring/history/config bounds, malformed envelopes and payloads, sanitized errors, claim-bound decryption/no follow-up send authority, and idempotency key tests.
- Canonical positives: enrollment, login, 254-byte canonical recipient and permitted payload bound.
- Byte negatives: BOM; leading/trailing/embedded whitespace; key reordering; duplicate v/recipient/displayOtp; unknown field; alternate numeric spellings; escaped key/value representation; invalid/truncated UTF8; malformed/trailing JSON/content/NUL; noncanonical recipient/OTP; invalid payload shape/version and oversized plaintext/envelope. All rejected through the same sanitized external boundary.
- Original-byte evidence: the BOM test proves decoded string equals canonical string while original authenticated bytes differ; decryption still rejects. Caller-owned reference fixture buffers remain unchanged. No protected values appear in assertion outputs.
- Repository classification: 343/343 PASS across all six methods; transport/RPC failure remains unavailable, malformed/semantically impossible returns remain contract violations.
- Recovery: 23/23 PASS; 21 valid and 15,979 invalid cross-field combinations plus 242 negative mutations. Prior recovery correction preserved.
- Preparation: 30/30 PASS; unchanged C3b durable preparation must complete first, then exactly one encryption/enqueue and awaited durable acknowledgement, no capability read, no retry, no suppressed/unconfirmed enqueue, gates before factories/entropy, no construction side effects or provider network.
- Remaining application: 76/76 PASS; exact six RPC names/keys, gate ordering, 672 finalize inputs (15 valid / 657 invalid), 31 legal finalize receipt families with stable duplicate/mismatch checks, timestamps/bytea/versions, full-window refusal, bounded claim ordering/uniqueness and defensive buffers.
- Complete focused invocation: 564/564 PASS; zero skipped/cancelled.

### SQL/TypeScript AAD equality

Both existing fixed vectors passed independent TypeScript encoding. A temporary Node driver extracted the exact SQL AAD function definition from the protected migration, executed both existing SQL assertions in a disposable postgres:17-bookworm PG17.11 transaction, and privately compared each SQL buffer with the TypeScript buffer and independent fixed vector. Direct byte equality 2/2 PASS. The transaction rolled back; zero helper functions survived and no fence was allocated. AAD values and protected fixture contents were not logged. No SQL/helper/fixture/proof file was modified. The temp driver is evidence machinery, not runtime code.

### Required validations completed

npm run typecheck: PASS.
npm test: PASS, 1525/1525; zero failures/skips/cancellations.
npm run build: PASS.

### Frozen proof coverage gap - no automatic correction

Exact requirement: frozen section 36, line 1731, separately lists epoch mismatch refusal and post-restart rollback refusal. Current test/postgres/every8dSettingsEmailOutboxConcurrency.py maintenance() at line 443 implements only administrative timestamp mutation under epoch_mismatch. The shell/Python proof neither restarts the server nor tests rollback after a changed postmaster epoch. Static postflight equality checks do not replace this execution proof.

The section-36 Enqueue and Begin rows also mandate enqueue versus cleanup and begin versus recovery. races() line 381 enumerates duplicate_enqueue, duplicate_begin, duplicate_finalize, recover_finalize, supersede_enqueue, lifecycle_begin and purge_finalize, plus the separate purge_cleanup and concurrent-claim cases. Neither named missing race is implemented elsewhere in the C3c-3 harness. Existing synchronous begin-expired/recover-expired tests do not establish a concurrent begin-versus-recovery winner order. These examples are sufficient to block complete-frozen-matrix claims; this is not an assertion that every other matrix requirement has been fully audited.

Classification: frozen executable-proof coverage deficiency; no newly demonstrated SQL runtime defect. The earlier 57 scenarios / 18 races remain PASS, but are not evidence for unimplemented section-36 obligations. User sections M/O prohibit PG harness/database changes in this narrow crypto cycle. No PG proof, SQL or contract change was made and no additional semantic correction was attempted. CI wiring, final committed-blob evidence and PR delivery remain unfinished because their complete-local-validation prerequisite has not been established. STOP FOR USER REVIEW.

### Current-cycle principal file evidence (uncommitted)

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| src/services/every8dSettingsEmailOutboxCrypto.ts | 11892 | CECAED61D54608749C6BEC6639428029021CBF10B522DFC6F6B262A5FF3968CA |
| test/every8dSettingsEmailOutboxCrypto.test.cjs | 18555 | 25DACE4378127C13C014CB85BDAAA781C464212AA2DB237E209E8CE840D9DA7B |
| test/every8dSettingsEmailOutboxPreparation.test.cjs | 9862 | 98288AE23027577764BC856CA79A4D6E6488B42276CEB9840100360664A1A2FD |
| test/every8dSettingsEmailOutboxApplication.test.cjs | 10087 | 90A1E5D65F2CE0EA6D9F16070C131EB3DE4297DA21F2B6B2B6A25E1524300EC2 |

This cycle also updates this evidence log. No other runtime module was corrected.
### Existing DB regressions - final result

All 11 unchanged scripts PASS on the disposable postgres:17-bookworm environment: ghlSmsOutboundClaimConcurrency, ghlSmsControlledLiveAuthorizationConcurrency, ghlMarketplaceOwnership, ghlMarketplaceLifecycleOrdering, ghlPublicOAuthBootstrap, ghlOAuthRefreshFoundation, every8dProviderConfigurations, every8dSettingsAuthFoundation, every8dSettingsEmailChallengeFoundation, every8dSettingsAuthOrchestration and every8dSettingsSessionConsumption.

Deterministic host-fixture setup corrections only: Windows CRLF made initial Bash startup fail before SQL; temporary LF shell execution copies were used. C3c-2a initially rejected its target definition because its checkout migration was CRLF (56,294 bytes), while its exact HEAD object is LF (55,648 bytes); removing checkout CRLF was proven to yield exactly the Git object, with no other byte differences. A Git archive snapshot also produced CRLF, so it was not used as canonical authority. Instead 49 baseline Supabase/PG proof objects were materialized directly via binary git show output into a temporary fixture, preserving exact Git bytes. The unchanged C3c-2a script then passed structure, runtime, independent sessions, maintenance refusals and cleanup; its final diagnostics explicitly report no unexpected deadlock/lock/statement/process timeout/retry and zero surviving harness backends. No protected source/proof file was normalized or edited. No timeout, assertion or runtime semantics were weakened.

### Database, cleanup and delivery snapshot

DB_AUTHORITY_CHANGED: NO.
Final protected hashes: 60/60 byte-identical; zero added protected artifacts. Both the original attached contract and repository artifact still hash to C3FF909BC66FB19398694CB16CC1AD07505E68C2603E73E780C67EAA83C0AEBA; all 42 numbered sections remain present.

Prior current-harness PG17 result: PASS_PRESERVED, 57 scenarios / 18 independent-session races, zero unexpected deadlocks/timeouts and zero surviving proof databases/backends. No new C3c-3 runtime/state-machine proof rerun was performed. This preserved result does not establish the identified missing frozen cases.

Current proof environment cleanup: before removal, surviving disposable proof databases=0 and other client backends=0. Stopped and removed only wincrm-c3c3-canonical-proof-20261026 and its disposable volumes; confirmed no container with that name remained. This is cleanup, not an executed post-restart rollback proof.

| Required report area | Final actual result |
| --- | --- |
| Canonical byte correction | Focused fix PASS; original-byte Buffer.equals comparison before release; exact BOM rejected |
| Crypto | 92/92 PASS; GCM/keyring/envelope/payload/error boundary cases |
| SQL / TS AAD | 2 SQL + 2 TS vectors PASS; direct equality 2/2 |
| Repository | 343/343 PASS across exactly six methods |
| Recovery | 23/23 PASS; 21 legal / 15,979 illegal combinations and 242 mutations |
| Preparation | 30/30 PASS |
| Remaining focused application cases | 76/76 PASS |
| Combined focused application invocation | 564/564 PASS; zero skipped/cancelled |
| Existing DB regressions | 11/11 scripts PASS; fixture line-ending setup corrections documented above |
| Typecheck / npm test / build | PASS / 1525 of 1525 PASS / PASS |
| Frozen PG17 full coverage | INCOMPLETE; specific section-36 obligations absent from current harness |
| DB authority / protected bytes | NO change; 60/60 identical |
| Final HEAD and origin/main | 0817596034b69c1badca2fdac1bf56b0490e4a3d |
| New commit / push / PR | None / none / none |
| First hosted CI | Not run; no PR opened |
| Working tree | Dirty; authorized uncommitted implementation and evidence preserved |
| Production changes / sending | NONE / NONE |
| C3c-4 / C3c-5 | NOT STARTED; NOT AUTHORIZED |

All-local frozen proof completion remains required before delivery. No production/manual activated-provider smoke test was run. CI wiring, committed-blob line-ending protection/evidence and final PR delivery have not been attempted because the mandatory frozen proof coverage gate has not passed. No new runtime semantic bug was demonstrated in this cycle after the authorized fix; the stopping finding is incomplete frozen executable-proof coverage under the explicit prohibition on PG harness changes.

The following user-required failure-path status describes the whole additional correction/continuation cycle, despite its canonical-byte regression and local application checks passing:

```text
C3C_3_CANONICAL_PLAINTEXT_CORRECTION: INCOMPLETE
C3C_3_IMPLEMENTATION: INCOMPLETE
C3C_3_PR: NOT_READY_FOR_REVIEW
PRODUCTION_CHANGES: NONE
C3C_4: NOT_AUTHORIZED
C3C_5: NOT_AUTHORIZED
```

NEXT_GATE: USER REVIEW OF FROZEN PG17 PROOF COVERAGE AND THE NO-PG-HARNESS-CHANGE BOUNDARY.
STOPPED. No further correction performed.
## Authorized three-case PG17 coverage completion cycle

### Scope, entry and plan

The latest human authorization permits only executable enqueue/cleanup, begin/recovery and actual post-restart rollback-refusal proofs, plus dedicated harness/wiring/evidence and disposable test setup. Runtime/database authority, TypeScript, ACLs, state machine and frozen contract remain unchanged. Pinned HEAD and fetched origin/main were verified at 0817596034b69c1badca2fdac1bf56b0490e4a3d; the original 60-file hash baseline matched before editing.

Smallest isolated implementation: add test/postgres/every8dSettingsEmailOutboxSection36.py as a subclass of the unchanged proof/session harnesses, and test/postgres/every8dSettingsEmailOutboxSection36.sh as the combined old-suite-plus-additions entrypoint. Add a dedicated isolated PG17 CI job and exclude the new C3c-3 migration from the old shared D3 wildcard. Add narrow .gitattributes entries preserving exact frozen and C3c-3 SQL/proof/vector bytes. No original protected file was modified; the new files sit outside the old 60-file baseline. Risk: invalid concurrency fixtures, time-boundary synchronization and incomplete restart cleanup. Proof-only rollback: remove the new harness/entrypoint and their CI wiring/attributes additions; runtime authority is unaffected.

### Actual cleanup authority inspected

Source: supabase/migrations/202610060001_every8d_settings_email_challenge_foundation.sql lines 1229-1269, cleanup_every8d_settings_auth_challenges_v1(integer).

- Batch input 1..500. It captures clock_timestamp() once per invocation.
- Candidate terminal time is coalesce(consumed_at,locked_at,superseded_at,delivery_failed_at,expires_at). Candidate must be at least 30 days old and terminal by those fields or expired.
- Selection orders terminal time/id, obtains FOR UPDATE SKIP LOCKED on the challenge and limits the bounded batch.
- Within the caller transaction it sets the existing cleanup context, deletes the failure ledger first, then deletes challenges. No independent commit or exception swallowing is introduced.
- C3c-3's unchanged immediate restrictive challenge FK rejects challenge deletion while a retained child exists. Failure rolls back the preceding ledger deletion as well.

A successful new enqueue and cleanup eligibility cannot hold for the same valid challenge at the same decision time: cleanup through expiry requires expires_at<=now-30 days, while enqueue requires now<expires_at; cleanup through consumed/locked/superseded/delivery-failed authority makes the challenge unusable for enqueue. This was not resolved by forging a row or bypassing a guard.

### Enqueue versus cleanup: three real physical-session cases

1. Cleanup first: a valid LIVE challenge with one failed-OTP ledger entry is aged with its complete timeline into legitimate expiry/retention eligibility. Actual cleanup deletes one challenge and its ledger in an open transaction. NOWAIT proves the challenge remains locked. Enqueue starts in another READ COMMITTED session, is observed blocked by that exact cleanup transaction using pg_blocking_pids/pg_stat_activity/pg_locks, then returns zero after cleanup commits. Subsequent enqueue still returns zero. Final challenge=0 / ledger=0 / outbox=0 / orphan=0.
2. Enqueue obtains the challenge lock first on an already cleanup-eligible row: enqueue truthfully rejects and retains its transaction lock. Actual cleanup in the other physical connection completes before release with zero selected/deleted rows under SKIP LOCKED. Full private row snapshots are unchanged. After release actual cleanup deletes one challenge/ledger. Final all counts zero, no resurrection. This is the nearest legal ordering for an eligible challenge, not a successful admission.
3. Successful enqueue first on a valid unexpired pending-delivery challenge: enqueue creates exactly one child and holds authority; concurrent actual cleanup completes with zero because the challenge is ineligible. Both commit; exact one child/challenge is checked. A real recorder transition subsequently establishes LIVE authority so a genuine failure-ledger witness can be appended. After valid time aging, actual cleanup reaches the restrictive FK and fails 23503; the entire private challenge/ledger/outbox snapshot is identical before/after refusal. Recovery, eligible retention aging, purge and cleanup then remove authority normally. Final all counts zero.

Evidence does not assert a logically impossible simultaneous successful-enqueue/eligible-cleanup winner. Both constructible lock orders and the successful-enqueue nearest legal order execute. Lock evidence prints only actor/session/lock metadata, fixed result counts and labels. Private receipt/row snapshots are compared internally; no payload, recipient, OTP, capability, token hash, key, ciphertext or AAD is printed. No unexpected deadlock/timeout.

### Begin versus recovery: four real races

- Begin wins on current unexpired LEASED authority: exactly one SENDING transition/count increment to 1; lease UUID/fence and lease expiry match the original claim. NOWAIT and relation/session evidence prove begin's lock. Recovery in a separate connection returns zero before release and another unexpired recovery leaves the committed row byte-for-byte unchanged. The proof waits for the actual persisted DB lease expiry using clock_timestamp(), then recovery returns SENDING -> DELIVERY_OUTCOME_UNKNOWN/count 1, atomically scrubs, and cannot authorize claim/stale begin/resend.
- Recovery wins, initial attempt 0: valid shortened test timeline is established, actual DB time passes lease expiry, recovery acquires authority and returns PENDING/count 0 with the lease triple cleared. Begin is physically observed waiting for recovery, then returns zero after commit. Stale lease/fence remains zero; no count increment.
- Recovery wins, prior positively nonaccepted attempt 1: the real begin and retryable finalize occur first, then a real due retry claim. After actual expiry, recovery returns RETRY_WAIT/count 1 and clears the lease; waiting/stale begin returns zero. Fence, retained envelope and prior-attempt timestamps remain unchanged. No provider attempt is invented.
- Expiry crossing: begin's transaction and its observed challenge-row lock wait start while the lease is unexpired. The holder retains the row across actual DB expiry. A separate recovery reaches the expired candidate and skips the held challenge with zero mutation; begin remains observably blocked. Releasing the holder allows begin to return zero using fresh post-lock clock_timestamp(), leaving the private row snapshot unchanged. Later recovery safely yields PENDING/count 0; the old lease/fence cannot begin.

Polling is only for observed lock/DB-time predicates and bounded health checks; sleeps are not the synchronization proof. No caller-controlled runtime clock was introduced. Existing 55-second statement / 35-second lock / bounded actor timeouts were not raised or weakened.

### Actual restart and separate same-epoch control

PG image postgres:17-bookworm; actual server 17.11 (Debian 17.11-1.pgdg12+2).

Separate control: fresh canonical prerequisites -> real C3c-3 migration -> postflight -> empty outbox, unused sequence and current singleton guard epoch -> real rollback SUCCESS. Exact prerequisite catalog/function/ACL/data snapshots are restored. The old full entrypoint's separate unused control also still executes before its runtime allocation.

Restart case: another fresh database receives the real migration and postflight. Outbox=0; sequence last_value=1/is_called=false; exactly one current-epoch guard. Record private snapshots and server system_identifier; ensure no live proof actor. Execute docker restart preserving the database/data directory; reconnect only after bounded pg_isready succeeds. Prove unchanged system_identifier and stored guard, with a new actual postmaster epoch. Attempt the real unchanged rollback and require exact SQLSTATE 55000 / C3c-3 server epoch guard mismatch. After refusal, empty/unused/guard checks and complete catalog/ACL/prerequisite/data/sequence snapshots match the pre-restart state: no partial drop/revoke/repair.

Fresh complete combined-run epochs (UTC):

- Stored guard before restart: 2026-10-26 15:33:42.743328+00.
- Actual postmaster after restart: 2026-10-26 15:37:32.189252+00.
- Inequality proved: YES. Stored metadata never edited.
- Refusal exact: YES. Partial changes: NO.

### Execution and fixture-only corrections

Focused additions PASS: 9 scenarios, 7 races. A separate freshly created PG17 environment then executed the unchanged original 57/18 suite followed by all new additions: 66 scenarios, 25 independent-session races, ALL current executable cases PASS; zero unexpected deadlocks/lock/statement/actor timeouts. Actual counts are summed only after parsing the original executed suite's PASS verdict, not from unexecuted scenario names.

Permitted proof-fixture corrections, all before the final fresh complete rerun:

1. Initial ledger append to pending-delivery authority correctly failed 23514. Fixed fixture ordering uses the real recorder to establish LIVE authority before append; successful enqueue case appends only afterward. Frozen admission/cleanup expectations did not change.
2. Restoring temporarily disabled fixture guards before deferred integrity events fired correctly failed 55006. Added SET CONSTRAINTS ALL IMMEDIATE before re-enabling guards, matching the existing disposable timeline-fixture pattern. All original guards are restored before authority RPCs.
3. Restart snapshot's to_jsonb(sequence alias) correctly failed 42809 because a sequence is not a composite table. An isolated temporary-sequence probe reproduced 42809; corrected only that snapshot query to explicit last_value/log_cnt/is_called fields. No authority behavior changed.
4. The temporary final-regression runner initially could observe initdb's transient Unix-only server. Its readiness probe now targets the real TCP postmaster inside the network-isolated container. Existing scripts and runtime timeouts were not changed. Local diagnostics are saved outside ephemeral WSL /tmp so host lifecycle cannot discard them.

Resources: focused fixture databases/backends were cleaned by the harness and shell traps; its container/volume was removed. Complete-run cleanup explicitly observed proof_databases=0 and other_clients=0 before stopping/removing only wincrm-c3c3-section36-full-20261026 and its disposable volume. The container restart is an executed proof, not simulated timestamp drift. No production fixture or published port was used.

### Broader frozen matrix reconciliation: additional unproven obligations

My earlier audit identified three missing cases but did not establish that they were the only missing obligations. This cycle closes exactly those three. It cannot justify all-section-36 PASS_COMPLETE. The following concrete additional omissions are demonstrable from executable call sites:

- Populated rollback refusal: the old maintenance loop calls rollback only on freshly installed databases modified by its nine listed tamper/dependency fixtures; none populates an outbox row. The new rollback calls are the empty same-epoch control and empty real-restart fixture. No C3c-3 populated rollback refusal executes.
- Used-but-purged rollback refusal: normal purge/no-resurrection tests execute, but no rollback is invoked in those used-then-empty databases. Aborted-allocation refusal is a different case and remains tested.
- Atomic maintenance lock-timeout proof: no C3c-3 test holds a conflicting maintenance lock and invokes this C3c-3 migration/rollback to assert the bounded refusal and unchanged target/guard/ACL/data state. Older C3c-2a's own lock-timeout proof does not execute C3c-3 artifacts.

Additional rows remain only partially evidenced by the current harness and must not be silently labeled complete:

| Section-36 row | Executed coverage | Unproven or incomplete explicit obligations |
| --- | --- | --- |
| Orphan | Valid committed challenge-only fixtures before enqueue; no runtime scanner/provider | Explicit orphan supersession under existing limits is not a dedicated executable case |
| Claim | Pending, due retry, non-due refusal, invalid batch bounds, SKIP LOCKED/concurrent claim | Actual multi-row DB batch ordering; preterminal unusable/deadline claim paths |
| Lease/fence | Fresh fence, stale fence begin refusal, prior retry finalization refused after claim | Independent stale UUID-only negative and claim versus stale-finalization race |
| Begin | Duplicate/concurrent begin, lifecycle, expiry, recovery and post-wait clock cases | Explicit lost/late acknowledgement contract-fixture assertions |
| Retry | Exact 5s/20s arithmetic, early refusal, new claim/begin, third-attempt exhaustion | Exact due-boundary execution is not separately established |
| Deadline/unusable | Separate deadline/unusable/budget paths and terminal scrub | Full simultaneous precedence combinations and exact full-window DB equality |
| Sender unavailable | Initial count-zero disposition, recorder and duplicate checks | Lease-expiry/new-claim races; complete retry-lease/SENDING refusal matrix |
| Duplicate resolution | Truthful terminal outcome duplicates/conflicts; retry duplicates before/after claim | Entire item-17 DB cross-product is not demonstrated by the smaller outcome fixture loops; TS mock-receipt coverage is not DB execution |
| Crypto-loss closure | Repeated no-begin count-zero/count-positive deadline closure | Full unusability variants after repeated loss are not separately executed |
| Purge/time authority | Every terminal state, pre/post retention, cleanup/finalize races, expired begin lock wait | Exact retention/expiry/full-window equality cases and lock waits crossing deadline/retention are not all executed |
| Direct owner DML/scrub | Representative immutable/state/context/truncate negatives and many terminal scrubs | Every forbidden transition/shape and every terminal source path is not exhaustively demonstrated |
| Sequence | Abort allocation refusal, exhausted fail-closed, cache/ACL tamper, large decimal fence | Independent concurrent successful allocations/abort-gap arithmetic and all owner/state tamper variants |
| Fingerprints | Full postflight, old/new FK trigger enabled tamper, cross-schema dependency/body callers | Dedicated target constraint/owner/ACL/body-drift refusal variants are not all executed |

These are proof-coverage findings, not claims that the runtime violates those semantics. The current authorization is expressly limited to adding three named cases; no extra runtime or harness corrections for the remaining rows were made. No request to change the frozen contract is implied. Final delivery requires either completing the exact remaining proof obligations under appropriate scope or independently establishing that specific existing executed assertions satisfy them. No historical PASS replaces an unexecuted required case. Stop before commit/push/PR/first hosted CI.

### Proof-only artifact byte evidence

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| test/postgres/every8dSettingsEmailOutboxSection36.py | 20013 | CDCF234276984606B522973C24318680A3A2CBEDE5D98E00A872EAB8B6A0042C |
| test/postgres/every8dSettingsEmailOutboxSection36.sh | 3475 | C1DF978AE71EEF51C1E19DD5931E7D490AF577DD424155E9C21CBFC56F661C53 |
| .gitattributes | 388 | EF00BC863A67A7CC53933A4EEB064BF6565719276C0F6AA226C71D9FC549E103 |
| .github/workflows/ci.yml | 6674 | 0B25A43A16927E723FA87B5BA5B053872B58BFF8DE129B2281E1AAAA61F3431E |

This cycle also changes this evidence log. All implementation/runtime files retain their previous-cycle bytes. No production dependency was added. Generated Python bytecode in the worktree was removed after execution; it is not a proof artifact.
### Final validation, resource and delivery snapshot for this cycle

All 11 existing DB regression scripts passed again after the fresh combined PG17 suite. They execute the unchanged baseline authority/proof objects using exact binary Git-object fixture files to avoid the already-diagnosed Windows checkout source-byte mismatch. Temporary shell execution copies use LF; committed SQL source bytes are not normalized. This is the same unchanged-script regression method documented in the preceding canonical-byte cycle. All final regression logs use fixed pass labels in the report; no protected row/payload contents are copied into evidence.

Final regression cleanup explicitly reported surviving_extra_databases=0 and other_clients=0; its EXIT trap removed only wincrm-c3c3-section36-regressions-20261026 and its disposable volume. Final Docker inventory for wincrm-c3c3-section36* returned no containers. The focused and complete containers were also removed. No surviving proof sessions, databases or task containers.

| Required report field | Final result |
| --- | --- |
| Authorized missing cases | All three execute and PASS; 9 added scenarios / 7 added races |
| Harness files | New Section36.py and Section36.sh; no edits to original harnesses |
| Other changed files this cycle | .github/workflows/ci.yml, .gitattributes, this run log |
| Runtime SQL / migration / rollback / TS changes | NO / NO / NO / NO |
| Enqueue/cleanup | All three legal orderings PASS; impossible simultaneous admission/cleanup eligibility documented; exact atomic 23503 FK refusal; final challenge/ledger/outbox/orphan counts all zero |
| Begin/recovery | Begin wins; recovery wins count 0 and count 1; actual expiry-crossing wait; all PASS, no stale send authority |
| PG17 version | 17.11; exact postgres:17-bookworm image |
| Post-restart proof | Actual new postmaster epoch; same data directory; exact 55000 refusal; no partial authority change |
| Separate same-epoch control | PASS, exact prerequisite restoration |
| Fresh complete current executable PG17 suite | 66 scenarios / 25 independent-session races; ALL PASS |
| Unexpected deadlocks/timeouts | Zero |
| Surviving proof resources | Zero databases/backends/containers |
| Original protected artifacts | 60/60 byte-identical; frozen SHA unchanged |
| Final focused application suite | 564/564 PASS; crypto 92 / repository 343 / recovery 23 / preparation 30 / remaining application 76 |
| Final existing DB regressions | 11/11 scripts PASS |
| Final typecheck | PASS |
| Final npm test | 1525/1525 PASS; zero failures/skips/cancellations |
| Final build | PASS |
| Diff whitespace check | PASS |
| HEAD / fetched origin/main | 0817596034b69c1badca2fdac1bf56b0490e4a3d |
| Commit / push / PR / hosted CI | None / none / none / not run |
| Working tree | Dirty; authorized implementation/proof/evidence drafts preserved; no staged commit |
| Production / sending / activation | NONE / NONE / NONE |
| C3c-4 / C3c-5 | NOT STARTED; NOT AUTHORIZED |

No actual runtime/rollback authority defect was demonstrated by the new proofs. The remaining blocker is incomplete mandatory frozen proof coverage beyond the three additions authorized in this cycle. User section B limits additions to those three, while section M requires all section-36 proof before delivery; that complete-matrix condition cannot truthfully be declared satisfied by the executed 66/25 harness. The reconciliation above makes the remaining scope concrete. No extra tests or authority corrections were added outside the narrow scope, and no PR/hosted CI was initiated. No production/provider/manual activation smoke test was run.

```text
C3C_3_THREE_AUTHORIZED_PROOF_CASES: PASS
C3C_3_SECTION36_COVERAGE: INCOMPLETE
C3C_3_LOCAL_PG17_PROOF: INCOMPLETE_FROZEN_MATRIX
C3C_3_IMPLEMENTATION: INCOMPLETE
C3C_3_PR: NOT_READY_FOR_REVIEW
PRODUCTION_CHANGES: NONE
C3C_4: NOT_AUTHORIZED
C3C_5: NOT_AUTHORIZED
```

NEXT_GATE: USER REVIEW OF THE REMAINING FROZEN EXECUTABLE-PROOF OBLIGATIONS.
STOPPED; no further correction or delivery action performed.
## Final authorized Section-36 proof-closure cycle: material-defect review stop

### Authority, plan and initial reconciliation

The latest human authorization permits every remaining Section-36 proof-only addition and requires immediate review stop on any actual runtime/rollback/ACL/fingerprint/state-machine/contract defect. No runtime correction is authorized. Pinned HEAD and freshly fetched origin/main remained 0817596034b69c1badca2fdac1bf56b0490e4a3d. Entry rehash matched all 60 original protected artifacts.

Before adding new tests, test/postgres/every8dSettingsEmailOutboxCoverageManifest.cjs verified the exact approved contract SHA and derived every matrix row directly from section 36, splitting every semicolon into a stable numbered obligation. It rejects an incomplete 25-area extraction. The resulting initial manifest, docs/every8d-c3c3-section36-coverage-initial.json, contains all 107 obligations with exact frozen wording, area, IDs, executable witness locations, execution status, expected authority outcome and evidence location. Initial counts: PASS 44 / MISSING 9 / PARTIAL 54. No PASS was inferred solely from source inspection: preserved PASS bindings were reviewed against the already executed fresh 66/25 log and actual assertions. Compound obligations remain PARTIAL until all parts have concrete executed witnesses.

The TDD skill was applied for proof slices at the seams explicitly authorized by the human: supported runtime wrappers, real apply/rollback, owner DML and independent-session snapshots. Its generic advice against DB side-channel assertions is superseded here by the human's explicit requirement for final DB authority snapshots. No new seam approval or runtime change was requested or inferred.

Affected files in this cycle: new test/postgres/every8dSettingsEmailOutboxCoverageManifest.cjs, new test/postgres/every8dSettingsEmailOutboxClosure.py, modified proof-only test/postgres/every8dSettingsEmailOutboxSection36.sh (adds isolated closure-slice dispatch), new initial/progress/execution JSON evidence, and this log. Existing original PG harnesses, all runtime SQL/rollback/migration/TS and the frozen contract remain unchanged. Proof-only rollback is removal of these additions/dispatch; no production or authority rollback occurred.

### Newly executed passing proof slices

| Scenario ID / group | Unique scenarios | Races | Actual assertions |
| --- | ---: | ---: | --- |
| rollback.populated | 1 | 0 | Fresh apply/postflight; supported enqueue creates one row/used fence; exact pre-use rollback refusal; populated row and catalog/function/trigger/ACL/prerequisite/guard/sequence snapshots unchanged |
| rollback.used_but_purged | 1 | 0 | Real enqueue/claim/begin/accepted finalize; existing full-timeline test fixture satisfies retention; real purge removes child; sequence remains genuinely used; guard/epoch/sequence never reset; real rollback refuses atomically |
| maintenance.apply_timeout / rollback_timeout | 2 | 2 | Actor A holds ROW EXCLUSIVE on the exact first quiescent prerequisite relation; Actor B runs the real artifact and is observed waiting for SHARE ROW EXCLUSIVE; frozen five-second lock_timeout produces exact expected 55P03; zero partial create/drop/grant/revoke/guard/sequence/prerequisite/row changes; later clean apply/postflight/rollback succeeds and restores exact baseline |
| sequence.concurrent_and_fresh_generation | 1 | 1 | Two physical open allocating transactions both complete before either commits; actual outbox RowExclusiveLocks observed; distinct increasing fences; fresh real claims use new UUID/generation; UUID-only, fence-only and prior tuples return zero and preserve row |
| sequence.aborted_gap | 1 | 0 | Supported enqueue allocates then transaction rolls back; row absent, sequence use retained; later supported enqueue gets next fence, never reused; guard unchanged |
| sequence.tamper_properties / owner / acl / state | 4 | 0 | Real disposable administrative tamper; definition/owner/ACL postflight refusal; observable initial-state drift; real rollback refusal for every variant; no partial change or repair |
| fingerprint.constraint / owner / acl / body | 4 | 0 | Actual disposable constraint, function-owner, ACL and literal stored-body drift; full postflight and real rollback refuse each; exact tampered catalog/ACL/guard/sequence/row/prerequisite snapshots unchanged |
| claim.deadline / unusable | 2 | 0 | Ineligible claim returns zero with unchanged row; separate recovery terminalizes EXPIRED/CANCELLED, counts zero, full scrub and no recorder invention |
| claim.batch_order / bounded_skip | 2 | 1 | Three real equal-availability jobs; actual bounded secondary UUID order; invalid bounds refuse atomically; exact remaining candidate handling; separate holder/claimer proves bounded SKIP LOCKED without refill or mutation, followed by successful post-release claims |
| Total passing unique scenarios | 18 | 4 | No unexpected deadlock/statement/actor timeout |

These counts are unique final slice cases, not the sum of repeated harness-development invocations. Two expected bounded maintenance lock timeouts are successful negative proofs, not unexpected runtime timeouts. No existing timeout was increased. No failed test was ignored or converted to a warning.

The used-but-purged test uses only the existing authorized shift_job full-timeline fixture after real terminalization. It moves timestamps coherently to make actual 24-hour retention and challenge expiry true before calling the unchanged real purge. It does not set a caller runtime clock, weaken retention predicates, reset the sequence, alter the installation guard or repair metadata.

### Proof-only expectation corrections before the actual defect

1. The first sequence-state-tamper variant expected the metadata postflight to reject a changed current sequence value. That was too broad: section 34 specifies definition/owner/ACL/guard metadata and fresh-apply unused invariants; section 35 gives guarded rollback the untouched-initial-state condition. The corrected test observes the explicit value drift and requires the real rollback refusal with the drift preserved. No runtime behavior changed.
2. The first claim-ineligibility variant expected claim itself to terminalize. Section 13 permits skipping ineligible rows and returning zero; terminal closure is separately handled by recovery/begin. The corrected proof requires claim zero plus an identical row snapshot, followed by separate actual recovery and scrub assertions. No frozen outcome was relaxed or reinterpreted to permit send authority.

Both corrected groups subsequently passed. These were new harness expectation mistakes, not runtime corrections. All expected outcomes continue to come from the unchanged frozen contract.

### ACTUAL material defect: owner terminal transition accepts sender-unavailable from SENDING

Executable scenario: direct_owner.sending_sender_unavailable, in test/postgres/every8dSettingsEmailOutboxClosure.py, method direct_owner_sender (line 298 at diagnosis).

Valid premise:

- Fresh disposable PG17 fixture with canonical prerequisites, real C3c-3 migration and postflight.
- Job created only through supported enqueue -> claim -> begin authority.
- Actual source state SENDING, attempt_count 1.
- Ordinary non-superuser common migration/table owner c3a_migration_owner, using the same explicit SET ROLE fixture boundary as the other authority proofs.
- All outbox/challenge triggers enabled normally. No trigger/constraint disabled, no superuser mutation, no sequence/guard/catalog reset in this failing case.

Passing public-RPC control: runtime_finalize... with sender_unavailable input on this SENDING row returns zero, and the complete source row snapshot remains unchanged. The defect is not a demonstrated failure of the supported service_role RPC or an external HTTP/provider exploit.

Failing ordinary-owner mutation: inside a real transaction set only the existing operation context to finalize, then request FAILED_TERMINAL with terminal_disposition sender_unavailable_pre_send, resolution_kind pre_send, provider outcome NULL, pre-send sender_unavailable, non-acceptance false, current lease/fence/attempt resolution tuple, one DB clock timestamp for resolved_at/terminal_at, and challenge_recording not_recorded. Expected: protection refuses the source-state/classification mismatch (23514) and preserves SENDING. Actual: UPDATE and COMMIT succeed.

Safe observed result:

```text
supported_rpc_refused = true
source_state = SENDING
source_attempt_count = 1
owner_operation_context = finalize
guards_enabled = true
trigger_or_constraint_disabled = false
actual_state = FAILED_TERMINAL
actual_attempt_count = 1
actual_terminal_disposition = sender_unavailable_pre_send
actual_resolution_kind = pre_send
forbidden_update_committed = true
lease_cleared = true
payload_scrubbed = true
```

No job/challenge ID, lease UUID, fence value, token hash, recipient, OTP, key, ciphertext or AAD is included in this evidence. Only fixed vocabulary, counts and booleans are preserved.

Frozen requirements: section 6's transition-authority table assigns pre-send sender-unavailable terminalization to LEASED, while SENDING -> FAILED_TERMINAL belongs to rejected/exhausted provider resolution. Section 19 line 963 states, "Only valid current LEASED authority may use it." Section 36 requires SENDING refusal and every forbidden owner transition/invalid terminal update. An active SENDING attempt must not be relabeled as never-sent merely by selecting pre-send metadata.

Exact cause in unchanged runtime authority:

- Migration lines 484-487 accept operation=finalize with old.state=SENDING and new.state in ACCEPTED/FAILED_TERMINAL/DELIVERY_OUTCOME_UNKNOWN. This branch does not prohibit sender_unavailable_pre_send/pre_send metadata for the SENDING source. The alternative LEASED branch checks that disposition, but the earlier SENDING branch is broader.
- Lines 492 onward permit terminal/resolution metadata changes and perform the required automatic scrub/lease clearing.
- The resolution CHECK at line 326 validates the resulting pre_send tuple and FAILED_TERMINAL/sender_unavailable_pre_send shape. A CHECK sees the new row, not the old source state, so it cannot close this transition-provenance gap alone.
- The owner core's supported finalize path correctly enforces LEASED; the ordinary owner transition guard does not enforce the same closed source/disposition relationship.

This is a demonstrated direct-owner state-machine guard counterexample, with supported RPC behavior explicitly distinguished. It does not assert production exposure or that application roles have table DML privileges. Human section S requires diagnosis/evidence and STOP rather than repairing runtime authority. No runtime SQL or trigger/constraint correction was made, and the failing proof/expected rejection remains intact for independent review.

### Coverage progress and certificate status at mandatory stop

Machine-readable evidence:

- docs/every8d-c3c3-section36-coverage-initial.json: original full 107-obligation matrix extraction and entry classifications.
- docs/every8d-c3c3-section36-coverage-progress.json: all 107 original obligations retained, bound to old/new executed witnesses, with the direct-owner counterexample attached to S36-077.
- docs/every8d-c3c3-section36-execution-progress.json: sanitized actual slice receipts, owner counterexample and separately identified passing supported-RPC control.

Current diagnostic counts: PASS 57 / MISSING 3 / PARTIAL 47. Thirteen previously missing/partial obligations now have complete named witnesses. The three still MISSING are explicit orphan supersession under limits, ambiguous begin acknowledgement, and late begin acknowledgement after provider deadline. PARTIAL includes the demonstrated owner counterexample and unexecuted remaining compound cases, including terminal-path and time-equality work. The batch proofs are retained as partial for full bounds closure because valid maximum batch-size 10 was not executed before stop. The full administrative-drift reconciliation is also not overstated from the eight executed variants.

Current-cycle unique attempted scenarios=19; fully passing scenarios=18; failed scenarios=1; independent-session races=4. The passing supported-RPC control is a subcase of the failing owner-negative scenario, not an additional counted scenario. No final SECTION36_MISSING=0/PARTIAL=0 certificate is produced. The progress artifact is explicitly not a closure certificate.

### Required report snapshot

| Area | Latest actual result |
| --- | --- |
| Initial complete matrix reconciliation | 107 obligations: 44 PASS / 9 MISSING / 54 PARTIAL |
| Newly added unique proof scenarios | 19 executed; 18 PASS / 1 actual guard counterexample; 4 races |
| Newly fully completed obligations | 13 |
| Current matrix status | 57 PASS / 3 MISSING / 47 PARTIAL; certificate NOT produced |
| Fresh unused rollback | PASS preserved from 66/25; clean controls also pass after both current maintenance timeout cases |
| Populated rollback refusal | New PASS; no partial drop/revoke/state change |
| Used-but-purged refusal | New PASS; used sequence remains authoritative despite empty outbox |
| Aborted allocation | New supported enqueue gap/no-reuse PASS; prior explicit rollback refusal preserved |
| Dependency/body-reference refusal | Prior 66/25 PASS preserved; no new complete-suite rerun |
| Administrative drift | New sequence/fingerprint variants PASS; complete area still PARTIAL |
| Apply / rollback lock timeout | New PASS / PASS; exactly expected frozen 5s refusal and unchanged authority |
| Post-restart / same-epoch proof | Prior actual-restart and separate-control PASS preserved |
| Sequence behavior | Concurrent allocation, abort gaps, fresh generation/stale rejection and tamper variants PASS; prior exhaustion/large-decimal proof preserved |
| Fingerprint behavior | New constraint/owner/ACL/body drift refusals PASS; prior FK/internal-trigger/postflight evidence preserved |
| Direct owner DML | FAIL: ordinary owner SENDING -> pre_send sender-unavailable classification committed with guards enabled |
| Complete terminal scrub matrix | Incomplete at stop; passing paths preserved; invalid classification nevertheless scrubs in the counterexample |
| Complete time-equality/post-wait matrix | Incomplete at stop; prior real expiry/post-lock cases preserved; no new caller-controlled runtime clock |
| Latest complete PG17 harness | Prior 66 scenarios / 25 races PASS preserved; updated complete closure run NOT REACHED |
| Current unexpected deadlocks/timeouts | Zero; two expected maintenance lock timeouts counted separately |
| Surviving current proof resources | Zero; per-pass checks reported zero proof DBs/other clients, failing harness reported zero backends, all runner traps removed their container and disposable volume, final inventory empty |
| Protected artifact rehash | 60/60 byte-identical after defect |
| RUNTIME_SQL_CHANGED | NO |
| TYPESCRIPT_RUNTIME_CHANGED | NO |
| FROZEN_CONTRACT_CHANGED | NO; exact SHA C3FF909BC66FB19398694CB16CC1AD07505E68C2603E73E780C67EAA83C0AEBA |
| Final DB regressions / focused app / typecheck / npm test / build | NOT RUN after current proof edits because section S stop fired; prior 11/11 / 564/564 / PASS / 1525/1525 / PASS preserved |
| HEAD / fetched origin/main | 0817596034b69c1badca2fdac1bf56b0490e4a3d |
| Commit / push / PR / first hosted CI | None / none / none / not run |
| Hosted conclusions | None |
| Working tree | Uncommitted implementation/proof/evidence preserved; not ready for delivery |
| Production / activation / provider sending | NONE |
| C3c-4 / C3c-5 | NOT STARTED; NOT AUTHORIZED |

No full fresh Section-36 closure run or final npm/regression rerun is claimed after the new defect. The mandatory stop supersedes continuation, and no historical PASS is substituted for the incomplete final gates.

```text
C3C_3_SECTION36_COVERAGE: INCOMPLETE
C3C_3_IMPLEMENTATION: INCOMPLETE
C3C_3_PR: NOT_READY_FOR_REVIEW
PRODUCTION_CHANGES: NONE
C3C_4: NOT_AUTHORIZED
C3C_5: NOT_AUTHORIZED
```

NEXT_GATE: INDEPENDENT REVIEW OF THE DIRECT-OWNER SENDING/PRE-SEND TERMINAL TRANSITION GUARD COUNTEREXAMPLE.
STOPPED; no authority correction or further proof/delivery execution.