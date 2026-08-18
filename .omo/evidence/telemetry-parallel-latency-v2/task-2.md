# Task 2 - `savings-math.ts` (honesty-labeled parallel savings math)

Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency`
Commit: `feat(omo-senpi): add honesty-labeled parallel savings math`

## Deliverables

- `packages/omo-senpi/src/components/telemetry/savings-math.ts` (84 LOC, under the 200 soft limit)
- `packages/omo-senpi/src/components/telemetry/savings-math.test.ts` (12 tests)

Not added to `index.ts` on purpose: the telemetry barrel does not export `wave-assembler` or
`eval-classifier` either, and this module is consumed by todo 6 wiring, not by the public surface.

## Contract

| Function | Formula | Return type |
| --- | --- | --- |
| `modeledWallClockSavedMs(wave)` | `sum(dᵢ) - wave.spanMs`, `0` when N<=1 | `{ label: "modeled"; valueMs: number }` |
| `upperBoundSavedMs(wave)` | `(N-1) * mean(dᵢ)`, `0` when N<=1 | `{ label: "upper_bound"; valueMs: number }` |
| `savedRoundTrips(waves)` | `Σ max(maxConcurrency_b - 1, 0)` | `number` |

`wave.spanMs` is read, never recomputed from `maxEnd - minStart`: the assembler already owns that
boundary semantics and recomputing would let the two definitions silently diverge.

`MeasurableWave` is the structural subset `{ calls: readonly { startMs; endMs }[]; spanMs; maxConcurrency }`,
so `ConcurrencyWave` from `wave-assembler.ts` is assignable with no adapter. Verified by typechecking a
throwaway probe that passes a declared `ConcurrencyWave` straight into all three functions:

```
$ bun run --cwd packages/omo-senpi typecheck   # with assignability-probe.ts present
$ tsgo --noEmit -p tsconfig.json
ASSIGNABLE: OK
```

## RED capture (genuine, before any implementation existed)

The test file was written first. `savings-math.ts` did not exist at this point and had never been
written - no `git stash` was involved.

```
$ ls packages/omo-senpi/src/components/telemetry/savings-math.ts
ls: packages/omo-senpi/src/components/telemetry/savings-math.ts: No such file or directory

$ bun test packages/omo-senpi/src/components/telemetry/savings-math.test.ts
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/savings-math.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './savings-math' from '/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency/packages/omo-senpi/src/components/telemetry/savings-math.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [205.00ms]
```

## GREEN

```
$ bun test packages/omo-senpi/src/components/telemetry/savings-math.test.ts
 12 pass
 0 fail
 31 expect() calls
Ran 12 tests across 1 file. [107.00ms]

$ bun run --cwd packages/omo-senpi typecheck
$ tsgo --noEmit -p tsconfig.json
(no output, exit 0)
```

Whole telemetry suite, baseline was 103 pass / 0 fail across 13 files:

```
$ bun test packages/omo-senpi/src/components/telemetry/
 115 pass
 0 fail
 433 expect() calls
Ran 115 tests across 14 files. [2.08s]
```

103 + 12 = 115, zero regressions.

## Mandatory cases

| Case | Assertion | Result |
| --- | --- | --- |
| (a) simultaneous 4-call | modeled 6.00 | pass |
| (b) long-tail | modeled 0.90, upperBound ~7.43, asserted to differ | pass |
| (c) N=1 | modeled 0, upperBound 0, savedRoundTrips 0 | pass |
| (d) N=0 | all zero, no NaN | pass |
| (e) span 10 > sum 2 | `-8` returned, not clamped to 0 | pass |
| (f) chained | modeled 2.00 and explicitly `not.toBe(9.0)` | pass |
| (g) chained maxConcurrency=2 | savedRoundTrips 1, and `not.toBe(calls.length - 1)` | pass |

`toBeCloseTo` is used for the float cases. `toBe(7.43)` would fail: the exact upper bound is
`3 * (9.9 / 4) = 7.425`.

## Honesty label enforced at the type level

Substituting the upper bound where a modeled value is expected is a compile error, so no caller can
launder one into the other without a greppable cast:

```
$ cat packages/omo-senpi/src/components/telemetry/label-probe.ts
import { upperBoundSavedMs, type MeasurableWave, type ModeledSavedMs } from "./savings-math"
declare const wave: MeasurableWave
export const smuggled: ModeledSavedMs = upperBoundSavedMs(wave)

$ bun run --cwd packages/omo-senpi typecheck
src/components/telemetry/label-probe.ts(4,14): error TS2322: Type 'UpperBoundSavedMs' is not assignable to type 'ModeledSavedMs'.
  Types of property 'label' are incompatible.
    Type '"upper_bound"' is not assignable to type '"modeled"'.
```

Probe deleted afterwards; it is not part of the commit.

## MUTATION PROOF (misleading-success class)

Temporarily flipped the subtrahend from `wave.spanMs` to `Math.max(...durations)` - the exact B1
regression the plan forbids:

```
-  return { label: "modeled", valueMs: sum(durations) - wave.spanMs }
+  return { label: "modeled", valueMs: sum(durations) - Math.max(...durations) }
```

```
$ bun test packages/omo-senpi/src/components/telemetry/savings-math.test.ts
136 |         expect(modeled.valueMs).toBeCloseTo(2.0, 10)
                                      ^
error: expect(received).toBeCloseTo(expected, precision)

Expected: 2
Received: 9

Expected precision: 10
Expected difference: < 0.00000000005
Received difference: 7

      at <anonymous> (.../savings-math.test.ts:136:33)
(fail) parallel savings math > #given a chained wave where A overlaps B and B overlaps C > #when the modeled saving is computed > #then it uses the wave span and never the longest single duration [1.81ms]

 10 pass
 2 fail
 30 expect() calls
```

Case (f) reports 9 instead of 2, the documented 4.5x overstatement. Case (e) also failed, which is
the negative-clamp guard doing its job. Reverted immediately, re-run: `12 pass / 0 fail`.

## MANUAL QA

Throwaway script `/tmp/savings-qa.ts`, run with `bun run /tmp/savings-qa.ts`. It builds each scenario
through the real `assembleWaves` rather than hand-written fixtures, so `spanMs` and `maxConcurrency`
are genuine assembler output.

```
$ bun run /tmp/savings-qa.ts
wave          N  sum(d)  span   modeled  upperBound  maxConc  savedRT
------------  -  ------  -----  -------  ----------  -------  -------
simultaneous  4  8.20    2.20   6.00     6.150       4        3
long-tail     4  9.90    9.00   0.90     7.425       4        3
chained       3  14.00   12.00  2.00     9.333       2        1
single        1  4.00    4.00   0.00     0.000       1        0
```

Binary verdict: **PASS**.
- chained row: `modeled 2.00`, `savedRT 1` (not 9.00, not 2) - required.
- long-tail row: `modeled 0.90` beside `upperBound 7.425` - required.
- simultaneous row: span 2.20 equals `max(dᵢ)`, so an honest simultaneous batch keeps its 6.00 and the
  span rule costs nothing on true parallelism.

## Adversarial classes

| Class | Probe | Outcome |
| --- | --- | --- |
| Malformed input - NaN duration | call with `endMs: NaN` alongside two valid 4ms calls | dropped, modeled `4`, no NaN leaked |
| Malformed input - Infinity duration | call with `endMs: Infinity` | dropped, N drops to 1, modeled `0` |
| Malformed input - reversed interval | `startMs: 10, endMs: 2` | dropped, modeled `0` |
| Malformed input - empty calls array | `calls: []` | all metrics `0`, `savedRoundTrips([])` also `0` |
| Malformed input - non-finite `spanMs` | `spanMs: NaN` | modeled `0`, no NaN reaches the metric |
| Malformed input - non-finite `maxConcurrency` | `maxConcurrency: NaN` | wave skipped, `savedRoundTrips` returns `0` |
| Malformed input - unsorted intervals | chained calls listed C, A, B | identical result to sorted order |
| Flaky tests | 5 repeated evaluations compared as a `Set` of size 1 | deterministic; no clock reads, no timers, no sleeps anywhere in the module or its test |
| Misleading success output | `max` variant mutation | test suite fails loudly on case (f); see MUTATION PROOF |

Ruled out with reason:
- **Concurrency / race conditions**: module is pure functions over immutable inputs, no shared mutable state.
- **IO / filesystem / network**: no imports outside the type-only structural contract.
- **Resource exhaustion**: no allocation proportional to anything but the caller-supplied wave, and the
  assembler already caps at `MAX_TRACKED_CALLS = 2000`.
- **Privacy leakage**: only numeric timestamps are consumed; no tool names, args, or results are read.

## Cleanup receipt

- `rm /tmp/savings-qa.ts` - done, `ls /tmp/savings-qa.ts` reports no such file.
- `rm /tmp/assignability-probe.ts` and the copied `assignability-probe.ts` - done.
- `rm packages/omo-senpi/src/components/telemetry/label-probe.ts` - done.
- `/tmp/savings-math.orig.ts` (mutation backup) - removed after revert.
- No `bun install` or any dependency install command was run at any point.
- `packages/omo-senpi/plugin/extensions/*.js` build artifacts untouched.

## Commands run

```
bun test packages/omo-senpi/src/components/telemetry/                       # baseline 103/0, final 115/0
bun test packages/omo-senpi/src/components/telemetry/savings-math.test.ts   # RED then 12/0
bun run --cwd packages/omo-senpi typecheck                                  # exit 0
bun run /tmp/savings-qa.ts                                                  # QA table above
```

## Risks

- `savedRoundTrips` trusts `maxConcurrency` from the assembler. If todo 4 ever feeds hand-built waves
  with a stale or recomputed concurrency value, the round-trip count degrades silently. The chained
  regression test pins the assembler-produced value, not a fixture-invented one.
- A wave whose calls are all malformed collapses to N=0 and reports `0` savings while
  `savedRoundTrips` may still count `maxConcurrency - 1` from the assembler's own sweep. That is
  deliberate: the two metrics answer different questions and the assembler's quality counters
  (`incomplete`, `clockAnomalies`, `malformed`) carry the anomaly signal.
