# PR 6826 review and repair QA

## Scope

- Merged current upstream `dev` into `codex/add-atlas-cloud-link-logo`.
- Resolved conflicts in installation documentation, the generated Codex installer,
  and the command-string audit allowlist.
- Updated the Atlas Cloud fallback test for the current fallback-lane policy.

## Passed

- `bun run build:codex-install`
- `tsgo --noEmit -p packages/model-core/tsconfig.json`
- `tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
- `tsgo --noEmit -p packages/omo-codex/tsconfig.json`
- `tsgo --noEmit -p script/tsconfig.json`
- All 15 changed test files other than the full installer suite: 180 Bun tests
  and 32 Node tests passed.
- Atlas Cloud packaged installer case: 1 passed.
- Generated installer suites: 43 passed.
- `git diff --cached --check refs/remotes/upstream/dev`

## Environment limitation

The full `install-codex.test.ts` suite progressed past the Atlas Cloud case but
could not validate the 27 vendored `designpowers` references because that
external shared-skill submodule was unavailable in this isolated checkout. The
Atlas Cloud installer case itself passed, and no production file was changed to
work around the missing fixture.

The live OpenCode terminal QA harness was not run because this isolated machine
does not have the required `opencode` and `tmux` executables.
