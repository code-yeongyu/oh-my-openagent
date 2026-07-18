# bin/ - Published Launcher Shim

## OVERVIEW

Node-side launch surface for every public CLI alias. The root shim resolves a platform package and spawns its generated `bin/oh-my-opencode.js` launcher payload; it is not the TypeScript CLI implementation.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Main launcher | `oh-my-opencode.js` | Entry for `oh-my-opencode`, `oh-my-openagent`, `omo`, `lazycodex`, and `lazycodex-ai` |
| Platform selection | `platform.js` | OS/arch/libc package candidates and baseline fallback |
| Platform types | `platform.d.ts` | Public declarations for the plain-JS selector |
| Version mismatch output | `version-mismatch.js` | User-facing installed-wrapper/platform-package mismatch diagnostics |
| Behavior tests | `*.test.ts` | Bun tests for invocation routing, platform selection, and diagnostics |

## RUNTIME FLOW

`oh-my-opencode.js` derives the invocation name, optionally routes the LazyCodex Node installer, resolves an ordered list of `oh-my-opencode-*` or `oh-my-openagent-*` platform package candidates, then spawns the first installed package's generated `bin/oh-my-opencode.js` launcher. Each generated Node launcher runs root `dist/cli` with Bun and, when Bun is missing or exits with `SIGILL`, falls back to root `dist/cli-node` with Node. The root shim retains ordered package fallback compatibility, including x64 `-baseline` candidates, but current generated platform payloads are identical Node scripts, so a Bun `SIGILL` is normally handled inside the selected launcher rather than by switching to a baseline package.

## CONVENTIONS

- Keep this surface Node-compatible; the root shim and generated launcher payloads are plain Node scripts.
- Preserve all five aliases. Alias-to-platform-family behavior is shared with `postinstall.mjs` and publish-time package rewrites.
- Keep error output actionable: report the detected platform and the ordered package candidates.
- Tests run from the root with `bun test bin` or as part of `bun test`.

## ANTI-PATTERNS

- Do not import adapter source from `packages/omo-opencode/src/`; this shim must remain usable from the published package layout.
- Do not hard-code one npm package family. `oh-my-opencode` and `oh-my-openagent` wrappers share the launcher.
- Do not edit generated launcher payloads under `packages/oh-my-opencode-*/bin/`; regenerate them through `script/build-binaries.ts`.
- Do not remove baseline fallback without updating platform tests and publish-platform coverage.
