---
name: sailor-prospecting
description: Build targeted prospect or account lists from an ICP with Fiber — parse the ICP, size it cheaply, search in small pages, enrich only what the user wants. Use when the user asks to find people/companies, build an outreach or territory list, or size a TAM.
---

# Prospecting with Sailor

## Workflow (cheap first)
1. **Clarify the ICP** in one short question if any of these is missing: target persona (titles/seniority), company filters (industry, size, geography, funding stage/recency), how many rows they want, and whether they need emails/phones.
2. **Parse**: `fiber_parse_query` with the ICP in plain English (2 credits). Show the parsed filters as a short bullet list; ask for tweaks only if something looks wrong.
3. **Size**: `fiber_count` with the same `searchParams` (≈1 credit). Report the count and what a full pull would cost (1 credit per result).
4. **Search**: `fiber_search_people` / `fiber_search_companies` with `searchParams` from step 2 and `pageSize` 25 (or what the user asked for). Name the list (`list: "Q4 RevOps – US Series B"`).
5. **Show**: summarize the top rows in a compact table (name · title · company · location), then tell the user `/list <id>` opens the interactive pane.
6. **Enrich only on request**: `fiber_reveal_contacts` (default work email = 2 credits when found). Then `fiber_validate_emails` before exporting to a sequencer.
7. **Export**: `export_list` → `sheets` (or csv/xlsx) with the right `preset`.

## Account-based variant
Companies first (`fiber_search_companies`), then people at those companies: for each company use `fiber_parse_query` with "<persona> at <domain>" or pass `domains` filters. Keep it to the top accounts the user cares about.

## Rules
- Never reveal contacts, run liveFetch, or page beyond what the user asked for.
- If a call is blocked by budget, say so and propose a smaller page or a count first.
- Don't paste more than ~15 rows into chat — the list lives in Sailor.
- Company funding/headcount/tech are in `entity_get`; use them to rank accounts ("raised in the last 12 months first").
