# 02 — Research Findings (from the linked sources)

All facts below were pulled from the linked pages and the machine-readable docs they point to (`llms.txt`, `ai-docs/*.md`), on 30 Sep 2026. Items marked **(verify)** should be confirmed against `https://api.fiber.ai/openapi.json` during implementation, because docs can drift.

---

## 1. Fiber AI API — fundamentals

| Topic | Detail |
|---|---|
| Base URL | `https://api.fiber.ai`, versioned under `/v1/` |
| Auth | API key as `apiKey` in the JSON body (POST), `?apiKey=` in the query (GET), **or** header `x-api-key` / `Authorization: Bearer`. Keys start with `sk_live_`. Get one at `fiber.ai/app/api` |
| Sandbox | `POST /v1/api-keys/create-sandbox` (`createSandboxApiKey`) creates a sandbox key. Use it for tests/CI **(verify semantics)** |
| Agent docs | `https://api.fiber.ai/llms.txt`, `llms-full.txt`, `ai-docs/index.md`, `ai-docs/{operationId}.md`, `openapi.json` (supports `Accept: text/markdown`) |
| Errors | 400 invalid request · 401 bad key · **402 out of credits** (includes purchase URL / `outOfCreditsAlert`) · 429 rate limited · 500 server (quote `errorCode` in support tickets) |
| Billing truth | `chargeInfo` (or `output.chargeInfo`) on every billable response is **the** authoritative charge. Credits are tracked at sub-credit precision (fractional) |
| Async pattern | Start → `taskId`/`runId` → poll. `llms.txt` says **poll every 30 s, never tighter**, until `progressPercent === 100` / `status === "NORMAL"` / `currentStage === "DONE"` (Mosaic uses `status: done`) |
| Pagination | Cursor-based via `nextCursor` |
| Agent etiquette (from `llms.txt`) | 1) Check credits before expensive ops. 2) **Get explicit user confirmation with the cost before charging.** 3) Never echo raw keys; mask them as `sk_live_****` |

### Credits and billing (docs.fiber.ai/billing)

| Operation | Cost |
|---|---|
| Work / personal email reveal | 2 credits |
| Phone reveal | 3 credits |
| Live fetch (profile/company) | 2 credits |
| Company / people search | 1 credit per result |
| Job posting search | 1 per posting |
| Audience build | 1 per company + 1 per prospect |
| Tracker entity check | 2 per entity per refresh |
| Kitchen Sink person | 2 credits (+2 with `liveFetch`) |
| Kitchen Sink bulk company | 2 per company |

- Low-credit alert fires around **500 credits remaining**, plus a separate alert at **10% of allocation** (`lowCreditAlert` inside `chargeInfo`).
- **Free:** `getOrgCredits`, `getRateLimits`, count endpoints (`companyCount`, `peopleSearchCount`, `jobPostingSearchCount`, `combinedSearchCount`), audience setup/estimates, tracker management, enums, typeaheads, `pollMosaic`, exclusion-list management.
- `getOrgCredits.creditsPerOperation` is expressed in **centiCredits** (100 = 1 credit). The UI must convert.
- Rate limits: reads 120/min, settings 10/min, `buyCredits` 2/min. Per-route limits come from `GET /v1/rate-limits`.

### Credit balance endpoint

`GET https://api.fiber.ai/v1/get-org-credits?apiKey=...` is free and allows 120 req/min.

```json
{ "output": [ {
  "organizationId": "string",
  "subscriptionId": "string",
  "max": 0, "used": 0, "available": 0,
  "usagePeriodResetsOn": "string",
  "creditsPerOperation": { "...": "tiered, centiCredits" }
} ] }
```

Note that `output` is an **array** (one element per org/subscription), so the UI must handle more than one entry.

---

## 2. Fiber MCP (docs.fiber.ai/build/mcp)

| Server | URL | Transport | Auth | Shape |
|---|---|---|---|---|
| **V2** | `https://mcp.fiber.ai/mcp/v2` | Streamable HTTP | API key | ~10 curated tools |
| **V3** | `https://mcp.fiber.ai/mcp/v3` | Streamable HTTP | **OAuth** (SSO via app.fiber.ai) | One tool per operation, **every** public op |
| **Core** | `https://mcp.fiber.ai/mcp` | Streamable HTTP | API key | Meta-tools: discover then call |
| **Lite** | `https://mcp.fiber.ai/mcp/lite` | Streamable HTTP | API key | Lighter meta-tool set **(verify tool list)** |

- **V2 tools (examples):** `api_companySearch`, `api_peopleSearch`, `api_individualRevealSync`, `api_companyLiveFetch`, `api_personLiveFetch`, `api_getOrgCredits`.
- **Core tools:** `search_endpoints` (ranked ops for an intent), `list_tag_packs` (recruiting/sales/signals groupings), `list_all_endpoints`, `get_endpoint_details_full`, `call_operation` (execute by `operationId`).
- Headers: `x-api-key: $FIBER_API_KEY` or `Authorization: Bearer`.
- Billing: no separate MCP price list. Each call is charged like the underlying API operation, and `chargeInfo` is authoritative.
- Fiber's recommendation: CLIs/IDEs → **V2 + `x-api-key`**. Chat UIs → V3 + OAuth. Check credits (`api_getOrgCredits` / `getOrgCredits`) before large ops.

Reference config (Claude Code):
```bash
claude mcp add --transport http fiber-ai-v2 https://mcp.fiber.ai/mcp/v2 \
  --header "x-api-key: $FIBER_API_KEY"
```

**Implication for Sailor:** use **V2** for the curated everyday tools and **Core** (`search_endpoints` → `get_endpoint_details_full` → `call_operation`) for full-catalog access with a tiny tool footprint. That covers "immediate access to all APIs" without loading 200 tool schemas into the context. Skip V3/OAuth in a terminal.

---

## 3. Kitchen Sink (docs.fiber.ai/enrichment/kitchen-sink)

Purpose: *resolve a person or company from whatever partial data you have.* Input types are auto-detected, and it draws on Fiber's identity graph, including reverse-email.

| Op (case-sensitive!) | Endpoint | Mode | Limits / cost |
|---|---|---|---|
| `KitchenSinkProfile` | `POST /v1/kitchen-sink/person` | Sync | 120 rpm · 2 cr (+2 with `liveFetch`) · ~1 min timeout |
| `kitchenSinkCompany` | `POST /v1/kitchen-sink/company` | Sync | 2 cr |
| `KitchenSinkBulkProfile` | `POST /v1/kitchen-sink/bulk/profile` | Sync | batch (verify max, likely 50) |
| `kitchenSinkBulkCompany` | `POST /v1/kitchen-sink/bulk/company` | Sync | 60 rpm · **1–50 companies/request** · 2 cr each · ~3 min timeout |

**Person inputs:** LinkedIn slug/URL/ID, email, name (with loose match), job title, company (LinkedIn id/name/domain), school, location (`countryCode` ISO-3166 alpha-3, `stateName`, `locality`). Options: `numProfiles` (1–10), `liveFetch`, `forceCompanyMatch`, `fuzzySearch`, `thoroughness`, `getDetailedEducation`, `getDetailedWorkExperience`.

**Company inputs:** `companyIdentifier` (oneOf `linkedinSlug` | `linkedinUrl` | `linkedinOrgID`), `companyName: {value}` (exact match on all words), `companyDomain: {value}` (prefixes stripped), `companyLocation`, `numCompanies` (1–10).

**Response:** `{ output: { data: [...], message? }, chargeInfo, warnings?, advice? }`. Bulk company returns `output.data` as an **array of arrays**, one inner array per query and in input order. Profiles have 44+ fields (work history, education, skills, inferred location + timezone, social metrics, hiring/open-to-work). Companies include tech stack, funding rounds/investors, headcount trends, identity data.

Contact reveal is **separate** (work email 2, personal email 2, phone 3).

When to use which:

| Scenario | Tool |
|---|---|
| Messy/ambiguous identifier | Kitchen Sink |
| Discovery with filters | `companySearch` / `peopleSearch` |
| Clean identifier refresh | Live enrich |
| Get email/phone | Contact enrichment |

---

## 4. Mosaic: CSV healing / repair-data

### `POST /v1/mosaic/start` (`startMosaic`)
- Heals and enriches **CSV, TXT, XLSX, or a public Google Sheet (first tab only)**. The file is fetched from a **public HTTPS URL** and processed async.
- Limits: **≤ 50 MiB**, `maxRows` 1–20,000, **20 req/min**.
- Body:
  - `apiKey` (req), `sourceUrl` (req, public HTTPS, direct download)
  - `customInstructions` (string, optional): free-text AI guidance
  - `options`: `contactInfo` (toggle work email / personal email / phone independently), `includeCompanyDetails` (default false), `liveFetch` (default **true**), `runRedline` (default false; compares output vs input columns), `maxRows`
- Billing: charged **after parsing**, based on row count × selected options. **The org's first run includes 1,000 free rows.**
- Response: `runId`, `isFreeTrialRun`, `chargeInfo` (one of `charged-now` / `charging-later` / `charged-for-async-process` / `free` / `credits-refunded`, with optional `lowCreditAlert`).

### `POST /v1/mosaic/poll` (`pollMosaic`), free, 120 rpm
- Body: `apiKey`, `runId`
- Response: `status` ∈ `pending | running | done | failed`, `rowCount`, `processedRowCount`, `isFreeTrialRun`, `stats { inputRows, outputRows, rowsWhereProfileFound, rowsWithContactDetails, rowsWithErrors }`, and when done, **temporary** `outputCsvUrl` and `reportUrl`.

### Other repair-data ops
`standardizeCompany` (`/v1/standardize/company/single`), `standardizeCompanyBulk`, `standardizeProfile` (normalize LinkedIn IDs/URNs).

**Implications:** (a) local files must be made reachable over public HTTPS (see 06 Edge Cases), (b) download outputs immediately because the links expire, (c) the cost is unknown until parsing, so estimate beforehand from the row count.

---

## 5. TypeScript SDK (github.com/fiber-ai/typescript-sdk)

- Package **`@fiberai/sdk`**, MIT, Node ≥ 18. Generated from OpenAPI (`openapi-ts.config.ts`).
- Pre-configured `client` pointing at `https://api.fiber.ai`. Customize it with `client.setConfig()` or `createClient()` (headers, fetch, interceptors).
- Calling convention: `op({ body: { apiKey, ... } })` for POST and `op({ query: { apiKey } })` for GET. Returns `{ data, error, response }`. Branch on `response.status`. Pass `throwOnError: true` to get exceptions instead.
- Types `FooResponse`, `FooErrors`. Zod schemas at `@fiberai/sdk/zod` (`zFoo`), useful for converting to TypeBox/JSON Schema for tool parameters.
- SDK README rate limits: search 180/min, contact enrichment 120/min single / 10/min batch, live enrichment 60/min, utility 10–50/min.
- Repo includes **`skills/fiber-sdk/`**, an Agent Skill for vibe-coding with the SDK. Sailor should bundle or reference it.
- SDK docs suggest env var `FIBERAI_API_KEY`, while MCP docs use `FIBER_API_KEY`. **Sailor should accept both.**

```ts
import { peopleSearch, companySearch, getOrgCredits } from "@fiberai/sdk";
const credits = await getOrgCredits({ query: { apiKey } });
const companies = await companySearch({ body: { apiKey,
  searchParams: { industriesV2: { anyOf: ["Software"] } }, pageSize: 25 } });
const people = await peopleSearch({ body: { apiKey,
  searchParams: { jobTitleV2: { anyOf: [{ type: "term", term: "CEO" }] } }, pageSize: 25 } });
```

---

## 6. Full Fiber operation catalog (grouped; from `ai-docs/index.md`)

Most relevant to GTM/recruiting are in **bold**.

- **Search:** **`companySearch`**, **`peopleSearch`**, `companyCount`, `peopleSearchCount`, **`paginatedCombinedSearch`**, `combinedSearchCount`, **`jobPostingSearch`**, `jobPostingSearchCount`, `quickCompanyResolve`, `quickPersonResolve`
- **Agentic/NL search:** **`slushieRun`** (`/v1/nlp-search/run`, prose → results), **`nlpSearchParse`** (prose → search params), `multiSourceSearch`
- **Contact details:** **`syncQuickContactReveal`**, **`syncTurboContactEnrichment`**, `triggerExhaustiveContactEnrichment` + `pollExhaustiveContactEnrichmentResult`, **`startBatchContactDetails`** / `pollBatchContactDetails` / `cancelBatchContactDetails`, `instantContactReveal`, `liteContactReveal`, `basicWorkEmailReveal`, `premiumPhoneReveal`
- **Kitchen Sink:** `KitchenSinkProfile`, `kitchenSinkCompany`, `KitchenSinkBulkProfile`, `kitchenSinkBulkCompany`
- **Repair data:** `startMosaic`, `pollMosaic`, `standardizeCompany(Bulk)`, `standardizeProfile`
- **Live fetch:** `profileLiveEnrich`, `companyLiveEnrich`, `startBatchLiveEnrich` / `pollBatchLiveEnrich`. LinkedIn activity: profile/company posts, comments, reactions, `postSearchByKeywords`
- **Audiences (bulk list building):** `createAudience` → `updateAudienceSearchParams` → `buildAudience` → `getAudienceStatus` → **`estimateEnrichmentCost`** → `triggerEnrichment` → `getEnrichmentStatus` → `exportCompanies` / `exportProspects` (CSV)
- **Exclusions (suppression):** company/prospect exclusion lists (create, add, remove, read, from audience)
- **Signals:** Saved searches (create, runs, spawn, skip), **Job changes** lists, **Tracker** (company/person lists, rules, `previewTrackerSignal`, `listTrackerSignals`), **Webhooks**
- **Company intel:** `getScoutingReport`, `getCompanyRevenue`, `getDepartmentSize`, `getTalentFlow(Rivals)`, depth chart, logos, rankings
- **Reverse lookup:** `reverseEmailLookup`, `liteReverseEmailLookup`, `reversePhoneLookup`
- **Validation:** **`emailBounceDetection`**, `validatePhoneNumber`
- **Recruiting extras:** GitHub lookup / GitHub→LinkedIn, **`stealthFoundersSearch`**, `blueCollarJobsSearch`, `twitterHandleToLinkedinUrl`, social-media lookup
- **Local business:** Google Maps search (start/check/poll), `startLocalBusinessSearch`, Yelp
- **Social/web:** X/Twitter, Reddit, Instagram, TikTok, YouTube, `webpageScreenshot`
- **Reference (free):** enums (industries, regions, metro areas, NAICS, skills, tags, technologies, time zones, languages, accelerators…), typeaheads (company, location, skills, `jobTitleRewrite`)
- **Account:** `getOrgCredits`, `getRateLimits`, API key management (`getCurrentApiKey`, **`updateApiKeyLimit`**, expiration, revoke), `listApiRequests` / `downloadApiRequests` (spend audit), auto-topup, `buyCredits`
- **Utility:** `healthCheck` (`GET /health`), `getOpenApi`

**Notably absent from Fiber:** a Google Sheets *write* integration. Mosaic can *read* a public Sheet, and audiences export CSV. Sheets export has to be built in the harness.

---

## 7. The Pi harness (pi-mono / `@earendil-works/pi-coding-agent`)

| Aspect | Finding |
|---|---|
| Install | `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` or `curl -fsSL https://pi.dev/install.sh \| sh` |
| Repo | `github.com/badlogic/pi-mono` (now also `earendil-works/pi`). Monorepo: `coding-agent`, `tui` (`@earendil-works/pi-tui`), `ai` (unified LLM API), `agent` |
| Philosophy | Minimal core, everything via extensions/skills/packages. Quote: **"No MCP. Build CLI tools with READMEs (see Skills), or build an extension that adds MCP support."** |
| LLMs | Subscriptions (Claude Pro/Max, ChatGPT Plus/Pro, Copilot) via `/login`, plus API keys for Anthropic, OpenAI, Azure, Gemini, Bedrock, Mistral, Groq, DeepSeek, xAI, OpenRouter, HF, Cloudflare and more. Custom providers via `~/.pi/agent/models.json` (so Ollama/vLLM/LM Studio work through OpenAI-compatible APIs) |
| Modes | Interactive TUI · print `-p` · `--mode json` · `--mode rpc` (JSONL over stdin/stdout) · SDK `createAgentSession()` |
| Extensions | TS modules in `~/.pi/agent/extensions/` or `.pi/extensions/`: `export default function (pi: ExtensionAPI) {...}` |
| Extension API | `pi.registerTool({name,label,description,parameters(TypeBox),execute(toolCallId, params, signal, onUpdate, ctx)})` with optional `renderCall`/`renderResult`; `pi.registerCommand(name,{description,handler})`; `registerShortcut`, `registerFlag`, `registerProvider`; `registerMessageRenderer`; events (`session_start`, `session_shutdown`, `before_agent_start`, `tool_call` (can **block**), `tool_result` (can transform), `context`, …); `pi.appendEntry()` for durable non-context state, `pi.sendMessage()` |
| UI API (`ctx.ui`) | `notify`, `select`, `confirm`, `input`, `editor`, **`setStatus(key, msg)`** (footer), **`setWidget(key, lines)`** (above/below editor), `setTitle`, `setEditorText`, **`custom(component)`** (full interactive TUI component with keyboard input). Check `ctx.hasUI` for headless modes |
| pi-tui | Components implement `render(width): string[]`, `handleInput(data)`, `invalidate()`. Built-ins: Text, Input, Editor, Markdown, Loader, SelectList, SettingsList, Container, Box, Image, VStack/HStack, **ScrollView**, MouseRegion; overlays; differential rendering; `matchesKey(data, Key.up)` |
| Skills | Agent Skills standard (`SKILL.md`) in `~/.pi/agent/skills/`, `.pi/skills/`, `.agents/skills/`, and packages. Invoked with `/skill:name` or auto-loaded |
| Prompt templates | Markdown in `~/.pi/agent/prompts/` → `/name` |
| Packages | `pi install npm:@x/y`, `git:github.com/u/r`. Bundle extensions + skills + prompts + themes. **Sailor ships this way** |
| Context files | `AGENTS.md` (global → parents → cwd), `AGENTS.override.md` |
| Sessions | JSONL trees in `~/.pi/agent/sessions/`, `/tree`, `/fork`, `/compact`, `-c` to continue |
| MCP options | Community packages: **`pi-mcp-adapter`** (token-efficient MCP adapter, listed on pi.dev/packages), `pi-mcp-tools`, etc., or our own client using `@modelcontextprotocol/sdk` |

---

## 8. Key takeaways that shape the design

1. **Pi gives us 80% of the harness.** Provider plumbing, TUI, sessions, skills, and packaging are already there. Our value is the Fiber layer and the GTM UX.
2. **Tools: typed SDK first, MCP for the long tail.** Typed tools give us control over cost gating, output trimming, and rich renderers. MCP Core gives full coverage in 5 small tools.
3. **Cost safety is required.** Fiber's own agent guide says to confirm cost before charging, and Pi's `tool_call` hook can block calls, so this is easy to enforce centrally.
4. **Mosaic needs a public URL, and its outputs expire.** The harness has to handle hosting and immediate download.
5. **Bulk ops have hard caps** (50 per Kitchen Sink bulk call, 20k rows per Mosaic run, 30 s polling), so chunking and job persistence are core features.
6. **No Sheets integration exists at Fiber.** We build it (Google Sheets API v4).

---

## 9. Corrections found while implementing (Sep 30, 2026)

These came from the per-operation `ai-docs` pages. They supersede anything above that conflicts:

| Topic | Correction |
|---|---|
| Count endpoints | `peopleSearchCount` is **1 credit per request** according to its ai-doc, even though the billing page lists counts as free. Sailor estimates 1 credit, and the ledger records the real `chargeInfo` |
| `nlpSearchParse` | **2 credits** per request, 120 rpm. Response: `output.searchId`, `output.parsedParams.{queryType, companySearchParams, profileSearchParams}`, `suggestedAction` |
| `slushieRun` | Synchronous. 2 credits fixed (first page) + 1 per result. `pageSize` 1–1000, `pageToken` pagination |
| `syncQuickContactReveal` | Body `{ linkedinUrl, enrichmentType: { getWorkEmails, getPersonalEmails, getPhoneNumbers } }`. **Every flag defaults to true (5 credits)**. Pricing: work 2 · personal 2 · all emails 3 · phones 3 · everything 5. Rate limit 200 rpm. Response `output.profile.{emails[{email,type,status}], phoneNumbers[{number,type}]}` |
| `startBatchContactDetails` | `personDetails[{ linkedinUrl: { value } }]`, **1–2,000 per request**, 30 rpm, returns `output.taskId`. Poll with `pollBatchContactDetails { taskId, cursor, take ≤ 100 }` (240 rpm, free) → `done/failed/canceled`, `statistics`, `pageResults[{inputs, outputs}]`, `nextCursor` |
| `startMosaic.options.contactInfo` | Fields `getWorkEmails / getPersonalEmails / getPhoneNumbers`, **all default true**. Sailor always sends them explicitly. There is no published per-row price, so Sailor's Mosaic estimate is marked uncertain |
| Kitchen Sink request shapes | `profileIdentifier: { identifier: "linkedinSlug" \| "linkedinUrl" \| "userID", value }`, `emailAddress` (string), `personName: { value, looseMatch }`, `companyName/companyDomain/jobTitle: { value }`, `profileLocation`. Bulk profile uses a `profiles[]` array (1–50, 60 rpm) and returns `output.data` as an array of arrays |
| `kitchenSinkCompany` | 2 credits, 120 rpm, ~30 s timeout. `numCompanies` 1–10 |
| `emailBounceDetection` | `{ email }` → `verdict ∈ ok \| undeliverable \| risky \| inconclusive`, `is_catch_all`, `deliverability_score`. 1 credit, 300 rpm |
| `chargeInfo` | Verbatim variants: `charged-now {creditsCharged}`, `charging-later {message}`, `charged-for-async-process {creditsCharged}`, `free {message}`, `credits-refunded {creditsRefunded}`. Any of them can carry `lowCreditAlert {getMoreCreditsUrl, message, availableCredits}` |
| `getRateLimits` | 20 rpm (not 120). Per-route `max` and `windowSeconds` |
| Operation index format | `- [\`opId\`](/ai-docs/opId.md) \`METHOD /path\` — summary` under `## Section` headings. Sailor parses this to reach every operation (`fiber_find_operation` / `fiber_call`) |
| Pi APIs | TypeBox is imported from `typebox`. `StringEnum` comes from `@earendil-works/pi-ai`. `tool_call` handlers return `{ block: true, reason }`. `ctx.ui.custom((tui, theme, kb, done) => Component)`. Prompt templates use `$1`, `$@` and `${1:-default}`, and the file name becomes the command |
