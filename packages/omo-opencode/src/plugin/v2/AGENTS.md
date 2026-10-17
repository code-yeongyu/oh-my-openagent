# src/plugin/v2/ -- OpenCode V2 Host Bridge

**Added:** 2026-09-01 | dual-host entry for OpenCode V2 (`opencode2`, beta channel)

## OVERVIEW

Bridges the existing V1 plugin (the whole staged init pipeline in `src/testing/create-plugin-module.ts`) onto the OpenCode V2 plugin API so one published package serves both hosts:

- V1 (`opencode`) loads the dist default export as a `PluginModule` and calls `.server(input)`.
- V2 (`opencode2`) loads the same default export and calls `.setup(ctx)`. Verified live on beta-18721: the host ignores the extra `server` key. `Plugin.define` is identity at runtime, so no dependency on `@opencode-ai/plugin@beta` is taken; `types.ts` carries the structural host types instead.

## FLOW (runV2Setup)

```
setup(ctx)
  ├─ createCompatPluginInput(v2)          # V1 PluginInput shape over the V2 context
  │    └─ createV1CompatClient(v2)        # V1 SDK call surface over V2 session domain
  ├─ createPluginModule().server(input)  # existing init pipeline -> V1 Hooks
  ├─ hooks.config(syntheticConfig)       # replay 6-phase handler to harvest
  │    ├─ registerV2Agents               # agent map -> agent.transform (draft.update)
  │    ├─ registerV2McpServers            # mcp map -> mcp.transform (draft.set)
  │    └─ registerV2Commands              # command map -> command.transform (draft.add)
  ├─ tool.transform                      # hooks.tool record -> draft.add (zod -> JSON Schema)
  ├─ registerV2SessionHooks              # prompt/context/model.request -> chat.message/system.transform/chat.params/chat.headers
  ├─ registerV2ToolHooks                 # execute.before/after -> tool.execute.before/after
  ├─ bridgeV2EventStream                 # ctx.event.subscribe -> V1 event handler
  └─ cleanup: abort stream + dispose registrations + V1 dispose
```

## FILES

| File | Purpose |
|------|---------|
| `types.ts` | Structural V2 host types (plugin context, drafts, hooks, events). No runtime dep. |
| `compat-context.ts` | V2 ctx -> V1 `PluginInput` (directory/worktree/project/serverUrl/$ degradation) |
| `client-facade.ts` | V1 SDK client shape over V2 session API (`{data}` envelopes, path-style inputs) |
| `event-bridge.ts` | V2 event stream -> V1 `{type, properties}` events (`session.execution.failed` -> `session.error`) |
| `agent-bridge.ts` | V1 AgentConfig -> V2 Agent.Info (`prompt`->`system`, `temperature`->`request.settings`, `tools/permission`->`permissions`) |
| `tool-bridge.ts` | V1 ToolDefinition -> V2 tool (zod raw shape -> JSON Schema via `_zod.toJSONSchema` override + `sanitizeJsonSchema`; results -> `{content, metadata}`; context synthesis incl. abort/metadata/ask) |
| `mcp-bridge.ts` | V1 mcp config -> V2 ServerConfig (`enabled` -> `!disabled`, oauth field renames) |
| `command-bridge.ts` | V1 command templates -> V2 CommandDefinition (renders template, submits via `session.prompt`) |
| `session-hook-bridge.ts` | `prompt`/`context`/`model.request` hooks -> V1 handlers, mutations written back |
| `tool-hook-bridge.ts` | `execute.before`/`execute.after` -> V1 handlers, args/results round-trip |
| `degradations.ts` | Warn-once registry for V2-missing V1 surfaces |
| `v2-plugin.ts` | `runV2Setup` orchestration + `defineV2Plugin` |
| `entry.ts` | `./v2` subpath entry re-exporting the dual-host module |

## KEY FACTS (verified live, see `.omo/evidence/20260831-opencode-v2-dual-host/`)

- `AgentDraft` has NO `add` method; `draft.update(id, fn)` CREATES the agent when the id is missing (probe-verified: agent persisted across service restart).
- Code Mode: V2 exposes registered tools as `tools.<name>` Code Mode entries (via the one model-facing `execute` tool), NOT flat model-facing tool defs. Register with `options: { codemode: true }` or the tool never appears. A nested call `tools.background_cancel({...})` dispatched through our bridge end-to-end on beta-18721.
- zod->JSON Schema: use the `_zod.toJSONSchema` override attached by `normalizeToolArgSchemas` (the plugin package's zod instance); a different zod build's `z.toJSONSchema` hits `seen.ref` crashes.
- Tool results: V2 `Tool.Result` is `{ output?, content?: string | Content[], metadata? }`; V1 `{title, output}` maps `title` into `metadata`.

## KNOWN V2 GAPS (documented degradations)

- No `session.todo` API -> facade returns empty todos (boulder/todo-continuation degrade to no-ops).
- No server-side toast API (`tui.showToast` is a CLI-plugin surface) -> no-op.
- No `session.status`/`children` per-session endpoints -> approximated (idle / empty).
- `experimental.session.compacting` + `compaction.autocontinue` have no V2 hook surface -> not registered.
- `ctx.$` (bun shell) is absent -> notification runner falls back to `execFile` (already its tested behavior).

## ANTI-PATTERNS

- Never import `@opencode-ai/plugin@beta` (or `@opencode-ai/client`) at runtime: the host provides the context; structural types in `types.ts` keep us decoupled from beta churn. Drift is caught by the live QA gate, not the compiler.
- Never call the V2 domains outside `runV2Setup` staging; the V1 handlers must stay the single behavior source.
- Never register tools without `codemode: true` (invisible to Code Mode sessions).

## NOTES

- Root entry `src/index.ts` default-exports the dual-host module; `script/write-v2-shim.mjs` emits the `./v2` subpath as a thin re-export so the package has one full bundle, not two.
- Sandbox QA layout: plugins live in `<XDG_CONFIG_HOME>/opencode/plugins/<name>/` with a package-root `index.js` re-export plus the full `dist/` tree beside it (skills probe resolves `./skills/` relative to the bundle).
