# POST review-blocker fixes, round 3 — the final pair, live re-run pass

Follow-up to `post-review-fixes-2.md`. The reviewer's remaining objection was that round 2 closed the
epoch TOCTOU by *racing* the compaction (re-read the epoch after the write, delete on mismatch),
which narrows the window but never eliminates it: the reviewer's interleaving is a write that yields
mid-flight, a compaction that bumps the epoch inside that yield, and a rename that lands afterwards —
whoever wins that race decides whether a stale verdict survives.

**Design decision implemented: enforce staleness AT THE CONSUMPTION POINT.** The launch epoch travels
inside the pending payload; the consumer compares it against the session's live epoch and refuses
anything that does not match. The race becomes unwinnable-but-harmless, because no ordering of writer
and compaction can produce a payload the consumer accepts.

| Commit | Fix | What |
|---|---|---|
| `5a12fb5ba` | 1+2 RED | memory-core: epoch mismatch -> `[]` + file deleted; epoch match -> nudges; epoch-less payload -> stale; `delete("a/b")` must not unlink the file owned by `"a:b"`. |
| `cff61caf9` | 1 | `PendingNudgesFile` gains `compactionEpoch`. `write(sessionId, nudges, { epoch })` stamps it; `take(sessionId, { currentEpoch })` deletes-and-returns-`[]` whenever `payload.compactionEpoch !== currentEpoch`. A missing epoch is stale by the same rule (the feature is unreleased, so no old-format payload exists in the wild). sessionId + TTL guards unchanged. |
| `749fd6a42` | 2 | `delete(sessionId)` now reads the payload and verifies the embedded `sessionId` before unlinking, mirroring `take()`. `sanitizeSessionFilename` maps `"a:b"` and `"a/b"` onto one filename, so the unguarded unlink let one session retract another's nudges. Mismatch -> file left, no error. |
| `869819ea0` | RED | omo-senpi: the runner must stamp its launch epoch; the gate wiring must expose `currentCompactionEpoch`; the recall drain must pass the live epoch; and THE RACE test — a fake store that yields mid-write, bumps the epoch during the yield, completes the write, **with the post-write retraction disabled** — must still yield nothing at `take()`. |
| `ee077b57e` | 1 | Runner passes `{ epoch: input.compactionEpoch ?? 0 }` into `write()`. The pre-write early-out stays (a known-stale verdict needs no file at all). The post-write delete-on-mismatch stays as **best-effort hygiene only**, documented in-source as such: correctness no longer depends on it. |
| `b5e82ac01` | 1 | `MemorianGateWiring.currentCompactionEpoch(sessionId)` exposes the epoch map; `recall-wiring`'s `before_agent_start` drain threads it into `take()` the same way the pending store itself is threaded; `wiring.ts` late-binds the two mutually dependent wirings through a ref. `onCompactionAccepted`'s own drop passes the post-bump epoch, so it drops payloads on both sides of the bump. |
| `ef5d43676` | — | Committed plugin bundle refreshed (`build-extension.mjs`). |

## RED evidence

memory-core (`packages/memory-core/src/recall/gate.test.ts`, before `cff61caf9`/`749fd6a42`):

```
(fail) PendingNudges > #given a written file #when inspected #then the self-describing payload and mode are pinned
(fail) PendingNudges > #given a colliding filename owned by another session #when deleted #then the file survives
(fail) PendingNudges compaction epoch > #given a payload stamped with an older epoch #when taken at the bumped epoch #then nothing returns and the file is deleted
(fail) PendingNudges compaction epoch > #given a payload carrying no epoch #when taken #then it is treated as stale and deleted
 18 pass  4 fail
```

The collision guard's RED, verbatim — `delete("a/b")` removed the payload owned by `"a:b"`:

```
340 |     await store.delete("a/b")
341 |
342 |     // then
343 |     expect(await readdir(dir)).toEqual(namesBefore)
                                     ^
error: expect(received).toEqual(expected)

- [
-   "a-b.json",
- ]
+ []

(fail) PendingNudges > #given a colliding filename owned by another session #when deleted #then the file survives
 0 pass  1 fail
```

omo-senpi (before `ee077b57e`/`b5e82ac01`): **14 fail, 39 pass** across
`memorian-runner.test.ts` + `memorian-wiring.test.ts` + `recall-wiring.test.ts`, including

```
(fail) MemorianGateRunner > #given a launch epoch #when the nudges are written #then the payload carries that epoch
(fail) createMemorianGateWiring currentCompactionEpoch > #given an untouched session #when its epoch is read #then it is the launch-time default
(fail) createMemoryRecallWiring pending-nudge injection > #given a pending nudge from a superseded epoch #when the turn starts #then nothing is injected and the payload is dropped
```

### THE RACE test (the reviewer's exact interleaving, encoded)

`memorian-runner.test.ts` — the fake store yields mid-write, the compaction bumps the epoch inside
that yield, the write then completes, and `delete` is a **no-op** so the post-write retraction cannot
mask the bug:

```ts
test("#given a compaction that lands mid-write and no post-write retraction #when the next turn takes #then the stale payload is never consumed", async () => {
  let epoch = 4
  pendingNudges: {
    write: async (sessionId, nudges, options) => {
      await Promise.resolve()        // yield exactly where rename has not happened yet
      epoch = 5                      // the compaction lands inside the write
      await real.write(sessionId, nudges, options)
    },
    delete: async () => undefined,   // best-effort retraction DISABLED on purpose
  }
  await runner.launch(launchInput({ compactionEpoch: 4, currentCompactionEpoch: () => epoch }))
  expect(await real.take(SESSION_ID, { currentEpoch: epoch })).toEqual([])
  expect(existsSync(join(identityPaths.recallPending, `${SESSION_ID}.json`))).toBe(false)
})
```

It fails before the fix (the epoch-4 payload is consumed at epoch 5) and passes after, which is the
whole point: with the retraction disabled, only the consumption-point check can save it.

## GREEN

- `bun run typecheck` (tsgo) in `packages/memory-core` — clean.
- `bun run typecheck` (tsgo) in `packages/omo-senpi` — clean.
- `bun test src/recall/gate.test.ts` — **22 pass, 0 fail**.
- `bun test src/components/memory/{memorian-runner,memorian-wiring,recall-wiring}.test.ts` — **53 pass, 0 fail**.
- `bun test src/components/memory/{compaction-survival,wiring,index}.test.ts` — **27 pass, 0 fail**.
- `bun test src/` in `packages/memory-core` — **616 pass, 0 fail** (76 files).

## Live driver re-run

Same driver (`memorian-gate-live-e2e.mjs`), `SENPI_BIN_OVERRIDE` pinned to the worktree
`node_modules/@code-yeongyu/senpi/dist/cli.js` (**2026.8.31**), output in `live-gate-postreview3/`.
Run **ONCE**.

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

The new field is visible in the live payload the REAL senpi wrote, which is the end-to-end proof that
the epoch is stamped in production and not just in unit fixtures:

```
PASS SINGLE-TURN the judged nudge is parked for a turn that never came ::
  {"version":1,"sessionId":"01a05b6d-0000-7000-8000-00000000000f","compactionEpoch":0,
   "writtenAt":"2026-09-01T08:33:30.208Z","nudges":[{"path":"reference/project/test-note.md",...}]}
```

And the full write -> take -> inject -> consume loop still closes at a matching epoch:

```
PASS HAPPY the validated nudge persisted to the pending store after turn 1
PASS HAPPY turn 2 JSONL contains an omo-memorian:recall entry :: count=2
PASS HAPPY turn 2 content carries <recalled-memory source="[[reference/project/test-note.md]]"
PASS HAPPY the pending file was consumed by the injection
```

Isolation re-verified by the driver: `realSenpiUntouched: true`, `realOmoMemoryUntouched: true`
(agents 416 -> 416, zero QA-attributable pending/token-bearing files), every sandbox removed.

Artifacts: `live-gate-postreview3/driver-result.json` (machine verdict, all 41 assertion records),
`live-gate-postreview3/driver-console.log` (the run's captured stdout).
