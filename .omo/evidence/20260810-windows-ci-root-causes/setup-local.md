# Local worktree setup

## What was tested

```bash
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/fix/windows-ci-root-causes
script/agent/setup.sh
```

## What was observed

```text
[setup] WARN: Bun 1.4.0 differs from CI-pinned 1.3.12
[setup] WARN: Node major 26 differs from CI-pinned 24
build:codex-plugin
build:senpi-plugin
build: all steps completed
SETUP_DONE exit=0
```

The build regenerated `packages/omo-senpi/plugin/extensions/omo.js` with unrelated local-Bun minifier churn. After user approval, only that generated drift was discarded:

```bash
git -C /Volumes/mengmotaStorage/local-workspaces/omo-wt/fix/windows-ci-root-causes restore --source=HEAD -- packages/omo-senpi/plugin/extensions/omo.js
```

Post-cleanup `git status --short --branch`:

```text
## fix/windows-ci-root-causes...origin/dev
```

## Why this is enough

The repository setup and full local build completed with exit 0 in the isolated worktree. The authoritative Windows proof will still run on CI-pinned Bun 1.3.12 and Node 24.

## Cleanup receipt

Monitor `bash_82` exited 0. No setup process remains. The shared checkout retained only its pre-existing untracked `.worktrees/` entry.
