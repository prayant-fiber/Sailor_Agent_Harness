/**
 * One-command list repair (F4): parse locally → pick engine → estimate → (approve) → run.
 *   ≤ 50 resolvable rows      → Kitchen Sink bulk (sync, 50/call)
 *   51 – 20,000 rows / messy  → Mosaic (async; public URL; job-managed)
 *   > 20,000 rows             → split into ≤ 20k-row Mosaic runs, merged on import
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { sailorHome, type SailorConfig } from "../config";
import type { FiberClient } from "../fiber/client";
import type { Estimate } from "../fiber/ops";
import { mosaicEstimate } from "../fiber/ops";
import type { Pricing } from "../fiber/pricing";
import type { Gtm } from "../gtm";
import { buildIdentity, detectColumns, isResolvable, type ColumnMap, type Identity } from "../io/columns";
import { readTableFromText, toCsv, type Table } from "../io/csv";
import { MAX_MOSAIC_BYTES, readInputFile, siblingPath } from "../io/files";
import { emailKind, normalizeLinkedinUrl } from "../io/normalize";
import { summarizePerson } from "../fiber/entities";
import { hostFile, isPublicHttpsUrl, runCleanup, type CleanupSpec } from "../hosting";
import { isSheetPublic, parseSheetUrl } from "../google/sheets";
import type { JobHandler, PollOutcome } from "../jobs/manager";
import type { JobRow, ListKind, Store } from "../store/db";

export const MOSAIC_MAX_ROWS = 20_000;
export const KS_MAX_ROWS = 50;

export interface RepairOptions {
  contacts?: { workEmail?: boolean; personalEmail?: boolean; phone?: boolean };
  includeCompanyDetails?: boolean;
  liveFetch?: boolean;
  runRedline?: boolean;
  maxRows?: number;
  customInstructions?: string;
  engine?: "auto" | "kitchen-sink" | "mosaic";
  listName?: string;
  /** Public HTTPS URL for the file (manual hosting). */
  sourceUrl?: string;
  sheet?: string;
}

export interface Preflight {
  source: string;
  sourceType: "file" | "sheet" | "url";
  fileName: string;
  bytes?: number;
  table?: Table;
  rowCount: number;
  columns?: ColumnMap;
  entityKind: ListKind;
  resolvable: number;
  engine: "kitchen-sink" | "mosaic";
  chunks: number;
  fileHash?: string;
  previous?: { at: number; list_id: string | null; run_id: string | null };
  estimate: Estimate;
  warnings: string[];
  identities?: { identity: Identity; input: Record<string, string> }[];
  options: RepairOptions;
}

export function mosaicOptions(o: RepairOptions) {
  return {
    // Always explicit: Fiber defaults every contactInfo flag to TRUE.
    contactInfo: { getWorkEmails: !!o.contacts?.workEmail, getPersonalEmails: !!o.contacts?.personalEmail, getPhoneNumbers: !!o.contacts?.phone },
    includeCompanyDetails: !!o.includeCompanyDetails,
    liveFetch: o.liveFetch ?? true,
    runRedline: !!o.runRedline,
    ...(o.maxRows ? { maxRows: Math.min(MOSAIC_MAX_ROWS, o.maxRows) } : {}),
  };
}

export async function preflight(source: string, opts: RepairOptions, deps: { pricing: Pricing; store: Store; googleToken?: () => Promise<string | undefined> }): Promise<Preflight> {
  const warnings: string[] = [];
  const sheet = parseSheetUrl(source);
  if (sheet && /docs\.google\.com/.test(source)) {
    // Google Sheet: Mosaic reads public sheets directly (first tab only).
    let rows = 0;
    let table: Table | undefined;
    if (await isSheetPublic(sheet)) {
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/export?format=csv${sheet.gid !== undefined ? `&gid=${sheet.gid}` : ""}`);
      table = readTableFromText(await res.text());
      rows = table.records.length;
    } else {
      warnings.push("This Sheet is not public. Mosaic can only read public Sheets — share it as 'Anyone with the link: Viewer', or export it to CSV and run /repair on the file.");
    }
    if (sheet.gid !== undefined && sheet.gid !== 0) warnings.push("Mosaic processes only the FIRST tab of a Google Sheet. Move the tab you want to the first position, or export it to CSV.");
    const columns = table ? detectColumns(table.headers, table.records) : undefined;
    const pre = finalize({ source, sourceType: "sheet", fileName: "Google Sheet", table, rowCount: rows, columns, warnings, opts, pricing: deps.pricing });
    pre.engine = "mosaic"; // KS path needs local rows; public-sheet path goes straight to Mosaic
    pre.estimate = mosaicEstimate({ __rowCount: pre.rowCount, options: mosaicOptions(opts) }, deps.pricing);
    return pre;
  }

  if (/^https?:\/\//i.test(source)) {
    if (!isPublicHttpsUrl(source)) throw new Error("Source URL must be public HTTPS.");
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Could not fetch ${source}: HTTP ${res.status}. Mosaic needs a public, direct-download link.`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_MOSAIC_BYTES) warnings.push("File exceeds Mosaic's 50 MiB limit.");
    const table = readTableFromText(new TextDecoder().decode(buf));
    const pre = finalize({ source, sourceType: "url", fileName: basename(new URL(source).pathname) || "remote file", bytes: buf.byteLength, table, rowCount: table.records.length, columns: detectColumns(table.headers, table.records), warnings, opts, pricing: deps.pricing });
    pre.fileHash = createHash("sha256").update(buf).digest("hex");
    pre.previous = deps.store.findRepair(pre.fileHash);
    return pre;
  }

  if (!existsSync(source)) throw new Error(`File not found: ${source}`);
  const input = await readInputFile(source, { sheet: opts.sheet });
  const t = input.table;
  if (t.encoding === "windows-1252") warnings.push("File was not valid UTF-8; decoded as Windows-1252 (Excel default). Check accented names.");
  if (t.skippedPreambleRows) warnings.push(`Header found on row ${t.headerRowIndex + 1}; skipped ${t.skippedPreambleRows} preamble row(s).`);
  if (t.droppedBlankRows) warnings.push(`Dropped ${t.droppedBlankRows} blank row(s).`);
  if (t.raggedRows) warnings.push(`${t.raggedRows} row(s) had a different number of columns than the header.`);
  for (const i of t.issues) warnings.push(`Line ${i.line}: ${i.message}`);
  if (input.bytes > MAX_MOSAIC_BYTES) warnings.push(`File is ${(input.bytes / 1048576).toFixed(1)} MiB (> 50 MiB); it will be split.`);
  const columns = detectColumns(t.headers, t.records);
  const pre = finalize({ source, sourceType: "file", fileName: basename(source), bytes: input.bytes, table: t, rowCount: t.records.length, columns, warnings, opts, pricing: deps.pricing });
  pre.fileHash = createHash("sha256").update(readFileSync(source)).digest("hex");
  pre.previous = deps.store.findRepair(pre.fileHash);
  if (pre.previous) warnings.push(`This exact file was already repaired on ${new Date(pre.previous.at).toLocaleString()}${pre.previous.list_id ? ` (list ${pre.previous.list_id})` : ""}. Re-running will charge again.`);
  return pre;
}

function finalize(a: { source: string; sourceType: Preflight["sourceType"]; fileName: string; bytes?: number; table?: Table; rowCount: number; columns?: ColumnMap; warnings: string[]; opts: RepairOptions; pricing: Pricing }): Preflight {
  const kind = a.columns?.entityKind ?? "people";
  const identities = a.table && a.columns ? a.table.records.map((r) => ({ identity: buildIdentity(r, a.columns!), input: r })) : undefined;
  const resolvable = identities ? identities.filter((x) => isResolvable(x.identity, kind)).length : a.rowCount;
  const phoneWarn = identities?.filter((x) => x.identity.phoneWarning?.includes("scientific")).length ?? 0;
  if (phoneWarn) a.warnings.push(`${phoneWarn} phone value(s) look damaged by Excel (scientific notation).`);
  if (a.columns && !Object.keys(a.columns.roles).length) a.warnings.push("Could not recognise any identifier columns (email, LinkedIn, name, company, domain).");
  const rowsToProcess = a.opts.maxRows ? Math.min(a.opts.maxRows, a.rowCount) : a.rowCount;
  let engine: Preflight["engine"] =
    a.opts.engine && a.opts.engine !== "auto" ? a.opts.engine
      : rowsToProcess <= KS_MAX_ROWS && identities && resolvable / Math.max(1, rowsToProcess) >= 0.8 ? "kitchen-sink" : "mosaic";
  if (engine === "kitchen-sink" && !identities) engine = "mosaic";
  const chunks = engine === "mosaic" ? Math.max(1, Math.ceil(rowsToProcess / MOSAIC_MAX_ROWS), a.bytes ? Math.ceil(a.bytes / (45 * 1048576)) : 1) : Math.ceil(rowsToProcess / KS_MAX_ROWS);
  let estimate: Estimate;
  if (engine === "kitchen-sink") {
    const per = 2 + (a.opts.liveFetch ? 2 : 0);
    const c = a.opts.contacts;
    const contactPer = (c?.workEmail ? 2 : 0) + (c?.personalEmail ? 2 : 0) + (c?.phone ? 3 : 0);
    estimate = { credits: resolvable * (per + contactPer), basis: `${resolvable} resolvable rows × ${per} (Kitchen Sink)${contactPer ? ` + up to ${contactPer}/row contact reveal` : ""}` };
  } else {
    estimate = mosaicEstimate({ __rowCount: rowsToProcess, options: mosaicOptions(a.opts) }, a.pricing);
    estimate.basis += " · the org's first Mosaic run includes 1,000 free rows";
  }
  return { source: a.source, sourceType: a.sourceType, fileName: a.fileName, bytes: a.bytes, table: a.table, rowCount: a.rowCount, columns: a.columns, entityKind: kind, resolvable, engine, chunks, estimate, warnings: a.warnings, identities, options: a.opts };
}

export function preflightCard(p: Preflight): string {
  const cov = p.columns ? Object.entries(p.columns.roles).map(([role, h]) => `${role}=${h} (${Math.round((p.columns!.coverage[role as keyof typeof p.columns.coverage] ?? 0) * 100)}%)`).join(", ") : "n/a";
  const lines = [
    `${p.fileName} · ${p.rowCount.toLocaleString()} rows${p.table ? ` · ${p.table.encoding} · delimiter ${JSON.stringify(p.table.delimiter)} · header row ${p.table.headerRowIndex + 1}` : ""}`,
    `Detected: ${p.entityKind} · ${cov}`,
    `Resolvable rows: ${p.resolvable.toLocaleString()} / ${p.rowCount.toLocaleString()}`,
    `Engine: ${p.engine === "mosaic" ? `Mosaic (async${p.chunks > 1 ? `, ${p.chunks} runs` : ""})` : "Kitchen Sink bulk (sync)"}`,
    `Options: work email ${p.options.contacts?.workEmail ? "✓" : "✗"} · personal email ${p.options.contacts?.personalEmail ? "✓" : "✗"} · phone ${p.options.contacts?.phone ? "✓" : "✗"} · company details ${p.options.includeCompanyDetails ? "✓" : "✗"} · liveFetch ${p.options.liveFetch ?? true ? "✓" : "✗"}`,
    `Estimated: ~${p.estimate.credits.toLocaleString()} credits (${p.estimate.basis})`,
  ];
  if (p.warnings.length) lines.push(...p.warnings.map((w) => `⚠ ${w}`));
  return lines.join("\n");
}

// ── Kitchen Sink path ──────────────────────────────────────────────────────
export async function runKitchenSinkRepair(p: Preflight, gtm: Gtm, opts: { signal?: AbortSignal; onProgress?: (d: number, t: number) => void } = {}) {
  if (!p.identities) throw new Error("Kitchen Sink path needs local rows.");
  const list = gtm.store.createList(p.options.listName ?? `Repaired: ${p.fileName}`, p.entityKind, `repair:${p.fileName}`);
  const rows = p.options.maxRows ? p.identities.slice(0, p.options.maxRows) : p.identities;
  const resolvable = rows.filter((r) => isResolvable(r.identity, p.entityKind));
  const skipped = rows.filter((r) => !isResolvable(r.identity, p.entityKind));
  for (const [i, r] of skipped.entries()) {
    const e = gtm.store.upsertUnresolved(p.entityKind === "people" ? "person" : "company", { ...r.identity }, `${list.id}:skip:${i}`);
    gtm.store.addToList(list.id, e.id, { status: "not_found", input: r.input });
  }
  const res = await gtm.bulkResolve(p.entityKind, resolvable, { listId: list.id, liveFetch: p.options.liveFetch, signal: opts.signal, onProgress: opts.onProgress });
  if (p.fileHash) gtm.store.recordRepair(p.fileHash, p.source, null, list.id);
  return { listId: list.id, listName: list.name, ...res, skipped: skipped.length };
}

// ── Mosaic path ────────────────────────────────────────────────────────────
function tmpDir(): string {
  const d = join(sailorHome(), "tmp");
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

/** Writes ≤ 20k-row chunk files with a stable __sailor_row_id column (D3, D5). */
export function writeMosaicChunks(p: Preflight): string[] {
  if (!p.table) return [];
  const headers = ["__sailor_row_id", ...p.table.headers];
  const rows = (p.options.maxRows ? p.table.records.slice(0, p.options.maxRows) : p.table.records).map((r, i) => ({ __sailor_row_id: String(i + 1), ...r }));
  const out: string[] = [];
  const size = Math.ceil(rows.length / p.chunks);
  for (let c = 0; c < p.chunks; c++) {
    const path = join(tmpDir(), `mosaic-${Date.now()}-${c + 1}-${p.fileName.replace(/[^\w.-]/g, "_").replace(/\.\w+$/, "")}.csv`);
    writeFileSync(path, toCsv(headers, rows.slice(c * size, (c + 1) * size), { escapeFormulas: false }), { mode: 0o600 });
    out.push(path);
  }
  return out;
}

export interface MosaicJobParams {
  source: string;
  fileName: string;
  outBase: string;
  sourceUrl: string;
  cleanup?: CleanupSpec;
  rowCount: number;
  options: ReturnType<typeof mosaicOptions>;
  listName: string;
  groupId: string;
  part: number;
  parts: number;
  fileHash?: string;
}

export async function startMosaicRuns(p: Preflight, deps: { client: FiberClient; store: Store; config: SailorConfig; signal?: AbortSignal }): Promise<JobRow[]> {
  const options = mosaicOptions(p.options);
  const listName = p.options.listName ?? `Repaired: ${p.fileName}`;
  const outBase = p.sourceType === "file" ? p.source : join(process.cwd(), p.fileName.replace(/[^\w.-]/g, "_") || "mosaic");
  const groupId = `grp_${Date.now().toString(36)}`;
  const targets: { url: string; cleanup?: CleanupSpec; rows: number }[] = [];

  if (p.sourceType === "sheet" || (p.sourceType === "url" && p.chunks === 1)) {
    targets.push({ url: p.source, rows: p.rowCount });
  } else if (p.options.sourceUrl) {
    if (!isPublicHttpsUrl(p.options.sourceUrl)) throw new Error("sourceUrl must be a public HTTPS URL.");
    if (p.chunks > 1) throw new Error(`This file needs ${p.chunks} Mosaic runs; a single manual URL cannot be split. Configure S3/R2 or Google Drive hosting (/repair hosting).`);
    targets.push({ url: p.options.sourceUrl, rows: p.rowCount });
  } else {
    const chunkFiles = writeMosaicChunks(p);
    const per = Math.ceil(p.rowCount / chunkFiles.length);
    for (const f of chunkFiles) {
      const hosted = await hostFile(f, deps.config); // throws MANUAL_URL_REQUIRED for "manual"
      targets.push({ url: hosted.url, cleanup: hosted.cleanup, rows: per });
    }
  }

  const jobs: JobRow[] = [];
  for (const [i, t] of targets.entries()) {
    const body = { sourceUrl: t.url, options: { ...options, ...(options.maxRows ? {} : { maxRows: Math.min(MOSAIC_MAX_ROWS, Math.max(1, t.rows)) }) }, ...(p.options.customInstructions ? { customInstructions: p.options.customInstructions.slice(0, 4000) } : {}) };
    const params: MosaicJobParams = { source: p.source, fileName: p.fileName, outBase, sourceUrl: t.url, cleanup: t.cleanup, rowCount: t.rows, options, listName, groupId, part: i + 1, parts: targets.length, fileHash: p.fileHash };
    const job = deps.store.createJob({ kind: "mosaic", op: "startMosaic", status: "uploading", params });
    try {
      const r = await deps.client.call("startMosaic", body, { signal: deps.signal });
      const runId = r.output?.runId ?? (r as any).runId;
      deps.store.updateJob(job.id, { remote_id: runId, status: "pending", result: { isFreeTrialRun: r.output?.isFreeTrialRun, chargeInfo: r.chargeInfo ?? r.output?.chargeInfo } });
      if (p.fileHash) deps.store.recordRepair(p.fileHash, p.source, runId, null);
    } catch (err) {
      deps.store.updateJob(job.id, { status: "failed", error: (err as Error).message });
      await runCleanup(t.cleanup, deps.config).catch(() => undefined);
      throw err;
    }
    jobs.push(deps.store.getJob(job.id)!);
  }
  return jobs;
}

async function download(url: string, path: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}) — Mosaic links are temporary; re-polling may return fresh links.`);
  writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
  return path;
}

/** Import Mosaic's healed CSV rows into a list. Column names of the output are detected, not assumed. */
export function importHealedCsv(store: Store, listId: string, text: string, sourceOp = "mosaic"): { imported: number; withContacts: number; notFound: number } {
  const t = readTableFromText(text);
  const cols = detectColumns(t.headers, t.records);
  const emailCols = t.headers.filter((h) => /e-?mail/i.test(h));
  const phoneCols = t.headers.filter((h) => /phone|mobile/i.test(h));
  let imported = 0, withContacts = 0, notFound = 0;
  store.tx(() => {
    t.records.forEach((r, idx) => {
      const id = buildIdentity(r, cols);
      const pos = Number(r.__sailor_row_id) || idx + 1;
      const li = id.linkedinUrl ?? normalizeLinkedinUrl(Object.values(r).find((v) => /linkedin\.com\/in\//i.test(v)) ?? "");
      if (!li && !id.email && !id.name) { notFound++; return; }
      const summary = { ...summarizePerson(r), name: id.name, title: id.title, company: id.company, companyDomain: id.domain, linkedinUrl: li, location: id.location };
      const e = li || id.name ? store.upsertPerson(summary, r, sourceOp, { email: id.email }) : store.upsertUnresolved("person", { ...id }, `${listId}:${pos}`);
      let contacts = 0;
      for (const h of emailCols) for (const em of String(r[h] ?? "").split(/[;,\s]+/).filter((x) => x.includes("@"))) {
        store.addContact(e.id, /personal/i.test(h) || emailKind(em) === "personal" ? "personal_email" : "work_email", em.toLowerCase(), null, sourceOp);
        contacts++;
      }
      for (const h of phoneCols) { const v = String(r[h] ?? "").trim(); if (v) { store.addContact(e.id, "phone", v, null, sourceOp); contacts++; } }
      if (contacts) withContacts++;
      store.addToList(listId, e.id, { status: li ? "enriched" : "not_found", input: r, position: pos });
      if (!li) notFound++;
      imported++;
    });
  });
  return { imported, withContacts, notFound };
}

export function mosaicHandler(deps: { client: FiberClient; store: Store; config: SailorConfig }): JobHandler {
  return {
    async poll(job: JobRow): Promise<PollOutcome> {
      const r = await deps.client.call("pollMosaic", { runId: job.remote_id });
      const o: any = r.output ?? r;
      const status = o.status as string;
      // D1/D10: once Fiber has started processing, the temporary public link is no longer needed.
      const params = job.params as MosaicJobParams;
      if (status !== "pending" && params.cleanup && params.cleanup.provider !== "none") {
        await runCleanup(params.cleanup, deps.config).then(() => { params.cleanup = { provider: "none" }; }).catch(() => undefined);
      }
      return {
        status: status === "done" ? "done" : status === "failed" ? "failed" : status === "running" ? "running" : "pending",
        progress: { done: o.processedRowCount, total: o.rowCount },
        result: o,
        error: status === "failed" ? (o.error ?? o.message ?? "Mosaic run failed") : undefined,
        params,
      };
    },
    async finalize(job: JobRow, out: PollOutcome) {
      const o: any = out.result;
      const params = job.params as MosaicJobParams;
      const suffix = params.parts > 1 ? `.healed.part${params.part}` : ".healed";
      // D4: download immediately — links are temporary.
      const healedPath = await download(o.outputCsvUrl, siblingPath(params.outBase, suffix));
      let reportPath: string | undefined;
      if (o.reportUrl) {
        const ext = /\.(json|md|html|txt|csv)(\?|$)/i.exec(o.reportUrl)?.[1] ?? "txt";
        reportPath = await download(o.reportUrl, siblingPath(params.outBase, `${suffix}.report`, `.${ext}`)).catch(() => undefined);
      }
      // Merge parts of the same group into one list.
      const groupList = deps.store.getMeta(`group:${params.groupId}`);
      const list = groupList ? deps.store.getList(groupList)! : deps.store.createList(params.listName, "people", `mosaic:${params.fileName}`);
      if (!groupList) deps.store.setMeta(`group:${params.groupId}`, list.id);
      const imp = importHealedCsv(deps.store, list.id, readFileSync(healedPath, "utf8"), "mosaic");
      deps.store.updateJob(job.id, { list_id: list.id });
      if (params.fileHash) deps.store.recordRepair(params.fileHash, params.source, job.remote_id, list.id);
      const s = o.stats ?? {};
      const summary = `Mosaic ${params.parts > 1 ? `part ${params.part}/${params.parts} ` : ""}done for ${params.fileName}: ${s.rowsWhereProfileFound ?? imp.imported - imp.notFound}/${s.inputRows ?? params.rowCount} profiles found, ${s.rowsWithContactDetails ?? imp.withContacts} with contacts, ${s.rowsWithErrors ?? 0} errors. Saved ${basename(healedPath)}${reportPath ? ` + ${basename(reportPath)}` : ""}; imported into list "${list.name}" (${list.id}).`;
      return { summary, result: { healedPath, reportPath, listId: list.id, stats: s, imported: imp } };
    },
    async onFailed(job: JobRow) {
      await runCleanup((job.params as MosaicJobParams).cleanup, deps.config).catch(() => undefined);
    },
  };
}

// ── Batch contact reveal (> 25 people) ─────────────────────────────────────
export interface BatchContactParams { listId?: string; byUrl: Record<string, string>; cursor?: string | null; types: Record<string, boolean>; count: number }

export function batchContactsHandler(deps: { client: FiberClient; store: Store }): JobHandler {
  return {
    async poll(job: JobRow): Promise<PollOutcome> {
      const params = job.params as BatchContactParams;
      let cursor = params.cursor ?? null;
      let last: any;
      // Drain available pages (max 100 each) so partial results are saved as they arrive (C3).
      for (let page = 0; page < 50; page++) {
        const r = await deps.client.call("pollBatchContactDetails", { taskId: job.remote_id, cursor, take: 100 });
        last = r.output ?? r;
        for (const item of last.pageResults ?? []) saveBatchItem(deps.store, params, item);
        if (!last.nextCursor || last.nextCursor === cursor) break;
        cursor = last.nextCursor;
      }
      const st = last?.statistics ?? last?.stats ?? {};
      const status = last?.failed ? "failed" : last?.canceled ? "canceled" : last?.done ? "done" : "running";
      return { status, progress: { done: st.numCompleted, total: st.totalPeopleToFetch }, result: st, params: { ...params, cursor }, error: last?.failed ? "Batch contact task failed" : undefined };
    },
    async finalize(job: JobRow, out: PollOutcome) {
      const st: any = out.result ?? {};
      return { summary: `Batch contact reveal done: ${st.numCompleted ?? "?"} completed, ${st.numFailed ?? 0} failed.`, result: { stats: st } };
    },
    async cancel(job: JobRow) {
      if (job.remote_id) await deps.client.call("cancelBatchContactDetails", { taskId: job.remote_id });
    },
  };
}

function saveBatchItem(store: Store, params: BatchContactParams, item: any): void {
  const url = normalizeLinkedinUrl(String(item?.inputs?.linkedinUrl?.value ?? item?.inputs?.linkedinUrl ?? item?.inputs ?? "")) ?? "";
  const entityId = params.byUrl[url];
  if (!entityId) return;
  const outs = item.outputs ?? {};
  for (const em of outs.emails ?? outs.workEmails ?? []) {
    const addr = String(em.email ?? em.value ?? em).toLowerCase();
    if (addr.includes("@")) store.addContact(entityId, String(em.type ?? "").includes("personal") ? "personal_email" : "work_email", addr, em.status ?? null, "startBatchContactDetails");
  }
  for (const em of outs.personalEmails ?? []) {
    const addr = String(em.email ?? em.value ?? em).toLowerCase();
    if (addr.includes("@")) store.addContact(entityId, "personal_email", addr, em.status ?? null, "startBatchContactDetails");
  }
  for (const ph of outs.phoneNumbers ?? outs.phones ?? []) {
    const n = String(ph.number ?? ph.value ?? ph);
    if (n) store.addContact(entityId, "phone", n, ph.type ?? null, "startBatchContactDetails");
  }
  if (params.listId) store.setItemStatus(params.listId, entityId, "enriched");
}
