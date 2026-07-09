# AGENTS.md

## Project identity

This repository is `line-ghl-connect-middleware`.

It is a production-oriented middleware for syncing LINE Official Account messages, LINE workflow actions, and GoHighLevel / HighLevel custom conversation provider logic.

The project is used for Win-CRM / GHL Marketplace use cases and is deployed on Railway.

## Tech stack

- Node.js 22+
- Express
- TypeScript
- Supabase
- LINE Messaging API
- HighLevel / GoHighLevel Marketplace App
- Railway

## Non-negotiable safety rules

- Do not expose secrets in code, logs, comments, examples, or test output.
- Never log full access tokens, refresh tokens, LINE channel secrets, webhook secrets, Supabase service keys, or GHL credentials.
- Do not hardcode tenant IDs, location IDs, channel access tokens, or webhook secrets.
- Do not change production environment variable names unless explicitly requested.
- Do not refactor unrelated files.
- Keep every PR small and focused.
- Do not make broad architecture rewrites unless explicitly requested.

## Current working flows that must not regress

These flows are known working and must be preserved:

1. `/health`
2. Legacy LINE inbound route: `/webhooks/line/inbound`
3. Legacy GHL outbound route: `/webhooks/ghl/line/outbound`
4. GHL Workflow Action route: `/webhooks/ghl/workflows/send-line`
5. Channel-aware LINE inbound route: `/webhooks/line/:webhookKey/inbound`
6. LINE Connect Page / Custom Page: `/connect/line`

Do not break these routes unless the user explicitly approves a migration plan.

## Architecture rules

- Keep tenant mapping, LINE channel mapping, and contact/profile mapping clearly separated.
- Do not assume one global LINE channel token for all tenants.
- Use Supabase as the source of truth for tenant, channel, and LINE profile mappings.
- Validate external webhook payloads defensively.
- External webhook handlers should fail safely and return predictable responses.
- Avoid duplicate LINE message sends.
- Avoid duplicate GHL contact or conversation creation.

## Supabase / database rules

Before changing database schema:

1. Explain the reason.
2. List affected tables.
3. Explain whether existing rows need migration.
4. Provide rollback notes.
5. Avoid destructive migrations unless explicitly approved.

Important tables:

- `tenants`
- `line_channels`
- `line_profiles`

Do not rename or remove existing columns without a migration and compatibility plan.

## GHL / HighLevel rules

- Keep GHL provider and conversation provider logic tenant-aware.
- Preserve required response formats for Marketplace Workflow Actions.
- When adding inbox mirroring, separate:
  - LINE inbound receive
  - GHL contact lookup/match
  - GHL conversation/message creation
  - error handling and retry behavior

## LINE rules

- Verify LINE webhook signatures where required.
- Use the correct LINE channel secret/access token for the specific LINE channel.
- Do not push messages unless tenant/channel/profile mapping is confirmed.
- Log LINE API errors safely without exposing tokens.

## Coding workflow

Before coding:

1. Restate the task.
2. Identify affected files.
3. Identify risk to existing working flows.
4. Explain the smallest safe implementation plan.
5. Do not code until the plan is clear.

After coding:

1. Run `npm run typecheck`.
2. Run `npm run build`.
3. Summarize changed files.
4. Summarize testing performed.
5. Mention anything not tested.
6. Mention required manual smoke tests if applicable.

## Commands

At minimum, run:

```bash
npm run typecheck
npm run build
