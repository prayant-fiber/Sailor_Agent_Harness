# AGENTS.md

Orientation for AI coding agents (and humans) working **on** this repository. For using Sailor, see the [README](README.md) and [docs/guide](docs/guide/).

## What this is

Sailor is an open-source GTM agent harness: a **Pi extension package** that adds Fiber AI tools, a cost guard, a credit meter, list panes, list repair, exports, CRM push and GTM skills to the [Pi](https://github.com/badlogic/pi-mono) terminal agent. Users bring their own LLM and Fiber API key. Every Fiber call can spend the user's money, so cost safety and key safety are the two properties that must never regress.

## Repo map

```
packages/pi-fiber/                 @sailor/pi-fiber — the Pi package
  extensions/sailor/index.ts       entry Pi loads (re-exports src/extension/index.ts)
  src/core/                        pure logic, NO Pi imports (exported as @sailor/pi-fiber/core)
    fiber/ops.ts                   operation registry: routing, rpm, idempotency, prices, deny/admin
    fiber/client.ts                FiberClient: the only HTTP path to Fiber
    budget.ts                      decide(): the pure cost policy
    store/db.ts                    SQLite schema + all queries (node:sqlite)
    gtm.ts, prospecting.ts         search / resolve / reveal / validate / scoring services
    repair/engine.ts, jobs/        Kitchen Sink + Mosaic repair, persistent jobs
    io/, export/, google/, hosting/, mcp/, crm.ts, secrets.ts, redact.ts, grounding.ts
  src/extension/                   Pi wiring
    index.ts                       registration order + lifecycle hooks
    runtime.ts                     Runtime singleton (config, client, store, jobs, meter)
    costGuard.ts                   tool_call hook + approveSpend()
    modes.ts, agentMode.ts         persona tool gating; Build / Plan / Sandbox
    prompt.ts                      per-turn system-prompt addendum
    tools/*.ts                     tools via registerSailorTool() (tools/common.ts)
    commands/*.ts                  slash commands
    ui/                            ListPane, cards, Fiber look
  skills/<name>/SKILL.md           GTM playbooks loaded by Pi
  prompts/*.md                     prompt templates (/icp, /callscript, …)
  themes/                          fiber-dark / fiber-light
  test/                            node:test suites; test/stubs replace Pi packages
packages/sailor-cli/bin/sailor.mjs `sailor` launcher — plain JS, zero deps, no build
evals/                             mock Fiber API + MCP server, scenarios E1–E10, runner
examples/  demo/  docs/            examples, demo scripts, documentation
types/shims/                       Pi/SDK type shims for offline typecheck
```

## Commands

```bash
npm install                     # Node >= 22.13 required (node:sqlite)
npm test                        # all tests; no network, no keys, no LLM
npm run typecheck               # strict TS against real Pi packages
npm run typecheck:offline       # against types/shims
npm run mock:fiber              # mock Fiber API + MCP on :4455 (key sk_live_testkey123456)
npm run evals                   # agent evals (needs pi + an LLM key; Fiber mocked)
pi -e ./packages/pi-fiber/extensions/sailor   # run the extension
```

One test file: `cd packages/pi-fiber && npx tsx --tsconfig tsconfig.test.json --test test/policy.test.ts`.

Run `npm test` and `npm run typecheck` before you consider a change done. If tests fail with `TransformError`, `node_modules` was installed on another OS/arch: reinstall.

## Hard rules

These are invariants. Breaking one is a bug even if tests pass.

1. **Every Fiber HTTP call goes through `FiberClient`.** No `fetch` to `api.fiber.ai` anywhere else. It injects the key, rate-limits, applies the retry policy and records `chargeInfo`.
2. **Never put `apiKey` in a tool schema, a prompt, a log line or an error message.** Run user-visible text through `redactText()`. The key is injected at call time only.
3. **Every paid tool declares an estimator** (`registerSailorTool({ estimate })`). Every paid action in a command or pane goes through `approveSpend()`. Tools must be registered **before** `installCostGuard()` in `src/extension/index.ts`.
4. **Every new Fiber operation gets a registry entry** in `src/core/fiber/ops.ts` with `paid`, `idempotent`, `rpm` and an estimate. Mark `verified: false` and return `uncertain: true` when the price isn't confirmed in Fiber's docs. Money movement and account sign-up are `deny: true`; API-key settings are `admin: true`.
5. **Never auto-retry a paid, non-idempotent call** after a timeout or 5xx. Raise `UnknownOutcomeError`.
6. **Third-party text reaches the model inside `asUntrusted(source, text)`** (profiles, posts, company data, API docs, MCP output).
7. **Exports escape formulas** (`= + - @`) and Sheets writes use `valueInputOption=RAW`. Do-not-contact and `excluded` rows never leave Sailor (exports, CRM rows).
8. **`src/core` has no Pi imports**, so it stays usable from scripts, the CLI and plain tests.
9. **Return handles, not payloads.** Tools save to the store and return a list id plus a short preview; the model reads more with `list_show` / `entity_get`.
10. **Plan mode and Sandbox mode must not spend.** Plan mode blocks anything with a cost; Sandbox mode never falls back to a live key.
11. **Recruiting mode never filters, ranks or infers by protected attributes.**
12. **The launcher stays plain JavaScript with no dependencies.** If you change secret storage in `core/secrets.ts`, mirror it in `sailor.mjs`.

## Where to make common changes

| Task | Files | Guide |
|---|---|---|
| Call a new Fiber operation | `core/fiber/ops.ts` (+ `pricing.ts` if it introduces a price) | [extending](docs/developer/extending.md#add-a-fiber-operation) |
| New agent tool | `extension/tools/<area>.ts`, register in `extension/index.ts` | [extending](docs/developer/extending.md#add-a-tool) |
| New slash command | `extension/commands/<area>.ts` | [extending](docs/developer/extending.md#add-a-slash-command) |
| Change cost rules | `core/budget.ts` (pure) + `test/policy.test.ts` | |
| Change what the model is told | `extension/prompt.ts`, tool descriptions, `skills/` | add an eval scenario |
| Persona / tool visibility | `extension/modes.ts` | |
| Build / Plan / Sandbox behaviour | `extension/agentMode.ts`, `core/fiber/sandbox.ts` | |
| Database schema | `core/store/db.ts` (`SCHEMA` + additive `migrate()`) | never drop or rename columns |
| Parsing messy files | `core/io/*` + `test/io.test.ts` | |
| Repair flow | `core/repair/engine.ts`, `extension/tools/repair.ts`, `extension/commands/repair.ts` | |
| Export presets | `core/export/rows.ts` | [extending](docs/developer/extending.md#add-an-export-preset) |
| CRM support | `core/crm.ts` | [extending](docs/developer/extending.md#add-a-crm) |
| Skills / prompt templates | `skills/<name>/SKILL.md`, `prompts/<name>.md` | [extending](docs/developer/extending.md#add-a-skill) |
| List pane / cards / look | `extension/ui/` + `test/ui.test.ts` | |
| Launcher, onboarding, doctor | `packages/sailor-cli/bin/sailor.mjs` | |
| Mock API behaviour | `evals/mock-fiber-server.ts` | |

## Code style

- TypeScript, strict, ES modules, Node ≥ 22.13 built-ins (`node:sqlite`, global `fetch`, `node:test`). Prefer built-ins over new dependencies; `src/core` has **zero** runtime dependencies and should stay that way.
- Pi packages and `typebox` are **peer** dependencies; import them only from `src/extension`.
- Tool schemas use TypeBox (`Type.Object`, `Type.Optional`, …) and `StringEnum` from `@earendil-works/pi-ai` for string enums.
- Match the surrounding style: two-space indent, double quotes, semicolons, compact helpers. A short header comment per module says what it's for; comments reference design edge-case ids (`A5`, `C9`, …, from `docs/06`) and Linear tickets (`FIB-20426`) where relevant.
- User-facing strings are plain and specific: say what happened, what it cost, and the exact command to fix it.
- Every handler starts with `rt.init(ctx)`. Check `ctx.hasUI` before any dialog and fall back to `console.log` in print/JSON mode.

## Testing expectations

- Pure logic → unit test in the matching `test/*.test.ts`.
- New tool or command → cover registration and guard behaviour in `test/extension.test.ts` (fake Pi host).
- Fiber interactions → extend the mock server and assert on `mock.requests`. Tests never call the real API.
- Agent-behaviour changes (prompts, skills, tool descriptions, guard messages) → add or update a scenario in `evals/scenarios/`.

See [docs/developer/testing.md](docs/developer/testing.md).

## Keep the docs in sync

User-visible changes need doc updates in the same change:

- Commands, flags, keys → `docs/guide/commands.md`
- Workflows → `docs/guide/user-guide.md`
- Settings, env vars → `docs/guide/configuration.md`
- Tools → `docs/reference/tools.md`
- Architecture-level changes → `docs/developer/architecture.md`
- Anything notable → `CHANGELOG.md`

## Commits and PRs

- Commit messages: `type(scope or ticket): summary`, e.g. `feat(FIB-20428): add /qualify and /lookalikes`, `fix: never retry paid timeouts`. Reference the Linear ticket when there is one.
- PR description: what changed, why, how it was tested (tests, mock, sandbox, evals), and any change to spend behaviour called out explicitly.
- Never commit keys, `.env`, `.sailor/`, healed CSVs or eval results (see `.gitignore`).

## Gotchas

- **Pi API drift.** Pi's extension API evolves; `npm run typecheck` against the real packages is the source of truth. Some calls are feature-detected (`registerMcpServer`, `setActiveTools`, `setEditorText`) and wrapped in `try`.
- **Pi ships its own MCP support.** Sailor keeps its own Fiber MCP bridge so every MCP call still goes through the cost guard. Don't route Fiber through Pi's MCP config.
- **Sandbox keys** (`sk_test_…`) return 501 for unsandboxed operations. Known ones are in `SANDBOX_UNSUPPORTED_OPS` and fail locally.
- **`node:sqlite` prints an ExperimentalWarning** on Node 22; it's filtered in `store/db.ts` and the launcher because it corrupts the TUI.
- **Estimators run before approval and may be called without `execute` following** (declined or blocked). Keep them side-effect free apart from caching a plan in `rt.plans`.
- **The ledger's `estimated` column is computed from the registry**, so an op without an estimator shows `null` there.
