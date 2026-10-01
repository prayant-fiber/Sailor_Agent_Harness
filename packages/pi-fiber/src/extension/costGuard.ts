/**
 * Cost guard (F9): every tool call passes through pi.on("tool_call") before execution.
 * Sailor tools declare an estimator; MCP tools map to operationIds; shell commands that look like they
 * hit Fiber directly (engineer mode scripts) get a warning confirm because they bypass the guard.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { decide, fmtCredits } from "../core/budget";
import type { Estimate } from "../core/fiber/ops";
import { errorMessage } from "../core/errors";
import type { Runtime } from "./runtime";
import { ESTIMATORS } from "./tools/common";

export async function approveSpend(rt: Runtime, ctx: ExtensionContext | undefined, label: string, estimate: Estimate): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!estimate.credits && !estimate.uncertain && !estimate.forceConfirm && !estimate.blockReason) return { ok: true };
  const d = decide({
    opId: label, estimate, available: rt.meter.available(), sessionSpent: rt.sessionSpent(), dailySpent: rt.dailySpent(),
    paidCallsThisTurn: rt.paidCallsThisTurn, hasUI: !!ctx?.hasUI, config: rt.config,
  });
  if (d.action === "block") return { ok: false, reason: d.reason };
  if (d.action === "confirm") {
    const yes = await ctx!.ui.confirm(d.title, d.message);
    if (!yes) return { ok: false, reason: "The user declined this charge. Do not retry; ask what they want instead." };
  }
  if (estimate.credits > 0) rt.paidCallsThisTurn++;
  return { ok: true };
}

const FIBER_SHELL = /(api\.fiber\.ai|mcp\.fiber\.ai|@fiberai\/sdk|FIBER_API_KEY|FIBERAI_API_KEY)/;

export function installCostGuard(pi: ExtensionAPI, rt: Runtime): void {
  pi.on("tool_call", async (event, ctx) => {
    rt.init(ctx);
    let estimate: Estimate | undefined;
    try {
      const est = ESTIMATORS.get(event.toolName);
      if (est) estimate = await est(event.input ?? {}, rt, event.toolCallId);
      else if (event.toolName === "bash" && typeof event.input?.command === "string" && FIBER_SHELL.test(event.input.command)) {
        estimate = { credits: 0, basis: "This shell command appears to call Fiber directly, bypassing Sailor's cost guard and ledger. Cost unknown.", uncertain: true, forceConfirm: true };
      }
    } catch (err) {
      // Estimation failed (e.g. unreadable file). Let the tool run and report the real error — unless it's a paid tool,
      // in which case we still need consent.
      if (ESTIMATORS.has(event.toolName)) estimate = { credits: 0, basis: `could not estimate: ${errorMessage(err)}`, uncertain: true };
    }
    if (!estimate) return;
    const res = await approveSpend(rt, ctx, event.toolName, estimate);
    if (!res.ok) return { block: true, reason: res.reason };
    if (estimate.credits > 0) rt.ui?.setStatus("sailor-last", `last: ${event.toolName} ~${fmtCredits(estimate.credits)} cr`);
  });
}
