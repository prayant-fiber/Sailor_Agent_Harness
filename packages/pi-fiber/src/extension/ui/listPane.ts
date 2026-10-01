/**
 * ListPane (F5): interactive, virtualized table of a Sailor list, rendered with pi-tui's Component contract
 * (render(width) → lines, handleInput(data), invalidate()). Paid actions are returned to the caller via
 * `done(action)` so the command handler can run them through the same cost-approval path as tools.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import type { ItemRow, ListRow, Store } from "../../core/store/db";
import { localTime } from "../../core/time";
import { fmtMoney } from "../../core/fiber/entities";
import { companyCard, personCard, type Paint } from "./cards";
import { displayWidth, pad, padLeft, truncate } from "./text";

export type PaneAction =
  | { action: "close"; state: PaneState }
  | { action: "enrich" | "validate" | "export" | "resolve" | "sheets"; ids: string[]; state: PaneState };

export interface PaneState { cursor: number; top: number; selected: string[]; filter: string; sort: SortKey; preset: number }
type SortKey = "position" | "name" | "company" | "status";
const SORTS: SortKey[] = ["position", "name", "company", "status"];

const RAW: Record<string, string[]> = {
  up: ["\x1b[A", "\x1bOA"], down: ["\x1b[B", "\x1bOB"], pageup: ["\x1b[5~"], pagedown: ["\x1b[6~"],
  home: ["\x1b[H", "\x1b[1~", "\x1bOH"], end: ["\x1b[F", "\x1b[4~", "\x1bOF"], enter: ["\r", "\n"],
  escape: ["\x1b"], backspace: ["\x7f", "\b"], space: [" "], tab: ["\t"],
};

function is(data: string, name: keyof typeof RAW | string): boolean {
  try { if (matchesKey(data, name as any)) return true; } catch { /* key name unsupported by this pi-tui version */ }
  return (RAW[name] ?? []).includes(data);
}

export class ListPane implements Component {
  private items: ItemRow[] = [];
  private view: ItemRow[] = [];
  private cursor = 0;
  private top = 0;
  private selected = new Set<string>();
  private filter = "";
  private filterDraft: string | null = null;
  private sort: SortKey = "position";
  private preset = 0;
  private card: ItemRow | null = null;
  private cardScroll = 0;
  private flash = "";
  private cache?: { width: number; lines: string[] };
  private readonly paint: Paint;

  constructor(
    private readonly store: Store,
    private readonly list: ListRow,
    private readonly theme: Theme,
    private readonly done: (a: PaneAction) => void,
    private readonly requestRender: () => void,
    initial?: Partial<PaneState>,
    private readonly viewportRows = Math.max(8, (process.stdout.rows || 30) - 10),
  ) {
    this.paint = (c, t) => { try { return theme.fg(c as any, t); } catch { return t; } };
    this.reload();
    if (initial) {
      this.filter = initial.filter ?? "";
      this.sort = initial.sort ?? "position";
      this.preset = initial.preset ?? 0;
      this.selected = new Set(initial.selected ?? []);
      this.applyView();
      this.cursor = Math.min(initial.cursor ?? 0, Math.max(0, this.view.length - 1));
      this.top = Math.min(initial.top ?? 0, this.cursor);
    }
  }

  private reload(): void {
    this.items = this.store.items(this.list.id, { withContacts: true });
    this.applyView();
  }

  private applyView(): void {
    const f = this.filter.toLowerCase();
    let v = f ? this.items.filter((it) => JSON.stringify([it.entity?.name, it.entity?.summary, it.status, it.contacts?.map((c) => c.value)]).toLowerCase().includes(f)) : [...this.items];
    const key = (it: ItemRow): string => {
      const s: any = it.entity?.summary ?? {};
      if (this.sort === "name") return (s.name ?? it.entity?.name ?? "").toLowerCase();
      if (this.sort === "company") return (s.company ?? s.domain ?? "").toLowerCase();
      if (this.sort === "status") return it.status;
      return String(it.position).padStart(8, "0");
    };
    v = v.sort((a, b) => key(a).localeCompare(key(b)));
    this.view = v;
    this.cursor = Math.min(this.cursor, Math.max(0, v.length - 1));
    this.invalidate();
  }

  private state(): PaneState {
    return { cursor: this.cursor, top: this.top, selected: [...this.selected], filter: this.filter, sort: this.sort, preset: this.preset };
  }

  private targetIds(): string[] {
    if (this.selected.size) return [...this.selected];
    const cur = this.view[this.cursor];
    return cur ? [cur.entity_id] : [];
  }

  invalidate(): void {
    this.cache = undefined;
  }

  handleInput(data: string): void {
    if (this.filterDraft !== null) return this.handleFilterInput(data);
    if (this.card) return this.handleCardInput(data);
    const n = this.view.length;
    if (is(data, "up") || data === "k") this.cursor = Math.max(0, this.cursor - 1);
    else if (is(data, "down") || data === "j") this.cursor = Math.min(n - 1, this.cursor + 1);
    else if (is(data, "pageup")) this.cursor = Math.max(0, this.cursor - this.viewportRows);
    else if (is(data, "pagedown")) this.cursor = Math.min(n - 1, this.cursor + this.viewportRows);
    else if (is(data, "home") || data === "g") this.cursor = 0;
    else if (is(data, "end") || data === "G") this.cursor = Math.max(0, n - 1);
    else if (is(data, "space")) {
      const id = this.view[this.cursor]?.entity_id;
      if (id) { if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id); this.cursor = Math.min(n - 1, this.cursor + 1); }
    } else if (data === "a") {
      if (this.selected.size === n) this.selected.clear(); else this.view.forEach((it) => this.selected.add(it.entity_id));
    } else if (is(data, "enter")) { this.card = this.view[this.cursor] ?? null; this.cardScroll = 0; }
    else if (data === "/") this.filterDraft = this.filter;
    else if (data === "s") { this.sort = SORTS[(SORTS.indexOf(this.sort) + 1) % SORTS.length]; this.applyView(); }
    else if (data === "c") this.preset = (this.preset + 1) % 2;
    else if (data === "d") this.toggleExclude();
    else if (data === "e" && this.list.kind === "people") return this.done({ action: "enrich", ids: this.targetIds(), state: this.state() });
    else if (data === "v" && this.list.kind === "people") return this.done({ action: "validate", ids: this.targetIds(), state: this.state() });
    else if (data === "r") return this.done({ action: "resolve", ids: this.targetIds(), state: this.state() });
    else if (data === "x") return this.done({ action: "export", ids: this.targetIds(), state: this.state() });
    else if (data === "S") return this.done({ action: "sheets", ids: this.targetIds(), state: this.state() });
    else if (data === "q" || is(data, "escape") || is(data, "ctrl+c")) return this.done({ action: "close", state: this.state() });
    else return;
    this.ensureVisible();
    this.invalidate();
    this.requestRender();
  }

  private toggleExclude(): void {
    const ids = this.targetIds();
    for (const id of ids) {
      const it = this.items.find((x) => x.entity_id === id);
      if (!it) continue;
      const next = it.status === "excluded" ? "new" : "excluded";
      this.store.setItemStatus(this.list.id, id, next);
      it.status = next;
      if (next === "excluded") {
        const e = it.entity!;
        if (e.linkedin_url) this.store.addDnc(e.linkedin_url, "linkedin", "excluded in list pane");
        if (e.email) this.store.addDnc(e.email, "email", "excluded in list pane");
      } else {
        const e = it.entity!;
        if (e.linkedin_url) this.store.removeDnc(e.linkedin_url);
        if (e.email) this.store.removeDnc(e.email);
      }
    }
    this.flash = `${ids.length} row(s) toggled do-not-contact`;
  }

  private handleFilterInput(data: string): void {
    if (is(data, "enter")) { this.filter = this.filterDraft ?? ""; this.filterDraft = null; this.cursor = 0; this.top = 0; this.applyView(); }
    else if (is(data, "escape")) this.filterDraft = null;
    else if (is(data, "backspace")) this.filterDraft = (this.filterDraft ?? "").slice(0, -1);
    else if (data.length === 1 && data >= " ") this.filterDraft += data;
    this.invalidate();
    this.requestRender();
  }

  private handleCardInput(data: string): void {
    if (is(data, "escape") || is(data, "backspace") || data === "q" || is(data, "enter")) this.card = null;
    else if (is(data, "down") || data === "j") this.cardScroll++;
    else if (is(data, "up") || data === "k") this.cardScroll = Math.max(0, this.cardScroll - 1);
    else if (data === "e" && this.list.kind === "people" && this.card) { const id = this.card.entity_id; this.card = null; return this.done({ action: "enrich", ids: [id], state: this.state() }); }
    else if (data === "n") { this.cursor = Math.min(this.view.length - 1, this.cursor + 1); this.card = this.view[this.cursor]; this.cardScroll = 0; }
    else if (data === "p") { this.cursor = Math.max(0, this.cursor - 1); this.card = this.view[this.cursor]; this.cardScroll = 0; }
    this.invalidate();
    this.requestRender();
  }

  private ensureVisible(): void {
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + this.viewportRows) this.top = this.cursor - this.viewportRows + 1;
  }

  render(width: number): string[] {
    if (this.cache && this.cache.width === width) return this.cache.lines;
    const p = this.paint;
    const lines: string[] = [];
    const title = ` ${this.list.name} · ${this.view.length}${this.filter ? `/${this.items.length}` : ""} ${this.list.kind} · sort: ${this.sort}${this.filter ? ` · filter: "${this.filter}"` : ""}${this.selected.size ? ` · ${this.selected.size} selected` : ""} `;
    lines.push(truncate(p("borderMuted", "─".repeat(2)) + p("accent", title) + p("borderMuted", "─".repeat(Math.max(0, width - displayWidth(title) - 2))), width));

    if (this.card) {
      const e = this.card.entity!;
      const body = this.list.kind === "people" ? personCard(e, this.card.contacts ?? [], width, p, this.card.notes) : companyCard(e, width, p, this.card.notes);
      lines.push(...body.slice(this.cardScroll, this.cardScroll + this.viewportRows + 2));
      lines.push(truncate(p("dim", ` esc back · ↑↓ scroll · n/p next/prev${this.list.kind === "people" ? " · e enrich" : ""}`), width));
      this.cache = { width, lines };
      return lines;
    }

    const cols = this.columns(width);
    lines.push(truncate(p("muted", cols.map((c) => (c.right ? padLeft(c.title, c.w) : pad(c.title, c.w))).join(" ")), width));
    if (!this.view.length) lines.push(p("dim", this.items.length ? "  no rows match the filter" : "  empty list"));
    const slice = this.view.slice(this.top, this.top + this.viewportRows);
    slice.forEach((it, i) => {
      const idx = this.top + i;
      let row = cols.map((c) => (c.right ? padLeft(c.get(it), c.w) : pad(c.get(it), c.w))).join(" ");
      if (idx === this.cursor) row = "▸" + row.slice(1); // plain text here, so slicing is safe
      const color = idx === this.cursor ? "accent" : it.status === "excluded" ? "dim" : it.status === "not_found" || it.status === "error" ? "warning" : "text";
      lines.push(truncate(p(color, row), width));
    });
    const pos = this.view.length ? `${this.cursor + 1}/${this.view.length}` : "0/0";
    if (this.filterDraft !== null) lines.push(truncate(p("accent", ` filter: ${this.filterDraft}▏`) + p("dim", "  (enter apply · esc cancel)"), width));
    else if (this.flash) { lines.push(truncate(p("success", ` ${this.flash}`), width)); this.flash = ""; }
    const keys = this.list.kind === "people"
      ? "↑↓ move · space select · a all · ⏎ card · e enrich · v validate · r re-resolve · d do-not-contact · x export · S sheets · / filter · s sort · c cols · q close"
      : "↑↓ move · space select · a all · ⏎ card · r re-resolve · d exclude · x export · S sheets · / filter · s sort · q close";
    lines.push(truncate(p("dim", ` ${pos} · ${keys}`), width));
    this.cache = { width, lines };
    return lines;
  }

  private columns(width: number): { title: string; w: number; right?: boolean; get: (it: ItemRow) => string }[] {
    const sel = { title: " ✓", w: 2, get: (it: ItemRow) => (this.selected.has(it.entity_id) ? " ●" : "  ") };
    const st = { title: "Status", w: 9, get: (it: ItemRow) => it.status };
    if (this.list.kind === "people") {
      const email = (it: ItemRow) => {
        const c = (it.contacts ?? []).find((x) => x.type === "work_email") ?? (it.contacts ?? []).find((x) => x.type === "personal_email");
        if (!c) return "";
        const b = c.validity === "valid" || c.validity === "ok" ? "✓" : c.validity === "risky" || c.validity === "catch_all" ? "~" : c.validity === "invalid" || c.validity === "undeliverable" ? "✗" : "?";
        return this.preset === 1 ? `${b} ${c.value}` : b;
      };
      const flex = [
        { title: "Name", weight: 3, get: (it: ItemRow) => (it.entity?.summary as any)?.name ?? it.entity?.name ?? "" },
        { title: "Title", weight: 4, get: (it: ItemRow) => (it.entity?.summary as any)?.title ?? "" },
        { title: "Company", weight: 3, get: (it: ItemRow) => (it.entity?.summary as any)?.company ?? "" },
      ];
      const fixed = [
        { title: this.preset === 1 ? "Email" : "@", w: this.preset === 1 ? 30 : 2, get: email },
        { title: "Local", w: 5, get: (it: ItemRow) => localTime((it.entity?.summary as any)?.timezone) ?? "" },
        st,
      ];
      return layout(width, sel, flex, fixed);
    }
    const flex = [
      { title: "Company", weight: 3, get: (it: ItemRow) => (it.entity?.summary as any)?.name ?? it.entity?.name ?? "" },
      { title: "Domain", weight: 2, get: (it: ItemRow) => (it.entity?.summary as any)?.domain ?? it.entity?.domain ?? "" },
      { title: "Industry", weight: 2, get: (it: ItemRow) => (it.entity?.summary as any)?.industry ?? "" },
    ];
    const fixed = [
      { title: "HC", w: 6, right: true, get: (it: ItemRow) => String((it.entity?.summary as any)?.headcount ?? "") },
      { title: "Funding", w: 14, get: (it: ItemRow) => { const f = (it.entity?.summary as any)?.latestFunding; return f ? `${f.stage ?? ""}${f.amountUsd ? ` $${fmtMoney(f.amountUsd)}` : ""}` : ""; } },
      st,
    ];
    return layout(width, sel, flex, fixed);
  }
}

function layout(width: number, sel: any, flex: { title: string; weight: number; get: (it: ItemRow) => string }[], fixed: any[]) {
  // K1: drop fixed columns right-to-left (keeping status) until flex columns get ≥ 8 cols each.
  let fx = [...fixed];
  const need = () => sel.w + fx.reduce((s, c) => s + c.w + 1, 0) + flex.length * 9;
  while (fx.length > 1 && need() > width) fx.splice(fx.length - 2, 1);
  let fl = [...flex];
  while (fl.length > 1 && sel.w + fx.reduce((s, c) => s + c.w + 1, 0) + fl.length * 9 > width) fl.pop();
  const remaining = Math.max(fl.length * 8, width - sel.w - 1 - fx.reduce((s, c) => s + c.w + 1, 0) - fl.length);
  const totalW = fl.reduce((s, c) => s + c.weight, 0);
  const flexCols = fl.map((c) => ({ title: c.title, w: Math.max(6, Math.floor((remaining * c.weight) / totalW)), get: c.get }));
  return [sel, ...flexCols, ...fx];
}
