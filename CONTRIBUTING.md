# Contributing to Sailor

Thanks for helping. Sailor spends real money on behalf of its users, so the bar for anything touching Fiber calls, keys or the cost guard is high. The rest is a normal TypeScript project.

## Set up

```bash
git clone https://github.com/prayant-fiber/Sailor_Agent_Harness.git sailor && cd sailor
npm install            # Node >= 22.13
npm test
npm run typecheck
```

For a credit-free loop, run the mock Fiber API in one terminal and Sailor against it in another:

```bash
npm run mock:fiber
FIBER_BASE_URL=http://127.0.0.1:4455 FIBER_MCP_BASE_URL=http://127.0.0.1:4455 \
FIBER_API_KEY=sk_live_testkey123456 SAILOR_HOME=/tmp/sailor-dev SAILOR_DISABLE_KEYCHAIN=1 \
SAILOR_ALLOW_INSECURE_URLS=1 pi -e ./packages/pi-fiber/extensions/sailor
```

(`./demo/run-demo.sh` does the same.) To try a change against the real API without spending, use a Fiber sandbox key and `/sandbox`.

## Before you start

- Read [AGENTS.md](AGENTS.md): repo map, **hard rules**, where things live and code style.
- [docs/developer/architecture.md](docs/developer/architecture.md) explains the request lifecycle and data model.
- [docs/developer/extending.md](docs/developer/extending.md) has recipes for new operations, tools, commands, skills, presets and CRMs.
- For anything larger than a fix, open an issue first so we can agree on the approach.

## Ground rules (summary)

- Every Fiber call goes through `FiberClient`. Never put `apiKey` in a tool schema.
- Every paid tool declares an estimator; every paid command or pane action goes through `approveSpend()`.
- New operations get a registry entry in `src/core/fiber/ops.ts` (`verified: false` if the price isn't confirmed).
- Third-party text goes to the model inside `asUntrusted(...)`.
- Exports escape formulas; Sheets writes use `RAW`; do-not-contact rows never leave Sailor.
- `src/core` stays free of Pi imports and runtime dependencies.

The full list is in [AGENTS.md → Hard rules](AGENTS.md#hard-rules).

## Making a change

1. Branch from `main`.
2. Make the change with tests:
   - pure logic → `packages/pi-fiber/test/*.test.ts`
   - tools and commands → `test/extension.test.ts`
   - agent behaviour (prompts, skills, tool descriptions) → a scenario in `evals/scenarios/`
3. Update the docs that describe what you changed (see [AGENTS.md → Keep the docs in sync](AGENTS.md#keep-the-docs-in-sync)) and add a line to [CHANGELOG.md](CHANGELOG.md) under *Unreleased*.
4. Run `npm test` and `npm run typecheck`. If you changed agent behaviour, run the relevant evals: `EVAL_ONLY=E2,E5 npm run evals`.
5. Open a pull request.

## Pull requests

Please include:

- **What and why**, linking the issue or Linear ticket.
- **How you tested it**: tests, mock, sandbox, evals (with the model).
- **Spend impact**: any change to what costs credits, estimates, approval prompts or budgets, stated explicitly. "None" is a fine answer.
- Screenshots or a short recording for TUI changes.

Commit messages follow `type(scope): summary`, e.g. `feat(repair): split files over 20k rows`, `fix(guard): count batch reveals once`.

## Reporting bugs

Open an issue with `sailor doctor` output, what you ran, what you expected and the full error. **Remove API keys and personal data first.** Security problems: see [SECURITY.md](SECURITY.md) instead.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
