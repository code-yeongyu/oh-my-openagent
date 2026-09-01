# Task 3 - eval 3-bucket classifier

Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency` (branch `feat/telemetry-parallel-latency`)

Files:
- `packages/omo-senpi/src/components/telemetry/eval-classifier.ts` (new)
- `packages/omo-senpi/src/components/telemetry/eval-classifier.test.ts` (new)

## Contract

Each wave is classified into exactly one bucket:
- `non_eval` - no call in the wave is the eval/code-execution tool
- `eval_only` - every call is eval
- `mixed` - both present

Parallelism and time-savings aggregates read the `non_eval` bucket ONLY. A `mixed`
wave is NOT stripped of its eval call and folded back into `non_eval`: removing the
eval call shrinks the wave span/max and inflates apparent savings (measured
distortion: a wave that truly saved 1.20s reports 0.70s after naive filtering).
`eval_only` waves are excluded from parallelism metrics entirely; only their count
and total duration are reported, in their own fields.

Eval detection reuses the existing normalization/suffix matcher from
`omo-native-tools.ts:182-190` (lowercase, trim, `-` -> `_`, then exact match or
`_`/`:`/`/` suffix match) against `eval`, `codemode`, `code_mode`. `code_mode` is
present so the `code-mode` spelling normalizes into a real match; `codemode` alone
would not match it. Bare `ln` is deliberately NOT in the list (stale historical
alias, false-positive risk). Only the tool NAME is read - no cell source, no args,
no results anywhere in this module.

## TDD - RED first

Tests were written before the production module. Verbatim RED capture:

```
$ cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency
$ bun test packages/omo-senpi/src/components/telemetry/eval-classifier.test.ts
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/eval-classifier.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './eval-classifier' from '/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency/packages/omo-senpi/src/components/telemetry/eval-classifier.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [212.00ms]
```

## GREEN - verify commands

```
$ bun test packages/omo-senpi/src/components/telemetry/eval-classifier.test.ts
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/eval-classifier.test.ts:
(pass) eval tool bucket classification > #given a wave with no eval calls #when classified #then it lands in non_eval [0.54ms]
(pass) eval tool bucket classification > #given a wave of only eval calls #when classified #then it lands in eval_only [0.08ms]
(pass) eval tool bucket classification > #given a wave with both eval and non-eval calls #when classified #then it lands in mixed [0.06ms]
(pass) eval tool bucket classification > #given eval naming variants #when detected #then only true eval names match [0.12ms]
(pass) eval tool bucket classification > #given a mixed wave #when aggregated #then it never leaks into the non_eval totals [0.14ms]
(pass) eval tool bucket classification > #given eval_only and mixed waves #when tool-call counters are aggregated #then only the non_eval domain is counted [0.14ms]
(pass) eval tool bucket classification > #given eval waves #when summarized #then their count and duration are reported in their own buckets [0.07ms]
(pass) eval tool bucket classification > #given wave sizes across every histogram bucket #when encoded #then counts are positional without labels [0.23ms]
(pass) eval tool bucket classification > #given malformed waves #when classified #then no throw and no misclassification [0.08ms]
(pass) eval tool bucket classification > #given repeated summaries of the same input #when compared #then the classifier holds no cross-call state [0.08ms]

 10 pass
 0 fail
 48 expect() calls
Ran 10 tests across 1 file. [323.00ms]
```

```
$ bun run --cwd packages/omo-senpi typecheck
$ tsgo --noEmit -p tsconfig.json
(exit 0, no diagnostics)
```

Mandatory case coverage:
- (a) `[bash,read,grep]` -> `non_eval`
- (b) `[eval]` -> `eval_only`
- (c) `[bash,eval]` -> `mixed`
- (d) `eval`, `codemode`, `mcp:eval`, `code-mode`, `EVAL`, ` eval `, `server/eval`, `tool_eval`, `code_mode` detected; `evaluate_foo`, `evaluate`, `ln`, `bash`, `read`, `codemodel`, `eval_helper`, empty, whitespace NOT detected
- (e) mixed wave does not leak into the non_eval aggregate
- (f) waves total / waves multi / joined calls / wave-size histogram aggregate the non_eval domain only (asserted by equality against a non_eval-only control plus absolute values)

## Mutation proof (guard is non-tautological)

Temporarily mutated `summarizeWaveBuckets` so `mixed` waves fall through into the
non_eval counters with their eval calls filtered out (exactly the forbidden naive
filtering). Verbatim FAILING capture:

```
$ bun test packages/omo-senpi/src/components/telemetry/eval-classifier.test.ts
37 |   test("#given a mixed wave #when aggregated #then it never leaks into the non_eval totals", () => {
38 |     const summary = summarizeWaveBuckets([wave(["bash", "eval"], 1_200), wave(["bash", "read"], 400)])
39 |
40 |     expect(summary.nonEval.wavesTotal).toBe(1)
                                            ^
error: expect(received).toBe(expected)

Expected: 1
Received: 2

      at .../eval-classifier.test.ts:40:40
(fail) eval tool bucket classification > #given a mixed wave #when aggregated #then it never leaks into the non_eval totals [0.49ms]

62 |     expect(polluted.nonEval.wavesTotal).toBe(nonEvalOnly.nonEval.wavesTotal)
                                             ^
error: expect(received).toBe(expected)

Expected: 3
Received: 5

      at .../eval-classifier.test.ts:62:41
(fail) eval tool bucket classification > #given eval_only and mixed waves #when tool-call counters are aggregated #then only the non_eval domain is counted [0.24ms]

84 |     expect(summary.nonEval.wavesTotal).toBe(1)
                                            ^
error: expect(received).toBe(expected)

Expected: 1
Received: 2

      at .../eval-classifier.test.ts:84:40
(fail) eval tool bucket classification > #given eval waves #when summarized #then their count and duration are reported in their own buckets [0.10ms]

 7 pass
 3 fail
 38 expect() calls
Ran 10 tests across 1 file. [286.00ms]
```

Mutation reverted from a pre-mutation copy; re-run afterwards: `10 pass / 0 fail`.

## Manual QA (auxiliary surface)

Throwaway script `/tmp/task3-qa.ts` (deleted after the run) classified a realistic
mixed set of waves and printed the bucket summary plus non_eval-only counters.

```
$ cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency
$ bun run /tmp/task3-qa.ts
per-wave classification
  non_eval  span=  820ms  [bash, read, grep]
  non_eval  span=  310ms  [read, read]
  non_eval  span=  120ms  [edit]
  eval_only span= 4400ms  [eval]
  eval_only span= 2100ms  [mcp:eval, codemode]
  mixed     span= 1200ms  [bash, eval]
  mixed     span= 1900ms  [read, grep, code-mode]
  non_eval  span=  640ms  [evaluate_foo, bash]

bucket summary
  eval_only waves      : 2
  eval_only duration ms: 6500
  mixed waves          : 2

non_eval-only counters (parallelism aggregates)
  non_eval_waves_total       : 4
  non_eval_waves_multi       : 3
  non_eval_joined_calls      : 8
  non_eval_wave_size_histogram: 1:2:1:0:0:0:0:0

control: counters computed from non_eval waves alone are identical -> PASS
```

Binary PASS/FAIL observable: 8 waves in, 4 `non_eval` + 2 `eval_only` + 2 `mixed`
out; `non_eval_waves_total = 4` and `non_eval_joined_calls = 8` count only the four
non_eval waves (3 + 2 + 1 + 2 calls), so the 2 eval_only and 2 mixed waves are
excluded from every parallelism counter while being reported separately with their
own count and duration. The control line recomputes the counters from the non_eval
waves alone and asserts byte-identical output -> PASS. Note `[evaluate_foo, bash]`
stayed `non_eval`, confirming no eval false positive.

## Adversarial classes

- Malformed input: empty wave, empty/whitespace tool names, unicode (`코드`,
  fullwidth `Ｅｖａｌ`), mixed case (`EVAL`), padded (` eval `). No throw; empty wave
  classifies as `non_eval` and contributes 0 joined calls without entering any
  histogram bucket; fullwidth `Ｅｖａｌ` does not lowercase to ASCII `eval` and is
  correctly NOT treated as eval. Covered by the malformed-waves test.
- Misleading success output: mutation proof above - the forbidden fold of `mixed`
  into `non_eval` makes cases (e) and (f) fail, so the guards cannot pass
  tautologically.
- Stale state: the module exports pure functions only; no module-level mutable
  state exists (the histogram array is allocated per call). Asserted by summarizing
  the same input twice and comparing deep-equal, plus an empty-input summary
  yielding the zeroed histogram.
- Ruled out - concurrency/interleaving: pure synchronous functions with no shared
  mutable state, so there is no interleaving hazard.
- Ruled out - privacy leakage: only `toolNames` and `spanMs` cross the API surface;
  no args, results, or cell source are accepted or stored.
- Ruled out - numeric overflow/truncation of the histogram string: 8 positional
  buckets with the plan's `MAX_TRACKED_CALLS = 2000` upper bound give at most 4
  digits per bucket = 39 chars, well under the 64-char truncation limit, and the
  encoding carries no labels.

## Cleanup receipt

`/tmp/task3-qa.ts` deleted after the run (`rm /tmp/task3-qa.ts`); scratch capture
files `/tmp/task3-red.txt`, `/tmp/task3-mutation.txt`, `/tmp/task3-qa-out.txt` and
the pre-mutation backup `/tmp/eval-classifier.orig.ts` also removed. No artifacts
remain outside the worktree.

## Commands

```
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency
bun test packages/omo-senpi/src/components/telemetry/eval-classifier.test.ts
bun run --cwd packages/omo-senpi typecheck
```
