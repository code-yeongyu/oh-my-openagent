# Curated-agent correction: what was tested

## Commands and surfaces

- `tsgo --noEmit -p packages/senpi-task/tsconfig.json`
- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- `bun test packages/senpi-task packages/omo-senpi`
- `bun run test:senpi`
- `bun test packages/omo-opencode/src/shared/markdown-link-audit.test.ts`
- `bun test packages/omo-senpi/plugin/scripts/build-extension.test.mjs`
- `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`
- `TMPDIR=<worktree>/.omo/tmp SENPI_BIN=/opt/homebrew/bin/senpi CURATED_AGENTS_E2E_OUT_DIR=<evidence-dir> node packages/omo-senpi/scripts/qa/curated-agents-e2e.mjs`
- `TMPDIR=<worktree>/.omo/tmp SENPI_BIN=/opt/homebrew/bin/senpi TASK_E2E_OUT_DIR=<evidence-dir> node packages/omo-senpi/scripts/qa/task-e2e.mjs`

The build checker no longer compares mtimes or a hand-maintained source-root list. The build embeds a content digest over the complete Bun metafile input graph, stable relative input paths, build settings, and build script; `--check` regenerates the graph and compares that source digest while independently verifying the checked-in body digest. The regression test asserts that the main graph includes `packages/senpi-task/src/runners/in-process/curated-readonly-bash.ts`, that old output mtimes pass, and that body or source-marker tampering fails.

## Why this is enough

The suite covers every rejected boundary: disablement with an explicit model, unoverrideable in-process execution, shell-free read-only remote research, complete fallback literals, independent live-analysis expectations, transitive bundle freshness, documentation accuracy, and all task evidence files.

## What was omitted

- No real external model request was made.
- No user credential, auth header, raw environment, or full transcript was copied.
- Evidence under `.omo/**` is intentionally uncommitted.
