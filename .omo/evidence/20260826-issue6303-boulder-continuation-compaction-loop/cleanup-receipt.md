# Cleanup receipt

Date: 2026-08-26

## Sandbox cleanup

- `/tmp/omo-qa-sandbox.ukdkmo` (QA run sandbox): removed.
- `/tmp/omo-qa-sandbox.a8JQJk` (first, unused sourcing of qa-sandbox.sh; a command
  timeout aborted the block before opencode was spawned): removed.
- `/tmp/opencode/issue-6303/`: retained as the QA working directory per lane mandate
  (contains count-sessions.ts, opencode-run-output.txt, stat snapshots); contains no
  credentials.

## Host pollution check

- Real `~/.local/share/opencode/opencode.db`: not written by the QA spawn (sandbox
  XDG_DATA_HOME active for the spawned process; see qa-transcript.md isolation proof).
  The file's size/mtime changed during the window due to the host's own concurrently
  running opencode sessions, unrelated to this QA.
- No reads/writes to real `~/.omo`, `~/.senpi`, `~/.config/opencode`, `~/.codex`,
  `~/.cache/opencode` by any QA step.
- Build artifacts: `bun run build` regenerated `dist/` and vendored plugin dist files
  inside the worktree; tracked-file churn from the install/build step
  (packages/omo-codex/...dist, packages/omo-senpi/plugin/extensions/*) was restored via
  `git checkout --` before final tree state. `git status` shows only intended source
  changes plus untracked new source/test/evidence files.
