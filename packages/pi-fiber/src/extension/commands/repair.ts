import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { saveGlobalConfig } from "../../core/config";
import { errorMessage } from "../../core/errors";
import { progressBar } from "../../core/jobs/manager";
import { preflight, preflightCard, runKitchenSinkRepair, startMosaicRuns } from "../../core/repair/engine";
import { approveSpend } from "../costGuard";
import { pickEntities, revealContacts, revealPlan, revealSummary } from "../actions";
import type { Runtime } from "../runtime";
import { blocker, repairEstimate, repairOptionsFrom } from "../tools/repair";
import { showText } from "../ui/textView";
import { flagBool, flagNum, flagStr, parseArgs } from "./args";

function say(ctx: ExtensionContext, msg: string, level: "info" | "warning" | "error" = "info") {
  if (ctx.hasUI) ctx.ui.notify(msg, level); else console.log(msg);
}

export function registerRepairCommands(pi: ExtensionAPI, rt: Runtime): void {
  pi.registerCommand("repair", {
    description: "Heal & enrich a messy list: /repair <file|url|sheet> [--work-email] [--personal-email] [--phone] [--company] [--max-rows N] [--engine kitchen-sink|mosaic] [--name N] [--url PUBLIC_URL] [--instructions \"…\"]  ·  /repair hosting <manual|gdrive|s3>",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args, ["work-email", "personal-email", "phone", "company", "no-live-fetch", "redline", "yes"]);
      if (a._[0] === "hosting") {
        const p = a._[1];
        if (!p || !["manual", "gdrive", "s3"].includes(p)) { say(ctx, `Mosaic hosting: ${rt.config.hosting.provider}. Options: manual (you provide a public URL), gdrive (uses /sheets connect; temporary anyone-with-link file), s3 (S3/R2 presigned URLs; configure hosting.s3 in ~/.sailor/config.json).`); return; }
        saveGlobalConfig({ hosting: { provider: p } } as any);
        rt.reloadConfig();
        say(ctx, `Mosaic hosting set to ${p}.`);
        return;
      }
      const src0 = a._.join(" ");
      if (!src0) { say(ctx, "Usage: /repair <file|url|google sheet url> [options]", "warning"); return; }
      if (!rt.hasKey) { say(ctx, "Connect Fiber first: /fiber login", "warning"); return; }
      const src = /^https?:/i.test(src0) || isAbsolute(src0) ? src0 : resolve(rt.cwd, src0);
      try {
        const opts = repairOptionsFrom({
          workEmail: flagBool(a, "work-email"), personalEmail: flagBool(a, "personal-email"), phone: flagBool(a, "phone"),
          includeCompanyDetails: flagBool(a, "company"), liveFetch: flagBool(a, "no-live-fetch") ? false : undefined, redline: flagBool(a, "redline"),
          maxRows: flagNum(a, "max-rows"), instructions: flagStr(a, "instructions"), engine: flagStr(a, "engine"), list: flagStr(a, "name"), sourceUrl: flagStr(a, "url"),
        });
        const pre = await preflight(src, opts, { pricing: rt.pricing, store: rt.store });
        const card = preflightCard(pre);
        const block = blocker(rt, pre);
        if (block) { await showText(ctx, "Repair pre-flight", [...card.split("\n"), "", `Cannot run yet: ${block}`]); return; }
        if (ctx.hasUI) await showText(ctx, "Repair pre-flight", card.split("\n"));
        const ok = await approveSpend(rt, ctx, `Repair ${pre.fileName} (${pre.engine})`, { ...repairEstimate(rt, pre), forceConfirm: true });
        if (!ok.ok) { say(ctx, ok.reason, "warning"); return; }
        if (pre.engine === "kitchen-sink") {
          const res = await runKitchenSinkRepair(pre, rt.gtm, { onProgress: (d, t) => ctx.ui?.setStatus("sailor-progress", `resolving ${progressBar(d, t)} ${d}/${t}`) });
          ctx.ui?.setStatus("sailor-progress", undefined);
          let msg = `Kitchen Sink: ${res.found} resolved, ${res.notFound} not found, ${res.skipped} skipped → list "${res.listName}" (${res.listId}).`;
          const c = opts.contacts;
          if (c?.workEmail || c?.personalEmail || c?.phone) {
            const plan = revealPlan(rt, pickEntities(rt, res.listId, undefined, { status: "enriched" }), c);
            msg += `\n${revealSummary(await revealContacts(rt, plan, { listId: res.listId }))}`;
          }
          say(ctx, `${msg}\nOpen it with /list ${res.listId}`);
        } else {
          try {
            const jobs = await startMosaicRuns(pre, { client: rt.client, store: rt.store, config: rt.config });
            rt.meter.render();
            say(ctx, `Started Mosaic: ${jobs.map((j) => j.id).join(", ")}. Progress shows above the editor; results land next to the file and in a new list.`);
          } catch (err) {
            if ((err as Error).message === "MANUAL_URL_REQUIRED") say(ctx, blocker(rt, { ...pre, options: { ...pre.options, sourceUrl: undefined } }) ?? "Configure hosting.", "warning");
            else throw err;
          }
        }
      } catch (err) {
        say(ctx, errorMessage(err), "error");
      }
    },
  });

  pi.registerCommand("jobs", {
    description: "Async jobs: /jobs [list] | refresh <id> | cancel <id> | resume <id>",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args);
      const [sub, id] = a._;
      try {
        if (sub === "cancel" && id) { await rt.jobs.cancel(id); say(ctx, `Canceled ${id}.`); return; }
        if (sub === "resume" && id) { rt.jobs.resume(id); await rt.jobs.pollNow(id); say(ctx, `Resumed ${id}.`); return; }
        if (sub === "refresh" && id) { await rt.jobs.pollNow(id); }
        const jobs = rt.store.jobs({ limit: 30 });
        await showText(ctx, "Sailor jobs", jobs.length ? jobs.flatMap((j) => {
          const pr = (j.result as any)?.progress ?? {};
          return [
            `${j.id}  ${j.kind.padEnd(14)} ${j.status.padEnd(20)} ${progressBar(pr.done, pr.total)} ${pr.done ?? "?"}/${pr.total ?? "?"}  ${new Date(j.created_at).toLocaleString()}`,
            ...((j.result as any)?.summary ? [`   ${(j.result as any).summary}`] : []),
            ...(j.error ? [`   ! ${j.error}`] : []),
          ];
        }) : ["No jobs yet."]);
      } catch (err) { say(ctx, errorMessage(err), "error"); }
    },
  });
}
