# Sailor demo: video script with timestamps (sandbox key)

The voiceover, rewritten from a real rehearsal on the Fiber sandbox key. Target length is **about 5½ minutes**. Paste steps refer to the blocks in [sandbox-runbook.md](sandbox-runbook.md).

## What the sandbox really returns

The script is written around these, so nothing on screen contradicts the voiceover.

- **Sample people:** a fixed set of fictional profiles (Jane Doe, Amara Okafor, Tomas Delgado… at Northwind Robotics and similar), with LinkedIn URLs ending in `-sandbox`. They **don't match the RevOps filters**, and Sailor says so itself. **No blurring needed**; nothing is real.
- **Placeholder email:** every revealed email is `jane.doe@example.com`, and validation comes back `inconclusive`.
- **Footer:** reads `Fiber SANDBOX · no credits charged` and `session −0`.
- **Approval prompts:** these only appear if you run `/budget auto 2` first (step B1). Without it, nothing under 25 credits asks for approval.

Before recording:

1. Run `SKIP_TESTS=1 SKIP_PROBE=1 ./demo/sandbox-demo.sh`.
2. Off camera, run `/budget session 200`, `/budget auto 2`, `/dryrun off`.
3. Start recording on the empty chat.

Columns: **Do** is the on-screen action; **Say** is the voiceover. Speed up the AI's "thinking" in editing.

---

## 0:00 – 0:20 · Intro

**Do:** Title card "Sailor: an open-source GTM agent on Fiber AI", then cut to the terminal.

**Say:**
> "This is Sailor, an open-source sales assistant that runs right in your terminal. You talk to it in plain English, and it does the prospecting work using Fiber AI's data: building lead lists, revealing and checking contacts, and writing outreach that's backed by real data. And it never spends a credit without showing you first."

---

## 0:20 – 0:40 · Setup and the meter

**Do:** Zoom in on the footer: `Fiber SANDBOX · no credits charged │ session −0/200`.

**Say:**
> "Getting started is one command. It checks your setup, asks for your LLM key and your Fiber key, and opens Sailor. Down here is the meter, which stays on screen the whole time. Today I'm on a Fiber sandbox key, so nothing is really charged and the data is sample data, but Sailor estimates and tracks every call exactly as it would on a live account."

---

## 0:40 – 1:00 · Balance (B2)

**Do:** Paste `What's my Fiber credit balance?`

**Say (after it answers):**
> "First, a simple question. Sailor recognises I'm on a sandbox key and tells me straight: there's no live balance, and nothing gets charged. It doesn't make up a number. On a live key, this is a free call that shows your real balance."

---

## 1:00 – 2:05 · Prospecting in plain English (B3) ★

**Do:** Paste the B3 prompt. Pause on the `Count matches` line, then on `5 people match`, then on the approval prompt (approve after 2 seconds), then on the results table.

**Say (while it starts):**
> "Now the real work. Say I sell a RevOps analytics tool. I ask, in plain English, for heads of RevOps at US software companies with 200 to 1,000 employees that raised money in the last year, and to save the top five as a list."

**Say (on the `Count matches` line):**
> "Sailor turns that into proper search filters: job titles, country, industry, company size and recent funding."

**Say (on `5 people match`):**
> "Before pulling any records it runs a count, which is a cheap call. It sizes the market first, then decides how much to fetch."

**Say (on the approval prompt):**
> "Pulling records costs credits, so Sailor stops and asks, with the estimate right there. Anything over the limit I set needs my OK. No surprises on the bill."

**Say (on the results table and Sailor's caveat):**
> "And they're saved to a list called RevOps US. Notice what Sailor says next: these are sandbox sample profiles, an engineer and a CEO, not RevOps leaders, and it tells me that instead of pretending they match. On a live key, the same filters return real RevOps leaders. I'd rather have an assistant that's honest about its data."

---

## 2:05 – 2:30 · List pane (B4)

**Do:** `/list revops-us` → `↓ ↓` → `Enter` on Jane Doe → hold 3 seconds on the card → `Esc` → `q`.

**Say:**
> "Lists open in a real table inside the terminal: sort, filter, select. Enter opens a prospect card with role, company, time in the role, previous jobs, education and their local time. Everything is stored locally, so I never pay twice to look at the same person."

---

## 2:30 – 3:05 · Revealing emails (B5)

**Do:** Paste the reveal prompt → approve → table of emails. Then paste the same prompt again.

**Say:**
> "Next, work emails for the first three people. Contact reveals cost credits, so the estimate and approval come first."

**Say (on the email table):**
> "In sandbox, every email is a placeholder at example.com, and Sailor points that out too. On a live key, you get each person's real work email."

**Say (on the second run):**
> "If I ask again, Sailor knows it already has fresh contacts for these three and doesn't call Fiber at all. Zero extra cost. Across a team, that caching adds up to real savings."

---

## 3:05 – 3:20 · Validating emails (B6)

**Do:** Paste `Validate the emails in revops-us`

**Say:**
> "Before anything goes into a sequence, I validate. Sailor checks each unique address once; here there's only the one placeholder, so it's 'inconclusive'. On a live key you get a clear valid, risky or undeliverable for each address, so you know exactly who's safe to email."

---

## 3:20 – 3:35 · Spend ledger (B7)

**Do:** `/credits`. Zoom in on the table.

**Say:**
> "Every call is logged here: what Sailor estimated and what Fiber actually charged, which is zero on a sandbox key. On a live account, this is your audit trail for spend."

---

## 3:35 – 4:25 · Grounded cold-call scripts (B9) ★

**Do:** Paste the scripts prompt. Let it run; speed up the fetching. Pause on:
1. the `Entity` cards being read;
2. `read sailor.md`;
3. the line `UNGROUNDED citations … callWindow`;
4. the re-save showing `all grounded`;
5. the final summary with citations like `[title]` and `[tenureMonths]`.

**Say (while it gathers facts):**
> "Now something reps love: cold-call scripts. Sailor first pulls everything it has on each person, then reads our team playbook, a simple sailor.md file with what we sell, our proof points, our tone and the claims we're not allowed to make."

**Say (on `UNGROUNDED citations`):**
> "Every fact in a script has to cite the data it came from. Watch this: Sailor's own checker caught one reference that wasn't backed by stored data…"

**Say (on `all grounded`):**
> "…so it fixed the script and saved it again. Now every citation checks out."

**Say (on the summary):**
> "Each script follows a proven structure: a permission-based opener, a reason to call, one line of value, two discovery questions, a clear ask, a voicemail and objection handling, plus the best time to call in the prospect's own time zone. And it flags that there was no funding data to use, so it didn't make up a funding round. That's the point: no hallucinated facts in your reps' mouths."

---

## 4:25 – 4:50 · Guardrails (B11, recruiting mode)

**Do:** `/mode recruiting` → paste `Find senior women engineers in Berlin` → hold on the answer → `/mode rep`.

**Say:**
> "Sailor also works for recruiters, with guardrails built in. Ask it to filter candidates by gender and it declines, because that's a protected attribute, and offers fair, job-related criteria instead: seniority, skills, experience and location."

---

## 4:50 – 5:10 · Dry run (B11)

**Do:** `/dryrun on` → paste `Search 25 VPs of Sales at fintech companies in London` → hold on `DRY RUN — … Nothing was charged` and the estimate → `/dryrun off`.

**Say:**
> "And if you want to plan before you spend, turn on dry run. Sailor maps out the whole job, a count and then a 25-person search, and tells you what it would cost, without running a single paid call."

---

## 5:10 – 5:25 · Export (B10)

**Do:** `/export-list revops-us csv --preset outreach` → show the file name.

**Say:**
> "When the list is ready, export it to CSV, Excel or Google Sheets, with columns already mapped for tools like Outreach, Apollo or HubSpot. Anyone on your do-not-contact list is always left out."

---

## 5:25 – 5:40 · Outro

**Do:** Closing card: GitHub link · "Bring your own LLM + your Fiber key".

**Say:**
> "That's Sailor: plain-English prospecting, contacts you can trust, outreach grounded in real data, and full control over every credit. It's open source and works with the LLM of your choice. Plug in your Fiber key and try it."

---

## Optional: list repair (B8), only if it works in rehearsal

In the last rehearsal, `/repair ./leads_messy.csv` reported 0 resolved because the Fiber call failed. Sailor now shows the error instead of hiding it, so rehearse it once:

- **If rows resolve:** insert this at 3:35 (adds ~30 s):
  > "Here's a messy CRM export: junk rows on top, semicolons, a last-name-first name, a Sales Navigator link and a 'mailto' email. Sailor works out the format by itself, finds the real header, maps the columns and shows the plan and cost before running. Then it matches each row to a profile and saves a clean list."
- **If it shows a Fiber error:** leave the scene out and send me the error text.

---

## Editing notes

- **Zoom in on:** the footer (0:20), `5 people match` (1:30), the approval prompt (1:40), Sailor's sample-data caveat (2:00), the second reveal (2:55), `UNGROUNDED` → `all grounded` (3:55–4:05).
- **Captions:** add the "Say" lines as captions.
- **Speed-ups:** speed up the thinking and fetching 2–4×; never cut the approval prompts or the citation fix.
- **No blurring needed:** sandbox data is fictional. Still never show your API keys.
- **Short cut (~90 s):** 0:00–0:20 → 1:00–2:05 → 2:30–3:05 → 3:35–4:25 → outro.
- **Model cost:** the rehearsal used Claude Opus 4.8 at about $0.87 per full run. Use a cheaper model (`/model`) for practice and Opus for the final take.
