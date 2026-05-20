
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
