# Issue 5928 QA Evidence

## What Was Tested

- Regression test for `tool-execute-before-handler`: Bash `PreToolUse` receives the active command cwd when provided in tool input.
- Regression test for tracked worktree fallback: Bash `PreToolUse` receives the boulder session `worktree_path` when tool input has no explicit cwd.
- Claude hook test folder: `packages/omo-opencode/src/hooks/claude-code-hooks`.
- Repository typecheck: `bun run typecheck`.
- Static diff whitespace check: `git diff --check`.
- Mandatory `opencode-qa` harness preflight: `.agents/skills/opencode-qa/scripts/lib/common.sh --self-check`.

## What Was Observed

- Red regression before the fix: the new explicit-cwd test expected `/active-worktree` but received `/session-repo`.
- Red regression before the boulder fallback: the new tracked-worktree test showed `getWorkForSession` was not called.
- Green focused handler test: `4 pass`, `0 fail`, `8 expect() calls`.
- Green Claude hook folder: `114 pass`, `0 fail`, `257 expect() calls`.
- Green typecheck: `bun run typecheck` exited `0`.
- Green static diff check: `git diff --check` exited `0`.
- `opencode-qa` live harness could not run on this host because `jq` and `tmux` are missing; the self-check output is captured in `opencode-qa-self-check.txt`.

## Why It Is Enough

The bug is in the OpenCode `tool.execute.before` handler's construction of `PreToolUseContext.cwd`. The focused regression tests assert the two cwd sources this handler can know about before hook dispatch: explicit Bash tool cwd and tracked session worktree. The broader Claude hook suite verifies the pre/post hook pipeline still behaves as expected, and typecheck covers the new boulder-state import.

## What Was Omitted

Live isolated OpenCode SSE/TUI QA was omitted because this Windows host lacks `jq` and `tmux`, and the `opencode-qa` harness self-check fails before it can safely spawn OpenCode. No secret-bearing logs or environment dumps were copied.
