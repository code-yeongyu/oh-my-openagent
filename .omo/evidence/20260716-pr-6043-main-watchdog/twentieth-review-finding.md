# PR 6043 Twentieth Review Finding

## Verdict Before Repair

BLOCK on exact reviewed head `0d8cc101ef77a0b1bbdac3d605f225da504e32c4`.

## Finding

An older active root session lost first-prompt watchdog eligibility as soon as
a newer root session was created. Root A followed by root B overwrote the
singular `_mainSessionID`; when silent root A later reached the watchdog gate,
the code rejected it because its ID differed from B. Root B recovered, but A
produced neither abort nor fallback retry.

This was reproduced twice and toggled by retaining root provenance across the
two lifecycle events. The failing-first output is
`twentieth-review-red-two-roots.txt`; the repaired output is
`twentieth-review-green-two-roots.txt`.

## Repair

Runtime source commit:
`1e0b44d5a8a08ec168a14d542456c11212a7c610`.

- `claude-code-session-state/state.ts` retains every active root while keeping
  the latest root available through the existing getter.
- `event-session-lifecycle.ts` registers only resolved root IDs and removes
  only the deleted root, restoring the previous root when appropriate.
- `first-prompt-watchdog.ts` accepts any registered active root while still
  rejecting unknown non-subagent child sessions.
- State, watchdog, and plugin lifecycle tests cover roots A/B, deleting B,
  and a created-session event without an ID.

Caller tracing found the adjacent missing-ID edge before commit: a malformed
`session.created` event would have called `setMainSession(undefined)` and
cleared all active roots. `twentieth-review-red-missing-created-id.txt` proves
the failure; `twentieth-review-green-missing-created-id.txt` proves the guard.

## Verification

- Runtime fallback: 291 pass, 0 fail across 45 files.
- Plugin lifecycle and session state: 53 pass, 0 fail across 3 files.
- OpenCode adapter strict typecheck: pass.
- Scoped Biome: pass over six changed files after adjusting only three known
  pre-existing diagnostics in temporary copies.
- Introduced-line no-excuse audit: pass.
- OpenCode QA self-check: pass with isolated HOME/XDG cleanup.
- Production-duration live OpenCode QA at exact source SHA: fallback seen,
  no watchdog re-arm, later user abort external, real database unchanged.

## Static-Gate Qualification

The direct whole-file Biome run retained three diagnostics that predate this
repair: a non-null assertion in `state.test.ts`, a zero-width character class
in `state.ts`, and a single-assignment `let` in `event.test.ts`. They are
captured in `twentieth-biome-all-changed.txt`. The passing scoped artifact
changes only those legacy lines in temporary copies and leaves repository
source untouched. The standalone no-excuse script failed to import TypeScript;
the documented forbidden patterns were applied directly to added lines.

## Post-Repair Verdict

PASS for the twentieth repair candidate at
`1e0b44d5a8a08ec168a14d542456c11212a7c610`, subject to exact-head CI and the
required independent reviewer gate after push.

## Omitted

Raw environment dumps, credentials, auth headers, private service logs, and
unsanitized session identifiers are omitted. Live credentials are fixed local
dummy values. The failed whole-file/static-helper attempts are retained only
as bounded diagnostic artifacts and contain no secrets.
