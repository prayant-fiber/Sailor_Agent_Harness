# Sailor sandbox demo: copy-paste runbook

Every command and chat message for the demo, in order, on a Fiber **sandbox key** (`sk_test_…`, never charged).

- **Part A** runs in your **Mac terminal** (zsh).
- **Part B** is typed into **Sailor's chat box** once it's open.

Each block is one copy-paste.

---

## Part A: terminal

### A1. One-time: get a fresh sandbox key

Skip this if you already have a `sk_test_…` key you haven't shared anywhere. It needs your live key once and costs nothing.

```bash
read -rsp "Live Fiber key (sk_live_…): " LIVE_KEY; echo
curl -s https://api.fiber.ai/v1/api-keys/create-sandbox \
  -H 'Content-Type: application/json' \
  -d "{\"apiKey\":\"$LIVE_KEY\",\"name\":\"sailor demo $(date +%F)\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["output"]["apiKey"])'
unset LIVE_KEY
```

Copy the printed `sk_test_…` key. It's shown only once.

### A2. Every time: set up and launch Sailor

```bash
cd ~/Projects/Sailor_Agent_Harness
./demo/sandbox-demo.sh
```

The script:

1. checks Node ≥ 22.13;
2. installs dependencies if they're missing;
3. runs the tests;
4. clears leftovers from the fake server;
5. asks for your **Anthropic key** and **Fiber sandbox key** (typing is hidden, nothing is saved);
6. checks which sandbox endpoints work;
7. opens Sailor in a fresh workspace.

Variants:

```bash
SKIP_TESTS=1 SKIP_PROBE=1 ./demo/sandbox-demo.sh            # faster relaunch for re-takes
SKIP_TESTS=1 SKIP_PROBE=1 FRESH=0 ./demo/sandbox-demo.sh    # keep lists from the previous take
```

You can skip the key prompts by exporting the keys first (`export ANTHROPIC_API_KEY=… FIBER_API_KEY=…`).

**Check:** the footer reads **`Fiber SANDBOX · no credits charged`**. If it shows `10,000 cr`, you're still on the fake server; open a new terminal and run A2 again.

---

## Part B: inside Sailor (paste one block at a time, wait for it to finish)

When an **approval prompt** appears ("Spend ~N credits on Fiber?"), approve it. In sandbox it's free, and the prompt itself is part of the demo.

### B1. Safety settings (not shown on camera)

```
/budget session 200
```
```
/budget auto 2
```
```
/dryrun off
```

### B2. Scene: sandbox / spend awareness

```
What's my Fiber credit balance?
```
✅ Expected: Sailor says it's a sandbox key and nothing is charged. No error.

### B3. Scene: prospecting, the main one

```
Find heads of RevOps at US software companies with 200-1000 employees that raised money in the last 12 months. Count the matches first, then search the top 5 and save them as a list called RevOps US.
```
✅ Expected:

1. a `Count matches` line showing the filters Sailor built (titles, country, industry, headcount, funding);
2. the match count (sandbox: `5 people match`);
3. an **approval prompt** for the search, which you approve;
4. `Added N people to list "RevOps US"`.

Paste the prompt above exactly; don't type the voiceover line into Sailor. It must ask Sailor to search and save, or Sailor stops after the count and asks.

### B4. Scene: list pane and prospect card

```
/lists
```
```
/list revops-us
```
Keys inside the pane: `↓` `↓` → `Enter` (opens the card) → `Esc` (back) → `q` (close the pane).
✅ Expected: a table of people, then a card with title, company, tenure and location.

If `revops-us` isn't found, use the id `/lists` shows.

### B5. Scene: reveal emails (cost guard)

```
Get work emails for the first 3 people in revops-us
```
✅ Expected: an approval prompt with an estimate → emails added (sandbox: all `jane.doe@example.com`, a placeholder).

Then run the same request again:
```
Get work emails for the first 3 people in revops-us
```
✅ Expected: "already had fresh contacts". Cached, no new call.

### B6. Scene: validate emails

```
Validate the emails in revops-us
```
✅ Expected: validity verdicts (sandbox: one placeholder address, `inconclusive`).

### B7. Scene: spend ledger

```
/credits
```
✅ Expected: estimated credits per operation, **0 charged** (sandbox).

### B8. Scene: repair a messy CSV

```
/repair ./leads_messy.csv
```
✅ Expected: a pre-flight card (`;` delimiter, header found below preamble rows, name/company/LinkedIn/email columns) → approve → a cleaned list. If it shows `0 resolved` with a `⚠ Fiber error`, skip this scene and send the error text.

Optionally show the file first, in a second terminal: `cat ~/Projects/Sailor_Agent_Harness/demo/workspace/leads_messy.csv`

### B9. Scene: grounded cold-call scripts

```
Write a 60-second cold-call script for each of the first 3 people in revops-us. Follow sailor.md and cite every fact.
```
✅ Expected: scripts with citation tags like `[latestFunding.stage]` and a best call time. Scroll slowly on camera.

### B10. Scene: export

```
/export-list revops-us csv --preset outreach
```
✅ Expected: a file written to `demo/workspace/revops-us.outreach.csv`.

### B11. Optional extras (pick one)

Recruiting guardrails:
```
/mode recruiting
```
```
Find senior women engineers in Berlin
```
✅ Expected: declines the gender filter and offers fair alternatives. Then go back to the default mode:
```
/mode rep
```

Dry run:
```
/dryrun on
```
```
Search 25 VPs of Sales at fintech companies in London
```
✅ Expected: an estimate only, nothing run. Then:
```
/dryrun off
```

### B12. Exit

Press `Ctrl+C` twice (or `Ctrl+D`).

---

## Part C: after the demo

```bash
# see the exported file
open ~/Projects/Sailor_Agent_Harness/demo/workspace/revops-us.outreach.csv

# remove demo output so it isn't committed
rm -f ~/Projects/Sailor_Agent_Harness/demo/workspace/*.outreach.csv

# commit today's work (sandbox support, /export-list rename, demo files, docs)
cd ~/Projects/Sailor_Agent_Harness
git add -A -- . ':!_to_delete'
git status
git commit -m "feat: Fiber sandbox support, /export-list + /import-list, demo scripts and runbooks"
```

---

## If something goes wrong

| What you see | Do this |
|---|---|
| `No API key found for the selected model` | The Anthropic key is missing or wrong. Exit and re-run A2 |
| Footer `10,000 cr` | You're on the fake server. Open a new terminal and re-run A2 |
| "isn't available with a Fiber sandbox key" | Expected for some operations; skip that step |
| Approval prompt never appears | `/budget auto 2` wasn't applied; run B1 again |
| `/list revops-us` not found | Run `/lists` and use the id it shows |
| Any other error | Copy the full error text and the message you typed, and send it to me |
