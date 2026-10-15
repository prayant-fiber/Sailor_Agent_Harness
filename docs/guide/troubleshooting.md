# Troubleshooting & FAQ

Start with `sailor doctor` (or `npm run sailor -- doctor`). It checks Node, `node:sqlite`, Pi, the extension, your Fiber key, Google, Mosaic hosting, the keychain, your terminal, your proxy settings and `exceljs`. `/fiber whoami` inside Sailor shows which key, profile, mode and database are in use.

## Install and start-up

| Symptom | Fix |
|---|---|
| `Sailor needs ≥ 22.13 (built-in node:sqlite)` | Upgrade Node (see [Getting started](getting-started.md#installing-or-upgrading-node)) and check `node -v` in the **same** terminal |
| `pi: command not found` | `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`, open a new terminal, and check `$(npm prefix -g)/bin` is on `PATH`. From a checkout, `npx pi` also works after `npm install` |
| `ExperimentalWarning: SQLite is an experimental feature` | Harmless on Node 22. The launcher hides it |
| The `sailor` launcher tries to `pi install npm:@sailor/pi-fiber` and fails | The package isn't published yet. Run from the checkout with `pi -e ./packages/pi-fiber/extensions/sailor` |
| No Sailor commands appear in Pi | Pi wasn't started with the extension. Use `npm run sailor` or `pi -e ./packages/pi-fiber/extensions/sailor` |
| `No API key found for the selected model` | That's your **LLM** key, not Fiber. Export `ANTHROPIC_API_KEY` (or similar), or `/login` |
| Small model calls the wrong tools or loops | `export SAILOR_TOOLS_PROFILE=lite`, or switch to a stronger model with `/model` |
| Columns missing in `/list` | Terminal narrower than 80 columns. Widen the window |

## Fiber key and credits

| Symptom | Fix |
|---|---|
| `Fiber rejected this key (401)` | Re-copy the key from [fiber.ai/app/api](https://fiber.ai/app/api) and run `/fiber login` or `sailor login`. Check that an old `FIBER_API_KEY` in your environment isn't overriding it: `echo $FIBER_API_KEY` |
| `/fiber logout` but Sailor still has a key | A key in `FIBER_API_KEY` / `FIBERAI_API_KEY` always wins. `unset` it |
| `Out of Fiber credits (402)` | Top up in the Fiber dashboard. Sailor never buys credits |
| `fetch failed` behind a VPN or proxy | `export NODE_USE_ENV_PROXY=1` with `HTTPS_PROXY` set |
| Footer shows `10,000 cr` and the same three people every time | You're still pointed at the mock server. `unset FIBER_BASE_URL FIBER_MCP_BASE_URL` or open a new terminal |
| Footer shows `Fiber SANDBOX` | You're in Sandbox mode or using an `sk_test_` key. `/build` switches back to your live key |
| Credits never go down | Dry run is on (`/dryrun off`, `unset SAILOR_DRY_RUN`) or you're on a sandbox key |
| Estimated and charged differ in `/credits` | Estimates are Sailor's prediction; the charge comes from Fiber's `chargeInfo`. Contact reveals are only charged when found, so charges are often lower. Large gaps are worth reporting |
| `Rate limited on <operation>` / "waiting Ns for … rate limit" | Sailor backs off and retries automatically. Wait, or use smaller batches |
| `<operation> did not complete … may or may not have been charged` | A paid call timed out. Sailor never retries those automatically. Check `/credits` before retrying |

## Spending blocked

| Message | Meaning and fix |
|---|---|
| `Over the session budget` / `Over the daily budget` | `/budget session <n>` or `/budget daily <n>` |
| `Paid-call limit for this turn reached` | Loop protection. Let the model summarise, then continue, or raise with `/budget turn <n>` |
| `needs approval … but there is no interactive UI` | Headless run. Add `--fiber-max-spend <n>` or `--fiber-dry-run` |
| `PLAN mode: … was not run` | You're in Plan mode. `/build` to run it, or `/sandbox` to try it free |
| `DRY RUN — … would cost` | `/dryrun off` |
| `… is blocked by Sailor policy` | Buying credits, cards and account sign-up are never done by the agent. Use the Fiber dashboard |
| `… changes API-key settings; the user must enable /fiber admin on first` | Run `/fiber admin on` for this session if you meant it |
| `isn't available with a Fiber sandbox key` | Fiber hasn't sandboxed that operation. Skip the step or use `/build` with a live key |

## Lists, repair and jobs

| Symptom | Fix |
|---|---|
| `No list "…"` | `/lists` shows ids and names; either works |
| `/repair` says "Mosaic needs a public HTTPS URL" | The file is over 50 rows. Set up hosting (`/repair hosting gdrive` or `s3`; see [Configuration](configuration.md#mosaic-hosting)), or pass `--url`, or `--max-rows 50` for a quick Kitchen Sink run |
| `/repair` on a Google Sheet says it's not public | Share the sheet as "anyone with the link can view", or connect Google and use `gdrive` hosting |
| Wrong columns detected | Rename the header to something obvious (`Email`, `LinkedIn`, `Company`, `Full Name`), or add `--instructions` for Mosaic |
| A Mosaic job seems stuck | Jobs poll every 30 s, then every 60 s after 10 minutes. `/jobs refresh <id>` polls now. Jobs resume after a restart |
| `.xlsx` not supported | `npm i -g exceljs` |
| Reveal skipped people | They're on the do-not-contact list, already have fresh cached contacts (free), or lack a LinkedIn URL/identifier. The summary line says which |

## Google Sheets

| Symptom | Fix |
|---|---|
| "Sailor needs your own Google OAuth client" | Create a **Desktop app** OAuth client and run `/sheets client <id> <secret>` ([steps](configuration.md#google-sheets)) |
| Browser doesn't open on `/sheets connect` | Open the URL Sailor prints. Over SSH use `/sheets connect --device` (needs a "TVs and Limited Input devices" client) |
| Export fails with 403 | Enable both the **Sheets** and **Drive** APIs in your Cloud project, then `/sheets connect` again |
| Can't write to an existing sheet | Sailor only asks for the `drive.file` scope, which covers sheets Sailor created (or files you opened with it). Export to a new sheet, then append or upsert into that one |

## CRM

| Symptom | Fix |
|---|---|
| Model says it isn't signed in | `/mcp login <server>` (`hubspot`, `attio`, `crm`) |
| HubSpot connector rejected | The redirect URL must be exactly `http://127.0.0.1:8765/callback`, and an account admin must connect first |
| Salesforce tools missing | Install the Salesforce CLI, `sf org login web --set-default`, then `/reload` |
| `PLAN mode doesn't write to your CRM` | `/build` first |

## FAQ

**Does Sailor send my data anywhere besides Fiber and my LLM?**
Only where you ask: Google Sheets exports, Mosaic hosting uploads (with consent and a temporary link) and your CRM. Telemetry is off and collects nothing in this version.

**Does the model see my Fiber key?**
No. The key is injected by Sailor's HTTP client and never appears in tool parameters. If you paste it into chat, Sailor offers to store it and redacts it from the message. Keys and tokens are also redacted from every tool result.

**Can I use Sailor without the `sailor` launcher?**
Yes. The launcher only does onboarding, `doctor` and theming. `pi -e ./packages/pi-fiber/extensions/sailor` is the extension on its own.

**Can I use a local or open-weights model?**
Yes, through any OpenAI-compatible endpoint Pi supports. Set `SAILOR_TOOLS_PROFILE=lite` for smaller models.

**Does Sailor also work with Pi's built-in MCP support?**
Yes, but configure Fiber through Sailor's bridge (`/fiber mcp`), not Pi's own MCP config. Calls through Pi's MCP config bypass Sailor's cost guard.

**What happens to running jobs when I quit?**
They're saved in the database and resume when you start Sailor again. Mosaic keeps running on Fiber's side in the meantime.

## Reset and uninstall

Inside Sailor:

```
/forget <id>      # remove one person or company
/wipe             # delete the local database
/fiber logout     # remove the stored Fiber key
/sheets disconnect
```

From the shell:

```bash
rm -rf ~/.sailor                                              # all local data, config and the fallback credentials file
security delete-generic-password -s sailor -a fiber:default   # macOS: remove the key from the keychain
secret-tool clear service sailor account fiber:default        # Linux equivalent
npm unlink -g sailor-gtm                                      # if you ran npm link
npm uninstall -g @earendil-works/pi-coding-agent              # remove Pi
```

## Still stuck?

Open an issue with the output of `sailor doctor`, the command or message you sent, and the full error text. **Remove keys and personal data first.** You can attach a note saved with `/feedback`.
