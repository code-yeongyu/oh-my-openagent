# bin/ - Published Launcher Shim

## OVERVIEW

Node-side launch surface for every public CLI alias. It resolves the platform package, handles baseline fallback, and starts the compiled binary; it is not the TypeScript CLI implementation.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Main launcher | `oh-my-opencode.js` | Entry for `oh-my-opencode`, `oh-my-openagent`, `omo`, `lazycodex`, and `lazycodex-ai` |
| Platform selection | `platform.js` | OS/arch/libc package candidates and baseline fallback |
| Platform types | `platform.d.ts` | Public declarations for the plain-JS selector |
| Version mismatch output | `version-mismatch.js` | User-facing installed-wrapper/platform-package mismatch diagnostics |
| Behavior tests | `*.test.ts` | Bun tests for invocation routing, platform selection, and diagnostics |

## RUNTIME FLOW

`oh-my-opencode.js` derives the invocation name, optionally routes the LazyCodex Node installer, resolves the matching `oh-my-opencode-*` or `oh-my-openagent-*` optional dependency, then spawns its `bin/oh-my-opencode` payload. On x64 it can fall back from the optimized package to `-baseline` after `SIGILL`.

## CONVENTIONS

- Keep this surface Node-compatible; users execute it before the Bun-compiled binary is available.
- Preserve all five aliases. Alias-to-platform-family behavior is shared with `postinstall.mjs` and publish-time package rewrites.
- Keep error output actionable: report the detected platform and the ordered package candidates.
- Tests run from the root with `bun test bin` or as part of `bun test`.

## ANTI-PATTERNS

- Do not import adapter source from `packages/omo-opencode/src/`; this shim must remain usable from the published package layout.
- Do not hard-code one npm package family. `oh-my-opencode` and `oh-my-openagent` wrappers share the launcher.
- Do not edit compiled binaries under `packages/oh-my-opencode-*/bin/`; build them through `script/build-binaries.ts`.
- Do not remove baseline fallback without updating platform tests and publish-platform coverage.
