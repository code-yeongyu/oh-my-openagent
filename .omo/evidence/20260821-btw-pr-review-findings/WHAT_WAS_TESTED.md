# BTW PR Review Follow-up QA

## What was tested

- Deferred `session.list` while the user replaced bare `/btw` with a newer
  composer draft.
- `New BTW` selection after navigation moved away from the picker source.
- Escape presses outside and inside the one-second pair interval using an
  injected clock.
- Real OpenCode 1.18.18 TUI against the task-worktree build, isolated XDG
  directories, and a local fake OpenAI Responses server.
- Mandatory `opencode-qa` tmux TUI smoke, including render, send-keys,
  teardown, and real-database isolation assertions.
- A real Main prompt, one retained BTW side, and two Escape presses 500 ms
  apart.
- Isolated SQLite session metadata and host OpenCode database counts.

## Commands

```text
bun test ./packages/omo-opencode/src/features/btw-side
bun test ./script/web-terminal-visual-qa.test.ts
bun run typecheck
bun run build
node script/qa/web-terminal-visual-qa.mjs [isolated OpenCode command and inputs]
sqlite3 [isolated opencode.db] [session metadata query]
sqlite3 [host opencode.db] "SELECT count(*) FROM session;"
```

## Exact captured output artifacts

- `artifacts/btw-tests/terminal-ansi.txt`
- `artifacts/qa-helper-tests/terminal-ansi.txt`
- `artifacts/typecheck.txt`
- `artifacts/build/terminal-ansi.txt`
- `artifacts/build/terminal.txt`
- `artifacts/sqlite-isolated.json`
- `artifacts/tmux-smoke-host-db.txt`
- `artifacts/tui-esc/terminal.txt`
- `artifacts/tui-esc/terminal-ansi.txt`
- `artifacts/tui-esc/terminal.png`

The TUI helper redacted the task-worktree path before writing the committed
TUI outputs. JUnit hostnames were replaced with `[REDACTED]` while preserving
all 75 BTW and 7 QA-helper test cases. Machine-local metadata was omitted.
