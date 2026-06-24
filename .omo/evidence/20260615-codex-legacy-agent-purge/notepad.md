# Codex Legacy Agent Purge Notepad

## Bootstrap
- Skills surveyed:
  - `programming`: required for TypeScript installer/test changes.
  - `remove-ai-slops`: requested discipline; use as bounded post-change slop/self-review on changed files.
  - `git-master`: required for status/diff-first workflow and atomic commit.
- Tier: HEAVY. Justification: installer cleanup can delete files under `CODEX_HOME/agents`, so the change touches permissions/destructive behavior and user explicitly requires strict verification.
- Worktree: `<WORKTREE>`
- Initial status: clean (`git status --short` empty).
- Branch: `fix/lazycodex-final-gate-followup`, upstream `origin/dev`.

## Success Criteria
- Deliverable: one atomic commit implementing safe purge of retired managed legacy `codex-ultrawork-reviewer.toml` during Codex install.
- Criterion 1: installer removes `[agents.codex-ultrawork-reviewer]` config and deletes only the known managed legacy agent file when its contents prove it is managed.
- Criterion 2: arbitrary/user TOMLs under `CODEX_HOME/agents` remain untouched, including a custom `codex-ultrawork-reviewer.toml` content variant.
- Criterion 3: focused install tests and feasible Codex gate pass, with exact commands and outputs captured under this evidence directory.

## Real-Surface Scenario
- Tool/invocation: `CODEX_HOME="$(mktemp -d)/codex" node packages/omo-codex/scripts/install-local.mjs install`, then inspect `$CODEX_HOME/config.toml` and `$CODEX_HOME/agents`.
- PASS observable: legacy config block absent, managed legacy TOML absent, unrelated/custom TOML preserved.

## Findings
- Existing config cleanup already removes `[agents.codex-ultrawork-reviewer]` when it points at `./agents/codex-ultrawork-reviewer.toml`.
- Missing behavior was durable file cleanup: the retired `CODEX_HOME/agents/codex-ultrawork-reviewer.toml` remained after install.
- Managed-proof guard uses retired reviewer content markers (`name`, strict reviewer description, and developer instructions opener) before deleting the filename.
- Same-name custom TOML without those markers is preserved.
- Inherited size smell: `packages/omo-codex/src/install/link-cached-plugin-agents.ts` is 262 pure LOC after the narrow edit. A proper split would be `agent-preservation.ts` for reasoning/service-tier capture and `retired-agent-purge.ts` for cleanup, but I did not broaden this deletion fix into a refactor.

## Evidence Log
- RED: `bun test packages/omo-codex/src/install/install-codex.test.ts --test-name-pattern 'retired managed reviewer'` captured in `red-focused-install-test.txt`; failed because the legacy TOML still existed.
- GREEN focused: `bun test packages/omo-codex/src/install/install-codex-legacy-agent-purge.test.ts` captured in `green-focused-install-test.txt`; 2 pass.
- Generated installer: `bun run build:codex-install` captured in `build-codex-install.txt`; pass.
- Real surface: isolated `CODEX_HOME` install through `node packages/omo-codex/scripts/install-local.mjs install --repo-root="$PWD"` captured in `real-surface-install-local.txt`; PASS, real `~/.codex/config.toml` hash unchanged.
- Focused regression: `bun test packages/omo-codex/src/install/install-codex-legacy-agent-purge.test.ts packages/omo-codex/src/install/link-cached-plugin-agents.test.ts` captured in `focused-install-and-agent-tests.txt`; 15 pass.
- Codex gate: `bun run test:codex` captured in `test-codex.txt`; pass.
- No-excuse: `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/omo-codex/src/install/link-cached-plugin-agents.ts packages/omo-codex/src/install/install-codex-legacy-agent-purge.test.ts` captured in `no-excuse-check.txt`; no violations.
- LSP diagnostics: no diagnostics for `link-cached-plugin-agents.ts` or `install-codex-legacy-agent-purge.test.ts`.
- Cleanup: manual QA temp root removed; receipt in `cleanup-receipt.txt`.

## Self Review
- Single responsibility: new test file owns legacy agent purge behavior; production addition is a focused retired-agent cleanup inside existing agent file management.
- Boundary purity: content deletion is guarded by file content markers, not filename alone.
- Escape hatches: no `as any`, `@ts-ignore`, `@ts-expect-error`, non-null assertion, or empty catch introduced.
- Defensive layer: filesystem existence checks are boundary checks around user-controlled `CODEX_HOME/agents`.
- Tests: RED/GREEN focused test, same-name custom preservation test, real generated installer scenario, and full Codex gate passed.
- Reviewer note: no multi-agent reviewer tool is available in this Codex tool surface; performed strict self-review plus no-excuse, LSP, focused tests, real-surface QA, and `bun run test:codex`.

## Final Anti-Slop Follow-Up
- Request: split retired managed-agent purge responsibility out of `link-cached-plugin-agents.ts`, keep behavior unchanged, remove trailing whitespace, and commit atomically.
- RED structural proof: `red-anti-slop-split-check.txt` shows `link-cached-plugin-agents.ts` at 262 pure LOC with purge constants/function still inline.
- GREEN structural proof: `green-anti-slop-split-check.txt` shows `link-cached-plugin-agents.ts` at 240 pure LOC and `retired-managed-agent-purge.ts` at 49 pure LOC.
- Behavior lock before split: `baseline-focused-install-tests-before-split.txt` passed 20 install/link/surface tests.
- Commit-candidate focused tests: `focused-install-tests-commit-candidate.txt` passed 20 tests / 151 assertions.
- Full gate: `test-codex-after-split.txt` passed `bun run test:codex`.
- Real surface: `real-surface-install-local-after-split.txt` installed into isolated `CODEX_HOME`, removed the managed retired reviewer TOML, preserved `user-custom.toml`, enabled `omo@sisyphuslabs`, left real `~/.codex/config.toml` hash unchanged, and cleaned the temp root.
- Static cleanup: `diff-check-commit-candidate.txt`, `loc-check-commit-candidate.txt`, and `no-excuse-check-commit-candidate.txt` passed.
