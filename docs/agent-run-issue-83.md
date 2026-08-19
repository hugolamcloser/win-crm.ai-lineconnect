# Agent run log — Issue #83

## Task identification

- GitHub task: Issue #83 — Phase 2C native HighLevel SMS Conversation Provider entry
- Approved branch: `codex/issue-83-ghl-wincrm-sms-entry`
- Base and pre-implementation HEAD: `c4261ed`
- Authority: corrected implementation and mock-only validation; no commit, push, pull request, deployment, Railway change, Supabase schema/data change, provider credential use, provider network request, or SMS send
- Last updated: 2026-08-19

## Task objective

Add the smallest native HighLevel default SMS Conversation Provider Delivery URL that authenticates HighLevel's signed raw callback, derives exactly one WinCRM tenant, and reaches the existing tenant-aware SMS services through an in-memory EVERY8D mock. Preserve LINE and reconciliation behavior.

## Architecture implemented

```text
Native HighLevel Send SMS
→ default SMS Conversation Provider
→ POST /webhooks/ghl/sms/outbound
→ raw-body X-GHL-Signature Ed25519 verification
→ strict SMS payload
→ default-off confirmation and exact fixture allowlists
→ getTenantIdsByLocationId(signed locationId), requiring exactly one tenant
→ getTenantById(derived tenantId), requiring exact location and approved tenant
→ server-built in-memory EVERY8D mock configuration
→ SmsProviderConfigService
→ SmsOutboundService
→ existing Every8dSmsProviderFactory
→ Phase 2C mock-only transport
```

The caller cannot choose a tenant, provider, credentials, provider configuration, transport, or retry behavior. The SMS route does not call the existing LINE provider pipeline, OAuth/token services, or a HighLevel message-status API.

## Authentication and tenant isolation

- The route uses the existing `verifyGhlWebhookSignature` Ed25519 verifier with the exact `rawBody` bytes and only `X-GHL-Signature`.
- Missing raw bytes return `400`; missing or invalid Ed25519 signatures return `401` before payload processing.
- Legacy `X-WH-Signature` and Workflow Action `x-wincrm-webhook-secret` cannot authenticate this route.
- `locationId` comes only from the signed strict payload. There is no `GHL_LOCATION_ID`, OAuth, private-token, latest/default tenant, or cross-tenant fallback.
- All tenant IDs for the exact signed location are queried. Zero and multiple matches fail closed.
- The one derived tenant row must exist, match both the derived ID and signed location, and equal the one approved Phase 2C tenant.
- Option 1 provider validation is used: no OAuth-backed conversation-channel lookup and no dependency on an undocumented `conversationProviderId` callback field.

## Strict request boundary

Required fields are `contactId`, `locationId`, `messageId`, `type` exactly `SMS`, Taiwan mobile `phone`, and non-empty `message` up to 333 characters. Documented optional `userId` is allowed. `attachments` is allowed only as an empty array.

The Zod object is strict. Extra tenant, provider, credential, provider-config, transport, retry, or other SMS-control fields are rejected. Responses contain only a safe mock/failure status, fixed provider name, attempt count, retry flag, and normalized error code.

## Default-off gates

Provider configuration is not constructed unless all checks pass:

1. `GHL_SMS_PHASE_2C_ENABLED=true`.
2. `GHL_SMS_PHASE_2C_CONFIRMATION=ENABLE_APPROVED_PHASE_2C_MOCK_ONLY`.
3. One exact approved location, tenant, contact, synthetic Taiwan phone, and test message are configured.
4. The signed payload exactly matches the approved location, contact, phone, and message.
5. Exact one-tenant resolution and tenant/location/approved-tenant binding succeed.

There are no wildcards or fallback values.

## Mock-only provider behavior

- The provider is server-fixed to `every8d`.
- One transient provider configuration is assembled with inert `.invalid` and mock placeholder values only after all security checks.
- `Every8dSmsProviderFactory` accepts only the Phase 2C mock-only transport marker; the Phase 2B controlled-live marker is rejected before a request.
- One approved callback invokes `SmsOutboundService` once, authenticates against the in-memory mock once, and invokes mock `SendSMS` once.
- Provider rejection, timeout, network failure, and malformed response stop after one mock send attempt. Automatic retry is always false.
- No `fetch`, live EVERY8D SiteURL, real UID/password/bearer token, OAuth request, status callback, or real provider operation is present in the Phase 2C path.

## Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `src/routes/ghlSmsProviderWebhook.ts` | New signed native SMS Delivery URL and strict payload boundary. | Adds only `POST /webhooks/ghl/sms/outbound`. |
| `src/services/ghlSmsProviderOutboundService.ts` | Default-off gates, exact tenant binding, and mock-only existing SMS service assembly. | Isolated Phase 2C SMS entry. |
| `src/integrations/every8dPhase2cMockTransport.ts` | Deterministic in-memory EVERY8D authentication/send transport. | No network capability. |
| `src/app.ts` | Registers the isolated SMS provider router. | Import/startup performs no SMS activity. |
| `src/config/env.ts` | Adds default-off confirmation and exact fixture variables. | Empty/disabled defaults. |
| `.env.example` | Documents native callback mock-only controls. | Documentation only. |
| `test/ghlSmsProviderOutbound.test.cjs` | Signature, schema, gates, tenant isolation, mock, retry, redaction, startup, and route-isolation proofs. | Test only. |
| `docs/agent-run-issue-83.md` | Records corrected architecture and sanitized evidence. | None. |

The superseded Workflow Action middleware, route, service, OAuth-binding repository helper, and Workflow Action-specific test were discarded. Existing `ghlWebhook.ts`, `ghlWebhookSignature.ts`, `jsonBody.ts`, `ghlSyncService.ts`, `repository.ts`, LINE modules, and reconciliation modules remain functionally unchanged.

## Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| Dedicated Phase 2C mock suite | Passed | 13 passed; no real transport is available to this suite. |
| `npm run typecheck` | Passed | TypeScript completed without errors. |
| `npm test` | Passed | 382 passed, 0 failed; includes existing LINE and reconciliation coverage. |
| `npm run build` | Passed | TypeScript production build completed without errors. |
| `git diff --check` | Passed | No whitespace errors; only expected Windows line-ending notices. |

## Protected systems

- Zero real EVERY8D requests and zero SMS
- Zero OAuth/token/private-token or HighLevel message-status request
- No Railway, deployment, production environment, Supabase schema, or Supabase data change
- No real credentials or customer recipient data
- Existing LINE inbound/outbound, Workflow Action, attachments, tenant/channel mapping, inbox mirroring, and reconciliation behavior preserved

## Remaining decision

No known implementation security blocker remains for a default-off mock-only Draft PR. Any live provider transport, real configuration, status reporting, deployment, or SMS execution requires separate authorization and security review.
