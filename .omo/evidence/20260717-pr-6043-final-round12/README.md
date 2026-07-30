# PR #6043 Final Repair Evidence - Round 12

Date: 2026-07-17

## Exact Source

- Prior reviewed head: `b28ad3657a27454bfac7c6000446740f03954841`.
- Armed-watchdog generation repair: `b5b8922be18e0e2d5739b206a40ac0d5e3d518ed`.
- QA candidate and repair commit tree:
  `6ed01e71d777b4d60b40319605709ef50ef7deaa` (`candidate_tree_match=yes`).

## Finding And Repair

A distinct newer user message arriving while the session watchdog was armed
kept the older message's generation and deadline. The failing-first test armed
user-1 at t=0, delivered user-2 at t=40ms, and observed abort/fallback at
user-1's t=100ms deadline (10 pass, 1 fail). The repair replaces an armed
watchdog only when both message IDs are known and different, preserving
duplicate/no-ID behavior while moving ownership and deadline to the newer turn.
The same suite then produced 11 pass, 0 fail, 29 expectations.

## Verification

- Focused watchdog/lifecycle ownership matrix: 27 pass, 0 fail, 72 expectations.
- Complete runtime-fallback suite: 360 pass, 0 fail, 724 expectations across 57
  files.
- Exact committed-source watchdog smoke: 11 pass, 0 fail.
- OpenCode adapter typecheck and pinned Biome 2.4.16 lint: pass.
- Repository-local no-excuse audit: no violations in all 90 PR-changed
  TypeScript files.
- OpenCode harness self-check, SSE self-test, and isolated tmux TUI smoke: pass;
  real DB remained at 5751 sessions.
- Production-duration isolated source-plugin run: older-root fallback, two
  active roots, deletion restoration, no fallback-owned re-arm, later external
  user cancellation, unchanged real DB, and cleanup.
- Round 11 remains the exact proof for the unchanged 63/63 plugin-event matrix.

## Sufficiency And Omissions

The new fake-timer regression directly proves that the old deadline cannot act
on a distinct newer message. The full runtime suite covers adjacent timeout,
abort, fallback, and generation behavior; prior exact lifecycle evidence stays
unchanged. Candidate-tree equality binds QA to committed source. Raw
`live-last-*` captures were removed; sanitized live artifacts retain behavior.
No secrets, credentials, auth headers, or environment dumps are included.
