# Agent run log — Issue #81

## Task identification

- GitHub task: Issue #81 — Phase 2B — Controlled Live EVERY8D Outbound Runtime Validation (Default-Off, Single-Tenant, Approval-Gated)
- Approved branch: `codex/issue-81-every8d-live-outbound-validation`
- Base and pre-implementation HEAD: `6fb5dee1e24656cffb52ce0e61ddc992839a825d`
- Initial authority: implementation and mock-only validation. A later, separately approved controlled execution completed exactly one `SendSMS` attempt; this evidence update does not authorize another provider request or SMS. No deployment, Railway, Supabase, LINE, GHL, workflow, route, callback, inbound/MO, SafeSay, or EventID change was authorized or performed.
- Date: 2026-08-18

## Task objective

Add the smallest separate controlled-live transport bridge that can later exercise the existing Phase 2A tenant-aware outbound architecture for one explicitly approved EVERY8D recipient. Keep the path default-off, manual-only, mock-tested, non-retrying, and unreachable from production startup or public routes. Stop before any real invocation.

## Architecture implemented

The controlled runner preserves this path:

```text
approved/requested tenant and location runtime inputs
→ SmsProviderConfigService exact tenant + location + provider resolution
→ SmsOutboundService one provider invocation
→ Every8dPhase2bControlledLiveSmsProviderFactory
→ existing Every8dSmsProvider adapter
→ existing Every8dClient
→ separately marked Phase 2B fetch transport
```

The existing Phase 2A `Every8dSmsProviderFactory` remains mock-only. Its transport-kind check, production behavior, and existing tests are unchanged. The only minimal shared refactor changes the private adapter's transport field from the mock-marker subtype to its existing `Every8dTransport` interface so the same adapter can be constructed by either strictly typed factory.

## Safety and approval gates

The manual runner fails before fetch-transport construction unless all conditions pass:

1. `EVERY8D_PHASE_2B_ENABLED=true`.
2. `EVERY8D_PHASE_2B_SEND_ENABLED=true`.
3. `EVERY8D_PHASE_2B_SEND_CONFIRMATION=SEND_ONE_PHASE_2B_APPROVED_SMS`.
4. Approved and requested tenant IDs are non-empty and exactly equal.
5. Approved and requested location IDs are non-empty and exactly equal.
6. `EVERY8D_PHASE_2B_PROVIDER=every8d`.
7. Approved and requested recipients are exactly equal and each matches `09xxxxxxxx`.
8. The message exactly equals the compiled Issue #81 reviewed test content.
9. SiteURL is a credential-free HTTPS origin, UID/password are non-empty runtime values, and timeout is an integer from 100 through 60,000 milliseconds.
10. The older ordinary and interactive controlled send flags are false or unset.

The controlled recipient parser rejects `+886`, spaces, punctuation, commas, semicolons, CR/LF, malformed numbers, and multiple recipients. It performs no number normalization.

## Tenant isolation

- The approved tenant and location create exactly one injected in-memory EVERY8D configuration.
- The requested tenant, location, and provider remain separate outbound-request inputs.
- The pre-provider gate requires exact approved/requested identity equality.
- `SmsProviderConfigService` independently resolves the same exact `tenantId + locationId + provider` tuple before provider construction.
- Credentials are attached only to the approved configuration and are not present in the outbound request or result.
- There is no cross-tenant, cross-location, global, latest-record, environment-search, Supabase, or LINE mapping fallback.

## Provider operations and retry boundary

One later separately approved invocation can perform only:

1. One authentication request to `ConnectionHandler.ashx`.
2. One general `SendSMS.ashx` request containing exactly one `DEST` and one `MSG`.

The runner does not invoke `GetDeliveryStatus`, `GetReplyMessage`, `SendParam`, EventID, SafeSay, a callback, or any interactive operation. It preserves the returned `BATCHID` and records it as the established `BID` with `bidSource: "batch_id"` for a later separately gated delivery-evidence task.

There is no automatic retry. Provider rejection, timeout, network failure, malformed response, HTTP failure, or an ambiguous result stops after the one attempted `SendSMS`.

## Runtime variables

| Variable | Required controlled value |
| --- | --- |
| `EVERY8D_PHASE_2B_ENABLED` | Exactly `true` |
| `EVERY8D_PHASE_2B_SEND_ENABLED` | Exactly `true` |
| `EVERY8D_PHASE_2B_SEND_CONFIRMATION` | Exactly `SEND_ONE_PHASE_2B_APPROVED_SMS` |
| `EVERY8D_PHASE_2B_APPROVED_TENANT_ID` | Approved non-empty tenant identity |
| `EVERY8D_PHASE_2B_APPROVED_LOCATION_ID` | Approved non-empty location identity |
| `EVERY8D_PHASE_2B_TENANT_ID` | Exact approved tenant identity |
| `EVERY8D_PHASE_2B_LOCATION_ID` | Exact approved location identity |
| `EVERY8D_PHASE_2B_PROVIDER` | Exactly `every8d` |
| `EVERY8D_PHASE_2B_APPROVED_RECIPIENT` | Approved one-recipient `09xxxxxxxx` value |
| `EVERY8D_PHASE_2B_RECIPIENT` | Exact approved recipient value |
| `EVERY8D_PHASE_2B_MESSAGE` | Exact compiled reviewed test content |
| `EVERY8D_SITE_URL` | Approved credential-free HTTPS provider origin |
| `EVERY8D_UID` | Runtime-only credential; never logged |
| `EVERY8D_PASSWORD` | Runtime-only credential; never logged |
| `EVERY8D_TIMEOUT_MS` | Optional integer 100–60,000; defaults to `10000` |

The runtime values must remain outside the repository and Railway. No real value was used during implementation or automated testing. The separately approved controlled execution supplied its values only at local runtime; no credential, full recipient, or complete message was stored in this repository.

## Logging and evidence boundary

- `Every8dClient` retains its sanitized logger.
- The outbound service logs only allowlisted provider outcome and attempt metadata.
- The manual runner logs only tenant/location/provider, outcome, attempt count, safe HTTP/provider status, sent/unsent/cost fields, failure code/stage, and returned `BATCHID`/`BID` correlation.
- UID, password, bearer token, complete credentials, full recipient, and complete message are absent from logs, normalized results, and runner failures.
- The runner never serializes configuration, process environment, transport requests, raw authentication responses, or raw provider errors.

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `src/config/every8dPhase2b.ts` | Default-off Phase 2B environment parser and fail-closed safety gates. | None unless manually imported and invoked. |
| `src/integrations/every8dSmsProvider.ts` | Additive controlled-live transport marker, wrapper, and factory over the existing adapter/client. | Existing mock-only factory behavior remains unchanged. |
| `src/scripts/every8dPhase2bOutboundValidation.ts` | Manual-only assembly of the existing Phase 2A resolver/service/provider/client path. | Not imported by server or routes. |
| `test/every8dPhase2bOutboundValidation.test.cjs` | Mock-only gate, isolation, retry, operation, redaction, and reachability coverage. | Test-only; no global fetch. |
| `package.json` | Adds a dedicated manual Phase 2B command without changing `start` or `dev`. | No production startup effect. |
| `docs/agent-run-issue-81.md` | Sanitized implementation and validation evidence. | None. |

## Mock validation evidence

The dedicated Phase 2B test suite uses only queued in-memory transports. Its accepted case observes exactly two mocked requests: one authentication and one `SendSMS`. Failure cases prove that rejection, timeout, network failure, and malformed response each produce no more than one `SendSMS` request. Static/import checks prove that application startup and all other source modules do not reference the manual runner. The controlled-live factory also rejects the Phase 2A mock transport marker.

## Controlled live execution evidence

The separately approved Phase 2B execution completed on 2026-08-18 from the controlled local Windows environment. Approved and requested tenant/location exact-match gates passed, and the resolved provider was `every8d`. Runtime credentials, the full recipient, and the complete message were not captured in repository evidence.

| Evidence | Sanitized result |
| --- | --- |
| Outcome | `accepted` |
| Maximum authorized `SendSMS` attempts | 1 |
| Actual `providerAttempts` | 1 |
| Authentication HTTP status | 200 |
| Authentication `providerResult` | `true` |
| `SendSMS` HTTP status | 200 |
| `SendSMS` `providerResult` | `true` |
| `sentCount` / `unsentCount` | 1 / 0 |
| Provider `cost` | 1 |
| `retryAttempted` | `false` |
| `interactiveReplyRequested` | `false` |
| Returned `BATCHID` | `8cf50a74-9c06-40ed-b7a1-edc192654a13` |
| Preserved `BID` | `8cf50a74-9c06-40ed-b7a1-edc192654a13` |
| `bidSource` | `batch_id` |

The approved Taiwan handset physically received the single controlled SMS at approximately 18:20 GMT+8. The recipient-provided screenshot showed that the received content matched the approved Phase 2B test message. The screenshot and full phone number remain outside the repository and PR.

The Taiwan VPN/network remained stable during the execution. This proves successful delivery under that specific network condition only; it does not establish that EVERY8D requires a Taiwan VPN.

No second SMS was sent and no automatic retry occurred. The execution did not call `GetDeliveryStatus`, `GetReplyMessage`, SafeSay, EventID, inbound/MO, or callback operations. It did not change any GHL route, LINE route, Express route, production startup behavior, Supabase schema/data, Railway configuration, or reconciliation behavior.

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| Dedicated Phase 2B mock suite | Passed | 23 passed; 0 failed. No network transport. |
| `npm run typecheck` | Passed | TypeScript completed without errors. |
| `npm test` | Passed | 369 passed; 0 failed, cancelled, skipped, or todo. Includes 23 Phase 2B tests. |
| `npm run build` | Passed | TypeScript production build completed without errors. |
| `git diff --check` | Passed | Evidence-only documentation diff has no whitespace errors. |

## Protected systems confirmed unchanged

- Express application and all public routes
- GHL routes, webhooks, conversations, and Workflow Actions
- LINE inbound/outbound, attachments, mappings, and provider behavior
- Contact reconciliation
- Supabase code, schema, migrations, and data
- Railway and deployment configuration
- Production `start` and `dev` behavior
- Delivery callbacks, inbound/MO, `GetReplyMessage`, SafeSay, and EventID

## Budget and stop-rule status

- Active coding tasks: one
- Implementation correction loops used: one (tightened leading/trailing recipient-space rejection during final requirements audit)
- Reviewer correction loops used: zero
- Repeated errors or failed approaches: none
- Provider credentials: supplied only at runtime for the separately approved controlled execution; not printed, logged, or stored
- Provider operations: one authentication request and one `SendSMS` attempt; no retry, status query, reply query, inbound/MO, callback, SafeSay, or EventID operation
- SMS outcome: exactly one accepted send and one sanitized handset receipt confirmation; no second SMS
- Stop rule triggered: yes; stop after recording the completed approved execution, with no further provider request authorized

## Unresolved decisions and next approval

The one separately approved controlled execution is complete. It does not authorize a second send, a delivery-status query, a reply-message query, deployment, or production/GHL integration. Any next phase requires its own scope, safety review, implementation task, and explicit approval.

## Recommended next action

Review the implementation, validation results, scope audit, and sanitized empirical evidence in Draft PR #82. If accepted, decide whether to mark the PR ready for review and merge it. Do not merge, deploy, send another SMS, query delivery/replies, or begin production/GHL integration under Issue #81 authority.
