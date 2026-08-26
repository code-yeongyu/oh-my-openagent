# OmO Native placeholder key fix evidence

Date: 2026-08-11
Branch: `fix/omo-native-placeholder-key`

## Defect reproduction: RED

The first change was a regression test asserting that the shipped OmO Native placeholder with a clean environment must be disabled. No production code had changed yet.

Command:

```text
bun test packages/telemetry-core/src/posthog-client.test.ts
```

Output:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/telemetry-core/src/posthog-client.test.ts:
60 |       env: {},
61 |       product: {
62 |         defaultApiKey: "phc_REPLACE_ME_OMO_NATIVE",
63 |         productEnvPrefix: "OMO_SENPI",
64 |       },
65 |     })).toBe(false)
             ^
error: expect(received).toBe(expected)

Expected: false
Received: true

(fail) posthog telemetry client > #given the unconfigured OmO Native placeholder and clean env #when enabled state is checked #then telemetry is disabled

 5 pass
 1 fail
 11 expect() calls
Ran 6 tests across 1 file.
```

This reproduces the shipped defect: the non-empty placeholder was treated as a configured key.

## Implementation contract

Telemetry core now exports `UNCONFIGURED_POSTHOG_API_KEY` and `isConfiguredTelemetryApiKey`. `hasTelemetryApiKey` rejects only the trimmed, exact placeholder value and continues to reject empty or whitespace-only values. `isTelemetryClientEnabled` uses that shared resolution path.

OmO Native imports the shared placeholder constant instead of defining a second magic string. No checks were scattered through omo-senpi call sites.

Exact-match policy for adversarial input:

- Empty string: disabled.
- Whitespace-only string: disabled.
- Exact placeholder: disabled.
- A longer key that contains the placeholder substring: enabled. The contract rejects the exact sentinel only, so a future real value cannot be rejected by broad substring matching.

## Focused GREEN

Command:

```text
bun test packages/telemetry-core/src/env.test.ts packages/telemetry-core/src/posthog-client.test.ts
```

Final output summary:

```text
(pass) telemetry API key configuration > #given empty input #when key availability is checked #then the expected result is returned
(pass) telemetry API key configuration > #given whitespace-only input #when key availability is checked #then the expected result is returned
(pass) telemetry API key configuration > #given exact unconfigured placeholder input #when key availability is checked #then the expected result is returned
(pass) telemetry API key configuration > #given longer key containing the placeholder input #when key availability is checked #then the expected result is returned
(pass) posthog telemetry client > #given the unconfigured OmO Native placeholder and clean env #when clients are created #then telemetry fails closed without constructing transports
(pass) posthog telemetry client > #given the placeholder default and a real env override #when enabled state is checked #then telemetry is enabled
(pass) posthog telemetry client > #given the legacy shared key as the default #when enabled state is checked #then telemetry remains enabled
(pass) posthog telemetry client > #given a real OmO Native default replaces the placeholder #when enabled state is checked #then telemetry activates without another flag

 35 pass
 0 fail
 42 expect() calls
Ran 35 tests across 2 files.
```

The two-client test creates two clients in one process with the same placeholder input. Both report `enabled: false`, and the transport factory invocation count remains zero.

First-run notice command:

```text
bun test packages/omo-senpi/src/components/telemetry/omo-native-notice.test.ts packages/omo-senpi/src/components/telemetry/product-identity.test.ts
```

Output summary:

```text
(pass) OmO Native telemetry notice and preview > #given the unconfigured project key #when session_start fires #then no first-run notice is sent

 22 pass
 0 fail
 168 expect() calls
Ran 22 tests across 2 files.
```

The notice test also verifies that no `notice-shown` marker is written while telemetry is disabled.

## Test-count delta

Origin/dev telemetry-core baseline was run in a detached temporary worktree:

```text
 41 pass
 0 fail
 75 expect() calls
Ran 41 tests across 4 files.
```

Changed telemetry-core suite:

```text
 49 pass
 0 fail
 85 expect() calls
Ran 49 tests across 4 files.
```

Delta: `+8` telemetry-core tests.

The origin/dev notice test was materialized temporarily beside the current module and run, then deleted:

```text
 13 pass
 0 fail
 31 expect() calls
Ran 13 tests across 1 file.
```

The changed notice test has 14 passing cases in the focused run. Delta: `+1` notice test. Total added test cases: `+9`.

## Required package gates

### telemetry-core tests

Command:

```text
bun test packages/telemetry-core
```

Output:

```text
 49 pass
 0 fail
 85 expect() calls
Ran 49 tests across 4 files. [120.00ms]
```

### omo-senpi tests

Command:

```text
bun test packages/omo-senpi
```

Output:

```text
 988 pass
 0 fail
 2980 expect() calls
Ran 988 tests across 152 files. [48.08s]
```

No `OMO_AGENT_TOOLKIT_BIN` exception or rerun was needed.

### telemetry-core typecheck

Command:

```text
bun run --cwd packages/telemetry-core typecheck
```

Output:

```text
$ tsgo --noEmit -p tsconfig.json
```

Exit status: 0.

### omo-senpi typecheck

Command:

```text
bun run --cwd packages/omo-senpi typecheck
```

Output:

```text
$ tsgo --noEmit -p tsconfig.json
```

Exit status: 0.

## Bundle rebuild and gates

The source change affects bundled telemetry-core logic, so all three extension JavaScript artifacts were rebuilt.

Command:

```text
node packages/omo-senpi/plugin/scripts/build-extension.mjs
```

Output:

```text
Bundled 776 modules in 45ms

  omo.js  0.89 MB  (entry point)

Bundled 279 modules in 10ms

  omo-member.js  117.61 KB  (entry point)

Bundled 61 modules in 5ms

  omo-memory-mcp.js  49.57 KB  (entry point)

Built omo-senpi extensions: /Volumes/mengmotaStorage/local-workspaces/omo-wt/fix/omo-native-placeholder-key/packages/omo-senpi/plugin/extensions/omo.js, /Volumes/mengmotaStorage/local-workspaces/omo-wt/fix/omo-native-placeholder-key/packages/omo-senpi/plugin/extensions/omo-member.js
```

Measured main bundle size command:

```text
stat -f '%z' packages/omo-senpi/plugin/extensions/omo.js
```

Output:

```text
895123
```

Measured size: `895123` bytes. Budget: `900000` bytes. Remaining headroom: `4877` bytes.

Command after rebuild:

```text
bun test packages/omo-senpi/src/bundle-size.test.ts packages/omo-senpi/src/bundle-purity.test.ts
```

Output:

```text
bun test v1.4.0-canary.1 (b58cd4685)

(pass) omo-senpi bundle size budget > #given the built extension #when its byte size is measured #then it stays within the documented byte budget
(pass) omo-senpi bundle purity > #given the senpi loader aliases #when tested #then the shared build constant pins all 19 peers
(pass) omo-senpi bundle purity > #given a built extension #when static imports are inspected #then only senpi peers and node builtins remain external

 3 pass
 0 fail
 5 expect() calls
Ran 3 tests across 2 files. [109.00ms]
```

## Real-surface QA

Invocation follows the script header and uses Bun. The script itself sets `POSTHOG_API_KEY=phc_test` for the enabled drive.

Command, run after the extension rebuild:

```text
bun script/qa/omo-native-telemetry-qa.mjs --evidence-dir /tmp/st_019feec3-real-qa-rebuilt
```

Output:

```json
{
  "result": "PASS",
  "evidenceDir": "../../../../../../tmp/st_019feec3-real-qa-rebuilt",
  "assertions": 19,
  "enabledRequests": 2,
  "capturedEvents": 16,
  "optOutDntRequests": 0,
  "optOutConfigRequests": 0,
  "cleanup": {
    "serverPid": 44178,
    "killZeroFails": true,
    "serverListening": false,
    "port": 64063,
    "portFree": true,
    "lsofOutput": ""
  }
}
```

## Four-case key probe

Temporary probe path: `./qa-key-probe.ts`.

Literal command:

```text
bun ./qa-key-probe.ts
```

Real stdout:

```text
placeholder+clean env: false
POSTHOG_API_KEY override: true
legacy shared default: true
DO_NOT_TRACK=1: false
```

## Documentation

`docs/reference/senpi-telemetry.md` now states that OmO Native telemetry remains inactive while the packaged key is an unconfigured placeholder and that a real `POSTHOG_API_KEY` activates it. The generated schema block was not changed. The schema drift test passed as part of the 988-test omo-senpi suite.

## Cleanup receipt

Temporary probe, baseline test file, and detached baseline worktree were removed.

```text
probe_exists=false
baseline_worktree_exists=false
notice_baseline_temp_exists=false
```

Final whitespace validation command:

```text
git diff --check
```

Expected and observed result: no output, exit status 0.
