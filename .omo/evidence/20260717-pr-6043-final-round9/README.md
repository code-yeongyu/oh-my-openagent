# PR #6043 Final Repair Evidence - Round 9

Date: 2026-07-17

## Candidate Identity

- Contributor head repaired: `72b6e1bf14e29a3300d8a4d64830083b45c59616`.
- Fresh base during repair: `14083b89f1cbf4680be13493a6c4afd67c957e8a`.
- Prior tested repair head: `1d3c3eef25f9f50aee988f9bd3432d485bcbaaf9`.
- Round-nine QA ran from that head plus the five source/test changes described
  below. The source commit is created only after this evidence gate passes.

## Findings And Red-To-Green Proof

The exact-head goal review found two remaining same-ID reuse races:

1. `session.stop` awaited an abort and then unconditionally reset retry state,
   even when deletion and recreation had transferred the ID to a replacement.
2. `session.deleted` entered `sessionDeletionTasks` only after general hook
   fan-out, so a recreation could finish while deletion was paused in an earlier
   hook and then be erased by stale cleanup.

The two deterministic regressions produced `0 pass, 2 fail` against the
unmodified source. With the generation recheck and pre-fan-out deletion
reservation, the same tests produced `2 pass, 0 fail, 6 expect() calls`.
`focused-ownership-matrix.txt` then expanded the repaired cases with adjacent
ownership/lifecycle regressions and produced 14 pass, 0 fail.

## What Was Tested

- The focused ownership and lifecycle matrix, including both new failing-first
  regressions.
- The complete runtime-fallback directory and complete plugin event matrix.
- OpenCode adapter typecheck, pinned Biome 2.4.16 lint, the bundled TypeScript
  no-excuse checker, diff integrity, and changed production pure-LOC checks.
- OpenCode QA harness self-check, SSE self-test, and isolated tmux TUI smoke.
- A production-duration isolated OpenCode server using the source plugin and a
  local fake provider through the real 90-second first-prompt watchdog.

## What Was Observed

- `focused-ownership-matrix.txt`: 14 pass, 0 fail, 36 expectations.
- `runtime-fallback-suite.txt`: 359 pass, 0 fail, 720 expectations across 57
  files.
- `plugin-event-complete.txt`: 61 pass, 0 fail, 166 expectations across 12
  files.
- `typecheck.txt`: pass.
- `biome-lint.txt`: five changed TypeScript files linted with no fixes.
- `no-excuse.txt`: no violations in five changed TypeScript files.
- `harness-self-check.txt`, `sse-self-test.txt`, and `tui-smoke.txt`: pass; TUI
  teardown completed and the real DB remained at 5751 sessions.
- `live-watchdog-qa.txt` and `live-isolation-receipt.txt`: the older root's
  silent primary request fell back visibly, the watchdog did not re-arm after
  completion, two roots coexisted, deleting the newer root restored the older
  root, a later user abort stayed external, and the real DB was unchanged.

## Why It Is Enough

The failing-first tests directly control the two awaits that made stale work
resume after identity transfer. The broader deterministic suites cover adjacent
abort, retry, fallback, monitor, deletion, and recreation paths. The live run
drives the real OpenCode server and source plugin for the user-visible watchdog
scenario, while the harness receipts prove XDG/HOME isolation and real database
non-interference.

## Superseded Attempts

- The first round-nine SSE self-test entered the configured proxy path and
  stalled before producing a verdict. It was terminated, its exact sandbox was
  removed, and the same self-test passed with loopback in `NO_PROXY`; only the
  passing result is preserved.
- An external copy of the no-excuse helper could not resolve repository
  TypeScript. A temporary colocated copy under `.omo/` used repository module
  resolution and passed; the temporary runner was removed.
- An initial live run accidentally reused round-eight output paths. Those
  process-only mutations were restored, the harness path was corrected, and a
  fresh full-duration run generated the round-nine artifacts here.

## What Was Omitted

- Raw `live-last-*` captures were removed because they contain ephemeral local
  paths, ports, and session IDs. Sanitized reviewer-facing artifacts preserve
  the asserted behavior.
- No tokens, auth headers, credentials, environment dumps, private provider
  traffic, or secret-bearing logs are included. The provider is loopback-only
  and uses a fixture key.
- Expected readiness connection failures and cleanup SIGTERM output are
  transport noise; terminal assertions and cleanup receipts are retained.

## Artifact Map

- `focused-ownership-matrix.txt`, `runtime-fallback-suite.txt`, and
  `plugin-event-complete.txt`: deterministic regression coverage.
- `run-live-watchdog-qa.sh`, `fake-silent-provider.mjs`, and
  `root-state-probe.ts`: reproducible isolated live driver and fixtures.
- `live-watchdog-qa.txt`, `live-plugin-watchdog.txt`,
  `live-fake-provider.txt`, `live-sse-events.jsonl`, `live-root-state.jsonl`,
  and `live-isolation-receipt.txt`: sanitized live proof.
- `harness-self-check.txt`, `sse-self-test.txt`, and `tui-smoke.txt`: harness
  proof.
- `typecheck.txt`, `biome-lint.txt`, `no-excuse.txt`, and
  `source-static-integrity.txt`: static and cleanup proof.
