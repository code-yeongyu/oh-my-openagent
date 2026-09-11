# Cleanup receipt

## Sandbox (created for this lane)

- /tmp/opencode/issue-6304/ - QA area: sandbox git repo + sibling worktree, isolated
  HOME/CODEX_HOME/PLUGIN_DATA/OMO_LSP_DAEMON_DIR/XDG state dirs, probe scripts, logs.
  Left in place intentionally as reproducible evidence; contains no secrets. Remove with
  `rm -rf /tmp/opencode/issue-6304` when no longer needed.
- Daemon processes spawned during QA run detached from the sandboxed OMO_LSP_DAEMON_DIR
  only; they idle-shutdown on their own and are bound to the sandbox socket path.

## Real-home incident remediation

- Deleted ~/.codex/codex-lsp/sessions/session-outcwd-{silent,mixed,no-cache,precision}.json
  (contents were exactly {"notConfiguredExtensions":[]}; written by the first test version).
- Removed the then-empty ~/.codex/codex-lsp/sessions directory created by that run.
- Verified after fix: repeated test runs create nothing under ~/.codex/codex-lsp.

## Worktree hygiene

- `git status --porcelain` shows ONLY:
  - M packages/omo-codex/plugin/components/lsp/src/codex-hook.ts
  - ?? packages/omo-codex/plugin/components/lsp/test/codex-hook-outside-cwd.test.ts
- Unrelated tracked bundles that a root `bun install` rebuilt as a side effect
  (codegraph dist, install-dist/install-local.mjs, senpi plugin extension bundles) were
  restored via `git checkout --` before the final gate rounds.
- No commits, no pushes, no PR creation performed by this lane (per mandate).
