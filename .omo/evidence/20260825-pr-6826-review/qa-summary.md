# PR 6826 review and repair QA

## Scope

- Merged current upstream `dev` into `codex/add-atlas-cloud-link-logo`.
- Resolved conflicts in installation documentation, the generated Codex installer,
  and the command-string audit allowlist.
- Updated the Atlas Cloud fallback test for the current fallback-lane policy.
- On 2026-08-28, merged `dev` at `64d89819e` and regenerated the Codex
  installer after the upstream fallback-lane refactor.

## Passed

- `bun run build:codex-install`
- `tsgo --noEmit -p packages/model-core/tsconfig.json`
- `tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
- `tsgo --noEmit -p packages/omo-codex/tsconfig.json`
- `tsgo --noEmit -p script/tsconfig.json`
- Thirteen changed Bun test files: 180 tests passed.
- Atlas Cloud packaged installer case: 1 passed.
- Generated installer suites: 43 passed.
- Read-only Atlas Cloud model discovery: all 12 configured model IDs were
  present in the live catalog and classified as `Text` models.
- `git diff --cached --check refs/remotes/upstream/dev`

## Environment limitation

The full `install-codex.test.ts` suite progressed past the Atlas Cloud case but
could not validate the 27 vendored `designpowers` references because that
external shared-skill submodule was unavailable in this isolated checkout. The
Atlas Cloud installer case itself passed, and no production file was changed to
work around the missing fixture.

The direct bootstrap test completed 12 of 13 cases. Its Atlas Cloud provider
case passed; the remaining catalog-drift assertion also fails against the
current upstream bootstrap distribution because `model-catalog.json` now uses
a 650,000-token window while the checked-in upstream component bundle has not
been rebuilt. This PR does not modify that assertion or bundle.

The live OpenCode terminal QA harness was not run because this isolated machine
does not have the required `opencode` and `tmux` executables.
