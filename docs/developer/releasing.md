# Releasing

Sailor ships as two npm packages from this monorepo:

| Package | Path | Installs as |
|---|---|---|
| `@sailor/pi-fiber` | `packages/pi-fiber` | `pi install npm:@sailor/pi-fiber` (a Pi package: TypeScript sources, skills, prompts, themes) |
| `sailor-gtm` | `packages/sailor-cli` | `npx sailor-gtm` / `npm i -g sailor-gtm` (the `sailor` command) |

Pi loads the extension's TypeScript directly, so there's no build step: the published `files` are the sources listed in each `package.json`.

## Checklist

**1. Green build**

- [ ] `npm install` from a clean clone
- [ ] `npm run typecheck` (real Pi packages) and `npm test` pass
- [ ] `npm run evals` on at least the primary model and one open-weights model with `SAILOR_TOOLS_PROFILE=lite`, meeting the targets in [testing](testing.md#agent-evals)
- [ ] A sandbox smoke run (`./demo/sandbox-demo.sh`) and a small live run with a tight budget: count → search 5 → reveal 2 → validate → export → `/credits` shows estimated ≈ charged

**2. Versions**

- [ ] Bump `version` in `packages/pi-fiber/package.json`, `packages/sailor-cli/package.json` and the root `package.json`
- [ ] Update the version strings in code: the `userAgent` in `src/extension/runtime.ts` and the version line in `/feedback` (`src/extension/commands/export.ts`)
- [ ] Add a section to [CHANGELOG.md](../../CHANGELOG.md)

**3. Pricing and API drift**

- [ ] Re-check `src/core/fiber/ops.ts` against Fiber's per-operation docs for any operation marked `verified: false`, and update `fetched` dates in the header comment
- [ ] Re-run `./demo/probe-sandbox.sh` and update `SANDBOX_UNSUPPORTED_OPS` if Fiber has sandboxed more operations
- [ ] Check the items in [08_Implementation_Status.md §4](../08_Implementation_Status.md) that are still unverified

**4. Package contents**

```bash
npm pack -w @sailor/pi-fiber --dry-run
npm pack -w sailor-gtm --dry-run
```

- [ ] No test fixtures, `.sailor/`, healed CSVs, `.env` or keys in the tarballs
- [ ] `README.md` and `LICENSE` included in both
- [ ] Install the packed tarball into a clean Pi (`pi install ./sailor-pi-fiber-x.y.z.tgz`) and run `/fiber whoami`

**5. Publish**

```bash
npm publish -w @sailor/pi-fiber --access public
npm publish -w sailor-gtm
```

Then, on a machine without the repo: `npx sailor-gtm doctor`, `npx sailor-gtm` and `pi install npm:@sailor/pi-fiber`.

**6. Afterwards**

- [ ] Tag the commit (`git tag vX.Y.Z && git push --tags`) and create a GitHub release with the changelog section
- [ ] Remove "not yet published" notes from the README and the getting-started guide

## Known pre-release items

- When it can't find a local checkout, the launcher installs `@sailor/pi-fiber` into Pi. It also tries this from a checkout when the run isn't interactive (`-p`, `--mode`) or the Fiber look is off, which fails until the package is published.
- `@fiberai/sdk` and the Pi dev dependencies are pinned to `latest` / `*`. Pin real ranges before 1.0.
- `exceljs` is optional and loaded dynamically; `.xlsx` features need it installed.
