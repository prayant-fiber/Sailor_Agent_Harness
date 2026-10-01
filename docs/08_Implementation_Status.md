# 08 — Implementation Status (v0.1, Sep 30, 2026)

This records what was built from docs 01–07, where each piece lives, what was checked, and what still needs checking against the live systems.

## 1. How it was verified

| Check | Result |
|---|---|
| TypeScript strict typecheck (`npm run typecheck:offline`, uses Pi type shims in `types/shims/`) | ✅ clean |
| Unit tests: parsers, normalizers, cost policy, op registry, chargeInfo, redaction, grounding, catalog, text width, S3 presign, SSE | ✅ |
| Integration tests against the mock Fiber API and MCP server (`evals/mock-fiber-server.ts`): key injection, 401/402/429/5xx/timeouts, search → list → reveal → validate → export, dedupe, Kitchen Sink repair, Mosaic job lifecycle with download and import, batch reveal job, MCP JSON and SSE | ✅ |
| Extension wiring test with a fake Pi host (`test/extension.test.ts`): tool and command registration, rep-mode tool gating, footer meter, system prompt, confirm/decline/dry-run/headless, recruiting guardrail, grounding check, repair preview, export and DNC, secret redaction hooks, shell-bypass consent, deny list, MCP bridge behind the guard | ✅ |
| TUI tests: ListPane at 50/80/120/200 columns (CJK names), keys, card rendering | ✅ |
| **Total** | **49 tests, all passing** |
| Typecheck against the **real** Pi packages (`npm run typecheck` after `npm install`) | ✅ clean after the Oct fixes: `registerFlag` accepts only `boolean`/`string`, the UI type is `ExtensionUIContext`, tool results need `details`, key ids and theme colors are typed. The only remaining error is `examples/scripts/weekly_reenrich.ts`, until `@fiberai/sdk` is installed (now a root devDependency) |
| Run inside a real `pi` process with a real LLM | ⏳ Not done. The npm registry was blocked by network policy on the build machine, so Pi could not be installed. Run `npm install && npm run typecheck && npm run evals` first |
| Calls against the live Fiber API | ⏳ Not done (no key in the build environment). Use a sandbox key (`createSandboxApiKey`) for the first smoke test |

## 2. Feature → code map

| Spec | Implementation |
|---|---|
| F1 key and all APIs | `core/secrets.ts` (keychain or 0600 file, `FIBER_API_KEY`/`FIBERAI_API_KEY`), `commands/fiber.ts` (`/fiber login\|logout\|whoami\|use\|mcp\|admin`), `core/fiber/client.ts`, `core/fiber/ops.ts`, `core/fiber/catalog.ts` + `tools/generic.ts` (`fiber_find_operation`, `fiber_operation_docs`, `fiber_call`) |
| F2 credit meter | `extension/meter.ts` (footer, low/empty states, 60 s refresh, debounced refresh after charges), `/credits` ledger (`store.ledgerByOp`) |
| F3 Fiber MCP | `core/mcp/client.ts` (Streamable HTTP, JSON and SSE, session re-init) + `tools/mcp.ts` (dynamic `fibermcp_<server>_<tool>` tools, estimates keyed by operationId) |
| F4 enrich and repair | `core/repair/engine.ts` (preflight, engine choice, Kitchen Sink bulk, Mosaic chunks, row-id join, import), `core/hosting/*` (manual, gdrive, s3/r2), `tools/repair.ts`, `commands/repair.ts` |
| F5 list panes | `extension/ui/listPane.ts` via `/list`, `/lists`, `ctrl+shift+l` |
| F6 cards and renderers | `extension/ui/cards.ts`, compact tool renderers in `tools/common.ts` |
| F7 Google Sheets | `core/google/oauth.ts` (loopback with PKCE, device flow), `core/google/sheets.ts` (create, append, upsert, RAW, chunks, header mapping), `tools/export.ts`, `commands/export.ts`, `/import sheets` |
| F8 vibe-coding | `skills/fiber-sdk`, `skills/sailor-gtm-engineering`, `/mode engineer`, `/new-script`, `examples/scripts/weekly_reenrich.ts` |
| F9 cost guard | `core/budget.ts` (pure policy), `extension/costGuard.ts` (`tool_call` hook, pane and command approvals, bash-bypass consent) |
| F10 NL ICP → search | `fiber_parse_query` → `fiber_count` → `fiber_search_*`, `fiber_nl_search` |
| F11 outreach assets | skills `sailor-cold-call` and `sailor-sales-strategy`, prompts `/callscript` `/sequence` `/account-plan` `/tam`, `list_set_notes` with grounding check |
| F12 recruiting | `/mode recruiting`, `skills/sailor-recruiting`, protected-attribute blocker in search tools |
| F13 signals | `fiber_tracker` tool (rules, lists, create, add, refresh, signals) + catalog access to job-change, saved-search and webhook operations |
| F14 suppression and dedupe | `dnc` table, `/dnc`, `dnc_add`, `d` key in the pane, suppression in reveal and export; entity dedupe by LinkedIn → email → name+domain |
| F15 jobs panel | `core/jobs/manager.ts`, `/jobs`, `fiber_jobs`, widget above the editor, completion message to the conversation |
| F16 workspaces | `.sailor/` in a project folder creates a project-local DB; lists live outside Pi sessions |
| Launcher | `packages/sailor-cli/bin/sailor.mjs` (onboarding, `login`, `doctor`, passthrough to pi) |
| Evals | `evals/mock-fiber-server.ts`, `evals/scenarios/*.json` (E1–E10), `evals/run.ts` (multi-model, asserts on actual API traffic) |

## 3. Edge-case coverage (IDs from doc 06)

✅ handled · 🟡 partly handled · ⏳ deferred

| Area | Status |
|---|---|
| **A: brief gaps** | A1 ✅ · A2 ✅ · A3 ✅ · A4 ✅ · A5 ✅ · A6 ✅ · A7 🟡 (contact reveals and email validation are cached; single Kitchen Sink lookups always re-query, though entities dedupe) · A8 🟡 (see G) · A9 ✅ · A10 ✅ · A11 ✅ · A12 🟡 (local DNC, tracker, sequencer CSV presets ✅; syncing Fiber exclusion lists and pushing to CRMs ⏳) · A13 ✅ |
| **B: keys** | B1 ✅ · B2 ✅ · B3 ✅ · B4 ✅ · B5 🟡 (key info shown in `/fiber whoami`; the key ceiling isn't yet included in spendable credits) · B6 ✅ · B7 ✅ · B8 ✅ (Pi) |
| **C: credits** | C1 ✅ · C2 ✅ · C3 ✅ · C4 ✅ · C5 ✅ · C6 ✅ · C7 ✅ · C8 ✅ · C9 ✅ · C10 ✅ · C11 ✅ · C12 ✅ · C13 ✅ |
| **D: Mosaic** | D1 ✅ (explicit consent; link revoked or deleted once the run leaves `pending`) · D2 ✅ · D3 ✅ (needs gdrive or s3 hosting) · D4 🟡 (immediate download; finalize retries on the next poll, but whether Fiber reissues expired links is unverified) · D5 ✅ · D6 ✅ · D7 ✅ · D8 🟡 (length-capped; not yet shown in the pre-flight card) · D9 ✅ · D10 ✅ |
| **E: messy input** | E1 ✅ · E2 ✅ · E3 ✅ · E4 ✅ · E5 ✅ · E6 ✅ · E7 ✅ · E8 ✅ · E9 ✅ · E10 ✅ · E11 🟡 (via optional `exceljs`) · E12 ⏳ (whole file is read into memory; streaming not implemented) |
| **F: data quality** | F1 ✅ · F2 ✅ · F3 🟡 (`fetched_at` shown; `liveFetch` opt-in) · F4 ✅ · F5 🟡 (original row kept in `list_items.input`; no side-by-side redline view yet) · F6 ✅ · F7 ✅ |
| **G: compliance** | G1 ✅ · G2 ✅ · G3 🟡 (`/forget` ✅; per-region export warnings ⏳) · G4 ✅ · G5 ✅ · G6 ✅ · G7 🟡 (0600/0700 permissions and `/wipe`; no encryption at rest) · G8 ✅ (off by default; collects nothing) |
| **H: reliability** | H1 🟡 (token buckets and Retry-After ✅; per-route limits from `getRateLimits` not ingested yet) · H2 ✅ · H3 ✅ · H4 ✅ (`NODE_USE_ENV_PROXY` hint) · H5 🟡 · H6 n/a |
| **I: agent behavior** | I1 ✅ · I2 🟡 (parse-first strategy; no local enum validation yet) · I3 ✅ · I4 ✅ · I5 ✅ · I6 ✅ · I7 🟡 (lists are global; no list version snapshots) · I8 ✅ |
| **J: Sheets** | J1 ✅ · J2 ✅ · J3 ✅ · J4 ✅ · J5 ✅ · J6 ✅ · J7 ✅ |
| **K: terminal** | K1 ✅ · K2 ✅ · K3 🟡 · K4 ✅ · K5 ⏳ (logos) |
| **L: output quality** | L1 ✅ · L2 ✅ (`examples/sailor.md`) · L3 🟡 · L4 ✅ · L5 ✅ |
| **M: maintenance** | M1 ✅ (CI) · M2 ✅ · M3 ✅ (no native dependencies) · M4 ✅ |

## 4. Assumptions to verify against live systems

1. **Friendly filter shapes.** In `buildPeopleSearchParams` and `buildCompanySearchParams`, the shapes for `titleGroups`, `keywords` and the relative-date filters (`startedInRole`, `lastFundedOn`) are best guesses. The documented shapes (`jobTitleV2` terms, `country3LetterCode`, `industriesV2`, `headquartersCountryCode`, `employeeCountV2`, `stage`) are used as documented. The prompt steers the model to `fiber_parse_query` output.
2. **Person and company payload field names** (`primary_slug`, `experiences`, `inferred_location`, `latest_funding_consensus`, …). The summarizers check several candidate names, so compare against a real response.
3. **`slushieRun` result array names** (`profiles` / `companies` / `data`), and **`companyCount`**'s count field and price.
4. **Mosaic output:** healed-CSV column names (import uses column detection), the report file type, per-row price, and link regeneration.
5. **`pollBatchContactDetails.pageResults[].outputs`** shape.
6. **Fiber MCP Core `call_operation` argument names** (`operationId` + `body`?). The estimator accepts `body`, `params`, `arguments` or `args`.
7. **Pi now ships its own MCP extension** (`createMcpExtension` is exported by the installed `@earendil-works/pi-coding-agent`), so the README's "No MCP" line is out of date. Sailor keeps its own Fiber MCP bridge because every call through it goes through the cost guard. If you also configure Fiber in Pi's built-in MCP, those calls bypass the guard.
8. **Pi extension API details:** `renderCall`/`renderResult` signatures, the `ctx.ui.custom` factory arguments, `getAllTools()` shape, `registerFlag` types, `sendMessage` options, the `input` event transform result, and `sessionManager.getSessionId`. All are taken from the docs and examples; confirm with `npm run typecheck` against the real packages.
9. **Google device flow with the `drive.file` scope.**

## 5. Next steps

1. `npm install && npm run typecheck`, then fix any mismatches with the real Pi types (see §4.7).
2. Smoke test: `pi -e ./packages/pi-fiber/extensions/sailor` with a sandbox Fiber key, running the demo in doc 07 §5. Record real payloads and adjust the summarizers and filter builders (§4.1–4.5).
3. `npm run evals` on three models, and tune the prompt addendum and skills until E1–E10 pass.
4. Implement the deferred items: sync Fiber exclusion lists, ingest per-route limits from `getRateLimits`, stream very large files, a redline view, list snapshots and region warnings.
5. Publish `@sailor/pi-fiber` and `sailor-gtm`, then start the growth-team dogfood (doc 07 §4).
