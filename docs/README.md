# Sailor — Open-Source GTM Agent Harness (built on Pi + Fiber AI)

> Working name: **Sailor** (from the project folder `Sailor_Agent_Harness`).
> A terminal-first agent harness for **sales reps, GTM engineers, and recruiters**. Users bring their own LLM and their own Fiber AI API key, then chat to build outreach lists, sales strategies, and cold-call scripts.

## Document map

| # | File | What it covers |
|---|------|----------------|
| 01 | [01_Problem_Statement.md](01_Problem_Statement.md) | The brief restated in detail: users, jobs-to-be-done, goals, non-goals, success criteria |
| 02 | [02_Research_Findings.md](02_Research_Findings.md) | Everything pulled from the linked docs: Fiber MCP, Kitchen Sink, Mosaic CSV healing, TypeScript SDK, full API catalog, billing, and the Pi harness |
| 03 | [03_Architecture.md](03_Architecture.md) | System design, repo layout, data model, key flows (diagrams) |
| 04 | [04_Feature_Specs.md](04_Feature_Specs.md) | One spec per feature in the brief (plus the ones the brief missed): commands, tools, UI, acceptance criteria |
| 05 | [05_Implementation_Plan.md](05_Implementation_Plan.md) | Phased build plan with tasks, code skeletons, estimates, and a hackathon cut |
| 06 | [06_Edge_Cases_and_Gaps.md](06_Edge_Cases_and_Gaps.md) | Cases the brief does not mention: cost safety, security, compliance, data quality, failure modes |
| 07 | [07_Testing_and_Demo.md](07_Testing_and_Demo.md) | Test strategy, evals, dogfooding plan, demo script |
| 08 | [08_Implementation_Status.md](08_Implementation_Status.md) | **What was built**: feature → code map, edge-case coverage, corrections to 02–05, unverified assumptions, next steps |

> The code lives in this repo (see the root [README](../README.md)). Docs 01–07 are the original design; doc 08 records how the implementation followed or changed it.

## One-paragraph summary

Fork/extend the **Pi coding agent** (`@earendil-works/pi-coding-agent`), which has a small core, 25+ LLM providers, and a strong extension API (custom tools, slash commands, TUI components, status bar, widgets, skills, packages). Ship Sailor as a **Pi package** (`pi install npm:@sailor/pi-fiber`) plus a thin branded launcher. It includes: (1) typed Fiber tools built on `@fiberai/sdk`, (2) the Fiber MCP (`https://mcp.fiber.ai/mcp/v2` or `/mcp` Core) as a fallback for the long tail of 200+ operations, (3) a live **credit meter** in the footer, (4) TUI **prospect/company panes**, (5) one-command **list repair** through Kitchen Sink bulk + Mosaic, (6) **Google Sheets export/import**, and (7) GTM **skills/playbooks** for sales, GTM engineering, and recruiting. It also adds a **cost-guard** that the brief doesn't mention: it estimates cost, asks for confirmation, and enforces budgets before any paid call.

## Key facts at a glance

- Fiber base URL: `https://api.fiber.ai` (auth via `apiKey` in body/query, or `x-api-key` / `Authorization: Bearer` header). Keys look like `sk_live_...`.
- Credit balance: `GET /v1/get-org-credits?apiKey=...`. Free, 120 req/min. Returns `max`, `used`, `available`, `usagePeriodResetsOn`, `creditsPerOperation`.
- Every paid response carries `chargeInfo`, the authoritative record of what was billed.
- Kitchen Sink: `POST /v1/kitchen-sink/person`, `/company`, `/bulk/profile`, `/bulk/company` (sync; bulk max 50 per call).
- Mosaic CSV healing: `POST /v1/mosaic/start` (public HTTPS file URL, ≤50 MiB, ≤20,000 rows) → `POST /v1/mosaic/poll` (free) → `outputCsvUrl` and `reportUrl` (temporary links).
- Pi has **no built-in MCP** by design. MCP comes either from an extension we write or from the community `pi-mcp-adapter` package.
