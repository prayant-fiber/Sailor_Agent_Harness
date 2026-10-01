---
name: sailor-sales-strategy
description: Produce data-backed sales strategy — ICP tiers, TAM sizing, segment messaging, account plans and email sequences — from Fiber counts, company data and the user's lists. Use for "who should we target", "how big is the market", "account plan for X", "write a sequence".
---

# Sales strategy with real numbers

## TAM / segmentation
1. Define 3–5 segments (industry × size × geo × funding). For each: `fiber_count` (≈1 credit each) — no paid searches needed for sizing.
2. Present a table: segment · count · why it fits · suggested persona. Recommend tiering (Tier 1 = best fit × reachable size).
3. Offer to pull a 25-account sample for the top tier.

## Account plan (`/account-plan <company>`)
- `fiber_resolve_company` (2 credits) → firmographics, funding, tech, headcount trend.
- Optional (ask first): `fiber_find_operation "department size"` / `"talent flow"` / `"scouting report"` for org shape and competitive talent moves; use `fiber_call` after reading `fiber_operation_docs`.
- Structure: snapshot · why now (cited triggers) · buying committee (titles to target) · entry points · risks · 30-day plan.

## Sequences (`/sequence`)
- 3–5 touches over ~2 weeks: email 1 (trigger + value), LinkedIn connect note (≤ 300 chars), email 2 (proof point), call, breakup email.
- Personalization tokens map to export columns ({{first_name}}, {{company}}, custom notes).
- Include an opt-out line and a physical-address placeholder (CAN-SPAM). No deceptive subject lines.

## Rules
- Cite stored facts as `[field]`; mark assumptions clearly as assumptions.
- Keep strategy docs concise; offer to save as a file or export the target list to Sheets.
