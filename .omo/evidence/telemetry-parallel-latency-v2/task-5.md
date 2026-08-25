# Task 5 — `parallelism_summary` schema registration

Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-telemetry-parallel-latency`
Baseline before work: `bun test packages/omo-senpi/src/components/telemetry/` = 115 pass / 0 fail
(115, not 103 — todo 2's `savings-math` tests had already landed in the worktree as untracked files.)

## Changed files

- `packages/omo-senpi/src/components/telemetry/product-identity.ts` — added the `parallelism_summary` entry to `OMO_NATIVE_EVENT_SCHEMAS` immediately after `feature_used`, alphabetically ordered, using the shared `STRING_PROPERTY` / `NUMBER_PROPERTY` / `enumProperty([...] as const)` helpers inside `Object.freeze({ ... })`.
- `packages/omo-senpi/src/components/telemetry/product-identity.test.ts` — added the histogram-width guard test.
- `docs/reference/senpi-telemetry.md` — generated block regenerated verbatim from `script/telemetry-schema-block.mjs` (15 added rows, no hand edits).

`turn_completed` untouched. `packages/telemetry-core/`, `packages/omo-codex/`, `packages/omo-opencode/`, `wave-assembler.ts`, `eval-classifier.ts`, `savings-math.ts`, and `packages/omo-senpi/plugin/extensions/*.js` all unmodified (`git status` clean for those paths).

## Registered property set

| Property | Type |
| --- | --- |
| `$session_id` | string |
| `clock_anomalies` | number |
| `eval_only_duration_ms` | number |
| `eval_only_waves` | number |
| `incomplete_calls` | number |
| `measured_turn_duration_ms_total` | number |
| `mixed_waves` | number |
| `modeled_wallclock_saved_ms` | number |
| `non_eval_joined_calls` | number |
| `non_eval_saved_round_trips` | number |
| `non_eval_wave_size_histogram` | string (positional, `:`-joined, no labels) |
| `non_eval_waves_multi` | number |
| `non_eval_waves_total` | number |
| `schema_kind` | enum `parallelism_v1` |
| `upper_bound_saved_ms` | number |

No median properties, no averaged ratios, no `_text` / `_path` / `_prompt` suffixes.

## RED / GREEN — the doc gate actually fires

### RED (schema added, doc not yet regenerated)

```
$ bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/schema-doc.test.ts:
40 |     const generateTelemetrySchemaBlock = await loadGenerator()
41 |     const expected = generateTelemetrySchemaBlock()
42 |     const actual = extractGeneratedBlock(await readFile(DOC_PATH, "utf8"))
43 |
44 |     if (actual !== expected) {
45 |       throw new Error([
                     ^
error: Telemetry schema documentation drifted.

Paste this exact generated block into docs/reference/senpi-telemetry.md:

<!-- BEGIN GENERATED SCHEMA -->
... (full expected block printed by the test; tail shown) ...
| `parallelism_summary` | `$session_id` | `string` | - |
| `parallelism_summary` | `clock_anomalies` | `number` | - |
| `parallelism_summary` | `eval_only_duration_ms` | `number` | - |
| `parallelism_summary` | `eval_only_waves` | `number` | - |
| `parallelism_summary` | `incomplete_calls` | `number` | - |
| `parallelism_summary` | `measured_turn_duration_ms_total` | `number` | - |
| `parallelism_summary` | `mixed_waves` | `number` | - |
| `parallelism_summary` | `modeled_wallclock_saved_ms` | `number` | - |
| `parallelism_summary` | `non_eval_joined_calls` | `number` | - |
| `parallelism_summary` | `non_eval_saved_round_trips` | `number` | - |
| `parallelism_summary` | `non_eval_wave_size_histogram` | `string` | - |
| `parallelism_summary` | `non_eval_waves_multi` | `number` | - |
| `parallelism_summary` | `non_eval_waves_total` | `number` | - |
| `parallelism_summary` | `schema_kind` | `string` | `parallelism_v1` |
| `parallelism_summary` | `upper_bound_saved_ms` | `number` | - |
<!-- END GENERATED SCHEMA -->
      at <anonymous> (.../schema-doc.test.ts:45:17)
(fail) OmO Native telemetry schema documentation > #given the product allowlists #when the reference is checked #then the generated schema block is byte exact [15.64ms]
(pass) OmO Native telemetry schema documentation > #given an empty property schema #when generation is attempted #then no corrupt block is emitted [0.16ms]

 1 pass
 1 fail
 1 expect() calls
Ran 2 tests across 1 file. [110.00ms]
```

### Regeneration (generated output spliced in, not hand-written)

```
$ bun -e '
const fs = require("node:fs");
const { generateTelemetrySchemaBlock } = await import("./script/telemetry-schema-block.mjs");
const path = "docs/reference/senpi-telemetry.md";
const doc = fs.readFileSync(path, "utf8");
const B = "<!-- BEGIN GENERATED SCHEMA -->", E = "<!-- END GENERATED SCHEMA -->";
const b = doc.indexOf(B), e = doc.indexOf(E);
fs.writeFileSync(path, doc.slice(0, b) + generateTelemetrySchemaBlock() + doc.slice(e + E.length));
console.log("replaced", b, e);
'
replaced 679 5574
```

### GREEN

```
$ bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
(pass) OmO Native telemetry schema documentation > #given the product allowlists #when the reference is checked #then the generated schema block is byte exact
(pass) OmO Native telemetry schema documentation > #given an empty property schema #when generation is attempted #then no corrupt block is emitted

 2 pass
 0 fail
 1 expect() calls
Ran 2 tests across 1 file. [97.00ms]
```

## Verify commands

```
$ bun test packages/omo-senpi/src/components/telemetry/product-identity.test.ts
 9 pass / 0 fail / 160 expect() calls

$ bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
 2 pass / 0 fail

$ bun test packages/omo-senpi/src/components/telemetry/
 116 pass / 0 fail / 457 expect() calls (14 files)

$ bun run --cwd packages/omo-senpi typecheck
$ tsgo --noEmit -p tsconfig.json
(exit 0, no diagnostics)
```

## Manual QA — allowlist enforcement at the transport boundary

Throwaway script (`parallelism-qa.tmp.ts`, deleted afterwards) built a real
`createEventTelemetryClient` with `OMO_NATIVE_PROPERTY_ALLOWLISTS` and the repo's
`createTransportRecorder()`, captured a `parallelism_summary` event carrying every
allowlisted property plus two non-allowlisted ones (`median_wave_size`,
`eval_cell_source`), and printed what actually reached the transport.

Verbatim stdout:

```
=== captured payload (transport-visible) ===
{
  "distinctId": "machine-hash",
  "event": "parallelism_summary",
  "properties": {
    "$session_id": "hashed-session",
    "clock_anomalies": 1,
    "eval_only_duration_ms": 45000,
    "eval_only_waves": 2,
    "incomplete_calls": 3,
    "measured_turn_duration_ms_total": 120000,
    "mixed_waves": 4,
    "modeled_wallclock_saved_ms": 2000,
    "non_eval_joined_calls": 21,
    "non_eval_saved_round_trips": 9,
    "non_eval_wave_size_histogram": "12:5:3:1:0:0:0:0",
    "non_eval_waves_multi": 5,
    "non_eval_waves_total": 21,
    "schema_kind": "parallelism_v1",
    "upper_bound_saved_ms": 7430,
    "platform": "omo-senpi",
    "product_name": "omo-native",
    "package_version": "5.0.0-beta.7",
    "schema_version": 1,
    "$process_person_profile": false
  }
}

=== allowlist enforcement ===
allowlisted properties intact: true
non-allowlisted properties present: []
RESULT: PASS

=== histogram width ===
example histogram: 12:5:3:1:0:0:0:0 length: 16
worst case (2000 per bucket): 2000:2000:2000:2000:2000:2000:2000:2000 length: 39
labelled encoding would be: 1=2000:2=2000:3=2000:4=2000:5_8=2000:9_16=2000:17_32=2000:33plus=2000 length: 69 -> truncated: true

=== malformed input: 80-char string ===
input length: 80 captured length: 64
silently truncated (no error): true
```

Binary result: **PASS** — every allowlisted property present with its value intact;
both non-allowlisted properties absent from the captured payload. The extra keys in
the payload (`platform`, `product_name`, `package_version`, `schema_version`,
`$process_person_profile`) are the wrapper's own shared properties, added after
projection, not caller-supplied data.

## Adversarial classes

- **Schema drift** — PROBED, fires. `schema-doc.test.ts` failed the moment the schema
  entry was added and passed only after the doc block was regenerated from the
  generator (RED/GREEN pair above). The doc gate is real, not decorative.
- **Malformed input / silent truncation** — PROBED. An 80-char string on
  `non_eval_wave_size_histogram` reached the transport as exactly 64 chars with no
  error and no diagnostic to the caller. This is why the histogram must be positionally
  encoded: the labelled form `1=2000:2=2000:...` is 69 chars, so it would be truncated
  to 64 mid-token and ship a corrupted final bucket that still parses as a plausible
  number. Positional encoding at the real upper bound is 39 chars, 25 chars of headroom.
- **Misleading success output** — PROBED. Removed `non_eval_wave_size_histogram` from a
  scratch copy of `product-identity.ts`; the new guard test failed
  (`TypeError: undefined is not an object (evaluating
  'OMO_NATIVE_EVENT_SCHEMAS.parallelism_summary.non_eval_wave_size_histogram.type')`,
  8 pass / 1 fail), proving the test is coupled to the real schema and cannot pass
  vacuously. The tracked file was restored from backup and re-verified
  (`git diff --stat` = 17 insertions, 0 deletions; full suite back to 116 pass / 0 fail).
- **Histogram overflow beyond 4 digits** — RULED OUT: `MAX_TRACKED_CALLS = 2000` in
  `wave-assembler.ts` caps tracked calls, so no single bucket count can exceed 4 digits.
  The guard asserts the honest `8*4 + 7 = 39` worst case, not a fictional 6-digit one.
- **Volume/emission-rate regressions** — RULED OUT for this todo: registration adds no
  emission path; firing is todo 6's scope.
- **`turn_completed` regression** — RULED OUT: the diff adds a sibling schema entry only;
  `git diff` shows zero lines touching the `turn_completed` block.

## Cleanup receipt

- `parallelism-qa.tmp.ts` (worktree QA script) — deleted.
- `/tmp/parallelism-qa.ts` — deleted.
- `/tmp/product-identity.backup.ts` (mutation-probe backup) — restored to source, then deleted.
- Post-cleanup `git status --short` shows only the three intended modified files plus
  another worker's untracked `savings-math.ts` / `savings-math.test.ts`.

## Risks

- The doc gate only guards the generated block; the prose sections around it are not
  covered, so a future property whose meaning needs prose explanation could ship
  undocumented in narrative terms while still passing the byte-exact test.
- `non_eval_wave_size_histogram` correctness (bucket order and positional encoding) is a
  producer-side contract; this todo registers the string type and proves the width bound
  but cannot enforce the encoding itself. Todo 6 must build the string in the fixed order
  `1, 2, 3, 4, 5_8, 9_16, 17_32, 33plus` with no labels.
