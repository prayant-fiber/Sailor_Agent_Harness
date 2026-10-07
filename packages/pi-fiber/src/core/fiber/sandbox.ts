/**
 * Fiber sandbox keys (sk_test_…): never charged, but not every operation is sandboxed yet — those return 501.
 * Seeded from a probe of api.fiber.ai (Oct 2026); any further 501 is learned at runtime by FiberClient.
 */
export const isSandboxKey = (key?: string): boolean => !!key?.startsWith("sk_test_");

/** Operations known to return 501 for sandbox keys. Sailor fails these locally, without a network call. */
export const SANDBOX_UNSUPPORTED_OPS: ReadonlySet<string> = new Set([
  "getOrgCredits", // credit balance
  "nlpSearchParse", // natural-language ICP → filters (probe passed with an empty body, but real requests return 501)
  "slushieRun", // one-shot natural-language search
  "KitchenSinkProfile", // single-person enrichment
  // API-key management is never sandboxed (docs.fiber.ai/account/api-keys)
  "getCurrentApiKey", "updateApiKeyLimit", "updateApiKeyExpiration", "resetApiKeyUsage", "revokeCurrentApiKey",
]);

/** Agent tools that only wrap unsupported operations; hidden from the model while a sandbox key is active. */
export const SANDBOX_HIDDEN_TOOLS: ReadonlySet<string> = new Set(["fiber_nl_search", "fiber_resolve_person", "fiber_parse_query"]);
