# extension

Senpi ExtensionAPI composition layer: validates the host surface, registers components in a fixed order, and owns the shared cross-component seams. Component prose and registration-order rationale live in `../../AGENTS.md`; this file covers what exists only here.

## Anatomy

| Path | Purpose |
|------|---------|
| `types.ts` | Structural host ports: `SenpiExtensionAPI`, `ComponentContext`, `ComponentLogger`, `OmoSenpiComponent`. The sanctioned description of the host surface; components import these, never concrete senpi types. Optional members (`rpc`, `events`, `cwd`, `appendEntry`, `registerMcpServer`, ...) stay optional so older hosts still load. |
| `compose.ts` | `composeOmoSenpiExtension` - the activation sequence: provision toolkit PATH + `OMO_DAG_SDK_ROOT` BEFORE any component registers; capability mismatch logs one warning and disables the extension (never throws); registers the global `omo-senpi-disabled` flag plus one `omo-senpi-<name>-disabled` flag per component; installs the capture registry and idle coordinator before the component loop; each `register` is individually try/caught so one failing component never blocks the rest. |
| `component-list.ts` | `createOmoSenpiComponents(taskComponent)`: the 18-component registration array; the task component is injected by the entry file. Order is load-bearing (documented in `../../AGENTS.md`). |
| `index.ts` | Source/dev entry: composes with the eager `createTaskComponent()` and default-exports the extension. |
| `bundled-index.ts` | Built-artifact entry: swaps in a lazy task shim that `await import("#omo-task-runtime")`; the alias is created by `plugin/scripts/build-extension.mjs`. |
| `idle-injection-coordinator.ts` | Shared idle-edge arbiter: components enqueue key-deduped, source-tagged injections; one flush per idle tick emits a single hidden `omo-senpi:wake` message wrapping all pending custom payloads. Production defers via a 200 ms `setTimeout` batch window (injectable `scheduleFlush` for tests) so notifications becoming ready together collapse into ONE steer injection. |
| `tool-capture-registry.ts` | Wraps `pi.registerTool` to capture full ToolDefinitions WITH live execute closures (`pi.getAllTools()` returns metadata without closures - Momus fix). Must wrap before any component registers; lsp registers earlier than task. |
| `tool-hook-status.ts` | `reportToolHookStatus(eventContext, message)` - shared "(OmO) Checking ..." tool-hook status reporting; silently no-ops without the host method. |
| `dag-sdk-root-provisioning.ts` | Publishes `OMO_DAG_SDK_ROOT` pointing at the packaged `../runtime/dag` (source-tree `plugin/runtime/dag` fallback) so dag eval cells can import the SDK. |
| `toolkit-path-provisioning.ts` | Prepends `OMO_AGENT_TOOLKIT_BIN` / PATH for the packaged `../runtime/agent-toolkit` so component spawns resolve it without global bins. |
| `omo-task.ts` | Re-export shim for `createTaskComponent` (build-graph entry). |

## Conventions

- Components reach the shared seams only through the injected `ComponentContext` (`logger`, `config.getFlag`, `getCapturedTools`, `idleCoordinator`) - never module singletons.
- New cross-component seams are added here, not duplicated inside components.
- `session-start-ordering.test.ts` pins registration order; `dag-sdk.test.ts` / `toolkit-path-provisioning.test.ts` pin the env provisioning seams.

## Anti-patterns

- Don't import `@code-yeongyu/senpi` runtime values from components; type-only through `types.ts` ports (bundle purity depends on it).
- Don't add an eager task-engine import to `bundled-index.ts`; the built artifact lazy-loads `#omo-task-runtime` deliberately.
- Don't register components outside `component-list.ts`, and don't reorder it without checking inter-component dependencies.
