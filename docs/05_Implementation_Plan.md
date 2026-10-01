# 05 — Implementation Plan

> **Status (Sep 30, 2026):** phases P0–P5 are implemented in this repo, including the evals, which run against a mock Fiber server. [08_Implementation_Status.md](08_Implementation_Status.md) maps every task to code and lists what is still unverified against the live API. P6 (dogfooding) is next.

## 0. Phasing overview

| Phase | Goal | Duration (1–2 devs) | Demo-able outcome |
|---|---|---|---|
| **P0 Spike** | Prove Pi + Fiber + key flow | 0.5 day | `pi -e ./sailor` → "what's my balance?" works |
| **P1 MVP core** | Key, credit meter, cost guard, 6 typed tools, list store | 2–3 days | Chat → search → list → enrich with confirmations |
| **P2 Repair & export** | Kitchen Sink bulk, Mosaic jobs, Sheets export | 2–3 days | `/repair messy.csv` → healed Sheet |
| **P3 TUI** | ListPane, cards, renderers, jobs widget | 2–3 days | Visual list browsing + one-key actions |
| **P4 MCP + skills** | MCP bridge, GTM skills/prompts, fiber-sdk skill, modes | 2 days | Long-tail ops, call scripts, vibe-coded scripts |
| **P5 Hardening** | Edge cases (doc 06), evals, packaging, docs | 2–3 days | `npx sailor`, eval suite green on 3 models |
| **P6 Dogfood** | Growth team usage, feedback loop | 1–2 weeks | Weekly iteration |

**Hackathon cut (≈48 h):** P0 + P1 + Mosaic part of P2 + Sheets export + a basic ListPane + credit meter + cost guard + cold-call skill. Everything else is roadmap.

---

## P0 — Spike (half day)

1. Install Pi: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`. Configure an LLM via `/login` or env.
2. Create `packages/pi-fiber/extensions/sailor/index.ts`, and run `pi -e ./packages/pi-fiber/extensions/sailor`.
3. Add `@fiberai/sdk`. Register the `fiber_credits` tool and set the footer status.
4. Read `pi-mono/packages/coding-agent/examples/extensions/` (e.g., `hello.ts`, `todo.ts`, `tools.ts`) and `docs/extensions.md`. Already verified: the `tool_call` event fields, `setStatus`/`setWidget` signatures, and the `registerTool` object form. Still to confirm in code: the `renderCall`/`renderResult` signatures and whether a `ctx.executeTool` exists for pane actions.

```ts
// extensions/sailor/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";          // Pi tools use TypeBox schemas
import { getOrgCredits } from "@fiberai/sdk";
import { loadFiberKey } from "./config";

export default function sailor(pi: ExtensionAPI) {
  pi.on("session_start", async (_e, ctx) => {
    const key = await loadFiberKey();
    if (!key) return ctx.ui.notify("Run /fiber login to connect Fiber", "warning");
    const { data, response } = await getOrgCredits({ query: { apiKey: key } });
    if (response.status === 401) return ctx.ui.notify("Invalid Fiber key", "error");
    const org = data?.output?.[0];
    ctx.ui.setStatus("fiber", `Fiber ${fmt(org?.available)} cr`);
  });

  pi.registerTool({
    name: "fiber_credits",
    label: "Fiber credits",
    description: "Get the Fiber org credit balance (free). Call before large/expensive operations.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, _ctx) {
      const key = await loadFiberKey();
      const { data } = await getOrgCredits({ query: { apiKey: key! } });
      const o = data!.output[0];
      return {
        content: [{ type: "text", text: `available=${o.available} used=${o.used} max=${o.max} resets=${o.usagePeriodResetsOn}` }],
        details: o,
      };
    },
  });
}
const fmt = (n?: number) => (n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 1 });
```

---

## P1 — MVP core (2–3 days)

### Tasks
| # | Task | Notes |
|---|---|---|
| 1.1 | `config.ts`: key resolution (env `FIBER_API_KEY`/`FIBERAI_API_KEY` → keytar → 0600 file), `/fiber login|logout|whoami` | Masked `ctx.ui.input`; validate via `getOrgCredits` |
| 1.2 | `fiber/client.ts`: wrapper `callFiber(opId, fn, args)` injects the key, rate-limits, handles 429/402/5xx, extracts `chargeInfo`, emits events | One choke point for all HTTP |
| 1.3 | `fiber/ops.ts` + `cost.ts`: registry + estimators; load `creditsPerOperation` (÷100) | Static fallback table from billing docs |
| 1.4 | `guard/costGuard.ts`: `pi.on("tool_call")` → estimate → confirm/block; budgets; dry-run; headless policy | See skeleton below |
| 1.5 | `meter/credits.ts`: footer status, ledger writes, 60 s refresh, low/empty states, `/credits` | |
| 1.6 | `store/db.ts`: SQLite schema (03 §4.6), migrations, list CRUD, cache | `better-sqlite3` |
| 1.7 | Typed tools v1: `fiber_nl_search`, `fiber_search_people`, `fiber_search_companies`, `fiber_count` (free), `fiber_resolve_person`, `fiber_resolve_company`, `fiber_reveal_contacts`, `list_create/get/add/remove` | Return handles + ≤10-row previews |
| 1.8 | `fiber/trim.ts`: field allowlists per entity for LLM output; full JSON to the store | Keeps context small |
| 1.9 | System prompt addendum (`before_agent_start` or `AGENTS.md` in the package): Sailor's role, cost etiquette, handles, grounding, compliance | |
| 1.10 | Redaction: `sk_live_…` masking on `tool_result` + `context` events | Test by grepping the session JSONL |

### Cost guard skeleton
```ts
// guard/costGuard.ts  (verified in Pi docs: event.toolName, event.toolCallId, event.input (mutable);
// return { block: true, reason } to block)
export function installCostGuard(pi: ExtensionAPI, deps: Deps) {
  pi.on("tool_call", async (event, ctx) => {
    const meta = deps.ops.forTool(event.toolName, event.input);   // incl. MCP call_operation → operationId
    if (!meta?.paid) return;                                       // free → allow
    const est = meta.estimate(event.input, deps.pricing);          // { credits, basis }
    const bal = deps.meter.available();
    const s = deps.budget.check(est.credits);                      // session/daily remaining

    if (deps.settings.dryRun)
      return { block: true, reason: `DRY RUN: would cost ~${est.credits} cr (${est.basis})` };
    if (est.credits > bal)
      return { block: true, reason: `Insufficient credits: need ~${est.credits}, have ${bal}` };
    if (!s.ok)
      return { block: true, reason: `Over ${s.which} budget (${s.remaining} left). Ask user to raise with /budget.` };
    if (est.credits <= deps.settings.autoApproveUnder) return;     // allow silently (footer shows)

    if (!ctx.hasUI)
      return deps.settings.headlessMaxSpend >= est.credits ? undefined
        : { block: true, reason: "Paid call needs approval; rerun with --fiber-max-spend" };

    const ok = await ctx.ui.confirm(
      `Spend ~${est.credits} Fiber credits?`,
      `${meta.opId}: ${est.basis}\nBalance ${bal} → ~${bal - est.credits}`,
    );
    if (!ok) return { block: true, reason: "User declined the charge." };
  });
}
```

### Typed tool pattern
```ts
pi.registerTool({
  name: "fiber_resolve_person",
  label: "Resolve person (Kitchen Sink)",
  description: "Resolve ONE person from any partial identifiers (LinkedIn URL, email, name+company). ~2 credits (+2 if liveFetch).",
  parameters: Type.Object({
    linkedinUrl: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    companyName: Type.Optional(Type.String()),
    companyDomain: Type.Optional(Type.String()),
    liveFetch: Type.Optional(Type.Boolean({ default: false })),
    listId: Type.Optional(Type.String({ description: "Add result to this list" })),
  }),
  async execute(_id, p, signal, onUpdate, ctx) {
    const res = await fiber.call("KitchenSinkProfile", { ...mapToKitchenSinkBody(p), numProfiles: 1 }, { signal });
    const profile = res.output.data?.[0];
    if (!profile) return text(`No match. Fiber said: ${res.output.message ?? "—"}`);
    const entity = store.upsertPerson(profile, "KitchenSinkProfile");
    if (p.listId) store.addToList(p.listId, entity.id);
    return { content: [{ type: "text", text: summarizePerson(entity) }], details: { entityId: entity.id, charge: res.chargeInfo } };
  },
  // renderResult: ProspectCard mini view (P3)
});
```

**Exit criteria P1:** The E2E flow "find → count → search → list → reveal 5 emails" passes with confirmations, the footer updates, and no key leaks.

---

## P2 — Repair and export (2–3 days)

| # | Task | Notes |
|---|---|---|
| 2.1 | `io/parse.ts`: detect encoding (chardet → iconv), delimiter, header row, BOM, quoted newlines, empty rows. Column role detection (email/linkedin/name/company/domain/phone) | Pure functions + fixtures |
| 2.2 | `io/sanitize.ts`: trim, lower-case emails, strip `mailto:`, normalize LinkedIn URL variants → `linkedin.com/in/<slug>`, E.164 phones, remove formula prefixes | |
| 2.3 | `fiber_repair_list` tool + `/repair` command: engine selection (KS bulk ≤ 50 rows vs Mosaic), pre-flight card, estimate | |
| 2.4 | KS bulk path: chunk 50/request, respect 60 rpm, map array-of-arrays back to input rows, per-row status | Partial failure tolerant |
| 2.5 | Hosting adapters: `gdrive` (upload + anyone-with-link reader, revoke after `status != pending`), `s3/r2` presigned GET (TTL 1 h), `manual` (user pastes URL), passthrough for public Sheet URLs | Warn about PII exposure; see doc 06 |
| 2.6 | `jobs/manager.ts`: persist, poll (≥ 30 s), resume on start, JobsWidget, notify + `pi.sendMessage` on completion | |
| 2.7 | Mosaic path: `startMosaic` → job → on `done` download `outputCsvUrl` + `reportUrl` immediately → `*.healed.csv` + import to list → show stats; `failed` → error + offer KS fallback | |
| 2.8 | Chunking >20k rows into multiple runs + merge | |
| 2.9 | `export/sheets.ts`: OAuth loopback + device flow, create/append/upsert, RAW input, 1k-row chunks, formatting, presets | `googleapis` |
| 2.10 | `/export csv|xlsx` with formula escaping; sequencer presets | |
| 2.11 | `/import sheets <url>` and `/import csv <path>` | |

```ts
// jobs/manager.ts (core loop)
const POLL_MS = 30_000;
async function tick() {
  for (const job of store.jobs.due(Date.now())) {
    const r = await fiber.call("pollMosaic", { runId: job.remoteId });     // free
    store.jobs.update(job.id, { status: r.output.status, progress: [r.output.processedRowCount, r.output.rowCount] });
    if (r.output.status === "done") {
      const csv = await download(r.output.outputCsvUrl);                    // temporary URL → fetch now
      const report = await download(r.output.reportUrl);
      await finalizeRepair(job, csv, report);                               // write *.healed.csv, import, revoke temp link
    } else if (r.output.status === "failed") {
      await failRepair(job, r);
    } else store.jobs.reschedule(job.id, Date.now() + POLL_MS);
  }
}
```

**Exit criteria P2:** `/repair examples/messy_1k.csv` → healed CSV + list + Sheet URL. Kill/restart mid-run resumes. Sheet cells beginning with `=` render as text.

---

## P3 — TUI (2–3 days)

| # | Task | Notes |
|---|---|---|
| 3.1 | `ui/ListPane.ts` implementing pi-tui `Component` (`render(width)`, `handleInput`, `invalidate`); virtualized rows; column presets; sort/filter; multi-select | Use `truncateToWidth`, `matchesKey(Key.*)` |
| 3.2 | Key actions call shared action functions (same as tools) → cost guard applies | Actions route through `ctx.executeTool` or a shared service |
| 3.3 | `ProspectCard`, `CompanyCard` overlays; sparkline util; local-time util from timezone | Image logos only when the terminal supports it |
| 3.4 | `renderCall`/`renderResult` for all typed tools (compact tables + cost line) | Plain-text fallback when `!ctx.hasUI` |
| 3.5 | Footer status composition (credits · session spend · budget · jobs) and the `JobsWidget` via `setWidget` | |
| 3.6 | Theme `sailor.json` (dark/light), responsive layouts at 80/120/200 cols | |
| 3.7 | Shortcuts: `ctrl+l` lists, `ctrl+j` jobs, `ctrl+k` credits | `pi.registerShortcut` |

**Exit criteria P3:** Navigate a 10k-row list smoothly. Enrich 5 selected rows with `e` → confirm → the row updates in place.

---

## P4 — MCP, skills, modes (2 days)

| # | Task |
|---|---|
| 4.1 | `mcp/bridge.ts` with `@modelcontextprotocol/sdk` StreamableHTTP client, `x-api-key` header, Core by default; dynamic `registerTool` per MCP tool (prefix `fibermcp_`); cost guard via `operationId`; lazy connect; reconnect |
| 4.2 | (Alt/fast path) ship `pi-mcp-adapter` config pointing at Fiber MCP; compare token usage/behavior |
| 4.3 | Skills: `sailor-prospecting`, `sailor-list-repair`, `sailor-cold-call`, `sailor-sales-strategy`, `sailor-recruiting`, `sailor-gtm-engineering`; vendor `fiber-sdk` skill (respect MIT license, attribute) |
| 4.4 | Prompt templates: `/icp`, `/callscript`, `/sequence`, `/account-plan`, `/sourcing`, `/tam` |
| 4.5 | Modes: `rep` (default; coding tools hidden), `engineer` (coding tools + fiber-sdk), `recruiting` (persona pack). Implement via tool exposure toggles in `before_agent_start` |
| 4.6 | `toolsProfile: lite` for small/local models (≤ 8 tools, shorter descriptions) |
| 4.7 | `/new-script` scaffolder + `examples/scripts/weekly_reenrich.ts` |

### Skill skeleton: `skills/sailor-cold-call/SKILL.md`
```markdown
---
name: sailor-cold-call
description: Write grounded cold-call scripts for prospects in a Sailor list. Use when the user asks for call scripts, talk tracks, voicemails, or objection handling.
---
1. Load facts with list_get(listId, fields=[name,title,tenure,company,headcount_trend,funding.latest,tech,recent_posts,timezone]).
2. For each prospect pick ONE trigger (priority: funding < 6mo, job change < 90d, hiring surge, relevant post). If none, use role-based pain.
3. Structure (60s): permission opener → trigger → 1-line value prop → 2 discovery Qs → CTA (15-min meeting). Add voicemail (≤ 20s) and 3 objections.
4. Every fact must carry a citation tag like [funding.latest]. Never invent numbers, names, or events. Mark guesses [unverified].
5. Add "Best window: 9–11am local (<tz>)". Skip prospects flagged do-not-contact.
6. Save to list notes via list_update; offer /export sheets.
```

---

## P5 — Hardening and packaging (2–3 days)

1. Work through **every item in `06_Edge_Cases_and_Gaps.md`** and tag each as handled / documented / deferred.
2. Package `@sailor/pi-fiber` so `pi install npm:@sailor/pi-fiber` works. Publish with provenance. The manifest format below is verified from Pi's `docs/packages.md`:
   ```json
   {
     "name": "@sailor/pi-fiber",
     "keywords": ["pi-package"],
     "pi": {
       "extensions": ["./extensions"],
       "skills": ["./skills"],
       "prompts": ["./prompts"],
       "themes": ["./themes"]
     }
   }
   ```
3. `sailor-cli`: `npx sailor` → checks Node, installs/locates Pi, installs the package, runs onboarding, launches. `sailor doctor` diagnoses key, LLM, Sheets auth, hosting, DB, and terminal capabilities.
4. Docs: README quickstart (2-minute path), config reference, cost model explainer, privacy note, contribution guide.
5. Evals (see doc 07) green on 3 providers.
6. License MIT. Attribute Pi (MIT) and the Fiber SDK skill.

---

## P6 — Dogfood with Fiber's growth team

- In-app `/feedback` writes a local report (optionally opens a GitHub issue draft). Opt-in anonymous usage metrics: commands used, errors, and spend per op, **never** list contents.
- Weekly triage and releases. Track the success metrics in 01 §6.

---

## Roadmap after v1
- Optional web viewer over Pi RPC mode (browser ListPane, charts) for users who prefer GUI.
- CRM connectors (HubSpot, Salesforce) and sequencer push (Instantly, Smartlead, Outreach) behind explicit confirms.
- Scheduled jobs (weekly re-enrich, tracker digests) via cron + Pi print mode.
- Team workspaces (shared SQLite → Postgres), shared budgets.
- Webhook listener for Tracker signals → desktop/Slack notifications.

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| Pi extension API changes (active project) | Pin Pi version, add a CI job against Pi `main`, keep a thin adapter layer |
| Fiber API schema drift | Generate the op registry from `openapi.json` at build time; contract tests against the sandbox key |
| Small models misuse tools / overspend | Lite profile, cost guard, dry-run, eval gating per model |
| Mosaic needs public URLs (PII exposure) | Short-TTL presigned URLs, revoke on start, explicit consent, prefer public-Sheet or user-hosted |
| Terminal diversity (Windows, tmux, SSH) | Plain-text fallbacks, no-color mode, device-flow OAuth |
