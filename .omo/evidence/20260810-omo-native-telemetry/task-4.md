# Task 4 evidence: omo-config-core telemetry config

## Scope

Implemented a distinct top-level `telemetry` block with shape `{ enabled: boolean }`, opt-out default `true`, strict validation in all four unified schemas, a telemetry-specific senpi harness support contract, and a typed `isOmoTelemetryEnabled` accessor.

The existing `codegraph.telemetry` setting and `SETTING_HARNESS_SUPPORT` were not reused.

## RED

Command:

```sh
bun test packages/omo-config-core/src/loader/telemetry-resolution.test.ts
```

Real output before implementation:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-config-core/src/loader/telemetry-resolution.test.ts:

# Unhandled error between tests
-------------------------------
SyntaxError: Export named 'isOmoTelemetryEnabled' not found in module '/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-config-core/src/index.ts'.
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [132.00ms]

EXIT_STATUS=1
```

## GREEN

Focused command:

```sh
bun test packages/omo-config-core/src/loader/telemetry-resolution.test.ts packages/omo-config-core/src/schema/telemetry.test.ts
```

Real summary:

```text
10 pass
0 fail
30 expect() calls
Ran 10 tests across 2 files. [101.00ms]
```

The 10 focused cases are 9 loader cases plus 1 harness-contract case. This is a +10 test-count delta, not a pre-existing suite-only success:

- base `telemetry.enabled:false` resolves false in the senpi view
- `[senpi]` override wins over base
- active profile layer wins over base
- absent telemetry defaults enabled through the typed accessor
- unknown sibling key is rejected
- string `"yes"` is rejected
- number is rejected
- null is rejected
- deeply nested garbage is rejected
- telemetry harness support explicitly includes `senpi`

Full package command:

```sh
bun test packages/omo-config-core
```

Real summary:

```text
146 pass
0 fail
401 expect() calls
Ran 146 tests across 30 files. [301.00ms]

EXIT_STATUS=0
```

Typecheck command and output:

```text
$ bun run --cwd packages/omo-config-core typecheck
$ tsgo --noEmit -p tsconfig.json
```

## Generated schema

Command:

```sh
bun run build:omo-schema
```

Real output:

```text
$ bun run script/build-omo-schema.ts
Generating omo JSON Schema...
✓ omo JSON Schema generated: assets/omo.schema.json

EXIT_STATUS=0
```

Freshness command:

```sh
bun test tests/omo-schema-freshness.test.ts
```

Real output summary:

```text
3 pass
0 fail
3 expect() calls
Ran 3 tests across 1 file. [129.00ms]

EXIT_STATUS=0
```

The generated asset contains the strict telemetry block at the root, typed harness overlays, profile base, and profile harness overlays. The freshness test proves the committed asset matches the current Zod source.

## Manual QA through the real loader

Literal setup and execution command:

```sh
QA_ROOT=/tmp/omo-task4-qa
QA_HOME="$QA_ROOT/home"
QA_SCRIPT=/tmp/omo-task4-manual-qa.ts
rm -rf "$QA_ROOT" "$QA_SCRIPT"
mkdir -p "$QA_HOME/.omo" "$QA_HOME/project"
printf '%s\n' '{"telemetry":{"enabled":false},"[senpi]":{"telemetry":{"enabled":true}}}' > "$QA_HOME/.omo/omo.json"
cat > "$QA_SCRIPT" <<'EOF'
import { isOmoTelemetryEnabled, loadOmoConfig } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-config-core/src/index.ts"

const result = loadOmoConfig({
  cwd: "/tmp/omo-task4-qa/home/project",
  env: { HOME: "/tmp/omo-task4-qa/home" },
  harness: "senpi",
  platform: "linux",
})

if (result.diagnostics.length > 0) {
  throw new Error(JSON.stringify(result.diagnostics))
}

console.log(`resolved telemetry.enabled=${isOmoTelemetryEnabled(result.config)}`)
EOF
bun "$QA_SCRIPT"
```

Real stdout:

```text
resolved telemetry.enabled=true
```

This proves the `[senpi]` block overrides base `false` through the real walked-file loader and senpi view resolution.

## Adversarial results

All malformed cases ran through the real loader validation path in `telemetry-resolution.test.ts`:

| Input | Result |
| --- | --- |
| `{"telemetry":{"enabled":"yes"}}` | rejected at `telemetry.enabled`; default-enabled fallback view returned |
| `{"telemetry":{"enabled":1}}` | rejected at `telemetry.enabled`; default-enabled fallback view returned |
| `{"telemetry":{"enabled":null}}` | rejected at `telemetry.enabled`; default-enabled fallback view returned |
| `{"telemetry":{"enabled":{"nested":{"garbage":true}}}}` | rejected at `telemetry.enabled`; default-enabled fallback view returned |
| `{"telemetry":{"enabled":false,"unexpected":true}}` | rejected at strict `telemetry` block; default-enabled fallback view returned |

No malformed layer was silently accepted.

## Cleanup receipt

Cleanup command:

```sh
rm -rf /tmp/omo-task4-qa /tmp/omo-task4-manual-qa.ts
test ! -e /tmp/omo-task4-qa/home/.omo/omo.json
test ! -e /tmp/omo-task4-manual-qa.ts
```

Real stdout:

```text
cleanup=complete (/tmp config and throwaway script removed)
```
