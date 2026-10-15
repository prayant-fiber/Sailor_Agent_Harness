# Changelog

All notable changes to Sailor. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Complete documentation set: user guide, command and tool references, configuration, troubleshooting, developer guides (architecture, extending, testing, releasing), `AGENTS.md`, `SECURITY.md` and this changelog (FIB-20642).

### Changed

- `RUNNING.md` became [docs/guide/getting-started.md](docs/guide/getting-started.md); demo runbooks moved to [docs/demo/](docs/demo/).

## [0.1.0] - pre-release

First implementation of the design in `docs/01`–`docs/07`.

### Added

- **Pi package `@sailor/pi-fiber`**: ~30 typed Fiber tools, generic `fiber_find_operation` / `fiber_operation_docs` / `fiber_call`, and a Fiber MCP bridge (Core by default) behind the cost guard.
- **Cost guard and credit meter**: estimates for every paid call, approval prompts, session/daily budgets, per-turn cap, dry run, headless allowance, ledger of estimated vs charged (`/credits`, `/budget`, `/dryrun`).
- **Lists**: local SQLite store, `/lists` and `/list` pane with cards and one-key actions, import from CSV/XLSX/Sheets.
- **List repair**: local pre-flight (encodings, delimiters, preamble, column roles), Kitchen Sink bulk and Mosaic jobs with Drive/S3 hosting, resumable jobs (`/repair`, `/jobs`).
- **Export**: Google Sheets (new/append/upsert), CSV, XLSX with sequencer presets; formula-injection escaping.
- **Prospecting shortcuts** (FIB-20428): `/qualify`, `/lookalikes`, `/emails`, `/phones`, `/contact-info`, `/socials`.
- **CRM export** (FIB-20427): `/crm` links HubSpot, Salesforce, Attio or any MCP server and pushes lists through it.
- **Agent modes** (FIB-20426): Build, Plan (zero spend) and Sandbox (Fiber sandbox key), with `Alt+M`.
- **Fiber sandbox support**: sandbox keys, local handling of unsandboxed operations, sandbox-aware prompt.
- **Fiber look**: branded header, footer, spinner and `fiber-dark` / `fiber-light` themes (`/look`).
- **Personas**: `rep`, `engineer` (coding tools, `fiber-sdk` skill, `/new-script`), `recruiting` (fairness guardrails).
- **Skills and prompt templates** for prospecting, list repair, cold calls, sales strategy, recruiting, GTM engineering and the Fiber SDK.
- **Safety**: keychain storage, key and token redaction, untrusted-data wrapping, do-not-contact list, `/forget`, `/wipe`.
- **`sailor` launcher** (`sailor-gtm`): onboarding, `login`, `doctor`, theming, passthrough to Pi.
- **Tests and evals**: unit, integration (mock Fiber), fake-Pi wiring and TUI tests; mock Fiber API + MCP server; agent scenarios E1–E10 with a multi-model runner; CI.
