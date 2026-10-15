# Tool reference

The tools Sailor gives the model. You don't call these directly; you ask in plain English and the model picks them. This page is for understanding what the agent can do, what each step costs, and for developers adding or changing tools.

**Legend.** *Cost* is Sailor's estimate (Fiber's `chargeInfo` is the source of truth). *Lite* = included in the `lite` tools profile for small models. *Key* = needs a connected Fiber key. Every paid call passes the [cost guard](../guide/user-guide.md#credits-estimates-and-the-cost-guard).

## Account

| Tool | Cost | Lite | Key | What it does |
|---|---|---|---|---|
| `fiber_credits` | free | ✓ | ✓ | Balance, session spend and remaining budgets |
| `fiber_jobs` | free | | | Async jobs (Mosaic, batch reveals) with status and progress |

## Search

| Tool | Cost | Lite | Key | What it does |
|---|---|---|---|---|
| `fiber_parse_query` | 2 | | ✓ | Plain-English ICP → Fiber `searchParams` (`nlpSearchParse`). Hidden in sandbox |
| `fiber_count` | ~1 | ✓ | ✓ | Count people or companies matching filters |
| `fiber_search_people` | 1 per result | | ✓ | People search into a list. Takes `searchParams` or simple filters (titles, title groups, countries, keywords, started role within N months); `pageSize` ≤ 200, default 25; `cursor` for the next page |
| `fiber_search_companies` | 1 per result | | ✓ | Company search into a list. Filters: industries, countries, employee range, funding stages, domains, keywords, funded within N months |
| `fiber_nl_search` | 2 + 1 per result | ✓ | ✓ | One-shot natural-language search (`slushieRun`). Hidden in sandbox |

In recruiting mode, search tools refuse queries that filter on protected attributes.

## Resolve

| Tool | Cost | Lite | Key | What it does |
|---|---|---|---|---|
| `fiber_resolve_person` | 2 (+2 live fetch) | ✓ | ✓ | One person from LinkedIn URL, email, or name + company/domain (Kitchen Sink). Returns up to `candidates` matches for the user to pick. Hidden in sandbox |
| `fiber_resolve_company` | 2 | ✓ | ✓ | One company from domain, LinkedIn URL or name |

## Contacts

| Tool | Cost | Lite | Key | What it does |
|---|---|---|---|---|
| `fiber_reveal_contacts` | work email 2 · + personal 3 total · + phone 5 total, per person, only when found | ✓ | ✓ | Reveal for a list or entity ids. Skips do-not-contact and fresh cached contacts. More than 25 people → background batch job |
| `fiber_validate_emails` | 1 per email (cached free) | | ✓ | Deliverability: `ok`, `risky`, `undeliverable`, `inconclusive` |

## Lists (local, free)

| Tool | Lite | What it does |
|---|---|---|
| `list_all` | ✓ | All lists with size and kind |
| `list_show` | ✓ | Rows of a list with chosen `fields`, paging, status filter and search. People fields include `name, title, company, email, phone, linkedin, local_time, tenureMonths, location, status, notes, score, tier, score_reason, socials` |
| `entity_get` | | Full stored facts for one person or company, with the best call window. The only facts outreach may cite |
| `list_create` | | Empty list |
| `list_add` / `list_remove` | | Add or remove entities |
| `list_set_notes` | | Save a script or note on a row; checks every `[citation]` against stored facts |
| `list_set_status` | | `new`, `enriched`, `contacted`, `excluded` (also adds to do-not-contact) |
| `dnc_add` | | Add emails, domains, LinkedIn URLs or phones to do-not-contact |
| `list_profile` | | Shape of a list (titles, seniority, geos, industries, sizes, funding) plus sample rows. Used by `/qualify` and `/lookalikes` |
| `list_score` | | Save 0–100 fit scores with reasons (batches ≤ 100); `narrowMinScore` copies qualified rows into a new list |
| `list_socials` | | Social profiles already stored for a list |
| `list_dedupe` | | Remove rows of one list that appear in another |

## Repair and export

| Tool | Cost | Lite | Key | What it does |
|---|---|---|---|---|
| `fiber_repair_list` | preview free; Kitchen Sink 2/row; Mosaic ~2/row + contacts | ✓ | ✓ | Parse, detect columns, then Kitchen Sink (≤ 50 rows) or Mosaic (async). `preview=true` returns the pre-flight card for free |
| `export_list` | free | ✓ | | Google Sheets (new / append / upsert), CSV or XLSX with column presets. Do-not-contact rows always left out |

## CRM (local, free)

| Tool | What it does |
|---|---|
| `crm_export_rows` | CRM-ready rows for a list, paged, do-not-contact removed, optional `minScore` |
| `crm_mark_exported` | Record a CRM export in the list's history |

The CRM's own MCP tools (`mcp__hubspot__…`, `mcp__salesforce__…`, `mcp__attio__…`, `mcp__crm__…`) are added by Pi once you `/crm connect`. They're hidden in Plan mode.

## Any Fiber operation

| Tool | Cost | What it does |
|---|---|---|
| `fiber_find_operation` | free | Search Fiber's catalog of 200+ operations by intent |
| `fiber_operation_docs` | free | Request schema, price, limits and examples for one operation |
| `fiber_call` | per operation; unknown costs always ask | Call any operation by id. Money movement and account operations are blocked; key admin needs `/fiber admin on` |
| `fiber_tracker` | free except `refresh` (2 per tracked company) | Fiber Tracker: `rules`, `lists`, `create`, `add`, `refresh`, `signals` |

## Fiber MCP bridge

When the bridge is on (`/fiber mcp`, `core` by default, off in sandbox and in the `lite` profile), every tool on the selected Fiber MCP servers is registered as `fibermcp_<server>_<tool>`. Calls are mapped to Fiber operation ids so the cost guard can estimate them; catalog-only meta tools are free.

## Pi's own tools

Pi's built-in tools stay available, filtered by mode:

| Mode / profile | `read` and other read-only tools | `bash`, `edit`, `write` |
|---|---|---|
| `rep`, `recruiting` | ✓ | hidden |
| `engineer` | ✓ | ✓ (shell commands that look like Fiber calls ask first, because they bypass the guard) |
| Plan mode (any persona) | ✓ | hidden |
| `lite` profile | `read` only | hidden |
