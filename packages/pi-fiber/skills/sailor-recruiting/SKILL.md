---
name: sailor-recruiting
description: Source and engage candidates with Fiber — sourcing searches by skills, titles, tenure, companies and location; GitHub/LinkedIn lookups; job-change tracking; and fair, specific candidate outreach. Use for recruiting, sourcing, talent mapping or candidate outreach requests.
---

# Recruiting with Sailor (use `/mode recruiting`)

## Sourcing
1. Turn the req into criteria: must-have skills, titles/seniority, years in role/company (`startedRoleWithinMonths`), target companies/industries, location/remote, languages.
2. `fiber_parse_query` → `fiber_count` → `fiber_search_people` (small pages). For "people who left X recently", describe it in plain English to `fiber_parse_query`.
3. Talent maps: `fiber_find_operation "talent flow"` for where people move between competitors.
4. Engineers: `fiber_find_operation "github"` (GitHub ↔ LinkedIn lookups) — read the docs first, costs vary.
5. Track passive candidates: `fiber_find_operation "job change"` to set up job-change lists.

## Fairness (hard rules)
- Never filter, rank or infer by gender, age, race/ethnicity, religion, disability, pregnancy/family status, nationality/citizenship or other protected characteristics — not even via proxies like graduation year or photos. Sailor blocks such searches; offer skill/experience-based criteria instead.
- Evaluate candidates only on job-related evidence from their profile.

## Outreach
- Specific > flattering: role, team, why *their actual experience* fits (cite `[previousRoles.0.title]`, `[skills]`, `[tenureMonths]`), comp range if the user shares it, and an easy reply path.
- Respect do-not-contact and opt-outs; don't message people who asked not to be contacted.
