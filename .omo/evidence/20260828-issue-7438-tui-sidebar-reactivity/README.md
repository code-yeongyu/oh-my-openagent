# Issue 7438 TUI sidebar reactivity

## Tested

- Failing-first mounted-root regression: write active and idle mirror
  snapshots, invoke the captured poll callback without sleeps, and inspect the
  same real OpenTUI test-renderer root after each transition.
- All TUI sidebar tests, full typecheck, full build, frozen lock install, and
  an assertion that `dist/tui.js` keeps `solid-js` external.
- OpenCode 1.18.23 under tmux with isolated HOME/XDG paths and the built local
  TUI plugin. The sidebar stayed mounted while snapshots changed.

## Observed

```text
Before fix: expected "runtime-agent"; mounted frame remained on Models.

Sidebar suite: 60 pass, 0 fail, 121 assertions
bun run typecheck: exit 0
bun run build: build: all steps completed
bun install --frozen-lockfile --ignore-scripts: exit 0
TUI_BUNDLE_SOLID_EXTERNAL=PASS

TUI smoke: rendered, accepted send-keys, tore down, real DB unchanged
ACTIVE_TRANSITION=PASS
IDLE_TRANSITION=PASS
ISOLATION=PASS:7933
```

This covers the one-shot slot, mirror polling, Solid reconciliation, built
bundle, real OpenCode plugin loader, and terminal paint surface in both
transition directions. The real database count stayed 7933 before and after.

Temporary paths, control sequences, provider output, configuration contents,
tokens, credentials, prompts, and auth headers were omitted.

## Verification after merging current dev

The branch was merged with `origin/dev` at
`c034b5313d65da3316db3ebf5459b30e75379ae6`. The only content conflict was in
`packages/omo-opencode/src/tui.test.ts`; the resolution keeps both the
mounted-root regression from this change and the newer helper-level regression
from `dev`, with dynamic import ordering preserved for the real OpenTUI Solid
runtime.

```text
Sidebar suite: 61 pass, 0 fail, 123 assertions
bunx bun@1.3.12 run typecheck: exit 0
bunx bun@1.3.12 run build: build: all steps completed

OpenCode TUI smoke: PASS (OpenCode 1.18.25)
ACTIVE_TRANSITION=PASS
IDLE_TRANSITION=PASS
ISOLATION=PASS:7946
```

The rerun again drove the built local TUI plugin in isolated HOME/XDG paths.
The real OpenCode database held 7,946 sessions both before and after.
