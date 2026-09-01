# Task 2 evidence: typed event capture wrapper and batching client

## RED

Command:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun test packages/telemetry-core/src/events.test.ts
```

Observed before implementation:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/telemetry-core/src/events.test.ts:

# Unhandled error between tests
-------------------------------
SyntaxError: Export named 'createEventTelemetryClient' not found in module '/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/telemetry-core/src/index.ts'.
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [121.00ms]
```

## GREEN

Pre-change package baseline, excluding the new test file:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun test packages/telemetry-core/src/activity-state.test.ts packages/telemetry-core/src/env.test.ts packages/telemetry-core/src/posthog-client.test.ts
```

Result: `31 pass, 0 fail`, 31 tests across 3 files.

Final package command:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun test packages/telemetry-core
```

Result:

```text
39 pass
0 fail
69 expect() calls
Ran 39 tests across 4 files. [126.00ms]
```

Test count delta: 39 final minus 31 baseline equals 8 new tests. This proves `events.test.ts` ran rather than relying on unchanged suite output.

The new tests pin:

- unknown allowlist keys are dropped and emit `telemetry_event_property_dropped`
- strings are truncated to 64 characters
- `$ip`, `$lib`, and `_text`, `_path`, `_prompt` suffix keys are rejected
- null, undefined, nested-object, and array property values are rejected without capture failure
- an empty event name is rejected
- two clients do not share mutable allowlist state
- 19 captures do not call transport flush before the configured `flushAt: 20`
- throwing capture transports do not throw to callers
- hanging flush uses an injected timer, schedules exactly `1000`, and resolves without wall-clock waiting
- existing product options remain byte-identical and additive overrides are threaded

## Typecheck

Command:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun run typecheck
```

Result: exit 0. The root typecheck completed `tsgo --noEmit`, script typecheck, and all package typechecks including telemetry-core and downstream packages.

## Adversarial focused run

Command:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun test packages/telemetry-core/src/events.test.ts --test-name-pattern 'malformed|two clients|hanging'
```

Real result:

```text
3 pass
5 filtered out
0 fail
7 expect() calls
Ran 3 tests across 1 file. [113.00ms]
```

This directly exercises malformed values and empty names, stale cross-client state, and the hung transport shutdown path. The full suite separately exercises a throwing capture transport to prevent misleading success from a swallowed capture failure.

## Manual QA

Throwaway script: `/tmp/omo-telemetry-task-2-qa.ts`

The script imported the source package wrapper, used a recording `TelemetryTransportFactory`, allowlisted a forbidden `secret_path`, an oversized `label`, and valid `reason`, then printed `JSON.stringify(messages[0])`.

Literal command:

```sh
bun /tmp/omo-telemetry-task-2-qa.ts | tee /tmp/task-2-manual-qa.txt
```

Real stdout:

```json
{"distinctId":"machine-hash","event":"session_started","properties":{"label":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","reason":"startup","platform":"omo-senpi","product_name":"omo-native","package_version":"5.0.0","schema_version":1,"$process_person_profile":false}}
```

The exact wire payload omits `secret_path`, retains `reason`, and contains exactly 64 `x` characters in `label` after truncating the 70-character input.

## Cleanup receipt

Command:

```sh
rm /tmp/omo-telemetry-task-2-qa.ts
```

Receipt:

```text
cleanup: deleted /tmp/omo-telemetry-task-2-qa.ts
```

Confirmed `/tmp/omo-telemetry-task-2-qa.ts` no longer exists. No spill file or retry queue was created.
