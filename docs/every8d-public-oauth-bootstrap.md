# EVERY8D public OAuth bootstrap and INSTALL/callback rendezvous

## Scope and default-off boundary

This post-D3 foundation adds a public first-install OAuth bootstrap without enabling OAuth, installing the Marketplace app, activating the Conversation Provider, calling HighLevel or EVERY8D, or authorizing SMS. `EVERY8D_GHL_OAUTH_ENABLED=false` remains the first runtime gate. While disabled, the new path creates no rows, generates no random state or binding, sets no cookie, redirects nowhere, starts no reconciler timer, scans no attempts, exchanges no code, and persists no credentials.

The existing shared-secret `POST /oauth/every8d-connect/initiate` route remains available for an already installed, exact signed installation. The new `POST /oauth/every8d-connect/start` route is the public first-install path and accepts only a genuinely empty POST with no query keys or body bytes.

## Human browser launcher

`GET /oauth/every8d-connect/launch` and `POST /oauth/every8d-connect/launch` are a narrow human-browser adapter around the unchanged public `/start` runtime operation. They let the operator begin from the same browser profile in which HighLevel is authenticated without weakening or expanding the `/start` contract.

The launcher GET has zero OAuth side effects. It never calls the OAuth start operation, generates state or a browser binding, uses randomness, writes a bootstrap row, sets the binding cookie, redirects, triggers the reconciler, or calls an external service. When OAuth is disabled it returns a static HTTP 503 unavailable page with no form, button, JavaScript, or external asset. When enabled it returns one input-free native POST form. The enabled page alone uses `Referrer-Policy: same-origin`, which permits Chromium to supply the exact same-origin `Origin` value on the form navigation. Both pages remain non-cacheable, deny framing, and use a restrictive CSP; the enabled page additionally pins `form-action 'self'`.

The launcher POST checks the default-off runtime gate before all request validation. An enabled request is accepted only when all of these conditions hold:

- there is no query delimiter or query input;
- `Origin` is exactly `https://win-crm.up.railway.app`, without deriving trust from `Host`, forwarded headers, or environment input;
- Fetch Metadata is exactly `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: navigate`, and `Sec-Fetch-Dest: document`;
- `Content-Type` is exactly `application/x-www-form-urlencoded`, with no parameter; and
- the native form body contains exactly zero bytes. A present `Content-Length` must be the canonical value `0`, but the route also verifies the actual request stream and rejects non-empty chunked bodies.

An accepted POST calls the existing start operation once, reuses the narrow `wincrm_every8d_oauth_binding` cookie (`Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/oauth/every8d-connect`, with no `Domain`), and returns an HTTP 200 continuation page. This committed 200 response ends the native form navigation before any cross-origin navigation: Chromium applies CSP `form-action` across a form-submission redirect chain, so the launcher does not redirect directly to HighLevel. The initial GET keeps `form-action 'self'`; the success page instead uses `form-action 'none'`, `Referrer-Policy: no-referrer`, and one ordinary same-tab hyperlink with `rel="noreferrer"`. There is no automatic redirect, JavaScript, or meta refresh.

The hyperlink `href` comes only from `runtime.start().authorizationUrl`. It is HTML-attribute escaped for `&`, double and single quotes, `<`, and `>` without parsing or changing the authorization URL. No request input can influence the destination, and the route accepts no tenant, company, application, provider, installation, redirect, state, or binding input.

There is intentionally no launcher nonce or durable launcher admission state. Each accepted click creates a fresh independent OAuth start, and no durable database resource exists before callback acceptance. A later launcher POST overwrites the same narrow browser cookie, so an earlier tab's callback will fail browser-binding validation while the latest flow remains usable.

The operator workflow is therefore: authenticate to HighLevel in the intended browser profile, open the launcher in that same profile, submit its single form, and explicitly select **Continue to HighLevel** on the continuation page. The ten-minute state TTL starts when the form POST calls the runtime. The user must continue in the same browser/profile: copying the authorization link to another browser does not copy the host-only binding cookie, so callback binding validation fails there. The existing `SameSite=Lax` behavior still permits the binding cookie on HighLevel's top-level callback navigation. OAuth remains default-off. Before any rollout, the external HighLevel application/version, redirect, lifecycle, installation, ownership, and provider checks described below still require their separately approved verification; the launcher does not enable OAuth, install the Marketplace app, or activate the Conversation Provider.

## Stateless public start

The public bootstrap is deliberately ownership-free. It never accepts or stores a browser-supplied tenant, location, company, installation ID, lifecycle generation, state, browser binding, installation URL, or redirect URI. HighLevel authentication plus explicit Location installation consent is the human authorization boundary. Authoritative company/location ownership enters only through the verified Ed25519-signed INSTALL lifecycle event and exact tenant resolution.

The server generates independent 32-byte nonce and browser-binding values. `/start` performs no database write. It returns canonical versioned state authenticated with HMAC-SHA-256 using a key derived from the active OAuth encryption key by HKDF-SHA-256 under `wincrm/every8d/oauth-state-auth/v1`. The state binds the key version, nonce, namespace, Marketplace version, redirect URI, configuration fingerprint, server-derived expected Location, browser-binding hash, issue time, and expiry.

The expected Location is parsed only from the validated SHA-pinned exact Location installation URL. It is never accepted from the browser or callback. Abandoned starts consume no durable admission capacity; traffic rate limiting remains an operational enhancement rather than a correctness boundary.

## Owner-managed Marketplace version

`ghl_marketplace_app_registrations` remains unchanged and immutable. The migration adds a separate `ghl_marketplace_app_version_registrations` table. It is owner-managed, has RLS enabled, grants no browser or `service_role` table access, and rejects update/delete after insertion. The migration inserts no version value.

Before rollout, a database owner must separately register the exact approved signed Marketplace version after the migration preflight. `service_role` cannot invent, change, or read that identity. Lifecycle, callback acceptance, exchange claim, and finalization compare the exact signed/configured version to the owner registration.

## Durable rendezvous

`ghl_marketplace_oauth_bootstraps` uses these one-way states:

- `waiting_install`
- `ready`
- `exchanging`
- `succeeded`
- `failed`

Durable evidence begins only after local authenticated-state, browser-binding, expiry, configuration, redirect, and expected-Location validation. One atomic RPC derives the target generation from current lifecycle state and inserts either `waiting_install` or `ready`. Callback acceptance and lifecycle INSTALL/UNINSTALL take the identical transaction-scoped advisory lock `pg_advisory_xact_lock(hashtextextended('ghl_marketplace_location_v1:' || registration.app_namespace || ':' || exact_location_id, 0))` before installation or attempt mutation. Callback-first therefore commits `waiting_install` before INSTALL can rendezvous it; INSTALL-first commits generation one before callback can insert directly as `ready`. The PostgreSQL 17 suite holds each winning transaction open on a controlled barrier, observes the other connection blocked on the advisory lock through `pg_stat_activity`, then proves the final generation-one attempt is `ready` in both orders.

The global lock order is: scalar validation; immutable registration/version and required tenant ownership reads; Location advisory lock for lifecycle/callback; installation row lock or creation; OAuth attempt row lock; credential/attempt writes. Exchange claim and finalization use installation row then attempt row. Failure and recovery cleanup use the attempt row only and never request an installation or Location lock. INSTALL rendezvous waits for the exact candidate and does not use `SKIP LOCKED`.

A partial uniqueness rule allows one progressing candidate per namespace, expected Location, and generation. A newer callback may atomically supersede only a `waiting_install` or `ready` candidate and scrubs its code. A generation is burned by `exchanging`, `succeeded`, failed `exchange_outcome_unknown`, or failed `credential_persistence_failed`; callback admission and exchange claim both enforce that durable evidence transactionally. A deterministic failure does not resurrect its attempt or code, but a fresh authenticated state/code may be admitted in the same installation generation.

The lifecycle RPC returns `applied`, `exact_replay`, or `stale_ignored`. Only `applied` may rendezvous or invalidate attempts. Exact replay cannot duplicate those side effects, stale events mutate nothing, and equal-time conflicting evidence remains rejected.

## Callback and authorization-code encryption

Callback acceptance verifies the exact authenticated state and independent browser binding locally before encryption or any database write. The database then enforces unique state-hash replay identity, approved registration/version, pinned expected Location, deterministic target generation, and one progressing candidate.

The authorization code uses a dedicated AES-256-GCM envelope with purpose `pending_authorization_code`, separate from access/refresh token encryption. Its authenticated additional data binds:

- envelope/domain version;
- purpose;
- `every8d_connect` namespace;
- state hash;
- Marketplace version;
- redirect URI; and
- immutable configuration fingerprint; and
- expected Location.

The outer and inner Base64URL values must be canonical, UTF-8 decoding is fatal, and the JSON envelope must be a plain object with exactly `version`, `purpose`, `keyVersion`, `iv`, `ciphertext`, and `tag` in that fixed serialized order. Canonical byte reconstruction rejects unknown/missing/duplicate fields, whitespace, reordered properties, alternate serialization, and invalid UTF-8 before AES-256-GCM decryption. Wrong AAD, key version, key, purpose, tag, ciphertext, or envelope fails closed. Raw code, state, binding, tokens, provider bodies, and credentials are never logged or returned.

## Exchange, finalization, and recovery

The database is the one-winner boundary for `ready -> exchanging`. Only the winner receives encrypted code context. Before any network exchange, the claim revalidates exact current signed INSTALL ownership, lifecycle generation/status/version, app/client/provider/channel identity, and owner-approved version.

After a request may have been emitted, malformed, unreadable, oversized, invalid-UTF-8, or truncated responses are ambiguous. A parseable 2xx response is also ambiguous unless it is a JSON object with structurally valid access and refresh tokens, user type, Location ID, company ID, expiry, and scopes; optional app and ownership fields may be absent but must have the expected type when supplied. Unknown or uncertain 4xx responses (including 401, 403, 408, 409, and 425), malformed 4xx error bodies, 429s, 5xx responses, network timeout/reset, worker recovery from stale `exchanging`, and persistence failure after a successful token response are likewise ambiguous. These outcomes are stored as `exchange_outcome_unknown` (or `credential_persistence_failed` for ambiguous post-exchange persistence), burn the generation, and are never automatically retried because the authorization code may already have been consumed.

Deterministic failures are restricted to local validation that prevents any token request from being emitted, HTTP 400 with a complete explicit `error: "invalid_grant"`, and a structurally complete token response that definitively fails exact local ownership or scope policy. They terminate and scrub that attempt without burning the installation generation, so only a fresh authenticated state/code may try again. No other provider error name is treated as deterministic, and the same authorization code is never reused.

Successful token validation requires Location mode, exact location/company, exact app identity when supplied, exact configured scopes, and no bulk/future/all-location authority. Encrypted access/refresh credential persistence and attempt success occur in one security-definer transaction that locks in a single order and revalidates installation ID, generation, status, current INSTALL evidence, and approved version before either becomes visible.

All required callback, exchange-claim, and finalization inputs are explicitly rejected when NULL or malformed before authority or credential mutation. Authority comparisons use NULL-safe `IS DISTINCT FROM` where missing database identity must fail closed. Finalization additionally requires non-empty ciphertext, key version, finite future expiry, and a non-empty scope array with no NULL or blank member. Lifecycle retains explicit SQLSTATE `23514`: INSTALL requires tenant/company evidence, while UNINSTALL requires NULL tenant/company input and exact stored ownership.

The legacy shared-secret reconnect path strictly parses the returned installation row after credential persistence and rechecks installation/app/client/tenant/Location/company/Conversation Provider/channel/provider identity, eligible status, generation, current INSTALL/version evidence, both ciphertexts, key version, exact expiry instant, and normalized scope set before returning `connected`. Malformed, partial, NULL, or mismatched persistence output returns `credential_persistence_failed`.

The reconciler runs only when OAuth is enabled: once after startup, opportunistically after a ready callback/applied INSTALL, and on a bounded 30-second interval. Multiple instances are safe because PostgreSQL claims one winner. SQL-backed crash fixtures commit `waiting_install`, `ready`, and structurally valid stale `exchanging` evidence in separate sessions. A later INSTALL promotes the waiting attempt; a fresh recovery session lists and claims ready exactly once; stale exchanging becomes failed `exchange_outcome_unknown`, scrubs ciphertext/key version, disappears from later recovery, and cannot be claimed again.

## UNINSTALL and reinstall

A newly applied UNINSTALL captures the pre-UNINSTALL generation and invalidates only attempts whose expected Location and target generation match it; claimed attempts must also match the exact installation and claimed generation. Cross-Location replay or stale evidence has zero attempt side effect. Finalization racing with UNINSTALL uses the same installation-then-attempt lock order: either finalization commits first and UNINSTALL clears the credentials, or UNINSTALL commits first and finalization returns false.

Reinstall establishes a new lifecycle generation. Old attempt claims and ciphertext cannot move to it. An exact replay performs no second invalidation, and a stale UNINSTALL cannot revoke a newer attempt.

## Migration and rollout

- Forward: `supabase/migrations/202609230002_every8d_public_oauth_bootstrap.sql`
- Rollback: `supabase/rollback/202609230002_every8d_public_oauth_bootstrap.sql`

The forward migration is additive and compatible with the populated D3 app registration. The rollback is deliberately guarded and refuses to discard version, bootstrap, or accepted lifecycle-version evidence. Neither file is applied by this implementation task.

Later production rollout requires a separate approved task to verify the exact base schema/data, migration hashes, lock availability, owner-register the approved Marketplace version, configure secrets, and decide whether to enable OAuth. Marketplace installation, provider activation, Railway changes, and any controlled OAuth test remain out of scope.

## Isolation

The implementation does not import or call LINE OAuth/provider/lifecycle modules, EVERY8D transport/customer credentials, SMS dispatch, Phase 2F authorization consumption, or Conversation Provider activation. Existing LINE routes and `GHL_SMS_PHASE_2F_ENABLED` behavior remain unchanged.
