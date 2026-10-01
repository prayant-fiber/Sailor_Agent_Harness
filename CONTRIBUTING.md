# Contributing to Sailor

1. `npm install` at the repo root (installs Pi packages as dev deps for typechecking).
2. Run tests: `cd packages/pi-fiber && npx tsx --tsconfig tsconfig.test.json --test test/*.test.ts`.
3. Try it: `pi -e ./packages/pi-fiber/extensions/sailor` with `FIBER_BASE_URL=http://127.0.0.1:4455` and `npm run mock:fiber` for a credit-free loop (mock key `sk_live_testkey123456`).

## Ground rules
- **Every Fiber call goes through `FiberClient`** (key injection, rate limits, retry policy, chargeInfo). Never put `apiKey` in a tool schema.
- **Every paid tool declares an estimator** (`registerSailorTool({ estimate })`). New operations get an entry in `src/core/fiber/ops.ts` with `paid`, `idempotent`, `rpm` and an estimate; mark `verified: false` when the price isn't confirmed in the ai-docs.
- **Third-party text goes to the model inside `asUntrusted(...)`.**
- **Exports escape formulas**; Sheets writes use `valueInputOption=RAW`.
- Keep `src/core` free of Pi imports so it stays usable from scripts and the CLI.
- Add/extend a scenario in `evals/scenarios` for agent-behaviour changes.
