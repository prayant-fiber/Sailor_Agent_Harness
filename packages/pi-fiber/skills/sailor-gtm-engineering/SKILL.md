---
name: sailor-gtm-engineering
description: Build repeatable GTM automations on Fiber — enrichment pipelines, scheduled re-enrichment of Sheets/CSVs, CRM hygiene scripts, webhooks and signal monitors — using the @fiberai/sdk TypeScript SDK. Use in engineer mode when the user wants code, scripts, pipelines or scheduled jobs.
---

# GTM engineering (use `/mode engineer`)

## Principles
- Scripts use `@fiberai/sdk` (see the `fiber-sdk` skill). Start from `/new-script <name>` which includes a dry-run flag and a spend confirmation.
- Key from `process.env.FIBER_API_KEY` (or `FIBERAI_API_KEY`) — never hard-code or print it.
- Log every `chargeInfo`; keep a running total and stop at a budget.
- Async ops (Mosaic, batch contact reveal, exhaustive reveal, audiences): poll **no faster than every 30 s**; persist task/run ids so a crash can resume.
- Idempotency: never blindly retry a paid call after a timeout — check results first.
- Respect per-route rate limits (`GET /v1/rate-limits`, free). Back off on 429.
- Bulk: Kitchen Sink bulk ≤ 50 per request; batch contact reveal ≤ 2,000 per request; Mosaic ≤ 20,000 rows / 50 MiB per run.

## Patterns
- **Weekly re-enrich a Sheet**: read rows → dedupe by LinkedIn/email → Kitchen Sink bulk for changed rows only → reveal missing work emails → validate → upsert back (see `examples/scripts/weekly_reenrich.ts`).
- **Inbound lead routing**: webhook/form → `KitchenSinkProfile` with email → company via `kitchenSinkCompany` → score → CRM.
- **Signals**: Tracker lists (`fiber_tracker`) or saved searches; webhook endpoints (`fiber_find_operation "webhook"`) to push signals to Slack/CRM.
- **Scheduling**: cron / GitHub Actions running `pi -p --mode json -e <sailor> --fiber-max-spend 200 "…"` or plain `tsx` scripts.

## Before running anything that spends credits
Tell the user the estimated cost and that scripts run via bash bypass Sailor's interactive cost guard; get explicit consent.
