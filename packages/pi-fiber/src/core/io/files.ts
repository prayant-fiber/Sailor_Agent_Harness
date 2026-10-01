import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { readTable, toCsv, type Table } from "./csv";

export const MAX_MOSAIC_BYTES = 50 * 1024 * 1024;

export interface InputFile { path: string; bytes: number; table: Table; sheetName?: string }

/** Reads CSV/TSV/TXT natively; XLSX via the optional `exceljs` package (E11). */
export async function readInputFile(path: string, opts: { sheet?: string } = {}): Promise<InputFile> {
  const bytes = statSync(path).size;
  const ext = extname(path).toLowerCase();
  if (ext === ".xlsx" || ext === ".xlsm") {
    let ExcelJS: any;
    try {
      ExcelJS = (await import("exceljs" as string)).default;
    } catch {
      throw new Error("Reading .xlsx needs the optional `exceljs` package (npm i -g exceljs), or export the sheet as CSV.");
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const ws = opts.sheet ? wb.getWorksheet(opts.sheet) : wb.worksheets[0];
    if (!ws) throw new Error(`Sheet "${opts.sheet}" not found. Sheets: ${wb.worksheets.map((w: any) => w.name).join(", ")}`);
    const lines: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row: any) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell: any, col: number) => { cells[col - 1] = cell.text ?? String(cell.value ?? ""); });
      lines.push(cells.map((c) => c ?? ""));
    });
    // Merged cells: exceljs repeats master value via cell.text for merged ranges → forward-filled already.
    const csv = lines.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    return { path, bytes, table: readTable(new TextEncoder().encode(csv), { delimiter: "," }), sheetName: ws.name };
  }
  const buf = readFileSync(path);
  return { path, bytes, table: readTable(buf, ext === ".tsv" ? { delimiter: "\t" } : {}) };
}

export function siblingPath(path: string, suffix: string, ext = ".csv"): string {
  const base = basename(path, extname(path));
  return join(dirname(path), `${base}${suffix}${ext}`);
}

export function writeCsvFile(path: string, headers: string[], rows: Record<string, unknown>[], opts: { bom?: boolean } = {}): string {
  writeFileSync(path, toCsv(headers, rows, { bom: opts.bom ?? true, escapeFormulas: true }), "utf8");
  return path;
}

export async function writeXlsxFile(path: string, headers: string[], rows: Record<string, unknown>[], sheetName = "Sailor"): Promise<string> {
  let ExcelJS: any;
  try {
    ExcelJS = (await import("exceljs" as string)).default;
  } catch {
    throw new Error("Writing .xlsx needs the optional `exceljs` package (npm i -g exceljs). CSV export works without it.");
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(headers.map((h) => { const v = r[h]; return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v; }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  await wb.xlsx.writeFile(path);
  return path;
}
