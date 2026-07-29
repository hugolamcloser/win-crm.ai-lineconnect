# LINE contact reconciliation preview (PR1)

This endpoint classifies a possible LINE/contact reconciliation. It is intentionally read-only. It does not merge, create, update, or delete contacts; alter Supabase mappings; create conversation messages; invoke workflow actions or provider callbacks; or send LINE messages.

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

The response contains a decision, sanitized reason codes, a non-reversible preview key, `currentContactMatchesMapping`, supplied-identity presence flags, a distinct-candidate count, field-policy status, and per-check `scopeAvailability` and `associatedRecords` statuses. It does not echo identity values or database/GHL identifiers.

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

`NO_IDENTIFIER` means neither Email nor Phone remains after trimming. It returns HTTP 200 without calling contact search or any associated-record endpoint. `NO_MATCH` means at least one syntactically valid identity signal was supplied but no distinct candidate matched.

Zero tenants for a location returns `MAPPING_NOT_FOUND` with `LOCATION_NOT_ONBOARDED`. Multiple tenants return `CROSS_TENANT_BLOCKED`. Zero mapping rows return `MAPPING_NOT_FOUND`, one continues, and two or more return `AMBIGUOUS`.

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

Field IDs are resolved at runtime from the location's contact custom-field definitions by stable `fieldKey` or exact field name; no tenant-specific field ID is hardcoded.

- LINE identity fields: different non-empty values produce `IDENTITY_CONFLICT`.
- Temporary AI command fields (`AI Event Command`, `AI Tag Command`, and `AI Content Command`) are ignored and are never proposed for transfer.
- Candidate Email/Phone workflow fields are ignored for comparison and are never used as request identity.
- Every other discovered contact custom field is protected. Different non-empty values produce `MANUAL_COMPLEX`.
- Candidate-only, master-only, and equal non-empty values are not conflicts.
- Missing or malformed field metadata fails closed as `MANUAL_COMPLEX`.

## Associated-record and scope policy

Only the distinct candidate is checked because the mapped LINE contact is the intended master. Conversations, notes, tasks, opportunities, appointments, orders, transactions, and invoices each report one of:

- `CLEAR`: the read succeeded and returned no records.
- `FOUND`: one or more records exist.
- `MISSING_SCOPE`: the stored OAuth grant lacks or HighLevel denies the required read scope.
- `UNAVAILABLE`: timeout, deadline, authentication, network, or service failure made the result uncertain.
- `MALFORMED`: a response could not be safely interpreted.

Every status other than `CLEAR` forces `MANUAL_COMPLEX`. Independent checks run concurrently only after tenant, mapping, candidate identity, and candidate location ownership pass.

Required read scopes are `contacts.readonly`, `locations/customFields.readonly`, `conversations.readonly`, `opportunities.readonly`, `payments/orders.readonly`, `payments/transactions.readonly`, and `invoices.readonly`. PR1 does not change Marketplace App scopes or OAuth configuration. `AUTO_SIMPLE` may therefore be unreachable until the missing read scopes are separately reviewed, approved, and rolled out.

Each HighLevel read has a narrow timeout and the whole preview has a fixed deadline. Reads are never retried beyond that deadline. Timeout, partial completion, or uncertainty returns `MANUAL_COMPLEX`. To preserve the no-write guarantee, Preview uses the stored location OAuth token but does not refresh it; an expired or near-expiry token fails closed.

## Transport boundary and rollback

The dedicated client permits only its declared GET endpoints and `POST /contacts/search`. It rejects every other POST and all PUT, PATCH, and DELETE requests before dispatch.

Rollback is removal of the preview route, service, types, field policy, read client, exact-count repository helper, tests, and this document. There is no migration, stored preview state, or production data to reverse.
