# QAing the opencode TUI under tmux (Case C)

## Verdict first (be honest)

- tmux CAN launch the opencode TUI and `capture-pane` reads the rendered frame; `send-keys` delivers keystrokes to the composer. This is proven and good for SMOKE checks: did it boot, does it render, does it accept input.
- The TUI is a 60fps full-screen app (built on @opentui/solid) with a custom renderer, animations, and a worker thread. Asserting on conversation OUTPUT by scraping the frame is FRAGILE and not recommended.
- For real behavior assertions prefer: `opencode run` (Case A, references/cli-commands.md), the server API + SSE (Case B, references/server-api.md + events-hooks.md), or the TUI control HTTP API (below). The TUI talks to the same server, so API-level QA is equivalent to driving the screen.

## Safety: isolate so QA never pollutes the real DB

Launching the real TUI would create sessions in the real ~/.local/share/opencode DB. Run it under an isolated XDG sandbox. The bundled `scripts/tui-smoke.sh` does exactly this and verifies the real session count is unchanged before/after.

## Smoke test (bundled)

- `scripts/tui-smoke.sh --self-test` launches the TUI under tmux in an isolated sandbox, polls capture-pane for a render marker (version string / "Ask anything" / footer), sends a sentinel keystroke, then kills the tmux session and confirms the real DB is untouched.

## Manual tmux recipe (fenced) - for ad hoc smoke

```
SESS=oqa_tui_demo
DIR=$(mktemp -d)
tmux new-session -d -s "$SESS" -x 200 -y 50
# isolate XDG so no real session is written
tmux send-keys -t "$SESS" "XDG_DATA_HOME=$DIR/data XDG_CONFIG_HOME=$DIR/cfg XDG_STATE_HOME=$DIR/state XDG_CACHE_HOME=$DIR/cache OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 opencode $DIR" Enter
sleep 7
tmux capture-pane -t "$SESS" -p | sed -n '1,30p'   # inspect the rendered frame
tmux send-keys -t "$SESS" "hello"                    # type into the composer
sleep 1
tmux capture-pane -t "$SESS" -p | sed -n '1,30p'
tmux kill-session -t "$SESS"                          # teardown (kills the TUI)
rm -rf "$DIR"
```

Explain: capture-pane -p prints the visible frame; send-keys injects input; kill-session tears down the process tree. Always teardown and remove the temp dir.

## The reliable alternative: TUI control HTTP API

A running TUI is a client of the local server, so you can drive it over HTTP without scraping the screen:

- POST /tui/append-prompt - append text to the composer
- POST /tui/submit-prompt - submit the composer
- POST /tui/execute-command - run a TUI command
- POST /tui/show-toast - show a toast
- GET /tui/control/next + POST /tui/control/response - the control channel

Use these (with auth + ?directory=) to deterministically drive a TUI you launched, then assert via the event stream (references/events-hooks.md).

## Headless component testing (for source-level TUI tests)

opencode unit-tests TUI components headlessly with @opentui/core/testing `createTestRenderer` (see packages/opencode/test/cli/tui/, e.g. app-lifecycle.test.ts). This is the route for asserting TUI component behavior in the source repo; see references/testing-harness.md.

Bottom line: tmux for smoke, server/SSE or /tui/* control for assertions, createTestRenderer for source unit tests.
