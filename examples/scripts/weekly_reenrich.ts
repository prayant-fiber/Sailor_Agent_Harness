/**
 * Weekly re-enrichment of a prospect CSV with @fiberai/sdk (GTM-engineering example, F8).
 *   npm i @fiberai/sdk
 *   FIBER_API_KEY=sk_live_… npx tsx examples/scripts/weekly_reenrich.ts prospects.csv --budget 200 [--dry-run] [--yes]
 * Flow: read CSV → pick rows with a LinkedIn URL but no work email → estimate → confirm → reveal work emails
 * (2 credits each, only when found) → write prospects.enriched.csv. Logs every chargeInfo; stops at --budget.
 * Schedule with cron / GitHub Actions (use --yes and a budget).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { getOrgCredits, syncQuickContactReveal } from "@fiberai/sdk";

const apiKey = process.env.FIBER_API_KEY ?? process.env.FIBERAI_API_KEY;
if (!apiKey) throw new Error("Set FIBER_API_KEY");
const [file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!file) throw new Error("usage: weekly_reenrich.ts <file.csv> [--budget N] [--dry-run] [--yes]");
const argVal = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined; };
const BUDGET = Number(argVal("--budget") ?? 100);
const DRY = process.argv.includes("--dry-run");

// Minimal CSV (quoted fields supported). For messy inputs use Sailor's /repair first.
function parse(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const out: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); out.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); out.push(row); }
  const headers = out[0];
  return { headers, rows: out.slice(1).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))) };
}
const esc = (v: string) => { const s = /^[=+\-@]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function main() {
  const { headers, rows } = parse(readFileSync(file, "utf8"));
  const liCol = headers.find((h) => /linkedin/i.test(h));
  const emCol = headers.find((h) => /e-?mail/i.test(h)) ?? "work_email";
  if (!liCol) throw new Error("No LinkedIn column found");
  if (!headers.includes(emCol)) headers.push(emCol);
  const todo = rows.filter((r) => r[liCol] && !r[emCol]);
  const estimate = todo.length * 2;
  const credits = (await getOrgCredits({ query: { apiKey: apiKey! } })).data as any;
  console.log(`${todo.length} rows need a work email → up to ~${estimate} credits (budget ${BUDGET}, available ${credits?.output?.[0]?.available})`);
  if (DRY || !todo.length) return;
  if (!process.argv.includes("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ok = /^y/i.test(await rl.question(`Spend up to ~${Math.min(estimate, BUDGET)} credits? [y/N] `));
    rl.close();
    if (!ok) return;
  }
  let spent = 0;
  for (const r of todo) {
    if (spent + 2 > BUDGET) { console.log(`Budget reached (${spent}).`); break; }
    const { data, response } = await syncQuickContactReveal({
      body: { apiKey: apiKey!, linkedinUrl: r[liCol], enrichmentType: { getWorkEmails: true, getPersonalEmails: false, getPhoneNumbers: false } },
    });
    if (response.status === 402) { console.log("Out of credits — stopping; partial results are saved."); break; }
    if (response.status === 429) { await new Promise((s) => setTimeout(s, 5000)); continue; }
    if (response.status !== 200) { console.warn(`HTTP ${response.status} for ${r[liCol]}`); continue; }
    const charge = (data as any)?.chargeInfo;
    spent += charge?.creditsCharged ?? 0;
    const email = (data as any)?.output?.profile?.emails?.find((e: any) => e.type !== "personal")?.email;
    if (email) r[emCol] = email;
    console.log(`${r[liCol]} → ${email ?? "not found"} (${charge?.method} ${charge?.creditsCharged ?? 0})`);
  }
  const outFile = file.replace(/\.csv$/i, "") + ".enriched.csv";
  writeFileSync(outFile, [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(","))].join("\n") + "\n");
  console.log(`Wrote ${outFile}. Spent ${spent} credits.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
