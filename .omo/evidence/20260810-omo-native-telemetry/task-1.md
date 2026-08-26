# Task 1 Evidence: DO_NOT_TRACK global telemetry opt-out

## Scope and baseline

Implementation scope:

- `packages/telemetry-core/src/env.ts`
- `packages/telemetry-core/src/env.test.ts`

Pre-change baseline command:

```sh
bun test packages/telemetry-core/src/env.test.ts
```

Observable baseline: 15 pass, 0 fail, 15 assertions, 15 tests across 1 file.

## RED capture

Exact command:

```sh
bun test packages/telemetry-core/src/env.test.ts
```

The test was run after adding the DO_NOT_TRACK cases and before changing `env.ts`. Exit status was nonzero as required.

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/telemetry-core/src/env.test.ts:
(pass) opt-out telemetry env matrix > #given unset env enables telemetry #when evaluated #then disabled={} [0.47ms]
(pass) opt-out telemetry env matrix > #given global disable 1 #when evaluated #then disabled={
  OMO_DISABLE_POSTHOG: "1",
} [0.07ms]
(pass) opt-out telemetry env matrix > #given global disable true #when evaluated #then disabled={
  OMO_DISABLE_POSTHOG: "true",
} [0.06ms]
(pass) opt-out telemetry env matrix > #given global disable yes #when evaluated #then disabled={
  OMO_DISABLE_POSTHOG: "yes",
} [0.05ms]
(pass) opt-out telemetry env matrix > #given global send 0 #when evaluated #then disabled={
  OMO_SEND_ANONYMOUS_TELEMETRY: "0",
} [0.05ms]
(pass) opt-out telemetry env matrix > #given global send false #when evaluated #then disabled={
  OMO_SEND_ANONYMOUS_TELEMETRY: "false",
} [0.08ms]
(pass) opt-out telemetry env matrix > #given global send no #when evaluated #then disabled={
  OMO_SEND_ANONYMOUS_TELEMETRY: "no",
} [0.09ms]
(pass) opt-out telemetry env matrix > #given codex disable 1 #when evaluated #then disabled={
  OMO_CODEX_DISABLE_POSTHOG: "1",
} [0.05ms]
(pass) opt-out telemetry env matrix > #given codex disable true #when evaluated #then disabled={
  OMO_CODEX_DISABLE_POSTHOG: "true",
} [0.05ms]
(pass) opt-out telemetry env matrix > #given codex disable yes #when evaluated #then disabled={
  OMO_CODEX_DISABLE_POSTHOG: "yes",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given codex send 0 #when evaluated #then disabled={
  OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "0",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given codex send false #when evaluated #then disabled={
  OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "false",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given codex send no #when evaluated #then disabled={
  OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "no",
} [0.05ms]
(pass) opt-out telemetry env matrix > #given approved codex send yes convergence #when evaluated #then disabled={
  OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "yes",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given invalid disable value #when evaluated #then disabled={
  OMO_CODEX_DISABLE_POSTHOG: "maybe",
} [0.04ms]
48 |         env: { DO_NOT_TRACK: "1" },
49 |         productEnvPrefix,
50 |       })
51 | 
52 |       // then
53 |       expect(result).toBe(true)
                          ^
error: expect(received).toBe(expected)

Expected: true
Received: false

      at <anonymous> (/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/telemetry-core/src/env.test.ts:53:22)
(fail) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is 1 > #when evaluated for omo-opencode #then telemetry is disabled [0.17ms]
48 |         env: { DO_NOT_TRACK: "1" },
49 |         productEnvPrefix,
50 |       })
51 | 
52 |       // then
53 |       expect(result).toBe(true)
                          ^
error: expect(received).toBe(expected)

Expected: true
Received: false

      at <anonymous> (/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/telemetry-core/src/env.test.ts:53:22)
(fail) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is 1 > #when evaluated for omo-codex #then telemetry is disabled [0.07ms]
48 |         env: { DO_NOT_TRACK: "1" },
49 |         productEnvPrefix,
50 |       })
51 | 
52 |       // then
53 |       expect(result).toBe(true)
                          ^
error: expect(received).toBe(expected)

Expected: true
Received: false

      at <anonymous> (/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/telemetry-core/src/env.test.ts:53:22)
(fail) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is 1 > #when evaluated for omo-senpi #then telemetry is disabled [0.09ms]
61 |         env: { DO_NOT_TRACK: " TRUE " },
62 |         productEnvPrefix: "OMO_SENPI",
63 |       })
64 | 
65 |       // then
66 |       expect(result).toBe(true)
                          ^
error: expect(received).toBe(expected)

Expected: true
Received: false

      at <anonymous> (/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/telemetry-core/src/env.test.ts:66:22)
(fail) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK uses existing flag normalization > #when the value is space-padded mixed case #then telemetry is disabled [0.07ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is not an opt-out value > #when the value is 0 #then telemetry remains enabled [0.05ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is not an opt-out value > #when the value is unset #then telemetry remains enabled [0.04ms]
91 |       const duringOptOut = shouldDisableTelemetry({ env, productEnvPrefix: "OMO_SENPI" })
92 |       env.DO_NOT_TRACK = ""
93 |       const afterOptOut = shouldDisableTelemetry({ env, productEnvPrefix: "OMO_SENPI" })
94 | 
95 |       // then
96 |       expect([beforeOptOut, duringOptOut, afterOptOut]).toEqual([false, true, false])
                                                             ^
error: expect(received).toEqual(expected)

  [
    false,
-   true,
+   false,
    false,
  ]

- Expected  - 1
+ Received  + 1

      at <anonymous> (/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/telemetry-core/src/env.test.ts:96:57)
(fail) DO_NOT_TRACK global opt-out > #given the same env object changes between evaluations > #when DO_NOT_TRACK changes #then each call reads the current value [0.11ms]

 17 pass
 5 fail
 22 expect() calls
Ran 22 tests across 1 file. [98.00ms]
```

RED result: 17 pass, 5 fail, 22 assertions. Failures showed `DO_NOT_TRACK=1`, normalized `" TRUE "`, and the changed-env opt-out value were not yet honored.

## GREEN capture

Exact command:

```sh
bun test packages/telemetry-core
```

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/telemetry-core/src/env.test.ts:
(pass) opt-out telemetry env matrix > #given unset env enables telemetry #when evaluated #then disabled={} [0.74ms]
(pass) opt-out telemetry env matrix > #given global disable 1 #when evaluated #then disabled={
  OMO_DISABLE_POSTHOG: "1",
} [0.07ms]
(pass) opt-out telemetry env matrix > #given global disable true #when evaluated #then disabled={
  OMO_DISABLE_POSTHOG: "true",
} [0.05ms]
(pass) opt-out telemetry env matrix > #given global disable yes #when evaluated #then disabled={
  OMO_DISABLE_POSTHOG: "yes",
} [0.05ms]
(pass) opt-out telemetry env matrix > #given global send 0 #when evaluated #then disabled={
  OMO_SEND_ANONYMOUS_TELEMETRY: "0",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given global send false #when evaluated #then disabled={
  OMO_SEND_ANONYMOUS_TELEMETRY: "false",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given global send no #when evaluated #then disabled={
  OMO_SEND_ANONYMOUS_TELEMETRY: "no",
} [0.07ms]
(pass) opt-out telemetry env matrix > #given codex disable 1 #when evaluated #then disabled={
  OMO_CODEX_DISABLE_POSTHOG: "1",
} [0.05ms]
(pass) opt-out telemetry env matrix > #given codex disable true #when evaluated #then disabled={
  OMO_CODEX_DISABLE_POSTHOG: "true",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given codex disable yes #when evaluated #then disabled={
  OMO_CODEX_DISABLE_POSTHOG: "yes",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given codex send 0 #when evaluated #then disabled={
  OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "0",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given codex send false #when evaluated #then disabled={
  OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "false",
} [0.05ms]
(pass) opt-out telemetry env matrix > #given codex send no #when evaluated #then disabled={
  OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "no",
} [0.05ms]
(pass) opt-out telemetry env matrix > #given approved codex send yes convergence #when evaluated #then disabled={
  OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "yes",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given invalid disable value #when evaluated #then disabled={
  OMO_CODEX_DISABLE_POSTHOG: "maybe",
} [0.04ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is 1 > #when evaluated for omo-opencode #then telemetry is disabled [0.05ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is 1 > #when evaluated for omo-codex #then telemetry is disabled [0.04ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is 1 > #when evaluated for omo-senpi #then telemetry is disabled [0.04ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK uses existing flag normalization > #when the value is space-padded mixed case #then telemetry is disabled [0.05ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is not an opt-out value > #when the value is 0 #then telemetry remains enabled [0.04ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is not an opt-out value > #when the value is unset #then telemetry remains enabled [0.04ms]
(pass) DO_NOT_TRACK global opt-out > #given the same env object changes between evaluations > #when DO_NOT_TRACK changes #then each call reads the current value [0.06ms]

packages/telemetry-core/src/activity-state.test.ts:
(pass) daily-active dedup state > #given XDG_DATA_HOME #when telemetry state dir resolves #then product cache dir appears exactly once [0.85ms]
(pass) daily-active dedup state > #given no state #when evaluated #then it sends once and writes current UTC day schema [0.78ms]
(pass) daily-active dedup state > #given stale state #when evaluated next day #then it sends and preserves schema field name [0.50ms]
(pass) daily-active dedup state > #given malformed state JSON #when evaluated #then it treats state as missing and records diagnostics [0.72ms]

packages/telemetry-core/src/posthog-client.test.ts:
(pass) posthog telemetry client > #given codex product parameters #when daily active is captured #then payload shape matches current contract [3.40ms]
(pass) posthog telemetry client > #given a state dir and fake transport #when daily active records twice same day #then only one event is sent [0.63ms]
(pass) posthog telemetry client > #given no API key after trimming #when client is created #then transport is not constructed [0.07ms]
(pass) posthog telemetry client > #given telemetry is disabled #when daily active records #then dedup state is not written [0.18ms]
(pass) posthog telemetry client > #given blank API key #when daily active records #then dedup state is not written [0.16ms]

 31 pass
 0 fail
 43 expect() calls
Ran 31 tests across 3 files. [106.00ms]
```

GREEN result: 31 pass, 0 fail, 43 assertions across 3 files.

Test count delta for `env.test.ts`: baseline 15 tests, final 22 tests, delta +7. The full package test count was 31, confirming the new test file cases actually ran and asserted rather than relying on command success output alone.

## Typecheck

The package has a `typecheck` script, so the package-local command was used.

Exact command:

```sh
bun run --cwd packages/telemetry-core typecheck
```

```text
$ tsgo --noEmit -p tsconfig.json
```

Result: exit 0.

## Manual QA

### Process-level DO_NOT_TRACK suite

Exact command:

```sh
DO_NOT_TRACK=1 bun test packages/telemetry-core
```

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/telemetry-core/src/env.test.ts:
(pass) opt-out telemetry env matrix > #given unset env enables telemetry #when evaluated #then disabled={} [0.49ms]
(pass) opt-out telemetry env matrix > #given global disable 1 #when evaluated #then disabled={
  OMO_DISABLE_POSTHOG: "1",
} [0.07ms]
(pass) opt-out telemetry env matrix > #given global disable true #when evaluated #then disabled={
  OMO_DISABLE_POSTHOG: "true",
} [0.07ms]
(pass) opt-out telemetry env matrix > #given global disable yes #when evaluated #then disabled={
  OMO_DISABLE_POSTHOG: "yes",
} [0.05ms]
(pass) opt-out telemetry env matrix > #given global send 0 #when evaluated #then disabled={
  OMO_SEND_ANONYMOUS_TELEMETRY: "0",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given global send false #when evaluated #then disabled={
  OMO_SEND_ANONYMOUS_TELEMETRY: "false",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given global send no #when evaluated #then disabled={
  OMO_SEND_ANONYMOUS_TELEMETRY: "no",
} [0.07ms]
(pass) opt-out telemetry env matrix > #given codex disable 1 #when evaluated #then disabled={
  OMO_CODEX_DISABLE_POSTHOG: "1",
} [0.06ms]
(pass) opt-out telemetry env matrix > #given codex disable true #when evaluated #then disabled={
  OMO_CODEX_DISABLE_POSTHOG: "true",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given codex disable yes #when evaluated #then disabled={
  OMO_CODEX_DISABLE_POSTHOG: "yes",
} [0.03ms]
(pass) opt-out telemetry env matrix > #given codex send 0 #when evaluated #then disabled={
  OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "0",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given codex send false #when evaluated #then disabled={
  OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "false",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given codex send no #when evaluated #then disabled={
  OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "no",
} [0.08ms]
(pass) opt-out telemetry env matrix > #given approved codex send yes convergence #when evaluated #then disabled={
  OMO_CODEX_SEND_ANONYMOUS_TELEMETRY: "yes",
} [0.04ms]
(pass) opt-out telemetry env matrix > #given invalid disable value #when evaluated #then disabled={
  OMO_CODEX_DISABLE_POSTHOG: "maybe",
} [0.03ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is 1 > #when evaluated for omo-opencode #then telemetry is disabled [0.04ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is 1 > #when evaluated for omo-codex #then telemetry is disabled [0.04ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is 1 > #when evaluated for omo-senpi #then telemetry is disabled [0.05ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK uses existing flag normalization > #when the value is space-padded mixed case #then telemetry is disabled [0.06ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is not an opt-out value > #when the value is 0 #then telemetry remains enabled [0.04ms]
(pass) DO_NOT_TRACK global opt-out > #given DO_NOT_TRACK is not an opt-out value > #when the value is unset #then telemetry remains enabled [0.04ms]
(pass) DO_NOT_TRACK global opt-out > #given the same env object changes between evaluations > #when DO_NOT_TRACK changes #then each call reads the current value [0.06ms]

packages/telemetry-core/src/activity-state.test.ts:
(pass) daily-active dedup state > #given XDG_DATA_HOME #when telemetry state dir resolves #then product cache dir appears exactly once [0.34ms]
(pass) daily-active dedup state > #given no state #when evaluated #then it sends once and writes current UTC day schema [0.69ms]
(pass) daily-active dedup state > #given stale state #when evaluated next day #then it sends and preserves schema field name [0.50ms]
(pass) daily-active dedup state > #given malformed state JSON #when evaluated #then it treats state as missing and records diagnostics [0.67ms]

packages/telemetry-core/src/posthog-client.test.ts:
(pass) posthog telemetry client > #given codex product parameters #when daily active is captured #then payload shape matches current contract [3.23ms]
(pass) posthog telemetry client > #given a state dir and fake transport #when daily active records twice same day #then only one event is sent [0.57ms]
(pass) posthog telemetry client > #given no API key after trimming #when client is created #then transport is not constructed [0.07ms]
(pass) posthog telemetry client > #given telemetry is disabled #when daily active records #then dedup state is not written [0.20ms]
(pass) posthog telemetry client > #given blank API key #when daily active records #then dedup state is not written [0.17ms]

 31 pass
 0 fail
 43 expect() calls
Ran 31 tests across 3 files. [121.00ms]
```

Result: 31 pass, 0 fail, 43 assertions across 3 files.

### Public package import one-liner

The telemetry-core package export resolves to its shipped TypeScript source, so this exercises the public package surface.

Exact command:

```sh
bun -e 'import { shouldDisableTelemetry } from "@oh-my-opencode/telemetry-core"; for (const env of [{ DO_NOT_TRACK: "1" }, { DO_NOT_TRACK: "false" }, {}, { OMO_DISABLE_POSTHOG: "1" }]) console.log(JSON.stringify(env), shouldDisableTelemetry({ env, productEnvPrefix: "OMO_SENPI" }))'
```

Real stdout:

```text
{"DO_NOT_TRACK":"1"} true
{"DO_NOT_TRACK":"false"} false
{} false
{"OMO_DISABLE_POSTHOG":"1"} true
```

Observable result: standard opt-out disables, explicit false and unset do not disable, and the existing product flag still disables.

## Adversarial classes

### Malformed input

Exact command:

```sh
bun -e 'import { shouldDisableTelemetry } from "./packages/telemetry-core/src/env.ts"; for (const [label, value] of [["empty", ""], ["whitespace-only", "   "], ["mixed-case", " YeS "], ["unicode-lookalike", "ｔｒｕｅ"]]) console.log(label, JSON.stringify(value), shouldDisableTelemetry({ env: { DO_NOT_TRACK: value }, productEnvPrefix: "OMO_SENPI" }))'
```

Real stdout:

```text
empty "" false
whitespace-only "   " false
mixed-case " YeS " true
unicode-lookalike "ｔｒｕｅ" false
```

Observable result: empty and whitespace-only values do not disable; ASCII mixed-case `YeS` disables after trim/lowercase normalization; the full-width Unicode lookalike does not match an accepted ASCII value.

### Stale state

The test `#given the same env object changes between evaluations #when DO_NOT_TRACK changes #then each call reads the current value` mutates one env object through `false -> yes -> empty` and observes `[false, true, false]`. This confirms there is no cached environment read.

### Misleading success output

The pre-change env suite had 15 tests. The post-change env suite ran 22 tests, a delta of 7, and the full telemetry-core suite reported 43 assertion calls. RED contained 5 assertion failures before implementation; GREEN contained 0 failures after implementation.

## Additional checks

Exact command:

```sh
git diff --check
```

Result: exit 0 with no output.

The pre-existing `SEND_OPT_OUT_VALUES` entry `"yes"` was intentionally preserved unchanged.

## Cleanup receipt

No runtime resources spawned. Only short-lived Bun and typecheck processes were run; all exited. Temporary capture files were created under `/tmp` for evidence assembly and are outside the repository.
