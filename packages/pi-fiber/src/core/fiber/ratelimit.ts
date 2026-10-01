/** Per-route token buckets (edge cases H1/H2). Limits come from the op registry, refined by GET /v1/rate-limits. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; capacity: number; refillPerMs: number; last: number }>();
  private blockedUntil = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  setLimit(key: string, perMinute: number): void {
    const capacity = Math.max(1, perMinute);
    const existing = this.buckets.get(key);
    this.buckets.set(key, { tokens: existing ? Math.min(existing.tokens, capacity) : capacity, capacity, refillPerMs: capacity / 60_000, last: this.now() });
  }

  /** Called after a 429 so every caller of this route waits. */
  block(key: string, ms: number): void {
    this.blockedUntil.set(key, Math.max(this.blockedUntil.get(key) ?? 0, this.now() + ms));
  }

  /** ms to wait before a request may be sent (0 = go now). Consumes a token when returning 0. */
  reserve(key: string, perMinute: number): number {
    if (!this.buckets.has(key)) this.setLimit(key, perMinute);
    const blocked = (this.blockedUntil.get(key) ?? 0) - this.now();
    if (blocked > 0) return blocked;
    const b = this.buckets.get(key)!;
    const t = this.now();
    b.tokens = Math.min(b.capacity, b.tokens + (t - b.last) * b.refillPerMs);
    b.last = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - b.tokens) / b.refillPerMs);
  }

  async acquire(key: string, perMinute: number, signal?: AbortSignal, onWait?: (ms: number) => void): Promise<void> {
    for (;;) {
      const wait = this.reserve(key, perMinute);
      if (wait <= 0) return;
      onWait?.(wait);
      await sleep(Math.min(wait, 5_000), signal);
    }
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(signal!.reason ?? new Error("aborted")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
