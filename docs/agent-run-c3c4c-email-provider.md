# C3c-4c-1 unregistered Resend adapter run log

## Task and exact base

- Task and authority: C3c-4c-1 only, per the pasted implementation authorization.
- Repository: `hugolamcloser/win-crm.ai-lineconnect`.
- Base: `ba03020684ac626af7e65ec67ee9cfa1d3cc273b`. Freshly fetched `origin/main` and `FETCH_HEAD` matched.
- Branch: `codex/c3c4c1-resend-adapter-foundation`, created in a new clean Codex-managed worktree at the exact base.
- Base CI: [CI #140, run 41994845997, attempt 1](https://github.com/hugolamcloser/win-crm.ai-lineconnect/actions/runs/41994845997/attempts/1). GitHub reported it as the latest main run. Its head matched the base and `validate`, `postgres-concurrency` and `postgres-email-outbox` succeeded.
- Date: 2026-11-12, Asia/Kuala Lumpur.

## Scope and risk

The plan before editing used the pasted C3c-4c contract, the repository AGENTS and run-log template, and the frozen C3c-4a/4b run logs and source. The finished adapter was also checked against the C3c-3 outbox and settings-auth contracts. Resend's published endpoint, error and idempotency documentation confirmed the status/name combinations and provider key bound. The slice adds a pure parser and an unregistered, explicitly constructed adapter. It assumes the frozen engine supplies the rendered plaintext, canonical sender, recipient, exact idempotency key and original monotonic deadline.

The main risks were an extra POST, unsafe delivery inference, missed cancellation and sensitive diagnostics. The adapter uses one fixed one-use HTTPS request, bounded streamed evidence, a single result settlement and a payload-free fatal observer. The test transport traps external network entry. Exact request values are asserted without printing them. A regression verifies that an observable Content-Length contradiction latches fatal before a later interruption.

## Changed files

| File | Change |
| --- | --- |
| `src/config/every8dSettingsEmailResend.ts` | Pure byte-bounded parser with a fixed value-free error |
| `src/services/every8dSettingsEmailResendProvider.ts` | Frozen unregistered adapter, fixed HTTPS destination and closed evidence |
| `test/every8dSettingsEmailResendConfig.test.cjs` | Credential shape, preservation and canary tests |
| `test/every8dSettingsEmailResendProvider.test.cjs` | Network-free request, response, timing, cleanup and canary tests |
| `docs/every8d-c3c4c-resend-provider-contract.md` | Frozen request, response, fatal and activation boundaries |
| `docs/agent-run-c3c4c-email-provider.md` | Validation, scope and rollback evidence |

## Validation

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | 1,878 PASS, zero failures, skips or cancellations. Base 1,756 plus 122 focused Resend cases |
| `npm run build` | PASS |
| `node --test test/every8dSettingsEmailResendConfig.test.cjs` | 22 PASS |
| `node --test test/every8dSettingsEmailResendProvider.test.cjs` | 100 PASS |
| `node --test test/every8dSettingsEmailWorker.test.cjs` | 68 PASS |
| `node --test test/every8dSettingsEmailWorkerLifecycle.test.cjs` | 66 PASS |
| `bash test/postgres/every8dSettingsEmailWorker.sh` | PG17, 8 of 8 real-repository scenarios PASS |
| `bash test/postgres/every8dSettingsEmailWorkerLifecycle.sh` | PG17, 6 of 6 real-repository scenarios PASS |
| `bash test/postgres/every8dSettingsEmailOutboxSection36.sh` | PG17, 107 of 107 obligations PASS, 213 scenarios and 47 races |
| Pinned prerequisite database regressions within the C3c-3 proof | 11 of 11 PASS |
| Protected path comparison against the exact base | All 288 pre-existing tracked paths, including all 44 SQL files, match the base. Only the six paths above were added |

Local application validation used Node 24 and the existing lockfile. The PostgreSQL proof ran in a new disposable PG17 container with Docker networking disabled and synthetic fixtures. The scratch runner used CRLF-normalized copies of the unchanged shell scripts and stored output in ignored `.temp`. Earlier runner invocations produced empty logs and then hit the disposable-container naming guard. Neither was counted. The full proof's generated coverage artifact was retained in scratch and the protected tracked certificate restored to the exact base bytes.

The draft PR carries the automatic implementation-head CI evidence, including its SHA, attempt and all three required jobs. Recording that run in PR metadata keeps the validated commit fixed. The implementation gate ends at independent C3c-4c-1 review.

## Production and rollback

The production provider registry is empty. C3c-4c-2 activation, credential pre-gating and lifecycle bridging are outside this slice. Database authority, worker/config/lifecycle, flags, package files, CI wiring and production Railway configuration remain at their existing state. Zero real credentials, provider requests, live mail, production access, migrations, deployment or merge were used. Live-provider and production smoke tests are outside the approved proof.

Revert the focused commit to remove the adapter, parser, tests and documents. No database, deployment, credentials or environment rollback is required. The draft branch and managed worktree are retained.

## C3c-4c-1 R2 correction

The user authorized one bounded correction cycle on draft PR #122. Before editing, GitHub reported OPEN, DRAFT, UNMERGED and MERGEABLE, one commit and six changed paths. Remote main and the PR base were `ba03020684ac626af7e65ec67ee9cfa1d3cc273b`. The clean branch and PR head were `7a444208b8758c469a3f3effd21e33f2f3be2ff0`. The existing managed worktree and original commit were retained.

The independent implementation review returned zero R1 findings and five R2 findings. The independent transport-contract review approved the connected TCP socket followed by a TLS wrap on that socket and a bounded HTTP/1.1 subset. The correction follows both review gates:

| Finding | Correction and proof |
| --- | --- |
| R2-1, zeroing bytes while Node can still own them | Transfer one request buffer to the exact TLS write callback. Held-callback tests cover early acceptance, abort, deadline and socket error before release. |
| R2-2, Authorization and Idempotency-Key exposed through Node HTTP surfaces | Connect through net and wrap with tls on the connected socket. Native ordinary HTTPS exposes both positive-control canaries. The revised path emits no HTTP client diagnostic or HttpClient performance entry, publishes only the plain TCP socket through net.client.socket, and delivers exact synthetic bytes to the TLS peer. |
| R2-3, reconstructed headers do not prove the received limit | Count up to 16,384 actual wire octets through the terminating CRLFCRLF before normalization. Test 16,384 and 16,385 with large leading and trailing OWS and split reads. |
| R2-4, unsupported transfer coding and trailers can influence evidence | Require one explicit Content-Length or single chunked coding with bounded metadata and an empty trailer section. Test segmentation, EOF, conflicting/unsupported framing and surplus discard. |
| R2-5, statusCode rounds to apparently exact integer | Validate the entire bounded JSON structure at depth up to 64. Compare the original statusCode token to the three ASCII HTTP status digits. Tests cover rounded fractional forms, alternate lexical forms and decoded duplicate keys. |

Changed paths are the new `src/services/every8dSettingsEmailResendTransport.ts` and updates to `src/services/every8dSettingsEmailResendProvider.ts`, `test/every8dSettingsEmailResendProvider.test.cjs`, `docs/every8d-c3c4c-resend-provider-contract.md` and this log. The main risks are request buffer ownership, native diagnostic confidentiality and ambiguous responses accidentally strengthening durable outcomes. The production registry remains empty, so the revised transport has no worker call site. The first native run exposed the test harness's literal-loopback bind dependency on dns.lookup. The test permits a synthesized literal response only and still blocks external DNS and connections. The local Windows sandbox also denied loopback, so the passing native proof ran with loopback available and the same test network guard.

### Corrected-state proof

| Check | Result |
| --- | --- |
| `npm run typecheck`, `npm test`, `npm run build` | PASS on Node v22.23.5, 2,000 tests with zero failures, skips or cancellations |
| Focused Resend config and provider tests | 22 and 222 PASS |
| Focused C3c-4a engine and C3c-4b lifecycle tests | 68 and 66 PASS |
| Native TLS loopback on Node v22.23.5 | Trusted certificate with and without ALPN passes. Wrong hostname, untrusted and expired certificates fail before an HTTP write. Abort/deadline at TCP entry and during a TLS stall produce unknown. Exact one TCP connection, TLS wrap and HTTP write on the success path. |
| Disposable PG17 worker and lifecycle | 8/8 and 6/6 PASS |
| Full C3c-3 proof and pinned prerequisite regressions | 107/107 obligations across 213 scenarios and 47 races. All 11 pinned regressions PASS. |
| Exact file equality | 290 pre-correction paths outside the scope match the reviewed head. All 288 main-base paths match, including 44/44 SQL files. The PR contains seven additions relative to main. |

The first corrected-head automatic CI and exact Node 22 runtime evidence are recorded in the draft PR description to keep the successfully checked commit fixed. A revert of the single correction commit restores the prior draft implementation. No dependency, credential, registration, worker bridge, database change, Railway action, production access, Resend connection, live email, manual CI rerun or merge was used. The next gate is independent C3c-4c-1 R2 rereview.

## Status-level fatal observation correction

Independent re-review of `7b6a60f05091502e37ff077c0ad2874376ddcc6e` reported zero R1 findings and one new R2. The original five R2 findings were independently closed. Before editing, PR #122 was open, draft, unmerged and mergeable with two commits and seven changed paths. Its base and fresh remote main were `ba03020684ac626af7e65ec67ee9cfa1d3cc273b`. The local and remote branch heads matched the reviewed commit and the managed worktree was clean.

The parser used to report status-based provider health only after parsing the full header block. A valid fatal status could therefore lose its notification when a later field was malformed or when the peer closed early. The correction adds a void notification immediately after a valid bounded final status line has been recognized within the original deadline. Only 201–299, 300–399, 401, 403, 404 and 405 have status-only fatality. The existing complete-header, body-framing and provider evidence paths still own delivery results. The parser checks its stopped state after the notification, since the observer can synchronously abort and dispose the parser.

The transport and provider changes are limited to that boundary. The provider test suite adds 44 cases for malformed and interrupted headers, reentrant abort, nonfatal and body-dependent statuses, invalid status lines, the original deadline and complete authentication evidence. The 25 targeted regressions of the reported defect failed against the reviewed head before implementation. The coalesced reentrant tests observe zero byte reads after the status when the fatal observer aborts, one request write, one fatal notification with zero arguments and resource cleanup. The prior five R2 proof designs remain in place.

| Final local check | Result |
| --- | --- |
| `npm run typecheck`, `npm test`, `npm run build` | PASS on Node v22.23.5. All 2,044 npm tests passed with zero failures, skips or cancellations. |
| Focused Resend config and provider suites | 22 and 266 PASS |
| Focused C3c-4a engine and C3c-4b lifecycle suites | 68 and 66 PASS |
| Disposable PG17 worker and lifecycle | 8/8 and 6/6 PASS |
| Full C3c-3 and pinned prerequisites | 107/107 obligations, 213 scenarios, 47 races, 11/11 prerequisite regressions PASS |
| Git blob equality | All 290 paths outside the correction scope match the reviewed head. All 288 main-base paths, including 44/44 SQL files, match byte-for-byte. The PR still changes seven files. |

The final automatic CI run and exact-head results are recorded in the draft PR description so the checked commit stays fixed. The production registry remains empty and both worker integration bridges remain outside this slice. No dependency, credentials, live email, external Resend network, database change, production access, Railway action or merge. Revert the single correction commit to restore the reviewed head. The next gate is independent C3c-4c-1 final rereview.

## C3c-4c-2 source integration

On 2026-11-16 (Asia/Kuala_Lumpur), fetched `origin/main` for `hugolamcloser/win-crm.ai-lineconnect` and verified exact base `9889a292e47cf9514950ce62fc39309d220ddd54`, the squash merge of PR #122. [CI #144, attempt 1](https://github.com/hugolamcloser/win-crm.ai-lineconnect/actions/runs/43858820827/attempts/1) was a push on that SHA and all three required jobs passed. Created a new managed worktree and branch `codex/c3c4c2-resend-integration-bridge` at that SHA. The C3c-4c-1 worktree was retained separately.

| Source file | Integration |
| --- | --- |
| `src/config/every8dSettingsEmailWorker.ts` | Pure validation of the optional supplied Resend key before the disabled gate. A malformed value raises the fixed worker configuration error. The worker config carries no Resend credential. |
| `src/services/every8dSettingsEmailProviderRegistry.ts` | The sole static frozen source registration is `resend`. Local readiness requires the key when Resend is selected and holds it privately for network-free client construction. |
| `src/workers/every8dSettingsEmailWorkerProcess.ts` | The zero-argument callback latches process failure before checking whether the first stop already owns shutdown. A fatal during provider construction prevents further startup. |
| `src/workers/every8dSettingsEmailWorkerRuntime.ts` | A first provider-fatal stop immediately closes admission and drains with the original send deadlines. Ordinary stops still abort the batch immediately. The existing 20-second drain aborts remaining tracked controllers if it expires. |
| `src/workers/every8dSettingsEmailWorkerTelemetry.ts` | Fixed `provider_fatal` stop reason on existing lifecycle events. |

The principal integration risk is replacing a result that arrives after the callback with cancellation-derived unknown. The fatal drain keeps admitted signals active until their original deadlines, permits finalization and preserves the first stop mode. The callback carries no delivery evidence. Tests cover accepted, authoritative non-acceptance and unknown outcomes, ten active submissions, subsequent admission refusal, deadline and drain bounds, and process exit 1 after both clean and expired fatal drains. Registry and startup tests trap construction-time I/O and use synthetic credentials.

### C3c-4c-2 validation

| Local check | Result |
| --- | --- |
| `npm run typecheck`, `npm test`, `npm run build` | PASS on Node v24.14.0. All 2,065 tests passed with zero failures, skips or cancellations. |
| Focused worker config, registry and worker lifecycle | 26, 4 and 83 PASS |
| Focused Resend config, Resend provider and C3c-4a engine | 22, 266 and 68 PASS. All 469 focused tests also passed on Node v22.23.5. |
| Disposable PG17 worker and lifecycle | 8/8 and 6/6 PASS |
| Full C3c-3 proof and pinned prerequisite regressions | PG 17.11, 107/107 obligations PASS across 213 scenarios and 47 races, with 11/11 pinned prerequisite regressions PASS. |
| Protected files | All 285 paths outside the 10-file integration scope match the base, including 44/44 SQL files. |

The C3c-4a engine, Resend credential parser, provider and transport, package files, CI workflow and database authority stay frozen. The PG17 proof uses a disposable local container with networking disabled. Generated proof output stays in ignored scratch space.

Static source registration leaves live email unavailable without the runtime flags, real credentials and deployment. The work uses synthetic keys and local tests. It includes no external Resend test, live email, production credential, database migration, Railway change or deployment. Reverting the integration commit restores the prior configuration, registry and lifecycle. No infrastructure rollback is needed. Automatic CI evidence belongs with the draft PR on the checked implementation SHA. The next gate is independent C3c-4c-2 implementation review.

## C3c-4c-2 R2 correction

On 2026-11-17 (Asia/Kuala_Lumpur), verified draft PR #123 was open, unmerged and mergeable with one commit and ten changed files. The fetched main and PR base matched `9889a292e47cf9514950ce62fc39309d220ddd54`. The clean local branch and PR head matched `9a61c8777ea738ff520dae45e14d3c326ebd6f84`. All three required jobs passed on that head in [CI #145, attempt 1](https://github.com/hugolamcloser/win-crm.ai-lineconnect/actions/runs/43878819716/attempts/1).

| Finding | Correction and regression proof |
| --- | --- |
| R2-1, forced drain retained provider ownership | Normal settlement and forced expiry share an idempotent release. Forced expiry transitions to stopped before canceling runtime-owned provider deadlines, detaching input listeners, deleting tracking, and aborting transports. It abandons wrappers without a result. Tests withhold the original timers, inspect runtime ownership at completion, manually invoke queued callbacks, and exercise late fulfillment and rejection. The engine's original deadline and cancellation registration are still observable after forced runtime completion, demonstrating that no wrapper result was forwarded. |
| R2-2, construction accepted invalid fatal callbacks | The readiness factory rejects non-functions with the fixed configuration error before the lazy provider import. A CommonJS test traps provider imports and attempts to send, use I/O or schedule a timer, and verifies that the valid callable is passed unchanged. |

All three targeted regressions failed against the reviewed head and passed after correction. The primary risk was weakening the original deadline or signal-first cancellation. Both continue through the existing normal settlement path. This correction modifies only the two affected source files, their test files, and the two existing C3c-4c documents.

| Local check | Result |
| --- | --- |
| npm typecheck, test and build | PASS. 2,067 tests passed on Node v24.14.0 with zero failures, skips or cancellations. |
| Focused registry, lifecycle and worker config | 4, 85 and 26 PASS on Node v22.23.5. |
| Focused Resend config, provider and C3c-4a engine | 22, 266 and 68 PASS on Node v22.23.5. |
| Disposable PostgreSQL proof | PG17 worker 8/8, lifecycle 6/6, full C3c-3 107/107 obligations across 213 scenarios and 47 races, and 11/11 pinned prerequisite regressions. |
| Protected file comparison | Six authorized correction paths and ten PR paths. All 44 SQL files match both the reviewed head and main. |

The correction uses synthetic keys and local proofs. The frozen C3c-4a engine, C3c-4c-1 parser, provider and transport, and database authority retain their exact Git blobs. Revert the single correction commit to restore the reviewed head. No infrastructure rollback is needed. Automatic CI evidence is recorded in the draft PR description to preserve the checked commit. The next gate is independent C3c-4c-2 R2 rereview.
