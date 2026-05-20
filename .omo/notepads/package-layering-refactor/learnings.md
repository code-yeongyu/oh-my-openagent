
## [2026-05-20T15:04:52Z] Task 1 baseline
- Total tests: 7315
- Pass: 7312, Fail: 2, Skip: 1
- Build exit code: 0 (dist/ size: 13M, 1456 files)
- Typecheck exit code: 0
- Packages: 15 package.json files under packages/, 3 private (ast-grep-mcp, rules-core, web)
- Anomalies observed: 2 pre-existing test failures in `src/features/opencode-skill-loader/skill-content.test.ts` — ambiguous short name resolution returns 2 resolved skills instead of 1 when "debugging" + "playwright" are queried together. This is a REAL baseline failure; do not fix as part of this refactor plan unless explicitly directed.

## [2026-05-20T15:12:12Z] Task 2 pre-flight
- `src/shared/deep-merge.ts`: pure, zero imports.
- `src/shared/snake-case.ts`: imports `./deep-merge` only (moved together) — pure after extraction.
- `src/shared/record-type-guard.ts`: pure, zero imports.
- `src/shared/extract-semver.ts`: pure, zero imports.
- `src/shared/frontmatter.ts`: imports `js-yaml` only.
- `src/shared/file-utils.ts`: imports `fs` only.
- `src/shared/contains-path.ts`: imports `fs` and `path` only.
- `src/shared/port-utils.ts`: imports `node:net` only.
- `src/shared/tool-name.ts`: pure, zero imports.
- `src/shared/replace-tool-args.ts`: pure, zero imports.
- `src/features/boulder-state/format-duration.ts`: pure, zero imports.
- `src/shared/jsonc-parser.ts`: coupled to plugin basenames; decoupled via parameterized `detectPluginConfigFile(dir, options)`.
- `src/shared/write-file-atomically.ts`: depends on omo-specific `./tolerant-fsync`; extraction deferred by scope decision (kept in-place).

## [2026-05-21T00:00:00Z] Task 7 (worktree)
- Pre-flight import audit (`packages/ast-grep-mcp/src/*.ts`) shows only `mcp.ts`, `runner.ts`, and `cli-binary-path-resolution.ts` touch adapter/runtime-specific concerns.
- Candidate extracted files are pure from MCP perspective:
  - `types.ts`: type-only, currently coupled only by `CliLanguage` source (`CLI_LANGUAGES`).
  - `language-support.ts`: CLI language enum + numeric defaults; no MCP/Bun coupling.
  - `pattern-hints.ts`: pure heuristics; no runtime coupling (intended identical behavior for pi/codex parity).
  - `result-formatter.ts`: pure string formatter over `SgResult`.
  - `sg-compact-json-output.ts`: pure JSON parsing/truncation logic; depends only on constants/types.
- `runner.ts` split requirement confirmed:
  - Core should own `buildSgArgs()` + `runSg()` orchestration and error mapping.
  - OMO-specific binary resolution stays adapter-side (`getAstGrepPath` in `cli-binary-path-resolution.ts`).
  - OMO-specific process spawn stays adapter-side (`bun-spawn-shim.ts`), injected via core deps (`spawnProcess`).
