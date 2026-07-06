# Remove Workflow Selector Evidence

## What Changed

Removed the Codex Light opt-in workflow selector runtime surface:

- deleted `components/workflow-selector/`
- deleted `hooks/user-prompt-submit-selecting-lazycodex-workflow.json`
- removed the component from the plugin workspace and package lock
- removed the aggregate plugin hook entry
- updated tests to assert the selector hook/component are absent

## Evidence

- `01-bun-install.txt`: dependency install plus full postinstall build; component build list does not include `workflow-selector`.
- `02-aggregate-tests.txt`: aggregate manifest and hook tests passed, including the reduced hook count and selector absence assertion.
- `03-component-bundled-cli.txt`: built component CLI contract tests passed without a workflow selector component.
- `04-runtime-absence-check.txt`: runtime package, manifest, hook, and component paths have no workflow selector references.
- `05-plugin-npm-test.txt`: `packages/omo-codex/plugin` full node test suite passed.
- `06-bun-test-codex.txt`: repo Codex compatibility gate passed.
- `07-codex-qa-common-self-check.txt`: codex-qa isolation harness passed and real `~/.codex/config.toml` was unchanged.
- `08-codex-install-verify.txt`: isolated local install verification passed and real `~/.codex/config.toml` was unchanged.
- `09-codex-app-server-drive-plugin.json`: isolated Codex app-server turn completed with plugin hooks firing; `userPromptSubmit` hooks are rules, ultrawork, and ulw-loop only.
- `review-work-manual-qa.md`: manual QA matrix and adversarial cases for PR #5745.
- `review-work-code-quality.md`: code-quality review with `omo:remove-ai-slops`, `omo:programming`, and `code-review` perspectives.
- `review-work-security.md`: security review with no findings and no secret-bearing evidence.
- `review-work-context-mining.md`: context search confirming no missed docs/changelog requirements and only test-only residual strings.
- `notepad.md`: current-task notepad artifact.
- `REVIEW_WORK_FINAL.md`: aggregate review-work verdict and Cubic skip recording.

## Residual Risk

The remaining `<lazycodex-auto-workflow>` string is a test fixture in ultrawork coverage for old transcript content. It is not runtime wiring and is intentionally excluded from the runtime absence check.
