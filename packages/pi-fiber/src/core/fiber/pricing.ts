/**
 * Price book. Static defaults come from docs.fiber.ai/billing and per-op ai-docs.
 * `getOrgCredits.output[].creditsPerOperation` is expressed in centiCredits (100 = 1 credit, edge case C2);
 * any numeric entry whose key matches one of our price keys overrides the static default.
 */
export const STATIC_PRICES: Record<string, number> = {
  "search.result": 1,
  "search.count": 1,
  "nlp.parse": 2,
  "contact.email": 2,
  "contact.phone": 3,
  "contact.all_emails": 3,
  "contact.all": 5,
  "live.fetch": 2,
  "kitchen.person": 2,
  "kitchen.company": 2,
  "mosaic.row": 2,
  "validate.email": 1,
};

export function centiToCredits(centi: number): number {
  return Math.round(centi) / 100;
}

export class Pricing {
  private prices = new Map<string, number>(Object.entries(STATIC_PRICES));
  /** Flattened creditsPerOperation (already converted to credits), for display in /credits. */
  public live: Record<string, number> = {};

  get(key: string, fallback: number): number {
    return this.prices.get(key) ?? fallback;
  }

  /** Accepts the raw creditsPerOperation object (any nesting) in centiCredits. */
  ingestCreditsPerOperation(raw: unknown): void {
    const flat: Record<string, number> = {};
    const walk = (v: unknown, prefix: string) => {
      if (typeof v === "number" && Number.isFinite(v)) flat[prefix] = centiToCredits(v);
      else if (v && typeof v === "object") for (const [k, c] of Object.entries(v)) walk(c, prefix ? `${prefix}.${k}` : k);
    };
    walk(raw, "");
    this.live = flat;
    for (const [k, v] of Object.entries(flat)) {
      if (this.prices.has(k)) this.prices.set(k, v);
    }
  }
}
