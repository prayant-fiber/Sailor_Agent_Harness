/**
 * Modes & tool profiles (F8, F12, A11):
 *  rep (default)  — GTM tools + read-only file tools; no shell / file-writing tools (safe for non-technical users)
 *  engineer       — everything, incl. Pi's coding tools, for vibe-coding with @fiberai/sdk
 *  recruiting     — rep toolset + recruiting prompt and fairness guardrails
 *  toolsProfile "lite" — ≤ ~10 core tools for small/local models
 *  agentMode "plan" — additionally hides shell/file-writing tools (paid Fiber calls are blocked by the cost guard)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "./runtime";
import { LITE_TOOLS, SAILOR_TOOLS } from "./tools/common";
import { SANDBOX_HIDDEN_TOOLS } from "../core/fiber/sandbox";
import { isCrmTool } from "../core/crm";

const WRITE_TOOLS = new Set(["bash", "edit", "write"]);

/** Tools that change things outside Sailor's store; hidden in Plan mode (FIB-20426). CRM MCP tools too (FIB-20427). */
const planHidden = (name: string) => WRITE_TOOLS.has(name) || isCrmTool(name);

export function computeActiveTools(all: string[], rt: Pick<Runtime, "config"> & { isSandbox?: boolean }): string[] {
  const { mode, toolsProfile } = rt.config;
  const planning = rt.config.agentMode === "plan";
  return all.filter((name) => {
    if (rt.isSandbox && SANDBOX_HIDDEN_TOOLS.has(name)) return false;
    if (planning && planHidden(name)) return false;
    if (toolsProfile === "lite") return LITE_TOOLS.has(name) || name === "read";
    if (mode !== "engineer" && WRITE_TOOLS.has(name)) return false;
    return true;
  });
}

export function applyMode(pi: ExtensionAPI, rt: Runtime): void {
  try {
    const all = pi.getAllTools().map((t) => t.name);
    pi.setActiveTools(computeActiveTools(all, rt));
  } catch {
    /* older Pi without tool activation APIs: keep defaults */
  }
}

export { SAILOR_TOOLS };
