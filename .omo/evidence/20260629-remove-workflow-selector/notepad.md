# Notepad: Remove Codex Workflow Selector

## Objective

Surgically remove the Codex Light opt-in workflow selector, originally introduced by PR #5540, while preserving the existing Codex hook chain.

## Implementation Notes

- Removed `packages/omo-codex/plugin/components/workflow-selector/`.
- Removed `packages/omo-codex/plugin/hooks/user-prompt-submit-selecting-lazycodex-workflow.json`.
- Removed aggregate plugin manifest, workspace, and lockfile references.
- Updated aggregate/component tests to assert selector absence while retaining rules, ultrawork, and ulw-loop coverage.

## QA Notes

- Local build/test evidence is in this directory as `01-*.txt` through `09-*.json`.
- Live Codex app-server QA used an isolated `CODEX_HOME` and local mock model. Real `~/.codex/config.toml` stayed unchanged.
- App-server hook notifications show `UserPromptSubmit` hooks for rules, ultrawork, and ulw-loop only.
- CI on PR #5745 passed across build, typecheck, test, and codex-compatibility matrices.

## Review Notes

- Manual QA matrix: `review-work-manual-qa.md`.
- Code-quality report: `review-work-code-quality.md`.
- Security report: `review-work-security.md`.
- Context-mining report: `review-work-context-mining.md`.
- Initial gate gap report: `review-work-initial-gate-review.md`.

## Residuals

- Cubic produced a neutral/skipped check and no inspectable review/comment. Per `work-with-pr`, this is recorded as Gate C skipped rather than blocking because there were no Cubic issues to address.
- The remaining `<lazycodex-auto-workflow>` string is a test-only legacy transcript fixture, not runtime wiring.
