# PR #6742 cross-harness QA

## What was tested

- OpenCode's isolated QA harness: `opencode-qa/scripts/lib/common.sh --self-check` and `server-smoke.sh --self-test`.
- OpenCode shared-skill loader scope: `bun test packages/omo-opencode/src/features/opencode-skill-loader/shared-skill-harness-scope.test.ts`.
- Codex's isolated QA harness: `codex-qa/scripts/lib/common.sh --self-check` and `app-server-drive.sh --plugin`.
- Shared frontmatter and Senpi synchronization: `bun test packages/skills-loader-core/src/features/builtin-skills/shared-skill-extraction.test.ts packages/omo-senpi/src/skills-sync.test.ts`.

## What was observed

- OpenCode ran in an isolated XDG sandbox; its server reported healthy, exposed 162 documented paths, and rejected unauthenticated access. The shared-skill loader test passed.
- Codex ran with an isolated `CODEX_HOME` and local mock model. The real `~/.codex/config.toml` hash was unchanged, and plugin `sessionStart`, `userPromptSubmit`, and `stop` hooks completed.
- The metadata and Senpi synchronization suite passed 14 tests. The programming description is 1005 characters and its YAML line is 1020 characters, both within the 1024-character budget.

## Why this is enough

The change is a shared skill's frontmatter routing text. The two harness checks prove isolated runtime startup and Codex's local plugin wiring; the loader and synchronization checks prove the shared skill is consumable and remains inside both enforced metadata budgets.

## Omitted

No real model request was made. Trigger selection is model-driven prose routing, so no deterministic assertion was added for a particular prompt; adding such a wording-pinning test is prohibited by `packages/shared-skills/AGENTS.md`.
