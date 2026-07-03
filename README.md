# LINE to GoHighLevel Conversation Middleware

Node.js, Express, TypeScript, and Supabase middleware for syncing LINE Official Account conversations with GoHighLevel Conversations through a custom Conversation Provider.

The important production auth rule: LINE inbound messages are forwarded to GHL with the installed-location Marketplace OAuth access token stored in Supabase. The private integration token is only an optional dev fallback and should not be relied on for production Conversation Provider message APIs.

## What Is Included

- Express API with LINE and GHL webhook routes.
- Raw-body LINE signature validation.
- Immediate 200 response to LINE, with background message processing.
- GHL Marketplace OAuth callback, token storage, token refresh, and one retry after 401.
- Automatic GHL contact creation and LINE profile mapping.
- Mandatory LINE contact tags: `line` and `line:{LINE_USER_ID}`.
- Optional GHL custom fields for LINE user ID and LINE display name.
- Supabase audit tables for webhook and message sync diagnostics.
- Debug routes that never expose tokens or secrets.

## Project Structure

```text
src/
  app.ts
  server.ts
  config/
  integrations/
  middleware/
  routes/
  services/
  types/
supabase/
  migrations/
```

## Required URLs

Assuming `PUBLIC_BASE_URL=https://api.win-crm.ai`:

- LINE webhook URL: `https://api.win-crm.ai/webhooks/line/inbound`
- GHL Conversation Provider Delivery URL: `https://api.win-crm.ai/webhooks/ghl/line/outbound`
- GHL Marketplace OAuth callback URL: `https://api.win-crm.ai/oauth/callback`
- Health check: `https://api.win-crm.ai/health`
- Environment check: `https://api.win-crm.ai/debug/env-check`
- OAuth status: `https://api.win-crm.ai/debug/oauth-status`
- OAuth token test: `https://api.win-crm.ai/debug/ghl-token-test`
- Recent events: `https://api.win-crm.ai/debug/recent-events`

The original route aliases still work:

- `POST /webhooks/line`
- `POST /webhooks/ghl/outbound`

## Environment Variables

Copy `.env.example` to `.env` for local work. In Railway, add real values in the service Variables tab.

Required:

```text
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
PUBLIC_BASE_URL=https://api.win-crm.ai
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
GHL_API_BASE_URL=https://services.leadconnectorhq.com
GHL_API_VERSION=2021-07-28
GHL_LOCATION_ID=...
GHL_CUSTOM_PROVIDER_ID=...
GHL_OAUTH_CLIENT_ID=...
GHL_OAUTH_CLIENT_SECRET=...
GHL_OAUTH_REDIRECT_URI=https://api.win-crm.ai/oauth/callback
GHL_OAUTH_TOKEN_URL=https://services.leadconnectorhq.com/oauth/token
```

Optional:

```text
GHL_LINE_USER_ID_FIELD_ID=
GHL_LINE_DISPLAY_NAME_FIELD_ID=
GHL_CUSTOM_PROVIDER_SECRET=...
WEBHOOK_SHARED_SECRET=...
GHL_ALLOW_PRIVATE_TOKEN_FALLBACK=false
GHL_PRIVATE_INTEGRATION_TOKEN=
```

Keep `GHL_ALLOW_PRIVATE_TOKEN_FALLBACK=false` in production. Never expose `SUPABASE_SERVICE_ROLE_KEY`, LINE secrets, GHL OAuth client secret, GHL access token, or GHL refresh token.

## Supabase Setup

Run both migrations in order:

1. `supabase/migrations/202607020001_initial_schema.sql`
2. `supabase/migrations/202607030001_ghl_oauth_tokens.sql`

In Supabase SQL Editor, paste and run each file one at a time. `Success. No rows returned` is normal because these migrations create or alter schema objects.

The second migration creates `ghl_oauth_tokens` and adds these message diagnostics to `message_events`:

- `ghl_status_code`
- `ghl_response_body`
- `request_payload`

RLS enabled is okay because this backend uses the Supabase service role key. Do not expose the service role key publicly.

## OAuth Flow

1. Set the GHL Marketplace app OAuth callback URL to `https://api.win-crm.ai/oauth/callback`.
2. Add `GHL_OAUTH_CLIENT_ID`, `GHL_OAUTH_CLIENT_SECRET`, and `GHL_OAUTH_REDIRECT_URI` in Railway.
3. Install the Marketplace app into the target GHL location.
4. HighLevel redirects to `/oauth/callback?code=...`.
5. The middleware exchanges the code for an access token and refresh token.
6. Tokens are stored server-side in Supabase `ghl_oauth_tokens` for the `GHL_LOCATION_ID`.
7. Calls to GHL use the stored OAuth access token.
8. If the token is expired or close to expiry, the middleware refreshes it.
9. If a GHL request returns 401, the middleware refreshes once and retries once.

Debug after installing:

```text
GET https://api.win-crm.ai/debug/oauth-status
GET https://api.win-crm.ai/debug/ghl-token-test
```

These routes do not return token values.

## LINE To GHL Flow

When LINE sends a text message:

1. The webhook validates `x-line-signature`.
2. The route immediately returns `{ "ok": true, "accepted": true }` to LINE.
3. The event is saved to `webhook_events`.
4. The LINE profile is saved or updated in `line_profiles`.
5. If no GHL contact mapping exists, the middleware creates a GHL contact using the stored OAuth token.
6. The LINE user is mapped to the GHL contact in `line_profiles`.
7. The GHL contact is created or updated with tags `line` and `line:{LINE_USER_ID}`.
8. Optional LINE custom fields are updated when configured.
9. The LINE message is posted to GHL through `/conversations/messages/inbound` using the location OAuth token.
10. `message_events` stores `success` or `failed`, plus GHL status/body/request details when available.

The inbound LINE message should appear inside the same GHL contact conversation thread. Creating the GHL contact alone is not success; check `message_events` and the GHL conversation.

## GHL To LINE Flow

GHL sends outbound replies to the Conversation Provider Delivery URL:

```text
https://api.win-crm.ai/webhooks/ghl/line/outbound
```

That Delivery URL is only for GHL to middleware replies. It is not the OAuth callback URL, and it is not the LINE webhook URL. GHL Marketplace webhooks are separate and are not required unless you add separate GHL event-notification features.

## API Reference

### `GET /health`

Returns `{ "ok": true }` plus service metadata.

### `GET /debug/env-check`

Returns `present` or `missing` for required and optional environment variables. It never returns real secret values.

### `GET /debug/recent-events`

Returns the latest 10 `line_profiles`, latest 10 `message_events`, and latest 10 `webhook_events` rows with secret-looking fields redacted. Use this to inspect status, `error_message`, `ghl_status_code`, `ghl_response_body`, and redacted `request_payload`.

### `GET /debug/oauth-status`

Returns token state for `GHL_LOCATION_ID`:

- `location_id`
- `token_present`
- `refresh_token_present`
- `expires_at`
- `expired`
- `scopes`
- `company_id`

It never returns access or refresh token values.

### `GET /debug/ghl-token-test`

Uses the stored OAuth token to call a simple GHL location endpoint. Returns success or failure, status code, endpoint, auth mode, and a redacted response body.

### `GET /oauth/callback`

Accepts the GHL OAuth `code`, exchanges it for tokens, stores them in Supabase, and returns safe install status.

### `POST /webhooks/line` and `POST /webhooks/line/inbound`

Receives LINE inbound webhooks. Requires a valid `x-line-signature` header.

### `POST /webhooks/ghl/outbound` and `POST /webhooks/ghl/line/outbound`

Receives outbound GHL Conversation Provider messages. If `GHL_CUSTOM_PROVIDER_SECRET` is configured, include it in `x-provider-secret` or `x-ghl-secret`.

### `POST /admin/mappings`

Manual override for linking a LINE user to an existing GHL contact or conversation. Requires `WEBHOOK_SHARED_SECRET`.

## Hugo Setup Checklist

1. Run the Supabase migrations.
2. Deploy the repo to Railway.
3. Add Railway environment variables.
4. Connect the Railway custom domain `api.win-crm.ai`.
5. Set the GHL Marketplace OAuth callback URL to `https://api.win-crm.ai/oauth/callback`.
6. Install the GHL Marketplace app into the target location.
7. Confirm `/debug/oauth-status` shows `token_present: true` and `refresh_token_present: true`.
8. Confirm `/debug/ghl-token-test` succeeds.
9. Set LINE Developers webhook URL to `https://api.win-crm.ai/webhooks/line/inbound`.
10. Set GHL Conversation Provider Delivery URL to `https://api.win-crm.ai/webhooks/ghl/line/outbound`.
11. Disable LINE auto-response in LINE Official Account Manager so test replies are not confusing.
12. Send a real LINE message.
13. Check `/debug/recent-events` and Supabase `message_events`.
14. Confirm the message appears in the GHL contact conversation thread.

## Common Errors

- `HighLevel API 401`: OAuth token is missing, expired and not refreshable, belongs to the wrong location, or lacks required scopes. Check `/debug/oauth-status`, `/debug/ghl-token-test`, and `message_events`.
- `No HighLevel OAuth token is stored`: Install the Marketplace app and complete `/oauth/callback`.
- Contact is created but message is missing in GHL Conversations: Check `message_events.ghl_status_code`, `message_events.ghl_response_body`, and `message_events.request_payload`.
- Tags are missing: Send another LINE message and check whether `message_events.error_message` includes a contact metadata warning.
- `Invalid LINE signature`: Check `LINE_CHANNEL_SECRET` and make sure LINE posts directly to `/webhooks/line/inbound`.
- `LINE API 401`: Check `LINE_CHANNEL_ACCESS_TOKEN`.
- GHL replies do not reach LINE: Confirm the provider Delivery URL is `/webhooks/ghl/line/outbound` and the GHL contact/conversation exists in `line_profiles`.
