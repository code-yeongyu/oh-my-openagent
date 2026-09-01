# POST review-blocker fixes — live re-run pass

> **SUPERSEDED — see `post-review-fixes-2.md`.** Two further blockers (the runner's residual
> `resolveModelRegistry` fallback and the epoch TOCTOU across `PendingNudges.write`) were fixed
> afterwards and the driver re-run: 7/7 PASS (`live-gate-postreview2/`).

Follow-up to `post-stale-ctx-fix.md`. Three review blockers plus one packaging gap, each fixed
TDD RED-first on `feat/memorian-gate`:

| Commit | Blocker | What |
|---|---|---|
| `4c45d7662` | 1 — quick fallback leak | `resolveReflectionModel` answers `resolved` for its beyond-category ladder too (`source: registry_fallback` / `session_inherit`), so a dead quick chain let the gate launch on an arbitrary registry model. The runner now treats any resolution carrying a `source` as unavailable: warn + skip, no fallback. |
| `c6975b286` | 2 — post-handler eventCtx access | The detached task fell back to `collectCandidates(eventCtx)` when `snapshotSession` returned undefined, rereading a ctx the host had already disposed. `snapshotSession` + `collectCandidatesFromSnapshot` are now REQUIRED, the ctx-reading fallback is gone from the gate wiring, `eventCtx` never enters the detached closure, and an incomplete snapshot warns (`omo-senpi memorian gate session snapshot incomplete`) and no-ops. |
| `29b0d8629` | 3 — in-flight gate survives compaction | Per-session compaction epoch (`Map<sessionId, number>` in the wiring): stamped on the launch, bumped unconditionally in `onCompactionAccepted` (the pending-file drop stays), compared in the runner immediately before `PendingNudges.write`. A mismatch discards with `memorian gate nudges dropped after compaction` and returns `skipped`. |
| `281ae3198` | NOTE — packing validation | `extensions/memorian-persona.md` added to `REQUIRED_PLUGIN_ARTIFACTS`; `plugin/scripts/install.mjs` REGENERATED via `build-install.mjs` (never hand-edited). |
| `2bde9a325` | — | Committed plugin bundle refreshed (`build-extension.mjs`); wiring/runner are bundled into `extensions/omo.js`. |

## RED evidence (each fix failed before its source change)

Blocker 1 — `#given no quick category but another usable registry model ... #then it warns, skips
and never rides the beyond-category ladder`:

```
error: expect(received).toBe(expected)
Expected: "skipped"
Received: "failed"      <- the gate LAUNCHED on the beyond-category model
```

Blocker 2 — `#given an incomplete session snapshot #when the ctx is invalidated after the handler
returns ...`:

```
error: expect(received).toEqual(expected)
  [
-   "omo-senpi memorian gate session snapshot incomplete",
+   "omo-senpi memorian gate failed",   <- stale-ctx throw from the detached reread
  ]
```

Blocker 3 — runner `#given a compaction accepted mid-flight ... #then the stale nudges are
discarded instead of written` FAILED (nudges written); wiring `#given a gate child in flight #when a
compaction is accepted mid-flight #then the launch's epoch check reports the verdict as stale`
FAILED (`compactionEpoch` / `currentCompactionEpoch` absent: `Expected: > -1, Received: -1`).

NOTE — `#given a packed plugin missing the memorian persona #when installing #then artifact
validation fails before settings change`:

```
error: expect(received).rejects.toThrow(expected)
Expected promise that rejects
Received promise that resolved   <- packing accepted a plugin missing the persona
```

## GREEN

- `bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json` — clean.
- `bun test packages/omo-senpi/src/components/memory/` — 1009 pass, 0 fail (144 files).
- `bun test packages/omo-senpi/src/install/` — 24 pass, 0 fail.

## Live driver re-run

Same driver (`memorian-gate-live-e2e.mjs`), `SENPI_BIN` pinned to the worktree
`node_modules/@code-yeongyu/senpi/dist/cli.js` (2026.8.31), output in `live-gate-postreview/`.

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

Isolation re-verified by the driver itself: `realSenpiUntouched: true`,
`realOmoMemoryUntouched: true` (agents 414 -> 414, zero QA-attributable pending/token-bearing
files), every sandbox removed.

Artifacts: `live-gate-postreview/driver-console.log`, `live-gate-postreview/driver-result.json`.
