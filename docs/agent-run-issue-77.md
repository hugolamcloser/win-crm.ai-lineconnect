# Agent run log — Issue #77

## Task identification

- GitHub task: Issue #77 — Phase 1D — Controlled EVERY8D Outbound API Connectivity Spike
- Approved branch: `codex/issue-77-every8d-connectivity-spike`
- Authority level: isolated implementation/evidence publication; maintainer-supplied controlled results accepted, but no agent-executed provider request or SMS, deployment, merge, schema, Railway, LINE, GHL, or reconciliation change
- Started at: 2026-08-17
- Last updated at: 2026-08-18

## Task objective

Implement a strictly isolated, manually invoked EVERY8D client for token acquisition, one `SendSMS`, and one delivery-status query. Keep real sending disabled by default, cover provider behavior with mocks, and stop before any real provider request.

## Current hypothesis

The bearer-token, ordinary send, delivery-status, and handset-delivery paths have accepted real controlled evidence. Ordinary carrier reply failed for the observed sender identity. The `EventID=-1` attempt reached EVERY8D but was rejected with undocumented status `-290`, and the documented SafeSay/activity-channel administration is inaccessible on this account. Ordinary outbound connectivity is proven for the controlled case; interactive/two-way capability remains blocked at the account/channel/provisioning layer.

## Current Issue #77 conclusion

- **Proven:** basic EVERY8D authentication, immediate token reuse within one invocation, one-recipient ordinary `SendSMS`, success/correlation parsing, delivery-status lookup, and physical Taiwan handset delivery for the exact controlled case.
- **Blocked:** ordinary carrier reply for the observed sender identity and the `EventID=-1` interactive path. The latter is blocked at the account/channel/provisioning layer until SafeSay access/default-channel entitlement is documented and available.
- **Unknown:** the meaning of `-290`, sender ownership/directionality, SafeSay/EventID/forwarding relationships, long-term token behavior, idempotency, broad encoding/segmentation/cost rules, and inbound correlation/security.
- **Next-phase decision:** sufficient to begin a separately approved, default-off, mock-only Phase 2A outbound foundation; insufficient to activate/deploy outbound SMS or begin interactive/inbound implementation.

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
| The separately approved controlled send returned provider success with one sent, zero unsent, and a `BATCHID`; `GetDeliveryStatus` queried the same message; and the approved handset physically received the exact approved controlled content. Recipient, content, credentials, token, and identifiers remain omitted. | Maintainer-supplied sanitized Issue #77 evidence, 2026-08-18. | Confirms one real provider acceptance, query correlation, and physical delivery. It does not establish reply/MO support, repeatability, or production readiness. |
| `GetReplyMessage` is documented as a bearer-authenticated query using a prior `BID`, with no outbound-message field. Its JSON response carries `SMS_COUNT`, `BID`, and reply records. | Sanitized API contract. | An existing-batch query can be isolated from `SendSMS`; it needs no additional outbound message. `MR` and `EventID` are not documented response fields and remain optional evidence context only. |
| The approved recipient attempted an ordinary carrier reply from the exact iPhone SMS conversation, and iOS reported it as not delivered/unable to send. | Maintainer-supplied sanitized Issue #77 evidence, 2026-08-18. | Establishes only that ordinary carrier reply to the sender used by that controlled send was not working at that time. It does not identify sender ownership, lifecycle, sharing, directionality, provisioning, or the `EventID` mechanism. No `GetReplyMessage` query is warranted without a proven inbound event. |
| The general `SendSMS` contract accepts optional `EventID`; supplying it adds an interactive-reply link with documented 17-character overhead, and `EventID=-1` selects the default activity channel. | Sanitized API contract. | Supports one separately gated `EventID=-1` experiment. It does not prove default-channel provisioning, SafeSay branding, reply transport, or stable correlation. |
| The separately approved `EventID=-1` invocation completed HTTP transport/authentication but EVERY8D returned provider status `-290`. No interactive SMS was delivered, no delivery/reply query followed, and no retry occurred. | Maintainer-supplied sanitized Issue #77 evidence, 2026-08-18. | Proves rejection of that exact interactive request. The repository contains no documented definition for `-290`, so its meaning and retry classification remain unresolved. |
| Official EVERY8D/SafeSay documentation describes `互動回覆簡訊`, `活動頻道管理`, `客服設定`, customer-reply enablement, and default-channel configuration. The observed account exposes no visible interactive entry; the public SafeSay login returns to the EVERY8D login flow; and those controls cannot be accessed or configured. | Maintainer-supplied sanitized documentation/UI evidence, 2026-08-18. | Establishes that no usable default interactive channel is empirically verified for this account. Missing entitlement or provider provisioning is a strong hypothesis, not a proven cause. |

## Commands executed and results

Commands and output contain no provider credentials, tokens, recipients, or customer data.

| Command | Purpose | Result | Evidence or follow-up |
| --- | --- | --- | --- |
| `git fetch origin main` | Refresh the approved base during preflight. | Passed. | Branch base matches latest `origin/main`. |
| `npm run typecheck` | Type safety. | Passed. | TypeScript completed with no errors. |
| `npm test` | Mocked spike and full regression suite. | Passed. | 325 tests passed; 0 failed, cancelled, skipped, or todo. |
| `npm run build` | Production TypeScript build. | Passed. | TypeScript build completed with no errors. |
| `npm run every8d:spike` with the master gate enabled and real-send gate disabled | Maintainer-controlled real authentication test through a Taiwan VPN. | Passed. | HTTP 200, provider result true, token acquired and redacted, outcome `authenticated_only`; no SMS sent. |
| `npm run every8d:spike` with separately approved one-recipient send gates | Maintainer-controlled ordinary outbound test. | Passed. | Authentication, one `SendSMS`, delivery query, and physical handset receipt succeeded; sanitized correlation evidence was retained. |
| `npm run every8d:interactive-spike` with separately approved one-recipient gates and `EventID=-1` | Maintainer-controlled interactive attempt. | Provider rejected. | Transport/authentication succeeded; provider status `-290`; no interactive SMS, delivery query, reply query, or retry. |

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
| Retrying the `EventID=-1` rejection. | `-290` is undocumented and the account has no empirically accessible default-channel administration; retrying would add risk without new evidence. |
| Default global transport inside the client. | Requiring transport injection makes mocked tests and network boundaries explicit. |

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `src/integrations/every8dClient.ts` | Isolated provider client, parsers, transport abstraction, and sanitized logging. | None unless explicitly imported and invoked. |
| `src/config/every8dSpike.ts` | Environment parsing and fail-closed safety gates. | None unless runner is invoked. |
| `src/scripts/every8dConnectivitySpike.ts` | Manual auth/send/status runner. | Not connected to the server or routes. |
| `src/config/every8dReplyQuery.ts` | Default-disabled existing-batch query gates and bounded page configuration. | None unless the manual query runner is invoked. |
| `src/scripts/every8dReplyQuery.ts` | Manual authentication plus one `GetReplyMessage` query with sanitized evidence summaries. | Query-only; cannot send and is not connected to the server or routes. |
| `src/config/every8dInteractiveSpike.ts` | Default-disabled one-recipient interactive-send gates, fixed `EventID=-1`, and conservative message cap. | None unless its manual runner is invoked. |
| `src/scripts/every8dInteractiveReplySpike.ts` | Manual authentication, one EventID send, and one delivery-status query. | Not connected to the server or routes; no reply query or callback. |
| `test/every8dConnectivitySpike.test.cjs` | Mock-only provider and runner coverage. | Test-only. |
| `test/every8dReplyQuery.test.cjs` | Mock-only MO parser, safety, no-send, and redaction coverage. | Test-only. |
| `test/every8dInteractiveReplySpike.test.cjs` | Mock-only EventID request, one-recipient gates, no-retry, no-query, and redaction coverage. | Test-only. |
| `.env.example` | Placeholder variable names and disabled defaults. | No credentials or production activation. |
| `package.json` | Adds the explicit manual runner command. | No startup-script change. |
| `docs/every8d-connectivity-spike.md` | Operator safety and uncertainty documentation. | None. |
| `docs/agent-run-issue-77.md` | Task evidence record. | None. |
| `docs/every8d-api-contract.md` | Adds sanitized Phase 1D controlled/account UI evidence E1–E4 without inventing `-290` semantics. | None. |
| `docs/every8d-feasibility-decision.md` | Reassesses blockers and separates implementation-only Phase 2A from activation and inbound gates. | None. |

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | TypeScript completed with no errors. |
| `npm test` | Passed | 325 passed; 0 failed, cancelled, skipped, or todo. Includes 34 EVERY8D mock/safety tests. |
| `npm run build` | Passed | TypeScript build completed with no errors. |

## Budget and stop-rule status

- Active coding tasks: one
- Implementation correction loops used: zero
- Reviewer correction loops used: zero
- Repeated errors or failed approaches: none
- Agent access to provider credentials/data: none; the maintainer supplied and used credentials locally, and no value was recorded.
- Provider requests: maintainer supplied accepted evidence for authentication, one successful ordinary controlled send/delivery query, and one provider-rejected interactive attempt; no agent-executed provider request.
- SMS sent: one ordinary controlled SMS was delivered; the interactive attempt was rejected before delivery.
- Stop rule applied: do not retry `EventID=-1` or execute `GetReplyMessage` without new documented provisioning evidence and separate approval.

## Unresolved decisions

- EVERY8D owns clarification of status `-290`, SafeSay entitlement/access, default `EventID=-1` activity-channel provisioning, token lifecycle, sender/reply identity, EventID/SafeSay relationship, `BID`/`MR` reply correlation semantics, encoding breadth, segmentation, billing, limits, retention, sandbox availability, and safe retry/idempotency behavior.
- The maintainer owns separate approval of the first real test account, recipient, message, test window, operator, and absolute cost cap.

## Recommended next action

Do not retry the interactive runner or execute `GetReplyMessage`. The next implementation may be a separately approved, default-off, mock-only Phase 2A tenant-aware outbound foundation with no live credentials, provider request, SMS, production route, deployment, callback, inbound handling, or GHL/LINE/Supabase/reconciliation change. Production activation and interactive/inbound phases remain blocked.
