# ⛵ Sailor: an open-source GTM agent harness (Pi + Fiber AI)

Sailor turns the [Pi](https://github.com/badlogic/pi-mono) terminal agent into a workspace for **sales reps, GTM engineers and recruiters**. You bring your own LLM and your own [Fiber AI](https://fiber.ai) API key, then chat to build prospect lists, repair messy CSVs, reveal and validate contacts, and write grounded outreach. The footer always shows what you're spending, and every paid call goes through a cost guard first.

```
Fiber 48,210 cr │ session −132.5/500 │ ⧗ 1 job
> Find heads of RevOps at US B2B SaaS companies, 200–1000 employees, that raised in the last 12 months
  Parse ICP · Count matches (1,240 · ~1 cr) · Search people (25 · ~25 cr) → list "RevOps US"  (/list revops-us)
> get work emails for the top 10              → "Spend ~20 credits on Fiber?" [y/N]
> /repair ./hubspot_export.csv --work-email   → pre-flight card → Kitchen Sink or Mosaic → healed list
> write 60-second cold-call scripts for them  → every fact cited, e.g. [latestFunding.stage]
> /export-list revops-us sheets --preset outreach   → Google Sheet link
```

> **Status: v0.1, pre-release.** The test suite and typecheck pass and the full flow has been run against the Fiber sandbox. Start with the offline mock or a sandbox key (see [Getting started](docs/guide/getting-started.md)) and set a small budget before your first live run.

## Quick start

You need **Node.js ≥ 22.13**, an LLM key for any provider Pi supports (Anthropic, OpenAI, Gemini, OpenRouter, Bedrock, local OpenAI-compatible endpoints…) and a Fiber API key from [fiber.ai/app/api](https://fiber.ai/app/api).

```bash
# 1. Pi, the agent harness Sailor plugs into
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# 2. Sailor, from this repo
git clone https://github.com/prayant-fiber/Sailor_Agent_Harness.git sailor && cd sailor
npm install
npm test

# 3. Your LLM key (or run /login inside Pi for a Claude/ChatGPT subscription)
export ANTHROPIC_API_KEY=sk-ant-...

# 4. Launch: asks for your Fiber key on first run, then opens Pi with Sailor loaded
npm run sailor
```

Then, inside Sailor:

```
/budget session 100        # cap this session's spend
/budget auto 10            # anything estimated above 10 credits asks first
What's my Fiber credit balance?
Find 10 VPs of Sales at Series B fintech companies in London
/lists
```

Want to try it without spending anything? Run `npm run mock:fiber` and follow [the offline walkthrough](docs/guide/getting-started.md#5-try-it-offline-against-the-mock-fiber-api), or switch to a Fiber sandbox key with `/sandbox`.

## What Sailor does

| | |
|---|---|
| **Prospecting** | Plain-English ICP → Fiber filters → cheap count → paged search into a local list. `/lookalikes` finds more rows like a list you already have; `/qualify` scores every row 0–100 against your criteria |
| **Contacts** | Reveal work/personal emails and phones (`/emails`, `/phones`, `/contact-info` or the list pane), validate deliverability, cache results so you never pay twice |
| **List repair** | `/repair <csv\|xlsx\|sheet>` detects encoding, delimiter, header row and column roles locally, then resolves rows with Kitchen Sink (≤ 50 rows) or Mosaic (async, up to 20k rows per run) |
| **List panes** | `/list <id>`: a sortable, filterable table with prospect/company cards and one-key actions (reveal, validate, re-resolve, export) |
| **Outreach** | Cold-call scripts, sequences, account plans and TAM sizing grounded in stored Fiber facts, with inline citations that Sailor checks |
| **Export** | Google Sheets (new, append or upsert), CSV and XLSX with presets for Apollo, HubSpot, Salesloft, Instantly and Smartlead; push to HubSpot, Salesforce or Attio over their MCP servers with `/crm` |
| **Every Fiber API** | ~30 typed tools, plus `fiber_find_operation` / `fiber_call` and a built-in Fiber MCP bridge for the 200+ operations without a dedicated tool |
| **Spend control** | Live credit meter, estimates before every paid call, session/daily budgets, per-turn call cap, dry-run, Plan mode (zero spend) and Sandbox mode (sample data, nothing charged) |
| **Safety** | Keys live in the OS keychain and are redacted everywhere; third-party data is marked untrusted; do-not-contact list, `/forget`, recruiting fairness guardrails, formula-injection-safe exports |
| **Vibe-coding** | `/mode engineer` + the `fiber-sdk` skill + `/new-script` to build scripts on `@fiberai/sdk` |

## Documentation

**Using Sailor**

- [Getting started](docs/guide/getting-started.md): install, connect your LLM and Fiber, first session, offline mock and sandbox
- [User guide](docs/guide/user-guide.md): core concepts and every workflow (prospecting, repair, contacts, outreach, export, CRM, recruiting)
- [Command reference](docs/guide/commands.md): every slash command, flag, shortcut and list-pane key
- [Configuration](docs/guide/configuration.md): `config.json`, environment variables, Google Sheets, Mosaic hosting, CRMs, where data lives
- [Troubleshooting & FAQ](docs/guide/troubleshooting.md)

**Building on Sailor**

- [AGENTS.md](AGENTS.md): orientation for coding agents and contributors (start here)
- [Architecture](docs/developer/architecture.md): how the pieces fit, request lifecycle, data model
- [Extending Sailor](docs/developer/extending.md): add a Fiber operation, tool, command, skill, CRM or export preset
- [Testing & evals](docs/developer/testing.md) · [Releasing](docs/developer/releasing.md)
- [Tool reference](docs/reference/tools.md): every tool the agent can call, with costs
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

The original design docs (problem statement, research, specs, edge cases, implementation status) are indexed in [docs/README.md](docs/README.md).

## Repository layout

```
packages/pi-fiber/       the Pi package (@sailor/pi-fiber): extension, core, skills, prompts, themes, tests
packages/sailor-cli/     the `sailor` launcher (onboarding, login, doctor, passthrough to pi)
evals/                   mock Fiber API + MCP server, agent scenarios E1–E10, multi-model runner
examples/                messy-CSV generator, domain list, SDK script, sailor.md playbook template
demo/                    demo launch scripts, sandbox probe, VHS tape, demo workspace
docs/                    user guide, developer guide, reference, design docs
types/shims/             minimal Pi type shims for offline typechecking
```

## Design notes

- **A Pi package, not a fork.** Everything ships as a Pi extension, so Pi upgrades flow through. The `sailor` launcher is a convenience.
- **Its own REST client instead of `@fiberai/sdk` at runtime.** One choke point for key injection, rate limits, retries that know which calls are safe to repeat, and `chargeInfo` accounting across all 200+ operations, including ones the SDK doesn't wrap yet. The SDK is what Sailor teaches for vibe-coding.
- **A local SQLite store.** Lists survive Pi session branches and restarts, and full Fiber payloads (44+ fields per person) stay out of the model's context. The model works with list handles and trimmed fields.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
