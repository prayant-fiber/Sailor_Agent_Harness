/**
 * Sailor — Pi extension wiring.
 *   pi install npm:@sailor/pi-fiber      (or: pi -e ./packages/pi-fiber/extensions/sailor)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "../core/errors";
import { progressBar } from "../core/jobs/manager";
import { containsSecret, redactText } from "../core/redact";
import { runtime as rt } from "./runtime";
import { installCostGuard } from "./costGuard";
import { applyMode } from "./modes";
import { systemPromptAddendum } from "./prompt";
import { registerAccountTools } from "./tools/account";
import { registerContactTools } from "./tools/contacts";
import { registerExportTools } from "./tools/export";
import { registerGenericTools } from "./tools/generic";
import { registerListTools } from "./tools/lists";
import { connectFiberMcp, disconnectFiberMcp } from "./tools/mcp";
import { registerRepairTools } from "./tools/repair";
import { registerResolveTools } from "./tools/resolve";
import { registerSearchTools } from "./tools/search";
import { registerFiberCommands } from "./commands/fiber";
import { registerListCommands, openListPane } from "./commands/lists";
import { registerRepairCommands } from "./commands/repair";
import { registerExportCommands } from "./commands/export";
import { registerScriptCommands } from "./commands/script";

export default function sailor(pi: ExtensionAPI): void {
  let jobsListenerInstalled = false;
  // ── flags ────────────────────────────────────────────────────────────────
  pi.registerFlag("fiber-max-spend", { description: "Headless (print/json/rpc) per-call spend allowance in Fiber credits", type: "string", default: "0" });
  pi.registerFlag("fiber-dry-run", { description: "Estimate paid Fiber calls without charging", type: "boolean", default: false });
  pi.registerFlag("sailor-mode", { description: "rep | engineer | recruiting", type: "string" });

  // ── tools, guard, commands ───────────────────────────────────────────────
  registerAccountTools(pi, rt);
  registerSearchTools(pi, rt);
  registerResolveTools(pi, rt);
  registerContactTools(pi, rt);
  registerRepairTools(pi, rt);
  registerListTools(pi, rt);
  registerExportTools(pi, rt);
  registerGenericTools(pi, rt);
  installCostGuard(pi, rt);
  registerFiberCommands(pi, rt);
  registerListCommands(pi, rt);
  registerRepairCommands(pi, rt);
  registerExportCommands(pi, rt);
  registerScriptCommands(pi, rt);

  pi.registerShortcut("ctrl+shift+l", { description: "Sailor: open lists", handler: async (ctx) => { rt.init(ctx); const l = rt.store.lists()[0]; if (l) await openListPane(rt, ctx, l.id); else ctx.ui.notify("No lists yet.", "info"); } });
  pi.registerShortcut("ctrl+shift+k", { description: "Sailor: refresh Fiber credits", handler: async (ctx) => { rt.init(ctx); await rt.meter.refresh(); ctx.ui.notify(rt.meter.text(), "info"); } });

  // ── lifecycle ────────────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    rt.init(ctx);
    const maxSpend = Number(pi.getFlag("fiber-max-spend") ?? 0);
    if (maxSpend > 0) rt.config.budget.headlessMaxSpend = maxSpend;
    if (pi.getFlag("fiber-dry-run")) rt.config.dryRun = true;
    const mode = pi.getFlag("sailor-mode");
    if (typeof mode === "string" && ["rep", "engineer", "recruiting"].includes(mode)) rt.config.mode = mode as any;

    if (rt.keyInfo?.warning) ctx.ui?.notify(rt.keyInfo.warning, "warning");
    rt.meter.render();
    if (rt.hasKey) void rt.meter.refresh();
    else if (ctx.hasUI) ctx.ui.notify("Sailor: connect your Fiber account with /fiber login (key from fiber.ai/app/api).", "info");
    rt.meter.start();

    // Jobs: resume persisted jobs, show progress widget, announce completions.
    if (!jobsListenerInstalled) { jobsListenerInstalled = true; rt.jobs.onEvent((e) => {
      renderJobsWidget();
      if (e.type === "done" || e.type === "failed" || e.type === "paused") {
        rt.ui?.notify(`${e.type === "done" ? "✓" : "!"} ${e.summary ?? `${e.job.kind} ${e.type}`}`, e.type === "done" ? "info" : "warning");
        pi.sendMessage({ customType: "sailor-job", content: `[Sailor job ${e.job.id} ${e.type}] ${e.summary ?? ""}`, display: true, details: { jobId: e.job.id } }, { triggerTurn: false });
      }
      rt.meter.render();
    }); }
    rt.jobs.start();
    renderJobsWidget();

    // Fiber MCP (lazy but in the background so the first prompt isn't blocked).
    if (rt.hasKey && rt.config.fiber.mcp.length && rt.config.toolsProfile !== "lite") {
      connectFiberMcp(pi, rt).then((names) => { if (names.length) applyMode(pi, rt); }).catch((err) => ctx.ui?.notify(`Fiber MCP unavailable (${errorMessage(err)}); typed tools and fiber_call still work.`, "warning"));
    }
    applyMode(pi, rt);
  });

  pi.on("session_shutdown", async () => {
    rt.shutdown();
    await disconnectFiberMcp();
  });

  pi.on("before_agent_start", async (event, ctx) => {
    rt.init(ctx);
    rt.paidCallsThisTurn = 0;
    return { systemPrompt: `${event.systemPrompt}\n${systemPromptAddendum(rt)}` };
  });

  // B7: a key pasted into chat never reaches the model.
  pi.on("input", async (event, ctx) => {
    if (!containsSecret(event.text)) return { action: "continue" };
    const m = event.text.match(/\bsk_(live|test|sandbox)_[A-Za-z0-9_-]{6,}/);
    if (m && ctx.hasUI && (await ctx.ui.confirm("That message contains a Fiber API key", "Store it securely as your Fiber key (and remove it from the message)?"))) {
      rt.init(ctx);
      const { fiberLogin } = await import("./commands/fiber");
      await fiberLogin(rt, ctx, rt.config.fiber.profile, m[0]);
    }
    return { action: "transform", text: redactText(event.text) };
  });

  // B2: redact secrets from every tool result (including bash output) before it enters the context/session.
  pi.on("tool_result", async (event) => {
    const changed = event.content?.some((c) => c.type === "text" && containsSecret(c.text));
    if (!changed) return undefined;
    return { content: event.content.map((c) => (c.type === "text" ? { ...c, text: redactText(c.text) } : c)) };
  });

  function renderJobsWidget(): void {
    try {
      const active = rt.jobs.active();
      if (!active.length) { rt.ui?.setWidget("sailor-jobs", undefined); return; }
      rt.ui?.setWidget("sailor-jobs", active.slice(0, 4).map((j) => {
        const pr = (j.result as any)?.progress ?? {};
        const name = (j.params as any)?.fileName ?? j.kind;
        return `⧗ ${j.kind === "mosaic" ? "Mosaic" : "Batch reveal"} ${name} ${progressBar(pr.done, pr.total)} ${pr.done ?? 0}/${pr.total ?? "?"} · ${j.status}`;
      }));
    } catch { /* store not ready */ }
  }
}
