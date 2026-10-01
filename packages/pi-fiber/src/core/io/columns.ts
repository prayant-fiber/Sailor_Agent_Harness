/** Column-role detection for messy lists (headers + value sniffing). */
import {
  extractEmails, linkedinSlug, normalizeCompanyName, normalizeDomain, normalizeLinkedinUrl, normalizeName,
  normalizePhone, parseNameAtCompany,
} from "./normalize";

export type Role =
  | "email" | "linkedin" | "fullName" | "firstName" | "lastName" | "company" | "companyLinkedin"
  | "domain" | "title" | "phone" | "location" | "country";

export interface ColumnMap {
  roles: Partial<Record<Role, string>>;
  coverage: Partial<Record<Role, number>>; // 0..1 of rows with a usable value
  entityKind: "people" | "companies";
}

const HEADER_PATTERNS: [Role, RegExp][] = [
  ["email", /^(work[\s_-]?)?e-?mail(\s*address)?$|^mail$|email/i],
  ["companyLinkedin", /company.*linkedin|linkedin.*company/i],
  ["linkedin", /linked\s*in|li[\s_-]?url|profile[\s_-]?url|sales\s*nav/i],
  ["firstName", /^first[\s_-]?name$|^given[\s_-]?name$|^first$|^fname$/i],
  ["lastName", /^last[\s_-]?name$|^surname$|^family[\s_-]?name$|^last$|^lname$/i],
  ["fullName", /^(full[\s_-]?)?name$|^contact(\s*name)?$|^person$|^lead(\s*name)?$|^candidate$/i],
  ["domain", /domain|website|web[\s_-]?site|^url$|company[\s_-]?url/i],
  ["company", /company|organi[sz]ation|^org$|account(\s*name)?|employer|business/i],
  ["title", /title|position|^role$|job|designation|seniority/i],
  ["phone", /phone|mobile|cell|tel(ephone)?|direct[\s_-]?dial/i],
  ["country", /country/i],
  ["location", /location|city|region|^state$|address|geo/i],
];

type Sniffer = (v: string) => boolean;
const SNIFF: Partial<Record<Role, Sniffer>> = {
  email: (v) => extractEmails(v).length > 0,
  linkedin: (v) => /linkedin\.com\/(in|pub|sales|talent)\//i.test(v),
  companyLinkedin: (v) => /linkedin\.com\/company\//i.test(v),
  domain: (v) => !!normalizeDomain(v) && !v.includes("@") && !/linkedin\.com/i.test(v),
  phone: (v) => /^[+(\d][\d\s().+-]{6,}$/.test(v.trim()) || /^\d(\.\d+)?e\+?\d+$/i.test(v.trim()),
};

export function detectColumns(headers: string[], records: Record<string, string>[]): ColumnMap {
  const sample = records.slice(0, 200);
  const roles: Partial<Record<Role, string>> = {};
  const used = new Set<string>();
  const valueRate = (h: string, fn: Sniffer) => {
    const vals = sample.map((r) => r[h] ?? "").filter((v) => v.trim());
    return vals.length ? vals.filter(fn).length / vals.length : 0;
  };
  // 1) header name patterns, validated by value sniffing where we can
  for (const [role, re] of HEADER_PATTERNS) {
    if (roles[role]) continue;
    const h = headers.find((x) => !used.has(x) && re.test(x) && (!SNIFF[role] || valueRate(x, SNIFF[role]!) >= 0.3));
    if (h) { roles[role] = h; used.add(h); }
  }
  // 2) value sniffing for unlabeled columns
  for (const role of ["email", "linkedin", "companyLinkedin", "phone", "domain"] as Role[]) {
    if (roles[role]) continue;
    let best: string | undefined, bestRate = 0.5;
    for (const h of headers) {
      if (used.has(h)) continue;
      const r = valueRate(h, SNIFF[role]!);
      if (r > bestRate) { bestRate = r; best = h; }
    }
    if (best) { roles[role] = best; used.add(best); }
  }
  const coverage: Partial<Record<Role, number>> = {};
  for (const [role, h] of Object.entries(roles) as [Role, string][]) {
    const fn = SNIFF[role] ?? ((v: string) => !!v.trim());
    coverage[role] = records.length ? records.filter((r) => fn(r[h] ?? "")).length / records.length : 0;
  }
  const personSignals = ["email", "linkedin", "fullName", "firstName", "lastName", "title"].filter((r) => roles[r as Role]).length;
  const entityKind = personSignals === 0 && (roles.company || roles.domain || roles.companyLinkedin) ? "companies" : "people";
  return { roles, coverage, entityKind };
}

export interface Identity {
  name?: string;
  email?: string;
  extraEmails?: string[];
  linkedinUrl?: string;
  linkedinSlug?: string;
  company?: string;
  companyLinkedin?: string;
  domain?: string;
  title?: string;
  phone?: string;
  phoneWarning?: string;
  location?: string;
  country?: string;
}

export function buildIdentity(rec: Record<string, string>, map: ColumnMap, defaultRegion = "US"): Identity {
  const g = (role: Role) => (map.roles[role] ? (rec[map.roles[role]!] ?? "").trim() : "");
  const id: Identity = {};
  const emails = extractEmails(g("email"));
  if (emails[0]) id.email = emails[0];
  if (emails.length > 1) id.extraEmails = emails.slice(1);
  const li = normalizeLinkedinUrl(g("linkedin"));
  if (li) { id.linkedinUrl = li; id.linkedinSlug = linkedinSlug(li); }
  const cli = normalizeLinkedinUrl(g("companyLinkedin"));
  if (cli) id.companyLinkedin = cli;
  let name = g("fullName") || [g("firstName"), g("lastName")].filter(Boolean).join(" ");
  let company = g("company");
  if (name && !company) {
    const nac = parseNameAtCompany(name);
    if (nac.name) { name = nac.name; company = nac.company ?? ""; }
  }
  if (name) id.name = normalizeName(name);
  if (company) id.company = normalizeCompanyName(company);
  const domain = normalizeDomain(g("domain")) || (id.email && !/gmail|yahoo|hotmail|outlook|icloud|aol|proton/.test(id.email) ? normalizeDomain(id.email) : "");
  if (domain) id.domain = domain;
  if (g("title")) id.title = g("title");
  if (g("phone")) {
    const p = normalizePhone(g("phone"), defaultRegion);
    if (p.e164) id.phone = p.e164;
    if (p.warning) id.phoneWarning = p.warning;
  }
  if (g("location")) id.location = g("location");
  if (g("country")) id.country = g("country");
  return id;
}

/** Can Kitchen Sink resolve this row? Needs a strong identifier or name+company. */
export function isResolvable(id: Identity, kind: "people" | "companies"): boolean {
  if (kind === "companies") return !!(id.domain || id.companyLinkedin || id.company);
  return !!(id.linkedinUrl || id.email || (id.name && (id.company || id.domain)));
}
