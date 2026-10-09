# ⛵ Sailor: an open-source GTM agent harness (Pi + Fiber AI)

Sailor turns the [Pi](https://github.com/badlogic/pi-mono) terminal agent into a harness for **sales reps, GTM engineers and recruiters**. You bring your own LLM and your own [Fiber AI](https://fiber.ai) API key. Then you chat to build outreach lists, repair messy contact lists, reveal contacts, and write grounded sales strategy and cold-call scripts. Sailor always shows what you're spending.

```
Fiber 48,210 cr │ session −132.5/500 │ ⧗ 1 job
> Find heads of RevOps at US B2B SaaS companies, 200–1000 employees, that raised in the last 12 months
  Parse ICP · Count matches (1,240 · ~1 cr) · Search people (25 · ~25 cr) → list "RevOps US" (/list revops-us)
> get work emails for the top 10          → "Spend ~20 credits on Fiber?" [y/N]
> /repair ./hubspot_export.csv --work-email   → pre-flight card → Mosaic job → healed CSV + list
> write 60-second cold-call scripts for them  → every fact cited, e.g. [latestFunding.stage]
> /export-list revops-us sheets --preset outreach  → Google Sheet link
```

## What's inside

| Brief item | Where it lives |
|---|---|
| Plug in your Fiber key and get all APIs | `/fiber login` (validated, stored in the OS keychain). About 20 typed tools, plus `fiber_find_operation` / `fiber_operation_docs` / `fiber_call` for any of the 200+ operations |
| Always-visible credit balance | Footer meter (`getOrgCredits` is free, refreshed after every charge and every 60 s), plus `/credits` ledger (estimated vs charged) |
| Built-in Fiber MCP | Zero-dependency Streamable-HTTP MCP bridge to `mcp.fiber.ai` (Core by default). `/fiber mcp core,v2,lite,off`. Pi has no MCP of its own |
| One-click enrich and repair | `/repair` and `fiber_repair_list`: local parsing (encoding, delimiter, header row, column roles), then **Kitchen Sink bulk** (≤50 rows) or **Mosaic** (async jobs, auto-split over 20k rows), then import into a list. In the list pane: `e` reveal, `v` validate, `r` re-resolve |
| Prospect/company panes and TUI components | `/list <id>`: virtualized table with sorting, filtering, multi-select, cards (tenure, local time, contacts with validity, funding, headcount sparkline) and one-key actions |
| Google Sheets export | `/export-list <list> sheets` (new, append or **upsert**; RAW input; sequencer presets) and `/import-list sheets <url>` |
| Skills/SDK for vibe-coding with Fiber | Skills: `fiber-sdk`, `sailor-gtm-engineering`, prospecting, list-repair, cold-call, sales-strategy, recruiting. `/mode engineer`, `/new-script` |

It also covers things the brief didn't ask for (see `docs/06_Edge_Cases_and_Gaps.md`):

- **Cost guard:** every paid call is estimated. Calls above a threshold ask first. Session and daily budgets, a per-turn call cap, dry-run mode, and a headless allowance.
- **Secrets:** your key is never shown to the LLM or written to logs, and pasted keys are redacted.
- **Data safety:** third-party data is wrapped as untrusted, and exports are protected against spreadsheet formula injection.
- **Outreach hygiene:** do-not-contact list, `/forget` for data-deletion requests, and recruiting fairness guardrails.
- **Reliability:** resumable jobs, cached contact reveals so you never pay twice, and rate-limit backoff.
- **Evals:** a scenario suite to run against several LLMs (see Tests & evals).

## Quick start

Requirements: **Node ≥ 22.13** and an LLM that Pi supports (Anthropic, OpenAI, Gemini, OpenRouter, Bedrock, local via OpenAI-compatible endpoints, …).

```bash
# 1) Pi (the agent harness)
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# 2a) From this repo (development)
git clone <this repo> sailor && cd sailor
npm install                         # dev deps for typecheck/tests (optional for running)
node packages/sailor-cli/bin/sailor.mjs            # onboarding + launches pi with Sailor loaded
#   …or directly: pi -e ./packages/pi-fiber/extensions/sailor

# 2b) As a Pi package (once published)
pi install npm:@sailor/pi-fiber
pi
```

In Pi: `/login` (or export `ANTHROPIC_API_KEY` etc.) for your LLM, then `/fiber login` for Fiber. `sailor doctor` checks everything.

### Commands

| Command | What it does |
|---|---|
| `/fiber login\|logout\|whoami\|use <profile>\|mcp <core,v2,lite,off>\|admin on\|off` | Account, key profiles, MCP bridge |
| `/credits` · `/budget session\|daily\|auto\|turn <n>` · `/dryrun on\|off` | Spend visibility and control |
| `/lists` · `/list <id>` · `/list rename\|delete` | Browse and act on lists (pane keys: `↑↓ space a ⏎ e v r d x S / s c q`) |
| `/repair <file\|url\|sheet> [--work-email] [--personal-email] [--phone] [--company] [--max-rows N] [--engine …] [--url PUBLIC_URL]` | Heal and enrich a list. `/repair hosting manual\|gdrive\|s3` |
| `/jobs [refresh\|cancel\|resume <id>]` | Async Mosaic and batch-reveal jobs (persisted, resumed on restart) |
| `/export-list <list> sheets\|csv\|xlsx [--preset …] [--mode upsert] [--sheet URL] [--valid-only]` | Export (do-not-contact rows are always excluded) |
| `/sheets connect [--device]\|client <id> <secret>\|status\|disconnect` | Google OAuth (scope `drive.file` only) |
| `/import-list csv <file>\|sheets <url>` | Import without spending credits |
| `/mode rep\|engineer\|recruiting` | Persona and tool set (rep mode hides shell and file-writing tools) |
| `/dnc add\|remove\|list` · `/forget <id>` · `/wipe` | Suppression and privacy |
| `/new-script <name>` · `/feedback` | Vibe-coding scaffold · local feedback notes |
| `/build` · `/plan` · `/sandbox [key sk_test_…]` · `/agent-mode` · `alt+m` | Agent mode: **Build** does the work; **Plan** is zero-spend (paid calls and write tools blocked, ends with "run in Build / try in Sandbox"); **Sandbox** runs on a Fiber sandbox key and never touches the live key. Also `--agent-mode` / `SAILOR_AGENT_MODE` |
| `/qualify [list] [criteria…] [--min 70]` | AI scores every row 0-100 with a reason (`list_score`), then copies the best fits into a new list |
| `/lookalikes [list] [--count 25]` | Infers the list's pattern (`list_profile`) and finds more like it with Fiber search, deduped against the seed list |
| `/emails [list] [--personal]` · `/phones` · `/contact-info` · `/socials [--refresh]` | Contact-info shortcuts for a whole list (same cost guard as the list pane; socials are read from stored Fiber data for free) |
| `/crm [connect hubspot\|salesforce\|attio\|custom <url>\|export [list] [--min-score N]\|disconnect]` | Links your CRM's own MCP server (Pi handles OAuth: `/mcp login <crm>`) and pushes lists to it; do-not-contact rows never leave |
| `/look fiber\|pi` | Fiber-branded terminal (wordmark header, mode chip + credits footer, purple spinner, `fiber-dark`/`fiber-light` themes) or Pi's stock look |
| Prompt templates: `/icp` `/callscript` `/sequence` `/account-plan` `/sourcing` `/tam` `/repair-list` | Ready-made workflows |

Flags for headless use (`pi -p`, `--mode json|rpc`): `--fiber-max-spend <credits>`, `--fiber-dry-run`, `--sailor-mode <mode>`. Without `--fiber-max-spend`, any paid call that needs approval is blocked in headless mode.

## Configuration

`~/.sailor/config.json`. A project-level `.sailor/config.json` overrides it, and creating a `.sailor/` folder also gives that project its own database.

```json
{
  "fiber": { "mcp": ["core"], "profile": "default" },
  "budget": { "autoApproveUnder": 25, "session": 500, "daily": 2000, "maxPaidCallsPerTurn": 10 },
  "toolsProfile": "full",
  "mode": "rep",
  "hosting": { "provider": "manual", "s3": { "endpoint": "https://<acct>.r2.cloudflarestorage.com", "region": "auto", "bucket": "sailor-tmp", "accessKeyIdEnv": "R2_KEY_ID", "secretAccessKeyEnv": "R2_SECRET", "ttlSeconds": 3600 } },
  "cache": { "profileTtlDays": 30, "contactTtlDays": 90 },
  "compliance": { "region": "US", "requireSuppressionCheck": true }
}
```

Environment variables:

- `FIBER_API_KEY` (or `FIBERAI_API_KEY`)
- `SAILOR_HOME`, `SAILOR_DB`
- `SAILOR_DRY_RUN=1`, `SAILOR_TOOLS_PROFILE=lite` (for small or local models), `SAILOR_MAX_SPEND`
- `SAILOR_GOOGLE_CLIENT_ID` / `SAILOR_GOOGLE_CLIENT_SECRET`
- `NODE_USE_ENV_PROXY=1` if you're behind a corporate proxy

### Google Sheets

Create an OAuth client of type **Desktop app** in Google Cloud Console and enable the Sheets and Drive APIs. Then run `/sheets client <id> <secret>` followed by `/sheets connect`. Sailor only requests `drive.file`, which covers files Sailor creates or you open with it. Over SSH, use `/sheets connect --device`, which needs a "TVs and Limited Input devices" client.

### Mosaic hosting

Mosaic fetches your file from a **public HTTPS URL**, so choose one of:

- **manual**: paste a link (for example a Sheet shared as "anyone with the link"), or pass `--url`.
- **gdrive**: Sailor uploads the file to your Drive with a temporary anyone-with-the-link permission, and revokes it once Mosaic starts processing.
- **s3**: S3 or R2 presigned URLs (1-hour TTL), deleted after Mosaic starts.

Uploading always asks for consent, because the file contains personal data.

## Repository layout

```
packages/pi-fiber/          # the Pi package (@sailor/pi-fiber)
  extensions/sailor/        # Pi entry point
  src/core/                 # zero-dependency core: Fiber client, op registry & pricing, cost policy, SQLite store,
                            #   CSV/normalizers, repair engine (Kitchen Sink + Mosaic), jobs, hosting (S3/Drive),
                            #   Google OAuth/Sheets, MCP client, export presets, grounding & fairness checks
  src/extension/            # Pi wiring: tools, cost guard, credit meter, commands, TUI (list pane, cards)
  skills/  prompts/         # GTM skills + prompt templates
  test/                     # unit, integration (mock Fiber), fake-Pi wiring and TUI tests
packages/sailor-cli/        # `sailor` launcher (onboarding, doctor, passthrough to pi)
evals/                      # mock Fiber API + MCP server, scenario suite, multi-model runner
examples/                   # messy CSV generator, domain list, SDK script, sailor.md playbook template
docs/                       # design docs 01–07 + 08 implementation status
```

## Tests and evals

```bash
cd packages/pi-fiber && npx tsx --tsconfig tsconfig.test.json --test test/*.test.ts   # 49 tests, no network
npm run typecheck                                         # against the real Pi packages (after npm install)
npm run mock:fiber                                        # local mock Fiber API on :4455
EVAL_MODELS="anthropic/claude-sonnet-4-5,openai/gpt-5" npm run evals   # needs pi + LLM keys; Fiber is mocked
```

## Design notes

- **Why not a Pi fork?** Everything ships as a Pi package, so Pi upgrades flow through. The launcher is optional.
- **Why the REST client and not `@fiberai/sdk` at runtime?** One choke point for key injection, rate limits, retries that know which calls are safe to repeat, and `chargeInfo` accounting across all 200+ operations, including ones the SDK doesn't wrap yet. The SDK is what Sailor teaches for vibe-coding (skills, `/new-script`, examples).
- **Why local SQLite?** Lists must survive Pi session branches and restarts, and full Fiber payloads are 44+ fields per person. The LLM gets handles and trimmed fields instead (see `docs/06`, A5).

## License

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
