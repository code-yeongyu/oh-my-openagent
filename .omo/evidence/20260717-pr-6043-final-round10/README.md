# PR #6043 Final Repair Evidence - Round 10

Date: 2026-07-17

## Exact Source Identity

- Prior pushed head reviewed: `12cf640788b2b558eab4f2f4b91b5c512c84d10f`.
- Repeated-deletion repair commit: `b4a9e52b18e08b56e16fe1714c363b6c91113f12`.
- QA candidate tree: `a2d431de43178bd459f707c590a3846f280b75fa`.
- Repair commit tree: `a2d431de43178bd459f707c590a3846f280b75fa`.
- `source-identity.txt` records `candidate_tree_match=yes`, proving the live-tested
  staged source is byte-identical to the committed repair tree.

## Finding And Red-To-Green Proof

A fresh exact-head gate found that repeated `session.deleted` events for the
same ID replaced the mapped cleanup promise instead of representing all pending
cleanup. Deletion one could pause, deletion two could complete and remove the
map entry, recreation could finish, and deletion one could then resume async
disconnect/tmux teardown against the replacement.

The failing-first event test produced 1 pass and 1 fail: before deletion one was
released, `stopSessionMonitors` had already been called twice. The repair chains
each new reservation behind the previous per-ID task while preserving its own
post-hook start gate. The same test then produced 2 pass, 0 fail, 8 expectations.

## What Was Tested

- Focused runtime/model/plugin ownership and lifecycle matrix, including the
  new repeated-deletion ABA regression.
- Complete runtime-fallback directory and complete plugin event matrix.
- OpenCode adapter typecheck, pinned Biome 2.4.16 lint for the latest repair,
  the repository-local TypeScript no-excuse checker across all 88 PR-changed
  TypeScript files, and diff integrity.
- OpenCode QA harness self-check, SSE self-test, and isolated tmux TUI smoke.
- A production-duration isolated OpenCode server using the staged candidate
  source, local fake provider, and real 90-second first-prompt watchdog.
- The repeated-deletion regression again after the source commit was created.

## What Was Observed

- `focused-ownership-matrix.txt`: 15 pass, 0 fail, 41 expectations.
- `runtime-fallback-suite.txt`: 359 pass, 0 fail, 720 expectations across 57
  files.
- `plugin-event-complete.txt`: 62 pass, 0 fail, 171 expectations across 12
  files.
- `exact-source-smoke.txt`: 2 pass, 0 fail on committed repair source.
- `typecheck.txt`, `biome-lint.txt`, and `no-excuse-all-changed.txt`: pass; the
  no-excuse audit covered all 88 changed TypeScript files.
- `harness-self-check.txt`, `sse-self-test.txt`, and `tui-smoke.txt`: pass; the
  TUI tore down and the real DB remained at 5751 sessions.
- `live-watchdog-qa.txt` and `live-isolation-receipt.txt`: visible older-root
  fallback, two active roots, newer-root deletion restoration, no fallback
  watchdog re-arm, later external user cancellation, and unchanged real DB.

## Why It Is Enough

The failing-first test controls both overlapping deletion tasks and observes
the exact stale async teardown boundary. The complete plugin event suite covers
adjacent hook fan-out, monitor, root lifecycle, and model fallback behavior.
The full runtime suite protects the watchdog behavior that motivated the PR.
The live run drives the real OpenCode source-plugin surface, and the candidate
tree/commit tree equality closes the exact-source identity gap noted by review.

## Superseded Attempts

- CI and review results for pushed head `12cf6407` are superseded by the new
  source repair and must not be used for disposition.
- An initial no-excuse wrapper built an empty zsh array and reported no input;
  the corrected repository-local invocation audited all 88 changed TypeScript
  files and passed.
- An initial common harness command used the wrong helper path; the documented
  `scripts/lib/common.sh --self-check` invocation passed.

## What Was Omitted

- Raw `live-last-*` captures were removed because they contain ephemeral local
  paths, ports, and session IDs. Sanitized artifacts preserve asserted behavior.
- No tokens, auth headers, credentials, environment dumps, private provider
  traffic, or secret-bearing logs are included.
- Expected readiness connection failures and cleanup SIGTERM output are
  transport noise; terminal assertions and cleanup receipts are preserved.

## Artifact Map

- `source-identity.txt`: staged candidate tree to repair commit tree proof.
- `focused-ownership-matrix.txt`, `runtime-fallback-suite.txt`,
  `plugin-event-complete.txt`, and `exact-source-smoke.txt`: deterministic proof.
- `run-live-watchdog-qa.sh`, `fake-silent-provider.mjs`, and
  `root-state-probe.ts`: reproducible isolated live driver and fixtures.
- `live-watchdog-qa.txt`, `live-plugin-watchdog.txt`,
  `live-fake-provider.txt`, `live-sse-events.jsonl`, `live-root-state.jsonl`,
  and `live-isolation-receipt.txt`: sanitized live proof.
- `harness-self-check.txt`, `sse-self-test.txt`, `tui-smoke.txt`,
  `typecheck.txt`, `biome-lint.txt`, `no-excuse-all-changed.txt`, and
  `cleanup-receipt.txt`: harness, static, and cleanup proof.
