# Agent run — post-D3 public OAuth bootstrap

## Task and authority

- Branch: `feature/every8d-public-oauth-bootstrap-rendezvous`
- Pinned base: `e0c096b08f39ee73f924803a8ad8b49db960cc9c`
- Scope: default-off public bootstrap, INSTALL/callback rendezvous, one-winner exchange, atomic finalization, lifecycle invalidation, reconciler, tests, and documentation.
- Explicit exclusions observed: no production access, migration application, Railway change, OAuth enablement, Marketplace install, provider activation, HighLevel/EVERY8D request, SMS, Phase 2F consumption, or LINE change.

## Design decisions

- Preserve the immutable D3 registration unchanged; add a separate owner-only immutable Marketplace-version registration.
- Keep the existing shared-secret installed/reconnect initiation route alongside the public empty-body start route.
- Permit only one active pinned-app bootstrap so an INSTALL cannot ambiguously claim one of several ownership-free attempts.
- Store only state/binding hashes and authorization-code-specific AES-GCM ciphertext.
- Put lifecycle outcome, rendezvous, invalidation, exchange claim, cleanup, and final success/credential atomicity in narrow security-definer PostgreSQL functions.
- Treat every ambiguous network exchange outcome as terminal and non-retryable.

## Validation evidence

- Initial focused OAuth/lifecycle Node validation: 84 passed.
- After preserving the installed/reconnect path and adding classifications: full `npm test` passed, 517 tests, zero failures.
- `npm run typecheck`: passed during implementation correction loop.
- `npm run build`: passed as part of the full test run.
- Local PostgreSQL probe: client 17.11 is installed, but the host lacks server catalogs (`share/postgres.bki`), Docker, and WSL; therefore no local cluster could be created and no external database was contacted.
- PostgreSQL 17 executable validation is wired to the repository's isolated CI service in `test/postgres/ghlPublicOAuthBootstrap.sh`; final run details are recorded after the Draft PR CI completes.

## Safety review

- D3 registration trigger was not weakened.
- The version migration inserts no owner identity.
- Public bootstrap schema has no tenant/location/company ownership columns.
- Disabled runtime gates RNG, database, cookies, redirects, reconciler, and network work.
- LINE and Phase 2F regression tests remain part of the 517-test suite.

## Rollback

Keep OAuth disabled. Before any feature evidence exists, the targeted rollback removes only the additive functions, table, trigger, constraint, and column. Once owner version, bootstrap, or signed lifecycle-version evidence exists, rollback refuses destructive evidence loss and requires a separately reviewed data-preserving plan.
