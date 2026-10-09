/**
 * Agent modes (FIB-20426): Build · Plan · Sandbox.
 *
 *  build    — the normal mode: Sailor does the work and spends Fiber credits through the cost guard.
 *  plan     — zero-spend: every paid Fiber call and every shell/file-writing tool is blocked. The agent writes a
 *             numbered plan with per-step credit estimates; when it's done the user picks "run in Build" or "try in Sandbox".
 *  sandbox  — everything runs against a Fiber sandbox key (sk_test_…): real API shapes, fixed sample data, nothing charged.
 *             The live key is never used while in Sandbox, so a demo can't spend credits by accident.
 *
 * Modes are orthogonal to the persona (`/mode rep|engineer|recruiting`). Switch with /build, /plan, /sandbox,
 * /agent-mode, the alt+m shortcut, or `--agent-mode` / SAILOR_AGENT_MODE.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { saveGlobalConfig, type AgentMode } from "../core/config";
import { errorMessage } from "../core/errors";
import { maskKey } from "../core/redact";
import { isSandboxKey } from "../core/fiber/sandbox";
import { looksLikeFiberKey, resolveSandboxKey, SANDBOX_PROFILE, storeFiberKey } from "../core/secrets";
import type { Runtime } from "./runtime";
import { applyMode } from "./modes";
import { connectFiberMcp, disconnectFiberMcp } from "./tools/mcp";

export const AGENT_MODES: AgentMode[] = ["build", "plan", "sandbox"];

export const AGENT_MODE_INFO: Record<AgentMode, { label: string; blurb: string }> = {
  build: { label: "BUILD", blurb: "does the work · spends Fiber credits (with approvals)" },
  plan: { label: "PLAN", blurb: "plans only · no credits spent, no files touched" },
  sandbox: { label: "SANDBOX", blurb: "runs on a Fiber sandbox key · sample data, nothing charged" },
};

export function nextAgentMode(m: AgentMode): AgentMode {
  return AGENT_MODES[(AGENT_MODES.indexOf(m) + 1) % AGENT_MODES.length];
}

export function isAgentMode(s: unknown): s is AgentMode {
  return typeof s === "string" && (AGENT_MODES as string[]).includes(s);
}

/** Listeners (header/footer) re-render when the mode changes. */
const listeners = new Set<(m: AgentMode) => void>();
export function onAgentModeChange(fn: (m: AgentMode) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function say(ctx: ExtensionContext, msg: string, level: "info" | "warning" | "error" = "info") {
  if (ctx.hasUI) ctx.ui.notify(msg, level); else console.log(msg);
}

/**
 * Makes sure a sandbox key is available before entering Sandbox mode. Offers to paste one or to mint one from the
 * live key (createSandboxApiKey is free; the new key is shown once by Fiber and stored under the "sandbox" profile).
 */
export async function ensureSandboxKey(rt: Runtime, ctx: ExtensionContext): Promise<boolean> {
  if (resolveSandboxKey(rt.config.fiber.profile)) return true;
  if (!ctx.hasUI) {
    say(ctx, "Sandbox mode needs a Fiber sandbox key: set FIBER_SANDBOX_KEY=sk_test_… or run /sandbox key <sk_test_…>.", "warning");
    return false;
  }
  const canMint = rt.hasKey && !isSandboxKey(rt.keyInfo?.key);
  const options = [...(canMint ? ["Create one from my Fiber key (free)"] : []), "Paste a sandbox key (sk_test_…)", "Cancel"];
  const pick = await ctx.ui.select("Sandbox mode needs a Fiber sandbox key", options);
  if (!pick || pick === "Cancel") return false;
  let key: string | undefined;
  if (pick.startsWith("Create")) {
    try {
      const r = await rt.client.call("createSandboxApiKey", { name: `sailor sandbox ${new Date().toISOString().slice(0, 10)}` }, { allowAdmin: true });
      key = (r.output as any)?.apiKey ?? (r.output as any)?.key;
      if (!key) throw new Error("Fiber didn't return a key");
    } catch (err) {
      say(ctx, `Couldn't create a sandbox key: ${errorMessage(err)}. Paste one instead with /sandbox key <sk_test_…>.`, "error");
      return false;
    }
  } else {
    key = (await ctx.ui.input("Fiber sandbox key", "sk_test_…"))?.trim();
  }
  if (!key) return false;
  if (!isSandboxKey(key) || !looksLikeFiberKey(key)) { say(ctx, "That isn't a sandbox key (expected sk_test_…). Sandbox mode never uses a live key.", "error"); return false; }
  const where = storeFiberKey(key, SANDBOX_PROFILE);
  say(ctx, `✓ Sandbox key ${maskKey(key)} saved (${where === "keychain" ? "OS keychain" : "~/.sailor/credentials.json"}).`);
  return true;
}

/** Switch mode: persists it, swaps the Fiber key, re-gates tools, toggles the Fiber MCP bridge, notifies the UI. */
export async function setAgentMode(pi: ExtensionAPI, rt: Runtime, ctx: ExtensionContext, mode: AgentMode, opts: { quiet?: boolean; persist?: boolean } = {}): Promise<boolean> {
  rt.init(ctx);
  const prev = rt.agentMode;
  if (mode === "sandbox" && !(await ensureSandboxKey(rt, ctx))) return false;
  if (opts.persist !== false) saveGlobalConfig({ agentMode: mode } as any);
  rt.config.agentMode = mode;
  rt.reloadConfig();
  rt.config.agentMode = mode; // env overrides in loadConfig must not undo an explicit switch
  rt.reloadKey();
  rt.client.sandboxSeen = false;
  rt.plans.clear();

  if (prev !== mode) {
    if (mode === "sandbox") await disconnectFiberMcp();
    else if (prev === "sandbox" && rt.hasKey && !rt.isSandbox && rt.config.fiber.mcp.length && rt.config.toolsProfile !== "lite") {
      connectFiberMcp(pi, rt).then((names) => { if (names.length) applyMode(pi, rt); }).catch(() => undefined);
    }
  }
  applyMode(pi, rt);
  if (rt.hasKey) void rt.meter.refresh(); else rt.meter.render();
  for (const fn of listeners) { try { fn(mode); } catch { /* ignore */ } }
  if (!opts.quiet) say(ctx, `${AGENT_MODE_INFO[mode].label} mode — ${AGENT_MODE_INFO[mode].blurb}${mode === "sandbox" ? ` (key ${maskKey(rt.keyInfo?.key)})` : ""}.`);
  return true;
}

/** Plan-mode block reason for the cost guard (undefined = allowed). */
export function planModeBlock(rt: Pick<Runtime, "agentMode">, label: string, estimate: { credits: number; basis: string; uncertain?: boolean; forceConfirm?: boolean }): string | undefined {
  if (rt.agentMode !== "plan") return undefined;
  if (!estimate.credits && !estimate.uncertain && !estimate.forceConfirm) return undefined;
  return `PLAN mode: ${label} was not run (it would cost ~${estimate.credits} credits: ${estimate.basis}). Put it in the plan as a step with this estimate instead. The user runs the plan with /build (or tries it free with /sandbox).`;
}

/** True when an assistant reply looks like a numbered plan (used to offer "run it" after a Plan-mode turn). */
export function looksLikePlan(text: string): boolean {
  return /(^|\n)\s*(#+\s*)?plan\b/i.test(text) && /(^|\n)\s*1[.)]\s+\S/.test(text) && /(^|\n)\s*2[.)]\s+\S/.test(text);
}

export const RUN_PLAN_MESSAGE = "Run the plan above step by step. Keep to the estimates; if a step would cost noticeably more, stop and tell me first.";

export function registerAgentModes(pi: ExtensionAPI, rt: Runtime): void {
  pi.registerFlag("agent-mode", { description: "Start in build | plan | sandbox mode", type: "string" });

  const cmd = (mode: AgentMode, extra = "") => ({
    description: `Switch to ${AGENT_MODE_INFO[mode].label} mode: ${AGENT_MODE_INFO[mode].blurb}${extra}`,
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      rt.init(ctx);
      const a = (args ?? "").trim().split(/\s+/);
      if (mode === "sandbox" && a[0] === "key") {
        const key = a[1];
        if (!key || !isSandboxKey(key)) { say(ctx, "Usage: /sandbox key sk_test_…", "warning"); return; }
        storeFiberKey(key, SANDBOX_PROFILE);
        say(ctx, `Saved sandbox key ${maskKey(key)}.`);
      }
      await setAgentMode(pi, rt, ctx, mode);
    },
  });
  pi.registerCommand("build", cmd("build"));
  pi.registerCommand("plan", cmd("plan"));
  pi.registerCommand("sandbox", cmd("sandbox", " · /sandbox key <sk_test_…> stores a key"));
  pi.registerCommand("agent-mode", {
    description: "Show or switch the agent mode: /agent-mode [build|plan|sandbox]",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const m = (args ?? "").trim();
      if (isAgentMode(m)) { await setAgentMode(pi, rt, ctx, m); return; }
      if (ctx.hasUI) {
        const labels = AGENT_MODES.map((x) => `${x === rt.agentMode ? "● " : "  "}${AGENT_MODE_INFO[x].label.padEnd(8)} ${AGENT_MODE_INFO[x].blurb}`);
        const pick = await ctx.ui.select("Agent mode", labels);
        if (pick) await setAgentMode(pi, rt, ctx, AGENT_MODES[labels.indexOf(pick)]);
      } else say(ctx, `Agent mode: ${rt.agentMode}. Options: ${AGENT_MODES.join(", ")}.`);
    },
  });
  pi.registerShortcut("alt+m", {
    description: "Sailor: cycle Build → Plan → Sandbox",
    handler: async (ctx) => { rt.init(ctx); await setAgentMode(pi, rt, ctx, nextAgentMode(rt.agentMode)); },
  });

  // After a Plan-mode turn that produced a plan, offer to run it.
  pi.on("agent_end", async (event: any, ctx: ExtensionContext) => {
    rt.init(ctx);
    if (rt.agentMode !== "plan" || !ctx.hasUI) return;
    const last = [...(event?.messages ?? [])].reverse().find((m: any) => m?.role === "assistant");
    const text = Array.isArray(last?.content) ? last.content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n") : String(last?.content ?? "");
    if (!looksLikePlan(text)) return;
    const pick = await ctx.ui.select("Plan ready. What next?", ["Run it in BUILD mode (spends credits, with approvals)", "Try it in SANDBOX mode (free sample data)", "Keep planning"]);
    if (!pick || pick.startsWith("Keep")) return;
    const target: AgentMode = pick.includes("SANDBOX") ? "sandbox" : "build";
    if (await setAgentMode(pi, rt, ctx, target)) pi.sendUserMessage(RUN_PLAN_MESSAGE, { deliverAs: "followUp" } as any);
  });
}
