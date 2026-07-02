# LINE to GoHighLevel Conversation Middleware

Node.js, Express, TypeScript, and Supabase middleware for syncing LINE Official Account conversations with GoHighLevel Conversations through a custom Conversation Provider.

The service accepts inbound LINE webhooks, validates the `x-line-signature` HMAC, maps LINE users to GHL contacts/conversations in Supabase, forwards inbound messages into HighLevel, receives outbound provider webhooks from HighLevel, and pushes replies back to LINE.

## What Is Included

- Express API with typed route handlers.
- LINE webhook signature verification using the raw request body.
- LINE profile lookup and push message support.
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

The backend uses the service role key, so row level security policies are not required for this server-only integration. Do not expose the service role key to browsers or mobile clients.

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

Assuming `PUBLIC_BASE_URL=https://example.com`:

- LINE webhook URL: `https://example.com/webhooks/line`
- HighLevel outbound provider webhook URL: `https://example.com/webhooks/ghl/outbound`
- Health check: `https://example.com/health`

## LINE Configuration

1. Open the LINE Developers Console.
2. Select your Messaging API channel.
3. Set the webhook URL to `/webhooks/line`.
4. Enable webhooks.
5. Disable auto-reply settings if HighLevel should own replies.
6. Copy the channel secret and long-lived channel access token into `.env`.

LINE signatures are verified against the exact raw UTF-8 body, so do not put middleware or proxies in front of this service that rewrite JSON bodies before they reach Express.

## HighLevel Configuration

1. Create or open a private integration with Conversations permissions.
2. Configure a custom Conversation Provider for the target location.
3. Set the provider outbound webhook URL to `/webhooks/ghl/outbound`.
4. If the provider supports a custom header or secret field, set it to `GHL_CUSTOM_PROVIDER_SECRET`.
5. Put the provider ID, location ID, private integration token, and API version into `.env`.

The inbound message client posts to:

```text
POST /conversations/messages/inbound
```

with the configured `Version` header. If your HighLevel account expects a different custom-provider payload shape, update `src/integrations/ghlClient.ts` in one place.

## Mapping A LINE User To A GHL Contact

Inbound LINE events create or update a `line_profiles` row. Messages are not forwarded into HighLevel until that LINE user is linked to a GHL contact, because HighLevel conversations need a contact context.

After a LINE user messages the account, find their `line_user_id` in Supabase, then link it:

```bash
curl -X POST https://example.com/admin/mappings \
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

### `POST /webhooks/line`

Receives LINE webhook events. Requires a valid `x-line-signature` header.

### `POST /webhooks/ghl/outbound`

Receives outbound HighLevel custom provider messages. If `GHL_CUSTOM_PROVIDER_SECRET` is configured, include it in either `x-provider-secret` or `x-ghl-secret`.

The parser accepts common payload fields:

- `message`, `body`, `text`, `message.body`, or `message.text`
- `contactId` or `contact.id`
- `conversationId` or `conversation.id`
- `messageId`, `id`, or `message.id`
- `attachments`

### `POST /admin/mappings`

Links a LINE user to a HighLevel contact/conversation. Requires `WEBHOOK_SHARED_SECRET`.

## Deployment Notes

- Deploy behind HTTPS. LINE and HighLevel webhooks should not target plain HTTP in production.
- Keep Supabase service role credentials server-side only.
- Preserve raw request bodies for LINE signature validation.
- Review message attachment handling before enabling binary media sync. This starter records non-text LINE messages as text placeholders.
- For multi-location deployments, extend `tenants` and route selection so each provider/channel pair can use distinct LINE and GHL credentials.

## Troubleshooting

- `Invalid LINE signature`: Verify `LINE_CHANNEL_SECRET`, webhook URL, and that no proxy reformats the request body.
- `Missing GHL contact mapping`: Link the LINE user through `/admin/mappings`.
- Outbound messages skipped: Confirm the GHL webhook payload includes a `contactId` or `conversationId` that exists in `line_profiles`.
- HighLevel API errors: Check `GHL_API_VERSION`, provider ID, location ID, token scopes, and the payload in `src/integrations/ghlClient.ts`.
