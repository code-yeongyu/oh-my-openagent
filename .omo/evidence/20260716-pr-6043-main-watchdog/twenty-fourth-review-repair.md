# PR #6043 Twenty-Fourth Review Repair

Date: 2026-07-17
Runtime source: `3577b62fca083a96c9eea6744be74966b649a711`
Base integrated by the branch: `5ef852a32c2c433386eb009bd92ca7c07359d0e6`

## Finding and repair

The exact-head code/concurrency lane found that the pinned
`@opencode-ai/sdk@1.15.13` resolves non-2xx responses by default. The abort
helper ignored the populated `error`, returned success, released retry
reservations, and retained internal abort ownership after a failed HTTP abort.

The repair passes `throwOnError: true`, defensively handles a resolved error
shape, clears internal ownership on failure, preserves the prompt reservation,
and returns `false`. The failing-first and repaired observations are recorded
in `twenty-fourth-review-finding.md`.

## What was tested and observed

- Pinned SDK wire contract: a local HTTP fake returned 404. Default SDK abort
  resolved with `error` and status 404; `throwOnError: true` rejected.
  Artifact: `twenty-fourth-sdk-wire-contract.txt`.
- Repaired helper through the real SDK and HTTP fake: returned `false`, cleared
  internal abort ownership, and retained the `model-suggestion-retry`
  reservation. Artifact: `twenty-fourth-sdk-wire-helper.txt`.
- Full runtime-fallback suite: 296 pass, 0 fail across 46 files.
  Artifact: `twenty-fourth-runtime-fallback-suite.txt`.
- Root/session lifecycle suite: 53 pass, 0 fail across 4 files.
  Artifact: `twenty-fourth-session-lifecycle-suite.txt`.
- OpenCode adapter typecheck, Biome 2.4.16 lint with formatter/assist disabled,
  bundled TypeScript no-excuse helper, diff integrity, and pure LOC limits all
  pass. Artifacts: `twenty-fourth-omo-opencode-typecheck.txt`,
  `twenty-fourth-biome.txt`, `twenty-fourth-no-excuse.txt`, and
  `twenty-fourth-integrity.txt`.
- Mandatory OpenCode QA harness self-check passed with isolated HOME/XDG
  cleanup. Artifact: `twenty-fourth-opencode-harness-self-check.txt`.
- Production-duration real OpenCode QA loaded the exact local plugin source and
  observed two active roots, silent older-root fallback, newer-root deletion
  restoring the older root, no fallback watchdog re-arm, later external user
  cancellation, and an unchanged real OpenCode database. Artifacts:
  `twenty-fourth-exact-live-watchdog-run.txt`,
  `twenty-fourth-exact-live-plugin-watchdog.txt`,
  `twenty-fourth-exact-live-fake-provider.txt`,
  `twenty-fourth-exact-live-sse-events.jsonl`,
  `twenty-fourth-exact-live-root-state.jsonl`, and
  `twenty-fourth-exact-live-isolation-receipt.txt`.

## Why it is enough

The wire-level SDK probes directly cover the newly repaired failure boundary.
The broad deterministic suites cover retry ownership, reservations, abort and
fallback interactions, generation races, compaction, and root lifecycle. The
isolated real harness covers the successful transport path and user-visible
watchdog lifecycle on the exact runtime commit while proving the real user DB
was untouched.

## What was omitted

Transient server logs, temporary sandbox paths, auth material, and raw
environment output were not committed. The first direct no-excuse invocation
failed before analysis because the external skill path could not resolve this
repo's TypeScript package; the identical script was rerun through Bun stdin
from repository module context and passed. Only the successful strict-rule
receipt is included here.
