/**
 * Secret storage: OS keychain when available (macOS `security`, Linux `secret-tool`),
 * otherwise a 0600 JSON file at ~/.sailor/credentials.json. Zero npm dependencies.
 *
 * Fiber key resolution order (edge cases B1/B6):
 *   FIBER_API_KEY (MCP docs) → FIBERAI_API_KEY (SDK docs) → keychain(profile) → credentials file(profile)
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, sailorHome } from "./config";

const SERVICE = "sailor";

export type SecretBackend = "env" | "keychain" | "file";

function credentialsPath(): string {
  return join(sailorHome(), "credentials.json");
}

function readFileStore(): Record<string, string> {
  const p = credentialsPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function writeFileStore(data: Record<string, string>): void {
  ensureDir(sailorHome());
  const p = credentialsPath();
  writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 });
  try { chmodSync(p, 0o600); } catch { /* ignore */ }
}

function hasCmd(cmd: string): boolean {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
  return r.status === 0;
}

function keychainAvailable(): "macos" | "secret-tool" | null {
  if (process.env.SAILOR_DISABLE_KEYCHAIN === "1") return null;
  if (process.platform === "darwin" && hasCmd("security")) return "macos";
  if (process.platform === "linux" && hasCmd("secret-tool") && process.env.DBUS_SESSION_BUS_ADDRESS) return "secret-tool";
  return null;
}

function keychainGet(account: string): string | undefined {
  const kc = keychainAvailable();
  if (kc === "macos") {
    const r = spawnSync("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() || undefined : undefined;
  }
  if (kc === "secret-tool") {
    const r = spawnSync("secret-tool", ["lookup", "service", SERVICE, "account", account], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() || undefined : undefined;
  }
  return undefined;
}

function keychainSet(account: string, value: string): boolean {
  const kc = keychainAvailable();
  if (kc === "macos") {
    const r = spawnSync("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", value], { stdio: "ignore" });
    return r.status === 0;
  }
  if (kc === "secret-tool") {
    const r = spawnSync("secret-tool", ["store", "--label", `Sailor ${account}`, "service", SERVICE, "account", account], { input: value, stdio: ["pipe", "ignore", "ignore"] });
    return r.status === 0;
  }
  return false;
}

function keychainDelete(account: string): void {
  const kc = keychainAvailable();
  if (kc === "macos") spawnSync("security", ["delete-generic-password", "-s", SERVICE, "-a", account], { stdio: "ignore" });
  if (kc === "secret-tool") spawnSync("secret-tool", ["clear", "service", SERVICE, "account", account], { stdio: "ignore" });
}

export function getSecret(account: string): { value: string; backend: SecretBackend } | undefined {
  const kc = keychainGet(account);
  if (kc) return { value: kc, backend: "keychain" };
  const file = readFileStore()[account];
  if (file) return { value: file, backend: "file" };
  return undefined;
}

export function setSecret(account: string, value: string): SecretBackend {
  if (keychainSet(account, value)) {
    // make sure no stale plaintext copy survives
    const store = readFileStore();
    if (store[account]) { delete store[account]; writeFileStore(store); }
    return "keychain";
  }
  const store = readFileStore();
  store[account] = value;
  writeFileStore(store);
  return "file";
}

export function deleteSecret(account: string): void {
  keychainDelete(account);
  const store = readFileStore();
  if (store[account]) { delete store[account]; writeFileStore(store); }
}

export function listProfiles(): string[] {
  const names = new Set<string>();
  for (const k of Object.keys(readFileStore())) if (k.startsWith("fiber:")) names.add(k.slice(6));
  return [...names];
}

export interface ResolvedKey {
  key: string;
  source: "FIBER_API_KEY" | "FIBERAI_API_KEY" | SecretBackend;
  warning?: string;
}

export function resolveFiberKey(profile = "default"): ResolvedKey | undefined {
  const a = process.env.FIBER_API_KEY?.trim();
  const b = process.env.FIBERAI_API_KEY?.trim();
  if (a) return { key: a, source: "FIBER_API_KEY", warning: b && b !== a ? "FIBER_API_KEY and FIBERAI_API_KEY differ; using FIBER_API_KEY." : undefined };
  if (b) return { key: b, source: "FIBERAI_API_KEY" };
  const s = getSecret(`fiber:${profile}`);
  return s ? { key: s.value, source: s.backend } : undefined;
}

export function storeFiberKey(key: string, profile = "default"): SecretBackend {
  return setSecret(`fiber:${profile}`, key.trim());
}

export function removeFiberKey(profile = "default"): void {
  deleteSecret(`fiber:${profile}`);
}

export function looksLikeFiberKey(s: string): boolean {
  return /^sk_(live|test|sandbox)_[A-Za-z0-9_-]{8,}$/.test(s.trim());
}
