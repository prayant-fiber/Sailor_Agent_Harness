/**
 * Minimal AWS SigV4 query-string presigning (S3, Cloudflare R2, MinIO). Zero dependencies.
 * Used to give Mosaic a short-lived public HTTPS URL for a local file (edge case D1).
 */
import { createHash, createHmac } from "node:crypto";

export interface S3Target {
  endpoint?: string; // e.g. https://<account>.r2.cloudflarestorage.com ; default https://s3.<region>.amazonaws.com
  region: string;    // "auto" for R2
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256hex = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const hmac = (key: string | Buffer, s: string) => createHmac("sha256", key).update(s).digest();

export function presignS3(method: "GET" | "PUT" | "DELETE", t: S3Target, key: string, expiresSeconds: number, now = new Date()): string {
  const endpoint = (t.endpoint ?? `https://s3.${t.region}.amazonaws.com`).replace(/\/+$/, "");
  const url = new URL(`${endpoint}/${enc(t.bucket)}/${key.split("/").map(enc).join("/")}`);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${t.region}/s3/aws4_request`;
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${t.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.min(604800, Math.max(1, Math.round(expiresSeconds)))),
    "X-Amz-SignedHeaders": "host",
  };
  if (t.sessionToken) params["X-Amz-Security-Token"] = t.sessionToken;
  const canonicalQuery = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  const canonicalRequest = [method, url.pathname, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${t.secretAccessKey}`, date);
  const kSigning = hmac(hmac(hmac(kDate, t.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
