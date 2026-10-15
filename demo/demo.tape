# VHS script for the Sailor demo (mock mode). Record with:  vhs demo/demo.tape
# Run from the repo root. LLM replies vary in length, so tune the Sleep values after a rehearsal.
Output demo/sailor-demo.mp4
Output demo/sailor-demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1440
Set Height 900
Set Padding 24
Set TypingSpeed 45ms
Set Theme "Catppuccin Mocha"

# ── setup (hidden) ──
Hide
Type "export PS1='$ ' && clear" Enter
Show

# Scene 1 — health check
Type "node packages/sailor-cli/bin/sailor.mjs doctor" Sleep 500ms Enter
Sleep 4s

# Scene 2 — launch Sailor (mock Fiber API)
Type "./demo/run-demo.sh" Sleep 500ms Enter
Sleep 8s

# Scene 3 — free question, zero spend
Type "What's my Fiber credit balance?" Enter
Sleep 12s

# Scene 4 — ICP → count → search → list
Type "I sell a RevOps analytics tool. Find heads of RevOps at US B2B SaaS companies, 200-1000 employees, that raised in the last 12 months. Save them as a list called RevOps US." Enter
Sleep 25s
Type "y"
Sleep 15s

# Scene 5 — list pane + prospect card
Type "/list revops-us" Enter
Sleep 3s
Down Sleep 700ms Down Sleep 700ms Up Sleep 700ms
Enter
Sleep 5s
Escape
Sleep 1s

# Scene 6 — reveal emails (cost guard)
Type "a"
Sleep 1s
Type "e"
Sleep 3s
Type "y"
Sleep 8s
Type "q"
Sleep 2s

# Scene 7 — credits ledger
Type "/credits" Enter
Sleep 5s

# Scene 8 — repair a messy CSV
Type "/repair ./leads_messy.csv" Enter
Sleep 6s
Type "y"
Sleep 15s

# Scene 9 — grounded cold-call scripts
Type "Write 60-second cold-call scripts for everyone in RevOps US. Cite every fact." Enter
Sleep 40s

# Scene 10 — export
Type "/export-list revops-us csv --preset outreach" Enter
Sleep 6s

Sleep 3s
