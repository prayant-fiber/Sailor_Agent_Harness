/**
 * Fiber MCP bridge (F3). Connects lazily to Fiber's MCP servers and registers each MCP tool as a Pi tool
 * named fibermcp_<server>_<tool>. Every call still passes the Sailor cost guard (mapped by operationId).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getOp, unknownOp, type Estimate } from "../../core/fiber/ops";
import { asUntrusted } from "../../core/grounding";
import { McpHttpClient, mcpText, type McpTool } from "../../core/mcp/client";
import type { Runtime } from "../runtime";
import { ESTIMATORS, SAILOR_TOOLS, ok, registerSailorTool } from "./common";

const PATHS: Record<string, string> = { core: "/mcp", v2: "/mcp/v2", lite: "/mcp/lite" };
/** Core/Lite meta-tools that only read the catalog (free). */
const FREE_META = new Set(["search_endpoints", "list_tag_packs", "list_all_endpoints", "get_endpoint_details_full", "get_endpoint_details"]);
/** V2 curated tool → REST operationId (for estimates). */
const V2_OPS: Record<string, string> = {
  api_companySearch: "companySearch", api_peopleSearch: "peopleSearch", api_individualRevealSync: "syncQuickContactReveal",
  api_companyLiveFetch: "companyLiveEnrich", api_personLiveFetch: "profileLiveEnrich", api_getOrgCredits: "getOrgCredits",
};

export const mcpClients = new Map<string, McpHttpClient>();

export function mcpEstimate(rt: Runtime, server: string, tool: string, input: Record<string, any>): Estimate | undefined {
  if (FREE_META.has(tool)) return undefined;
  let opId: string | undefined;
  let args: Record<string, any> = input;
  if (tool === "call_operation") {
    opId = input.operationId ?? input.operation_id ?? input.opId;
    args = input.body ?? input.params ?? input.arguments ?? input.args ?? {};
  } else opId = V2_OPS[tool] ?? tool.replace(/^api_/, "");
  if (!opId) return { credits: 0, basis: `${server}/${tool}: unknown operation`, uncertain: true };
  const meta = getOp(opId) ?? unknownOp(opId);
  if (meta.deny) return { credits: 0, basis: "", blockReason: `${opId} is blocked by Sailor policy (money movement / account signup is never done by the agent).` };
  if (!meta.paid) return undefined;
  return meta.estimate?.(args, rt.pricing) ?? { credits: 0, basis: "unknown cost", uncertain: true };
}

export async function connectFiberMcp(pi: ExtensionAPI, rt: Runtime, servers = rt.config.fiber.mcp): Promise<string[]> {
  const registered: string[] = [];
  for (const server of servers) {
    if (mcpClients.has(server)) continue;
    const url = `${rt.config.fiber.mcpBaseUrl}${PATHS[server] ?? "/mcp"}`;
    const client = new McpHttpClient(url, () => ({ "x-api-key": rt.keyInfo?.key ?? "" }));
    const tools: McpTool[] = await client.listTools();
    mcpClients.set(server, client);
    for (const t of tools) {
      const name = `fibermcp_${server}_${t.name}`.replace(/[^\w]/g, "_").slice(0, 64);
      if (SAILOR_TOOLS.has(name)) continue;
      registerSailorTool(pi, rt, {
        name,
        label: `Fiber MCP ${t.name}`,
        description: `[Fiber MCP ${server}] ${t.description ?? t.name}${server === "core" && t.name === "call_operation" ? " — prefer Sailor's dedicated fiber_* tools when one exists; costs are checked by Sailor's cost guard." : ""}`.slice(0, 1024),
        parameters: Type.Unsafe(t.inputSchema ?? { type: "object", properties: {} }),
        estimate: (input, r) => mcpEstimate(r, server, t.name, input),
        async execute(params: any, _ctx, { signal }) {
          const res = await client.callTool(t.name, params ?? {}, signal);
          const text = mcpText(res);
          if (res.isError) throw new Error(text.slice(0, 2000));
          return ok(asUntrusted(`fiber-mcp:${server}`, text.length > 20_000 ? `${text.slice(0, 20_000)}\n… (truncated)` : text), res.structuredContent);
        },
      });
      registered.push(name);
    }
  }
  return registered;
}

export async function disconnectFiberMcp(): Promise<void> {
  for (const c of mcpClients.values()) await c.close().catch(() => undefined);
  mcpClients.clear();
}

export { ESTIMATORS };
