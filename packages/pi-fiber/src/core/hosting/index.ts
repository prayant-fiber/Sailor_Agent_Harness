/**
 * Hosting adapters that give Mosaic a public HTTPS URL for a local file (edge cases D1, D10).
 * Cleanup specs are JSON so they can be persisted in the job row and retried after a restart.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { SailorConfig } from "../config";
import { driveDelete, driveMakePublic, driveRevoke, driveUpload } from "../google/drive";
import { getAccessToken, googleClientFromEnv } from "../google/oauth";
import { presignS3, type S3Target } from "./s3";

export type CleanupSpec =
  | { provider: "gdrive"; fileId: string; permissionId: string }
  | { provider: "s3"; key: string }
  | { provider: "none" };

export interface HostedFile { url: string; provider: string; expiresAt?: number; cleanup: CleanupSpec }

function s3Target(cfg: SailorConfig): S3Target {
  const s = cfg.hosting.s3;
  if (!s) throw new Error('S3/R2 hosting is not configured. Add hosting.s3 {region,bucket,endpoint?,accessKeyIdEnv,secretAccessKeyEnv} to ~/.sailor/config.json.');
  const accessKeyId = process.env[s.accessKeyIdEnv];
  const secretAccessKey = process.env[s.secretAccessKeyEnv];
  if (!accessKeyId || !secretAccessKey) throw new Error(`Set ${s.accessKeyIdEnv} and ${s.secretAccessKeyEnv} for S3/R2 hosting.`);
  return { endpoint: s.endpoint, region: s.region, bucket: s.bucket, accessKeyId, secretAccessKey, sessionToken: process.env.AWS_SESSION_TOKEN };
}

export function mimeFor(path: string): string {
  if (/\.xlsx$/i.test(path)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/\.tsv$/i.test(path)) return "text/tab-separated-values";
  if (/\.txt$/i.test(path)) return "text/plain";
  return "text/csv";
}

export async function hostFile(path: string, cfg: SailorConfig): Promise<HostedFile> {
  const provider = cfg.hosting.provider;
  if (provider === "gdrive") {
    const token = await getAccessToken(googleClientFromEnv(cfg.google.clientIdEnv, cfg.google.clientSecretEnv));
    const fileId = await driveUpload(token, path, mimeFor(path));
    const { url, permissionId } = await driveMakePublic(token, fileId);
    return { url, provider, cleanup: { provider: "gdrive", fileId, permissionId } };
  }
  if (provider === "s3") {
    const t = s3Target(cfg);
    const ttl = cfg.hosting.s3?.ttlSeconds ?? 3600;
    const key = `${cfg.hosting.s3?.prefix ?? "sailor-mosaic/"}${randomUUID()}-${basename(path)}`;
    const put = presignS3("PUT", t, key, 900);
    const res = await fetch(put, { method: "PUT", body: readFileSync(path), headers: { "content-type": mimeFor(path) } });
    if (!res.ok) throw new Error(`S3/R2 upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return { url: presignS3("GET", t, key, ttl), provider, expiresAt: Date.now() + ttl * 1000, cleanup: { provider: "s3", key } };
  }
  throw new Error("MANUAL_URL_REQUIRED");
}

export async function runCleanup(spec: CleanupSpec | undefined, cfg: SailorConfig): Promise<void> {
  if (!spec || spec.provider === "none") return;
  if (spec.provider === "gdrive") {
    const token = await getAccessToken(googleClientFromEnv(cfg.google.clientIdEnv, cfg.google.clientSecretEnv));
    await driveRevoke(token, spec.fileId, spec.permissionId).catch(() => undefined);
    await driveDelete(token, spec.fileId);
    return;
  }
  if (spec.provider === "s3") {
    const res = await fetch(presignS3("DELETE", s3Target(cfg), spec.key, 300), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`S3/R2 delete failed: HTTP ${res.status}`);
  }
}

export function isPublicHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (process.env.SAILOR_ALLOW_INSECURE_URLS === "1" && u.protocol === "http:") return true; // tests / local mocks only
    return u.protocol === "https:" && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname);
  } catch {
    return false;
  }
}
