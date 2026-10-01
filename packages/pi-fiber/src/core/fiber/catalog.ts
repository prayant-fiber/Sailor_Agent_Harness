/**
 * Full Fiber operation catalog from https://api.fiber.ai/ai-docs/index.md (public, no key, no credits).
 * Lets the agent discover and call any of the 200+ operations even when MCP is disabled (F1 "all APIs").
 */
import type { HttpMethod } from "./ops";

export interface CatalogEntry { opId: string; method: HttpMethod; path: string; summary: string; section: string }

const LINE = /\[`([^`]+)`\]\([^)]*\)\s+`(GET|POST|PUT|PATCH|DELETE)\s+([^`]+)`\s+[—-]+\s+(.*)$/;

export function parseCatalog(md: string): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  let section = "";
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("## ")) { section = line.slice(3).trim(); continue; }
    const m = line.match(LINE);
    if (m) out.push({ opId: m[1], method: m[2] as HttpMethod, path: m[3].trim(), summary: m[4].trim(), section });
  }
  return out;
}

let cache: { at: number; entries: CatalogEntry[] } | undefined;

export async function loadCatalog(baseUrl = "https://api.fiber.ai", maxAgeMs = 6 * 3600_000): Promise<CatalogEntry[]> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.entries;
  const res = await fetch(`${baseUrl}/ai-docs/index.md`, { headers: { accept: "text/markdown" } });
  if (!res.ok) throw new Error(`Could not load Fiber operation index (HTTP ${res.status}).`);
  const entries = parseCatalog(await res.text());
  cache = { at: Date.now(), entries };
  return entries;
}

export function searchCatalog(entries: CatalogEntry[], query: string, limit = 12): CatalogEntry[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  const score = (e: CatalogEntry) => {
    const hay = `${e.opId} ${e.summary} ${e.section} ${e.path}`.toLowerCase();
    return terms.reduce((s, t) => s + (hay.includes(t) ? (e.opId.toLowerCase().includes(t) ? 3 : 1) : 0), 0);
  };
  return entries.map((e) => ({ e, s: score(e) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.e);
}

export async function fetchOpDoc(opId: string, baseUrl = "https://api.fiber.ai", maxChars = 12_000): Promise<string> {
  if (!/^[\w-]+$/.test(opId)) throw new Error("Invalid operationId");
  const res = await fetch(`${baseUrl}/ai-docs/${opId}.md`, { headers: { accept: "text/markdown" } });
  if (!res.ok) throw new Error(`No docs for ${opId} (HTTP ${res.status}).`);
  const text = await res.text();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (truncated; ${text.length - maxChars} more chars)` : text;
}
