# @sailor/pi-fiber

The Sailor Pi package adds Fiber AI to the [Pi](https://github.com/badlogic/pi-mono) agent for sales, GTM and recruiting work. It includes:

- Typed Fiber tools
- An always-on credit meter and a cost guard that estimates and confirms paid calls
- List panes and prospect/company cards
- List repair (Kitchen Sink + Mosaic)
- Google Sheets export
- A Fiber MCP bridge
- GTM skills and prompt templates

```bash
pi install npm:@sailor/pi-fiber     # or: pi -e ./extensions/sailor
pi
/fiber login
```

See the repository README for commands, configuration and design notes. The core (`src/core`, exported as `@sailor/pi-fiber/core`) has no dependencies and works outside Pi.

Requires Node ≥ 22.13 (uses the built-in `node:sqlite`).
