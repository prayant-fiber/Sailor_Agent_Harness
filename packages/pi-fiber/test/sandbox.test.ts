import { test } from "node:test";
import assert from "node:assert/strict";
import { FiberClient } from "../src/core/fiber/client";
import { SandboxUnsupportedError } from "../src/core/errors";
import { computeActiveTools } from "../src/extension/modes";

const SANDBOX_KEY = "sk_test_sandbox123456";

test("sandbox 501 → SandboxUnsupportedError, never retried (even for idempotent ops)", async () => {
  let calls = 0;
  const client = new FiberClient({
    baseUrl: "http://x", getKey: () => SANDBOX_KEY, maxRetries: 3,
    fetchImpl: (async () => { calls++; return new Response(JSON.stringify({ message: "Sandbox mode is not yet available for this endpoint." }), { status: 501 }); }) as any,
  });
  await assert.rejects(client.call("pollMosaic", { runId: "r" }), (e: unknown) => e instanceof SandboxUnsupportedError && /sandbox/i.test((e as Error).message));
  assert.equal(calls, 1);
});

test("x-fiber-sandbox header marks the client as sandbox; free chargeInfo charges 0", async () => {
  const charges: number[] = [];
  const client = new FiberClient({
    baseUrl: "http://x", getKey: () => SANDBOX_KEY, onCharge: (e) => charges.push(e.credits),
    fetchImpl: (async () => new Response(JSON.stringify({ output: { data: [] }, chargeInfo: { method: "free", message: "sandbox" } }), { status: 200, headers: { "x-fiber-sandbox": "true" } })) as any,
  });
  assert.equal(client.sandboxSeen, false);
  await client.call("peopleSearch", { pageSize: 5 });
  assert.equal(client.sandboxSeen, true);
  assert.deepEqual(charges, [0]);
});

test("known-unsupported ops fail locally for sandbox keys (no network); live keys unaffected", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return new Response(JSON.stringify({ output: [{ available: 5 }] }), { status: 200 }); }) as any;
  const sandbox = new FiberClient({ baseUrl: "http://x", getKey: () => SANDBOX_KEY, fetchImpl });
  for (const op of ["getOrgCredits", "slushieRun", "KitchenSinkProfile"]) await assert.rejects(sandbox.call(op, {}), SandboxUnsupportedError);
  assert.equal(calls, 0);
  const live = new FiberClient({ baseUrl: "http://x", getKey: () => "sk_live_abcdef123456", fetchImpl });
  await live.call("getOrgCredits", {});
  assert.equal(calls, 1);
});

test("a new 501 is remembered: the second call doesn't hit the network", async () => {
  let calls = 0;
  const client = new FiberClient({ baseUrl: "http://x", getKey: () => SANDBOX_KEY, fetchImpl: (async () => { calls++; return new Response("{}", { status: 501 }); }) as any });
  await assert.rejects(client.call("companySearch", {}), SandboxUnsupportedError);
  await assert.rejects(client.call("companySearch", {}), SandboxUnsupportedError);
  assert.equal(calls, 1);
  assert.ok(client.sandboxUnsupported.has("companySearch"));
});

test("sandbox hides tools that only wrap unsupported ops", () => {
  const all = ["fiber_search_people", "fiber_nl_search", "fiber_resolve_person", "fiber_reveal_contacts"];
  const config = { mode: "rep", toolsProfile: "full" } as any;
  assert.deepEqual(computeActiveTools(all, { config, isSandbox: true }), ["fiber_search_people", "fiber_reveal_contacts"]);
  assert.deepEqual(computeActiveTools(all, { config, isSandbox: false }), all);
});

test("title groups use the documented { type, groups: [] } shape and reject unknown values", async () => {
  const { buildPeopleSearchParams } = await import("../src/core/gtm");
  const sp: any = buildPeopleSearchParams({ titles: ["Head of RevOps"], titleGroups: ["vp", "Director", "founder"] });
  assert.deepEqual(sp.jobTitleV2.anyOf, [
    { type: "term", term: "Head of RevOps" },
    { type: "static-groups", groups: ["founder"] },
    { type: "dynamic-groups", groups: ["vp", "director"] },
  ]);
  assert.throws(() => buildPeopleSearchParams({ titleGroups: ["ceo"] }), /Unknown title group/);
});

test("FIB-20390: sandbox prompt tells the agent to proceed on sample data without caveats", async () => {
  const { systemPromptAddendum } = await import("../src/extension/prompt");
  const base = { config: { budget: { autoApproveUnder: 25, session: 500, daily: 2000 }, mode: "rep", dryRun: false }, client: { sandboxUnsupported: new Set(["slushieRun"]) } };
  const sb = systemPromptAddendum({ ...base, isSandbox: true } as any);
  assert.match(sb, /SANDBOX mode: sample data, keep going/);
  assert.match(sb, /will NOT match the request/);
  assert.match(sb, /Do not re-run, broaden or tweak a search/);
  assert.match(sb, /Don't get in the user's way/);
  const live = systemPromptAddendum({ ...base, isSandbox: false } as any);
  assert.doesNotMatch(live, /SANDBOX/);
});

test("FIB-20390: Fiber data results carry a hidden sandbox note; other results and live keys don't", async () => {
  const { withSandboxNote, SANDBOX_DATA_NOTE } = await import("../src/extension/tools/common");
  const fiber = { content: [{ type: "text", text: '<untrusted source="fiber">table</untrusted>' }], details: {} } as any;
  const plain = { content: [{ type: "text", text: "Saved notes." }], details: {} } as any;
  const s = withSandboxNote(fiber, true);
  assert.equal(s.content.length, 2);
  assert.equal((s.content[1] as any).text, SANDBOX_DATA_NOTE);
  assert.equal((s.content[0] as any).text, (fiber.content[0] as any).text, "the user-visible block is unchanged");
  assert.equal(withSandboxNote(fiber, false).content.length, 1);
  assert.equal(withSandboxNote(plain, true).content.length, 1);
});
