/**
 * Free, local tools behind the prospecting slash commands (FIB-20428).
 *  list_profile — compact profile of a list (titles, seniority, geos, industries, sizes, funding) for /qualify and /lookalikes
 *  list_score   — save AI fit scores (0-100 + reason) on list rows, optionally copy the qualified rows into a new list
 *  list_socials — social profiles (LinkedIn, X, GitHub, …) already in Sailor's store for a list
 *  list_dedupe  — drop rows of one list that already appear in another (lookalikes shouldn't repeat the seed list)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { asUntrusted } from "../../core/grounding";
import { extractSocials, narrowToQualified, profileList, saveScores, socialsLine } from "../../core/prospecting";
import type { Runtime } from "../runtime";
import { ok, registerSailorTool } from "./common";

export function registerProspectingTools(pi: ExtensionAPI, rt: Runtime): void {
  registerSailorTool(pi, rt, {
    name: "list_profile",
    label: "List profile",
    needsKey: false,
    description: "Summarize what a Sailor list looks like (local, free): top titles, seniority, companies, locations, industries, headcount, funding, tech, plus a sample of rows with entity ids. Use it to infer an ICP for lookalike searches or to calibrate qualification.",
    parameters: Type.Object({
      list: Type.String({ description: "List id or name" }),
      sample: Type.Optional(Type.Integer({ minimum: 0, maximum: 50, default: 15 })),
    }),
    async execute(p: any) {
      const prof = profileList(rt.store, p.list, p.sample ?? 15);
      return ok(asUntrusted("fiber", prof.text), { kind: prof.kind, size: prof.size });
    },
  });

  registerSailorTool(pi, rt, {
    name: "list_score",
    label: "Score list",
    needsKey: false,
    description: "Save qualification scores on rows of a Sailor list (local, free). score is 0-100 fit against the user's criteria; reason is one short, grounded sentence citing stored fields. Tier is derived (A ≥80, B ≥60, C ≥40, D <40) unless given. Send scores in batches of up to 50. Set narrowMinScore on the LAST batch to copy rows scoring at least that much into a new list, best first.",
    parameters: Type.Object({
      list: Type.String({ description: "List id or name" }),
      scores: Type.Array(Type.Object({
        entityId: Type.String(),
        score: Type.Number({ minimum: 0, maximum: 100 }),
        reason: Type.Optional(Type.String()),
      }), { maxItems: 100 }),
      narrowMinScore: Type.Optional(Type.Number({ minimum: 0, maximum: 100, description: "After saving, create a list of rows with score ≥ this" })),
      narrowName: Type.Optional(Type.String({ description: "Name for the qualified list" })),
    }),
    async execute(p: any) {
      const list = rt.store.getList(p.list);
      if (!list) throw new Error(`No list "${p.list}".`);
      const r = saveScores(rt.store, list.id, p.scores ?? []);
      const scored = rt.store.items(list.id, { withContacts: false }).filter((i) => i.score != null).length;
      let msg = `Saved ${r.updated} scores on "${list.name}" (${scored}/${list.size} rows scored).${r.missing.length ? ` Not on this list: ${r.missing.slice(0, 10).join(", ")}.` : ""}`;
      if (p.narrowMinScore !== undefined) {
        const n = narrowToQualified(rt.store, list.id, p.narrowMinScore, p.narrowName);
        msg += `\nQualified list "${n.listName}" (${n.listId}): ${n.kept} of ${n.total} rows scored ≥ ${p.narrowMinScore}. Open it with /list ${n.listId}.`;
      }
      return ok(msg);
    },
  });

  registerSailorTool(pi, rt, {
    name: "list_socials",
    label: "Socials",
    needsKey: false,
    description: "Social profiles (LinkedIn, X/Twitter, GitHub, Facebook, Instagram, personal site…) found in the Fiber data Sailor already stored for a list or entities (local, free). Rows with only LinkedIn may have more after a Kitchen Sink refresh (r in /list).",
    parameters: Type.Object({
      list: Type.Optional(Type.String()),
      entityIds: Type.Optional(Type.Array(Type.String())),
      limit: Type.Optional(Type.Integer({ minimum: 1, default: 50 })),
    }),
    async execute(p: any) {
      const ents = p.entityIds?.length
        ? p.entityIds.map((id: string) => rt.store.getEntity(id) ?? rt.store.findEntity(id)).filter(Boolean)
        : (() => { const l = p.list ? rt.store.getList(p.list) : undefined; if (!l) throw new Error("Give a list or entityIds."); return rt.store.items(l.id, { withContacts: false, limit: p.limit ?? 50 }).map((i) => i.entity!).filter(Boolean); })();
      const lines = ents.map((e: any) => `${e.id} · ${e.name ?? e.summary?.name ?? ""} · ${socialsLine(extractSocials(e)) || "(none stored)"}`);
      const withMore = ents.filter((e: any) => Object.keys(extractSocials(e)).some((k) => k !== "linkedin")).length;
      return ok(asUntrusted("fiber", lines.join("\n")) + `\n${withMore}/${ents.length} have socials beyond LinkedIn.`);
    },
  });

  registerSailorTool(pi, rt, {
    name: "list_dedupe",
    label: "Dedupe lists",
    needsKey: false,
    description: "Remove from `list` every row that is also in `against` (same person/company), e.g. drop the seed list's own rows from a lookalike search. Local, free.",
    parameters: Type.Object({ list: Type.String(), against: Type.String() }),
    async execute(p: any) {
      const a = rt.store.getList(p.list), b = rt.store.getList(p.against);
      if (!a || !b) throw new Error("Both lists must exist (list_all shows them).");
      const seen = new Set(rt.store.items(b.id, { withContacts: false }).map((i) => i.entity_id));
      const dupes = rt.store.items(a.id, { withContacts: false }).filter((i) => seen.has(i.entity_id)).map((i) => i.entity_id);
      const n = dupes.length ? rt.store.removeFromList(a.id, dupes) : 0;
      return ok(`Removed ${n} rows from "${a.name}" that were already in "${b.name}". ${rt.store.countItems(a.id)} rows left.`);
    },
  });
}
