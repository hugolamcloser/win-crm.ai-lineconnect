# EVERY8D C2 provider credential foundation

## Purpose and security boundary

C2 adds a database-only authority for future per-installation EVERY8D provider
credentials. It stores ciphertext and structural metadata only. It does not add
an encryption implementation, keyring environment variables, a runtime
resolver, provider validation, provider activation, SafeSay behavior, an
EVERY8D request, an SMS send, or a browser-readable secret surface.

The global runtime provider configuration and all Railway/environment settings
remain unchanged. The Phase 2F gate remains disabled. Existing LINE and
HighLevel OAuth behavior is outside this migration and is not modified.

## Schema

public.every8d_provider_configurations owns at most one row for an exact
(installation_id, installation_generation) pair. The parent is
public.ghl_marketplace_installations(id) with ON UPDATE RESTRICT and
ON DELETE RESTRICT.

The row contains:

- an immutable installation identity and generation;
- a trimmed, nonempty site_url of at most 2048 characters;
- a 100–60000 ms timeout;
- encrypted UID/password bytes plus an encryption-key version;
- credential state and structural revision metadata;
- optional SafeSay enablement and EventID metadata;
- finite configuration, replacement, validation, disconnection, creation, and
  update timestamps.

No tenant, location, company, Marketplace identity, OAuth client, conversation
provider, or Marketplace version is duplicated. Those values remain
authoritative on the parent installation and its immutable registrations. The
database intentionally does not impose a fake HTTPS/origin regex; canonical URL
validation belongs to C4.

The table adds only its primary-key index and the unique
installation/generation index.

## Credential states

No row means unconfigured.

| State | Credential tuple | Validation metadata | Disconnection |
| --- | --- | --- | --- |
| configured | Complete, nonempty ciphertext tuple | Cleared | Not disconnected |
| validated | Complete, nonempty ciphertext tuple | Finite validation time; no failure | Not disconnected |
| invalid | Complete, nonempty ciphertext tuple | Finite validation time and sanitized structural failure class | Not disconnected |
| disconnected | UID/password/key version scrubbed | Cleared | Finite disconnected_at; SafeSay disabled |

validation_failure_class is constrained only to a trimmed, 1–64 character
snake-case-like structure. C2 deliberately does not freeze the future C5
semantic failure-class vocabulary.

## Parent and generation isolation

Every insert and every update that produces a secret-bearing state rechecks the
current parent under a row lock. The exact generation must match, and the
parent must:

- be the registered every8d_connect / sms / every8d installation;
- match the immutable Marketplace app, OAuth client, conversation-provider,
  channel, and provider registration;
- carry a registered lifecycle version;
- have company ownership;
- have latest lifecycle evidence INSTALL;
- have status pending or active.

Disabled, uninstalled, stale-generation, unregistered-version, and mismatched
identity rows fail closed. A later generation receives no row and inherits no
credentials.

## Revision and mutation protection

protect_every8d_provider_configuration_v1() is a SECURITY DEFINER
BEFORE INSERT OR UPDATE OR DELETE trigger function with a fixed
pg_catalog, public search path.

- Initial configuration must be configured at revision 1.
- Authority fields are site_url, timeout_ms, both ciphertexts, and key version.
- Authority replacement, reconnect, or future re-encryption advances revision
  by exactly one, advances replaced_at, returns to configured, and clears
  validation/disconnection metadata.
- Disconnect advances revision exactly once, scrubs the complete credential
  tuple, clears validation metadata, disables SafeSay, and retains EventID.
- Validation-only and SafeSay-only changes leave revision unchanged.
- Identity, generation, configured time, and created time are immutable.
- Deletes are always rejected.

This is structural revision protection, not caller-level compare-and-swap.
Expected-revision authorization and mutation RPCs belong to C4.

## Lifecycle scrub

invalidate_every8d_provider_configuration_v1() runs from an AFTER UPDATE OF
status, installation_generation trigger on the parent installation. When the
new status is disabled/uninstalled or the generation changes, it targets only
the old generation and only if that row is not already disconnected.

The mutation scrubs provider ciphertext/key version, advances revision once,
clears validation metadata, records disconnection, and disables SafeSay while
retaining URL, timeout, EventID, configuration/replacement history, identity,
and generation. It then verifies that no targeted row remains secret-bearing,
non-disconnected, or SafeSay-enabled. Failure raises and aborts the entire
parent lifecycle transaction, including the existing OAuth scrub.

Exact lifecycle replay and an already-disconnected row are inert.

PostgreSQL limits identifiers to 63 bytes, so the requested lifecycle trigger
declaration is stored in the catalog as
invalidate_every8d_provider_configuration_after_installation_up. The forward
and rollback SQL both use the requested full spelling, which PostgreSQL resolves
to that same deterministic identifier.

## SafeSay boundary

safesay_enabled defaults to false. safesay_event_id is nullable, trimmed,
1–256 characters, and intentionally has no numeric-only rule or global/default
value. Enabling requires an EventID. Disconnect and lifecycle invalidation
disable SafeSay but retain the non-secret EventID as historical configuration.

C2 implements no SafeSay send, receive, link, callback, or webhook behavior.

## RLS and grants

RLS is enabled. public, anon, and authenticated receive no table privileges.
service_role receives SELECT only through one USING (true) policy and receives
no insert, update, or delete privilege. Neither trigger function is directly
executable by application roles. No view, general-purpose secret RPC, or
browser-readable surface is added.

## Phase boundaries

- C3 may add approved settings presentation and collection; C2 adds no route.
- C4 owns encryption/key selection, canonical URL validation, expected-revision
  CAS, and narrow mutation RPCs.
- C5 owns provider credential validation and semantic failure classes.
- Runtime provider resolution, activation, SafeSay behavior, Phase 2F
  enablement, and external calls require separate authorization.

## Rollback

The single rollback takes an exclusive table lock and refuses before dropping
anything if any configuration row exists. It does not inspect or decrypt row
content. An empty rollback drops only the C2 lifecycle trigger, configuration
triggers, service-role policy, table, and two C2 functions, in that order,
without CASCADE. It never drops public.set_updated_at() or any lifecycle,
OAuth, C1a, or C1b object.
