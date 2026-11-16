# C3c-4c Resend provider contract

C3c-4c-1 supplies the reviewed adapter, transport and network-free proof for provider ID `resend`. C3c-4c-2 connects those modules to the settings email worker in source. The C3c-4a engine and C3c-3 database authority still govern delivery evidence, outbox state, fences, leases, attempt limits, retry timing and idempotency.

## Credential and request

Only `undefined` is absent. A supplied API key must be a string of 1–256 UTF-8 bytes, each in the ASCII range 0x21–0x7E. The parser preserves the exact value without requiring a prefix. It throws a fixed configuration error for malformed values. This validates local header containment. Credential activity is determined by the provider.

The frozen factory captures the admitted key privately and takes a synchronous, zero-argument fatal observer. Construction performs no I/O, health check, validation send, queueing, polling or timer setup. The socket seam is available only through explicit code injection for tests. The fixed destination is `api.resend.com:443` and the fixed request line is `POST /emails HTTP/1.1`. No environment configuration selects a destination, proxy, trust roots, transport or executable.

The only application-supplied headers are:

| Header | Value |
| --- | --- |
| Authorization | Bearer followed by the exact admitted API key |
| Content-Type | `application/json` |
| Accept | `application/json` |
| Accept-Encoding | `identity` |
| Idempotency-Key | Exact engine-supplied value |
| Content-Length | Exact request-body byte count |
| Host | `api.resend.com` |
| Connection | `close` |

The JSON object has exactly `from`, `to`, `subject` and `text`. The adapter passes the engine's sender, subject and plaintext through unchanged and wraps the exact recipient in a one-element array. It submits the body once and follows zero redirects. The frozen key is the 57-byte ASCII `wincrm-c3c3-email-v1:<canonical-lowercase-job-uuid>`. The adapter checks header containment and Resend's 256-character limit without regenerating the key or interpreting its structure. An incompatible key fails before transport. Resend's documented 24-hour retention supplies no WinCRM retry or replay authority. [Resend send endpoint](https://resend.com/docs/api-reference/emails/send-email), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)

## TCP, TLS and diagnostics

The transport invokes built-in net.connect once at the fixed host and port with autoSelectFamily false. Once that plain socket connects, the transport wraps it once with tls.connect({ socket, ... }). TLS sends SNI for api.resend.com, verifies that hostname and the certificate chain, and explicitly uses the Node bundled public trust roots. The minimum is TLS 1.2. The client offers only HTTP/1.1 and accepts that selection or absent ALPN. It opens one connection, performs one application write after secureConnect and closes the connection after the first complete framed response or a failure. There is no reconnect, fallback, proxy, replay, pooling, pipelining or HTTP-stack client.

The Node process and code running inside it are trusted. The ordinary net.client.socket channel can publish the underlying plain TCP socket. The TLS wrapper does not open its own TCP connection or publish a plaintext-capable socket through that channel. Built-in HTTP client diagnostics and HttpClient performance entries are bypassed. Production must prohibit --tls-keylog, --trace-tls, NODE_TLS_REJECT_UNAUTHORIZED=0 and tooling that captures request plaintext or TLS keys. The transport installs no key logger, TLS tracing callback, client certificate or session reuse.

## Deadline and buffer ownership

The transport checks the signal and requires at least 1,000,000 ns on the original monotonic deadline both before preparation and immediately before invoking net.connect. It marks transport entry before invoking net.connect, including synchronous throws. DNS, TCP, TLS, write, response framing and JSON evidence processing share that deadline and signal. No stage refreshes either. TCP entry is the conservative boundary even if TLS or the HTTP write never starts. Abort or deadline destroys the active sockets and selects one result.

One adapter-owned buffer contains the exact HTTP headers and JSON. Before write entry, cleanup may zero the buffer. At the single tlsSocket.write call, the adapter transfers buffer ownership to the write callback. Result settlement, socket destruction, errors, aborts and deadline do not mutate submitted bytes. The callback for that write zeroes the buffer and drops its reference, including when Node releases it with an error. If the callback never runs, the adapter does not retain a separate reference or mutate the bytes. JavaScript strings and copies inside the runtime have no guaranteed erasure.

## Bounded HTTP/1.1 and JSON evidence

The wire parser admits a literal HTTP/1.1 status line of at most 1,024 octets including CRLF, with a three-digit 100–599 status and a printable ASCII reason. It rejects all informational responses and upgrades. The complete status and header block, including all whitespace and delimiters through CRLFCRLF, must fit within 16,384 actual received octets before field normalization. Field names must use HTTP tokens. Bare LF, folded fields, invalid controls and whitespace before the colon are rejected. Duplicate Content-Type, Content-Encoding, Content-Length, Transfer-Encoding, Trailer or Connection blocks evidence.

Evidence requires application/json with optional UTF-8 charset and absent or identity Content-Encoding. A response Connection field may be absent, close or keep-alive. Evidence requires one framing mode. Content-Length is decimal and bounded to 16,384 bytes. Transfer-Encoding accepts only a single chunked coding. Each chunk uses 1–16 hexadecimal digits, CRLF, exact data and CRLF. The stream terminates with 0 followed by an empty trailer section. Extensions, Trailer declarations and actual trailers are forbidden. Decoded data is bounded to 16,384 bytes and cumulative chunk metadata to 128 KiB. EOF cannot finish an incomplete frame, and surplus bytes after a completed frame are discarded.

Evidence uses fatal UTF-8 decoding and rejects BOM. A structural tokenizer validates the complete JSON document, permits at most 64 object/array levels, counts top-level members, decodes names and detects duplicate evidence names after escape decoding. Nested lookalikes have no authority.

Acceptance requires a completed HTTP 200 before the original deadline without cancellation. The top-level object must have exactly one `id` member and no duplicate spelling of it. The ID must contain 1–255 characters in ASCII 0x21–0x7E. The result carries that exact ID. A duplicate idempotent success uses the same checks.

Structured error evidence requires a top-level object with unique string `name` and `message` fields. Optional `statusCode` must be unique, and its raw JSON token must be exactly the three ASCII digits of the actual HTTP status. Fractional, exponent, signed and string forms never establish authority, even if numeric coercion would round them to the HTTP status. Error message text has no classification role. Resend documents 401 `validation_error` for an invalid key on sending endpoints and 403 `restricted_api_key` for an inactive key. [Resend error reference](https://resend.com/docs/api-reference/errors)

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

The adapter invokes `reportProviderFatal()` synchronously when it establishes a fatal condition and at most once per send. A complete, valid, bounded HTTP/1.1 final status line received within the original monotonic deadline establishes status-only fatality for 201–299, 300–399, 401, 403, 404 and 405. This health notification occurs before the remaining headers are validated and carries no delivery authority. Malformed or interrupted headers cannot erase the fatal observation. A recognized 401 or 403 still requires complete bounded headers, framing and body evidence to establish authoritative non-acceptance. A synchronous abort from the fatal observer stops parsing and selects `outcome_unknown` after transport entry.

The callback carries no identity, payload, reason or evidence. The result carries no fatal field. Late events cannot replace a selected result or report fatal again. This slice emits no definitive message refusal, uses no Retry-After scheduling and performs no internal retry.

Configuration errors are fixed and value-free. Adapter diagnostics exclude the key, Authorization, message content and identifiers, idempotency key, provider response, raw exceptions and request objects. A validated provider message ID crosses only the acceptance-result interface. Tests trap external network entry and use synthetic values. Native Node 22 loopback exercises the TLS peer, ordinary HTTPS as a positive diagnostic control, absence of HTTP client diagnostic/performance events from the revised path, and observation of the retained plain TCP socket through cleanup.

## Worker integration in C3c-4c-2

The worker configuration validates the shape of a supplied `EVERY8D_SETTINGS_AUTH_EMAIL_RESEND_API_KEY` before applying the disabled gate, regardless of provider selection. A malformed value produces the fixed worker configuration error. A missing or valid supplied value permits an otherwise valid disabled worker configuration, including a dormant unknown provider ID. Worker configuration never retains the Resend key.

The production source registry has one frozen own registration, `resend`. Operational startup reads the environment, admits the worker configuration, parses readiness, constructs the client and then constructs the repository and runtime before starting the loop. Readiness requires an admitted key held privately for client construction. Readiness and construction do no I/O and schedule no work. The client opens a connection only when a send reaches the adapter.

The process-owned fatal callback latches a nonzero exit and synchronously closes claim, begin-send, maintenance and new provider admission when it initiates shutdown. The first stop mode wins. Ordinary stops immediately cancel the batch. A first `provider_fatal` stop preserves in-flight provider signals and original deadlines so completed results can reach finalization during the existing 20-second drain. Repeated notifications and later signals leave the drain deadline in place. A fatal notification during an ordinary stop still latches failure. A fatal notification during client construction ends startup before repository or runtime construction.

Drain expiry aborts remaining provider transport controllers and requests a forced process exit. The callback supplies zero delivery evidence, and the unchanged engine processes actual results and repository receipts. Telemetry allowlists only the fixed `provider_fatal` reason on the existing lifecycle events.

**Static source registration and production activation are separate.** Live email remains unavailable without an operational environment, its required flags and credentials, and a worker deployment. This slice uses synthetic credentials and local proofs and makes no deployment or external Resend request.
