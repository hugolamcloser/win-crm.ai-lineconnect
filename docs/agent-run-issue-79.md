# Agent run log — Issue #79

## Task identification

- GitHub task: Issue #79 — Phase 2A — Tenant-Aware EVERY8D Outbound SMS Foundation (Default-Off, Mock-Only)
- Approved branch: `codex/issue-79-every8d-outbound-foundation`
- Base and pre-implementation HEAD: `8a1cb79eae6737f44f8cf2f09aea204577d85114`
- Authority: additive mock-only implementation and validation; no commit, push, PR, provider request, SMS, production configuration, schema, route, deployment, LINE, GHL, workflow, or reconciliation change
- Date: 2026-08-18

## Architecture implemented

Phase 2A adds four isolated layers:

1. Provider-neutral outbound request, result, correlation, and normalized failure contracts.
2. An injected in-memory provider-configuration resolver that requires an exact tenant, location, and provider match.
3. A default-off outbound orchestration service that validates the request, resolves configuration before provider creation, invokes one provider send operation, and never retries.
4. A mock-transport-only EVERY8D adapter that reuses `Every8dClient` authentication and `SendSMS` parsing.

No module is registered in the Express application or imported by existing LINE, GHL, workflow, reconciliation, Supabase, or deployment code.

## Files changed

| File                                       | Change                                                                                       | Runtime impact                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/types/sms.ts`                         | Provider-neutral request/result, correlation, provider, and failure contracts.               | None unless explicitly imported.                                           |
| `src/services/smsProviderConfigService.ts` | Injected exact-match configuration model and resolver.                                       | None; it has no environment or persistence integration.                    |
| `src/services/smsOutboundService.ts`       | Default-off validation and provider orchestration service.                                   | None; it is not registered or instantiated by production runtime.          |
| `src/integrations/every8dSmsProvider.ts`   | Mock-only adapter over the existing EVERY8D client.                                          | None; it rejects the existing fetch transport and is not wired to runtime. |
| `test/smsOutboundFoundation.test.cjs`      | Mocked tenant isolation, failure, redaction, correlation, retry, and network-boundary tests. | Test-only.                                                                 |
| `docs/agent-run-issue-79.md`               | Phase 2A evidence and decision record.                                                       | None.                                                                      |

The existing `src/integrations/every8dClient.ts` did not require modification.

## Tenant isolation

- Every request must supply non-empty `tenantId`, `locationId`, and `provider` values.
- The resolver accepts only injected configuration records and selects only an exact three-part match.
- Zero matches, duplicate matches, cross-match ambiguity, tenant mismatch, location mismatch, unsupported provider, and disabled configuration all fail closed with distinct normalized codes.
- The resolver never selects a latest record and has no global, environment, Supabase, LINE, or other-tenant fallback.
- Configuration is resolved before a provider object is constructed or invoked.
- Tests prove that a request cannot use credentials belonging to another tenant or location.

## Default-off and mock-only behavior

- `SmsOutboundService` defaults to disabled unless its constructor receives `enabled: true` explicitly.
- The disabled path performs no configuration lookup, provider construction, transport request, or logging of message content.
- The EVERY8D factory requires a runtime marker implemented only by the Phase 2A mock transport contract.
- The existing network/fetch transport is rejected by the Phase 2A factory.
- No default transport, environment reader, real credential source, route, runner, or application registration exists for this foundation.
- Tests replace `global.fetch` with a failing sentinel and prove it is never called.

## Outbound and correlation behavior

- The service validates a single numeric destination of bounded length, a non-empty message within the documented 333-character ceiling, and an optional bounded internal reference.
- The EVERY8D adapter performs one mocked authentication request and one mocked general `SendSMS` request.
- It retains the returned `BATCHID` and records that same established batch identifier as the future delivery-query `BID`, explicitly marked with `bidSource: "batch_id"` rather than claiming a separate provider-returned BID.
- `MR` is optional and is preserved only when a provider result actually contains it. The general EVERY8D `SendSMS` adapter does not invent an `MR`.
- No delivery query, callback, inbound/MO, EventID, SafeSay, or interactive behavior is implemented.

## Failure and retry behavior

- Configuration, request, provider rejection, HTTP failure, timeout, network failure, malformed response, and unexpected provider failure remain distinguishable.
- Every normalized failure states `retryable: false` and `retryAttempted: false`.
- The orchestration contains no loop, retry helper, delayed retry, or second provider invocation.
- Mock request counts prove that provider rejection and timeout each result in at most one `SendSMS` request.

## Secret and privacy behavior

- Provider credentials are confined to the injected provider configuration and do not appear in outbound request or result contracts.
- Bearer tokens remain inside the existing EVERY8D client call sequence.
- Service logs contain only provider name, outcome, failure code, attempt count, and retry state.
- Tests verify that UID, password, bearer token, complete destination, and message content are absent from logs and returned results.

## Mocked test coverage

The Phase 2A suite covers:

- exact tenant/location/provider resolution;
- missing identities and zero configuration matches;
- tenant and location mismatches;
- duplicate and cross-match ambiguity;
- disabled configuration;
- default-off behavior;
- missing and unsupported providers;
- malformed destination and message requests;
- successful authentication and one mocked send;
- authentication and send rejection;
- HTTP failure, timeout, ambiguous network failure, and malformed provider response;
- BATCHID/BID correlation and explicit BID source;
- optional MR preservation without invention;
- credential, token, destination, and message redaction;
- no retry after rejection or timeout;
- no cross-tenant fallback;
- rejection of the existing fetch transport; and
- zero use of global fetch or real network access.

## Validation results

| Command             | Result | Evidence                                                                                 |
| ------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `npm run typecheck` | Passed | TypeScript completed without errors.                                                     |
| `npm test`          | Passed | 346 tests passed; 0 failed, cancelled, skipped, or todo. Includes 21 new Phase 2A tests. |
| `npm run build`     | Passed | TypeScript production build completed without errors.                                    |

No test invoked an EVERY8D endpoint or sent an SMS. All provider responses came from queued in-memory fixtures.

## Protected systems confirmed untouched

- Express application registration and public routes
- GHL routes, webhooks, conversation integration, and production behavior
- LINE routes, clients, provider-first behavior, attachments, and Workflow Actions
- contact reconciliation
- Supabase code, schema, migrations, and production data
- Railway and deployment configuration
- environment variables and production credential persistence
- callbacks, inbound/MO, SafeSay, and EventID interactive messaging

## Remaining Phase 2B blockers

Phase 2A does not authorize or resolve production activation. Phase 2B remains blocked on separately approved decisions and evidence for:

- production tenant/provider configuration persistence and secret ownership/rotation;
- EVERY8D token lifetime, caching, concurrency, rotation, expiry, and revocation behavior;
- safe timeout reconciliation and provider idempotency before any retry policy;
- exact EVERY8D Taiwan wire-number format and normalization;
- broader encoding, segmentation, charge, content, rate, and limit behavior;
- staging/test environment, absolute cost cap, monitoring, operational support, and explicit live-test approval;
- production route/GHL integration design and authorization; and
- any persistence or schema proposal, if later required, as a separate approved migration task.

Interactive and inbound work remains separately blocked by sender/reply provisioning, SafeSay/EventID entitlement, callback security, replay protection, and stable recipient-level correlation.
