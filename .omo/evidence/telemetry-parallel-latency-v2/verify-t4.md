# Adversarial verification: todo 4 (`omo-native-parallel.ts`)

Verifier: independent (did not implement todo 4). Commit under verification: `7692e58f2`.
Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency`
HEAD at verification time was exactly `7692e58f2` with a clean `git status`, so every measurement
below is of todo 4's own commit and not of concurrent workers' output.

```
AdversarialVerify
verdict: confirmed
evidence: |
  $ git show --stat 7692e58f2
   .omo/evidence/telemetry-parallel-latency-v2/task-4.md        | 207 ++++++++++++++
   .../telemetry/omo-native-parallel.test.ts                     | 300 +++++++++++++++++++++
   .../components/telemetry/omo-native-parallel.ts               | 183 +++++++++++++
   3 files changed, 690 insertions(+)

  $ git show --name-only --pretty=format: 7692e58f2 | grep -E "wave-assembler|savings-math|eval-classifier|product-identity|senpi-telemetry.md|telemetry-core|omo-codex|omo-opencode|plugin/extensions|index\.ts"
  NONE (clean)

  $ bun test packages/omo-senpi/src/components/telemetry/
   133 pass
   0 fail
   491 expect() calls
  Ran 133 tests across 15 files. [2.60s]

  $ bun run --cwd packages/omo-senpi typecheck
  $ tsgo --noEmit -p tsconfig.json
  (exit 0, no output)

  $ bun run /tmp/vt4-probe.ts            # independent driver, own fake pi (not repo test-support)
  === ITEM 8: QA REPRODUCTION ===
  size before shutdown: 1
  wave count: 1
  spanMs: 700 maxConcurrency: 3
  counters: {"observedCalls":3,"pairedCalls":3,"incomplete":0,"clockAnomalies":0,"droppedCalls":0,"malformed":0}
  measured_turn_duration_ms_total: 1000
  post-shutdown size: 0 post-shutdown snapshot: undefined

  $ bun test /tmp/vt4scratch/mutated.test.ts   # default `now` mutated to () => 777777
   15 pass
   0 fail

  $ bun run /tmp/vt4scratch/assembly-count.ts  # assembleWaves instrumented in a scratch copy
  assembleWaves calls after 2500 pairs and zero snapshots: 0
  assembleWaves calls after ONE snapshot(): 1
  observations fed to that single assembly: 5000 (expect 5000 )
  counters: {"observedCalls":2500,"pairedCalls":2000,"incomplete":0,"clockAnomalies":0,"droppedCalls":500,"malformed":0}

  $ bun run /tmp/vt4scratch/handoff.ts
  A) module registered FIRST, todo-6 consumer SECOND: consumer observed -> undefined (EMPTY); registry size after = 0
  B) todo-6 consumer registered FIRST, module SECOND: consumer observed -> paired=1 turnMs=600; registry size after = 0
  C) consumer reads registry on turn_end: paired=1 turnMs=600; registry size after shutdown = 0
repro: |
  No blocking defect found. Two non-blocking findings, both reproducible:
  (F1) post-shutdown `turn_start` residue:
    fire session_shutdown for session S, then turn_start{timestamp:9000} for S
    -> registry.size() === 1 with an empty snapshot, contradicting the module header's
       "Only a `start` observation may open per-session state".
  (F2) evidence LOC mismatch:
    awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/)/' packages/omo-senpi/src/components/telemetry/omo-native-parallel.ts | wc -l
    -> 162, while task-4.md claims 143. Both under the 250 ceiling.
confidence: 0.93
```

## Acceptance-criterion table

Plan todo 4 criteria are: (a) start/end pairs assemble into waves, (b) session state empty after
`session_shutdown`, (c) unknown payload shapes do not throw; plus the MUST NOTs (no event emission
here, no `args`/`result` storage) and the repo conventions.

| Criterion | Result | Exact observation |
| --- | --- | --- |
| (a) start/end pairs assemble into waves | PASS | Own driver: 3 overlapping pairs -> `wave count: 1`, `spanMs: 700`, `maxConcurrency: 3`, `pairedCalls:3`. Sequential pairs -> one wave each. |
| (b) state empty after `session_shutdown` | PASS | `post-shutdown size: 0`, `post-shutdown snapshot: undefined`; leak matrix L1/L2/L4/L5/L6/L8 all size 0. |
| (c) malformed payloads do not throw | PASS | 25 hostile shapes x 5 events x 4 context variants = 500 dispatches, `throws: 0`, `registry size: 0`, `snapshot: undefined`. |
| MUST NOT: no event emitted here | PASS | Module exposes `snapshot()` only; no `captureEvent` import or call (`grep` on the file: none). |
| MUST NOT: never store `args` / `result` | PASS | Distinctive 80-char needles injected into `args` and `result`; `snapshot contains args needle: false`, `contains result needle: false`, `full dump contains any needle: false`. |
| `turn_start.timestamp` trusted, turn end stamped | PASS | `turn_start{timestamp:10000}` + `turn_end` at injected clock 11000 -> `measured_turn_duration_ms_total: 1000`. |
| Arrival stamp is first statement in each stamping handler | PASS | `omo-native-parallel.ts:100,105,118`: `const atMs = now()` is line 1 of the `tool_execution_start`, `tool_execution_end`, and `turn_end` handlers. `turn_start` correctly does not stamp. |
| Injected clock threaded through every timestamp | PASS | Default `now` mutated to a constant in a scratch copy: 15/15 tests still pass, so no test reads the real clock. Test file has zero `setTimeout`/`performance.now`/randomness; the single `Date.now()` (line 149) is asserted only as `> 1_000_000` and is not a timing dependency. |
| Session isolation | PASS | Interleaved two-session drive: `s1 ids: [["a1","a2"]] turnMs: 600`, `s2 ids: [["b1"]]`; counters disjoint. |
| Suite 133 pass / 0 fail | PASS | `133 pass, 0 fail, 491 expect() calls, 15 files`. |
| Typecheck green | PASS | `tsgo --noEmit -p tsconfig.json`, exit 0, no output. |
| Diff scope (only 2 new files + evidence) | PASS | `git show --stat` lists exactly those three paths; forbidden-path grep returns nothing. |
| No `as any` / `@ts-ignore` / emoji / em dash | PASS | grep + perl unicode scan over both files: NONE. |
| given/when/then convention (AGENTS.md:292) | PASS | 17 nested `describe` blocks with `#given`/`#when`/`#then` prefixes AND 15 inline `// given` markers. Not a flat single-line title. |
| Pure LOC under 250 | PASS (evidence number wrong) | Mandated awk: impl **162** (task-4.md claims 143), test **232** (matches). Both under 250. |

## Item 1: leak-probe matrix (independent driver, own fake pi)

`registry.size()` measured after each shape.

| # | Shape | size | Verdict |
| --- | --- | --- | --- |
| L1 | start, end, `session_shutdown`, then **late `tool_execution_end`** | **0** (snapshot `undefined`) | PASS - the fixed defect does not reproduce |
| L2 | turn_start, turn_end, `session_shutdown`, then **late `turn_end`** | **0** (snapshot `undefined`) | PASS |
| L3 | start, `session_shutdown`, then **late `tool_execution_start`** | **1** (`observedCalls:1, incomplete:1`) | BY DESIGN - the author's stated rule explicitly allows a `start` to open state |
| L3b | start, `session_shutdown`, then **late `turn_start`** | **1** (empty snapshot) | FINDING F1 - contradicts the header's "only a `start` observation may open state" |
| L3c | `session_shutdown` on a never-seen session, then `turn_start` | **1** (empty snapshot) | FINDING F1 (same root cause: `startTurn` calls `ensure()`) |
| L4 | two `session_shutdown` for the same session | **0** | PASS - `Map.delete` is idempotent |
| L5 | `session_shutdown` for a session that never existed | **0** | PASS |
| L6 | two sessions, interleaved starts/ends, interleaved shutdowns | **0** (mid-sequence 1) | PASS - shutting down s1 left s2 intact, then s2 cleared |
| L7 | `session_shutdown` with unresolvable session (no ctx / `{}`) | **1** (live session survives) | PASS - correct: an unattributable shutdown must not wipe a live session |
| L8 | `session_shutdown` with wrong payload `type` | **0** | PASS - the handler intentionally ignores the payload and clears on the event name |

Adversarial growth check on F1: 1000 x (`session_shutdown` then late `turn_start`) leaves
`registry size = 1000`; the same loop with a late `tool_execution_start` also leaves 1000.

**Is F1 a blocker? No, and here is the reasoning I would defend.** The residue entries are
*empty* (`observedCalls:0`, `measuredTurnDurationMsTotal:0`), so no metric is corrupted. In the real
senpi lifecycle `session_shutdown` carries `reason: "quit" | "reload" | "new" | "resume" | "fork"`
(`types.d.ts:716-721`), and for `reload`/`resume` the same session id legitimately continues; the
reload cycle I drove (D1) shows the resumed session is clean (`turnMs 400`, prior 500 correctly
discarded) and the terminal shutdown returns size to 0. So allowing a *new turn* to reopen state is
coherent behavior; what is not coherent is the module header claiming only a `start` observation
can do it while `startTurn` calls `ensure()`. **The defect the author claims to have found and fixed
is real and complete for the shapes it names** (L1, L2 both clean). F1 is a documentation/invariant
mismatch on an adjacent path, recorded as a finding rather than a blocker.

## Item 3: single-assembly count

Instrumented `assembleWaves` in a scratch copy and drove 2500 start/end pairs (above
`MAX_TRACKED_CALLS = 2000`) through one session:

- `assembleWaves` calls after 2500 pairs and **zero** `snapshot()` calls: **0**
- after **one** `snapshot()`: **1**
- observations handed to that single call: **5000** (the whole session buffer, not a batch)
- after a second `snapshot()`: **2** (i.e. exactly 1 per call, no memoization, no per-batch assembly)
- resulting counters: `pairedCalls:2000, droppedCalls:500`

The 500 drops prove the cap is applied **once across the whole session**, not reset per batch. The
claim holds and the todo-1 repair is not defeated.

Related non-blocking observation for todo 6: the *raw observation buffer* in `SessionState` is itself
unbounded - 200k starts on one session retained ~11.9 MiB of heap while still reporting
`droppedCalls:198000`. The cap bounds assembly output, not resident input. Not in todo 4's acceptance
criteria (the plan puts `MAX_TRACKED_CALLS` on todo 1), and unreachable at realistic session sizes,
but todo 6 should not assume the buffer is bounded.

## Item 7: handoff hazard verdict (guidance for todo 6)

**The hazard is real, and the `registry` option is NOT by itself the escape hatch.** Measured:

| Registration order | What the consumer's `session_shutdown` handler sees |
| --- | --- |
| A: this module first, todo-6 consumer second | `snapshot(id)` -> **`undefined`** (data already cleared) |
| B: todo-6 consumer first, this module second | `paired=1 turnMs=600` (full data) |
| C: consumer snapshots on `turn_end` instead of `session_shutdown` | `paired=1 turnMs=600` (full data) |

Scenario A used a caller-supplied `registry` and still lost everything: passing `registry` shares the
*object*, it does not change handler ordering, and `FakeExtensionAPI.dispatch` (and senpi's real
dispatcher) invokes handlers in registration order. So the escape hatch as described in the evidence
("a `registry` option is provided") is insufficient on its own.

Actionable guidance for todo 6, in preference order:

1. **Preferred - do not read on `session_shutdown` at all.** Own the registry via the `registry`
   option and snapshot on a lifecycle event that fires before teardown (`turn_end` or
   `agent_settled`). Scenario C confirms this works regardless of registration order and still ends
   at `registry.size() === 0` after shutdown. This is the only option that is not order-fragile.
2. **Acceptable - register the emitting `session_shutdown` handler BEFORE
   `registerOmoNativeParallelTelemetry(pi, ...)`** inside `omo-native-component.ts`'s `register()`
   body (that file already sequences every telemetry registration linearly at lines 62-96, so this is
   a one-line ordering decision the author fully controls). Scenario B confirms it works. If todo 6
   takes this route, it MUST pin the ordering with a regression test, because the guarantee is
   invisible at the call site and a future reorder silently turns `parallelism_summary` into a no-op
   emitting zeros. Note this collides with the plan's success criterion that
   `parallelism_summary` fires exactly once per session and is proven "not a no-op caused by
   registration order" - that test is mandatory, not optional.
3. **Do not** register the consumer after the module and read on shutdown. That is scenario A and it
   emits nothing.

## Other probes (no findings against todo 4)

- **Malformed input**: 25 shapes (`null`, `undefined`, `""`, `"str"`, `0`, `42`, `[]`, `[1,2]`,
  `true`, a `Symbol`, missing `toolCallId`, missing `toolName`, `null`/numeric/empty ids, wrong
  `type`, unknown-id `end`, `turn_start` with no/string/`NaN`/negative/`Infinity` timestamp,
  `turn_end` bare, `Object.create(null)`, a `Map`, and a self-referential cyclic object) crossed with
  5 events and 4 context variants (valid, `null`, numeric session id, non-function `getSessionId`):
  **0 throws, 0 state opened, snapshot `undefined`**. Cyclic payloads do not hang or throw because
  only two scalar fields are read.
- **Nested/overlapping turns** (two `turn_start` then two `turn_end`): `600`, i.e. the second start
  wins and the orphaned end is dropped. No negative or double counting.
- **Negative turn duration** (`turn_end` stamped before `turn_start.timestamp`): contributes 0, not a
  negative number.
- **A `getSessionId` that throws** propagates out of the handler. This is *not* a todo-4 regression:
  `extractSessionId` here is byte-equivalent in behavior to the established sibling
  `omo-native-tools.ts:174-180`, `eventContext` is host-supplied (trusted boundary, not
  attacker-controlled), and the plan's criterion (c) covers unknown *payloads*, all of which pass.
- **Duplicate `toolCallId` reuse** loses the first start (`observedCalls:2, pairedCalls:1`). That is
  `wave-assembler.ts` (todo 1) pending-map behavior, outside todo 4's diff, and senpi guarantees
  unique tool call ids.

## Findings summary (non-blocking)

- **F1** - `registry.startTurn` calls `ensure()`, so `turn_start` opens session state. The module
  header (lines 16-18) asserts "Only a `start` observation may open per-session state". The code and
  the comment disagree; a post-shutdown `turn_start` leaves a permanent empty entry if no further
  shutdown arrives. Suggested one-line follow-up for whoever owns todo 6: either reword the header to
  "only a `start` observation or a `turn_start` may open state" or make `startTurn` non-creating.
- **F2** - `task-4.md` reports implementation pure LOC as 143; the mandated awk command measures
  **162**. The test file's 232 is accurate. Ceiling not breached either way.
- **F3** - the per-session raw observation array is unbounded (see item 3). Informational for todo 6.

## Cleanup receipt

Scratch artifacts created and deleted: `/tmp/vt4-probe.ts`, `/tmp/vt4scratch/` (containing
`orig.ts`, `mutated-clock.ts`, `mutated.test.ts`, `counted.ts`, `assembly-count.ts`, `growth.ts`,
`deep.ts`, `handoff.ts`). All scratch copies lived outside the repository; no tracked source or test
file was modified at any point.

```
$ rm -rf /tmp/vt4scratch /tmp/vt4-probe.ts && ls /tmp | grep -i "vt4|qa-parallel|probe-resurrect"
NO SCRATCH REMAINS

$ git status --porcelain
(empty)

$ git log --oneline -1
7692e58f2 feat(omo-senpi): wire turn and tool-execution events for parallelism telemetry
```

## Commands run

```
git show --stat 7692e58f2
git show --name-only --pretty=format: 7692e58f2 | grep -E "<forbidden paths>"
bun test packages/omo-senpi/src/components/telemetry/                      # 133 pass / 0 fail
bun run --cwd packages/omo-senpi typecheck                                 # exit 0
bun run /tmp/vt4-probe.ts                                                  # items 1,4,5,6,7,8
bun test /tmp/vt4scratch/mutated.test.ts                                   # item 2, constant default clock
bun run /tmp/vt4scratch/assembly-count.ts                                  # item 3
bun run /tmp/vt4scratch/growth.ts                                          # unbounded-growth probe
bun run /tmp/vt4scratch/deep.ts                                            # reload cycle, nested turns, hostile ctx
bun run /tmp/vt4scratch/handoff.ts                                         # item 7
awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/)/' <each file> | wc -l       # 162 / 232
grep -n "as any|@ts-ignore|em dash" + perl unicode emoji scan              # NONE
rm -rf /tmp/vt4scratch /tmp/vt4-probe.ts
git status --porcelain                                                     # clean
```

`bun install` was never run.
