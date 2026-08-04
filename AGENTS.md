# AGENTS.md

## Project identity

This repository is `line-ghl-connect-middleware`, the Win-CRM multi-channel messaging middleware.

It contains the existing LINE Official Account integration, HighLevel / GoHighLevel conversation integration, and tenant-aware provider configuration. A future Taiwan SMS integration is planned but is not yet implemented.

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

The following existing LINE capabilities are also protected and must remain unaffected:

- LINE inbound and outbound messages.
- LINE Workflow Action delivery.
- LINE native image, video, and PDF attachments.
- LINE tenant and channel mapping.
- LINE contact reconciliation.
- HighLevel inbox mirroring for LINE conversations.

Do not refactor existing LINE routes or modules unless an approved task makes that change necessary and includes a compatibility and rollback plan.

## Architecture rules

- Keep tenant mapping, LINE channel mapping, and contact/profile mapping clearly separated.
- Do not assume one global LINE channel token for all tenants.
- Keep LINE and SMS modules, routes, webhooks, provider clients, credentials, sender identities, mappings, and configuration clearly separated.
- Do not route SMS through LINE-specific code or reuse LINE credentials, identifiers, webhook verification, or delivery state for SMS.
- Do not assume every tenant uses the same messaging channel, provider, credentials, sender number, or provider configuration.
- Resolve provider and channel configuration for the exact tenant before any future message send or inbound processing.
- Keep shared abstractions channel-neutral. Channel-specific validation, payloads, provider errors, retries, and delivery behavior must remain in their channel boundary.
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

## Taiwan SMS pilot governance

- Follow [`docs/taiwan-sms-pilot-plan.md`](docs/taiwan-sms-pilot-plan.md) for the approved phase order and boundaries.
- Handle every pilot phase as a separate GitHub task and pull request.
- Do not begin SMS runtime implementation until the provider feasibility and API contract phase is complete and approved.
- Do not add provider credentials, send live SMS messages, or infer production configuration during planning or development.
- Use [`docs/agent-run-log-template.md`](docs/agent-run-log-template.md) to record autonomous task evidence and decisions.

## Agent authority and autonomy boundaries

Unless a task grants less authority, Level 3 permits the agent to:

- Read code and documentation.
- Inspect logs supplied inside the development environment, with secrets and customer data excluded.
- Research technical requirements.
- Create implementation plans.
- Create an isolated branch when the task does not already specify a branch.
- Change in-scope code or documentation.
- Run tests and correct in-scope validation failures.
- Commit changes and open a pull request.

Level 3 does not permit the agent to:

- Merge a pull request.
- Deploy to Railway or any other environment.
- Change production environment variables or configuration.
- Execute production database migrations.
- Access customer or other production data.
- Send live LINE or SMS messages.
- Use production provider credentials.
- Perform unrelated work, including personal finance tasks.

## Agent budget and stop rules

- Work on a maximum of one active coding task at a time.
- Use at most two implementation correction loops.
- Use at most one reviewer correction loop.
- Do not attempt the same failed solution twice without meaningful new evidence.
- Stop when the same error occurs twice without meaningful progress.
- Stop when requirements conflict.
- Stop when production access or production credentials are required.
- Stop when provider documentation is insufficient to establish a safe contract.
- Stop when a database schema change becomes necessary and report the required decision instead of changing the schema.
- Stop when the task expands significantly beyond its approved scope.
- Never merge or deploy automatically.

## Coding workflow

Before coding:

1. Restate the task.
2. Identify affected files.
3. Identify risk to existing working flows.
4. Explain the smallest safe implementation plan.
5. Do not code until the plan is clear.

After coding:

1. Run `npm run typecheck`.
2. Run `npm test`.
3. Run `npm run build`.
4. Confirm all three commands pass before declaring the task complete.
5. Summarize changed files.
6. Summarize testing performed.
7. Mention anything not tested.
8. Mention required manual smoke tests if applicable.

## Commands

At minimum, run:

```bash
npm run typecheck
npm test
npm run build
```
