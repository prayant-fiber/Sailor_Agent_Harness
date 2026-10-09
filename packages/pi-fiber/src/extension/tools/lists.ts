import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { checkGrounding, asUntrusted } from "../../core/grounding";
import type { ItemStatus } from "../../core/store/db";
import { callWindow } from "../../core/time";
import type { Runtime } from "../runtime";
import { companyCard, personCard } from "../ui/cards";
import { itemsTable, ok, registerSailorTool } from "./common";

const Str = (d: string) => Type.Optional(Type.String({ description: d }));
const STATUSES = ["new", "enriched", "contacted", "excluded", "not_found", "error"] as const;

export function registerListTools(pi: ExtensionAPI, rt: Runtime): void {
  registerSailorTool(pi, rt, {
    name: "list_all",
    label: "Lists",
    lite: true,
    needsKey: false,
    description: "Show all Sailor lists (local, free) with size and kind.",
    parameters: Type.Object({}),
    async execute() {
      const lists = rt.store.lists();
      if (!lists.length) return ok("No lists yet. Search, resolve or /repair to create one.");
      return ok(lists.map((l) => `${l.id} · "${l.name}" · ${l.size} ${l.kind} · updated ${new Date(l.updated_at).toLocaleString()}`).join("\n"));
    },
  });

  registerSailorTool(pi, rt, {
    name: "list_show",
    label: "Show list",
    lite: true,
    needsKey: false,
    description: "Read rows of a Sailor list (local, free). Use `fields` to fetch only what you need, e.g. people: id,name,title,company,email,phone,linkedin,local_time,tenureMonths,location,status,notes,score,tier,score_reason,socials; companies: id,name,domain,industry,headcount,latestFunding,tech,hq,status,score,tier,score_reason.",
    parameters: Type.Object({
      list: Type.String({ description: "List id or name" }),
      fields: Type.Optional(Type.Array(Type.String())),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 25 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
      status: Type.Optional(StringEnum(STATUSES)),
      search: Str("Substring filter"),
    }),
    async execute(p: any) {
      const list = rt.store.getList(p.list);
      if (!list) throw new Error(`No list "${p.list}".`);
      const items = rt.store.items(list.id, { limit: p.limit ?? 25, offset: p.offset ?? 0, status: p.status, search: p.search });
      const total = rt.store.countItems(list.id, p.status);
      return ok(`"${list.name}" (${list.id}) · ${list.kind} · showing ${items.length ? (p.offset ?? 0) + 1 : 0}-${(p.offset ?? 0) + items.length} of ${total}\n${itemsTable(list.kind, items, p.fields)}`);
    },
  });

  registerSailorTool(pi, rt, {
    name: "entity_get",
    label: "Entity",
    needsKey: false,
    description: "Full stored facts for one person/company (local, free): role, tenure, history, education, contacts with validity, funding, headcount trend, tech, local time and best call window. Use these facts — and only these — when writing personalized scripts; cite them as [field.path].",
    parameters: Type.Object({ id: Type.String({ description: "Entity id, LinkedIn URL, email or domain" }) }),
    async execute(p: any) {
      const e = rt.store.getEntity(p.id) ?? rt.store.findEntity(p.id);
      if (!e) throw new Error(`No stored entity "${p.id}".`);
      const contacts = rt.store.contacts(e.id);
      const card = e.kind === "person" ? personCard(e, contacts, 100) : companyCard(e, 100);
      const facts = { ...(e.summary as object), contacts: contacts.map((c) => ({ type: c.type, value: c.value, validity: c.validity })), callWindow: e.kind === "person" ? callWindow((e.summary as any).timezone).label : undefined };
      return ok(`${asUntrusted("fiber", card.join("\n"))}\nfacts (cite as [path]): ${JSON.stringify(facts)}`, { entity: e, contacts });
    },
  });

  registerSailorTool(pi, rt, {
    name: "list_create",
    label: "Create list",
    needsKey: false,
    description: "Create an empty Sailor list (local, free).",
    parameters: Type.Object({ name: Type.String(), kind: StringEnum(["people", "companies"] as const) }),
    async execute(p: any) {
      const l = rt.store.createList(p.name, p.kind, "manual");
      return ok(`Created list "${l.name}" (id: ${l.id}).`);
    },
  });

  registerSailorTool(pi, rt, {
    name: "list_add",
    label: "Add to list",
    needsKey: false,
    description: "Add stored entities (by id) to a list (local, free).",
    parameters: Type.Object({ list: Type.String(), entityIds: Type.Array(Type.String()) }),
    async execute(p: any) {
      const l = rt.store.getList(p.list);
      if (!l) throw new Error(`No list "${p.list}".`);
      let n = 0;
      for (const id of p.entityIds) { const e = rt.store.getEntity(id); if (e) { rt.store.addToList(l.id, e.id); n++; } }
      return ok(`Added ${n} to "${l.name}".`);
    },
  });

  registerSailorTool(pi, rt, {
    name: "list_remove",
    label: "Remove from list",
    needsKey: false,
    description: "Remove entities from a list (local, free).",
    parameters: Type.Object({ list: Type.String(), entityIds: Type.Array(Type.String()) }),
    async execute(p: any) {
      const l = rt.store.getList(p.list);
      if (!l) throw new Error(`No list "${p.list}".`);
      return ok(`Removed ${rt.store.removeFromList(l.id, p.entityIds)} from "${l.name}".`);
    },
  });

  registerSailorTool(pi, rt, {
    name: "list_set_notes",
    label: "Save notes",
    needsKey: false,
    description: "Save generated content (call script, email, account plan) as the notes of a list row (local, free). Scripts are checked for grounding: every [citation] must exist in the entity's stored facts; unknown citations are reported so you can fix them.",
    parameters: Type.Object({ list: Type.String(), entityId: Type.String(), notes: Type.String() }),
    async execute(p: any) {
      const l = rt.store.getList(p.list);
      const e = rt.store.getEntity(p.entityId);
      if (!l || !e) throw new Error("Unknown list or entity.");
      const report = checkGrounding(p.notes, { ...(e.summary as object), contacts: rt.store.contacts(e.id) });
      rt.store.setItemNotes(l.id, e.id, p.notes);
      return ok(`Saved notes for ${e.name ?? e.id}. Citations: ${report.citations.length}${report.unknown.length ? ` · UNGROUNDED citations (not in stored facts, fix or mark [unverified]): ${report.unknown.join(", ")}` : " · all grounded"}${report.unverified ? ` · ${report.unverified} [unverified] claims` : ""}.`, report);
    },
  });

  registerSailorTool(pi, rt, {
    name: "list_set_status",
    label: "Set status",
    needsKey: false,
    description: "Set row status (new, enriched, contacted, excluded) for entities in a list (local, free). 'excluded' also adds them to the do-not-contact list.",
    parameters: Type.Object({ list: Type.String(), entityIds: Type.Array(Type.String()), status: StringEnum(STATUSES) }),
    async execute(p: any) {
      const l = rt.store.getList(p.list);
      if (!l) throw new Error(`No list "${p.list}".`);
      for (const id of p.entityIds) {
        rt.store.setItemStatus(l.id, id, p.status as ItemStatus);
        if (p.status === "excluded") {
          const e = rt.store.getEntity(id);
          if (e?.linkedin_url) rt.store.addDnc(e.linkedin_url, "linkedin", "excluded");
          if (e?.email) rt.store.addDnc(e.email, "email", "excluded");
        }
      }
      return ok(`Updated ${p.entityIds.length} row(s) to ${p.status}.`);
    },
  });

  registerSailorTool(pi, rt, {
    name: "dnc_add",
    label: "Do not contact",
    needsKey: false,
    description: "Add emails, domains, LinkedIn URLs or phones to the local do-not-contact list. Suppressed entries are skipped by reveals and exports.",
    parameters: Type.Object({ values: Type.Array(Type.String()), reason: Str("Why (opt-out, customer, competitor…)") }),
    async execute(p: any) {
      for (const v of p.values) {
        const kind = v.includes("@") ? "email" : /linkedin\.com/i.test(v) ? "linkedin" : /^\+?[\d\s()-]{7,}$/.test(v) ? "phone" : "domain";
        rt.store.addDnc(v, kind, p.reason);
      }
      return ok(`Added ${p.values.length} value(s) to do-not-contact.`);
    },
  });
}
