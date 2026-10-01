---
name: fiber-sdk
description: How to write TypeScript against Fiber AI's official SDK (@fiberai/sdk) — client setup, calling conventions, errors, pagination, polling, zod schemas and agent docs. Use when writing or fixing code that calls Fiber.
license: MIT (summary of the public fiber-ai/typescript-sdk README; see that repo's skills/fiber-sdk for the canonical version)
---

# Fiber TypeScript SDK (`@fiberai/sdk`)

## Install & auth
```bash
npm install @fiberai/sdk   # Node ≥ 18
export FIBER_API_KEY=sk_live_...   # from https://fiber.ai/app/api
```
A pre-configured `client` points at `https://api.fiber.ai`. Customize with `client.setConfig({...})` or `createClient()` (headers, fetch, interceptors).

## Calling convention
- POST ops: `op({ body: { apiKey, ... } })`; GET ops: `op({ query: { apiKey } })`.
- Every call resolves to `{ data, error, response }`. Branch on `response.status` (not error strings), or pass `throwOnError: true`.
- Types: `FooResponse`, `FooErrors`; runtime validation via `import { zFoo } from "@fiberai/sdk/zod"`.

```ts
import { getOrgCredits, peopleSearch, companySearch } from "@fiberai/sdk";
const apiKey = process.env.FIBER_API_KEY!;
const credits = await getOrgCredits({ query: { apiKey } });
const companies = await companySearch({ body: { apiKey, pageSize: 25,
  searchParams: { industriesV2: { anyOf: ["Software"] }, headquartersCountryCode: { anyOf: ["USA"] },
                  employeeCountV2: { lowerBoundExclusive: 199, upperBoundInclusive: 1000 } } } });
const people = await peopleSearch({ body: { apiKey, pageSize: 25,
  searchParams: { jobTitleV2: { anyOf: [{ type: "term", term: "CEO" }] }, country3LetterCode: { anyOf: ["USA"] } } } });
```

## Key operations
| Need | Operation(s) |
|---|---|
| Balance / limits (free) | `getOrgCredits`, `getRateLimits` |
| Search | `companySearch`, `peopleSearch`, counts (`companyCount`, `peopleSearchCount`), `paginatedCombinedSearch` |
| NL search | `nlpSearchParse` (prose → searchParams), `slushieRun` (prose → results) |
| Resolve messy identifiers | `KitchenSinkProfile`, `kitchenSinkCompany`, bulk variants (≤ 50/request) |
| Contacts | `syncQuickContactReveal` (work 2 / personal 2 / phone 3 / all 5 credits), `startBatchContactDetails` + `pollBatchContactDetails` (≤ 2,000), exhaustive start/poll |
| Repair CSVs | `startMosaic` (public HTTPS URL, ≤ 50 MiB, ≤ 20k rows; contactInfo flags default TRUE — set them explicitly) + `pollMosaic` (free) |
| Validate | `emailBounceDetection` (1 credit) |

## Patterns
- **Pagination**: cursor-based; pass `nextCursor` from the previous response.
- **Async**: start → `taskId`/`runId` → poll every ≥ 30 s until done; download result URLs immediately (they expire).
- **Billing truth**: `chargeInfo` on each response (`method`: charged-now | charging-later | charged-for-async-process | free | credits-refunded; `creditsCharged` / `creditsRefunded`; optional `lowCreditAlert`).
- **Errors**: 400 bad field/enum · 401 bad key · 402 out of credits (includes top-up URL) · 429 rate limited · 500 (quote `errorCode`).

## Agent docs
- Routing rules: https://api.fiber.ai/llms.txt · index: https://api.fiber.ai/ai-docs/index.md
- One op: https://api.fiber.ai/ai-docs/{operationId}.md · OpenAPI: https://api.fiber.ai/openapi.json
- Inside Sailor: `fiber_find_operation` and `fiber_operation_docs` fetch these for you.
