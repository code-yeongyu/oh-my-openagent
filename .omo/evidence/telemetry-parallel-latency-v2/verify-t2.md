# Adversarial verification - todo 2 (`savings-math.ts`)

Independent verifier. Did not implement todo 2. No source or test file was modified;
all mutation work happened in `/tmp` scratch copies, since deleted.

Commit under verification: `d6dd78b4f` - `feat(omo-senpi): add honesty-labeled parallel savings math`

```AdversarialVerify
verdict: confirmed
evidence: |
  # scope
  $ git show --stat d6dd78b4f
   .../telemetry-parallel-latency-v2/task-2.md        | 224 ++++++++++++++++++
   .../src/components/telemetry/savings-math.test.ts  | 252 +++++++++++++++++++++
   .../src/components/telemetry/savings-math.ts       |  84 +++++++
   3 files changed, 560 insertions(+)
  $ git show --name-only --format="" d6dd78b4f | grep -E 'turn_completed|telemetry-core/|omo-codex/|omo-opencode/|plugin/extensions/.*\.js|index\.ts$'
  NO FORBIDDEN PATHS TOUCHED
  $ git show d6dd78b4f | grep -n 'turn_completed'
  NO turn_completed IN DIFF

  # suite + typecheck
  $ bun test packages/omo-senpi/src/components/telemetry/savings-math.test.ts
  12 pass / 0 fail / 31 expect() calls
  $ bun test packages/omo-senpi/src/components/telemetry/
  118 pass / 0 fail / 463 expect() calls, 14 files
  $ bun run --cwd packages/omo-senpi typecheck
  $ tsgo --noEmit -p tsconfig.json   (exit 0, no output)

  # mutation probes (scratch copies under /tmp/vt2-scratch)
  A: subtrahend -> Math.max(...durations)  => 10 pass / 2 fail (chained: Expected 2, Received 9)
  A isolated (-t "never the longest single duration") => 0 pass / 1 fail
  B: savedRoundTrips -> wave.calls.length - 1 => 9 pass / 3 fail (chained: Expected 1, Received 2)
  C: Math.max(0, sum - spanMs) clamp => 11 pass / 1 fail (negative: Expected -8, Received 0)

  # type-level honesty label (standalone tsgo project, /tmp/vt2-tsprobe)
  label-probe.ts(14,14): error TS2322: Type 'UpperBoundSavedMs' is not assignable to type 'ModeledSavedMs'.
    Types of property 'label' are incompatible.
      Type '"upper_bound"' is not assignable to type '"modeled"'.
  label-probe.ts(17,14): error TS2322: Type 'ModeledSavedMs' is not assignable to type 'UpperBoundSavedMs'.
      Type '"modeled"' is not assignable to type '"upper_bound"'.
  ConcurrencyWave -> all three functions: zero errors (no adapter needed)

  # evidence QA table reproduced through the REAL assembleWaves (/tmp/vt2-qa)
  wave          N  sum(d)  span   modeled  upperBound  maxConc  savedRT
  simultaneous  4    8.20   2.20     6.00       6.150        4        3
  long-tail     4    9.90   9.00     0.90       7.425        4        3
  chained       3   14.00  12.00     2.00       9.333        2        1
  single        1    4.00   4.00     0.00       0.000        1        0
  (byte-identical to the table in task-2.md)
repro: no defect found; no repro required
confidence: 0.93
```

## Acceptance-criterion table

| Criterion | Verdict | Deciding observation |
| --- | --- | --- |
| `modeledWallClockSavedMs = sum(d) - wave.spanMs`, not `- max(d)` | PASS | Source line 46: `sum(durations) - wave.spanMs`. `grep` finds no `Math.max` in the modeled path. Mutation A proves the test detects the `max` variant. |
| Chained wave pins 2.00 and rejects 9.00 | PASS | Test lines 136-137: `toBeCloseTo(2.0, 10)` plus `not.toBe(9.0)`. Under mutation A the test fails alone: `Expected: 2, Received: 9`. |
| `savedRoundTrips` uses `max(maxConcurrency - 1, 0)`, not `N - 1` | PASS | Source line 59. Chained wave N=3, maxConcurrency=2, result 1. Mutation B fails 3 tests. |
| `(N-1)*mean` exposed only under an `upperBound` name, never the default | PASS | Only `upperBoundSavedMs` computes `(durations.length - 1) * mean`; it returns `label: "upper_bound"`. No other export returns that value. |
| Negative results not clamped | PASS | span 10 > sum 2 returns `-8` (test line 126). Mutation C (clamp) fails that test. |
| Honesty label enforced at the TYPE level | PASS | Independent tsgo run produced TS2322 in **both** directions (see evidence). Not merely "looks branded". |
| `ConcurrencyWave` flows in with no adapter | PASS | Probe passing a declared `ConcurrencyWave` into all three functions typechecked with zero errors. |
| Module reads `wave.spanMs`, does not recompute `maxEnd - minStart` | PASS | `savings-math.ts` contains no `minStart`/`maxEnd` computation; it consumes `wave.spanMs` directly. |
| Arithmetic matches independent recomputation | PASS | Recomputed in Python with no repo code: simultaneous 6.000000, long-tail modeled 0.900000 / upper 7.425000, chained 2.000000 / savedRT 1, N=1 -> 0, N=0 -> 0, multi-wave savedRT 4. All match the test expectations. |
| Long-tail upper bound uses tolerance, not `toBe(7.43)` | PASS | Test uses `toBeCloseTo(7.43, 2)`. Exact value is `3*(9.9/4) = 7.425000000000001`; `toBe(7.43)` would fail (verified: `7.425... == 7.43` is `False`). See caveat below. |
| Malformed input: no throw, no NaN/Infinity leak | PASS | Nine classes fed directly to the exports (empty, NaN end, Infinity end, negative durations, NaN span, Infinity span, NaN/-Infinity maxConcurrency, all-reversed). Zero throws, zero non-finite values in any returned metric. |
| No clock reads / no async in the test file | PASS | `grep -nE 'Date\.now\|performance\.now\|setTimeout\|await\|async\|sleep\|Math\.random'` -> NONE, in both module and test. |
| given/when/then naming, no Arrange-Act-Assert | PASS | Every block is `#given` / `#when` / `#then`. No AAA markers in the diff. |
| No `as any`, no `@ts-ignore` | PASS | Grep over the added lines: none found. |
| kebab-case filenames, no catch-all util/helper names | PASS | `savings-math.ts`, `savings-math.test.ts`. No `util`/`helper` identifiers. |
| No emojis, no em dashes | PASS | Python scan reports zero non-ASCII characters in either file. |
| Pure functions, no IO or clock reads | PASS | No imports at all in `savings-math.ts` beyond its own type declarations. 5 repeated evaluations yield a `Set` of size 1. |
| Files under 250 pure-LOC ceiling | PASS | `awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/)/' \| wc -l` -> module 75, test 223. |
| Scope: only the two new files plus evidence | PASS | `git show --stat` lists exactly 3 files, all additions. No forbidden path touched. |
| Evidence numbers reproduce | PASS | The QA table in `task-2.md` reproduced byte-identically through the real `assembleWaves`, not hand fixtures. Suite counts reconcile (see note). |

## Mutation probe results

All three ran against a scratch copy at `/tmp/vt2-scratch` (module + test copied, test importing
the mutated copy). The tracked files were never modified: `git status` shows `savings-math.*`
clean throughout.

### Probe A - flip the subtrahend to `Math.max(...durations)`

```
46:  return { label: "modeled", valueMs: sum(durations) - Math.max(...durations) }

Expected: -8   Received: 1
(fail) ... #then the negative result is surfaced instead of clamped to zero
Expected: 2    Received: 9
(fail) ... #then it uses the wave span and never the longest single duration
 10 pass
 2 fail
```

Isolated to the single mandated test, to prove the chained case carries its own weight rather than
riding on a sibling failure:

```
$ bun test savings-math.test.ts -t "never the longest single duration"
Expected: 2   Received: 9
 0 pass
 1 fail
```

**Result: MUTATION KILLED.** The exact 4.5x B1 regression (2.00 -> 9.00) is caught. Not tautological.

### Probe B - `savedRoundTrips` uses `calls.length - 1`

```
59:    total += wave.calls.length - 1

Expected: 0   Received: -1   (fail) ... #then every metric is zero rather than NaN
Expected: 1   Received: 2    (fail) ... #then it follows max concurrency rather than the call count
Expected: 4   Received: 5    (fail) ... #then single-call waves contribute nothing ...
 9 pass
 3 fail
```

**Result: MUTATION KILLED.** The chained wave correctly demands 1, not N-1=2.

### Probe C - add a `Math.max(0, ...)` clamp

```
46:  return { label: "modeled", valueMs: Math.max(0, sum(durations) - wave.spanMs) }

Expected: -8   Received: 0
(fail) ... #then the negative result is surfaced instead of clamped to zero
 11 pass
 1 fail
```

**Result: MUTATION KILLED.** The no-clamp requirement is genuinely pinned.

## Attack attempts that failed to find a defect

- **Tautology hunt.** Checked every assertion whose expected side might be re-derived from the code
  under test. All mandated values are hardcoded literals (`6.0`, `0.9`, `7.43`, `2.0`, `-8`, `1`, `4`,
  `0`). Only two re-derivations exist: line 143 `expect(CHAINED_THREE.maxConcurrency).toBe(2)`
  (a fixture self-check against a literal) and line 145
  `not.toBe(CHAINED_THREE.calls.length - 1)` (redundant belt-and-braces sitting beside the
  hardcoded `toBe(1)` on line 144). Neither replaces an independent expectation, so neither weakens
  the suite. Mutation B independently confirms line 144 does the real work.
- **Test-fixture independence.** The test file rebuilds `spanMs`/`maxConcurrency` in a local
  `waveOf` helper rather than importing the assembler, which in principle could drift from
  `wave-assembler.ts`. I closed this by recomputing every case in Python *and* by rerunning the
  scenarios through the real `assembleWaves`; all three sources agree exactly, so the local helper
  is currently faithful.
- **`upperBoundSavedMs` ignoring a non-finite `spanMs`.** A wave with `spanMs: Infinity` returns
  modeled `0` but upper bound `2`. This is correct by design: the upper bound is a function of the
  durations only and never consults the span. No NaN escapes.
- **Default-path leakage of the upper bound.** `grep` confirms `savings-math` is not imported
  anywhere else in the repo yet, so no caller can currently be using the wrong value. The type-level
  brand blocks it for future todo 6 wiring.

## Caveats (non-blocking, recorded for the record)

1. **Thin tolerance margin.** `expect(upper.valueMs).toBeCloseTo(7.43, 2)` passes with
   `|7.425000000000001 - 7.43| = 0.004999999999999005` against a threshold of `0.005`. It clears by
   about 1e-18. The assertion is correct today and `toBe(7.43)` was rightly avoided, but the margin
   is thinner than it looks. `toBeCloseTo(7.425, 10)` would express the same intent with real slack.
   Not a defect: the mandated value is pinned and the test passes deterministically (float
   arithmetic here is reproducible, not timing dependent).
2. **Suite count differs from the evidence.** `task-2.md` records 115 pass / 14 files; I measured
   118 pass / 14 files. The delta is fully explained by a concurrent worker's uncommitted fix to
   `wave-assembler.ts` / `wave-assembler.test.ts` (+40 test lines, changing the `MAX_TRACKED_CALLS`
   gate from `paired.length` to `paired.length + pending.size`). I inspected that diff: it alters an
   internal cap condition only and leaves the `ConcurrencyWave` type surface
   (`calls`/`spanMs`/`maxConcurrency`) untouched, so todo 2's contract is unaffected. Per the brief,
   concurrent-worker dirt is not a todo 2 defect. Note the dirty files were `wave-assembler.*`, not
   the `product-identity.*` / `senpi-telemetry.md` set named in the brief.
3. **Evidence claims a deleted probe file.** `task-2.md` references a `label-probe.ts` that no longer
   exists. Rather than trust it, I rebuilt the probe from scratch in an isolated tsgo project and
   reproduced the TS2322 errors myself, in both assignment directions. The claim is independently
   established, not taken on faith.

## Cleanup receipt

```
$ rm -rf /tmp/vt2-scratch /tmp/vt2-tsprobe /tmp/vt2-qa
removed: /tmp/vt2-scratch
removed: /tmp/vt2-tsprobe
removed: /tmp/vt2-qa
$ git status --short
 M packages/omo-senpi/src/components/telemetry/wave-assembler.test.ts
 M packages/omo-senpi/src/components/telemetry/wave-assembler.ts
```

The only dirty files belong to the concurrent worker. No tracked source or test file was modified by
this verification. No `bun install` or any dependency install command was run. The sole file written
is this verdict.
