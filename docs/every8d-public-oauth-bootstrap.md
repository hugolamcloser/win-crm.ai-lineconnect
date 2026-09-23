# EVERY8D public OAuth bootstrap and INSTALL/callback rendezvous

## Scope and default-off boundary

This post-D3 foundation adds a public first-install OAuth bootstrap without enabling OAuth, installing the Marketplace app, activating the Conversation Provider, calling HighLevel or EVERY8D, or authorizing SMS. `EVERY8D_GHL_OAUTH_ENABLED=false` remains the first runtime gate. While disabled, the new path creates no rows, generates no random state or binding, sets no cookie, redirects nowhere, starts no reconciler timer, scans no attempts, exchanges no code, and persists no credentials.

The existing shared-secret `POST /oauth/every8d-connect/initiate` route remains available for an already installed, exact signed installation. The new `POST /oauth/every8d-connect/start` route is the public first-install path and accepts only an empty JSON object.

## Non-owning public bootstrap

The public bootstrap is deliberately ownership-free. It never accepts or stores a browser-supplied tenant, location, company, installation ID, lifecycle generation, state, browser binding, installation URL, or redirect URI. HighLevel authentication plus explicit Location installation consent is the human authorization boundary. Authoritative company/location ownership enters only through the verified Ed25519-signed INSTALL lifecycle event and exact tenant resolution.

The server generates independent 32-byte state and browser-binding values. Only SHA-256 hashes are stored. The binding cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, has no Domain attribute, is limited to `/oauth/every8d-connect`, and cannot outlive the bootstrap TTL. Start, callback, pending, and status responses are `no-store`, `no-cache`, `no-referrer`, and deny framing.

Admission is database serialized. Expired attempts are terminalized before an atomic global cap check, and only one active attempt is permitted for the pinned app context. This intentionally conservative first version avoids ambiguous INSTALL-to-bootstrap matching. A distributed general-purpose rate limiter remains an operational enhancement, not part of this PR.

## Owner-managed Marketplace version

`ghl_marketplace_app_registrations` remains unchanged and immutable. The migration adds a separate `ghl_marketplace_app_version_registrations` table. It is owner-managed, has RLS enabled, grants no browser or `service_role` table access, and rejects update/delete after insertion. The migration inserts no version value.

Before rollout, a database owner must separately register the exact approved signed Marketplace version after the migration preflight. `service_role` cannot invent, change, or read that identity. Lifecycle, bootstrap creation, exchange claim, and finalization compare the exact signed/configured version to the owner registration.

## Durable rendezvous

`ghl_marketplace_oauth_bootstraps` uses these one-way states:

- `awaiting_callback`
- `waiting_install`
- `ready`
- `exchanging`
- `succeeded`
- `failed`

For callback-first ordering, the validated callback stores only encrypted code material and moves to `waiting_install`; a newly applied current INSTALL claims the exact installation/generation and moves it to `ready`. For INSTALL-first ordering, INSTALL claims the still-`awaiting_callback` attempt; the later validated callback stores the encrypted code and moves directly to `ready`. PostgreSQL row locks and compare-and-set updates serialize concurrent arrival.

The lifecycle RPC returns `applied`, `exact_replay`, or `stale_ignored`. Only `applied` may rendezvous or invalidate attempts. Exact replay cannot duplicate those side effects, stale events mutate nothing, and equal-time conflicting evidence remains rejected.

## Callback and authorization-code encryption

Callback acceptance requires the exact state hash, independent browser-binding hash, configured redirect URI, immutable config fingerprint, approved version, eligible one-time status, and unexpired attempt before code storage.

The authorization code uses a dedicated AES-256-GCM envelope with purpose `pending_authorization_code`, separate from access/refresh token encryption. Its authenticated additional data binds:

- envelope/domain version;
- purpose;
- bootstrap ID;
- `every8d_connect` namespace;
- state hash;
- redirect URI; and
- immutable config/install-context fingerprint.

Wrong AAD, key version, key, tag, ciphertext, or envelope fails closed. Raw code, state, binding, tokens, provider bodies, and credentials are never logged or returned.

## Exchange, finalization, and recovery

The database is the one-winner boundary for `ready -> exchanging`. Only the winner receives encrypted code context. Before any network exchange, the claim revalidates exact current signed INSTALL ownership, lifecycle generation/status/version, app/client/provider/channel identity, and owner-approved version.

Timeouts, network failures, 429s, and 5xx responses are terminal `exchange_outcome_unknown`. They are never automatically retried because the authorization code may already have been consumed. `invalid_grant` and invalid token responses are also terminal. Every terminal path scrubs authorization-code ciphertext.

Successful token validation requires Location mode, exact location/company, exact app identity when supplied, exact configured scopes, and no bulk/future/all-location authority. Encrypted access/refresh credential persistence and attempt success occur in one security-definer transaction that locks in a single order and revalidates installation ID, generation, status, current INSTALL evidence, and approved version before either becomes visible.

The reconciler runs only when OAuth is enabled: once after startup, opportunistically after a ready callback/applied INSTALL, and on a bounded 30-second interval. Multiple instances are safe because PostgreSQL claims one winner. `waiting_install` and `ready` are recoverable. A stale `exchanging` attempt becomes failed `exchange_outcome_unknown`, its code is scrubbed, and it is never replayed.

## UNINSTALL and reinstall

A newly applied UNINSTALL invalidates incomplete old attempts and scrubs stored authorization-code ciphertext. It increments the lifecycle generation where required and clears installed OAuth credentials. Finalization racing with UNINSTALL uses the same installation-then-attempt lock order: either finalization commits first and UNINSTALL clears the credentials, or UNINSTALL commits first and finalization returns false. No stale-generation credentials become usable.

Reinstall establishes a new lifecycle generation. Old attempt claims and ciphertext cannot move to it. An exact replay performs no second invalidation, and a stale UNINSTALL cannot revoke a newer attempt.

## Migration and rollout

- Forward: `supabase/migrations/202609230002_every8d_public_oauth_bootstrap.sql`
- Rollback: `supabase/rollback/202609230002_every8d_public_oauth_bootstrap.sql`

The forward migration is additive and compatible with the populated D3 app registration. The rollback is deliberately guarded and refuses to discard version, bootstrap, or accepted lifecycle-version evidence. Neither file is applied by this implementation task.

Later production rollout requires a separate approved task to verify the exact base schema/data, migration hashes, lock availability, owner-register the approved Marketplace version, configure secrets, and decide whether to enable OAuth. Marketplace installation, provider activation, Railway changes, and any controlled OAuth test remain out of scope.

## Isolation

The implementation does not import or call LINE OAuth/provider/lifecycle modules, EVERY8D transport/customer credentials, SMS dispatch, Phase 2F authorization consumption, or Conversation Provider activation. Existing LINE routes and `GHL_SMS_PHASE_2F_ENABLED` behavior remain unchanged.
