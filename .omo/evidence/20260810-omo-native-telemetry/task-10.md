# Task 10 evidence: payload ring buffer and preview persistence

## Scope

Implemented `packages/omo-senpi/src/components/telemetry/omo-native-buffer.ts` and its co-located test. The Wave 1 commit `dd935ad20` already supplied the additive optional `onCapture(payload)` field in both `packages/telemetry-core/src/events.ts` and `packages/telemetry-core/index.d.ts`, so no further telemetry-core source change was needed.

## RED

Command:

```sh
bun test packages/omo-senpi/src/components/telemetry/omo-native-buffer.test.ts
```

Real output before implementation:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/omo-native-buffer.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './omo-native-buffer' from '/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/src/components/telemetry/omo-native-buffer.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [130.00ms]
```

## GREEN

Focused command:

```sh
bun test packages/omo-senpi/src/components/telemetry/omo-native-buffer.test.ts
```

Result:

```text
7 pass
0 fail
23 expect() calls
Ran 7 tests across 1 file. [870.00ms]
```

The count changed from RED `0 pass / 1 fail / 1 error` to GREEN `7 pass / 0 fail`; the output is not a retry of an empty or unchanged suite.

Required suite commands and results:

```text
bun test packages/telemetry-core
39 pass, 0 fail, 69 expect() calls, 4 files

bun test packages/omo-senpi/src/components/telemetry
39 pass, 0 fail, 121 expect() calls, 6 files

bun run --cwd packages/omo-senpi typecheck
exit 0

bun run typecheck
exit 0, including packages/telemetry-core and packages/omo-senpi tsgo projects
```

Focused touched-file typecheck also exited 0:

```sh
./node_modules/.bin/tsgo --ignoreConfig --noEmit --target ESNext --module ESNext --moduleResolution bundler --strict --esModuleInterop --skipLibCheck --types bun-types packages/omo-senpi/src/components/telemetry/omo-native-buffer.ts packages/omo-senpi/src/components/telemetry/omo-native-buffer.test.ts
```

`git diff --check` exited 0.

## Acceptance and adversarial results

- FIFO ring cap: pushed payloads 1 through 60; retained exactly 50, with payload 11 first and payload 60 last.
- Wrapper wiring: passed `buffer.onCapture` to `createEventTelemetryClient`; transport messages, in-memory payloads, and parsed `last-payloads.json` matched.
- Atomic stale-state replacement: pre-created the destination with non-JSON stale content; one capture replaced it with the current JSON array, did not append, and left no `.tmp` file.
- 64KB cap: captured 50 payloads containing 70,000-character strings; the persisted file remained at or below 65,536 bytes and parsed as valid JSON while all 50 remained in memory.
- Serialization: a circular reference did not throw and emitted one diagnostic; a later payload containing `undefined` also did not throw. No corrupt JSON was created.
- Tight-loop serialization: captured 100 payloads synchronously; the final file parsed and exactly matched the final 50-entry in-memory ring, beginning at payload 51.
- Unwritable directory: changed a fresh temp state directory to mode `0500`, captured twice without a throw, retained both payloads in memory, and observed exactly one `telemetry_capture_failed` diagnostic.
- No spill queue and no retry path were added.

## Manual QA

Throwaway script captured three events through the real `createEventTelemetryClient` observer hook. Literal execution command:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && QA_DIR="$(mktemp -d /tmp/omo-task-10-qa.XXXXXX)" && bun /tmp/omo-task-10-manual-qa.ts "$QA_DIR" && cat "$QA_DIR/last-payloads.json" && printf '\n' && rm -rf "$QA_DIR" /tmp/omo-task-10-manual-qa.ts
```

Real stdout:

```json
[{"distinctId":"manual-qa-machine","event":"daily_active","properties":{"day_utc":"2026-08-08","reason":"session_start","platform":"omo-senpi","product_name":"omo-native","package_version":"5.0.0-beta.5","schema_version":1,"$process_person_profile":false}},{"distinctId":"manual-qa-machine","event":"daily_active","properties":{"day_utc":"2026-08-09","reason":"session_start","platform":"omo-senpi","product_name":"omo-native","package_version":"5.0.0-beta.5","schema_version":1,"$process_person_profile":false}},{"distinctId":"manual-qa-machine","event":"daily_active","properties":{"day_utc":"2026-08-10","reason":"session_start","platform":"omo-senpi","product_name":"omo-native","package_version":"5.0.0-beta.5","schema_version":1,"$process_person_profile":false}}]
```

## Cleanup receipt

- Every test that set mode `0500` restored mode `0700` in `finally`; `afterEach` also attempted mode restoration before recursive cleanup.
- The manual QA command removed its `/tmp/omo-task-10-qa.*` directory and throwaway script.
- Final `/tmp` scan for `omo-task-10-qa.*`, `omo-native-buffer-test-*`, and `omo-task-10-manual-qa.ts` returned no paths.
- Concurrent sibling-lane files were not staged or edited.
