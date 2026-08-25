# CI fix: register `parallelism_summary` in the OmO Native QA event allowlist

PR #6897 — branch `feat/telemetry-parallel-latency` -> `dev`.

## 1. Exact failing message

`test (ubuntu-latest)` job, step "Run tests" (`bun test`):

```
error: OmO Native QA allowlist event coverage diverged: missing=none; extra=parallelism_summary
      at assertAllowlistCoverage (script/qa/omo-native-telemetry-qa.mjs:43:15)
      at script/qa/omo-native-telemetry-qa.mjs:47:1
```

Reproduced locally before the fix with `bun test script/qa/omo-native-telemetry-qa.test.ts` (0 pass / 1 fail / 1 error, identical message).

## 2. The guard: what and where

- Guard implementation: `script/qa/omo-native-telemetry-qa.mjs:38-45` (`assertAllowlistCoverage`), throwing at `script/qa/omo-native-telemetry-qa.mjs:43`.
- Guard data source (the pinned expected set): `script/qa/omo-native-telemetry-qa.mjs:27-36` (`const expectedNativeEvents = new Set([...])`).
- Guard invocation at module load: `script/qa/omo-native-telemetry-qa.mjs:47` — so merely importing the QA driver validates coverage.
- Guard's CI surface (the bun test that failed): `script/qa/omo-native-telemetry-qa.test.ts:6-14` (`EXPECTED_EVENTS`) and `script/qa/omo-native-telemetry-qa.test.ts:16-27` (both test cases).

What it protects: `OMO_NATIVE_PROPERTY_ALLOWLISTS` in
`packages/omo-senpi/src/components/telemetry/product-identity.ts:155` is derived automatically from
`OMO_NATIVE_EVENT_SCHEMAS` (`product-identity.ts:68`). The real-surface QA driver uses those allowlists to
privacy-scan every captured PostHog payload (property allowlist, `$`-property allowlist, known-model /
known-provider masking, absolute-path scan, prompt-fragment scan — `omo-native-telemetry-qa.mjs:353-388`) and to
require presence of each native event in a live CLI drive (`omo-native-telemetry-qa.mjs:344`). Because the
allowlist is derived, a newly added event would silently expand the QA's scan scope with no human ever deciding
that the event is QA-covered. The divergence guard is the tripwire: any new event must be *consciously registered*
in the QA's pinned expected set, and any event silently dropped from the schema fails as `missing=`.

Correct fix = register the event (done below). Weakening the comparison, skipping the test, or special-casing
`parallelism_summary` would defeat exactly the protection described above; none of that was done.

`parallelism_summary` is emitted at most once per session on `session_shutdown`
(`packages/omo-senpi/src/components/telemetry/omo-native-component.ts:61-62` documents the ordering constraint) and
carries 16 properties: `$session_id`, `schema_kind` (`parallelism_v1`), non-eval round-trip/wave counters
(`non_eval_waves_total`, `non_eval_waves_multi`, `non_eval_joined_calls`, `non_eval_saved_round_trips`,
`non_eval_wave_size_histogram`), wall-clock savings (`modeled_wallclock_saved_ms`, `upper_bound_saved_ms`,
`measured_turn_duration_ms_total`), eval-bucket separation (`eval_only_waves`, `eval_only_duration_ms`,
`mixed_waves`), and data-quality counters (`incomplete_calls`, `dropped_calls`, `clock_anomalies`). All 16 keys
already live in `OMO_NATIVE_EVENT_SCHEMAS` (`product-identity.ts:135-152`), so the QA property allowlist for this
event is generated accurately with no extra metadata to supply.

## 3. Diff

```diff
diff --git a/script/qa/omo-native-telemetry-qa.mjs b/script/qa/omo-native-telemetry-qa.mjs
@@ -33,6 +33,7 @@ const expectedNativeEvents = new Set([
   "skill_loaded",
   "delegation_started",
   "feature_used",
+  "parallelism_summary",
 ])
@@ -470,7 +471,7 @@ function evidenceMarkdown(input) {
-PASS. The real Senpi CLI emitted all seven OmO Native events plus the unchanged legacy daily-active event, both opt-out paths emitted zero requests, and cleanup completed.
+PASS. The real Senpi CLI emitted all eight OmO Native events plus the unchanged legacy daily-active event, both opt-out paths emitted zero requests, and cleanup completed.
@@ -494,7 +495,7 @@ ${assertionLines}
-All privacy, property, and path scans above were scoped strictly to: daily_active, session_started, prompt_submitted, turn_completed, skill_loaded, delegation_started, and feature_used. ...
+All privacy, property, and path scans above were scoped strictly to: daily_active, session_started, prompt_submitted, turn_completed, skill_loaded, delegation_started, feature_used, and parallelism_summary. ...

diff --git a/script/qa/omo-native-telemetry-qa.test.ts b/script/qa/omo-native-telemetry-qa.test.ts
@@ -7,6 +7,7 @@ const EXPECTED_EVENTS = [
   "daily_active",
   "delegation_started",
   "feature_used",
+  "parallelism_summary",
   "prompt_submitted",
   "session_started",
   "skill_loaded",
@@ -14,7 +15,7 @@ const EXPECTED_EVENTS = [
-  test("... #then it covers exactly the seven native events", () => {
+  test("... #then it covers exactly the eight native events", () => {
```

Both pinned lists are in their existing style: the `.mjs` set is in emission order (new event appended last, matching
its position in `OMO_NATIVE_EVENT_SCHEMAS`); the `.test.ts` array is alphabetical, so `parallelism_summary` was
inserted between `feature_used` and `prompt_submitted`. The two prose strings inside the driver's evidence template
are the driver's own generated QA report text, which enumerates the exact scan scope; leaving them stale would have
made the driver emit a factually wrong report ("seven events", event list missing the new one).

## 4. Verify results (all five gates)

1. Failing test file passes:
   `bun test script/qa/omo-native-telemetry-qa.test.ts` -> `2 pass, 0 fail, 4 expect() calls`.
2. `bun test packages/omo-senpi/src/components/telemetry/` -> `136 pass, 0 fail, 480 expect() calls` across 15 files.
3. `bun run --cwd packages/omo-senpi typecheck` (`tsgo --noEmit -p tsconfig.json`) -> exit 0, no diagnostics.
4. `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` -> exit 0,
   `omo-senpi extension build is current: .../packages/omo-senpi/plugin/extensions/omo.js`
   (the other lane's `senpi-compatibility` fix is undisturbed; no `bun install` was run).
5. `git status --porcelain` before staging:
   ```
    M script/qa/omo-native-telemetry-qa.mjs
    M script/qa/omo-native-telemetry-qa.test.ts
   ```

## 5. Adversarial probes

### Misleading success output — is the guard vacuous?

Probed with a scratch test (`guard-probe.scratch.test.ts`, deleted afterwards; `git status` confirmed clean again)
that fed `assertAllowlistCoverage` a *different* event removed from the real allowlist:

```ts
const { skill_loaded: _dropped, ...withoutSkillLoaded } = OMO_NATIVE_PROPERTY_ALLOWLISTS
expect(() => assertAllowlistCoverage(withoutSkillLoaded)).toThrow("missing=skill_loaded")

const { parallelism_summary: _dropped, ...without } = OMO_NATIVE_PROPERTY_ALLOWLISTS
expect(() => assertAllowlistCoverage(without)).toThrow("missing=parallelism_summary")
```

Result: `2 pass, 0 fail`. The guard still FIRES on a missing event, and it now specifically protects
`parallelism_summary` too. The guard is NOT vacuous; the green suite is real, not misleading success output.
(The repo's own second test case at `omo-native-telemetry-qa.test.ts:23-27` independently asserts both the
`missing=` and `extra=` branches and was left untouched.)

### Scope creep

Diff is exactly the two QA guard files (the pinned expected-event list in the driver plus its bun-test twin) and
this evidence file. No changes to `turn_completed`, no changes under `packages/telemetry-core/`,
`packages/omo-codex/`, or `packages/omo-opencode/`, no product-code changes, no `bun install`, no committed-bundle
churn (gate 4 proves it). No test was skipped, `.only`'d, deleted, or loosened; no exception branch for this event.

## 6. Push confirmation

Commit: `test(omo-senpi): register parallelism_summary in the OmO Native QA event allowlist`
Pushed to `origin feat/telemetry-parallel-latency`; this push also carried the pre-existing unpushed local commit
`7ec3c4c30` (evidence files), as intended. Exact hashes and push transcript recorded in the task report.
