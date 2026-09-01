# POST review-blocker fixes, round 2 — live re-run pass

Follow-up to `post-review-fixes.md`. Two remaining review blockers on `feat/memorian-gate`, each
fixed TDD RED-first, plus the memory-core primitive the second fix needed.

| Commit | Blocker | What |
|---|---|---|
| `8b265ae56` | 1 — indirect post-handler ctx read | The detached runner still had `input.modelRegistry ?? this.options.resolveModelRegistry()`. When the settle handler's synchronous snapshot returned undefined or threw, the wiring omitted `modelRegistry` and the runner fell through to the resolver, which reads `lastEventCtx.current` AFTER the handler returned — i.e. after `AgentSession` dispose invalidated the ctx. The snapshot is now AUTHORITATIVE: the runner consumes ONLY `input.modelRegistry`, warns `memorian gate registry snapshot unavailable` and skips when it is absent. The `resolveModelRegistry` runner option is DELETED (wiring-runtime was its only caller). |
| `7e482ca11` | (primitive) | `PendingNudges.delete(sessionId)` — targeted, best-effort retraction of one session's payload. `take()` would read and parse a payload the caller wrote microseconds earlier; the writer retracting its own file needs a delete, not a read. |
| `341e89a33` | 2 — epoch TOCTOU | `isStaleAfterCompaction()` passed, then `PendingNudges.write()` awaited mkdir/prune/writeFile/rename. A compaction accepted inside that window bumped the epoch while its own pending drop still found no file, so the rename landed a pre-compaction nudge nothing would ever remove. The epoch is now re-read AFTER the write completes; a mismatch deletes the just-written file and warns `memorian gate nudges dropped after compaction`. The cheap pre-write check stays as an early-out. Every interleaving is closed: bump-before-recheck → the runner retracts; write-before-drop → `onCompactionAccepted`'s drop deletes. |
| `d89f41ed1` | — | Committed plugin bundle refreshed (`build-extension.mjs`). |

## RED evidence (each fix failed before its source change)

Blocker 1 — runner `#given no registry snapshot on the input #when the runner launches #then it
warns, skips and spawns nothing`, run with a resolver spy that throws when consulted after the
handler returned:

```
error: expect(received).toBe(expected)
Expected: "skipped"
Received: "failed"      <- the resolver WAS consulted (spy threw) instead of a clean skip
(fail) MemorianGateRunner > #given no registry snapshot on the input ...
 11 pass  1 fail
```

Primitive — `PendingNudges.delete`:

```
TypeError: store.delete is not a function. (In 'store.delete("session-1")', 'store.delete' is undefined)
(fail) PendingNudges > #given a written payload #when deleted #then only that session's file is removed
(fail) PendingNudges > #given no payload for the session #when deleted #then it is a silent no-op
 2 fail
```

Blocker 2 — runner `#given a compaction accepted DURING the pending write #when the write completes
#then the landed file is retracted` (fake store whose `write` bumps the epoch mid-write, then
performs the real write):

```
error: expect(received).toBe(expected)
Expected: "skipped"
Received: "nudged"      <- the pre-compaction payload stayed on disk
(fail) MemorianGateRunner > #given a compaction accepted DURING the pending write ...
```

## GREEN

- `bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json` — clean.
- `bun x tsgo --noEmit -p packages/memory-core/tsconfig.json` — clean.
- `bun test packages/omo-senpi/src/components/memory/memorian-runner.test.ts packages/omo-senpi/src/components/memory/memorian-wiring.test.ts` — 23 pass, 0 fail.
- `bun test packages/memory-core/src/recall/` — 63 pass, 0 fail.
- `bun test packages/omo-senpi/src/components/memory/` — 1011 pass, 0 fail (144 files).

## Live driver re-run

Same driver (`memorian-gate-live-e2e.mjs`), `SENPI_BIN` pinned to the worktree
`node_modules/@code-yeongyu/senpi/dist/cli.js` (2026.8.31), output in `live-gate-postreview2/`.
Run ONCE.

**VERDICT: PASS — 7/7 scenarios, 41 assertions, 0 FAIL, driver exit 0.**

| # | Scenario | Verdict | Assertions |
|---|---|---|---|
| a | HAPPY | PASS | 13 |
| b | DISABLED | PASS | 5 |
| c | NO-CANDIDATES | PASS | 4 |
| d | INVALID-NUDGE | PASS | 5 |
| e | LOOP | PASS | 2 |
| f | REAL-CHILD | PASS | 4 |
| g | SINGLE-TURN | PASS | 5 |

Isolation re-verified by the driver: `realSenpiUntouched: true`, `realOmoMemoryUntouched: true`
(agents 416 -> 416, zero QA-attributable pending/token-bearing files), every sandbox removed.

Artifacts: `live-gate-postreview2/driver-result.json` (machine verdict, all 41 assertion records),
`live-gate-postreview2/driver-console.log` (PASS/FAIL lines rendered from that JSON — this run was
captured through a pipe rather than `tee`, so the console log is derived from the driver's own
result record, not retyped).
