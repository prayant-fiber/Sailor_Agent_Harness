# sailor-gtm (the `sailor` command)

A launcher for Pi with the Sailor extension.

```bash
npx sailor-gtm            # first run: connect your LLM + Fiber key, then opens Pi with Sailor
sailor doctor             # checks Node, Pi, Fiber key, Google Sheets, Mosaic hosting, terminal, proxy
sailor login              # (re)connect Fiber
sailor -p "how many heads of RevOps are in the US?" --fiber-max-spend 5   # headless; passes args through to pi
```
