import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockFiber, type MockFiber } from "../../../evals/mock-fiber-server";
import { DEFAULT_CONFIG, deepMerge } from "../src/core/config";
import { FiberClient, type ChargeEvent } from "../src/core/fiber/client";
import { InvalidKeyError, OutOfCreditsError, UnknownOutcomeError, BlockedByPolicyError } from "../src/core/errors";
import { Pricing } from "../src/core/fiber/pricing";
import { Gtm } from "../src/core/gtm";
import { JobManager } from "../src/core/jobs/manager";
import { McpHttpClient, mcpText } from "../src/core/mcp/client";
import { batchContactsHandler, mosaicHandler, preflight, runKitchenSinkRepair, startMosaicRuns } from "../src/core/repair/engine";
import { Store } from "../src/core/store/db";
import { listExportRows } from "../src/core/export/rows";

const KEY = "sk_live_testkey123456";
let mock: MockFiber;
const dir = mkdtempSync(join(tmpdir(), "sailor-test-"));
process.env.SAILOR_HOME = dir;
process.env.SAILOR_ALLOW_INSECURE_URLS = "1"; // mock server is plain http

function setup(opts: { key?: string } = {}) {
  const charges: ChargeEvent[] = [];
  const client = new FiberClient({ baseUrl: mock.url, getKey: () => opts.key ?? KEY, onCharge: (e) => charges.push(e), maxRetries: 2 });
  const store = new Store(":memory:");
  const config = deepMerge(DEFAULT_CONFIG, { fiber: { baseUrl: mock.url } } as any);
  const gtm = new Gtm(client, store, config, new Pricing());
  return { client, store, config, gtm, charges };
}

before(async () => { mock = await startMockFiber({ rateLimitOnce: ["/v1/company-search"] }); });
after(async () => { await mock.close(); });

test("client injects the key (body + header), never from args, and reports charges", async () => {
  const { client, charges } = setup();
  const r = await client.call("peopleSearch", { apiKey: "sk_live_attacker_supplied", searchParams: {}, pageSize: 2 });
  assert.equal(r.output.data.length, 2);
  const req = mock.requests.at(-1)!;
  assert.equal(req.body.apiKey, KEY);
  assert.equal(req.headers["x-api-key"], KEY);
  assert.equal(charges.at(-1)!.credits, 2);
  const g = await client.call("getOrgCredits", {});
  assert.ok(mock.requests.at(-1)!.path.endsWith("get-org-credits"));
  assert.ok(g.output[0].available > 0);
});

test("client: 401 → InvalidKeyError, 429 retried, deny list blocked", async () => {
  await assert.rejects(setup({ key: "sk_live_wrongwrongwrong" }).client.call("getOrgCredits", {}), InvalidKeyError);
  const r = await setup().client.call("companySearch", { searchParams: {} }); // first call gets 429, then retried
  assert.equal(r.output.data.length, 2);
  await assert.rejects(setup().client.call("buyCredits", { amount: 1 }), BlockedByPolicyError);
});

test("client: paid timeout is UnknownOutcome (no retry); idempotent 5xx retried", async () => {
  let calls = 0;
  const slow = new FiberClient({ baseUrl: "http://127.0.0.1:1", getKey: () => KEY, fetchImpl: (async () => { calls++; throw new TypeError("fetch failed"); }) as any, maxRetries: 2 });
  await assert.rejects(slow.call("syncQuickContactReveal", { linkedinUrl: "x" }), UnknownOutcomeError);
  assert.equal(calls, 1);
  let n = 0;
  const flaky = new FiberClient({ baseUrl: "http://x", getKey: () => KEY, maxRetries: 2, fetchImpl: (async () => { n++; return n < 2 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ output: { ok: true } }), { status: 200 }); }) as any });
  const r = await flaky.call("pollMosaic", { runId: "r" });
  assert.equal(r.output.ok, true);
  assert.equal(n, 2);
});

test("search → list → reveal → validate → export (happy path)", async () => {
  const { gtm, store } = setup();
  const parsed = await gtm.nlParse("Heads of RevOps in the US");
  const sp = parsed.parsedParams!.profileSearchParams;
  assert.equal(await gtm.count("people", sp), 1240);
  const res = await gtm.searchPeople(sp, { pageSize: 3, list: "Q4 RevOps" });
  assert.equal(res.added, 3);
  assert.equal(store.getList("Q4 RevOps")!.size, 3);
  const entities = store.items(res.listId).map((i) => i.entity!);
  const plan = gtm.planReveal(entities, { workEmail: true });
  assert.equal(plan.todo.length, 3);
  assert.equal(plan.estimate.credits, 6);
  for (const e of plan.todo) await gtm.revealOne(e, plan.types);
  // Second plan: everything cached → nothing to pay (A7)
  assert.equal(gtm.planReveal(entities, { workEmail: true }).todo.length, 0);
  const v = await gtm.validateEmail("dana@loomly.com");
  assert.equal(v.verdict, "ok");
  assert.equal((await gtm.validateEmail("dana@loomly.com")).cached, true);
  // DNC excluded from export (G2)
  store.addDnc("raj@tidewave.io", "email");
  const out = listExportRows(store, res.listId, { preset: "outreach" });
  assert.equal(out.rows.length, 2);
  assert.equal(out.skippedDnc, 1);
  assert.deepEqual(out.headers.slice(0, 3), ["First Name", "Last Name", "Email"]);
});

test("dedupe: same person via email then LinkedIn is one entity (F6)", async () => {
  const { store } = setup();
  const a = store.upsertPerson({ name: "Dana Whitfield" }, null, "import", { email: "dana@loomly.com" });
  const b = store.upsertPerson({ name: "Dana Whitfield", linkedinUrl: "https://www.linkedin.com/in/dana-whitfield" }, null, "ks", { email: "dana@loomly.com" });
  assert.equal(a.id, b.id);
  assert.equal(store.getEntity(a.id)!.linkedin_url, "https://www.linkedin.com/in/dana-whitfield");
});

test("Kitchen Sink repair path for small files keeps row order and marks not-found", async () => {
  const { gtm, store } = setup();
  const f = join(dir, "small.csv");
  writeFileSync(f, "Name,Company,LinkedIn\nDana Whitfield,Loomly,https://linkedin.com/in/dana-whitfield\nNobody Known,Nowhere Inc,\n");
  const pre = await preflight(f, {}, { pricing: gtm.pricing, store });
  assert.equal(pre.engine, "kitchen-sink");
  assert.equal(pre.rowCount, 2);
  const r = await runKitchenSinkRepair(pre, gtm);
  assert.equal(r.found, 1);
  assert.equal(r.notFound, 1);
  const items = store.items(r.listId);
  assert.equal(items[0].status, "enriched");
  assert.equal(items[1].status, "not_found");
  assert.ok(store.findRepair(pre.fileHash!));
});

test("Mosaic path: start with manual URL → job polls → downloads healed CSV → imports list (A4, D4, D5)", async () => {
  const { client, store, config } = setup();
  const f = join(dir, "big.csv");
  writeFileSync(f, ["Full Name,Email,Company", ...Array.from({ length: 80 }, (_, i) => `Person ${i},p${i}@acme.com,Acme`)].join("\n"));
  const pre = await preflight(f, { engine: "auto", sourceUrl: `${mock.url}/files/source.csv`, contacts: { workEmail: true } }, { pricing: new Pricing(), store });
  assert.equal(pre.engine, "mosaic");
  const jobs = await startMosaicRuns(pre, { client, store, config });
  assert.equal(jobs.length, 1);
  const startReq = mock.requests.find((r) => r.path === "/v1/mosaic/start")!;
  assert.deepEqual(startReq.body.options.contactInfo, { getWorkEmails: true, getPersonalEmails: false, getPhoneNumbers: false });
  let t = 1_000;
  const mgr = new JobManager(store, config, () => t);
  mgr.register("mosaic", mosaicHandler({ client, store, config }));
  store.updateJob(jobs[0].id, { next_poll_at: 0 });
  await mgr.tick();
  assert.equal(store.getJob(jobs[0].id)!.status, "running");
  t += 31_000;
  await mgr.tick();
  const done = store.getJob(jobs[0].id)!;
  assert.equal(done.status, "done", done.error ?? "");
  const healed = (done.result as any).healedPath;
  assert.ok(existsSync(healed));
  assert.ok(readFileSync(healed, "utf8").includes("Dana Whitfield"));
  const list = store.getList(done.list_id!)!;
  assert.equal(list.size, 3);
  assert.equal(store.items(list.id)[0].contacts![0].value, "dana@loomly.com");
});

test("batch contact job streams results into the list", async () => {
  const { client, store, config } = setup();
  const e = store.upsertPerson({ name: "Mei Chen", linkedinUrl: "https://www.linkedin.com/in/mei-chen" }, null, "test");
  const list = store.createList("batch", "people");
  store.addToList(list.id, e.id);
  const job = store.createJob({ kind: "batch_contacts", op: "startBatchContactDetails", remoteId: "task_1", status: "running", params: { listId: list.id, byUrl: { "https://www.linkedin.com/in/mei-chen": e.id }, cursor: null, types: {}, count: 1 }, nextPollAt: 0 });
  const mgr = new JobManager(store, config);
  mgr.register("batch_contacts", batchContactsHandler({ client, store }));
  await mgr.tick();
  assert.equal(store.getJob(job.id)!.status, "done");
  assert.equal(store.contacts(e.id)[0].value, "mei@parcelo.com");
});

test("402 mid-batch stops cleanly and keeps partial results (C3)", async () => {
  const m2 = await startMockFiber({ outOfCreditsAfter: 1 });
  try {
    const client = new FiberClient({ baseUrl: m2.url, getKey: () => KEY });
    const store = new Store(":memory:");
    const gtm = new Gtm(client, store, DEFAULT_CONFIG, new Pricing());
    const res = await gtm.searchPeople({}, { pageSize: 3 });
    assert.equal(res.added, 3);
    await assert.rejects(gtm.searchPeople({}, { pageSize: 3 }), OutOfCreditsError);
    assert.equal(store.lists().length, 1);
  } finally { await m2.close(); }
});

test("MCP bridge client speaks Streamable HTTP (JSON + SSE)", async () => {
  const c = new McpHttpClient(`${mock.url}/mcp`, () => ({ "x-api-key": KEY }));
  const tools = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["search_endpoints", "call_operation"]);
  const r = await c.callTool("call_operation", { operationId: "getTalentFlowRivals", body: {} });
  assert.match(mcpText(r), /getTalentFlowRivals/);
});
