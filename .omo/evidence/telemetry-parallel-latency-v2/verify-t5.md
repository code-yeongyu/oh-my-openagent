# Adversarial verification — todo 5 (`parallelism_summary` schema registration)

Verifier: independent, did not implement todo 5.
Commit under verification: `de7416776` — `feat(omo-senpi): register parallelism_summary event schema`
Method: all probes run in a **detached scratch worktree** at exactly `de7416776`
(`git worktree add --detach /tmp/vt5-scratch de7416776`), with `node_modules` symlinked
from the parent worktree (no `bun install`). Zero tracked files mutated in the live worktree.

```AdversarialVerify
verdict: confirmed
evidence: |
  # scratch worktree pinned to the commit under verification
  $ git worktree add --detach /tmp/vt5-scratch de7416776
  HEAD is now at de7416776 feat(omo-senpi): register parallelism_summary event schema

  # --- property set exactness (15 entries, read from the frozen object) ---
  $ bun -e '...import product-identity.ts; dump OMO_NATIVE_EVENT_SCHEMAS.parallelism_summary...'
  $session_id -> {"type":"string"}
  clock_anomalies -> {"type":"number"}
  eval_only_duration_ms -> {"type":"number"}
  eval_only_waves -> {"type":"number"}
  incomplete_calls -> {"type":"number"}
  measured_turn_duration_ms_total -> {"type":"number"}
  mixed_waves -> {"type":"number"}
  modeled_wallclock_saved_ms -> {"type":"number"}
  non_eval_joined_calls -> {"type":"number"}
  non_eval_saved_round_trips -> {"type":"number"}
  non_eval_wave_size_histogram -> {"type":"string"}
  non_eval_waves_multi -> {"type":"number"}
  non_eval_waves_total -> {"type":"number"}
  schema_kind -> {"type":"string","values":["parallelism_v1"]}
  upper_bound_saved_ms -> {"type":"number"}
  frozen: true

  # --- doc gate probe A: add a property, leave the doc alone ---
  $ (insert `zz_probe_property: NUMBER_PROPERTY,` into the schema)
  $ bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
  error: Telemetry schema documentation drifted.
  (fail) ... #then the generated schema block is byte exact [16.09ms]
   1 pass
   1 fail
  # restore
  $ cp /tmp/vt5-pi.bak packages/.../product-identity.ts
  $ git diff --stat            # (no output = restored)
  $ bun test .../schema-doc.test.ts
   2 pass
   0 fail

  # --- doc block was GENERATED, byte-for-byte ---
  $ bun -e 'compare generateTelemetrySchemaBlock() vs block between sentinels'
  actual bytes: 5921 expected bytes: 5921
  byte-exact identical: true

  # --- mutation probe: delete non_eval_wave_size_histogram from the schema ---
  $ bun test packages/omo-senpi/src/components/telemetry/product-identity.test.ts
  (fail) OmO Native product identity > #given the tracked-call cap #when the widest wave
         histogram is encoded #then it stays inside the 64 character privacy limit [0.20ms]
   8 pass
   1 fail
  # restore -> git status clean

  # --- independently measured histogram lengths ---
  positional: 2000:2000:2000:2000:2000:2000:2000:2000
  positional length: 39 formula 8*4+7 = 39
  labelled:   1=2000:2=2000:3=2000:4=2000:5_8=2000:9_16=2000:17_32=2000:33plus=2000
  labelled length: 69
  positional survives 64 slice: true
  labelled truncated by 64 slice: true -> "1=2000:...:33plus"

  # --- allowlist enforcement through the real client + createTransportRecorder() ---
  $ bun /tmp/vt5-probe.ts
  allowlisted count: 15
  captured non-shared keys: ["$session_id","clock_anomalies","eval_only_duration_ms",
    "eval_only_waves","incomplete_calls","measured_turn_duration_ms_total","mixed_waves",
    "modeled_wallclock_saved_ms","non_eval_joined_calls","non_eval_saved_round_trips",
    "non_eval_wave_size_histogram","non_eval_waves_multi","non_eval_waves_total",
    "schema_kind","upper_bound_saved_ms"]
  every allowlisted arrived intact: true
  missing allowlisted: []
  intruders present: []                     # sent median_wave_size, eval_cell_source, prompt_text
  labelled input length: 69 captured length: 64
  silently truncated to exactly 64: true

  # --- evidence reproduction ---
  $ bun test packages/omo-senpi/src/components/telemetry/product-identity.test.ts
   9 pass / 0 fail / 160 expect() calls   (claim: 9 pass)  MATCH
  $ bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
   2 pass / 0 fail                        (claim: 2 pass)  MATCH
  $ bun test packages/omo-senpi/src/components/telemetry/
   116 pass / 0 fail / 457 expect() calls across 14 files  (claim: 116/0)  MATCH
  $ bun run --cwd packages/omo-senpi typecheck   # in the live worktree
  $ tsgo --noEmit -p tsconfig.json
  EXITCODE=0                                (claim: exit 0, no diagnostics)  MATCH

  # --- must-NOT-have ---
  $ git show --name-only --format="" de7416776
  .omo/evidence/telemetry-parallel-latency-v2/task-5.md
  docs/reference/senpi-telemetry.md
  packages/omo-senpi/src/components/telemetry/product-identity.test.ts
  packages/omo-senpi/src/components/telemetry/product-identity.ts
  $ ... | grep -E 'telemetry-core/|omo-codex/|omo-opencode/|plugin/extensions/' | wc -l
  0
  $ git show de7416776 -- 'packages/omo-senpi/**' | grep '^-' | grep -v '^---'
  (empty = pure additions, no schema entry modified)
repro: none — no defect found.
confidence: 0.95
```

## Acceptance-criterion table

| # | Criterion | Result | Observation that decided it |
|---|---|---|---|
| 1 | Schema contains exactly the 15 specified properties, nothing extra/missing | **PASS** | Runtime dump of `OMO_NATIVE_EVENT_SCHEMAS.parallelism_summary`: exactly 15 keys, set-equal to the spec list. |
| 1b | Types correct (`$session_id` string; 12 numbers; histogram string; `schema_kind` enum) | **PASS** | Dump shows `{"type":"string"}` for `$session_id`/`non_eval_wave_size_histogram`, `{"type":"number"}` for all 12 counters, `{"type":"string","values":["parallelism_v1"]}` for `schema_kind` (single value). |
| 1c | Every tool-call-derived COUNT carries the `non_eval_` prefix | **PASS** | The four wave/call counts are `non_eval_waves_total`, `non_eval_waves_multi`, `non_eval_joined_calls`, `non_eval_saved_round_trips`. The remaining counts are deliberately eval-bucket (`eval_only_waves`, `mixed_waves`) or quality counters (`incomplete_calls`, `clock_anomalies`), which the plan names as separate domains, not non_eval aggregates. No unprefixed non_eval count exists. |
| 2a | The doc gate actually fires | **PASS** | Adding `zz_probe_property` to the schema turned `schema-doc.test.ts` from 2 pass/0 fail to 1 pass/1 fail with `error: Telemetry schema documentation drifted.` Restoring returned it to 2 pass/0 fail. |
| 2b | Doc block is generated, not hand-edited | **PASS** | `generateTelemetrySchemaBlock()` output vs the shipped block between sentinels: 5921 bytes each, `actual === expected` -> `true`. Zero byte difference. |
| 3a | Positional encoding fits at the real upper bound | **PASS** | Independently reproduced: `2000` x 8 joined by `:` = **39 chars** = `8*4 + 7`; survives a 64-char slice unchanged. |
| 3b | Labelled form would truncate | **PASS** | Independently reproduced: `1=2000:2=2000:...:33plus=2000` = **69 chars**; 64-slice cuts to `...:33plus`, losing the final bucket value. |
| 3c | The test asserts the honest 39-char bound, not a fictional worst case | **PASS** | The test derives the width from the real exported `MAX_TRACKED_CALLS` (verified `= 2000` in `wave-assembler.ts:10` at this commit) and asserts `toHaveLength(bucketCount * 4 + (bucketCount - 1))` = 39, plus `<= 64`. It does not hardcode an inflated digit count. |
| 4a | All 15 allowlisted properties arrive intact | **PASS** | Real `createEventTelemetryClient` + repo `createTransportRecorder()`: captured non-shared key set is exactly the 15 allowlisted keys; `every allowlisted arrived intact: true`; `missing allowlisted: []`. |
| 4b | Non-allowlisted properties dropped | **PASS** | Sent `median_wave_size`, `eval_cell_source`, `prompt_text` alongside; `intruders present: []`. |
| 4c | >64-char string truncated to exactly 64 | **PASS** | 69-char labelled string in, 64-char string out, `silently truncated to exactly 64: true` — the corruption mechanism the positional encoding avoids. |
| 5 | Mutation probe: guard test is non-vacuous | **PASS** | Deleting `non_eval_wave_size_histogram` from the schema flipped `product-identity.test.ts` to 8 pass / 1 fail, failing precisely the new histogram guard. |
| 6a | `turn_completed` schema unchanged | **PASS** | `git show de7416776 -- 'packages/omo-senpi/**' \| grep '^-'` is empty (pure additions); the only `turn_completed` mentions in the whole diff are prose lines inside `task-5.md`. |
| 6b | No median / averaged-ratio property | **PASS** | No property name in the 15-key dump contains `median`, `avg`, `average`, or `ratio`. `upper_bound_saved_ms` carries the mandated `_upper_bound`-style honesty label. |
| 6c | No `_text` / `_path` / `_prompt` suffix | **PASS** | None of the 15 keys ends in those suffixes (also structurally blocked by `FORBIDDEN_SUFFIX` in `telemetry-core/src/events.ts:50`). |
| 6d | Zero changes under telemetry-core / omo-codex / omo-opencode / plugin/extensions | **PASS** | `git show --name-only` lists 4 files only; the forbidden-path grep count is `0`. |
| 7a | given/when/then convention | **PASS** | The added test uses inline `// given:` / `// when:` / `// then:` comments, explicitly permitted by AGENTS.md:292 ("or inline `// given` / `// when` / `// then` comments"). It also matches the file's existing `#given/#when/#then` title convention used by all 8 pre-existing tests. Not a style finding. |
| 7b | No `as any`, no `@ts-ignore` | **PASS** | grep over added source lines: 0 hits each. `enumProperty([...] as const)` is a const assertion, not `as any`. |
| 7c | No emojis, no em dashes in added source | **PASS** | grep + perl unicode-range scan over added lines of both `.ts` files: 0 hits. (Em dashes exist only in the `task-5.md` evidence prose, not in source.) |
| 7d | Files under the 250 pure-LOC ceiling | **PASS** | `product-identity.ts` 220 -> **237**; `product-identity.test.ts` 114 -> **125**. Both under 250. (Note: `product-identity.ts` at 237 is over the AGENTS.md 200 LOC *soft* limit, but it was already at 220 before this commit — pre-existing, not introduced here.) |
| 8 | Evidence numbers reproduce | **PASS** | 9/2/116-0/exit-0 all reproduced exactly (see evidence block). |

## Doc-gate probe result

**The gate is real.** In a clean scratch copy at `de7416776` I inserted one extra
property (`zz_probe_property: NUMBER_PROPERTY`) into `OMO_NATIVE_EVENT_SCHEMAS.parallelism_summary`
without touching `docs/reference/senpi-telemetry.md`. `schema-doc.test.ts` immediately
went **1 pass / 1 fail** with `error: Telemetry schema documentation drifted.` and printed
the corrected block. Restoring the file returned it to **2 pass / 0 fail**.

Separately, the shipped doc block is provably generator output, not hand-typed:
`generateTelemetrySchemaBlock()` and the text between the sentinels are both 5921 bytes
and compare `===` true. Zero byte drift.

## Mutation probe result

**The new guard test is not vacuous.** Deleting the line
`non_eval_wave_size_histogram: STRING_PROPERTY,` from the schema in the scratch copy made
`product-identity.test.ts` drop to **8 pass / 1 fail**, and the failing test is exactly
the new one (`#given the tracked-call cap #when the widest wave histogram is encoded
#then it stays inside the 64 character privacy limit`). The test is coupled to the real
schema object and cannot pass with the property absent. Restored; `git diff --stat` empty.

## Independently measured histogram lengths

| Encoding | String at `MAX_TRACKED_CALLS = 2000` | Length | Survives the 64-char wrapper slice? |
|---|---|---|---|
| Positional (shipped contract) | `2000:2000:2000:2000:2000:2000:2000:2000` | **39** | Yes — unchanged (25 chars headroom) |
| Labelled (forbidden) | `1=2000:2=2000:3=2000:4=2000:5_8=2000:9_16=2000:17_32=2000:33plus=2000` | **69** | No — truncated to `...:33plus`, last bucket value destroyed |

Both figures reproduced from scratch (`8*4 + 7 = 39` confirmed arithmetically and by
`String.length`), and the 69->64 truncation was also observed end-to-end through the real
capture path, not just by `slice()`.

## Attempts to break the claim that did NOT succeed

- Tried to find a count property missing the `non_eval_` prefix that is nonetheless
  tool-call-derived — the only unprefixed counts are the explicitly separate eval-bucket
  and data-quality counters the plan mandates as distinct domains.
- Tried to make the doc gate a no-op — it fired on the first mutation.
- Tried to make the histogram guard pass vacuously by deleting the property it asserts on
  — it failed loudly instead.
- Tried to smuggle non-allowlisted and forbidden-suffix properties through the real
  transport — all three were dropped.
- Tried to find hidden edits to `turn_completed` or forbidden packages — the diff is four
  files and pure additions.

## Known non-blocking observations

1. **Scratch-only typecheck noise.** Running `bun run --cwd packages/omo-senpi typecheck`
   inside the scratch worktree emitted one `TS2322` in
   `packages/utils/src/runtime/file.ts(35,11)`. This is an artifact of my `node_modules`
   symlink resolving that package back through the parent worktree path (duplicate lib
   resolution), not a defect of todo 5 — that file is untouched by the commit, and in the
   real worktree the same command exits **0 with no diagnostics**. Not attributable.
2. **Soft LOC limit.** `product-identity.ts` sits at 237 pure LOC against AGENTS.md's
   200 LOC *soft* limit. It was already 220 before this commit; the +17 is the minimum
   required schema entry. Under the 250 ceiling this verification applies. Informational.
3. **Cross-lane coupling.** The guard test imports `MAX_TRACKED_CALLS` from
   `wave-assembler.ts`, owned by todo 1. I checked the in-flight lane's diff for that file:
   `MAX_TRACKED_CALLS` is unchanged at `2000`, so the 4-digit assumption still holds. If a
   later lane raises that constant past 9999 the guard would correctly fail rather than
   silently ship a truncatable string — the coupling is a feature, not a hazard.

## Cleanup receipt

- Scratch worktree `/tmp/vt5-scratch` — all `node_modules` symlinks removed, then
  `git worktree remove --force /tmp/vt5-scratch`. Before removal `git status --short`
  in the scratch was **empty** (both probe mutations restored).
- `/tmp/vt5-pi.bak` (mutation-probe backup), `/tmp/vt5-probe.ts` (allowlist capture
  script), `/tmp/vt5-tc-real.txt` — deleted. `ls /tmp/vt5-*` -> `No such file or directory`.
- Live worktree: **no tracked file mutated by this verification.** Final
  `git status --short` shows only `?? omo-native-parallel.test.ts` and
  `?? omo-native-parallel.ts`, which are another worker's in-flight todo-4 files, untouched
  by me. The only file I wrote is this verdict file.

## Verdict

**confirmed.** Todo 5's done-claim survives every probe: the property set is exactly the
15 specified entries with correct types, the doc block is byte-exact generator output
guarded by a gate that demonstrably fires, the histogram guard is non-vacuous and asserts
the honest 39-char bound against the real 64-char truncation threshold, the allowlist drops
every intruder while passing all 15 properties intact, no must-NOT-have was violated, and
every claimed number reproduces.
