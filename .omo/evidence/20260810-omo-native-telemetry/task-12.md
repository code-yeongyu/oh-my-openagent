# Task 12 evidence: first-run notice and telemetry preview command

## RED

Failing test was written before the production module.

Command:

```sh
bun test packages/omo-senpi/src/components/telemetry/omo-native-notice.test.ts
```

Output:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/omo-native-notice.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './omo-native-notice' from '/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/src/components/telemetry/omo-native-notice.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [100.00ms]
```

## GREEN

Focused command:

```sh
bun test packages/omo-senpi/src/components/telemetry/omo-native-notice.test.ts
```

Output:

```text
8 pass
0 fail
22 expect() calls
Ran 8 tests across 1 file. [1325.00ms]
```

Test-count delta: the focused target moved from `0 pass, 1 fail, 1 error` before implementation to `8 pass, 0 fail`. The eight final cases cover one-shot notice persistence, DO_NOT_TRACK suppression, marker failure, stale state, concurrent starts, notification interruption, payload preview, and absent/corrupt preview files.

Required suite:

```sh
bun test packages/omo-senpi/src/components/telemetry
```

Output:

```text
63 pass
0 fail
193 expect() calls
Ran 63 tests across 9 files. [1386.00ms]
```

Typecheck:

```sh
bun run --cwd packages/omo-senpi typecheck
```

Output:

```text
$ tsgo --noEmit -p tsconfig.json
```

`git diff --check` exited 0.

## Manual QA

The throwaway script was created inside the worktree at `./qa-notice-probe.ts`. It used `FakeExtensionAPI`, an isolated temp agent directory, two consecutive `session_start` dispatches, and the registered `omo-telemetry` command.

Literal command:

```sh
bun ./qa-notice-probe.ts
```

Real stdout:

```text
notifications=1
command stdout:
Enabled: true
Opt-out matrix:
OMO_SENPI_DISABLE_POSTHOG: <unset>
OMO_DISABLE_POSTHOG: <unset>
OMO_SENPI_SEND_ANONYMOUS_TELEMETRY: <unset>
OMO_SEND_ANONYMOUS_TELEMETRY: <unset>
DO_NOT_TRACK: <unset>
omo.json telemetry.enabled: true
Last payloads:
[
  {
    "distinctId": "audit-machine",
    "event": "session_started",
    "properties": {
      "reason": "startup"
    }
  }
]
```

Binary observable: `notifications=1` after exactly two session starts, and command stdout contains the persisted event and payload fields.

## Adversarial results

- Malformed input: truncated `last-payloads.json` returns `Telemetry payload preview is unreadable or malformed.` without throwing. PASS.
- Empty state: absent `last-payloads.json` returns `No telemetry payloads have been recorded.` without throwing. PASS.
- Stale state: a pre-existing `<stateDir>/notice-shown` suppresses notification. PASS.
- Repeated interruptions: two concurrent `session_start` dispatches produce one notification because marker creation uses exclusive `wx`. PASS.
- Notification interruption: when the first UI notify throws, the marker already exists and a later session does not retry. PASS.
- Unwritable marker directory: two starts emit no notice, do not throw, and produce exactly one diagnostic from `omo-native-notice`. PASS.
- Disabled telemetry: `DO_NOT_TRACK=1` emits no notice. PASS.
- Misleading success output: focused test count and full telemetry-suite test count are recorded separately above. PASS.

## Cleanup receipt

```text
cleanup: qa-notice-probe.ts deleted
```

The temp agent directory was removed by `withTempAgentDir`, its generated telemetry state was removed by the probe, and `test ! -e ./qa-notice-probe.ts` succeeded after deletion.
