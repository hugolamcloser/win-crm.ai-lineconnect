# Phase 2G-D D1 — staged HighLevel company ownership

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

The application repository exposes this narrow RPC, but the lifecycle service does not call it in D1. Automatic INSTALL provisioning remains blocked because public HighLevel examples do not reliably establish `appNamespace`, `installType`, `versionId`, `webhookId`, a stable installation ID, or event ordering. This avoids encoding an unproven signed-payload contract. No in-memory lock is used as an ownership guarantee.

## OAuth and encryption binding

OAuth installation eligibility now requires non-empty immutable `company_id`. The Location token response must contain `companyId` exactly equal to the installation company before credential persistence. Missing or different company identity fails after one-time state consumption and before persistence. The credential update predicate includes company ownership.

AES-256-GCM authenticated data now also binds `companyId`. The envelope version advances from 1 to 2 to make the AAD contract change explicit. A version-1 ciphertext cannot be treated as company-bound. This is intentionally fail-closed: Phase 2G-C remained default-off and no real EVERY8D OAuth ciphertext is expected, but D1 does not assume production row contents or rewrite any data. A pre-D1 row stays NULL-company/ineligible until authoritative signed ownership is separately approved and bound; any old ciphertext remains unusable under the v2 company-bound context.

## Uninstall and reinstall

UNINSTALL now requires signed company evidence and exact app/client/location/company/provider lookup. A company mismatch cannot invalidate a row. Successful uninstall still preserves the row, marks it uninstalled, and increments generation. Database state rules continue to reject old state consumption; v2 ciphertext also binds the old generation and company. Automatic reinstall provisioning remains behind the D3 contract gate, while the database primitive already proves the approved transition semantics.

## Rollback

The D1 rollback locks the installation table and refuses to discard any non-NULL company evidence. With only legacy NULL rows, it removes the provisioning function and v2 trigger/function, restores the v1 trigger and prior service-role grants, drops only `company_id`, and preserves the rows. Unexpected dependencies abort the whole rollback. The Phase 2G-A rollback remains separate.

No forward or rollback SQL in this slice is authorized for production.

## Required D3 evidence before enabling INSTALL provisioning

Capture one Ed25519-verified Ah Lam payload and establish, without guessing:

- exact INSTALL and UNINSTALL field names, types, and presence;
- whether `appNamespace` and `installType=Location` are actually signed;
- exact app ID, Location ID, and non-empty company ID;
- whether `versionId`, `timestamp`, or `webhookId` exists and its safe semantics;
- whether any stable HighLevel installation identifier exists;
- duplicate delivery and reinstall payload behavior;
- lifecycle webhook versus browser callback ordering;
- whether install-link `state` survives unchanged; and
- whether app installation can be separated from OAuth consent/authorization.

Until reviewed evidence supports a precise parser, INSTALL returns `provisioning_blocked` after signature/config/tenant validation and writes no installation.

## Isolation

The D1 modules do not use LINE onboarding or `ghl_oauth_tokens`, do not create tenants, do not import SMS operation/authorization services, and do not call an EVERY8D transport. PostgreSQL proofs fingerprint the protected tenant, LINE token, SMS operation, and armed-authorization fixtures before and after migration/rollback exercises.
