# Fix 4163 Ultrawork Notepad

## Bootstrap

- Tier: HEAVY.
- Justification: The change targets session continuation and background-task race behavior.
- Worktree: `/Users/yeongyu/local-workspaces/omo/.local-ignore/pr-worktrees/fix-4163`.
- Branch: expected `sisyphus-bot/fix-4163`.

## Skills

- `work-with-pr`: required because the deliverable is a PR merged or auto-merge armed against `dev`.
- `opencode-qa`: required because the change touches OpenCode plugin hook behavior.
- `omo-programming`: required for TypeScript source and test edits.
- `commit` and `git-master`: required for atomic commits and safe branch/PR git operations.
- `review-work`: required as a blocking post-implementation HEAVY review gate.

## Success Criteria

1. Failing-first proof confirms the race on current dev: active children false, pending parent wake true, incomplete todos, and the enforcer must not inject.
2. Minimal fix strengthens existing gates only, with no new `session.prompt` or `session.promptAsync` route.
3. Required tests pass: todo-continuation-enforcer suite, prompt async route audit, and typecheck.
4. OpenCode QA evidence is captured under this directory, or a documented deterministic-race justification explains why a live repro is impractical.
5. A reviewer-readable PR targeting `dev` is pushed and auto-merge is enabled with merge commit semantics.

## Evidence Index

- Setup rerun with `PATH="$HOME/.bun/bin:$PATH" bash script/agent/setup.sh`: passed after initial PATH-only `bun` lookup failure.
