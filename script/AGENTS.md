# script/ -- Build/Publish Automation

**Generated:** 2026-05-18

## OVERVIEW

Build and publish automation scripts. Run via `bun run <script>` from root package.json. 13 files total (10 source + 3 test). Singular directory name (not "scripts/").

## SCRIPTS

| File | Purpose |
|------|---------|
| `build-binaries.ts` | 11 platform binaries via `bun compile` (darwin/linux/windows, AVX2 + baseline) |
| `build-schema.ts` | Zod schema to JSON Schema for `assets/oh-my-opencode.schema.json` |
| `build-schema-document.ts` | Helper: `createOhMyOpenCodeJsonSchema()` for build-schema.ts |
| `build-model-capabilities.ts` | Refresh `src/generated/model-capabilities.generated.json` from models.dev |
| `patch-node-require-shim.ts` | Patches `dist/index.js` for Node/Electron require compatibility |
| `publish.ts` | Local multi-package publish alternative (platform packages + npm) |
| `generate-changelog.ts` | Release notes from git log, filters bot commits |
| `run-ci-tests.ts` | Test isolation: separates `mock.module()` users from shared tests |

## TESTS

| File | Coverage |
|------|----------|
| `build-binaries.test.ts` | Platform target validation |
| `build-schema.test.ts` | JSON Schema generation |
| `publish-workflow.test.ts` | Publish logic |
| `run-ci-tests.test.ts` | Isolation runner |

## RUN VIA PACKAGE.JSON

- `bun run build:binaries` → build-binaries.ts
- `bun run build:schema` → build-schema.ts
- `bun run build:model-capabilities` → build-model-capabilities.ts

## TSCONFIG

`tsconfig.json` is script-specific (separate from `src/`). Includes only `publish-workflow.test.ts`.

## NOTE

`run-ci-tests.ts` is referenced by `ci.yml` but CI now uses plain `bun test` (no sharding or split isolation runner). The isolation logic remains for local use.
