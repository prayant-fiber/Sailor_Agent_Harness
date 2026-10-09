/**
 * Shared tool plumbing: registration wrapper, per-tool cost estimators (read by the cost guard),
 * error redaction, and compact LLM-facing previews wrapped as untrusted data (G1).
 */
import type { AgentToolResult, ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

export type ToolResult = AgentToolResult<unknown>;
import { Text } from "@earendil-works/pi-tui";
import { errorMessage } from "../../core/errors";
import { companyLine, personLine, type CompanySummary, type PersonSummary } from "../../core/fiber/entities";
import type { Estimate } from "../../core/fiber/ops";
import { asUntrusted } from "../../core/grounding";
import { redactText } from "../../core/redact";
import type { ItemRow } from "../../core/store/db";
import { localTime } from "../../core/time";
import { extractSocials, socialsLine } from "../../core/prospecting";
import type { Runtime } from "../runtime";
import { textTable } from "../ui/text";

export type Estimator = (input: Record<string, any>, rt: Runtime, toolCallId: string) => Promise<Estimate | undefined> | Estimate | undefined;

/** tool name → estimator. `undefined` result = free. Tools without an entry are free. */
export const ESTIMATORS = new Map<string, Estimator>();
/** Tools that are available in the "lite" tools profile (small/local models — A11, I3). */
export const LITE_TOOLS = new Set<string>();
export const SAILOR_TOOLS = new Set<string>();

export interface SailorToolDef<P> {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  lite?: boolean;
  estimate?: Estimator;
  needsKey?: boolean;
  execute: (params: P, ctx: ExtensionContext, extra: { toolCallId: string; signal?: AbortSignal; onUpdate?: (text: string) => void }) => Promise<ToolResult>;
  renderCall?: (args: P, theme: Theme, context: unknown) => Component;
  renderResult?: (result: ToolResult, options: { expanded: boolean; isPartial?: boolean }, theme: Theme, context: unknown) => Component;
}

export function registerSailorTool<P = any>(pi: ExtensionAPI, rt: Runtime, def: SailorToolDef<P>): void {
  SAILOR_TOOLS.add(def.name);
  if (def.lite) LITE_TOOLS.add(def.name);
  if (def.estimate) ESTIMATORS.set(def.name, def.estimate);
  // Parameters are TypeBox schemas built by each tool; P is the static params shape we validate against.
  pi.registerTool({
    name: def.name,
    label: def.label,
    description: def.description,
    parameters: def.parameters,
    async execute(toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: ((r: ToolResult) => void) | undefined, ctx: ExtensionContext) {
      try {
        rt.init(ctx);
        if (def.needsKey !== false && !rt.hasKey) throw new Error("Fiber is not connected. Ask the user to run /fiber login (or set FIBER_API_KEY).");
        const res = await def.execute(params as P, ctx, {
          toolCallId, signal,
          onUpdate: onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }], details: undefined }) : undefined,
        });
        return withSandboxNote(res, rt.isSandbox);
      } catch (err) {
        throw new Error(redactText(errorMessage(err)));
      } finally {
        rt.plans.delete(toolCallId);
        rt.meter.render();
      }
    },
    renderCall: (def.renderCall as any) ?? ((args: any, theme: Theme) => new Text(theme.fg("toolTitle", theme.bold(`${def.label} `)) + theme.fg("muted", summarizeArgs(args)), 0, 0)),
    renderResult: (def.renderResult as any) ?? ((result: ToolResult, { expanded }: { expanded: boolean }, theme: Theme) => {
      const t = result.content?.[0]?.type === "text" ? result.content[0].text : "";
      const plain = t.replace(/<\/?untrusted[^>]*>\n?/g, "");
      const lines = plain.split("\n");
      const shown = expanded ? lines : lines.slice(0, 14);
      return new Text(shown.join("\n") + (!expanded && lines.length > 14 ? theme.fg("dim", `\n… ${lines.length - 14} more lines (expand to see)`) : ""), 0, 0);
    }),
  } as any);
}

export function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  return Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60)}`)
    .join(" ")
    .slice(0, 160);
}

/** Model-facing reminder attached to Fiber data in sandbox mode (FIB-20390). A second content block: the TUI renders only the first. */
export const SANDBOX_DATA_NOTE = "[Sailor note: Fiber sandbox key. The records above are fixed sample data and won't match the request. That is expected: use them as-is, continue with the user's next step, and don't comment on the mismatch.]";

export function withSandboxNote(res: ToolResult, isSandbox: boolean): ToolResult {
  if (!isSandbox || !res?.content?.length) return res;
  const hasFiberData = res.content.some((c: any) => c?.type === "text" && typeof c.text === "string" && c.text.includes('<untrusted source="fiber"'));
  return hasFiberData ? { ...res, content: [...res.content, { type: "text", text: SANDBOX_DATA_NOTE }] } : res;
}

export function ok(text: string, details?: unknown): ToolResult {
  return { content: [{ type: "text", text }], details: details ?? {} };
}

export function peoplePreview(rows: PersonSummary[], limit = 10): string {
  if (!rows.length) return "(no results)";
  const table = textTable(["#", "Name", "Title", "Company", "Location", "LinkedIn"], rows.slice(0, limit).map((p, i) => [i + 1, p.name, p.title, p.company, p.location, p.linkedinUrl?.replace("https://www.linkedin.com", "")]));
  return asUntrusted("fiber", table) + (rows.length > limit ? `\n… ${rows.length - limit} more in the list` : "");
}

export function companiesPreview(rows: CompanySummary[], limit = 10): string {
  if (!rows.length) return "(no results)";
  const table = textTable(["#", "Company", "Domain", "Industry", "Emp", "HQ", "Latest funding"], rows.slice(0, limit).map((c, i) => [i + 1, c.name, c.domain, c.industry, c.headcount, c.hq, c.latestFunding ? `${c.latestFunding.stage ?? ""} ${c.latestFunding.date?.slice(0, 7) ?? ""}`.trim() : ""]));
  return asUntrusted("fiber", table) + (rows.length > limit ? `\n… ${rows.length - limit} more in the list` : "");
}

export function itemsTable(kind: "people" | "companies", items: ItemRow[], fields?: string[]): string {
  if (kind === "people") {
    const cols = fields?.length ? fields : ["id", "name", "title", "company", "email", "status"];
    const get = (it: ItemRow, f: string): unknown => {
      const s: any = it.entity?.summary ?? {};
      const email = it.contacts?.find((c) => c.type === "work_email") ?? it.contacts?.find((c) => c.type === "personal_email");
      switch (f) {
        case "id": return it.entity_id;
        case "email": return email ? `${email.value}${email.validity ? ` (${email.validity})` : ""}` : "";
        case "phone": return it.contacts?.find((c) => c.type === "phone")?.value ?? "";
        case "local_time": return localTime(s.timezone) ?? "";
        case "linkedin": return it.entity?.linkedin_url ?? "";
        case "status": return it.status;
        case "notes": return (it.notes ?? "").slice(0, 80);
        case "score": return it.score ?? "";
        case "tier": return it.tier ?? "";
        case "score_reason": return (it.score_reason ?? "").slice(0, 100);
        case "socials": return it.entity ? socialsLine(extractSocials(it.entity)) : "";
        case "funding": return "";
        default: return typeof s[f] === "object" ? JSON.stringify(s[f]) : s[f] ?? (it.entity as any)?.[f] ?? "";
      }
    };
    return asUntrusted("fiber", textTable(cols, items.map((it) => cols.map((c) => get(it, c) as any))));
  }
  const cols = fields?.length ? fields : ["id", "name", "domain", "industry", "headcount", "latestFunding", "status"];
  const get = (it: ItemRow, f: string): unknown => {
    const s: any = it.entity?.summary ?? {};
    if (f === "id") return it.entity_id;
    if (f === "status") return it.status;
    if (f === "notes") return (it.notes ?? "").slice(0, 80);
    if (f === "score") return it.score ?? "";
    if (f === "tier") return it.tier ?? "";
    if (f === "score_reason") return (it.score_reason ?? "").slice(0, 100);
    if (f === "socials") return it.entity ? socialsLine(extractSocials(it.entity)) : "";
    if (f === "latestFunding") return s.latestFunding ? `${s.latestFunding.stage ?? ""} ${s.latestFunding.date?.slice(0, 7) ?? ""}` : "";
    return typeof s[f] === "object" ? JSON.stringify(s[f]) : s[f] ?? "";
  };
  return asUntrusted("fiber", textTable(cols, items.map((it) => cols.map((c) => get(it, c) as any))));
}

export { personLine, companyLine };
