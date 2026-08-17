# LINE contact reconciliation preview (PR1)

This endpoint classifies a possible LINE/contact reconciliation. It is read-only for business, contact, mapping, conversation, provider, workflow, and LINE data. It does not merge, create, update, or delete contacts; alter Supabase mappings; create conversation messages; invoke workflow actions or provider callbacks; or send LINE messages. Normal OAuth lifecycle maintenance may update only the exact location's `ghl_oauth_tokens` row when its access token must be refreshed.

## Endpoint

`POST /internal/line-contact-reconcile/preview` requires the existing shared-secret authentication.

```json
{
  "locationId": "required",
  "currentContactId": "required",
  "source": "line",
  "identity": {
    "email": "optional",
    "phone": "optional E.164"
  }
}
```

The caller must not supply a tenant ID or LINE user ID. The backend resolves one tenant for the location, performs exact-count tenant-scoped `line_profiles` reads, obtains the immutable LINE user ID from the unique mapping, and verifies that `currentContactId` exactly equals that mapping's GHL contact ID. It never selects a preferred profile when duplicate rows exist.

The response contains a decision, sanitized reason codes, an HMAC-based preview key, `currentContactMatchesMapping`, supplied-identity presence flags, a distinct-candidate count, field-policy status, per-check `riskReadStatuses`, and sanitized transfer-inventory counts. It does not echo identity values, tags, field IDs, or database/GHL identifiers. The preview key uses the existing server shared secret with a reconciliation-specific domain separator; raw HMAC input is never logged or returned.

## Decision precedence

1. `UNSUPPORTED_SOURCE`
2. `INVALID_EMAIL`
3. `INVALID_PHONE`
4. `NO_IDENTIFIER`
5. `CROSS_TENANT_BLOCKED`
6. `MAPPING_NOT_FOUND`
7. `AMBIGUOUS`
8. `MAPPING_CONTACT_MISMATCH`
9. `ALREADY_RECONCILED`
10. `NO_MATCH`
11. `IDENTITY_CONFLICT`
12. `MANUAL_COMPLEX`
13. `AUTO_SIMPLE`

`NO_IDENTIFIER` means neither Email nor Phone remains after trimming. It returns HTTP 200 without calling contact search or any associated-record endpoint. `NO_MATCH` means at least one syntactically valid identity signal was supplied but no distinct candidate matched. `ALREADY_RECONCILED` means the supplied identity is already on the mapped contact and no distinct candidate exists. Master-only merge risks do not replace either result with `MANUAL_COMPLEX`; transfer-risk blocking begins only after one distinct candidate exists.

Zero tenants for a location returns `MAPPING_NOT_FOUND` with `LOCATION_NOT_ONBOARDED`. Multiple tenants return `CROSS_TENANT_BLOCKED`. Zero mapping rows return `MAPPING_NOT_FOUND`, one continues, and two or more return `AMBIGUOUS`. Every exact-count result is checked against the returned row count; inconsistent results fail closed rather than selecting a row.

## Silent GHL workflow handoff

PR1 does not create or publish this workflow. A future workflow must use this exact silent sequence:

1. Customer Replied.
2. Clear candidate Email and Phone custom fields.
3. Workflow AI extracts identity only from the current inbound message.
4. Continue only when this execution writes at least one candidate field.
5. Call the Preview endpoint with those current-execution values.
6. Clear candidate Email and Phone fields after Preview.
7. End silently.

The endpoint evaluates only `identity` values in the current request. It never reads candidate Email or Phone from stored GHL custom fields. The AI must not update standard Email/Phone, choose contact IDs, select a master, merge, or send a customer-facing reply.

## Field policy

Field IDs are resolved at runtime from the location's contact custom-field definitions by stable `fieldKey` or exact field name; no tenant-specific field ID is hardcoded. HighLevel `fieldKey` values are not assumed to be globally unique. Definitions with unrelated duplicate normalized keys remain separate protected fields by their unique IDs, while ambiguity is evaluated and rejected for each LINE identity or ignored temporary-field reference.

- Every confirmed LINE identity custom-field value is checked independently against the immutable, tenant-scoped Supabase `lineUserId`. Empty values provide no evidence, an exact value is valid evidence, and any different non-empty value produces `IDENTITY_CONFLICT` without exposing either value. The mapped master's LINE identity fields are validated from location metadata even when contact search finds no distinct candidate; malformed or unavailable metadata fails closed without associated-record reads.
- Stable LINE identity metadata includes `contact.line_user_id`, `contact.line_userid`, `contact.line_id`, `LINE User ID`, `LINE UserId`, and `LINE ID`. The configured `GHL_LINE_USER_ID_FIELD_ID` is recognized only when that exact ID exists in the current location metadata.
- Temporary AI command fields (`AI Event Command`, `AI Tag Command`, and `AI Content Command`) are ignored and are never proposed for transfer.
- Candidate Email/Phone workflow fields are ignored for comparison and are never used as request identity.
- Every other discovered contact custom field is protected. Different non-empty values produce `MANUAL_COMPLEX`.
- Candidate-only, master-only, and equal non-empty values are not conflicts.
- Missing or malformed field metadata fails closed as `MANUAL_COMPLEX`.
- Missing field IDs, conflicting duplicate values, duplicate metadata IDs, and ambiguous stable metadata fail closed. Conclusively equal duplicate values may be normalized once.

Exact `line:<user>` tags are identity evidence. A captured value is canonicalized for comparison and deduplication only when it matches the integration's supported LINE user-ID syntax: `U` or `u` followed by exactly 32 hexadecimal characters. Canonicalization normalizes the prefix and hexadecimal casing without rewriting the GHL tag or the Supabase mapping. Unsupported or malformed `line:` identity tags fail closed, a genuinely different canonical user is `IDENTITY_CONFLICT`, and multiple genuinely different canonical identities are `AMBIGUOUS`. Multiple raw case variants of the same valid identity count as one identity. The ordinary `line` tag is not identity evidence, and arbitrary identifiers never receive generic case-insensitive comparison. Responses and logs expose only sanitized states, never raw LINE user IDs or identity tags.

Malformed tag containers, non-string entries, and empty tag entries fail closed as a `MALFORMED` read. They are never silently discarded.

After one candidate passes GHL location and identity validation, Preview exact-counts tenant-scoped `line_profiles` rows for the candidate contact. Another LINE user's mapping is `IDENTITY_CONFLICT`; multiple mappings are `AMBIGUOUS`. Because the candidate is already distinct, a candidate mapping to the same immutable LINE user is also `AMBIGUOUS` with `SAME_LINE_USER_MAPPED_TO_MULTIPLE_CONTACTS`. No preferred profile selector is used, and `ALREADY_RECONCILED` is reserved for identity already present on the currently mapped contact when no distinct candidate exists.

Standard contact data uses an explicit policy. Recognized transferable business fields enter the sanitized transfer inventory. True system metadata—IDs, location IDs, timestamps, deletion markers, internal links, tags/custom-field containers, `createdBy`, and HighLevel's derived `emailLowerCase`, `firstNameLowerCase`, `fullNameLowerCase`, and `lastNameLowerCase` values—is ignored rather than treated as transferable. Contact type, followers, attribution data (including `attributionSource`), and business relationship fields are protected business data, not disposable metadata. Any non-empty field that is neither classified nor explicitly ignored forces `MANUAL_COMPLEX` with `UNCLASSIFIED_STANDARD_FIELD_PRESENT` when a distinct candidate exists.

Protected or unsupported standard fields are compared by relationship and returned only as `masterOnly`, `candidateOnly`, `equal`, and `conflicting` counts. Master-only and equal values are safe for Preview because the intended master retains them. Candidate-only values return `CANDIDATE_ONLY_PROTECTED_STANDARD_FIELD`; conflicting values return `CONFLICTING_PROTECTED_STANDARD_FIELD`. Names and values are never returned.

## Associated-record and scope policy

Only a distinct candidate is checked because the mapped LINE contact is the intended master. No associated-record endpoint is called for `NO_MATCH` or `ALREADY_RECONCILED`. Conversations, notes, tasks, opportunities, appointments, orders, transactions, and invoices each report one of:

- `CLEAR`: the read succeeded and returned no records.
- `FOUND`: one or more records exist.
- `MISSING_SCOPE`: the stored OAuth grant lacks or HighLevel denies the required read scope.
- `UNAVAILABLE`: timeout, deadline, authentication, network, or service failure made the result uncertain.
- `MALFORMED`: a response could not be safely interpreted.

Every status other than `CLEAR` forces `MANUAL_COMPLEX`. `riskReadStatuses` describes the result of each bounded risk read and is not presented as OAuth scope presence. Independent checks run concurrently only after tenant, mapping, candidate identity, candidate location ownership, candidate LINE mapping, and LINE identity tag checks pass.

Required read scopes are `contacts.readonly`, `locations/customFields.readonly`, `conversations.readonly`, `opportunities.readonly`, `payments/orders.readonly`, `payments/transactions.readonly`, and `invoices.readonly`. PR1 does not change Marketplace App scopes or OAuth configuration. `AUTO_SIMPLE` may therefore be unreachable until the missing read scopes are separately reviewed, approved, and rolled out.

The location-scoped Orders risk read uses `GET /payments/orders` with `locationId`, `altId`, `altType=location`, `contactId`, `limit=1`, and `offset=0`. Production contract validation confirmed that the live List Orders endpoint requires `altType=location`; the read remains bounded and classification-only.

Each HighLevel read has a narrow timeout and the whole preview has a fixed deadline. Reads are never retried beyond that deadline, no new refresh or read starts after the deadline wins, and completion is logged once. Timeout, partial completion, or uncertainty returns `MANUAL_COMPLEX`. A mapped-contact 404 becomes `MAPPING_NOT_FOUND`; a searched candidate that disappears becomes `MANUAL_COMPLEX`.

Preview acquires OAuth only after exact tenant and location resolution. A valid stored access token is reused. An expired or near-expiry token is refreshed once through the stored location refresh token; a permitted read that returns 401 may also trigger the same single shared session refresh and retry that exact read once. Concurrent 401 reads share one refresh promise. Private-token fallback is never used. Stored, returned, and saved location/tenant context must remain exact, the exchange is capped by the remaining Preview deadline, and any missing, rejected, foreign, still-expired, or second-refresh condition fails closed. Token values are never logged or returned. OAuth refresh persistence is limited to `ghl_oauth_tokens`; `line_profiles` and all business or messaging records remain untouched.

Transfer inventory is classification-only. It returns counts for master-only, candidate-only, equal, and conflicting transferable standard fields, protected or unsupported standard fields, and custom fields, plus candidate-only non-identity tags and an unclassified-standard-field count. It never returns or proposes field names, values, IDs, tags, Email, Phone, LINE IDs, or contact IDs and performs no mutation.

## Transport boundary and rollback

The dedicated client permits only its declared GET endpoints and `POST /contacts/search`. It rejects every other POST and all PUT, PATCH, and DELETE requests before dispatch.

Rollback of OAuth refresh support is a code revert restoring fail-closed behavior for expired tokens. There is no migration or stored Preview state to reverse. Previously refreshed OAuth credentials remain valid; no contact, mapping, conversation, provider, workflow, or LINE data requires rollback.
