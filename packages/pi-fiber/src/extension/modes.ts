/**
 * Modes & tool profiles (F8, F12, A11):
 *  rep (default)  — GTM tools + read-only file tools; no shell / file-writing tools (safe for non-technical users)
 *  engineer       — everything, incl. Pi's coding tools, for vibe-coding with @fiberai/sdk
 *  recruiting     — rep toolset + recruiting prompt and fairness guardrails
 *  toolsProfile "lite" — ≤ ~10 core tools for small/local models
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "./runtime";
import { LITE_TOOLS, SAILOR_TOOLS } from "./tools/common";

const WRITE_TOOLS = new Set(["bash", "edit", "write"]);

export function computeActiveTools(all: string[], rt: Pick<Runtime, "config">): string[] {
  const { mode, toolsProfile } = rt.config;
  return all.filter((name) => {
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
