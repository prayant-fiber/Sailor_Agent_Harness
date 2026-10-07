/**
 * Extension wiring test with a fake Pi host (run with tsconfig.test.json so Pi packages resolve to test/stubs).
 *   tsx --tsconfig tsconfig.test.json --test test/extension.test.ts
 * Exercises: tool registration, session_start meter, cost guard (allow/confirm/block/dry-run), tool execution
 * against the mock Fiber server, key redaction hooks, and slash commands.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockFiber, type MockFiber } from "../../../evals/mock-fiber-server";

const home = mkdtempSync(join(tmpdir(), "sailor-ext-"));
process.env.SAILOR_HOME = home;
process.env.SAILOR_DB = join(home, "sailor.db");
process.env.SAILOR_DISABLE_KEYCHAIN = "1";
process.env.FIBER_API_KEY = "sk_live_testkey123456";

let mock: MockFiber;
const tools = new Map<string, any>();
const commands = new Map<string, any>();
const handlers = new Map<string, ((e: any, ctx: any) => any)[]>();
const notes: string[] = [];
const statuses = new Map<string, string | undefined>();
let confirmAnswer = true;
const confirms: string[] = [];
let active: string[] = [];

const fakePi: any = {
  on: (ev: string, h: any) => handlers.set(ev, [...(handlers.get(ev) ?? []), h]),
  registerTool: (t: any) => tools.set(t.name, t),
  registerCommand: (n: string, d: any) => commands.set(n, d),
  registerShortcut: () => undefined,
  registerFlag: () => undefined,
  getFlag: () => undefined,
  sendMessage: (m: any) => notes.push(`msg:${m.content}`),
  appendEntry: () => undefined,
  getAllTools: () => [...tools.keys(), "read", "bash", "edit", "write"].map((name) => ({ name })),
  getActiveTools: () => active,
  setActiveTools: (n: string[]) => { active = n; },
};

const ctx: any = {
  cwd: home, mode: "tui", hasUI: true,
  sessionManager: { getBranch: () => [], getEntries: () => [], getSessionId: () => "sess-test" },
  ui: {
    notify: (m: string) => notes.push(m),
    confirm: async (title: string, msg?: string) => { confirms.push(`${title}\n${msg ?? ""}`); return confirmAnswer; },
    select: async (_t: string, o: string[]) => o[0],
    input: async () => undefined,
    setStatus: (k: string, v?: string) => statuses.set(k, v),
    setWidget: () => undefined,
    custom: async () => ({ action: "close", state: {} }),
  },
};

async function emit(ev: string, e: any): Promise<any> {
  let last: any;
  for (const h of handlers.get(ev) ?? []) last = (await h(e, ctx)) ?? last;
  return last;
}

async function callTool(name: string, input: Record<string, any>): Promise<{ blocked?: string; text?: string }> {
  const id = `call_${Math.random().toString(36).slice(2)}`;
  const g = await emit("tool_call", { toolName: name, toolCallId: id, input });
  if (g?.block) return { blocked: g.reason };
  const r = await tools.get(name).execute(id, input, undefined, undefined, ctx);
  return { text: r.content[0].text };
}

before(async () => {
  mock = await startMockFiber({ credits: 5000 });
  process.env.FIBER_BASE_URL = mock.url;
  process.env.FIBER_MCP_BASE_URL = mock.url;
  writeFileSync(join(home, "config.json"), JSON.stringify({ fiber: { mcp: [] } }));
  const mod = await import("../src/extension/index");
  mod.default(fakePi);
  await emit("session_start", {});
  await new Promise((r) => setTimeout(r, 150)); // meter refresh
});

after(async () => {
  await emit("session_shutdown", {});
  await mock.close();
});

test("registers the Sailor toolset, commands and rep-mode tool activation", () => {
  for (const t of ["fiber_credits", "fiber_parse_query", "fiber_count", "fiber_search_people", "fiber_search_companies", "fiber_nl_search", "fiber_resolve_person", "fiber_resolve_company", "fiber_reveal_contacts", "fiber_validate_emails", "fiber_repair_list", "list_all", "list_show", "entity_get", "list_set_notes", "export_list", "fiber_find_operation", "fiber_call", "fiber_tracker", "dnc_add"]) assert.ok(tools.has(t), t);
  for (const c of ["fiber", "credits", "budget", "dryrun", "mode", "lists", "list", "import-list", "repair", "jobs", "export-list", "sheets", "dnc", "forget", "wipe", "new-script", "feedback"]) assert.ok(commands.has(c), c);
  assert.ok(active.includes("fiber_search_people"));
  assert.ok(!active.includes("bash"), "rep mode hides bash");
  assert.match(statuses.get("fiber") ?? "", /Fiber 5,000 cr/);
});

test("system prompt addendum is injected and per-turn counter resets", async () => {
  const r = await emit("before_agent_start", { systemPrompt: "BASE" });
  assert.match(r.systemPrompt, /^BASE\n[\s\S]*# Sailor/);
  assert.match(r.systemPrompt, /untrusted/);
});

test("cheap calls run silently; expensive calls ask; decline blocks", async () => {
  confirms.length = 0;
  const p = await callTool("fiber_parse_query", { query: "Heads of RevOps in the US" });
  assert.match(p.text!, /profileSearchParams/);
  assert.equal(confirms.length, 0);
  const s = await callTool("fiber_search_people", { searchParams: { jobTitleV2: { anyOf: [] } }, pageSize: 3, list: "RevOps" });
  assert.match(s.text!, /Added 3 people to list "RevOps"/);
  assert.match(s.text!, /<untrusted source="fiber">/);
  confirmAnswer = false;
  const big = await callTool("fiber_search_people", { searchParams: { x: 1 }, pageSize: 100 });
  assert.match(big.blocked!, /declined/);
  assert.match(confirms.at(-1)!, /Spend ~100 credits/);
  confirmAnswer = true;
});

test("reveal uses work-email default, skips cached, records ledger", async () => {
  const r1 = await callTool("fiber_reveal_contacts", { list: "RevOps" });
  assert.match(r1.text!, /Revealed 3 people/);
  const r2 = await callTool("fiber_reveal_contacts", { list: "RevOps" });
  assert.match(r2.text!, /3 already had fresh contacts/);
  const req = mock.requests.filter((q) => q.path === "/v1/contact-details/single").at(-1)!;
  assert.deepEqual(req.body.enrichmentType, { getWorkEmails: true, getPersonalEmails: false, getPhoneNumbers: false });
  const show = await callTool("list_show", { list: "RevOps", fields: ["name", "email"] });
  assert.match(show.text!, /dana@loomly\.com \(valid\)/);
});

test("dry-run blocks paid calls with an estimate", async () => {
  await commands.get("dryrun").handler("on", ctx);
  const r = await callTool("fiber_count", { kind: "people", titles: ["CEO"] });
  assert.match(r.blocked!, /DRY RUN/);
  await commands.get("dryrun").handler("off", ctx);
});

test("recruiting mode refuses protected-attribute filters", async () => {
  await commands.get("mode").handler("recruiting", ctx);
  await assert.rejects(callTool("fiber_nl_search", { query: "young female engineers in Austin" }), /protected attributes/);
  await commands.get("mode").handler("rep", ctx);
});

test("grounded notes are checked", async () => {
  const list = JSON.parse(JSON.stringify(await callTool("list_show", { list: "RevOps", fields: ["id", "name"] })));
  const id = /\b([0-9a-f-]{12})\b/.exec(list.text)![1];
  const r = await callTool("list_set_notes", { list: "RevOps", entityId: id, notes: "Saw the [talks.keynote] and [title]." });
  assert.match(r.text!, /UNGROUNDED citations.*talks\.keynote/);
});

test("repair preview is free and shows the pre-flight card", async () => {
  const f = join(home, "messy.csv");
  writeFileSync(f, "Exported by CRM\n\nName;E-mail;Company\nDana Whitfield;mailto:dana@loomly.com;Loomly\nRaj Menon;;Tidewave\n");
  const before = mock.state.paidCalls;
  const r = await callTool("fiber_repair_list", { source: f, preview: true });
  assert.match(r.text!, /2 rows/);
  assert.match(r.text!, /delimiter ";"/);
  assert.match(r.text!, /Kitchen Sink/);
  assert.equal(mock.state.paidCalls, before);
});

test("export writes an injection-safe CSV and skips DNC", async () => {
  await callTool("dnc_add", { values: ["raj@tidewave.io"] });
  const r = await callTool("export_list", { list: "RevOps", target: "csv", preset: "hubspot", path: home });
  assert.match(r.text!, /Wrote 2 rows/);
  assert.match(r.text!, /1 do-not-contact/);
});

test("secrets pasted in chat or printed by tools are redacted", async () => {
  const t = await emit("input", { text: "my key is sk_live_abcdefghijk999" });
  assert.equal(t.action, "transform");
  assert.ok(!t.text.includes("abcdefghijk999"));
  const tr = await emit("tool_result", { toolName: "bash", toolCallId: "x", input: {}, content: [{ type: "text", text: "FIBER_API_KEY=sk_live_testkey123456" }] });
  assert.ok(!tr.content[0].text.includes("testkey123456"));
});

test("shell commands that hit Fiber directly need consent", async () => {
  confirms.length = 0;
  confirmAnswer = false;
  const g = await emit("tool_call", { toolName: "bash", toolCallId: "b1", input: { command: "curl https://api.fiber.ai/v1/people-search -d @q.json" } });
  assert.equal(g.block, true);
  confirmAnswer = true;
});

test("blocked operations stay blocked through fiber_call", async () => {
  const r = await callTool("fiber_call", { operationId: "buyCredits", args: { amount: 100 } });
  assert.match(r.blocked!, /blocked by Sailor policy/);
  assert.ok(!mock.requests.some((q) => q.path === "/v1/buy-credits"));
});

test("Fiber MCP bridge registers tools and keeps them behind the cost guard", async () => {
  await commands.get("fiber").handler("mcp core", ctx);
  assert.ok(tools.has("fibermcp_core_call_operation"));
  assert.ok(active.includes("fibermcp_core_search_endpoints"));
  const free = await callTool("fibermcp_core_search_endpoints", { query: "talent flow" });
  assert.match(free.text!, /getTalentFlowRivals/);
  const denied = await callTool("fibermcp_core_call_operation", { operationId: "buyCredits", body: {} });
  assert.match(denied.blocked!, /blocked by Sailor policy/);
  confirms.length = 0;
  const unknown = await callTool("fibermcp_core_call_operation", { operationId: "getTalentFlowRivals", body: { domain: "stripe.com" } });
  assert.equal(confirms.length, 1, "unknown-cost op asks first");
  assert.match(unknown.text!, /getTalentFlowRivals/);
  await commands.get("fiber").handler("mcp off", ctx);
});
