# Task 8 evidence: turn_completed usage and cost telemetry

## Source contracts verified

- `TurnEndEvent` was verified at `/Volumes/mengmotaStorage/local-workspaces/senpi/packages/coding-agent/src/core/extensions/types.ts:979-985`. It contains `turnIndex: number` and `message: AgentMessage`.
- The base pi-ai message union was verified at `/Volumes/mengmotaStorage/local-workspaces/senpi/packages/ai/src/types.ts:475-516`: `Message = UserMessage | AssistantMessage | ToolResultMessage`. Senpi's agent layer exposes this through `AgentMessage` at `/Volumes/mengmotaStorage/local-workspaces/senpi/packages/agent/src/types.ts:341-350`, with an empty-by-default declaration-merging extension point for custom messages. The handler therefore narrows explicitly on `event.message.role === "assistant"` before reading assistant-only fields.
- The real pi-ai source path is `/Volumes/mengmotaStorage/local-workspaces/senpi/packages/ai/src/types.ts`. Senpi resolves `node_modules/@earendil-works/pi-ai` to that package via a symlink.
- `Usage` was verified at that real path, lines 448-469. It has `input`, `output`, `cacheRead`, `cacheWrite`, optional `cacheWrite1h`, optional `reasoning`, `totalTokens`, and `cost.{input,output,cacheRead,cacheWrite,total}`.
- The pi-ai comment at lines 455-458 states that `reasoning` is a subset of `output` and that `output` already includes those tokens. The implementation uses `reasoning ?? 0` semantics and never adds reasoning to `output` or `totalTokens`. The docs task must warn consumers not to double count reasoning.
- User-defined provider models were verified at `/Volumes/mengmotaStorage/local-workspaces/senpi/packages/coding-agent/src/core/model-config-schema.ts:155-215`, where provider configuration accepts a `models` array of `ModelDefinitionSchema`. This is why a custom model under known provider `openai` is masked independently.

## RED

Command:

```sh
bun test packages/omo-senpi/src/components/telemetry/omo-native-turns.test.ts
```

Real output before implementation:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/omo-native-turns.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './omo-native-turns' from '/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/src/components/telemetry/omo-native-turns.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [128.00ms]
```

## Focused GREEN

Command:

```sh
bun test packages/omo-senpi/src/components/telemetry/omo-native-turns.test.ts
```

Real output after implementation:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/omo-native-turns.test.ts:
(pass) OmO Native turn telemetry > #given provider and model identities #when masked #then each field is decided independently [2.42ms]
(pass) OmO Native turn telemetry > #given an assistant turn #when it ends #then exactly one allowlisted turn_completed payload is emitted [1.12ms]
(pass) OmO Native turn telemetry > #given reasoning is absent #when the assistant turn ends #then reasoning is zero and not added to total [0.11ms]
(pass) OmO Native turn telemetry > #given a non-assistant AgentMessage #when turn_end fires #then no event is emitted [0.06ms]
(pass) OmO Native turn telemetry > #given missing usage #when the assistant turn ends #then zero values and one diagnostic are emitted [0.11ms]
(pass) OmO Native turn telemetry > #given malformed usage #when the assistant turn ends #then invalid values become zero with one diagnostic [0.07ms]
(pass) OmO Native turn telemetry > #given successive assistant turns #when emitted #then turn_index follows the host monotonically [0.07ms]

 7 pass
 0 fail
 22 expect() calls
Ran 7 tests across 1 file. [1062.00ms]
```

Test count delta receipt: this task adds 7 focused tests with 22 assertions. The required telemetry directory run completed with 39 tests and 121 assertions, so success was not inferred from a stale or empty test target.

## Required verification

### Telemetry directory

Command:

```sh
bun test packages/omo-senpi/src/components/telemetry
```

Result:

```text
39 pass
0 fail
121 expect() calls
Ran 39 tests across 6 files. [1.82s]
```

The run covered the 7 task-8 tests plus the committed and concurrently present telemetry tests. Required cases passing in the task-8 file include known/known, known/custom, unknown provider, both unknown, non-assistant zero events, missing fields, absent reasoning, cost rounding, one event per turn, exact allowlist keys, and sequential host turn indexes.

### Typecheck

Command:

```sh
bun run --cwd packages/omo-senpi typecheck
```

Real output:

```text
$ tsgo --noEmit -p tsconfig.json
```

Exit status: 0.

### Static checks

```text
git diff --check: exit 0
omo-native-turns.ts: 90 lines
omo-native-turns.test.ts: 199 lines
```

The implementation stays below the 200 LOC soft limit. No model-switching field or state was added.

## Adversarial results

- Message without `usage`: emitted one `turn_completed` event with all usage and cost fields set to zero, emitted exactly one diagnostic, and did not throw.
- `cost: null`: cost became zero and shared the event's single malformed-usage diagnostic.
- `NaN`, positive infinity, and negative token values: each invalid field became zero; valid fields remained intact; exactly one diagnostic was emitted for the turn.
- Missing optional `reasoning`: became zero with no diagnostic.
- Stale internal state: there is no internal turn counter. Two events with host indexes 8 and 9 emitted `[8, 9]`, proving each event uses the current host `turnIndex` rather than retained state.
- Independent masking: `openai` plus a user-defined model emitted `{provider:"openai", model_id:"custom"}`. Unknown provider and model emitted both fields as `custom`. The provider and model checks are separate decisions.
- Non-assistant input: a user message emitted zero events and zero diagnostics.
- Payload shape: the event-specific key set was compared exactly against `OMO_NATIVE_PROPERTY_ALLOWLISTS.turn_completed`.

## Manual QA through a recording transport

Literal command:

```sh
cat > /tmp/omo-task8-manual-qa.ts <<'EOF'
import type { TurnEndEvent } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/node_modules/@code-yeongyu/senpi/dist/index.d.ts"
import { createEventTelemetryClient } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/telemetry-core/src/events.ts"
import type { TelemetryCaptureMessage } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/telemetry-core/src/types.ts"
import { createOmoNativeTurnHandler } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/src/components/telemetry/omo-native-turns.ts"
import { createOmoNativeProductConfig, OMO_NATIVE_PROPERTY_ALLOWLISTS } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/src/components/telemetry/product-identity.ts"

const captured: TelemetryCaptureMessage[] = []
const client = createEventTelemetryClient({
  distinctId: "manual-machine",
  env: { POSTHOG_API_KEY: "manual-key" },
  product: createOmoNativeProductConfig(),
  propertyAllowlist: OMO_NATIVE_PROPERTY_ALLOWLISTS,
  schemaVersion: 1,
  source: "task-8-manual-qa",
  transportFactory: () => ({
    capture: (message) => captured.push(message),
    flush: async () => undefined,
    shutdown: async () => undefined,
  }),
})
const handle = createOmoNativeTurnHandler({ client, sessionId: "manual-session" })
const usage = {
  input: 10,
  output: 20,
  cacheRead: 3,
  cacheWrite: 4,
  totalTokens: 37,
  cost: { input: 0.1, output: 0.2, cacheRead: 0.03, cacheWrite: 0.04, total: 0.123456 },
}
function event(turnIndex: number, provider: string, model: string): TurnEndEvent {
  return {
    type: "turn_end",
    turnIndex,
    message: { role: "assistant", provider, model, usage },
    toolResults: [],
  } as unknown as TurnEndEvent
}
handle(event(1, "openai", "gpt-5.6-sol"))
handle(event(2, "openai", "user-defined-model"))
handle(event(3, "sionic-openrouter", "private-model"))
handle({
  type: "turn_end",
  turnIndex: 4,
  message: { role: "user", content: "not collected", timestamp: 1 },
  toolResults: [],
} as TurnEndEvent)
console.log(JSON.stringify(captured, null, 2))
EOF
bun /tmp/omo-task8-manual-qa.ts
rm /tmp/omo-task8-manual-qa.ts
```

Real stdout:

```json
[
  {
    "distinctId": "manual-machine",
    "event": "turn_completed",
    "properties": {
      "$session_id": "manual-session",
      "provider": "openai",
      "model_id": "gpt-5.6-sol",
      "input_tokens": 10,
      "output_tokens": 20,
      "cache_read_tokens": 3,
      "cache_write_tokens": 4,
      "reasoning_tokens": 0,
      "total_tokens": 37,
      "cost_usd": 0.1235,
      "turn_index": 1,
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "package_version": "5.0.0-beta.5",
      "schema_version": 1,
      "$process_person_profile": false
    }
  },
  {
    "distinctId": "manual-machine",
    "event": "turn_completed",
    "properties": {
      "$session_id": "manual-session",
      "provider": "openai",
      "model_id": "custom",
      "input_tokens": 10,
      "output_tokens": 20,
      "cache_read_tokens": 3,
      "cache_write_tokens": 4,
      "reasoning_tokens": 0,
      "total_tokens": 37,
      "cost_usd": 0.1235,
      "turn_index": 2,
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "package_version": "5.0.0-beta.5",
      "schema_version": 1,
      "$process_person_profile": false
    }
  },
  {
    "distinctId": "manual-machine",
    "event": "turn_completed",
    "properties": {
      "$session_id": "manual-session",
      "provider": "custom",
      "model_id": "custom",
      "input_tokens": 10,
      "output_tokens": 20,
      "cache_read_tokens": 3,
      "cache_write_tokens": 4,
      "reasoning_tokens": 0,
      "total_tokens": 37,
      "cost_usd": 0.1235,
      "turn_index": 3,
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "package_version": "5.0.0-beta.5",
      "schema_version": 1,
      "$process_person_profile": false
    }
  }
]
```

Four synthetic `turn_end` inputs produced three captures. The fourth, non-assistant event produced no payload.

## Cleanup receipt

```text
CLEANUP: removed /tmp/omo-task8-manual-qa.ts
```

The throwaway executable script was removed after the manual run. No identity salt, hostname, or preview payload file was added to evidence.
