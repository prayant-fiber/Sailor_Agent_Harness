/**
 * Google Sheets v4 export/import over REST (F7, edge cases E5, J3–J5).
 *  - valueInputOption=RAW so "=HYPERLINK(...)" from scraped data is stored as text, never evaluated.
 *  - 1,000-row chunks with 429 back-off.
 *  - upsert by key column: existing rows updated in place, new rows appended, unknown headers appended at the end,
 *    user-added columns never deleted.
 */
const API = "https://sheets.googleapis.com/v4/spreadsheets";
export const SHEETS_CELL_LIMIT = 10_000_000;

export interface SheetRef { spreadsheetId: string; gid?: number }

export function parseSheetUrl(url: string): SheetRef | undefined {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return /^[a-zA-Z0-9-_]{25,}$/.test(url) ? { spreadsheetId: url } : undefined;
  const g = url.match(/[#&?]gid=(\d+)/);
  return { spreadsheetId: m[1], gid: g ? Number(g[1]) : undefined };
}

export function sheetUrl(id: string, gid?: number): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit${gid !== undefined ? `#gid=${gid}` : ""}`;
}

async function gapi(token: string, method: string, url: string, body?: unknown, attempt = 0): Promise<any> {
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    await new Promise((r) => setTimeout(r, Math.min(64_000, 1000 * 2 ** attempt) + Math.random() * 500));
    return gapi(token, method, url, body, attempt + 1);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`Google Sheets API ${res.status}: ${json.error?.message ?? text.slice(0, 300)}`);
  return json;
}

function a1Col(n: number): string {
  let s = "";
  for (n = n + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function cellValue(v: unknown): string | number | boolean {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export async function getSheetMeta(token: string, spreadsheetId: string): Promise<{ title: string; sheets: { sheetId: number; title: string; rowCount: number; columnCount: number }[] }> {
  const j = await gapi(token, "GET", `${API}/${spreadsheetId}?fields=properties.title,sheets.properties`);
  return { title: j.properties?.title, sheets: (j.sheets ?? []).map((s: any) => ({ sheetId: s.properties.sheetId, title: s.properties.title, rowCount: s.properties.gridProperties?.rowCount ?? 0, columnCount: s.properties.gridProperties?.columnCount ?? 0 })) };
}

export async function readSheet(token: string, ref: SheetRef): Promise<{ title: string; headers: string[]; rows: Record<string, string>[] }> {
  const meta = await getSheetMeta(token, ref.spreadsheetId);
  const tab = meta.sheets.find((s) => ref.gid === undefined || s.sheetId === ref.gid) ?? meta.sheets[0];
  const j = await gapi(token, "GET", `${API}/${ref.spreadsheetId}/values/${encodeURIComponent(quoteSheet(tab.title))}?valueRenderOption=FORMATTED_VALUE`);
  const values: string[][] = j.values ?? [];
  const headers = (values[0] ?? []).map((h) => String(h));
  const rows = values.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "")])));
  return { title: tab.title, headers, rows };
}

export interface ExportOptions {
  title?: string;
  existing?: SheetRef;
  mode?: "new" | "append" | "upsert";
  keyColumn?: string;
  tabTitle?: string;
  onProgress?: (done: number, total: number) => void;
}

export async function exportToSheet(token: string, headers: string[], rows: Record<string, unknown>[], opts: ExportOptions): Promise<{ url: string; spreadsheetId: string; updated: number; appended: number }> {
  if ((rows.length + 1) * headers.length > SHEETS_CELL_LIMIT * 0.9) throw new Error(`Too large for one spreadsheet (${rows.length} rows × ${headers.length} cols). Split the list or export CSV.`);
  const mode = opts.existing ? (opts.mode ?? "upsert") : "new";
  let spreadsheetId: string, tab: { sheetId: number; title: string };

  if (!opts.existing) {
    const created = await gapi(token, "POST", API, {
      properties: { title: opts.title ?? `Sailor export ${new Date().toISOString().slice(0, 10)}` },
      sheets: [{ properties: { title: opts.tabTitle ?? "Sailor", gridProperties: { frozenRowCount: 1 } } }],
    });
    spreadsheetId = created.spreadsheetId;
    tab = { sheetId: created.sheets[0].properties.sheetId, title: created.sheets[0].properties.title };
    await writeRange(token, spreadsheetId, tab.title, 0, [headers.map(cellValue)]);
    const appended = await appendRows(token, spreadsheetId, tab.title, 1, headers, rows, opts.onProgress);
    await formatHeader(token, spreadsheetId, tab.sheetId, headers.length);
    return { url: sheetUrl(spreadsheetId, tab.sheetId), spreadsheetId, updated: 0, appended };
  }

  spreadsheetId = opts.existing.spreadsheetId;
  const meta = await getSheetMeta(token, spreadsheetId);
  tab = (opts.tabTitle ? meta.sheets.find((s) => s.title === opts.tabTitle) : meta.sheets.find((s) => opts.existing!.gid === undefined || s.sheetId === opts.existing!.gid)) ?? meta.sheets[0];
  const current = await gapi(token, "GET", `${API}/${spreadsheetId}/values/${encodeURIComponent(quoteSheet(tab.title))}?valueRenderOption=UNFORMATTED_VALUE`);
  const values: any[][] = current.values ?? [];
  let sheetHeaders: string[] = (values[0] ?? []).map(String);
  // J4: header mapping — keep user columns, append new ones at the end
  const missing = headers.filter((h) => !sheetHeaders.includes(h));
  if (!sheetHeaders.length) sheetHeaders = [...headers];
  else sheetHeaders = [...sheetHeaders, ...missing];
  if (missing.length || !values.length) await writeRange(token, spreadsheetId, tab.title, 0, [sheetHeaders]);

  let updated = 0;
  let toAppend = rows;
  if (mode === "upsert") {
    const key = opts.keyColumn ?? headers.find((h) => /linkedin/i.test(h)) ?? headers.find((h) => /email/i.test(h)) ?? headers[0];
    const keyIdx = sheetHeaders.indexOf(key);
    const index = new Map<string, number>();
    values.slice(1).forEach((r, i) => { const k = String(r[keyIdx] ?? "").trim().toLowerCase(); if (k) index.set(k, i + 1); });
    toAppend = [];
    const updates: { range: string; values: any[][] }[] = [];
    for (const row of rows) {
      const k = String(row[key] ?? "").trim().toLowerCase();
      const at = k ? index.get(k) : undefined;
      if (at === undefined) { toAppend.push(row); continue; }
      // J5: only write Sailor-owned columns (those in `headers`); leave user columns untouched
      for (const h of headers) {
        const col = sheetHeaders.indexOf(h);
        updates.push({ range: `${quoteSheet(tab.title)}!${a1Col(col)}${at + 1}`, values: [[cellValue(row[h])]] });
      }
      updated++;
    }
    for (let i = 0; i < updates.length; i += 5000) {
      await gapi(token, "POST", `${API}/${spreadsheetId}/values:batchUpdate`, { valueInputOption: "RAW", data: updates.slice(i, i + 5000) });
    }
  }
  const startRow = Math.max(values.length, 1);
  const appended = await appendRows(token, spreadsheetId, tab.title, startRow, sheetHeaders, toAppend, opts.onProgress);
  return { url: sheetUrl(spreadsheetId, tab.sheetId), spreadsheetId, updated, appended };
}

async function writeRange(token: string, id: string, tab: string, row0: number, values: any[][]): Promise<void> {
  await gapi(token, "PUT", `${API}/${id}/values/${encodeURIComponent(`${quoteSheet(tab)}!A${row0 + 1}`)}?valueInputOption=RAW`, { values });
}

async function appendRows(token: string, id: string, tab: string, startRow: number, headers: string[], rows: Record<string, unknown>[], onProgress?: (d: number, t: number) => void): Promise<number> {
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000).map((r) => headers.map((h) => cellValue(r[h])));
    await writeRange(token, id, tab, startRow + i, chunk);
    onProgress?.(Math.min(i + 1000, rows.length), rows.length);
  }
  return rows.length;
}

async function formatHeader(token: string, id: string, sheetId: number, cols: number): Promise<void> {
  await gapi(token, "POST", `${API}/${id}:batchUpdate`, {
    requests: [
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.98 } } }, fields: "userEnteredFormat(textFormat,backgroundColor)" } },
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
      { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: cols } } } },
      { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: Math.min(cols, 26) } } },
    ],
  });
}

/** Is this Sheet readable without auth? (Mosaic can only read public sheets — D2.) */
export async function isSheetPublic(ref: SheetRef): Promise<boolean> {
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${ref.spreadsheetId}/export?format=csv${ref.gid !== undefined ? `&gid=${ref.gid}` : ""}`, { method: "GET", redirect: "manual" });
    return res.status === 200;
  } catch {
    return false;
  }
}
