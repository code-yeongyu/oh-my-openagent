# PR #6043 Twenty-Second Review Repair

Date: 2026-07-17

## Finding

Independent exact-head review lane 2 blocked evidence head
`c0f209443e3dc06446f14af02c68afe5a2c63ba1`. The shared abort helper already
returned `false` when OpenCode rejected cancellation, but the
`message.updated` and `session.status` provider-signal callers ignored that
ownership result. Both could release retry state and dispatch a replacement
while the original provider request remained active.

The review probe observed one rejected abort followed by one fallback dispatch
on both event paths. The blocking report is preserved at
`.omo/evidence/pr-6043-lane-2-code-review.md`.

## Repair

Source commit `ece0473ca317a819d4d5ba8bf8f86272ee31d1fa` makes the abort result a hard
dispatch gate:

- `message-update-handler.ts` preserves awaiting/in-flight ownership and exits
  when retry-signal or quota abort is rejected.
- `session-status-handler.ts` preserves active or pending fallback ownership,
  avoids a second abort after a successful override abort, and exits before
  state mutation when the final abort is rejected.
- `abort-rejection-handlers.test.ts` adds four failing-first observable
  regressions covering message retry-signal, message quota, status in-flight,
  and status pending-fallback boundaries.

The red run produced `0 pass, 4 fail`: every case recorded fallback dispatch
after rejection, and the in-flight status path attempted abort twice. The
repaired focused run produced `4 pass, 0 fail`.

## Verification

- Full runtime-fallback suite: `295 pass, 0 fail` across 46 files.
- Root lifecycle/state suite: `53 pass, 0 fail` across 4 files.
- OpenCode adapter typecheck: pass.
- Exact-source Biome: pass on all 3 repaired files.
- Bundled TypeScript no-excuse helper: no violations in 3 files.
- Pure LOC: test 152, message handler 198, status handler 137.
- OpenCode QA harness self-check: pass on OpenCode 1.17.13.
- Exact-source real OpenCode run: pass at
  `ece0473ca317a819d4d5ba8bf8f86272ee31d1fa`; two active roots, older-root
  fallback, newer-root deletion restoration, no fallback watchdog re-arm,
  later external cancellation, and unchanged real database.

## Evidence Boundaries

The false-abort outcome is deterministic only at the typed handler seam, so
the four focused regressions prove that no replacement dispatch occurs and
ownership remains intact. The real OpenCode harness exercises the unchanged
successful-abort transport and the complete user-visible watchdog lifecycle.
It does not force a live server abort rejection, because doing so while an
actual request remains active is not deterministic through the public server
API. Raw auth values, session IDs, local paths, and unrelated logs are omitted
or sanitized.

## Verdict

The lane-2 blocker is repaired on exact source commit
`ece0473ca317a819d4d5ba8bf8f86272ee31d1fa`. Fresh exact-head CI and the full
independent review sequence are still required before merge.
