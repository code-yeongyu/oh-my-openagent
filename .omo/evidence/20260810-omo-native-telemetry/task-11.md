# Task 11 evidence - register OmO Native telemetry component

Date: 2026-08-10
Scope: integration registration, rebuilt extension artifact, bundle budget gate, package verification, and manual event-stream QA.

## Inherited integration verification

Command:

```text
bun test packages/omo-senpi/src/components/telemetry/omo-native-component.test.ts
```

Output:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/omo-native-component.test.ts:
(pass) OmO Native telemetry component integration > #given the real component list #when composed #then telemetry input classification registers before ultrawork [1.25ms]
(pass) OmO Native telemetry component integration > #given an enabled composed component #when the full host sequence dispatches #then the exact event stream is captured in order [22.23ms]
(pass) OmO Native telemetry component integration > #given the telemetry disable flag #when the full component is composed #then native and legacy capture zero events [0.80ms]
(pass) OmO Native telemetry component integration > #given shutdown and restart plus repeated interruption #when sessions cycle #then client state is fresh and shutdown never throws [2.52ms]

 4 pass
 0 fail
 16 expect() calls
Ran 4 tests across 1 file. [1.84s]
```

This covers the integration stream, the ordering pin placing telemetry before ultrawork, disable-flag suppression for both native and legacy telemetry, fresh client state after restart, and repeated `session_shutdown` during an interrupted turn without an exception.

## Fresh artifact rebuild and bundle measurements

The committed artifact at `HEAD` before this task's integration rebuild was measured independently from the index:

```text
head_artifact_size=867366
```

That 867,366-byte artifact was below the former 880,000-byte gate but did not contain this integration. This is why the earlier bundle-size success was misleading: it measured a stale telemetry-free artifact. The bundle must be rebuilt before using the size gate as evidence.

The inherited worktree artifact immediately before my rebuild was:

```text
size=891364 mtime=2026-08-10T20:10:41+0900 epoch=1786360241
```

Literal rebuild command:

```text
node packages/omo-senpi/plugin/scripts/build-extension.mjs
```

Output and post-build receipt:

```text
Bundled 781 modules in 31ms

  omo.js  0.89 MB  (entry point)

Bundled 279 modules in 9ms

  omo-member.js  117.61 KB  (entry point)

Bundled 61 modules in 5ms

  omo-memory-mcp.js  49.37 KB  (entry point)

Built omo-senpi extensions: /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/plugin/extensions/omo.js, /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/plugin/extensions/omo-member.js
After rebuild:
size=891384 mtime=2026-08-10T20:12:33+0900 epoch=1786360353
7d9731f575a7e79f2ba05046c0fce3267e285fd8e1c1edfa312194cee6e78a74  packages/omo-senpi/plugin/extensions/omo.js
// omo-senpi-build:cb9259fee86de081b71f916716567e54b674e6a196869c85727625bc9412501d:f10b606c2a27f89d01205c836b4aa291bbdd010908e2026010e14352542133d0
```

Measured pre-feature committed artifact: 867,366 bytes.
Measured inherited post-feature artifact: 891,364 bytes.
Measured freshly rebuilt post-feature artifact used for the gate and commit: 891,384 bytes.

Before raising the budget, the freshly rebuilt artifact failed the old gate exactly at the expected boundary:

```text
Expected: <= 880000
Received: 891384

 0 pass
 1 fail
```

## Budget raise justification

`BUDGET_BYTES` was raised from 880,000 to the round 900,000 ceiling for plan `omo-native-telemetry`. The measured 891,384 bytes are plan-scoped first-party feature code wired into the extension entry. No new third-party dependency was inlined; `posthog-node` was already in the bundle for legacy telemetry. The rebuilt artifact passes `bundle-purity.test.ts`.

A trim was attempted before this decision and rejected. The feature emitter modules are small enough that reclaiming the required bytes would require a secondary telemetry chunk and therefore a loader-topology change. That would alter the one-file loader topology and require live Senpi loader validation. Raising to 900,000 gives explicit round-number headroom and follows the file rule not to raise the ceiling to the failing value.

Post-raise command:

```text
bun test packages/omo-senpi/src/bundle-size.test.ts
```

Output:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/bundle-size.test.ts:
(pass) omo-senpi bundle size budget > #given the built extension #when its byte size is measured #then it stays within the documented byte budget [1.39ms]

 1 pass
 0 fail
 2 expect() calls
Ran 1 test across 1 file. [165.00ms]
```

## Bundle purity gate

Command:

```text
bun test packages/omo-senpi/src/bundle-purity.test.ts
```

Output:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/bundle-purity.test.ts:
(pass) omo-senpi bundle purity > #given the senpi loader aliases #when tested #then the shared build constant pins all 19 peers [0.81ms]
(pass) omo-senpi bundle purity > #given a built extension #when static imports are inspected #then only senpi peers and node builtins remain external [3.08ms]

 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 file. [174.00ms]
```

## Full package suite and environmental flake

The inherited agent environment contained:

```text
OMO_AGENT_TOOLKIT_BIN=/Users/yeongyu/.bun/install/global/node_modules/omo-ai/bin/omo-agent-toolkit.js
```

Command:

```text
bun test packages/omo-senpi
```

Summary:

```text
1 tests failed:
(fail) omo-senpi ulw-loop runtime > #given OMO_BIN is set #when resolving the default omo binary #then Bun is not needed and PATH is ignored [0.30ms]

 958 pass
 1 fail
 2837 expect() calls
Ran 959 tests across 149 files. [47.31s]
```

This is the known pre-existing environment-sensitive ulw-loop failure caused by the inherited `OMO_AGENT_TOOLKIT_BIN`, not a telemetry regression. The exact test file passes in a clean environment without that variable.

Command:

```text
env -u OMO_AGENT_TOOLKIT_BIN bun test packages/omo-senpi/src/components/ulw-loop/runtime.test.ts
```

Output:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/ulw-loop/runtime.test.ts:
(pass) omo-senpi ulw-loop runtime > #given OMO_BIN is set #when resolving the default omo binary #then Bun is not needed and PATH is ignored [0.73ms]
(pass) omo-senpi ulw-loop runtime > #given a temp omo binary #when default runOmoCommand executes status #then it captures stdout and cwd via Node-compatible spawning [391.97ms]
(pass) omo-senpi ulw-loop runtime > #given a child flooding stderr beyond the 64KiB pipe buffer #when runOmoCommand executes a .js target #then it completes within the 30s budget via process.execPath [57.53ms]
(pass) omo-senpi ulw-loop runtime > #given built Senpi runs under Node #when inspecting runtime source #then the ulw-loop component has no Bun global dependency [0.20ms]
(pass) omo-senpi ulw-loop resolveOmoBin toolkit-first chain > #given only OMO_AGENT_TOOLKIT_BIN is set #when resolving #then it wins and PATH is ignored [0.08ms]
(pass) omo-senpi ulw-loop resolveOmoBin toolkit-first chain > #given all three links are present #when resolving #then OMO_AGENT_TOOLKIT_BIN beats the PATH toolkit and OMO_BIN [0.52ms]
(pass) omo-senpi ulw-loop resolveOmoBin toolkit-first chain > #given a PATH toolkit and OMO_BIN #when resolving #then the PATH omo-agent-toolkit wins over OMO_BIN [0.76ms]
(pass) omo-senpi ulw-loop resolveOmoBin toolkit-first chain > #given only OMO_BIN is set #when resolving #then it resolves exactly as before the rename (characterization) [0.08ms]
(pass) omo-senpi ulw-loop resolveOmoBin toolkit-first chain > #given PATH holds only a fake named omo #when resolving #then it returns null - the bare-omo PATH tail is deliberately dropped [0.41ms]
(pass) omo-senpi ulw-loop resolveOmoBin toolkit-first chain > #given a whitespace-only OMO_AGENT_TOOLKIT_BIN #when resolving #then it falls through to OMO_BIN [0.07ms]
(pass) omo-senpi ulw-loop resolveOmoBin toolkit-first chain > #given nothing is set and PATH is empty #when resolving #then it returns null [0.05ms]
(pass) omo-senpi ulw-loop default registration through the toolkit chain > #given a PATH omo-agent-toolkit and no envs #when the component registers with defaults #then the toolkit binary receives the status argv [363.90ms]
(pass) omo-senpi ulw-loop default registration through the toolkit chain > #given PATH holds only a fake named omo and no envs #when the component registers with defaults #then it degrades without executing the stale binary [0.60ms]

 13 pass
 0 fail
 20 expect() calls
Ran 13 tests across 1 file. [918.00ms]
```

## Typecheck

Command:

```text
bun run --cwd packages/omo-senpi typecheck
```

Output:

```text
$ tsgo --noEmit -p tsconfig.json
```

Exit status: 0.

## Manual QA event stream

A throwaway `./qa-compose-probe.ts` inside the worktree instantiated `FakeExtensionAPI`, registered the composed OmO Native telemetry component, and dispatched the exact sequence `session_start -> input -> input_disposition -> turn_end -> tool_result -> session_shutdown`.

Literal command:

```text
bun run ./qa-compose-probe.ts
```

Real stdout:

```text
ordered events: ["daily_active","session_started","omo_senpi_daily_active","prompt_submitted","turn_completed","feature_used"]
1. daily_active: ["$process_person_profile","$session_id","day_utc","package_version","platform","product_name","reason","schema_version"]
2. session_started: ["$os","$os_version","$process_person_profile","$session_id","arch","cpu_count","default_model","default_provider","memory_bucket","model_count","package_version","platform","product_name","provider_count","providers","reason","schema_version"]
3. omo_senpi_daily_active: ["$os","$os_version","$process_person_profile","ci","cpu_count","cpu_model","day_utc","locale","os_arch","os_type","package_name","package_version","platform","product_name","reason","runtime","runtime_version","shell","source","terminal","timezone","total_memory_gb"]
4. prompt_submitted: ["$process_person_profile","$session_id","input_source","invocation_stage","is_effective_ultrawork_invocation","is_real_user_prompt","is_turn_start","keyword_any","keyword_occurrence_bucket","keyword_ultrawork_full","keyword_ulw_abbrev","keyword_variant","package_version","platform","product_name","prompt_length_bucket","queue_mode","real_prompt_ordinal_bucket","schema_version","suppression_reason"]
5. turn_completed: ["$process_person_profile","$session_id","cache_read_tokens","cache_write_tokens","cost_usd","input_tokens","model_id","output_tokens","package_version","platform","product_name","provider","reasoning_tokens","schema_version","total_tokens","turn_index"]
6. feature_used: ["$process_person_profile","$session_id","feature","package_version","platform","product_name","schema_version"]
```

## Adversarial results

- Freshness: the artifact committed by this task is the freshly rebuilt 891,384-byte `omo.js`, with mtime `2026-08-10T20:12:33+0900`, epoch `1786360353`, SHA-256 `7d9731f575a7e79f2ba05046c0fce3267e285fd8e1c1edfa312194cee6e78a74`, and a current build marker.
- Stale-state control: the 867,366-byte `HEAD` artifact would have passed the old budget while omitting this integration, so no bundle-size result from before the rebuild is accepted as evidence.
- Purity: the rebuilt artifact has only the documented Senpi peers and Node builtins as external imports.
- Interruption: the integration test performs repeated `session_shutdown` calls after an input is interrupted and verifies that neither call throws.
- Disable flag: composing with `omo-senpi-telemetry-disabled` captures zero native and zero legacy events.
- Ordering: the exported real component list contains telemetry exactly once and before ultrawork.

## Cleanup receipt

- Removed the throwaway `./qa-compose-probe.ts` after capturing stdout.
- No scratch files remain.
- `git diff --check` passes.
- Constraint scan found no `as any`, `@ts-ignore`, em dash, or en dash in the task source changes.
- No emitter module was modified for byte trimming.
- Both this evidence file and the previously missed `task-13a.md` are force-added because `.omo/*` is ignored.
