# LINE to GoHighLevel Conversation Middleware

Node.js, Express, TypeScript, and Supabase middleware for syncing LINE Official Account conversations with GoHighLevel Conversations through a custom Conversation Provider.

The service accepts inbound LINE webhooks, validates the `x-line-signature` HMAC, saves LINE profiles in Supabase, creates or reuses mapped GHL contacts, forwards inbound messages into HighLevel, receives outbound provider webhooks from HighLevel, and pushes replies back to LINE.

## What Is Included

- Express API with typed route handlers.
- LINE webhook signature verification using the raw request body.
- LINE profile lookup and push message support.
- Automatic GHL contact creation for new LINE users.
- HighLevel API client for inbound custom provider messages.
- Outbound HighLevel webhook handler for replies back to LINE.
- Supabase migration for tenants, LINE profile mappings, message audit logs, and raw webhook audit storage.
- Admin endpoint for linking a LINE user to a GHL contact/conversation.
- Dockerfile and production build scripts.

## Project Structure

```text
src/
  app.ts                       Express app assembly
  server.ts                    HTTP server entrypoint
  config/                      Environment, logger, Supabase client
  integrations/                LINE and HighLevel API clients
  middleware/                  JSON/raw body, errors, shared-secret auth
  routes/                      Health, LINE webhook, GHL webhook, admin routes
  services/                    Sync logic and Supabase repository helpers
  types/                       LINE, GHL, and HTTP types
supabase/
  migrations/                  SQL migration files
```

## Requirements

- Node.js 22 or newer.
- Supabase project.
- LINE Official Account Messaging API channel.
- HighLevel private integration token with Conversations access.
- HighLevel custom Conversation Provider configured for the target location.

## Environment Setup

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Important values:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: Supabase backend credentials. Use the service role key only on the server.
- `LINE_CHANNEL_SECRET`: Used to verify LINE webhook signatures.
- `LINE_CHANNEL_ACCESS_TOKEN`: Used to call LINE profile and push message APIs.
- `GHL_PRIVATE_INTEGRATION_TOKEN`: HighLevel / LeadConnector private integration token.
- `GHL_LOCATION_ID`: HighLevel location ID.
- `GHL_CUSTOM_PROVIDER_ID`: Your HighLevel custom Conversation Provider ID.
- `GHL_CUSTOM_PROVIDER_SECRET`: Optional shared secret for outbound webhooks from HighLevel.
- `WEBHOOK_SHARED_SECRET`: Optional shared secret for the admin mapping endpoint.

## Supabase Setup

Apply the migration in `supabase/migrations/202607020001_initial_schema.sql`.

Using the Supabase CLI:

```bash
supabase db push
```

Or paste the SQL migration into the Supabase SQL editor.

Seeing `Success. No rows returned` after running the migration is normal because the SQL creates schema objects and does not return table rows. RLS can be enabled on the tables; this backend uses `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS for server-side operations. Do not expose `SUPABASE_SERVICE_ROLE_KEY` publicly, in browser code, or in mobile apps.

## Install And Build

```bash
npm install
npm run build
```

Run locally:

```bash
npm run dev
```

Run the compiled service:

```bash
npm start
```

## Webhook URLs

Assuming `PUBLIC_BASE_URL=https://api.win-crm.ai`:

- LINE webhook URL: `https://api.win-crm.ai/webhooks/line/inbound`
- HighLevel outbound provider webhook URL: `https://api.win-crm.ai/webhooks/ghl/line/outbound`
- Health check: `https://api.win-crm.ai/health`
- Safe environment check: `https://api.win-crm.ai/debug/env-check`

The original route names still work:

- `POST /webhooks/line`
- `POST /webhooks/ghl/outbound`

## LINE Configuration

1. Open the LINE Developers Console.
2. Select your Messaging API channel.
3. Set the webhook URL to `https://api.win-crm.ai/webhooks/line/inbound`.
4. Enable webhooks.
5. Disable auto-reply settings if HighLevel should own replies.
6. Copy the channel secret and long-lived channel access token into `.env`.

LINE signatures are verified against the exact raw UTF-8 body, so do not put middleware or proxies in front of this service that rewrite JSON bodies before they reach Express.

## HighLevel Configuration

1. Create or open a private integration with Conversations permissions.
2. Configure a custom Conversation Provider for the target location.
3. Set the provider outbound webhook URL to `https://api.win-crm.ai/webhooks/ghl/line/outbound`.
4. If the provider supports a custom header or secret field, set it to `GHL_CUSTOM_PROVIDER_SECRET`.
5. Put the provider ID, location ID, private integration token, and API version into `.env`.

The inbound message client posts to:

```text
POST /conversations/messages/inbound
```

with the configured `Version` header. If your HighLevel account expects a different custom-provider payload shape, update `src/integrations/ghlClient.ts` in one place.

## Mapping A LINE User To A GHL Contact

Inbound LINE events create or update a `line_profiles` row. If that LINE user is already linked to a GHL contact, the message is forwarded to that contact. If no mapping exists yet, the middleware creates a new GHL contact using the LINE display name, saves the `line_user_id` to `ghl_contact_id` mapping in Supabase, then forwards the same inbound LINE message into GHL.

The admin endpoint remains available as an override tool. Use it when you want to attach a LINE user to an existing GHL contact or conversation:

```bash
curl -X POST https://api.win-crm.ai/admin/mappings \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $WEBHOOK_SHARED_SECRET" \
  -d '{
    "lineUserId": "Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "ghlContactId": "highlevel-contact-id",
    "ghlConversationId": "optional-existing-conversation-id"
  }'
```

Future LINE messages from that user will be forwarded to the linked GHL contact. Future GHL outbound webhooks for that contact or conversation will be pushed back to LINE.

## API Reference

### `GET /health`

Returns service health.

### `GET /debug/env-check`

Returns whether required environment variables are `present` or `missing`. Secret values are never returned.

### `POST /webhooks/line`

Receives LINE webhook events. Requires a valid `x-line-signature` header.

### `POST /webhooks/line/inbound`

Alias for `POST /webhooks/line`.

### `POST /webhooks/ghl/outbound`

Receives outbound HighLevel custom provider messages. If `GHL_CUSTOM_PROVIDER_SECRET` is configured, include it in either `x-provider-secret` or `x-ghl-secret`.

### `POST /webhooks/ghl/line/outbound`

Alias for `POST /webhooks/ghl/outbound`.

The parser accepts common payload fields:

- `message`, `body`, `text`, `message.body`, or `message.text`
- `contactId` or `contact.id`
- `conversationId` or `conversation.id`
- `messageId`, `id`, or `message.id`
- `attachments`

### `POST /admin/mappings`

Links a LINE user to a HighLevel contact/conversation. Requires `WEBHOOK_SHARED_SECRET`.

## Hugo Setup Guide

This is the shortest path for deploying Hugo's `api.win-crm.ai` middleware from a fresh account setup.

### Production Launch Checklist

1. Deploy this repository to Railway from the `main` branch.
2. Add all Railway environment variables from `.env.example` using real values in Railway only.
3. Open the Railway public URL and test `GET /health`.
4. Test `GET /debug/env-check` and confirm every required variable is `present`.
5. Connect the custom domain `api.win-crm.ai` in Railway.
6. Set the LINE Developers webhook URL to `https://api.win-crm.ai/webhooks/line/inbound`.
7. Set the GHL Conversation Provider Delivery URL to `https://api.win-crm.ai/webhooks/ghl/line/outbound`.
8. Send a real LINE message and confirm it creates or maps a GHL contact.
9. Reply from GHL and confirm the message is pushed back to LINE.

### 1. Deploy To Railway

1. Deploy the `main` branch in Railway.
2. In Railway, choose **New Project**.
3. Choose **Deploy from GitHub repo**.
4. Select `hugolamcloser/line-ghl-connect-middleware`.
5. Let Railway detect the Node.js app. The project builds with `npm install` and starts with `npm start`.
6. Open the Railway service settings and add your custom domain `api.win-crm.ai`.
7. Keep the generated Railway domain too. It is useful for testing before DNS is ready.

After deployment, test:

```text
GET https://api.win-crm.ai/health
GET https://api.win-crm.ai/debug/env-check
```

### 2. Create The Supabase Project

1. Go to Supabase and create a new project.
2. Save the project password somewhere safe.
3. Open **Project Settings** then **API**.
4. Copy the project URL into `SUPABASE_URL`.
5. Copy the service role key into `SUPABASE_SERVICE_ROLE_KEY`.

The service role key is powerful. Put it only in Railway environment variables, never in frontend code.

### 3. Run The Supabase SQL Migration

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Open `supabase/migrations/202607020001_initial_schema.sql` from this repo.
4. Paste the full SQL into Supabase.
5. Click **Run**.
6. `Success. No rows returned` is the expected result.
7. If you clicked **Run and enable RLS**, that is okay for this backend because it uses `SUPABASE_SERVICE_ROLE_KEY`.
8. Confirm these tables exist: `tenants`, `line_profiles`, `message_events`, and `webhook_events`.
9. Keep `SUPABASE_SERVICE_ROLE_KEY` only in Railway service variables. Never paste it into public docs, frontend code, or client apps.

### 4. Add Railway Environment Variables

Add these variables in Railway under your service's **Variables** tab:

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
GHL_PRIVATE_INTEGRATION_TOKEN=...
GHL_API_VERSION=2021-07-28
GHL_LOCATION_ID=...
GHL_CUSTOM_PROVIDER_ID=...
GHL_CUSTOM_PROVIDER_SECRET=...
WEBHOOK_SHARED_SECRET=...
```

Then open:

```text
https://api.win-crm.ai/debug/env-check
```

Every listed variable should show `present`. This endpoint never shows the actual secret values.

### 5. Get LINE Credentials

1. Open the LINE Developers Console.
2. Choose your provider and Messaging API channel.
3. In **Basic settings**, copy **Channel secret** into `LINE_CHANNEL_SECRET`.
4. In **Messaging API**, issue or copy the long-lived **Channel access token** into `LINE_CHANNEL_ACCESS_TOKEN`.
5. In **Messaging API**, set the webhook URL to:

```text
https://api.win-crm.ai/webhooks/line/inbound
```

6. Enable **Use webhook**.
7. Disable LINE auto-reply if HighLevel should handle the replies.

### 6. Get GHL Credentials

1. In HighLevel, open the target sub-account or location.
2. Create or open a private integration with Contacts and Conversations permissions.
3. Copy the private integration access token into `GHL_PRIVATE_INTEGRATION_TOKEN`.
4. Find the location ID in the location settings, business profile, or the HighLevel URL. Put it in `GHL_LOCATION_ID`.
5. Create or open your custom Conversation Provider for that location.
6. Copy the custom provider ID into `GHL_CUSTOM_PROVIDER_ID`.
7. If the provider lets you set a delivery secret, use the same value as `GHL_CUSTOM_PROVIDER_SECRET`.
8. Set the custom provider delivery URL to:

```text
https://api.win-crm.ai/webhooks/ghl/line/outbound
```

### 7. Test LINE To GHL

1. Confirm `/debug/env-check` shows all required variables as `present`.
2. Send a text message to the LINE Official Account from a real LINE user.
3. In Supabase, check that `line_profiles` has a row for that `line_user_id`.
4. If no GHL mapping existed, the middleware should create a new GHL contact with the LINE display name.
5. Confirm the same Supabase row now has `ghl_contact_id`.
6. Confirm the LINE message appears in the GHL conversation.

### 8. Test GHL To LINE

1. Open the GHL conversation that was created or mapped from LINE.
2. Send a reply from GHL.
3. GHL should POST to `https://api.win-crm.ai/webhooks/ghl/line/outbound`.
4. The middleware should find the Supabase mapping and push the reply to the LINE user.
5. Check `message_events` in Supabase if the message does not arrive.

### 9. Common Errors And Debugging

- `Invalid LINE signature`: Check `LINE_CHANNEL_SECRET`, confirm the webhook URL is exactly `/webhooks/line/inbound`, and make sure LINE is sending directly to the deployed service.
- `LINE API 401`: Check `LINE_CHANNEL_ACCESS_TOKEN`.
- `HighLevel API 401`: Check `GHL_PRIVATE_INTEGRATION_TOKEN` and private integration scopes.
- `HighLevel create contact response did not include a contact id`: The GHL create-contact response shape changed or the token cannot create contacts. Check the Railway logs and the HighLevel API response.
- `GHL_LOCATION_ID is required` or `GHL_CUSTOM_PROVIDER_ID is required`: Add the missing Railway variable and redeploy.
- GHL replies do not reach LINE: Confirm the GHL provider delivery URL is `/webhooks/ghl/line/outbound`, confirm `GHL_CUSTOM_PROVIDER_SECRET` matches if you use one, and confirm the GHL contact or conversation exists in `line_profiles`.
- Railway deploy is live but webhooks fail: Open `/health`, then `/debug/env-check`, then Railway logs. Fix missing variables first.

## Deployment Notes

- Deploy behind HTTPS. LINE and HighLevel webhooks should not target plain HTTP in production.
- Keep Supabase service role credentials server-side only.
- Preserve raw request bodies for LINE signature validation.
- Review message attachment handling before enabling binary media sync. This starter records non-text LINE messages as text placeholders.
- For multi-location deployments, extend `tenants` and route selection so each provider/channel pair can use distinct LINE and GHL credentials.

## Troubleshooting

- `Invalid LINE signature`: Verify `LINE_CHANNEL_SECRET`, webhook URL, and that no proxy reformats the request body.
- GHL contact was created for the wrong person: Link the LINE user to the correct existing contact through `/admin/mappings`.
- Outbound messages skipped: Confirm the GHL webhook payload includes a `contactId` or `conversationId` that exists in `line_profiles`.
- HighLevel API errors: Check `GHL_API_VERSION`, provider ID, location ID, token scopes, and the payload in `src/integrations/ghlClient.ts`.
