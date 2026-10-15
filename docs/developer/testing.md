# Testing & evals

Sailor has three layers of checks: **typecheck**, **tests** (no network, no keys, no LLM) and **agent evals** (a real LLM against a mock Fiber API). CI runs the first two on every push and pull request.

## Commands

```bash
npm install                    # once
npm test                       # all test files in packages/pi-fiber/test
npm run typecheck              # strict TS against the real Pi packages
npm run typecheck:offline      # strict TS against types/shims (no Pi install needed)
npm run mock:fiber             # mock Fiber API + MCP on :4455, for manual testing
npm run evals                  # agent evals (needs pi and an LLM key; Fiber is mocked)
```

Run one test file:

```bash
cd packages/pi-fiber
npx tsx --tsconfig tsconfig.test.json --test test/policy.test.ts
```

Filter by name with `--test-name-pattern "dry run"`.

## How the tests run without Pi

Tests use Node's built-in runner (`node:test`) through `tsx`. `packages/pi-fiber/tsconfig.test.json` maps the Pi packages (`@earendil-works/pi-coding-agent`, `pi-tui`, `pi-ai`) and `typebox` to small stubs in `test/stubs/`, so tests don't need Pi installed and run fast.

Each suite points `SAILOR_HOME` and `SAILOR_DB` at a temp folder and sets `SAILOR_DISABLE_KEYCHAIN=1`, so tests never touch your real data or keychain. Integration-style tests start the mock Fiber server on a random port.

| File | Covers |
|---|---|
| `policy.test.ts` | `decide()` (allow/confirm/block paths), operation registry, estimates and deny list, Mosaic estimate, `chargeInfo` parsing, redaction, grounding, fairness and injection detectors, catalog parsing, argument parser, text width, time helpers |
| `io.test.ts` | Encodings, delimiters, quoting, preamble rows, column detection, normalisers (emails, LinkedIn URLs, phones, names), formula escaping, Sheet URLs, S3 presigning, SSE parsing |
| `integration.test.ts` | `FiberClient` against the mock: key injection, 401/402/429/5xx/timeouts, search → list → reveal → validate → export, dedupe, Kitchen Sink repair, Mosaic lifecycle, batch reveal job, MCP JSON and SSE |
| `extension.test.ts` | The whole extension in a fake Pi host: tool and command registration, rep-mode gating, system prompt, confirm/decline/dry-run, reveal caching and ledger, recruiting guardrail, grounding, repair preview, export and DNC, secret redaction, shell-bypass consent, deny list, MCP behind the guard, `/phones`, `/qualify`, Plan/Sandbox switching, `/crm connect` and `/crm export` |
| `prospecting.test.ts` | Socials extraction, list profiling, score clamping/tiering/narrowing, CRM rows (DNC removed, fit and socials carried) and CRM server entries |
| `sandbox.test.ts` | Plan-mode gating, sandbox key never falling back to a live key, 501 handling and learning, hidden tools, sandbox prompt and data note, title-group filter shape, Fiber header/footer rendering |
| `ui.test.ts` | `ListPane` at 50/80/120/200 columns (including CJK names), keys, card rendering |

### Writing tests

- Put pure logic in `src/core` and test it directly; it's faster and needs no fake host.
- For extension behaviour, extend `extension.test.ts`: it captures registered tools, commands and hooks in maps and lets you set `confirmAnswer` to simulate the user.
- Never hit the real Fiber API from tests. Add canned responses to `evals/mock-fiber-server.ts` instead; its `requests` array records every call so you can assert on exactly what was sent (including that the key was injected and never logged).
- Snapshot-free: assert on specific strings and numbers that matter (an estimate, a blocked reason, a header).

## Typecheck

`npm run typecheck` compiles everything (packages, evals, examples) against the real Pi packages installed by `npm install`. This is what catches drift when Pi's extension API changes. `npm run typecheck:offline` uses `tsconfig.check.json` and the shims in `types/shims/`, for environments without Pi; keep the shims in step when you use new Pi APIs.

## Agent evals

Unit tests prove the plumbing; evals check that a real model *uses* it well. `evals/run.ts`, for each scenario and model:

1. starts the mock Fiber server (with the scenario's knobs) in a temp workspace,
2. runs `pi -p --mode json -e <extension> [--model M] [--fiber-max-spend N] "<prompt>"`,
3. asserts on what actually hit the mock API and on the final assistant text.

Because assertions are on API traffic, the same scenarios grade any provider.

```bash
npm run evals                                                   # default model from Pi settings
EVAL_MODELS="anthropic/claude-sonnet-4-5,openai/gpt-5" npm run evals
EVAL_ONLY=E1,E3,E10 npm run evals                               # subset
PI_BIN=/path/to/pi npm run evals                                # custom pi binary
SAILOR_TOOLS_PROFILE=lite EVAL_MODELS="openrouter/qwen/qwen3-coder" npm run evals
```

Results print per scenario and are written to `evals/last-results.json` (git-ignored).

| Id | Scenario | Checks |
|---|---|---|
| E1 | Credit balance | Answers with zero spend |
| E2 | ICP search | Parses or counts before searching; small page size |
| E3 | Reveal needs approval | Headless reveal without an allowance is blocked and explained |
| E4 | List repair | Previews, picks the right engine, imports |
| E5 | Grounded script | Citations exist in stored facts |
| E6 | Prompt injection | Instructions inside scraped profile data are ignored |
| E7 | Long-tail operation | Finds and calls an operation without a dedicated tool |
| E8 | Out of credits | Stops and explains instead of retrying |
| E9 | Recruiting fairness | Refuses protected-attribute filters |
| E10 | Headless block | Paid calls blocked with no UI and no allowance |

Targets: ≥ 90% pass on the primary model, ≥ 75% on an open-weights model with the `lite` profile. Add a scenario for any change to prompts, skills, tool descriptions or guard messages (format in [extending](extending.md#add-an-eval-scenario)).

## Manual testing

- **Mock:** `./demo/run-demo.sh` starts the mock and opens Sailor in `demo/workspace` with a throwaway home. Deterministic, free.
- **Sandbox:** `./demo/sandbox-demo.sh` (or `/sandbox` in a session) runs against the real API with a sandbox key. `./demo/probe-sandbox.sh` reports which endpoints are sandboxed.
- **Messy input:** `npm run examples:messy` writes `examples/messy_1k.csv`, which exercises every parser edge case.

## CI

`.github/workflows/ci.yml` runs on every push and pull request (Ubuntu, Node 22): `npm install`, `npm run typecheck`, `npm test`, and a check that no live Fiber key appears in any Pi session file.

## Troubleshooting the dev setup

| Symptom | Fix |
|---|---|
| Every test fails with `TransformError` | `node_modules` was installed on a different OS or CPU (esbuild ships native binaries). `rm -rf node_modules && npm install` on this machine |
| `npm run typecheck` fails only in `examples/scripts/weekly_reenrich.ts` | `@fiberai/sdk` didn't install; re-run `npm install` |
| Typecheck errors in Pi types after upgrading Pi | Pi's extension API changed. Fix the call sites, then update `types/shims/` to match |
| Evals can't find `pi` | Install Pi globally or set `PI_BIN` (after `npm install`, `node_modules/.bin/pi` works) |
