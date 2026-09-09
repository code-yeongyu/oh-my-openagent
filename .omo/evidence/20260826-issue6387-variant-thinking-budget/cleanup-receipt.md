# Cleanup receipt

Worktree: /home/viprix/projects/oom-wt-6387 (branch fix/6387-variant-thinking-budget)

## Restored (bun install postinstall churn, not part of this change)

- packages/omo-codex/plugin/components/codegraph/dist/cli.js
- packages/omo-codex/plugin/components/codegraph/dist/serve.js
- packages/omo-codex/scripts/install-dist/install-local.mjs
- packages/omo-senpi/plugin/extensions/omo-member.js
- packages/omo-senpi/plugin/extensions/omo-memory-mcp.js
- packages/omo-senpi/plugin/extensions/omo-task.js
- packages/omo-senpi/plugin/extensions/omo.js

Restored via `GIT_MASTER=1 git checkout -- <paths>`; `git status --short` afterwards shows
only the six intended source/test files under packages/omo-opencode/src.

## Not staged, not committed

Per lane mandate: no git add, no commit, no push, no PR. The change lives as uncommitted
working-tree modifications on the lane branch. Evidence dir is gitignored and left on disk
unforced (no `git add -f` needed since nothing is staged).

## Temp artifacts

- /tmp/opencode/issue-6387/qa-variant-budget.ts (QA script)
- /tmp/opencode/issue-6387/debug-junior.ts, debug2.ts, debug3.ts (transient debugging,
  superseded; kept for traceability)
- /tmp/opencode/issue-6387-bun-install.log (install log)
