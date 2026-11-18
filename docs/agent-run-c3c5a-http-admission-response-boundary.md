# Agent run log for C3c-5a HTTP admission and response boundary

## Task identification

- GitHub task requested in the C3c-5a implementation brief
- Approved branch `codex/c3c5a-http-admission-response-boundary`
- Exact base `109ebfc879936918e81eb94d6654853cc7bdfae9`
- Level 3, limited to the unmounted C3c-5a slice
- Started and updated 2026-11-17

## Task objective

Implement the settings-auth HTTP configuration, request admission, body and response boundary, and prove it with an isolated Node/Express harness. The independent implementation review follows local validation and automatic PR CI.

## Files inspected

| File | Relevant finding |
| --- | --- |
| `docs/every8d-c3c-settings-auth-contract.md` | Freezes the eight public endpoints, separate HTTP and worker gates, and HTTP security and cookie authority. |
| `src/config/every8dSettingsAuth.ts` | Existing flag grammar treats absence, empty string and literal `false` as disabled. |
| `src/app.ts`, `src/server.ts` | The application entry points and middleware order are protected in this slice. |
| `.github/workflows/ci.yml` | Node 22 validation, PostgreSQL concurrency and PostgreSQL email outbox are separate jobs. |

## Evidence and decisions

- Fetched remote `main` and verified the exact base and local/remote branch availability. Baseline CI #147, run 44010238256, attempt 1, was a successful push run. All three required jobs passed and the validate job recorded Node v22.23.4.
- On Node v22.23.4 with default `maxHeadersCount = null`, the harness received 1,998 raw entries at 999 fields and 2,000 entries at 1,000 fields. The boundary rejected the saturated request with fixed application 400 before reading its body. At 1,001 fields, Node returned 431 before the request callback.
- Framing validation uses individual values as delivered in `IncomingMessage.rawHeaders`. The native parser consumes surrounding header-line optional whitespace. Native parser tests distinguish rejected field syntax from delivered syntax such as `Content-Length: 00` and unsupported transfer codings.
- The socket proofs held multiple waiters through body completion and owner response finish, resumed them in order after reusable 204 and 400 responses, and blocked them on overflow, unread-body rejection, late non-reuse and premature close. The finish callback uses the captured request socket because Node detaches the response socket during finish.
- The internal dispatch seam uses synthetic handlers only. Verify envelopes contain the OTP string. The contract assigns the request capability to the purpose-specific pending cookie. Tests use synthetic input and local loopback.

## Approaches attempted

The initial framing test expected Node to reject an identity transfer coding before dispatch. A native loopback probe on v22.23.4 demonstrated delivery. The corrected test asserts the fixed application 400 for this coding and the native 400 for invalid or duplicate Content-Length and for simultaneous Content-Length and Transfer-Encoding.

## Files changed

| File | Change |
| --- | --- |
| `src/config/every8dSettingsAuthHttp.ts` | Strict public origin and HTTP gate configuration. |
| `src/middleware/every8dSettingsAuthHttp.ts` | Raw request-target classification, exact dispatch, framing and media admission, socket gate, fixed responses and telemetry. |
| `src/middleware/every8dSettingsAuthJson.ts` | Bounded fatal UTF-8 decoding and flat string-object tokenization. |
| `test/every8dSettingsAuthHttpBoundary.test.cjs` | Isolated Express harness and raw loopback proofs. |
| This run log | Validation and scope evidence. |

## Validation summary

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass on Node v22.23.4 |
| `npm test` | 2,083 passed on Node v22.23.4 |
| `npm run build` | Pass on Node v22.23.4 |
| `node --test test/every8dSettingsAuthHttpBoundary.test.cjs` | 16 passed on Node v22.23.4 |

The new boundary has no production import or mount and uses no database or provider calls. Production and live-message smoke tests are outside this slice.

## Budget and stop-rule status

Two implementation correction loops addressed the framing test and made late duplicate response error notifications harmless after gate settlement. No reviewer correction loop ran. The next gate after automatic PR CI is independent C3c-5a implementation review.

## Independent review correction, 2026-11-18

PR #124 was pinned to base `109ebfc879936918e81eb94d6654853cc7bdfae9`, reviewed head `39f3c42d5a1e1bccc11cebed9e14b2054d682bb2` and tree `d40a8cb4cd5970654d0472715112855e7704902b`. The fetched refs and PR metadata matched. CI #148, run 44093919196, attempt 1 passed all three jobs at the reviewed head.

| Finding | Correction and proof on Node v22.23.4 |
| --- | --- |
| R2-1 | Empty HTTP(S) authority and literal fragment shadows are ownership-only. Raw loopback requests show native delivery, local 404 and zero dispatch or downstream calls for protected spellings. Genuine neighbors reach downstream. |
| R2-2 | Exact GETs dispatch without reading a body for absent length or length zero. Positive length, chunked framing, and an incomplete body receive a local 400 with connection close. A declared oversize receives 413. None starts a data reader or reaches a follower. |
| R2-3 | Delivered framing errors take precedence after saturation. The test matrix covers exact enabled and disabled routes, claimed aliases and absolute forms, with queried valid-framing controls. |
| R2-4 | Built-in IDNA conversion preserves canonical `xn--bcher-kva`. The noncanonical fixture `xn---bga` decodes to `œ` and re-encodes to `xn--bga`. The invalid fixture `xn--a` decodes to an empty string. Both malformed fixtures fail even when either feature flag disables the boundary. |
| R2-5 | Represented success and 204 clear incompatible staged headers and preserve intentional cookies. Synchronous and asynchronous fallback errors clear provisional headers and retain the required connection close. |

Typecheck and build passed. The repository suite passed 2,089 tests, and the focused suite passed 22 tests, including six new correction proofs. The correction covers the two HTTP modules, focused test, and this run log. The boundary is still unmounted and the JSON parser file is unchanged. Production and browser smoke tests are outside this slice. One reviewer correction cycle was used. The corrected head requires independent re-review after automatic CI.

## Second review correction and public-origin scope decision

PR #124 remained at base `109ebfc879936918e81eb94d6654853cc7bdfae9`, reviewed head `9d469412cf28ff83f3d85bb0bcd48c51bfd028f8`, and tree `3419fafb243364ce8ae31704f552bcbeb4fe4e9f`. CI #149, run 44224318510, attempt 1 passed all three jobs. The worktree was clean before editing.

| Finding | Correction and proof on Node v22.23.4 |
| --- | --- |
| Fragment ownership | Only the path prefix before a literal hash enters namespace classification. Protected controls remain local. Neighbors with traversal and encoded path spellings in their fragments, including an empty-authority target, reach downstream. Encoded percent-23 remains path data. |
| GET queue ownership | Each admitted bodyless GET acquires the connection gate before dispatch. A synchronous throw, asynchronous rejection, or non-reusable response blocks the follower. Reusable success releases it after response finish and execution complete. The initial-GET pipeline uses the same gate. |
| Public-origin A-label scope | The authorized contract amendment limits hostnames to canonical ASCII DNS labels and canonical IP forms. Any DNS label starting with `xn--` fails even while disabled. The six review fixtures fail, and canonical ASCII and IP controls pass. Future IDN support requires separate contract and runtime review. |
| Committed error closure | A private response hook closes the captured socket and latches the gate. Tests exercised a committed response both before finish and after socket detachment, with one wire response and zero downstream follower calls. Success and unsent error sanitation still pass. |

Typecheck and build passed on Node v22.23.4. The full suite passed 2,096 tests and the focused suite passed 29 tests, with zero failures and skips. The correction covers the two HTTP modules, focused test, this log, and the public base URL row of the settings-auth contract. The boundary remains unmounted. The JSON parser and durable services are unchanged. Production and browser smoke tests are outside this slice. The next gate is independent re-review of the corrected head after automatic CI.
