# Task 6 evidence: OmO Native session lifecycle

Date: 2026-08-10

## Scope

Implemented only:

- `packages/omo-senpi/src/components/telemetry/omo-native-session.ts`
- `packages/omo-senpi/src/components/telemetry/omo-native-session.test.ts`

The required evidence file is the only additional task-owned write. Concurrent sibling-lane files were not staged or edited.

## RED

Command:

```sh
bun test packages/omo-senpi/src/components/telemetry/omo-native-session.test.ts
```

Real failing output before implementation:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/omo-native-session.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './omo-native-session' from '/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/src/components/telemetry/omo-native-session.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [152.00ms]
```

## Real model inventory shape finding

The machine's actual home is `/Users/yeongyu`, so the required files resolve to:

- `/Users/yeongyu/.senpi/agent/models.json`
- `/Users/yeongyu/.senpi/agent/settings.json`

Credential values were not printed or copied. The exact structural inspection result was:

```text
models.json top-level keys: ['providers']
providers type: dict count: 10
first provider id: anthropic keys: ['api', 'apiKey', 'baseUrl', 'headers', 'modelOverrides', 'models', 'name']
first provider models type: list count: 5
first model keys: ['compat', 'contextWindow', 'cost', 'id', 'input', 'maxTokens', 'name', 'reasoning', 'thinkingLevelMap', 'upstreamModelId']
settings.json top-level keys: ['defaultModel', 'defaultProvider', 'defaultThinkingLevel', 'favoriteModels', 'lastChangelogVersion', 'packages', 'retry', 'theme', 'tipsHistory']
defaultProvider present/type: True str
defaultModel present/type: True str
```

The tests cite and use those exact relevant keys:

- `models.json`: top-level `providers`, provider-level `models`, model-level `id`
- `settings.json`: `defaultProvider`, `defaultModel`

The implementation reads only `models.json` and `settings.json`. It never reads `auth.json`.

## GREEN

Focused command:

```sh
bun test packages/omo-senpi/src/components/telemetry/omo-native-session.test.ts
```

Result:

```text
9 pass
0 fail
28 expect() calls
Ran 9 tests across 1 file.
```

Required telemetry directory command:

```sh
bun test packages/omo-senpi/src/components/telemetry
```

Result:

```text
55 pass
0 fail
171 expect() calls
Ran 55 tests across 8 files. [1133.00ms]
```

Test-count receipt: task 6 contributes 9 of the 55 passing tests. The earlier incomplete concurrent-wave run reported 48 passes plus one missing sibling module; the final required run includes the completed sibling lane and reports 55 actual passes, not the earlier partial count.

Typecheck command:

```sh
bun run --cwd packages/omo-senpi typecheck
```

Result:

```text
$ tsgo --noEmit -p tsconfig.json
```

Exit status: 0.

## Verified behavior

- `DO_NOT_TRACK=1` suppresses native and legacy event creation and leaves both marker paths absent.
- Real `omo.json` loading with `telemetry.enabled:false` suppresses native and legacy event creation and leaves both marker paths absent.
- Environment opt-out is checked before configuration opt-out.
- Enabled sessions dual-emit the legacy `omo_senpi_daily_active` and native `daily_active` on their independent daily markers.
- Native `daily_active` uses `getDailyActiveCaptureState` with the OmO Native state directory and is sent only through `captureEvent`.
- Two separate clients on the same UTC day produce one native `daily_active`; `FIXED_NOW + 24h` produces the second.
- A pre-existing legacy marker's exact bytes remain unchanged while the native marker is written separately.
- `session_started` includes session reason, OS/release, architecture, CPU count, memory bucket, provider/model counts, known provider names, and independently masked defaults.
- The recorded `session_started` property key set is asserted exactly as the event allowlist plus the wrapper's mandatory shared properties. No call-site extras survive.
- Missing or corrupt inventory produces counts 0, omits defaults, reports exactly one inventory diagnostic, and does not throw.
- Empty `providers` is valid and emits zero counts without a diagnostic.
- `session_shutdown` invokes the one native session client's bounded shutdown; the injected timer records exactly `1000` ms and the native transport flush/shutdown counts are each one.
- The legacy call remains fire-and-forget on the interactive path; native capture is synchronous enqueue and native flush occurs only on shutdown.

## Manual QA

Auxiliary script: `/tmp/omo-native-session-qa.ts`. It created a temporary agent directory, wrote data-shaped `providers` / `models` and `defaultProvider` / `defaultModel` fixtures, registered `createOmoNativeSessionComponent` on `FakeExtensionAPI`, dispatched `session_start`, and used a recording transport.

Literal command:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun /tmp/omo-native-session-qa.ts
```

Real stdout, exact captured `session_started` payload JSON:

```json
{
  "distinctId": "0b0a8867d0dcea081efdbac05d22c0904b5ac59ae85876e3f8343dc994a2a39c",
  "event": "session_started",
  "properties": {
    "$session_id": "qa-session-hash",
    "$os": "darwin",
    "$os_version": "26.3.1",
    "arch": "arm64",
    "cpu_count": 2,
    "memory_bucket": "32_63_gb",
    "provider_count": 2,
    "model_count": 2,
    "providers": "anthropic",
    "reason": "resume",
    "default_provider": "anthropic",
    "default_model": "claude-sonnet-5",
    "platform": "omo-senpi",
    "product_name": "omo-native",
    "package_version": "5.0.0-beta.5",
    "schema_version": 1,
    "$process_person_profile": false
  }
}
```

## Adversarial results

- Corrupt `models.json`: no throw, one diagnostic, counts 0, defaults omitted.
- Absent inventory: no throw, one diagnostic, counts 0, defaults omitted.
- Empty `providers`: valid zero inventory, no diagnostic.
- Stale state: a second component/client on `2026-07-03` does not re-emit native daily activity.
- Next UTC day: `2026-07-04` re-emits native daily activity once.
- Unknown provider name is excluded from `providers`; unknown model under known `anthropic` is masked to `custom` while `default_provider` remains `anthropic`.
- Auth-file guard command found no `auth` / `auth.json` reference in either owned file.
- Dirty worktree guard: concurrent untracked `omo-native-prompt.ts` and test were observed and deliberately excluded from this task's staging.

## Cleanup receipt

```text
removed /tmp/omo-native-session-qa.ts
Temporary omo-native-session-qa-* directories remaining: 0
auth references in owned implementation/test: none
```

All `withTempAgentDir` fixtures remove their directories in `finally`.

## Shipping reminder

`OMO_NATIVE_POSTHOG_API_KEY` remains the wave-1 placeholder `phc_REPLACE_ME_OMO_NATIVE`. Without a `POSTHOG_API_KEY` override, PostHog will drop native events until the OmO Native project key is supplied.
