# Taiwan SMS pilot plan

## Purpose

This plan prepares Win-CRM to add Taiwan SMS as a future messaging channel without changing or weakening the existing LINE and HighLevel integrations. It defines sequencing and governance only; it does not select or implement an SMS provider, change runtime behavior, modify the database, configure production, or authorize live messages.

Every phase below must be approved as a separate GitHub task and delivered through a separate focused pull request. A phase may start only after the previous phase's evidence and unresolved decisions have been reviewed. No phase may merge or deploy automatically.

## Cross-phase guardrails

- Preserve all existing LINE routes, modules, credentials, tenant/channel mappings, contact reconciliation, native attachments, Workflow Action delivery, and HighLevel inbox mirroring.
- Keep LINE and SMS routes, webhooks, clients, credentials, sender identities, mappings, message state, and provider-specific behavior separate.
- Do not assume tenants share a messaging channel, SMS provider, credentials, sender number, or configuration.
- Resolve all future messaging configuration for the exact tenant and channel, and fail closed when the mapping is missing or ambiguous.
- Do not use production credentials, access customer data, send live LINE or SMS messages, change production configuration, migrate a production database, deploy, or merge autonomously.
- Apply the authority, budget, validation, and stop rules in [`../AGENTS.md`](../AGENTS.md).
- Record evidence and decisions with [`agent-run-log-template.md`](agent-run-log-template.md).
- Run `npm run typecheck`, `npm test`, and `npm run build` for every implementation task; all three commands must pass before completion.

## Phase 1: Provider feasibility and API contract

### Objective

Determine whether a candidate Taiwan SMS provider can satisfy the pilot safely and document a provider-neutral contract before any runtime implementation begins.

### Required evidence

- Supported Taiwan destinations, sender number or sender ID rules, provisioning lead time, and test/sandbox availability.
- Authentication and credential lifecycle, including tenant isolation and rotation expectations.
- Outbound request, success, failure, retry, rate-limit, idempotency, message-segmentation, encoding, and delivery-receipt behavior.
- Inbound webhook payload, authenticity verification, replay protection, delivery ordering, and acknowledgement requirements.
- Provider availability, support path, observability, data-handling, and applicable Taiwan consent, opt-out, retention, and content restrictions requiring business or legal confirmation.
- A sanitized API contract with example shapes that contain no real credentials, customer data, phone numbers, or provider secrets.
- A written recommendation, rejected options with reasons, unresolved decisions, cost assumptions, and explicit feasibility result.

### Exit gate

The provider documentation must be sufficient to implement and test without guessing. The contract and provider choice require review and approval. If documentation is insufficient, production credentials are required for basic feasibility, or a schema change appears necessary, stop and open a decision task instead of proceeding.

## Phase 2: SMS provider foundation and outbound sending

### Objective

Implement a tenant-aware SMS provider boundary and safe outbound sending against the approved Phase 1 contract.

### Scope

- Add channel-specific configuration validation and exact tenant/provider resolution.
- Add the provider client, normalized outbound request/result types, bounded timeout and retry behavior, idempotency controls, and secret-safe logging.
- Add automated tests for validation, tenant isolation, provider failures, duplicates, segmentation/encoding limits, and fail-closed behavior.
- Keep inbound SMS, HighLevel conversation mirroring, live credentials, and live sends out of scope.

### Exit gate

Outbound behavior is covered by mocks or an approved non-production sandbox, existing LINE tests remain green, all mandatory validation passes, and no production configuration or data is changed.

## Phase 3: Inbound SMS webhook

### Objective

Receive, authenticate, validate, deduplicate, and normalize inbound SMS events for the exact tenant and provider.

### Scope

- Add a dedicated SMS webhook route that does not reuse a LINE route or LINE signature logic.
- Verify provider authenticity, enforce payload limits, protect against replay, acknowledge predictably, and redact sensitive values from logs.
- Resolve the exact tenant, provider, receiving number, and sender identity; fail closed on missing or ambiguous mappings.
- Define deterministic deduplication and retry behavior with automated tests.
- Keep HighLevel conversation creation and live webhook configuration out of scope.

### Exit gate

Webhook behavior is proven with fixtures or a non-production sandbox, duplicate and malformed events are safe, mandatory validation passes, and LINE webhook behavior remains unchanged.

## Phase 4: Win-CRM and HighLevel conversation integration

### Objective

Connect normalized SMS events and outbound results to Win-CRM and HighLevel conversations without mixing SMS identity or delivery behavior with LINE.

### Scope

- Define tenant-scoped SMS contact and conversation matching independently of `line_profiles` and LINE user IDs.
- Mirror inbound SMS into the correct HighLevel conversation and route approved outbound SMS requests through the SMS provider boundary.
- Prevent duplicate contacts, conversations, messages, and provider sends.
- Preserve provider response formats and make channel identity explicit in audit and error handling.
- Add automated tests covering tenant isolation, contact matching, inbox mirroring, outbound routing, retry boundaries, and LINE regression behavior.

### Exit gate

End-to-end behavior passes with mocks or a non-production sandbox, all identity and mapping decisions are documented, mandatory validation passes, and existing LINE/HighLevel flows remain unchanged. Any required schema change must be proposed and approved in its own migration task before this phase continues.

## Phase 5: Staging and live-test preparation

### Objective

Prepare a controlled, human-approved staging and live-test runbook without autonomously deploying, configuring production, or sending a live message.

### Scope

- Document staging configuration, secret ownership and rotation, tenant/provider onboarding, webhook setup, monitoring, alerts, audit review, rate/cost limits, rollback, and incident response.
- Define a limited test matrix covering outbound, inbound, delivery receipts, duplicates, provider outage, opt-out handling, encoding/segmentation, HighLevel mirroring, and LINE regression checks.
- Specify named human approvals, test tenant and numbers, success thresholds, stop conditions, and evidence capture.
- Separate deployment approval from live-message approval.

### Exit gate

The runbook and rollback plan are reviewed, all unresolved business/compliance/provider decisions have owners, staging validation is complete, and explicit human approval is recorded for any later deployment or live test. The agent must still stop before deploying or sending a live message.

## Unresolved decisions owned by future tasks

- Taiwan SMS provider and fallback-provider policy.
- Sender number or sender ID model and tenant ownership.
- Taiwan consent, opt-out, retention, content, and business-registration requirements.
- SMS encoding, segmentation, throughput, delivery-receipt, and cost limits.
- Inbound number availability and routing model.
- HighLevel provider/message representation and workflow behavior for SMS.
- Persistence needs and whether an approved, backward-compatible schema change is required.
- Sandbox, staging, monitoring, support, and incident-response ownership.

## Recommended next task

Open Phase 1 as a documentation/research issue: evaluate Taiwan SMS provider feasibility and produce the sanitized API contract and decision record. Do not begin provider implementation in that task.
