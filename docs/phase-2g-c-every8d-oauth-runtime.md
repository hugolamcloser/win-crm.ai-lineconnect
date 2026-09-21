# Phase 2G-C — EVERY8D Connect HighLevel OAuth runtime foundation

Issue: [#98](https://github.com/hugolamcloser/win-crm.ai-lineconnect/issues/98).

This slice adds a default-off HighLevel Marketplace OAuth foundation for the separate EVERY8D Connect app. It does not enable HighLevel External Authentication, authenticate to EVERY8D, activate a Conversation Provider, configure a Delivery URL, call EVERY8D, create an SMS operation, consume SMS authorization, or send SMS.

## Runtime boundary

The implementation is Location/Sub-account only. Authorization-code responses must identify `userType=Location`, the exact installation location, the configured app when an app ID is present, and the exact configured scope set. Company tokens, agency flows, bulk installs, future-location installs, approve-all-locations responses, multiple/foreign approved locations, and ambiguous ownership fail closed.

The dedicated routes are:

- `POST /oauth/every8d-connect/initiate`: protected by the existing server shared-secret middleware. The caller supplies an exact installation, tenant, and location tuple; the database row must match the dedicated app, client, provider, namespace, channel, status, and generation.
- `GET /oauth/every8d-connect/callback`: requires authorization code, state, and the narrow browser-binding cookie. It returns only generic no-store JSON.
- `POST /webhooks/ghl/every8d-connect/lifecycle`: accepts only current `X-GHL-Signature` Ed25519 verification over the exact raw body. It does not accept legacy `X-WH-Signature` as authority.

The existing `/oauth/callback`, legacy AppInstall route, LINE custom page, LINE token store, and LINE OAuth service are unchanged.

## Dedicated configuration and default-off behavior

`EVERY8D_GHL_OAUTH_ENABLED` defaults to false. When disabled, initiation fails before database, randomness, or network activity. When enabled, every dedicated setting must be complete and valid:

- `EVERY8D_GHL_MARKETPLACE_APP_ID`
- `EVERY8D_GHL_OAUTH_CLIENT_ID`
- `EVERY8D_GHL_OAUTH_CLIENT_SECRET`
- `EVERY8D_GHL_OAUTH_REDIRECT_URI`
- `EVERY8D_GHL_OAUTH_INSTALLATION_URL`
- `EVERY8D_GHL_OAUTH_INSTALLATION_URL_SHA256`
- `EVERY8D_GHL_OAUTH_TOKEN_URL` (defaults to the official token endpoint)
- `EVERY8D_GHL_CONVERSATION_PROVIDER_ID`
- `EVERY8D_GHL_OAUTH_REQUIRED_SCOPES`
- `EVERY8D_GHL_OAUTH_ACTIVE_KEY_VERSION`
- `EVERY8D_GHL_OAUTH_ENCRYPTION_KEYS`

No existing `GHL_OAUTH_*`, `GHL_MARKETPLACE_APP_ID`, or `GHL_CUSTOM_PROVIDER_ID` value is read or reinterpreted. The scope list has no built-in product scope: an operator must provide the exact separately reviewed Marketplace scope set, and the callback requires exact set equality rather than adding a speculative scope.

No production values or keys are included in the repository. `EVERY8D_GHL_OAUTH_ENCRYPTION_KEYS` is a JSON object from explicit key version to a base64-encoded 32-byte key. The active version must exist in that collection.

The reviewed HighLevel-generated Location install link establishes the exact structural boundary `https://app.gohighlevel.com/v2/location/{locationId}/integration/{integrationId}/versions/{versionId}` with no query or fragment. The runtime requires that exact origin and path shape plus a lowercase SHA-256 approval pin for the entire manually reviewed URL. It rejects host, location, integration, version, path, query, fragment, credentials, port, or digest drift. The link does not expose OAuth client, redirect, or scope identities, so the runtime does not invent those fields or infer them from the URL. The actual EVERY8D Connect link and digest remain runtime-only configuration and are not committed.

## State and browser binding

Initiation generates independent 32-byte random values for OAuth state and browser binding. Only lowercase SHA-256 hashes are written to `ghl_marketplace_oauth_states`. The raw browser binding is stored in an `HttpOnly`, `SameSite=Lax`, short-lived cookie limited to `/oauth/every8d-connect`; production cookies are `Secure`. Request logging already redacts state/code queries and cookie/header values.

The callback verifies the state hash, browser-binding hash with timing-safe comparison, exact installation and generation, eligible installation status, exact configured redirect URI, expiry, and unused/unrevoked evidence before exchange. State is consumed before the network request, so a failed exchange cannot be replayed.

The repository consumes through one conditional PostgreSQL update with exact state/install/generation/binding/redirect filters and `consumed_at IS NULL AND revoked_at IS NULL`, returning the winner. The existing Phase 2G-A PostgreSQL 17 concurrency proof runs two real connections against this same conditional-update/trigger boundary and proves one winner plus generation/reinstall serialization. Phase 2G-C also proves one exchange and one persistence call under concurrent duplicate callbacks.

No migration was required.

## Token exchange and persistence

The exchange uses only the dedicated EVERY8D Connect HighLevel OAuth client, `user_type=Location`, the exact configured HTTPS redirect, the pinned `https://services.leadconnectorhq.com/oauth/token` endpoint, disabled HTTP redirect following, a 15-second timeout, and a 64 KiB streamed response limit. Provider error bodies, authorization codes, secrets, states, cookies, and token values are never returned or logged.

Access and refresh tokens are separately encrypted with AES-256-GCM using independent random 96-bit IVs and 128-bit authentication tags. The versioned envelope contains the format version, key version, IV, ciphertext, and tag. Authenticated additional data binds each ciphertext to:

- installation ID;
- installation generation;
- Marketplace app ID;
- OAuth client ID;
- tenant ID;
- location ID; and
- token purpose (`access_token` or `refresh_token`).

Wrong key, version, AAD, tag, ciphertext, or installation generation fails closed. Only encrypted envelope bytes, key version, expiry, and normalized scopes are written to the exact `ghl_marketplace_installations` row after a second ownership/generation/status check. Returned `timestamptz` values are parsed as instants and compared by exact epoch milliseconds, so equivalent PostgreSQL `Z`/`+00:00` forms succeed while malformed or different instants fail closed. The implementation never reads or writes `ghl_oauth_tokens` and never performs a location-only credential lookup.

## Signed lifecycle evidence and provisioning blocker

The namespaced lifecycle route validates exact raw-body Ed25519 signature, app ID, event type, Location mode, location, namespace, and rejection flags before any mutation. It resolves exactly one already-existing tenant and never calls `ensureTenantForLocation()` or creates a tenant.

The first slice requires explicit `appNamespace=every8d_connect` and `installType=Location` for both supported lifecycle events; missing or different values fail closed. Current public HighLevel INSTALL/UNINSTALL examples are inconsistent about including those fields, so lifecycle activation also remains blocked until signed sandbox payloads from the actual EVERY8D Connect app confirm the exact contract. The code does not infer a default or accept a looser variant.

Automatic INSTALL provisioning intentionally stops after validation. Current signed Location INSTALL evidence includes `companyId`, but `ghl_marketplace_installations` has no immutable company ownership column. Discarding that evidence would prevent the callback from comparing an available token-response company to the signed installation owner. Reusing `ghl_pending_app_installs` or other LINE onboarding storage is forbidden. The route therefore returns a sanitized `provisioning_blocked` result and creates no installation.

A later reviewed additive schema decision should bind `company_id` to the installation (with immutability, reinstall behavior, tests, and rollback) before automatic provisioning is enabled. The OAuth service in this PR operates only on an already trusted, exact installation row.

Exact signed Location UNINSTALL can mark an existing exact app/client/location/provider installation `uninstalled` and increment generation. It preserves encrypted bytes and audit evidence; the status/generation change makes old states and old-generation AAD ineligible. It does not call HighLevel or uninstall the app remotely.

## Refresh-token status

Refresh is deferred. The current schema has no monotonic credential revision or database refresh lease, so a refresh started from stale ciphertext could overwrite a newer callback/refresh result across Railway processes. Process-local locks are insufficient.

The smallest later database primitive is an additive monotonic credential revision (or an equivalent database-owned compare-and-swap RPC) updated atomically with ciphertext. Refresh persistence must require the exact prior revision plus installation identity/generation/status. This decision needs a separate reviewed migration and PostgreSQL race proof.

## LINE and SMS isolation

The new modules do not import or call `upsertGhlOAuthToken()`, `getGhlOAuthToken()`, `ensureTenantForLocation()`, legacy onboarding/pending-install helpers, SMS operation functions, authorization consumption, or EVERY8D transports. They do not refer to `GHL_CUSTOM_PROVIDER_ID` or change LINE routing, reconciliation, profiles, workflow delivery, inbox behavior, or `/oauth/callback`.

OAuth success only stores encrypted HighLevel credentials. It has no path to provider selection, Delivery URL configuration, SMS operation creation, the armed Phase 2F authorization, EVERY8D UID/password, network send, or SMS delivery.

## Remaining activation and dispatch blockers

- Confirm in a HighLevel sandbox that the generated Marketplace installation URL preserves and returns the appended OAuth `state`; current Marketplace documentation describes the installation URL and code callback but does not explicitly document state pass-through.
- Confirm that signed EVERY8D Connect INSTALL and UNINSTALL payloads include the required exact `appNamespace` and Location `installType`; public examples are inconsistent, and missing evidence remains rejected.
- Add and approve immutable signed `companyId` ownership before automatic INSTALL provisioning.
- Resolve the GET-message minimum scope and reliable `conversationProviderId`/message attribution contract before any provider dispatch work.
- Add database-authoritative refresh compare-and-swap before refresh runtime.
- Configure and activate nothing until a separate production task approves exact environment values, Marketplace settings, and rollout.

Official HighLevel references reviewed on 2026-09-21:

- [OAuth 2.0 Marketplace flow](https://marketplace.gohighlevel.com/docs/Authorization/OAuth2.0/)
- [Get Access Token](https://marketplace.gohighlevel.com/docs/ghl/oauth/get-access-token/)
- [Marketplace distribution model](https://marketplace.gohighlevel.com/docs/oauth/AppDistribution/)
- [AppInstall webhook](https://marketplace.gohighlevel.com/docs/webhook/AppInstall/)
- [AppUninstall webhook](https://marketplace.gohighlevel.com/docs/webhook/AppUninstall/index.html)
- [Webhook signature guide](https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/)

## Rollback

Keep `EVERY8D_GHL_OAUTH_ENABLED=false` to disable the entire new runtime. Reverting this isolated PR removes the routes and runtime without changing the installed Phase 2G-A schema or existing data. Do not drop or truncate Marketplace tables, delete installation/state evidence, alter LINE OAuth records, or change production configuration as part of rollback.
