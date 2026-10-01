/**
 * Width-aware text helpers (K1, K2). Dependency-free so they work in print/json/RPC modes and in tests.
 * Handles ANSI escapes, CJK/fullwidth characters and emoji (2 columns), and combining marks (0 columns).
 */
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

function charWidth(cp: number): number {
  if (cp === 0 || cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0f) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)
  ) return 2;
  return 1;
}

export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0)!);
  return w;
}

/** Truncate to `width` columns, preserving ANSI sequences, appending an ellipsis when cut. */
export function truncate(s: string, width: number, ellipsis = "…"): string {
  if (width <= 0) return "";
  if (displayWidth(s) <= width) return s;
  const target = width - displayWidth(ellipsis);
  let out = "", w = 0, i = 0;
  while (i < s.length) {
    ANSI.lastIndex = i;
    const m = ANSI.exec(s);
    if (m && m.index === i) { out += m[0]; i += m[0].length; continue; }
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    const cw = charWidth(ch.codePointAt(0)!);
    if (w + cw > target) break;
    out += ch; w += cw; i += ch.length;
  }
  return out + ellipsis + (/\x1b\[/.test(out) ? "\x1b[0m" : "");
}

export function pad(s: string, width: number): string {
  const t = truncate(s, width);
  return t + " ".repeat(Math.max(0, width - displayWidth(t)));
}

export function padLeft(s: string, width: number): string {
  const t = truncate(s, width);
  return " ".repeat(Math.max(0, width - displayWidth(t))) + t;
}

export function sparkline(values: number[]): string {
  const ticks = "▁▂▃▄▅▆▇█";
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return "";
  const min = Math.min(...v), max = Math.max(...v);
  return v.map((x) => ticks[max === min ? 3 : Math.round(((x - min) / (max - min)) * 7)]).join("");
}

/** Plain-text table for LLM-facing tool output (compact, no box drawing). */
export function textTable(headers: string[], rows: (string | number | undefined | null)[][], maxCol = 36): string {
  const cells = [headers, ...rows.map((r) => r.map((c) => (c === undefined || c === null ? "" : String(c)).replace(/\s+/g, " ")))];
  const widths = headers.map((_, i) => Math.min(maxCol, Math.max(...cells.map((r) => displayWidth(r[i] ?? "")))));
  return cells.map((r) => r.map((c, i) => pad(c ?? "", widths[i])).join(" | ").trimEnd()).join("\n");
}

export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if (displayWidth(line) + displayWidth(word) + (line ? 1 : 0) > width) { if (line) out.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}
