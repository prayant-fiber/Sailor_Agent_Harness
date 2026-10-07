import { existsSync, rmSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "../../core/errors";
import { getAccessToken, googleClientFromEnv } from "../../core/google/oauth";
import { parseSheetUrl, readSheet } from "../../core/google/sheets";
import { buildIdentity, detectColumns } from "../../core/io/columns";
import { readInputFile } from "../../core/io/files";
import { Store } from "../../core/store/db";
import { approveSpend } from "../costGuard";
import { pickEntities, resolvePlan, revealContacts, revealPlan, revealSummary, validateEmails, validatePlan } from "../actions";
import type { Runtime } from "../runtime";
import { ListPane, type PaneAction, type PaneState } from "../ui/listPane";
import { showText } from "../ui/textView";
import { doExport } from "../tools/export";
import { parseArgs } from "./args";

function say(ctx: ExtensionContext, msg: string, level: "info" | "warning" | "error" = "info") {
  if (ctx.hasUI) ctx.ui.notify(msg, level); else console.log(msg);
}

/** Opens the ListPane and runs returned actions (with cost approval) until the user closes it. */
export async function openListPane(rt: Runtime, ctx: ExtensionContext, listRef: string): Promise<void> {
  const list = rt.store.getList(listRef);
  if (!list) { say(ctx, `No list "${listRef}". /lists shows all lists.`, "error"); return; }
  if (!ctx.hasUI || ctx.mode !== "tui") {
    const items = rt.store.items(list.id, { limit: 50 });
    console.log(`${list.name} (${list.id}) — ${list.size} ${list.kind}`);
    for (const it of items) console.log(`${it.entity_id}\t${(it.entity?.summary as any)?.name ?? it.entity?.name ?? ""}\t${(it.entity?.summary as any)?.title ?? (it.entity?.summary as any)?.domain ?? ""}\t${it.status}`);
    return;
  }
  let state: PaneState | undefined;
  for (;;) {
    const action = await ctx.ui.custom<PaneAction>((tui, theme, _kb, done) => new ListPane(rt.store, rt.store.getList(list.id)!, theme, done, () => tui.requestRender(), state));
    state = action.state;
    if (action.action === "close") return;
    try {
      await runPaneAction(rt, ctx, list.id, list.kind, action);
    } catch (err) {
      say(ctx, errorMessage(err), "error");
    }
    rt.meter.render();
  }
}

async function runPaneAction(rt: Runtime, ctx: ExtensionContext, listId: string, kind: "people" | "companies", a: Exclude<PaneAction, { action: "close" }>): Promise<void> {
  const entities = pickEntities(rt, undefined, a.ids);
  if (!entities.length) return;
  if (a.action === "enrich") {
    const choice = await ctx.ui.select(`Reveal contacts for ${entities.length} ${entities.length === 1 ? "person" : "people"}`, ["Work email (2 cr each, if found)", "Work + personal email", "Work email + phone", "Everything (emails + phones, 5 cr)", "Cancel"]);
    if (!choice || choice === "Cancel") return;
    const types = choice.startsWith("Everything") ? { workEmail: true, personalEmail: true, phone: true }
      : choice.includes("personal") ? { workEmail: true, personalEmail: true } : choice.includes("phone") ? { workEmail: true, phone: true } : { workEmail: true };
    const plan = revealPlan(rt, entities, types);
    if (!plan.todo.length) { say(ctx, revealSummary({ revealed: 0, contactsFound: 0, cached: plan.cached.length, dnc: plan.dnc.length, missingId: plan.missingId.length, errors: [] })); return; }
    const ok = await approveSpend(rt, ctx, "Reveal contacts", plan.estimate);
    if (!ok.ok) { say(ctx, ok.reason, "warning"); return; }
    const out = await revealContacts(rt, plan, { listId, onProgress: (m) => ctx.ui.setStatus("sailor-progress", m) });
    ctx.ui.setStatus("sailor-progress", undefined);
    say(ctx, revealSummary(out));
  } else if (a.action === "validate") {
    const plan = validatePlan(rt, entities);
    if (!plan.emails.length) { say(ctx, "No unvalidated emails on the selected rows (reveal first with e)."); return; }
    const ok = await approveSpend(rt, ctx, "Validate emails", plan.estimate);
    if (!ok.ok) { say(ctx, ok.reason, "warning"); return; }
    const res = await validateEmails(rt, plan.emails);
    say(ctx, `Validated ${res.length}: ${res.filter((r: any) => r.verdict === "ok").length} ok, ${res.filter((r: any) => r.verdict === "risky").length} risky, ${res.filter((r: any) => r.verdict === "undeliverable").length} undeliverable.`);
  } else if (a.action === "resolve") {
    const plan = resolvePlan(rt, entities, kind);
    const ok = await approveSpend(rt, ctx, "Re-resolve with Kitchen Sink", plan.estimate);
    if (!ok.ok) { say(ctx, ok.reason, "warning"); return; }
    const r = await rt.gtm.bulkResolve(kind, plan.rows, { listId });
    say(ctx, `Kitchen Sink: ${r.found} resolved, ${r.notFound} not found.${r.errors.length ? ` Errors: ${r.errors.join("; ")}` : ""}`);
  } else if (a.action === "export" || a.action === "sheets") {
    const target = a.action === "sheets" ? "sheets" : ((await ctx.ui.select("Export format", ["csv", "xlsx", "sheets"])) as "csv" | "xlsx" | "sheets" | undefined);
    if (!target) return;
    const preset = (await ctx.ui.select("Column preset", ["raw", "outreach", "apollo", "hubspot", "salesloft", "instantly", "smartlead"])) as any;
    say(ctx, await doExport(rt, { list: listId, target, preset: preset ?? "raw", mode: target === "sheets" ? "upsert" : undefined }, (m) => ctx.ui.setStatus("sailor-progress", m)));
    ctx.ui.setStatus("sailor-progress", undefined);
  }
}

export function registerListCommands(pi: ExtensionAPI, rt: Runtime): void {
  pi.registerCommand("lists", {
    description: "Browse Sailor lists (pick one to open it)",
    handler: async (_args, ctx) => {
      rt.init(ctx);
      const lists = rt.store.lists();
      if (!lists.length) { say(ctx, "No lists yet — ask Sailor to find prospects, or /import-list csv <file>."); return; }
      if (!ctx.hasUI) { for (const l of lists) console.log(`${l.id}\t${l.name}\t${l.size} ${l.kind}`); return; }
      const labels = lists.map((l) => `${l.name} · ${l.size} ${l.kind} · ${l.id}`);
      const pick = await ctx.ui.select("Sailor lists", labels);
      if (pick) await openListPane(rt, ctx, lists[labels.indexOf(pick)].id);
    },
  });

  pi.registerCommand("list", {
    description: "Open a list in the interactive pane: /list <id|name>  (also: /list rename <id> <name> · /list delete <id>)",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args);
      if (a._[0] === "rename" && a._[1] && a._[2]) { rt.store.renameList(a._[1], a._.slice(2).join(" ")); say(ctx, "Renamed."); return; }
      if (a._[0] === "delete" && a._[1]) {
        const l = rt.store.getList(a._[1]);
        if (!l) { say(ctx, "No such list.", "error"); return; }
        if (ctx.hasUI && !(await ctx.ui.confirm(`Delete list "${l.name}"?`, `${l.size} rows. Entities and contacts stay in the local store.`))) return;
        rt.store.deleteList(l.id); say(ctx, `Deleted list "${l.name}".`); return;
      }
      const ref = a._.join(" ") || rt.store.lists()[0]?.id;
      if (!ref) { say(ctx, "No lists yet."); return; }
      await openListPane(rt, ctx, ref);
    },
  });

  pi.registerCommand("import-list", {
    description: "Import rows into a local list without spending credits: /import-list csv <file> [--name N] | /import-list sheets <url> [--name N]",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args);
      const [kind, src] = a._;
      try {
        let headers: string[], records: Record<string, string>[], label: string;
        if (kind === "sheets") {
          const ref = src ? parseSheetUrl(src) : undefined;
          if (!ref) throw new Error("Usage: /import-list sheets <google sheet url>");
          const token = await getAccessToken(googleClientFromEnv(rt.config.google.clientIdEnv, rt.config.google.clientSecretEnv));
          const s = await readSheet(token, ref);
          headers = s.headers; records = s.rows; label = s.title;
        } else {
          const path = src ? (isAbsolute(src) ? src : resolve(rt.cwd, src)) : "";
          if (!path || !existsSync(path)) throw new Error("Usage: /import-list csv <path to .csv/.tsv/.xlsx>");
          const f = await readInputFile(path);
          headers = f.table.headers; records = f.table.records; label = path.split(/[\\/]/).pop()!;
        }
        const cols = detectColumns(headers, records);
        const list = rt.store.createList(typeof a.flags.name === "string" ? a.flags.name : `Imported: ${label}`, cols.entityKind, `import:${label}`);
        rt.store.tx(() => records.forEach((r, i) => {
          const id = buildIdentity(r, cols);
          const e = cols.entityKind === "people"
            ? (id.linkedinUrl || id.email || id.name ? rt.store.upsertPerson({ name: id.name, title: id.title, company: id.company, companyDomain: id.domain, linkedinUrl: id.linkedinUrl, location: id.location }, null, "import", { email: id.email }) : rt.store.upsertUnresolved("person", { ...id }, `${list.id}:${i}`))
            : rt.store.upsertCompany({ name: id.company, domain: id.domain, linkedinUrl: id.companyLinkedin }, null, "import");
          if (id.email) rt.store.addContact(e.id, "work_email", id.email, null, "import");
          if (id.phone) rt.store.addContact(e.id, "phone", id.phone, null, "import");
          rt.store.addToList(list.id, e.id, { input: r, position: i });
        }));
        say(ctx, `Imported ${records.length} rows into "${list.name}" (${list.id}) as ${cols.entityKind}. Detected: ${Object.entries(cols.roles).map(([k, v]) => `${k}=${v}`).join(", ") || "no identifier columns"}. Nothing was charged; use /list ${list.id} then r to resolve, or /repair for Mosaic.`);
      } catch (err) { say(ctx, errorMessage(err), "error"); }
    },
  });

  pi.registerCommand("dnc", {
    description: "Do-not-contact list: /dnc add <email|domain|linkedin|phone>… [--reason R] | remove <value> | list",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args);
      const [sub, ...vals] = a._;
      if (sub === "add") { for (const v of vals) rt.store.addDnc(v, v.includes("@") ? "email" : /linkedin\.com/.test(v) ? "linkedin" : /^\+?[\d\s()-]{7,}$/.test(v) ? "phone" : "domain", typeof a.flags.reason === "string" ? a.flags.reason : undefined); say(ctx, `Added ${vals.length}.`); return; }
      if (sub === "remove") { for (const v of vals) rt.store.removeDnc(v); say(ctx, `Removed ${vals.length}.`); return; }
      const rows = rt.store.dncList();
      await showText(ctx, `Do-not-contact (${rows.length})`, rows.length ? rows.map((r) => `${r.kind.padEnd(9)} ${r.value}${r.reason ? `  — ${r.reason}` : ""}`) : ["(empty)"]);
    },
  });

  pi.registerCommand("forget", {
    description: "Delete a person/company and their contacts from the local store (GDPR/CCPA requests): /forget <id|email|linkedin>",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const ref = (args ?? "").trim();
      const e = ref ? rt.store.getEntity(ref) ?? rt.store.findEntity(ref) : undefined;
      if (!e) { say(ctx, "Not found.", "error"); return; }
      if (ctx.hasUI && !(await ctx.ui.confirm(`Forget ${e.name ?? e.id}?`, "Removes the entity, its contacts and list rows from the local Sailor store, and adds them to do-not-contact."))) return;
      if (e.email) rt.store.addDnc(e.email, "email", "forget request");
      if (e.linkedin_url) rt.store.addDnc(e.linkedin_url, "linkedin", "forget request");
      rt.store.forgetEntity(e.id);
      say(ctx, `Forgot ${e.name ?? e.id}. (Fiber-side data is governed by Fiber; contact privacy@fiber.ai for upstream requests.)`);
    },
  });

  pi.registerCommand("wipe", {
    description: "Delete the local Sailor database (lists, contacts, cache, ledger)",
    handler: async (_args, ctx) => {
      rt.init(ctx);
      const path = rt.store.path;
      if (!ctx.hasUI || !(await ctx.ui.confirm("Wipe all local Sailor data?", `${path}\nThis cannot be undone. Fiber credits and your API key are not affected.`))) return;
      rt.shutdown();
      rt.store.close();
      for (const p of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(p)) rmSync(p);
      (rt as any).store = new Store(path);
      (rt as any).initialised = false;
      rt.init(ctx);
      say(ctx, "Local Sailor data wiped.");
    },
  });
}
