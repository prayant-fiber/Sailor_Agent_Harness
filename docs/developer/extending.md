# Extending Sailor

Recipes for the changes people make most often. Read [AGENTS.md](../../AGENTS.md) first for the ground rules, and [architecture](architecture.md) for how the pieces connect.

**Contents:** [Add a Fiber operation](#add-a-fiber-operation) · [Add a tool](#add-a-tool) · [Add a slash command](#add-a-slash-command) · [Add a skill](#add-a-skill) · [Add a prompt template](#add-a-prompt-template) · [Add an export preset](#add-an-export-preset) · [Add a CRM](#add-a-crm) · [Handle a new sandbox gap](#handle-a-new-sandbox-gap) · [Add an eval scenario](#add-an-eval-scenario) · [Use the core from a script](#use-the-core-from-a-script)

---

## Add a Fiber operation

Every operation Sailor calls by name needs an entry in the registry, `packages/pi-fiber/src/core/fiber/ops.ts`. The registry drives routing, rate limiting, retries, cost estimates and the guard.

```ts
{ opId: "jobPostingSearch", method: "POST", path: "/v1/job-search",
  paid: true, idempotent: false, rpm: 180, family: "search", verified: true,
  estimate: (a) => ({ credits: pageSize(a), basis: `up to ${pageSize(a)} postings × 1` }) },
```

| Field | Rule |
|---|---|
| `opId` | Fiber's operationId, exact case (lookups are case-insensitive) |
| `method`, `path` | From the operation's agent docs (`https://api.fiber.ai/ai-docs/<opId>.md`). Path params use `{name}` and are filled from args |
| `paid` | `true` if Fiber can charge for it |
| `idempotent` | `true` only if retrying can't double-charge or double-write. Free reads: yes. Paid charges: almost always no |
| `rpm` | Requests per minute from the docs (client-side token bucket) |
| `estimate` | Returns `{ credits, basis }`. Use `Pricing` keys (`p.get("contact.email", 2)`) when a price exists in `pricing.ts`, so live prices override it |
| `verified` | `false` (and `uncertain: true` in the estimate) when the price isn't confirmed in the docs |
| `deny` | Never callable by the agent (money movement, account sign-up) |
| `admin` | Needs `/fiber admin on` (API-key settings) |
| `timeoutMs` | For slow operations |

Operations without an entry still work through `fiber_call` (via the catalog), but they're treated as "unknown cost" and always ask. Add a unit test in `test/policy.test.ts` for any non-trivial estimator, and update the mock server (`evals/mock-fiber-server.ts`) if tests or evals will call it.

## Add a tool

Tools live in `packages/pi-fiber/src/extension/tools/`. Always register through `registerSailorTool()` (in `tools/common.ts`), never `pi.registerTool()` directly: the wrapper records the estimator for the guard, handles the lite profile, checks for a key, redacts errors, adds the sandbox note and re-renders the meter.

```ts
// src/extension/tools/jobs.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { asUntrusted } from "../../core/grounding";
import type { Runtime } from "../runtime";
import { ok, registerSailorTool } from "./common";

export function registerJobTools(pi: ExtensionAPI, rt: Runtime): void {
  registerSailorTool(pi, rt, {
    name: "fiber_search_jobs",
    label: "Search job postings",
    description: "Search job postings with Fiber (1 credit per posting returned). Use for hiring signals. Default pageSize 25.",
    parameters: Type.Object({
      query: Type.String({ description: "Role or keywords, e.g. 'RevOps manager'" }),
      pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
    }),
    // Read by the cost guard before execute(). Return undefined for free calls.
    estimate: (input, r) => r.gtm.estimate("jobPostingSearch", input),
    async execute(p: { query: string; pageSize?: number }, _ctx, { signal }) {
      // Illustrative body: take the real shape from the operation's agent docs (fiber_operation_docs).
      const res = await rt.client.call("jobPostingSearch", { searchParams: { keywords: [p.query] }, pageSize: p.pageSize ?? 25 }, { signal });
      const rows = (res.output as any)?.data ?? [];
      // Third-party text goes back to the model wrapped as untrusted, and short.
      return ok(asUntrusted("fiber", rows.slice(0, 15).map((j: any) => `${j.title} · ${j.company_name}`).join("\n")), { count: rows.length });
    },
  });
}
```

Then call `registerJobTools(pi, rt)` in `src/extension/index.ts` **before** `installCostGuard(pi, rt)`.

Checklist:

- **Description**: say what it does, what it costs, and when to use it instead of a neighbour. The model reads this.
- **Never put `apiKey` in parameters.** `FiberClient` injects it.
- **Free local tools** set `needsKey: false` so they work before `/fiber login`.
- **`lite: true`** only for core tools a small model needs.
- **Estimators should be exact about what will run.** If the estimate needs real work (reading a file, filtering cached rows), compute a plan, store it in `rt.plans.set(toolCallId, plan)` and reuse it in `execute` (see `tools/contacts.ts`).
- **Save results to the store** and return a list handle plus a short preview, not full payloads.
- **Sandbox**: if the tool only wraps an operation Fiber hasn't sandboxed, add its name to `SANDBOX_HIDDEN_TOOLS` in `core/fiber/sandbox.ts`.
- Add it to the [tool reference](../reference/tools.md).
- Test it in `test/extension.test.ts` (registration, guard behaviour, execution against the mock).

## Add a slash command

Commands live in `src/extension/commands/`. Pattern:

```ts
pi.registerCommand("example", {
  description: "One line with the usage: /example <list> [--limit N]",
  handler: async (args, ctx) => {
    rt.init(ctx);                                    // always first
    const a = parseArgs(args, ["dry"]);              // positional a._, flags a.flags; list boolean flags
    const limit = flagNum(a, "limit");
    try {
      const estimate = { credits: 10, basis: "10 × 1" };
      const ok = await approveSpend(rt, ctx, "/example", estimate);   // same rules as model tool calls
      if (!ok.ok) { say(ctx, ok.reason, "warning"); return; }
      // … do the work through rt.gtm / rt.client / rt.store …
      say(ctx, "Done.");
    } catch (err) { say(ctx, errorMessage(err), "error"); }
    rt.meter.render();
  },
});
```

- Every paid action in a command goes through `approveSpend()`.
- Use `ctx.hasUI` before any dialog; in print/JSON mode fall back to `console.log` (the local `say()` helpers do this).
- Long output goes in `showText(ctx, title, lines)` (a scrollable viewer), not a toast.
- If a command needs judgement rather than a fixed procedure, send the model a precise brief with `pi.sendUserMessage(brief, { deliverAs: "followUp" })`, as `/qualify`, `/lookalikes` and `/crm export` do. Keep the brief explicit about which tools to use and what's free.
- Persist settings with `saveGlobalConfig()` then `rt.reloadConfig()`.
- Document it in [commands.md](../guide/commands.md) and, if it's user-facing, the [user guide](../guide/user-guide.md).

## Add a skill

Skills are Markdown playbooks Pi loads on demand. Create `packages/pi-fiber/skills/<name>/SKILL.md`:

```markdown
---
name: sailor-renewals
description: Prepare renewal and expansion plays for existing customers from Fiber company data. Use when the user asks about renewals, expansion, upsell or customer health.
---

# Renewals with Sailor

## Workflow (cheap first)
1. …name the exact Sailor tools, their costs and the order…

## Rules
- …what never to do (reveal without asking, invent facts, …)…
```

The `description` decides when Pi loads the skill, so make it specific about triggers. Name concrete tools and costs in the body, keep it short (existing skills are 20–50 lines), and repeat the important guardrails (cheap first, ground every fact, respect DNC).

## Add a prompt template

Create `packages/pi-fiber/prompts/<name>.md`. It becomes `/<name>`:

```markdown
---
description: Renewal plan for one customer account
argument-hint: "<company domain or name>"
---
Use the sailor-renewals skill for: $ARGUMENTS
```

`$ARGUMENTS` is everything, `$1` the first argument, `${@:2}` the rest. Templates should stay one or two lines that point at a skill.

## Add an export preset

Presets live in `src/core/export/rows.ts`. Add the name to the `Preset` type and `PRESETS`, then add its column mapping alongside the existing ones (follow `outreach` or `hubspot`). The tool schema, `/export-list --preset` and the list pane's preset picker all read `PRESETS`; update the pane's hard-coded picker list in `commands/lists.ts` too. Add a case to `test/io.test.ts`.

## Add a CRM

CRMs are data, not code: add an entry to `CRMS` in `src/core/crm.ts` and its id to `CrmId`.

```ts
pipedrive: {
  id: "pipedrive", label: "Pipedrive", server: "pipedrive",
  docs: "https://…",
  authSteps: () => ["Sign in: run /mcp login pipedrive."],
  entry: () => ({ url: "https://mcp.example.com/pipedrive", exposure: "direct" }),   // Pi mcpServers entry
  agentHints: "Pipedrive: search persons by email before creating; never delete.",
},
```

`entry` is a Pi `mcpServers` entry (`url` for remote servers, or `command`/`args` for local ones). `agentHints` goes into the export brief, so say how to dedupe and which fields to use. Tools from the server are automatically hidden in Plan mode (`isCrmTool`). Add the setup steps to [configuration.md](../guide/configuration.md#crm).

## Handle a new sandbox gap

If Fiber returns 501 for an operation on sandbox keys, `FiberClient` learns it at runtime. To make it permanent (no wasted call, and the model is told up front), add the opId to `SANDBOX_UNSUPPORTED_OPS` in `src/core/fiber/sandbox.ts`, and if a tool only wraps that operation, add the tool to `SANDBOX_HIDDEN_TOOLS`. `demo/probe-sandbox.sh` checks endpoints against a real sandbox key. Cover it in `test/sandbox.test.ts`.

## Add an eval scenario

Agent-behaviour changes (prompt, skills, tool descriptions, guard messages) should come with a scenario in `evals/scenarios/`. Scenarios run a real LLM against the mock Fiber server and assert on **what actually hit the API**, so they work across model providers.

```json
{ "id": "E11", "title": "Counts before searching", "prompt": "Find VPs of Sales at London fintechs",
  "maxSpend": 30,
  "expect": { "calledPaths": ["/v1/people-search/count"], "maxPageSize": 25, "finalTextMatches": "(count|match)" } }
```

Fields: `prompt`, optional `setup: "search3"` (pre-seed a list), `mock` options (`credits`, `outOfCreditsAfter`, `injectionProfile`, `rateLimitOnce`, `mosaicPollsUntilDone`), `flags`, `files` (written into the temp workspace), `maxSpend` (`--fiber-max-spend`). Assertions: `calledPaths`, `notCalledPaths`, `anyOfPaths`, `maxCredits`, `maxPageSize`, `maxCallsToPath`, `finalTextMatches`, `finalTextNotMatches`. See [testing](testing.md#agent-evals).

## Use the core from a script

`src/core` has no Pi dependency and is exported as `@sailor/pi-fiber/core`, so scripts can reuse the client, store and repair engine with the same guarantees:

```ts
import { FiberClient, Store, loadConfig, resolveFiberKey } from "@sailor/pi-fiber/core";

const config = loadConfig();
const key = resolveFiberKey(config.fiber.profile)?.key;
const client = new FiberClient({ baseUrl: config.fiber.baseUrl, getKey: () => key, onCharge: (e) => console.log(e.opId, e.credits) });
const store = new Store(Store.defaultPath());

const credits = await client.call("getOrgCredits", {});
console.log(credits.output);
console.log(store.lists());
```

For standalone automations that don't need Sailor's store, prefer the official `@fiberai/sdk` (see `/new-script` and `examples/scripts/weekly_reenrich.ts`).
