# Senpi task TUI stats evidence

## Scope

- Remove cache-hit-rate text from running Senpi task rows.
- Count the outer eval call and nested eval invocations separately.

## RED / GREEN

- RED: `cache-display-red.txt` proves unchanged running rows include cache-hit-rate text.
- GREEN: `cache-display-green.txt` proves focused running-row tests pass without `CH:`.
- RED: `nested-eval-red.txt` proves unchanged accounting reports one instead of three.
- GREEN: `nested-eval-green.txt` proves eval, nested, control, non-eval, and duplicate-end cases pass.

## Real terminal QA

Command:

```sh
node script/qa/web-terminal-visual-qa.mjs \
  --title "Senpi task running status row" \
  --command "bun packages/omo-senpi/scripts/qa/task-stats-renderer.mjs background" \
  --source-label "task-stats-renderer background eval scenario" \
  --cwd "$PWD" --cols 160 --rows 12 --dwell-ms 2500 \
  --evidence-dir .omo/evidence/20260803-senpi-task-tui-stats/terminal
```

Observed running row:

```text
⠋ Background... · category:quick(apitopia/z-ai/glm-5.2-ultrafast-unlocked) · turn 3 (3 tools) · $0.1303 · 42 tok/s · read src/foo.ts · 1m 5s
```

Observed completed row:

```text
task_output Background completion statistics (st_background) completed · category:quick · ran 1m 5s · 3 tools · $0.1303 (CH: 44%) · 42 tok/s
```

PASS:

- `3 tools` comes from one eval plus two nested `details.toolCalls`.
- `$0.1303`, `42 tok/s`, activity, and elapsed time remain visible.
- `CH:` is absent despite the fixture carrying `cache_hit_rate_last: 0.89`.
- `(CH: 44%)` remains present on the completed row from `cache_hit_rate_run: 0.44`.
- `terminal/terminal.png` is a 3248x432 xterm.js browser capture.
- `terminal/terminal.txt` captures the real PTY output.
- `terminal/metadata.json` records `connector: xterm-node-pty` and `browserCapture: captured`.
- `terminal/metadata.json` preserves the evidence schema with `"ansi": null`.

Cleanup receipt:

```text
metadata: pty pid 98365 killed
verification: pty-clean:98365
verification: web-terminal-qa-process-clean
verification: renderer-process-clean
```

## Why this is enough

- Focused RED/GREEN tests prove the accounting and formatting seams independently.
- The deterministic terminal fixture feeds eval result metadata through the production tracker and renders the resulting stats through the actual Senpi task widget renderer.
- The browser-captured xterm.js surface proves the user-visible line, color path, width, and cleanup behavior rather than relying on a string-only unit test.

## Final gates

- Focused stats and TUI tests: PASS.
- `tsgo --noEmit -p packages/senpi-task/tsconfig.json`: PASS.
- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`: PASS.
- `bun run typecheck`: PASS.
- `bun run build`: PASS.
- `bun run test:senpi`: 529 pass, 0 fail across 84 files.
- `git diff --check`: PASS.

## Cubic review response

- Validated every `details.toolCalls` entry before counting it.
- Classified eval controls from `args ?? input`.
- Refreshed the terminal fixture to prove running cache-rate absence and completed cache-rate presence separately.
- Preserved evidence metadata shape with `"ansi": null`.
- Re-ran focused tests, package compilers, repository typecheck/build, and the 529-test Senpi gate.

## LIGHT self-review

1. Single responsibility: each production file keeps one existing responsibility; eval accounting stays in the run-stats tracker and running spend formatting stays in the status-line formatter.
2. Boundary purity: unknown eval results are narrowed at the event boundary before `details.toolCalls` is read; unknown values do not escape into internal logic.
3. Variant discrimination: no new tagged-union switch is partial; widened child events are handled by their existing string discriminator and only the eval action boundary is inspected.
4. Escape hatches: no `any`, ignore directive, non-null assertion, unsafe cast, or warning suppression was added.
5. Defensive layer: record/array checks guard genuinely untrusted tool result metadata, not values already guaranteed by internal types.
6. One-off helpers: new single-use helpers were inlined; the moved spend test retains only its two-use record fixture.
7. Tests: reverting the running-spend or nested-eval production changes reproduces the captured RED failures.

Tier remains LIGHT: the final diff is a localized accounting/rendering change with no new production module, external integration, persistence schema, permissions, or cross-domain refactor.

## Isolation

All implementation and QA run from the task-owned worktree. The user's main checkout remains untouched.

## Omitted material

Raw session transcript content may contain private prompts or provider usage data. Evidence records only the minimum structural facts needed to prove nested eval accounting.
