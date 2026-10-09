/**
 * Fiber look for the terminal: replaces Pi's stock header/footer/spinner with Fiber-branded ones.
 *  - header: the Fiber wordmark (● F I B E R ᴬᴵ) + Sailor tagline + Build/Plan/Sandbox chips + key hints
 *  - footer: brand mark · mode chip · Fiber credits/session spend · other statuses │ model · context use; cwd · branch
 *  - working indicator in Fiber purple, mode-aware working message, terminal title "Sailor · Fiber AI"
 *  - themes/fiber-dark.json + fiber-light.json (loaded by the `sailor` launcher, or `pi --theme <pkg>/themes`)
 * Brand colours from fiber.ai: purple #9D78F0, deep violet #6A48E3, lavender #EEE7FF on zinc neutrals.
 * `/look pi` restores Pi's stock UI; `/look fiber` brings this back (saved in ~/.sailor/config.json).
 */
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { saveGlobalConfig, type AgentMode } from "../../core/config";
import { AGENT_MODES, AGENT_MODE_INFO, onAgentModeChange } from "../agentMode";
import type { Runtime } from "../runtime";

// ── brand palette (truecolor with 256-colour fallback; honours NO_COLOR) ────
type Rgb = [number, number, number];
export const FIBER = {
  purple: [157, 120, 240] as Rgb, // #9D78F0
  deep: [106, 72, 227] as Rgb, // #6A48E3
  lavender: [238, 231, 255] as Rgb, // #EEE7FF
  ink: [9, 9, 11] as Rgb, // #09090B
  zinc: [113, 113, 122] as Rgb, // #71717A
  zincDark: [63, 63, 70] as Rgb, // #3F3F46
  amber: [245, 165, 36] as Rgb, // sandbox
  white: [255, 255, 255] as Rgb,
};
const ANSI256: [Rgb, number][] = [[FIBER.purple, 141], [FIBER.deep, 99], [FIBER.lavender, 189], [FIBER.ink, 232], [FIBER.zinc, 243], [FIBER.zincDark, 238], [FIBER.amber, 214], [FIBER.white, 255]];

const noColor = () => !!process.env.NO_COLOR;
const truecolor = () => /^(truecolor|24bit)$/i.test(process.env.COLORTERM ?? "") || /(iTerm|WezTerm|ghostty|vscode)/i.test(process.env.TERM_PROGRAM ?? "");
function code(rgb: Rgb, layer: 38 | 48): string {
  if (truecolor()) return `\x1b[${layer};2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  const idx = ANSI256.find(([c]) => c === rgb)?.[1] ?? 255;
  return `\x1b[${layer};5;${idx}m`;
}
export const paint = (rgb: Rgb, s: string, bold = false) => (noColor() ? s : `${bold ? "\x1b[1m" : ""}${code(rgb, 38)}${s}\x1b[39m${bold ? "\x1b[22m" : ""}`);
export const chip = (bg: Rgb, fg: Rgb, s: string) => (noColor() ? `[${s.trim()}]` : `${code(bg, 48)}${code(fg, 38)}\x1b[1m${s}\x1b[22m\x1b[39m\x1b[49m`);

const MODE_CHIP: Record<AgentMode, { bg: Rgb; fg: Rgb }> = {
  build: { bg: FIBER.purple, fg: FIBER.ink },
  plan: { bg: FIBER.lavender, fg: FIBER.deep },
  sandbox: { bg: FIBER.amber, fg: FIBER.ink },
};
export const modeChip = (m: AgentMode) => chip(MODE_CHIP[m].bg, MODE_CHIP[m].fg, ` ${AGENT_MODE_INFO[m].label} `);

/** Theme-aware bold text (readable on light and dark terminals). */
const strong = (theme: Theme | undefined, s: string) => { try { return theme ? theme.bold(theme.fg("text", s)) : s; } catch { return s; } };

/** "● F I B E R ᴬᴵ" — the fiber.ai wordmark: round mark, letter-spaced caps, purple superscript AI. */
export function wordmark(theme?: Theme): string {
  return `${paint(FIBER.purple, "●", true)}  ${strong(theme, "F I B E R")} ${paint(FIBER.purple, "ᴬᴵ", true)}`;
}

const pad = (left: string, right: string, width: number) => {
  const gap = width - visibleWidth(left) - visibleWidth(right);
  return gap >= 1 ? left + " ".repeat(gap) + right : truncateToWidth(left, width);
};

// ── header ───────────────────────────────────────────────────────────────
export function headerLines(rt: Runtime, theme: Theme | undefined, width: number): string[] {
  const dim = (s: string) => { try { return theme ? theme.fg("dim", s) : s; } catch { return s; } };
  const muted = (s: string) => { try { return theme ? theme.fg("muted", s) : s; } catch { return s; } };
  const mode = rt.agentMode;
  const chips = AGENT_MODES.map((m) => (m === mode ? modeChip(m) : dim(` ${AGENT_MODE_INFO[m].label.toLowerCase()} `))).join(dim("·"));
  const rule = paint(FIBER.deep, "─".repeat(Math.max(0, Math.min(width, 72) - 2)));
  const lines = [
    "",
    ` ${wordmark(theme)}   ${paint(FIBER.purple, "Sailor", true)}`,
    ` ${muted("Prospect, enrich and reach out on Fiber's live B2B data.")}`,
    ` ${rule}`,
    ` ${chips}   ${dim(AGENT_MODE_INFO[mode].blurb)}`,
    ` ${dim("alt+m")} ${muted("mode")}  ${dim("/qualify")} ${dim("/lookalikes")} ${dim("/emails")} ${dim("/crm")}  ${dim("/lists")}  ${dim("ctrl+shift+k")} ${muted("credits")}`,
    "",
  ];
  return lines.map((l) => truncateToWidth(l, width));
}

// ── footer ───────────────────────────────────────────────────────────────
export function footerLines(rt: Runtime, ctx: ExtensionContext | undefined, theme: Theme | undefined, data: Pick<ReadonlyFooterDataProvider, "getGitBranch" | "getExtensionStatuses"> | undefined, width: number): string[] {
  const dim = (s: string) => { try { return theme ? theme.fg("dim", s) : s; } catch { return s; } };
  const muted = (s: string) => { try { return theme ? theme.fg("muted", s) : s; } catch { return s; } };
  const statuses = new Map(data?.getExtensionStatuses?.() ?? []);
  const fiber = statuses.get("fiber") ?? rt.meter?.text?.() ?? "";
  statuses.delete("fiber");
  const others = [...statuses.values()].filter(Boolean);
  const credit = fiber.replace(/^Fiber( SANDBOX)? ?/, "").replace(/^: ?/, "");
  const left = `${paint(FIBER.purple, "●", true)} ${strong(theme, "fiber")} ${dim("sailor")}  ${modeChip(rt.agentMode)}  ${muted(credit)}${others.length ? dim(`  ·  ${others.join("  ·  ")}`) : ""}`;
  let right = "";
  try {
    const usage = ctx?.getContextUsage?.();
    const model = ctx?.model?.id;
    right = dim([model, usage?.percent != null ? `ctx ${Math.round(usage.percent)}%` : ""].filter(Boolean).join(" · "));
  } catch { /* ctx outlived its session */ }
  const branch = data?.getGitBranch?.();
  const persona = rt.config?.mode && rt.config.mode !== "rep" ? ` · ${rt.config.mode}` : "";
  const line2 = dim(`  ${basename(rt.cwd || process.cwd())}${branch ? ` (${branch})` : ""}${persona}${rt.config?.crm?.provider ? ` · crm ${rt.config.crm.provider}` : ""}`);
  return [pad(left, right, width), truncateToWidth(line2, width)];
}

// ── install / uninstall ──────────────────────────────────────────────────
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const WORKING: Record<AgentMode, string> = { build: "Sailor is on it…", plan: "Planning (no credits)…", sandbox: "Sandbox run…" };

export function installFiberLook(rt: Runtime, ctx: ExtensionContext): void {
  if (!ctx.hasUI || ctx.mode !== "tui") return;
  const ui = ctx.ui;
  let requestRender: (() => void) | undefined;
  const component = (render: (w: number) => string[], tui: TUI): Component & { dispose?(): void } => {
    requestRender = () => { try { tui.requestRender(); } catch { /* closed */ } };
    const off = onAgentModeChange((m) => { applyWorking(m); requestRender?.(); });
    return { render, invalidate() {}, dispose: off };
  };
  const applyWorking = (m: AgentMode) => {
    try { ui.setWorkingMessage?.(WORKING[m]); } catch { /* older Pi */ }
  };
  try { ui.setHeader?.((tui, theme) => component((w) => headerLines(rt, theme, w), tui)); } catch { /* older Pi */ }
  try {
    ui.setFooter?.((tui, theme, data) => {
      const c = component((w) => footerLines(rt, ctx, theme, data, w), tui);
      const offBranch = data.onBranchChange?.(() => requestRender?.());
      const dispose = c.dispose;
      return { ...c, dispose: () => { dispose?.(); offBranch?.(); } };
    });
  } catch { /* older Pi */ }
  try { ui.setWorkingIndicator?.({ frames: SPINNER.map((f) => paint(FIBER.purple, f, true)), intervalMs: 80 }); } catch { /* older Pi */ }
  try { ui.setHiddenThinkingLabel?.("thinking"); } catch { /* older Pi */ }
  try { ui.setTitle?.("Sailor · Fiber AI"); } catch { /* ignore */ }
  applyWorking(rt.agentMode);
}

export function uninstallFiberLook(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  const ui = ctx.ui;
  for (const f of [() => ui.setHeader?.(undefined), () => ui.setFooter?.(undefined), () => ui.setWorkingIndicator?.(), () => ui.setWorkingMessage?.(), () => ui.setHiddenThinkingLabel?.()]) {
    try { f(); } catch { /* ignore */ }
  }
}

/** Picks fiber-dark / fiber-light if Pi loaded them (via the launcher or the package's `pi.themes`). */
export function applyFiberTheme(ctx: ExtensionContext): boolean {
  const ui = ctx.ui;
  try {
    const names = new Set((ui.getAllThemes?.() ?? []).map((t) => t.name));
    const light = /;(7|15)$/.test(process.env.COLORFGBG ?? "");
    const want = light ? "fiber-light" : "fiber-dark";
    return names.has(want) ? !!ui.setTheme?.(want)?.success : false;
  } catch { return false; }
}

export function registerFiberLook(pi: ExtensionAPI, rt: Runtime): void {
  pi.registerCommand("look", {
    description: "Terminal look: /look fiber (Fiber-branded header, footer and theme) | /look pi (Pi's stock UI)",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const want = (args ?? "").trim() || (rt.config.ui.look === "fiber" ? "pi" : "fiber");
      if (want !== "fiber" && want !== "pi") { ctx.ui?.notify("Usage: /look fiber | pi", "warning"); return; }
      saveGlobalConfig({ ui: { look: want } } as any);
      rt.reloadConfig();
      if (want === "fiber") {
        installFiberLook(rt, ctx);
        const themed = applyFiberTheme(ctx);
        ctx.ui?.notify(`Fiber look on${themed ? "" : " (start Sailor with the `sailor` launcher for the Fiber colour theme)"}.`, "info");
      } else {
        uninstallFiberLook(ctx);
        ctx.ui?.notify("Pi's stock look restored. Change the colour theme in /settings → Theme.", "info");
      }
    },
  });
}
