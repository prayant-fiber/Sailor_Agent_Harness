#!/usr/bin/env node
/**
 * sailor — branded launcher for Pi + the Sailor extension.
 *   sailor               onboarding (first run) then interactive Pi with Sailor loaded
 *   sailor login         (re)connect your Fiber API key
 *   sailor doctor        diagnose Node, Pi, Fiber key, Google, hosting, terminal
 *   sailor <pi args…>    anything else is passed to pi (e.g. sailor -p "count heads of revops in the US" --fiber-max-spend 5)
 * Plain JavaScript on purpose: runs on any Node ≥ 22.13 with no build step.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

// node:sqlite prints an ExperimentalWarning on load; hide just that one.
const _emit = process.emitWarning.bind(process);
process.emitWarning = (w, ...rest) => (String(w?.message ?? w).includes("SQLite") ? undefined : _emit(w, ...rest));

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL_EXT = resolve(HERE, "../../pi-fiber/extensions/sailor");
const SAILOR_HOME = process.env.SAILOR_HOME || join(homedir(), ".sailor");
const BASE_URL = process.env.FIBER_BASE_URL || "https://api.fiber.ai";
const PKG = "@sailor/pi-fiber";
const PI_PKG = "@earendil-works/pi-coding-agent";

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };
const noColor = !!process.env.NO_COLOR || !process.stdout.isTTY;
for (const k of Object.keys(c)) if (noColor) c[k] = (s) => s;

// ── secrets (same layout as packages/pi-fiber/src/core/secrets.ts) ─────────
const which = (cmd) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0;
function keychain() {
  if (process.env.SAILOR_DISABLE_KEYCHAIN === "1") return null;
  if (process.platform === "darwin" && which("security")) return "macos";
  if (process.platform === "linux" && which("secret-tool") && process.env.DBUS_SESSION_BUS_ADDRESS) return "secret-tool";
  return null;
}
function readStore() { try { return JSON.parse(readFileSync(join(SAILOR_HOME, "credentials.json"), "utf8")); } catch { return {}; } }
function writeStore(d) { mkdirSync(SAILOR_HOME, { recursive: true, mode: 0o700 }); const p = join(SAILOR_HOME, "credentials.json"); writeFileSync(p, JSON.stringify(d, null, 2), { mode: 0o600 }); try { chmodSync(p, 0o600); } catch {} }
function getSecret(account) {
  const kc = keychain();
  if (kc === "macos") { const r = spawnSync("security", ["find-generic-password", "-s", "sailor", "-a", account, "-w"], { encoding: "utf8" }); if (r.status === 0 && r.stdout.trim()) return r.stdout.trim(); }
  if (kc === "secret-tool") { const r = spawnSync("secret-tool", ["lookup", "service", "sailor", "account", account], { encoding: "utf8" }); if (r.status === 0 && r.stdout.trim()) return r.stdout.trim(); }
  return readStore()[account];
}
function setSecret(account, value) {
  const kc = keychain();
  if (kc === "macos" && spawnSync("security", ["add-generic-password", "-U", "-s", "sailor", "-a", account, "-w", value], { stdio: "ignore" }).status === 0) return "OS keychain";
  if (kc === "secret-tool" && spawnSync("secret-tool", ["store", "--label", `Sailor ${account}`, "service", "sailor", "account", account], { input: value, stdio: ["pipe", "ignore", "ignore"] }).status === 0) return "OS keychain";
  const s = readStore(); s[account] = value; writeStore(s); return `${join(SAILOR_HOME, "credentials.json")} (0600)`;
}
function config() { try { return JSON.parse(readFileSync(join(SAILOR_HOME, "config.json"), "utf8")); } catch { return {}; } }
function resolveKey() {
  return process.env.FIBER_API_KEY || process.env.FIBERAI_API_KEY || getSecret(`fiber:${config().fiber?.profile ?? "default"}`);
}
const mask = (k) => (k ? k.replace(/^(sk_[a-z]+_).*(.{4})$/, "$1****$2") : "(none)");

// ── prompts ───────────────────────────────────────────────────────────────
function ask(q, { hidden = false } = {}) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const write = rl._writeToOutput?.bind(rl);
      rl._writeToOutput = (s) => { if (s.includes(q)) write?.(s); else write?.("*".repeat(Math.min(s.length, 1))); };
    }
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); res(a.trim()); });
  });
}

async function credits(key) {
  const res = await fetch(`${BASE_URL}/v1/get-org-credits?apiKey=${encodeURIComponent(key)}`, { headers: { "x-api-key": key } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 501 && key.startsWith("sk_test_")) return { sandbox: true }; // balance isn't sandboxed yet
  if (!res.ok) throw new Error(res.status === 401 ? "Fiber rejected this key (401)." : `Fiber returned HTTP ${res.status}`);
  const out = Array.isArray(body.output) ? body.output : [body.output];
  return out.sort((a, b) => (b?.available ?? 0) - (a?.available ?? 0))[0];
}

async function login() {
  console.log(`${c.bold("Connect Fiber")} — create or copy a key at ${c.dim("https://fiber.ai/app/api")}`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = await ask("Fiber API key (sk_live_… or sandbox sk_test_…): ", { hidden: true });
    if (!key) return false;
    try {
      const org = await credits(key);
      const where = setSecret(`fiber:${config().fiber?.profile ?? "default"}`, key);
      const bal = org?.sandbox ? "sandbox key (no credits charged)" : `${Number(org?.available ?? 0).toLocaleString()} credits available${key.startsWith("sk_test_") ? " · sandbox key (no credits charged)" : ""}`;
      console.log(c.green(`✓ Connected (${mask(key)}) · ${bal} · stored in ${where}`));
      return true;
    } catch (e) {
      console.log(c.red(`✗ ${e.message}`));
    }
  }
  return false;
}

// ── pi discovery ──────────────────────────────────────────────────────────
function piBin() {
  if (which("pi")) return "pi";
  const local = resolve(HERE, "../../../node_modules/.bin/pi");
  return existsSync(local) ? local : null;
}

function piPackageInstalled(pi) {
  const r = spawnSync(pi, ["list"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.includes(PKG);
}

async function ensurePi() {
  let pi = piBin();
  if (pi) return pi;
  const a = await ask(`Pi (${PI_PKG}) is not installed. Install it globally with npm now? [Y/n] `);
  if (/^n/i.test(a)) { console.log(`Install manually: npm install -g --ignore-scripts ${PI_PKG}`); process.exit(1); }
  const r = spawnSync("npm", ["install", "-g", "--ignore-scripts", PI_PKG], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  pi = piBin();
  if (!pi) { console.log(c.red("pi still not on PATH — open a new terminal and retry.")); process.exit(1); }
  return pi;
}

// ── doctor ────────────────────────────────────────────────────────────────
async function doctor() {
  const ok = (m) => console.log(`${c.green("✓")} ${m}`);
  const warn = (m) => console.log(`${c.yellow("!")} ${m}`);
  const bad = (m) => console.log(`${c.red("✗")} ${m}`);
  const [maj, min] = process.versions.node.split(".").map(Number);
  (maj > 22 || (maj === 22 && min >= 13)) ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} — Sailor needs ≥ 22.13 (built-in node:sqlite)`);
  process.getBuiltinModule?.("node:sqlite") ? ok("node:sqlite available") : bad("node:sqlite missing");
  const pi = piBin();
  if (pi) {
    const v = spawnSync(pi, ["--version"], { encoding: "utf8" });
    ok(`pi found (${(v.stdout || v.stderr || "").trim().split("\n")[0] || "unknown version"})`);
    if (existsSync(LOCAL_EXT)) ok(`Sailor extension (local checkout): ${LOCAL_EXT}`);
    else piPackageInstalled(pi) ? ok(`${PKG} installed in pi`) : warn(`${PKG} not installed — run: pi install npm:${PKG}`);
  } else bad(`pi not found — npm install -g --ignore-scripts ${PI_PKG}`);
  const key = resolveKey();
  if (!key) bad("No Fiber key — run: sailor login");
  else {
    try { const org = await credits(key); ok(`Fiber key ${mask(key)} valid · ${org?.sandbox ? "SANDBOX (balance endpoint not sandboxed; nothing is charged)" : `${Number(org?.available ?? 0).toLocaleString()} credits${key.startsWith("sk_test_") ? " · SANDBOX (nothing is charged)" : ""}`}`); }
    catch (e) { bad(`Fiber key ${mask(key)}: ${e.message}${/fetch failed/.test(e.message) ? " (behind a proxy? try NODE_USE_ENV_PROXY=1)" : ""}`); }
  }
  if (process.env.FIBER_API_KEY && process.env.FIBERAI_API_KEY && process.env.FIBER_API_KEY !== process.env.FIBERAI_API_KEY) warn("FIBER_API_KEY and FIBERAI_API_KEY differ; FIBER_API_KEY wins");
  const cfg = config();
  const gid = process.env.SAILOR_GOOGLE_CLIENT_ID || getSecret("google:client_id");
  gid ? (getSecret("google:refresh") ? ok("Google Sheets connected") : warn("Google OAuth client set but not connected — /sheets connect")) : warn("Google Sheets not configured (optional) — see README → Google Sheets");
  const host = cfg.hosting?.provider ?? "manual";
  host === "manual" ? warn("Mosaic hosting: manual (large /repair runs need a public URL; /repair hosting gdrive|s3)") : ok(`Mosaic hosting: ${host}`);
  keychain() ? ok("OS keychain available for secrets") : warn(`No OS keychain — secrets stored in ${join(SAILOR_HOME, "credentials.json")} (0600)`);
  process.stdout.isTTY ? ok(`Terminal ${process.stdout.columns}×${process.stdout.rows}${process.stdout.columns < 80 ? c.yellow(" (narrow: some columns hide)") : ""}`) : warn("stdout is not a TTY (print/json modes still work)");
  if (process.env.HTTPS_PROXY && process.env.NODE_USE_ENV_PROXY !== "1") warn("HTTPS_PROXY is set; export NODE_USE_ENV_PROXY=1 so Node's fetch uses it");
  try { await import("exceljs"); ok("exceljs present (.xlsx import/export)"); } catch { warn("exceljs not installed (optional, for .xlsx): npm i -g exceljs"); }
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "doctor") return doctor();
  if (args[0] === "login") { await login(); return; }
  if (args[0] === "--help" || args[0] === "help") {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(2, 8).map((l) => l.replace(/^ \* ?/, "")).join("\n"));
    return;
  }
  const interactive = process.stdin.isTTY && !args.includes("-p") && !args.includes("--print") && !args.includes("--mode");
  if (interactive && !resolveKey()) {
    console.log(c.bold("\n⛵ Welcome to Sailor — a GTM agent harness on Pi + Fiber AI\n"));
    console.log("1) Your LLM: Sailor uses Pi's providers. Set e.g. ANTHROPIC_API_KEY / OPENAI_API_KEY, or run /login inside for Claude/ChatGPT subscriptions.");
    console.log("2) Your Fiber key:");
    await login();
  }
  const pi = await ensurePi();
  const piArgs = [...args];
  if (existsSync(join(LOCAL_EXT, "index.ts"))) piArgs.unshift("-e", LOCAL_EXT);
  else if (!piPackageInstalled(pi)) {
    console.log(c.dim(`Installing ${PKG} into pi…`));
    const r = spawnSync(pi, ["install", `npm:${PKG}`], { stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const child = spawn(pi, piArgs, { stdio: "inherit", env: { ...process.env } });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => { console.error(c.red(e?.message ?? String(e))); process.exit(1); });
