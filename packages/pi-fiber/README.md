# @sailor/pi-fiber

**Sailor for Pi**: Fiber AI inside the [Pi](https://github.com/badlogic/pi-mono) terminal agent, for sales reps, GTM engineers and recruiters. Bring your own LLM and your own [Fiber AI](https://fiber.ai) key, then chat to build prospect lists, repair messy CSVs, reveal and validate contacts, and write grounded outreach, with every paid call estimated and approved first.

```bash
pi install npm:@sailor/pi-fiber      # or, from a checkout: pi -e ./extensions/sailor
pi
/fiber login                          # key from fiber.ai/app/api, stored in your OS keychain
/budget session 100
Find heads of RevOps at US B2B SaaS companies, 200–1000 employees
```

Requires Node ≥ 22.13 (uses the built-in `node:sqlite`).

## What's in the package

- **Tools**: ~30 typed Fiber tools (search, count, NL parse, resolve, reveal, validate, repair, lists, export, tracker, CRM rows) plus `fiber_find_operation` / `fiber_call` for any of Fiber's 200+ operations, and a Fiber MCP bridge
- **Cost guard**: estimates, approval prompts, session/daily budgets, per-turn cap, dry run, headless allowance, and a ledger of estimated vs charged
- **Credit meter** in the footer, always visible
- **List panes**: `/list` with sorting, filtering, selection, prospect/company cards and one-key reveal, validate, re-resolve and export
- **List repair**: `/repair` with local pre-flight, Kitchen Sink bulk and Mosaic jobs
- **Export**: Google Sheets (new/append/upsert), CSV, XLSX with sequencer presets; `/crm` push to HubSpot, Salesforce, Attio or any MCP server
- **Modes**: personas `rep` / `engineer` / `recruiting`; agent modes Build / Plan / Sandbox
- **Skills and prompts**: prospecting, list repair, cold calls, sales strategy, recruiting, GTM engineering, Fiber SDK; `/icp`, `/callscript`, `/sequence`, `/account-plan`, `/tam`, `/sourcing`, `/repair-list`
- **Themes**: `fiber-dark`, `fiber-light`

## Using the core without Pi

`src/core` has no Pi dependency and is exported as `@sailor/pi-fiber/core`: the Fiber client (key injection, rate limits, safe retries, `chargeInfo`), the operation registry and cost policy, the SQLite store, CSV/XLSX parsing, the repair engine, Google Sheets and MCP clients.

```ts
import { FiberClient, loadConfig, resolveFiberKey } from "@sailor/pi-fiber/core";
```

## Documentation

Full docs live in the repository: [getting started](https://github.com/prayant-fiber/Sailor_Agent_Harness/blob/main/docs/guide/getting-started.md), [user guide](https://github.com/prayant-fiber/Sailor_Agent_Harness/blob/main/docs/guide/user-guide.md), [commands](https://github.com/prayant-fiber/Sailor_Agent_Harness/blob/main/docs/guide/commands.md), [configuration](https://github.com/prayant-fiber/Sailor_Agent_Harness/blob/main/docs/guide/configuration.md), [troubleshooting](https://github.com/prayant-fiber/Sailor_Agent_Harness/blob/main/docs/guide/troubleshooting.md).

## License

MIT
