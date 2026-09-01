# Task 9 evidence: skill, delegation, and feature usage telemetry

## Scope

Implemented only:

- `packages/omo-senpi/src/components/telemetry/omo-native-tools.ts`
- `packages/omo-senpi/src/components/telemetry/omo-native-tools.test.ts`

The evidence file is required by the work plan. Concurrent wave files visible in the worktree were not staged or edited.

## RED

Command:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && set -o pipefail; bun test packages/omo-senpi/src/components/telemetry/omo-native-tools.test.ts 2>&1 | tee /tmp/omo-native-tools-red.txt
```

Real stdout:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/omo-native-tools.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './omo-native-tools' from '/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/src/components/telemetry/omo-native-tools.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [91.00ms]
```

The failure was the expected missing production module after writing the test first.

## GREEN

Focused command:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun test packages/omo-senpi/src/components/telemetry/omo-native-tools.test.ts
```

Result:

```text
8 pass
0 fail
12 expect() calls
Ran 8 tests across 1 file. [1.52s]
```

Test-count delta attributable to task 9: 0 passing focused tests at RED, 8 passing focused tests at GREEN.

Required telemetry suite command:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun test packages/omo-senpi/src/components/telemetry
```

Result:

```text
39 pass
0 fail
121 expect() calls
Ran 39 tests across 6 files. [1114.00ms]
```

Required typecheck command:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun run --cwd packages/omo-senpi typecheck
```

Result:

```text
$ tsgo --noEmit -p tsconfig.json
```

Exit code: 0.

## Acceptance and adversarial probes

The focused test suite proves:

- Builtin `debugging` and `ulw-plan` `SKILL.md` paths emit exact allowlisted names.
- An outside `notes/ulw-plan/SKILL.md` path emits zero events.
- A non-builtin skill under the actual skills-root shape emits zero events.
- Lexical traversal `<skills-root>/../../etc/passwd` emits zero events.
- A symlinked builtin-named directory resolving outside the skills root emits zero events.
- A prompt-injection-style directory name `ulw-plan\"},\"feature\":\"goal_tool` is never echoed because it is not in `BUILTIN_SKILL_NAMES`.
- `path: null` emits zero events and does not throw.
- Missing `input` emits no event, does not throw, and records exactly one diagnostic.
- A background batch of 3 inherited `deep` category items emits 3 events, each bucketed `2_4`.
- `subagent_type: explore` emits `kind: subagent, name: explore`.
- An unknown category emits `name: custom`.
- `create_goal`, `team_create`, and `memory`/`memory_apply_patch` deduplicate independently per session.
- Session shutdown clears only that session's dedup state.
- Emitted event-property key sets exactly equal `OMO_NATIVE_PROPERTY_ALLOWLISTS.skill_loaded`, `.delegation_started`, and `.feature_used`.

The skill path check uses `realpathSync` on both root and target followed by `path.relative` boundary validation. It does not use substring matching, so traversal and symlink escapes fail closed.

## Manual QA

Throwaway script content written to `/tmp/omo-native-tools-qa.ts`:

```ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createEventTelemetryClient } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/telemetry-core/src/events.ts"
import { FakeExtensionAPI } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/test-support/fake-extension-api.ts"
import { createTransportRecorder } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/src/components/telemetry/telemetry.test-support.ts"
import { createOmoNativeProductConfig, OMO_NATIVE_PROPERTY_ALLOWLISTS } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/src/components/telemetry/product-identity.ts"
import { registerOmoNativeToolTelemetry } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/src/components/telemetry/omo-native-tools.ts"

const skillsRoot = "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry/packages/omo-senpi/plugin/skills"
const customDir = join(skillsRoot, ".qa-custom-skill")
mkdirSync(customDir)
writeFileSync(join(customDir, "SKILL.md"), "# custom\n")
const recorder = createTransportRecorder()
const client = createEventTelemetryClient({
  distinctId: "qa-machine",
  env: { POSTHOG_API_KEY: "qa-key" },
  product: createOmoNativeProductConfig(),
  propertyAllowlist: OMO_NATIVE_PROPERTY_ALLOWLISTS,
  schemaVersion: 1,
  source: "task-9-manual-qa",
  transportFactory: recorder.factory,
})
const pi = new FakeExtensionAPI()
registerOmoNativeToolTelemetry(pi, {
  captureEvent: client.captureEvent,
  hashSessionId: (id) => `qa:${id}`,
  skillsRoot,
})
const ctx = { sessionManager: { getSessionId: () => "qa-session" } }
const payload = (toolName: string, input: Record<string, unknown>) => ({
  type: "tool_result", toolCallId: toolName, toolName, input, content: [], isError: false, details: undefined,
})
try {
  await pi.dispatch("tool_result", payload("read", { path: join(skillsRoot, "debugging", "SKILL.md") }), ctx)
  const beforeCustom = recorder.messages.length
  await pi.dispatch("tool_result", payload("read", { path: join(customDir, "SKILL.md") }), ctx)
  console.log(`custom_skill_event_delta=${recorder.messages.length - beforeCustom}`)
  await pi.dispatch("tool_result", payload("task", {
    category: "deep", run_in_background: true,
    tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }],
  }), ctx)
  await pi.dispatch("tool_result", payload("create_goal", { objective: "qa" }), ctx)
  await pi.dispatch("tool_result", payload("create_goal", { objective: "qa again" }), ctx)
  console.log(JSON.stringify(recorder.messages, null, 2))
} finally {
  rmSync(customDir, { recursive: true, force: true })
  await client.shutdown()
}
```

Literal execution command:

```sh
cd /Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/omo-native-telemetry && bun /tmp/omo-native-tools-qa.ts
```

Real stdout:

```text
custom_skill_event_delta=0
[
  {
    "distinctId": "qa-machine",
    "event": "skill_loaded",
    "properties": {
      "$session_id": "qa:qa-session",
      "skill_name": "debugging",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "package_version": "5.0.0-beta.5",
      "schema_version": 1,
      "$process_person_profile": false
    }
  },
  {
    "distinctId": "qa-machine",
    "event": "delegation_started",
    "properties": {
      "$session_id": "qa:qa-session",
      "kind": "category",
      "name": "deep",
      "background": true,
      "batch_size_bucket": "2_4",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "package_version": "5.0.0-beta.5",
      "schema_version": 1,
      "$process_person_profile": false
    }
  },
  {
    "distinctId": "qa-machine",
    "event": "delegation_started",
    "properties": {
      "$session_id": "qa:qa-session",
      "kind": "category",
      "name": "deep",
      "background": true,
      "batch_size_bucket": "2_4",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "package_version": "5.0.0-beta.5",
      "schema_version": 1,
      "$process_person_profile": false
    }
  },
  {
    "distinctId": "qa-machine",
    "event": "delegation_started",
    "properties": {
      "$session_id": "qa:qa-session",
      "kind": "category",
      "name": "deep",
      "background": true,
      "batch_size_bucket": "2_4",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "package_version": "5.0.0-beta.5",
      "schema_version": 1,
      "$process_person_profile": false
    }
  },
  {
    "distinctId": "qa-machine",
    "event": "feature_used",
    "properties": {
      "$session_id": "qa:qa-session",
      "feature": "goal_tool",
      "platform": "omo-senpi",
      "product_name": "omo-native",
      "package_version": "5.0.0-beta.5",
      "schema_version": 1,
      "$process_person_profile": false
    }
  }
]
```

The second `create_goal` generated no second `feature_used` event. The custom skill generated no event, shown by `custom_skill_event_delta=0`.

## Cleanup receipt

```text
cleanup_script=removed
cleanup_custom_dir=removed
```

No process, port, temporary custom skill, or QA script remains.
