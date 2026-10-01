/**
 * Prospect / company cards (F6) as plain line arrays. `paint` adds theme colors when a Theme is available;
 * without it (print/json/RPC modes) cards degrade to plain text.
 */
import { fmtMoney, type CompanySummary, type PersonSummary } from "../../core/fiber/entities";
import type { ContactRow, EntityRow } from "../../core/store/db";
import { callWindow, localTime } from "../../core/time";
import { sparkline, truncate, wrap } from "./text";

export type Paint = (color: string, text: string) => string;
export const noPaint: Paint = (_c, t) => t;

function badge(validity: string | null | undefined): string {
  if (!validity) return "?";
  if (validity === "valid" || validity === "ok") return "✓ valid";
  if (validity === "risky" || validity === "catch_all") return "~ risky";
  if (validity === "invalid" || validity === "undeliverable") return "✗ invalid";
  return validity;
}

export function personCard(e: EntityRow, contacts: ContactRow[], width: number, paint: Paint = noPaint, notes?: string | null): string[] {
  const s = e.summary as PersonSummary;
  const L: string[] = [];
  const line = (t: string) => L.push(truncate(t, width));
  line(paint("accent", `▌ ${s.name ?? e.name ?? "(unknown)"}`) + (s.openToWork ? paint("success", "  open to work") : ""));
  if (s.headline) line(paint("muted", `  ${s.headline}`));
  line(`  ${s.title ?? "—"} @ ${s.company ?? "—"}${s.tenureMonths !== undefined ? paint("dim", ` · ${s.tenureMonths} mo in role`) : ""}`);
  const lt = localTime(s.timezone);
  line(`  ${s.location ?? "location unknown"}${lt ? paint("dim", ` · local ${lt}`) : ""}`);
  if (s.linkedinUrl) line(paint("dim", `  ${s.linkedinUrl}`));
  L.push("");
  line(paint("toolTitle", "  Contacts"));
  if (!contacts.length) line(paint("dim", "    none yet — press e to reveal"));
  for (const c of contacts) line(`    ${c.type.replace("_", " ").padEnd(15)} ${c.value}  ${paint(c.validity === "valid" || c.validity === "ok" ? "success" : c.validity ? "warning" : "dim", badge(c.validity))}`);
  if (s.previousRoles?.length) {
    L.push("");
    line(paint("toolTitle", "  Previously"));
    for (const r of s.previousRoles) line(`    ${r.title ?? "?"} @ ${r.company ?? "?"}${r.start ? paint("dim", ` (${r.start.slice(0, 7)}–${r.end?.slice(0, 7) ?? ""})`) : ""}`);
  }
  if (s.education?.length) {
    L.push("");
    line(paint("toolTitle", "  Education"));
    for (const ed of s.education) line(`    ${ed.school ?? "?"}${ed.degree ? `, ${ed.degree}` : ""}${ed.field ? ` (${ed.field})` : ""}`);
  }
  if (s.skills?.length) { L.push(""); for (const w of wrap(`Skills: ${s.skills.join(", ")}`, width - 4)) line(`  ${w}`); }
  L.push("");
  line(paint("dim", `  Best call window: ${callWindow(s.timezone).label}`));
  line(paint("dim", `  Source: ${e.source_op ?? "?"} · fetched ${new Date(e.fetched_at).toLocaleDateString()}`));
  if (notes) { L.push(""); line(paint("toolTitle", "  Notes")); for (const w of wrap(notes, width - 4).slice(0, 12)) line(`    ${w}`); }
  return L;
}

export function companyCard(e: EntityRow, width: number, paint: Paint = noPaint, notes?: string | null): string[] {
  const s = e.summary as CompanySummary;
  const L: string[] = [];
  const line = (t: string) => L.push(truncate(t, width));
  line(paint("accent", `▌ ${s.name ?? e.name ?? "(unknown)"}`) + paint("dim", `  ${s.domain ?? ""}`));
  line(`  ${[s.industry, s.hq, s.founded ? `founded ${String(s.founded).slice(0, 4)}` : undefined].filter(Boolean).join(" · ")}`);
  const trend = s.headcountHistory?.length ? sparkline(s.headcountHistory.map((h) => h.count)) : "";
  line(`  Headcount: ${s.headcount ?? "?"}${trend ? `  ${paint("success", trend)}` : ""}${s.openJobs ? paint("dim", ` · ${s.openJobs} open roles`) : ""}`);
  const f = s.latestFunding;
  if (f) line(`  Latest funding: ${f.stage ?? "?"}${f.amountUsd ? ` $${fmtMoney(f.amountUsd)}` : ""}${f.date ? ` (${f.date.slice(0, 10)})` : ""}${f.investors?.length ? paint("dim", ` · ${f.investors.join(", ")}`) : ""}`);
  if (s.totalFundingUsd) line(`  Total funding: $${fmtMoney(s.totalFundingUsd)}`);
  if (s.tech?.length) { L.push(""); for (const w of wrap(`Tech: ${s.tech.join(", ")}`, width - 4)) line(`  ${w}`); }
  if (s.description) { L.push(""); for (const w of wrap(s.description, width - 4).slice(0, 4)) line(paint("muted", `  ${w}`)); }
  if (s.linkedinUrl) line(paint("dim", `  ${s.linkedinUrl}`));
  line(paint("dim", `  Source: ${e.source_op ?? "?"} · fetched ${new Date(e.fetched_at).toLocaleDateString()}`));
  if (notes) { L.push(""); line(paint("toolTitle", "  Notes")); for (const w of wrap(notes, width - 4).slice(0, 12)) line(`    ${w}`); }
  return L;
}
