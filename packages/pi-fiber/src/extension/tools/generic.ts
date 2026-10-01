import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { fetchOpDoc, loadCatalog, searchCatalog, type CatalogEntry } from "../../core/fiber/catalog";
import { getOp, unknownOp } from "../../core/fiber/ops";
import { asUntrusted } from "../../core/grounding";
import type { Runtime } from "../runtime";
import { ok, registerSailorTool } from "./common";

const catalogIndex = new Map<string, CatalogEntry>();

async function catalogEntry(rt: Runtime, opId: string): Promise<CatalogEntry | undefined> {
  if (!catalogIndex.size) for (const e of await loadCatalog(rt.config.fiber.baseUrl)) catalogIndex.set(e.opId.toLowerCase(), e);
  return catalogIndex.get(opId.toLowerCase());
}

export function registerGenericTools(pi: ExtensionAPI, rt: Runtime): void {
  registerSailorTool(pi, rt, {
    name: "fiber_find_operation",
    label: "Find Fiber op",
    needsKey: false,
    description: "Search Fiber's full catalog of 200+ API operations (company intel, talent flow, job changes, tracker, audiences, social, Google Maps…) by intent. Free. Use when no dedicated Sailor tool fits; then read fiber_operation_docs and call fiber_call.",
    parameters: Type.Object({ query: Type.String({ description: "What you want to do, e.g. 'talent flow rivals' or 'job postings'" }) }),
    async execute(p: any) {
      const entries = await loadCatalog(rt.config.fiber.baseUrl);
      for (const e of entries) catalogIndex.set(e.opId.toLowerCase(), e);
      const hits = searchCatalog(entries, p.query);
      if (!hits.length) return ok("No matching operations.");
      return ok(hits.map((e) => `${e.opId} · ${e.method} ${e.path} · ${e.summary} [${e.section}]${getOp(e.opId)?.paid === false ? " · free" : ""}`).join("\n"));
    },
  });

  registerSailorTool(pi, rt, {
    name: "fiber_operation_docs",
    label: "Fiber op docs",
    needsKey: false,
    description: "Read the agent docs for one Fiber operation (request schema, cost, rate limit, examples). Free.",
    parameters: Type.Object({ operationId: Type.String() }),
    async execute(p: any) {
      return ok(asUntrusted("api.fiber.ai", await fetchOpDoc(p.operationId, rt.config.fiber.baseUrl)));
    },
  });

  registerSailorTool(pi, rt, {
    name: "fiber_call",
    label: "Fiber call",
    description: "Call any Fiber operation by operationId with a JSON body (the API key is added automatically — never include it). Paid calls go through the cost guard; unknown costs always ask the user. Money movement and account operations are blocked. Read fiber_operation_docs first for the exact body.",
    parameters: Type.Object({
      operationId: Type.String(),
      args: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Request body / query / path params" })),
    }),
    estimate: async (i, r) => {
      const meta = getOp(i.operationId) ?? unknownOp(i.operationId);
      if (meta.deny) return { credits: 0, basis: "", blockReason: `${meta.opId} is blocked by Sailor policy (money movement / account signup is never done by the agent). The user can do it in the Fiber dashboard.` };
      if (meta.admin && !r.adminMode) return { credits: 0, basis: "", blockReason: `${meta.opId} changes API-key settings; the user must enable /fiber admin on first.` };
      if (!meta.paid) return undefined;
      return meta.estimate?.(i.args ?? {}, r.pricing) ?? { credits: 0, basis: "unknown cost", uncertain: true };
    },
    async execute(p: any, _ctx, { signal }) {
      const known = getOp(p.operationId);
      const cat = known ? undefined : await catalogEntry(rt, p.operationId);
      if (!known && !cat) throw new Error(`Unknown operation ${p.operationId}. Use fiber_find_operation.`);
      const r = await rt.client.call(known?.opId ?? cat!.opId, p.args ?? {}, { signal, method: cat?.method, path: cat?.path, allowAdmin: rt.adminMode });
      const body = JSON.stringify(r.output ?? r, null, 1);
      const trimmed = body.length > 20_000 ? `${body.slice(0, 20_000)}\n… (truncated ${body.length - 20_000} chars)` : body;
      return ok(asUntrusted("fiber", trimmed), { chargeInfo: r.chargeInfo });
    },
  });

  registerSailorTool(pi, rt, {
    name: "fiber_tracker",
    label: "Signals tracker",
    description: "Monitor companies for signals (funding, hiring, headcount changes…) with Fiber Tracker. Actions: rules (list available rules, free), create (company list with rules, free), add (companies by domain/LinkedIn, free), refresh (2 credits per tracked company), signals (read fired signals, free), lists (free).",
    parameters: Type.Object({
      action: StringEnum(["rules", "lists", "create", "add", "refresh", "signals"] as const),
      listId: Type.Optional(Type.String({ description: "Tracker list id" })),
      name: Type.Optional(Type.String()),
      rules: Type.Optional(Type.Array(Type.Any(), { description: "Rule configs from action=rules" })),
      companies: Type.Optional(Type.Array(Type.Any(), { description: "Companies to add (see fiber_operation_docs addTrackerCompanies)" })),
      entityCount: Type.Optional(Type.Integer({ description: "Tracked companies (for the refresh estimate)" })),
    }),
    estimate: (i, r) => (i.action === "refresh" ? r.gtm.estimate("refreshTrackerCompanyList", { __entityCount: i.entityCount }) : undefined),
    async execute(p: any, _ctx, { signal }) {
      const map: Record<string, [string, Record<string, unknown>]> = {
        rules: ["listAvailableTrackerRules", {}],
        lists: ["listTrackerCompanyLists", {}],
        create: ["createTrackerCompanyList", { name: p.name, rules: p.rules }],
        add: ["addTrackerCompanies", { listId: p.listId, companies: p.companies }],
        refresh: ["refreshTrackerCompanyList", { listId: p.listId }],
        signals: ["listTrackerSignals", { listId: p.listId }],
      };
      const [op, args] = map[p.action];
      const cat = getOp(op) ? undefined : await catalogEntry(rt, op);
      const r = await rt.client.call(op, args, { signal, method: cat?.method, path: cat?.path });
      return ok(asUntrusted("fiber", JSON.stringify(r.output ?? r, null, 1).slice(0, 15_000)));
    },
  });
}
