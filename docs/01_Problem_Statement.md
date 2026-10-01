# 01 — Problem Statement (Detailed)

## 1. The brief (source: `Problem_Statement.txt`)

> Coders have their pick of harnesses for automating their work, but what about sales reps, GTM engineers, or recruiters? Build an open-source harness where users can plug in their own LLM and their Fiber AI API key and start chatting with it to build outreach lists, sales strategies, and cold-call scripts.

Suggested starting point: the **Pi harness**, modified to bake in Fiber and optimized for sales, GTM, and recruiting.

Suggested ideas from the brief:

1. Built-in skills/SDKs for vibe-coding with Fiber (open-source TypeScript SDK)
2. Custom panes for visualizing lists of prospects/companies to reach out to
3. One-click buttons to enrich and repair messy contact lists (Kitchen Sink, CSV healing / Mosaic)
4. Built-in Fiber AI MCP
5. Custom TUI components for visualizing prospect/company info
6. Google Sheets integration to export data
7. User plugs in their Fiber API key and gets immediate access to all APIs
8. Custom UI that always shows the user's Fiber credit balance

Reward: Fiber's in-house growth team will dogfood the result and give feedback. **The real bar is "a growth team would use this every day."**

Reference links:

| Link | Purpose |
|------|---------|
| https://docs.fiber.ai/build/mcp | Fiber MCP servers (V2 / V3 / Core / Lite) |
| https://docs.fiber.ai/enrichment/kitchen-sink | Resolve people/companies from messy partial data |
| https://api.fiber.ai/docs/#tag/repair-data/POST/v1/mosaic/start | Mosaic CSV healing |
| https://github.com/fiber-ai/typescript-sdk | `@fiberai/sdk`, including agent-facing docs and a skills folder |

## 2. Who the users are

| Persona | Typical day | What they want from a chat harness |
|---|---|---|
| **SDR / AE (sales rep)** | Builds territory lists, researches accounts, writes emails, makes calls | "Find 50 VPs of Eng at Series B fintechs in NYC, get emails, and write me a call script for each." |
| **GTM engineer** | Builds enrichment pipelines, cleans CRM exports, writes scripts/Clay-style workflows | "Heal this 8k-row HubSpot export, dedupe it, and generate a TS script that re-runs weekly." Vibe-codes with the SDK. |
| **Recruiter / sourcer** | Sources candidates, tracks job changes, writes outreach | "Find senior Rust engineers who left FAANG in the last 6 months, within 50mi of Austin, and show their GitHub." |
| **Growth / RevOps lead** | ICP definition, TAM sizing, signal monitoring, budget owner | "How big is our TAM? What will enriching it cost? Alert me when target accounts raise money." |

Non-technical users (reps, recruiters) are the main audience. GTM engineers are the power users. The harness has to work for both: **natural-language first, code when you want it.**

## 3. Jobs-to-be-done

1. **Discover**: turn an ICP in plain English into a list of companies and people (search, NL search, audiences).
2. **Resolve and repair**: turn a messy list (CSV, Sheet, CRM export) into clean canonical entities (Kitchen Sink, Mosaic, standardize).
3. **Enrich**: add contact details (email/phone), firmographics, funding, tech stack, work history.
4. **Understand**: view a prospect or company quickly (TUI cards/panes) and decide who to contact.
5. **Strategize**: account plans, segment messaging, sales strategy docs grounded in real data.
6. **Activate**: cold-call scripts, email sequences, LinkedIn notes, each personalized from fetched facts.
7. **Export**: push to Google Sheets (and CSV / sequencer formats).
8. **Monitor**: job changes, funding, hiring signals (Tracker, saved searches).
9. **Control spend**: always know the credit balance, what an action will cost, and what it did cost.

## 4. Goals

- **G1: Zero-to-value in under 2 minutes.** Install, paste the Fiber key, pick an LLM, and see results for the first query.
- **G2: BYO everything.** Any LLM Pi supports (Anthropic, OpenAI, Gemini, OpenRouter, local via OpenAI-compatible endpoints, and more) and the user's own Fiber key.
- **G3: Full Fiber API coverage.** Typed first-class tools for the ~25 most-used operations, plus MCP/generic access to all 200+.
- **G4: Cost transparency and safety.** Live balance, pre-call estimates, confirmations, and budgets.
- **G5: GTM-native UX.** List panes, prospect cards, one-key actions (enrich, repair, export).
- **G6: Open source and hackable.** MIT, distributed as a Pi package, with skills and prompts users can fork.

## 5. Non-goals (for v1)

- Sending emails or placing calls directly (no deliverability or telephony stack). Sailor produces the assets and exports them.
- Being a full CRM. Local list storage only, plus export.
- A web/GUI app. It's a TUI first, with an optional web viewer later over Pi's RPC mode.
- Replacing Fiber's own dashboard for billing/admin.

## 6. Success criteria (what the growth team will judge)

| Criterion | Measurable target |
|---|---|
| Time to first useful list | ≤ 2 min from `npx`/install |
| Credit surprises | 0: every paid call above threshold is confirmed, and every charge is visible |
| List repair | A 1k-row messy CSV → healed CSV plus a Sheet in one command |
| Script quality | Every personalized claim in a script traces back to a fetched field |
| Model-agnostic | Core flows pass the eval suite on at least 3 providers (e.g., Claude, GPT, one open-weights model) |
| Daily-driver feel | Growth team uses it for more than a week without reverting to the dashboard for core tasks |

## 7. What "done" looks like (demo narrative)

```
$ sailor
Sailor · model: claude-sonnet · Fiber: 48,210 credits · budget: 500/session
> /fiber login                       # validates key via get-org-credits
> Find heads of RevOps at 200–1000 person B2B SaaS companies in the US that raised in the last 12 months
  [pane] 37 companies · 52 people   (search cost: 89 credits, confirmed)
> enrich emails for the top 20        → confirm "~40 credits (20 × 2)" → done, 17 found
> /repair ./hubspot_export.csv       → Mosaic run… 1,204 rows → 1,131 profiles found
> write a 60-second cold call script for each, referencing their recent funding
> /export sheets "Q4 RevOps Outbound"  → link to Google Sheet
```
