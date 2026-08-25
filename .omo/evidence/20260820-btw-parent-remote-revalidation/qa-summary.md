# BTW remote parent revalidation QA

Date: 2026-08-20
Worktree: `fix/btw-parent-remote-revalidation`
OpenCode: 1.18.18
Plugin build: 5.0.0-beta.12 (dev)

## What was tested

### Failing-first parent revalidation

The validator regression keeps the local TUI session store stale while remote
status changes from `exists` to `missing`.

```sh
/tmp/bun-v1.3.12/bun-darwin-aarch64/bun test \
  --cwd packages/omo-opencode \
  src/features/btw-side/tui-parent-validator.test.ts
```

Binary pass condition after the fix: first result `true`, second result
`false`, and two remote status calls.

Artifacts: `red.txt`, `green.txt`, `validation.txt`.

### Complete BTW regression domain

The exact twelve test files changed by merged PR #7058 were run from
`packages/omo-opencode` with pinned Bun 1.3.12. The gate covers the validator,
adoption cache/guard, controller, session bridge, TUI wiring, context
injection, delegation guards, lifecycle/OpenClaw suppression, startup, and TUI
registration.

Observed: 101 pass, 0 fail, 289 expectations across 12 files.

The OpenCode package typecheck, repository typecheck, and pinned production
build also exited 0. See `validation.txt`.

### Production validator driver

The production module was imported and executed with statuses `exists`, then
`missing`.

Observed:

```json
{"first":true,"second":false,"calls":2}
```

### OpenCode QA helpers

```sh
bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check
bash .agents/skills/opencode-qa/scripts/tui-smoke.sh --self-test
node script/qa/web-terminal-visual-qa.mjs --self-test
```

Observed:

- all common dependencies and isolation helpers passed;
- TUI 1.18.18 rendered, accepted keys, and tore down;
- the real DB stayed at 7601 sessions during the helper smoke;
- xterm.js, node-pty, true-color ANSI, and CJK rendering passed.

### Real OpenCode side screen

The xterm.js helper launched the worktree-built `dist/index.js` and
`dist/tui.js` with absolute isolated XDG paths and a local Responses-compatible
mock model. Inputs were driven through the browser terminal:

1. `{Escape}`
2. `Remember ALPHA-CONTEXT-42 and keep working until I ask a side question.`
3. `{Enter}`
4. `/btw what context token is in the main conversation?`
5. `{Enter}`

Binary pass condition: the side route displays the side-only question,
`SIDE-CONTEXT-PROOF`, and the BTW status label.

Observed: PASS.

Artifacts:

- `web-terminal-side-final/terminal.png`
- `web-terminal-side-final/terminal.txt`
- `web-terminal-side-final/terminal-ansi.txt`
- `web-terminal-side-final/metadata.json`
- `mock-output.txt`

The side-screen isolated transcript contains only:

- parent: `Remember ALPHA-CONTEXT-42...`
- side: `what context token is in the main conversation?`
- side: `SIDE-CONTEXT-PROOF`
- parent: `PARENT-CONTINUED`

The hidden parent context and boundary were available to the model
(`SIDE_CONTEXT_OK`) but were not persisted in the side transcript.

### Real OpenCode switch and close

A fresh isolated XDG sandbox repeated the parent and inline `/btw` flow, then
sent these physical browser-terminal keys:

1. `{Ctrl+/}`
2. `{Ctrl+/}`
3. `{Ctrl+C}`

Binary pass condition: terminal history contains the side screen and BTW
status, the final rendered screen is the parent, and the isolated DB contains
only the parent session.

Observed: PASS.

- `web-terminal-full-flow/terminal-ansi.txt` contains
  `SIDE-CONTEXT-PROOF` and `BTW from main ... ctrl+/ switch ... ctrl+c close`.
- `web-terminal-full-flow/terminal.png` renders the parent screen with
  `PARENT-CONTINUED` after the two switches and close.
- `web-terminal-full-flow/metadata.json` records both `Ctrl+/` inputs and the
  physical `Ctrl+C`.
- The isolated DB has one session and its only text parts are the parent
  request and `PARENT-CONTINUED`.

Artifacts:

- `web-terminal-full-flow/terminal.png`
- `web-terminal-full-flow/terminal.txt`
- `web-terminal-full-flow/terminal-ansi.txt`
- `web-terminal-full-flow/metadata.json`

## What was observed

- A newly created side is empty before the controller submits the inline
  question; the controller regression pins that ordering.
- The inline `/btw` question travels through the real TUI prompt.
- The side model receives bounded parent context and the BTW boundary.
- Neither hidden parent context nor side content pollutes the opposite
  transcript.
- The side status label renders in xterm.js.
- Two browser-terminal `Ctrl+/` keys switch away and back.
- Browser-terminal `Ctrl+C` closes and deletes the side.
- Remote parent validation returns `true`, then `false`, with two server calls.
- The real host OpenCode DB count was 7601 before and 7601 after QA.

## Why this is enough

The failing-first unit proof targets the exact post-merge race: stale local
state cannot bypass remote parent confirmation. The production driver proves
the shipped function's observable contract. The 12-file domain gate covers
adjacent session/adoption behavior. Finally, the two real OpenCode xterm.js
scenarios exercise the user-facing prompt, model context, status UI, switch,
close, deletion, and transcript-isolation surfaces using the worktree build.

## Cleanup receipt

- Failed exploratory xterm runs killed PTY pids 54151, 54552, and 54733; they
  are retained only as honest failed artifacts and are not cited as passing QA.
- Passing xterm runs killed PTY pids 55120 and 55845 and closed their Chrome
  sessions, as recorded in each `metadata.json`.
- The mock-model background session was terminated after both passing runs.
- Ports 46731 and 46736 have no listeners (`lsof` returned no rows).
- The real OpenCode DB count is unchanged at 7601.
- Isolated DBs, sanitized terminal captures, and config fixtures are retained
  under this evidence directory for reviewer inspection; no live process or
  host configuration remains.

## What was omitted

No real provider request, token, authorization header, or private credential
was used. The literal `qa-local` value is a non-secret local mock credential.
Raw environment dumps were not captured. Runtime logs were summarized rather
than copied when they were not needed for a binary assertion.
