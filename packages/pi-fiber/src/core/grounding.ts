/**
 * Grounding + compliance helpers for generated outreach (A9, L1, G6).
 * Scripts must tag every personalized fact with a citation like [funding.latest] / [company.headcount].
 */
import { flatten } from "./fiber/entities";

export interface GroundingReport { citations: string[]; unknown: string[]; unverified: number; ok: boolean }

/** Map friendly citation roots to summary paths. */
const ALIASES: Record<string, string> = {
  "funding.latest": "latestFunding", funding: "latestFunding", "company.headcount": "headcount", headcount: "headcount",
  tenure: "tenureMonths", role: "title", "person.title": "title", "company.name": "company", location: "location",
  timezone: "timezone", tech: "tech", "company.tech": "tech", education: "education", "previous_roles": "previousRoles",
};

export function checkGrounding(text: string, facts: Record<string, unknown>): GroundingReport {
  const flat = flatten(facts);
  const keys = Object.keys(flat);
  const tags = [...text.matchAll(/\[([a-zA-Z_][\w.]*)\]/g)].map((m) => m[1]).filter((t) => t !== "unverified");
  const unknown = tags.filter((t) => {
    const path = ALIASES[t] ?? t;
    return !keys.some((k) => k === path || k.startsWith(`${path}.`) || k.startsWith(`${path.replace(/^(person|company)\./, "")}`));
  });
  const unverified = (text.match(/\[unverified\]/g) ?? []).length;
  return { citations: [...new Set(tags)], unknown: [...new Set(unknown)], unverified, ok: unknown.length === 0 };
}

const PROTECTED = [
  { re: /\b(women|woman|female|men|male|gender|non-?binary|trans(gender)?)\b/i, what: "gender" },
  { re: /\b(young|older|age[ds]?|under\s*\d{2}|over\s*\d{2}|millennial|gen\s?z|boomer|recent grads? only)\b/i, what: "age" },
  { re: /\b(black|white|asian|hispanic|latin[oax]|caucasian|african[- ]american|ethnic(ity)?|race|racial)\b/i, what: "race/ethnicity" },
  { re: /\b(christian|muslim|jewish|hindu|sikh|buddhist|religio(n|us))\b/i, what: "religion" },
  { re: /\b(pregnan|maternity|mothers?|fathers?|married|single|marital)\w*/i, what: "family/marital status" },
  { re: /\b(disab(led|ility)|veteran status|citizenship|nationality|native[- ]born)\b/i, what: "disability/citizenship" },
];

/** Recruiting fairness guard: flags queries that filter on protected attributes. */
export function protectedAttributeCheck(text: string): string[] {
  return PROTECTED.filter((p) => p.re.test(text)).map((p) => p.what);
}

/** Wraps third-party text so the model treats it as data (G1 prompt-injection defense). */
export function asUntrusted(label: string, text: string): string {
  const cleaned = text.replace(/<\/?untrusted[^>]*>/gi, "");
  return `<untrusted source="${label}">\n${cleaned}\n</untrusted>`;
}

const INJECTION = /(ignore (all|any|previous|prior) (instructions|prompts)|system prompt|you are now|disregard (the )?above|exfiltrat|send (this|the|all) (data|contacts|list) to|curl\s+https?:|<\s*script)/i;

export function looksLikeInjection(text: string): boolean {
  return INJECTION.test(text);
}
