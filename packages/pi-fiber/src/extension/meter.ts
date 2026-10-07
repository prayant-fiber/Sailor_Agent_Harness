/**
 * Always-visible credit meter (F2): footer status via ctx.ui.setStatus("fiber", …).
 * Refresh: on session start, debounced after each charge (≤ 1 per 10 s), and every 60 s. getOrgCredits is free.
 */
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { fmtCredits } from "../core/budget";
import type { ChargeEvent } from "../core/fiber/client";
import { errorMessage, InvalidKeyError, OutOfCreditsError, SandboxUnsupportedError } from "../core/errors";
import type { Runtime } from "./runtime";

export interface OrgCredits { organizationId?: string; subscriptionId?: string; max: number; used: number; available: number; usagePeriodResetsOn?: string; creditsPerOperation?: unknown }

export class CreditMeter {
  org?: OrgCredits;
  orgs: OrgCredits[] = [];
  lastRefresh = 0;
  private spentSinceRefresh = 0;
  private ui?: ExtensionUIContext;
  private timer?: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  state: "unknown" | "ok" | "low" | "empty" | "nokey" | "error" | "sandbox" = "unknown";
  lastError?: string;
  private lowAlerted = false;

  constructor(private readonly rt: Runtime) {}

  attach(ui: ExtensionUIContext | undefined): void {
    this.ui = ui;
    this.render();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refresh(), this.rt.config.meter.refreshIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Spendable credits (optimistic between refreshes). */
  available(): number | undefined {
    if (!this.org) return undefined;
    return Math.max(0, this.org.available - this.spentSinceRefresh);
  }

  async refresh(): Promise<OrgCredits | undefined> {
    if (!this.rt.hasKey) { this.state = "nokey"; this.render(); return undefined; }
    try {
      const r = await this.rt.client.call("getOrgCredits", {});
      const out: OrgCredits[] = Array.isArray(r.output) ? r.output : r.output ? [r.output as any] : [];
      this.orgs = out;
      // Multiple subscriptions: show the one with the most available credits (edge note in 02 §1).
      this.org = [...out].sort((a, b) => (b.available ?? 0) - (a.available ?? 0))[0];
      if (this.org?.creditsPerOperation) this.rt.pricing.ingestCreditsPerOperation(this.org.creditsPerOperation);
      this.spentSinceRefresh = 0;
      this.lastRefresh = Date.now();
      this.lastError = undefined;
      this.state = this.computeState();
    } catch (err) {
      this.lastError = errorMessage(err);
      this.state = err instanceof InvalidKeyError ? "nokey" : err instanceof OutOfCreditsError ? "empty" : err instanceof SandboxUnsupportedError ? "sandbox" : "error";
      if (this.state === "sandbox") this.lastError = undefined;
    }
    this.render();
    return this.org;
  }

  private computeState(): CreditMeter["state"] {
    const a = this.available();
    if (a === undefined || !this.org) return "unknown";
    if (a <= 0) return "empty";
    const cfg = this.rt.config.meter;
    if (a < cfg.lowCreditAbsolute || (this.org.max > 0 && a / this.org.max < cfg.lowCreditFraction)) return "low";
    return "ok";
  }

  onCharge(e: ChargeEvent): void {
    this.spentSinceRefresh += e.credits;
    if (e.lowCreditAlert?.availableCredits !== undefined && this.org) {
      this.org = { ...this.org, available: e.lowCreditAlert.availableCredits };
      this.spentSinceRefresh = 0;
    }
    this.state = this.computeState();
    if (e.lowCreditAlert && !this.lowAlerted) {
      this.lowAlerted = true;
      this.ui?.notify(`Fiber: ${e.lowCreditAlert.message ?? "credits are running low"}${e.lowCreditAlert.getMoreCreditsUrl ? ` — ${e.lowCreditAlert.getMoreCreditsUrl}` : ""}`, "warning");
    }
    this.render();
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.refresh(), Math.max(0, 10_000 - (Date.now() - this.lastRefresh)));
    this.debounce.unref?.();
  }

  text(): string {
    const cfg = this.rt.config;
    if (this.state === "nokey" || !this.rt.hasKey) return "Fiber: not connected · /fiber login";
    const a = this.available();
    const parts: string[] = [];
    const sb = this.rt.isSandbox;
    if (sb && (a === undefined || this.state === "sandbox")) parts.push("Fiber SANDBOX · no credits charged");
    else if (a === undefined) parts.push(this.state === "error" ? "Fiber: offline" : "Fiber: …");
    else parts.push(`Fiber${sb ? " SANDBOX" : ""} ${fmtCredits(a)} cr${this.state === "low" ? " LOW" : this.state === "empty" ? " EMPTY · top up" : ""}`);
    let spent = 0;
    try { spent = this.rt.sessionSpent(); } catch { /* store not ready */ }
    parts.push(`session −${fmtCredits(spent)}/${fmtCredits(cfg.budget.session)}`);
    if (cfg.dryRun) parts.push("DRY-RUN");
    if (cfg.mode !== "rep") parts.push(cfg.mode);
    let active = 0;
    try { active = this.rt.jobs.active().length; } catch { /* ignore */ }
    if (active) parts.push(`⧗ ${active} job${active > 1 ? "s" : ""}`);
    return parts.join(" │ ");
  }

  render(): void {
    this.ui?.setStatus("fiber", this.text());
  }
}
