import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { listExportRows, PRESETS, type Preset } from "../../core/export/rows";
import { getAccessToken, googleClientFromEnv } from "../../core/google/oauth";
import { exportToSheet, parseSheetUrl } from "../../core/google/sheets";
import { writeCsvFile, writeXlsxFile } from "../../core/io/files";
import { slugify } from "../../core/store/db";
import type { Runtime } from "../runtime";
import { ok, registerSailorTool } from "./common";

const Str = (d: string) => Type.Optional(Type.String({ description: d }));

export interface ExportArgs { list: string; target: "sheets" | "csv" | "xlsx"; title?: string; sheetUrl?: string; mode?: "new" | "append" | "upsert"; keyColumn?: string; preset?: Preset; validOnly?: boolean; path?: string }

export async function doExport(rt: Runtime, a: ExportArgs, onProgress?: (msg: string) => void): Promise<string> {
  const list = rt.store.getList(a.list);
  if (!list) throw new Error(`No list "${a.list}".`);
  const { headers, rows, skippedDnc, skippedInvalid } = listExportRows(rt.store, list.id, { preset: a.preset, validOnly: a.validOnly });
  const skipped = `${skippedDnc ? ` ${skippedDnc} do-not-contact/excluded rows left out.` : ""}${skippedInvalid ? ` ${skippedInvalid} rows without a valid email left out.` : ""}`;
  if (!rows.length) return `Nothing to export from "${list.name}".${skipped}`;
  if (a.target === "sheets") {
    const token = await getAccessToken(googleClientFromEnv(rt.config.google.clientIdEnv, rt.config.google.clientSecretEnv));
    let existing = a.sheetUrl ? parseSheetUrl(a.sheetUrl) : undefined;
    let mode = a.mode;
    if (!existing && a.mode && a.mode !== "new") {
      const last = rt.store.lastExport(list.id, "sheets");
      if (last) existing = parseSheetUrl(last.url);
    }
    if (!existing) mode = "new";
    const r = await exportToSheet(token, headers, rows, { title: a.title ?? `${list.name} — Sailor`, existing, mode, keyColumn: a.keyColumn, onProgress: (d, t) => onProgress?.(`wrote ${d}/${t} rows`) });
    rt.store.addExport(list.id, "sheets", r.url, mode);
    return `Exported "${list.name}" to Google Sheets: ${r.url}\n${r.appended} rows appended${r.updated ? `, ${r.updated} updated` : ""}.${skipped}`;
  }
  const dir = a.path && !/\.(csv|xlsx)$/i.test(a.path) ? (isAbsolute(a.path) ? a.path : resolve(rt.cwd, a.path)) : rt.cwd;
  const file = a.path && /\.(csv|xlsx)$/i.test(a.path) ? (isAbsolute(a.path) ? a.path : resolve(rt.cwd, a.path)) : join(dir, `${slugify(list.name)}${a.preset && a.preset !== "raw" ? `.${a.preset}` : ""}.${a.target}`);
  if (a.target === "xlsx") await writeXlsxFile(file, headers, rows, list.name.slice(0, 31));
  else writeCsvFile(file, headers, rows);
  rt.store.addExport(list.id, a.target, file);
  return `Wrote ${rows.length} rows to ${file}.${skipped} (Cells starting with = + - @ are escaped to prevent spreadsheet formula injection.)`;
}

export function registerExportTools(pi: ExtensionAPI, rt: Runtime): void {
  registerSailorTool(pi, rt, {
    name: "export_list",
    label: "Export list",
    lite: true,
    needsKey: false,
    description: "Export a Sailor list to Google Sheets (new sheet, append, or upsert by key column) or to a local CSV/XLSX. Presets map columns for outreach, apollo, hubspot, salesloft, instantly, smartlead. Do-not-contact rows are always left out. Free (no Fiber credits).",
    parameters: Type.Object({
      list: Type.String(),
      target: StringEnum(["sheets", "csv", "xlsx"] as const),
      title: Str("Spreadsheet title (new sheet)"),
      sheetUrl: Str("Existing Google Sheet URL to append/upsert into"),
      mode: Type.Optional(StringEnum(["new", "append", "upsert"] as const)),
      keyColumn: Str("Upsert key column (default: LinkedIn, else email)"),
      preset: Type.Optional(StringEnum(PRESETS)),
      validOnly: Type.Optional(Type.Boolean({ description: "Only rows whose work email validated ok", default: false })),
      path: Str("Output file or directory for csv/xlsx (default: current directory)"),
    }),
    async execute(p: any, _ctx, { onUpdate }) {
      return ok(await doExport(rt, p, onUpdate));
    },
  });
}
