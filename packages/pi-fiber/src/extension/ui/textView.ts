import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import { displayWidth, truncate } from "./text";

class TextView implements Component {
  private scroll = 0;
  constructor(private title: string, private lines: string[], private theme: Theme, private done: () => void, private rows = Math.max(8, (process.stdout.rows || 30) - 8)) {}
  private k(data: string, name: string, ...raw: string[]): boolean {
    try { if (matchesKey(data, name as any)) return true; } catch { /* ignore */ }
    return raw.includes(data);
  }
  handleInput(data: string): void {
    if (this.k(data, "escape", "\x1b") || data === "q" || this.k(data, "enter", "\r") || this.k(data, "ctrl+c", "\x03")) return this.done();
    if (this.k(data, "down", "\x1b[B") || data === "j") this.scroll = Math.min(Math.max(0, this.lines.length - this.rows), this.scroll + 1);
    if (this.k(data, "up", "\x1b[A") || data === "k") this.scroll = Math.max(0, this.scroll - 1);
    if (this.k(data, "pagedown", "\x1b[6~")) this.scroll = Math.min(Math.max(0, this.lines.length - this.rows), this.scroll + this.rows);
    if (this.k(data, "pageup", "\x1b[5~")) this.scroll = Math.max(0, this.scroll - this.rows);
  }
  render(width: number): string[] {
    const t = ` ${this.title} `;
    const head = this.theme.fg("borderMuted", "──") + this.theme.fg("accent", t) + this.theme.fg("borderMuted", "─".repeat(Math.max(0, width - displayWidth(t) - 2)));
    const body = this.lines.slice(this.scroll, this.scroll + this.rows).map((l) => truncate(l, width));
    const more = this.lines.length > this.rows ? ` ${this.scroll + 1}-${Math.min(this.lines.length, this.scroll + this.rows)}/${this.lines.length} · ↑↓ scroll ·` : "";
    return [truncate(head, width), ...body, truncate(this.theme.fg("dim", `${more} esc/q close`), width)];
  }
  invalidate(): void {}
}

/** Show a read-only, scrollable panel in the TUI; print to stdout in headless modes. */
export async function showText(ctx: ExtensionContext, title: string, lines: string[]): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    if (ctx.hasUI) ctx.ui.notify(`${title}\n${lines.join("\n")}`, "info");
    else console.log(`${title}\n${lines.join("\n")}`);
    return;
  }
  await ctx.ui.custom<void>((_tui, theme, _kb, done) => new TextView(title, lines, theme, () => done()));
}
