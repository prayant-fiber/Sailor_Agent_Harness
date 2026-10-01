import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fmtCredits } from "../../core/budget";
import { progressBar } from "../../core/jobs/manager";
import type { Runtime } from "../runtime";
import { ok, registerSailorTool } from "./common";

export function registerAccountTools(pi: ExtensionAPI, rt: Runtime): void {
  registerSailorTool(pi, rt, {
    name: "fiber_credits",
    label: "Fiber credits",
    lite: true,
    description: "Get the Fiber credit balance, this session's spend and remaining budgets (free). Call before large or expensive operations.",
    parameters: Type.Object({}),
    async execute() {
      const org = await rt.meter.refresh();
      if (!org) return ok(`Could not read credits: ${rt.meter.lastError ?? "unknown error"}`);
      const b = rt.config.budget;
      return ok([
        `Available: ${fmtCredits(org.available)} of ${fmtCredits(org.max)} (used ${fmtCredits(org.used)})${org.usagePeriodResetsOn ? `, resets ${org.usagePeriodResetsOn}` : ""}`,
        `This session: ${fmtCredits(rt.sessionSpent())} / budget ${fmtCredits(b.session)} · today: ${fmtCredits(rt.dailySpent())} / ${fmtCredits(b.daily)}`,
        `Paid calls ≤ ${b.autoApproveUnder} credits run without a prompt; larger ones ask the user.${rt.config.dryRun ? " DRY-RUN is ON (nothing will be charged)." : ""}`,
      ].join("\n"), { org });
    },
  });

  registerSailorTool(pi, rt, {
    name: "fiber_jobs",
    label: "Sailor jobs",
    description: "List async jobs (Mosaic list repairs, batch contact reveals) with status and progress (free).",
    parameters: Type.Object({ activeOnly: Type.Optional(Type.Boolean({ description: "Only running jobs", default: false })) }),
    needsKey: false,
    async execute(p: { activeOnly?: boolean }) {
      const jobs = rt.store.jobs({ active: !!p.activeOnly, limit: 20 });
      if (!jobs.length) return ok("No jobs.");
      return ok(jobs.map((j) => {
        const pr = (j.result as any)?.progress ?? {};
        return `${j.id} · ${j.kind} · ${j.status} ${progressBar(pr.done, pr.total)} ${pr.done ?? "?"}/${pr.total ?? "?"}${j.list_id ? ` · list ${j.list_id}` : ""}${j.error ? ` · ${j.error}` : ""}${(j.result as any)?.summary ? `\n   ${(j.result as any).summary}` : ""}`;
      }).join("\n"));
    },
  });
}
