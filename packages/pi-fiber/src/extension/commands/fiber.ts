import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { saveGlobalConfig } from "../../core/config";
import { fmtCredits, startOfLocalDay } from "../../core/budget";
import { errorMessage } from "../../core/errors";
import { maskKey } from "../../core/redact";
import { listProfiles, looksLikeFiberKey, removeFiberKey, storeFiberKey } from "../../core/secrets";
import type { Runtime } from "../runtime";
import { connectFiberMcp, disconnectFiberMcp } from "../tools/mcp";
import { applyMode } from "../modes";
import { parseArgs } from "./args";
import { showText } from "../ui/textView";

function say(ctx: ExtensionContext, msg: string, level: "info" | "warning" | "error" = "info") {
  if (ctx.hasUI) ctx.ui.notify(msg, level);
  else console.log(msg);
}

export async function fiberLogin(rt: Runtime, ctx: ExtensionContext, profile = rt.config.fiber.profile, keyArg?: string): Promise<boolean> {
  let key = keyArg;
  if (!key && ctx.hasUI) key = (await ctx.ui.input("Fiber API key (sk_live_…) — get one at fiber.ai/app/api", "sk_live_…"))?.trim();
  if (!key) { say(ctx, "No key entered.", "warning"); return false; }
  if (!looksLikeFiberKey(key)) say(ctx, "That doesn't look like a Fiber key (expected sk_live_…); trying anyway.", "warning");
  const prev = rt.keyInfo;
  rt.keyInfo = { key, source: "file" };
  const org = await rt.meter.refresh();
  if (!org) {
    rt.keyInfo = prev;
    say(ctx, `Key rejected or Fiber unreachable: ${rt.meter.lastError ?? "unknown error"}`, "error");
    rt.meter.render();
    return false;
  }
  const backend = storeFiberKey(key, profile);
  rt.reloadKey();
  saveGlobalConfig({ fiber: { profile } } as any);
  say(ctx, `✓ Connected to Fiber (${maskKey(key)}, profile "${profile}", stored in ${backend === "keychain" ? "OS keychain" : "~/.sailor/credentials.json (0600)"}) · ${fmtCredits(org.available)} credits available.`);
  return true;
}

export function registerFiberCommands(pi: ExtensionAPI, rt: Runtime): void {
  pi.registerCommand("fiber", {
    description: "Fiber account: login | logout | whoami | use <profile> | mcp <core|v2|lite|off> | admin <on|off>",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args);
      const sub = a._[0] ?? "whoami";
      try {
        switch (sub) {
          case "login": await fiberLogin(rt, ctx, typeof a.flags.profile === "string" ? a.flags.profile : rt.config.fiber.profile, a._[1]); break;
          case "logout": removeFiberKey(rt.config.fiber.profile); rt.reloadKey(); rt.meter.state = "nokey"; rt.meter.render(); say(ctx, `Removed stored key for profile "${rt.config.fiber.profile}".${rt.keyInfo ? ` Note: ${rt.keyInfo.source} is still set in your environment.` : ""}`); break;
          case "use": {
            const profile = a._[1];
            if (!profile) { say(ctx, `Profiles: ${listProfiles().join(", ") || "(none in file store)"} · active: ${rt.config.fiber.profile}`); break; }
            saveGlobalConfig({ fiber: { profile } } as any);
            rt.reloadConfig(); rt.reloadKey();
            if (!rt.hasKey) { say(ctx, `Profile "${profile}" has no key yet.`, "warning"); await fiberLogin(rt, ctx, profile); }
            else { await rt.meter.refresh(); say(ctx, `Switched to profile "${profile}".`); }
            break;
          }
          case "mcp": {
            const which = a._[1];
            if (!which) { say(ctx, `Fiber MCP servers: ${rt.config.fiber.mcp.join(", ") || "off"}`); break; }
            const servers = which === "off" ? [] : which.split(",") as any;
            saveGlobalConfig({ fiber: { mcp: servers } } as any);
            rt.reloadConfig();
            await disconnectFiberMcp();
            if (servers.length) {
              const names = await connectFiberMcp(pi, rt, servers);
              pi.setActiveTools([...new Set([...pi.getActiveTools(), ...names])]);
              say(ctx, `Connected Fiber MCP (${servers.join(", ")}): ${names.length} tools.`);
            } else say(ctx, "Fiber MCP disabled (typed tools + fiber_call still cover every operation).");
            break;
          }
          case "admin": rt.adminMode = a._[1] === "on"; say(ctx, `API-key admin operations ${rt.adminMode ? "ENABLED for this session" : "disabled"}.`, rt.adminMode ? "warning" : "info"); break;
          case "whoami":
          default: {
            if (!rt.hasKey) { say(ctx, "Not connected. Run /fiber login (or set FIBER_API_KEY)."); break; }
            const org = await rt.meter.refresh();
            let keyInfo = "";
            try { const k = await rt.client.call("getCurrentApiKey", {}); const o: any = k.output ?? {}; keyInfo = [o.name && `name ${o.name}`, o.creditLimit !== undefined && `key limit ${o.creditLimit}`, o.expiresAt && `expires ${o.expiresAt}`].filter(Boolean).join(" · "); } catch { /* optional */ }
            say(ctx, [
              `Key ${maskKey(rt.keyInfo?.key)} (from ${rt.keyInfo?.source}${rt.keyInfo?.warning ? `; ${rt.keyInfo.warning}` : ""}) · profile ${rt.config.fiber.profile}${keyInfo ? ` · ${keyInfo}` : ""}`,
              org ? `Org ${org.organizationId ?? "?"} · ${fmtCredits(org.available)} / ${fmtCredits(org.max)} credits · resets ${org.usagePeriodResetsOn ?? "?"}` : `Credits unavailable: ${rt.meter.lastError}`,
              `Mode ${rt.config.mode} · tools ${rt.config.toolsProfile} · MCP ${rt.config.fiber.mcp.join(",") || "off"} · DB ${rt.store.path}`,
            ].join("\n"));
          }
        }
      } catch (err) {
        say(ctx, errorMessage(err), "error");
      }
    },
  });

  pi.registerCommand("credits", {
    description: "Show Fiber credit balance, session ledger by operation, and recent charges",
    handler: async (_args, ctx) => {
      rt.init(ctx);
      const org = await rt.meter.refresh();
      const byOp = rt.store.ledgerByOp(rt.sessionId);
      const recent = rt.store.recentLedger(10);
      const lines = [
        org ? `Balance: ${fmtCredits(org.available)} / ${fmtCredits(org.max)} (used ${fmtCredits(org.used)}) · resets ${org.usagePeriodResetsOn ?? "?"}` : `Balance unavailable: ${rt.meter.lastError ?? "not connected"}`,
        `Session: ${fmtCredits(rt.sessionSpent())} / ${fmtCredits(rt.config.budget.session)} · Today: ${fmtCredits(rt.store.spentSince(startOfLocalDay()))} / ${fmtCredits(rt.config.budget.daily)} · auto-approve ≤ ${rt.config.budget.autoApproveUnder}`,
        "",
        "This session by operation (estimated → charged):",
        ...(byOp.length ? byOp.map((r) => `  ${r.op.padEnd(30)} ${String(r.calls).padStart(4)} calls  ~${fmtCredits(r.estimated)} → ${fmtCredits(r.charged)}`) : ["  (no charges yet)"]),
        "",
        "Recent charges:",
        ...(recent.length ? recent.map((r) => `  ${new Date(r.at).toLocaleTimeString()} ${r.op} ${r.method ?? ""} ${fmtCredits(r.charged)}`) : ["  (none)"]),
        "",
        "Top up in the Fiber dashboard: https://fiber.ai/app (Sailor never buys credits).",
      ];
      await showText(ctx, "Fiber credits", lines);
    },
  });

  pi.registerCommand("budget", {
    description: "Show or set spend limits: /budget session <n> | daily <n> | auto <n> | turn <n>",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args);
      const [which, val] = a._;
      const n = Number(val);
      const key = ({ session: "session", daily: "daily", auto: "autoApproveUnder", turn: "maxPaidCallsPerTurn" } as Record<string, string>)[which ?? ""];
      if (key && Number.isFinite(n) && n >= 0) {
        saveGlobalConfig({ budget: { [key]: n } } as any);
        rt.reloadConfig();
      }
      const b = rt.config.budget;
      say(ctx, `Budgets — session ${b.session} (spent ${fmtCredits(rt.sessionSpent())}) · daily ${b.daily} (spent ${fmtCredits(rt.dailySpent())}) · auto-approve ≤ ${b.autoApproveUnder} · max paid calls/turn ${b.maxPaidCallsPerTurn}. Tip: also cap the key itself in the Fiber dashboard.`);
    },
  });

  pi.registerCommand("dryrun", {
    description: "Estimate-only mode: /dryrun on|off",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const on = (args ?? "").trim() !== "off";
      saveGlobalConfig({ dryRun: on } as any);
      rt.reloadConfig();
      say(ctx, on ? "DRY-RUN on: paid calls are estimated and blocked." : "DRY-RUN off.");
    },
  });

  pi.registerCommand("mode", {
    description: "Switch persona: /mode rep | engineer | recruiting",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const m = (args ?? "").trim() as any;
      if (!["rep", "engineer", "recruiting"].includes(m)) { say(ctx, `Mode: ${rt.config.mode}. Options: rep (default, no shell/file-writing tools), engineer (adds coding tools + fiber-sdk skill), recruiting (sourcing + fairness guardrails).`); return; }
      saveGlobalConfig({ mode: m } as any);
      rt.reloadConfig();
      applyMode(pi, rt);
      say(ctx, `Mode set to ${m}.`);
    },
  });
}
