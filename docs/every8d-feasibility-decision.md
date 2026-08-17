# EVERY8D Phase 1B feasibility decision

## Scope and evidence boundary

Issue #74 re-evaluates the ten hard blockers established by Issue #72 and PR #73. It does not create a replacement blocker list and does not authorize runtime implementation or testing.

The review uses only:

- GitHub Issue #74;
- [`../AGENTS.md`](../AGENTS.md);
- [`taiwan-sms-pilot-plan.md`](taiwan-sms-pilot-plan.md);
- [`every8d-api-contract.md`](every8d-api-contract.md);
- this document's existing Phase 1 blocker register; and
- the official EVERY8D API 2.1 specification evidence already incorporated into Phase 1.

No new official specification, written provider answer, credentials, sandbox evidence, callback delivery evidence, or controlled-test result was supplied. A Phase 1B follow-up supplied authorized observations from an authenticated EVERY8D dashboard. They are sanitized in the API contract and evaluated below only as account/dashboard evidence. No provider question was sent and no test was executed.

## Evidence classifications

| Classification | Application in Phase 1B |
| --- | --- |
| Confirmed by official EVERY8D documentation | The API 2.1 specification explicitly states the behavior, as captured in the sanitized contract. |
| Confirmed by EVERY8D account/dashboard behavior | An authorized, non-sensitive dashboard observation demonstrates behavior but is not treated as an API guarantee. No such evidence was available in this review. |
| Requires written provider confirmation | The official specification is silent, ambiguous, or internally inconsistent and EVERY8D must answer in writing. |
| Requires a separately approved controlled test | Provider statements or unclear edge cases must be verified in a sandbox or explicitly approved test process. Issue #74 authorizes planning only. |
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

## Blocker-resolution table

This table updates the existing A1–A10 register below.

| Item | Previous status | Evidence | New status | Next action |
| --- | --- | --- | --- | --- |
| A1 Callback authenticity | Hard blocker | Official specification confirms HTTPS GET callbacks but documents no signature, secret, mTLS, or source policy. D1 confirms report configuration controls, not authentication. | Remains hard blocker; unresolved. | Obtain written security contract; open an explicit security decision if no authenticity control exists. |
| A2 Callback replay and deduplication | Hard blocker | Callback fields and non-200 retries are documented; D1 adds configuration UI but no immutable event ID, replay window, or deduplication guarantee. | Remains hard blocker; unresolved. | Obtain written event-identity contract, then run separately approved replay/duplicate tests. |
| A3 Callback acknowledgement, retry, timeout, and ordering | Hard blocker | Official evidence confirms HTTP 200/non-200 behavior. D1 confirms configurable attempt count, encoding, and GET/POST, but not their semantics or the remaining delivery policy. | Remains hard blocker; unresolved. | Obtain written method/attempt/acknowledgement/delivery policy, then verify it in a separately approved test. |
| A4 Outbound idempotency and ambiguous timeout | Hard blocker | `MR` correlation and 24-hour filtering are documented; D3/D5 confirms send/query UI, not idempotency or timeout retry safety. | Remains hard blocker; unresolved. | Obtain written idempotency/reconciliation rules, then test timeout and duplicate-filter behavior separately. |
| A5 Token lifecycle | Hard blocker | Obtain/check/close operations and an eight-hour acquisition recommendation are documented; exact lifecycle and errors are not. | Remains hard blocker; unresolved. | Obtain written lifecycle contract, then test with non-production credentials under separate approval. |
| A6 Sender identity, reply channel, and tenant routing | Hard blocker | Official `EventID` behavior plus D2 reply forwarding confirm two reply-related capabilities, but not their relationship, sender identity, native MO, provisioning, ownership, or tenant mapping. | Remains hard blocker; unresolved. | Obtain written sender/inbound/reply provisioning and tenant-routing contract, then verify with one approved test tenant. |
| A7 Callback correlation (`MR`/`MSGID`) | Hard blocker | Official `BATCHID`/`BID` uses remain ambiguous at recipient level; D5/D6 confirms status/reply-detail query UI but no stable join key. | Remains hard blocker; unresolved. | Obtain corrected schema, identifier guarantees, and sanitized samples; then test end-to-end correlation. |
| A8 Request and callback encoding | Hard blocker | Official media types remain incomplete. D1 confirms `BIG5`/`UTF-8` report choices, but not wire charset, escaping, scope/default, Unicode, or query limits. | Remains hard blocker; unresolved. | Obtain written charset/escaping/selection rules, then run representative separately approved tests. |
| A9 Counting, segmentation, and charges | Hard blocker | The 333-character statement and 17-character `EventID` overhead are documented; D7 confirms prepaid balance UI but not counting, boundaries, maximum segments, or billing rates. | Remains hard blocker; unresolved. | Obtain written counting/charging table, then run separately approved boundary tests. |
| A10 Non-production test capability | Hard blocker | The specification identifies no test facility. D7 confirms an active prepaid account, not a sandbox, test host, test credentials/numbers, or no-charge facility. | Remains hard blocker; unresolved. | Obtain written test-environment/process confirmation; seek separate project approval before any provider interaction or send. |

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
- **Dashboard/account evidence:** D7 confirms the account was active and authenticated. It supplies no token lifecycle, rotation, expiry, revocation, or error evidence.
- **Evidence needed:** Written lifecycle/error contract plus a separately approved non-production lifecycle test.
- **Status:** Remains a hard blocker.

### A6. Sender identity, reply channel, and tenant routing

- **Exact unanswered question:** What sender identity recipients see; whether replies use EventID web interaction or carrier-native MO; how inbound numbers/channels are provisioned; whether they are shared or dedicated; and what stable resource identifies a tenant?
- **Why it matters:** Win-CRM must resolve the exact tenant, provider configuration, sender, and inbound resource without global or ambiguous routing.
- **Official evidence available:** `EventID` adds an interactive-reply link, `-1` selects a default activity channel, replies can be queried by batch, and callback status `999` represents a reply. Sender and provisioning behavior are absent.
- **Dashboard/account evidence:** D2 confirms `開啟回覆轉寄` and a dashboard explanation that a recipient can reply and EVERY8D can forward the reply toward customer systems/email; SafeSay is described separately. It does not identify the transport, sender, provisioning, ownership, EventID/SafeSay relationship, or tenant mapping.
- **Evidence needed:** Written sender/inbound provisioning, ownership, lifecycle, native-MO, and tenant-routing contract plus a separately approved single-tenant test.
- **Status:** Remains a hard blocker.

### A7. Callback correlation ambiguity (`MR` and `MSGID`)

- **Exact unanswered question:** What each `MR` row means, where `MSGID` originates, which values are unique and stable, and what recipient-level value joins send, DR, MO, and callback records?
- **Why it matters:** Incorrect correlation can attach a delivery report or reply to the wrong recipient, tenant, or message.
- **Official evidence available:** `BATCHID` is returned and `BID` carries it into queries/cancellation. Optional caller `MR` is unique within a personalized/parameter batch. The callback table duplicates `MR` with different meanings and refers to outbound `MSGID` that no send table defines.
- **Dashboard/account evidence:** D5/D6 confirms records/status query and `查詢發送回覆明細` UI functions. No sanitized stable identifier, schema, uniqueness, or lifecycle evidence was supplied.
- **Evidence needed:** Corrected written schema, identifier scope/lifecycle guarantees, sanitized provider samples, and a separately approved end-to-end correlation test.
- **Status:** Remains a hard blocker. No end-to-end correlation or idempotency key is established.

### A8. Request and callback encoding

- **Exact unanswered question:** How do the dashboard's `BIG5`/`UTF-8` report choices map to callback bytes/defaults and HTTP methods; and what form/query escaping, Unicode normalization, emoji/combining-character behavior, malformed-input behavior, and callback URL-length rules apply?
- **Why it matters:** Incorrect encoding can corrupt content, change segment counts, break any future signature verification, or create unsafe parser differences.
- **Official evidence available:** Endpoint media types are documented; the callback is described only as encoded; reply content identifies Traditional Chinese and English.
- **Dashboard/account evidence:** D1 confirms `BIG5` and `UTF-8` report-encoding choices. It does not define the selected/default scope, actual wire encoding, percent/form encoding, Unicode behavior, or errors.
- **Evidence needed:** Written charset/escaping contract plus separately approved Traditional Chinese, ASCII, URL, emoji, and combining-character tests.
- **Status:** Remains a hard blocker.

### A9. Message counting, segmentation, and charge boundaries

- **Exact unanswered question:** What algorithm counts characters, where segments split, how encoding affects the count, what the maximum segment count is, and how each segment/EventID reply feature is billed?
- **Why it matters:** Win-CRM cannot validate content, predict cost, cap sending, or explain multipart delivery without those rules.
- **Official evidence available:** Long SMS is described as supporting up to 333 characters, content above 333 is split, international long content is split, and the EventID link adds 17 characters.
- **Dashboard/account evidence:** D7 confirms a visible prepaid balance existed. No balance amount, rate, segment count, charge calculation, or credit-expiry evidence is recorded.
- **Evidence needed:** Written counting/segmentation/charge table plus separately approved boundary and multilingual tests.
- **Status:** Remains a hard blocker.

### A10. Non-production test capability

- **Exact unanswered question:** Does EVERY8D provide a sandbox, test endpoint, test credentials/numbers, no-charge messages, callback simulator, or provider-approved controlled production process?
- **Why it matters:** Contract validation must not require production credentials, customer recipients, or uncontrolled live sending.
- **Official evidence available:** No sandbox or non-production facility is documented.
- **Dashboard/account evidence:** D7 confirms an active authenticated prepaid account and D1–D6 confirm production-like account functions. None is identified as a sandbox, test endpoint, test credential/number, no-charge facility, or authorized test process.
- **Evidence needed:** Written provider test-process confirmation followed by a separate project decision authorizing a bounded test.
- **Status:** Remains a hard blocker. Issue #74 authorizes the plan below only.

## Resolution summary

- **Resolved blockers:** 0.
- **Remaining hard blockers:** 10 (A1–A10).
- **Written provider question groups still required:** 27 across the filtered checklist below.
- **Separately approved controlled tests proposed:** 10 test cases. None is authorized or executed.
- **Phase 2 gate:** Closed while any A1–A10 implementation-safety blocker remains.

## Prioritized provider-support checklist

Every question below remains unanswered after combining the official specification with D1–D7. The dashboard evidence narrows several questions but does not eliminate any API/security/operational guarantee group, so 27 question groups remain. This is the filtered checklist to prepare for human-approved provider contact; Issue #74 does not authorize sending it automatically.

### Hard blockers

1. D1 confirms callback configuration exists; what callback authenticity controls are supported, and what exact verification procedure and key/source rotation rules apply?
2. What immutable callback event identity, uniqueness scope, replay window, deduplication key, and duplicate-delivery guarantees apply?
3. For D1's configurable GET/POST method and attempt count, what payload, allowed/default values, acknowledgement body, timeout, retry schedule/backoff, maximum delivery age, ordering, and concurrency rules apply?
4. What native idempotency or timeout-reconciliation mechanism protects an accepted-but-unobserved outbound send?
5. What exact token lifetime, reuse, concurrent-token, rotation-overlap, expiry, close/revocation, error-response, and authentication-retry rules apply?
6. Given D2's reply-forwarding flow, what outbound sender identity and underlying reply transport apply; how does forwarding relate to EventID and SafeSay; and what inbound provisioning, shared/dedicated ownership, lifecycle, native-MO availability, and tenant-routing identifier apply?
7. Please provide a corrected callback schema and identifier contract for `BATCHID`/`BID`, both `MR` entries, `MSGID`, `EventID`, and the stable recipient-level correlation value.
8. For D1's `BIG5`/`UTF-8` report choices, what default/selection scope, actual callback bytes, GET/POST percent/form encoding, Unicode normalization, emoji/combining-character, malformed-input, and query/payload-length rules apply?
9. What character-count, segmentation, maximum-segment, EventID-overhead, and per-segment/reply billing rules apply, including the 333-character boundary?
10. D7 confirms an active prepaid account but no test facility; what sandbox or approved controlled-test process exists, including host, credentials, recipient, callbacks, charge treatment, environment parity, and support supervision?

### Controlled-test questions

1. D3/D5 confirms send/query UI but not its API failure contract; what exhaustive HTTP/provider error catalogue, response content types, and permanent/transient/authentication/partial-failure classifications should tests assert?
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

This is a plan only. Current authorization permits **zero** SMS messages, zero credential use, zero callback configuration, and zero provider-account changes. Execution requires all of the following:

1. Written EVERY8D answers for the relevant checklist items.
2. A provider-supported sandbox or explicitly approved controlled process.
3. A separate GitHub issue and explicit human approval naming the environment, account owner, test recipient, message/cost caps, test window, and operator.
4. Non-production or purpose-created credentials supplied outside the repository.
5. Confirmation that no customer recipient, customer content, bulk send, or marketing campaign is involved.

### Proposed test matrix

All future outbound cases use one maintainer-approved Taiwan test handset. Sanitized hashes/references, not full credentials or phone numbers, are recorded in project evidence.

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
- No identifier is assumed to provide tenant-safe correlation or idempotency.
- No callback authenticity or replay control is assumed.
- No charset, segment, price, rate, retention, sender, sandbox, or token-lifecycle value is inferred.
- The proposed canonical E.164 normalization is a future Win-CRM design recommendation, conditional on provider wire-format confirmation.
- A provider answer without controlled evidence may still leave test-dependent behavior open.
- A controlled test cannot compensate for a missing security mechanism, missing tenant-routing identifier, or unacceptable commercial/legal term.

## Recommended next action

Phase 2 runtime implementation is not authorized. The smallest safe next task is a provider-evidence collection and decision issue that:

1. has a human owner send only the filtered checklist above;
2. records sanitized written answers as repository evidence;
3. updates the contract and A1–A10 statuses without guessing;
4. decides whether the ten-case controlled plan can be separately authorized; and
5. keeps runtime implementation blocked until every implementation-safety blocker is resolved.

If that gate later passes, the conditional next implementation issue should be **Phase 2 — Tenant-aware EVERY8D provider foundation and safe outbound sending**, limited to the approved contract, mocks or the approved non-production environment, exact tenant/provider resolution, bounded timeout/retry and duplicate-send controls, secret-safe logging, and automated tests. Inbound SMS, GHL integration, LINE changes, production configuration, live credentials, and live sends must remain out of scope.

## Task evidence record

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

## Phase 1B decision

**NOT YET FEASIBLE**

All ten implementation-safety blockers remain open. EVERY8D is not rejected, but Phase 2 must remain blocked until written provider evidence and any separately approved controlled tests establish a contract that can be implemented and tested without guessing.
