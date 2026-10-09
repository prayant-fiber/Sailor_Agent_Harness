/**
 * Prospecting shortcuts (FIB-20428):
 *   /qualify [list] [criteria…] [--min 70]     AI scores every row against your criteria, then narrows to a qualified list
 *   /lookalikes [list] [--count 25]            finds more people/companies like the ones in a list (Fiber search)
 *   /emails [list] [--personal] [--limit N]    reveal work emails (+ personal) for a list
 *   /phones [list] [--limit N]                 reveal phone numbers
 *   /socials [list] [--refresh]                social profiles from Fiber data (free; --refresh re-pulls profiles first)
 *   /contact-info [list] [--limit N]           work + personal email + phone
 *
 * Contact commands run deterministically through the same reveal path and cost guard as the list pane.
 * /qualify and /lookalikes hand a precise brief to the agent: Fiber has no scoring/lookalike API yet, so the model
 * does the judgment with free local tools (list_profile, list_show, entity_get, list_score) and normal Fiber search.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContactTypes } from "../../core/gtm";
import { errorMessage } from "../../core/errors";
import { extractSocials, socialsLine } from "../../core/prospecting";
import type { ListRow } from "../../core/store/db";
import { approveSpend } from "../costGuard";
import { pickEntities, resolvePlan, revealContacts, revealPlan, revealSummary } from "../actions";
import type { Runtime } from "../runtime";
import { showText } from "../ui/textView";
import { flagBool, flagNum, flagStr, parseArgs, type Parsed } from "./args";

function say(ctx: ExtensionContext, msg: string, level: "info" | "warning" | "error" = "info") {
  if (ctx.hasUI) ctx.ui.notify(msg, level); else console.log(msg);
}

/** First positional arg if it names a list; otherwise ask (UI) or fall back to the most recently used list. */
export async function resolveListArg(rt: Runtime, ctx: ExtensionContext, a: Parsed, opts: { kind?: "people" | "companies"; purpose: string }): Promise<{ list?: ListRow; rest: string[] }> {
  const lists = rt.store.lists().filter((l) => !opts.kind || l.kind === opts.kind);
  const first = a._[0];
  const named = first ? rt.store.getList(first) ?? rt.store.getList(a._.join(" ")) : undefined;
  if (named) {
    if (opts.kind && named.kind !== opts.kind) { say(ctx, `"${named.name}" is a ${named.kind} list; ${opts.purpose} needs a ${opts.kind} list.`, "warning"); return { rest: [] }; }
    const rest = rt.store.getList(first!) ? a._.slice(1) : [];
    return { list: named, rest };
  }
  if (!lists.length) { say(ctx, `No ${opts.kind ?? ""} lists yet. Find prospects first (e.g. /icp …) or /import-list csv <file>.`.replace("  ", " "), "warning"); return { rest: a._ }; }
  if (ctx.hasUI && lists.length > 1) {
    const labels = lists.map((l) => `${l.name} · ${l.size} ${l.kind} · ${l.id}`);
    const pick = await ctx.ui.select(`Which list for ${opts.purpose}?`, labels);
    return { list: pick ? lists[labels.indexOf(pick)] : undefined, rest: a._ };
  }
  return { list: lists[0], rest: a._ };
}

async function runReveal(rt: Runtime, ctx: ExtensionContext, label: string, args: string | undefined, types: ContactTypes): Promise<void> {
  rt.init(ctx);
  const a = parseArgs(args, ["personal"]);
  const { list } = await resolveListArg(rt, ctx, a, { kind: "people", purpose: label });
  if (!list) return;
  const entities = pickEntities(rt, list.id, undefined, { limit: flagNum(a, "limit"), status: flagStr(a, "status") });
  const plan = revealPlan(rt, entities, types);
  if (!plan.todo.length) {
    say(ctx, revealSummary({ revealed: 0, contactsFound: 0, cached: plan.cached.length, dnc: plan.dnc.length, missingId: plan.missingId.length, errors: [] }) || "Nothing to reveal.");
    await showContacts(rt, ctx, list, types);
    return;
  }
  const ok = await approveSpend(rt, ctx, `${label} for ${plan.todo.length} ${plan.todo.length === 1 ? "person" : "people"} in "${list.name}"`, plan.estimate);
  if (!ok.ok) { say(ctx, ok.reason, "warning"); return; }
  try {
    const out = await revealContacts(rt, plan, { listId: list.id, signal: ctx.signal, onProgress: (m) => ctx.ui?.setStatus("sailor-progress", m) });
    ctx.ui?.setStatus("sailor-progress", undefined);
    say(ctx, revealSummary(out));
    if (!out.jobId) await showContacts(rt, ctx, list, types);
  } catch (err) {
    ctx.ui?.setStatus("sailor-progress", undefined);
    say(ctx, errorMessage(err), "error");
  }
  rt.meter.render();
}

async function showContacts(rt: Runtime, ctx: ExtensionContext, list: ListRow, types: ContactTypes): Promise<void> {
  const items = rt.store.items(list.id, { limit: 200 });
  const rows = items.map((it) => {
    const s: any = it.entity?.summary ?? {};
    const get = (t: string) => it.contacts?.filter((c) => c.type === t).map((c) => `${c.value}${c.validity ? ` (${c.validity})` : ""}`).join(", ") ?? "";
    return [s.name ?? it.entity?.name ?? it.entity_id, types.workEmail ? get("work_email") : "", types.personalEmail ? get("personal_email") : "", types.phone ? get("phone") : ""].filter((x, i) => i === 0 || [types.workEmail, types.personalEmail, types.phone][i - 1]).join("  ·  ");
  });
  const found = items.filter((it) => it.contacts?.some((c) => (types.workEmail && c.type === "work_email") || (types.personalEmail && c.type === "personal_email") || (types.phone && c.type === "phone"))).length;
  await showText(ctx, `${list.name} · contact info (${found}/${items.length} with results)`, [...rows, "", `Export: /export-list ${list.id} csv · or push to your CRM with /crm export ${list.id}`]);
}

export const qualifyBrief = (listId: string, listName: string, size: number, criteria: string, min: number) => [
  `/qualify — score every row of list "${listName}" (${listId}, ${size} rows) and narrow it down.`,
  `Qualified means: ${criteria}`,
  "",
  "Steps (all free — don't spend Fiber credits unless I say so):",
  `1. list_profile ${listId} to see the shape of the list.`,
  `2. Read rows with list_show (only the fields you need; page through with offset, 50 at a time). Use entity_get only for borderline rows.`,
  "3. Score each row 0-100 for fit with a one-line reason that cites stored fields (e.g. [title], [headcount], [latestFunding.stage]). Missing data lowers confidence, it isn't a disqualifier by itself; say so in the reason.",
  `4. Save scores with list_score in batches of up to 50. On the last batch set narrowMinScore=${min} so the qualified rows land in a new list.`,
  "5. Reply with: tier counts (A/B/C/D), the top 10 with reasons, the new list id, and 2-3 patterns that separated good from bad fits.",
  size > 400 ? `This list is large (${size}). Score the first 400 rows, then ask me before continuing.` : "",
].filter((l) => l !== "").join("\n");

export const lookalikesBrief = (listId: string, listName: string, kind: string, count: number) => [
  `/lookalikes — find ${count} more ${kind} like the ones in "${listName}" (${listId}).`,
  "Fiber doesn't have a lookalike endpoint, so infer the pattern and search for it:",
  `1. list_profile ${listId} (free). Pick the 3-5 traits most shared across the list (${kind === "people" ? "titles/seniority, company size, industry, geography, skills" : "industry, headcount band, geography, funding stage, tech"}). Ignore one-offs.`,
  `2. Turn them into Fiber filters (fiber_parse_query when available, otherwise the friendly filters) and run fiber_count first. If the count is tiny or huge, adjust one filter and recount once.`,
  `3. Search with pageSize ${count} into a new list named "Lookalikes of ${listName}".`,
  `4. list_dedupe that new list against ${listId} so nobody from the seed list repeats.`,
  "5. Reply with the traits you used, the count, the cost, and the top 10 new rows. Don't reveal contacts yet; offer /emails or /contact-info.",
].join("\n");

export function registerProspectingCommands(pi: ExtensionAPI, rt: Runtime): void {
  pi.registerCommand("qualify", {
    description: "AI-score every row of a list against your criteria and narrow to the best fits: /qualify [list] [criteria…] [--min 70]",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args);
      const { list, rest } = await resolveListArg(rt, ctx, a, { purpose: "/qualify" });
      if (!list) return;
      let criteria = rest.join(" ").trim();
      if (!criteria && ctx.hasUI) criteria = (await ctx.ui.input(`What makes a row in "${list.name}" qualified?`, "e.g. VP+ in RevOps at B2B SaaS, 200-2000 employees, raised in the last 18 months"))?.trim() ?? "";
      if (!criteria) criteria = "best fit for the ICP in sailor.md (or, if there is none, the strongest buyers for a B2B GTM data product); explain the rubric you used first";
      const min = flagNum(a, "min") ?? 70;
      pi.sendUserMessage(qualifyBrief(list.id, list.name, list.size ?? rt.store.countItems(list.id), criteria, min), { deliverAs: "followUp" } as any);
    },
  });

  pi.registerCommand("lookalikes", {
    description: "Find more people/companies like the ones in a list, using Fiber search: /lookalikes [list] [--count 25]",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args);
      const { list } = await resolveListArg(rt, ctx, a, { purpose: "/lookalikes" });
      if (!list) return;
      if (!(list.size ?? rt.store.countItems(list.id))) { say(ctx, `"${list.name}" is empty.`, "warning"); return; }
      const count = Math.max(1, Math.min(200, flagNum(a, "count") ?? 25));
      pi.sendUserMessage(lookalikesBrief(list.id, list.name, list.kind, count), { deliverAs: "followUp" } as any);
    },
  });

  pi.registerCommand("emails", {
    description: "Reveal emails for a list with Fiber: /emails [list] [--personal] [--limit N] (work email 2 cr each, only when found)",
    handler: async (args, ctx) => runReveal(rt, ctx, "/emails", args, { workEmail: true, personalEmail: flagBool(parseArgs(args, ["personal"]), "personal") }),
  });

  pi.registerCommand("phones", {
    description: "Reveal phone numbers for a list with Fiber: /phones [list] [--limit N]",
    handler: async (args, ctx) => runReveal(rt, ctx, "/phones", args, { phone: true }),
  });

  pi.registerCommand("contact-info", {
    description: "Reveal everything for a list (work + personal email + phone): /contact-info [list] [--limit N]",
    handler: async (args, ctx) => runReveal(rt, ctx, "/contact-info", args, { workEmail: true, personalEmail: true, phone: true }),
  });

  pi.registerCommand("socials", {
    description: "Social profiles (LinkedIn, X, GitHub, …) for a list from Fiber data: /socials [list] [--refresh] (free; --refresh re-pulls profiles via Kitchen Sink)",
    handler: async (args, ctx) => {
      rt.init(ctx);
      const a = parseArgs(args, ["refresh"]);
      const { list } = await resolveListArg(rt, ctx, a, { purpose: "/socials" });
      if (!list) return;
      let entities = pickEntities(rt, list.id, undefined, { limit: flagNum(a, "limit") });
      const thin = entities.filter((e) => !Object.keys(extractSocials(e)).some((k) => k !== "linkedin"));
      let refresh = flagBool(a, "refresh");
      if (!refresh && thin.length && ctx.hasUI && rt.hasKey) {
        const pick = await ctx.ui.select(`${thin.length}/${entities.length} rows only have LinkedIn stored`, ["Show what's stored (free)", `Refresh those ${thin.length} profiles from Fiber first (~${thin.length * 2} cr)`]);
        refresh = !!pick?.startsWith("Refresh");
      }
      if (refresh && thin.length) {
        const plan = resolvePlan(rt, thin, list.kind);
        const ok = await approveSpend(rt, ctx, `/socials refresh for ${thin.length} rows`, plan.estimate);
        if (!ok.ok) say(ctx, ok.reason, "warning");
        else {
          try { await rt.gtm.bulkResolve(list.kind, plan.rows, { listId: list.id, signal: ctx.signal }); }
          catch (err) { say(ctx, errorMessage(err), "error"); }
          entities = pickEntities(rt, list.id, undefined, { limit: flagNum(a, "limit") });
        }
      }
      const lines = entities.map((e) => `${(e.summary as any)?.name ?? e.name ?? e.id}  ·  ${socialsLine(extractSocials(e)) || "(none)"}`);
      const more = entities.filter((e) => Object.keys(extractSocials(e)).some((k) => k !== "linkedin")).length;
      await showText(ctx, `${list.name} · socials (${more}/${entities.length} beyond LinkedIn)`, [...lines, "", `Raw export includes x_url, github_url, website: /export-list ${list.id} csv`]);
    },
  });
}
