# Adversarial verification - todos 1 and 3

Role: independent adversarial verifier. Did not implement either todo. No source or test
file was modified; all mutations were performed on scratch copies under `/tmp` and deleted
afterwards. Only this file was written.

Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency`
Plan: `.omo/plans/telemetry-parallel-latency-v2.md` (todos 1, 3)
Under verification: `b8078d13a` (todo 1), `279a2c674` (todo 3)

---

## Todo 1 - concurrency wave assembler

```
AdversarialVerify
verdict: needs-fix
evidence: |
  $ bun test packages/omo-senpi/src/components/telemetry/wave-assembler.test.ts
   11 pass / 0 fail / 29 expect() calls / Ran 11 tests across 1 file. [123.00ms]

  $ bun test packages/omo-senpi/src/components/telemetry/
   103 pass / 0 fail / 402 expect() calls / Ran 103 tests across 13 files. [1291.00ms]

  $ bun run --cwd packages/omo-senpi typecheck
   tsgo --noEmit -p tsconfig.json  -> exit 0

  $ git show --name-status b8078d13a
   A .omo/evidence/telemetry-parallel-latency-v2/task-1.md
   A packages/omo-senpi/src/components/telemetry/wave-assembler.test.ts
   A packages/omo-senpi/src/components/telemetry/wave-assembler.ts

  Direct probe (module imported straight, not via its own test file):
   chained waves= 1 span= 12 maxConc= 2
   sum(d)= 14  span-formula saving= 2  max-formula saving= 9
   parallel-batch (5000 starts, then 5000 ends):
     tracked= 5000  dropped= 0  paired= 5000  observed= 5000  incomplete= 0
   all-starts-no-ends (2500):
     observed= 2500  incomplete= 2500  dropped= 0

  Mutation probes: 7 of 7 mutations killed at least one assertion (detail below).
repro: |
  # MAX_TRACKED_CALLS is not enforced when starts arrive before ends.
  cat > /tmp/cap-repro.ts <<'TS'
  import { assembleWaves, MAX_TRACKED_CALLS } from "<worktree>/packages/omo-senpi/src/components/telemetry/wave-assembler"
  const obs: any[] = []
  for (let i = 0; i < 5000; i += 1) obs.push({ kind: "start", toolCallId: `p${i}`, toolName: "bash", atMs: 0 })
  for (let i = 0; i < 5000; i += 1) obs.push({ kind: "end", toolCallId: `p${i}`, toolName: "bash", atMs: 100 })
  const r = assembleWaves(obs)
  console.log("cap", MAX_TRACKED_CALLS, "tracked", r.waves.reduce((t, w) => t + w.calls.length, 0), "dropped", r.counters.droppedCalls)
  TS
  bun run /tmp/cap-repro.ts
  # observed: cap 2000 tracked 5000 dropped 0   (expected tracked <= 2000)
confidence: 0.92
```

### Acceptance criteria

| # | Criterion | Result | Deciding observation |
| --- | --- | --- | --- |
| a | 3 overlapping -> 1 wave, size 3, span produced | PASS | `waveShape` equals `[{size:3, spanMs:600, maxConcurrency:3}]`; killed by mutation M6. |
| b | 3 sequential -> 3 waves of size 1 | PASS | Three `{size:1, spanMs:100, maxConcurrency:1}` entries; direct probe agrees. |
| c | Overlap + sequential mix -> correct split | PASS | `[{size:2, spanMs:300, maxConcurrency:2}, {size:1, spanMs:50, maxConcurrency:1}]`; killed by M6. |
| d | Missing end -> incomplete counted, excluded | PASS | `counters.incomplete === 1`, wave contains only `done`; killed by M3. |
| e | `endMs < startMs` -> clock_anomaly, excluded | PASS | `clockAnomalies === 1`, `pairedCalls === 1`, one wave; direct probe D: `waves=0, paired=0, clockAnomalies=1`; killed by M4. |
| f | >2000 calls -> detail dropped, counters preserved | **FAIL** | Holds only for strictly interleaved `[start,end,start,end,...]` arrival (the exact shape the test builds): `tracked=2000, dropped=1000`. With 5000 starts arriving before any end, `tracked=5000, dropped=0`. The guard reads `paired.length`, but detail accumulates in the unbounded `pending` Map (`wave-assembler.ts:69` vs `:73`). |
| g | Chained A(0-5) B(4-9) C(8-12) -> 1 wave, span 12, maxConcurrency 2 | PASS | Direct probe: `waves=1, span=12, maxConc=2`; span formula yields saving 2 vs `max(d)` formula 9, matching the plan's 4.5x-inflation guard. Killed by mutation M1. |

### Mutation probes (scratch copies in `/tmp/mut-*`, tracked files untouched)

| ID | Mutation applied to the scratch copy | Outcome |
| --- | --- | --- |
| M1 | `spanMs = max(endMs - startMs)` instead of `maxEnd - minStart` (the exact prohibited `max(d)` basis) | 2 fail. Case (g): `Expected: 12, Received: 5`. Non-tautological. |
| M2 | `maxConcurrency = calls.length` instead of sweepline | 2 fail, including case (g) and the boundary-touching case. |
| M3 | `counters.incomplete = 0` | 2 fail, including case (d) and the cross-session leak test. |
| M4 | Clock-anomaly records fall through into waves | 1 fail, case (e). |
| M5 | Cap disabled (`if (false)`) | 1 fail, case (f). |
| M6 | Overlap grouping removed (each call its own wave) | 4 fail: cases (a), (c), (g), boundary. |
| M7 | Timestamp validation weakened to `typeof atMs !== "number"` | 1 fail, the malformed-input case. |

Every acceptance criterion is killed by at least one targeted mutation. No tautological
assertion was found in this file.

### Adversarial classes

- **Stale state:** ruled out. `assembleWaves` is pure; `pending`, `paired`, and `counters`
  are allocated per call. Two back-to-back assemblies share nothing
  (`second.counters.incomplete === 0` after a first session with an orphan).
- **Malformed input:** no throw. Nine hostile records (`undefined`, `{}`, bare string,
  array, number, `NaN`/`Infinity`/negative timestamps, non-string and empty `toolCallId`)
  produced `threw=no`, `malformed=7`, and only the one valid pair reached the metrics.
  Rejection is at the parse boundary, so no bad value reaches the arithmetic.
- **Misleading success output:** none found. Every assertion compares against literals
  computed by hand, not against values re-derived from the module under test. Case (f) is
  the one weak spot: it is not tautological but its fixture shape is the single arrival
  order under which the buggy guard happens to work.
- **Duplicate ids:** re-using a `toolCallId` after it is paired produces two independent
  paired calls (`paired=2, waves=2`), which is reasonable and does not corrupt counters.

### Defect detail (blocker for `confirmed`)

`wave-assembler.ts:69` gates on `paired.length >= MAX_TRACKED_CALLS`, but per-call detail
first accumulates in `pending` (`:73`), which has no bound. A session whose tool calls run
concurrently - starts arriving before the matching ends, which is precisely the workload
this telemetry exists to measure - retains every start in `pending` and then every pair in
`paired`, with `droppedCalls` stuck at 0. Measured: 5000 starts followed by 5000 ends yields
`tracked=5000, dropped=0` against a declared cap of 2000. 2500 starts with no ends leaves
`incomplete=2500` resident.

This breaches todo 1's stated MUST-NOT ("배열을 무한히 키우지 말 것 ... `MAX_TRACKED_CALLS = 2000`
초과 시 카운터만 유지하고 상세는 버림"). Acceptance criterion (f) reads as satisfied only
because its fixture interleaves start and end for every call. Suggested fix: gate on
`paired.length + pending.size` (and bound `pending` insertion) rather than `paired.length`
alone, then add a case (f) variant whose starts all precede its ends.

Severity: not a correctness bug in the reported metrics (spans, waves, and counters remain
accurate) - it is the memory guard the plan explicitly required, and it does not hold.

---

## Todo 3 - eval 3-bucket classifier

```
AdversarialVerify
verdict: confirmed
evidence: |
  $ bun test packages/omo-senpi/src/components/telemetry/eval-classifier.test.ts
   10 pass / 0 fail / 48 expect() calls / Ran 10 tests across 1 file. [136.00ms]

  $ bun test packages/omo-senpi/src/components/telemetry/
   103 pass / 0 fail / 402 expect() calls / Ran 103 tests across 13 files. [1291.00ms]

  $ bun run --cwd packages/omo-senpi typecheck
   tsgo --noEmit -p tsconfig.json  -> exit 0

  $ git show --name-status 279a2c674
   A .omo/evidence/telemetry-parallel-latency-v2/task-3.md
   A packages/omo-senpi/src/components/telemetry/eval-classifier.test.ts
   A packages/omo-senpi/src/components/telemetry/eval-classifier.ts

  Direct probe (module imported straight, not via its own test file):
   classify(["bash","eval"]) = mixed
   isEvalToolName: evaluate_foo=false code-mode=true mcp:eval=true codemode=true
   polluted nonEval = {"wavesTotal":1,"wavesMulti":1,"joinedCalls":2,"waveSizeHistogram":"0:1:0:0:0:0:0:0"}
   control  nonEval = {"wavesTotal":1,"wavesMulti":1,"joinedCalls":2,"waveSizeHistogram":"0:1:0:0:0:0:0:0"}
   equal = true; evalOnlyWaves=1 evalOnlyDurationMs=3000 mixedWaves=1

  Mutation probes: 7 of 7 mutations killed at least one assertion (detail below).
repro: not applicable - no defect found.
confidence: 0.9
```

### Acceptance criteria

| # | Criterion | Result | Deciding observation |
| --- | --- | --- | --- |
| a | `[bash,read,grep]` -> `non_eval` | PASS | `classifyWaveBucket` returns `non_eval`; killed by mutation N4 (substring matcher). |
| b | `[eval]` -> `eval_only` | PASS | Returns `eval_only` for `["eval"]` and `["eval","eval"]`; killed by N3. |
| c | `[bash,eval]` -> `mixed` | PASS | Direct probe returns `mixed`; killed by N1. |
| d | `eval`/`codemode`/`mcp:eval`/`code-mode` detected, `evaluate_foo` NOT | PASS | Direct probe: `true/true/true/true` and `evaluate_foo=false`. Also negative on `evaluate`, `ln`, `codemodel`, `eval_helper`, empty, whitespace. Killed by N4 and N5. |
| e | `mixed` never folded into `non_eval` | PASS | `summarizeWaveBuckets([mixed, non_eval])` gives `nonEval.wavesTotal=1, mixedWaves=1`; killed by N1 and N2 (N2 is the exact forbidden "strip eval, recount" fold). |
| f | waves_total / waves_multi / joined_calls / histogram aggregate `non_eval` only | PASS | Polluted input (7 waves incl. 2 eval_only + 2 mixed) yields counters byte-identical to the 3-wave non_eval control, and absolute values `3 / 2 / 6 / "1:1:1:0:0:0:0:0"`. Killed by N2, N3, N6, N7. |

### Mutation probes (scratch copies in `/tmp/mut3-*`, tracked files untouched)

| ID | Mutation applied to the scratch copy | Outcome |
| --- | --- | --- |
| N1 | `mixed` classified as `non_eval` (the headline forbidden fold) | 5 fail, including cases (c), (e), (f). Non-tautological. |
| N2 | `mixed` counted into non_eval aggregates with eval calls stripped (the exact "filter then recompute" the plan forbids) | 3 fail, including (e) and (f). |
| N3 | `eval_only` falls through into non_eval aggregates | 2 fail, including (f). |
| N4 | Suffix matcher replaced by naive `includes` (produces the `evaluate_foo` false positive) | 1 fail, case (d). |
| N5 | `code_mode` dropped from the eval name list | 1 fail, case (d) via the `code-mode` variant. |
| N6 | Histogram encoded with labels (`b0=1:b1=2:...`) | 3 fail, including the positional-encoding assertion. |
| N7 | `wavesMulti` incremented for every wave regardless of size | 1 fail, case (f). |

Every acceptance criterion is killed by at least one targeted mutation. No tautological
assertion was found in this file. Note that case (f) asserts both an equality against an
independently constructed non_eval-only control *and* hard-coded absolute values, so it
cannot pass by deriving its expectation from the output under test.

### Adversarial classes

- **Stale state:** ruled out. Only pure exported functions; the histogram array is
  allocated per call. Summarizing identical input twice deep-equals, and
  `summarizeWaveBuckets([])` returns the zeroed `"0:0:0:0:0:0:0:0"`.
- **Malformed input:** empty wave, empty and whitespace names, unicode (`코드`), fullwidth
  `Ｅｖａｌ`, mixed case `EVAL`, padded ` eval ` all handled without throwing and without
  misclassification. `spanMs: NaN` is absorbed by the `Number.isFinite` guard in
  `durationOf` (`evalOnlyDurationMs=0`, histogram intact). **One boundary gap:**
  `summarizeWaveBuckets([{toolNames: null, spanMs: NaN}])` throws
  `TypeError: null is not an object (evaluating 'toolName of wave.toolNames')`. This is
  reachable only by violating the module's own TypeScript contract; its sole intended
  producer is todo 1's typed `PairedToolCall[]`, and neither the plan nor todo 3's
  acceptance criteria require defence at this internal seam. Recorded as a note, not a
  blocker; if todo 4/6 ever feeds this from raw event payloads, it must guard there.
- **Misleading success output:** none. The (f) control is built from a separate literal
  array rather than from the polluted result.
- **Privacy:** only `toolNames` and `spanMs` cross the API surface. No args, results, or
  cell source are accepted or stored.

---

## Evidence-file reproduction

| Claim in evidence | Source | Re-run result | Verdict |
| --- | --- | --- | --- |
| task-1: `11 pass / 0 fail / 29 expect()` | task-1.md GREEN block | `11 pass / 0 fail / 29 expect()` | reproduced |
| task-1: `103 pass / 0 fail / 402 expect()`, 13 files | task-1.md suite block | `103 pass / 0 fail / 402 expect()`, 13 files | reproduced |
| task-1: typecheck exit 0 | task-1.md | `tsgo --noEmit -p tsconfig.json` exit 0 | reproduced |
| task-1: chained wave `span=12, maxConcurrency=2` | task-1.md manual QA | direct probe `span=12 maxConc=2` | reproduced |
| task-1: cap case `tracked 2000, dropped 10, observed 2010` | task-1.md case (f) row | reproduced for the interleaved shape; **not** an invariant - see defect above | reproduced but misleading |
| task-1: `malformed` counts 7, not the fixture length 9 | task-1.md judgement call 3 | direct garbage probe `malformed=7` | reproduced; reasoning is correct (the two orphan ends are well-formed) |
| task-3: `10 pass / 0 fail / 48 expect()` | task-3.md GREEN block | `10 pass / 0 fail / 48 expect()` | reproduced |
| task-3: mutation fold makes 3 tests fail | task-3.md mutation proof | independent mutation N2 produced the same 3 failures with the same expected/received values | reproduced |
| task-3: `evaluate_foo` stays non_eval | task-3.md manual QA | direct probe `isEvalToolName("evaluate_foo") === false` | reproduced |
| task-3: histogram <= 39 chars, no labels | task-3.md | `"1:1:1:1:1:1:1:1"` (15 chars at 1 digit; 8 buckets x 4 digits + 7 colons = 39 worst case), no `=` present | reproduced |

Every number quoted in both evidence files is reproducible. No unreproducible figure was
found. The one qualification is task-1's case (f) row: the number is real, but it does not
demonstrate the invariant the plan asked for.

## Repo conventions (diff only)

| Check | Result | Observation |
| --- | --- | --- |
| given/when/then naming, never Arrange-Act-Assert | PASS | `rg "Arrange\|Act:\|Assert"` -> no matches. `wave-assembler.test.ts` uses nested `describe("#given")/describe("#when")/test("#then")`. `eval-classifier.test.ts` uses a single flat `#given ... #when ... #then` test title, a third variant not literally listed in AGENTS.md:292 (which names nested describes or inline `// given` comments). It is unambiguously given/when/then and readable; flagged as a style note only, not a violation. |
| No `as any` | PASS | No occurrence in any of the four files. `wave-assembler.test.ts` uses `as readonly unknown[]` and `as readonly ToolExecutionObservation[]` to feed deliberately hostile input, which is the narrow cast, not `any`. |
| No `@ts-ignore` / `@ts-expect-error` | PASS | No matches. |
| kebab-case filenames | PASS | `wave-assembler.ts`, `wave-assembler.test.ts`, `eval-classifier.ts`, `eval-classifier.test.ts`. |
| No catch-all util/helper filenames | PASS | Both modules are named for their single responsibility. |
| No emojis | PASS | Scanned for codepoints > U+1F000: 0 in all four files. |
| No em dashes | PASS | 0 U+2014/U+2013 in all four files. |
| Pure LOC < 250 | PASS | `awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/)/' <file> \| wc -l`: wave-assembler.ts 151, wave-assembler.test.ts 171, eval-classifier.ts 91, eval-classifier.test.ts 95. |

## Scope fidelity

`git show --name-status b8078d13a` and `git show --name-status 279a2c674` together add
exactly six files and modify none:

```
A .omo/evidence/telemetry-parallel-latency-v2/task-1.md
A packages/omo-senpi/src/components/telemetry/wave-assembler.test.ts
A packages/omo-senpi/src/components/telemetry/wave-assembler.ts
A .omo/evidence/telemetry-parallel-latency-v2/task-3.md
A packages/omo-senpi/src/components/telemetry/eval-classifier.test.ts
A packages/omo-senpi/src/components/telemetry/eval-classifier.ts
```

Forbidden-path grep over both commits' file lists (`telemetry-core`, `omo-codex`,
`omo-opencode`, `plugin/extensions`, `turn_completed`) returns no matches. The string
`turn_completed` appears 0 times in either diff. Both commits are in scope. No barrel
export was added, consistent with todo 4 owning the wiring.

## Summary

- Todo 1: **needs-fix**. All seven acceptance criteria are pinned by non-tautological
  tests and six of seven hold, but criterion (f) - the `MAX_TRACKED_CALLS` memory guard -
  is satisfied only for interleaved start/end arrival. Under concurrent arrival the cap
  never fires and 5000 calls are retained against a declared cap of 2000, breaching the
  todo's explicit MUST-NOT on unbounded growth. Scope, conventions, and every evidence
  number are clean.
- Todo 3: **confirmed**. All six acceptance criteria hold under independent probing, all
  seven mutations kill assertions, scope and conventions are clean, and every evidence
  number reproduces. The lone note is a `TypeError` on `toolNames: null`, reachable only
  by breaking the module's TypeScript contract at an internal seam the plan does not
  require to be defended.
