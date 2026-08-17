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

No new official specification, written provider answer, EVERY8D account/dashboard observation, credentials, sandbox evidence, callback evidence, or controlled-test result was supplied. No provider question was sent and no test was executed.

## Evidence classifications

| Classification | Application in Phase 1B |
| --- | --- |
| Confirmed by official EVERY8D documentation | The API 2.1 specification explicitly states the behavior, as captured in the sanitized contract. |
| Confirmed by EVERY8D account/dashboard behavior | An authorized, non-sensitive dashboard observation demonstrates behavior but is not treated as an API guarantee. No such evidence was available in this review. |
| Requires written provider confirmation | The official specification is silent, ambiguous, or internally inconsistent and EVERY8D must answer in writing. |
| Requires a separately approved controlled test | Provider statements or unclear edge cases must be verified in a sandbox or explicitly approved test process. Issue #74 authorizes planning only. |
| Still unresolved | No qualifying evidence currently establishes the behavior. |

Dashboard labels must never be promoted to an API guarantee without supporting written provider documentation or controlled evidence.

## Blocker-resolution table

This table updates the existing A1–A10 register below.

| Item | Previous status | Evidence | New status | Next action |
| --- | --- | --- | --- | --- |
| A1 Callback authenticity | Hard blocker | Official specification confirms HTTPS GET callbacks but documents no signature, secret, mTLS, or source policy. No dashboard evidence. | Remains hard blocker; unresolved. | Obtain written security contract; open an explicit security decision if no authenticity control exists. |
| A2 Callback replay and deduplication | Hard blocker | Callback fields and non-200 retries are documented; no immutable event ID, replay window, or deduplication guarantee. | Remains hard blocker; unresolved. | Obtain written event-identity contract, then run separately approved replay/duplicate tests. |
| A3 Callback acknowledgement, retry, timeout, and ordering | Hard blocker | HTTP 200 success and retry after non-200 are documented; body, limits, timing, backoff, timeout, ordering, and concurrency are not. | Remains hard blocker; unresolved. | Obtain written delivery policy, then verify it in a separately approved test. |
| A4 Outbound idempotency and ambiguous timeout | Hard blocker | `MR` correlation and 24-hour content/number filtering are documented; idempotency and timeout retry safety are not. | Remains hard blocker; unresolved. | Obtain written idempotency/reconciliation rules, then test timeout and duplicate-filter behavior separately. |
| A5 Token lifecycle | Hard blocker | Obtain/check/close operations and an eight-hour acquisition recommendation are documented; exact lifecycle and errors are not. | Remains hard blocker; unresolved. | Obtain written lifecycle contract, then test with non-production credentials under separate approval. |
| A6 Sender identity, reply channel, and tenant routing | Hard blocker | `EventID` link/default-channel behavior is documented; sender identity, native MO, provisioning, ownership, and tenant mapping are not. | Remains hard blocker; unresolved. | Obtain written sender/inbound provisioning and tenant-routing contract, then verify with one approved test tenant. |
| A7 Callback correlation (`MR`/`MSGID`) | Hard blocker | `BATCHID`/`BID` uses are documented; callback `MR` is duplicated and `MSGID` is undefined in send requests. | Remains hard blocker; unresolved. | Obtain corrected schema, identifier guarantees, and sanitized samples; then test end-to-end correlation. |
| A8 Request and callback encoding | Hard blocker | Media types and Traditional Chinese/English reply content are documented; charset, escaping, Unicode, and query limits are not. | Remains hard blocker; unresolved. | Obtain written charset/escaping rules, then run representative separately approved tests. |
| A9 Counting, segmentation, and charges | Hard blocker | The 333-character statement and 17-character `EventID` overhead are documented; counting, boundaries, maximum segments, and billing are not. | Remains hard blocker; unresolved. | Obtain written counting/charging table, then run separately approved boundary tests. |
| A10 Non-production test capability | Hard blocker | The specification identifies no sandbox, test host, test credentials/numbers, or no-charge facility. | Remains hard blocker; unresolved. | Obtain written test-environment/process confirmation; seek separate project approval before any provider interaction or send. |

## Existing hard blockers reviewed individually

### A1. Callback authenticity

- **Exact unanswered question:** What supported mechanism proves that a callback came from EVERY8D: signature, shared secret, mTLS, stable source allowlist, or another control?
- **Why it matters:** An unauthenticated route could accept forged delivery or reply events and route false data into the wrong tenant or conversation.
- **Official evidence available:** EVERY8D calls a configured HTTPS URL with GET query parameters. No authenticity mechanism is documented.
- **Dashboard/account evidence:** None available.
- **Evidence needed:** Written provider security contract. If the answer is "none," an explicit Win-CRM security risk decision is required; a test cannot create a missing security guarantee.
- **Status:** Remains a hard blocker.

### A2. Callback replay protection and event deduplication

- **Exact unanswered question:** What immutable event identity, uniqueness scope, replay window, duplicate guarantee, and redelivery behavior apply?
- **Why it matters:** Provider retries or replay could duplicate delivery updates, replies, contacts, or conversation messages.
- **Official evidence available:** Callback fields include batch/message-related values and non-200 responses cause retries; no event ID or replay contract is defined.
- **Dashboard/account evidence:** None available.
- **Evidence needed:** Written identity/replay contract plus a separately approved duplicate and replay test.
- **Status:** Remains a hard blocker.

### A3. Callback acknowledgement, retry, timeout, and ordering

- **Exact unanswered question:** What response body, attempt limit, timeout, retry interval/backoff, delivery age, ordering, concurrency, and duplicate behavior apply?
- **Why it matters:** The receiver cannot choose safe acknowledgement, queueing, and recovery behavior without risking loss or duplication.
- **Official evidence available:** HTTP 200 is success; non-200 causes retries until an unspecified maximum.
- **Dashboard/account evidence:** None available.
- **Evidence needed:** Written delivery policy plus a separately approved acknowledgement/retry/ordering test.
- **Status:** Remains a hard blocker.

### A4. Outbound idempotency and ambiguous-timeout retry safety

- **Exact unanswered question:** Is there a native idempotency key or safe reconciliation procedure after a connection timeout, and can the 24-hour filter safely protect concurrent retries?
- **Why it matters:** A retry after an accepted-but-unobserved send can duplicate delivery and billing.
- **Official evidence available:** `MR` is a within-batch correlation value for personalized/parameter sends. `SendSMS4FilterMessage.ashx` compares the same content and mobile within 24 hours and supports `IsSend=false`. Atomicity and retry guarantees are not documented.
- **Dashboard/account evidence:** None available.
- **Evidence needed:** Written idempotency, filter comparison/scope/atomicity, and timeout-reconciliation contract plus a separately approved timeout/concurrency test.
- **Status:** Remains a hard blocker. `MR`, `BATCHID`, `MSGID`, and the filter endpoint are not approved as idempotency keys.

### A5. Token lifecycle

- **Exact unanswered question:** What are the exact lifetime, reuse, concurrent-token, replacement, rotation-overlap, expiry, close/revocation, error-response, and authentication-retry rules?
- **Why it matters:** Tenant-scoped caching, rotation, fail-closed behavior, and recovery cannot be designed from a refresh recommendation alone.
- **Official evidence available:** Obtain, status-check, and close operations exist; obtaining a token every eight hours is recommended.
- **Dashboard/account evidence:** None available.
- **Evidence needed:** Written lifecycle/error contract plus a separately approved non-production lifecycle test.
- **Status:** Remains a hard blocker.

### A6. Sender identity, reply channel, and tenant routing

- **Exact unanswered question:** What sender identity recipients see; whether replies use EventID web interaction or carrier-native MO; how inbound numbers/channels are provisioned; whether they are shared or dedicated; and what stable resource identifies a tenant?
- **Why it matters:** Win-CRM must resolve the exact tenant, provider configuration, sender, and inbound resource without global or ambiguous routing.
- **Official evidence available:** `EventID` adds an interactive-reply link, `-1` selects a default activity channel, replies can be queried by batch, and callback status `999` represents a reply. Sender and provisioning behavior are absent.
- **Dashboard/account evidence:** None available.
- **Evidence needed:** Written sender/inbound provisioning, ownership, lifecycle, native-MO, and tenant-routing contract plus a separately approved single-tenant test.
- **Status:** Remains a hard blocker.

### A7. Callback correlation ambiguity (`MR` and `MSGID`)

- **Exact unanswered question:** What each `MR` row means, where `MSGID` originates, which values are unique and stable, and what recipient-level value joins send, DR, MO, and callback records?
- **Why it matters:** Incorrect correlation can attach a delivery report or reply to the wrong recipient, tenant, or message.
- **Official evidence available:** `BATCHID` is returned and `BID` carries it into queries/cancellation. Optional caller `MR` is unique within a personalized/parameter batch. The callback table duplicates `MR` with different meanings and refers to outbound `MSGID` that no send table defines.
- **Dashboard/account evidence:** None available.
- **Evidence needed:** Corrected written schema, identifier scope/lifecycle guarantees, sanitized provider samples, and a separately approved end-to-end correlation test.
- **Status:** Remains a hard blocker. No end-to-end correlation or idempotency key is established.

### A8. Request and callback encoding

- **Exact unanswered question:** What charset, form/query escaping, Unicode normalization, emoji/combining-character behavior, malformed-input behavior, and callback URL-length rules apply?
- **Why it matters:** Incorrect encoding can corrupt content, change segment counts, break any future signature verification, or create unsafe parser differences.
- **Official evidence available:** Endpoint media types are documented; the callback is described only as encoded; reply content identifies Traditional Chinese and English.
- **Dashboard/account evidence:** None available.
- **Evidence needed:** Written charset/escaping contract plus separately approved Traditional Chinese, ASCII, URL, emoji, and combining-character tests.
- **Status:** Remains a hard blocker.

### A9. Message counting, segmentation, and charge boundaries

- **Exact unanswered question:** What algorithm counts characters, where segments split, how encoding affects the count, what the maximum segment count is, and how each segment/EventID reply feature is billed?
- **Why it matters:** Win-CRM cannot validate content, predict cost, cap sending, or explain multipart delivery without those rules.
- **Official evidence available:** Long SMS is described as supporting up to 333 characters, content above 333 is split, international long content is split, and the EventID link adds 17 characters.
- **Dashboard/account evidence:** None available.
- **Evidence needed:** Written counting/segmentation/charge table plus separately approved boundary and multilingual tests.
- **Status:** Remains a hard blocker.

### A10. Non-production test capability

- **Exact unanswered question:** Does EVERY8D provide a sandbox, test endpoint, test credentials/numbers, no-charge messages, callback simulator, or provider-approved controlled production process?
- **Why it matters:** Contract validation must not require production credentials, customer recipients, or uncontrolled live sending.
- **Official evidence available:** No sandbox or non-production facility is documented.
- **Dashboard/account evidence:** None available.
- **Evidence needed:** Written provider test-process confirmation followed by a separate project decision authorizing a bounded test.
- **Status:** Remains a hard blocker. Issue #74 authorizes the plan below only.

## Resolution summary

- **Resolved blockers:** 0.
- **Remaining hard blockers:** 10 (A1–A10).
- **Written provider question groups still required:** 27 across the filtered checklist below.
- **Separately approved controlled tests proposed:** 10 test cases. None is authorized or executed.
- **Phase 2 gate:** Closed while any A1–A10 implementation-safety blocker remains.

## Prioritized provider-support checklist

Every question below remains unanswered by the official specification and existing repository evidence. This is the filtered checklist to prepare for human-approved provider contact; Issue #74 does not authorize sending it automatically.

### Hard blockers

1. What callback authenticity controls are supported, and what exact verification procedure and key/source rotation rules apply?
2. What immutable callback event identity, uniqueness scope, replay window, deduplication key, and duplicate-delivery guarantees apply?
3. What callback acknowledgement body, timeout, retry count/schedule/backoff, maximum delivery age, ordering, and concurrency rules apply?
4. What native idempotency or timeout-reconciliation mechanism protects an accepted-but-unobserved outbound send?
5. What exact token lifetime, reuse, concurrent-token, rotation-overlap, expiry, close/revocation, error-response, and authentication-retry rules apply?
6. What outbound sender identity, reply mechanism, inbound number/channel provisioning, shared/dedicated ownership, EventID lifecycle, native-MO availability, and tenant-routing identifier apply?
7. Please provide a corrected callback schema and identifier contract for `BATCHID`/`BID`, both `MR` entries, `MSGID`, `EventID`, and the stable recipient-level correlation value.
8. What request/callback charset, percent/form encoding, Unicode normalization, emoji/combining-character, malformed-input, and callback query-length rules apply?
9. What character-count, segmentation, maximum-segment, EventID-overhead, and per-segment/reply billing rules apply, including the 333-character boundary?
10. What sandbox or approved controlled-test facility exists, including host, credentials, recipient, callbacks, charge treatment, environment parity, and support supervision?

### Controlled-test questions

1. What exhaustive HTTP/provider error catalogue, response content types, and permanent/transient/authentication/partial-failure classifications should tests assert?
2. Which Taiwan formats among `09xxxxxxxx`, `8869xxxxxxxx`, and `+8869xxxxxxxx` are accepted, and how are whitespace, punctuation, and invalid numbers handled?
3. How does the 24-hour filter normalize and compare number/content, what is its account/channel/time scope, and is the operation atomic under concurrency?
4. What QPS, concurrency, recipients/request, payload/batch, throughput, query, and throttling limits and retry guidance should tests enforce?
5. What DR state transitions, terminal states, out-of-order behavior, and operational distinction between statuses `0` and `700` apply?
6. What timezone, daylight-saving, and clock-skew rules apply to scheduling, DR, MO, and callback timestamps?
7. Is MO pagination 10 or 1,000 records per page, and what signals the final page?
8. What are the DR/MO/callback retention windows and `BATCHID` uniqueness, scope, reuse, partial-send, and lifecycle guarantees?
9. What EventID activity/link lifecycle and reply limits apply, and can replies occur without the EventID link through carrier-native MO?
10. What response escaping, empty-field, partial-success, insufficient-credit, and `RETRYTIME` expiry/carrier-retry behavior should fixtures and tests cover?

### Operational/commercial follow-ups

1. What SLA, maintenance, incident-notification, disaster-recovery, and service-region commitments apply?
2. What support hours, severity levels, named escalation path, and response targets apply during a pilot incident?
3. What domestic, segmented, EventID/reply, international, setup, tax, minimum-commitment, and credit-expiry pricing applies?
4. What consent, opt-out, suppression, quiet-hour, content, blacklist, and Taiwan legal/acceptable-use responsibilities belong to EVERY8D versus Win-CRM?
5. What data residency, encryption, access, subprocessor, retention, deletion, export, and breach-notification controls apply?
6. What sender/reply-resource provisioning lead time, fees, shared/dedicated ownership, tenant assignment, portability, and offboarding rules apply?
7. What dashboards, exports, audit history, alerts, reconciliation reports, and incident-evidence retention are available?

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
- No dashboard/account evidence exists in this task.
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
| Existing A1–A10 register | All ten blockers still lack the evidence required for safe implementation. |

### Files changed

| File | Change | Runtime impact |
| --- | --- | --- |
| `docs/every8d-api-contract.md` | Adds Phase 1B evidence classifications and a consolidated unresolved contract register. | None. |
| `docs/every8d-feasibility-decision.md` | Reviews A1–A10, adds the resolution table, filtered provider checklist, and controlled-test readiness plan. | None. |

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
- Repeated errors or failed approaches: none
- Production credentials/data accessed: no
- Live or controlled SMS sent: no
- Runtime, Railway, Supabase, GHL, LINE, contact reconciliation, or production configuration changed: no
- Stop rule triggered: no; missing evidence is explicitly unresolved

## Phase 1B decision

**NOT YET FEASIBLE**

All ten implementation-safety blockers remain open. EVERY8D is not rejected, but Phase 2 must remain blocked until written provider evidence and any separately approved controlled tests establish a contract that can be implemented and tested without guessing.
