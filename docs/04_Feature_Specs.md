# 04 — Feature Specs

Each spec includes **User story → UX → Tools/APIs → Behavior → Acceptance criteria**. F1–F8 map 1:1 to the ideas in the brief. F9–F16 are features the brief does not mention but a daily-driver GTM harness needs.

---

## F1. Plug in your Fiber key and get immediate access to all APIs

**Story:** As a new user, I paste my key once and can use any Fiber capability from chat.

**UX**
- `sailor` first run prompts: `Fiber API key (sk_live_…):` with masked input. It also auto-detects `FIBER_API_KEY` / `FIBERAI_API_KEY`.
- `/fiber login` · `/fiber logout` · `/fiber whoami` (masked key `sk_live_****ab12`, org id, credit summary, rate limits).
- Multiple profiles: `/fiber use work` · `/fiber use sandbox`.

**APIs:** `getOrgCredits` (validate + balance), `getCurrentApiKey` (key metadata/limit), `getRateLimits`.

**Behavior**
- Validation: 401 → "Invalid key." Network error → "Can't reach api.fiber.ai" and run `healthCheck`.
- The key is stored in the keychain, **never** written to session JSONL, tool args, or logs. A redaction filter on the `context` and `tool_result` events masks `sk_live_[A-Za-z0-9]+`.
- "All APIs": Tier-1 typed tools + MCP Core meta-tools (`search_endpoints` → `get_endpoint_details_full` → `call_operation`) + `fiber_call` (a generic typed passthrough using `openapi.json`, for when MCP is unavailable).

**Acceptance:** A valid key goes from paste to the balance showing in the footer in under 3 s. The key string never appears in `~/.pi/agent/sessions/*.jsonl` (automated test greps for it).

---

## F2. Always-visible credit balance

**Story:** I always know how many credits I have and what this session has spent.

**UX (footer via `ctx.ui.setStatus("fiber", …)`)**
```
Fiber 48,210 cr │ session −132.5 │ budget 500 │ ⧗ 2 jobs
```
- Normal → default color. Low (<10% of `max` or <500) → yellow. Empty/402 → red with "top up" hint.
- `/credits`: full breakdown (org max/used/available, `usagePeriodResetsOn`, per-op spend table for this session, last 10 charges with `chargeInfo`), plus a link to buy credits (the harness never buys itself).

**APIs:** `getOrgCredits` (free, 120 rpm), `chargeInfo` on every response, optionally `listApiRequests` for org-level history.

**Behavior:** Refresh on session start, after each charge (debounced 10 s), and every 60 s while active. Handle `output[]` with multiple orgs by showing the one matching the key, or the sum with a hint.

**Acceptance:** The footer updates within 1 s of a charge (optimistic) and reconciles within 15 s. It never shows a stale number for more than 60 s.

---

## F3. Built-in Fiber MCP

**Story:** The agent can reach any Fiber operation, including new ones Fiber ships, without a harness update.

**Design:** Sailor's MCP bridge connects to **Core** (`https://mcp.fiber.ai/mcp`) by default and optionally **V2** (`/mcp/v2`), using `x-api-key`. Tools are registered with the prefix `fibermcp_*`. Configure with `/fiber mcp [core|v2|lite|off]`.

**Behavior**
- Lazy connect on first use (to save startup time). Reconnect with backoff, and surface a clear error if MCP is down; typed tools keep working.
- `call_operation` goes through the cost guard using `operationId`. Unknown ops default to "paid, unknown cost → confirm".
- Results are trimmed the same way as typed tools (large arrays go to the list store and the LLM gets a handle).
- Duplicate capability resolution: if a typed tool exists for an op, the system prompt tells the model to prefer it.

**Acceptance:** "Get the talent flow rivals for stripe.com" (no typed tool) works via Core: `search_endpoints` → `call_operation`, with a cost confirmation.

---

## F4. One-click enrich and repair of messy contact lists (Kitchen Sink + Mosaic)

**Story:** I have a messy CSV/Sheet (mixed LinkedIn URLs, emails, "John @ Acme", typos). One command gives me a clean, enriched list.

**UX**
- `/repair <path|sheet-url> [--contacts work,personal,phone] [--company] [--max-rows N] [--instructions "..."]`
- In ListPane: `r` = repair the selected rows, `e` = enrich contacts.
- Pre-flight card:
  ```
  hubspot_export.csv · 1,204 rows · UTF-8 · delimiter ',' · header row 1
  Detected columns: name(✓) email(✓ 61%) company(✓) linkedin(✓ 38%) phone(~)
  Engine: Mosaic (async)   Options: work email ✓ phone ✗ company details ✓ liveFetch ✓
  Estimated: first 1,000 rows free (first org run) + ~204 × N cr  →  confirm? [y/N]
  ```

**Engine selection**
| Condition | Engine |
|---|---|
| ≤ 50 rows, clean identifiers | **Kitchen Sink** (`KitchenSinkBulkProfile` / `kitchenSinkBulkCompany`, sync, 50/call) |
| 51 – 20,000 rows or messy/free-text | **Mosaic** (`startMosaic` + `pollMosaic`) |
| > 20,000 rows | Split into ≤ 20k-row chunks → multiple Mosaic runs (respecting 20 rpm), then merge |
| Company-only list | `kitchenSinkBulkCompany` or `standardizeCompanyBulk` |

**Mosaic flow:** parse locally (encoding/delimiter/header/row count, sanitize) → estimate → confirm → make a public HTTPS URL (Sheet URL as-is if public; otherwise upload via a hosting adapter: Drive "anyone with link", S3/R2 presigned, or a user-provided URL) → `startMosaic` → persist the job → poll every 30 s → **download `outputCsvUrl` and `reportUrl` immediately** → revoke the temp link → import into a list → show `stats` (found %, contacts %, errors) and a diff/redline view if `runRedline`.

**Acceptance:** Sample messy CSV of 1,000 rows → healed list in ListPane, local healed CSV saved next to the original (`*.healed.csv`), temp link revoked, and the job survives a Sailor restart mid-run.

---

## F5. Custom panes for prospect/company lists

**Story:** I want to see my lists as tables, scan them, and act on rows without typing.

**UX:** `/lists` opens a list browser (SelectList). `/list <name>` opens the ListPane (via `ctx.ui.custom()`), full-screen or as an overlay.

```
┌ Q4 RevOps Outbound · 52 people · sort: company ▲ · filter: email=found ─────────┐
│ ✓ │ Name            │ Title              │ Company     │ HC   │ Email  │ Local  │
│ ▸ │ Dana Whitfield  │ Head of RevOps     │ Loomly      │ 340  │ ✓ val  │ 09:14  │
│   │ Raj Menon       │ Dir. Revenue Ops   │ Tidewave    │ 610  │ ? c-all│ 11:14  │
│   │ …                                                                           │
└ ↑↓ move · space select · ⏎ card · e enrich · v validate · x export · d exclude · / filter · q close ┘
```
- Virtualized rendering (10k+ rows OK), responsive column dropping on narrow terminals, and truncation that handles Unicode width.
- Row status colors: new / enriched / contacted / excluded.
- Actions call the same tools the LLM uses, so there's one code path and the same cost guard.

**Acceptance:** A 10k-row list scrolls without flicker. Every action shows its cost before running. Works at 80 columns.

---

## F6. Custom TUI components for prospect/company info

**Story:** When the agent mentions a person/company, I see a rich, scannable card instead of JSON.

**Components**
- `ProspectCard`: name, headline, current role + tenure, previous 3 roles, education, location + **local time**, contact block (email/phone with validity badge + source), social stats, "signals" (job change, open to work, hiring), recent posts (if fetched), and provenance timestamps.
- `CompanyCard`: logo (Image component on capable terminals), domain, industry, HQ, headcount + **trend sparkline**, funding timeline (rounds, investors), tech stack chips, open roles count, department sizes.
- **Tool renderers:** `renderResult` for search tools draws a compact table plus `charged 25 cr · list:abc123`. `renderCall` shows the human-readable intent ("Searching people: Head of RevOps · US · 200–1000 HC").

**Acceptance:** Cards render correctly in dark/light themes, degrade to plain text in `-p`/json/RPC modes, and never block the agent loop.

---

## F7. Google Sheets integration

**Story:** Export any list (or script set) to a Google Sheet my team can use, and read lists from Sheets.

**UX**
- `/sheets connect` → opens the browser for OAuth (loopback). Falls back to the device-code flow over SSH.
- `/export sheets [list] [--title "…"] [--sheet <url>] [--mode new|append|upsert --key email] [--preset outreach|apollo|hubspot|raw]`
- `/import sheets <url>` → list (via Sheets API if connected, or via Mosaic directly if the sheet is public).

**Behavior**
- Scopes: `drive.file` (only files Sailor creates or the user opens with it) + `spreadsheets`.
- Writes in 1,000-row chunks with backoff on 429 (Sheets quota ~60 writes/min/user). Uses `valueInputOption=RAW` to prevent formula injection. Header formatting, frozen row, filter view, hyperlinks for LinkedIn.
- Upsert by key column (email/linkedin) to avoid duplicates on re-export.
- Records exports in `exports` so `/export again` re-syncs.
- Fallbacks: `/export csv|xlsx` locally, and an optional "copy as TSV" to paste into Sheets.

**Acceptance:** A 5,000-row list exports in under 60 s. Re-export with `--mode upsert` produces no duplicates. Cells starting with `=`,`+`,`-`,`@` show as text.

---

## F8. Built-in skills/SDK for vibe-coding with Fiber

**Story:** As a GTM engineer I ask "write a script that re-enriches my Sheet weekly" and get working TS code using `@fiberai/sdk`.

**Contents**
- Vendored `fiber-sdk` skill (from the SDK repo) plus a Sailor addendum: conventions (`{data,error,response}`, `throwOnError`, polling ≥ 30 s, `chargeInfo` logging, key from env, never hardcode).
- `/new-script <name>` scaffolds `scripts/<name>.ts` with `@fiberai/sdk`, dotenv, a cost-confirmation helper, and a dry-run flag.
- Reference fetch: skills tell the agent to consult `https://api.fiber.ai/ai-docs/{operationId}.md` (via Pi's tools/bash) when unsure of a schema.
- Coding tools (Pi's `read/write/edit/bash`) are enabled in **engineer mode** (`/mode engineer`) and hidden in **rep mode** (default) to keep non-technical users safe.

**Acceptance:** The agent produces a script that type-checks (`tsc --noEmit`) and runs against a sandbox key in the eval suite.

---

## F9. Cost guard and budgets *(not in brief)*

- Pre-call estimate for every paid op, a confirm dialog above the threshold, and a hard block above session/daily budget or balance.
- `/budget session 1000` · `/budget daily 5000` · `/budget auto 25`.
- **Dry-run mode** (`/dryrun on`): all paid calls return an estimate only. Useful for planning.
- Prefer free first: the system prompt and skills instruct count endpoints (`peopleSearchCount`, `companyCount`) and `estimateEnrichmentCost` before paid work.
- Recommends setting a Fiber-side key ceiling via `updateApiKeyLimit` as a second line of defense.

## F10. Natural-language ICP → search *(not in brief)*
`fiber_nl_search` wraps `nlpSearchParse` so the user sees and edits the structured filters, then runs `peopleSearch`/`companySearch`. `slushieRun` is used for one-shot answers. Typeaheads/enums (free) normalize industries, locations, and titles (`jobTitleRewrite`) to cut down on failed searches.

## F11. Outreach asset generation *(core of the brief, needs a spec)*
Skills + prompt templates:
- `/callscript [list|person]`: 30/60/120-second variants, opener, trigger, discovery questions, objection handling, voicemail version. Best call window by local time.
- `/sequence`: 3–5 step email + LinkedIn touch sequence with personalization tokens.
- `/account-plan <company>`: org map (department sizes, depth chart), priorities from signals, entry points.
- `/strategy`: segment-level sales strategy (ICP tiers, messaging by persona, TAM via count endpoints).
- **Grounding rule:** every personalized fact is cited to a stored field. Any "hallucination risk" line is flagged `[unverified]`.

## F12. Recruiting mode *(persona pack)*
`/mode recruiting` switches skills and presets to candidate sourcing (people search with skills/seniority/tenure), GitHub → LinkedIn, stealth founders, job-change lists, candidate outreach templates, and **bias guardrails** (no filtering or inference on protected attributes).

## F13. Signals and monitoring *(not in brief)*
Wrap Tracker, Job Changes, and Saved Searches: `/watch companies <list> --rules funding,hiring`, `/signals`. Optional webhook → local notification or Slack (future). Great for "call them when they raise."

## F14. Suppression and dedupe *(not in brief)*
Fiber exclusion lists (company/prospect) sync with local "do not contact" status. Every export/enrich checks suppression first. Cross-list dedupe uses normalized LinkedIn URL > email > (name, domain).

## F15. Async jobs panel *(not in brief)*
`/jobs` lists running/finished jobs (Mosaic, batch reveal, audience enrich, exhaustive reveal) with progress, cost so far, cancel (`cancelBatchContactDetails`), retry, and open-result actions. Jobs are persisted and resumed across restarts.

## F16. Session and workspace management *(not in brief)*
Lists live in the workspace DB (not the session), so Pi's `/fork` / `/tree` branches share lists. Tool results carry list handles and snapshot versions so branch replay stays consistent. `/workspace` switches between client/territory workspaces (separate DBs).
