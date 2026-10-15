# Command reference

Every slash command, flag, shortcut and key Sailor adds to Pi. `<…>` is required, `[…]` is optional, `a|b` means one of. List arguments accept a list id or name; when a list is optional, Sailor asks which one (or uses the most recent list when there's only one).

Pi's own commands (`/model`, `/login`, `/settings`, `/mcp`, `/reload`, …) keep working as usual.

**Contents:** [Account & spend](#account-and-spend) · [Modes](#modes) · [Lists](#lists) · [Prospecting & contacts](#prospecting-and-contacts) · [Repair & jobs](#repair-and-jobs) · [Export & import](#export-and-import) · [CRM](#crm) · [Privacy](#privacy) · [Other](#other) · [Prompt templates](#prompt-templates) · [Shortcuts](#keyboard-shortcuts) · [List pane keys](#list-pane-keys) · [CLI flags](#cli-flags) · [Launcher](#the-sailor-launcher)

---

## Account and spend

| Command | What it does |
|---|---|
| `/fiber` or `/fiber whoami` | Masked key and where it came from, profile, org, balance, mode, tools profile, MCP servers, database path |
| `/fiber login [key] [--profile P]` | Connect a Fiber key. Validates it with the free credits call, then stores it in the OS keychain (or `~/.sailor/credentials.json`, 0600) |
| `/fiber logout` | Remove the stored key for the active profile. A key set in the environment still applies |
| `/fiber use [profile]` | Switch key profile (e.g. `work`, `personal`). With no argument, lists profiles. Prompts for a key if the profile has none |
| `/fiber mcp [core\|v2\|lite\|off]` | Show or set which Fiber MCP servers are bridged. Comma-separate to combine (`core,v2`). Default `core` |
| `/fiber admin on\|off` | Allow API-key admin operations (limit, expiry, revoke, create sandbox key) for this session |
| `/credits` | Balance, this session's spend per operation (estimated → charged), today's total, recent charges |
| `/budget` | Show budgets and spend |
| `/budget session <n>` | Max credits per session (default 500) |
| `/budget daily <n>` | Max credits per day (default 2000) |
| `/budget auto <n>` | Calls estimated at or below `n` credits run without asking (default 25) |
| `/budget turn <n>` | Max paid calls per model turn (default 10) |
| `/dryrun on\|off` | Estimate-only mode: paid calls are blocked and the estimate is reported |

Budget and dry-run settings are saved to `~/.sailor/config.json`.

## Modes

| Command | What it does |
|---|---|
| `/mode [rep\|engineer\|recruiting]` | Switch persona. `rep` hides shell and file-writing tools; `engineer` adds coding tools and the SDK skill; `recruiting` adds fairness guardrails. No argument shows the current mode |
| `/build` | Build mode: do the work, spend with approvals |
| `/plan` | Plan mode: zero spend, no shell/file/CRM writes; produces a costed plan |
| `/sandbox` | Sandbox mode: run on a Fiber sandbox key. Offers to create or paste one if none is stored |
| `/sandbox key <sk_test_…>` | Store a sandbox key and switch to Sandbox mode |
| `/agent-mode [build\|plan\|sandbox]` | Show a picker or switch directly |
| `/look [fiber\|pi]` | Fiber-branded header, footer, spinner and theme, or Pi's stock look. No argument toggles |

## Lists

| Command | What it does |
|---|---|
| `/lists` | Pick a list to open |
| `/list [id\|name]` | Open a list in the interactive pane (default: most recent) |
| `/list rename <id> <new name>` | Rename a list |
| `/list delete <id>` | Delete a list (asks first). Entities and contacts stay in the store |

## Prospecting and contacts

| Command | What it does | Cost |
|---|---|---|
| `/qualify [list] [criteria…] [--min 70]` | Score every row 0–100 with a reason and tier, then copy rows ≥ `--min` into a new list | Free (local tools) |
| `/lookalikes [list] [--count 25]` | Infer the list's pattern, count, then search for more like it into `Lookalikes of <list>`, deduped against the seed | Count + 1 per result |
| `/emails [list] [--personal] [--limit N] [--status S]` | Reveal work emails (and personal with `--personal`) | 2 per email found (3 for both) |
| `/phones [list] [--limit N] [--status S]` | Reveal phone numbers | 3 per phone found |
| `/contact-info [list] [--limit N] [--status S]` | Reveal work + personal email + phone | 5 per person |
| `/socials [list] [--refresh] [--limit N]` | Social profiles from stored data. `--refresh` re-pulls thin profiles with Kitchen Sink first | Free (`--refresh` ~2 per row) |

Reveals skip do-not-contact people and anyone with fresh cached contacts. More than 25 people run as a background batch job.

## Repair and jobs

| Command | What it does |
|---|---|
| `/repair <file\|url\|sheet url> [options]` | Pre-flight, estimate, approve, then repair with Kitchen Sink (≤ 50 rows) or Mosaic |
| `/repair hosting [manual\|gdrive\|s3]` | Show or set how Mosaic gets a public URL for local files |
| `/jobs` | List async jobs (Mosaic runs, batch reveals) with progress |
| `/jobs refresh <id>` | Poll a job now |
| `/jobs cancel <id>` | Cancel a job |
| `/jobs resume <id>` | Resume a paused job |

`/repair` options:

| Option | Meaning |
|---|---|
| `--work-email` `--personal-email` `--phone` | Reveal these contacts for resolved rows (all off by default) |
| `--company` | Include company details |
| `--max-rows N` | Only process the first N rows |
| `--engine kitchen-sink\|mosaic` | Force an engine (default: automatic) |
| `--name "<list name>"` | Name of the resulting list |
| `--url <public https url>` | Public copy of the file, for manual hosting |
| `--instructions "<text>"` | Extra guidance for Mosaic, e.g. `"the company column contains brand names"` |
| `--redline` | Mosaic: compare output against input columns |
| `--no-live-fetch` | Mosaic: don't live-fetch LinkedIn |

## Export and import

| Command | What it does |
|---|---|
| `/export-list <list> [csv\|xlsx\|sheets] [options]` | Export a list (default `csv`). Free; do-not-contact rows are always left out |
| `/import-list csv <file> [--name N]` | Import a CSV, TSV or XLSX into a new list without spending credits |
| `/import-list sheets <url> [--name N]` | Import a Google Sheet into a new list |
| `/sheets` or `/sheets status` | Is Google connected? |
| `/sheets client <client id> [client secret]` | Save your Google OAuth client (stored in the keychain) |
| `/sheets connect [--device]` | Sign in to Google. Opens the browser; `--device` (automatic over SSH) uses a device code instead |
| `/sheets disconnect` | Forget the Google tokens |

`/export-list` options:

| Option | Meaning |
|---|---|
| `--preset raw\|outreach\|apollo\|hubspot\|salesloft\|instantly\|smartlead` | Column mapping |
| `--mode new\|append\|upsert` | Sheets only. Default `new`; `append`/`upsert` reuse the last exported sheet if `--sheet` isn't given |
| `--sheet <url>` | Existing sheet to append to or upsert into |
| `--title "<title>"` | Title for a new sheet |
| `--valid-only` | Only rows whose work email validated `ok` |
| `--path <file or folder>` | CSV/XLSX destination (default: current folder) |

## CRM

| Command | What it does |
|---|---|
| `/crm` | Status and a picker (connect, export, sign-in steps, switch, disconnect) |
| `/crm connect hubspot\|salesforce\|attio` | Link a CRM's MCP server and show the sign-in steps |
| `/crm connect custom <https://…/mcp>` | Link any streamable-HTTP MCP server as a CRM |
| `/crm status` | Sign-in steps and docs for the linked CRM |
| `/crm export [list] [--min-score N]` | Push a list to the CRM via its MCP tools. Not available in Plan mode |
| `/crm disconnect` | Unlink. Remove stored OAuth tokens with `/mcp logout <server>` |

## Privacy

| Command | What it does |
|---|---|
| `/dnc` or `/dnc list` | Show the do-not-contact list |
| `/dnc add <value>… [--reason R]` | Add emails, domains, LinkedIn URLs or phone numbers |
| `/dnc remove <value>…` | Remove entries |
| `/forget <id\|email\|linkedin>` | Delete one person or company and their contacts locally, and add them to do-not-contact |
| `/wipe` | Delete the whole local database (asks first) |

## Other

| Command | What it does |
|---|---|
| `/new-script <name>` | Scaffold `scripts/<name>.ts` using `@fiberai/sdk` |
| `/feedback [text]` | Save feedback to `~/.sailor/feedback/` (nothing is sent) |
| `/telemetry on\|off` | Opt in or out of anonymous usage counts (off by default; local counters only in this version) |

## Prompt templates

Templates load a skill and pass your arguments through.

| Template | Arguments | Skill |
|---|---|---|
| `/icp` | `<who you sell to>` | `sailor-prospecting`: parse, count, small sample search |
| `/callscript` | `<list> [what you sell]` | `sailor-cold-call`: grounded 60-second scripts |
| `/sequence` | `<list> [offer / proof point]` | `sailor-sales-strategy`: 4-touch email + LinkedIn + call sequence |
| `/account-plan` | `<company domain or name>` | `sailor-sales-strategy`: data-backed account plan |
| `/tam` | `<market description>` | `sailor-sales-strategy`: segment sizing with counts |
| `/sourcing` | `<role, must-haves, location, target companies>` | `sailor-recruiting`: sourcing plan + shortlist |
| `/repair-list` | `<path or sheet url> [work-email] [phone]` | `sailor-list-repair`: preview, then repair |

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+Shift+L` | Open the most recent list |
| `Ctrl+Shift+K` | Refresh the Fiber credit balance |
| `Alt+M` | Cycle Build → Plan → Sandbox |

## List pane keys

| Key | Action |
|---|---|
| `↑` `↓` or `k` `j` | Move one row |
| `PgUp` `PgDn` | Move one page |
| `g` / `Home`, `G` / `End` | First / last row |
| `Space` | Select or deselect the row |
| `a` | Select all |
| `Enter` | Open the card |
| `/` | Filter (`Enter` applies, `Esc` cancels, `Backspace` edits) |
| `s` | Cycle sort: position → name → company → status |
| `c` | Switch column set |
| `d` | Toggle do-not-contact / excluded |
| `e` | Reveal contacts (people lists) |
| `v` | Validate emails (people lists) |
| `r` | Re-resolve with Kitchen Sink |
| `x` | Export (choose format and preset) |
| `S` | Export to Google Sheets (upsert) |
| `q` / `Esc` / `Ctrl+C` | Close |

In a card: `↑` `↓` / `k` `j` scroll, `n` / `p` next / previous row, `e` reveal for this person, `Esc` / `q` / `Enter` back to the table.

## CLI flags

Pass these to `pi` (or to `sailor`, which forwards them):

| Flag | Meaning |
|---|---|
| `--fiber-max-spend <credits>` | Headless only: paid calls up to this estimate run without approval. Without it, any call needing approval is blocked |
| `--fiber-dry-run` | Estimate paid calls, charge nothing |
| `--sailor-mode rep\|engineer\|recruiting` | Start in a persona |
| `--agent-mode build\|plan\|sandbox` | Start in an agent mode |

## The `sailor` launcher

| Command | What it does |
|---|---|
| `sailor` | First run: onboarding (LLM hint, Fiber key). Then starts Pi with Sailor and the Fiber theme |
| `sailor login` | Enter or replace the Fiber key (validated, stored in the keychain) |
| `sailor doctor` | Check Node, `node:sqlite`, Pi, the extension, the Fiber key, Google, Mosaic hosting, keychain, terminal size, proxy and `exceljs` |
| `sailor --help` | Usage |
| `sailor <anything else>` | Passed through to `pi`, e.g. `sailor -p "…" --fiber-max-spend 5` |

From a checkout without `npm link`, use `npm run sailor -- <args>` or `node packages/sailor-cli/bin/sailor.mjs <args>`.
