/**
 * Fiber operation registry — the single table that drives HTTP routing, rate limiting,
 * retry policy, cost estimation and the cost guard. Values come from the per-operation docs at
 * https://api.fiber.ai/ai-docs/{operationId}.md (fetched 2026-09-30). `verified: false` marks
 * estimates we could not confirm; the guard treats those conservatively and the ledger records
 * the authoritative `chargeInfo` after the fact.
 */
import type { Pricing } from "./pricing";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Estimate {
  credits: number;
  basis: string;
  /** true when we are guessing (unknown op or unverified pricing) */
  uncertain?: boolean;
  /** always ask the user, whatever the amount (e.g. PII leaves the machine for Mosaic hosting) */
  forceConfirm?: boolean;
  /** policy block (deny-listed operation) — never runs */
  blockReason?: string;
}

export interface OpMeta {
  opId: string;
  method: HttpMethod;
  path: string;
  paid: boolean;
  /** Safe to retry automatically on 5xx/timeout? Free reads yes; paid charges no. */
  idempotent: boolean;
  /** Requests per minute (client-side token bucket). */
  rpm: number;
  family: string;
  /** Never callable from the agent (money movement / key admin). Edge cases C12/C13. */
  deny?: boolean;
  /** Needs explicit `/fiber admin` mode. */
  admin?: boolean;
  timeoutMs?: number;
  verified?: boolean;
  estimate?: (args: Record<string, any>, p: Pricing) => Estimate;
}

const free = (): Estimate => ({ credits: 0, basis: "free" });

function contactEstimate(types: { getWorkEmails?: boolean; getPersonalEmails?: boolean; getPhoneNumbers?: boolean } | undefined, p: Pricing, people = 1): Estimate {
  const t = { getWorkEmails: true, getPersonalEmails: true, getPhoneNumbers: true, ...(types ?? {}) };
  const emails = (t.getWorkEmails ? 1 : 0) + (t.getPersonalEmails ? 1 : 0);
  let per: number;
  let what: string;
  if (emails === 2 && t.getPhoneNumbers) { per = p.get("contact.all", 5); what = "emails+phones"; }
  else if (emails === 2) { per = p.get("contact.all_emails", 3); what = "all emails"; }
  else if (emails === 1 && t.getPhoneNumbers) { per = p.get("contact.email", 2) + p.get("contact.phone", 3); what = `${t.getWorkEmails ? "work" : "personal"} email+phones`; }
  else if (emails === 1) { per = p.get("contact.email", 2); what = t.getWorkEmails ? "work email" : "personal email"; }
  else if (t.getPhoneNumbers) { per = p.get("contact.phone", 3); what = "phones"; }
  else { per = 0; what = "nothing requested"; }
  return { credits: per * people, basis: `${people} × ${per} (${what}); charged only when found` };
}

const pageSize = (a: Record<string, any>, d = 25) => Math.max(1, Math.min(Number(a.pageSize ?? d) || d, 1000));

const OPS: OpMeta[] = [
  // ── Utility / account (free) ─────────────────────────────────────────────
  { opId: "getOrgCredits", method: "GET", path: "/v1/get-org-credits", paid: false, idempotent: true, rpm: 120, family: "utility", estimate: free, verified: true },
  { opId: "getRateLimits", method: "GET", path: "/v1/rate-limits", paid: false, idempotent: true, rpm: 20, family: "utility", estimate: free, verified: true },
  { opId: "healthCheck", method: "GET", path: "/health", paid: false, idempotent: true, rpm: 60, family: "utility", estimate: free },
  { opId: "getCurrentApiKey", method: "POST", path: "/v1/api-keys/current", paid: false, idempotent: true, rpm: 30, family: "account", estimate: free },
  { opId: "listApiRequests", method: "POST", path: "/v1/api-requests", paid: false, idempotent: true, rpm: 30, family: "account", estimate: free },
  // Money movement & key admin: never from the agent (C12/C13)
  { opId: "buyCredits", method: "POST", path: "/v1/buy-credits", paid: true, idempotent: false, rpm: 2, family: "billing", deny: true },
  { opId: "cardsAttach", method: "POST", path: "/v1/cards/attach", paid: false, idempotent: false, rpm: 2, family: "billing", deny: true },
  { opId: "updateAutoTopupSettings", method: "POST", path: "/v1/auto-topup/configure", paid: false, idempotent: false, rpm: 10, family: "billing", deny: true },
  { opId: "accountSendOtp", method: "POST", path: "/v1/account/send-otp", paid: false, idempotent: false, rpm: 5, family: "account", deny: true },
  { opId: "accountVerifyOtp", method: "POST", path: "/v1/account/verify-otp", paid: false, idempotent: false, rpm: 5, family: "account", deny: true },
  { opId: "revokeCurrentApiKey", method: "POST", path: "/v1/api-keys/revoke", paid: false, idempotent: false, rpm: 10, family: "account", admin: true },
  { opId: "resetApiKeyUsage", method: "POST", path: "/v1/api-keys/usage/reset", paid: false, idempotent: false, rpm: 10, family: "account", admin: true },
  { opId: "updateApiKeyLimit", method: "POST", path: "/v1/api-keys/limit", paid: false, idempotent: true, rpm: 10, family: "account", admin: true },
  { opId: "updateApiKeyExpiration", method: "POST", path: "/v1/api-keys/expiration", paid: false, idempotent: true, rpm: 10, family: "account", admin: true },
  { opId: "createSandboxApiKey", method: "POST", path: "/v1/api-keys/create-sandbox", paid: false, idempotent: false, rpm: 10, family: "account", admin: true },

  // ── Search ───────────────────────────────────────────────────────────────
  { opId: "peopleSearch", method: "POST", path: "/v1/people-search", paid: true, idempotent: false, rpm: 180, family: "search", verified: true,
    estimate: (a, p) => ({ credits: pageSize(a) * p.get("search.result", 1), basis: `up to ${pageSize(a)} profiles × 1 (charged per profile found)` }) },
  { opId: "companySearch", method: "POST", path: "/v1/company-search", paid: true, idempotent: false, rpm: 180, family: "search", verified: true,
    estimate: (a, p) => ({ credits: pageSize(a) * p.get("search.result", 1), basis: `up to ${pageSize(a)} companies × 1 (charged per company found)` }) },
  { opId: "peopleSearchCount", method: "POST", path: "/v1/people-search/count", paid: true, idempotent: true, rpm: 180, family: "search", verified: true,
    estimate: (_a, p) => ({ credits: p.get("search.count", 1), basis: "1 per count request" }) },
  { opId: "companyCount", method: "POST", path: "/v1/company-count", paid: true, idempotent: true, rpm: 180, family: "search", verified: false,
    estimate: (_a, p) => ({ credits: p.get("search.count", 1), basis: "≤1 per count request (billing docs list counts as free)", uncertain: true }) },
  { opId: "jobPostingSearch", method: "POST", path: "/v1/job-search", paid: true, idempotent: false, rpm: 180, family: "search",
    estimate: (a) => ({ credits: pageSize(a), basis: `up to ${pageSize(a)} postings × 1` }) },
  { opId: "paginatedCombinedSearch", method: "POST", path: "/v1/combined-search/paginated", paid: true, idempotent: false, rpm: 120, family: "search", verified: false,
    estimate: (a) => ({ credits: pageSize(a) * 2, basis: `up to ${pageSize(a)} companies + ${pageSize(a)} people`, uncertain: true }) },
  { opId: "nlpSearchParse", method: "POST", path: "/v1/nlp-search/parse", paid: true, idempotent: true, rpm: 120, family: "nl-search", verified: true,
    estimate: (_a, p) => ({ credits: p.get("nlp.parse", 2), basis: "2 per parse" }) },
  { opId: "slushieRun", method: "POST", path: "/v1/nlp-search/run", paid: true, idempotent: false, rpm: 120, family: "nl-search", verified: true, timeoutMs: 60_000,
    estimate: (a) => { const n = pageSize(a); const fixed = a.pageToken ? 0 : 2; return { credits: fixed + n, basis: `${fixed} fixed + up to ${n} results × 1` }; } },

  // ── Kitchen Sink (resolve from messy identifiers) ────────────────────────
  { opId: "KitchenSinkProfile", method: "POST", path: "/v1/kitchen-sink/person", paid: true, idempotent: false, rpm: 120, family: "kitchen-sink", verified: true, timeoutMs: 60_000,
    estimate: (a) => { const per = 2 + (a.liveFetch ? 2 : 0); return { credits: per, basis: `2 per lookup${a.liveFetch ? " + 2 liveFetch" : ""}` }; } },
  { opId: "kitchenSinkCompany", method: "POST", path: "/v1/kitchen-sink/company", paid: true, idempotent: false, rpm: 120, family: "kitchen-sink", verified: true, timeoutMs: 30_000,
    estimate: () => ({ credits: 2, basis: "2 per lookup" }) },
  { opId: "KitchenSinkBulkProfile", method: "POST", path: "/v1/kitchen-sink/bulk/profile", paid: true, idempotent: false, rpm: 60, family: "kitchen-sink", verified: true, timeoutMs: 180_000,
    estimate: (a) => { const n = (a.profiles ?? []).length; const per = 2 + (a.liveFetch ? 2 : 0); return { credits: n * per, basis: `${n} × ${per}` }; } },
  { opId: "kitchenSinkBulkCompany", method: "POST", path: "/v1/kitchen-sink/bulk/company", paid: true, idempotent: false, rpm: 60, family: "kitchen-sink", verified: true, timeoutMs: 180_000,
    estimate: (a) => { const n = (a.companies ?? []).length; return { credits: n * 2, basis: `${n} × 2` }; } },
  { opId: "quickPersonResolve", method: "POST", path: "/v1/person-resolve", paid: true, idempotent: false, rpm: 120, family: "kitchen-sink", verified: false,
    estimate: () => ({ credits: 1, basis: "~1 per resolve", uncertain: true }) },
  { opId: "quickCompanyResolve", method: "POST", path: "/v1/company-resolve", paid: true, idempotent: false, rpm: 120, family: "kitchen-sink", verified: false,
    estimate: () => ({ credits: 1, basis: "~1 per resolve", uncertain: true }) },

  // ── Contact details ──────────────────────────────────────────────────────
  { opId: "syncQuickContactReveal", method: "POST", path: "/v1/contact-details/single", paid: true, idempotent: false, rpm: 200, family: "contact", verified: true, timeoutMs: 120_000,
    estimate: (a, p) => contactEstimate(a.enrichmentType, p, 1) },
  { opId: "syncTurboContactEnrichment", method: "POST", path: "/v1/contact-details/turbo/sync", paid: true, idempotent: false, rpm: 120, family: "contact", verified: false, timeoutMs: 120_000,
    estimate: (a, p) => ({ ...contactEstimate(a.enrichmentType, p, 1), uncertain: true }) },
  { opId: "startBatchContactDetails", method: "POST", path: "/v1/contact-details/batch/start", paid: true, idempotent: false, rpm: 30, family: "contact", verified: true,
    estimate: (a, p) => contactEstimate(a.enrichmentTypes, p, (a.personDetails ?? []).length) },
  { opId: "pollBatchContactDetails", method: "POST", path: "/v1/contact-details/batch/poll", paid: false, idempotent: true, rpm: 240, family: "contact", estimate: free, verified: true },
  { opId: "cancelBatchContactDetails", method: "POST", path: "/v1/contact-details/batch/cancel", paid: false, idempotent: true, rpm: 30, family: "contact", estimate: free },
  { opId: "triggerExhaustiveContactEnrichment", method: "POST", path: "/v1/contact-details/exhaustive/start", paid: true, idempotent: false, rpm: 60, family: "contact", verified: false,
    estimate: (a, p) => ({ ...contactEstimate(a.enrichmentType, p, 1), uncertain: true }) },
  { opId: "pollExhaustiveContactEnrichmentResult", method: "POST", path: "/v1/contact-details/exhaustive/poll", paid: false, idempotent: true, rpm: 120, family: "contact", estimate: free },

  // ── Validation ───────────────────────────────────────────────────────────
  { opId: "emailBounceDetection", method: "POST", path: "/v1/validate-email/single", paid: true, idempotent: true, rpm: 300, family: "validation", verified: true,
    estimate: () => ({ credits: 1, basis: "1 per email" }) },
  { opId: "validatePhoneNumber", method: "POST", path: "/v1/validate-phone/single", paid: true, idempotent: true, rpm: 120, family: "validation", verified: false,
    estimate: () => ({ credits: 1, basis: "~1 per phone", uncertain: true }) },

  // ── Repair data / Mosaic ─────────────────────────────────────────────────
  { opId: "startMosaic", method: "POST", path: "/v1/mosaic/start", paid: true, idempotent: false, rpm: 20, family: "repair", verified: true,
    estimate: (a, p) => mosaicEstimate(a, p) },
  { opId: "pollMosaic", method: "POST", path: "/v1/mosaic/poll", paid: false, idempotent: true, rpm: 120, family: "repair", estimate: free, verified: true },
  { opId: "standardizeCompany", method: "POST", path: "/v1/standardize/company/single", paid: true, idempotent: true, rpm: 60, family: "repair", verified: false,
    estimate: () => ({ credits: 1, basis: "~1", uncertain: true }) },
  { opId: "standardizeCompanyBulk", method: "POST", path: "/v1/standardize/company/bulk", paid: true, idempotent: true, rpm: 30, family: "repair", verified: false,
    estimate: (a) => ({ credits: (a.companies ?? a.inputs ?? []).length || 1, basis: "~1 per company", uncertain: true }) },
  { opId: "standardizeProfile", method: "POST", path: "/v1/standardize/profile/single", paid: true, idempotent: true, rpm: 60, family: "repair", verified: false,
    estimate: () => ({ credits: 1, basis: "~1", uncertain: true }) },

  // ── Live fetch ───────────────────────────────────────────────────────────
  { opId: "profileLiveEnrich", method: "POST", path: "/v1/linkedin-live-fetch/profile/single", paid: true, idempotent: false, rpm: 60, family: "live", verified: true,
    estimate: (_a, p) => ({ credits: p.get("live.fetch", 2), basis: "2 per live fetch" }) },
  { opId: "companyLiveEnrich", method: "POST", path: "/v1/linkedin-live-fetch/company/single", paid: true, idempotent: false, rpm: 60, family: "live", verified: true,
    estimate: (_a, p) => ({ credits: p.get("live.fetch", 2), basis: "2 per live fetch" }) },

  // ── Reverse lookup ───────────────────────────────────────────────────────
  { opId: "reverseEmailLookup", method: "POST", path: "/v1/email-to-person/single", paid: true, idempotent: false, rpm: 120, family: "reverse", verified: false,
    estimate: () => ({ credits: 2, basis: "~2 per lookup", uncertain: true }) },
  { opId: "reversePhoneLookup", method: "POST", path: "/v1/phone-to-person/single", paid: true, idempotent: false, rpm: 120, family: "reverse", verified: false,
    estimate: () => ({ credits: 3, basis: "~3 per lookup", uncertain: true }) },

  // ── Audiences (bulk) ─────────────────────────────────────────────────────
  { opId: "createAudience", method: "POST", path: "/v1/audiences/create", paid: false, idempotent: false, rpm: 30, family: "audience", estimate: free },
  { opId: "estimateEnrichmentCost", method: "POST", path: "/v1/audiences/{audienceId}/enrichment/estimate", paid: false, idempotent: true, rpm: 30, family: "audience", estimate: free },

  // ── Exclusions (free management) ─────────────────────────────────────────
  { opId: "createProspectExclusionList", method: "POST", path: "/v1/exclusions/prospects/create-list", paid: false, idempotent: false, rpm: 30, family: "exclusions", estimate: free },
  { opId: "addProspectsToExclusionList", method: "POST", path: "/v1/exclusions/prospects/add-to-list", paid: false, idempotent: true, rpm: 30, family: "exclusions", estimate: free },
  { opId: "getProspectExclusionLists", method: "POST", path: "/v1/exclusions/prospects/get-lists", paid: false, idempotent: true, rpm: 30, family: "exclusions", estimate: free },
  { opId: "createCompanyExclusionList", method: "POST", path: "/v1/exclusions/companies/create-list", paid: false, idempotent: false, rpm: 30, family: "exclusions", estimate: free },
  { opId: "addCompaniesToExclusionList", method: "POST", path: "/v1/exclusions/companies/add-to-list", paid: false, idempotent: true, rpm: 30, family: "exclusions", estimate: free },

  // ── Signals ──────────────────────────────────────────────────────────────
  { opId: "listAvailableTrackerRules", method: "GET", path: "/v1/tracker/rules", paid: false, idempotent: true, rpm: 30, family: "tracker", estimate: free },
  { opId: "createTrackerCompanyList", method: "POST", path: "/v1/tracker/company-lists", paid: false, idempotent: false, rpm: 30, family: "tracker", estimate: free },
  { opId: "addTrackerCompanies", method: "PUT", path: "/v1/tracker/company-lists/{listId}/companies", paid: false, idempotent: true, rpm: 30, family: "tracker", estimate: free },
  { opId: "refreshTrackerCompanyList", method: "POST", path: "/v1/tracker/company-lists/{listId}/refresh", paid: true, idempotent: false, rpm: 10, family: "tracker", verified: false,
    estimate: (a) => ({ credits: 2 * (Number(a.__entityCount) || 1), basis: "2 per tracked entity per refresh", uncertain: !a.__entityCount }) },
  { opId: "listTrackerSignals", method: "GET", path: "/v1/tracker/signals/{listId}", paid: false, idempotent: true, rpm: 60, family: "tracker", estimate: free },

  // ── Company intel ────────────────────────────────────────────────────────
  { opId: "getScoutingReport", method: "POST", path: "/v1/scouting-report", paid: true, idempotent: false, rpm: 30, family: "intel", verified: false,
    estimate: () => ({ credits: 5, basis: "estimate", uncertain: true }) },
];

export function mosaicEstimate(a: Record<string, any>, p: Pricing): Estimate {
  const rows = Number(a.__rowCount ?? a.options?.maxRows ?? 0);
  if (!rows) return { credits: 0, basis: "unknown until Fiber parses the file (charged after parsing)", uncertain: true };
  // NOTE: Fiber defaults every contactInfo flag to TRUE when omitted — Sailor always sends them explicitly.
  const ci = { getWorkEmails: true, getPersonalEmails: true, getPhoneNumbers: true, ...(a.options?.contactInfo ?? {}) };
  let per = p.get("mosaic.row", 2); // per-row profile resolution (≈ Kitchen Sink lookup; unverified)
  if (ci.getWorkEmails) per += p.get("contact.email", 2);
  if (ci.getPersonalEmails) per += p.get("contact.email", 2);
  if (ci.getPhoneNumbers) per += p.get("contact.phone", 3);
  if (a.options?.includeCompanyDetails) per += p.get("kitchen.company", 2);
  const freeRows = a.__firstRun ? Math.min(rows, 1000) : 0;
  const billable = Math.max(0, rows - freeRows);
  return {
    credits: billable * per,
    basis: `${rows} rows${freeRows ? ` (first ${freeRows} free on first org run)` : ""} × ~${per}/row; contact reveals charged only when found`,
    uncertain: true,
  };
}

const BY_ID = new Map(OPS.map((o) => [o.opId, o]));
const BY_LOWER = new Map(OPS.map((o) => [o.opId.toLowerCase(), o]));

/** Case-insensitive lookup, returns canonical meta (edge case I5: KitchenSinkProfile vs kitchenSinkCompany). */
export function getOp(opId: string): OpMeta | undefined {
  return BY_ID.get(opId) ?? BY_LOWER.get(opId.toLowerCase());
}

export function allOps(): OpMeta[] {
  return [...OPS];
}

/** Meta for an operation Sailor has no entry for (e.g. new op called through MCP). */
export function unknownOp(opId: string): OpMeta {
  return {
    opId, method: "POST", path: "", paid: true, idempotent: false, rpm: 30, family: "unknown",
    estimate: () => ({ credits: 0, basis: "unknown cost — Sailor has no price for this operation", uncertain: true }),
  };
}

export function fillPath(path: string, args: Record<string, any>): { path: string; rest: Record<string, any> } {
  const rest = { ...args };
  const filled = path.replace(/\{(\w+)\}/g, (_m, name) => {
    const v = rest[name];
    if (v === undefined) throw new Error(`Missing path parameter ${name}`);
    delete rest[name];
    return encodeURIComponent(String(v));
  });
  return { path: filled, rest };
}
