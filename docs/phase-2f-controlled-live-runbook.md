# Phase 2F controlled-live outbound runbook

## Status and boundary

Phase 2F-A implements infrastructure only. It does not activate controlled-live sending, apply migrations to Supabase, configure HighLevel, change Railway networking, authenticate to EVERY8D, or send an SMS.

The established outbound route remains:

`HighLevel native Send SMS -> signed /webhooks/ghl/sms/outbound -> Taiwan normalization -> exact tenant -> durable operation claim -> one-time authorization -> atomic send-start -> SmsOutboundService -> EVERY8D`

When `GHL_SMS_PHASE_2F_ENABLED` is not exactly `true`, the existing Phase 2C mock path retains its prior behavior. Phase 2F does not reuse Phase 2B activation flags.

## Forward migrations

Apply only under a separately approved database-change task, in filename order:

1. `202609010001_ghl_sms_controlled_live_mode.sql`
2. `202609010002_ghl_sms_controlled_live_authorizations.sql`

The first migration permits exactly `mock` and `controlled_live`. It also permits `definitive_failed` before provider start with zero attempts while retaining one-attempt requirements for accepted, ambiguous, and provider-started failures.

The second migration creates the service-only one-time authorization table and `consume_ghl_sms_controlled_live_authorization_v1`. The RPC consumes one exact armed authorization and starts one exact controlled-live operation in the same PostgreSQL transaction. The operation binding is unique, so one operation cannot retain multiple consumed authorizations. A false result or transaction error grants no provider permission.

Do not edit or reapply `202608190001_ghl_sms_outbound_operations.sql` as part of Phase 2F.

## Authorization evidence

An authorization is scoped to one exact tenant, location, contact, EVERY8D controlled-live mode, canonical destination fingerprint, and exact-message fingerprint. The database stores neither the destination nor message.

Fingerprints are lowercase HMAC-SHA256 hex computed with the runtime-only `GHL_SMS_PHASE_2F_FINGERPRINT_SECRET` and versioned domain separation:

- destination: `destination:v1:` followed by the canonical Taiwan E.164 value;
- message: `message:v1:` followed by the exact approved message, without trimming or rewriting.

The HMAC key must be at least 32 bytes, must not be logged or returned, and must never be stored in Supabase. Authorization lifecycle changes require a separately approved operational procedure. A consumed or revoked authorization cannot be rearmed, reset, or reused; consumed evidence cannot be deleted.

## Runtime gates

All of the following must pass before the atomic RPC:

- signed callback verification and strict payload validation;
- strict Taiwan-mobile normalization;
- `GHL_SMS_PHASE_2F_ENABLED=true`;
- `GHL_SMS_PHASE_2F_SEND_ENABLED=true`;
- exact confirmation `ENABLE_APPROVED_PHASE_2F_CONTROLLED_LIVE`;
- `GHL_SMS_PHASE_2F_NETWORK_CONFIRMED=true`;
- exact configured tenant, location, contact, canonical destination, message, and authorization ID;
- exactly one tenant resolved for the signed location;
- a new durable controlled-live operation claim.

Provider credentials are read and the tenant-bound provider factory is created only after the RPC succeeds. There is no global, latest, or default tenant fallback and no callback-controlled provider, mode, or credentials.

Runtime-only configuration names are documented in `.env.example`. Keep all values blank and both enable gates plus `NETWORK_CONFIRMED` false during Phase 2F-A.

## Outcome semantics

- Authorization unavailable or RPC failure before commit: definitive failure, zero provider attempts, no send-start.
- Explicit provider rejection after atomic send-start: `definitive_failed`, one attempt.
- Network failure, timeout, HTTP ambiguity, malformed response, or unknown acceptance: `ambiguous`, one attempt.
- Accepted submission: `accepted`, one attempt.

No automatic retry creates new send permission. Consumption is permanent regardless of the post-start provider outcome.

## Network evidence and Phase 2F-B prerequisites

Sanitized provider evidence confirms:

- overseas cloud-server access is acceptable;
- a fixed outbound IP must be supplied;
- EVERY8D will whitelist the supplied fixed IP.

Before any separately approved Phase 2F-B execution:

1. Enable Railway Static Outbound IP under separate approval.
2. Redeploy under separate approval.
3. Record every IPv4 address assigned to the WinCRM service; do not assume only one.
4. Send all assigned IPv4 addresses to Eric through the approved channel.
5. Receive explicit EVERY8D whitelist confirmation.
6. Only then may `GHL_SMS_PHASE_2F_NETWORK_CONFIRMED` be set to `true` as part of the separately approved controlled execution.

Phase 2F-A does none of these steps. Production Supabase and Railway remain untouched.

## Validation boundary

Local validation uses synthetic credentials, fake transports/providers, and zero `global.fetch` calls. GitHub Actions applies the full migration chain to a disposable PostgreSQL 17 service, preserves the existing Phase 2E claim proof, and adds the one-authorization/two-operation race plus forced rollback proof. CI never connects to production Supabase.

SafeSay, EventID, inbound SMS, delivery-status queries, reply queries, LINE behavior, and HighLevel message-status updates remain out of scope.
