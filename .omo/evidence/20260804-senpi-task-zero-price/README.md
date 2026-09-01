# Senpi task TUI zero-price QA

## What was tested

- Focused RED to GREEN test:
  `bun test packages/senpi-task/src/tools/task/renderers-run-stats.test.ts`
- Package verification:
  `bun test packages/senpi-task`
  and `tsgo --noEmit -p packages/senpi-task/tsconfig.json`
- Generated adapter verification:
  `node packages/omo-senpi/plugin/scripts/build-extension.mjs`
  and the same command with `--check`
- Live Senpi integration:
  `SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/task-e2e.mjs`
- Zero-cost TUI surface:
  `script/qa/web-terminal-visual-qa.mjs` drove a real PTY rendered by xterm.js in Chrome and printed the production `taskResultLines()` row for `cost_usd: 0`.
- Non-zero regression surface:
  the same xterm.js driver rendered `cost_usd: 0.42131`.

## What was observed

- RED: unchanged production output was
  `task completed id:st_00000009 ran:1s tools:0 cost:$0.0000`.
- GREEN: the focused suite passed 7 tests and 20 assertions.
- Zero browser-rendered row:
  `task completed id:st_zero ran:1s tools:0`
  with no `cost:` or `$0`.
- Non-zero browser-rendered row:
  `task completed id:st_paid ran:1s tools:0 cost:$0.4213`.
- Both changed files had no LSP diagnostics.
- Package tests, typecheck, extension build, and generated-output check exited 0.
- CI then caught that the initially committed Senpi bundle was stale because the first local build had resolved workspace packages from the shared checkout. Worktree-local dependencies were installed, the bundle was regenerated, and its `--check` command passed. Details are in `ci-remediation.txt`.
- The isolated live Senpi task driver passed all 11 lifecycle/integration checks, reported `real_senpi_untouched: PASS`, and leaked zero of four spawned PIDs.
- Visual QA cleanup:
  PTY 24979 killed and confirmed absent;
  PTY 27058 killed and confirmed absent.

## Evidence artifacts

- `red.txt`
- `green.txt`
- `verification.txt`
- `live-senpi.txt`
- `ci-remediation.txt`
- `zero/terminal.png`
- `zero/terminal.txt`
- `zero/terminal-ansi.txt`
- `zero/metadata.json`
- `nonzero/terminal.png`
- `nonzero/terminal.txt`
- `nonzero/terminal-ansi.txt`
- `nonzero/metadata.json`

## Why it is enough

The failing test proves the prior task renderer exposed the exact unwanted zero-dollar token. The same seam passes after the one-line change, while the existing non-zero assertion remains green. The xterm.js captures exercise the production task row formatter through a real PTY and browser terminal, proving the user-visible zero and non-zero outputs rather than relying on tests alone. Package and regenerated-adapter checks cover adjacent code risk, and the isolated live Senpi task driver proves the component still works through the actual harness lifecycle.

## Self-review

LIGHT tier still holds: the diff changes one existing presentation condition and adds one focused regression case. It does not alter price calculation, persistence, task execution, status-line spend, task-output prose, or non-zero formatting. No drive-by refactor was introduced.

## What was omitted

No provider credentials, environment dumps, auth headers, model responses, private session data, or host logs were captured. The QA fixtures use synthetic task IDs and spend values.
