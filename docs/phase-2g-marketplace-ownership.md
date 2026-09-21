# Phase 2G-A — Marketplace schema and ownership foundation

Issue: [#95](https://github.com/hugolamcloser/win-crm.ai-lineconnect/issues/95).
This slice adds database definitions and disposable database proofs only. Applying the migration to production, OAuth implementation, provider dispatch, configuration changes, and activation require separate review and authorization.

## Architecture and isolation

Keep the existing repository, Railway service, and Supabase project. EVERY8D Connect has its own HighLevel Marketplace app and OAuth client identity. Nothing in this change creates infrastructure, routes, credentials, installations, or send permission.

The legacy LINE store remains `ghl_oauth_tokens`, unique by location. `upsertGhlOAuthToken()` and `getGhlOAuthToken()` in `src/services/repository.ts` remain LINE-only. The new tables have no relationship to that token table and no trigger or function reads or writes its credentials. EVERY8D must never call these legacy helpers or `ensureTenantForLocation()`, which can create a LINE-configured tenant.

| Boundary | Phase 2G-A behavior |
| --- | --- |
| Existing tenants | Add only `tenants_marketplace_id_location_key`, a unique `(id, location_id)` constraint; existing UUID primary key already guarantees uniqueness. No row updates or backfill. |
| LINE provider | New installation trigger rejects the exact bound tenant's `ghl_provider_id`. No change to that column, `GHL_CUSTOM_PROVIDER_ID`, or LINE credentials. |
| LINE runtime | No source, route, reconciliation, contact-matching, workflow, attachment, mirroring, or startup changes. |
| SMS runtime | No change to outbound operation identities, idempotency, authorization tables/RPCs, or send gates. |
| New ownership | Exact preexisting tenant/location composite FK; immutable app/client/tenant/location/provider tuple. No global/latest fallback. |
| Lifecycle | Installation status, including `active`, never authorizes a send. |

The provider guard is intentionally narrow: it checks the bound tenant's LINE provider when an installation is inserted or updated. It is not a registry of all LINE provider IDs, an external HighLevel app-identity verifier, or a trigger on existing tenant updates. Future provisioning must validate app/client/provider ownership against the separately configured EVERY8D identity, forbid every known LINE identity, and fail on ambiguity. Any future change to a bound tenant's LINE provider must also be separately reviewed for collision. No such change is made here.

## Installation schema

`supabase/migrations/202609170001_ghl_marketplace_ownership.sql` creates `ghl_marketplace_installations`:

| Fields | Enforcement |
| --- | --- |
| `id` | Generated UUID primary key. |
| `app_namespace`, `channel`, `provider` | Fixed to `every8d_connect`, `sms`, `every8d`. This table does not migrate LINE installations. |
| `marketplace_app_id`, `oauth_client_id`, `conversation_provider_id` | Separate required identifiers, bounded nonempty ASCII identifier strings. They represent distinct concepts, not interchangeable keys. |
| `tenant_id`, `location_id` | Composite FK to exact existing tenant/location; update/delete restricted. No tenant creation. |
| App/location | Unique `(marketplace_app_id, location_id)` even across different tenant candidates. |
| Ownership context and `created_at` | Immutable after creation, including primary key; changes need a separately reviewed preservation procedure. |
| `status` | `pending` default; also `active`, `disabled`, `uninstalled`. These describe installation lifecycle only. |
| `installation_generation` | Positive integer, default 1; updates may keep it or increment by exactly one. Reactivation from `disabled`/`uninstalled` to `pending`/`active` requires the increment, preventing revival of old states. A future reinstall must increment it atomically. |
| Future credential columns | Nullable `bytea` access/refresh ciphertext pair, `encryption_key_version`, `token_expires_at`, `granted_scopes`. Either all credential metadata is absent with empty scopes, or both nonempty ciphertext values and key/expiry metadata are present. |
| Timestamps | Created/updated timestamps; reuse the existing `set_updated_at()` trigger function without modifying it. |

No plaintext-token or OAuth client-secret column is introduced. The SQL type cannot prove that bytes were encrypted correctly: encryption, authenticated context binding, key management, expiry refresh, rotation, and stale-refresh concurrency control remain future application work. Test bytes are deliberately synthetic and are not presented as encryption validation. Credential lookup must always use the exact installation identity and verify its ownership tuple; location-only lookup is prohibited.

The composite FK also prevents changing/deleting a referenced tenant's identity/location. That restriction applies only once an installation exists. The supporting constraint needs a short table lock/index build at migration time; a five-second lock timeout fails safely if the lock cannot be acquired. No production migration is authorized here.

## OAuth-state schema and limits

`ghl_marketplace_oauth_states` stores UUID identity, an installation FK, its generation snapshot, unique lowercase SHA-256 `state_hash`, `browser_binding_hash`, exact intended `redirect_uri`, and creation/expiry/consumption/revocation timestamps. Ownership is inherited from the installation rather than copied into another editable tuple.

- State context cannot change. Consumed/revoked evidence cannot reset, switch terminal states, or be rewritten.
- Insertions must start unused against an eligible `pending`/`active` installation and current generation.
- Expiry must follow creation by at most 15 minutes. New states cannot already be expired or future-created.
- HTTPS URI validation is structural only. Future runtime must compare the complete URI to the configured allowlisted callback URI; this SQL check is not URL parsing or an OAuth redirect allowlist.
- First consumption checks live expiry, current generation, and eligible installation status. Its timestamp comes from the database clock, preventing backdated consumption of an expired state.
- A shared installation row lock serializes validation with generation/status updates. Conditional consumption with unused-state predicates returns one winner under contention. A reinstall committed first invalidates the old generation.
- `service_role` cannot delete or truncate state evidence. An administrator/database owner remains trusted.

The future callback must validate the random state's hash, browser binding, exact redirect URI, installation/app ownership, generation, eligibility, and one-time consumption atomically. This slice does not implement an authorization-code exchange, state generation, cookies, CSRF protection end-to-end, or token refresh. Complete OAuth security is still blocked on that later implementation and its tests.

## RLS and server access

Both tables enable RLS. `PUBLIC`, `anon`, and `authenticated` have no table privileges or policies. `service_role` receives only SELECT, INSERT, UPDATE with policies for those operations; it receives no DELETE, TRUNCATE, REFERENCES, or TRIGGER privilege. CI tests a non-BYPASSRLS service role so the policies are exercised, as well as ordinary roles denied by both grants and RLS.

Two narrow SECURITY DEFINER trigger functions enforce ownership and state eligibility without granting service access to legacy tenant/token tables. Their `search_path` is fixed to `pg_catalog, public`, relations are qualified, and direct execution is revoked from public/browser/service roles. They contain no dynamic SQL or credential output. Their deployment owner must remain a trusted migration administrator. Existing function/table privileges are not changed.

RLS is a browser/server boundary, not protection from a compromised service-role backend or database owner. Later server APIs must enforce installation-specific access. Migration deployment must use error logging that suppresses SQL row DETAIL and must never log credential-bearing statements; the proof uses terse errors and synthetic fixtures only.

## Provider attribution decision: dispatch remains blocked

Configured installation ownership and ownership of a particular outgoing message are separate requirements. A valid signature and an EVERY8D URL do not prove that a message belongs to EVERY8D.

HighLevel's current v3 [provider callback documentation](https://marketplace.gohighlevel.com/docs/webhook/ProviderOutboundMessage/) specifies Ed25519 `X-GHL-Signature` over the original JSON bytes. The Delivery URL does not receive the legacy RSA header. The documented SMS payload contains message/location/contact and content fields but no Marketplace app ID or conversation-provider ID. This establishes the attribution gap; namespacing cannot close it. Reviewed 2026-09-21.

The future dispatch gate must:

1. Verify the original request bytes before parsing/processing.
2. Resolve exactly one eligible EVERY8D installation for the signed location, with no LINE or global fallback.
3. Fetch the referenced HighLevel message using only that installation's OAuth token.
4. Require exact message/location/contact/provider identity, outbound SMS type/direction, destination and content agreement. Missing or inconsistent evidence fails closed before an operation claim or authorization consumption.

The official [GET message response](https://marketplace.gohighlevel.com/docs/ghl/conversations/get-message/) lists `conversationProviderId`, `body`, and `to`, but they are optional. Their availability in the intended default-SMS provider flow remains unproven. The official [scope matrix](https://marketplace.gohighlevel.com/docs/Authorization/Scopes/) maps message writes but does not explicitly map this GET-by-ID endpoint. Do not infer that `conversations/message.readonly` is either sufficient or required, and do not request extra scopes speculatively. Reviewed 2026-09-21.

**External contract gate:** obtain authoritative scope mapping and provider-field availability for the chosen provider mode before implementing live dispatch. If adequate evidence is unavailable, dispatch stays blocked pending another documented and reviewed attribution mechanism. This schema is not evidence that the contract gate has been resolved. No provider-mode selection, HighLevel settings, scope changes, Delivery URL registration, or activation occurs in Phase 2G-A.

## Migration and rollback

Forward migration is a single transaction with no seeds/backfill. Reapplication or a partial/conflicting schema clearly fails on duplicate objects/constraints rather than silently accepting drift. Use the migration ledger and inspect definitions before resolving such failures; do not ignore them. Tests inject a collision after earlier DDL to prove the whole transaction rolls back.

Before application, revert this isolated PR. After application, the separately reviewed rollback file is `supabase/rollback/202609170001_ghl_marketplace_ownership.sql`, outside forward migration discovery. It locks both tables before checking emptiness, preventing an insert between the check and removal. If either table has data it raises an error and preserves everything. If empty, it drops only new tables, their functions, and the supporting tenant constraint in dependency order. It never uses CASCADE. Unexpected dependencies abort the entire transaction, including earlier drops.

If data exists, leave the additive schema in place pending a reviewed data-preservation/removal plan. Do not delete records to make production rollback pass. Test cleanup deletes only specifically identified synthetic rows in `wincrm_test` as the disposable database owner. No production forward or rollback command was run.

## Validation and remaining work

CI applies the complete migration chain to PostgreSQL 17, retains both existing SMS concurrency proofs, then runs `bash test/postgres/ghlMarketplaceOwnership.sh`. The new runner executes the SQL assertions, consumption/reinstall races, populated rollback refusals, empty rollback, dependency failure, migration reapplication refusal, late DDL failure, and reapplication after clean rollback. Before/after fingerprints confirm protected LINE/SMS data is unchanged.

Run `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check` as well. Local evidence and environment details are recorded in `agent-run-phase-2g-a.md`.

Still blocked: production migrations/deployment, creation of real installation/state rows, encryption/key provisioning, OAuth routes/refresh/reinstall orchestration, provider routes and attribution contract, scope finalization, provider activation, inbound/status work, and any EVERY8D request or SMS. The currently armed authorization is outside this task and remains untouched.
