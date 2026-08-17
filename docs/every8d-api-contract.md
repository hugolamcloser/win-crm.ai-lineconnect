# EVERY8D API 2.1 sanitized provider contract

## Status and scope

This document records behavior confirmed by the official EVERY8D specification and the Phase 1B evidence classification completed for Issue #74. It remains a research artifact only. It does not authorize runtime implementation, credential use, callback configuration, live SMS, controlled testing, database changes, production configuration, or deployment.

Undocumented or internally inconsistent behavior is not inferred. Open questions and the Phase 1 decision are recorded in [`every8d-feasibility-decision.md`](every8d-feasibility-decision.md).

## Phase 1B evidence classification

Issue #74 requires every conclusion to use one of these evidence classes:

| Classification | Meaning in this contract |
| --- | --- |
| Confirmed by official EVERY8D documentation | The behavior is stated in the official API 2.1 specification and is recorded in the relevant contract section below. |
| Confirmed by EVERY8D account/dashboard behavior | A non-sensitive observation from an authorized EVERY8D account demonstrates the behavior, but does not by itself establish an API guarantee. |
| Requires written provider confirmation | The official specification does not establish the behavior or is internally inconsistent. EVERY8D must answer in writing before the behavior is designed as a guarantee. |
| Requires a separately approved controlled test | Written confirmation should be verified against a sandbox or explicitly approved test process before the affected behavior is accepted. Issue #74 does not authorize such a test. |
| Still unresolved | No qualifying official, dashboard, written-provider, or controlled-test evidence is available. |

No EVERY8D account or dashboard evidence was supplied for Phase 1B. No provider question was sent and no controlled test was run. Accordingly, dashboard-only conclusions are absent and every gap below remains either a written-confirmation requirement, a separately approved controlled-test requirement, or unresolved.

## Source identity

| Item | Confirmed value |
| --- | --- |
| Provider | EVERY8D / 互動資通股份有限公司 |
| Specification title | 簡訊 API2.1 規格書 |
| Version | 2.2 |
| Date | 2025/11/14 |
| Revision note | Version 2.2 changed the API SiteURL entry. |
| Transport | HTTPS |

Section references in this document refer to the official specification.

## Sanitization rules

All examples use placeholders. They contain no real username, password, provider token, customer data, or recipient phone number.

- `<site-url>` is the provider-assigned host.
- `<every8d-uid>` and `<every8d-password>` are placeholders only.
- `<bearer-token>` is a placeholder only.
- `<recipient-mobile>` and similar values are placeholders, not phone numbers.
- `<batch-id>` and `<message-reference>` are placeholders.

## SiteURL behavior

The specification expresses endpoints as `https://[SiteUrl]/...`.

- Enterprise users use `new.e8d.tw` as `[SiteUrl]`.
- Enterprise dedicated-platform users must obtain `[SiteUrl]` from EVERY8D sales.
- The specification does not define a sandbox or non-production SiteURL.

This contract therefore uses `https://<site-url>` and does not infer that every tenant shares one provider host.

## Authentication and token operations

### Endpoint

All token operations use:

```text
POST https://<site-url>/API21/HTTP/ConnectionHandler.ashx
Content-Type: application/json
```

### Obtain a token

The request body fields are:

| Field | Type | Required | Confirmed meaning |
| --- | --- | --- | --- |
| `HandlerType` | integer | Yes | Processing type; value must be `3`. |
| `VerifyType` | integer | Yes | Verification type; value must be `1` to obtain a token. |
| `UID` | string | Yes | EVERY8D account identifier. |
| `PWD` | string | Yes | EVERY8D account password. |

Sanitized request:

```http
POST /API21/HTTP/ConnectionHandler.ashx HTTP/1.1
Host: <site-url>
Content-Type: application/json

{
  "HandlerType": 3,
  "VerifyType": 1,
  "UID": "<every8d-uid>",
  "PWD": "<every8d-password>"
}
```

Confirmed success shape:

```json
{
  "Result": true,
  "Msg": "<bearer-token>"
}
```

Confirmed failure shape:

```json
{
  "Result": false,
  "Status": "<error-code>",
  "Msg": "<error-message>"
}
```

The specification recommends obtaining a token once every eight hours. It does not state an exact token lifetime or complete rotation and concurrency rules.

### Check token status

Use the same endpoint with `Authorization: Bearer <bearer-token>` and this body:

```json
{
  "HandlerType": 3,
  "VerifyType": 2
}
```

The documented success response is `{"Result":true}`. A documented failure shape includes `Result=false`, `Status`, and `Msg`.

### Close a token

Use the same endpoint with `Authorization: Bearer <bearer-token>` and this body:

```json
{
  "HandlerType": 3,
  "VerifyType": 3
}
```

The documented success response is `{"Result":true}`. A documented failure shape includes `Result=false`, `Status`, and `Msg`.

### Authentication alternatives on service endpoints

SMS send, query, and maintenance endpoints document two alternative authentication methods:

1. An `Authorization: Bearer <bearer-token>` header.
2. `UID` and `PWD` fields in the request body.

The alternatives are provider-confirmed behavior. This Phase 1 document does not select or implement a credential strategy. Repository governance prohibits committing or logging real credentials and requires future credential resolution to be tenant-specific.

## Outbound SMS endpoints

| Capability | Endpoint | Method | Content type |
| --- | --- | --- | --- |
| General SMS | `/API21/HTTP/SendSMS.ashx` | `POST` | `application/x-www-form-urlencoded` |
| Personalized or parameter SMS | `/API21/HTTP/SendParam.ashx` | `POST` | `application/json` |
| General SMS with 24-hour duplicate filtering | `/API21/HTTP/SendSMS4FilterMessage.ashx` | `POST` | `application/x-www-form-urlencoded` |
| Cancel scheduled SMS | `/API21/HTTP/EraseBooking.ashx` | `POST` | `application/x-www-form-urlencoded` |

### General SMS request

The general endpoint sends one message body to one or more mobile numbers.

| Field | Type | Required | Confirmed meaning |
| --- | --- | --- | --- |
| `Authorization` | header string | Alternative M1 | Bearer token. |
| `UID` | body string | Alternative M2 | Account identifier when bearer authentication is not used. |
| `PWD` | body string | Alternative M2 | Account password when bearer authentication is not used. |
| `SB` | string | No | Subject used to identify the send. It is not sent as SMS content and may be empty. |
| `MSG` | string | Yes | SMS content. |
| `DEST` | string | Yes | One or more mobile numbers separated by ASCII commas. |
| `ST` | string | No | Scheduled time in `yyyyMMddHHmmss`; an empty value means immediate send. |
| `RETRYTIME` | string | No | Message validity period in minutes; default is `1440`. |
| `EventID` | string | No | Interactive-reply activity/channel code. `-1` selects the default activity channel. |

`RETRYTIME` is documented as a validity period. It is not documented as an HTTP retry count or client retry policy.

Sanitized immediate-send request:

```http
POST /API21/HTTP/SendSMS.ashx HTTP/1.1
Host: <site-url>
Authorization: Bearer <bearer-token>
Content-Type: application/x-www-form-urlencoded

SB=<internal-subject>&MSG=<message-content>&DEST=<recipient-mobile>&ST=&RETRYTIME=1440&EventID=<activity-code>
```

Sanitized scheduled request:

```http
POST /API21/HTTP/SendSMS.ashx HTTP/1.1
Host: <site-url>
Authorization: Bearer <bearer-token>
Content-Type: application/x-www-form-urlencoded

SB=<internal-subject>&MSG=<message-content>&DEST=<recipient-mobile>&ST=<yyyyMMddHHmmss>&RETRYTIME=1440
```

### Phone-number behavior

The specification confirms only the following:

- General `DEST` accepts multiple mobile numbers separated by ASCII commas.
- Personalized examples and the field description show both Taiwan national form and a `+886` international form.
- International SMS sending is supported but disabled by default and must be enabled in account settings.
- International numbers do not support long SMS; the platform states that it splits long content for those numbers.

The specification does not establish a complete normalization or validation contract.

### Personalized SMS

`SendParam.ashx` can send individually composed content to multiple recipients in one JSON request.

Top-level fields:

| Field | Type | Required | Confirmed meaning |
| --- | --- | --- | --- |
| `UID` / `PWD` | string | Alternative M2 | Body authentication when bearer authentication is not used. |
| `SB` | string | No | Internal subject; it is not sent as SMS content. |
| `RETRYTIME` | string | No | Validity period in minutes; default is `1440`. |
| `EventID` | string | No | Interactive-reply activity/channel code. |
| `RecipientDataList` | array | Yes by request shape | Recipient records. |

Recipient fields for personalized SMS:

| Field | Type | Required | Confirmed meaning |
| --- | --- | --- | --- |
| `Name` | string | No | Recipient display name for provider send records; default is empty. |
| `Mobile` | string | Yes | Recipient mobile number. |
| `Email` | string | Marked mandatory | Recipient email; the description also says the default is empty and that EVERY8D emails the SMS content without charge. This internal inconsistency is unresolved. |
| `SendTime` | string | No | `yyyyMMddHHmmss`; empty means immediate send. |
| `Param` | string | Yes | Personalized SMS content. |
| `MR` | string | No | Per-message send code. If provided, it must be unique within the same batch and is returned in status reporting. |

Sanitized request:

```http
POST /API21/HTTP/SendParam.ashx HTTP/1.1
Host: <site-url>
Authorization: Bearer <bearer-token>
Content-Type: application/json

{
  "SB": "<internal-subject>",
  "RETRYTIME": 1440,
  "EventID": "<activity-code>",
  "RecipientDataList": [
    {
      "Name": "<recipient-name>",
      "Mobile": "<recipient-mobile>",
      "Email": "<recipient-email>",
      "SendTime": "",
      "Param": "<message-content>",
      "MR": "<message-reference>"
    }
  ]
}
```

### Parameter SMS

The parameter variant also uses `SendParam.ashx`.

- `MSG` is required and can contain `%field1%` through `%field5%`.
- A recipient `Param` value supplies five pipe-separated values.
- Empty values are allowed, but the pipe separators may not be omitted.
- Recipient records otherwise use `Name`, `Mobile`, `Email`, `SendTime`, and `MR` as described above.

Sanitized request fragment:

```json
{
  "MSG": "<prefix>%field1%<separator>%field2%<suffix>",
  "RecipientDataList": [
    {
      "Name": "<recipient-name>",
      "Mobile": "<recipient-mobile>",
      "Email": "<recipient-email>",
      "SendTime": "",
      "Param": "<field-1>|<field-2>|||",
      "MR": "<message-reference>"
    }
  ]
}
```

### Duplicate-filter endpoint

`SendSMS4FilterMessage.ashx` documents filtering of the same content sent to the same mobile number within 24 hours.

Its fields match general SMS and add:

| Field | Type | Required | Confirmed meaning |
| --- | --- | --- | --- |
| `IsSend` | boolean | No | Defaults to `true`; use `false` to evaluate without sending. |

A success or duplicate response can add:

| Field | Confirmed meaning |
| --- | --- |
| `FAIL_MOBILE` | Duplicate mobile numbers, separated by `/`. |
| `FAIL_BATCHID` | Associated duplicate batch identifiers, separated by `/`. |

The specification does not state that this endpoint is a general idempotency mechanism or that it makes client retries safe.

## SMS length and segmentation

The specification states:

- SMS is sent as long SMS and is not limited to 70 Chinese characters.
- It can send up to 333 characters.
- Content over 333 characters is automatically split before sending.
- International mobile networks do not support long SMS, so the platform automatically splits long content for international numbers.
- Adding `EventID` causes the interactive-reply link to add 17 characters to the SMS content.

The specification does not define the character encoding, character-count algorithm, segment boundaries, maximum segment count, or per-segment charging rules. Those gaps are not filled in here.

## Send responses and documented errors

### General SMS

The success response is comma-separated in this order:

```text
<credit>,<sent-count>,<cost>,<unsent-count>,<batch-id>
```

| Position | Name | Confirmed meaning |
| --- | --- | --- |
| 1 | `CREDIT` | Remaining account credit after the send. |
| 2 | `SENDED` | Number sent. The spelling is from the provider contract. |
| 3 | `COST` | Credits deducted for this send. |
| 4 | `UNSEND` | Number not sent for insufficient credit. |
| 5 | `BATCHID` | Batch identifier. |

The documented failure form is:

```text
<status>,<error-message>
```

### Personalized and parameter SMS

Confirmed success shape:

```json
{
  "Result": true,
  "Msg": "<credit>,<sent-count>,<cost>,<unsent-count>,<batch-id>"
}
```

Confirmed failure shape:

```json
{
  "Result": false,
  "Status": "<error-code>",
  "Msg": "<error-message>"
}
```

### Duplicate-filter response

The response extends the general comma-separated values with duplicate mobiles and duplicate batch identifiers:

```text
<credit>,<sent-count>,<cost>,<unsent-count>,<batch-id>,<duplicate-mobiles>,<duplicate-batch-ids>
```

When `IsSend=false`, documented responses use zero values and may still return duplicate mobiles and batch identifiers.

### Documented send-error examples

| Code | Context documented by the specification |
| --- | --- |
| `-99` | Example unknown or exception error for general send and several maintenance operations. |
| `-28` | Example `SendTime` format error for personalized or parameter sending. |

These are examples, not an exhaustive endpoint-error catalogue.

## Batch and message references

- `BATCHID` is returned after successful send or scheduling and must be retained for delivery-status and reply/MO queries.
- The scheduled-SMS cancellation endpoint accepts `BID`, the batch identifier.
- `MR` is optional on personalized and parameter sends. When supplied, it must be unique within the batch and is included in status reporting.
- The callback table also describes an automatically generated record number as `MR` and separately repeats `MR` with a different batch-sequence meaning. This duplicated field name is unresolved.
- The callback table describes `MSGID` as a value supplied during sending, but the outbound SMS request tables do not define a `MSGID` field.

No per-recipient provider message identifier other than the documented `MR` behavior is inferred.

## Delivery-status query

### Request

```text
POST https://<site-url>/API21/HTTP/GetDeliveryStatus.ashx
Content-Type: application/x-www-form-urlencoded
```

| Field | Type | Required | Confirmed meaning |
| --- | --- | --- | --- |
| `Authorization` | header string | Alternative M1 | Bearer token. |
| `UID` / `PWD` | body string | Alternative M2 | Body authentication. |
| `BID` | string | Yes | Batch identifier returned by the send operation. |
| `PNO` | integer | No | Page number, starting at `1`; each page covers up to 1,000 records. |
| `RESPFORMAT` | integer | No | `0` TAB, `1` JSON, `2` XML; default is `0`. |

Sanitized JSON-format request:

```http
POST /API21/HTTP/GetDeliveryStatus.ashx HTTP/1.1
Host: <site-url>
Authorization: Bearer <bearer-token>
Content-Type: application/x-www-form-urlencoded

BID=<batch-id>&PNO=1&RESPFORMAT=1
```

### Response fields

| Field | Confirmed meaning |
| --- | --- |
| `SMS_COUNT` | Total delivery-report count for the batch. |
| `BID` | Batch identifier. |
| `MR` | Message reference/identifier. |
| `NAME` | Provider system key (`DestName`). |
| `MOBILE` | Mobile number. |
| `SEND_TIME` | Send time, documented as `yyyy-MM-dd HH:mm:ss`. |
| `COST` | Deducted credits. |
| `STATUS` | Delivery-report status from the appendix. |
| `REAL_COST` | Actual deducted credits. |
| `RECEIVED_TIME` | Delivery-report time, documented as `yyyy-MM-dd HH:mm:ss`. |
| `DESCRIPTION` | Query result description, listed in the parameter table. |

Sanitized JSON success shape:

```json
{
  "SMS_COUNT": 1,
  "BID": "<batch-id>",
  "DATA": [
    {
      "MR": "<message-reference>",
      "NAME": "<recipient-name>",
      "MOBILE": "<recipient-mobile>",
      "SEND_TIME": "<yyyy-MM-dd HH:mm:ss>",
      "COST": "<credit-cost>",
      "STATUS": "<delivery-status>",
      "REAL_COST": "<actual-credit-cost>",
      "RECEIVED_TIME": "<yyyy-MM-dd HH:mm:ss>"
    }
  ]
}
```

The documented no-results/failure JSON shape contains `SMS_COUNT: 0` and the requested `BID`; it does not include a distinct error object.

## Documented delivery states

The following meanings are transcribed from the specification's DR appendix without adding terminal-state or transition assumptions.

| Status | Provider-documented meaning |
| --- | --- |
| `-10` | Recipient phone system does not support MMS; delivery failed. |
| `-8` | Recipient mobile-number format is invalid; delivery failed. |
| `-5` | Short Message content exceeds the limit; delivery failed. |
| `-4` | Scheduled send time is more than 24 hours overdue; delivery failed. |
| `-3` | Recipient mobile number is on EVERY8D's blacklist; delivery failed. |
| `-2` | API account or password is incorrect; delivery failed. |
| `-1` | Parameter error; delivery failed. |
| `0` | Message delivered to the carrier and awaiting handset receipt. |
| `100` | Successfully delivered to the handset. |
| `101` | Carrier reported receipt failure caused by handset off, poor signal, insufficient SMS storage, or similar condition. |
| `102` | Carrier reported receipt failure caused by network-system or equipment failure. |
| `103` | Carrier reported an incorrect, unassigned, or inactive recipient number. |
| `104` | Recipient number is on the carrier blacklist; delivery failed. |
| `105` | Carrier blocked message content because of a sensitive keyword. |
| `106` | The system blocked message content because of a sensitive keyword. |
| `300` | Scheduled SMS. |
| `301` | Not sent because credit is absent or insufficient. |
| `303` | Schedule cancelled. |
| `500` | International mobile number; international SMS must be enabled in account settings. |
| `700` | Sent/transmitted. |
| `999` | Reply SMS. |

## Reply/MO lookup

### Request

```text
POST https://<site-url>/API21/HTTP/GetReplyMessage.ashx
Content-Type: application/x-www-form-urlencoded
```

| Field | Type | Required | Confirmed meaning |
| --- | --- | --- | --- |
| `Authorization` | header string | Alternative M1 | Bearer token. |
| `UID` / `PWD` | body string | Alternative M2 | Body authentication. |
| `BID` | string | Yes | Batch identifier retained from sending. |
| `PNO` | integer | No | Page number starting at `1`. The pagination quantities are internally inconsistent in the specification. |
| `RESPFORMAT` | integer | No | `0` TAB or `1` JSON; default is `0`. |

The section says a query returns at most 1,000 records, while its `PNO` description assigns 10 records per page. This contract records both statements and does not choose between them.

### Response fields

| Field | Confirmed meaning |
| --- | --- |
| `SMS_COUNT` | Total reply/MO count for the batch. |
| `BID` | Batch identifier. |
| `NAME` | Provider system key (`DestName`). |
| `MOBILE` | Mobile number. |
| `CONTENT` | Reply content. |
| `RECEIVED_TIME` | MO time, documented as `yyyy-MM-dd HH:mm:ss`. |

Sanitized JSON success shape:

```json
{
  "SMS_COUNT": 1,
  "BID": "<batch-id>",
  "DATA": [
    {
      "NAME": "<recipient-name>",
      "MOBILE": "<recipient-mobile>",
      "CONTENT": "<reply-content>",
      "RECEIVED_TIME": "<yyyy-MM-dd HH:mm:ss>"
    }
  ]
}
```

The documented no-results/failure JSON shape contains `SMS_COUNT: 0` and `BID`.

## EventID interactive-reply behavior

- `EventID` is the activity/channel code for the provider's interactive-reply SMS capability.
- When supplied, EVERY8D adds an interactive-reply link to the SMS content.
- The link adds 17 characters to the content according to the specification.
- `EventID=-1` uses the default activity channel.

The specification does not explain channel provisioning, reply-number allocation, tenant ownership, or whether carrier-native MO is separately available.

## Callback/report mechanism

### Configuration and method

- The customer implements an HTTPS receiver and supplies its URL to EVERY8D for provider-side configuration.
- EVERY8D calls that URL for SMS DR, SMS MO, and MMS DR events.
- The callback uses HTTP `GET` with query parameters.

Sanitized callback shape:

```http
GET /<callback-path>?BatchID=<batch-id>&RM=<recipient-mobile>&RT=<yyyyMMddHHmmss>&STATUS=<status>&SM=<reply-content>&ST=<send-time>&MR=<message-reference>&SUBJECT=<subject>&NAME=<recipient-name>&SOURCE=<source>&CHARGE=<credit-charge>&TYPE=SMS&MSGID=<message-id> HTTP/1.1
Host: <customer-callback-host>
```

The specification labels the callback content as encoded but does not identify the URL-encoding or character-encoding rules.

### Callback fields

| Field | Provider-documented meaning |
| --- | --- |
| `BatchID` | Batch/send code returned after sending. |
| `RM` | Mobile number. |
| `RT` | Report time in `yyyyMMddHHmmss`. |
| `STATUS` | Delivery-report status from the appendix. |
| `SM` | Reply SMS content in Traditional Chinese or English. |
| `ST` | Send time. |
| `MR` | Record number automatically created per message, used to distinguish duplicate phone numbers within a batch. |
| `MR` (second table row) | Described separately as batch-code sequence number; the duplicated name is unresolved. |
| `SUBJECT` | SMS subject. |
| `NAME` | Name. |
| `SOURCE` | Send source. |
| `CHARGE` | Charged credits. |
| `TYPE` | `SMS` or `MMS`. |
| `MSGID` | Value described as supplied during sending, although the SMS send tables do not define that request field. |

### Acknowledgement and retries

- The specification treats an HTTP status other than `200` as a connection failure.
- EVERY8D retries the customer URL after such a failure.
- EVERY8D stops after an unspecified maximum number of attempts.
- No required acknowledgement body is documented.
- Retry count, schedule, backoff, timeout, ordering, and duplicate-delivery behavior are not documented.

### Reply SMS callback

The specification explicitly states:

- `STATUS=999` means a reply SMS.
- The reply content is placed in `SM`.

No callback authenticity, signature, or replay-protection mechanism is documented.

## Phase 1B unresolved contract register

This register narrows the existing Phase 1 gaps without creating a second blocker list. Blocker ownership and the Phase 1B decision remain in [`every8d-feasibility-decision.md`](every8d-feasibility-decision.md).

### Sender identity and inbound reply model

| Question | Existing official evidence | Phase 1B classification |
| --- | --- | --- |
| What identity is visible to an outbound recipient? | The send request defines destinations, content, subject, and optional `EventID`; it does not define a sender number or sender ID. | Requires written provider confirmation; still unresolved. |
| What makes a message reply-capable? | `EventID` adds an interactive-reply link and `EventID=-1` selects a default activity channel. | The link behavior is confirmed by official documentation; the provisioning and ownership model requires written provider confirmation. |
| Is ordinary carrier-native MO available? | The specification documents reply lookup and callback `STATUS=999`, but does not say whether those replies are carrier-native MO or only EventID web replies. | Requires written provider confirmation and a separately approved controlled test; still unresolved. |
| How are inbound numbers or channels provisioned? | Not documented. | Requires written provider confirmation; still unresolved. |
| Are receiving resources dedicated or shared? | Not documented. | Requires written provider confirmation; still unresolved. |
| How is a reply associated with the original outbound message? | `BID`/`BATCHID` is used for reply lookup; callbacks include `BatchID`, `MR`, and an unclear `MSGID`. | The presence of these fields is confirmed; stable recipient-level correlation requires written provider confirmation and a separately approved controlled test. |
| How is a sender or inbound resource associated with a Win-CRM tenant? | No tenant or customer-owned sender/channel identifier is defined. | Requires written provider confirmation; still unresolved. |

There is no account/dashboard evidence for any of these questions. Dashboard labels, if later observed, must be recorded as dashboard-only evidence until the API contract or a controlled test establishes their runtime meaning.

### Callback security and delivery contract

| Behavior | Existing official evidence | Phase 1B classification |
| --- | --- | --- |
| Authentication, signature, shared secret, mTLS, or source allowlist | None documented. | Requires written provider confirmation; still unresolved. No security mechanism may be invented. |
| Replay protection and immutable event identity | None documented. | Requires written provider confirmation and a separately approved controlled test; still unresolved. |
| Successful acknowledgement | HTTP status `200` is treated as successful connectivity; no acknowledgement body is defined. | Status behavior is confirmed by official documentation; body requirements require written provider confirmation. |
| Retry trigger | A non-200 response causes a retry. | Confirmed by official documentation. |
| Retry count, interval, backoff, timeout, and maximum delivery age | Retries stop after an unspecified maximum; no other values are defined. | Requires written provider confirmation and a separately approved controlled test; still unresolved. |
| Duplicate callbacks, ordering, and concurrency | Not documented. | Requires written provider confirmation and a separately approved controlled test; still unresolved. |

### Correlation and message identity

| Identifier | Confirmed documented purpose | Missing guarantee | Phase 1B classification |
| --- | --- | --- | --- |
| `BATCHID` | Returned by a successful send/schedule and used for DR, MO, callback reporting, and cancellation. | Scope, uniqueness duration, reuse, partial-send behavior, and tenant-safe lifecycle. | Documented purpose confirmed; guarantees require written provider confirmation and a separately approved lifecycle test. |
| `BID` | Request field carrying the batch identifier for DR/MO queries and scheduled cancellation. | Whether it is always identical to the returned `BATCHID` in every endpoint and failure mode. | Documented use confirmed; complete relationship requires written provider confirmation. |
| `MR` | Optional caller value for personalized/parameter sends, unique within a batch and returned in status reporting. The callback table also defines `MR` twice with conflicting meanings. | Stable source, uniqueness scope, exact callback meaning, and whether general sends expose a recipient-level value. | Documented uses confirmed but internally inconsistent; corrected schema and controlled samples are required. |
| `MSGID` | Callback table describes it as supplied during sending. | No outbound SMS request table defines it; source, uniqueness, and lifecycle are unknown. | Requires corrected written provider documentation and a separately approved controlled test; still unresolved. |
| `EventID` | Selects the interactive-reply activity/channel and causes a reply link to be added. | Activity lifecycle, tenant ownership, relation to callbacks/MO, and uniqueness. | Documented send behavior confirmed; routing guarantees require written provider confirmation and a separately approved test. |
| Recipient-level identifier | No unambiguous immutable identifier is documented across send, DR, MO, and callback. | The key needed for end-to-end recipient correlation. | Requires written provider confirmation and a separately approved test; still unresolved. |

No documented identifier can currently correlate the full Win-CRM request → EVERY8D submission → delivery status → inbound reply → callback chain without additional guarantees. None is documented as an idempotency key.

### Retry and duplicate-send safety

| Question | Existing official evidence | Phase 1B classification |
| --- | --- | --- |
| Is retry after an ambiguous HTTP timeout safe? | Not documented. | Requires written provider confirmation and a separately approved controlled test; still unresolved. |
| Does EVERY8D provide native idempotency? | No idempotency key or idempotent send contract is documented. | Requires written provider confirmation; still unresolved. |
| Is `MR` idempotent? | `MR` is documented as a within-batch correlation value for personalized/parameter sends. | Correlation is confirmed; idempotency is not documented and must not be inferred. |
| What does `SendSMS4FilterMessage.ashx` compare? | Same content to the same mobile number within 24 hours; `IsSend=false` can evaluate without sending. | Character/number normalization, account/channel scope, time boundary, concurrency, and error behavior require written confirmation. |
| Is duplicate filtering atomic and safe for client retries? | Not documented. | Requires written provider confirmation and a separately approved concurrency/timeout test; still unresolved. |

Until those questions are resolved, an ambiguous send outcome must not be automatically retried and the filtered endpoint must not be treated as universal duplicate-send protection.

### Authentication and token lifecycle

| Behavior | Existing official evidence | Phase 1B classification |
| --- | --- | --- |
| Obtain, check, and close token operations | `VerifyType` values `1`, `2`, and `3` are documented. | Confirmed by official documentation. |
| Recommended acquisition interval | Obtain a token once every eight hours. | Confirmed as a recommendation, not an exact lifetime. |
| Exact lifetime, reuse, multiple active tokens, and rotation overlap | Not documented. | Requires written provider confirmation and a separately approved non-production test; still unresolved. |
| Expiry, replacement, close/revocation propagation, and error response | Not documented beyond generic failure shapes. | Requires written provider confirmation and a separately approved non-production test; still unresolved. |
| Safe retry after authentication failure | Not documented. | Requires written provider confirmation and a separately approved non-production test; still unresolved. |

### Encoding, length, segmentation, and billing

| Behavior | Existing official evidence | Phase 1B classification |
| --- | --- | --- |
| Request media types | JSON and form-encoded media types are identified per endpoint. | Confirmed by official documentation. |
| Request/callback charset and percent-encoding | Not defined; the callback is only described as encoded. | Requires written provider confirmation and a separately approved test; still unresolved. |
| Traditional Chinese and English replies | The callback `SM` description names Traditional Chinese and English. | Confirmed only for the documented reply-content field; it does not establish request charset or counting rules. |
| ASCII, URLs, emoji, combining characters, and Unicode normalization | Not documented. | Requires written provider confirmation and separately approved representative tests; still unresolved. |
| Long-message maximum and `EventID` overhead | Long SMS is described as up to 333 characters; content above 333 is split; the interactive link adds 17 characters. | Confirmed by official documentation. |
| Counting algorithm, segment boundaries, maximum segments, and per-segment billing | Not documented. | Requires written provider confirmation and separately approved boundary tests; still unresolved. |

### Taiwan phone-number normalization

The official examples show a Taiwan national form and a `+886` form, but do not establish the accepted set. In particular, the contract does not confirm acceptance of all three candidate forms `09xxxxxxxx`, `8869xxxxxxxx`, and `+8869xxxxxxxx` or define punctuation, whitespace, and validation behavior.

The eventual Win-CRM strategy should therefore be conditional and provider-neutral:

1. Accept only explicitly approved Taiwan input forms at the external boundary.
2. Parse and validate as a Taiwan mobile number without silently treating malformed input as valid.
3. Normalize the internal destination to canonical E.164 (`+8869xxxxxxxx`) while retaining a redacted audit representation rather than logging the full number.
4. Convert to the exact EVERY8D wire format only after written provider confirmation and controlled-test evidence establish that format.
5. Reject missing, ambiguous, unsupported, or non-Taiwan destinations for the pilot; keep international sending out of scope.

This is a recommended future design, not a provider-confirmed API behavior, and no normalization is implemented by Issue #74.

### Provider limits, retention, and test availability

| Limit or capability | Existing official evidence | Phase 1B classification |
| --- | --- | --- |
| DR page size | Up to 1,000 records per page. | Confirmed by official documentation. |
| MO page size | The specification conflicts between 1,000 records and 10 records per page. | Requires corrected written confirmation and a separately approved multi-page test. |
| QPS, concurrency, throughput, recipients/request, payload/batch size, throttling, and query frequency | Not documented. | Requires written provider confirmation; still unresolved. |
| DR, MO, callback, and identifier retention | Not documented. | Requires written provider confirmation and later reconciliation testing; still unresolved. |
| Sandbox, non-production endpoint, test credentials/numbers, or no-charge messages | Not documented. | Requires written provider confirmation; still unresolved. |
| Provider-approved controlled production test | Not documented. | Requires explicit written provider and project approval. Issue #74 does not authorize it. |

The proposed controlled-test matrix, message ceiling, cost gate, evidence requirements, and stop conditions are recorded in the feasibility decision. It is a readiness artifact only and must not be executed without a separate approval.

## Confirmed boundaries

This contract deliberately does not define:

- callback authentication or replay protection;
- send idempotency or safe retry after an ambiguous timeout;
- tenant routing or sender-number ownership;
- exact token lifetime or rotation behavior;
- request and callback charset rules;
- exact SMS segmentation or charging rules;
- throughput, rate limits, or maximum batch size;
- sandbox behavior;
- retention, SLA, pricing, consent, or opt-out rules.

Those items remain provider questions and prevent Phase 2 clearance.
