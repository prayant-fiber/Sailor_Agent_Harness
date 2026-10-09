/** FIB-20426/27/28 + Fiber look: pure helpers (no Pi host, no network). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SAILOR_HOME = mkdtempSync(join(tmpdir(), "sailor-prosp-"));
process.env.SAILOR_DISABLE_KEYCHAIN = "1";
process.env.NO_COLOR = "1";

const { Store } = await import("../src/core/store/db");
const { extractSocials, profileList, saveScores, narrowToQualified, tierFor, seniorityOf } = await import("../src/core/prospecting");
const { CRMS, crmRows, isCrmTool } = await import("../src/core/crm");
const { computeActiveTools } = await import("../src/extension/modes");
const { planModeBlock, looksLikePlan, nextAgentMode } = await import("../src/extension/agentMode");
const { resolveSandboxKey } = await import("../src/core/secrets");
const { headerLines, footerLines } = await import("../src/extension/ui/fiberLook");

function seed() {
  const s = new Store(":memory:");
  const l = s.createList("Seed", "people");
  const people = [
    { name: "Dana Whitfield", title: "VP Revenue Operations", company: "Loomly", companyDomain: "loomly.com", location: "Austin, TX", linkedinUrl: "https://www.linkedin.com/in/dana" },
    { name: "Raj Menon", title: "Head of RevOps", company: "Tidewave", companyDomain: "tidewave.io", location: "NYC", linkedinUrl: "https://www.linkedin.com/in/raj" },
    { name: "Ana Ruiz", title: "Sales Manager", company: "Loomly", companyDomain: "loomly.com", location: "Austin, TX", linkedinUrl: "https://www.linkedin.com/in/ana" },
  ];
  const raw = [{ twitter_username: "danaw", github_url: "https://github.com/danaw", experiences: [{ company_linkedin: "https://twitter.com/loomly" }] }, {}, { websites: [{ url: "https://x.com/anaruiz" }] }];
  const ids = people.map((p, i) => { const e = s.upsertPerson(p, raw[i], "test"); s.addToList(l.id, e.id); return e.id; });
  s.addContact(ids[0], "work_email", "dana@loomly.com", "valid", "test");
  s.addContact(ids[1], "work_email", "raj@tidewave.io", "valid", "test");
  return { s, l, ids };
}

test("socials come from stored Fiber data, not from employers nested in experience", () => {
  const { s, ids } = seed();
  const dana = extractSocials(s.getEntity(ids[0])!);
  assert.equal(dana.x, "https://x.com/danaw");
  assert.equal(dana.github, "https://github.com/danaw");
  assert.equal(dana.linkedin, "https://www.linkedin.com/in/dana");
  assert.equal(extractSocials(s.getEntity(ids[2])!).x, "https://x.com/anaruiz");
  assert.deepEqual(Object.keys(extractSocials(s.getEntity(ids[1])!)), ["linkedin"]);
});

test("list profile summarizes titles, seniority and companies", () => {
  const { s, l } = seed();
  const p = profileList(s, l.id);
  assert.match(p.text, /3 people/);
  assert.match(p.text, /Companies: Loomly \(67%\)/);
  assert.match(p.text, /Seniority: .*VP/);
  assert.equal(seniorityOf("Head of RevOps"), "Head");
  assert.equal(seniorityOf("Chief Revenue Officer"), "C-level");
});

test("scores are clamped, tiered and narrowed best-first", () => {
  const { s, l, ids } = seed();
  const r = saveScores(s, l.id, [{ entityId: ids[0], score: 120, reason: "x" }, { entityId: ids[1], score: 65 }, { entityId: ids[2], score: 10 }, { entityId: "nope", score: 50 }]);
  assert.equal(r.updated, 3);
  assert.deepEqual(r.missing, ["nope"]);
  assert.equal(tierFor(100), "A");
  const n = narrowToQualified(s, l.id, 60);
  assert.equal(n.kept, 2);
  const items = s.items(n.listId);
  assert.deepEqual(items.map((i) => i.score), [100, 65]);
  assert.equal(items[0].tier, "A");
});

test("CRM rows drop DNC and carry fit + socials", () => {
  const { s, l, ids } = seed();
  s.addDnc("raj@tidewave.io", "email");
  saveScores(s, l.id, [{ entityId: ids[0], score: 88, reason: "VP RevOps" }]);
  const r = crmRows(s, l.id);
  assert.equal(r.total, 2);
  assert.equal(r.skippedDnc, 1);
  const dana = r.rows.find((x) => x.sailorId === ids[0])!;
  assert.equal(dana.email, "dana@loomly.com");
  assert.equal(dana.firstName, "Dana");
  assert.equal(dana.fitScore, 88);
  assert.equal(dana.xUrl, "https://x.com/danaw");
  assert.equal(crmRows(s, l.id, { minScore: 50 }).total, 1);
});

test("CRM connection entries", () => {
  assert.equal(CRMS.hubspot.entry({ provider: "hubspot" }, {}), undefined, "HubSpot needs a connector client id");
  const hs = CRMS.hubspot.entry({ provider: "hubspot", hubspotClientId: "abc" }, { hubspotClientSecret: "s" })!;
  assert.equal(hs.url, "https://mcp.hubspot.com");
  assert.deepEqual(hs.oauth, { clientId: "abc", clientSecret: "s", callbackPort: 8765 });
  assert.equal(CRMS.attio.entry({}, {})!.url, "https://mcp.attio.com/mcp");
  assert.ok(CRMS.salesforce.entry({ salesforceOrg: "prod" }, {})!.args!.includes("prod"));
  assert.ok(isCrmTool("mcp__hubspot__create_contact"));
  assert.ok(!isCrmTool("mcp__github__search"));
});

test("Plan mode: tools and spend gating", () => {
  const all = ["read", "bash", "edit", "write", "fiber_count", "mcp__attio__upsert-record"];
  const cfg = (agentMode: string, mode = "engineer") => ({ config: { mode, toolsProfile: "full", agentMode } as any });
  assert.deepEqual(computeActiveTools(all, cfg("build")), all);
  assert.deepEqual(computeActiveTools(all, cfg("plan")), ["read", "fiber_count"]);
  assert.match(planModeBlock({ agentMode: "plan" }, "fiber_count", { credits: 1, basis: "count" })!, /PLAN mode/);
  assert.equal(planModeBlock({ agentMode: "plan" }, "list_show", { credits: 0, basis: "" }), undefined);
  assert.equal(planModeBlock({ agentMode: "build" }, "fiber_count", { credits: 1, basis: "count" }), undefined);
  assert.ok(looksLikePlan("## Plan\n1. Count heads of RevOps (~1 cr)\n2. Search 25 (~25 cr)"));
  assert.ok(!looksLikePlan("Here are 3 results: 1. Dana"));
  assert.equal(nextAgentMode("build"), "plan");
  assert.equal(nextAgentMode("sandbox"), "build");
});

test("Sandbox key never falls back to a live key", () => {
  delete process.env.FIBER_SANDBOX_KEY;
  process.env.FIBER_API_KEY = "sk_live_abcdefgh1234";
  assert.equal(resolveSandboxKey(), undefined);
  process.env.FIBER_API_KEY = "sk_test_abcdefgh1234";
  assert.equal(resolveSandboxKey()?.key, "sk_test_abcdefgh1234");
  process.env.FIBER_SANDBOX_KEY = "sk_test_other12345";
  assert.equal(resolveSandboxKey()?.key, "sk_test_other12345");
  delete process.env.FIBER_SANDBOX_KEY;
  delete process.env.FIBER_API_KEY;
});

test("Fiber header/footer render the wordmark, the mode and stay within width", () => {
  const rt: any = { agentMode: "sandbox", cwd: "/tmp/acme", config: { mode: "rep", crm: { provider: "attio" } }, meter: { text: () => "Fiber SANDBOX · no credits charged │ session −0/500" } };
  const theme: any = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
  const h = headerLines(rt, theme, 60);
  assert.ok(h.some((l) => l.includes("F I B E R") && l.includes("Sailor")));
  assert.ok(h.some((l) => l.includes("[SANDBOX]")));
  assert.ok(h.every((l) => l.length <= 60));
  const statuses = new Map([["fiber", "Fiber SANDBOX · no credits charged │ session −0/500"], ["sailor-last", "last: fiber_count ~1 cr"]]);
  const f = footerLines(rt, { model: { id: "claude-x" }, getContextUsage: () => ({ tokens: 1, contextWindow: 10, percent: 12 }) } as any, theme, { getGitBranch: () => "main", getExtensionStatuses: () => statuses }, 120);
  assert.match(f[0], /● fiber sailor {2}\[SANDBOX\] {2}· no credits charged/);
  assert.match(f[0], /claude-x · ctx 12%$/);
  assert.match(f[1], /acme \(main\) · crm attio/);
});
