# Todo 5 Agents Repair2 Report

## What Changed

- Added a regression test where `<project>/.senpi/agents` is a symlink to an external directory containing `agent/escaped.md`.
- Changed `listMarkdownAgentFiles()` to inspect each configured location root before deriving `agent` and `agents` scan children.
- Extended manual QA to drive both symlinked derived scan roots and symlinked configured roots.

## Adversarial Classes

- Symlink stale-state escape blocked: `loadAgents({ homeDir, projectDir })` refuses `<project>/.senpi/agents -> <external>` before scanning `<project>/.senpi/agents/agent`; `escaped` is not loaded and the read diagnostic names the symlinked configured location.
- Malformed/read diagnostic remains: malformed frontmatter and read diagnostics still appear while valid agents continue loading.
- Dirty worktree/cleanup: cleanup receipt records status and zero-byte evidence check before the atomic commit; a post-commit clean status was run separately.
- Misleading success output via raw artifacts: every command artifact includes an explicit `[exit-code]` trailer.
- Flaky tests avoided by symlink fixture: the regression uses per-test temp dirs and filesystem symlinks, with no timing or polling.
- Open PR branches non-applicable: work stayed on `code-yeongyu/senpi-task-w0-agents`; no push or PR operation was performed.
- OpenCode/Codex harness QA non-applicable: touched `packages/senpi-task` only, not `packages/omo-opencode` or `packages/omo-codex`.

## Evidence

- RED: `.omo/evidence/senpi-task/task-5-agents/repair2-red.txt`
- Focused agents tests: `.omo/evidence/senpi-task/task-5-agents/repair2-green-focused-agents-tests.txt`
- Full package tests: `.omo/evidence/senpi-task/task-5-agents/repair2-full-package-tests.txt`
- Typecheck: `.omo/evidence/senpi-task/task-5-agents/repair2-typecheck.txt`
- Manual QA: `.omo/evidence/senpi-task/task-5-agents/repair2-manual-agents-qa.txt`
- Static guards: `.omo/evidence/senpi-task/task-5-agents/repair2-static-guards.txt`
- No-excuse audit: `.omo/evidence/senpi-task/task-5-agents/repair2-no-excuse.txt`
- LOC audit: `.omo/evidence/senpi-task/task-5-agents/repair2-loc.txt`
