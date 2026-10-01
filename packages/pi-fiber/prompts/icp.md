---
description: Turn an ICP into a sized, sample prospect list (cheap-first)
argument-hint: "<who you sell to, e.g. Heads of RevOps at US B2B SaaS 200-1000 employees that raised in the last 12 months>"
---
Use the sailor-prospecting skill. ICP: $ARGUMENTS

1. Parse it with fiber_parse_query and show me the filters.
2. Count matches with fiber_count and tell me what a full pull would cost.
3. Pull a first page of 25 into a list named after the ICP and show the top 10.
Do not reveal contacts yet.
