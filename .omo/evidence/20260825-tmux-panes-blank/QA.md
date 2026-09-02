# Issue #3280 - blank tmux subagent panes

## Root cause

`buildTmuxAttachCommand()` (packages/tmux-core/src/tmux-utils/pane-command.ts) emitted a ONE-SHOT
`/bin/sh -c "opencode attach <url> --session <id> --dir <dir>"`. The tmux-subagent lifecycle spawns an
inert placeholder pane first and swaps it into this attach command via `respawn-pane -k` on activation
(pane-activate.ts). If the single attach attempt fails (transient server-URL/port mismatch, slow server
start - the `--port 3000` workaround in the issue comments), the one-shot shell exits, the pane process
dies, and the user sees a permanently blank/stale pane while the task runs elsewhere.

## Fix

Wrap the attach in a survival retry loop inside the same pane command:

```
while :; do opencode attach ...; code=$?; case $code in 0|130|143) exit $code;; esac;
printf '%s\n' "OMO attach failed (exit $code); retrying in 2s..."; sleep 2; done
```

- Exit codes 0 (success), 130 (SIGINT), 143 (SIGTERM) terminate the loop: a user quitting attach must
  not be resurrected.
- Any other exit code prints a visible diagnostic line and retries after 2s, so the pane never dies blank.
- `$`, backslash, backtick, double-quote payloads are escaped for the outer double-quoted `/bin/sh -c`
  context (`escapeForOuterDoubleQuotes`); intentional inner expansions like `$code` survive verbatim.

## Files changed

- packages/tmux-core/src/tmux-utils/pane-command.ts - retry-loop attach command
- packages/tmux-core/src/tmux-utils/pane-command.test.ts - co-located regression tests
- packages/tmux-core/src/tmux-utils/pane-auth-env.test.ts - exact-payload expectation updated to new command
- packages/omo-opencode/src/shared/tmux/tmux-utils/pane-command.test.ts - mirror-shim test parity

The omo-opencode `pane-command.ts` is a pure re-export shim of `@oh-my-opencode/tmux-core`; team-mode
(`team-core/layout.ts`) builds its own send-keys attach string and is intentionally untouched.

## What was tested / observed

- New failing-first regression tests (given/when/then):
  1. inspection: generated payload contains the survival loop, user-exit code gate, retry message.
     Fails against old one-shot builder (no `while :; do`).
  2. behavioral: fake `opencode` bin fails twice then succeeds -> exactly 3 invocations, exit 0,
     correct attach args. Fails against old builder (1 invocation, exit 1).
  3. behavioral: fake bin exits 130 immediately -> loop exits 130 with exactly 1 invocation (no
     resurrection of user quit). Old builder also exits 130 but has no gate; new test pins the gate.
- Scoped suites: 22/22 pass (both pane-command files); full scoped run
  `bun test packages/tmux-core packages/omo-opencode/src/shared/tmux packages/omo-opencode/src/features/tmux-subagent`
  = 361 pass / 0 fail. Artifacts: scoped-tests.txt, tmux-suites.txt.
- Typecheck: `bunx tsgo --noEmit -p packages/tmux-core/tsconfig.json` clean;
  `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` clean.

## Why this is enough

The unit seam IS the production surface here: tmux executes the generated string verbatim via
`respawn-pane -k`, and the behavioral tests execute that exact string through `/bin/sh` with a counting
fake binary, proving end-to-end retry + arg integrity + quoting under real shell parsing (including the
metacharacter-injection guards already pinned by existing tests, which still pass).

## Omitted / not covered

- No live multi-minute tmux session was driven (network-restricted env; behavioral tests substitute a
  real shell + fake binary for the `opencode` CLI). Residual risk: retry cadence feel (2s) is a product
  choice, not asserted against UX.
- Submodule pointer drift under packages/shared-skills/upstreams/* present in the worktree is unrelated
  build noise and is NOT part of this change.
