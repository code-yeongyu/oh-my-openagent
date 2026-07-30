# PR #6043 Final Repair Evidence - Round 8

Date: 2026-07-17

## Candidate Identity

- Contributor head reviewed and repaired:
  `72b6e1bf14e29a3300d8a4d64830083b45c59616`.
- Fresh `origin/dev` and merge base:
  `14083b89f1cbf4680be13493a6c4afd67c957e8a`.
- Runtime ownership repair: `fffed869ef00426a3b8df905324d5edcbbf217a9`.
- Model-fallback ownership repair: `473d6a9c2a1ab4dae356013c09776571eeadf77e`.
- Same-ID lifecycle repair and exact tested source head:
  `ec4beb1a5368a638167568759c5adb5a84ff1eb3`.

## What Was Tested

- Deterministic ownership tests for runtime fallback dispatch, status/error
  continuation generations, duplicate updates for one user message, pending
  abort invalidation, model-fallback continuation ABA, and same-ID lifecycle
  deletion/recreation.
- The complete `runtime-fallback` test directory and the complete plugin event
  matrix affected by the repair.
- OpenCode adapter typecheck, repository-pinned Biome 2.4.16 lint over every
  changed TypeScript file, the bundled TypeScript no-excuse checker, diff
  integrity, and production pure-LOC limits.
- The OpenCode QA harness common self-check, SSE self-test, and isolated tmux TUI
  smoke.
- A real isolated OpenCode server using the source plugin and a local fake
  provider. The primary model stayed silent through the real 90-second watchdog,
  the watchdog aborted that request, the fallback produced visible text, the
  plugin recorded completion, deletion of the newer active root restored the
  older root, and a later user abort was classified as external cancellation.

## What Was Observed

- `focused-ownership-matrix.txt`: 12 pass, 0 fail.
- `runtime-fallback-suite.txt`: 358 pass, 0 fail, 717 expectations across 56
  files.
- `plugin-lifecycle-model-matrix.txt`: 25 pass, 0 fail.
- `plugin-event-complete.txt`: 60 pass, 0 fail.
- `typecheck.txt`, `biome-lint.txt`, and `no-excuse.txt`: pass. The no-excuse
  checker covered 15 changed TypeScript files.
- `live-plugin-watchdog.txt`: the watchdog dispatched one fallback, observed a
  visible assistant completion, did not re-arm after that completion, and later
  resolved the genuine user abort as external cancellation.
- `live-root-state.jsonl`: both root sessions were active; deleting the newer
  root restored the older root as current without deactivating it.
- `live-isolation-receipt.txt`: isolated sandbox, real DB unchanged, five closed
  primary attempts, two fallback requests (one completed and one intentionally
  hung for user cancellation), and all HTTP assertions passed.
- `tui-smoke.txt`: isolated TUI rendered, accepted input, tore down tmux, and
  left the real DB count unchanged at 5751.

## Why It Is Enough

The deterministic suite pins every reproduced ownership and same-ID reuse race,
including the exact duplicate-user-update interleaving discovered during live
QA. The complete runtime and plugin-event suites cover adjacent abort, timeout,
compaction, fallback, monitor, and lifecycle behavior. The production-duration
run drives the real OpenCode server and source plugin through the user-visible
watchdog scenario instead of substituting unit tests for harness behavior.
Isolation receipts prove that the run did not write to the user's real OpenCode
database.

## Superseded Attempts

- The first round-eight live run exposed a real race: SSE contained the completed
  fallback response, but a repeated update for the same user message advanced
  generation while the plugin's asynchronous visibility probe was pending. The
  run timed out waiting for completion bookkeeping. That failure led directly to
  the user-message-ID generation repair and its regression test. The final live
  artifacts in this directory are from the passing rerun.
- `biome.txt` was produced by an unpinned Biome 2.5.4 `check` attempt and reported
  repository-irrelevant whole-file formatting/organize-import diagnostics.
  `biome-lint.txt`, produced with the repository's installed Biome 2.4.16 lint
  binary, is the valid static result. The superseded output is intentionally not
  part of the committed evidence set.

## What Was Omitted

- Raw `live-last-*` server/plugin/SSE captures are not committed because they
  contain ephemeral local paths, ports, and session IDs. Reviewer-facing live
  files replace those values with stable placeholders.
- No auth headers, API tokens, environment dumps, credentials, or private
  provider traffic are included. The fake provider uses only local loopback and
  a non-secret fixture key.
- Readiness connection-refused lines and expected SIGTERM output from cleanup are
  transport noise; the final assertions and cleanup receipts are preserved.

## Artifact Map

- `run-live-watchdog-qa.sh`, `fake-silent-provider.mjs`, `root-state-probe.ts`:
  reproducible isolated live driver and fixtures.
- `live-plugin-watchdog.txt`, `live-fake-provider.txt`,
  `live-sse-events.jsonl`, `live-root-state.jsonl`,
  `live-isolation-receipt.txt`: sanitized live proof.
- `focused-ownership-matrix.txt`, `runtime-fallback-suite.txt`,
  `plugin-lifecycle-model-matrix.txt`, `plugin-event-complete.txt`: deterministic
  regression proof.
- `harness-self-check.txt`, `sse-self-test.txt`, `tui-smoke.txt`: OpenCode QA
  harness proof.
- `typecheck.txt`, `biome-lint.txt`, `no-excuse.txt`,
  `source-static-integrity.txt`: static and source-integrity proof.
