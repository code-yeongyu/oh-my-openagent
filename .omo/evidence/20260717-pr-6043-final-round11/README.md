# PR #6043 Final Repair Evidence - Round 11

Date: 2026-07-17

## Exact Source Identity

- Prior reviewed head: `0dfbc339a6b0df828da93e0cd0b94dfeebd95f2f`.
- Creation-hook ordering repair: `6bd6be558f4789ed083470e9be9f4e460fcc8b9e`.
- QA candidate and repair commit tree:
  `cfcf461bf6a920ce93ffb35a7146600a95c30af7`.
- `source-identity.txt` records `candidate_tree_match=yes`.

## Finding And Repair

Fresh review found that same-ID `session.created` dispatched normal hooks before
awaiting pending deletion cleanup. Replacement runtime state could therefore be
created while an older deletion was paused, then erased by the deletion's later
hook fan-out. The failing-first event test produced 2 pass and 1 fail, observing
replacement hook state before deletion completed. The repair awaits the per-ID
deletion chain before any creation hook dispatch. The same test then produced 3
pass, 0 fail, 10 expectations.

## Verification

- Focused ownership/lifecycle matrix: 16 pass, 0 fail, 43 expectations.
- Complete runtime-fallback suite: 359 pass, 0 fail, 720 expectations across 57
  files.
- Complete plugin event matrix: 63 pass, 0 fail, 173 expectations across 12
  files.
- Exact committed-source smoke: 3 pass, 0 fail.
- OpenCode adapter typecheck and pinned Biome 2.4.16 lint: pass.
- Repository-local TypeScript no-excuse audit: no violations in all 89
  PR-changed TypeScript files.
- OpenCode harness self-check, SSE self-test, and isolated tmux TUI smoke: pass;
  real DB remained at 5751 sessions.
- Production-duration isolated source-plugin run: visible older-root fallback,
  two active roots, deletion restoration, no fallback watchdog re-arm, later
  external user cancellation, unchanged real DB, and cleanup.

## Why It Is Enough

The failing-first regression controls the precise early-hook interleaving and
proves replacement hooks cannot run until all prior same-ID deletion hooks and
cleanup finish. The repeated-deletion and earlier same-ID tests remain in the
focused matrix. Full plugin-event and runtime suites cover adjacent behavior,
while the live source-plugin run proves the original watchdog workflow. Exact
candidate-tree equality binds the live run to the committed repair source.

## Omissions And Superseded Attempts

- CI/review on prior head `0dfbc339` is superseded.
- Raw `live-last-*` captures were removed because they contain ephemeral local
  paths, ports, and session IDs; sanitized live artifacts are retained.
- No tokens, auth headers, credentials, environment dumps, private provider
  traffic, or secret-bearing logs are included.

## Artifact Map

- `source-identity.txt`: exact staged/committed tree proof.
- `focused-ownership-matrix.txt`, `runtime-fallback-suite.txt`,
  `plugin-event-complete.txt`, `exact-source-smoke.txt`: deterministic proof.
- `live-*`, `run-live-watchdog-qa.sh`, `fake-silent-provider.mjs`, and
  `root-state-probe.ts`: isolated live proof and fixtures.
- `typecheck.txt`, `biome-lint.txt`, `no-excuse-all-changed.txt`,
  `harness-self-check.txt`, `sse-self-test.txt`, `tui-smoke.txt`, and
  `cleanup-receipt.txt`: static, harness, and cleanup proof.
