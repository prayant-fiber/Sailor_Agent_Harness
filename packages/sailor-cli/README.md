# sailor-gtm (the `sailor` command)

A small launcher for [Pi](https://github.com/badlogic/pi-mono) with the Sailor extension: first-run onboarding, a health check, and the Fiber look. Everything else is passed straight to `pi`.

```bash
npx sailor-gtm             # first run: connect your Fiber key, then opens Pi with Sailor
sailor login               # enter or rotate your Fiber key (validated, stored in the OS keychain)
sailor doctor              # check Node, Pi, the extension, Fiber key, Google, Mosaic hosting, keychain, terminal, proxy
sailor -p "how many heads of RevOps are in the US?" --fiber-max-spend 5   # headless; args go to pi
```

What it does on start:

1. If you have no Fiber key yet (and the session is interactive), asks for one, validates it with Fiber's free credits call and stores it in the OS keychain (or `~/.sailor/credentials.json`, mode 0600).
2. Offers to install Pi (`@earendil-works/pi-coding-agent`) if it's missing.
3. Starts `pi` with the Sailor extension: the local checkout when run from the repo, otherwise the installed `@sailor/pi-fiber` package.
4. Applies the `fiber-dark` / `fiber-light` theme unless you chose another (`SAILOR_LOOK=pi` or `/look pi` turns the Fiber look off).

From a checkout without installing: `npm run sailor -- <args>` or `node packages/sailor-cli/bin/sailor.mjs <args>`. To get a global `sailor` command from a checkout: `npm link -w sailor-gtm`.

Plain JavaScript with no dependencies; needs Node ≥ 22.13.

Docs: [getting started](https://github.com/prayant-fiber/Sailor_Agent_Harness/blob/main/docs/guide/getting-started.md) · [commands](https://github.com/prayant-fiber/Sailor_Agent_Harness/blob/main/docs/guide/commands.md#the-sailor-launcher).
