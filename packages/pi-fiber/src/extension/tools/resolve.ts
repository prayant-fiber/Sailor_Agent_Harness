import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { companyLine, personLine, type CompanySummary, type PersonSummary } from "../../core/fiber/entities";
import { asUntrusted } from "../../core/grounding";
import { identityFromArgs } from "../../core/gtm";
import type { Runtime } from "../runtime";
import { ok, registerSailorTool } from "./common";

const Str = (d: string) => Type.Optional(Type.String({ description: d }));

export function registerResolveTools(pi: ExtensionAPI, rt: Runtime): void {
  registerSailorTool(pi, rt, {
    name: "fiber_resolve_person",
    label: "Resolve person",
    lite: true,
    description: "Resolve ONE person from any partial identifiers — LinkedIn URL, email, or name + company/domain (Fiber Kitchen Sink, 2 credits; +2 with liveFetch). Returns a compact profile and saves it. If several candidates come back, show them to the user to pick; never guess.",
    parameters: Type.Object({
      linkedinUrl: Str("LinkedIn profile URL or slug"),
      email: Str("Email address"),
      name: Str("Full name"),
      company: Str("Company name"),
      domain: Str("Company domain"),
      title: Str("Job title hint"),
      liveFetch: Type.Optional(Type.Boolean({ description: "Fetch fresh data from LinkedIn (+2 credits)", default: false })),
      candidates: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 1, description: "Return up to N candidates for ambiguous names" })),
      list: Str("Add the match to this list"),
    }),
    estimate: (i, r) => { const e = r.gtm.estimate("KitchenSinkProfile", i); return e; },
    async execute(p: any, _ctx, { signal }) {
      const id = identityFromArgs(p);
      if (!id.linkedinUrl && !id.email && !id.name) throw new Error("Give at least a LinkedIn URL, an email, or a name (+ company/domain).");
      if (id.name && !id.company && !id.domain && !id.linkedinUrl && !id.email) throw new Error("A name alone is too ambiguous — add a company or domain.");
      const r = await rt.gtm.resolvePerson(id, { liveFetch: p.liveFetch, numProfiles: p.candidates, list: p.list, signal });
      if (!r.entities.length) return ok(`No match found.${r.message ? ` Fiber: ${r.message}` : ""} Suggest adding company/domain or a LinkedIn URL.`);
      const lines = r.entities.map((e, i) => `${i + 1}. [${e.id}] ${personLine(e.summary as PersonSummary)}${e.linkedin_url ? ` · ${e.linkedin_url}` : ""}`);
      return ok(`${r.entities.length > 1 ? `${r.entities.length} candidates — ask the user which one:` : "Match:"}\n${asUntrusted("fiber", lines.join("\n"))}\nUse entity_get <id> for full details.`, { ids: r.entities.map((e) => e.id) });
    },
  });

  registerSailorTool(pi, rt, {
    name: "fiber_resolve_company",
    label: "Resolve company",
    lite: true,
    description: "Resolve ONE company from a domain, LinkedIn company URL or name (Fiber Kitchen Sink, 2 credits). Returns firmographics: headcount, funding, tech, HQ.",
    parameters: Type.Object({
      domain: Str("Company domain, e.g. stripe.com"),
      companyLinkedinUrl: Str("LinkedIn company URL"),
      company: Str("Company name"),
      candidates: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 1 })),
      list: Str("Add the match to this list"),
    }),
    estimate: (i, r) => r.gtm.estimate("kitchenSinkCompany", i),
    async execute(p: any, _ctx, { signal }) {
      const id = identityFromArgs(p);
      if (!id.domain && !id.companyLinkedin && !id.company) throw new Error("Give a domain, LinkedIn company URL or company name.");
      const r = await rt.gtm.resolveCompany(id, { numCompanies: p.candidates, list: p.list, signal });
      if (!r.entities.length) return ok("No company match found.");
      const lines = r.entities.map((e, i) => `${i + 1}. [${e.id}] ${companyLine(e.summary as CompanySummary)}`);
      return ok(asUntrusted("fiber", lines.join("\n")) + "\nUse entity_get <id> for full details.", { ids: r.entities.map((e) => e.id) });
    },
  });
}
