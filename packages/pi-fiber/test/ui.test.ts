import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/core/store/db";
import { ListPane, type PaneAction } from "../src/extension/ui/listPane";
import { personCard } from "../src/extension/ui/cards";
import { displayWidth } from "../src/extension/ui/text";

const theme: any = { fg: (_c: string, t: string) => t, bold: (t: string) => t };

function seed() {
  const store = new Store(":memory:");
  const list = store.createList("Pane test", "people");
  for (let i = 0; i < 40; i++) {
    const e = store.upsertPerson({ name: i === 3 ? "李小龙 Bruce" : `Person ${i}`, title: "Head of Revenue Operations and Strategy", company: `Company ${i}`, timezone: "America/New_York", linkedinUrl: `https://www.linkedin.com/in/p${i}` }, null, "test");
    store.addToList(list.id, e.id);
    if (i % 2) store.addContact(e.id, "work_email", `p${i}@c${i}.com`, "valid", "test");
  }
  return { store, list: store.getList(list.id)! };
}

test("ListPane renders within width at 50/80/120/200 columns (K1, K2)", () => {
  const { store, list } = seed();
  for (const w of [50, 80, 120, 200]) {
    const pane = new ListPane(store, list, theme, () => undefined, () => undefined, undefined, 10);
    const lines = pane.render(w);
    assert.ok(lines.length >= 12);
    for (const l of lines) assert.ok(displayWidth(l) <= w, `line too wide at ${w}: ${displayWidth(l)}`);
  }
});

test("ListPane keys: move, select, filter, card, actions", () => {
  const { store, list } = seed();
  let action: PaneAction | undefined;
  const pane = new ListPane(store, list, theme, (a) => { action = a; }, () => undefined, undefined, 10);
  pane.handleInput("\x1b[B"); // down
  pane.handleInput(" ");       // select row 1 → cursor 2
  pane.handleInput(" ");       // select row 2
  assert.match(pane.render(100)[0], /2 selected/);
  pane.handleInput("/"); for (const ch of "Person 1") pane.handleInput(ch); pane.handleInput("\r");
  assert.match(pane.render(100)[0], /filter: "Person 1"/);
  pane.handleInput("\r"); // open card
  assert.ok(pane.render(100).some((l) => l.includes("Contacts")));
  pane.handleInput("\x1b"); // back
  pane.handleInput("e");
  assert.equal(action?.action, "enrich");
  assert.equal((action as any).ids.length, 2);
  pane.handleInput("d"); // toggle DNC on selection
  assert.equal(store.dncList().length, 2);
  pane.handleInput("q");
  assert.equal(action?.action, "close");
});

test("person card degrades to plain text", () => {
  const { store, list } = seed();
  const it = store.items(list.id)[1];
  const lines = personCard(it.entity!, it.contacts!, 60);
  assert.ok(lines.some((l) => l.includes("p1@c1.com") && l.includes("valid")));
  assert.ok(lines.some((l) => l.includes("Best call window")));
});
