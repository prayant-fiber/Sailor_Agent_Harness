/**
 * Pure cost-policy decision used by the cost guard (F9, edge cases A1, C6, C9, I1, I6).
 */
import type { SailorConfig } from "./config";
import type { Estimate } from "./fiber/ops";

export interface PolicyInput {
  opId: string;
  estimate: Estimate;
  /** Spendable credits right now (min of org available and key ceiling), undefined if unknown. */
  available?: number;
  sessionSpent: number;
  dailySpent: number;
  paidCallsThisTurn: number;
  hasUI: boolean;
  config: Pick<SailorConfig, "budget" | "dryRun">;
  /** A human action (pane key/command) already confirmed this exact spend. */
  preApproved?: boolean;
}

export type PolicyDecision =
  | { action: "allow"; note?: string }
  | { action: "confirm"; title: string; message: string }
  | { action: "block"; reason: string };

export function fmtCredits(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function decide(p: PolicyInput): PolicyDecision {
  const { budget } = p.config;
  const cost = p.estimate.credits;
  const approx = `~${fmtCredits(cost)} credits`;

  if (p.estimate.blockReason) return { action: "block", reason: p.estimate.blockReason };

  if (p.config.dryRun) return { action: "block", reason: `DRY RUN — ${p.opId} would cost ${approx} (${p.estimate.basis}). Nothing was charged. Turn off with /dryrun off.` };

  if (p.paidCallsThisTurn >= budget.maxPaidCallsPerTurn)
    return { action: "block", reason: `Paid-call limit for this turn reached (${budget.maxPaidCallsPerTurn}). Summarize progress and ask the user before spending more.` };

  if (p.available !== undefined && cost > p.available)
    return { action: "block", reason: `Insufficient credits: ${p.opId} needs ${approx}, only ${fmtCredits(p.available)} available. Suggest a smaller batch or topping up at fiber.ai.` };

  const sessionLeft = budget.session - p.sessionSpent;
  const dailyLeft = budget.daily - p.dailySpent;
  if (cost > sessionLeft)
    return { action: "block", reason: `Over the session budget: ${approx} requested, ${fmtCredits(Math.max(0, sessionLeft))} left of ${fmtCredits(budget.session)}. The user can raise it with /budget session <n>.` };
  if (cost > dailyLeft)
    return { action: "block", reason: `Over the daily budget: ${approx} requested, ${fmtCredits(Math.max(0, dailyLeft))} left of ${fmtCredits(budget.daily)}. The user can raise it with /budget daily <n>.` };

  if (p.preApproved) return { action: "allow", note: `${approx} (pre-approved)` };

  const needsConfirm = cost > budget.autoApproveUnder || (p.estimate.uncertain && cost === 0) || !!p.estimate.forceConfirm;
  if (!needsConfirm) return { action: "allow", note: cost ? approx : undefined };

  if (!p.hasUI) {
    if (budget.headlessMaxSpend > 0 && cost <= budget.headlessMaxSpend && !(p.estimate.uncertain && cost === 0) && !p.estimate.forceConfirm) return { action: "allow", note: `${approx} (headless allowance)` };
    return { action: "block", reason: `${p.opId} needs approval (${approx}) but there is no interactive UI. Re-run with --fiber-max-spend <credits> or SAILOR_MAX_SPEND.` };
  }

  const bal = p.available !== undefined ? `\nBalance ${fmtCredits(p.available)} → ~${fmtCredits(Math.max(0, p.available - cost))}` : "";
  const unsure = p.estimate.uncertain ? "\n(estimate is uncertain — actual charge comes from Fiber's chargeInfo)" : "";
  return {
    action: "confirm",
    title: cost ? `Spend ${approx} on Fiber?` : `Run ${p.opId} (cost unknown)?`,
    message: `${p.opId}: ${p.estimate.basis}${bal}\nSession: ${fmtCredits(p.sessionSpent)}/${fmtCredits(budget.session)} · Today: ${fmtCredits(p.dailySpent)}/${fmtCredits(budget.daily)}${unsure}`,
  };
}

export function startOfLocalDay(t = Date.now()): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
