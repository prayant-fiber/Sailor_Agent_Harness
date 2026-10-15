# User guide

How Sailor works and how to do each job with it. For exact syntax see the [command reference](commands.md); for settings see [configuration](configuration.md).

**Contents**

- [Core concepts](#core-concepts)
  - [Chat, tools and slash commands](#chat-tools-and-slash-commands)
  - [Lists and the local store](#lists-and-the-local-store)
  - [Credits, estimates and the cost guard](#credits-estimates-and-the-cost-guard)
  - [Personas: rep, engineer, recruiting](#personas-rep-engineer-recruiting)
  - [Agent modes: Build, Plan, Sandbox](#agent-modes-build-plan-sandbox)
- [Workflows](#workflows)
  - [Build a prospect list from an ICP](#build-a-prospect-list-from-an-icp)
  - [Look up one person or company](#look-up-one-person-or-company)
  - [Work a list in the list pane](#work-a-list-in-the-list-pane)
  - [Reveal and validate contacts](#reveal-and-validate-contacts)
  - [Qualify a list and find lookalikes](#qualify-a-list-and-find-lookalikes)
  - [Repair and enrich a messy list](#repair-and-enrich-a-messy-list)
  - [Write grounded outreach](#write-grounded-outreach)
  - [Sales strategy: TAM, account plans, sequences](#sales-strategy-tam-account-plans-sequences)
  - [Export to Sheets, CSV and XLSX](#export-to-sheets-csv-and-xlsx)
  - [Push a list to your CRM](#push-a-list-to-your-crm)
  - [Recruiting and sourcing](#recruiting-and-sourcing)
  - [Signals and the rest of the Fiber API](#signals-and-the-rest-of-the-fiber-api)
  - [Build automations with the Fiber SDK](#build-automations-with-the-fiber-sdk)
  - [Run Sailor headless or in scripts](#run-sailor-headless-or-in-scripts)
- [Privacy and outreach hygiene](#privacy-and-outreach-hygiene)

---

## Core concepts

### Chat, tools and slash commands

There are two ways to make Sailor do things:

- **Ask in plain English.** The model picks from Sailor's tools (`fiber_count`, `fiber_search_people`, `fiber_reveal_contacts`, `list_show`, …) and chains them. This is the normal way to work. The full list is in the [tool reference](../reference/tools.md).
- **Run a slash command.** Commands like `/list`, `/repair`, `/emails` and `/export-list` run directly, without the model deciding anything, and go through the same cost guard. Some commands (`/qualify`, `/lookalikes`, `/crm export`) hand the model a precise brief instead.

Prompt templates (`/icp`, `/callscript`, `/sequence`, `/account-plan`, `/sourcing`, `/tam`, `/repair-list`) are shortcuts that load the matching skill and fill in your arguments.

### Lists and the local store

Everything Sailor finds lands in a **local SQLite database** (by default `~/.sailor/sailor.db`), not in the chat:

- **Lists** are named collections of people *or* companies. Searches, resolves, repairs and imports all create or add to a list. Each list has an id (a slug like `revops-us`) and a name; commands accept either.
- **Entities** are people and companies, stored once and shared by every list. Sailor deduplicates by LinkedIn URL, then email, then name + domain, so the same person found twice is one row.
- **Contacts** (emails, phones) belong to an entity and carry a validity verdict once validated. Revealed contacts and email verdicts are cached (90 days by default), so asking again is free.
- **List rows** have a status: `new`, `enriched`, `contacted`, `excluded`, `not_found` or `error`, plus optional notes (for example a saved call script) and an optional fit score from `/qualify`.

The model only sees a list handle and a short preview of each result, then reads exactly the fields it needs with `list_show` and `entity_get`. That keeps big lists out of the context window and keeps cost down.

Lists outlive Pi sessions and branches. To keep a project's lists separate, create a `.sailor/` folder in that project directory; Sailor then uses `.sailor/sailor.db` there instead of the global database.

### Credits, estimates and the cost guard

The footer always shows your Fiber balance and this session's spend, for example `Fiber 48,210 cr │ session −132.5/500 │ ⧗ 1 job`. The balance comes from Fiber's free `get-org-credits` call and refreshes at start-up, shortly after every charge, and every 60 seconds. `Ctrl+Shift+K` refreshes it on demand.

Before **any** paid call (a tool the model calls, a pane action, a slash command, an MCP tool), Sailor estimates its cost and decides:

| Situation | What happens |
|---|---|
| Free call, or estimate ≤ the auto-approve threshold (default 25) | Runs |
| Estimate above the threshold, or the cost is unknown | Asks you: `Spend ~40 credits on Fiber?` with your balance, session and daily totals |
| Would exceed the session or daily budget, or your balance | Blocked, with the reason and how to raise the limit |
| More than `maxPaidCallsPerTurn` paid calls in one model turn (default 10) | Blocked, and the model is told to stop and check with you |
| Dry run is on | Blocked; you get the estimate only |
| Plan mode | Blocked; the step goes into the plan with its estimate |
| No interactive UI (headless) and the call needs approval | Blocked unless you passed `--fiber-max-spend` |
| Money movement or account operations (buying credits, cards, OTP) | Always blocked; do these in the Fiber dashboard |
| API-key admin operations | Blocked until you run `/fiber admin on` |

After each call Sailor records what Fiber **actually** charged (from the response's `chargeInfo`) in a ledger. `/credits` shows estimated vs charged per operation for the session, plus recent charges.

Habits that keep spend low, which the model is also instructed to follow:

- Count before you search (`fiber_count` is about 1 credit).
- Search in small pages (25) first.
- Preview repairs (free) before running them.
- Reveal only what you asked for; the default reveal is work email only.

### Personas: rep, engineer, recruiting

`/mode` picks the persona, which changes the system prompt and the tools the model can use:

| Mode | For | Tools |
|---|---|---|
| `rep` (default) | Sales reps and anyone non-technical | All Sailor tools and read-only file tools; **no shell and no file-writing tools** |
| `engineer` | GTM engineers who want scripts and pipelines | Everything, including Pi's coding tools (`bash`, `edit`, `write`) and the `fiber-sdk` skill |
| `recruiting` | Recruiters and sourcers | Like `rep`, plus a recruiting prompt and fairness guardrails |

Separately, `SAILOR_TOOLS_PROFILE=lite` (or `"toolsProfile": "lite"`) cuts the tool set to about ten core tools for small or local models.

### Agent modes: Build, Plan, Sandbox

The agent mode controls whether Sailor spends. It's independent of the persona. The current mode shows as a chip in the header and footer.

| Mode | What it does | Switch |
|---|---|---|
| **Build** (default) | Does the work and spends credits, with approvals | `/build` |
| **Plan** | Zero spend: paid Fiber calls, shell, file-writing and CRM tools are blocked. Free tools still work so the plan uses your real lists. The model replies with a numbered plan, a tool or command per step and a credit estimate per step. When a plan is ready Sailor offers **Run it in BUILD** or **Try it in SANDBOX** | `/plan` |
| **Sandbox** | Runs on a Fiber sandbox key (`sk_test_…`): real API, fixed sample data, nothing charged. Your live key is never used in this mode | `/sandbox` |

`Alt+M` cycles Build → Plan → Sandbox. `/agent-mode` shows a picker. You can also start in a mode with `--agent-mode plan` or `SAILOR_AGENT_MODE=plan`. The choice is saved in your config.

The first time you enter Sandbox mode without a sandbox key, Sailor offers to create one from your live key (free) or to paste one. See [Getting started → sandbox](getting-started.md#6-try-it-on-a-fiber-sandbox-key) for what sandbox does and doesn't support.

---

## Workflows

### Build a prospect list from an ICP

Describe who you want:

```
Find heads of RevOps at US B2B SaaS companies, 200–1000 employees, that raised in the last 12 months.
Count first, then search the top 25 into a list called RevOps US.
```

What Sailor does:

1. **Parse** the description into Fiber's structured filters with `fiber_parse_query` (2 credits) and shows them to you.
2. **Count** matches with `fiber_count` (about 1 credit) so you know the market size and what a full search would cost.
3. **Search** with `fiber_search_people` or `fiber_search_companies` (1 credit per result returned) in pages of 25, saving results to a list. You approve if the estimate is over your threshold.
4. Tell you the list id. Open it with `/list <id>`.

Ask for "the next page" to continue with the saved cursor. For quick exploration, `fiber_nl_search` does all of it in one call (2 credits + 1 per result). The `/icp <description>` template runs the same cheap-first flow from the `sailor-prospecting` skill.

### Look up one person or company

```
Who is the Head of Growth at loomly.com?
Look up https://www.linkedin.com/in/dana-whitfield
Tell me about tidewave.io
```

`fiber_resolve_person` and `fiber_resolve_company` use Fiber Kitchen Sink (2 credits each; +2 for a live LinkedIn fetch) and accept any partial identifiers: LinkedIn URL, email, or name plus company or domain. If several people match, Sailor shows the candidates and asks you to pick rather than guessing. A name alone isn't enough.

### Work a list in the list pane

`/lists` shows every list; pick one to open it. `/list <id or name>` opens one directly, and `Ctrl+Shift+L` opens the most recent.

The pane is a scrollable, sortable table. Press `Enter` on a row for a card: for people, title, company, tenure, local time and best call window, contacts with validity; for companies, funding, headcount trend, tech and HQ.

| Key | Action |
|---|---|
| `↑` `↓` / `j` `k`, `PgUp` `PgDn`, `g` `G` | Move |
| `Space` / `a` | Select row / select all |
| `Enter` | Open the card (`n` / `p` next / previous, `e` reveal for this person, `Esc` back) |
| `/` | Filter (type, `Enter` to apply, `Esc` to cancel) |
| `s` | Cycle sort: position, name, company, status |
| `c` | Switch column set |
| `e` | Reveal contacts (people lists): choose work email, + personal, + phone, or everything |
| `v` | Validate emails |
| `r` | Re-resolve with Kitchen Sink |
| `d` | Toggle do-not-contact (excluded) |
| `x` | Export (CSV, XLSX or Sheets, then a column preset) |
| `S` | Export straight to Google Sheets (upsert) |
| `q` / `Esc` | Close |

Actions apply to the selected rows, or to the row under the cursor if nothing is selected. Paid actions show the same estimate and approval prompt as everywhere else.

Manage lists with `/list rename <id> <new name>` and `/list delete <id>` (rows' entities and contacts stay in the store).

### Reveal and validate contacts

From chat:

```
Get work emails for the first 10 people in revops-us
Also get phone numbers for the ones marked A-tier
Validate the emails in revops-us
```

Or with commands, which run directly through the cost guard:

```
/emails revops-us             # work email (2 cr each, charged only when found)
/emails revops-us --personal  # work + personal
/phones revops-us             # phones
/contact-info revops-us       # everything (emails + phones)
/socials revops-us            # X, GitHub, website… from stored data (free)
```

Details worth knowing:

- People on the do-not-contact list are skipped. People with fresh cached contacts are skipped for free.
- Reveals of more than 25 people run as a **background batch job**. Keep working; progress shows above the editor and in `/jobs`, and results stream into the list.
- Validation (1 credit per email; cached verdicts are free) returns `ok`, `risky` (for example catch-all), `undeliverable` or `inconclusive`. Validate before exporting to a sequencer, and use `--valid-only` on export to keep only `ok` emails.
- `/socials` reads social profiles from data Sailor already stored. Rows that only have LinkedIn can be refreshed with Kitchen Sink first (`--refresh`, about 2 credits each).

### Qualify a list and find lookalikes

**`/qualify [list] [criteria] [--min 70]`** scores every row 0–100 against your criteria, with a one-line reason that cites stored fields, and derives a tier (A ≥ 80, B ≥ 60, C ≥ 40, D below). Rows scoring at least `--min` are copied into a new, sorted list. Scoring uses free local tools only. With no criteria, Sailor asks, or falls back to the ICP in your `sailor.md`.

```
/qualify revops-us VP or Head level in RevOps at B2B SaaS, 200–2000 employees, raised in the last 18 months --min 70
```

Scores show in `list_show` (`score`, `tier`, `score_reason` fields), in exports, and in CRM pushes as `fitScore` / `fitTier` / `fitReason`.

**`/lookalikes [list] [--count 25]`** profiles a list (common titles, seniority, company size, industry, geography, funding), turns the 3–5 strongest shared traits into Fiber filters, counts, searches into `Lookalikes of <list>`, and removes anyone already in the seed list. It doesn't reveal contacts; it offers `/emails` afterwards.

### Repair and enrich a messy list

`/repair` takes a CSV, TSV, XLSX, a public file URL or a Google Sheet, and turns it into a clean, resolved Sailor list.

```
/repair ./hubspot_export.csv
/repair ./event_leads.xlsx --work-email --phone --name "Event leads"
/repair https://docs.google.com/spreadsheets/d/... --company
```

1. **Pre-flight (local, free).** Sailor detects encoding (including Windows-1252), delimiter, preamble rows above the header, duplicate columns and each column's role (name, company, domain, LinkedIn, email, phone, title, location). It cleans values such as `mailto:` links, `"Name <email>"` cells, Sales Navigator URLs and `Last, First` names, then shows a card with the row count, detected columns, chosen engine, estimate and any warnings. It also tells you if the same file was repaired before.
2. **Engine choice.**
   - **Kitchen Sink bulk** for up to 50 rows where most rows have a usable identifier. Runs immediately and needs no hosting.
   - **Mosaic** for anything larger or messier: an async Fiber job that handles up to 20,000 rows per run (Sailor splits larger files and merges the results). Mosaic needs a **public HTTPS URL** for the file; see [Mosaic hosting](configuration.md#mosaic-hosting). Sailor always asks before uploading, because the file contains personal data, and revokes or deletes the temporary link once Mosaic has started.
3. **Approve** the estimate, then Sailor runs it. Mosaic jobs are polled every 30 seconds (60 after ten minutes), survive restarts, and when done the healed CSV is downloaded next to your original and imported into a list.

Contact reveals are **off by default**. Turn them on with `--work-email`, `--personal-email`, `--phone`. Other options: `--company` (company details), `--max-rows N`, `--engine kitchen-sink|mosaic`, `--url PUBLIC_URL` (manual hosting), `--instructions "…"` (guidance for Mosaic's AI), `--redline`, `--no-live-fetch`.

You can also just say "fix this file and get work emails" and the model uses `fiber_repair_list`, previewing first.

To load a file **without** spending anything, use `/import-list csv <file>` or `/import-list sheets <url>`, then resolve selected rows later with `r` in the list pane.

Track jobs with `/jobs`; `/jobs cancel <id>`, `/jobs resume <id>` and `/jobs refresh <id>` manage them.

### Write grounded outreach

Sailor writes cold-call scripts, voicemails, emails and objection handlers from the facts it has stored, and cites each personal fact inline:

```
Write a 60-second cold-call script for each of the first 5 people in revops-us. Follow sailor.md.
/callscript revops-us "revenue forecasting for RevOps teams"
```

- Every personalised claim carries a citation like `[latestFunding.stage]` or `[tenureMonths]`. Anything uncertain is marked `[unverified]`. Sailor never invents funding rounds, numbers or events.
- Scripts are saved on the list row with `list_set_notes`, which checks every citation against the stored facts and reports any that don't match.
- Call scripts follow a fixed shape: permission opener, trigger (funding, job change, hiring, post), one-line value prop, two discovery questions, call to action, a ≤ 20-second voicemail and three objection handlers, plus the best call window in the prospect's local time.
- Cold emails include an opt-out line and a sender-address placeholder (CAN-SPAM).
- For large lists, Sailor writes one template per persona or segment with per-row variables rather than hundreds of one-off scripts.

**Your playbook.** Copy [`examples/sailor.md`](../../examples/sailor.md) to the folder you run Sailor from and fill in what you sell, the proof points you're allowed to cite, tone, banned claims, the meeting ask and compliance lines. The outreach skills follow it.

### Sales strategy: TAM, account plans, sequences

The `sailor-sales-strategy` skill produces strategy backed by real Fiber numbers:

```
/tam mid-market logistics software in North America and the UK
/account-plan tidewave.io
/sequence revops-us "we cut forecast prep from 3 days to 3 hours"
Which segments of revops-us should I prioritise and why?
```

Counts are cheap (about 1 credit each), so Sailor sizes segments with counts rather than full searches.

### Export to Sheets, CSV and XLSX

```
/export-list revops-us csv --preset outreach
/export-list revops-us xlsx --path ./exports/
/export-list revops-us sheets --preset outreach
/export-list revops-us sheets --mode upsert --sheet https://docs.google.com/spreadsheets/d/...
/export-list revops-us csv --valid-only
```

- **Presets** map columns for common tools: `raw` (everything, including socials and fit scores), `outreach`, `apollo`, `hubspot`, `salesloft`, `instantly`, `smartlead`.
- **Google Sheets** modes: `new` (default), `append`, or `upsert` (update matching rows, keyed on LinkedIn URL, then email, unless you pass `keyColumn`). Without `--sheet`, `append` and `upsert` reuse the sheet this list was last exported to. Values are written as raw text, never as formulas.
- **CSV / XLSX** go to the current folder as `<list>.<preset>.csv` unless you give `--path`. Cells starting with `=`, `+`, `-` or `@` are escaped to block spreadsheet formula injection. XLSX needs `exceljs`.
- **Do-not-contact and excluded rows are never exported.**

Exporting is free. Set up Google first: see [Configuration → Google Sheets](configuration.md#google-sheets).

### Push a list to your CRM

Sailor doesn't talk to CRMs itself. It registers your CRM vendor's **own MCP server** with Pi, Pi handles sign-in, and the model writes records through that server's tools using CRM-ready rows Sailor prepares.

```
/crm connect hubspot          # or salesforce, attio, custom <https://…/mcp>
/mcp login hubspot            # sign in (Attio, HubSpot, custom OAuth servers)
/crm export revops-us --min-score 70
```

The export brief tells the model to search before creating (so re-exports don't duplicate), never delete records, skip fields the CRM rejects, and report created / updated / skipped counts. Do-not-contact rows never leave Sailor. Lists over 200 rows are pushed 100 at a time with a check-in. CRM tools are hidden in Plan mode.

Per-CRM setup steps are in [Configuration → CRM](configuration.md#crm).

### Recruiting and sourcing

```
/mode recruiting
/sourcing Senior backend engineer, Go + Postgres, Berlin or remote EU, ex-fintech
```

Recruiting mode sources by skills, experience, titles, tenure, companies, schools and location. **It refuses to filter, rank or infer by protected attributes** (gender, age, race or ethnicity, religion, disability, family status, nationality): such searches are blocked before they reach Fiber, and the model offers compliant criteria instead. Candidate outreach is specific about the role and why the candidate's actual experience fits. Switch back with `/mode rep`.

### Signals and the rest of the Fiber API

Fiber has 200+ operations. Sailor has dedicated tools for the common ones, and three generic tools for the rest:

- `fiber_find_operation`: search the catalog by intent (free), for example "talent flow from competitors" or "job postings".
- `fiber_operation_docs`: read one operation's schema, price and limits (free).
- `fiber_call`: call it. The key is added automatically; the cost guard still applies, and an unknown cost always asks.

Just ask: "Which companies are hiring RevOps roles in Austin right now?" and the model finds the right operation.

`fiber_tracker` monitors companies for signals (funding, hiring, headcount changes) with Fiber Tracker: list rules, create a tracked list, add companies, refresh (2 credits per tracked company) and read fired signals.

Sailor also bridges Fiber's hosted **MCP servers** (Core by default) as tools named `fibermcp_<server>_<tool>`, with every call still going through the cost guard. Manage this with `/fiber mcp core|v2|lite|off` (comma-separate to combine).

### Build automations with the Fiber SDK

```
/mode engineer
/new-script weekly_reenrich
Make it read prospects.csv, reveal work emails for rows that have LinkedIn but no email, and stop at 200 credits.
```

`/new-script <name>` scaffolds `scripts/<name>.ts` on [`@fiberai/sdk`](https://www.npmjs.com/package/@fiberai/sdk) with Sailor's conventions: key from the environment, `chargeInfo` logged, a `--dry-run` flag, a confirmation before paid loops, and async polling no faster than every 30 seconds. See [`examples/scripts/weekly_reenrich.ts`](../../examples/scripts/weekly_reenrich.ts) for a complete example.

> Scripts you run with `bash` call Fiber directly and **bypass Sailor's cost guard and ledger**. Sailor detects shell commands that look like Fiber calls and asks before running them.

### Run Sailor headless or in scripts

Pi's print mode (`-p`) and JSON/RPC modes work with Sailor. With no one to approve, **any paid call that would need approval is blocked** unless you give an allowance:

```bash
# free
pi -e ./packages/pi-fiber/extensions/sailor -p "What's my Fiber credit balance?"

# allow paid calls up to 5 credits each
pi -e ./packages/pi-fiber/extensions/sailor -p "How many heads of RevOps are in the US?" --fiber-max-spend 5

# estimate only, JSON event stream
pi -e ./packages/pi-fiber/extensions/sailor --mode json --fiber-dry-run -p "Find 25 VPs of Sales at London fintechs"

# via the launcher (arguments pass straight through to pi)
npm run sailor -- -p "count heads of revops in the US" --fiber-max-spend 5 --sailor-mode rep
```

Flags: `--fiber-max-spend <credits>` (or `SAILOR_MAX_SPEND`), `--fiber-dry-run`, `--sailor-mode rep|engineer|recruiting`, `--agent-mode build|plan|sandbox`. Session and daily budgets still apply.

---

## Privacy and outreach hygiene

| Need | How |
|---|---|
| Never contact someone (opt-out, customer, competitor) | `/dnc add <email\|domain\|linkedin url\|phone>… [--reason R]`, the `d` key in a list pane, or ask the model. DNC entries are skipped by reveals and left out of every export and CRM push |
| A data-deletion request (GDPR / CCPA) | `/forget <id\|email\|linkedin>` deletes the person, their contacts and list rows from the local store and adds them to do-not-contact. Fiber-side data is handled by Fiber (privacy@fiber.ai) |
| Start over | `/wipe` deletes the local database (lists, contacts, cache, ledger). Your key and Fiber credits aren't affected |
| Keep your key out of the conversation | Keys are injected by Sailor and never shown to the model. If you paste one into chat, Sailor offers to store it securely and redacts it from the message. Keys, bearer tokens, Google tokens and signed URLs are also redacted from every tool result |
| Untrusted content | Profiles, posts, company descriptions and API docs reach the model wrapped as untrusted data, and the model is told never to follow instructions inside them |
| Usage telemetry | Off by default and collects nothing in this version (`/telemetry on\|off`) |
| Feedback | `/feedback <text>` saves a note to `~/.sailor/feedback/`. Nothing is sent anywhere |
