import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { Estimate } from "../../core/fiber/ops";
import { preflight, preflightCard, runKitchenSinkRepair, startMosaicRuns, type Preflight, type RepairOptions } from "../../core/repair/engine";
import type { Runtime } from "../runtime";
import { pickEntities, revealContacts, revealPlan, revealSummary } from "../actions";
import { ok, registerSailorTool } from "./common";

const Str = (d: string) => Type.Optional(Type.String({ description: d }));

export function repairOptionsFrom(p: any): RepairOptions {
  return {
    contacts: { workEmail: !!p.workEmail, personalEmail: !!p.personalEmail, phone: !!p.phone },
    includeCompanyDetails: !!p.includeCompanyDetails,
    liveFetch: p.liveFetch,
    runRedline: !!p.redline,
    maxRows: p.maxRows,
    customInstructions: p.instructions,
    engine: p.engine ?? "auto",
    listName: p.list,
    sourceUrl: p.sourceUrl,
    sheet: p.sheet,
  };
}

/** Why a preflight cannot run yet (so the guard does not ask for money we will not spend). */
export function blocker(rt: Runtime, pre: Preflight): string | undefined {
  if (pre.rowCount === 0 && pre.sourceType !== "sheet") return "The file has no data rows.";
  if (pre.sourceType === "sheet" && pre.warnings.some((w) => w.includes("not public"))) return pre.warnings.find((w) => w.includes("not public"));
  if (pre.engine === "mosaic" && pre.sourceType === "file" && !pre.options.sourceUrl && rt.config.hosting.provider === "manual")
    return "Mosaic needs a public HTTPS URL for this file. Either (a) pass sourceUrl (e.g. a Google Sheet shared 'anyone with link', or a presigned link), or (b) configure hosting once with `/repair hosting gdrive` (needs /sheets connect) or `/repair hosting s3`. Files ≤ 50 rows use Kitchen Sink and need no hosting.";
  return undefined;
}

export function repairEstimate(rt: Runtime, pre: Preflight): Estimate {
  const uploads = pre.engine === "mosaic" && pre.sourceType === "file" && !pre.options.sourceUrl;
  return {
    ...pre.estimate,
    basis: `${pre.estimate.basis}${uploads ? ` · the file (contains personal data) will be uploaded to ${rt.config.hosting.provider} with a temporary public link that Sailor revokes once Mosaic starts` : ""}`,
    forceConfirm: uploads || pre.estimate.forceConfirm,
  };
}

export function registerRepairTools(pi: ExtensionAPI, rt: Runtime): void {
  registerSailorTool(pi, rt, {
    name: "fiber_repair_list",
    label: "Repair list",
    lite: true,
    description: "Clean, resolve and enrich a messy contact/company list (CSV, TSV, XLSX, public URL, or Google Sheet). Parses locally, detects columns, then uses Kitchen Sink bulk (≤50 rows, sync) or Mosaic (async job, up to 20k rows per run) and imports results into a Sailor list. Set preview=true first to show the user the pre-flight card (free). Contact reveal flags default OFF.",
    parameters: Type.Object({
      source: Type.String({ description: "Path to a local file, a public HTTPS file URL, or a Google Sheet URL" }),
      preview: Type.Optional(Type.Boolean({ description: "Only analyse the file and show the plan + estimate (free)", default: false })),
      workEmail: Type.Optional(Type.Boolean({ default: false })),
      personalEmail: Type.Optional(Type.Boolean({ default: false })),
      phone: Type.Optional(Type.Boolean({ default: false })),
      includeCompanyDetails: Type.Optional(Type.Boolean({ default: false })),
      liveFetch: Type.Optional(Type.Boolean({ description: "Mosaic default true; Kitchen Sink default false (+2/row)" })),
      redline: Type.Optional(Type.Boolean({ description: "Mosaic: compare output against input columns", default: false })),
      maxRows: Type.Optional(Type.Integer({ minimum: 1, maximum: 20000 })),
      instructions: Str("Extra guidance for Mosaic's AI (e.g. 'company column contains brand names')"),
      engine: Type.Optional(StringEnum(["auto", "kitchen-sink", "mosaic"] as const)),
      list: Str("Name for the resulting list"),
      sourceUrl: Str("Public HTTPS URL of the same file (manual hosting for Mosaic)"),
      sheet: Str("XLSX sheet name (default: first sheet)"),
    }),
    estimate: async (i, r, id) => {
      if (i.preview) return undefined;
      const src = /^https?:/i.test(i.source) || isAbsolute(i.source) ? i.source : resolve(r.cwd, i.source);
      const pre = await preflight(src, repairOptionsFrom(i), { pricing: r.pricing, store: r.store });
      r.plans.set(id, pre);
      if (blocker(r, pre)) return undefined;
      return repairEstimate(r, pre);
    },
    async execute(p: any, _ctx, { toolCallId, signal, onUpdate }) {
      const src = /^https?:/i.test(p.source) || isAbsolute(p.source) ? p.source : resolve(rt.cwd, p.source);
      const pre = (rt.plans.get(toolCallId) as Preflight) ?? (await preflight(src, repairOptionsFrom(p), { pricing: rt.pricing, store: rt.store }));
      const card = preflightCard(pre);
      if (p.preview) return ok(`${card}\n\nNothing was charged. Ask the user to confirm options, then call again without preview.`, { preflight: { ...pre, table: undefined, identities: undefined } });
      const block = blocker(rt, pre);
      if (block) return ok(`${card}\n\nCannot run yet: ${block}`);
      if (pre.engine === "kitchen-sink") {
        const res = await runKitchenSinkRepair(pre, rt.gtm, { signal, onProgress: (d, t) => onUpdate?.(`resolved ${d}/${t}`) });
        let text = `${card}\n\nKitchen Sink: ${res.found} resolved, ${res.notFound} not found, ${res.skipped} skipped (no usable identifier). List "${res.listName}" (id: ${res.listId}).${res.errors.length ? `\nErrors: ${res.errors.join("; ")}` : ""}`;
        const c = pre.options.contacts;
        if (c?.workEmail || c?.personalEmail || c?.phone) {
          const plan = revealPlan(rt, pickEntities(rt, res.listId, undefined, { status: "enriched" }), c);
          const out = await revealContacts(rt, plan, { listId: res.listId, signal, onProgress: onUpdate });
          text += `\n${revealSummary(out)}`;
        }
        return ok(`${text}\nOpen with /list ${res.listId}; export with /export-list.`, res);
      }
      try {
        const jobs = await startMosaicRuns(pre, { client: rt.client, store: rt.store, config: rt.config, signal });
        rt.meter.render();
        return ok(`${card}\n\nStarted ${jobs.length} Mosaic run(s): ${jobs.map((j) => `${j.id} (run ${j.remote_id})`).join(", ")}. Sailor polls every 30s, downloads the healed CSV next to the original as soon as it's ready, and imports it into list "${pre.options.listName ?? `Repaired: ${pre.fileName}`}". The user can keep working; progress is in the footer and /jobs.`, { jobs: jobs.map((j) => j.id) });
      } catch (err) {
        if ((err as Error).message === "MANUAL_URL_REQUIRED") return ok(`${card}\n\nCannot run yet: ${blocker(rt, { ...pre, options: { ...pre.options, sourceUrl: undefined } }) ?? "hosting not configured"}`);
        throw err;
      }
    },
  });
}
