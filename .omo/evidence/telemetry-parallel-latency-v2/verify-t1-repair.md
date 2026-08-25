# Adversarial re-verification — todo 1 repair (`791437517`)

Independent verifier. Did NOT implement the fix. No tracked source or test file was modified.
Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency`
Under verification: `791437517` (`fix(omo-senpi): bound wave assembler tracking across pending observations`) on top of `b8078d13a`.

```
AdversarialVerify
verdict: confirmed
evidence: see "Commands run" below - every number in this file came from a command executed in this session
repro: no defect found in the repair; the one residual issue is a reporting gap owned by todo 6, repro: `bun run /tmp/vt1/probe.ts` SHAPE2 -> incomplete=2000 while 500 refused starts are visible only in droppedCalls, which `parallelism_summary` does not carry (packages/omo-senpi/src/components/telemetry/product-identity.ts:135-151)
confidence: 0.93
```

## 1. Independent reproduction of all three claimed shapes

Own scratch driver (`/tmp/vt1/probe.ts`, written from scratch, importing the exported
`assembleWaves` / `MAX_TRACKED_CALLS` directly). Author's script was deleted and was not reused.

```
$ bun run /tmp/vt1/probe.ts
SHAPE1 5000-starts-then-5000-ends
  tracked=2000 paired=2000 dropped=3000 observed=5000 incomplete=0 anomalies=0 malformed=0
  accounted(paired+incomplete+dropped)=5000 residentDetail=2000 CAP=2000 INVARIANT_OK=true BOUND_OK=true
SHAPE2 2500-starts-no-ends
  tracked=0 paired=0 dropped=500 observed=2500 incomplete=2000 anomalies=0 malformed=0
  accounted(paired+incomplete+dropped)=2500 residentDetail=2000 CAP=2000 INVARIANT_OK=true BOUND_OK=true
SHAPE3 2010-interleaved-pairs
  tracked=2000 paired=2000 dropped=10 observed=2010 incomplete=0 anomalies=0 malformed=0
  accounted(paired+incomplete+dropped)=2010 residentDetail=2000 CAP=2000 INVARIANT_OK=true BOUND_OK=true
```

| Shape | Claimed | Independently measured | Match |
| --- | --- | --- | --- |
| 5000 starts then 5000 ends | tracked 2000, dropped 3000, observed 5000 | tracked 2000, dropped 3000, observed 5000 | yes |
| 2500 starts, no ends | tracked 0, dropped 500, observed 2500, incomplete 2000 | identical | yes |
| 2010 interleaved pairs | tracked 2000, dropped 10, observed 2010 | identical | yes |

All three claimed number sets reproduce exactly. The original defect (`tracked=5000 dropped=0`;
2500 resident) is closed: resident detail is 2000 in every shape.

## 2. Attack on the invariant claim — arrival orders neither extreme covers

`/tmp/vt1/probe2.ts`. `resident = trackedDetail + incomplete` is the true memory footprint
(paired array + pending map), which is what the cap must bound.

```
$ bun run /tmp/vt1/probe2.ts
(a) starts -> partial ends -> more starts        [3000 starts, 1500 ends, 1500 more starts]
  tracked=1500 paired=1500 dropped=2500 observed=4500 incomplete=500 resident=2000 BOUND_OK=true INVARIANT=true
(b) 3 starts : 1 end ratio, 2000 rounds          [pending stays large and nonzero while paired grows]
  tracked=2000 paired=2000 dropped=4000 observed=6000 incomplete=0 resident=2000 BOUND_OK=true INVARIANT=true
(c) 2500 starts then 2500 ends incl. ends for refused starts
  tracked=2000 paired=2000 dropped=500 observed=2500 incomplete=0 resident=2000 BOUND_OK=true INVARIANT=true
(c2) 2100 starts, ends ONLY for the 100 refused starts
  tracked=0 paired=0 dropped=100 observed=2100 incomplete=2000 resident=2000 BOUND_OK=true INVARIANT=true
(d) boundary starts-then-ends n=1999   tracked=1999 dropped=0 observed=1999 resident=1999 BOUND_OK=true INVARIANT=true
(d) boundary interleaved     n=1999   tracked=1999 dropped=0 observed=1999 resident=1999 BOUND_OK=true INVARIANT=true
(d) boundary starts-then-ends n=2000   tracked=2000 dropped=0 observed=2000 resident=2000 BOUND_OK=true INVARIANT=true
(d) boundary interleaved     n=2000   tracked=2000 dropped=0 observed=2000 resident=2000 BOUND_OK=true INVARIANT=true
(d) boundary starts-then-ends n=2001   tracked=2000 dropped=1 observed=2001 resident=2000 BOUND_OK=true INVARIANT=true
(d) boundary interleaved     n=2001   tracked=2000 dropped=1 observed=2001 resident=2000 BOUND_OK=true INVARIANT=true
(e) clock anomaly + normal pair
  tracked=1 paired=1 dropped=0 observed=2 incomplete=0 anomalies=1 resident=1 BOUND_OK=true
  INVARIANT(p+i+d==obs)=FALSE   INVARIANT(p+i+d+anomalies==obs)=true
```

Findings per probe:

- **(a) re-entry after partial drain** — no leak. After the drain `paired=1500`, so only 500 of the
  1500 re-entrant starts are admitted and 1000 are refused. Resident lands exactly on 2000.
  This is the shape a `paired.length`-only gate would have gotten wrong in the opposite direction
  (it would have admitted all 1500 and grown pending to 500 past the cap).
- **(b) sustained pending pressure** — no leak. The gate fires on the sum, so a session that never
  drains still saturates at 2000 and refuses the remaining 4000 starts.
- **(c) ends for refused starts** — no corruption, no resurrection. An end whose start was refused
  hits `pending.get(...) === undefined` and is discarded silently
  (`wave-assembler.ts:87`), so it neither increments `pairedCalls` nor re-admits detail.
  Counters stay truthful. Note it is also NOT counted as `malformed`, which matches the deliberate
  orphan-end semantics already documented and asserted by the pre-existing malformed test.
- **(c2) ends only for the refused tail** — the adversarial version of (c). Resident stays 2000,
  `dropped=100`, nothing resurrects.
- **(d) exact boundary** — correct off-by-one behaviour on both arrival orders. `n=2000` admits all
  2000 with `dropped=0`; `n=2001` admits 2000 and drops exactly 1. `>=` is the right comparator.
- **(e) clock anomaly** — **the author's stated invariant `paired + incomplete + dropped == observed`
  is not universally true.** A clock-anomalous call is removed from `pending`, never enters `paired`,
  and lands only in `clockAnomalies`. The correct full invariant is
  `paired + incomplete + dropped + clockAnomalies == observed`. This is pre-existing behaviour from
  `b8078d13a` (unchanged by this repair, and the anomaly-exclusion semantics were explicitly
  confirmed correct by the prior verification), and every call is still accounted for in some
  counter, so nothing is silently lost. I record it as a precision correction to the author's claim,
  not a defect in the repair.

**Randomized sweep** (`/tmp/vt1/probe3.ts`, 400 deterministic-LCG interleavings, 2500-4500
observations each, 62% start bias, random-order ends):

```
$ bun run /tmp/vt1/probe3.ts
400 randomized interleavings: worstResident=2000 CAP=2000 boundBreaks=0 invariantBreaks=0
```

Worst-case resident detail across 400 arbitrary interleavings is exactly 2000, never above. The
author's correctness argument (a start migrates from `pending` to `paired`, so `paired.length +
pending.size` is invariant across the transition and the sum is monotone-bounded) holds up under
attack, and I could not construct a counterexample.

## 3. RED reconstruction against the old gate — genuine

Reconstructed independently: pulled the pre-fix module from git and pointed a copy of the CURRENT
test file at it. No author artifact reused.

```
$ git show b8078d13a:packages/omo-senpi/src/components/telemetry/wave-assembler.ts > /tmp/vt1/oldgate/wave-assembler.ts
$ grep -n "MAX_TRACKED_CALLS" /tmp/vt1/oldgate/wave-assembler.ts
10:export const MAX_TRACKED_CALLS = 2000
69:      if (paired.length >= MAX_TRACKED_CALLS) {        <- old gate, paired only
$ cp <current worktree>/wave-assembler.test.ts /tmp/vt1/oldgate/
$ bun test /tmp/vt1/oldgate/wave-assembler.test.ts
(fail) ... #given every start arriving before any end beyond the tracking cap ...
  expect(trackedCalls).toBe(MAX_TRACKED_CALLS)   Expected: 2000   Received: 2500
(fail) ... #given unmatched starts beyond the tracking cap ...
  expect(result.counters.incomplete).toBe(MAX_TRACKED_CALLS)   Expected: 2000   Received: 2500
 11 pass
 2 fail
 31 expect() calls
```

Exactly the claimed RED: 11 pass / 2 fail, `incomplete` Expected 2000 Received 2500. The two new
tests genuinely pin the defect - they fail against the old gate and pass against the fix. The RED
capture was not fabricated.

GREEN on the shipped code:

```
$ bun test packages/omo-senpi/src/components/telemetry/wave-assembler.test.ts
 13 pass
 0 fail
 35 expect() calls
```

## 4. No regression to metric logic

```
$ bun run /tmp/vt1/chained.ts
chained: waves=1 span=12 maxConcurrency=2 paired=3        <- A(0-5) B(4-9) C(8-12), as required
overlap3: waves=1 span=600 conc=3
sequential3: waves=3 spans=100,100,100
incomplete: incomplete=1 waves=1
anomaly: clockAnomalies=1 paired=1 waves=1
```

The chained-wave case is untouched by the repair: 1 wave, `span=12`, `maxConcurrency=2`. Spans,
wave partitioning, `incomplete`, and `clockAnomalies` all match the previously-confirmed values.

**Mutation check — the guard is still non-tautological.** Copied the CURRENT (post-fix) module to
`/tmp/vt1/mutant/`, replaced `spanMs: maxEnd - minStart` with `spanMs: max(endMs - startMs)`:

```
$ bun test /tmp/vt1/mutant/wave-assembler.test.ts
(fail) #given tool executions that overlap in time ... #then all three calls join one wave carrying a span
(fail) #given a chained wave where the first and last calls never overlap ... #then one wave reports the full span and a concurrency of two
  expect(result.waves[0]?.spanMs).toBe(12)   Expected: 12   Received: 5
 11 pass
 2 fail
```

The `max(d)` mutant is still caught (by two tests, not one). The repair did not weaken the span
guard.

The source diff is 8 lines: 6 lines of module comment plus a one-line gate change
(`paired.length` -> `paired.length + pending.size`), 1 deletion. There is no mechanism by which it
could perturb span/wave/concurrency computation, and the measurements above confirm it did not.

## 5. Position on the `incomplete` under-reporting trade

**My position: acceptable inside the module, NOT yet auditable on the wire. This is a real note for
todo 6, and it is stricter than the author's framing.**

The behaviour: once the cap is hit, refused starts land in `droppedCalls`, not `incomplete`. The
2500-starts case reports `incomplete=2000` when 2500 starts were genuinely unfinished. `incomplete`
therefore saturates at `MAX_TRACKED_CALLS` and understates by the dropped count.

Why it is acceptable at the module level: `incomplete` is defined as *residual pending detail*, and
the plan explicitly mandates dropping detail past the cap while keeping counters
("카운터만 유지하고 상세는 버림"). `observedCalls` remains exact and unsaturated, `droppedCalls`
carries the deficit exactly, and the full accounting
`paired + incomplete + dropped + clockAnomalies == observed` holds in all 400 randomized shapes plus
every hand-built shape above. A consumer holding all five counters can always recover the truth. No
call is silently lost.

Why it is nonetheless a live risk: **the registered `parallelism_summary` schema does not carry a
dropped-calls property.** `packages/omo-senpi/src/components/telemetry/product-identity.ts:135-151`
exposes `incomplete_calls` and `clock_anomalies` but no `dropped_calls`. A dashboard reading that
event sees `incomplete_calls = 2000` and has no way to detect that another 500 starts were refused,
nor that the value is a saturated ceiling rather than a measurement. The accounting invariant that
makes this trade defensible is *not observable to the consumer*. That is precisely the "silently
corrupts a metric a dashboard would read" failure mode - deferred one layer, not eliminated.

Recommendation for todo 6 (NOT a blocker on todo 1, whose contract is counters-only and is
satisfied): either add a `dropped_calls` number property to `parallelism_summary` so the invariant
is reconstructible on the wire, or emit a saturation flag so a reader can tell a true
`incomplete_calls = 2000` from a capped one. The schema is todo 5's file and correctly untouched
here.

## 6. Scope

```
$ git show --stat 791437517
 .omo/evidence/telemetry-parallel-latency-v2/task-1.md        | 121 +++++++++++++++
 packages/omo-senpi/src/components/telemetry/wave-assembler.test.ts |  40 ++++
 packages/omo-senpi/src/components/telemetry/wave-assembler.ts      |   8 +-
 3 files changed, 168 insertions(+), 1 deletion(-)
```

Exactly the three permitted paths. None of `savings-math.ts`, `eval-classifier.ts`,
`product-identity.ts`, `product-identity.test.ts`, `docs/reference/senpi-telemetry.md`,
`packages/telemetry-core/`, `packages/omo-codex/`, `packages/omo-opencode/`, `plugin/extensions/`,
or `index.ts` is touched by this commit. (A `git diff b8078d13a..791437517` range does show
`savings-math.ts`, `product-identity.ts`, and the telemetry doc, but those come from the intervening
commits `d6dd78b4f` and `de7416776` - todos 2 and 5, owned by other workers. The repair commit
itself is clean.)

**Interleaved fixture preserved:**

```
$ git diff b8078d13a 791437517 -- .../wave-assembler.test.ts | grep -c "^-[^-]"
0
```

Zero deleted lines in the test file. The original case (f) `#given more tool calls than the session
tracking cap` fixture is byte-identical - it was NOT rewritten to accommodate the fix. The two new
cases are pure additions. This is the correct move: keeping the strictly-interleaved fixture
preserves the one arrival order the old gate handled, so the suite now covers both.

## 7. Conventions on the diff

- **given/when/then:** both new cases use nested `describe("#given ...") > describe("#when ...") >
  test("#then ...")`. This satisfies AGENTS.md CONVENTIONS ("nested `describe` with
  `#given`/`#when`/`#then` prefixes"). No flat single-line `#given/#when/#then` title in the diff
  (`grep -E 'test\("#given.*#when.*#then'` -> none).
- **`as any`:** 0 occurrences in added lines. **`@ts-ignore`:** 0. **em dash:** 0.
  **non-ASCII / emoji:** none (`LC_ALL=C grep '[^ -~]'` over the 47 added lines -> none).
- **Pure LOC:**
  ```
  $ awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/)/' wave-assembler.ts | wc -l      -> 157
  $ awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/)/' wave-assembler.test.ts | wc -l -> 204
  ```
  Both under the 250 ceiling.
- Test data is fully literal - no `Date.now()`, no timers, no sleeps, no async. The two new cases
  cannot pass by timing luck.

## 8. Suite health

```
$ bun test packages/omo-senpi/src/components/telemetry/
 133 pass
 0 fail
 491 expect() calls
Ran 133 tests across 15 files. [2.67s]

$ bun run --cwd packages/omo-senpi typecheck
$ tsgo --noEmit -p tsconfig.json
TYPECHECK_EXIT=0
```

0 fail. The count is 133 rather than the author's recorded 118 because other workers landed
concurrent commits (todos 2 and 5) plus untracked todo-4 files; that in-flight work is out of scope
here and is green. `bun install` was not run.

## Commands run

```
git log --oneline -5
git status --porcelain
git show --stat 791437517
git show 791437517 -- packages/omo-senpi/src/components/telemetry/wave-assembler.ts packages/omo-senpi/src/components/telemetry/wave-assembler.test.ts
git show b8078d13a:packages/omo-senpi/src/components/telemetry/wave-assembler.ts > /tmp/vt1/oldgate/wave-assembler.ts
git diff b8078d13a 791437517 -- .../wave-assembler.test.ts | grep -c "^-[^-]"
bun run /tmp/vt1/probe.ts             # three claimed shapes
bun run /tmp/vt1/probe2.ts            # arrival orders (a)(b)(c)(c2)(d)(e)
bun run /tmp/vt1/probe3.ts            # 400 randomized interleavings
bun run /tmp/vt1/chained.ts           # chained-wave + metric regression
bun test /tmp/vt1/oldgate/wave-assembler.test.ts    # RED reconstruction
bun test /tmp/vt1/mutant/wave-assembler.test.ts     # spanMs mutation check
bun test packages/omo-senpi/src/components/telemetry/wave-assembler.test.ts
bun test packages/omo-senpi/src/components/telemetry/
bun run --cwd packages/omo-senpi typecheck
awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/)/' <file> | wc -l
```

## Verdict

**confirmed.** The repair is real and complete. The gate now bounds `paired.length + pending.size`,
all three claimed reproduction number sets are independently reproduced exactly, the bound holds
under six hand-built adversarial arrival orders and 400 randomized interleavings (worst resident
2000, zero breaches), the RED against the old gate reproduces exactly as claimed (11 pass / 2 fail,
Expected 2000 Received 2500), the interleaved fixture was kept rather than rewritten, metric logic
is unperturbed and its span guard is still non-tautological under mutation, scope is exactly the
three permitted files, conventions are clean, and the suite is 0 fail.

Two non-blocking corrections carried forward:

1. The author's invariant should read `paired + incomplete + dropped + clockAnomalies == observed`;
   `clockAnomalies` is a fourth sink (pre-existing, not introduced by this repair).
2. `incomplete_calls` saturates at the cap and `parallelism_summary` carries no `dropped_calls`, so
   the invariant that justifies the trade is not reconstructible by a dashboard. Note for todo 6.

## Cleanup receipt

```
$ rm -rf /tmp/vt1
$ ls -d /tmp/vt1 2>&1            -> ls: /tmp/vt1: No such file or directory
$ ls /tmp/wave-cap-repro.ts /tmp/wave-assembler-qa.ts /tmp/wave-assembler.ts.hold 2>&1
                                 -> No such file or directory (author's artifacts already absent)
$ git status --porcelain
?? packages/omo-senpi/src/components/telemetry/omo-native-parallel.test.ts
?? packages/omo-senpi/src/components/telemetry/omo-native-parallel.ts
```

No tracked modification from this verification. The two untracked files are another worker's
in-flight todo 4 and predate this session. The only file I created is this verdict file.
