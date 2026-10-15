# Configuration

Sailor works with no configuration beyond a Fiber key. This page covers everything you *can* change: the config file, environment variables, Fiber keys and profiles, Google Sheets, Mosaic hosting, CRMs, and where Sailor keeps its data.

**Contents:** [Config files](#config-files) · [All settings](#all-settings) · [Environment variables](#environment-variables) · [Fiber keys and profiles](#fiber-keys-and-profiles) · [Google Sheets](#google-sheets) · [Mosaic hosting](#mosaic-hosting) · [CRM](#crm) · [Your outreach playbook](#your-outreach-playbook-sailormd) · [Where data lives](#where-data-lives)

---

## Config files

Settings are merged in this order (later wins):

1. Built-in defaults
2. **Global** `~/.sailor/config.json` (or `$SAILOR_HOME/config.json`)
3. **Project** `.sailor/config.json` in the folder you start Sailor from
4. Environment variables (see below)

Commands like `/budget`, `/mode`, `/dryrun`, `/fiber mcp`, `/repair hosting`, `/look`, `/crm connect` and the agent-mode switches write to the **global** file. Edit the project file by hand when one project needs different settings.

Creating a `.sailor/` folder in a project also gives that project its **own database** (`.sailor/sailor.db`), so its lists stay separate.

A typical global config:

```json
{
  "fiber": { "mcp": ["core"], "profile": "default" },
  "budget": { "autoApproveUnder": 10, "session": 200, "daily": 1000, "maxPaidCallsPerTurn": 10 },
  "mode": "rep",
  "agentMode": "build",
  "hosting": { "provider": "s3", "s3": { "endpoint": "https://<account>.r2.cloudflarestorage.com", "region": "auto", "bucket": "sailor-tmp", "accessKeyIdEnv": "R2_KEY_ID", "secretAccessKeyEnv": "R2_SECRET", "ttlSeconds": 3600 } },
  "compliance": { "region": "US", "requireSuppressionCheck": true }
}
```

## All settings

| Key | Default | Meaning |
|---|---|---|
| `fiber.baseUrl` | `https://api.fiber.ai` | Fiber REST API |
| `fiber.mcpBaseUrl` | `https://mcp.fiber.ai` | Fiber MCP servers |
| `fiber.mcp` | `["core"]` | MCP servers to bridge: any of `core`, `v2`, `lite`; `[]` turns the bridge off |
| `fiber.profile` | `"default"` | Active key profile |
| `fiber.requestTimeoutMs` | `120000` | Default HTTP timeout (some operations set their own) |
| `budget.autoApproveUnder` | `25` | Paid calls estimated at or below this run without asking |
| `budget.session` | `500` | Max credits per session |
| `budget.daily` | `2000` | Max credits per local calendar day |
| `budget.maxPaidCallsPerTurn` | `10` | Loop protection: paid calls per model turn |
| `budget.headlessMaxSpend` | `0` | Per-call allowance with no UI; `0` blocks any call that needs approval. Set by `--fiber-max-spend` / `SAILOR_MAX_SPEND` |
| `dryRun` | `false` | Estimate paid calls, never charge |
| `cache.profileTtlDays`, `cache.companyTtlDays` | `30` | Reserved for profile freshness (not used yet) |
| `cache.contactTtlDays` | `90` | How long revealed contacts and email verdicts are reused instead of paid for again |
| `toolsProfile` | `"full"` | `"lite"` exposes about ten core tools, for small or local models |
| `mode` | `"rep"` | Persona: `rep`, `engineer`, `recruiting` |
| `agentMode` | `"build"` | `build`, `plan`, `sandbox` |
| `ui.look` | `"fiber"` | `"fiber"` (branded header, footer, theme) or `"pi"` (stock Pi) |
| `crm.provider` | – | `hubspot`, `salesforce`, `attio`, `custom` |
| `crm.url` | – | Custom CRM: streamable-HTTP MCP URL |
| `crm.hubspotClientId` | – | HubSpot MCP connector client id |
| `crm.salesforceOrg` | – | Salesforce org alias or username (default: the CLI's default org) |
| `hosting.provider` | `"manual"` | Mosaic file hosting: `manual`, `gdrive`, `s3` |
| `hosting.s3.endpoint` | – | S3-compatible endpoint (omit for AWS) |
| `hosting.s3.region` | – | e.g. `us-east-1`, or `auto` for R2 |
| `hosting.s3.bucket` | – | Bucket for temporary uploads |
| `hosting.s3.accessKeyIdEnv` / `secretAccessKeyEnv` | – | **Names** of the env variables holding the credentials (never the credentials themselves). `AWS_SESSION_TOKEN` is used if set |
| `hosting.s3.prefix` | – | Optional key prefix |
| `hosting.s3.ttlSeconds` | `3600` | Presigned URL lifetime |
| `google.clientIdEnv` / `clientSecretEnv` | `SAILOR_GOOGLE_CLIENT_ID` / `SAILOR_GOOGLE_CLIENT_SECRET` | Env variable names for your Google OAuth client |
| `google.defaultFolderId` | `null` | Reserved (not used yet) |
| `compliance.region` | `"US"` | Reserved for per-region export warnings (not used yet) |
| `compliance.requireSuppressionCheck` | `true` | Skip do-not-contact people when revealing contacts. Exports and CRM pushes always leave them out |
| `jobs.pollIntervalMs` | `30000` | Async job polling (Fiber asks for ≥ 30 s) |
| `jobs.slowPollAfterMs` / `slowPollIntervalMs` | `600000` / `60000` | Poll every 60 s once a job has run 10 minutes |
| `meter.refreshIntervalMs` | `60000` | Credit balance refresh |
| `meter.lowCreditAbsolute` / `lowCreditFraction` | `500` / `0.1` | When the meter turns "low" |
| `telemetry.enabled` | `false` | Opt-in flag for anonymous usage counts. Nothing is collected in this version |

## Environment variables

| Variable | Purpose |
|---|---|
| `FIBER_API_KEY` | Fiber key. Takes priority over stored keys |
| `FIBERAI_API_KEY` | Alternative name (used by the SDK docs). If both are set, `FIBER_API_KEY` wins |
| `FIBER_SANDBOX_KEY` | Sandbox key used in Sandbox mode |
| `FIBER_BASE_URL`, `FIBER_MCP_BASE_URL` | Override the API and MCP endpoints (mock server, staging) |
| `SAILOR_HOME` | Data folder (default `~/.sailor`) |
| `SAILOR_DB` | Database path (overrides the global and project database) |
| `SAILOR_DRY_RUN=1` | Dry-run mode |
| `SAILOR_MAX_SPEND` | Headless per-call allowance (same as `--fiber-max-spend`) |
| `SAILOR_TOOLS_PROFILE=lite` | Smaller tool set |
| `SAILOR_AGENT_MODE` | `build`, `plan` or `sandbox` at start-up |
| `SAILOR_LOOK` | `fiber` or `pi` |
| `SAILOR_DISABLE_KEYCHAIN=1` | Store secrets in `credentials.json` instead of the OS keychain |
| `SAILOR_GOOGLE_CLIENT_ID`, `SAILOR_GOOGLE_CLIENT_SECRET` | Google OAuth client (alternative to `/sheets client`) |
| `SAILOR_ALLOW_INSECURE_URLS=1` | Allow `http://` hosting URLs. **Local mocks only** |
| `NODE_USE_ENV_PROXY=1` | Make Node's `fetch` honour `HTTPS_PROXY` behind a corporate proxy |
| `NO_COLOR=1` | Plain output from the launcher and the Fiber look |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, … | Your LLM provider (read by Pi) |

## Fiber keys and profiles

Sailor looks for a key in this order: `FIBER_API_KEY` → `FIBERAI_API_KEY` → OS keychain → `~/.sailor/credentials.json`.

- **Keychain.** macOS uses `security` and Linux uses `secret-tool` (needs a running D-Bus session). Entries use service `sailor` and account `fiber:<profile>`. Without a keychain, or with `SAILOR_DISABLE_KEYCHAIN=1`, secrets go in `credentials.json` with permissions `0600`.
- **Profiles** let you keep several keys (`/fiber login --profile work`, then `/fiber use work`). Sandbox keys are stored under the `sandbox` profile and are only used in Sandbox mode.
- **Sandbox key lookup** is `FIBER_SANDBOX_KEY` → stored `sandbox` profile → your regular key *only if* it's itself a sandbox key. A live key is never used in Sandbox mode.
- The key is added to requests by Sailor's HTTP client. It never appears in tool parameters, so the model can't see or leak it.

Also cap the key itself (credit limit, expiry) in the Fiber dashboard. `/fiber whoami` shows the key's limit and expiry.

## Google Sheets

Sailor uses **your own** Google OAuth client and asks only for the `drive.file` scope, which covers files Sailor creates or that you open with it, nothing else in your Drive.

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project and enable the **Google Sheets API** and **Google Drive API**.
2. Under **APIs & Services → Credentials**, create an **OAuth client ID** of type **Desktop app**. (If you'll sign in over SSH or on a headless machine, create a **TVs and Limited Input devices** client instead.)
3. In Sailor:
   ```
   /sheets client <CLIENT_ID> <CLIENT_SECRET>
   /sheets connect
   /sheets status
   ```
   Or set `SAILOR_GOOGLE_CLIENT_ID` and `SAILOR_GOOGLE_CLIENT_SECRET` instead of `/sheets client`.

`/sheets connect` opens your browser (loopback redirect with PKCE). Over SSH, or with `--device`, it shows a URL and a code to enter on any device. The refresh token is stored in the keychain. `/sheets disconnect` forgets it.

## Mosaic hosting

Repairs of more than 50 rows (or messy files) run on Fiber **Mosaic**, which downloads your file from a **public HTTPS URL**. Choose how Sailor provides one with `/repair hosting <provider>`:

| Provider | How it works | Setup |
|---|---|---|
| `manual` (default) | You provide the URL: share the file or a Google Sheet as "anyone with the link" and pass `--url`, or repair the Sheet URL directly | None |
| `gdrive` | Sailor uploads the file to your Drive, adds a temporary anyone-with-the-link permission, and revokes it once Mosaic starts | `/sheets connect` |
| `s3` | Sailor uploads to your S3 or Cloudflare R2 bucket and gives Mosaic a presigned URL (1-hour TTL), deleting the object once Mosaic starts | `hosting.s3` in config, credentials in the env variables it names |

Sailor always asks before uploading, because the file contains personal data. Cleanup is recorded with the job, so it's retried after a restart. Files up to 50 rows with good identifiers use Kitchen Sink and need no hosting.

R2 example:

```json
{
  "hosting": {
    "provider": "s3",
    "s3": { "endpoint": "https://<account-id>.r2.cloudflarestorage.com", "region": "auto", "bucket": "sailor-tmp", "accessKeyIdEnv": "R2_KEY_ID", "secretAccessKeyEnv": "R2_SECRET", "ttlSeconds": 3600 }
  }
}
```

```bash
export R2_KEY_ID=... R2_SECRET=...
```

Give that key access to the one bucket only, and add a lifecycle rule that deletes objects after a day as a backstop.

## CRM

`/crm connect <crm>` registers the CRM's **own MCP server** with Pi for this and future sessions. Pi handles transport and OAuth; tokens are stored by Pi, not Sailor. The CRM's tools appear as `mcp__<server>__<tool>`.

### HubSpot

1. In HubSpot: **Development → MCP Connectors → Create MCP connector**.
2. Add the redirect URL `http://127.0.0.1:8765/callback`, create it, and copy the client ID and secret.
3. `/crm connect hubspot` and paste them (the secret goes in your keychain).
4. `/mcp login hubspot`. A HubSpot account admin must connect first.

### Salesforce

1. `npm install -g @salesforce/cli`
2. `sf org login web --set-default` (add `--alias <name>` and enter it when `/crm connect salesforce` asks for an org).
3. `/crm connect salesforce`, then `/reload` or restart Sailor.

Sailor runs the official `@salesforce/mcp` server through `npx` with the `data`, `orgs` and `users` toolsets.

### Attio

`/crm connect attio`, then `/mcp login attio` and approve access in the browser. No API key needed.

### Any other CRM

`/crm connect custom https://your-crm.example.com/mcp`. If the server uses OAuth, `/mcp login crm`. Servers that need an API key: configure them under `mcpServers.crm` in `~/.pi/agent/mcp.json` instead.

Disconnect with `/crm disconnect`, then `/mcp logout <server>` to remove tokens.

## Your outreach playbook (`sailor.md`)

Copy [`examples/sailor.md`](../../examples/sailor.md) to the folder you run Sailor from and fill it in:

- **What we sell:** product, persona, core outcome
- **Proof points:** the only customer results Sailor may cite
- **Tone:** e.g. "direct, ≤ 110 words per email, no emojis"
- **Banned claims:** e.g. no competitor pricing, no "guaranteed"
- **Meeting ask:** who, how long
- **Compliance:** sender address and opt-out line

The cold-call, sequence and qualify flows read it. `demo/workspace/sailor.md` is a filled-in example for a fictional product.

## Where data lives

| Path | Contents |
|---|---|
| `~/.sailor/config.json` | Global settings (0600) |
| `~/.sailor/credentials.json` | Secrets, only when no OS keychain is available (0600) |
| `~/.sailor/sailor.db` | Lists, entities, contacts, cache, jobs, ledger, exports, do-not-contact (0600) |
| `<project>/.sailor/config.json`, `<project>/.sailor/sailor.db` | Project overrides and project database |
| `~/.sailor/tmp/` | Temporary chunks of large files split for Mosaic |
| `~/.sailor/feedback/` | Notes saved with `/feedback` |
| `<original file>.healed….csv` | Mosaic output, saved next to the file you repaired (plus a report when Fiber provides one) |
| OS keychain, service `sailor` | Fiber keys (`fiber:<profile>`), Google client and refresh token, HubSpot connector secret |
| `~/.pi/agent/` | Pi's own settings, sessions and MCP config (managed by Pi) |

`$SAILOR_HOME` moves everything under `~/.sailor`. To remove it all, see [Troubleshooting → reset and uninstall](troubleshooting.md#reset-and-uninstall).
