# Atlas Memory Leak Verification

## Failing-first proof

`bun test packages/omo-opencode/src/hooks/atlas/index.test.ts --test-name-pattern "releases Atlas-owned state on disposal"`

Before the implementation, this failed because `createAtlasHook()` did not expose `dispose`.

## Passing checks

`bun test packages/omo-opencode/src/hooks/atlas/index.test.ts packages/omo-opencode/src/hooks/atlas/atlas-lifecycle-store.test.ts packages/omo-opencode/src/plugin-dispose.test.ts`

Observed: 79 passing tests and 130 assertions.

`bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`

Observed: exit status 0.

## Manual hook-surface QA

`opencode serve --pure --port 47891` was launched with every XDG path under a `mktemp` sandbox. A Node `fetch` observed `200 {"healthy":true,"version":"1.18.22"}` from `/global/health`; the process was terminated and the sandbox removed. This proves isolated OpenCode server startup but does not prove an Atlas event because the pure server intentionally loaded no plugin.

## Diagnostics

The configured LSP daemon was unavailable at `/home/viprix/.omo/lsp-daemon/v0.1.0/daemon.sock`; package typechecking is the available static diagnostic result.
