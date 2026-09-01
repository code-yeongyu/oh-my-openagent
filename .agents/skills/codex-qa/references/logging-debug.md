# Observing Codex at runtime (logs + debug surfaces)

The intent "use `/debugging` to watch logs while QAing" maps to the surfaces
below. Codex has **no `/debugging` command**; these are the real ways to observe
a run.

## 1. The notification stream (best signal for plugin QA)

When you drive via the app-server, the stdout stream IS the live trace:
`hook/started` / `hook/completed`, `item/*`, `mcpServer/*`, `error`, `warning`.
This is structured and assertion-grade — prefer it over scraping text logs.
`scripts/app-server-drive.sh` captures it; the JSON summary it prints is the
evidence.

## 2. app-server stderr (`RUST_LOG`)

The app-server writes tracing logs to **stderr** (not a file), filtered by
`RUST_LOG` (`app-server/src/lib.rs:638-651`). Turn it up and capture:

```bash
RUST_LOG=info   # or debug
LOG_FORMAT=json # optional: machine-parseable lines
```

The driver inherits the env; raise `RUST_LOG` before invoking it to see the
plugin/hook subprocess accounting on stderr (surfaced in the summary's
`stderrTail`).

## 3. The logs SQLite DB

The app-server also writes structured logs to a SQLite DB under `$CODEX_HOME`
(alongside `state_5.sqlite`). Query it post-run for a durable record:

```bash
ls "$CODEX_HOME"/*.sqlite
```

## 4. TUI `/debug-config`

Inside the TUI, the slash command is **`/debug-config`** (NOT `/debugging`) —
"show config layers and requirement sources" (`tui/src/slash_command.rs:107`).
Useful to confirm which config layer enabled the plugin. Drive it under tmux:

```bash
tmux send-keys -t <sess> "/debug-config" Enter
tmux capture-pane -t <sess> -p -S -
```

For TUI visual QA evidence, render the live TUI through the real xterm.js web
terminal instead of scraping the tmux pane (`tmux capture-pane` degrades color
and CJK width):

```bash
node script/qa/web-terminal-visual-qa.mjs --title "Codex TUI /debug-config" \
  --command "codex" --input "/debug-config" --input "{Enter}" \
  --evidence-dir .omo/evidence/<slug>/codex-debug-config-web-terminal
```

Attach the resulting `terminal.png` and keep `metadata.json` with the cleanup
receipt. The tmux pane above proves the config text; this PNG proves the visual
TUI surface in true color.

## 5. `codex debug` subcommands

`codex debug models` (raw model catalog), `codex debug prompt-input` (the
model-visible prompt list), and `codex debug app-server …` (a built-in
app-server driver). Run them against the isolated `CODEX_HOME` for ad-hoc
inspection.

## Component-level logs

`rules` emits phase/timing lines to stderr under `NODE_DEBUG=codex-rules`. Most
components prove themselves through their stdout `additionalContext` or a disk
artifact — see [components-hooks.md](./components-hooks.md).
