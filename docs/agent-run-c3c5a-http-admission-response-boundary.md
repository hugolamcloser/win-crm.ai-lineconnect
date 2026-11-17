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
