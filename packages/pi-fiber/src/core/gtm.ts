/**
 * GTM service layer: the single code path shared by LLM tools, slash commands and TUI pane actions.
 * Services never ask for approval themselves — callers (cost guard / pane actions) approve the
 * aggregate estimate first. Services record entities, contacts and statuses in the Store.
 */
import type { SailorConfig } from "./config";
import type { FiberClient } from "./fiber/client";
import { summarizeCompany, summarizePerson, type CompanySummary, type PersonSummary } from "./fiber/entities";
import { getOp, type Estimate } from "./fiber/ops";
import type { Pricing } from "./fiber/pricing";
import type { Identity } from "./io/columns";
import { emailKind, linkedinSlug, normalizeDomain, normalizeLinkedinUrl } from "./io/normalize";
import { Store, type EntityRow, type ListKind } from "./store/db";

export interface ContactTypes { workEmail?: boolean; personalEmail?: boolean; phone?: boolean }

export interface PeopleFilters {
  titles?: string[];
  titleGroups?: string[]; // founder | c-suite | board-member | vp | director | management | ...
  countries?: string[]; // ISO-3166 alpha-3
  keywords?: string[];
  startedRoleWithinMonths?: number;
}

export interface CompanyFilters {
  industries?: string[];
  countries?: string[];
  employeeMin?: number;
  employeeMax?: number;
  stages?: string[];
  domains?: string[];
  keywords?: string[];
  fundedWithinMonths?: number;
}

const STATIC_TITLE_GROUPS = new Set(["founder", "c-suite", "board-member"]);

/**
 * Friendly filters → Fiber searchParams. jobTitleV2 / country3LetterCode / industriesV2 / headquartersCountryCode /
 * employeeCountV2 / stage / domains shapes are from the ai-docs; the group, keyword and relative-date shapes are
 * best-effort. For anything non-trivial the agent should prefer `fiber_parse_query` (nlpSearchParse), whose
 * output is Fiber-generated searchParams, and pass them through verbatim.
 */
export function buildPeopleSearchParams(f: PeopleFilters): Record<string, unknown> {
  const sp: Record<string, any> = {};
  const titles: any[] = [];
  for (const t of f.titles ?? []) titles.push({ type: "term", term: t });
  for (const g of f.titleGroups ?? []) titles.push(STATIC_TITLE_GROUPS.has(g) ? { type: "static-groups", group: g } : { type: "dynamic-groups", group: g });
  if (titles.length) sp.jobTitleV2 = { anyOf: titles };
  if (f.countries?.length) sp.country3LetterCode = { anyOf: f.countries.map((c) => c.toUpperCase()) };
  if (f.keywords?.length) sp.keywords = { containsAny: f.keywords };
  if (f.startedRoleWithinMonths) sp.startedInRole = { type: "relative", withinLastMonths: f.startedRoleWithinMonths };
  return sp;
}

export function buildCompanySearchParams(f: CompanyFilters): Record<string, unknown> {
  const sp: Record<string, any> = {};
  if (f.industries?.length) sp.industriesV2 = { anyOf: f.industries };
  if (f.countries?.length) sp.headquartersCountryCode = { anyOf: f.countries.map((c) => c.toUpperCase()) };
  if (f.employeeMin !== undefined || f.employeeMax !== undefined) {
    sp.employeeCountV2 = {
      ...(f.employeeMin !== undefined ? { lowerBoundExclusive: Math.max(0, f.employeeMin - 1) } : {}),
      ...(f.employeeMax !== undefined ? { upperBoundInclusive: f.employeeMax } : {}),
    };
  }
  if (f.stages?.length) sp.stage = { anyOf: f.stages };
  if (f.domains?.length) sp.domains = f.domains.map(normalizeDomain).filter(Boolean);
  if (f.keywords?.length) sp.keywords = { containsAny: f.keywords };
  if (f.fundedWithinMonths) sp.lastFundedOn = { type: "relative", withinLastMonths: f.fundedWithinMonths };
  return sp;
}

export function toContactTypes(t: ContactTypes | undefined): { getWorkEmails: boolean; getPersonalEmails: boolean; getPhoneNumbers: boolean } {
  // Sailor default: work email only (cheapest useful). Fiber's own default is "everything" (5 credits).
  const x = t ?? { workEmail: true };
  return { getWorkEmails: !!x.workEmail, getPersonalEmails: !!x.personalEmail, getPhoneNumbers: !!x.phone };
}

export interface SearchResult<S> { listId: string; listName: string; added: number; nextCursor?: string; preview: S[]; charged?: number }

export class Gtm {
  constructor(
    readonly client: FiberClient,
    readonly store: Store,
    readonly config: SailorConfig,
    readonly pricing: Pricing,
  ) {}

  estimate(opId: string, args: Record<string, any>): Estimate {
    const meta = getOp(opId);
    return meta?.estimate?.(args, this.pricing) ?? { credits: 0, basis: "unknown", uncertain: true };
  }

  private ensureList(listRef: string | undefined, kind: ListKind, source: string): { id: string; name: string } {
    if (listRef) {
      const existing = this.store.getList(listRef);
      if (existing) {
        if (existing.kind !== kind) throw new Error(`List "${existing.name}" holds ${existing.kind}, not ${kind}.`);
        return existing;
      }
      return this.store.createList(listRef, kind, source);
    }
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    return this.store.createList(`${kind === "people" ? "People" : "Companies"} ${stamp}`, kind, source);
  }

  // ── search ───────────────────────────────────────────────────────────────
  async nlParse(query: string, signal?: AbortSignal) {
    const r = await this.client.call("nlpSearchParse", { query }, { signal });
    return r.output as { searchId?: string; parsedParams?: { queryType?: string; companySearchParams?: any; profileSearchParams?: any }; suggestedAction?: string; [k: string]: any };
  }

  async count(kind: ListKind, searchParams: Record<string, unknown>, signal?: AbortSignal): Promise<number | undefined> {
    const op = kind === "people" ? "peopleSearchCount" : "companyCount";
    const r = await this.client.call(op, { searchParams }, { signal });
    const o: any = r.output ?? {};
    return o.totalProfilesFound ?? o.totalCompaniesFound ?? o.count ?? o.total;
  }

  async searchPeople(searchParams: Record<string, unknown>, opts: { pageSize?: number; cursor?: string; list?: string; signal?: AbortSignal } = {}): Promise<SearchResult<PersonSummary>> {
    const r = await this.client.call("peopleSearch", { searchParams, pageSize: opts.pageSize ?? 25, ...(opts.cursor ? { cursor: opts.cursor } : {}) }, { signal: opts.signal });
    const data: any[] = r.output?.data ?? [];
    const list = this.ensureList(opts.list, "people", "peopleSearch");
    const preview: PersonSummary[] = [];
    this.store.tx(() => {
      for (const raw of data) {
        const s = summarizePerson(raw);
        const e = this.store.upsertPerson(s, raw, "peopleSearch");
        this.store.addToList(list.id, e.id);
        preview.push(s);
      }
    });
    return { listId: list.id, listName: list.name, added: data.length, nextCursor: r.output?.nextCursor, preview };
  }

  async searchCompanies(searchParams: Record<string, unknown>, opts: { pageSize?: number; cursor?: string; list?: string; signal?: AbortSignal } = {}): Promise<SearchResult<CompanySummary>> {
    const r = await this.client.call("companySearch", { searchParams, pageSize: opts.pageSize ?? 25, ...(opts.cursor ? { cursor: opts.cursor } : {}) }, { signal: opts.signal });
    const data: any[] = r.output?.data ?? [];
    const list = this.ensureList(opts.list, "companies", "companySearch");
    const preview: CompanySummary[] = [];
    this.store.tx(() => {
      for (const raw of data) {
        const s = summarizeCompany(raw);
        const e = this.store.upsertCompany(s, raw, "companySearch");
        this.store.addToList(list.id, e.id);
        preview.push(s);
      }
    });
    return { listId: list.id, listName: list.name, added: data.length, nextCursor: r.output?.nextCursor, preview };
  }

  /** Natural-language search in one call (slushieRun): returns people or companies depending on the query. */
  async nlSearch(query: string, opts: { pageSize?: number; pageToken?: string; list?: string; signal?: AbortSignal } = {}) {
    const r = await this.client.call("slushieRun", { query, pageSize: opts.pageSize ?? 25, ...(opts.pageToken ? { pageToken: opts.pageToken } : {}) }, { signal: opts.signal });
    const o: any = r.output ?? {};
    const companies: any[] = o.companies ?? (o.parsedParams?.queryType === "company" ? o.data ?? o.results : undefined) ?? [];
    const people: any[] = o.profiles ?? o.people ?? (companies.length ? [] : o.data ?? o.results ?? []);
    const kind: ListKind = companies.length && !people.length ? "companies" : "people";
    const list = this.ensureList(opts.list, kind, "slushieRun");
    const preview: (PersonSummary | CompanySummary)[] = [];
    this.store.tx(() => {
      for (const raw of kind === "people" ? people : companies) {
        if (kind === "people") { const s = summarizePerson(raw); this.store.addToList(list.id, this.store.upsertPerson(s, raw, "slushieRun").id); preview.push(s); }
        else { const s = summarizeCompany(raw); this.store.addToList(list.id, this.store.upsertCompany(s, raw, "slushieRun").id); preview.push(s); }
      }
    });
    return { kind, listId: list.id, listName: list.name, added: preview.length, nextPageToken: o.nextPageToken as string | undefined, parsedParams: o.parsedParams, preview };
  }

  // ── resolve (Kitchen Sink) ───────────────────────────────────────────────
  static kitchenSinkPersonBody(id: Identity & { numProfiles?: number }): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    if (id.linkedinUrl) {
      const slug = linkedinSlug(id.linkedinUrl);
      b.profileIdentifier = slug ? { identifier: "linkedinSlug", value: slug } : { identifier: "linkedinUrl", value: id.linkedinUrl };
    }
    if (id.email) b.emailAddress = id.email;
    if (id.name) b.personName = { value: id.name, looseMatch: !id.linkedinUrl && !id.email };
    if (id.title) b.jobTitle = { value: id.title };
    if (id.companyLinkedin) {
      const slug = linkedinSlug(id.companyLinkedin);
      if (slug) b.companyIdentifier = { identifier: "linkedinSlug", value: slug };
    }
    if (id.company) b.companyName = { value: id.company };
    if (id.domain) b.companyDomain = { value: id.domain };
    if (id.numProfiles) b.numProfiles = id.numProfiles;
    return b;
  }

  static kitchenSinkCompanyBody(id: Identity): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    const li = id.companyLinkedin ?? (id.linkedinUrl && /\/company\//.test(id.linkedinUrl) ? id.linkedinUrl : undefined);
    if (li) { const slug = linkedinSlug(li); if (slug) b.companyIdentifier = { identifier: "linkedinSlug", value: slug }; }
    if (id.company) b.companyName = { value: id.company };
    if (id.domain) b.companyDomain = { value: id.domain };
    return b;
  }

  /** Returns up to numProfiles candidates (F1: ambiguous matches are surfaced, never silently picked). */
  async resolvePerson(id: Identity, opts: { liveFetch?: boolean; numProfiles?: number; list?: string; signal?: AbortSignal } = {}) {
    const body = { ...Gtm.kitchenSinkPersonBody({ ...id, numProfiles: opts.numProfiles ?? 1 }), liveFetch: !!opts.liveFetch };
    const r = await this.client.call("KitchenSinkProfile", body, { signal: opts.signal });
    const data: any[] = r.output?.data ?? [];
    const entities: EntityRow[] = data.map((raw) => this.store.upsertPerson(summarizePerson(raw), raw, "KitchenSinkProfile", { email: id.email }));
    if (opts.list && entities.length === 1) {
      const list = this.ensureList(opts.list, "people", "KitchenSinkProfile");
      this.store.addToList(list.id, entities[0].id, { status: "enriched" });
    }
    return { entities, message: r.output?.message as string | undefined, warnings: r.warnings };
  }

  async resolveCompany(id: Identity, opts: { numCompanies?: number; list?: string; signal?: AbortSignal } = {}) {
    const r = await this.client.call("kitchenSinkCompany", { ...Gtm.kitchenSinkCompanyBody(id), numCompanies: opts.numCompanies ?? 1 }, { signal: opts.signal });
    const raw: any[] = Array.isArray(r.output) ? r.output : r.output?.data ?? [];
    const entities = raw.map((c) => this.store.upsertCompany(summarizeCompany(c), c, "kitchenSinkCompany"));
    if (opts.list && entities.length === 1) {
      const list = this.ensureList(opts.list, "companies", "kitchenSinkCompany");
      this.store.addToList(list.id, entities[0].id, { status: "enriched" });
    }
    return { entities };
  }

  /** Kitchen Sink bulk (≤50 per call, sync). Maps the array-of-arrays response back to input order. */
  async bulkResolve(kind: ListKind, rows: { identity: Identity; input: Record<string, string> }[], opts: { listId: string; liveFetch?: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }) {
    let found = 0, notFound = 0;
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      const body = kind === "people"
        ? { profiles: chunk.map((r) => ({ ...Gtm.kitchenSinkPersonBody(r.identity), numProfiles: 1 })), liveFetch: !!opts.liveFetch }
        : { companies: chunk.map((r) => ({ ...Gtm.kitchenSinkCompanyBody(r.identity), numCompanies: 1 })) };
      try {
        const res = await this.client.call(kind === "people" ? "KitchenSinkBulkProfile" : "kitchenSinkBulkCompany", body, { signal: opts.signal });
        const out: any[][] = res.output?.data ?? [];
        this.store.tx(() => {
          chunk.forEach((row, j) => {
            const match = out[j]?.[0];
            const pos = i + j;
            if (match) {
              const e = kind === "people"
                ? this.store.upsertPerson(summarizePerson(match), match, "KitchenSinkBulkProfile", { email: row.identity.email })
                : this.store.upsertCompany(summarizeCompany(match), match, "kitchenSinkBulkCompany");
              this.store.addToList(opts.listId, e.id, { status: "enriched", input: row.input, position: pos });
              found++;
            } else {
              const e = this.store.upsertUnresolved(kind === "people" ? "person" : "company", { ...row.identity }, `${opts.listId}:${pos}`);
              this.store.addToList(opts.listId, e.id, { status: "not_found", input: row.input, position: pos });
              notFound++;
            }
          });
        });
      } catch (err) {
        errors.push(`rows ${i + 1}-${i + chunk.length}: ${(err as Error).message}`);
        if ((err as any)?.status === 402) break; // C3: stop; partial results are already saved
      }
      opts.onProgress?.(Math.min(i + 50, rows.length), rows.length);
    }
    return { found, notFound, errors };
  }

  // ── contacts ─────────────────────────────────────────────────────────────
  /** Which entities actually need a reveal (skip DNC, skip fresh cached contacts, need a LinkedIn URL). */
  planReveal(entities: EntityRow[], types: ContactTypes | undefined) {
    const t = toContactTypes(types);
    const maxAge = this.config.cache.contactTtlDays * 86_400_000;
    const todo: EntityRow[] = [], cached: EntityRow[] = [], dnc: EntityRow[] = [], missingId: EntityRow[] = [];
    for (const e of entities) {
      if (this.config.compliance.requireSuppressionCheck && this.store.entityIsDnc(e)) { dnc.push(e); continue; }
      if (!e.linkedin_url) { missingId.push(e); continue; }
      const have = this.store.contacts(e.id);
      const wanted = (t.getWorkEmails ? ["work_email"] : []).concat(t.getPersonalEmails ? ["personal_email"] : [], t.getPhoneNumbers ? ["phone"] : []);
      if (wanted.every((w) => have.some((c) => c.type === w)) && this.store.hasFreshContacts(e.id, maxAge)) { cached.push(e); continue; }
      todo.push(e);
    }
    const estimate = this.estimate("syncQuickContactReveal", { enrichmentType: t });
    const per = estimate.credits;
    return { todo, cached, dnc, missingId, types: t, estimate: { credits: per * todo.length, basis: `${todo.length} people × ${per} (${estimate.basis.replace(/^1 × \d+ /, "")})` } as Estimate };
  }

  async revealOne(e: EntityRow, types: ReturnType<typeof toContactTypes>, signal?: AbortSignal) {
    const r = await this.client.call("syncQuickContactReveal", { linkedinUrl: e.linkedin_url, enrichmentType: types }, { signal });
    const prof: any = r.output?.profile ?? r.output ?? {};
    let n = 0;
    for (const em of prof.emails ?? []) {
      const addr = String(em.email ?? em.value ?? "").toLowerCase();
      if (!addr) continue;
      const type = String(em.type ?? "").toLowerCase().includes("personal") || emailKind(addr) === "personal" ? "personal_email" : "work_email";
      this.store.addContact(e.id, type, addr, em.status ?? null, "syncQuickContactReveal");
      n++;
    }
    for (const ph of prof.phoneNumbers ?? prof.phones ?? []) {
      const num = String(ph.number ?? ph.value ?? "");
      if (num) { this.store.addContact(e.id, "phone", num, ph.type ?? null, "syncQuickContactReveal"); n++; }
    }
    return n;
  }

  // ── validation ───────────────────────────────────────────────────────────
  async validateEmail(email: string, signal?: AbortSignal) {
    const key = Store.cacheKey("emailBounceDetection", { email });
    const hit = this.store.cacheGet(key);
    const out: any = hit?.response ?? (await this.client.call("emailBounceDetection", { email }, { signal })).output;
    if (!hit) this.store.cacheSet(key, out, this.config.cache.contactTtlDays * 86_400);
    const verdict = String(out?.verdict ?? "inconclusive");
    this.store.setContactValidity(email, verdict === "ok" ? "valid" : verdict);
    return { email, verdict, catchAll: !!out?.is_catch_all, role: !!out?.is_role_based, score: out?.deliverability_score as number | undefined, cached: !!hit };
  }
}

export function identityFromEntity(e: EntityRow): Identity {
  const s: any = e.summary ?? {};
  return { name: e.name ?? s.name, email: e.email ?? undefined, linkedinUrl: e.linkedin_url ?? undefined, company: s.company, domain: e.domain ?? s.companyDomain ?? s.domain, title: s.title };
}

export function identityFromArgs(a: { linkedinUrl?: string; email?: string; name?: string; company?: string; domain?: string; title?: string; companyLinkedinUrl?: string }): Identity {
  return {
    linkedinUrl: a.linkedinUrl ? normalizeLinkedinUrl(a.linkedinUrl) ?? a.linkedinUrl : undefined,
    email: a.email?.toLowerCase().trim(),
    name: a.name,
    company: a.company,
    domain: a.domain ? normalizeDomain(a.domain) : undefined,
    title: a.title,
    companyLinkedin: a.companyLinkedinUrl ? normalizeLinkedinUrl(a.companyLinkedinUrl) : undefined,
  };
}
