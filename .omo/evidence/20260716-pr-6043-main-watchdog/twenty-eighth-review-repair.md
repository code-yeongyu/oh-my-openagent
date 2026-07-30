# PR 6043 twenty-eighth review repair

## Finding

The fresh goal-and-constraint lane reviewed evidence head
`74e387bf47dbf2d107e204969daf287983f548ff` and passed every functional
criterion, but found that two files in the full PR diff violated the repository
250-pure-line ceiling:

- `packages/omo-opencode/src/plugin/event.test.ts` had unrelated one-line
  churn while remaining a 1504-pure-line legacy module.
- `packages/omo-opencode/src/plugin/event.model-fallback.test.ts` gained the
  SDK abort-boundary regression while remaining a 1070-pure-line legacy
  module.

The lane also observed one Windows CI job still running. That temporal
condition cleared without code changes; all exact-head checks passed before
this repair cycle began.

## Repair

Source commit `82debef4dbbbe95d077666e6ed279aaca56d8932`:

- restores both oversized legacy tests byte-for-byte to `origin/dev`, removing
  them from the PR diff; and
- preserves the SDK resolved-error contract in the focused 44-pure-line
  `event-model-fallback-abort-boundary.test.ts` module.

The production runtime remains pinned to
`a5d9298c5581b90cad1822995456edb6f82a9268`.

## Exact-head verification

- Focused runtime lifecycle plus model-fallback boundary: 21 pass / 0 fail
  across 5 files (`twenty-eighth-exact-focused-regressions.txt`).
- Full runtime fallback: 302 pass / 0 fail across 48 files
  (`twenty-eighth-exact-runtime-fallback-suite.txt`).
- Plugin event, model fallback, root lifecycle, and session state: 66 pass / 0
  fail across 5 files (`twenty-eighth-exact-session-lifecycle-suite.txt`).
- Static gates: package `tsgo --noEmit`, bundled no-excuse audit over 13 files,
  documented Biome lint-only check, `git diff --check`, and whole-PR pure-LOC
  audit pass. The audit reports zero changed TypeScript files over 250 lines.
- Pinned SDK 1.15.13 abort boundary and OpenCode harness self-check pass.
- Mandatory isolated real OpenCode QA passes at `82debef4d`: two active roots,
  older-root fallback, deletion restoration, no fallback re-arm, later user
  cancellation external, and real DB count unchanged at 5751.

## Why this is enough

The repair changes only test organization. Byte equivalence to `origin/dev`
proves the two legacy files carry no PR behavior, while the focused test locks
the same SDK abort contract at its production controller seam. Broad suites,
typecheck, static checks, the SDK loopback, and the live harness prove no
behavioral regression from relocation.

## Omitted or bounded

No secrets, auth headers, raw environments, private credentials, or unrelated
logs are copied. The original failing goal-lane report is preserved as
`twenty-eighth-goal-review-finding.md`; its CI observation was time-bounded and
is superseded by the terminal exact-head check record.
