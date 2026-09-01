# F1 plan-compliance fixes

## Result

PASS. Findings A, B, and C are fixed and verified against the source invariant, rebuilt plugin artifact, real Senpi/PostHog capture surface, and byte-exact generated documentation.

## Finding A: every native event uses the privacy wrapper

### RED

Command:

```sh
git show 4684e0a38:packages/omo-senpi/src/components/telemetry/omo-native-component.ts | nl -ba | grep 'transport\.capture'
```

Observed before the fix:

```text
112        transport.capture(message)
149    transport.capture(payload)
```

The second call constructed post-session native payloads and sent them directly. It bypassed telemetry-core validation. The first call was the transport implementation forwarding a payload already validated by telemetry-core.

### GREEN

The component now creates a telemetry-core `createEventTelemetryClient` facade for all post-session native events. That wrapper performs event allowlisting, property allowlisting, forbidden-key rejection, primitive-value validation, and string truncation before the underlying transport is reached. The already-validated initial session messages and the newly validated facade messages share one explicitly named `forwardValidatedCapture` transport boundary.

Command:

```sh
bun test packages/omo-senpi/src/omo-native-capture-path.audit.test.ts
```

Result:

```text
2 pass
0 fail
```

The first test scans every non-test `omo-native-*.ts` module and permits direct `.capture(` only inside `forwardValidatedCapture`. The second test mutates the scanned source in memory by appending a new `transport.capture(message)` outside that function and requires the scanner to report `omo-native-component.ts:<line>:transport.capture(`. This is the required fail-on-new-bypass proof.

## Finding B: bundled native telemetry reports the real package version

### RED

Command:

```sh
git show 4684e0a38:.omo/evidence/20260810-omo-native-telemetry/captured-payloads.json | python3 -c 'import json,sys,collections; e=json.load(sys.stdin); n=[x for x in e if x["event"]!="omo_senpi_daily_active"]; print(len(n), collections.Counter(x["properties"].get("package_version") for x in n))'
```

Observed before the fix:

```text
15 Counter({'0.0.0': 15})
```

The legacy telemetry component has the same runtime package-manifest probing pattern and remains unchanged, as required.

### GREEN

`build-extension.mjs` now reads `packages/omo-senpi/package.json` and supplies `OMO_SENPI_PACKAGE_VERSION` through Bun's build-time `--define`. `product-identity.ts` uses that inlined value in the bundle while retaining source-runtime manifest lookup for unbundled tests. The define values are included in the source digest so a package-version-only change invalidates the build marker.

Build command:

```sh
node packages/omo-senpi/plugin/scripts/build-extension.mjs
```

Artifact inspection:

```sh
wc -c packages/omo-senpi/plugin/extensions/omo.js
rg -o 'packageVersion:"[^"]+"|package_version:"[^"]+"|5\.0\.0-beta\.5|0\.0\.0' packages/omo-senpi/plugin/extensions/omo.js | sort | uniq -c
```

Observed:

```text
892528 packages/omo-senpi/plugin/extensions/omo.js
3 0.0.0
1 5.0.0-beta.5
```

The remaining `0.0.0` strings are the unchanged legacy telemetry fallback. The native product constant adjacent to its bundled config is `P5="5.0.0-beta.5"`.

Real rebuilt-artifact QA command, using Bun because the concurrent F2 worker converted the QA module to import the TypeScript single source of truth:

```sh
bun script/qa/omo-native-telemetry-qa.mjs --evidence-dir /tmp/omo-f1-qa-evidence
```

Result:

```json
{
  "result": "PASS",
  "assertions": 19,
  "enabledRequests": 2,
  "capturedEvents": 16,
  "optOutDntRequests": 0,
  "optOutConfigRequests": 0,
  "cleanup": {
    "serverPid": 7933,
    "killZeroFails": true,
    "serverListening": false,
    "port": 55278,
    "portFree": true,
    "lsofOutput": ""
  }
}
```

Bundled-runtime captured payload proof:

```sh
python3 - <<'PY'
import collections, json
p = "/tmp/omo-f1-qa-evidence/captured-payloads.json"
events = json.load(open(p))
native = [event for event in events if event["event"] != "omo_senpi_daily_active"]
print("native_events", len(native))
print("package_versions", collections.Counter(event["properties"].get("package_version") for event in native))
print(json.dumps({
  "event": native[0]["event"],
  "properties": {key: native[0]["properties"].get(key) for key in [
    "package_version", "platform", "product_name", "schema_version",
  ]},
}, indent=2))
PY
```

Observed:

```text
native_events 15
package_versions Counter({'5.0.0-beta.5': 15})
{
  "event": "daily_active",
  "properties": {
    "package_version": "5.0.0-beta.5",
    "platform": "omo-senpi",
    "product_name": "omo-native",
    "schema_version": 1
  }
}
```

All 15 OmO Native events in the 16-event capture carry `5.0.0-beta.5`; the remaining event is the intentionally separate legacy dual emit.

## Finding C: generated docs include types and enum values

### RED

Command:

```sh
git show 4684e0a38:docs/reference/senpi-telemetry.md
```

The committed generated table had only `Event` and `Allowed properties` columns.

### GREEN

`OMO_NATIVE_EVENT_SCHEMAS` is now the frozen machine-readable declaration for property types and enum/bucket values. Runtime `OMO_NATIVE_PROPERTY_ALLOWLISTS` is derived from its keys, and the documentation generator consumes the same declaration.

Generation command:

```sh
bun script/telemetry-schema-block.mjs
```

Generated block:

```markdown
<!-- BEGIN GENERATED SCHEMA -->
## Event schema

| Event | Property | Type | Allowed values |
|-------|----------|------|----------------|
| `daily_active` | `$session_id` | `string` | - |
| `daily_active` | `day_utc` | `string` | - |
| `daily_active` | `reason` | `string` | `session_start` |
| `session_started` | `$session_id` | `string` | - |
| `session_started` | `$os` | `string` | - |
| `session_started` | `$os_version` | `string` | - |
| `session_started` | `arch` | `string` | - |
| `session_started` | `cpu_count` | `number` | - |
| `session_started` | `default_model` | `string` | `claude-fable-5`, `claude-haiku-4-5`, `claude-opus-5`, `claude-sonnet-5`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.6-flash`, `gpt-5.6-sol`, `gpt-5.6-terra`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `gpt-5.6-luna-fast`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `custom` |
| `session_started` | `default_provider` | `string` | `anthropic`, `anthropic-api`, `deepseek`, `google`, `github-copilot`, `kimi-for-coding`, `moonshotai`, `openai`, `opencode`, `opencode-go`, `quotio-openai`, `vercel`, `xai`, `custom` |
| `session_started` | `memory_bucket` | `string` | `lt_8_gb`, `8_15_gb`, `16_31_gb`, `32_63_gb`, `64_plus_gb` |
| `session_started` | `model_count` | `number` | - |
| `session_started` | `provider_count` | `number` | - |
| `session_started` | `providers` | `string` | - |
| `session_started` | `reason` | `string` | `startup`, `reload`, `new`, `resume`, `fork` |
| `prompt_submitted` | `$session_id` | `string` | - |
| `prompt_submitted` | `input_source` | `string` | `interactive`, `rpc`, `extension` |
| `prompt_submitted` | `invocation_stage` | `string` | `none`, `first_arm`, `remention`, `post_compact_rearm` |
| `prompt_submitted` | `is_effective_ultrawork_invocation` | `boolean` | - |
| `prompt_submitted` | `is_real_user_prompt` | `boolean` | - |
| `prompt_submitted` | `is_turn_start` | `boolean` | - |
| `prompt_submitted` | `keyword_any` | `boolean` | - |
| `prompt_submitted` | `keyword_occurrence_bucket` | `string` | `1`, `2`, `3_5`, `6_plus` |
| `prompt_submitted` | `keyword_ultrawork_full` | `boolean` | - |
| `prompt_submitted` | `keyword_ulw_abbrev` | `boolean` | - |
| `prompt_submitted` | `keyword_variant` | `string` | `none`, `ulw`, `ultrawork`, `both` |
| `prompt_submitted` | `prompt_length_bucket` | `string` | `lt_100`, `100_500`, `500_2000`, `gte_2000` |
| `prompt_submitted` | `queue_mode` | `string` | `immediate`, `follow_up`, `steer`, `other` |
| `prompt_submitted` | `real_prompt_ordinal_bucket` | `string` | `1`, `2_3`, `4_10`, `11_25`, `26_plus` |
| `prompt_submitted` | `suppression_reason` | `string` | `none`, `no_keyword`, `extension_source`, `embedded_directive`, `skill_expansion`, `skill_name_only` |
| `turn_completed` | `$session_id` | `string` | - |
| `turn_completed` | `cache_read_tokens` | `number` | - |
| `turn_completed` | `cache_write_tokens` | `number` | - |
| `turn_completed` | `cost_usd` | `number` | - |
| `turn_completed` | `input_tokens` | `number` | - |
| `turn_completed` | `model_id` | `string` | `claude-fable-5`, `claude-haiku-4-5`, `claude-opus-5`, `claude-sonnet-5`, `deepseek-v4-flash`, `deepseek-v4-pro`, `gemini-3.6-flash`, `gpt-5.6-sol`, `gpt-5.6-terra`, `k3`, `kimi-for-coding-highspeed`, `kimi-k3`, `gpt-5.6-luna-fast`, `minimax-m2.7`, `minimax-m3`, `grok-4.20-0309-non-reasoning`, `custom` |
| `turn_completed` | `output_tokens` | `number` | - |
| `turn_completed` | `provider` | `string` | `anthropic`, `anthropic-api`, `deepseek`, `google`, `github-copilot`, `kimi-for-coding`, `moonshotai`, `openai`, `opencode`, `opencode-go`, `quotio-openai`, `vercel`, `xai`, `custom` |
| `turn_completed` | `reasoning_tokens` | `number` | - |
| `turn_completed` | `total_tokens` | `number` | - |
| `turn_completed` | `turn_index` | `number` | - |
| `skill_loaded` | `$session_id` | `string` | - |
| `skill_loaded` | `skill_name` | `string` | `ast-grep`, `coding-agent-sessions`, `data-scientist`, `debugging`, `frontend`, `git-master`, `give-me-tips`, `hyperplan`, `init-deep`, `lsp-setup`, `programming`, `refactor`, `remove-ai-slops`, `review-work`, `start-work`, `ultimate-browsing`, `ultrawork`, `ulw-loop`, `ulw-plan`, `ulw-research`, `visual-qa` |
| `delegation_started` | `$session_id` | `string` | - |
| `delegation_started` | `background` | `boolean` | - |
| `delegation_started` | `batch_size_bucket` | `string` | `1`, `2_4`, `5_plus` |
| `delegation_started` | `kind` | `string` | `category`, `subagent` |
| `delegation_started` | `name` | `string` | `visual-engineering`, `artistry`, `ultrabrain`, `deep`, `quick`, `unspecified-low`, `architect`, `unspecified-high`, `writing`, `explore`, `librarian`, `metis`, `momus`, `custom` |
| `feature_used` | `$session_id` | `string` | - |
| `feature_used` | `feature` | `string` | `goal_tool`, `team_create`, `memory_tool` |
<!-- END GENERATED SCHEMA -->
```

Byte-exact drift command:

```sh
bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
```

Result after regeneration:

```text
2 pass
0 fail
```

Mutation proof command:

```sh
cp docs/reference/senpi-telemetry.md /tmp/senpi-telemetry.md.clean
python3 - <<'PY'
from pathlib import Path
p = Path('docs/reference/senpi-telemetry.md')
s = p.read_text()
needle = '| `prompt_submitted` | `keyword_variant` | `string` | `none`, `ulw`, `ultrawork`, `both` |'
p.write_text(s.replace(needle, needle.replace('`both`', '`mutated`'), 1))
PY
bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
cp /tmp/senpi-telemetry.md.clean docs/reference/senpi-telemetry.md
bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
```

Observed mutation result:

```text
mutation_exit=1
1 pass
1 fail
```

Observed restored result:

```text
2 pass
0 fail
```

## Verification gates

```sh
bun test packages/omo-senpi
```

Observed: 970 pass, 1 environment-sensitive pre-existing failure in `components/ulw-loop/runtime.test.ts` because the workstation exports `OMO_AGENT_TOOLKIT_BIN=/Users/yeongyu/.bun/install/global/node_modules/omo-ai/bin/omo-agent-toolkit.js`.

Required isolated rerun:

```sh
env -u OMO_AGENT_TOOLKIT_BIN bun test packages/omo-senpi/src/components/ulw-loop/runtime.test.ts
```

Observed: 13 pass, 0 fail.

```sh
bun test packages/telemetry-core
```

Observed: 41 pass, 0 fail.

```sh
bun run --cwd packages/omo-senpi typecheck
```

Observed: exit 0, no diagnostics.

```sh
bun test packages/omo-senpi/src/bundle-size.test.ts packages/omo-senpi/src/bundle-purity.test.ts
```

Observed: 3 pass, 0 fail. Measured `packages/omo-senpi/plugin/extensions/omo.js`: 892528 bytes, below the 900000-byte budget by 7472 bytes.

## Cleanup receipt

- Real QA capture server pid 7933 no longer exists (`killZeroFails: true`).
- TCP port 55278 is free and `lsof` returned no listener.
- The QA driver removed all isolated Senpi, agent, session, XDG, provider, and capture-server temporary directories.
- `/tmp/omo-f1-qa-evidence` was removed after the bundled payload proof was copied into this evidence file.
- The docs mutation was restored from `/tmp/senpi-telemetry.md.clean`, and the byte-exact drift test passed after restoration.
- Build-extension test scratch directory `.build-extension-test-9m9588` was removed.
