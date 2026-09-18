# PR 7818 refresh verification (2026-09-16)

## Integration

- HEAD: `4684451a626916b26f04aab5a24bf7834d160302` (unchanged PR head).
- MERGE_HEAD: `776c4668d12976f816cd7c580ac7728e313d0029` (freshly fetched origin/dev).
- Branch: `maintenance/pr7818-refresh-20260916-st01a0aae7`.
- Conflict-free `git -c user.name=MoerAI -c user.email=friendnt@g.skku.edu merge origin/dev --no-commit --no-ff`.
- Both schema assets regenerated from merged source and exactly matched the automatic merge.
- Relative to dev, production changes remain the two generator edits and two generated assets: remove duplicate embedded IDs, allow omitted git_master and profiles while retaining property validation. Two regression files and prior evidence remain intact.
- No commits, pushes, comments, PR changes, common config changes, or edits to other worktrees.

## Commands and observed results

Host tools explicitly selected by PATH: Bun **1.4.0**, Node **v24.18.0**. No fallback.

1. `bun install --frozen-lockfile --ignore-scripts`: pass, 465 packages installed; lockfile unchanged.
2. `bun run build:schema && bun run build:omo-schema`: pass, no new asset drift.
3. `bun test script/build-schema.test.ts script/build-omo-schema.test.ts tests/omo-schema-freshness.test.ts`: **15 pass, 0 fail, 32 assertions**, single run.
4. `bun run typecheck`: pass (root, script and all configured package compiler gates).
5. `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow GIT_CONFIG_VALUE_0=always bun run build`: pass on first execution, all steps completed. The local-submodule permission was command-scoped. Unrelated generated Codex/Senpi build churn was restored from the merge index, not staged.
6. `BUN_BIN=<audited-bun> NODE_BIN=<audited-node> bash .omo/evidence/20260916-pr7818-refresh/replay.sh`: pass. Real Node CLI migration output plus two unified fixtures and a flat fixture accepted by Ajv CLI 5.0.0. Invalid git_master, profiles and unknown property fixtures rejected with exit 1 as required.
7. `bash -n .../replay.sh`: pass. PR-specific `git diff --cached origin/dev --check`: pass before this evidence was staged.

Captured outputs: `install.txt`, `tests.txt`, `typecheck.txt`, `build.txt`, `replay.txt`, `server-smoke.json`. Private worktree/home/temp prefixes are replaced with placeholders; raw logs remain local.

## Real OpenCode and isolation

Reused the audited, unchanged `20260909-6445-input-schema/server-smoke.mjs` driver, copying it and its fixture into a disposable sandbox so old committed captures are not overwritten. Docker image `omo-qa:latest`, image ID `sha256:e40c321a338bacdc02dd643f1b968570b2f5522509c46523b862d05e0bed5ab2`, contains Node v24.18.0, Bun 1.3.12, OpenCode 1.18.4. Container Bun is not used for repository install/test/build; OpenCode is its existing real binary.

Read-only source mount; tmpfs /qa; isolated HOME and all four XDG directories; no host auth/config mounted. Readiness uses the server listening event, not polling or sleeps. Built local plugin loaded successfully: health true and `call_omo_agent` present. Server exited, container removed, temporary sandbox removed. Host DB session count **8104 before / 8104 after**, queried read-only.

## Limitations and deviations

- The first pre-merge plan attempt failed because the executable was a dangling symlink, but the shell continued into the merge. This failure is preserved in `plan.md`. Before publication, the lead wrote a recovery plan, saved all new evidence and the staged tree, aborted only the task-owned merge, and repeated the exact merge in the planned order. After restoring evidence with apply_patch, the staged tree was byte-identical: `264f05c43ce96ef7210a12f4757c41a6dbcd97f5` before and after. The original validation therefore applies to the recovered integration; no claim is made that the first attempt followed the required order.
- LSP diagnostics rejected all four PR TypeScript files as outside the tool's main-checkout boundary. Full root/script/package compiler gates passed; LSP results are unavailable.
- Ajv emits existing unknown `uri` format warnings with the committed replay's `--strict=false`; these warnings are retained, not suppressed. URI-format semantics are not covered by this check.
- No model inference, TUI, full repository test suite, cross-platform run, or new behavioral Codex/Senpi QA: this PR changes generated editor schemas, not those adapters. OpenCode QA proves real plugin/config boot, not editor UI rendering.
- Whole-merge whitespace checking reports pre-existing upstream evidence/generated-file whitespace. The PR-specific diff against origin/dev is clean; unrelated upstream content was not modified.
