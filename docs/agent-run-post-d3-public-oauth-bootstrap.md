# Agent run — post-D3 public OAuth bootstrap

## Task and authority

- Branch: `feature/every8d-public-oauth-bootstrap-rendezvous`
- Pinned base: `e0c096b08f39ee73f924803a8ad8b49db960cc9c`
- Scope: default-off public bootstrap, INSTALL/callback rendezvous, one-winner exchange, atomic finalization, lifecycle invalidation, reconciler, tests, and documentation.
- Explicit exclusions observed: no production access, migration application, Railway change, OAuth enablement, Marketplace install, provider activation, HighLevel/EVERY8D request, SMS, Phase 2F consumption, or LINE change.

## Design decisions

- Preserve the immutable D3 registration unchanged; add a separate owner-only immutable Marketplace-version registration.
- Keep the existing shared-secret installed/reconnect initiation route alongside the public empty-body start route.
- Keep public start stateless and authenticate its canonical state with an HKDF-derived HMAC key.
- Derive the expected Location only from the validated SHA-pinned installation URL.
- Create durable attempt evidence atomically at callback, scoped by Location and target lifecycle generation.
- Serialize callback and lifecycle mutation with the identical Location advisory key `ghl_marketplace_location_v1:{app_namespace}:{exact_location_id}` and preserve installation-row-before-attempt-row ordering.
- Store only state/binding hashes and authorization-code-specific AES-GCM ciphertext.
- Put lifecycle outcome, rendezvous, invalidation, exchange claim, cleanup, and final success/credential atomicity in narrow security-definer PostgreSQL functions.
- Burn a generation only for ambiguous exchange evidence (`exchanging`, `succeeded`, `exchange_outcome_unknown`, or post-response `credential_persistence_failed`); deterministic failure permits only a fresh authenticated state/code.
- Require a structurally complete 2xx token object before semantic validation. Missing or malformed token, ownership, expiry, or scope fields are ambiguous; only explicit HTTP 400 `invalid_grant`, local pre-network rejection, and complete exact ownership/scope policy rejection are deterministic.
- Require canonical authorization-code envelopes and strict post-persistence validation in the legacy reconnect path.
- Reject required NULL SECURITY DEFINER inputs explicitly and use NULL-safe authority comparisons.

## Validation evidence

- Provider-outcome repair validation head: `d6087e40bb17066adef37a4ebf41468ff7db54d5`.
- Full repair Node validation: 593 tests passed with zero failures or skips.
- `npm run typecheck`: SUCCESS.
- `npm run build`: SUCCESS.
- Local PostgreSQL probe: client 17.11 is installed, but the host lacks server catalogs (`share/postgres.bki`), Docker, and WSL; therefore no local cluster could be created and no external database was contacted.
- Hosted CI run: `36004813308`.
- Hosted `validate`: SUCCESS.
- Hosted PostgreSQL 17 `postgres-concurrency`: SUCCESS, including the full migration chain, rollback/reapply, privilege proofs, lifecycle ordering, callback/INSTALL concurrency, lifecycle-v2 required-NULL rejection, recovery-limit boundaries, generation burn, crash/recovery, and finalization/UNINSTALL.

## Safety review

- D3 registration trigger was not weakened.
- The version migration inserts no owner identity.
- Public start creates no row; callback-created attempts have server-pinned Location and target-generation evidence but no browser-supplied tenant/company ownership.
- Disabled runtime gates RNG, database, cookies, redirects, reconciler, and network work.
- LINE and Phase 2F regression tests remain inside the single 593-test Node suite; no LINE or Phase 2F production module is changed by this repair.

## Rollback

Keep OAuth disabled. Before any feature evidence exists, the targeted rollback removes only the additive functions, table, trigger, constraint, and column. Once owner version, bootstrap, or signed lifecycle-version evidence exists, rollback refuses destructive evidence loss and requires a separately reviewed data-preserving plan.
