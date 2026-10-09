/**
 * CRM export over MCP (FIB-20427). Sailor doesn't talk to CRMs itself: it registers the CRM vendor's own MCP server
 * with Pi (pi.registerMcpServer), Pi handles transport + OAuth (/mcp login <name>), and the agent writes records
 * through the CRM's MCP tools using rows Sailor prepares (crm_export_rows). Nothing about the CRM is hard-coded
 * beyond how to connect and which field names each CRM expects.
 */
import { extractSocials } from "./prospecting";
import type { Store } from "./store/db";
import { splitName } from "./io/normalize";

export type CrmId = "hubspot" | "salesforce" | "attio" | "custom";

export interface CrmConfig {
  provider?: CrmId;
  /** custom: streamable-HTTP MCP URL */
  url?: string;
  /** hubspot: client id of the user's HubSpot "MCP connector" (Development → MCP Connectors) */
  hubspotClientId?: string;
  /** salesforce: org username/alias (default: the CLI's default org) */
  salesforceOrg?: string;
}

/** The Pi MCP server config (same shape as an mcp.json `mcpServers` entry). */
export interface McpServerEntry { url?: string; command?: string; args?: string[]; headers?: Record<string, string>; oauth?: Record<string, unknown>; exposure?: string; timeout?: number }

export const HUBSPOT_CALLBACK_PORT = 8765;

export interface CrmInfo {
  id: CrmId;
  label: string;
  /** Pi MCP server name → tools appear as mcp__<server>__<tool>. */
  server: string;
  docs: string;
  /** How the user signs in, shown after connecting. */
  authSteps: (cfg: CrmConfig) => string[];
  entry: (cfg: CrmConfig, secrets: { hubspotClientSecret?: string }) => McpServerEntry | undefined;
  /** Hints for the agent: which MCP tools to use and how to dedupe. */
  agentHints: string;
}

export const CRMS: Record<CrmId, CrmInfo> = {
  hubspot: {
    id: "hubspot", label: "HubSpot", server: "hubspot",
    docs: "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server",
    authSteps: (cfg) => cfg.hubspotClientId ? [
      `Sign in: run /mcp login hubspot (a HubSpot account admin must connect first).`,
    ] : [
      "In HubSpot: Development → MCP Connectors → Create MCP connector.",
      `Add the redirect URL http://127.0.0.1:${HUBSPOT_CALLBACK_PORT}/callback, create it, and copy the client ID and secret.`,
      "Then run /crm connect hubspot again and paste them (the secret is stored in your OS keychain).",
    ],
    entry: (cfg, s) => cfg.hubspotClientId ? {
      url: "https://mcp.hubspot.com",
      oauth: { clientId: cfg.hubspotClientId, ...(s.hubspotClientSecret ? { clientSecret: s.hubspotClientSecret } : {}), callbackPort: HUBSPOT_CALLBACK_PORT },
      exposure: "direct",
    } : undefined,
    agentHints: "HubSpot: search for an existing contact by email (or company by domain) before creating one; then create or update. Standard contact properties: email, firstname, lastname, jobtitle, company, website, phone, hs_linkedin_url (fall back to a note if a property is rejected). Associate each contact with its company.",
  },
  salesforce: {
    id: "salesforce", label: "Salesforce", server: "salesforce",
    docs: "https://github.com/salesforcecli/mcp",
    authSteps: (cfg) => [
      "Needs the Salesforce CLI: npm install -g @salesforce/cli",
      `Authorize your org once: sf org login web --set-default${cfg.salesforceOrg ? ` --alias ${cfg.salesforceOrg}` : ""}`,
      "Then /reload (or restart Sailor) so the server picks up the org.",
    ],
    entry: (cfg) => ({
      command: "npx",
      args: ["-y", "@salesforce/mcp", "--orgs", cfg.salesforceOrg || "DEFAULT_TARGET_ORG", "--toolsets", "data,orgs,users"],
      exposure: "direct",
      timeout: 120,
    }),
    agentHints: "Salesforce: use the data toolset (SOQL query + DML). Check for an existing Lead/Contact by Email first (SELECT Id FROM Lead WHERE Email = …); create Leads with FirstName, LastName, Email, Title, Company (required), Website, Phone, LinkedIn in Description unless the org has a LinkedIn field. Batch writes; never delete.",
  },
  attio: {
    id: "attio", label: "Attio", server: "attio",
    docs: "https://docs.attio.com/mcp/overview",
    authSteps: () => ["Sign in: run /mcp login attio and approve access in the browser (no API key needed)."],
    entry: () => ({ url: "https://mcp.attio.com/mcp", exposure: "direct" }),
    agentHints: "Attio: use upsert-record so re-exports don't duplicate (people matched on email_addresses, companies on domains). Put Sailor notes/fit reason in create-note on the record. Optionally add records to a list with add-record-to-list.",
  },
  custom: {
    id: "custom", label: "Other CRM (MCP URL)", server: "crm",
    docs: "https://modelcontextprotocol.io",
    authSteps: () => ["If the server uses OAuth, run /mcp login crm. Servers that need an API key: add it under mcpServers.crm in ~/.pi/agent/mcp.json instead."],
    entry: (cfg) => cfg.url ? { url: cfg.url, exposure: "direct" } : undefined,
    agentHints: "Custom CRM: list the server's tools first, prefer upsert/search-then-create so re-exports don't duplicate, and never delete records.",
  },
};

export const CRM_IDS = Object.keys(CRMS) as CrmId[];
export const isCrmId = (s: unknown): s is CrmId => typeof s === "string" && s in CRMS;

/** MCP server names Sailor registers for CRMs (tools hidden in Plan mode). */
export const CRM_SERVERS = new Set(Object.values(CRMS).map((c) => c.server));
export const isCrmTool = (toolName: string): boolean => [...CRM_SERVERS].some((s) => toolName.startsWith(`mcp__${s}__`));

export interface CrmRow { sailorId: string; [k: string]: unknown }

/** CRM-ready records for a list (DNC/excluded rows left out), paged so the agent can push in batches. */
export function crmRows(store: Store, listRef: string, opts: { offset?: number; limit?: number; minScore?: number } = {}): { kind: "people" | "companies"; total: number; rows: CrmRow[]; skippedDnc: number; nextOffset?: number } {
  const list = store.getList(listRef);
  if (!list) throw new Error(`No list "${listRef}".`);
  const all = store.items(list.id).filter((it) => opts.minScore === undefined || (it.score ?? -1) >= opts.minScore);
  let skippedDnc = 0;
  const eligible = all.filter((it) => {
    if (it.status === "excluded" || (it.entity && store.entityIsDnc(it.entity))) { skippedDnc++; return false; }
    return !!it.entity && !it.entity.dedupe_key.startsWith("raw:");
  });
  const offset = opts.offset ?? 0, limit = Math.max(1, Math.min(100, opts.limit ?? 25));
  const page = eligible.slice(offset, offset + limit);
  const rows = page.map((it): CrmRow => {
    const e = it.entity!;
    const s: any = e.summary ?? {};
    const best = (t: string) => it.contacts?.filter((c) => c.type === t).sort((a, b) => rank(a.validity) - rank(b.validity))[0]?.value;
    const so = extractSocials(e);
    const fit = it.score != null ? { fitScore: it.score, fitTier: it.tier, fitReason: it.score_reason } : {};
    if (list.kind === "people") {
      const nm = splitName(s.name ?? e.name ?? "");
      return clean({
        sailorId: e.id, firstName: nm.first, lastName: nm.last, email: best("work_email") ?? best("personal_email"), phone: best("phone"),
        title: s.title, company: s.company, companyDomain: s.companyDomain ?? e.domain, linkedinUrl: e.linkedin_url, xUrl: so.x, githubUrl: so.github,
        location: s.location, notes: it.notes, ...fit,
      });
    }
    return clean({
      sailorId: e.id, name: s.name ?? e.name, domain: s.domain ?? e.domain, linkedinUrl: e.linkedin_url, industry: s.industry, headcount: s.headcount,
      hq: s.hq, country: s.country, latestFundingStage: s.latestFunding?.stage, latestFundingDate: s.latestFunding?.date, notes: it.notes, ...fit,
    });
  });
  const next = offset + page.length;
  return { kind: list.kind, total: eligible.length, rows, skippedDnc, nextOffset: next < eligible.length ? next : undefined };
}

const rank = (v: string | null) => (v === "valid" || v === "ok" ? 0 : v === "risky" || v === "catch_all" ? 1 : v == null || v === "unknown" ? 2 : 3);
function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === "") delete o[k];
  return o;
}
