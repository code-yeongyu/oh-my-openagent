# Senpi Live Task Status Manual QA

## What was tested

The repository's live xterm command was attempted three ways against the isolated `task-tui-e2e.mjs --scenario active` fixture. That fixture currently hangs the capture harness and its mock child ends with `Connection error`, so it produced no auditable artifacts.

The fallback exercised the exact changed production surface:

```bash
bun .omo/evidence/20260727-senpi-task-live-status/live-status-driver.ts
```

The driver imports `createTaskStatusUi()` and the shipped row formatter, supplies one running background task, leaves parent input idle, and lets the production 250ms timer update the real terminal row.

The real PTY stream was captured with:

```bash
node script/qa/web-terminal-visual-qa.mjs \
  --title "Senpi live task status driver" \
  --command "bun .omo/evidence/20260727-senpi-task-live-status/live-status-driver.ts" \
  --cwd /Users/yeongyu/local-workspaces/omo-wt/fix/senpi-live-task-status \
  --cols 140 --rows 12 --dwell-ms 3500 --no-browser \
  --source-label "actual status UI controller and formatter in a real PTY" \
  --evidence-dir .omo/evidence/20260727-senpi-task-live-status/tui-raw-pty
```

That exact ANSI stream was then rendered through Chrome/xterm.js:

```bash
node script/qa/web-terminal-visual-qa.mjs \
  --title "Senpi live task status" \
  --from-file .omo/evidence/20260727-senpi-task-live-status/tui-raw-pty/terminal-ansi.txt \
  --cols 140 --rows 12 \
  --evidence-dir .omo/evidence/20260727-senpi-task-live-status/tui-web-terminal
```

## What was observed

- The PTY stream contains 8 distinct status rows from the production controller.
- Initial visible state:
  `turn 81 (210 tools) · 40 tok/s · running · 0s`
- Later visible state with no parent input:
  `turn 81 (211 tools) · 41 tok/s · running · 1s`
- Spinner frames changed on each 250ms repaint.
- `tui-check` result: max width `110/140`, no overflow lines, `borderMisaligned: false`.
- Browser/xterm.js screenshot: `tui-web-terminal/terminal.png`
- Browser-rendered text: `tui-web-terminal/terminal.txt`
- Full update stream: `tui-raw-pty/terminal-ansi.txt`
- Capture metadata and cleanup: `tui-raw-pty/metadata.json`, `tui-web-terminal/metadata.json`

Post-rebase refresh:
- Raw PTY evidence was regenerated after rebasing onto current `origin/dev`.
- Xterm.js replay rewrote the screenshot, terminal text, ANSI stream, and metadata with source label `post-rebase replay of actual status UI controller PTY stream`.
- The refreshed screenshot still shows `turn 81 (211 tools) · 41 tok/s · running · 1s`.
- Refreshed `tui-check`: max width `110/140`, no overflow, no border drift.

## Why it is enough

The deterministic RED→GREEN tests prove the scheduler contract and terminal cleanup. The PTY stream proves the production controller actually repaints without parent input, and the xterm.js replay proves the resulting terminal row remains visually aligned at the requested width. Together they cover the behavior that froze in the user's TUI and the main regression risk of a timer that never stops.

## Cleanup receipt

- Raw PTY capture killed PID `61046`.
- Xterm.js replay spawned no PTY.
- Failed direct Senpi fixture process tree was killed.
- Failed sandbox `/private/var/folders/nj/hqfr8ndn5q56cqw7jqgbrck40000gn/T/omo-senpi-qa-aij9gb` was removed.
- No `live-status-driver`, `web-terminal-visual-qa`, `task-tui-e2e`, or matching sandbox process remains.
- Existing unrelated browser listeners on ports 9222 and 51732 were left untouched.

## What was omitted

No secrets, environment dumps, auth headers, or provider credentials were captured.
