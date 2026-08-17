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

## First controlled recipient format

The official examples show both Taiwan national form and `+886` form, but the provider documentation does not establish the complete accepted set or normalization rules. The runner deliberately does not normalize a number.

For the first domestic controlled test, the conservative operator choice is Taiwan national mobile form `09xxxxxxxx` (10 ASCII digits, no spaces or punctuation). This is a local test constraint based on the documented national-form example, not a provider-confirmed guarantee. Do not use `+8869xxxxxxxx` for the first test unless international-number handling has been separately confirmed and approved, because the documentation says international SMS is disabled by default at the account level.

The exact same single value must be supplied as both `EVERY8D_APPROVED_RECIPIENT` and `EVERY8D_SPIKE_RECIPIENT`. The runner rejects commas, semicolons, carriage returns, newlines, missing values, and any requested/approved mismatch. It does not independently prove ownership of the handset or validate the number with EVERY8D before the send request; those remain human approval responsibilities.

## Sanitized evidence capture

On provider acceptance, the runner logs the returned `BATCHID` as `batchId`. It reuses that value as `BID` in one immediate `GetDeliveryStatus` request and logs the response `bid`, any returned `MR` values as `mrValues`, and documented delivery states. These identifiers are retained without logging the token, password, complete recipient, or message content.

The token exists only in process memory long enough to authenticate the `SendSMS` and `GetDeliveryStatus` requests. The password is read from process environment for authentication. Neither value is included in structured log metadata, returned runner output, or documented evidence.

## Known limitations

- Exact token lifetime, rotation overlap, and concurrent-token behavior remain undocumented.
- Sender identity, reply routing, and tenant-safe correlation remain unresolved.
- `MR`/`MSGID` callback semantics remain internally inconsistent in the provider documentation.
- Encoding, segmentation, charge boundaries, rate limits, status retention, and idempotent retry behavior remain unresolved.
- No sandbox SiteURL is documented.
- The runner makes no automatic retry after an ambiguous send timeout because that could duplicate a billed SMS.
- Immediate delivery querying cannot prove callback behavior, final-state timing, or status-transition guarantees.
