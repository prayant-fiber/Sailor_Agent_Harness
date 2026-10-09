/**
 * Prospecting helpers behind /qualify, /lookalikes and /socials (FIB-20428). Pure functions over the local store:
 * no Fiber calls, no credits. Fiber has no scoring or lookalike API yet, so Sailor gives the model a compact,
 * deterministic profile of a list and a place to write scores; the judgment itself is the model's.
 */
import type { EntityRow, ItemRow, Store } from "./store/db";

export type SocialNetwork = "linkedin" | "x" | "github" | "facebook" | "instagram" | "youtube" | "tiktok" | "crunchbase" | "angellist" | "website";
export type Socials = Partial<Record<SocialNetwork, string>>;

const NETWORKS: [SocialNetwork, RegExp][] = [
  ["linkedin", /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\//i],
  ["x", /^https?:\/\/(www\.)?(twitter|x)\.com\/[^/?#]+/i],
  ["github", /^https?:\/\/(www\.)?github\.com\/[^/?#]+/i],
  ["facebook", /^https?:\/\/([a-z-]+\.)?facebook\.com\//i],
  ["instagram", /^https?:\/\/(www\.)?instagram\.com\//i],
  ["youtube", /^https?:\/\/(www\.)?youtube\.com\//i],
  ["tiktok", /^https?:\/\/(www\.)?tiktok\.com\//i],
  ["crunchbase", /^https?:\/\/(www\.)?crunchbase\.com\//i],
  ["angellist", /^https?:\/\/(www\.)?(angel\.co|wellfound\.com)\//i],
];

/** Handle-style fields some Fiber payloads use instead of URLs. */
const HANDLE_KEYS: Record<string, (h: string) => [SocialNetwork, string]> = {
  twitter_username: (h) => ["x", `https://x.com/${h.replace(/^@/, "")}`],
  twitter_handle: (h) => ["x", `https://x.com/${h.replace(/^@/, "")}`],
  twitterhandle: (h) => ["x", `https://x.com/${h.replace(/^@/, "")}`],
  github_username: (h) => ["github", `https://github.com/${h}`],
  githubusername: (h) => ["github", `https://github.com/${h}`],
  facebook_username: (h) => ["facebook", `https://facebook.com/${h}`],
};
const WEBSITE_KEYS = new Set(["website", "personal_website", "personalwebsite", "blog", "homepage", "website_url", "websiteurl"]);

/** Social profiles found in a stored entity (summary + full Fiber payload). Free: reads local data only. */
export function extractSocials(e: Pick<EntityRow, "linkedin_url" | "data" | "summary" | "kind">): Socials {
  const out: Socials = {};
  if (e.linkedin_url) out.linkedin = e.linkedin_url;
  const seen = new WeakSet<object>();
  const walk = (v: unknown, key: string, depth: number): void => {
    if (depth > 6 || v == null) return;
    if (typeof v === "string") {
      const s = v.trim();
      const k = key.toLowerCase();
      if (HANDLE_KEYS[k] && /^@?[\w.-]{1,40}$/.test(s)) { const [n, url] = HANDLE_KEYS[k](s); out[n] ??= url; return; }
      if (!/^https?:\/\//i.test(s) || s.length > 300) return;
      for (const [n, re] of NETWORKS) if (re.test(s)) { out[n] ??= s; return; }
      // Only a person's own site counts as "website" (skip company/employer URLs and logos).
      if (WEBSITE_KEYS.has(k) && e.kind === "person" && depth <= 2) out.website ??= s;
      return;
    }
    if (typeof v !== "object") return;
    if (seen.has(v as object)) return;
    seen.add(v as object);
    // Don't harvest socials of employers/colleagues nested in experience arrays.
    if (/^(experiences?|work_experience|positions|company|current_company|employer|colleagues|similar_profiles|people_also_viewed)$/i.test(key)) return;
    if (Array.isArray(v)) { for (const x of v.slice(0, 50)) walk(x, key, depth + 1); return; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k, depth + 1);
  };
  walk(e.summary, "", 0);
  walk(e.data, "", 0);
  return out;
}

export function socialsLine(s: Socials): string {
  return Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(" · ");
}

// ── list profile (for /qualify and /lookalikes) ─────────────────────────────

function top(values: (string | undefined | null)[], n = 8): [string, number][] {
  const c = new Map<string, number>();
  for (const v of values) { const k = (v ?? "").toString().trim(); if (k) c.set(k, (c.get(k) ?? 0) + 1); }
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
const fmtTop = (label: string, xs: [string, number][], total: number) => xs.length ? `${label}: ${xs.map(([k, n]) => `${k} (${Math.round((100 * n) / Math.max(1, total))}%)`).join(", ")}` : "";

const SENIORITY: [string, RegExp][] = [
  ["C-level", /\b(chief|c[eftoir]o|cro|cmo|cpo)\b/i],
  ["Founder", /\b(co-?founder|founder|owner)\b/i],
  ["VP", /\b(vp|vice president|svp|evp)\b/i],
  ["Head", /\bhead of\b/i],
  ["Director", /\bdirector\b/i],
  ["Manager", /\bmanager\b/i],
  ["IC", /./],
];
export function seniorityOf(title?: string): string | undefined {
  if (!title) return undefined;
  return SENIORITY.find(([, re]) => re.test(title))?.[0];
}

function headcountBucket(n?: number): string | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  const b = [10, 50, 200, 500, 1000, 5000, 10000];
  let lo = 1;
  for (const hi of b) { if (n <= hi) return `${lo}-${hi}`; lo = hi + 1; }
  return "10001+";
}

export interface ListProfile { kind: "people" | "companies"; size: number; text: string; excludeIds: string[] }

/** Deterministic summary of what a list "looks like" (titles, seniority, companies, geos, industries, sizes, funding). */
export function profileList(store: Store, listRef: string, sample = 15): ListProfile {
  const list = store.getList(listRef);
  if (!list) throw new Error(`No list "${listRef}". Use list_all to see lists.`);
  const items = store.items(list.id, { withContacts: false });
  const ents = items.map((i) => i.entity!).filter(Boolean);
  const S = (e: EntityRow) => (e.summary ?? {}) as any;
  const lines = [`List "${list.name}" (${list.id}) · ${items.length} ${list.kind}`];
  if (list.kind === "people") {
    lines.push(
      fmtTop("Titles", top(ents.map((e) => S(e).title)), ents.length),
      fmtTop("Seniority", top(ents.map((e) => seniorityOf(S(e).title))), ents.length),
      fmtTop("Companies", top(ents.map((e) => S(e).company)), ents.length),
      fmtTop("Company domains", top(ents.map((e) => S(e).companyDomain ?? e.domain)), ents.length),
      fmtTop("Locations", top(ents.map((e) => S(e).location)), ents.length),
      fmtTop("Countries", top(ents.map((e) => S(e).country)), ents.length),
      fmtTop("Skills", top(ents.flatMap((e) => (S(e).skills ?? []) as string[]), 12), ents.length),
    );
    const ten = ents.map((e) => S(e).tenureMonths).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
    if (ten.length) lines.push(`Tenure in role: median ${ten[Math.floor(ten.length / 2)]} months`);
  } else {
    lines.push(
      fmtTop("Industries", top(ents.map((e) => S(e).industry)), ents.length),
      fmtTop("Headcount", top(ents.map((e) => headcountBucket(S(e).headcount))), ents.length),
      fmtTop("Countries", top(ents.map((e) => S(e).country)), ents.length),
      fmtTop("HQ", top(ents.map((e) => S(e).hq)), ents.length),
      fmtTop("Latest funding stage", top(ents.map((e) => S(e).latestFunding?.stage)), ents.length),
      fmtTop("Tech", top(ents.flatMap((e) => (S(e).tech ?? []) as string[]), 12), ents.length),
    );
    const founded = ents.map((e) => Number(String(S(e).founded ?? "").slice(0, 4))).filter((y) => y > 1800).sort();
    if (founded.length) lines.push(`Founded: ${founded[0]}–${founded[founded.length - 1]} (median ${founded[Math.floor(founded.length / 2)]})`);
  }
  const scored = items.filter((i) => i.score != null);
  if (scored.length) lines.push(`Qualified: ${scored.length}/${items.length} scored · tiers ${top(scored.map((i) => i.tier)).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  lines.push("", `Sample (${Math.min(sample, items.length)}):`);
  for (const it of items.slice(0, sample)) lines.push(`- ${it.entity_id} · ${sampleLine(list.kind, it)}`);
  return { kind: list.kind, size: items.length, text: lines.filter((l) => l !== "").join("\n"), excludeIds: ents.map((e) => e.linkedin_url ?? e.domain ?? e.id) };
}

function sampleLine(kind: "people" | "companies", it: ItemRow): string {
  const s: any = it.entity?.summary ?? {};
  return kind === "people"
    ? [s.name ?? it.entity?.name, s.title, s.company, s.location].filter(Boolean).join(" · ")
    : [s.name ?? it.entity?.name, s.domain ?? it.entity?.domain, s.industry, s.headcount && `${s.headcount} emp`, s.latestFunding?.stage].filter(Boolean).join(" · ");
}

// ── qualification scores ────────────────────────────────────────────────────

export type Tier = "A" | "B" | "C" | "D";
export const tierFor = (score: number): Tier => (score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D");

export interface ScoreInput { entityId: string; score: number; reason?: string; tier?: Tier }

/** Saves AI scores (0-100) on list rows. Returns how many rows were updated and which ids weren't on the list. */
export function saveScores(store: Store, listId: string, scores: ScoreInput[]): { updated: number; missing: string[] } {
  let updated = 0;
  const missing: string[] = [];
  store.tx(() => {
    for (const s of scores) {
      const score = Math.max(0, Math.min(100, Math.round(Number(s.score))));
      if (!Number.isFinite(score)) { missing.push(s.entityId); continue; }
      const ok = store.setItemScore(listId, s.entityId, score, s.tier ?? tierFor(score), s.reason?.slice(0, 280) ?? null);
      if (ok) updated++; else missing.push(s.entityId);
    }
  });
  return { updated, missing };
}

/** Copies rows scoring ≥ minScore into a new list, best first. */
export function narrowToQualified(store: Store, listId: string, minScore: number, name?: string): { listId: string; listName: string; kept: number; total: number } {
  const list = store.getList(listId);
  if (!list) throw new Error(`No list "${listId}".`);
  const items = store.items(list.id, { withContacts: false });
  const kept = items.filter((i) => i.score != null && i.score >= minScore && i.status !== "excluded").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const out = store.createList(name ?? `${list.name} · qualified ≥${minScore}`, list.kind, `qualify:${list.id}`);
  store.tx(() => kept.forEach((it, pos) => {
    store.addToList(out.id, it.entity_id, { position: pos, status: it.status });
    store.setItemScore(out.id, it.entity_id, it.score!, it.tier ?? null, it.score_reason ?? null);
  }));
  return { listId: out.id, listName: out.name, kept: kept.length, total: items.length };
}
