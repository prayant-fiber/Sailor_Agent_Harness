/**
 * Sailor runtime: one instance per Pi process, (re)initialised on session_start.
 * Owns config, Fiber client, store, pricing, services, jobs, meter and MCP bridge.
 */
import { randomUUID } from "node:crypto";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, type SailorConfig } from "../core/config";
import { FiberClient, type ChargeEvent } from "../core/fiber/client";
import { getOp } from "../core/fiber/ops";
import { Pricing } from "../core/fiber/pricing";
import { Gtm } from "../core/gtm";
import { JobManager } from "../core/jobs/manager";
import { batchContactsHandler, mosaicHandler } from "../core/repair/engine";
import { resolveFiberKey, type ResolvedKey } from "../core/secrets";
import { Store } from "../core/store/db";
import { startOfLocalDay } from "../core/budget";
import { CreditMeter } from "./meter";

export class Runtime {
  config!: SailorConfig;
  keyInfo?: ResolvedKey;
  client!: FiberClient;
  store!: Store;
  pricing = new Pricing();
  gtm!: Gtm;
  jobs!: JobManager;
  meter!: CreditMeter;
  sessionId: string = randomUUID();
  ui?: ExtensionUIContext;
  hasUI = false;
  cwd = process.cwd();
  paidCallsThisTurn = 0;
  adminMode = false;
  /** Cached preflights / plans computed in the cost guard and reused by execute() (keyed by toolCallId). */
  plans = new Map<string, unknown>();
  private initialised = false;
  private waitNotice?: ReturnType<typeof setTimeout>;

  init(ctx: ExtensionContext): void {
    this.cwd = ctx.cwd ?? process.cwd();
    this.ui = ctx.hasUI ? ctx.ui : undefined;
    this.hasUI = !!ctx.hasUI;
    this.sessionId = ctx.sessionManager?.getSessionId?.() ?? this.sessionId;
    if (this.initialised) { this.meter.attach(this.ui); return; }
    this.config = loadConfig(this.cwd);
    this.keyInfo = resolveFiberKey(this.config.fiber.profile);
    this.store = new Store(Store.defaultPath(this.cwd));
    this.client = new FiberClient({
      baseUrl: this.config.fiber.baseUrl,
      getKey: () => this.keyInfo?.key,
      timeoutMs: this.config.fiber.requestTimeoutMs,
      userAgent: "sailor-pi-fiber/0.1",
      onCharge: (e) => this.onCharge(e),
      onWait: (op, ms) => this.onRateLimitWait(op, ms),
    });
    this.gtm = new Gtm(this.client, this.store, this.config, this.pricing);
    this.jobs = new JobManager(this.store, this.config);
    this.jobs.register("mosaic", mosaicHandler({ client: this.client, store: this.store, config: this.config }));
    this.jobs.register("batch_contacts", batchContactsHandler({ client: this.client, store: this.store }));
    this.meter = new CreditMeter(this);
    this.meter.attach(this.ui);
    this.initialised = true;
  }

  reloadConfig(): void {
    this.config = loadConfig(this.cwd);
    (this.gtm as any).config = this.config;
    this.meter.render();
  }

  reloadKey(): void {
    this.keyInfo = resolveFiberKey(this.config.fiber.profile);
  }

  get hasKey(): boolean {
    return !!this.keyInfo?.key;
  }

  sessionSpent(): number {
    return this.store.spentInSession(this.sessionId);
  }

  dailySpent(): number {
    return this.store.spentSince(startOfLocalDay());
  }

  private onCharge(e: ChargeEvent): void {
    const meta = getOp(e.opId);
    const est = meta?.estimate?.(e.args ?? {}, this.pricing);
    this.store.addLedger(this.sessionId, e.opId, est ? est.credits : null, e.credits, e.method ?? null, e.raw);
    this.meter.onCharge(e);
  }

  private onRateLimitWait(op: string, ms: number): void {
    if (ms < 2000) return;
    this.ui?.setStatus("sailor-wait", `waiting ${Math.ceil(ms / 1000)}s for ${op} rate limit…`);
    clearTimeout(this.waitNotice);
    this.waitNotice = setTimeout(() => this.ui?.setStatus("sailor-wait", undefined), ms + 500);
  }

  shutdown(): void {
    this.jobs?.stop();
    this.meter?.stop();
  }
}

export const runtime = new Runtime();
