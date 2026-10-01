/**
 * Minimal MCP client over Streamable HTTP (JSON-RPC 2.0; JSON or SSE responses). Zero dependencies.
 * Pi has no built-in MCP ("No MCP… build an extension that adds MCP support"), so Sailor ships this bridge
 * to Fiber's MCP servers (https://mcp.fiber.ai/mcp = Core meta-tools, /mcp/v2 = curated tools).
 */
export interface McpTool { name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: Record<string, unknown> }
export interface McpCallResult { content: { type: string; text?: string; [k: string]: unknown }[]; isError?: boolean; structuredContent?: unknown }

const PROTOCOL = "2025-06-18";

export class McpHttpClient {
  private sessionId?: string;
  private nextId = 1;
  private initialized?: Promise<void>;
  serverInfo?: { name?: string; version?: string };

  constructor(private readonly url: string, private readonly headers: () => Record<string, string>, private readonly timeoutMs = 120_000) {}

  private async post(message: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const res = await fetch(this.url, {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        ...(this.initialized ? { "mcp-protocol-version": PROTOCOL } : {}),
        ...this.headers(),
      },
      body: JSON.stringify(message),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (res.status === 202 || res.status === 204) return undefined;
    if (res.status === 404 && this.sessionId) {
      // session expired → re-initialize once
      this.sessionId = undefined;
      this.initialized = undefined;
      throw new McpSessionExpired();
    }
    if (!res.ok) throw new Error(`MCP ${this.url} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream")) return parseSse(await res.text(), message.id as number);
    const body = await res.json();
    return Array.isArray(body) ? body.find((m) => m.id === message.id) : body;
  }

  private async rpc(method: string, params: Record<string, unknown> | undefined, signal?: AbortSignal): Promise<any> {
    await this.ensureInit(signal);
    const id = this.nextId++;
    let msg: any;
    try {
      msg = await this.post({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }, signal);
    } catch (err) {
      if (err instanceof McpSessionExpired) { await this.ensureInit(signal); msg = await this.post({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }, signal); }
      else throw err;
    }
    if (!msg) throw new Error(`MCP ${method}: empty response`);
    if (msg.error) throw new Error(`MCP ${method} error ${msg.error.code}: ${msg.error.message}`);
    return msg.result;
  }

  ensureInit(signal?: AbortSignal): Promise<void> {
    if (!this.initialized) {
      this.initialized = (async () => {
        const id = this.nextId++;
        const r = await this.post({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "sailor", version: "0.1.0" } } }, signal);
        if (r?.error) throw new Error(`MCP initialize failed: ${r.error.message}`);
        this.serverInfo = r?.result?.serverInfo;
        await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, signal);
      })().catch((e) => { this.initialized = undefined; throw e; });
    }
    return this.initialized;
  }

  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const r = await this.rpc("tools/list", cursor ? { cursor } : undefined, signal);
      tools.push(...(r?.tools ?? []));
      cursor = r?.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    return this.rpc("tools/call", { name, arguments: args }, signal);
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    await fetch(this.url, { method: "DELETE", headers: { "mcp-session-id": this.sessionId, ...this.headers() } }).catch(() => undefined);
    this.sessionId = undefined;
    this.initialized = undefined;
  }
}

class McpSessionExpired extends Error {}

export function parseSse(text: string, id?: number): any {
  let found: any;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    if (!data) continue;
    try {
      const msg = JSON.parse(data);
      if (id === undefined || msg.id === id) found = msg;
    } catch { /* ignore keep-alives */ }
  }
  return found;
}

export function mcpText(r: McpCallResult): string {
  return (r.content ?? []).map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
}
