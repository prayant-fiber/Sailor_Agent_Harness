# Getting started

This guide takes you from nothing to a working Sailor session: prerequisites, install, a free offline run against the mock Fiber API, a sandbox run, and finally a live run with a budget in place.

**Contents**

1. [Prerequisites](#1-prerequisites)
2. [Install Pi and Sailor](#2-install-pi-and-sailor)
3. [Verify the install](#3-verify-the-install)
4. [Connect your LLM](#4-connect-your-llm)
5. [Try it offline against the mock Fiber API](#5-try-it-offline-against-the-mock-fiber-api)
6. [Try it on a Fiber sandbox key](#6-try-it-on-a-fiber-sandbox-key)
7. [Go live](#7-go-live)
8. [Your first real session](#8-your-first-real-session)
9. [Next steps](#9-next-steps)

---

## 1. Prerequisites

| You need | Why | Check |
|---|---|---|
| **Node.js ≥ 22.13** | Sailor uses Node's built-in `node:sqlite` (no native modules to compile) | `node -v` |
| **npm** | Installs Pi and the dev dependencies | `npm -v` |
| **An LLM** | Pi drives the conversation. Any Pi provider works: Anthropic, OpenAI, Gemini, OpenRouter, Bedrock, or a local OpenAI-compatible server | an API key in your environment, or `/login` inside Pi |
| **A Fiber AI API key** | Every Fiber tool, the credit meter and the MCP bridge | create one at [fiber.ai/app/api](https://fiber.ai/app/api). Live keys look like `sk_live_…`, sandbox keys like `sk_test_…` |

Optional, for specific features:

| Optional | Enables | Setup |
|---|---|---|
| Google Cloud OAuth client | `/export-list … sheets`, `/import-list sheets`, Drive hosting for Mosaic | [Configuration → Google Sheets](configuration.md#google-sheets) |
| `exceljs` | `.xlsx` import and export | `npm i -g exceljs` |
| S3 / R2 bucket or Google Drive | Hosting files for `/repair` runs over 50 rows | [Configuration → Mosaic hosting](configuration.md#mosaic-hosting) |
| A CRM (HubSpot, Salesforce, Attio, or any MCP server) | `/crm export` | [Configuration → CRM](configuration.md#crm) |

### Installing or upgrading Node

```bash
# nvm
nvm install 22 && nvm use 22
# or Homebrew (macOS)
brew install node@22 && brew link --overwrite node@22

node -v   # v22.13.0 or later
```

On Node 22 you may see `ExperimentalWarning: SQLite is an experimental feature`. It's harmless; the launcher and the extension hide it.

---

## 2. Install Pi and Sailor

Sailor is a **Pi package**. Pi supplies the terminal UI, the model providers and session handling; Sailor adds the Fiber tools, commands, panes, skills and cost guard.

### Pi

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi --version
```

If `pi` isn't found, open a new terminal and check that `$(npm prefix -g)/bin` is on your `PATH`. You can also skip this step: the `sailor` launcher offers to install Pi the first time it runs.

### Sailor (from source)

```bash
git clone https://github.com/prayant-fiber/Sailor_Agent_Harness.git sailor
cd sailor
npm install
```

`npm install` pulls the workspace dev dependencies: `tsx`, `typescript`, the real Pi packages (for typechecking and a local `pi` binary) and `@fiberai/sdk` (for the vibe-coding example). Running Sailor through a global `pi` doesn't strictly need them, but the tests, evals, mock server and typecheck do.

### Sailor (as a Pi package, once published)

```bash
pi install npm:@sailor/pi-fiber
pi
```

> `@sailor/pi-fiber` and `sailor-gtm` are not on npm yet. Until they are, run from source.

### Optional: a global `sailor` command

```bash
npm link -w sailor-gtm     # from the repo root
sailor doctor
```

---

## 3. Verify the install

None of these need network access or keys.

```bash
npm test                    # unit, integration (mock Fiber), fake-Pi wiring and TUI tests
npm run typecheck           # against the real Pi packages (needs npm install)
npm run typecheck:offline   # against the bundled shims in types/shims (works without Pi installed)
```

Then run the health check:

```bash
npm run sailor -- doctor    # or: node packages/sailor-cli/bin/sailor.mjs doctor
```

A healthy result looks like this (`✗` lines need fixing; `!` lines are optional features):

```
✓ Node 22.x
✓ node:sqlite available
✓ pi found (…)
✓ Sailor extension (local checkout): …/packages/pi-fiber/extensions/sailor
✓ Fiber key sk_live_****abcd valid · 48,210 credits
! Google Sheets not configured (optional) — see README → Google Sheets
! Mosaic hosting: manual (large /repair runs need a public URL; /repair hosting gdrive|s3)
✓ OS keychain available for secrets
✓ Terminal 160×45
! exceljs not installed (optional, for .xlsx): npm i -g exceljs
```

Before you've added a Fiber key, the key line shows `✗ No Fiber key — run: sailor login`. That's expected.

---

## 4. Connect your LLM

Pick one:

```bash
export ANTHROPIC_API_KEY=sk-ant-...      # Claude
export OPENAI_API_KEY=sk-...             # OpenAI
export GEMINI_API_KEY=...                # Gemini
export OPENROUTER_API_KEY=...            # OpenRouter (incl. open-weights models)
```

Or start Pi and use `/login` to sign in with a Claude or ChatGPT subscription. Switch models any time with `/model`. Add the `export` to your shell profile (`~/.zshrc`, `~/.bashrc`) to keep it.

> **Small or local models:** `export SAILOR_TOOLS_PROFILE=lite` gives the model a smaller tool set (about ten core tools), which most small models handle much better.

---

## 5. Try it offline against the mock Fiber API

The repo ships a mock Fiber API and MCP server with deterministic data and 10,000 fake credits. Everything runs locally; no credits are spent. This is the best way to learn the commands.

**Terminal 1: start the mock**

```bash
npm run mock:fiber           # http://127.0.0.1:4455
```

**Terminal 2: launch Sailor against it, in a throwaway home directory**

```bash
export FIBER_BASE_URL=http://127.0.0.1:4455
export FIBER_MCP_BASE_URL=http://127.0.0.1:4455
export FIBER_API_KEY=sk_live_testkey123456        # the key the mock accepts
export SAILOR_HOME=/tmp/sailor-mock               # keeps mock data out of ~/.sailor
export SAILOR_DB=/tmp/sailor-mock/sailor.db
export SAILOR_DISABLE_KEYCHAIN=1                  # don't write the fake key to your keychain
export SAILOR_ALLOW_INSECURE_URLS=1               # the mock is plain http; local use only

pi -e ./packages/pi-fiber/extensions/sailor
```

Shortcut: `./demo/run-demo.sh` does all of the above (starts the mock, sets the variables, opens Sailor in `demo/workspace`).

The footer should read `Fiber 10,000 cr`. Try:

```
What's my Fiber credit balance?
Find heads of RevOps at US B2B SaaS companies with 200–1000 employees
/lists
/credits
```

The mock returns the same few people (Dana Whitfield, Raj Menon, Mei Chen) and companies (Loomly, Tidewave) for every query.

When you're done, `Ctrl+C` both terminals and open a fresh terminal (or `unset` the variables above) so you don't accidentally keep talking to the mock.

---

## 6. Try it on a Fiber sandbox key

A Fiber **sandbox key** (`sk_test_…`) talks to the real Fiber API with the real request and response shapes, returns a small fixed set of fictional sample records, and is **never charged**. It's the safest way to rehearse a workflow end to end.

The easiest route is Sailor's Sandbox mode. In a normal session (connected with your live key):

```
/sandbox
```

Sailor offers to **create a sandbox key from your live key** (free) or lets you paste one. The key is stored under a separate `sandbox` profile, and while Sandbox mode is on **your live key is never used**. The footer shows `Fiber SANDBOX · no credits charged`. Go back with `/build`.

Other ways in:

```bash
# start straight in sandbox mode (a sandbox key in FIBER_SANDBOX_KEY is never confused with your live key)
FIBER_SANDBOX_KEY=sk_test_... pi -e ./packages/pi-fiber/extensions/sailor --agent-mode sandbox

# or the guided demo script (checks, tests, endpoint probe, launch)
./demo/sandbox-demo.sh
```

What to expect in sandbox:

- Results are sample data and **won't match your filters**. That's normal.
- Some operations aren't sandboxed by Fiber yet: the credit balance, natural-language parsing and search (`nlpSearchParse`, `slushieRun`), single-person Kitchen Sink and API-key management. Sailor hides the tools that depend on them and builds search filters itself instead.
- The Fiber MCP bridge is off in sandbox.
- Estimates and approval prompts still appear, so you can see exactly what a live run would ask.

---

## 7. Go live

Open a **fresh terminal** (no mock variables) and pick one of three ways to start. They all load the same extension.

### A. The `sailor` launcher (recommended)

```bash
npm run sailor                 # = node packages/sailor-cli/bin/sailor.mjs
```

On first run it:

1. Reminds you to set your LLM key.
2. Asks for your Fiber API key (input is masked), checks it with the free `get-org-credits` call, and stores it in your **OS keychain** (macOS Keychain or Linux `secret-tool`; service `sailor`, account `fiber:default`). Without a keychain it falls back to `~/.sailor/credentials.json` with mode `0600`.
3. Offers to install Pi if it's missing.
4. Starts Pi with the Sailor extension and the Fiber colour theme.

Other launcher commands: `sailor login` (replace or rotate the key), `sailor doctor`, `sailor --help`. Anything else is passed straight to `pi`.

### B. Pi directly

```bash
export FIBER_API_KEY=sk_live_...      # or skip this and run /fiber login inside
pi -e ./packages/pi-fiber/extensions/sailor
```

### C. Installed Pi package (after publishing)

```bash
pi install npm:@sailor/pi-fiber
pi
```

### Set a budget before your first paid call

The defaults are: calls estimated at 25 credits or less run without asking, 500 credits per session, 2,000 per day, at most 10 paid calls per agent turn. Tighten them for your first sessions:

```
/budget session 100       # max credits this session
/budget daily 300         # max credits today
/budget auto 10           # calls estimated above 10 credits ask first
/dryrun on                # optional: estimate everything, charge nothing
/credits                  # balance + ledger (estimated vs charged, per operation)
```

You can also cap the key itself in the Fiber dashboard, which Sailor respects.

---

## 8. Your first real session

```
> Find heads of RevOps at US B2B SaaS companies, 200–1000 employees, that raised in the last 12 months
    → Sailor parses the ICP, runs a cheap count, asks before a paid search, and saves the results to a list
> /lists
> /list revops-us
    pane keys: ↑↓ move · space select · a select all · ⏎ card · e reveal · v validate
               r re-resolve · d do-not-contact · x export · S Sheets · / filter · s sort · c columns · q close
> get work emails for the top 10        → "Spend ~20 credits on Fiber?"  [y/N]
> validate those emails
> /qualify revops-us VP or Head level, 200–2000 employees, raised in the last 18 months
> write 60-second cold-call scripts for the A-tier rows   → every fact cited, e.g. [latestFunding.stage]
> /export-list revops-us csv --preset outreach
> /credits
```

Worth setting up early:

- **Your outreach playbook.** Copy `examples/sailor.md` to the folder you run Sailor from and fill it in (what you sell, proof points you may cite, tone, banned claims, compliance lines). The cold-call, sequence and qualify flows follow it.
- **A project workspace.** Create a `.sailor/` folder in a project directory and Sailor uses a separate database (and optional config) for that project.
- **A messy list to repair.** `npm run examples:messy` writes `examples/messy_1k.csv`, a deliberately broken 1,000-row export. Then `/repair examples/messy_1k.csv --work-email`.

---

## 9. Next steps

- The [user guide](user-guide.md) walks through every workflow.
- The [command reference](commands.md) lists every command and key.
- [Configuration](configuration.md) covers Google Sheets, Mosaic hosting, CRMs and all settings.
- If something goes wrong, see [Troubleshooting](troubleshooting.md).

### First-time checklist

- [ ] `node -v` ≥ 22.13
- [ ] `pi --version` works
- [ ] `npm install` and `npm test` pass
- [ ] LLM key exported (or `/login` done)
- [ ] Mock session works (§5)
- [ ] `sailor doctor` shows no `✗`
- [ ] `/budget session 100` and `/budget auto 10` set
- [ ] First live search: free-ish count first, then a small paid search
- [ ] `/credits`: estimated and charged roughly match
