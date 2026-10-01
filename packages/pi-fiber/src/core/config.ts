import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ToolsProfile = "full" | "lite";
export type Mode = "rep" | "engineer" | "recruiting";
export type HostingProvider = "manual" | "gdrive" | "s3";

export interface SailorConfig {
  fiber: {
    baseUrl: string;
    mcpBaseUrl: string;
    /** Which Fiber MCP servers to bridge. "core" = discover+call any op; "v2" = curated tools. */
    mcp: Array<"core" | "v2" | "lite">;
    /** Active key profile name (see secrets.ts). */
    profile: string;
    requestTimeoutMs: number;
  };
  budget: {
    /** Paid calls estimated at or below this many credits run without a confirm dialog. */
    autoApproveUnder: number;
    session: number;
    daily: number;
    /** Max paid tool calls per agent turn (loop protection). */
    maxPaidCallsPerTurn: number;
    /** Headless (print/json/rpc) spend allowance per call. 0 = block paid calls when no UI. */
    headlessMaxSpend: number;
  };
  dryRun: boolean;
  cache: { profileTtlDays: number; companyTtlDays: number; contactTtlDays: number };
  toolsProfile: ToolsProfile;
  mode: Mode;
  hosting: {
    provider: HostingProvider;
    s3?: { endpoint?: string; region: string; bucket: string; accessKeyIdEnv: string; secretAccessKeyEnv: string; prefix?: string; ttlSeconds?: number };
  };
  google: { clientIdEnv: string; clientSecretEnv: string; defaultFolderId?: string | null };
  compliance: { region: string; requireSuppressionCheck: boolean };
  jobs: { pollIntervalMs: number; slowPollAfterMs: number; slowPollIntervalMs: number };
  meter: { refreshIntervalMs: number; lowCreditAbsolute: number; lowCreditFraction: number };
  telemetry: { enabled: boolean };
}

export const DEFAULT_CONFIG: SailorConfig = {
  fiber: {
    baseUrl: "https://api.fiber.ai",
    mcpBaseUrl: "https://mcp.fiber.ai",
    mcp: ["core"],
    profile: "default",
    requestTimeoutMs: 120_000,
  },
  budget: { autoApproveUnder: 25, session: 500, daily: 2000, maxPaidCallsPerTurn: 10, headlessMaxSpend: 0 },
  dryRun: false,
  cache: { profileTtlDays: 30, companyTtlDays: 30, contactTtlDays: 90 },
  toolsProfile: "full",
  mode: "rep",
  hosting: { provider: "manual" },
  google: { clientIdEnv: "SAILOR_GOOGLE_CLIENT_ID", clientSecretEnv: "SAILOR_GOOGLE_CLIENT_SECRET", defaultFolderId: null },
  compliance: { region: "US", requireSuppressionCheck: true },
  // Fiber guidance: poll async jobs every 30s, never tighter.
  jobs: { pollIntervalMs: 30_000, slowPollAfterMs: 10 * 60_000, slowPollIntervalMs: 60_000 },
  meter: { refreshIntervalMs: 60_000, lowCreditAbsolute: 500, lowCreditFraction: 0.1 },
  telemetry: { enabled: false },
};

export function sailorHome(): string {
  return process.env.SAILOR_HOME || join(homedir(), ".sailor");
}

export function ensureDir(path: string, mode = 0o700): string {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode });
  return path;
}

export function globalConfigPath(): string {
  return join(sailorHome(), "config.json");
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, ".sailor", "config.json");
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(patch as any)) {
    if (v === undefined) continue;
    const b = (base as any)?.[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b) ? deepMerge(b, v as any) : v;
  }
  return out;
}

function readJson(path: string): any {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Invalid JSON in ${path}: ${(err as Error).message}`);
  }
}

/** Global (~/.sailor/config.json) merged with project (.sailor/config.json) merged with env overrides. */
export function loadConfig(cwd: string = process.cwd()): SailorConfig {
  let cfg = deepMerge(DEFAULT_CONFIG, readJson(globalConfigPath()));
  cfg = deepMerge(cfg, readJson(projectConfigPath(cwd)));
  if (process.env.SAILOR_DRY_RUN === "1") cfg.dryRun = true;
  if (process.env.SAILOR_TOOLS_PROFILE === "lite") cfg.toolsProfile = "lite";
  if (process.env.SAILOR_MAX_SPEND) cfg.budget.headlessMaxSpend = Number(process.env.SAILOR_MAX_SPEND) || 0;
  if (process.env.FIBER_BASE_URL) cfg.fiber.baseUrl = process.env.FIBER_BASE_URL;
  if (process.env.FIBER_MCP_BASE_URL) cfg.fiber.mcpBaseUrl = process.env.FIBER_MCP_BASE_URL;
  return cfg;
}

/** Persist a partial patch into the global config file. */
export function saveGlobalConfig(patch: DeepPartial<SailorConfig>): SailorConfig {
  const path = globalConfigPath();
  ensureDir(dirname(path));
  const current = readJson(path) ?? {};
  const next = deepMerge(current, patch as any);
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort on non-POSIX */ }
  return loadConfig();
}
