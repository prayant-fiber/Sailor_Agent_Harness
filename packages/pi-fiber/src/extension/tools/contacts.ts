import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Runtime } from "../runtime";
import { pickEntities, revealContacts, revealPlan, revealSummary, validateEmails, validatePlan } from "../actions";
import { ok, registerSailorTool } from "./common";

const Str = (d: string) => Type.Optional(Type.String({ description: d }));

export function registerContactTools(pi: ExtensionAPI, rt: Runtime): void {
  registerSailorTool(pi, rt, {
    name: "fiber_reveal_contacts",
    label: "Reveal contacts",
    lite: true,
    description: "Reveal emails/phones for people in a list or by entity id. Default = work email only (2 credits each, charged only when found); personal email +2; phone +3. Skips do-not-contact people and anyone with fresh cached contacts (free). >25 people run as a background batch job. Only call when the user asked for contact details.",
    parameters: Type.Object({
      list: Str("List id or name"),
      entityIds: Type.Optional(Type.Array(Type.String(), { description: "Specific entity ids (from list_show / resolve)" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, description: "Only the first N people of the list" })),
      status: Str("Only items with this status (e.g. new)"),
      workEmail: Type.Optional(Type.Boolean({ default: true })),
      personalEmail: Type.Optional(Type.Boolean({ default: false })),
      phone: Type.Optional(Type.Boolean({ default: false })),
    }),
    estimate: (i, r, id) => {
      const plan = revealPlan(r, pickEntities(r, i.list, i.entityIds, { status: i.status, limit: i.limit }), { workEmail: i.workEmail ?? true, personalEmail: i.personalEmail, phone: i.phone });
      r.plans.set(id, plan);
      return plan.todo.length ? { ...plan.estimate, basis: `${plan.estimate.basis}${plan.cached.length ? `; ${plan.cached.length} cached free` : ""}${plan.dnc.length ? `; ${plan.dnc.length} DNC skipped` : ""}` } : undefined;
    },
    async execute(p: any, _ctx, { toolCallId, signal, onUpdate }) {
      const plan = (rt.plans.get(toolCallId) as ReturnType<typeof revealPlan>) ?? revealPlan(rt, pickEntities(rt, p.list, p.entityIds, { status: p.status, limit: p.limit }), { workEmail: p.workEmail ?? true, personalEmail: p.personalEmail, phone: p.phone });
      const listId = p.list ? rt.store.getList(p.list)?.id : undefined;
      const out = await revealContacts(rt, plan, { listId, signal, onProgress: onUpdate });
      return ok(revealSummary(out) + (listId ? `\nSee them with list_show ${listId} fields=[name,company,email,phone].` : ""), out);
    },
  });

  registerSailorTool(pi, rt, {
    name: "fiber_validate_emails",
    label: "Validate emails",
    description: "Check deliverability of revealed emails (1 credit each; cached verdicts free). Verdicts: ok, risky (e.g. catch-all), undeliverable, inconclusive. Use before exporting to a sequencer.",
    parameters: Type.Object({
      list: Str("List id or name — validates unvalidated emails of its people"),
      entityIds: Type.Optional(Type.Array(Type.String())),
      emails: Type.Optional(Type.Array(Type.String(), { description: "Explicit email addresses" })),
    }),
    estimate: (i, r, id) => {
      const plan = i.emails?.length ? { emails: i.emails as string[], estimate: { credits: i.emails.length, basis: `${i.emails.length} × 1` } } : validatePlan(r, pickEntities(r, i.list, i.entityIds));
      r.plans.set(id, plan);
      return plan.emails.length ? plan.estimate : undefined;
    },
    async execute(p: any, _ctx, { toolCallId, signal }) {
      const plan = (rt.plans.get(toolCallId) as { emails: string[] }) ?? (p.emails?.length ? { emails: p.emails } : validatePlan(rt, pickEntities(rt, p.list, p.entityIds)));
      if (!plan.emails.length) return ok("No unvalidated emails found.");
      const res = await validateEmails(rt, plan.emails, signal);
      const counts: Record<string, number> = {};
      for (const r of res) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
      return ok(`Validated ${res.length} emails: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}.\n` + res.slice(0, 30).map((r: any) => `${r.email}: ${r.verdict}${r.catchAll ? " (catch-all)" : ""}${r.cached ? " [cached]" : ""}`).join("\n"), res);
    },
  });
}
