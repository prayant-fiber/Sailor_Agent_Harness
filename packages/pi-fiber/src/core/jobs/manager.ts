/**
 * Persistent async job manager (F15, edge cases A4, C3, D4, D7, I8).
 * Jobs live in SQLite, so they survive Pi restarts; the manager resumes them on session start.
 * Poll cadence follows Fiber guidance: ≥ 30 s, slowing to 60 s after 10 minutes.
 */
import type { SailorConfig } from "../config";
import { errorMessage, OutOfCreditsError } from "../errors";
import type { JobRow, Store } from "../store/db";

export interface PollOutcome {
  status: "pending" | "running" | "done" | "failed" | "canceled";
  progress?: { done?: number | null; total?: number | null };
  result?: unknown;
  error?: string;
  /** params patch to persist (e.g. pagination cursor) */
  params?: unknown;
}

export interface JobHandler {
  poll(job: JobRow): Promise<PollOutcome>;
  /** Called once when poll reports done. Must be idempotent (may re-run after a crash). */
  finalize(job: JobRow, outcome: PollOutcome): Promise<{ summary: string; result?: unknown }>;
  onFailed?(job: JobRow, outcome: PollOutcome): Promise<void>;
  cancel?(job: JobRow): Promise<void>;
}

export interface JobEvent { type: "progress" | "done" | "failed" | "paused"; job: JobRow; summary?: string }

export class JobManager {
  private handlers = new Map<string, JobHandler>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private listeners = new Set<(e: JobEvent) => void>();

  constructor(private readonly store: Store, private readonly config: SailorConfig, private readonly now: () => number = Date.now) {}

  register(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  onEvent(fn: (e: JobEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: JobEvent): void {
    for (const l of this.listeners) { try { l(e); } catch { /* UI errors must not kill polling */ } }
  }

  start(checkEveryMs = 5_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), checkEveryMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  active(): JobRow[] {
    return this.store.jobs({ active: true });
  }

  nextPollAt(job: JobRow): number {
    const age = this.now() - job.created_at;
    const iv = age > this.config.jobs.slowPollAfterMs ? this.config.jobs.slowPollIntervalMs : this.config.jobs.pollIntervalMs;
    return this.now() + Math.max(30_000, iv);
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const job of this.store.dueJobs(this.now())) await this.pollOne(job);
    } finally {
      this.ticking = false;
    }
  }

  /** Force an immediate poll (e.g. `/jobs refresh`) — still respects the per-op rate limiter in the client. */
  async pollNow(jobId: string): Promise<void> {
    const job = this.store.getJob(jobId);
    if (job && job.remote_id) await this.pollOne(job);
  }

  private async pollOne(job: JobRow): Promise<void> {
    const h = this.handlers.get(job.kind);
    if (!h) return;
    let out: PollOutcome;
    try {
      out = await h.poll(job);
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        this.store.updateJob(job.id, { status: "paused_out_of_credits", error: err.message });
        this.emit({ type: "paused", job: this.store.getJob(job.id)!, summary: err.message });
        return;
      }
      this.store.updateJob(job.id, { next_poll_at: this.nextPollAt(job), error: errorMessage(err) });
      return;
    }
    const result = { ...(job.result ?? {}), progress: out.progress };
    if (out.status === "done") {
      this.store.updateJob(job.id, { status: "finalizing", result, params: out.params ?? job.params });
      try {
        const fin = await h.finalize(this.store.getJob(job.id)!, out);
        this.store.updateJob(job.id, { status: "done", result: { ...result, ...(fin.result as object ?? {}), summary: fin.summary }, error: null });
        this.emit({ type: "done", job: this.store.getJob(job.id)!, summary: fin.summary });
      } catch (err) {
        // leave in 'running' so finalize is retried on the next tick
        this.store.updateJob(job.id, { status: "running", next_poll_at: this.nextPollAt(job), error: `finalize: ${errorMessage(err)}` });
      }
      return;
    }
    if (out.status === "failed" || out.status === "canceled") {
      this.store.updateJob(job.id, { status: out.status, error: out.error ?? out.status, result });
      await h.onFailed?.(this.store.getJob(job.id)!, out).catch(() => undefined);
      this.emit({ type: "failed", job: this.store.getJob(job.id)!, summary: out.error });
      return;
    }
    this.store.updateJob(job.id, { status: out.status, result, next_poll_at: this.nextPollAt(job), params: out.params ?? job.params, error: null });
    this.emit({ type: "progress", job: this.store.getJob(job.id)! });
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error(`No job ${jobId}`);
    await this.handlers.get(job.kind)?.cancel?.(job);
    this.store.updateJob(jobId, { status: "canceled" });
  }

  resume(jobId: string): void {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error(`No job ${jobId}`);
    this.store.updateJob(jobId, { status: job.remote_id ? "running" : "pending", next_poll_at: this.now(), error: null });
  }
}

export function progressBar(done: number | null | undefined, total: number | null | undefined, width = 12): string {
  if (!total) return "░".repeat(width);
  const f = Math.max(0, Math.min(width, Math.round(((done ?? 0) / total) * width)));
  return "▓".repeat(f) + "░".repeat(width - f);
}
