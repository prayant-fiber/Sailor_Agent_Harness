/** Turn list items into flat export rows, with presets for common sequencers/CRMs (F7, F14). */
import { splitName } from "../io/normalize";
import type { ItemRow, Store } from "../store/db";
import { extractSocials } from "../prospecting";

export type Preset = "raw" | "outreach" | "apollo" | "hubspot" | "salesloft" | "instantly" | "smartlead";
export const PRESETS: Preset[] = ["raw", "outreach", "apollo", "hubspot", "salesloft", "instantly", "smartlead"];

export interface ExportRowsOptions { preset?: Preset; validOnly?: boolean; excludeDnc?: boolean; includeNotes?: boolean; status?: ItemRow["status"] }

function best(item: ItemRow, type: "work_email" | "personal_email" | "phone"): { value?: string; validity?: string } {
  const cs = (item.contacts ?? []).filter((c) => c.type === type);
  const rank = (v: string | null) => (v === "valid" || v === "ok" ? 0 : v === "risky" || v === "catch_all" ? 1 : v === "unknown" || v == null ? 2 : 3);
  const c = cs.sort((a, b) => rank(a.validity) - rank(b.validity))[0];
  return { value: c?.value, validity: c?.validity ?? undefined };
}

// FIB-20428: /qualify scores and /socials ride along in raw exports.
const scoreCols = (it: ItemRow) => ({ fit_score: it.score ?? "", fit_tier: it.tier ?? "", fit_reason: it.score_reason ?? "" });
const socialCols = (e: NonNullable<ItemRow["entity"]>) => { const so = extractSocials(e); return { x_url: so.x ?? "", github_url: so.github ?? "", website: so.website ?? "" }; };

export function listExportRows(store: Store, listId: string, opts: ExportRowsOptions = {}): { headers: string[]; rows: Record<string, unknown>[]; skippedDnc: number; skippedInvalid: number } {
  const list = store.getList(listId);
  if (!list) throw new Error(`No list ${listId}`);
  const items = store.items(listId, { status: opts.status });
  let skippedDnc = 0, skippedInvalid = 0;
  const base: Record<string, unknown>[] = [];
  for (const it of items) {
    const e = it.entity!;
    if (it.status === "excluded" || ((opts.excludeDnc ?? true) && store.entityIsDnc(e))) { skippedDnc++; continue; }
    const s: any = e.summary ?? {};
    const we = best(it, "work_email"), pe = best(it, "personal_email"), ph = best(it, "phone");
    if (opts.validOnly && list.kind === "people" && !(we.validity === "valid" || we.validity === "ok")) { skippedInvalid++; continue; }
    const nm = splitName(s.name ?? e.name ?? "");
    base.push(list.kind === "people" ? {
      name: s.name ?? e.name ?? "", first_name: nm.first ?? "", last_name: nm.last ?? "",
      title: s.title ?? "", company: s.company ?? "", company_domain: s.companyDomain ?? e.domain ?? "",
      linkedin_url: e.linkedin_url ?? "", work_email: we.value ?? "", work_email_status: we.validity ?? "",
      personal_email: pe.value ?? "", phone: ph.value ?? "", location: s.location ?? "", timezone: s.timezone ?? "",
      tenure_months: s.tenureMonths ?? "", status: it.status, notes: opts.includeNotes === false ? "" : it.notes ?? "",
      ...scoreCols(it), ...socialCols(e),
      source: e.source_op ?? "", fetched_at: new Date(e.fetched_at).toISOString(),
    } : {
      company: s.name ?? e.name ?? "", domain: s.domain ?? e.domain ?? "", linkedin_url: e.linkedin_url ?? "",
      industry: s.industry ?? "", headcount: s.headcount ?? "", hq: s.hq ?? "", country: s.country ?? "", founded: s.founded ?? "",
      latest_funding_stage: s.latestFunding?.stage ?? "", latest_funding_usd: s.latestFunding?.amountUsd ?? "", latest_funding_date: s.latestFunding?.date ?? "",
      total_funding_usd: s.totalFundingUsd ?? "", tech: (s.tech ?? []).join(", "), status: it.status, notes: it.notes ?? "",
      ...scoreCols(it), ...socialCols(e),
      source: e.source_op ?? "", fetched_at: new Date(e.fetched_at).toISOString(),
    });
  }
  const mapped = applyPreset(base, list.kind, opts.preset ?? "raw");
  return { ...mapped, skippedDnc, skippedInvalid };
}

function applyPreset(rows: Record<string, unknown>[], kind: string, preset: Preset): { headers: string[]; rows: Record<string, unknown>[] } {
  const rawHeaders = rows[0] ? Object.keys(rows[0]) : [];
  if (preset === "raw" || kind !== "people") return { headers: rawHeaders, rows };
  const maps: Record<Exclude<Preset, "raw">, [string, string][]> = {
    outreach: [["First Name", "first_name"], ["Last Name", "last_name"], ["Email", "work_email"], ["Title", "title"], ["Company", "company"], ["Website", "company_domain"], ["LinkedIn", "linkedin_url"], ["Mobile Phone", "phone"], ["Time Zone", "timezone"], ["Custom1", "notes"]],
    apollo: [["First Name", "first_name"], ["Last Name", "last_name"], ["Email", "work_email"], ["Title", "title"], ["Company", "company"], ["Website", "company_domain"], ["Person Linkedin Url", "linkedin_url"], ["Phone", "phone"], ["City", "location"]],
    hubspot: [["First Name", "first_name"], ["Last Name", "last_name"], ["Email", "work_email"], ["Job Title", "title"], ["Company Name", "company"], ["Website URL", "company_domain"], ["LinkedIn URL", "linkedin_url"], ["Phone Number", "phone"], ["City", "location"]],
    salesloft: [["first_name", "first_name"], ["last_name", "last_name"], ["email_address", "work_email"], ["title", "title"], ["company_name", "company"], ["linkedin_url", "linkedin_url"], ["phone", "phone"], ["city", "location"]],
    instantly: [["email", "work_email"], ["first_name", "first_name"], ["last_name", "last_name"], ["company_name", "company"], ["website", "company_domain"], ["personalization", "notes"], ["phone", "phone"]],
    smartlead: [["email", "work_email"], ["first_name", "first_name"], ["last_name", "last_name"], ["company_name", "company"], ["website", "company_domain"], ["linkedin_profile", "linkedin_url"], ["phone_number", "phone"], ["custom_personalization", "notes"]],
  };
  const m = maps[preset];
  return { headers: m.map(([h]) => h), rows: rows.filter((r) => preset === "instantly" || preset === "smartlead" ? !!r.work_email : true).map((r) => Object.fromEntries(m.map(([h, k]) => [h, r[k] ?? ""]))) };
}
