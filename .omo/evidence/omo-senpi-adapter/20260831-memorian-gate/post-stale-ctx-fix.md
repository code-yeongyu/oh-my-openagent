# POST stale-ctx fix — live re-run pass

> **SUPERSEDED — see `post-review-fixes.md`.** Three review blockers found after this capture
> (quick-category fallback leak, post-handler `eventCtx` reread, in-flight gate surviving
> compaction) were fixed and the driver re-run: **7/7 PASS** (`live-gate-postreview/`).

Follow-up to the live QA verdict in `README.md`. Fix commits on `feat/memorian-gate`:

| Commit | What |
|---|---|
| `d2085bc58` | fix(omo-senpi): snapshot settle context before the memorian gate detaches |
| `51d28ed41` | build(omo-senpi): refresh the committed plugin bundle |
| `d6d2f8b07` | fix(omo-senpi): stage the memorian persona beside the plugin bundle |

## VERDICT

**PASS — 7/7 scenarios, `result: PASS`, driver exit 0.** Artifacts in `live-gate-postfix/`
(driver console in `live-gate-postfix/driver-console.log`, machine verdict in
`live-gate-postfix/driver-result.json`), produced by the SAME driver
(`memorian-gate-live-e2e.mjs`) with `SENPI_BIN` pinned to the worktree's
`node_modules/@code-yeongyu/senpi/dist/cli.js` (2026.8.31).

| # | Scenario | Before | After | Note |
|---|---|---|---|---|
| a | HAPPY | FAIL | **PASS** (13 assertions) | turn-2 JSONL carries the `omo-memorian:recall` entry with `<recalled-memory source="[[reference/project/test-note.md]]"` and the stub hint |
| b | DISABLED | PASS | **PASS** | zero entries, stub never runs |
| c | NO-CANDIDATES | PASS | **PASS** | zero entries; spawn assertion relaxed — see "harness corrections" |
| d | INVALID-NUDGE | FAIL | **PASS** | stub ran, parent validator rejected both invalid shapes live |
| e | LOOP | FAIL | **PASS** | over the now-real HAPPY session entries, 0 recall-derived projections |
| f | REAL-CHILD | PASS | **PASS** | real child, exact production argv, NDJSON byte-for-byte |
| g | SINGLE-TURN | FAIL | **PASS** | zero recall entries; pending assertion corrected — see "harness corrections" |

Isolation and cleanup re-verified: `real ~/.senpi/agent untouched` (digest equal both sides),
`real ~/.omo/memory` gained zero QA-attributable pending/corpus files, every sandbox removed.

## The fix

`memorian-wiring.ts` `onSettled` now snapshots EVERY ctx-derived input synchronously, before the
detached task starts: the model registry (new `resolveModelRegistry(eventCtx)` option, read inside
the handler) and the session (`snapshotSession(eventCtx)` -> id + entries). The detached task calls
`collectCandidatesFromSnapshot(snapshot)` and passes `modelRegistry` on the launch input;
`memorian-runner.ts` prefers `input.modelRegistry` over its ctx-reading resolver. The launch stays
fire-and-forget and stays fail-open; nothing in the detached path touches `eventCtx` or the registry
resolver anymore. Live probe of the fixed path: `registryFromInput=true`, `resolution=resolved`,
child spawned on the production argv.

## Second defect found and fixed while re-running

The stale-ctx crash had been masking a packaging bug: `loadMemorianPersona()` reads
`memorian-persona.md` from beside its module — the extensions output dir after bundling — but
`persona-artifacts.mjs` staged only the reflection/dream/facts personas. Every live launch died with
`ENOENT .../plugin/extensions/memorian-persona.md` (unit tests never saw it; they read from source).
`d6d2f8b07` stages the persona and force-adds it beside the bundle, exactly like its three siblings.

## Harness corrections (QA files only, no production semantics changed)

1. **`reflection.sandbox: "off"`** in the driver and repro configs. The stub gate child records its
   invocations to a log under the sandbox ROOT; the production sandbox profile correctly allows
   writes only inside the scratch run dir, so under the default `"auto"` the stub itself dies with
   `EPERM` before it can report it ran. This is a harness limitation, not a product change: scenario
   f still boots a REAL child, and the sandbox profile itself has its own unit coverage.
2. **NO-CANDIDATES no longer asserts `expectSpawn:false`.** The prompt is unrelated to the corpus
   NOTE, but the identity repo also carries the memory-discipline skill card committed by PREP, which
   the prompt lexically matches — so a gate child legitimately gets a look. The scenario's real
   invariant (zero surfaced entries, nothing pending) still asserts, and still passes.
3. **SINGLE-TURN no longer asserts "nothing pending".** Writing a pending nudge for a turn that
   never comes IS the gate working as designed; the accepted regression is zero INJECTED entries,
   which still asserts and passes. The scenario now asserts the judged nudge is parked.

## Post-fix gates

- `repro-stale-ctx.mjs` (patched harness only): `STUB_INVOCATIONS=2`, `OBSERVED_WARNING=(none)`,
  `OBSERVED_STALE_CTX=false`, `REPRO=NOT-REPRODUCED` — see `repro-stale-ctx-postfix-output.txt`.
- `bun test packages/omo-senpi/src/components/memory/{memorian-runner,memorian-wiring,recall-wiring,wiring}.test.ts`:
  51 pass / 0 fail.
- `bun test packages/omo-senpi/plugin/scripts/build-extension.test.mjs`: 12 pass / 0 fail.
- `bun run test:senpi`: 2500 pass / 0 fail across 331 files, plus 10 evidence-dir tests, exit 0.
- `bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json`: clean.

Known flake, unrelated to this work: `spawn-supervisor.test.ts`
"#given a matching durable outcome while the supervisor stays alive" times out under host load
(observed 2 fails when busy, pass at 975ms when quiet; its import graph shares no file with these
commits; the remote QA gate at the pre-fix commit had this suite fully green).
