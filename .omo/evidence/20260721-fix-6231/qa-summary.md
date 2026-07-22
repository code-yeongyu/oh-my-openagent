# QA & Evidence — fix(build-binaries) issue #6231

The generated platform launcher (`bin/oh-my-opencode.js`) is written by
`createPlatformLauncherSource()` as an **ES module** (`#!/usr/bin/env node` + `import { spawnSync }`),
but every platform package (`oh-my-openagent-<os>-<arch>` / `oh-my-opencode-<os>-<arch>`) ships a
`package.json` with **no `"type": "module"`**. When a node that does not auto-detect module syntax
loads the `.js` directly (node < 22.7, or with detection disabled — the Windows `bunx`/npm wrapper
path in the report), it parses the file as CommonJS and throws
`SyntaxError: Cannot use import statement outside a module`, so `bunx oh-my-openagent doctor` crashes
before running. Fix: make the tiny bootstrap launcher CommonJS (`require`) so it loads regardless of
node version, `"type"` field, or syntax detection.

## Competing hypotheses / fix-shape options

- **H1 — add `"type": "module"` to the 12 platform `package.json` files.** Matches the reporter's
  wording but touches 12 files, keeps the ESM-`.js`-under-node footgun for any future non-detecting
  node, and leaves the test suite still masking the bug. Rejected (broad, symptom-metadata).
- **H2 — rename the launcher output to `.mjs`.** Forces ESM everywhere, but requires editing 11
  `binary:` entries plus every consumer that references `oh-my-opencode.js` by name. Rejected
  (bigger blast radius, distribution-filename change).
- **H3 — make the launcher CommonJS (`require`) — CHOSEN.** One product change in the single source
  (`createPlatformLauncherSource`) fixes all 12 platforms at once; the launcher has no ESM-only
  features (no top-level await / import.meta), so `require` is a drop-in; same filename, same
  runtime behaviour; loads deterministically under every node (no `"type"` field or detection
  dependency). A `require`-only file has no `import`/`export`, so node's syntax detection classifies
  it as CommonJS on modern node too.
- **Why the tests hid it:** `build-binaries.test.ts` runs the launcher under `process.execPath`
  (= bun during `bun test`, which parses `.js` as ESM), and `build-binaries-launcher.test.ts` wrote
  it as `.mjs` (forces ESM). Neither exercised `.js` under real node. Switching the launcher-test
  fixture to the production `.js` filename makes those tests exercise the real path going forward.

## Changes (product: 3 insertions / 3 deletions, 1 file)

- `script/build-binaries.ts`: `createPlatformLauncherSource()` — the 3 `import { … } from "node:*"`
  lines become `const { … } = require("node:*")`. `state`/filename/behaviour otherwise unchanged.
- `script/build-binaries-launcher.test.ts`: launcher fixture `launcher.mjs` → `launcher.js` (so the
  existing runtime tests exercise the shipped `.js`), plus a focused regression test that loads the
  launcher as `.js` under `node --no-experimental-detect-module` and asserts it parses and reaches
  its own missing-root guard instead of a module `SyntaxError`.

## What was tested / observed

- **RED** `red-6231.txt`: new test fails with `SyntaxError: Cannot use import statement outside a
  module` (5 pass / 1 fail, EXIT=1) on unmodified dev.
- **GREEN** `green-6231.txt`: both build-binaries suites → 16 pass / 0 fail, EXIT=0.
- **Negative control** `negative-control-6231.txt`: product change stashed → the #6231 test fails
  again (SyntaxError), EXIT=1; restored after.
- **Typecheck** `typecheck-6231.txt`: `bun run typecheck` (full monorepo) → EXIT=0.
- **Live surface** `live-driver.mjs` + `live-driver-before.txt` / `live-driver-after.txt`: the REAL
  `createPlatformLauncherSource()` output written as `oh-my-opencode.js` inside a directory whose
  `package.json` omits `"type": "module"` (the shipped platform layout), loaded with
  `node --no-experimental-detect-module`. BEFORE fix: node exit 1, ES-module Warning +
  `SyntaxError`. AFTER fix: node exit 2, reaches `OMO_WRAPPER_PACKAGE_ROOT is required` (parsed and
  ran). Isolated `mktemp` dir, removed by the driver.

## Why this is enough

The unit RED→GREEN pins the exact regression at the launcher generator, the negative control proves
the test is coupled to the fix, and the live driver reproduces the reporter's crash and its
resolution through the real production artifact (the generated `oh-my-opencode.js` in a no-`type`
package) on Windows. The empirical reproduction (`node --no-experimental-detect-module`) faithfully
matches the reporter's CJS-loader stack trace. Full typecheck and both build-binaries suites confirm
no regression.

## Residuals / out of scope

- Platform `package.json` files still omit `"type": "module"`; this is now harmless because the
  launcher is CommonJS. Adding it is unnecessary and would be redundant with this fix.
- Only the launcher bootstrap is converted; the packaged CLI bundles (`dist/cli`, `dist/cli-node`)
  are unaffected — the launcher spawns them as child processes.

## Omitted

No secrets, tokens, or credentials are present. Temp paths in logs are ordinary Windows temp dirs.
