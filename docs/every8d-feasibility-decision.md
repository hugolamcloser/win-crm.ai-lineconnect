# EVERY8D Phase 1 feasibility decision

## Decision

**NOT YET FEASIBLE**

This result means EVERY8D is **not yet cleared for Phase 2 runtime implementation**. It does not reject EVERY8D as the Taiwan SMS provider. The official specification establishes a substantial HTTP API contract, but mandatory security, duplicate-send, tenant-routing, credential, test, and production-safety facts remain unresolved.

Issue #72 can complete with this decision because Phase 1 explicitly allows `NOT YET FEASIBLE`. Phase 2 must not begin until the hard blockers have written resolutions and the provider contract is updated and approved.

## Sources and evidence boundary

The decision uses only:

- GitHub Issue #72;
- [`../AGENTS.md`](../AGENTS.md);
- [`taiwan-sms-pilot-plan.md`](taiwan-sms-pilot-plan.md);
- the official `簡訊 API2.1 規格書`, Version 2.2, dated 2025/11/14, reviewed in full across 82 PDF pages; and
- the sanitized confirmed behavior recorded in [`every8d-api-contract.md`](every8d-api-contract.md).

Provider behavior absent from, or internally inconsistent in, the official PDF is treated as unknown.

## Decision summary

| Category | Count | Phase 2 effect |
| --- | ---: | --- |
| A. Hard blockers before Phase 2 | 10 | Each requires a written resolution before runtime implementation. |
| B. Provider confirmation / controlled test required | 12 | Must be confirmed by EVERY8D or an explicitly approved non-production test before the affected behavior is implemented or accepted. |
| C. Operational / commercial follow-up | 7 | Requires named ownership before staging or live use; no answer is invented in Phase 1. |

## A. Hard blockers before Phase 2

### A1. Callback authenticity

- **Known:** EVERY8D sends SMS DR/MO callbacks by HTTPS `GET` to a customer URL configured by the provider.
- **Unknown:** No signature, shared secret, mTLS requirement, source-address policy, or other authenticity mechanism is documented.
- **Why it matters:** An unauthenticated inbound route could accept forged delivery or reply events and route false messages into the wrong tenant or conversation.
- **Resolution:** Obtain written EVERY8D confirmation of the supported authenticity mechanism. If none exists, open an explicit security decision before Phase 2/3.

### A2. Callback replay protection and event deduplication

- **Known:** Callback fields include batch and message-related values, and non-200 responses cause retries.
- **Unknown:** No immutable event ID, replay window, duplicate-delivery guarantee, or supported deduplication key is documented.
- **Why it matters:** Provider retries or malicious replay could create duplicate delivery updates, replies, contacts, or conversation messages.
- **Resolution:** Ask EVERY8D for the event-identity and replay contract; verify it later with an approved controlled callback test.

### A3. Callback acknowledgement, retry, timeout, and ordering contract

- **Known:** HTTP status `200` is treated as successful connectivity; non-200 is retried until an unspecified maximum.
- **Unknown:** Required response body, maximum attempts, timeout, retry intervals, backoff, ordering, concurrency, and duplicate behavior are not documented.
- **Why it matters:** The receiver cannot safely choose acknowledgement, queueing, deduplication, or failure behavior without risking event loss or duplication.
- **Resolution:** Obtain the complete callback delivery policy from EVERY8D and confirm it with a controlled non-production test.

### A4. Outbound idempotency and ambiguous-timeout retry safety

- **Known:** The general filtered endpoint can identify the same content sent to the same number within 24 hours. Optional `MR` values correlate personalized/parameter messages within a batch.
- **Unknown:** No general client idempotency key or safe retry behavior is documented for a connection timeout after submission.
- **Why it matters:** Retrying an ambiguous send could send and bill the same SMS more than once.
- **Resolution:** Ask EVERY8D for a supported idempotency mechanism and timeout-reconciliation procedure. Do not treat `MR`, `BATCHID`, or the filtered endpoint as idempotency without confirmation.

### A5. Token lifetime, concurrency, rotation, and revocation

- **Known:** The token endpoint supports obtain, status check, and close operations. The PDF recommends obtaining a token every eight hours.
- **Unknown:** Exact lifetime, renewal semantics, concurrent-token behavior, rotation overlap, revocation guarantees, and expired-token status/HTTP behavior are not documented.
- **Why it matters:** Tenant-scoped credential isolation, rotation, caching, and recovery cannot be designed safely from a recommendation alone.
- **Resolution:** Obtain a written token-lifecycle contract from EVERY8D. Confirm lifecycle edge cases later with non-production credentials only.

### A6. Sender identity, reply channel, and tenant routing

- **Known:** The PDF documents destination numbers and `EventID` interactive-reply activity channels. It does not identify the visible sender number.
- **Unknown:** Sender number/ID, dedicated versus shared ownership, inbound number or channel provisioning, tenant association, and whether ordinary carrier MO is available are not documented.
- **Why it matters:** The middleware must resolve the exact tenant, provider configuration, sender identity, and inbound route without sharing or guessing identifiers.
- **Resolution:** Ask EVERY8D for the complete sender and inbound provisioning model, including identifiers available in outbound, MO query, and callback records.

### A7. Callback correlation ambiguity (`MR` and `MSGID`)

- **Known:** The callback table lists `MR` twice with different meanings. It also lists `MSGID` as supplied during sending, while outbound SMS request tables do not define `MSGID`.
- **Unknown:** The actual field name for the batch sequence, the source and uniqueness of `MSGID`, and the stable per-recipient correlation key are unclear.
- **Why it matters:** Incorrect correlation can attach delivery reports or replies to the wrong recipient, tenant, or message.
- **Resolution:** Obtain corrected callback schema and sample payloads from EVERY8D, then verify them in a controlled non-production test.

### A8. Request and callback encoding

- **Known:** Endpoints use JSON or form encoding. The callback is described as an encoded GET query. Reply content supports Traditional Chinese and English.
- **Unknown:** Required charset, URL-encoding rules, Unicode normalization, emoji handling, malformed-input behavior, and callback query-length limits are not documented.
- **Why it matters:** Incorrect decoding can corrupt message content, break signatures if one exists, miscount segments, or create unsafe parsing differences.
- **Resolution:** Obtain written charset and escaping rules and confirm representative multilingual payloads through a controlled non-production test.

### A9. Message counting, segmentation limits, and charge boundaries

- **Known:** Long SMS supports up to 333 characters; content over 333 is said to be split. International long content is also split. An interactive-reply link adds 17 characters.
- **Unknown:** Character-count algorithm, segment boundaries, maximum segment count, behavior at and over 333, encoding-dependent limits, and per-segment charges are not documented.
- **Why it matters:** The service cannot validate input, predict cost, cap sends, or prevent surprising multi-part delivery without guessing.
- **Resolution:** Request the complete SMS encoding/segmentation table and charge calculation from EVERY8D; confirm boundary cases in an approved test environment.

### A10. Non-production test capability

- **Known:** The PDF gives an enterprise production-style SiteURL and examples but does not identify a sandbox.
- **Unknown:** Sandbox host, test credentials, test numbers, callback test tooling, charge-free behavior, and environment parity are not documented.
- **Why it matters:** Phase 2 must not require production credentials or live recipients for basic contract validation.
- **Resolution:** Ask EVERY8D for a supported sandbox or controlled non-production test process. If none exists, open a separate approval decision before any live-provider validation.

## B. Provider confirmation / controlled test required

### B1. Exhaustive HTTP and provider error contract

- **Known:** Examples include `-99`, `-28`, and DR statuses; success/failure shapes vary by endpoint.
- **Unknown:** Exhaustive endpoint error codes, HTTP status mapping, authentication failure mapping, response content types, and whether errors can use non-documented shapes.
- **Why it matters:** A client must classify permanent, transient, authentication, validation, and partial failures deterministically.
- **Resolution:** Request an official error-code catalogue and verify representative failures in a controlled test.

### B2. Accepted phone-number formats and normalization

- **Known:** Examples show Taiwan national form and `+886` form; general `DEST` uses comma-separated numbers.
- **Unknown:** Formally accepted formats, normalization, whitespace/punctuation handling, Taiwan-only validation, and rejection behavior.
- **Why it matters:** Validation must fail closed rather than silently rewrite or misroute a destination.
- **Resolution:** Obtain written format rules and run approved boundary tests.

### B3. Exact 24-hour duplicate-filter semantics

- **Known:** `SendSMS4FilterMessage.ashx` filters the same content sent to the same mobile number within 24 hours and can evaluate without sending.
- **Unknown:** Atomicity, comparison normalization, clock boundary, scope by account/channel, concurrent-request behavior, and whether provider retries are covered.
- **Why it matters:** The feature may be useful as a safety control but cannot be treated as idempotency without precise semantics.
- **Resolution:** Ask EVERY8D for formal semantics and validate concurrent and boundary cases in a controlled test.

### B4. Rate, throughput, concurrency, and batch limits

- **Known:** DR queries return at most 1,000 records per page. No outbound throughput limit is stated.
- **Unknown:** QPS, concurrent connection limits, maximum recipients/request, payload size, daily limits, throttling status, and retry guidance.
- **Why it matters:** The client needs bounded queues and predictable handling of provider throttling.
- **Resolution:** Obtain provider limits and verify throttling behavior without sending live SMS.

### B5. Delivery-state transitions and finality

- **Known:** The appendix defines literal meanings for statuses including `0`, `100`, `700`, and failure states.
- **Unknown:** Allowed transitions, terminal states, whether updates can regress or arrive out of order, and the distinction between `0` and `700` operationally.
- **Why it matters:** Incorrect finality rules can overwrite successful states or retry messages that are already in flight.
- **Resolution:** Ask EVERY8D for the DR state machine and validate sample timelines in a controlled test.

### B6. Timezone and timestamp rules

- **Known:** Request and response timestamp formats are documented.
- **Unknown:** Timezone, daylight-saving behavior, clock-skew tolerance, and whether all timestamps use the same zone.
- **Why it matters:** Scheduling, expiry, ordering, reconciliation, and audit records require unambiguous instants.
- **Resolution:** Obtain written timezone rules and verify a scheduled non-production case.

### B7. MO pagination inconsistency

- **Known:** The MO section says each query returns at most 1,000 records; its `PNO` field describes pages of 10 records.
- **Unknown:** Correct page size and end-of-pagination behavior.
- **Why it matters:** A poller could omit replies or loop incorrectly.
- **Resolution:** Ask EVERY8D to correct the contract and confirm with a multi-page controlled fixture or test.

### B8. DR, MO, and callback retention windows

- **Known:** Batch IDs are required for DR and MO queries.
- **Unknown:** How long DR/MO data remains queryable, callback replay availability, and deletion timing.
- **Why it matters:** Recovery and reconciliation windows cannot be sized safely.
- **Resolution:** Obtain written retention periods and later align operational recovery windows.

### B9. `BATCHID` uniqueness, scope, and lifecycle

- **Known:** `BATCHID` is returned after sending and used for status, reply lookup, callbacks, and scheduled cancellation.
- **Unknown:** Global versus account scope, uniqueness duration, reuse possibility, persistence guarantees, and behavior for partial sends.
- **Why it matters:** It affects tenant-safe correlation and reconciliation.
- **Resolution:** Obtain written identifier guarantees and confirm sample lifecycle behavior in a controlled test.

### B10. EventID and reply-channel lifecycle

- **Known:** `EventID` adds an interactive-reply link; `-1` uses the default activity channel; replies can be queried or reported with status `999`.
- **Unknown:** Activity creation, expiry, tenant ownership, link lifetime, reply limits, supported browsers, and whether replies can occur without the link.
- **Why it matters:** The inbound product behavior and routing model cannot be specified from the send field alone.
- **Resolution:** Ask EVERY8D for the interactive-reply service contract and demonstrate it only in a later approved test.

### B11. International SMS behavior

- **Known:** International sending is disabled by default, can be enabled in account settings, and does not support long SMS without splitting.
- **Unknown:** Supported destinations, number formats, content restrictions, segmentation, status coverage, and charging.
- **Why it matters:** Destination validation and cost controls cannot assume Taiwan behavior applies internationally.
- **Resolution:** Obtain the supported-country and international-SMS contract. Keep international sending out of the pilot unless separately approved.

### B12. Response parsing, partial success, credit failure, and validity expiry

- **Known:** Several endpoints return comma-separated values; `UNSEND` represents messages not sent for insufficient credit; `RETRYTIME` defaults to 1,440 minutes.
- **Unknown:** Escaping rules for commas/newlines, empty-field behavior, precise partial-success semantics, what happens during validity expiry, and whether the provider retries carrier delivery during that period.
- **Why it matters:** Parsing or retry mistakes could misclassify accepted, rejected, or partially sent batches.
- **Resolution:** Request formal response grammar and validity-period behavior, then test sanitized fixtures and non-production edge cases.

## C. Operational / commercial follow-up

### C1. Availability, SLA, and maintenance

- **Known:** The PDF documents HTTPS integration but no availability commitment.
- **Unknown:** SLA, maintenance windows, incident notifications, disaster recovery, and service-region guarantees.
- **Why it matters:** Operational expectations and fallback decisions require measurable commitments.
- **Resolution:** Later operational decision based on EVERY8D commercial/service documentation.

### C2. Support onboarding and escalation

- **Known:** The PDF refers users to sales/customer service for dedicated-platform SiteURL and API questions.
- **Unknown:** Named support channel, hours, severity levels, escalation path, and response targets.
- **Why it matters:** Pilot incidents need an accountable provider path.
- **Resolution:** EVERY8D confirmation followed by a later support-ownership decision.

### C3. Pricing and credit assumptions

- **Known:** SMS responses expose credit balance, send cost, and real cost. The PDF does not provide SMS pricing.
- **Unknown:** Taiwan SMS price, long-message segment pricing, reply-channel fees, international fees, minimum commitment, taxes, and credit expiry.
- **Why it matters:** Cost limits and pilot budget cannot be set from API fields alone.
- **Resolution:** Obtain a commercial quote and make a later budget decision. No price is assumed here.

### C4. Consent, opt-out, content, and blacklist responsibilities

- **Known:** DR statuses include provider/carrier blacklist and sensitive-keyword blocking outcomes.
- **Unknown:** Customer consent duties, opt-out workflow, suppression ownership, content restrictions, quiet hours, and applicable Taiwan legal requirements.
- **Why it matters:** Technical delivery does not establish lawful or acceptable use.
- **Resolution:** Later business/legal decision informed by EVERY8D policy confirmation.

### C5. Data handling, residency, retention, and deletion

- **Known:** The provider processes destination numbers, names, optional email, content, delivery records, and replies.
- **Unknown:** Data location, encryption-at-rest, access controls, subprocessors, retention, deletion, export, and breach notification.
- **Why it matters:** Customer-data governance and privacy review require these facts.
- **Resolution:** Obtain EVERY8D privacy/security documentation and complete a later data-governance review.

### C6. Sender provisioning lead time and commercial ownership

- **Known:** Sender identity and reply-channel provisioning are not defined in the API PDF.
- **Unknown:** Lead time, setup fees, dedicated/shared ownership, portability, tenant assignment, and offboarding.
- **Why it matters:** Pilot schedule and tenant onboarding depend on the commercial provisioning model.
- **Resolution:** EVERY8D sales confirmation and a later onboarding decision after the technical routing blocker is resolved.

### C7. Observability, reconciliation, and incident evidence

- **Known:** The API exposes balance, batch, DR, MO, cost, and callback data.
- **Unknown:** Provider dashboards, export capabilities, audit history, alerting, reconciliation reports, and incident evidence retention.
- **Why it matters:** Operations need to diagnose delivery, billing, and callback discrepancies without exposing secrets or customer content.
- **Resolution:** Demonstrate provider tooling in a later operational review and assign monitoring ownership.

## Prioritized checklist for EVERY8D support

### Priority 0 - required before Phase 2 clearance

1. Provide the callback authentication mechanism and exact verification procedure.
2. Provide callback event identity, replay, deduplication, acknowledgement, retry, timeout, ordering, and concurrency rules.
3. Provide the supported outbound idempotency or ambiguous-timeout reconciliation mechanism.
4. Provide exact token lifetime, rotation, concurrent-token, revocation, and expiry-error behavior.
5. Define sender number/ID, reply-channel provisioning, dedicated/shared ownership, and tenant-routing identifiers.
6. Correct the callback schema: duplicated `MR`, undefined outbound `MSGID`, and the stable per-recipient correlation key.
7. Provide charset, URL-encoding, Unicode, and callback query-length rules.
8. Provide character-count, segmentation, maximum-length, and per-segment charging rules, including the 333-character boundary and `EventID` link.
9. Provide a sandbox or approved non-production test process with test credentials/numbers and callback testing.

### Priority 1 - contract confirmation and controlled testing

10. Provide the exhaustive HTTP/provider error catalogue and response grammar.
11. Define accepted phone formats and normalization.
12. Define duplicate-filter atomicity and 24-hour comparison scope.
13. Provide rate, throughput, concurrency, payload, and recipient limits plus throttling behavior.
14. Provide the DR state machine and terminal-state rules.
15. State the timezone for every request, DR, MO, and callback timestamp.
16. Resolve MO page size: 1,000 versus 10.
17. State DR/MO/callback retention and `BATCHID` uniqueness/lifecycle guarantees.
18. Provide the `EventID` activity/channel lifecycle and whether carrier-native MO is available.
19. Provide international SMS destination, format, segmentation, status, and charging rules.
20. Define partial success, insufficient-credit behavior, `RETRYTIME` expiry, and response escaping.

### Priority 2 - operational and commercial readiness

21. Provide SLA, maintenance, support, and escalation terms.
22. Provide SMS, segmentation, reply-channel, international, and setup pricing.
23. Provide consent, opt-out, content, blacklist, and acceptable-use responsibilities.
24. Provide privacy, security, residency, retention, deletion, and breach documentation.
25. Provide sender/reply provisioning lead times and ownership terms.
26. Demonstrate dashboards, exports, audit evidence, monitoring, and reconciliation tools.

## Rejected assumptions and approaches

| Rejected approach | Reason |
| --- | --- |
| Invent a callback signature or reuse LINE signature verification. | No EVERY8D mechanism is documented, and SMS must remain separate from LINE. |
| Route callbacks globally by mobile number or `BATCHID`. | Tenant scope and identifier guarantees are unconfirmed. |
| Treat `MR` or `MSGID` as an idempotency key. | Their correlation semantics are incomplete or internally inconsistent. |
| Treat the 24-hour filter endpoint as universal retry protection. | Its atomicity and timeout-retry contract are undocumented. |
| Use UID/PWD on every service request as the default design. | The provider supports it, but credential-lifecycle and tenant-isolation decisions are unresolved. |
| Infer UTF-8, segment counts, rate limits, or delivery finality from common SMS practice. | The Phase 1 exit gate forbids guessing. |
| Use production credentials or live recipients to close evidence gaps. | Project governance prohibits production credentials and live SMS during this work. |

## Risks and assumptions

- No provider behavior is assumed beyond the official PDF.
- No pricing, throughput, delivery-finality, sender, sandbox, or callback-security assumption is accepted.
- The sanitized contract preserves provider field names, including provider spellings such as `SENDED`.
- The official examples are treated as illustrative shapes, not proof of sandbox availability.
- The current result may change after written provider confirmation and an explicitly approved non-production test.

## Phase gate and recommended next step

Phase 2 is not approved.

The smallest safe next step is a provider-clarification decision task owned by the project maintainer:

1. Send the prioritized checklist to EVERY8D support or sales.
2. Store only non-sensitive written answers as approved project evidence.
3. Decide whether a controlled non-production test is available and separately authorize it without production credentials or live customer numbers.
4. Update the sanitized contract and feasibility decision in a focused review task.
5. Approve Phase 2 only if all hard blockers are resolved and the contract can be implemented and tested without guessing.

If that gate later passes, the conditional next implementation task is **Phase 2 - tenant-aware EVERY8D provider foundation and safe outbound sending**, limited to mocks or an approved non-production environment and kept separate from inbound SMS, GHL integration, LINE behavior, production configuration, and live sends.

## Task evidence record

### Task identification

- GitHub task: Issue #72 - Phase 1 EVERY8D Provider Feasibility and Sanitized API Contract
- Approved branch: `agent/phase-1-every8d-api-contract`
- Authority: documentation-only; commit, push, and draft PR authorized; merge and deploy prohibited
- Source review: complete 82-page official specification

### Files inspected

| File or source | Relevant finding |
| --- | --- |
| Official EVERY8D specification v2.2 | Establishes the confirmed API behavior and exposes the unresolved provider questions. |
| `AGENTS.md` | Requires provider/channel separation, secret safety, stop-on-guessing, and no autonomous merge/deploy. |
| `docs/taiwan-sms-pilot-plan.md` | Defines Phase 1 evidence and the no-guessing exit gate. |
| GitHub Issue #72 | Defines the two documentation deliverables and allowed feasibility results. |

### Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `docs/every8d-api-contract.md` | Adds the sanitized provider contract. | None. |
| `docs/every8d-feasibility-decision.md` | Adds the feasibility decision, unresolved questions, and provider checklist. | None. |

### Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | TypeScript completed with no errors. |
| `npm test` | Passed | 291 tests passed; 0 failed, cancelled, skipped, or todo. |
| `npm run build` | Passed | TypeScript build completed with no errors. |

### Budget and stop-rule status

- Active coding tasks: one documentation-only task
- Implementation correction loops used: zero at authoring
- Reviewer correction loops used: zero
- Production credentials or data accessed: no
- Live SMS sent: no
- Runtime, Railway, Supabase, GHL, or LINE behavior changed: no
- Stop rule triggered: no; unresolved provider behavior is recorded rather than guessed
