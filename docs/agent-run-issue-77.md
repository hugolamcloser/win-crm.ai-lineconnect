# Agent run log — Issue #77

## Task identification

- GitHub task: Issue #77 — Phase 1D — Controlled EVERY8D Outbound API Connectivity Spike
- Approved branch: `codex/issue-77-every8d-connectivity-spike`
- Authority level: isolated mocked implementation, commit, push, and draft PR; no real provider request, SMS, deployment, merge, schema, Railway, LINE, GHL, or reconciliation change
- Started at: 2026-08-17
- Last updated at: 2026-08-17

## Task objective

Implement a strictly isolated, manually invoked EVERY8D client for token acquisition, one `SendSMS`, and one delivery-status query. Keep real sending disabled by default, cover provider behavior with mocks, and stop before any real provider request.

## Current hypothesis

The documented bearer-token path and endpoint shapes are sufficient for a mock-validated controlled runner. The first separately approved real test is still required to determine whether actual authentication, response grammar, token reuse, identifiers, and immediate delivery querying match the document.

## Files inspected

| File | Reason inspected | Relevant finding |
| --- | --- | --- |
| `AGENTS.md` | Repository authority and protected boundaries. | Requires isolation from LINE/GHL, secret safety, focused changes, and complete validation. |
| GitHub Issue #77 | Approved implementation scope. | Authorizes an isolated connectivity spike and mocked tests, but no real SMS without later approval. |
| `docs/every8d-api-contract.md` | Documented provider request/response contract. | Defines token, `SendSMS`, `GetDeliveryStatus`, `BATCHID`, `BID`, and `MR` shapes. |
| `docs/every8d-feasibility-decision.md` | Unresolved provider behavior and stop rules. | Production Phase 2 remains blocked; the controlled spike must not invent missing guarantees. |
| `docs/taiwan-sms-pilot-plan.md` | Cross-phase isolation requirements. | SMS must remain separate from LINE, GHL, production configuration, and database behavior. |
| `src/app.ts` and existing route modules | Runtime-boundary check. | The spike does not need an HTTP route or application registration. |

## Evidence discovered

| Evidence | Source | Impact on the task |
| --- | --- | --- |
| Authentication uses JSON `HandlerType=3`, `VerifyType=1`, `UID`, and `PWD`. | Sanitized API contract. | Implemented exactly with injected transport. |
| General send returns five comma-separated fields; failure returns status and message. | Sanitized API contract. | Parser accepts only the documented success shape and exposes provider status safely on failure. |
| Delivery JSON returns `SMS_COUNT`, `BID`, and optional `DATA` records containing `MR` and `STATUS`. | Sanitized API contract. | Parser captures correlation and delivery fields without assuming state finality. |
| Token lifecycle, idempotency, sender identity, encoding, segmentation, cost, and sandbox behavior remain unresolved. | Feasibility decision. | No retry, caching guarantee, production route, or inferred behavior was added. |
| A real authentication-only invocation from the maintainer's local machine through a Taiwan Surfshark VPN reached `https://new.e8d.tw`, returned HTTP 200 with provider result `true`, and acquired a token. The token remained redacted, `realSendEnabled` was false, and the outcome was `authenticated_only`. | Maintainer-supplied sanitized Issue #77 evidence, 2026-08-17. | Confirms real connectivity and token acquisition in that network context. It does not prove send acceptance, token lifetime, delivery behavior, number normalization, or repeatability from other networks. |

## Commands executed and results

Commands and output contain no provider credentials, tokens, recipients, or customer data.

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git fetch origin main` | Refresh the approved base during preflight. | Passed. | Branch base matches latest `origin/main`. |
| `npm run typecheck` | Type safety. | Passed. | TypeScript completed with no errors. |
| `npm test` | Mocked spike and full regression suite. | Passed. | 306 tests passed; 0 failed, cancelled, skipped, or todo. |
| `npm run build` | Production TypeScript build. | Passed. | TypeScript build completed with no errors. |
| `npm run every8d:spike` with the master gate enabled and real-send gate disabled | Maintainer-controlled real authentication test through a Taiwan VPN. | Passed. | HTTP 200, provider result true, token acquired and redacted, outcome `authenticated_only`; no SMS sent. |

## Approaches attempted

| Approach | Outcome | New evidence |
| --- | --- | --- |
| Injected transport and logger with a standalone runner. | Implemented. | Automated tests can exercise every provider path without network access. |

## Rejected approaches and reasons

| Rejected approach | Reason rejected |
| --- | --- |
| Express route for SMS sending. | Issue #77 prohibits a production-reachable send route. |
| Importing LINE/GHL services or Supabase mappings. | The spike must remain isolated and is not Phase 2 integration. |
| Automatic `SendSMS` retry. | Ambiguous timeouts could create duplicate billed messages. |
| Default global transport inside the client. | Requiring transport injection makes mocked tests and network boundaries explicit. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `src/integrations/every8dClient.ts` | Isolated provider client, parsers, transport abstraction, and sanitized logging. | None unless explicitly imported and invoked. |
| `src/config/every8dSpike.ts` | Environment parsing and fail-closed safety gates. | None unless runner is invoked. |
| `src/scripts/every8dConnectivitySpike.ts` | Manual auth/send/status runner. | Not connected to the server or routes. |
| `test/every8dConnectivitySpike.test.cjs` | Mock-only provider and runner coverage. | Test-only. |
| `.env.example` | Placeholder variable names and disabled defaults. | No credentials or production activation. |
| `package.json` | Adds the explicit manual runner command. | No startup-script change. |
| `docs/every8d-connectivity-spike.md` | Operator safety and uncertainty documentation. | None. |
| `docs/agent-run-issue-77.md` | Task evidence record. | None. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | TypeScript completed with no errors. |
| `npm test` | Passed | 306 passed; 0 failed, cancelled, skipped, or todo. Includes 15 EVERY8D mock/safety tests. |
| `npm run build` | Passed | TypeScript build completed with no errors. |

## Budget and stop-rule status

- Active coding tasks: one
- Implementation correction loops used: zero
- Reviewer correction loops used: zero
- Repeated errors or failed approaches: none
- Agent access to provider credentials/data: none; the maintainer supplied and used credentials locally, and no value was recorded.
- Provider requests: one maintainer-executed authentication-only request; no agent-executed provider request.
- SMS sent: no
- Stop rule triggered: no

## Unresolved decisions

- EVERY8D owns clarification of token lifetime/reuse, sender/reply identity, correlation semantics, encoding, segmentation, billing, limits, retention, sandbox availability, and safe retry/idempotency behavior.
- The maintainer owns separate approval of the first real test account, recipient, message, test window, operator, and absolute cost cap.

## Recommended next action

Prepare the exact one-recipient send command and stop. Do not execute it until the maintainer separately approves the exact recipient, message, account, network context, operator, test window, and cost exposure.
