/**
 * /crm — link a CRM and export Sailor lists to it over the CRM's own MCP server (FIB-20427).
 *   /crm                         status + picker
 *   /crm connect <hubspot|salesforce|attio|custom> [url]
 *   /crm export [list] [--min-score N]
 *   /crm disconnect
 * Tools: crm_export_rows (CRM-ready rows, paged, DNC removed) and crm_mark_exported (records the export).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, saveGlobalConfig } from "../../core/config";
import { CRM_IDS, CRMS, crmRows, isCrmId, type CrmConfig, type CrmId } from "../../core/crm";
import { errorMessage } from "../../core/errors";
import { getSecret, setSecret } from "../../core/secrets";
import type { Runtime } from "../runtime";
import { ok, registerSailorTool } from "../tools/common";
import { showText } from "../ui/textView";
import { flagNum, parseArgs } from "./args";
import { resolveListArg } from "./prospecting";

const HUBSPOT_SECRET = "crm:hubspot:client_secret";

function say(ctx: ExtensionContext, msg: string, level: "info" | "warning" | "error" = "info") {
  if (ctx.hasUI) ctx.ui.notify(msg, level); else console.log(msg);
}

/** Registers the configured CRM's MCP server with Pi for this session. Returns the server name, if any. */
export function registerCrmServer(pi: ExtensionAPI, cfg: CrmConfig | undefined): string | undefined {
  const reg = (pi as any).registerMcpServer as ((name: string, c: unknown) => void) | undefined;
  if (!cfg?.provider || !isCrmId(cfg.provider) || !reg) return undefined;
  const info = CRMS[cfg.provider];
  const entry = info.entry(cfg, { hubspotClientSecret: cfg.provider === "hubspot" ? getSecret(HUBSPOT_SECRET)?.value : undefined });
  if (!entry) return undefined;
  reg.call(pi, info.server, entry);
  return info.server;
}

function unregisterCrmServer(pi: ExtensionAPI, cfg: CrmConfig | undefined): void {
  if (!cfg?.provider || !isCrmId(cfg.provider)) return;
  try { (pi as any).unregisterMcpServer?.(CRMS[cfg.provider].server); } catch { /* not registered */ }
}

export const crmExportBrief = (crm: CrmId, listId: string, listName: string, total: number, minScore?: number) => [
  `/crm export — push list "${listName}" (${listId}) to ${CRMS[crm].label}${minScore !== undefined ? ` (rows with fit score ≥ ${minScore})` : ""}. ${total} rows are eligible (do-not-contact rows are already removed).`,
  `1. Page through crm_export_rows list=${listId}${minScore !== undefined ? ` minScore=${minScore}` : ""} (25 at a time). Only use fields that are present; never invent values.`,
  `2. Write each batch with the ${CRMS[crm].label} MCP tools (mcp__${CRMS[crm].server}__…). ${CRMS[crm].agentHints}`,
  "3. If a tool says you're not signed in, stop and tell me to run /mcp login " + CRMS[crm].server + ". If a field is rejected, skip that field (keep it in a note) rather than failing the record.",
  `4. When done, call crm_mark_exported with list=${listId}, crm=${crm} and the counts. Reply with created / updated / skipped counts and any errors.`,
  total > 200 ? `This is ${total} rows: do the first 100, report, and ask before continuing.` : "",
].filter(Boolean).join("\n");

export function registerCrm(pi: ExtensionAPI, rt: Runtime): void {
  // Register at load so the server connects with the session (config is global; project overrides are picked up on /reload).
  try { registerCrmServer(pi, loadConfig(process.cwd()).crm); } catch { /* bad config: /crm reports it */ }

  registerSailorTool(pi, rt, {
    name: "crm_export_rows",
    label: "CRM rows",
    needsKey: false,
    description: "CRM-ready records for a Sailor list (local, free), paged: people → firstName,lastName,email,phone,title,company,companyDomain,linkedinUrl,xUrl,githubUrl,location,notes,fitScore/fitTier/fitReason; companies → name,domain,linkedinUrl,industry,headcount,hq,country,latestFunding*,notes. Do-not-contact and excluded rows are removed. Use with the linked CRM's MCP tools (see /crm).",
    parameters: Type.Object({
      list: Type.String(),
      offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
      minScore: Type.Optional(Type.Number({ description: "Only rows with a /qualify fit score ≥ this" })),
    }),
    async execute(p: any) {
      const r = crmRows(rt.store, p.list, p);
      return ok(`${r.kind} ${p.offset ?? 0}–${(p.offset ?? 0) + r.rows.length} of ${r.total}${r.skippedDnc ? ` (${r.skippedDnc} do-not-contact/excluded left out)` : ""}${r.nextOffset !== undefined ? ` · next offset=${r.nextOffset}` : " · last page"}\n${JSON.stringify(r.rows)}`, r);
    },
  });

  registerSailorTool(pi, rt, {
    name: "crm_mark_exported",
    label: "CRM export done",
    needsKey: false,
    description: "Record that a list was exported to the CRM (shows up in export history). Call once after pushing a list.",
    parameters: Type.Object({
      list: Type.String(),
      crm: Type.String(),
      created: Type.Optional(Type.Integer()), updated: Type.Optional(Type.Integer()), skipped: Type.Optional(Type.Integer()),
    }),
    async execute(p: any) {
      const l = rt.store.getList(p.list);
      if (!l) throw new Error(`No list "${p.list}".`);
      rt.store.addExport(l.id, `crm:${p.crm}`, null, `created ${p.created ?? 0} · updated ${p.updated ?? 0} · skipped ${p.skipped ?? 0}`);
      return ok(`Recorded export of "${l.name}" to ${p.crm}.`);
    },
  });

  pi.registerCommand("crm", {
    description: "Link your CRM and export lists to it: /crm [connect hubspot|salesforce|attio|custom <url>] | export [list] [--min-score N] | disconnect",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args);
      let sub = a._[0];
      const cur = rt.config.crm ?? {};
      try {
        if (!sub) {
          if (!ctx.hasUI) { say(ctx, cur.provider ? `CRM: ${CRMS[cur.provider].label} (MCP server "${CRMS[cur.provider].server}").` : "No CRM linked. /crm connect hubspot|salesforce|attio|custom <url>"); return; }
          const opts = cur.provider
            ? [`Export a list to ${CRMS[cur.provider].label}`, `Sign-in steps for ${CRMS[cur.provider].label}`, "Switch CRM", "Disconnect"]
            : CRM_IDS.map((id) => `Connect ${CRMS[id].label}`);
          const pick = await ctx.ui.select(cur.provider ? `CRM: ${CRMS[cur.provider].label}` : "Link a CRM", opts);
          if (!pick) return;
          if (pick.startsWith("Export")) sub = "export";
          else if (pick.startsWith("Sign-in")) sub = "status";
          else if (pick === "Disconnect") sub = "disconnect";
          else if (pick === "Switch CRM") { const p2 = await ctx.ui.select("Link a CRM", CRM_IDS.map((id) => CRMS[id].label)); if (!p2) return; a._ = ["connect", CRM_IDS[CRM_IDS.map((id) => CRMS[id].label).indexOf(p2)]]; sub = "connect"; }
          else { a._ = ["connect", CRM_IDS[opts.indexOf(pick)]]; sub = "connect"; }
        }
        if (sub === "connect") await connect(a._[1], a._[2], ctx);
        else if (sub === "disconnect") {
          unregisterCrmServer(pi, cur);
          saveGlobalConfig({ crm: { provider: null, url: null } } as any);
          rt.reloadConfig();
          say(ctx, `CRM unlinked. Stored OAuth tokens stay with Pi; remove them with /mcp logout ${cur.provider ? CRMS[cur.provider].server : "<server>"}.`);
        } else if (sub === "export") {
          if (!cur.provider) { say(ctx, "Link a CRM first: /crm connect hubspot|salesforce|attio", "warning"); return; }
          if (rt.agentMode === "plan") { say(ctx, "PLAN mode doesn't write to your CRM. Switch with /build to export.", "warning"); return; }
          const { list } = await resolveListArg(rt, ctx, { _: a._.slice(1), flags: a.flags }, { purpose: "/crm export" });
          if (!list) return;
          const minScore = flagNum(a, "min-score");
          const { total } = crmRows(rt.store, list.id, { limit: 1, minScore });
          if (!total) { say(ctx, `Nothing to export from "${list.name}".`, "warning"); return; }
          pi.sendUserMessage(crmExportBrief(cur.provider, list.id, list.name, total, minScore), { deliverAs: "followUp" } as any);
        } else {
          if (!cur.provider) { say(ctx, "No CRM linked. /crm connect hubspot|salesforce|attio|custom <url>"); return; }
          const info = CRMS[cur.provider];
          await showText(ctx, `CRM · ${info.label}`, [`MCP server: ${info.server} (tools mcp__${info.server}__*) · manage it in /mcp`, "", ...info.authSteps(cur), "", `Docs: ${info.docs}`, "", "Export: /crm export <list>"]);
        }
      } catch (err) { say(ctx, errorMessage(err), "error"); }
    },
  });

  async function connect(which: string | undefined, url: string | undefined, ctx: ExtensionContext): Promise<void> {
    if (!isCrmId(which)) { say(ctx, `Usage: /crm connect ${CRM_IDS.join("|")}`, "warning"); return; }
    const patch: CrmConfig = { provider: which };
    if (which === "custom") {
      const u = url ?? (ctx.hasUI ? (await ctx.ui.input("CRM MCP server URL (streamable HTTP)", "https://…/mcp"))?.trim() : undefined);
      if (!u || !/^https:\/\//.test(u)) { say(ctx, "Need an https:// MCP URL.", "warning"); return; }
      patch.url = u;
    }
    if (which === "hubspot") {
      const id = rt.config.crm?.hubspotClientId ?? (ctx.hasUI ? (await ctx.ui.input(`HubSpot MCP connector client ID (redirect URL: http://127.0.0.1:8765/callback) — leave empty for setup steps`, ""))?.trim() : undefined);
      if (id) {
        patch.hubspotClientId = id;
        if (!getSecret(HUBSPOT_SECRET) && ctx.hasUI) {
          const secret = (await ctx.ui.input("HubSpot MCP connector client secret", ""))?.trim();
          if (secret) setSecret(HUBSPOT_SECRET, secret);
        }
      }
    }
    if (which === "salesforce" && ctx.hasUI && !rt.config.crm?.salesforceOrg) {
      const org = (await ctx.ui.input("Salesforce org alias/username (empty = CLI default org)", ""))?.trim();
      if (org) patch.salesforceOrg = org;
    }
    unregisterCrmServer(pi, rt.config.crm);
    saveGlobalConfig({ crm: patch } as any);
    rt.reloadConfig();
    let server: string | undefined;
    try { server = registerCrmServer(pi, rt.config.crm); } catch (err) { say(ctx, `Couldn't register the ${CRMS[which].label} MCP server: ${errorMessage(err)}`, "error"); }
    const info = CRMS[which];
    const steps = info.authSteps(rt.config.crm);
    say(ctx, `${server ? `✓ ${info.label} linked (MCP server "${server}").` : `${info.label} selected — finish setup:`}\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
    // Pre-fill the sign-in command so the user only presses Enter.
    if (server && ctx.hasUI && (which === "hubspot" || which === "attio" || which === "custom")) {
      try { (ctx.ui as any).setEditorText?.(`/mcp login ${server}`); } catch { /* older Pi */ }
    }
  }
}
