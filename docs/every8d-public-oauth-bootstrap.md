# EVERY8D public OAuth bootstrap and INSTALL/callback rendezvous

## Scope and default-off boundary

This post-D3 foundation adds a public first-install OAuth bootstrap without enabling OAuth, installing the Marketplace app, activating the Conversation Provider, calling HighLevel or EVERY8D, or authorizing SMS. `EVERY8D_GHL_OAUTH_ENABLED=false` remains the first runtime gate. While disabled, the new path creates no rows, generates no random state or binding, sets no cookie, redirects nowhere, starts no reconciler timer, scans no attempts, exchanges no code, and persists no credentials.

The existing shared-secret `POST /oauth/every8d-connect/initiate` route remains available for an already installed, exact signed installation. The new `POST /oauth/every8d-connect/start` route is the public first-install path and accepts only a genuinely empty POST with no query keys or body bytes.

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

Timeouts, connection failures after possible request emission, unreadable or truncated responses, malformed/truncated 2xx responses, 429s, 5xx responses, worker recovery from stale `exchanging`, and persistence failure after a successful token response are ambiguous. They burn the generation and are never automatically retried because the authorization code may already have been consumed. A complete explicit `invalid_grant`, local pre-network validation failure, and a complete token response that definitively fails exact ownership/scopes validation are deterministic. They terminate and scrub that attempt without burning the installation generation, so only a fresh authenticated state/code may try again. The same authorization code is never reused.

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
