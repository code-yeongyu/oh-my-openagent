# Adversarial verification - plan todo 6 (`parallelism_summary` session emission)

Verifier: independent (did not implement todo 6).
Under verification: commit `b084aeeeb`.
Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency`.
Method: all mutation probing was done in throwaway detached `git worktree`s under `/tmp/vt6-55835`
(`mutwt` @ `b084aeeeb`, `basewt` @ `7692e58f2`), with `node_modules` symlinked from the main
worktree. `bun install` was never run. No tracked file in the verification worktree was modified.

```AdversarialVerify
verdict: confirmed
evidence: |
  # --- suite / typecheck reproduction (main worktree, unmodified) ---
  $ bun test packages/omo-senpi/src/components/telemetry/
     148 pass / 0 fail / 520 expect() calls / 16 files          -> matches evidence exactly

  $ bun run --cwd packages/omo-senpi typecheck
    $ tsgo --noEmit -p tsconfig.json
    TYPECHECK EXIT=0                                            -> matches

  $ bun test packages/omo-senpi/src/
     1550 pass / 0 fail / 4405 expect() calls / 232 files [138.01s]  -> matches

  $ bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
     2 pass / 0 fail                                            -> matches

  # baseline delta claim independently rebuilt at the parent commit
  $ git worktree add /tmp/vt6-55835/basewt 7692e58f2 --detach
  $ (basewt) bun test packages/omo-senpi/src/components/telemetry/
     133 pass / 0 fail / 15 files                               -> baseline 133 confirmed; 148-133 = 15 new

  # --- ORDERING ATTACK (item 1), all six mutants run in /tmp/vt6-55835/mutwt ---
  M1 emit moved after the session component:
     $ bun test .../omo-native-component.test.ts
       expect(summaries).toHaveLength(1)
       Expected length: 1 / Received length: 0
       (fail) ... #then exactly one non-empty parallelism_summary is captured
       4 pass / 1 fail
     $ bun test .../omo-native-parallel-summary.test.ts   -> 14 pass / 0 fail  (unit suite STAYS GREEN)
     => the trap reproduced exactly: green unit tests, zero production events, ordering test catches it.

  M2 internal registrations swapped inside registerOmoNativeParallelSummary
     (subscriber registered before the emit handler):
     $ bun test packages/omo-senpi/src/components/telemetry/   -> 136 pass / 12 fail  (CAUGHT)

  M3 caller-site inversion: registerOmoNativeParallelTelemetry(shared registry) called BEFORE
     registerOmoNativeParallelSummary at the call site:
     $ bun test packages/omo-senpi/src/components/telemetry/   -> 147 pass / 1 fail
       (fail) ... #then exactly one non-empty parallelism_summary is captured   (CAUGHT)

  M4 third session_shutdown handler inserted BETWEEN the summary and the session component,
     clearing state.capture/state.sessionHash early:
     $ bun test packages/omo-senpi/src/components/telemetry/   -> 147 pass / 1 fail
       parallelism_summary UNAFFECTED (the summary handler is index 0 and wins);
       the single failure is an unrelated pre-existing shutdown/restart assertion.
       => not a false negative: the design is genuinely immune to a later-registered clearer.

  M5 session component hoisted to first inside register(), summary second (same hazard as M1
     expressed from the other side):
     $ bun test packages/omo-senpi/src/components/telemetry/   -> 146 pass / 2 fail
       (fail) ... #then exactly one non-empty parallelism_summary is captured   (CAUGHT)

  M6 intra-handler reorder: registry.clear(sessionId) moved BEFORE registry.snapshot(sessionId):
     $ bun test packages/omo-senpi/src/components/telemetry/   -> 136 pass / 12 fail  (CAUGHT)

  # real registration order, driven through createOmoNativeTelemetryComponent(...).register():
    registration order: session_shutdown -> tool_execution_start -> tool_execution_end -> turn_start ->
    turn_end -> session_shutdown -> input -> input_disposition -> session_shutdown -> session_start ->
    session_shutdown -> turn_end -> tool_result -> session_shutdown -> session_start
    session_shutdown handler indices: [0, 5, 8, 10, 13]
    -> emitting handler is index 0 (first of five). Byte-identical to the evidence file's claim.

  # real senpi host dispatch contract (not just the fake):
    node_modules/@code-yeongyu/senpi/dist/core/extensions/runner.js:900 `async emit(event)`
      for (const ext of this.extensions) { for (const handler of handlers) { await handler(...) } }
    -> sequential await in registration order, matching FakeExtensionAPI.dispatch. The ordering
       assumption holds against the real runtime, not only against the test double.

  # --- ONCE-PER-SESSION (item 2), driven through the REAL component with a transport recorder ---
  A. 5 turns / 10 waves, one session          -> summary count: 1 | non_eval_waves_total: 10 | joined: 15
  B. two session_shutdown for one session     -> summary count: 1
  C. two interleaved sessions, one component  -> summary count: 1  (see FINDING-1 below)
  D. shutdown, zero activity                  -> summary count: 0
  E. shutdown -> session_start -> shutdown    -> summary count: 2, joined [2, 2] (per-lifecycle, not accumulated)

  # --- BUCKET ISOLATION ON THE WIRE (item 3), captured payload verbatim ---
  waves driven: W1 non_eval bash/read/grep, W2 eval_only, W3 mixed(eval+bash), W4 non_eval write/edit
  {
    "$session_id": "hashed:b", "clock_anomalies": 0, "dropped_calls": 0,
    "eval_only_duration_ms": 700, "eval_only_waves": 1, "incomplete_calls": 0,
    "measured_turn_duration_ms_total": 0, "mixed_waves": 1,
    "modeled_wallclock_saved_ms": 950, "non_eval_joined_calls": 5,
    "non_eval_saved_round_trips": 3, "non_eval_wave_size_histogram": "0:1:1:0:0:0:0:0",
    "non_eval_waves_multi": 2, "non_eval_waves_total": 2,
    "schema_kind": "parallelism_v1", "upper_bound_saved_ms": 1200,
    "platform": "omo-senpi", "product_name": "omo-native", "package_version": "5.0.0-beta.7",
    "schema_version": 1, "$process_person_profile": false
  }
  -> non_eval_waves_total 2 excludes BOTH the eval_only and the mixed wave.
  -> non_eval_joined_calls 5 = 3 (W1) + 2 (W4). The mixed wave's `bash` is NOT folded in (would give 6).
  -> eval_only_waves / eval_only_duration_ms / mixed_waves carry their waves separately.

  # --- dropped_calls + FOUR-SINK (item 4), 2500 starts vs MAX_TRACKED_CALLS=2000 ---
  MAX_TRACKED_CALLS: 2000  observed: 2500
  dropped_calls: 500 | incomplete_calls: 0 | clock_anomalies: 0 | non_eval_joined_calls: 2000
  histogram: 0:0:0:0:0:0:0:1  len 15
  FOUR-SINK: 2000 + 0 + 500 + 0 = 2500 (observed 2500) -> HOLDS

  # --- SCHEMA + DOC GATE (item 5) ---
  $ bun run <generator harness>
    byte-exact: true
    dropped_calls row in generator output: true
  -> the doc block between the BEGIN/END sentinels equals generateTelemetrySchemaBlock() byte-for-byte.
  doc gate FIRES (probe: added `zz_probe_property` to the parallelism_summary schema in a scratch worktree):
    error: Telemetry schema documentation drifted.
    | `parallelism_summary` | `zz_probe_property` | `number` | - |
    1 pass / 1 fail   -> reverted.

  # --- CONVERGENCE (item 6) ---
  simultaneous equal (3 calls, each 1000000-1000500): modeled 1000, upper 1000
    hand: sum(d)=1500, span=1000500-1000000=500 -> modeled 1000 ; upper=(3-1)*500=1000. Equal is
    arithmetically forced, not wiring.
  staggered unequal (a 1000000-1000500, b 1000400-1001400): modeled 100, upper 750
    hand: sum(d)=500+1000=1500, span=1001400-1000000=1400 -> modeled 100 ; upper=(2-1)*750=750.
    -> DIVERGES on the wire. Not aliased.
  bucket fixture cross-check via assembleWaves + savings-math directly:
    W1 bash[1000000-1000500] read[1000100-1000400] grep[1000200-1000450] span 500 modeled 550 upper 700
    W4 write[1005000-1005600] edit[1005100-1005500]                       span 600 modeled 400 upper 500
    totals 950 / 1200 -> matches the wire exactly.

  # --- MUST-NOT-HAVE on the commit (item 7) ---
  $ git show --name-only --format="" b084aeeeb
    .omo/evidence/telemetry-parallel-latency-v2/task-6.md
    docs/reference/senpi-telemetry.md
    packages/omo-senpi/src/components/telemetry/omo-native-component.test.ts
    packages/omo-senpi/src/components/telemetry/omo-native-component.ts
    packages/omo-senpi/src/components/telemetry/omo-native-parallel-summary.test.ts
    packages/omo-senpi/src/components/telemetry/omo-native-parallel-summary.ts
    packages/omo-senpi/src/components/telemetry/product-identity.ts
  -> zero changes under packages/telemetry-core/, packages/omo-codex/, packages/omo-opencode/,
     plugin/extensions/.
  -> turn_completed: every occurrence in the diff is prose or a read-only test assertion
     (`expect(recorder.messages.filter(({event}) => event === "turn_completed")).toHaveLength(0)`).
     No schema or handler change.
  -> code-mode / K / compression metric: `git show b084aeeeb | grep -inE "codemode|code_mode|compression"`
     returns nothing.
  -> `grep -n "Math.max" omo-native-parallel-summary.ts` -> no match. Savings come from
     savings-math.ts (span-based, unmodified by this commit).
  -> histogram is `":"`-joined positional (eval-classifier.ts:80 `histogram.join(":")`), no `=` labels,
     15 chars on the wire.
  -> every tool-call-derived parallelism count carries the `non_eval_` prefix. `dropped_calls`,
     `incomplete_calls`, `clock_anomalies` are assembler-level cross-bucket quality sinks
     (wave-assembler.ts:41-43, counted before any eval classification), so prefixing them
     `non_eval_` would be actively false. Judged conformant.

  # --- CONVENTIONS on the diff (item 8) ---
  $ git show b084aeeeb | grep -E "^\+" | grep -E "as any|@ts-ignore|—|emoji"   -> no match
  $ awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/)/' omo-native-parallel-summary.ts | wc -l  -> 118 (< 250)
  given/when/then: the 14 unit tests use nested describe #given/#when/#then AND inline
  // given / // when / // then. See STYLE FINDING below for the ordering test.

  # --- CLEANUP ---
  $ git worktree remove --force /tmp/vt6-55835/mutwt ; git worktree remove --force /tmp/vt6-55835/basewt
  $ rm -rf /tmp/vt6-55835
  $ git status --porcelain    -> (empty)
  $ ls /tmp | grep -i vt6     -> (no match)
repro: |
  No blocking defect found. Reproductions for the two non-blocking findings:

  FINDING-1 (inherited, not introduced by todo 6) - a second distinct session's summary is
  silently dropped when both sessions share one component instance and no session_start
  intervenes, because the first session_shutdown clears state.capture:
    drive createOmoNativeTelemetryComponent once; session_start(s1); tool calls for s1 and s2;
    session_shutdown(s1) -> 1 summary; session_shutdown(s2) -> still 1 summary (s1 only).
  Proven PRE-EXISTING and universal, not specific to parallelism_summary:
    session_start(s1); session_shutdown(s1); input+input_disposition for s2
      -> prompt_submitted count = 0
  Also: with NO session_start at all, ZERO native events of any kind are captured
  (facade is installed lazily by the session component's first capture). Out of todo 6's scope.

  FINDING-2 (evidence accuracy) - task-6.md says "148 = 133 baseline + 14 new tests
  (13 unit + 1 real-registration-order regression)". Actual:
    $ bun test .../omo-native-parallel-summary.test.ts -> 14 pass
  so the split is 14 unit + 1 ordering = 15 new. Baseline 133 and total 148 are both correct;
  only the internal split is mislabelled.
confidence: 0.92
```

## 1. Ordering-attack matrix

| # | Mutation | Realistic? | parallelism_summary on the wire | Suite result | Caught? |
| --- | --- | --- | --- | --- | --- |
| M1 | `registerOmoNativeParallelSummary` moved AFTER `createOmoNativeSessionComponent` | yes - the exact trap | 0 events | ordering test fails `Received length: 0`; unit file 14/0 GREEN | CAUGHT |
| M2 | Internal registrations swapped: subscriber registered before the emit handler | yes - a plausible "tidy up the imports" edit | 0 events | 136 pass / 12 fail | CAUGHT |
| M3 | Caller registers `registerOmoNativeParallelTelemetry` first with a shared registry, then the summary | yes - the "just share the registry" refactor the module doc warns about | 0 events | 147 pass / 1 fail (ordering test) | CAUGHT |
| M4 | A third `session_shutdown` handler inserted between the summary and the session component, clearing `state.capture` | yes - a future component landing in the middle | 1 event, correct payload | 147 pass / 1 fail, but the failure is an unrelated pre-existing shutdown/restart assertion; the summary is unaffected | N/A - design is immune (summary is handler index 0) |
| M5 | Session component hoisted to first inside `register()`, summary second | yes | 0 events | 146 pass / 2 fail (ordering test among them) | CAUGHT |
| M6 | Intra-handler: `registry.clear()` moved before `registry.snapshot()` | yes - a plausible "clear early to be safe" edit | 0 events | 136 pass / 12 fail | CAUGHT |

Result: **no realistic reorder leaves the suite green while breaking production emission.** Every
ordering violation I could construct is caught, and M4 shows the internally-owned half is genuinely
robust rather than merely untested. The author's claim that exactly one caller-side constraint
remains, and that it is provably pinned, holds up.

The ordering regression test is the load-bearing artifact and it does its job: under M1 it produces
exactly `Received length: 0` while the 14-test unit file stays fully green, which is the precise
"green tests, zero production events" failure mode this todo exists to prevent.

## 2. Once-per-session matrix

| Scenario | Expected | Observed | Verdict |
| --- | --- | --- | --- |
| One session, 5 turns, 10 waves, 15 calls | exactly 1 | 1 (`non_eval_waves_total: 10`, `non_eval_joined_calls: 15`) | PASS |
| Same session shut down twice | exactly 1, no duplicate | 1 | PASS |
| Two interleaved sessions, one component instance | 2 (one each) | 1 (s1 only) | see FINDING-1 - inherited facade teardown, identical for `prompt_submitted`; not introduced by todo 6 |
| Shutdown with no activity at all | 0 | 0 | PASS |
| shutdown -> session_start -> shutdown (same raw id) | 1 per lifecycle, no accumulation | 2 events, `joined` [2, 2] | PASS - per-lifecycle, registry cleared between; not a bound violation |

The volume bound holds: emission is structurally impossible outside the single `session_shutdown`
handler, and that handler consumes-then-clears in one step. Many turns and many waves still cost
exactly one event.

## 3. On-the-wire bucket table

Driven waves: W1 = bash/read/grep overlapping (non_eval), W2 = single `eval` (eval_only),
W3 = `eval` + `bash` overlapping (mixed), W4 = write/edit overlapping (non_eval).

| Property | Value | Should include | Verdict |
| --- | --- | --- | --- |
| `non_eval_waves_total` | 2 | W1, W4 only | correct - eval_only and mixed both excluded |
| `non_eval_waves_multi` | 2 | W1, W4 | correct |
| `non_eval_joined_calls` | 5 | 3 (W1) + 2 (W4) | correct - the mixed wave's `bash` NOT folded in (folding gives 6) |
| `non_eval_saved_round_trips` | 3 | (3-1) + (2-1) | correct |
| `modeled_wallclock_saved_ms` | 950 | 550 (W1) + 400 (W4) | correct - mixed wave contributes 0 |
| `upper_bound_saved_ms` | 1200 | 700 (W1) + 500 (W4) | correct, and diverges from modeled |
| `eval_only_waves` / `eval_only_duration_ms` | 1 / 700 | W2 only | correct, separate bucket |
| `mixed_waves` | 1 | W3 only | correct, count-only, no savings leak |
| `non_eval_wave_size_histogram` | `0:1:1:0:0:0:0:0` (15 chars) | positional, unlabelled | correct, no `=`, well under 64 |

## 4. Four-sink arithmetic

Driven independently: 2500 `tool_execution_start` against `MAX_TRACKED_CALLS = 2000`, then 2500 ends.

```
observed  = 2500
paired            (non_eval_joined_calls) = 2000
incomplete        (incomplete_calls)      =    0
dropped           (dropped_calls)         =  500
clockAnomalies    (clock_anomalies)       =    0
                                            -----
paired + incomplete + dropped + anomalies = 2500  ==  observed   -> HOLDS
```

`dropped_calls: 500` genuinely reaches the captured payload, so the cap's under-report is
recoverable by a dashboard consumer instead of silently invisible.

The test asserts the **four-term** form (`omo-native-parallel-summary.test.ts:224-225`); no
three-term form exists in todo 6's commit. Note for the record: `wave-assembler.test.ts:174`
(todo 1's file, not this commit) does use the weaker three-term form, but its fixture has
`clockAnomalies == 0`, so it is arithmetically sound - just less strict. Out of scope here.

## 5. Judgement: was option (1) correctly rejected?

**Yes. The rejection is sound, and option (1) would not have removed the fragility.**

- The emit-half claim reproduces. I independently confirmed that after `session_shutdown` the
  wrapped transport clears `state.capture`, and that every subsequent native capture is a silent
  no-op - not only `parallelism_summary` but `prompt_submitted` too. So moving the *snapshot* to
  `turn_end` fixes only half the hazard; the *emission* must still happen while capture is live.
- The "neither event knows it is the last one" claim checks out against the host type definitions.
  `TurnEndEvent` is per-turn. `AgentSettledEvent` is documented as
  "Fired after an agent run has fully settled and no automatic retry, compaction, or queued
  continuation will run" - per agent *run*, not per session. A session can contain many settled
  runs, so emitting there is either per-run (volume blowup, explicitly forbidden by the plan's only
  volume defense) or first-run-only (silent loss of every later wave). Both are disqualifying.
- The hybrid the finding did not name - snapshot on `turn_end` into a holding buffer, emit on
  `session_shutdown` - is strictly worse, not better: it carries the *same* caller-side registration
  constraint as option (2) (the emit still has to beat the transport teardown) *plus* an extra
  buffer to keep coherent. Option (2) with the internal half owned by the module is the smaller,
  more testable design.
- Crucially, the chosen design's residual fragility is not "invisible": it is one constraint,
  documented at both ends (module header and call site comment), and pinned by a test I
  independently proved fails under mutation with the exact production symptom.

## 6. Non-blocking findings

**STYLE FINDING (item 8).** The ordering regression test at
`omo-native-component.test.ts:182` uses a flat single-line `test("#given ... #when ... #then ...")`
title with no nested `describe` and no inline `// given` / `// when` / `// then` comments. Per the
strict reading of AGENTS.md:292 ("nested `describe` with `#given`/`#when`/`#then` prefixes, or
inline `// given` / `// when` / `// then` comments") that is neither form. It does match the
pre-existing style of its neighbours in the same file (e.g. line 98), so it is locally consistent.
Reported as a style finding only; it does not weaken the test, which I proved fires under mutation.
The 14 new unit tests in `omo-native-parallel-summary.test.ts` use both nested describes and inline
comments and are fully conformant.

**FINDING-1 (inherited limitation, not a todo-6 defect).** After the first `session_shutdown`,
`state.capture` is cleared and stays cleared until a `session_start` reinstalls the capture facade.
Any second session sharing the same component instance therefore loses its summary. I verified this
is a pre-existing property of the shared facade, not something todo 6 introduced: `prompt_submitted`
behaves identically, and with no `session_start` at all *zero* native events of any kind are
captured. Todo 6 neither causes nor worsens it, and fixing it is outside this todo's scope. Worth
carrying to a follow-up if multi-session-per-process ever becomes real.

**FINDING-2 (evidence accuracy).** `task-6.md` states "13 unit + 1 real-registration-order
regression"; the actual split is 14 unit + 1 ordering. Baseline (133) and total (148) are both
correct and both independently reproduced, so the delta claim is right and only the internal
breakdown is off by one. Cosmetic.

## 7. Reproducibility of the evidence file (item 9)

Every binary check in `task-6.md` reproduced:

| Claim | Reproduced |
| --- | --- |
| 148 pass / 0 fail telemetry suite | yes, exactly |
| 133 baseline at parent commit `7692e58f2` | yes, rebuilt in a fresh worktree |
| typecheck exit 0 | yes |
| 1550 pass / 0 fail blast radius | yes, exactly |
| `schema-doc.test.ts` green | yes (2 pass) |
| doc block byte-exact with the generator | yes, independently regenerated and compared |
| doc gate still fires | yes, proven with a scratch probe property |
| M1 mutation -> `Received length: 0`, unit suite green | yes, reproduced independently |
| registration order string | yes, byte-identical |
| emitting handler is the first `session_shutdown` | yes, handler indices `[0, 5, 8, 10, 13]` |
| `dropped_calls: 500` at 2500 vs 2000 cap | yes, driven independently through the real component |
| four-sink invariant closes at 2500 | yes |
| exactly 1 event, buckets isolated, mixed `bash` not folded | yes, on my own fixture |
| `upper_bound == modeled` is arithmetic, not aliasing | yes, hand-computed and cross-checked; a diverging fixture genuinely diverges (100 vs 750) |
| no forbidden package touched, `turn_completed` unchanged | yes |
| 118 pure LOC, under the 250 ceiling | yes |

Nothing in the evidence file failed to reproduce.

## 8. Cleanup receipt

- Scratch worktrees `/tmp/vt6-55835/mutwt` and `/tmp/vt6-55835/basewt` removed via
  `git worktree remove --force`; `/tmp/vt6-55835` deleted with `rm -rf`.
- `ls /tmp | grep -i vt6` -> no match. Pre-existing `/tmp` entries (including
  `/private/tmp/omo-preexist-debug-038ed`) were left untouched.
- `git status --porcelain` in
  `/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency` -> **empty**.
  No tracked source, test, or doc file was modified by this verification. The only file written is
  this verdict.
