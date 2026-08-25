# Memory pressure line QA evidence

Date: 2026-08-18
Branch: `feat/memory-pressure-line`

## Problem

The committed `system/**/*.md` token estimate was visible only through the UI advisory at `compile_warn_tokens`. The agent received no earlier signal in model context and therefore could not self-trim before the advisory fired.

## Design exercised

- Soft threshold: `floor(0.8 * compile_warn_tokens)`.
- Estimate source: committed HEAD, UTF-8 bytes divided by four, using the same `estimateSystemTokens` implementation as the existing status advisory.
- Projection behavior: memory content remains intact; one additive line is inserted into `<memory_metadata>` only at or above the soft threshold.
- Configuration: the existing resolved `compile_warn_tokens` value is read by the real prompt wiring; no setting was added.

## TDD RED

Command:

```sh
bun test packages/omo-senpi/src/components/memory/prompt.test.ts packages/omo-senpi/src/components/memory/wiring.test.ts
```

Captured in `red-tests.txt`. The new tests failed before implementation because the pressure metadata export and behavior did not exist:

```text
SyntaxError: Export named 'MEMORY_PRESSURE_METADATA_TOKEN' not found .../prompt.ts
0 pass
2 fail
```

The second suite also exposed the incomplete worktree dependency layout after frozen install failed; that was an environment issue, not a product failure.

## GREEN

Command:

```sh
bun test \
  packages/omo-senpi/src/components/memory/prompt.test.ts \
  packages/omo-senpi/src/components/memory/status.test.ts \
  packages/omo-senpi/src/components/memory/wiring.test.ts \
  packages/omo-senpi/src/components/memory/compaction-survival.test.ts
```

Captured in `green-tests.txt`:

```text
51 pass
0 fail
161 expect() calls
Ran 51 tests across 4 files.
```

The covered acceptance cases include:

- below threshold: exact pre-feature prompt bytes are pinned;
- exact boundary: `floor(0.8 * 30000) = 24000`, with one `24000/30000` and `80%` line;
- above threshold through real wiring: a committed repo change refreshes the next compile to `100/100` and `100%`;
- no truncation: large committed persona content remains present;
- existing status advisory and compaction-survival behavior remain green.

## Typecheck

Command:

```sh
cd packages/omo-senpi
npx tsgo --noEmit -p tsconfig.json
```

Captured in `tsgo.txt`; the file is empty because the command completed successfully with no diagnostics.

## Bundle freshness

The first CI pass caught the expected committed-plugin drift after changing prompt source:

```text
omo-senpi extension build is not current: stale-output
output=.../packages/omo-senpi/plugin/extensions/omo.js
```

The extension artifacts were regenerated under Linux (`oven/bun:1.3.14`) because the committed source digest is intentionally platform-sensitive and CI validates Linux. The exact CI freshness command was then rerun in a fresh Linux container. Output is captured in `bundle-check.txt` and ends with:

```text
omo-senpi extension build is current: .../packages/omo-senpi/plugin/extensions/omo.js
```

## Dependency setup

`bun install --frozen-lockfile` failed before package installation because Bun attempted to migrate `package-lock.json`, then rejected the resulting lockfile change under frozen mode. Following the task fallback, `node_modules` was symlinked from the main checkout at the workspace root and for packages required by the affected test/typecheck graph (`omo-senpi`, `omo-config-core`, and `senpi-task`). These symlinks are local-only and are not committed.
