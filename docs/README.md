# Sailor documentation

Sailor is an open-source GTM agent harness for sales reps, GTM engineers and recruiters, built on the [Pi](https://github.com/badlogic/pi-mono) terminal agent and the [Fiber AI](https://fiber.ai) API. Start with the [README](../README.md) for the overview.

## Using Sailor

| Guide | What it covers |
|---|---|
| [Getting started](guide/getting-started.md) | Prerequisites, install, offline mock run, sandbox run, going live with a budget, first session |
| [User guide](guide/user-guide.md) | Core concepts (lists, credits and the cost guard, personas, agent modes) and every workflow: prospecting, contacts, qualify and lookalikes, repair, outreach, strategy, export, CRM, recruiting, the long tail of Fiber, SDK scripts, headless use, privacy |
| [Command reference](guide/commands.md) | Every slash command, option, prompt template, shortcut, list-pane key, CLI flag and launcher command |
| [Configuration](guide/configuration.md) | Config files and every setting, environment variables, keys and profiles, Google Sheets, Mosaic hosting, CRMs, `sailor.md`, where data lives |
| [Troubleshooting & FAQ](guide/troubleshooting.md) | Common errors and fixes, FAQ, reset and uninstall |

## Building on Sailor

| Guide | What it covers |
|---|---|
| [AGENTS.md](../AGENTS.md) | Orientation for coding agents and contributors: repo map, hard rules, where to change what, style |
| [Architecture](developer/architecture.md) | Packages and layers, lifecycle, a paid call end to end, `FiberClient`, data model, jobs, tool gating, security model |
| [Extending Sailor](developer/extending.md) | Recipes: Fiber operations, tools, commands, skills, prompt templates, export presets, CRMs, sandbox gaps, eval scenarios, using the core from scripts |
| [Testing & evals](developer/testing.md) | Test suites, stubs, mock server, typecheck, agent evals, CI |
| [Releasing](developer/releasing.md) | Release checklist and known pre-release items |
| [Tool reference](reference/tools.md) | Every tool the agent can call, with cost and availability |
| [Contributing](../CONTRIBUTING.md) · [Security](../SECURITY.md) · [Changelog](../CHANGELOG.md) | |

## Demo material

| File | What it is |
|---|---|
| [demo/sandbox-runbook.md](demo/sandbox-runbook.md) | Copy-paste runbook for a demo on a Fiber sandbox key |
| [demo/demo-video-plan.md](demo/demo-video-plan.md) | Plan for a 4–5 minute demo video: scenes, what to type, recording |
| [demo/video-script.md](demo/video-script.md) | Timestamped voiceover for the sandbox demo |

Scripts live in [`demo/`](../demo/): `run-demo.sh` (mock), `sandbox-demo.sh` (sandbox), `probe-sandbox.sh`, `demo.tape` (VHS).

## Design documents

The original design, written before implementation. They explain *why* Sailor is shaped the way it is; where they differ from the code, the guides above and the code are current.

| # | Document | Covers |
|---|---|---|
| 01 | [Problem statement](01_Problem_Statement.md) | Users, jobs to be done, goals, non-goals, success criteria |
| 02 | [Research findings](02_Research_Findings.md) | Fiber MCP, Kitchen Sink, Mosaic, the SDK, the API catalog, billing, Pi |
| 03 | [Architecture (design)](03_Architecture.md) | Planned system design, data model and flows |
| 04 | [Feature specs](04_Feature_Specs.md) | One spec per feature, with acceptance criteria |
| 05 | [Implementation plan](05_Implementation_Plan.md) | Phased plan and code skeletons |
| 06 | [Edge cases and gaps](06_Edge_Cases_and_Gaps.md) | Cost, security, compliance, data quality and failure modes (ids like A5, C9 referenced in code) |
| 07 | [Testing and demo](07_Testing_and_Demo.md) | Test strategy, evals, dogfooding, demo script |
| 08 | [Implementation status](08_Implementation_Status.md) | What was built (v0.1), feature → code map, edge-case coverage, assumptions to verify |

## Fiber facts at a glance

- API base URL `https://api.fiber.ai`; MCP at `https://mcp.fiber.ai` (`/mcp` Core, `/mcp/v2`, `/mcp/lite`).
- Keys: `sk_live_…` (live) and `sk_test_…` (sandbox, never charged). Create them at [fiber.ai/app/api](https://fiber.ai/app/api).
- Credit balance: `GET /v1/get-org-credits`, free.
- Every paid response carries `chargeInfo`, the authoritative record of what was billed.
- Kitchen Sink: synchronous resolve from messy identifiers; bulk endpoints take up to 50 per call.
- Mosaic: async CSV healing from a public HTTPS URL, up to 20,000 rows and 50 MiB per run; poll no faster than every 30 s.
- Per-operation agent docs: `https://api.fiber.ai/ai-docs/<operationId>.md`.
