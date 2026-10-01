/**
 * Agent eval runner (docs/07 §2). For each scenario × model:
 *   1. start the mock Fiber server (with scenario knobs), point Sailor at it (FIBER_BASE_URL),
 *   2. run `pi -p --mode json -e <sailor extension> [--model M] [--fiber-max-spend N] "<prompt>"` in a temp workspace,
 *   3. assert on what actually hit the (mock) Fiber API + the final assistant text.
 * Assertions on API traffic are provider-agnostic, so the same scenarios grade Claude, GPT and open-weights models.
 *
 *   tsx evals/run.ts                          # default model from Pi settings
 *   EVAL_MODELS="anthropic/claude-sonnet-4-5,openai/gpt-5,openrouter/qwen/qwen3-coder" tsx evals/run.ts
 *   EVAL_ONLY=E2,E5 tsx evals/run.ts
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockFiber, type MockFiber, type MockOptions } from "./mock-fiber-server";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, "../packages/pi-fiber/extensions/sailor");
const KEY = "sk_live_testkey123456";

interface Scenario {
  id: string; title: string; prompt: string; maxSpend?: number; setup?: "search3"; mock?: MockOptions; flags?: string[]; files?: Record<string, string>;
  expect: {
    calledPaths?: string[]; notCalledPaths?: string[]; anyOfPaths?: string[][]; maxCredits?: number; maxPageSize?: number;
    maxCallsToPath?: Record<string, number>; finalTextMatches?: string; finalTextNotMatches?: string;
  };
}

function runPi(args: string[], env: Record<string, string>, cwd: string, timeoutMs = 240_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const child = spawn(process.env.PI_BIN ?? "pi", args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const t = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("exit", (code) => { clearTimeout(t); res({ code: code ?? -1, stdout, stderr }); });
  });
}

/** Pull assistant text out of Pi's JSONL event stream without depending on exact event names. */
function finalText(jsonl: string): string {
  const texts: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const ev = JSON.parse(line);
      const walk = (v: any, role?: string) => {
        if (!v || typeof v !== "object") return;
        const r = v.role ?? role;
        if (r === "assistant" && typeof v.text === "string") texts.push(v.text);
        if (r === "assistant" && Array.isArray(v.content)) for (const c of v.content) if (c?.type === "text") texts.push(c.text);
        for (const k of Object.keys(v)) if (typeof v[k] === "object") walk(v[k], r);
      };
      walk(ev);
    } catch { /* not JSON */ }
  }
  return texts.at(-1) ?? jsonl.slice(-2000);
}

async function seed(mock: MockFiber, home: string, cwd: string): Promise<void> {
  // Pre-populate a list via the core API (same DB path the extension will use).
  process.env.SAILOR_HOME = home;
  const { Store } = await import("../packages/pi-fiber/src/core/store/db");
  const { FiberClient } = await import("../packages/pi-fiber/src/core/fiber/client");
  const { Gtm } = await import("../packages/pi-fiber/src/core/gtm");
  const { Pricing } = await import("../packages/pi-fiber/src/core/fiber/pricing");
  const { DEFAULT_CONFIG } = await import("../packages/pi-fiber/src/core/config");
  const store = new Store(join(home, "sailor.db"));
  const gtm = new Gtm(new FiberClient({ baseUrl: mock.url, getKey: () => KEY }), store, DEFAULT_CONFIG, new Pricing());
  await gtm.searchPeople({}, { pageSize: 3, list: "Seeded RevOps" });
  store.close();
  void cwd;
}

async function main() {
  const scenarios: Scenario[] = readdirSync(join(HERE, "scenarios")).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(HERE, "scenarios", f), "utf8")));
  const only = process.env.EVAL_ONLY?.split(",");
  const models = process.env.EVAL_MODELS?.split(",").map((m) => m.trim()).filter(Boolean) ?? [""];
  const results: { model: string; id: string; pass: boolean; notes: string[]; credits: number }[] = [];

  for (const model of models) {
    for (const sc of scenarios.filter((s) => !only || only.includes(s.id))) {
      const mock = await startMockFiber(sc.mock ?? {});
      const home = mkdtempSync(join(tmpdir(), "sailor-eval-"));
      const cwd = mkdtempSync(join(tmpdir(), "sailor-eval-cwd-"));
      writeFileSync(join(home, "config.json"), JSON.stringify({ fiber: { mcp: [] }, budget: { session: 500 } }));
      for (const [name, content] of Object.entries(sc.files ?? {})) writeFileSync(join(cwd, name), content);
      if (sc.setup === "search3") { await seed(mock, home, cwd); mock.requests.length = 0; }
      const startCredits = mock.state.credits;
      const args = ["-p", "--mode", "json", "-e", EXT, ...(model ? ["--model", model] : []), ...(sc.maxSpend ? ["--fiber-max-spend", String(sc.maxSpend)] : []), ...(sc.flags ?? []), sc.prompt];
      const run = await runPi(args, { FIBER_API_KEY: KEY, FIBER_BASE_URL: mock.url, FIBER_MCP_BASE_URL: mock.url, SAILOR_HOME: home, SAILOR_DB: join(home, "sailor.db"), SAILOR_DISABLE_KEYCHAIN: "1" }, cwd);
      const text = finalText(run.stdout);
      const paths = mock.requests.map((r) => r.path);
      const credits = startCredits - mock.state.credits;
      const notes: string[] = [];
      const e = sc.expect;
      for (const p of e.calledPaths ?? []) if (!paths.includes(p)) notes.push(`expected call to ${p}`);
      for (const p of e.notCalledPaths ?? []) if (paths.includes(p)) notes.push(`unexpected call to ${p}`);
      for (const group of e.anyOfPaths ?? []) if (!group.some((p) => paths.includes(p))) notes.push(`expected one of ${group.join(" | ")}`);
      if (e.maxCredits !== undefined && credits > e.maxCredits) notes.push(`spent ${credits} > ${e.maxCredits}`);
      if (e.maxPageSize !== undefined) for (const r of mock.requests) if ((r.body?.pageSize ?? 0) > e.maxPageSize) notes.push(`pageSize ${r.body.pageSize} on ${r.path}`);
      for (const [p, n] of Object.entries(e.maxCallsToPath ?? {})) { const k = paths.filter((x) => x === p).length; if (k > n) notes.push(`${k} calls to ${p} (max ${n})`); }
      if (e.finalTextMatches && !new RegExp(e.finalTextMatches, "i").test(text)) notes.push(`final text !~ /${e.finalTextMatches}/`);
      if (e.finalTextNotMatches && new RegExp(e.finalTextNotMatches, "i").test(text)) notes.push(`final text ~ /${e.finalTextNotMatches}/`);
      if (run.code !== 0) notes.push(`pi exited ${run.code}: ${run.stderr.slice(-300)}`);
      const pass = notes.length === 0;
      results.push({ model: model || "(default)", id: sc.id, pass, notes, credits });
      console.log(`${pass ? "PASS" : "FAIL"} ${model || "(default)"} ${sc.id} ${sc.title} · ${credits} cr${pass ? "" : `\n     ${notes.join("\n     ")}`}`);
      await mock.close();
    }
  }
  const byModel = new Map<string, { pass: number; total: number; credits: number }>();
  for (const r of results) { const m = byModel.get(r.model) ?? { pass: 0, total: 0, credits: 0 }; m.total++; m.credits += r.credits; if (r.pass) m.pass++; byModel.set(r.model, m); }
  console.log("\nSummary");
  for (const [m, s] of byModel) console.log(`  ${m}: ${s.pass}/${s.total} (${Math.round((s.pass / s.total) * 100)}%) · ${s.credits} mock credits`);
  writeFileSync(join(HERE, "last-results.json"), JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
