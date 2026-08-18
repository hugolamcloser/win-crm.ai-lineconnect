# EVERY8D controlled connectivity spike

## Purpose and authority

This runner exists only for the controlled engineering spike approved in GitHub Issue #77. It is not a production SMS integration, is not registered as an Express route, and is not connected to LINE, HighLevel, contact reconciliation, Supabase, Railway, or deployment configuration.

Automated tests inject an in-memory transport. They never call EVERY8D and require no credentials.

Do not execute a real provider request or SMS without a separate explicit approval that identifies the account owner, exact test recipient, message, cost cap, test window, and operator.

## Environment variables

| Variable | Purpose | Default behavior |
| --- | --- | --- |
| `EVERY8D_SITE_URL` | Credential-free HTTPS origin assigned by EVERY8D. | Required after activation. |
| `EVERY8D_UID` | EVERY8D account identifier. | Required after activation; never logged. |
| `EVERY8D_PASSWORD` | EVERY8D account password. | Required after activation; never logged. |
| `EVERY8D_TIMEOUT_MS` | Per-request timeout from 100 through 60,000 milliseconds. | `10000` |
| `EVERY8D_SPIKE_ENABLED` | Master network-activity gate. | Disabled unless exactly `true`. |
| `EVERY8D_SPIKE_SEND_ENABLED` | Enables the one-SMS path after activation. | Disabled unless exactly `true`. |
| `EVERY8D_SPIKE_SEND_CONFIRMATION` | Deliberate confirmation phrase for a real send. | Empty; must exactly equal `SEND_ONE_APPROVED_SMS`. |
| `EVERY8D_APPROVED_RECIPIENT` | Maintainer-approved single test recipient. | Required for a send. |
| `EVERY8D_SPIKE_RECIPIENT` | Recipient requested for this invocation. | Required and must exactly equal the approved recipient. |
| `EVERY8D_SPIKE_MESSAGE` | Exact controlled test content. | Required for a send and capped locally at 70 characters. |
| `EVERY8D_REPLY_QUERY_ENABLED` | Separate activation gate for querying replies to an existing batch. | Disabled unless exactly `true`. |
| `EVERY8D_REPLY_QUERY_CONFIRMATION` | Deliberate query confirmation phrase. | Empty; must exactly equal `QUERY_EXISTING_BATCH_REPLIES`. |
| `EVERY8D_REPLY_QUERY_BATCH_ID` | Existing `BATCHID` returned by the approved controlled send. | Required for a reply query. |
| `EVERY8D_REPLY_QUERY_PAGE` | Reply-result page. | `1`; the controlled runner rejects every other page. |
| `EVERY8D_REPLY_QUERY_MR` | Optional prior `MR` retained as correlation context. | Empty; not sent to `GetReplyMessage`. |
| `EVERY8D_REPLY_QUERY_EVENT_ID` | Optional prior `EventID` retained as correlation context. | Empty; not sent to `GetReplyMessage`. |
| `EVERY8D_INTERACTIVE_ENABLED` | Master gate for the isolated interactive-reply spike. | Disabled unless exactly `true`. |
| `EVERY8D_INTERACTIVE_SEND_ENABLED` | Enables its one-message path after activation. | Disabled unless exactly `true`. |
| `EVERY8D_INTERACTIVE_CONFIRMATION` | Deliberate confirmation phrase for the interactive test. | Empty; must exactly equal `SEND_ONE_APPROVED_INTERACTIVE_SMS`. |
| `EVERY8D_INTERACTIVE_EVENT_ID` | Interactive activity/channel selector. | Empty; the controlled runner permits only `-1`. |
| `EVERY8D_INTERACTIVE_RECIPIENT` | Recipient requested for the interactive test. | Required and must exactly match `EVERY8D_APPROVED_RECIPIENT`. |
| `EVERY8D_INTERACTIVE_MESSAGE` | Exact controlled interactive content. | Required and capped locally at 53 characters before link insertion. |

Keep all real values outside the repository. Do not add these variables to Railway for this spike.

## Safety gates

Running `npm run every8d:spike` is safe by default: the process exits before constructing a client request unless `EVERY8D_SPIKE_ENABLED` is exactly `true`.

With only the master gate enabled, the runner can acquire a token but will not call `SendSMS`. Reaching the real-send path additionally requires all of the following:

1. `EVERY8D_SPIKE_SEND_ENABLED=true`.
2. `EVERY8D_SPIKE_SEND_CONFIRMATION=SEND_ONE_APPROVED_SMS`.
3. One non-empty approved recipient.
4. One non-empty requested recipient that exactly matches the approved recipient.
5. No comma, semicolon, carriage return, or newline in either recipient value.
6. One non-empty message of at most 70 Unicode characters.
7. Complete provider configuration.

The provider client independently rejects comma-, semicolon-, and newline-separated destinations and never retries `SendSMS` automatically.

## Controlled operation

After every gate passes, a single invocation performs exactly:

1. `POST /API21/HTTP/ConnectionHandler.ashx` to obtain a bearer token.
2. One `POST /API21/HTTP/SendSMS.ashx` for the exact approved recipient.
3. One `POST /API21/HTTP/GetDeliveryStatus.ashx` using the returned `BATCHID` as `BID` and the same bearer token.

The runner records sanitized HTTP/provider status, timing, `BATCHID`/`BID`, `MR` values, and delivery states. It does not log credentials, tokens, full recipient values, or message content.

The delivery query occurs immediately after provider acceptance. An empty or pending result is possible and does not establish a final delivery state.

## Existing-batch reply/MO query

`npm run every8d:reply-query` is a separate, query-only runner. It authenticates and calls only `GetReplyMessage` for the supplied existing `BATCHID`. It does not import or invoke the controlled send runner, has no `SendSMS` invocation path, is not registered as an Express route, and does not alter provider or application configuration.

The query is disabled by default and exits before constructing a client or provider request unless all of these conditions hold:

1. `EVERY8D_REPLY_QUERY_ENABLED=true`.
2. `EVERY8D_REPLY_QUERY_CONFIRMATION=QUERY_EXISTING_BATCH_REPLIES`.
3. `EVERY8D_REPLY_QUERY_BATCH_ID` contains the existing approved-send `BATCHID`.
4. `EVERY8D_REPLY_QUERY_PAGE=1`.
5. `EVERY8D_SPIKE_SEND_ENABLED=false` or unset.
6. Complete provider authentication configuration is present.

After the gates pass, one invocation performs exactly:

1. `POST /API21/HTTP/ConnectionHandler.ashx` to obtain a bearer token.
2. One `POST /API21/HTTP/GetReplyMessage.ashx` with `BID`, `PNO=1`, and `RESPFORMAT=1`.

The provider contract makes `GetReplyMessage` a read/query operation keyed by a prior `BATCHID`; therefore no additional outbound message is required. The query can return zero records if no reply exists, reply routing is unavailable, the account/activity is not provisioned for replies, or the documented correlation model differs in practice.

The runner retains `BATCHID`/returned `BID` and optional operator-supplied `MR`/`EventID` context. The documented reply response does not itself contain `MR` or `EventID`, so those optional values are evidence context only and are not sent to the provider. Logs omit names, complete phone numbers, and reply content. Each reply is represented only by a short one-way `senderRef`, short one-way `replyRef`, content presence/length, and provider receive time.

Before a real query, preserve the prior controlled-send `BATCHID` outside the repository and obtain one of these pieces of human evidence:

- confirmation that the approved handset sent a reply using the provider-supported reply mechanism; or
- a sanitized EVERY8D dashboard view showing an MO/reply record associated with that batch/account.

Neither evidence item requires another outbound SMS. Do not configure a callback URL, activity, sender identity, Railway variable, or production route for this query-only check.

No real `GetReplyMessage` query is currently authorized. The approved recipient's ordinary carrier reply attempt failed before a proven inbound event existed, so querying that earlier batch now would produce ambiguous evidence.

## Controlled interactive-reply test preparation

The documented interactive mechanism uses the existing general endpoint:

```text
POST /API21/HTTP/SendSMS.ashx
Content-Type: application/x-www-form-urlencoded
Authorization: Bearer <redacted-token>

MSG=<controlled-content>&DEST=<one-approved-recipient>&EventID=-1
```

The official contract says that supplying `EventID` causes EVERY8D to add an interactive-reply link to the SMS content and adds 17 characters. `EventID=-1` selects the account's default activity channel. It does not prove that a default channel is provisioned, active, uniquely owned, or mapped to this account/tenant. Dashboard evidence mentions SafeSay separately, so the captured evidence does not prove that the link produced by `EventID=-1` will be SafeSay-branded.

The controlled runner permits only `EventID=-1`. It is disabled by default and requires all of the following before constructing a provider client:

1. `EVERY8D_INTERACTIVE_ENABLED=true`.
2. `EVERY8D_INTERACTIVE_SEND_ENABLED=true`.
3. `EVERY8D_INTERACTIVE_CONFIRMATION=SEND_ONE_APPROVED_INTERACTIVE_SMS`.
4. `EVERY8D_INTERACTIVE_EVENT_ID=-1`.
5. One requested recipient that exactly matches `EVERY8D_APPROVED_RECIPIENT` and contains no bulk separator.
6. One non-empty message of at most 53 Unicode characters.
7. `EVERY8D_SPIKE_SEND_ENABLED=false` or unset.
8. `EVERY8D_REPLY_QUERY_ENABLED=false` or unset.
9. Complete provider authentication configuration.

The proposed controlled content is:

```text
WinCRM EVERY8D 雙向回覆測試，請依簡訊內回覆方式回覆 TEST01。
```

Its 41-character pre-link length plus the documented 17-character link overhead remains within the local 70-character conservative envelope. This does not establish the provider's encoding, segmentation, rendering, or billing rules.

After every gate passes, one invocation performs exactly:

1. Token acquisition.
2. One `SendSMS` request for the exact approved recipient, content, and `EventID=-1`.
3. One `GetDeliveryStatus` request using the returned `BATCHID` as `BID` to capture any returned `MR` and delivery state.

There is no retry after provider rejection, network failure, timeout, or ambiguous send outcome. The runner never calls `GetReplyMessage`, creates a callback, or imports application routes, GHL, LINE, Supabase, reconciliation, Railway, or deployment code.

Expected recipient flow, subject to real provider behavior, is: receive one SMS containing the controlled content plus a provider-added reply link; open that link; submit exactly `TEST01` through the provider's interactive flow. Ordinary reply in the iPhone SMS composer is not the planned mechanism. The account's default activity channel may be absent or unusable, in which case the link may be missing or fail—this outcome would be useful evidence but would not establish why provisioning failed.

The send retains `BATCHID`; delivery lookup carries it as `BID` and may return `MR`; the runner records `EventID=-1` as request context. A later separately approved `GetReplyMessage` query would use `BID=BATCHID`. The documented reply response contains `BID` but not `EventID` or `MR`, so recipient-level joining remains empirically and contractually uncertain.

Two-way capability would require all of the following evidence:

- the received SMS visibly contains the provider-added interactive reply link;
- the approved recipient can open it and submit `TEST01`;
- EVERY8D accepts and records that reply;
- a later separately approved query or sanitized provider UI shows the exact reply associated with the same `BATCHID`/`BID`; and
- any available `MR`/`EventID` evidence remains consistent without relying on an undocumented join.

## First controlled recipient format

The official examples show both Taiwan national form and `+886` form, but the provider documentation does not establish the complete accepted set or normalization rules. The runner deliberately does not normalize a number.

For the first domestic controlled test, the conservative operator choice is Taiwan national mobile form `09xxxxxxxx` (10 ASCII digits, no spaces or punctuation). This is a local test constraint based on the documented national-form example, not a provider-confirmed guarantee. Do not use `+8869xxxxxxxx` for the first test unless international-number handling has been separately confirmed and approved, because the documentation says international SMS is disabled by default at the account level.

The exact same single value must be supplied as both `EVERY8D_APPROVED_RECIPIENT` and `EVERY8D_SPIKE_RECIPIENT`. The runner rejects commas, semicolons, carriage returns, newlines, missing values, and any requested/approved mismatch. It does not independently prove ownership of the handset or validate the number with EVERY8D before the send request; those remain human approval responsibilities.

## Sanitized evidence capture

On provider acceptance, the runner logs the returned `BATCHID` as `batchId`. It reuses that value as `BID` in one immediate `GetDeliveryStatus` request and logs the response `bid`, any returned `MR` values as `mrValues`, and documented delivery states. These identifiers are retained without logging the token, password, complete recipient, or message content.

The token exists only in process memory long enough to authenticate the `SendSMS` and `GetDeliveryStatus` requests. The password is read from process environment for authentication. Neither value is included in structured log metadata, returned runner output, or documented evidence.

## Accepted controlled-send evidence

Maintainer-supplied evidence confirms that the previously approved one-recipient invocation returned provider success with `sentCount=1`, `unsentCount=0`, and a `BATCHID`; `GetDeliveryStatus` queried the same message; and the approved handset physically received the exact approved controlled content. The recipient and message are intentionally omitted here. No repeat send is needed for reply/MO evidence collection.

The approved recipient then attempted an ordinary carrier reply from the exact iPhone SMS conversation. iOS reported the reply as not delivered/unable to send. This establishes only that ordinary carrier reply to the sender identity used by that controlled `SendSMS` invocation was not working at that time. It does not establish whether the sender was shared, dedicated, temporary, inherently one-way, misconfigured, or unrelated to the documented `EventID` interactive mechanism.

## Known limitations

- Exact token lifetime, rotation overlap, and concurrent-token behavior remain undocumented.
- Sender identity, reply routing, and tenant-safe correlation remain unresolved.
- Whether native handset replies are available for this account/send, whether `EventID` is required, and how a reply maps to `MR` remain unresolved. The documented `GetReplyMessage` response correlates by `BID` only.
- The reply section is internally inconsistent about page size and maximum results, so the controlled runner permits page 1 only.
- `MR`/`MSGID` callback semantics remain internally inconsistent in the provider documentation.
- Encoding, segmentation, charge boundaries, rate limits, status retention, and idempotent retry behavior remain unresolved.
- No sandbox SiteURL is documented.
- The runner makes no automatic retry after an ambiguous send timeout because that could duplicate a billed SMS.
- Immediate delivery querying cannot prove callback behavior, final-state timing, or status-transition guarantees.
