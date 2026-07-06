# Issue 77 Sparkshell Guidance Notepad

## Skills
- `work-with-pr`: PR lifecycle is explicitly required; using a clean task worktree and opening one PR without merging.
- `codex-qa`: mandatory for `packages/omo-codex` component changes and live Codex hook evidence.
- `commit`: required for atomic git commits.
- `omo:programming`: TypeScript test/source edits require TypeScript discipline.

## Tier
LIGHT. The change is a narrow guidance/test update inside an existing Codex rules component and adjacent prompt text, with no new module, abstraction, persistence, security, or concurrency boundary.

## Success Criteria
- One PR from `code-yeongyu/fix-lazycodex-77-sparkshell-argv-guidance` to `dev` in `code-yeongyu/oh-my-openagent`, unmerged, linking `Fixes code-yeongyu/lazycodex#77`.
- RED evidence captures a focused test failing before production guidance changes because the Sparkshell runtime guidance lacks `omo sparkshell rg --files` and `not omo sparkshell 'rg --files'`.
- GREEN evidence covers focused tests/typecheck/build needed for touched package.
- Mandatory Codex QA evidence is captured under this directory with isolated `CODEX_HOME`.
- Manual QA extracts the injected `## Sparkshell Runtime` context and proves positive argv-token and negative quoted-string examples.

## Now
Self-review, stage scoped files, commit, push, and open the PR.

## Todo
- Self-review, commit, push, and open PR.

## Findings
- Main source worktree `/Users/yeongyu/local-workspaces/omo` has unrelated dirty Codex installer/config changes, so work is isolated in `/Users/yeongyu/local-workspaces/omo-wt/code-yeongyu/fix-lazycodex-77-sparkshell-argv-guidance`.
- `packages/omo-codex/plugin/components/rules/src/sparkshell-awareness.ts` emits the `## Sparkshell Runtime` context.
- `packages/omo-codex/plugin/components/rules/test/sparkshell-awareness.test.ts` already has a focused helper for the Sparkshell-first contract.
- Dependency setup needed `npm --prefix packages/omo-codex/plugin ci` and `bun install` in the clean worktree before focused tests could reach assertions.
- `packages/omo-codex/plugin/components/ultrawork/directive.md` is generated from `packages/prompts-core/prompts/ultrawork/codex.md`; the source prompt and generated copy both need the clarification.
- Full `packages/omo-codex/plugin/components/rules` `npm run check` is blocked by pre-existing package-wide Biome findings unrelated to this edit; touched-file validation passes.
- `packages/omo-codex/plugin/components/ulw-loop` Biome ignores `directive.md`; typecheck/build passed and the ignored markdown check is captured separately.

## Evidence Log
- RED captured: `.omo/evidence/20260626-issue-77-sparkshell-guidance/red.txt` shows `sparkshell-awareness.test.ts` failing because `## Sparkshell Runtime` lacks `` `omo sparkshell rg --files` ``.
- GREEN focused checks captured: `green-rules-sparkshell-awareness.txt`, `green-ultrawork-package-smoke.txt`.
- Touched package validation captured: `validate-rules-touched.txt`, `validate-ultrawork-touched.txt`, `validate-ulw-loop-typecheck-build.txt`, `validate-prompts-core.txt`.
- Mandatory Codex gates captured: `test-codex.txt`, `codex-qa-common-self-check.txt`, `codex-qa-app-server-plugin.json`.
- Manual extracted-context QA captured: `manual-qa.txt` and `manual-qa-hook-output.json`.
