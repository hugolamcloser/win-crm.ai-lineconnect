# EVERY8D Phase 1B/1D feasibility decision

## Scope and evidence boundary

Issue #74 re-evaluated the ten hard blockers established by Issue #72 and PR #73. Issue #77 subsequently supplied separately approved, sanitized controlled evidence for basic outbound connectivity and an attempted interactive-reply path. This update does not authorize another provider request, production activation, deployment, or inbound/two-way implementation.

The review uses only:

- GitHub Issues #74 and #77;
- [`../AGENTS.md`](../AGENTS.md);
- [`taiwan-sms-pilot-plan.md`](taiwan-sms-pilot-plan.md);
- [`every8d-api-contract.md`](every8d-api-contract.md);
- this document's existing Phase 1 blocker register; and
- the official EVERY8D API 2.1 specification evidence already incorporated into Phase 1.

Phase 1B supplied authorized observations from an authenticated EVERY8D dashboard. Phase 1D then supplied sanitized controlled results for authentication, one ordinary outbound send, delivery-status lookup, physical handset receipt, a failed ordinary carrier reply, and one rejected `EventID=-1` attempt. Additional sanitized UI evidence compares the documented SafeSay activity-channel controls with their absence on this account. These results are classified only within their observed scope; they do not create undocumented provider guarantees.

## Evidence classifications

| Classification | Application in Phase 1B |
| --- | --- |
| Confirmed by official EVERY8D documentation | The API 2.1 specification explicitly states the behavior, as captured in the sanitized contract. |
| Confirmed by EVERY8D account/dashboard behavior | An authorized, non-sensitive dashboard observation demonstrates behavior but is not treated as an API guarantee. No such evidence was available in this review. |
| Confirmed by a separately approved controlled test | A bounded observed result establishes only the exact request/account/recipient behavior tested; it is not generalized to production, other tenants, other content, or undocumented semantics. |
| Requires written provider confirmation | The official specification is silent, ambiguous, or internally inconsistent and EVERY8D must answer in writing. |
| Requires a separately approved controlled test | Provider statements or unclear edge cases must be verified in a sandbox or explicitly approved test process. Issue #74 authorized planning only; Issue #77 later authorized specific bounded cases. |
| Still unresolved | No qualifying evidence currently establishes the behavior. |

Dashboard labels must never be promoted to an API guarantee without supporting written provider documentation or controlled evidence.

## Dashboard evidence incorporated

The sanitized evidence IDs below are defined in [`every8d-api-contract.md`](every8d-api-contract.md#sanitized-every8d-dashboard-evidence). No account identity, credential, balance amount, phone number, message, recipient, or customer information is recorded.

| Evidence | What it narrows | What it does not establish |
| --- | --- | --- |
| D1 Report settings | Confirms a callback URL field, attempt-count setting, `BIG5`/`UTF-8` choices, and `POST`/`GET` choices exist in the authenticated UI. | Authentication, replay protection, attempt semantics, retry timing, POST/GET payload parity, acknowledgement, ordering, duplicate behavior, or wire-encoding rules. |
| D2 Reply forwarding | Confirms `開啟回覆轉寄` and a `回覆轉寄說明` flow in which recipients can reply and EVERY8D can forward replies toward customer systems/email; SafeSay is described separately. | Sender identity, carrier-native MO, EventID/SafeSay relationship, inbound provisioning, shared/dedicated ownership, tenant routing, correlation, or forwarding guarantees. |
| D3–D6 SMS/MMS/query UI | Confirms separate SMS and MMS functions, SMS send/parameter/scheduled/report management, send records/status query, and `查詢發送回覆明細`. | API equivalence, identifier guarantees, idempotency, pagination, retention, state finality, tenant correlation, or delivery guarantees. |
| D7 Active prepaid account | Confirms the observed authenticated account was active and exposed a prepaid balance. | Pricing, balance amount, credit expiry, production readiness, sandbox availability, test authorization, or permission to send. |

These observations narrow unanswered questions but do not resolve an implementation-safety blocker.

## Phase 1D controlled evidence incorporated

Evidence E1–E4 is defined in [`every8d-api-contract.md`](every8d-api-contract.md#sanitized-phase-1d-controlled-and-accountui-evidence).

### Proven facts

- One controlled authentication succeeded over HTTPS and produced a usable bearer token without exposing it.
- One ordinary one-recipient `SendSMS` request succeeded, returned a `BATCHID`, and was physically delivered to the approved Taiwan handset.
- `GetDeliveryStatus` accepted that batch as `BID` and returned a valid response.
- Ordinary carrier reply from the exact iPhone conversation was not deliverable for that sender identity.
- One `EventID=-1` request reached EVERY8D after successful transport/authentication and was rejected with provider status `-290`; no interactive SMS was delivered and no retry occurred.
- The observed account does not expose the documented `互動回覆簡訊`, `活動頻道管理`, or `客服設定` controls, and the public SafeSay login path did not provide separate access.

### Strong hypotheses, not provider guarantees

- The `EventID=-1` rejection and missing account controls are consistent with a missing entitlement, missing activity-channel provisioning, or no usable default channel on this account.
- The ordinary sender identity used by the successful outbound send appears unsuitable for direct carrier reply in the observed case.

Neither hypothesis establishes sender ownership/directionality or the meaning of `-290`.

### Still unresolved

- The official meaning and permanence/transience classification of provider status `-290`.
- How SafeSay access is entitled or provisioned, who creates activity channels, and how a default channel is assigned to this account.
- Whether SafeSay, `EventID`, reply forwarding, carrier-native MO, and `GetReplyMessage` are separate or connected reply mechanisms.
- Sender ownership/lifecycle, tenant routing, stable recipient-level correlation, callback security, provider idempotency, token lifecycle, encoding breadth, segmentation, rates, limits, retention, and sandbox availability.

## Blocker-resolution table

This table updates the existing A1–A10 register below.

| Item | Previous status | Evidence | New status | Next action |
| --- | --- | --- | --- | --- |
| A1 Callback authenticity | Hard blocker | No new callback evidence. | Remains hard for inbound/callback phases; not required for a mock-only Phase 2A outbound foundation with no callback. | Obtain written security contract before Phase 3 or any callback activation. |
| A2 Callback replay and deduplication | Hard blocker | No new callback evidence. | Remains hard for inbound/callback phases; not required for a callback-free Phase 2A foundation. | Obtain event-identity/replay contract before Phase 3. |
| A3 Callback acknowledgement, retry, timeout, and ordering | Hard blocker | No new callback evidence. | Remains hard for inbound/callback phases; not required for a callback-free Phase 2A foundation. | Obtain delivery policy before Phase 3 or callback activation. |
| A4 Outbound idempotency and ambiguous timeout | Hard blocker | E1 proves one successful send; it supplies no ambiguous-timeout or idempotency evidence. The spike intentionally does not retry. | Remains an outbound activation blocker. A Phase 2A implementation may proceed only with automatic provider retry disabled and no live sending. | Obtain written idempotency/reconciliation rules and separately approve timeout testing before activation. |
| A5 Token lifecycle | Hard blocker | E1 proves acquisition and immediate reuse across one send/status sequence. | Basic acquisition/immediate reuse resolved for the controlled case; lifecycle/caching/rotation remains an activation blocker. | Keep Phase 2A token behavior replaceable and default-off; obtain the lifecycle contract before activation. |
| A6 Sender identity, reply channel, and tenant routing | Hard blocker | E2 shows ordinary reply failure. E3 returned opaque `-290` for `EventID=-1`. E4 shows the documented SafeSay/channel controls are inaccessible on this account. | Strengthened hard blocker for interactive/two-way capability at the account/channel/provisioning layer. It does not block outbound-only foundation code that contains no inbound or interactive behavior. | Do not retry; obtain written status/provisioning/entitlement and tenant-routing answers. |
| A7 Callback correlation (`MR`/`MSGID`) | Hard blocker | E1 proves `BATCHID`/`BID` correlation for one send/status query; no inbound event exists. | Outbound batch/status correlation resolved for the controlled case; inbound/callback recipient correlation remains hard-blocked. | Obtain corrected schema and provisioned reply test before inbound work. |
| A8 Request and callback encoding | Hard blocker | E1 proves the exact controlled Traditional Chinese content traversed the ordinary send path and handset successfully. | Exact controlled outbound encoding works; general message/callback encoding remains an activation/inbound blocker. | Limit Phase 2A to mocks and explicit validation; obtain broader encoding evidence before activation. |
| A9 Counting, segmentation, and charges | Hard blocker | E1 proves one short message can be delivered; no sanitized segment/charge boundary evidence was supplied. | Remains an outbound activation blocker; does not prevent default-off mock-only foundation work. | Obtain counting/segmentation/rate evidence before activation. |
| A10 Non-production test capability | Hard blocker | Issue #77 demonstrates a project-approved bounded live test process, but no sandbox or provider-approved non-production facility. | Controlled-test execution is proven possible under explicit approval; sandbox/parity and repeatable test-process guarantees remain unresolved. | Phase 2A may use mocks only; require separate approval for every later provider interaction. |

## Existing hard blockers reviewed individually

### A1. Callback authenticity

- **Exact unanswered question:** What supported mechanism proves that a callback came from EVERY8D: signature, shared secret, mTLS, stable source allowlist, or another control?
- **Why it matters:** An unauthenticated route could accept forged delivery or reply events and route false data into the wrong tenant or conversation.
- **Official evidence available:** EVERY8D calls a configured HTTPS URL with GET query parameters. No authenticity mechanism is documented.
- **Dashboard/account evidence:** D1 confirms that `用戶發送回報設定` exposes callback/report configuration controls. No callback-authentication observation was supplied.
- **Evidence needed:** Written provider security contract. If the answer is "none," an explicit Win-CRM security risk decision is required; a test cannot create a missing security guarantee.
- **Status:** Remains a hard blocker.

### A2. Callback replay protection and event deduplication

- **Exact unanswered question:** What immutable event identity, uniqueness scope, replay window, duplicate guarantee, and redelivery behavior apply?
- **Why it matters:** Provider retries or replay could duplicate delivery updates, replies, contacts, or conversation messages.
- **Official evidence available:** Callback fields include batch/message-related values and non-200 responses cause retries; no event ID or replay contract is defined.
- **Dashboard/account evidence:** D1 confirms callback/report configuration UI, but no event identity, replay, or deduplication control was observed or supplied.
- **Evidence needed:** Written identity/replay contract plus a separately approved duplicate and replay test.
- **Status:** Remains a hard blocker.

### A3. Callback acknowledgement, retry, timeout, and ordering

- **Exact unanswered question:** How do the dashboard's GET/POST and attempt-count settings map to runtime payloads; and what response body, allowed/default attempt values, timeout, retry interval/backoff, delivery age, ordering, concurrency, and duplicate behavior apply?
- **Why it matters:** The receiver cannot choose safe acknowledgement, queueing, and recovery behavior without risking loss or duplication.
- **Official evidence available:** HTTP 200 is success; non-200 causes retries until an unspecified maximum.
- **Dashboard/account evidence:** D1 confirms a callback attempt-count setting plus GET/POST method choices. It does not establish the selected value, allowed range, default, retry trigger/timing, payload shape, acknowledgement, ordering, or concurrency.
- **Evidence needed:** Written delivery policy plus a separately approved acknowledgement/retry/ordering test.
- **Status:** Remains a hard blocker.

### A4. Outbound idempotency and ambiguous-timeout retry safety

- **Exact unanswered question:** Is there a native idempotency key or safe reconciliation procedure after a connection timeout, and can the 24-hour filter safely protect concurrent retries?
- **Why it matters:** A retry after an accepted-but-unobserved send can duplicate delivery and billing.
- **Official evidence available:** `MR` is a within-batch correlation value for personalized/parameter sends. `SendSMS4FilterMessage.ashx` compares the same content and mobile within 24 hours and supports `IsSend=false`. Atomicity and retry guarantees are not documented.
- **Dashboard/account evidence:** D3/D5 confirms send and records/status query UI functions. It supplies no idempotency key, timeout reconciliation, or filter atomicity evidence.
- **Evidence needed:** Written idempotency, filter comparison/scope/atomicity, and timeout-reconciliation contract plus a separately approved timeout/concurrency test.
- **Status:** Remains a hard blocker. `MR`, `BATCHID`, `MSGID`, and the filter endpoint are not approved as idempotency keys.

### A5. Token lifecycle

- **Exact unanswered question:** What are the exact lifetime, reuse, concurrent-token, replacement, rotation-overlap, expiry, close/revocation, error-response, and authentication-retry rules?
- **Why it matters:** Tenant-scoped caching, rotation, fail-closed behavior, and recovery cannot be designed from a refresh recommendation alone.
- **Official evidence available:** Obtain, status-check, and close operations exist; obtaining a token every eight hours is recommended.
- **Dashboard/account and controlled evidence:** D7 confirms the account was active. E1 proves token acquisition and immediate reuse across one send/status sequence; it supplies no lifecycle, rotation, expiry, revocation, or concurrency evidence.
- **Evidence needed:** Written lifecycle/error contract plus a separately approved non-production lifecycle test.
- **Status:** Basic acquisition and immediate reuse are resolved for the controlled case. Long-lived runtime lifecycle/caching remains an outbound activation blocker.

### A6. Sender identity, reply channel, and tenant routing

- **Exact unanswered question:** What sender identity recipients see; whether replies use EventID web interaction or carrier-native MO; how inbound numbers/channels are provisioned; whether they are shared or dedicated; and what stable resource identifies a tenant?
- **Why it matters:** Win-CRM must resolve the exact tenant, provider configuration, sender, and inbound resource without global or ambiguous routing.
- **Official evidence available:** `EventID` adds an interactive-reply link, `-1` selects a default activity channel, replies can be queried by batch, and callback status `999` represents a reply. Sender and provisioning behavior are absent.
- **Dashboard/account and controlled evidence:** D2 documents reply forwarding. E2 shows ordinary carrier reply was not deliverable for the observed sender. E3 shows `EventID=-1` was rejected with undocumented status `-290`. E4 shows the documented SafeSay/channel administration is inaccessible on this account.
- **Evidence needed:** Written sender/inbound provisioning, ownership, lifecycle, native-MO, and tenant-routing contract plus a separately approved single-tenant test.
- **Status:** Remains a hard blocker for interactive/two-way capability and is now empirically localized to unresolved account/channel/provisioning behavior. Do not retry without new provider evidence.

### A7. Callback correlation ambiguity (`MR` and `MSGID`)

- **Exact unanswered question:** What each `MR` row means, where `MSGID` originates, which values are unique and stable, and what recipient-level value joins send, DR, MO, and callback records?
- **Why it matters:** Incorrect correlation can attach a delivery report or reply to the wrong recipient, tenant, or message.
- **Official evidence available:** `BATCHID` is returned and `BID` carries it into queries/cancellation. Optional caller `MR` is unique within a personalized/parameter batch. The callback table duplicates `MR` with different meanings and refers to outbound `MSGID` that no send table defines.
- **Dashboard/account and controlled evidence:** D5/D6 confirms records/status and reply-detail UI functions. E1 proves `BATCHID`/`BID` correlation across one ordinary send/status query. No inbound event or stable end-to-end recipient identifier was observed.
- **Evidence needed:** Corrected written schema, identifier scope/lifecycle guarantees, sanitized provider samples, and a separately approved end-to-end correlation test.
- **Status:** Outbound batch/status correlation is resolved for the controlled case. Inbound/callback correlation remains a hard blocker; no end-to-end identifier or idempotency key is established.

### A8. Request and callback encoding

- **Exact unanswered question:** How do the dashboard's `BIG5`/`UTF-8` report choices map to callback bytes/defaults and HTTP methods; and what form/query escaping, Unicode normalization, emoji/combining-character behavior, malformed-input behavior, and callback URL-length rules apply?
- **Why it matters:** Incorrect encoding can corrupt content, change segment counts, break any future signature verification, or create unsafe parser differences.
- **Official evidence available:** Endpoint media types are documented; the callback is described only as encoded; reply content identifies Traditional Chinese and English.
- **Dashboard/account and controlled evidence:** D1 confirms report-encoding choices. E1 proves the exact controlled Traditional Chinese outbound content traversed the form-encoded request and arrived correctly; broader Unicode and callback encoding remain untested.
- **Evidence needed:** Written charset/escaping contract plus separately approved Traditional Chinese, ASCII, URL, emoji, and combining-character tests.
- **Status:** Resolved only for the exact controlled outbound content. General outbound and callback encoding remains an activation/inbound blocker.

### A9. Message counting, segmentation, and charge boundaries

- **Exact unanswered question:** What algorithm counts characters, where segments split, how encoding affects the count, what the maximum segment count is, and how each segment/EventID reply feature is billed?
- **Why it matters:** Win-CRM cannot validate content, predict cost, cap sending, or explain multipart delivery without those rules.
- **Official evidence available:** Long SMS is described as supporting up to 333 characters, content above 333 is split, international long content is split, and the EventID link adds 17 characters.
- **Dashboard/account and controlled evidence:** D7 confirms a visible prepaid balance; E1 proves one short message was deliverable. No rate, segment count, boundary, charge calculation, or credit-expiry evidence is recorded.
- **Evidence needed:** Written counting/segmentation/charge table plus separately approved boundary and multilingual tests.
- **Status:** Remains an outbound activation blocker; it does not prevent default-off, mock-only Phase 2A foundation work.

### A10. Non-production test capability

- **Exact unanswered question:** Does EVERY8D provide a sandbox, test endpoint, test credentials/numbers, no-charge messages, callback simulator, or provider-approved controlled production process?
- **Why it matters:** Contract validation must not require production credentials, customer recipients, or uncontrolled live sending.
- **Official evidence available:** No sandbox or non-production facility is documented.
- **Dashboard/account and controlled evidence:** D7 confirms an active prepaid account and D1–D6 confirm production-like functions. Issue #77 proves a project-approved bounded live test process can be executed, but no sandbox, test endpoint, provider-approved test credential/number, no-charge facility, or repeatable provider test contract is identified.
- **Evidence needed:** Written provider test-process confirmation followed by a separate project decision authorizing a bounded test.
- **Status:** Mock-only Phase 2A work can proceed under a separate issue. Any additional provider interaction remains separately gated; sandbox/parity and provider test-process guarantees remain unresolved.

## Resolution summary

- **Fully resolved original A1–A10 blocker groups:** 0; their broad production/inbound guarantees remain incomplete.
- **Resolved controlled outbound proof points:** HTTPS authentication, immediate token reuse within one invocation, one-recipient ordinary `SendSMS`, success parsing/`BATCHID`, `GetDeliveryStatus` with `BID`, and physical Taiwan handset delivery for the exact tested case.
- **Interactive/two-way conclusion:** blocked at the account/channel/provisioning layer; `EventID=-1` returned undocumented status `-290`, no interactive message was delivered, and the expected SafeSay administration is inaccessible.
- **Phase 2A implementation gate:** conditionally open only for a separately approved, default-off, mock-validated outbound foundation task with no real credentials/sends, no automatic provider retry, no callback, no inbound, and no production route or deployment.
- **Outbound activation/deployment gate:** closed pending A4, the remaining A5 lifecycle questions, broader A8/A9 evidence, tenant/provider configuration design, and an explicitly approved staging/live process.
- **Phase 3 inbound/two-way gate:** closed pending A1–A3, A6, A7, provisioned reply capability, and verified callback security/correlation.

## Prioritized provider-support checklist

Every question below remains incompletely answered after combining the official specification with D1–D7 and E1–E4. The controlled evidence resolves basic outbound connectivity but does not eliminate the API/security/operational guarantee groups needed for activation or inbound work. This is the filtered checklist for human-approved provider contact; no issue authorizes sending it automatically.

### Hard blockers

1. D1 confirms callback configuration exists; what callback authenticity controls are supported, and what exact verification procedure and key/source rotation rules apply?
2. What immutable callback event identity, uniqueness scope, replay window, deduplication key, and duplicate-delivery guarantees apply?
3. For D1's configurable GET/POST method and attempt count, what payload, allowed/default values, acknowledgement body, timeout, retry schedule/backoff, maximum delivery age, ordering, and concurrency rules apply?
4. What native idempotency or timeout-reconciliation mechanism protects an accepted-but-unobserved outbound send?
5. What exact token lifetime, reuse, concurrent-token, rotation-overlap, expiry, close/revocation, error-response, and authentication-retry rules apply?
6. Given D2/E2–E4, what outbound sender identity and underlying reply transport apply; how does forwarding relate to EventID and SafeSay; what entitlement/provisioning exposes `互動回覆簡訊` and activity-channel administration; and what inbound shared/dedicated ownership, lifecycle, native-MO availability, and tenant-routing identifier apply?
7. Please provide a corrected callback schema and identifier contract for `BATCHID`/`BID`, both `MR` entries, `MSGID`, `EventID`, and the stable recipient-level correlation value.
8. For D1's `BIG5`/`UTF-8` report choices, what default/selection scope, actual callback bytes, GET/POST percent/form encoding, Unicode normalization, emoji/combining-character, malformed-input, and query/payload-length rules apply?
9. What character-count, segmentation, maximum-segment, EventID-overhead, and per-segment/reply billing rules apply, including the 333-character boundary?
10. D7 confirms an active prepaid account but no test facility; what sandbox or approved controlled-test process exists, including host, credentials, recipient, callbacks, charge treatment, environment parity, and support supervision?

### Controlled-test questions

1. D3/D5 confirms send/query UI but not its API failure contract; what exhaustive HTTP/provider error catalogue, including the observed `-290`, response content types, and permanent/transient/authentication/partial-failure classifications should tests assert?
2. Which Taiwan formats among `09xxxxxxxx`, `8869xxxxxxxx`, and `+8869xxxxxxxx` are accepted, and how are whitespace, punctuation, and invalid numbers handled?
3. How does the 24-hour filter normalize and compare number/content, what is its account/channel/time scope, and is the operation atomic under concurrency?
4. What QPS, concurrency, recipients/request, payload/batch, throughput, query, and throttling limits and retry guidance should tests enforce?
5. D5 confirms status-query UI; what DR state transitions, terminal states, out-of-order behavior, and operational distinction between statuses `0` and `700` apply?
6. What timezone, daylight-saving, and clock-skew rules apply to scheduling, DR, MO, and callback timestamps?
7. D6 confirms reply-detail querying; for API MO results, is pagination 10 or 1,000 records per page, and what signals the final page?
8. What are the DR/MO/callback retention windows and `BATCHID` uniqueness, scope, reuse, partial-send, and lifecycle guarantees?
9. Given D2's reply-forwarding flow, what EventID/SafeSay/forwarding relationship, activity/link lifecycle, and reply limits apply, and can replies occur without the EventID link through carrier-native MO?
10. What response escaping, empty-field, partial-success, insufficient-credit, and `RETRYTIME` expiry/carrier-retry behavior should fixtures and tests cover?

### Operational/commercial follow-ups

1. What SLA, maintenance, incident-notification, disaster-recovery, and service-region commitments apply?
2. What support hours, severity levels, named escalation path, and response targets apply during a pilot incident?
3. Given D7's prepaid-balance UI, what domestic, segmented, EventID/reply, international, setup, tax, minimum-commitment, deduction, and credit-expiry pricing rules apply?
4. What consent, opt-out, suppression, quiet-hour, content, blacklist, and Taiwan legal/acceptable-use responsibilities belong to EVERY8D versus Win-CRM?
5. What data residency, encryption, access, subprocessor, retention, deletion, export, and breach-notification controls apply?
6. What sender/reply-resource provisioning lead time, fees, shared/dedicated ownership, tenant assignment, portability, and offboarding rules apply?
7. D3–D6 confirms send/query/management UI functions; what exports, audit history, alerts, reconciliation reports, API/UI field equivalence, and incident-evidence retention are available?

## Controlled-test readiness plan

### Authorization boundary

Issue #77 separately authorized and completed one ordinary outbound case and one `EventID=-1` attempt. The ordinary case delivered; the interactive case was rejected with opaque status `-290` and was not retried. Current authorization has returned to **zero further provider requests or SMS messages**, zero callback configuration, and zero provider-account changes. Any additional execution requires all of the following:

1. Written EVERY8D answers for the relevant checklist items.
2. A provider-supported sandbox or explicitly approved controlled process.
3. A separate GitHub issue and explicit human approval naming the environment, account owner, test recipient, message/cost caps, test window, and operator.
4. Non-production or purpose-created credentials supplied outside the repository.
5. Confirmation that no customer recipient, customer content, bulk send, or marketing campaign is involved.

### Proposed test matrix

All future outbound cases use one maintainer-approved Taiwan test handset. Sanitized hashes/references, not full credentials or phone numbers, are recorded in project evidence.

Issue #77 supplies partial evidence for T3 (one short Traditional Chinese ordinary send delivered) and T7 (the send request reached the provider but was rejected before delivery/reply because `EventID=-1` returned `-290`). T7 remains incomplete and blocked; it must not be retried until provisioning evidence changes.

| Test | Exact behavior | Evidence to capture | Maximum outbound submissions |
| --- | --- | --- | ---: |
| T1 Token lifecycle | Obtain, reuse, concurrent token behavior, status check, expiry/close/revocation, and authentication error/recovery. | Sanitized timestamps, HTTP/provider status classes, token-state transitions, and provider confirmation comparison. | 0 |
| T2 ASCII and URL | Short ASCII content and an HTTPS URL round-trip through send, DR, and handset. | Sanitized request shape, accepted response, BATCHID, DR sequence, received content/length, and billed segments. | 1 |
| T3 Traditional Chinese | Short Traditional Chinese content round-trip. | Decoded content equality, character count, DR sequence, and billed segments. | 1 |
| T4 Emoji and combining characters | One emoji case and one combining-character case, only if provider says they are supported. | Exact Unicode code points before/after, rejection or delivery behavior, counts, and billing. | 2 |
| T5 Length/segmentation boundaries | Provider-confirmed boundaries below, at, and above one relevant threshold, including EventID overhead only if supported. | Provider count, segment count, handset rendering/order, DR records, and per-case charge. | 3 |
| T6 Taiwan number forms | Approved national and international forms for the same test handset. | Accepted/rejected forms, provider normalization, response classes, and destination identity match. | 2 |
| T7 EventID reply/correlation | One EventID send and one reply by the provider-approved mechanism. | Activity/channel identity, outbound BATCHID/MR/MSGID fields, MO/query/callback fields, reply content/time, and tenant-resource mapping. | 1 |
| T8 Callback delivery | Reuse T7/provider simulator to exercise 200 acknowledgement, one deliberate non-200, retry, duplicate, delay, and ordering. | Sanitized callback sequence, headers/query shape, attempt timestamps, duplicates, ordering, and acknowledgement behavior. | 0 additional |
| T9 Timeout and duplicate filter | Provider-supervised ambiguous timeout plus filter dry-run/send behavior; never perform an unapproved automatic retry. | Provider send record, client observation, filter result, duplicate outcome, atomicity evidence, and billed count. | 2 |
| T10 Query/errors/limits | DR/MO pagination, representative validation/auth/throttle failures, retention observation, and response grammar using fixtures or provider tooling. | Sanitized pages, end condition, HTTP/provider status mapping, timestamps, and retention/limit statements. | 0 |

The future plan ceiling is 12 provider-accepted outbound submissions to one approved test handset. It also has a hard ceiling of 18 carrier-billed SMS segments; if EVERY8D cannot guarantee that cap before execution, the test must not start. There is no bulk or multi-recipient test.

### Cost exposure

- **Issue #74 authorized exposure:** zero.
- **Issue #77 observed exposure:** one delivered ordinary SMS and one provider-rejected interactive attempt; no amount, balance, recipient, or credential is recorded.
- **Future controlled-test estimate:** no numeric estimate is possible from current evidence because per-segment, EventID/reply, and tax pricing are undocumented.
- Before separate approval, the owner must record an exact currency amount calculated as no more than 18 domestic billed segments plus at most one EventID/reply fee and applicable tax.
- The separately approved issue must state that absolute monetary cap. Missing price evidence or inability to enforce the cap is a stop condition.

### Stop and rollback conditions

Stop immediately before any further API request or message when:

- the environment, credential owner, recipient, sender/reply resource, or tenant mapping is missing or ambiguous;
- a real customer number or customer content appears in scope;
- the provider cannot state or enforce message/segment/cost caps;
- an unexpected charge, recipient, sender identity, callback destination, duplicate send, or unsupported encoding occurs;
- the observed contract differs materially from written provider confirmation;
- callbacks cannot be isolated from production or verified safely;
- credentials or personal data appear in repository files, logs, screenshots, or test output; or
- any production, Railway, Supabase, GHL, LINE, reconciliation, deployment, bulk-send, or marketing change becomes necessary.

Rollback consists of disabling/closing only the purpose-created test token/account resource through the approved operator, removing the non-production callback through the provider-approved process, and preserving sanitized evidence. It must not alter production or delete audit evidence.

## Assumptions and risks

- Official behavior is limited to what the Phase 1 sanitized contract records; common SMS practices are not treated as EVERY8D guarantees.
- Dashboard evidence D1–D7 is accepted only as authenticated account/UI behavior and is not promoted to an API guarantee.
- Controlled evidence E1–E4 is accepted only for the exact account, request, recipient, and outcomes observed; it is not generalized to production or other tenants.
- No identifier is assumed to provide tenant-safe correlation or idempotency.
- No callback authenticity or replay control is assumed.
- No charset, segment, price, rate, retention, sender, sandbox, or token-lifecycle value is inferred.
- The proposed canonical E.164 normalization is a future Win-CRM design recommendation, conditional on provider wire-format confirmation.
- A provider answer without controlled evidence may still leave test-dependent behavior open.
- A controlled test cannot compensate for a missing security mechanism, missing tenant-routing identifier, or unacceptable commercial/legal term.

## Recommended next action

The smallest safe next implementation task may be a separately approved **Phase 2A — Default-off tenant-aware EVERY8D outbound foundation**. This is supported because basic ordinary outbound connectivity is empirically proven, but it must be limited to:

1. exact tenant/provider configuration resolution with placeholders and mocks only;
2. the isolated provider boundary and normalized outbound result types;
3. automatic provider retry disabled until A4 is resolved;
4. replaceable token handling without claiming long-term lifecycle guarantees;
5. strict content/destination validation that does not generalize beyond proven/documented behavior;
6. secret-safe logging, deterministic mocked failures, and LINE regression coverage; and
7. no live credentials, provider request, SMS, production route, deployment, callback, inbound handling, GHL integration, Supabase migration, or reconciliation change.

Phase 2A requires its own GitHub issue, review, branch, and PR. The ordinary outbound evidence is sufficient to begin that implementation-only task, not to activate or deploy outbound SMS. Provider-evidence collection must continue in parallel for A4/A5/A8/A9/A10, and interactive/inbound work remains blocked by A1–A3/A6/A7.

## Historical Phase 1B task evidence record

### Task identification

- GitHub task: Issue #74 — Phase 1B — Resolve EVERY8D Hard Blockers and Controlled Test Readiness
- Approved branch: `agent/phase-1b-every8d-blocker-resolution`
- Authority: documentation/evidence only; commit, push, and draft PR authorized; controlled tests, merge, deployment, credentials, and SMS prohibited
- Started and last updated: 2026-08-17

### Files inspected

| File or source | Relevant finding |
| --- | --- |
| GitHub Issue #74 | Requires review of A1–A10, evidence classification, a filtered provider checklist, controlled-test plan, and a Phase 1B gate decision. |
| `AGENTS.md` | Requires channel separation, secret safety, evidence-based stopping, focused changes, validation, and no autonomous merge/deploy. |
| `docs/taiwan-sms-pilot-plan.md` | Phase 1 must be implementable/testable without guessing before Phase 2 begins. |
| `docs/every8d-api-contract.md` | Confirms API shapes and exposes missing sender, callback, correlation, retry, lifecycle, encoding, limits, and test guarantees. |
| Authorized sanitized dashboard observations D1–D7 | Narrow callback configuration, reply forwarding, query UI, and prepaid-account questions without establishing API guarantees. |
| Existing A1–A10 register | After applying official and dashboard evidence, all ten blockers still lack the guarantees required for safe implementation. |

### Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `docs/every8d-api-contract.md` | Adds Phase 1B evidence classifications, sanitized dashboard evidence D1–D7, and a consolidated unresolved contract register. | None. |
| `docs/every8d-feasibility-decision.md` | Reviews A1–A10 using official and dashboard evidence, narrows the provider checklist, and retains the non-executable controlled-test plan. | None. |

### Validation summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | TypeScript completed with no errors after the dashboard-evidence follow-up. |
| `npm test` | Passed | 291 tests passed; 0 failed, cancelled, skipped, or todo. |
| `npm run build` | Passed | TypeScript build completed with no errors after the dashboard-evidence follow-up. |

### Budget and stop-rule status

- Active coding tasks: one documentation-only task
- Implementation correction loops used: zero at authoring
- Reviewer correction loops used: zero
- Repeated errors or failed approaches: none
- Production credentials/data accessed: no
- Live or controlled SMS sent: no
- Runtime, Railway, Supabase, GHL, LINE, contact reconciliation, or production configuration changed: no
- Stop rule triggered: no; missing evidence is explicitly unresolved

## Current Phase 1B/1D decision

**ORDINARY OUTBOUND CONNECTIVITY PROVEN; PHASE 2A IMPLEMENTATION-ONLY CONDITIONALLY FEASIBLE; INTERACTIVE/INBOUND BLOCKED**

The Issue #77 evidence is sufficient to begin a separately gated, default-off, mock-only Phase 2A outbound foundation task under the restrictions above. It is not sufficient to enable production outbound sending, add a production route, deploy, or use live credentials. Interactive/two-way capability remains blocked at the account/channel/provisioning layer, and no additional `EventID=-1` send or `GetReplyMessage` query should occur without new documented provisioning evidence and separate approval.
