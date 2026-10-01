import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { buildCompanySearchParams, buildPeopleSearchParams, type CompanyFilters, type PeopleFilters } from "../../core/gtm";
import { protectedAttributeCheck } from "../../core/grounding";
import type { Runtime } from "../runtime";
import { companiesPreview, ok, peoplePreview, registerSailorTool } from "./common";

const Str = (d: string) => Type.Optional(Type.String({ description: d }));
const StrArr = (d: string) => Type.Optional(Type.Array(Type.String(), { description: d }));

const PeopleFilterSchema = {
  titles: StrArr("Job titles (free text terms), e.g. ['Head of RevOps','VP Sales']"),
  titleGroups: StrArr("Title groups: founder, c-suite, board-member, vp, director, management, entry-level"),
  countries: StrArr("ISO-3166 alpha-3 country codes, e.g. ['USA','GBR']"),
  keywords: StrArr("Profile keywords"),
  startedRoleWithinMonths: Type.Optional(Type.Integer({ description: "Only people who started their current role within N months" })),
};

const CompanyFilterSchema = {
  industries: StrArr("Industry names (Fiber industriesV2 values, e.g. 'Software')"),
  countries: StrArr("HQ ISO-3166 alpha-3 codes, e.g. ['USA']"),
  employeeMin: Type.Optional(Type.Integer({ description: "Min employees (inclusive)" })),
  employeeMax: Type.Optional(Type.Integer({ description: "Max employees (inclusive)" })),
  stages: StrArr("Funding stages, e.g. seed, series_a, series_b"),
  domains: StrArr("Exact company domains"),
  keywords: StrArr("Company keywords"),
  fundedWithinMonths: Type.Optional(Type.Integer({ description: "Last funding within N months" })),
};

function checkFairness(rt: Runtime, text: string): string {
  if (rt.config.mode !== "recruiting") return "";
  const hits = protectedAttributeCheck(text);
  if (hits.length) throw new Error(`This search filters on protected attributes (${hits.join(", ")}). Sailor does not search or rank candidates by protected characteristics. Rephrase using skills, experience, title, location or company.`);
  return "";
}

export function registerSearchTools(pi: ExtensionAPI, rt: Runtime): void {
  registerSailorTool(pi, rt, {
    name: "fiber_parse_query",
    label: "Parse ICP",
    description: "Turn a plain-English ICP/sourcing request into Fiber's structured searchParams (nlpSearchParse, 2 credits). Show the parsed filters to the user, then pass them unchanged as `searchParams` to fiber_count / fiber_search_people / fiber_search_companies. Prefer this over guessing enum values.",
    parameters: Type.Object({ query: Type.String({ description: "Natural-language description of who/what to find" }) }),
    estimate: (i, r) => r.gtm.estimate("nlpSearchParse", i),
    async execute(p: { query: string }, _ctx, { signal }) {
      checkFairness(rt, p.query);
      const o = await rt.gtm.nlParse(p.query, signal);
      const pp = o.parsedParams ?? {};
      return ok([
        `suggestedAction: ${o.suggestedAction ?? pp.queryType ?? "?"}`,
        pp.profileSearchParams ? `profileSearchParams (use with fiber_search_people):\n${JSON.stringify(pp.profileSearchParams, null, 1)}` : "",
        pp.companySearchParams ? `companySearchParams (use with fiber_search_companies):\n${JSON.stringify(pp.companySearchParams, null, 1)}` : "",
        o.suggestedAction === "none" ? "Fiber could not interpret the query — ask the user to be more specific." : "",
      ].filter(Boolean).join("\n\n"), o);
    },
  });

  registerSailorTool(pi, rt, {
    name: "fiber_count",
    label: "Count matches",
    lite: true,
    description: "Count people or companies matching filters before searching (≈1 credit, much cheaper than a search). Use it to size a TAM and to tell the user what a full search would cost.",
    parameters: Type.Object({
      kind: StringEnum(["people", "companies"] as const),
      searchParams: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Fiber searchParams (e.g. from fiber_parse_query)" })),
      ...PeopleFilterSchema, ...CompanyFilterSchema,
    }),
    estimate: (i, r) => r.gtm.estimate(i.kind === "people" ? "peopleSearchCount" : "companyCount", i),
    async execute(p: any, _ctx, { signal }) {
      const sp = p.searchParams ?? (p.kind === "people" ? buildPeopleSearchParams(p as PeopleFilters) : buildCompanySearchParams(p as CompanyFilters));
      const n = await rt.gtm.count(p.kind, sp, signal);
      return ok(`${n?.toLocaleString() ?? "unknown"} ${p.kind} match. A full page of 25 costs ~25 credits; ${n ?? "?"} results would cost ~${n ?? "?"} credits.`, { count: n, searchParams: sp });
    },
  });

  registerSailorTool(pi, rt, {
    name: "fiber_search_people",
    label: "Search people",
    description: "Search people with Fiber (1 credit per profile returned). Results are saved to a Sailor list; you get a list handle and a short preview — use list_show for more rows. Pass `searchParams` from fiber_parse_query when available; otherwise use the simple filters. Default pageSize 25.",
    parameters: Type.Object({
      searchParams: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Fiber people searchParams (preferred)" })),
      ...PeopleFilterSchema,
      pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 25 })),
      cursor: Str("nextCursor from a previous page"),
      list: Str("Name or id of the list to add results to (created if missing)"),
    }),
    estimate: (i, r) => r.gtm.estimate("peopleSearch", i),
    async execute(p: any, _ctx, { signal }) {
      checkFairness(rt, JSON.stringify(p));
      const sp = p.searchParams ?? buildPeopleSearchParams(p);
      if (!Object.keys(sp).length) throw new Error("No filters given. Use fiber_parse_query first or pass filters.");
      const r = await rt.gtm.searchPeople(sp, { pageSize: p.pageSize, cursor: p.cursor, list: p.list, signal });
      return ok(`Added ${r.added} people to list "${r.listName}" (id: ${r.listId}).${r.nextCursor ? ` More available: cursor=${r.nextCursor}` : ""}\n${peoplePreview(r.preview)}\nOpen it for the user with /list ${r.listId}.`, r);
    },
  });

  registerSailorTool(pi, rt, {
    name: "fiber_search_companies",
    label: "Search companies",
    description: "Search companies with Fiber (1 credit per company returned). Results are saved to a Sailor list (handle + preview). Pass `searchParams` from fiber_parse_query when available.",
    parameters: Type.Object({
      searchParams: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Fiber company searchParams (preferred)" })),
      ...CompanyFilterSchema,
      pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 25 })),
      cursor: Str("nextCursor from a previous page"),
      list: Str("Name or id of the list to add results to (created if missing)"),
    }),
    estimate: (i, r) => r.gtm.estimate("companySearch", i),
    async execute(p: any, _ctx, { signal }) {
      const sp = p.searchParams ?? buildCompanySearchParams(p);
      if (!Object.keys(sp).length) throw new Error("No filters given. Use fiber_parse_query first or pass filters.");
      const r = await rt.gtm.searchCompanies(sp, { pageSize: p.pageSize, cursor: p.cursor, list: p.list, signal });
      return ok(`Added ${r.added} companies to list "${r.listName}" (id: ${r.listId}).${r.nextCursor ? ` More available: cursor=${r.nextCursor}` : ""}\n${companiesPreview(r.preview)}\nOpen it for the user with /list ${r.listId}.`, r);
    },
  });

  registerSailorTool(pi, rt, {
    name: "fiber_nl_search",
    label: "NL search",
    lite: true,
    description: "One-shot natural-language search (Fiber slushieRun): 2 credits + 1 per result. Returns people, or companies for company-shaped queries, saved to a list. Good for quick exploration; for precise/large searches use fiber_parse_query → fiber_count → fiber_search_*.",
    parameters: Type.Object({
      query: Type.String(),
      pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
      pageToken: Str("nextPageToken from a previous call"),
      list: Str("List to add results to"),
    }),
    estimate: (i, r) => r.gtm.estimate("slushieRun", i),
    async execute(p: any, _ctx, { signal }) {
      checkFairness(rt, p.query);
      const r = await rt.gtm.nlSearch(p.query, { pageSize: p.pageSize, pageToken: p.pageToken, list: p.list, signal });
      const preview = r.kind === "people" ? peoplePreview(r.preview as any) : companiesPreview(r.preview as any);
      return ok(`Added ${r.added} ${r.kind} to list "${r.listName}" (id: ${r.listId}).${r.nextPageToken ? ` nextPageToken=${r.nextPageToken}` : ""}\n${preview}`, r);
    },
  });
}
