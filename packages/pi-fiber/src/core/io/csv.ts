/**
 * Tolerant CSV/TSV reader + safe writer (edge cases E1–E5, E12). No dependencies.
 */

export interface DecodeResult { text: string; encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "windows-1252" }

export function decodeBuffer(buf: Uint8Array): DecodeResult {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: new TextDecoder("utf-8").decode(buf.subarray(3)), encoding: "utf-8-bom" };
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(buf.subarray(2)), encoding: "utf-16le" };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(buf.subarray(2)), encoding: "utf-16be" };
  // BOM-less UTF-16LE (Excel "Unicode Text"): many NULs at odd offsets
  const sample = buf.subarray(0, Math.min(buf.length, 400));
  let oddNul = 0;
  for (let i = 1; i < sample.length; i += 2) if (sample[i] === 0) oddNul++;
  if (sample.length > 20 && oddNul > sample.length / 4) return { text: new TextDecoder("utf-16le").decode(buf), encoding: "utf-16le" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(buf), encoding: "windows-1252" };
  }
}

const CANDIDATES = [",", ";", "\t", "|"] as const;
export type Delimiter = (typeof CANDIDATES)[number];

/** Count delimiter occurrences outside quotes per line; pick the one with the most consistent non-zero count. */
export function sniffDelimiter(text: string): Delimiter {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 50);
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => {
      let n = 0, q = false;
      for (const ch of l) { if (ch === '"') q = !q; else if (!q && ch === d) n++; }
      return n;
    }).filter((n) => n > 0);
    if (!counts.length) continue;
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    const [mode, modeCount] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    const score = (modeCount / lines.length) * 10 + Math.min(mode, 10) * 0.1 + counts.length / lines.length;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export interface ParseIssue { line: number; message: string }

/** RFC 4180 parser that tolerates quoted newlines, doubled quotes, stray quotes and ragged rows. */
export function parseCsv(text: string, delimiter: string = ","): { rows: string[][]; issues: ParseIssue[] } {
  const rows: string[][] = [];
  const issues: ParseIssue[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let fieldStartLine = 1;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field.trim() === "") { inQuotes = true; field = ""; fieldStartLine = line; }
      else field += ch; // stray quote inside an unquoted field
    } else if (ch === delimiter) pushField();
    else if (ch === "\r") { if (text[i + 1] === "\n") i++; pushRow(); line++; }
    else if (ch === "\n") { pushRow(); line++; }
    else field += ch;
  }
  if (inQuotes) issues.push({ line: fieldStartLine, message: "Unterminated quoted field; parsed to end of file." });
  if (field !== "" || row.length) pushRow();
  return { rows, issues };
}

function isBlankRow(r: string[]): boolean {
  return r.every((c) => !c || !c.trim());
}

/** Picks the header row among the first 15 rows (header may not be row 1 — E3). */
export function detectHeaderRow(rows: string[][]): number {
  let best = 0, bestScore = -Infinity;
  const limit = Math.min(rows.length, 15);
  const typicalWidth = mode(rows.slice(0, 60).filter((r) => !isBlankRow(r)).map((r) => r.filter((c) => c.trim()).length));
  for (let i = 0; i < limit; i++) {
    const r = rows[i];
    if (isBlankRow(r)) continue;
    const cells = r.map((c) => c.trim()).filter(Boolean);
    if (cells.length < Math.max(1, Math.floor(typicalWidth * 0.6))) continue;
    const alpha = cells.filter((c) => /[A-Za-z]/.test(c) && !/@|\d{4,}|https?:/.test(c)).length;
    const unique = new Set(cells.map((c) => c.toLowerCase())).size;
    const knownHeader = cells.filter((c) => HEADER_HINT.test(c)).length;
    const score = alpha * 2 + unique + knownHeader * 5 - i * 0.5;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

const HEADER_HINT = /^(first|last|full)?\s*_?(name|email|e-mail|mail|company|organization|org|account|domain|website|url|linkedin|title|job|role|position|phone|mobile|city|state|country|location|notes?|id)\b/i;

function mode(ns: number[]): number {
  const f = new Map<number, number>();
  for (const n of ns) f.set(n, (f.get(n) ?? 0) + 1);
  return [...f.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
}

export function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h, i) => {
    let base = h.replace(/^﻿/, "").replace(/\s+/g, " ").trim() || `column_${i + 1}`;
    const key = base.toLowerCase();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n > 0) base = `${base}_${n + 1}`;
    return base;
  });
}

export interface Table {
  headers: string[];
  records: Record<string, string>[];
  encoding: DecodeResult["encoding"];
  delimiter: string;
  headerRowIndex: number;
  skippedPreambleRows: number;
  droppedBlankRows: number;
  raggedRows: number;
  issues: ParseIssue[];
}

export function readTableFromText(text: string, opts: { delimiter?: string; encoding?: DecodeResult["encoding"] } = {}): Table {
  const delimiter = opts.delimiter ?? sniffDelimiter(text);
  const { rows, issues } = parseCsv(text, delimiter);
  const headerRowIndex = detectHeaderRow(rows);
  const headers = dedupeHeaders(rows[headerRowIndex] ?? []);
  let dropped = 0, ragged = 0;
  const records: Record<string, string>[] = [];
  for (const r of rows.slice(headerRowIndex + 1)) {
    if (isBlankRow(r)) { dropped++; continue; }
    if (r.length !== headers.length) ragged++;
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { rec[h] = (r[i] ?? "").trim(); });
    if (r.length > headers.length) rec.__extra = r.slice(headers.length).join(delimiter);
    records.push(rec);
  }
  return { headers, records, encoding: opts.encoding ?? "utf-8", delimiter, headerRowIndex, skippedPreambleRows: headerRowIndex, droppedBlankRows: dropped, raggedRows: ragged, issues };
}

export function readTable(buf: Uint8Array, opts: { delimiter?: string } = {}): Table {
  const { text, encoding } = decodeBuffer(buf);
  return readTableFromText(text, { ...opts, encoding });
}

/** Formula/CSV injection guard (E5): prefix dangerous leading chars with an apostrophe, but keep plain numbers like -5. */
export function escapeFormula(value: unknown): string {
  const s = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) return `'${s}`;
  return s;
}

function quote(s: string, delimiter: string): string {
  return /["\r\n]/.test(s) || s.includes(delimiter) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[], opts: { delimiter?: string; bom?: boolean; escapeFormulas?: boolean } = {}): string {
  const d = opts.delimiter ?? ",";
  const esc = opts.escapeFormulas ?? true;
  const cell = (v: unknown) => quote(esc ? escapeFormula(v) : v == null ? "" : String(v), d);
  const lines = [headers.map((h) => quote(h, d)).join(d), ...rows.map((r) => headers.map((h) => cell(r[h])).join(d))];
  return (opts.bom ? "﻿" : "") + lines.join("\r\n") + "\r\n";
}
