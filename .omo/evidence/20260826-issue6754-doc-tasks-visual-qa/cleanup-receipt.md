# Cleanup receipt - issue 6754 QA

- Sandbox `/tmp/opencode/issue-6754/sandbox` (isolated XDG/HOME/CODEX_HOME tree): REMOVED via `rm -rf`; verified absent (`ls` shows no sandbox dir).
- Contents removed: 3 bun cache `.pile` files created by the QA run (see qa-transcript.log). No other runtime artifacts were spawned: no servers, no tmux sessions, no browser contexts, no bound ports.
- Real user dirs untouched: isolation-before/after logs identical for `~/.omo`, `~/.config/opencode`, `~/.codex`, `~/.cache/opencode`.
- Worktree churn from `bun install` (codegraph dist, install-dist, senpi plugin extensions bundler reordering) was restored via `git checkout --` before gates; final `git status` contains only the nine intended files plus untracked `.omo/evidence/20260826-issue6754-doc-tasks-visual-qa/`.
- `/tmp/opencode/issue-6754/*.log|*.sh|*.ts` scratch artifacts retained as lane evidence copies; they contain no secrets.
