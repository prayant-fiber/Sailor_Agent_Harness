/**
 * Normalizers from Fiber's rich payloads (44+ fields per person) into compact, stable summaries.
 * The full payload is stored locally; only summaries (and handles) go to the LLM (edge case A5).
 * Field names are probed defensively because different endpoints use different shapes.
 */
import { normalizeDomain, normalizeLinkedinUrl } from "../io/normalize";

export interface PersonSummary {
  name?: string;
  headline?: string;
  title?: string;
  company?: string;
  companyDomain?: string;
  companyLinkedin?: string;
  location?: string;
  country?: string;
  timezone?: string;
  linkedinUrl?: string;
  slug?: string;
  startedRole?: string;
  tenureMonths?: number;
  previousRoles?: { title?: string; company?: string; start?: string; end?: string }[];
  education?: { school?: string; degree?: string; field?: string }[];
  skills?: string[];
  followers?: number;
  connections?: number;
  openToWork?: boolean;
  hiring?: boolean;
}

export interface CompanySummary {
  name?: string;
  domain?: string;
  linkedinUrl?: string;
  slug?: string;
  orgId?: string;
  industry?: string;
  hq?: string;
  country?: string;
  headcount?: number;
  headcountHistory?: { date: string; count: number }[];
  founded?: string;
  latestFunding?: { stage?: string; amountUsd?: number; date?: string; investors?: string[] };
  totalFundingUsd?: number;
  tech?: string[];
  openJobs?: number;
  description?: string;
}

const pick = (o: any, ...keys: string[]): any => {
  for (const k of keys) {
    const v = k.split(".").reduce((acc: any, part) => (acc == null ? undefined : acc[part]), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};
const str = (v: any): string | undefined => (v == null ? undefined : typeof v === "string" ? v : typeof v === "object" ? (v.name ?? v.value ?? v.text) : String(v));
const numOrU = (v: any): number | undefined => (typeof v === "number" ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : undefined);

function monthsSince(date?: string): number | undefined {
  if (!date) return undefined;
  const t = Date.parse(date.length === 7 ? `${date}-01` : date);
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, Math.round((Date.now() - t) / (30.44 * 86_400_000)));
}

export function summarizePerson(p: any): PersonSummary {
  if (!p || typeof p !== "object") return {};
  const exps: any[] = pick(p, "experiences", "work_experience", "experience", "positions") ?? [];
  const current = exps.find((e) => !pick(e, "end_date", "endDate", "ends_at", "end") || pick(e, "is_current", "isCurrent")) ?? exps[0];
  const slug = pick(p, "primary_slug", "linkedin_slug", "slug", "public_identifier", "publicIdentifier");
  const url = pick(p, "linkedin_url", "linkedinUrl", "url") ?? (slug ? `https://www.linkedin.com/in/${slug}` : undefined);
  const started = str(pick(current ?? {}, "start_date", "startDate", "starts_at", "start"));
  const loc = pick(p, "inferred_location", "location", "locality");
  const edu: any[] = pick(p, "education", "educations") ?? [];
  const skills: any[] = pick(p, "skills") ?? [];
  return {
    name: str(pick(p, "name", "full_name", "fullName")) ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || undefined),
    headline: str(pick(p, "headline", "linkedin_headline")),
    title: str(pick(current ?? {}, "title", "job_title", "position")) ?? str(pick(p, "job_title", "title", "current_title")),
    company: str(pick(current ?? {}, "company_name", "company.name", "companyName", "company")) ?? str(pick(p, "company_name", "current_company.name")),
    companyDomain: normalizeDomain(str(pick(current ?? {}, "company_domain", "company.domain", "companyDomain")) ?? str(pick(p, "company_domain")) ?? "") || undefined,
    companyLinkedin: str(pick(current ?? {}, "company_linkedin_url", "company.linkedin_url")),
    location: typeof loc === "string" ? loc : str(pick(loc ?? {}, "formatted", "display", "name", "city")) ?? str(pick(p, "location_name", "city")),
    country: str(pick(p, "country_code", "inferred_location.country_code", "location.country_code", "country")),
    timezone: str(pick(p, "timezone", "inferred_location.timezone", "location.timezone", "time_zone")),
    linkedinUrl: url ? normalizeLinkedinUrl(String(url)) ?? String(url) : undefined,
    slug: slug ? String(slug) : undefined,
    startedRole: started,
    tenureMonths: monthsSince(started),
    previousRoles: exps.filter((e) => e !== current).slice(0, 3).map((e) => ({
      title: str(pick(e, "title", "job_title")), company: str(pick(e, "company_name", "company.name", "company")),
      start: str(pick(e, "start_date", "startDate")), end: str(pick(e, "end_date", "endDate")),
    })),
    education: edu.slice(0, 3).map((e) => ({ school: str(pick(e, "school_name", "school.name", "school")), degree: str(pick(e, "degree", "degree_name")), field: str(pick(e, "field_of_study", "field")) })),
    skills: skills.slice(0, 15).map((s) => str(s)!).filter(Boolean),
    followers: numOrU(pick(p, "follower_count", "followers", "num_followers")),
    connections: numOrU(pick(p, "connection_count", "connections", "num_connections")),
    openToWork: pick(p, "open_to_work", "is_open_to_work", "openToWork") === true || undefined,
    hiring: pick(p, "is_hiring", "hiring") === true || undefined,
  };
}

export function summarizeCompany(c: any): CompanySummary {
  if (!c || typeof c !== "object") return {};
  const domains = pick(c, "domains", "domain", "website");
  const domain = Array.isArray(domains) ? domains[0] : domains;
  const slug = pick(c, "linkedin_primary_slug", "linkedin_slug", "slug") ?? (Array.isArray(c.linkedin_slugs) ? c.linkedin_slugs[0] : undefined);
  const funding = pick(c, "latest_funding_consensus", "latest_funding", "last_funding");
  const tech = pick(c, "technologies", "tech_stack", "technology_stack") ?? [];
  const hist = pick(c, "employee_count_history", "headcount_history", "employee_count_by_month") ?? [];
  const hq = pick(c, "headquarters", "hq", "location");
  return {
    name: str(pick(c, "name", "company_name", "linkedin_name")),
    domain: domain ? normalizeDomain(String(domain)) : undefined,
    linkedinUrl: str(pick(c, "linkedin_url")) ?? (slug ? `https://www.linkedin.com/company/${slug}` : undefined),
    slug: slug ? String(slug) : undefined,
    orgId: str(pick(c, "li_org_id", "linkedin_id", "linkedin_org_id")),
    industry: str(pick(c, "industry", "industries.0", "linkedin_industry")),
    hq: typeof hq === "string" ? hq : str(pick(hq ?? {}, "formatted", "city", "name")),
    country: str(pick(c, "headquarters_country_code", "country_code", "hq.country_code")),
    headcount: numOrU(pick(c, "employee_count_consensus", "employee_count", "headcount", "num_employees")),
    headcountHistory: Array.isArray(hist) ? hist.slice(-12).map((h: any) => ({ date: String(pick(h, "date", "month") ?? ""), count: Number(pick(h, "count", "employee_count", "value") ?? 0) })).filter((h: any) => h.date) : undefined,
    founded: str(pick(c, "founded_on_consensus", "founded_on", "founded_year", "founded")),
    latestFunding: funding ? {
      stage: str(pick(funding, "stage", "round", "type", "funding_type")),
      amountUsd: numOrU(pick(funding, "amount_usd", "amountUSD", "amount", "money_raised_usd")),
      date: str(pick(funding, "date", "announced_on", "announced_date")),
      investors: (pick(funding, "investors", "lead_investors") ?? []).slice?.(0, 5).map((i: any) => str(i)!).filter(Boolean),
    } : undefined,
    totalFundingUsd: numOrU(pick(c, "total_funding_usd", "totalFundingUSD", "total_funding")),
    tech: Array.isArray(tech) ? tech.slice(0, 20).map((t: any) => str(t)!).filter(Boolean) : undefined,
    openJobs: numOrU(pick(c, "li_job_posts_stats.total", "open_jobs", "num_open_jobs")),
    description: (str(pick(c, "description", "tagline")) ?? "").slice(0, 280) || undefined,
  };
}

/** One-line human/LLM-readable renderings. */
export function personLine(p: PersonSummary): string {
  const bits = [p.name ?? "(unknown)", p.title && p.company ? `${p.title} @ ${p.company}` : p.title ?? p.company, p.location, p.tenureMonths !== undefined ? `${p.tenureMonths}mo in role` : undefined];
  return bits.filter(Boolean).join(" · ");
}

export function companyLine(c: CompanySummary): string {
  const f = c.latestFunding;
  const funding = f?.stage || f?.amountUsd ? `${f.stage ?? "funding"}${f.amountUsd ? ` $${fmtMoney(f.amountUsd)}` : ""}${f.date ? ` (${f.date.slice(0, 7)})` : ""}` : undefined;
  return [c.name ?? c.domain ?? "(unknown)", c.domain, c.industry, c.headcount ? `${c.headcount} emp` : undefined, c.hq, funding].filter(Boolean).join(" · ");
}

export function fmtMoney(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

/** Flatten a summary into dot-path → value (used for grounding citations and exports). */
export function flatten(obj: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj === null || obj === undefined) return out;
  if (Array.isArray(obj)) {
    if (obj.every((v) => typeof v !== "object")) out[prefix] = obj.join(", ");
    else obj.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
  } else if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = obj;
  return out;
}
