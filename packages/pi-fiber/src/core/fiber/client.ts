/**
 * FiberClient — the single choke point for every Fiber HTTP call.
 *  - injects the API key at call time (the LLM never sees it; tool schemas never contain apiKey)
 *  - per-route rate limiting, 429 back-off, idempotency-aware retries
 *  - maps 401/402/429 to typed errors, never auto-retries paid non-idempotent calls on timeouts (C4)
 *  - extracts `chargeInfo` (authoritative billing) and emits it to the meter/ledger
 * Uses Node's global fetch (Node ≥ 22). Behind a corporate proxy run with NODE_USE_ENV_PROXY=1.
 */
import {
  BlockedByPolicyError, FiberHttpError, InvalidKeyError, OutOfCreditsError, RateLimitedError, SandboxUnsupportedError, UnknownOutcomeError,
} from "../errors";
import { redactText } from "../redact";
import { fillPath, getOp, type HttpMethod, type OpMeta } from "./ops";
import { RateLimiter, sleep } from "./ratelimit";
import { isSandboxKey, SANDBOX_UNSUPPORTED_OPS } from "./sandbox";

export interface ChargeEvent {
  opId: string;
  /** request args without the key (used to compute the pre-call estimate for the ledger) */
  args?: Record<string, any>;
  credits: number;
  method?: string;
  lowCreditAlert?: { availableCredits?: number; getMoreCreditsUrl?: string; message?: string };
  raw: unknown;
  at: number;
}

export interface FiberClientOptions {
  baseUrl: string;
  getKey: () => string | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  limiter?: RateLimiter;
  maxRetries?: number;
  userAgent?: string;
  onCharge?: (e: ChargeEvent) => void;
  onWait?: (opId: string, ms: number) => void;
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Required for ops not in the registry (generic passthrough). */
  method?: HttpMethod;
  path?: string;
  allowAdmin?: boolean;
  timeoutMs?: number;
}

export interface FiberResponse<T = any> {
  output: T;
  chargeInfo?: unknown;
  warnings?: unknown[];
  advice?: unknown[];
  [k: string]: unknown;
}

export class FiberClient {
  /** True once Fiber has answered with `x-fiber-sandbox: true` (sandbox key, nothing charged). */
  sandboxSeen = false;
  /** Operations that returned 501 for a sandbox key (seeded with the known list, extended at runtime). */
  readonly sandboxUnsupported = new Set<string>(SANDBOX_UNSUPPORTED_OPS);
  readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: FiberClientOptions) {
    this.limiter = opts.limiter ?? new RateLimiter();
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
  }

  hasKey(): boolean {
    return !!this.opts.getKey();
  }

  async call<T = any>(opId: string, args: Record<string, any> = {}, co: CallOptions = {}): Promise<FiberResponse<T>> {
    const known = getOp(opId);
    const meta: OpMeta | undefined = known ?? (co.path ? {
      opId, method: co.method ?? "POST", path: co.path, paid: true, idempotent: false, rpm: 30, family: "unknown",
    } : undefined);
    if (!meta) throw new FiberHttpError(`Unknown Fiber operation "${opId}". Use fiber_find_operation to discover it.`, 400, opId);
    if (meta.deny) throw new BlockedByPolicyError(meta.opId, "money movement / account signup is never performed by the agent. Do it in the Fiber dashboard.");
    if (meta.admin && !co.allowAdmin) throw new BlockedByPolicyError(meta.opId, "API-key administration requires /fiber admin mode.");

    const key = this.opts.getKey();
    if (!key) throw new InvalidKeyError(meta.opId, "no key configured");
    if (isSandboxKey(key) && this.sandboxUnsupported.has(meta.opId)) throw new SandboxUnsupportedError(meta.opId);

    const { path, rest } = fillPath(meta.path, stripApiKey(args));
    const url = new URL(path, this.opts.baseUrl);
    const init: RequestInit = {
      method: meta.method,
      headers: {
        "x-api-key": key,
        "accept": "application/json",
        "user-agent": this.opts.userAgent ?? "sailor-pi-fiber/0.1",
      },
    };
    if (meta.method === "GET" || meta.method === "DELETE") {
      url.searchParams.set("apiKey", key);
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    } else {
      (init.headers as Record<string, string>)["content-type"] = "application/json";
      init.body = JSON.stringify({ apiKey: key, ...rest });
    }

    const maxRetries = this.opts.maxRetries ?? 3;
    const timeoutMs = co.timeoutMs ?? meta.timeoutMs ?? this.opts.timeoutMs ?? 120_000;
    let attempt = 0;
    for (;;) {
      attempt++;
      await this.limiter.acquire(meta.opId, meta.rpm, co.signal, (ms) => this.opts.onWait?.(meta.opId, ms));
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = co.signal ? AbortSignal.any([co.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await this.fetchImpl(url, { ...init, signal });
      } catch (err) {
        if (co.signal?.aborted) throw co.signal.reason ?? err;
        const cause = timeout.aborted ? `timed out after ${Math.round(timeoutMs / 1000)}s` : `network error: ${(err as Error).message}`;
        if (meta.paid && !meta.idempotent) throw new UnknownOutcomeError(meta.opId, cause);
        if (attempt <= maxRetries) { await sleep(backoff(attempt), co.signal); continue; }
        throw new FiberHttpError(`${meta.opId} failed: ${cause}`, 0, meta.opId);
      }

      const body = await readBody(res);
      if (res.headers.get("x-fiber-sandbox") === "true") this.sandboxSeen = true;
      if (res.ok) {
        this.emitCharge(meta.opId, body, rest);
        return body as FiberResponse<T>;
      }
      switch (res.status) {
        case 401:
        case 403:
          throw new InvalidKeyError(meta.opId, body);
        case 402:
          throw new OutOfCreditsError(meta.opId, findUrl(body), body);
        case 429: {
          const wait = retryAfterMs(res, body);
          this.limiter.block(meta.opId, wait);
          // 429 = request rejected before processing → safe to retry even for paid ops.
          if (attempt <= maxRetries) { this.opts.onWait?.(meta.opId, wait); await sleep(wait, co.signal); continue; }
          throw new RateLimitedError(meta.opId, wait, body);
        }
        case 501:
          if (isSandboxKey(key)) this.sandboxUnsupported.add(meta.opId);
          throw new SandboxUnsupportedError(meta.opId, body);
        default: {
          if (res.status >= 500 && meta.idempotent && attempt <= maxRetries) { await sleep(backoff(attempt), co.signal); continue; }
          const msg = errorText(body) ?? res.statusText;
          throw new FiberHttpError(
            `${meta.opId} → HTTP ${res.status}: ${redactText(msg)}`,
            res.status, meta.opId, body, (body as any)?.errorCode,
            res.status === 400 ? "Check field names/enum values (see ai-docs for this operation)." : res.status >= 500 ? "Fiber server error; include errorCode if contacting support." : undefined,
          );
        }
      }
    }
  }

  private emitCharge(opId: string, body: any, args: Record<string, any>): void {
    const info = body?.chargeInfo ?? body?.output?.chargeInfo;
    if (!info || !this.opts.onCharge) return;
    this.opts.onCharge({ opId, args, ...parseCharge(info), raw: info, at: Date.now() });
  }
}

/**
 * chargeInfo variants (verbatim from ai-docs): charged-now {creditsCharged}, charging-later {message},
 * charged-for-async-process {creditsCharged}, free {message}, credits-refunded {creditsRefunded};
 * each may carry lowCreditAlert {getMoreCreditsUrl, message, availableCredits}.
 */
export function parseCharge(info: any): { credits: number; method?: string; lowCreditAlert?: ChargeEvent["lowCreditAlert"] } {
  if (!info || typeof info !== "object") return { credits: 0 };
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const method: string | undefined = info.method;
  let credits = 0;
  if (method === "credits-refunded") credits = -num(info.creditsRefunded);
  else if (method === "charged-now" || method === "charged-for-async-process") credits = num(info.creditsCharged);
  else if (method !== "free" && method !== "charging-later") credits = num(info.creditsCharged);
  return { credits, method, lowCreditAlert: info.lowCreditAlert ?? undefined };
}

function stripApiKey(args: Record<string, any>): Record<string, any> {
  const { apiKey: _a, api_key: _b, ...rest } = args ?? {};
  return rest;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 2000) }; }
}

function errorText(body: any): string | undefined {
  if (!body) return undefined;
  if (typeof body === "string") return body;
  return body.message ?? body.error?.message ?? (typeof body.error === "string" ? body.error : undefined) ?? body.detail ?? (body.issues ? JSON.stringify(body.issues).slice(0, 800) : undefined);
}

function findUrl(body: unknown): string | undefined {
  const s = JSON.stringify(body ?? "");
  const m = s.match(/https?:\/\/[^"\s]+/);
  return m?.[0];
}

function retryAfterMs(res: Response, body: any): number {
  const h = res.headers.get("retry-after");
  if (h) {
    const secs = Number(h);
    if (Number.isFinite(secs)) return Math.max(1000, secs * 1000);
    const date = Date.parse(h);
    if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
  }
  const b = Number(body?.retryAfterSeconds ?? body?.retryAfter);
  return Number.isFinite(b) && b > 0 ? b * 1000 : 5_000;
}

function backoff(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}
