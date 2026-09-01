# F2 fixes: allowlist single-source + fail-closed config

## Result

PASS. The QA privacy scan now imports the canonical OmO Native allowlists and known model/provider inventories from `product-identity.ts`. Session telemetry and the notice/preview path now distinguish a missing config from malformed or unreadable existing config: missing remains enabled by default, while config errors disable telemetry and emit a diagnostic.

## Finding 1: canonical QA allowlist

### RED

Command:

```text
bun test script/qa/omo-native-telemetry-qa.test.ts
```

Observed before the implementation:

```text
SyntaxError: Export named 'assertAllowlistCoverage' not found in module 'script/qa/omo-native-telemetry-qa.mjs'.
0 pass
1 fail
1 error
```

The old script had no canonical coverage assertion and retained hand-maintained `propertyAllowlists` and `knownModels` copies.

### GREEN

Command:

```text
bun test script/qa/omo-native-telemetry-qa.test.ts
```

Observed:

```text
2 pass
0 fail
4 expect() calls
```

The script now runs under Bun, imports `OMO_NATIVE_PROPERTY_ALLOWLISTS`, `KNOWN_MODELS`, and `KNOWN_PROVIDERS` directly from `packages/omo-senpi/src/components/telemetry/product-identity.ts`, and calls `assertAllowlistCoverage(OMO_NATIVE_PROPERTY_ALLOWLISTS)` during module initialization. The assertion requires exactly these seven event names: `daily_active`, `session_started`, `prompt_submitted`, `turn_completed`, `skill_loaded`, `delegation_started`, and `feature_used`. The test also proves missing and extra events fail loudly.

Repository invocation audit:

```text
rg -n --hidden 'node script/qa/omo-native-telemetry-qa|omo-native-telemetry-qa' . --glob '!node_modules' --glob '!.git'
```

Observed only the QA script, its co-located test import, and the new Bun usage line. `rg -n 'omo-native-telemetry-qa' .github` returned no CI references. No caller invokes the old Node command.

## Finding 2: fail-closed config errors

### RED

Command:

```text
bun test packages/omo-senpi/src/components/telemetry/omo-native-session.test.ts packages/omo-senpi/src/components/telemetry/omo-native-notice.test.ts
```

Observed before the implementation:

```text
Expected: []
Received: daily_active, session_started, omo_senpi_daily_active
(fail) malformed existing config -> session telemetry is disabled and a diagnostic is emitted

Expected to contain: omo.json telemetry.enabled: false
Received: omo.json telemetry.enabled: true
(fail) malformed existing config -> notice preview reports disabled and emits a diagnostic

23 pass
2 fail
```

This captured the fail-open behavior: malformed existing config produced loader diagnostics, but both paths treated the loader's default config as enabled and emitted no config-error diagnostic.

### GREEN

The co-located tests cover both modules independently for all required states:

- no config file: enabled `true`
- valid `telemetry.enabled: false`: disabled
- valid `telemetry.enabled: true`: enabled
- malformed existing config: disabled and `telemetry_capture_failed` diagnostic emitted from the module source
- unreadable existing config, simulated by an `omo.json` directory that raises a read diagnostic: disabled and diagnostic emitted

Final focused/full command:

```text
bun test packages/omo-senpi/src/components/telemetry
```

Observed:

```text
79 pass
0 fail
314 expect() calls
Ran 79 tests across 11 files.
```

Typechecks:

```text
bun run --cwd packages/omo-senpi typecheck
bun run typecheck:script
```

Observed both commands exit 0 with `tsgo --noEmit` and no diagnostics.

## End-to-end QA re-run

The script's own updated usage documents Bun. Literal command:

```text
bun script/qa/omo-native-telemetry-qa.mjs --evidence-dir .omo/evidence/20260810-omo-native-telemetry --senpi-bin node_modules/.bin/senpi
```

Observed exit 0:

```json
{
  "result": "PASS",
  "evidenceDir": ".omo/evidence/20260810-omo-native-telemetry",
  "assertions": 19,
  "enabledRequests": 2,
  "capturedEvents": 16,
  "optOutDntRequests": 0,
  "optOutConfigRequests": 0,
  "cleanup": {
    "serverPid": 94065,
    "killZeroFails": true,
    "serverListening": false,
    "port": 54870,
    "portFree": true,
    "lsofOutput": ""
  }
}
```

The assertion count remains 19, including all seven event-presence checks, privacy scans, and both opt-out checks.

## Violation-detection proof

Temporary mutation, not committed: immediately before the privacy scan loop, the first captured event was assigned `bogus_property: true`.

The same literal QA command exited 1:

```text
Error: property-allowlist: daily_active.bogus_property is not documented or SDK-added
    at privacyScan (script/qa/omo-native-telemetry-qa.mjs:358:40)
```

The mutation was reverted before the green run. `git diff` contains no `bogus_property` assignment.

## Cleanup receipt

- Mutation reverted.
- Capture server PID 94065 stopped; `killZeroFails: true`.
- Port 54870 released; `portFree: true`; listener scan output empty.
- QA sandbox and capture temporary directories removed; a `find` scan returned no `omo-native-telemetry-*` directories.
- Temporary `/tmp/omo-native-f2-violation.out`, `/tmp/omo-native-f2-green.out`, `/tmp/omo-native-f2-green-current.out`, and `/tmp/omo-native-f2-telemetry-suite.out` proof files removed after this evidence was recorded.
- No process, port, sandbox, mutation, or temporary proof file remains.
