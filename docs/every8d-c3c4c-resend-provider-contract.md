# C3c-4c-1 Resend provider contract

C3c-4c-1 adds the source and network-free proof for provider ID `resend`. The production registry is empty and the worker has no call site for the credential parser or factory. **C3c-4c-1 does not make live email possible.** C3c-4c-2 owns the proposed disabled-config pre-gate parser call, static registration and provider-fatal lifecycle bridge. The C3c-4a worker engine, C3c-4b lifecycle and C3c-3 database authority remain frozen, including the outbox, fences, leases, attempt limits, retry timing, renderer, crypto and idempotency generation.

## Credential and request

Only `undefined` is absent. A supplied API key must be a string of 1–256 UTF-8 bytes, each in the ASCII range 0x21–0x7E. The parser preserves the exact value without requiring a prefix. It throws a fixed configuration error for malformed values. This validates local header containment. Credential activity is determined by the provider.

The frozen factory captures the admitted key privately and takes a synchronous, zero-argument fatal observer. Construction performs no I/O, health check, validation send, queueing, polling or timer setup. The request seam is callable only by explicit injection. The default transport uses built-in `node:https` and a one-use connection with certificate verification. The fixed destination is `POST https://api.resend.com/emails`. No environment configuration selects a destination, proxy, transport or executable.

The only application-supplied headers are:

| Header | Value |
| --- | --- |
| Authorization | Bearer followed by the exact admitted API key |
| Content-Type | `application/json` |
| Accept | `application/json` |
| Accept-Encoding | `identity` |
| Idempotency-Key | Exact engine-supplied value |
| Content-Length | Exact request-body byte count |

The JSON object has exactly `from`, `to`, `subject` and `text`. The adapter passes the engine's sender, subject and plaintext through unchanged and wraps the exact recipient in a one-element array. It submits the body once and follows zero redirects. The frozen key is the 57-byte ASCII `wincrm-c3c3-email-v1:<canonical-lowercase-job-uuid>`. The adapter checks header containment and Resend's 256-character limit without regenerating the key or interpreting its structure. An incompatible key fails before transport. Resend's documented 24-hour retention supplies no WinCRM retry or replay authority. [Resend send endpoint](https://resend.com/docs/api-reference/emails/send-email), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)

## Transport boundary and limits

Each send crosses the request-invocation boundary at most once. The adapter checks the abort signal and requires at least 1,000,000 ns on the original monotonic deadline before preparing the request and again immediately before invocation. Cancellation or insufficient budget before entry proves `transport_not_started`. After entry, ordinary transport exceptions, including a synchronous HTTPS throw, carry no proof of non-acceptance. Abort and deadline destroy unfinished transport and settle once. The adapter releases its abort listener, watchdog and request/response references after settlement. It clears owned mutable buffers when written or discarded. JavaScript strings and internal transport copies have no guaranteed erasure.

Node limits response headers to 16 KiB. The adapter checks duplicate evidence headers using raw header fields and limits the streamed body to 16,384 actual bytes independently of Content-Length. A declared length must be valid and match the completed stream. Content-Type must be `application/json`, optionally with a UTF-8 charset. Content-Encoding must be absent or exactly `identity`. The adapter performs no decompression. Evidence uses fatal UTF-8 decoding and complete JSON.

Acceptance requires a completed HTTP 200 before the original deadline without cancellation. The top-level object must have exactly one `id` member and no duplicate spelling of it. The ID must contain 1–255 characters in ASCII 0x21–0x7E. The result carries that exact ID. A duplicate idempotent success uses the same checks.

Structured error evidence requires a top-level object with unique string `name` and `message` fields. Optional `statusCode` must be a unique integer equal to the HTTP status. Error message text has no classification role. Resend documents 401 `validation_error` for an invalid key on sending endpoints and 403 `restricted_api_key` for an inactive key. [Resend error reference](https://resend.com/docs/api-reference/errors)

## Response and fatal policy

| Observation | Provider outcome and evidence | Fatal observer |
| --- | --- | --- |
| Valid 200, including an idempotent success | `accepted` / `authoritative_acceptance` | No |
| 200 with malformed, incomplete or invalid acceptance evidence established by response processing | `outcome_unknown` | Yes |
| Other final 2xx, 3xx, 404 or 405 | `outcome_unknown` | Yes |
| 400 `invalid_idempotency_key` or `validation_error` | `outcome_unknown` | Yes |
| 401 `missing_api_key` or `validation_error` with recognized structured evidence | `not_accepted_retryable` / `authoritative_non_acceptance` | Yes |
| 403 `invalid_permission`, `restricted_api_key` or `suspended_api_key` with recognized structured evidence | `not_accepted_retryable` / `authoritative_non_acceptance` | Yes |
| Other 401 or 403, including broad 403 `validation_error` and malformed responses | `outcome_unknown` | Yes |
| 409 `invalid_idempotent_request` | `outcome_unknown` | Yes |
| 409 `concurrent_idempotent_requests` or other 409 | `outcome_unknown` | No |
| 422 `missing_required_field`, `missing_required_parameter`, `invalid_parameter` or `invalid_attachment` | `outcome_unknown` | Yes |
| 429 `daily_quota_exceeded` or `monthly_quota_exceeded` | `outcome_unknown` | Yes |
| Other 400, 422 or 429, and all 5xx | `outcome_unknown` | No |
| Network, DNS, connect, TLS, reset, timeout or interrupted response after invocation | `outcome_unknown` | Only if an independent fatal condition was established |
| Abort or deadline after invocation | `outcome_unknown` | No new fatal observation |
| Abort or insufficient deadline budget before invocation | `not_accepted_retryable` / `transport_not_started` | No |
| Proven adapter invariant failure before invocation | `not_accepted_retryable` / `transport_not_started` | Yes |

The adapter invokes `reportProviderFatal()` synchronously when it establishes a fatal condition and at most once per send. For 401 or 403, the status establishes fatality while the bounded complete body can still establish authoritative non-acceptance. An interruption leaves the fatal observation latched. The callback carries no identity, payload, reason or evidence. The result carries no fatal field. Late events cannot replace a selected result or report fatal again. This slice emits no definitive message refusal, uses no Retry-After scheduling and performs no internal retry.

Configuration errors are fixed and value-free. Adapter diagnostics exclude the key, Authorization, message content and identifiers, idempotency key, provider response, raw exceptions and request objects. A validated provider message ID crosses only the acceptance-result interface. Tests trap external network entry and use synthetic values.
