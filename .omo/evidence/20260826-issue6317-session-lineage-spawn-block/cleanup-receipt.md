# Cleanup receipt

- Sandboxed `opencode serve` (pid 182774, port 14917): stopped via SIGTERM; port verified closed.
- Sandbox root `/tmp/opencode/issue-6317/`: retained intentionally as lane QA evidence
  (xdg-data/opencode/opencode.db contains exactly the 2 QA sessions; node_modules symlink into
  worktree removed-safe, points at worktree install).
- Worktree generated-artifact churn caused by `bun install` postinstall (7 files under
  packages/omo-codex + packages/omo-senpi dist/plugin bundles) restored via
  `git checkout --` before gates; final `git status` shows only the 3 intended source files.
- No real user store read or written: no access to ~/.omo, ~/.senpi, ~/.config/opencode,
  ~/.codex, ~/.cache/opencode, or the real opencode.db at any point. All processes ran with
  XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_STATE_HOME/XDG_CACHE_HOME/HOME pointed at
  /tmp/opencode/issue-6317/ subdirs (envelope printed in qa-transcript.log).
- No git commit, no push, no PR (lane mandate).
