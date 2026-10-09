/**
 * Local workspace store (SQLite via Node's built-in `node:sqlite`, Node ≥ 22.13 — no native deps).
 * Lives outside Pi sessions so lists survive /fork, /tree and restarts (A6, F16, I7).
 * PII lives here: file is created 0600 inside a 0700 dir (G7). `/wipe` deletes it.
 */
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync as DB } from "node:sqlite";
import { ensureDir, sailorHome } from "../config";
import type { CompanySummary, PersonSummary } from "../fiber/entities";
import { normalizeDomain, normalizeLinkedinUrl } from "../io/normalize";

export type EntityKind = "person" | "company";
export type ListKind = "people" | "companies";
export type ItemStatus = "new" | "enriched" | "contacted" | "excluded" | "not_found" | "error";

export interface ListRow { id: string; name: string; kind: ListKind; source: string | null; created_at: number; updated_at: number; size?: number }
export interface EntityRow { id: string; kind: EntityKind; dedupe_key: string; linkedin_url: string | null; domain: string | null; email: string | null; name: string | null; summary: PersonSummary & CompanySummary; data: any; source_op: string | null; fetched_at: number }
export interface ItemRow { list_id: string; entity_id: string; position: number; status: ItemStatus; notes: string | null; input: Record<string, string> | null; entity?: EntityRow; contacts?: ContactRow[]; score?: number | null; tier?: string | null; score_reason?: string | null }
export interface ContactRow { entity_id: string; type: "work_email" | "personal_email" | "phone"; value: string; validity: string | null; source_op: string | null; fetched_at: number }
export interface JobRow { id: string; kind: string; op: string; remote_id: string | null; status: string; params: any; result: any; list_id: string | null; created_at: number; updated_at: number; next_poll_at: number; error: string | null }
export interface LedgerRow { id: number; session_id: string; op: string; estimated: number | null; charged: number; method: string | null; at: number }

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, source TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
  linkedin_url TEXT, domain TEXT, email TEXT, name TEXT,
  summary TEXT NOT NULL, data TEXT, source_op TEXT, fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entities_linkedin ON entities(linkedin_url);
CREATE INDEX IF NOT EXISTS entities_email ON entities(email);
CREATE TABLE IF NOT EXISTS list_items (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE, entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', notes TEXT, input TEXT,
  PRIMARY KEY (list_id, entity_id)
);
CREATE TABLE IF NOT EXISTS contacts (
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE, type TEXT NOT NULL, value TEXT NOT NULL,
  validity TEXT, source_op TEXT, fetched_at INTEGER NOT NULL, PRIMARY KEY (entity_id, type, value)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, op TEXT NOT NULL, remote_id TEXT, status TEXT NOT NULL, params TEXT, result TEXT,
  list_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, next_poll_at INTEGER NOT NULL, error TEXT
);
CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, response TEXT NOT NULL, charge TEXT, fetched_at INTEGER NOT NULL, ttl_s INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, op TEXT NOT NULL, estimated REAL, charged REAL NOT NULL, method TEXT, raw TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_at ON ledger(at);
CREATE TABLE IF NOT EXISTS exports (id INTEGER PRIMARY KEY AUTOINCREMENT, list_id TEXT, target TEXT NOT NULL, url TEXT, mode TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS dnc (value TEXT PRIMARY KEY, kind TEXT NOT NULL, reason TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS repairs (file_hash TEXT PRIMARY KEY, source TEXT, run_id TEXT, list_id TEXT, at INTEGER NOT NULL);
`;

let warningFilterInstalled = false;
function loadSqlite(): typeof import("node:sqlite") {
  if (!warningFilterInstalled) {
    // node:sqlite prints an ExperimentalWarning on first load that would corrupt the TUI.
    const orig = process.emitWarning.bind(process);
    (process as any).emitWarning = (w: any, ...rest: any[]) => {
      const msg = typeof w === "string" ? w : w?.message;
      if (typeof msg === "string" && msg.includes("SQLite")) return;
      return (orig as any)(w, ...rest);
    };
    warningFilterInstalled = true;
  }
  const mod = (process as any).getBuiltinModule?.("node:sqlite");
  if (!mod) throw new Error("Sailor needs Node.js ≥ 22.13 (built-in node:sqlite). Run `sailor doctor`.");
  return mod;
}

const now = () => Date.now();
const j = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
const pj = <T>(s: unknown): T => (s == null ? (null as T) : JSON.parse(String(s)));

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "list";
}

export function personKey(s: { linkedinUrl?: string | null; email?: string | null; name?: string | null; companyDomain?: string | null; company?: string | null }): string {
  const li = s.linkedinUrl ? normalizeLinkedinUrl(s.linkedinUrl) : undefined;
  if (li) return `li:${li}`;
  if (s.email) return `em:${s.email.toLowerCase()}`;
  return `nm:${(s.name ?? "").toLowerCase().replace(/\s+/g, " ").trim()}|${(s.companyDomain ?? s.company ?? "").toLowerCase()}`;
}

export function companyKey(s: { domain?: string | null; linkedinUrl?: string | null; orgId?: string | null; name?: string | null }): string {
  const d = s.domain ? normalizeDomain(s.domain) : "";
  if (d) return `dm:${d}`;
  const li = s.linkedinUrl ? normalizeLinkedinUrl(s.linkedinUrl) : undefined;
  if (li) return `li:${li}`;
  if (s.orgId) return `org:${s.orgId}`;
  return `nm:${(s.name ?? "").toLowerCase().trim()}`;
}

export class Store {
  readonly db: DB;
  readonly path: string;

  constructor(path?: string) {
    this.path = path ?? Store.defaultPath();
    if (this.path !== ":memory:") ensureDir(dirname(this.path));
    const { DatabaseSync } = loadSqlite();
    const fresh = this.path !== ":memory:" && !existsSync(this.path);
    this.db = new DatabaseSync(this.path);
    this.db.exec(SCHEMA);
    this.migrate();
    if (fresh) { try { chmodSync(this.path, 0o600); } catch { /* ignore */ } }
  }

  static defaultPath(cwd = process.cwd()): string {
    // Project-local workspace if the user created .sailor/ in the project, else global (F16).
    if (process.env.SAILOR_DB) return process.env.SAILOR_DB;
    const local = join(cwd, ".sailor");
    if (existsSync(local)) return join(local, "sailor.db");
    return join(sailorHome(), "sailor.db");
  }

  /** Additive column migrations for stores created by older versions. */
  private migrate(): void {
    const cols = new Set((this.db.prepare("PRAGMA table_info(list_items)").all() as any[]).map((c) => c.name));
    // FIB-20428 /qualify: AI fit score per list row.
    if (!cols.has("score")) this.db.exec("ALTER TABLE list_items ADD COLUMN score REAL");
    if (!cols.has("tier")) this.db.exec("ALTER TABLE list_items ADD COLUMN tier TEXT");
    if (!cols.has("score_reason")) this.db.exec("ALTER TABLE list_items ADD COLUMN score_reason TEXT");
  }

  close(): void { this.db.close(); }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try { const r = fn(); this.db.exec("COMMIT"); return r; } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  // ── lists ────────────────────────────────────────────────────────────────
  createList(name: string, kind: ListKind, source?: string): ListRow {
    let id = slugify(name);
    let finalName = name.trim();
    for (let i = 2; this.db.prepare("SELECT 1 FROM lists WHERE id = ? OR name = ?").get(id, finalName); i++) { id = `${slugify(name)}-${i}`; finalName = `${name.trim()} (${i})`; }
    const t = now();
    this.db.prepare("INSERT INTO lists (id, name, kind, source, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(id, finalName, kind, source ?? null, t, t);
    return this.getList(id)!;
  }

  getList(idOrName: string): ListRow | undefined {
    const r = this.db.prepare(`SELECT l.*, (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS size FROM lists l WHERE l.id = ? OR lower(l.name) = lower(?)`).get(idOrName, idOrName) as any;
    return r ?? undefined;
  }

  lists(): ListRow[] {
    return this.db.prepare(`SELECT l.*, (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS size FROM lists l ORDER BY l.updated_at DESC`).all() as any;
  }

  deleteList(id: string): void { this.db.prepare("DELETE FROM lists WHERE id = ?").run(id); }

  renameList(id: string, name: string): void { this.db.prepare("UPDATE lists SET name = ?, updated_at = ? WHERE id = ?").run(name, now(), id); }

  touchList(id: string): void { this.db.prepare("UPDATE lists SET updated_at = ? WHERE id = ?").run(now(), id); }

  // ── entities ─────────────────────────────────────────────────────────────
  upsertPerson(summary: PersonSummary, raw: unknown, sourceOp: string, extra: { email?: string } = {}): EntityRow {
    const key = personKey({ linkedinUrl: summary.linkedinUrl, email: extra.email, name: summary.name, companyDomain: summary.companyDomain, company: summary.company });
    return this.upsertEntity("person", key, { linkedin_url: summary.linkedinUrl ?? null, domain: summary.companyDomain ?? null, email: extra.email ?? null, name: summary.name ?? null }, summary, raw, sourceOp);
  }

  upsertCompany(summary: CompanySummary, raw: unknown, sourceOp: string): EntityRow {
    const key = companyKey(summary);
    return this.upsertEntity("company", key, { linkedin_url: summary.linkedinUrl ?? null, domain: summary.domain ?? null, email: null, name: summary.name ?? null }, summary, raw, sourceOp);
  }

  /** Placeholder entity for input rows that Fiber could not resolve (kept so row order/status survives). */
  upsertUnresolved(kind: EntityKind, input: Record<string, unknown>, keyHint: string): EntityRow {
    return this.upsertEntity(kind, `raw:${keyHint}`, { linkedin_url: null, domain: (input.domain as string) ?? null, email: (input.email as string) ?? null, name: (input.name as string) ?? null }, input as any, null, "input");
  }

  private upsertEntity(kind: EntityKind, key: string, cols: { linkedin_url: string | null; domain: string | null; email: string | null; name: string | null }, summary: unknown, raw: unknown, sourceOp: string): EntityRow {
    // Also match an existing row by secondary keys (e.g. person first seen by email, later by LinkedIn) — F6.
    const existing = (this.db.prepare("SELECT * FROM entities WHERE dedupe_key = ?").get(key) as any)
      ?? (cols.linkedin_url ? this.db.prepare("SELECT * FROM entities WHERE kind = ? AND linkedin_url = ?").get(kind, cols.linkedin_url) as any : undefined)
      ?? (cols.email ? this.db.prepare("SELECT * FROM entities WHERE kind = ? AND email = ?").get(kind, cols.email) as any : undefined);
    const t = now();
    if (existing) {
      const mergedSummary = { ...pj<object>(existing.summary), ...stripUndefined(summary as object) };
      this.db.prepare(`UPDATE entities SET linkedin_url = COALESCE(?, linkedin_url), domain = COALESCE(?, domain), email = COALESCE(?, email), name = COALESCE(?, name),
        summary = ?, data = COALESCE(?, data), source_op = ?, fetched_at = ? WHERE id = ?`)
        .run(cols.linkedin_url, cols.domain, cols.email, cols.name, JSON.stringify(mergedSummary), raw === null ? null : j(raw), sourceOp, t, existing.id);
      return this.getEntity(existing.id)!;
    }
    const id = randomUUID().slice(0, 12);
    this.db.prepare(`INSERT INTO entities (id, kind, dedupe_key, linkedin_url, domain, email, name, summary, data, source_op, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, kind, key, cols.linkedin_url, cols.domain, cols.email, cols.name, JSON.stringify(summary ?? {}), j(raw), sourceOp, t);
    return this.getEntity(id)!;
  }

  getEntity(id: string): EntityRow | undefined {
    const r = this.db.prepare("SELECT * FROM entities WHERE id = ?").get(id) as any;
    return r ? { ...r, summary: pj(r.summary), data: pj(r.data) } : undefined;
  }

  findEntity(ref: string): EntityRow | undefined {
    const li = normalizeLinkedinUrl(ref);
    const r = (this.db.prepare("SELECT * FROM entities WHERE id = ?").get(ref) as any)
      ?? (li ? this.db.prepare("SELECT * FROM entities WHERE linkedin_url = ?").get(li) as any : undefined)
      ?? (this.db.prepare("SELECT * FROM entities WHERE email = ? OR domain = ?").get(ref.toLowerCase(), ref.toLowerCase()) as any)
      ?? (this.db.prepare("SELECT * FROM entities WHERE lower(name) = lower(?) LIMIT 1").get(ref) as any);
    return r ? this.getEntity(r.id) : undefined;
  }

  forgetEntity(id: string): void {
    this.db.prepare("DELETE FROM entities WHERE id = ?").run(id);
  }

  // ── list items ───────────────────────────────────────────────────────────
  addToList(listId: string, entityId: string, opts: { status?: ItemStatus; input?: Record<string, string>; position?: number } = {}): void {
    const pos = opts.position ?? ((this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM list_items WHERE list_id = ?").get(listId) as any).p as number);
    this.db.prepare(`INSERT INTO list_items (list_id, entity_id, position, status, input) VALUES (?,?,?,?,?)
      ON CONFLICT(list_id, entity_id) DO UPDATE SET status = excluded.status, input = COALESCE(excluded.input, list_items.input)`)
      .run(listId, entityId, pos, opts.status ?? "new", j(opts.input));
    this.touchList(listId);
  }

  removeFromList(listId: string, entityIds: string[]): number {
    let n = 0;
    for (const id of entityIds) n += Number(this.db.prepare("DELETE FROM list_items WHERE list_id = ? AND entity_id = ?").run(listId, id).changes);
    this.touchList(listId);
    return n;
  }

  setItemStatus(listId: string, entityId: string, status: ItemStatus): void {
    this.db.prepare("UPDATE list_items SET status = ? WHERE list_id = ? AND entity_id = ?").run(status, listId, entityId);
  }

  setItemScore(listId: string, entityId: string, score: number, tier: string | null, reason: string | null): boolean {
    const r = this.db.prepare("UPDATE list_items SET score = ?, tier = ?, score_reason = ? WHERE list_id = ? AND entity_id = ?").run(score, tier, reason, listId, entityId);
    return Number(r.changes) > 0;
  }

  setItemNotes(listId: string, entityId: string, notes: string): void {
    this.db.prepare("UPDATE list_items SET notes = ? WHERE list_id = ? AND entity_id = ?").run(notes, listId, entityId);
    this.touchList(listId);
  }

  items(listId: string, opts: { limit?: number; offset?: number; status?: ItemStatus; withContacts?: boolean; search?: string } = {}): ItemRow[] {
    const where = ["i.list_id = ?"];
    const args: any[] = [listId];
    if (opts.status) { where.push("i.status = ?"); args.push(opts.status); }
    if (opts.search) { where.push("(lower(e.name) LIKE ? OR lower(e.summary) LIKE ?)"); args.push(`%${opts.search.toLowerCase()}%`, `%${opts.search.toLowerCase()}%`); }
    args.push(opts.limit ?? 1_000_000, opts.offset ?? 0);
    const rows = this.db.prepare(`SELECT i.*, e.id AS e_id FROM list_items i JOIN entities e ON e.id = i.entity_id WHERE ${where.join(" AND ")} ORDER BY i.position LIMIT ? OFFSET ?`).all(...args) as any[];
    return rows.map((r) => ({
      list_id: r.list_id, entity_id: r.entity_id, position: r.position, status: r.status, notes: r.notes, input: pj(r.input),
      score: r.score ?? null, tier: r.tier ?? null, score_reason: r.score_reason ?? null,
      entity: this.getEntity(r.entity_id), contacts: opts.withContacts === false ? undefined : this.contacts(r.entity_id),
    }));
  }

  countItems(listId: string, status?: ItemStatus): number {
    const r = status
      ? this.db.prepare("SELECT COUNT(*) AS n FROM list_items WHERE list_id = ? AND status = ?").get(listId, status)
      : this.db.prepare("SELECT COUNT(*) AS n FROM list_items WHERE list_id = ?").get(listId);
    return Number((r as any).n);
  }

  // ── contacts ─────────────────────────────────────────────────────────────
  addContact(entityId: string, type: ContactRow["type"], value: string, validity: string | null, sourceOp: string): void {
    this.db.prepare(`INSERT INTO contacts (entity_id, type, value, validity, source_op, fetched_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(entity_id, type, value) DO UPDATE SET validity = COALESCE(excluded.validity, contacts.validity), fetched_at = excluded.fetched_at`)
      .run(entityId, type, value, validity, sourceOp, now());
  }

  setContactValidity(value: string, validity: string): void {
    this.db.prepare("UPDATE contacts SET validity = ? WHERE value = ?").run(validity, value);
  }

  contacts(entityId: string): ContactRow[] {
    return this.db.prepare("SELECT * FROM contacts WHERE entity_id = ? ORDER BY type").all(entityId) as any;
  }

  hasFreshContacts(entityId: string, maxAgeMs: number): boolean {
    const r = this.db.prepare("SELECT MAX(fetched_at) AS t FROM contacts WHERE entity_id = ?").get(entityId) as any;
    return !!r?.t && now() - Number(r.t) < maxAgeMs;
  }

  // ── cache (A7: never pay twice inside the TTL) ────────────────────────────
  static cacheKey(opId: string, args: unknown): string {
    return `${opId}:${createHash("sha256").update(stableStringify(args)).digest("hex").slice(0, 32)}`;
  }

  cacheGet<T = any>(key: string): { response: T; fetchedAt: number } | undefined {
    const r = this.db.prepare("SELECT * FROM cache WHERE key = ?").get(key) as any;
    if (!r) return undefined;
    if (now() - Number(r.fetched_at) > Number(r.ttl_s) * 1000) { this.db.prepare("DELETE FROM cache WHERE key = ?").run(key); return undefined; }
    return { response: pj(r.response), fetchedAt: Number(r.fetched_at) };
  }

  cacheSet(key: string, response: unknown, ttlSeconds: number, charge?: unknown): void {
    this.db.prepare("INSERT OR REPLACE INTO cache (key, response, charge, fetched_at, ttl_s) VALUES (?,?,?,?,?)").run(key, JSON.stringify(response), j(charge), now(), Math.round(ttlSeconds));
  }

  // ── jobs ─────────────────────────────────────────────────────────────────
  createJob(j0: { kind: string; op: string; remoteId?: string; status?: string; params?: unknown; listId?: string; nextPollAt?: number }): JobRow {
    const id = `job_${randomUUID().slice(0, 8)}`;
    const t = now();
    this.db.prepare(`INSERT INTO jobs (id, kind, op, remote_id, status, params, result, list_id, created_at, updated_at, next_poll_at, error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, j0.kind, j0.op, j0.remoteId ?? null, j0.status ?? "pending", j(j0.params), null, j0.listId ?? null, t, t, j0.nextPollAt ?? t, null);
    return this.getJob(id)!;
  }

  updateJob(id: string, patch: Partial<Pick<JobRow, "status" | "remote_id" | "result" | "next_poll_at" | "error" | "list_id" | "params">>): void {
    const cur = this.getJob(id);
    if (!cur) return;
    this.db.prepare(`UPDATE jobs SET status = ?, remote_id = ?, result = ?, next_poll_at = ?, error = ?, list_id = ?, params = ?, updated_at = ? WHERE id = ?`).run(
      patch.status ?? cur.status, patch.remote_id ?? cur.remote_id, j(patch.result ?? cur.result), patch.next_poll_at ?? cur.next_poll_at,
      patch.error === undefined ? cur.error : patch.error, patch.list_id ?? cur.list_id, j(patch.params ?? cur.params), now(), id);
  }

  getJob(id: string): JobRow | undefined {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as any;
    return r ? { ...r, params: pj(r.params), result: pj(r.result) } : undefined;
  }

  jobs(opts: { active?: boolean; limit?: number } = {}): JobRow[] {
    const rows = (opts.active
      ? this.db.prepare("SELECT * FROM jobs WHERE status IN ('pending','running','uploading','paused_out_of_credits') ORDER BY created_at DESC LIMIT ?").all(opts.limit ?? 100)
      : this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(opts.limit ?? 100)) as any[];
    return rows.map((r) => ({ ...r, params: pj(r.params), result: pj(r.result) }));
  }

  dueJobs(at = now()): JobRow[] {
    return (this.db.prepare("SELECT * FROM jobs WHERE status IN ('pending','running') AND remote_id IS NOT NULL AND next_poll_at <= ? ORDER BY next_poll_at").all(at) as any[])
      .map((r) => ({ ...r, params: pj(r.params), result: pj(r.result) }));
  }

  // ── ledger (C1/C6) ───────────────────────────────────────────────────────
  addLedger(sessionId: string, op: string, estimated: number | null, charged: number, method: string | null, raw?: unknown): void {
    this.db.prepare("INSERT INTO ledger (session_id, op, estimated, charged, method, raw, at) VALUES (?,?,?,?,?,?,?)").run(sessionId, op, estimated, charged, method, j(raw), now());
  }

  spentSince(since: number): number {
    return Number((this.db.prepare("SELECT COALESCE(SUM(charged), 0) AS s FROM ledger WHERE at >= ?").get(since) as any).s);
  }

  spentInSession(sessionId: string): number {
    return Number((this.db.prepare("SELECT COALESCE(SUM(charged), 0) AS s FROM ledger WHERE session_id = ?").get(sessionId) as any).s);
  }

  ledgerByOp(sessionId?: string): { op: string; calls: number; estimated: number; charged: number }[] {
    return (sessionId
      ? this.db.prepare("SELECT op, COUNT(*) AS calls, COALESCE(SUM(estimated),0) AS estimated, SUM(charged) AS charged FROM ledger WHERE session_id = ? GROUP BY op ORDER BY charged DESC").all(sessionId)
      : this.db.prepare("SELECT op, COUNT(*) AS calls, COALESCE(SUM(estimated),0) AS estimated, SUM(charged) AS charged FROM ledger GROUP BY op ORDER BY charged DESC").all()) as any;
  }

  recentLedger(limit = 10): LedgerRow[] {
    return this.db.prepare("SELECT id, session_id, op, estimated, charged, method, at FROM ledger ORDER BY id DESC LIMIT ?").all(limit) as any;
  }

  // ── exports / DNC / repairs ──────────────────────────────────────────────
  addExport(listId: string | null, target: string, url: string | null, mode?: string): void {
    this.db.prepare("INSERT INTO exports (list_id, target, url, mode, at) VALUES (?,?,?,?,?)").run(listId, target, url, mode ?? null, now());
  }

  lastExport(listId: string, target: string): { url: string; mode: string | null; at: number } | undefined {
    return this.db.prepare("SELECT url, mode, at FROM exports WHERE list_id = ? AND target = ? ORDER BY id DESC LIMIT 1").get(listId, target) as any;
  }

  addDnc(value: string, kind: "email" | "linkedin" | "domain" | "phone", reason?: string): void {
    this.db.prepare("INSERT OR REPLACE INTO dnc (value, kind, reason, at) VALUES (?,?,?,?)").run(value.toLowerCase(), kind, reason ?? null, now());
  }

  removeDnc(value: string): void { this.db.prepare("DELETE FROM dnc WHERE value = ?").run(value.toLowerCase()); }

  dncList(): { value: string; kind: string; reason: string | null }[] {
    return this.db.prepare("SELECT value, kind, reason FROM dnc ORDER BY at DESC").all() as any;
  }

  isDnc(values: (string | null | undefined)[]): boolean {
    for (const v of values) {
      if (!v) continue;
      const lv = v.toLowerCase();
      if (this.db.prepare("SELECT 1 FROM dnc WHERE value = ?").get(lv)) return true;
      const dom = lv.includes("@") ? lv.split("@")[1] : undefined;
      if (dom && this.db.prepare("SELECT 1 FROM dnc WHERE value = ? AND kind = 'domain'").get(dom)) return true;
    }
    return false;
  }

  entityIsDnc(e: EntityRow): boolean {
    const emails = this.contacts(e.id).map((c) => c.value);
    return this.isDnc([e.email, e.linkedin_url, e.domain, ...emails]);
  }

  recordRepair(fileHash: string, source: string, runId: string | null, listId: string | null): void {
    this.db.prepare("INSERT OR REPLACE INTO repairs (file_hash, source, run_id, list_id, at) VALUES (?,?,?,?,?)").run(fileHash, source, runId, listId, now());
  }

  findRepair(fileHash: string): { source: string; run_id: string | null; list_id: string | null; at: number } | undefined {
    return this.db.prepare("SELECT * FROM repairs WHERE file_hash = ?").get(fileHash) as any;
  }

  getMeta(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as any)?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: any = {};
  for (const [k, v] of Object.entries(o ?? {})) if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) out[k] = v;
  return out;
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as any)[k])}`).join(",")}}`;
}
