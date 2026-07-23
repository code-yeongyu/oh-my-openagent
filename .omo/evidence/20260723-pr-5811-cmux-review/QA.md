# PR #5811 cmux eligibility QA

## What was tested

1. Failing-first targeted tests for the cmux-only environment in:
   - `packages/tmux-core/src/tmux-utils.test.ts`
   - `packages/tmux-core/src/tmux-utils/pane-spawn-runner.test.ts`
   - `packages/omo-opencode/src/shared/tmux/tmux-utils.test.ts`
2. The complete affected tmux and manager suites: 37 files, 289 tests.
3. Full repository typecheck and build.
4. Strict TypeScript no-excuse rules on every edited TypeScript file.
5. A production-module driver importing the OpenCode pane-spawn adapter and
   tmux-core eligibility, command-builder, and close paths with `TMUX` absent,
   `TMUX_PANE` present, and `CMUX_SOCKET_PATH` present.
6. An isolated OpenCode HTTP server loading this worktree's built plugin, with
   an SSE probe that observed `session.created`.

## What was observed

- RED: 41 pass, 3 intended failures. The cmux-only predicate returned `false`
  and pane spawn stopped before `split-window`.
- Review round 1 GREEN was rejected because it broadened literal tmux
  eligibility. `c1-green.log` and `c2-regression.log` are marked superseded.
- Review round 2 RED: 25 pass, 3 intended failures against the separate inline
  pane predicate and real manager path.
- Review round 2 GREEN: 33 targeted pass, then 289 affected-scope pass across
  37 files with 662 assertions.
- Typecheck: clean across root, scripts, and all packages.
- Build: completed successfully.
- Strict TypeScript audit: no violations in thirteen edited source/test files.
- Real module surface: eager pane spawn succeeded, then graceful close executed
  both `send-keys C-c` and `kill-pane`.
- OpenCode surface: local plugin configuration was visible through `/config`,
  server health was good, and the event wire delivered `session.created`.
- Isolation: the real OpenCode database stayed at 21,931 sessions before and
  after.
- Final post-review rerun loaded the rebuilt plugin on isolated port 45482,
  created session `ses_070da0fd9ffeDC9YLuxO6nPzgy`, observed
  `session.created`, preserved the same 21,931 real-session count, and removed
  the server, port listener, and temp directory.

## Why it is enough

The RED/GREEN pair proves the exact review blocker changed for the right
reason. The final design keeps literal tmux detection unchanged and scopes cmux
compatibility to inline pane lifecycle only. The broader suites protect
standard tmux, disabled environments,
escaping, spawn, activation, replacement, closing, and polling behavior.
The production-module driver exercises the OpenCode adapter's selected inline
pane predicate and uses the same predicate for tmux-core close. Literal
tmux-core defaults remain unchanged for unsupported window/session operations.
The isolated OpenCode server proves the built local plugin loads and the
lifecycle event that reaches `TmuxSessionManager.onSessionCreated` is present
on the real harness wire.

## What was omitted

Raw server logs and environment dumps were not copied because they can contain
host-specific or authentication-sensitive values. The evidence records only
the local plugin path, public health response, generated isolated session ID,
event type, counts, and cleanup state.

## Cleanup receipt

- Killed isolated OpenCode server session `bash_65`.
- Confirmed TCP port 45481 has no listener.
- Removed `/tmp/omo-pr5811-opencode-qa`.
- Removed temporary `.local-ignore/lsp-pr-5811` symlink.
- Confirmed the real OpenCode session count remained 21,931.
- Killed final isolated server `bash_103`, confirmed TCP 45482 was free, and
  removed `/tmp/omo-pr5811-final-qa`.
