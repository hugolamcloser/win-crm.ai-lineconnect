# Phase 2G-D — staged HighLevel company ownership and D3 lifecycle contract

Issue: [#100](https://github.com/hugolamcloser/win-crm.ai-lineconnect/issues/100).

This D1 slice adds the database and runtime ownership boundary needed for a later Ah Lam-only HighLevel sandbox proof. It does not apply a production migration, configure Railway or HighLevel, install the Marketplace app, authorize OAuth, activate a Conversation Provider or Delivery URL, call EVERY8D, access SMS operations or controlled-live authorization, or send SMS.

## Callback and D2 configuration correction

The implemented runtime route remains:

`/oauth/every8d-connect/callback`

The exact future HighLevel redirect must therefore be:

`https://win-crm.up.railway.app/oauth/every8d-connect/callback`

Earlier Marketplace evidence used the stale `https://win-crm.up.railway.app/oauth/every8d/callback`. D1 does not change HighLevel and does not add a compatibility alias. Correcting the Marketplace setting and the runtime environment is a D2 action requiring separate approval before D4.

## Staged additive schema

Migration `202609220001_ghl_marketplace_company_ownership.sql` adds nullable `company_id` to `ghl_marketplace_installations`. Nullable is intentional: production row count and provenance have not been inspected, and D1 must not invent ownership for a pre-existing row. Runtime OAuth eligibility nevertheless requires a non-empty company, so a NULL row is representable but unusable for real EVERY8D OAuth.

Once set, company ownership is protected by the v2 installation trigger and cannot change or return to NULL. It is not globally unique because one HighLevel company may own multiple Locations. Existing app/location uniqueness and tenant/location foreign-key ownership remain unchanged.

Direct `service_role` INSERT and arbitrary table UPDATE are removed from the installation table. The role retains SELECT and only the mutable status/generation/encrypted-credential columns needed by the dedicated runtime. Browser roles retain no table or provisioning-function access.

## Atomic provisioning primitive

The server-only `provision_every8d_ghl_marketplace_installation_v1` database function is the sole service-role transition that may insert a company-bound row or bind a legacy NULL row. It accepts the exact configured app/client/provider identities plus tenant, signed Location, and signed company. It:

- verifies exact tenant/location ownership;
- inserts one pending EVERY8D/SMS installation when absent;
- converges concurrent duplicate calls on the existing app/location row;
- treats duplicate evidence for pending/active ownership as idempotent;
- rejects different client, tenant, company, provider, channel, or namespace ownership;
- permits the same company at different exact Locations; and
- reactivates disabled/uninstalled ownership as pending with exactly one generation increment.

The D3 lifecycle service calls this narrow RPC only after Ed25519 verification and exact signed INSTALL validation. The expected `versionId` is derived from the already reviewed and SHA-256-pinned Location installation URL, so no new production configuration name or latest-version fallback is introduced. No in-memory lock is used as an ownership guarantee.

## OAuth and encryption binding

OAuth installation eligibility now requires non-empty immutable `company_id`. The Location token response must contain `companyId` exactly equal to the installation company before credential persistence. Missing or different company identity fails after one-time state consumption and before persistence. The credential update predicate includes company ownership.

AES-256-GCM authenticated data now also binds `companyId`. The envelope version advances from 1 to 2 to make the AAD contract change explicit. A version-1 ciphertext cannot be treated as company-bound. This is intentionally fail-closed: Phase 2G-C remained default-off and no real EVERY8D OAuth ciphertext is expected, but D1 does not assume production row contents or rewrite any data. A pre-D1 row stays NULL-company/ineligible until authoritative signed ownership is separately approved and bound; any old ciphertext remains unusable under the v2 company-bound context.

## Uninstall and reinstall

UNINSTALL does not trust or require `companyId`, `installType`, `appNamespace`, or an installation identifier from the event. It finds exactly one row by the internal `every8d_connect` namespace and exact configured app/client/provider plus signed Location, requires a non-NULL immutable stored company owner, and uses that stored company in the compare-and-swap update. Zero or ambiguous rows fail closed. Successful uninstall preserves the row, marks it uninstalled, and increments generation once; duplicate delivery returns the same terminal generation. Database state rules continue to reject old state consumption, and v2 ciphertext binds the old generation and stored company.

## Rollback

The D1 rollback locks the installation table and refuses to discard any non-NULL company evidence. With only legacy NULL rows, it removes the provisioning function and v2 trigger/function, restores the v1 trigger and prior service-role grants, drops only `company_id`, and preserves the rows. Unexpected dependencies abort the whole rollback. The Phase 2G-A rollback remains separate.

No forward or rollback SQL in this slice is authorized for production.

## D3 controlled HighLevel evidence and implemented contract

The controlled Location evidence from 2026-09-22 established:

- INSTALL contained exact app/version identity, `installType: "Location"`, Location, company, user/company display metadata, timestamp, and `webhookId`.
- UNINSTALL contained only type, app/version identity, Location, timestamp, and `webhookId`; it did not contain company or install type.
- Neither event contained `appNamespace` or a stable `installationId`/`installId`/`id`. `every8d_connect` is therefore only an internal namespace.
- HighLevel retried both event types after the default-off endpoint returned `503 lifecycle_disabled`. Retries preserved each event's `webhookId`, while INSTALL and UNINSTALL used different values.
- HighLevel committed installation/removal despite those 503 responses, and Marketplace installation did not select the SMS Conversation Provider.
- OAuth remained disabled, no provider was selected, no EVERY8D call occurred, and no SMS was sent.

Accordingly, `webhookId` is accepted only as event/delivery metadata and is never passed to provisioning, lookup, or update persistence. Existing atomic row identity and generation semantics already make identical or changed-`webhookId` retries converge, so D3 adds no event table or schema migration.

INSTALL is eligible only for exact type, configured app, pinned version, `Location` install type, valid Location/company identifiers, no bulk/future-location flags, one exact existing tenant/location, and separate provider ownership. The signed company becomes immutable stored ownership through the existing RPC. No global/default/latest fallback exists.

## Observed code-only OAuth callback

After Allow & Install, the controlled Marketplace path redirected to `/oauth/every8d-connect/callback` with an authorization code but no `state`. The code value was not retained. This direct Marketplace flow therefore did not preserve the runtime's custom state/browser binding in the observed case.

The callback contract is intentionally unchanged: missing `state` returns `400 oauth_request_invalid` before runtime callback activity or token exchange. A separate controlled OAuth-initiation design is required before any code may be exchanged. Installation success remains distinct from OAuth authorization and Conversation Provider activation.

## Isolation

The Phase 2G-D modules do not use LINE onboarding or `ghl_oauth_tokens`, do not create tenants, do not import SMS operation/authorization services, and do not call an EVERY8D transport. PostgreSQL proofs fingerprint the protected tenant, LINE token, SMS operation, and armed-authorization fixtures before and after migration/rollback exercises. Provider activation is not part of lifecycle provisioning.
