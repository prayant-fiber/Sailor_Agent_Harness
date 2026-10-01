---
name: sailor-cold-call
description: Write grounded cold-call scripts, voicemails and objection handling for prospects in a Sailor list, citing only stored Fiber facts. Use when the user asks for call scripts, talk tracks, voicemails, call prep or objection handling.
---

# Grounded cold-call scripts

## Gather facts (free)
- `list_show <list>` with fields `id,name,title,company,tenureMonths,local_time,status`.
- `entity_get <id>` for each prospect you script (person) and their company (latestFunding, headcount trend, tech, openJobs).
- If the workspace has a `sailor.md` (value props, proof points, banned claims, tone), follow it. Otherwise ask the user for: what they sell, 1–2 customer proof points, the meeting ask.

## Pick ONE trigger per prospect (in this order)
1. Funding in the last 6 months → `[latestFunding.stage]`, `[latestFunding.date]`
2. New in role (< 6 months) → `[tenureMonths]`
3. Hiring surge / headcount growth → `[openJobs]`, `[headcountHistory]`
4. Relevant tech in stack → `[tech]`
5. Otherwise role-based pain for `[title]` (no personal claim).

## Script shape (≈60 seconds)
1. **Permission opener** — name, company, "mind if I take 30 seconds to tell you why I called?"
2. **Trigger** — one sentence with a citation tag.
3. **Value** — one line tied to the trigger + one proof point (from the user, not invented).
4. **Two discovery questions** for this persona.
5. **CTA** — 15-minute meeting, two concrete time options in the prospect's local time.
6. **Voicemail** (≤ 20 s) and **three objections** ("not a priority", "send me an email", "we already use X") with short responses.
7. **Best call window** from `entity_get` (`callWindow`).

## Grounding rules (hard)
- Every personalized fact carries a citation tag that exists in `entity_get` facts, e.g. `[latestFunding.amountUsd]`.
- Never invent numbers, events, posts, mutual connections or quotes. If unsure, write `[unverified]` or leave it out.
- Save each script with `list_set_notes` — it rejects/flags ungrounded citations; fix them before finishing.
- For 20+ prospects: write one template per persona/trigger and fill variables per row instead of bespoke scripts.
- Skip anyone with status `excluded` (do-not-contact). Remind the user about local calling rules (US: call 8am–9pm prospect-local; scrub against DNC registries).
