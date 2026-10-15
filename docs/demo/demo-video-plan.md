# Sailor demo video: what to show and how to run it

A plan for a **4–5 minute** demo of Sailor: what to set up, what to show in each scene, what to type, what to say, and how to record it.

Helper files (in `demo/`):

| File | What it is |
|---|---|
| `demo/run-demo.sh` | Starts the mock Fiber API in the background and opens Sailor against it in a fresh sandbox (`/tmp/sailor-demo`). `LIVE=1` uses the real Fiber API instead |
| `demo/workspace/leads_messy.csv` | A small, deliberately broken CRM export (preamble rows, `;` delimiter, "Last, First" name, Sales Navigator URL, `mailto:` email) for the repair scene |
| `demo/workspace/sailor.md` | Demo playbook for a **fictional** product ("Northstar"), so the cold-call scripts have something to sell |
| `demo/demo.tape` | VHS script that types the whole demo automatically and renders MP4 + GIF |

---

## 1. Decide: mock or live?

| | **Mock mode** (recommended) | **Live mode** |
|---|---|---|
| Fiber data | Canned: 3 people (Dana Whitfield, Raj Menon, Mei Chen), 2 companies (Loomly, Tidewave) | Real Fiber results |
| Credits | 10,000 fake credits, nothing real spent | Real credits (set a budget) |
| Privacy | No real people's contact details on screen | Real emails/phones on screen: blur them in editing |
| Repeatable | Fiber side identical every take | Results change |
| Google Sheets export | Not available (use CSV) | Available after `/sheets connect` |
| Large Mosaic repair | Not shown | Available with hosting set up |

The LLM is real in both modes, so its wording changes between takes.

---

## 2. One-time setup (≈15 min)

```bash
# 1. Node ≥ 22.13
node -v

# 2. Pi
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# 3. Repo deps + sanity check
cd ~/Projects/Sailor_Agent_Harness
npm install
npm test                                # 49 passing

# 4. LLM key (a strong model looks best on video: Claude Sonnet-class or GPT-5-class)
export ANTHROPIC_API_KEY=sk-ant-...

# 5. Recording tool (pick one, see §5)
brew install vhs                        # scripted recording
# or use QuickTime / OBS / Screen Studio for a live narrated take
```

**Terminal look** (for a live screen recording):

- Font size 18–20pt, window ≈ 140×40 or larger (the list pane hides columns under 80 cols)
- A dark theme, no transparency or background image
- Hide the dock, turn on Do Not Disturb, close Slack and email
- `export PS1='$ '` for a clean prompt; `clear` before each take

**Live mode only:**

```bash
LIVE=1 ./demo/run-demo.sh               # first run asks for your Fiber key
# inside Sailor, before recording:
/budget session 100
/budget auto 5                          # so the approval prompt appears on camera
/sheets connect                         # if you'll show the Google Sheets export (README → Google Sheets)
```

---

## 3. How to run everything

### Mock mode (one command)

```bash
cd ~/Projects/Sailor_Agent_Harness
./demo/run-demo.sh
```

This:

1. Wipes and recreates the sandbox at `/tmp/sailor-demo` (keeps your real `~/.sailor` and keychain untouched)
2. Starts the mock Fiber API on `127.0.0.1:4455` in the background (log: `/tmp/sailor-demo/mock.log`)
3. Points Sailor at it with a fake key
4. Opens Sailor from `demo/workspace/`, so the playbook and CSV are in the working folder
5. Stops the mock when you exit

Options: `FRESH=0 ./demo/run-demo.sh` keeps the lists from the last run (useful to re-record one scene). `SANDBOX=/tmp/other ./demo/run-demo.sh` uses a different folder.

### Manual mock mode (two terminals)

```bash
# Terminal 1
npm run mock:fiber

# Terminal 2
export FIBER_BASE_URL=http://127.0.0.1:4455 FIBER_MCP_BASE_URL=http://127.0.0.1:4455
export FIBER_API_KEY=sk_live_testkey123456 SAILOR_HOME=/tmp/sailor-demo SAILOR_DB=/tmp/sailor-demo/sailor.db
export SAILOR_DISABLE_KEYCHAIN=1 SAILOR_ALLOW_INSECURE_URLS=1
cd demo/workspace && node ../../packages/sailor-cli/bin/sailor.mjs
```

---

## 4. Shot list

Times are targets for the final cut. "Say" lines are suggested voiceover or on-screen captions.

### Scene 0 — Hook (0:00–0:15)

**Show:** a title card, or the terminal with the Sailor banner.
**Say:** "Sailor turns your terminal into a sales assistant. Plain-English prospecting on Fiber AI's data, with every credit visible before you spend it."

### Scene 1 — Setup in one command (0:15–0:35)

**Type:**
```bash
node packages/sailor-cli/bin/sailor.mjs doctor
./demo/run-demo.sh
```
**Show:** the green ✓ checks, then Sailor opening with the **credit meter in the footer** (`Fiber 10,000 cr`).
**Say:** "One command checks your setup, connects your Fiber key and opens Sailor. Your credit balance is always in the footer."
> In live mode, show the first-run key prompt instead (key is masked). Never show the full key.

### Scene 2 — Free questions cost nothing (0:35–0:50)

**Type:** `What's my Fiber credit balance?`
**Show:** the answer, and that the footer didn't change.
**Say:** "Free calls stay free. Sailor knows which Fiber calls cost credits."

### Scene 3 — Plain-English prospecting (0:50–1:40) ★ main scene

**Type:**
```
I sell a RevOps analytics tool. Find heads of RevOps at US B2B SaaS companies, 200-1000 employees, that raised in the last 12 months. Save them as a list called RevOps US.
```
**Show:**
1. The parsed filters (title, country, headcount, funding)
2. The cheap **count** first (mock: 1,240 matches)
3. The **approval prompt** with the credit estimate → approve
4. The new list `revops-us` and the footer ticking down

**Say:** "Sailor turns the request into Fiber filters, counts matches first, then asks before spending. You see the estimate every time."

### Scene 4 — List pane and prospect cards (1:40–2:10)

**Type:** `/list revops-us` then use `↑ ↓` and `Enter` on a row.
**Show:** the table, then the **prospect card**: tenure, local time, company funding, headcount.
**Say:** "Lists live in a proper table: sort, filter, multi-select. Enter opens the full card."

### Scene 5 — Reveal emails with the cost guard (2:10–2:40)

**In the pane:** `a` (select all) → `e` (reveal) → approve.
**Show:** the estimate prompt, emails appearing with **validity badges**, the footer dropping.
**Say:** "Revealing contacts is a paid action, so it asks first. Revealed contacts are cached, so you never pay twice."
Press `q` to leave the pane.

### Scene 6 — Spend ledger (2:40–2:55)

**Type:** `/credits`
**Show:** estimated vs. charged per operation.
**Say:** "Every call is logged: what we estimated and what Fiber actually charged."

### Scene 7 — Repair a messy CSV (2:55–3:30)

**Optional:** first show the file in a second pane: `cat demo/workspace/leads_messy.csv` (preamble rows, semicolons, "Menon, Raj", a Sales Navigator URL, `mailto:`).
**Type:** `/repair ./leads_messy.csv`
**Show:** the **pre-flight card** (detected delimiter, header row, column roles, engine = Kitchen Sink, estimate) → approve → healed list.
**Say:** "Drop in a broken CRM export. Sailor works out the format, matches every row to a real profile, and saves a clean list."
> Live mode, bigger files: `/repair <file> --work-email` goes through Mosaic (needs hosting, see [Configuration → Mosaic hosting](../guide/configuration.md#mosaic-hosting)).

### Scene 8 — Grounded cold-call scripts (3:30–4:10) ★

**Type:**
```
Write 60-second cold-call scripts for everyone in RevOps US. Cite every fact.
```
**Show:** a script with citation tags like `[latestFunding.stage]`, plus the best time to call in the prospect's time zone. Scroll slowly.
**Say:** "Scripts follow your playbook (`sailor.md`) and every fact cites the Fiber field it came from. No made-up claims."

### Scene 9 — Export (4:10–4:30)

**Mock:** `/export-list revops-us csv --preset outreach`
**Live:** `/export-list revops-us sheets --preset outreach` and show the Google Sheet opening.
**Say:** "Export to CSV, Excel or Google Sheets, mapped for your sequencer. Do-not-contact rows are always left out."

### Scene 10 — Optional extras (pick one, ~20 s)

| Extra | How |
|---|---|
| Engineer mode | `/mode engineer` → "Write a script that re-enriches this list every Monday" → shows a TypeScript file using `@fiberai/sdk` |
| Recruiting guardrails | `/mode recruiting` → "Find senior women engineers in Berlin" → Sailor declines the protected filter and offers compliant alternatives |
| Headless safety | In a second terminal: `pi -e ./packages/pi-fiber/extensions/sailor -p "Find 25 VPs of Sales in London"` → paid call blocked without `--fiber-max-spend` |

### Scene 11 — Outro (last 10–15 s)

**Show:** title card with the GitHub link and the install line (`npx sailor-gtm`, once published).
**Say:** "Sailor is open source. Bring your own LLM and your Fiber key."

---

## 5. Recording

### Option A — VHS (scripted, cleanest)

```bash
cd ~/Projects/Sailor_Agent_Harness
vhs demo/demo.tape          # → demo/sailor-demo.mp4 and .gif
```

- The tape types each scene for you. LLM replies vary, so after a rehearsal **adjust the `Sleep` values** in `demo/demo.tape` (the search and the scripts scenes need the most time).
- Check what key Pi's approval prompt expects (the tape sends `y`). If it's different, change those lines.
- Add voiceover and titles afterwards in your editor.

### Option B — live screen recording (narrated)

1. Start `./demo/run-demo.sh` with the terminal sized and styled (§2).
2. `Cmd+Shift+5` (QuickTime) → record selected portion → select the terminal window. Or OBS / Screen Studio (auto-zoom looks good for terminals).
3. Do the scenes in order. Pause and redo a scene if something goes wrong; you'll cut it later.
4. Record the voiceover separately if you prefer; it's easier to get it clean.

### Option C — asciinema

```bash
brew install asciinema agg
asciinema rec demo/sailor.cast -c ./demo/run-demo.sh
agg demo/sailor.cast demo/sailor.gif
```
Good for a README GIF; no audio.

---

## 6. Editing

- Cut the waiting while the LLM thinks, or speed it up 2–4× with a small "⏩" label.
- Zoom in on the footer meter and the approval prompts; they're the key point of the demo.
- Add captions for the "Say" lines (many people watch muted).
- **Live mode:** blur every real email address, phone number and API key.
- Tools: iMovie, CapCut, Descript (edit by transcript), or Screen Studio.
- Export 1080p MP4. Keep a 30-second GIF cut (scenes 3–5) for the README and Slack.

---

## 7. Rehearsal checklist

- [ ] `npm test` passes
- [ ] `./demo/run-demo.sh` opens Sailor and the footer shows `Fiber 10,000 cr`
- [ ] Each scene runs once without errors (**Sailor has not been run with a real LLM before, so do a full dry run first**)
- [ ] Note what the approval prompt looks like and which key confirms it
- [ ] List id is `revops-us` (check with `/lists`; otherwise change the commands)
- [ ] Notifications off, terminal sized, font big
- [ ] Live mode: budget set, key never visible, Sheets connected if used

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| Footer shows a real balance in mock mode | A `FIBER_BASE_URL` wasn't set. Use `./demo/run-demo.sh` |
| `ECONNREFUSED 127.0.0.1:4455` | Mock didn't start: check `/tmp/sailor-demo/mock.log`; run `npm install` |
| Model skips the count or the approval | Use a stronger model; re-take the scene |
| Search returns only 3 people | Expected in mock mode (canned data) |
| `/list revops-us` not found | `/lists` to see the real id |
| Columns missing in the pane | Widen the terminal to ≥ 120 cols |
| Paid call "blocked" | You're in headless mode; that's the headless-safety extra |
