# Agent run — Phase 2G-C first OAuth foundation slice

## Task and authority

- GitHub issue: [#98](https://github.com/hugolamcloser/win-crm.ai-lineconnect/issues/98).
- Branch: `codex/issue-98-phase-2g-c-every8d-oauth-runtime`.
- Base: refreshed `origin/main` at `466bc4acc46eed9817d7b86f414cbefd05e20d6f`; local main matched and the working tree was clean before branch creation.
- Authority: implement, test, commit, push, and open a Draft PR for the first default-off Location-only OAuth foundation. No merge, deployment, production configuration/database access, app installation, provider activation, EVERY8D request, authorization access, or SMS.

## Implemented boundary

- Dedicated configuration; no reuse of LINE/legacy GHL OAuth variables.
- Namespaced, shared-secret-protected initiation and browser-bound callback.
- SHA-256 state and binding persistence with database-atomic one-time consumption.
- Location-only HighLevel token exchange with exact location/app/scope and ownership-mode rejection.
- AES-256-GCM versioned encryption and exact installation-specific persistence.
- Ed25519-only namespaced lifecycle webhook boundary.
- Exact signed uninstall invalidation.
- No refresh runtime, provider dispatch, SMS, or production action.

## TDD evidence

The public seams were HTTP routes, the dedicated OAuth service, the repository state/persistence boundary, and the encryption module. Each implementation seam began with a failing Node test. Initial failures were missing-module failures for the new crypto, OAuth service, lifecycle webhook, and OAuth route modules; each went green after the corresponding minimal implementation.

Focused proofs cover:

- default-off zero side effects;
- exact and wrong installation/app/client/tenant/location behavior;
- Company/bulk/future-location/approve-all rejection;
- state expiry, reuse, revocation, generation, redirect, binding, and concurrent callback behavior;
- exact scope validation and bounded dedicated token exchange;
- AES-256-GCM round trip and wrong key/version/AAD/tag/ciphertext failure;
- no plaintext persistence or sensitive errors/responses;
- Ed25519 raw-body lifecycle verification with no legacy-signature authority;
- LINE, SMS, armed-authorization, and EVERY8D transport isolation.

The audit repair pass added exact instant comparison for realistic PostgREST `timestamptz` forms, a pinned no-redirect HighLevel token endpoint, strict canonical Ed25519 Base64 decoding, required lifecycle namespace/install type, whitespace-secret rejection, full install-link digest pinning, a post-exchange generation race, and a realistic PostgREST persistence shape. A later out-of-band review of the actual HighLevel-generated link established the generic Location path boundary `https://app.gohighlevel.com/v2/location/{locationId}/integration/{integrationId}/versions/{versionId}` with no query or fragment. The runtime now enforces that structure and the full-link digest without committing the actual link or digest. HighLevel lifecycle examples remain inconsistent about namespace/install-type fields, so that signed-payload contract remains an activation blocker rather than being guessed.

The existing `test/postgres/ghlMarketplaceOwnership.sh` remains the real PostgreSQL 17 proof for the exact conditional state update used by the repository. It proves one winner across two connections and serializes state consumption against generation changes. CI runs it after the complete migration chain.

## Decisions and blockers

1. **No schema change in this PR.** The existing tables support state and encrypted credential persistence.
2. **Automatic INSTALL provisioning stopped.** Signed `companyId` cannot be retained immutably in the current installation table, and legacy pending/onboarding storage is forbidden. The validated webhook returns `provisioning_blocked` without mutation. A later additive company-binding design is required.
3. **Refresh deferred.** Current schema has no monotonic credential revision or refresh lease for cross-process stale-result CAS. A later additive database primitive and race proof are required.
4. **Activation blocked.** The install-link structure and approval-pin boundary are resolved, but its actual runtime values remain unset until a separate activation task. Marketplace state pass-through needs sandbox confirmation; signed lifecycle payloads must confirm the required namespace/install type; provider-message attribution and GET-message minimum scope remain unresolved and separate from OAuth readiness.

## Validation record

- `npm run typecheck`: passed.
- `npm test`: passed, 494 tests, 0 failed, 0 skipped after install-link hardening.
- `npm run build`: passed.
- `git diff --check`: passed; only line-ending notices were emitted.
- Focused Phase 2G-C and shared-boundary regression tests: 125 passed across configuration/exchange, repository, routes, service/concurrency, lifecycle, encryption, shared signature, SMS isolation, and existing LINE/GHL compatibility suites.
- Local PostgreSQL runner: not run because Docker is unavailable and the installed PostgreSQL package lacks `share/postgres.bki`; hosted CI runs the existing PostgreSQL 17 proof.

No production connection, Supabase mutation, Railway change, HighLevel change, LINE change, EVERY8D request, SMS operation, authorization access/consumption, or SMS send occurred.
