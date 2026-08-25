# Task 4 evidence: event subscription wiring (`omo-native-parallel.ts`)

Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency`
Deliverables:
- `packages/omo-senpi/src/components/telemetry/omo-native-parallel.ts`
- `packages/omo-senpi/src/components/telemetry/omo-native-parallel.test.ts`

## Baseline

```
$ bun test packages/omo-senpi/src/components/telemetry/
 118 pass
 0 fail
 463 expect() calls
Ran 118 tests across 14 files. [2.51s]
```

(The task brief quoted 116; the wave-assembler author's concurrent in-worktree edits to
`wave-assembler.test.ts` add 2 more. 118/0 is the real baseline this task started from.)

## RED capture (test written first, implementation absent)

```
$ ls packages/omo-senpi/src/components/telemetry/omo-native-parallel.ts
ls: packages/omo-senpi/src/components/telemetry/omo-native-parallel.ts: No such file or directory

$ bun test packages/omo-senpi/src/components/telemetry/omo-native-parallel.test.ts
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/omo-native-parallel.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './omo-native-parallel' from '/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency/packages/omo-senpi/src/components/telemetry/omo-native-parallel.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [198.00ms]
```

Genuine RED: the module file did not exist when the test suite was first run. No stash was
needed; the test file was authored before any implementation byte.

### Second RED (leak defect found during adversarial probing)

While probing the "repeated interruptions" class I checked whether a stray event arriving
*after* `session_shutdown` re-creates the session entry. It did:

```
$ bun run /tmp/probe-resurrect.ts
size after post-shutdown end: 1
```

That is a real leak: nothing guarantees a second `session_shutdown`, so the resurrected entry
would live for the process lifetime, and its `start` was already discarded so the observation
carries no information. A failing test was added first:

```
$ bun test packages/omo-senpi/src/components/telemetry/omo-native-parallel.test.ts
(fail) omo-native parallel telemetry > #given a session that has recorded observations > #when session_shutdown is dispatched > #then a late end or turn end does not resurrect the cleared session [0.24ms]
 14 pass
 1 fail
```

Fix: only a `start` observation may open per-session state; `end` and `turn_end` operate on
existing state or are dropped. Documented in the module header.

## GREEN

```
$ bun test packages/omo-senpi/src/components/telemetry/omo-native-parallel.test.ts
(pass) omo-native parallel telemetry > #given overlapping tool execution start and end pairs on one session > #when the session snapshot is assembled > #then the observations form a single concurrency wave with the injected span
(pass) ... > #then only the tool call id and name are retained
(pass) #given sequential tool executions > ... > #then every call forms its own wave
(pass) #given a turn that starts with its own timestamp and ends without one > ... > #then the measured turn duration accumulates across turns
(pass) ... > #then a turn end without a preceding start contributes nothing
(pass) ... > #then a turn end stamped before the turn start is not counted as negative time
(pass) #given an injected clock instead of the real one > ... > #then every recorded timestamp comes from the injected clock
(pass) #given two independent sessions dispatching interleaved observations > ... > #then neither session sees the other session's calls
(pass) #given a session that has recorded observations > #when session_shutdown is dispatched > #then the session state is dropped and nothing leaks
(pass) ... > #then only the shutting-down session is dropped
(pass) ... > #then a shutdown mid sequence and a repeated shutdown are both safe
(pass) ... > #then a late end or turn end does not resurrect the cleared session
(pass) #given malformed or unknown event payloads > ... > #then no handler throws and no observation is recorded
(pass) ... > #then events without a resolvable session are ignored
(pass) #given a start whose end never arrives > ... > #then the call is counted as incomplete rather than paired

 15 pass
 0 fail
 28 expect() calls
Ran 15 tests across 1 file. [93.00ms]
```

Mandatory case coverage: (a) start/end pairs produce assembled waves - case 1; (b) post
`session_shutdown` state is empty - cases 9/10/11/12 (`registry.size() === 0` and
`snapshot(...) === undefined`); (c) malformed payloads do not throw - case 13 (13 hostile
shapes fanned out across all four subscribed events); (d) injected clock is used - case 7
(asserted timestamps 42/84, values no real clock can produce); (e) `turn_start.timestamp`
plus stamped end yields the measured duration - case 4 (2000->2750 plus 3000->3250 = 1000).

## Verification commands

```
$ bun run --cwd packages/omo-senpi typecheck
$ tsgo --noEmit -p tsconfig.json
(exit 0, no output)

$ bun test packages/omo-senpi/src/components/telemetry/
 133 pass
 0 fail
 491 expect() calls
Ran 133 tests across 15 files. [1448.00ms]
```

133 = 118 baseline + 15 new. 0 fail.

LOC check (pure, comments and blanks excluded): implementation 143, test 232. Both under the
250 ceiling. `rg 'as any|@ts-ignore|em dash|emoji'` over both files: no banned tokens.

## Manual QA

Throwaway script `/tmp/qa-parallel-task4.ts` built a fake `pi` capturing handlers, registered
the module with an injected clock, and fired: `turn_start` (timestamp 10000), three
overlapping `tool_execution_start`/`tool_execution_end` pairs (t1 10100-10700, t2 10150-10600,
t3 10200-10800), `turn_end` at clock 11000, then `session_shutdown`.

Verbatim stdout of `bun run /tmp/qa-parallel-task4.ts`:

```
registry size before shutdown: 1
wave count: 1
wave[0] spanMs=700 maxConcurrency=3 calls=[{"toolCallId":"t1","toolName":"bash","startMs":10100,"endMs":10700},{"toolCallId":"t2","toolName":"read","startMs":10150,"endMs":10600},{"toolCallId":"t3","toolName":"grep","startMs":10200,"endMs":10800}]
counters: {"observedCalls":3,"pairedCalls":3,"incomplete":0,"clockAnomalies":0,"droppedCalls":0,"malformed":0}
measured_turn_duration_ms_total: 1000
snapshot contains raw args/result: false
post-shutdown registry size: 0
post-shutdown snapshot: undefined
RESULT: PASS
```

Binary observable: expected wave count 1, span 700 from the injected timestamps
(10800 - 10100), `maxConcurrency` 3, measured turn duration 1000 (turn_start.timestamp 10000
to stamped turn end 11000), and post-shutdown state size 0. All match; `RESULT: PASS`.

## Adversarial classes

- **Malformed input** - probed. 13 shapes (`null`, `undefined`, string, number, array, missing
  `toolCallId`, empty `toolCallId`, missing `toolName`, numeric `toolCallId`, wrong `type`,
  `end` for an unknown call id, `turn_start` with no timestamp, `turn_start` with a string
  timestamp) fanned across all four handlers. No throw, zero waves, zero accumulated turn
  duration. Events whose context yields no session id are dropped without creating state.
- **Stale state** - probed. Two sessions dispatching interleaved starts and ends keep disjoint
  observations (`session-a` sees only `a`, `session-b` only `b`), a shutdown for one session
  leaves the other intact, and after shutdown the session's entry is gone.
- **Flaky tests** - ruled out by construction. Zero real-clock reads (the one `Date.now()` in
  the test file is asserted *against* the injected values to prove the injected clock won),
  zero sleeps, zero timers, zero randomness; the fake dispatch is synchronous.
- **Repeated interruptions** - probed and it found a real defect. A `session_shutdown`
  mid-sequence followed by the orphaned `tool_execution_end` used to resurrect the entry; a
  second shutdown for the same session is a no-op `Map.delete`. Both are now covered by tests
  and the resurrection is fixed.
- **Concurrency / interleaving of the assembler cap** - ruled out here: this module never calls
  `assembleWaves` incrementally. Observations are buffered and funnelled through exactly one
  assembly call in `snapshot()`, so `MAX_TRACKED_CALLS` is applied once per session as intended.
- **Privacy leakage** - ruled out: the parser reads only `toolCallId` and `toolName`; a test
  and the QA script both assert the serialized snapshot contains none of the injected `args` or
  `result` payloads.

## Measurement caveat (documented in the module header)

Senpi's tool-execution events carry no timestamps, so the handler stamps arrival time from the
injected clock as its first statement. Every span therefore inherits handler-entry skew on both
edges: a call's measured duration is the window between two handler entries, not the tool's
internal runtime. `turn_start` does carry `timestamp` and is trusted as-is, so turn boundaries
are asymmetric by design.

## Scope receipts

- No telemetry event is emitted here (emission is todo 6).
- No eval-classifier adapter built (todo 6 owns mapping assembler `calls` to `toolNames`).
- Untouched: `wave-assembler.ts`, `savings-math.ts`, `eval-classifier.ts`, `product-identity.ts`,
  `product-identity.test.ts`, `docs/reference/senpi-telemetry.md`.
- Not added to `index.ts` (the barrel excludes its siblings too).
- `packages/omo-senpi/plugin/extensions/*.js` remained clean throughout (`git status --porcelain`
  on that path returned nothing; no checkout needed).

## Cleanup receipt

`/tmp/qa-parallel-task4.ts`, `/tmp/qa-parallel-task4.out`, and `/tmp/probe-resurrect.ts` were
deleted after the output above was captured verbatim.

## Commands run

```
bun test packages/omo-senpi/src/components/telemetry/                                  # baseline 118/0
bun test packages/omo-senpi/src/components/telemetry/omo-native-parallel.test.ts       # RED (module missing)
bun run /tmp/probe-resurrect.ts                                                        # leak probe
bun test packages/omo-senpi/src/components/telemetry/omo-native-parallel.test.ts       # RED (resurrection test)
bun test packages/omo-senpi/src/components/telemetry/omo-native-parallel.test.ts       # GREEN 15/0
bun run --cwd packages/omo-senpi typecheck                                             # exit 0
bun test packages/omo-senpi/src/components/telemetry/                                  # 133/0
bun run /tmp/qa-parallel-task4.ts                                                      # RESULT: PASS
rm /tmp/qa-parallel-task4.ts /tmp/qa-parallel-task4.out /tmp/probe-resurrect.ts
```
