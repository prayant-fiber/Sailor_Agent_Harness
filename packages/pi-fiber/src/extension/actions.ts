/**
 * Shared GTM actions used by tools, slash commands and pane keys (one code path, one cost policy).
 */
import { OutOfCreditsError, errorMessage } from "../core/errors";
import type { Estimate } from "../core/fiber/ops";
import { identityFromEntity, toContactTypes, type ContactTypes } from "../core/gtm";
import type { BatchContactParams } from "../core/repair/engine";
import type { EntityRow, ListKind } from "../core/store/db";
import type { Runtime } from "./runtime";

export const SYNC_REVEAL_MAX = 25;

export interface RevealOutcome { revealed: number; contactsFound: number; cached: number; dnc: number; missingId: number; jobId?: string; stoppedReason?: string; errors: string[] }

export function revealPlan(rt: Runtime, entities: EntityRow[], types: ContactTypes | undefined) {
  const plan = rt.gtm.planReveal(entities, types);
  const mode: "sync" | "batch" = plan.todo.length > SYNC_REVEAL_MAX ? "batch" : "sync";
  return { ...plan, mode };
}

export async function revealContacts(rt: Runtime, plan: ReturnType<typeof revealPlan>, opts: { listId?: string; signal?: AbortSignal; onProgress?: (msg: string) => void }): Promise<RevealOutcome> {
  const out: RevealOutcome = { revealed: 0, contactsFound: 0, cached: plan.cached.length, dnc: plan.dnc.length, missingId: plan.missingId.length, errors: [] };
  if (!plan.todo.length) return out;
  if (plan.mode === "batch") {
    const byUrl: Record<string, string> = {};
    for (const e of plan.todo) byUrl[e.linkedin_url!] = e.id;
    const urls = Object.keys(byUrl);
    const jobIds: string[] = [];
    for (let i = 0; i < urls.length; i += 2000) {
      const chunk = urls.slice(i, i + 2000);
      const r = await rt.client.call("startBatchContactDetails", { personDetails: chunk.map((u) => ({ linkedinUrl: { value: u } })), enrichmentTypes: plan.types }, { signal: opts.signal });
      const taskId = r.output?.taskId;
      const params: BatchContactParams = { listId: opts.listId, byUrl: Object.fromEntries(chunk.map((u) => [u, byUrl[u]])), cursor: null, types: plan.types, count: chunk.length };
      const job = rt.store.createJob({ kind: "batch_contacts", op: "startBatchContactDetails", remoteId: taskId, status: "running", params, listId: opts.listId, nextPollAt: Date.now() + rt.config.jobs.pollIntervalMs });
      jobIds.push(job.id);
    }
    out.jobId = jobIds.join(",");
    out.revealed = urls.length;
    rt.meter.render();
    return out;
  }
  for (const [i, e] of plan.todo.entries()) {
    try {
      const n = await rt.gtm.revealOne(e, plan.types, opts.signal);
      out.revealed++;
      out.contactsFound += n;
      if (opts.listId) rt.store.setItemStatus(opts.listId, e.id, "enriched");
      opts.onProgress?.(`revealed ${i + 1}/${plan.todo.length}`);
    } catch (err) {
      if (err instanceof OutOfCreditsError) { out.stoppedReason = err.message; break; }
      out.errors.push(`${e.name ?? e.id}: ${errorMessage(err)}`);
      if ((err as any)?.code === "UNKNOWN_OUTCOME") { out.stoppedReason = errorMessage(err); break; }
    }
  }
  return out;
}

export function revealSummary(o: RevealOutcome): string {
  const parts = [
    o.jobId ? `Started batch reveal job ${o.jobId} for ${o.revealed} people (results stream into the list; check /jobs).` : `Revealed ${o.revealed} people → ${o.contactsFound} contact points.`,
    o.cached ? `${o.cached} already had fresh contacts (not charged).` : "",
    o.dnc ? `${o.dnc} skipped: do-not-contact.` : "",
    o.missingId ? `${o.missingId} skipped: no LinkedIn URL (resolve them first with fiber_resolve_person or /repair).` : "",
    o.stoppedReason ? `Stopped early: ${o.stoppedReason}` : "",
    o.errors.length ? `Errors: ${o.errors.slice(0, 5).join("; ")}` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

export function validatePlan(rt: Runtime, entities: EntityRow[]): { emails: string[]; estimate: Estimate } {
  const emails = new Set<string>();
  for (const e of entities) for (const c of rt.store.contacts(e.id)) if (c.type !== "phone" && (!c.validity || c.validity === "unknown")) emails.add(c.value);
  const list = [...emails];
  return { emails: list, estimate: { credits: list.length, basis: `${list.length} emails × 1 (cached verdicts are free)` } };
}

export async function validateEmails(rt: Runtime, emails: string[], signal?: AbortSignal) {
  const results = [];
  for (const em of emails) {
    try { results.push(await rt.gtm.validateEmail(em, signal)); }
    catch (err) { if (err instanceof OutOfCreditsError) break; results.push({ email: em, verdict: `error: ${errorMessage(err)}` } as any); }
  }
  return results;
}

export function resolvePlan(rt: Runtime, entities: EntityRow[], kind: ListKind): { rows: { identity: ReturnType<typeof identityFromEntity>; input: Record<string, string> }[]; estimate: Estimate } {
  const rows = entities.map((e) => ({ identity: identityFromEntity(e), input: {} as Record<string, string> }));
  const per = kind === "people" ? 2 : 2;
  return { rows, estimate: { credits: rows.length * per, basis: `${rows.length} × ${per} (Kitchen Sink bulk)` } };
}

export function pickEntities(rt: Runtime, listId: string | undefined, ids: string[] | undefined, opts: { status?: string; limit?: number } = {}): EntityRow[] {
  if (ids?.length) return ids.map((id) => rt.store.getEntity(id) ?? rt.store.findEntity(id)).filter((e): e is EntityRow => !!e);
  if (!listId) return [];
  const list = rt.store.getList(listId);
  if (!list) throw new Error(`No list "${listId}". Use list_all to see lists.`);
  return rt.store.items(list.id, { status: opts.status as any, limit: opts.limit, withContacts: false }).map((i) => i.entity!).filter(Boolean);
}

export { toContactTypes };
