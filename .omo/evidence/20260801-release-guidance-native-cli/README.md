# Release guidance QA evidence

## What was tested

- Failing-first validation of deliberately invalid GitHub and Discord drafts.
- Static policy validation across the six drift-synced skill and command files.
- Existing contained-surface changelog tests.
- Repository markdown link audit.
- OpenCode QA harness dependency and isolation self-check.
- Isolated `opencode run --command get-unpublished-changes` real-surface invocation.

## What was observed

- RED: the initial draft failed because it lacked the dedicated Native CLI transition heading and contained excluded internal adapter wording.
- RED: `v4.19.4` and all three matching npm package versions were absent.
- GREEN: all six guidance files contain the required transition and exclusion policies; both command copies are byte-identical.
- GREEN: `script/generate-changelog.test.ts` passes its contained-surface cases.
- GREEN: `packages/omo-opencode/src/shared/markdown-link-audit.test.ts` passes.
- GREEN: the OpenCode QA harness confirmed required dependencies and removed its isolated sandbox.
- The real OpenCode command transcript is recorded separately after completion.

## Why it is enough

The change is prompt-only. The guidance files are validated directly, the shipped changelog exclusion seam remains green, the markdown audit covers committed documentation integrity, and the actual OpenCode command surface is driven in an isolated XDG sandbox.

## What was omitted

Raw environment values, credentials, provider configuration, and secret-bearing logs are not recorded.
