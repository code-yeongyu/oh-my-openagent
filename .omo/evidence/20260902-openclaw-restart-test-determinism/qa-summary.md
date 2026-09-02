# OpenClaw restart test determinism QA

## Scope

The only code change is in `packages/openclaw-core/src/__tests__/reply-listener-restart-persisted-config.test.ts`. The test now transforms the pending daemon state into its ready state synchronously inside the spawn mock. `startReplyListener()` writes that pending state synchronously before calling the mock, so the mock observes its real production boundary. No production file changed.

## Failing-first evidence

GitHub Actions run [33580607971](https://github.com/code-yeongyu/oh-my-openagent/actions/runs/33580607971), `dev` push `e719373053473d29ae0513b7b54159fede377395`, failed in `test (windows-latest, 2/2)`.

Observed failing test output:

```text
(fail) startReplyListener > restarts an already running daemon when persisted reply-listener config is stale [1283.41ms]
```

The original mock started readiness with `setTimeout(..., 5)` and recursively scheduled another timer while the pending state file was absent. The production path creates and writes that file before the synchronous spawn call, so the timer is unnecessary and made the test depend on scheduler timing.

## Automated verification

### Focused regression

**What was tested:**

```text
bun test packages/openclaw-core/src/__tests__/reply-listener-restart-persisted-config.test.ts
```

**Observed:** exit 0.

```text
1 pass
0 fail
6 expect() calls
Ran 1 test across 1 file. [3.16s]
```

The restart test passed in 12.73 ms. Its existing assertions remain intact: restart success, exactly one spawn, SIGTERM of the prior daemon, and the three persisted-config checks.

### Package suite

**What was tested:**

```text
bun test packages/openclaw-core
```

**Observed:** exit 0.

```text
68 pass
0 fail
156 expect() calls
Ran 68 tests across 15 files. [5.78s]
```

The changed stale persisted-config test passed in 1.58 ms. The related runtime-signature restart, startup, timeout, state, daemon-resolution, and daemon-process tests also passed.

### Scoped typecheck

**What was tested:**

```text
bunx --no-install tsgo --noEmit -p packages/openclaw-core/tsconfig.json
```

**Observed:** exit 0 with no diagnostics.

### Isolated OpenCode real-harness smoke

**What was tested:**

```text
bash .agents/skills/opencode-qa/scripts/tui-smoke.sh --self-test
```

**Observed:** exit 0.

```text
PASS: TUI rendered under tmux (marker found; version 1.18.26)
PASS: send-keys reached the TUI composer (sentinel echoed)
PASS: tmux session torn down (has-session false)
PASS: real DB untouched (session count 8046 unchanged)
PASS: tui-smoke
```

This drives the installed OpenCode TUI through tmux. The skill creates an isolated XDG sandbox and proved the real OpenCode database session count was unchanged before and after the smoke.

## Why this is sufficient

The focused test now drives readiness at the exact synchronous state-write/spawn boundary that production guarantees. It retains every restart and persistence assertion. The complete core-package suite covers adjacent reply-listener behavior, scoped typecheck covers the changed TypeScript package, and the isolated real-harness smoke confirms the consuming OpenCode surface boots, accepts input, cleans up, and preserves the host database.

## Environment notes and omissions

The worktree initially had no `node_modules`; the first focused and package commands could not resolve `@oh-my-opencode/rules-engine`, and `tsgo` was absent from `PATH`. `bun install --frozen-lockfile` materialized the workspace dependencies but its lifecycle build stopped when inherited local submodule URLs were blocked by Git file-transport policy. No tracked source or lockfile changed. The final test and typecheck commands above used the installed workspace dependencies and passed.

No credential, token, auth-header, environment-variable, or raw database content was recorded.
