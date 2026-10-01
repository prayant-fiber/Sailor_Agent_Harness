/**
 * Google OAuth for Sheets/Drive (F7, edge cases J1/J2/J6/J7). Zero dependencies.
 *  - Scope: drive.file only (non-sensitive; covers Sheets/Drive files Sailor creates or the user opens with it).
 *  - Loopback flow with PKCE for desktop; device-code flow for SSH/headless terminals.
 *  - Bring-your-own OAuth client: SAILOR_GOOGLE_CLIENT_ID / SAILOR_GOOGLE_CLIENT_SECRET ("Desktop app" client type).
 *  - Refresh token is stored in the OS keychain (or 0600 file) under "google:refresh".
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { deleteSecret, getSecret, setSecret } from "../secrets";

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DEVICE_URL = "https://oauth2.googleapis.com/device/code";

export interface GoogleClient { clientId: string; clientSecret?: string }

export class GoogleAuthRequired extends Error {
  constructor(msg = "Google is not connected. Run /sheets connect.") { super(msg); this.name = "GoogleAuthRequired"; }
}

let cached: { token: string; exp: number } | undefined;

export function googleClientFromEnv(idEnv = "SAILOR_GOOGLE_CLIENT_ID", secretEnv = "SAILOR_GOOGLE_CLIENT_SECRET"): GoogleClient | undefined {
  const clientId = process.env[idEnv] ?? getSecret("google:client_id")?.value;
  const clientSecret = process.env[secretEnv] ?? getSecret("google:client_secret")?.value;
  return clientId ? { clientId, clientSecret } : undefined;
}

export function isGoogleConnected(): boolean {
  return !!getSecret("google:refresh");
}

export function disconnectGoogle(): void {
  deleteSecret("google:refresh");
  cached = undefined;
}

async function tokenRequest(params: Record<string, string>): Promise<any> {
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Google token error: ${body.error ?? res.status} ${body.error_description ?? ""}`.trim());
    (err as any).code = body.error;
    throw err;
  }
  return body;
}

export async function getAccessToken(client: GoogleClient | undefined): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const refresh = getSecret("google:refresh")?.value;
  if (!refresh || !client) throw new GoogleAuthRequired();
  try {
    const body = await tokenRequest({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), refresh_token: refresh, grant_type: "refresh_token" });
    cached = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  } catch (err) {
    if ((err as any).code === "invalid_grant") { disconnectGoogle(); throw new GoogleAuthRequired("Google access was revoked or expired. Run /sheets connect again."); }
    throw err;
  }
}

/** Desktop loopback flow. `open(url)` should launch the browser (or print the URL). */
export async function loopbackAuthorize(client: GoogleClient, open: (url: string) => void | Promise<void>, timeoutMs = 5 * 60_000): Promise<void> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(12).toString("hex");
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}`;
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: client.clientId, redirect_uri: redirectUri, response_type: "code", scope: GOOGLE_SCOPES.join(" "),
    code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "consent",
  })}`;
  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { server.close(); reject(new Error("Timed out waiting for Google sign-in.")); }, timeoutMs);
    server.on("request", (req, res) => {
      const u = new URL(req.url ?? "/", redirectUri);
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html" });
      if (u.searchParams.get("state") !== state && !err) { res.end("State mismatch. Close this tab and retry /sheets connect."); return; }
      res.end(err ? `<h3>Sailor: Google sign-in failed (${err}). You can close this tab.</h3>` : "<h3>Sailor is connected to Google. You can close this tab.</h3>");
      clearTimeout(timer);
      server.close();
      if (err) reject(new Error(`Google sign-in failed: ${err}`));
      else if (c) resolve(c);
    });
    Promise.resolve(open(url)).catch(reject);
  });
  const tokens = await tokenRequest({
    client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
    code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri,
  });
  if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Remove Sailor from your Google account's third-party access and retry.");
  setSecret("google:refresh", tokens.refresh_token);
  cached = { token: tokens.access_token, exp: Date.now() + (tokens.expires_in ?? 3600) * 1000 };
}

/** Device-code flow for SSH / no-browser environments (J1). */
export async function deviceAuthorize(client: GoogleClient, show: (verificationUrl: string, userCode: string) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(DEVICE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: client.clientId, scope: GOOGLE_SCOPES.join(" ") }) });
  const d: any = await res.json();
  if (!res.ok) throw new Error(`Google device flow error: ${d.error ?? res.status}. Device flow needs a "TVs and Limited Input devices" OAuth client.`);
  show(d.verification_url ?? d.verification_uri, d.user_code);
  let interval = (d.interval ?? 5) * 1000;
  const deadline = Date.now() + (d.expires_in ?? 900) * 1000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("aborted");
    await new Promise((r) => setTimeout(r, interval));
    try {
      const t = await tokenRequest({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), device_code: d.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
      if (!t.refresh_token) throw new Error("No refresh token returned.");
      setSecret("google:refresh", t.refresh_token);
      cached = { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 };
      return;
    } catch (err) {
      const code = (err as any).code;
      if (code === "authorization_pending") continue;
      if (code === "slow_down") { interval += 5000; continue; }
      throw err;
    }
  }
  throw new Error("Google device sign-in expired. Run /sheets connect --device again.");
}
