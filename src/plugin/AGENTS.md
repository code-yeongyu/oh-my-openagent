# src/plugin/ — 12 OpenCode Hook Handlers + Hook Composition

**Generated:** 2026-06-08

## OVERVIEW

Core glue layer. Files assemble the 12 OpenCode hook handlers wired into `PluginInterface` here (an additional 2, `experimental.session.compacting` + `experimental.compaction.autocontinue`, are wired in `src/testing/create-plugin-module.ts`). Each handler file maps to one OpenCode hook type.

## HANDLER FILES

| File | OpenCode Hook | Purpose |
|------|---------------|---------|
| `config.ts` | `config` | 6-phase config loading pipeline (delegates to `plugin-handlers/`) |
| `tool-registry.ts` | `tool` | 20–39 tools assembled with config gates (team-mode +12, task system +4, hashline +1, interactive_bash +1, look_at +1) |
| `tool-definition.ts` | `tool.definition` | Per-tool definition transform (applies todo-description-override) |
| `chat-message.ts` | `chat.message` | First-message variant resolution, session setup, keyword detection trigger |
| `chat-params.ts` | `chat.params` | Anthropic effort, think mode, runtime fallback model override |
| `chat-headers.ts` | `chat.headers` | Copilot `x-initiator` header injection |
| `command-execute-before.ts` | `command.execute.before` | Pre-command guards (slash-command interception, etc.) |
| `event.ts` | `event` | Session lifecycle (created/deleted/idle/error/status), openclaw dispatch, runtime fallback, 4 team-session-event handlers (when team_mode.enabled) |
| `tool-execute-before.ts` | `tool.execute.before` | Pre-tool guards |
| `tool-execute-after.ts` | `tool.execute.after` | Post-tool hooks (truncation, comment-checker, hashline read tagging, json-error-recovery) |
| `messages-transform.ts` | `experimental.chat.messages.transform` | Context injection, thinking-block validation, tool-pair validation, keyword detection |
| `system-transform.ts` | `experimental.chat.system.transform` | System-message-level transforms |
| `session-compacting.ts` | `experimental.session.compacting` | Context + todo preservation across compaction (registered via `create-plugin-module.ts`) |
| `skill-context.ts` | (helper) | Skill/browser/category context shared with tool creation |
| `build-team-idle-wake-hint-client.ts` | (helper) | Build the team idle-wake-hint client wired into event handlers |

## HOOK COMPOSITION (hooks/ subdir)

| File | Tier | Count |
|------|------|-------|
| `create-session-hooks.ts` | Session | 24 |
| `create-tool-guard-hooks.ts` | Tool Guard | 17 |
| `create-transform-hooks.ts` | Transform | 5 |
| `create-skill-hooks.ts` | Skill | 2 |
| `create-core-hooks.ts` | Aggregator | Session + Guard + Transform = 46 |

`createContinuationHooks()` (7) lives in `src/create-hooks.ts` next to `createCoreHooks()` and `createSkillHooks()`.

## SUPPORT FILES

| File | Purpose |
|------|---------|
| `available-categories.ts` | Build `AvailableCategory[]` for agent prompt injection |
| `session-agent-resolver.ts` | Resolve which agent owns a session |
| `session-status-normalizer.ts` | Normalize session status across OpenCode versions |
| `recent-synthetic-idles.ts` | Dedup rapid synthetic idle events |
| `unstable-agent-babysitter.ts` | Track unstable agent behavior across sessions |
| `types.ts` | `PluginContext`, `PluginInterface`, `ToolsRecord`, `TmuxConfig` |
| `ultrawork-model-override.ts` | Ultrawork mode model override logic |
| `ultrawork-db-model-override.ts` | DB-level model override for ultrawork |
| `config-handler.ts` | Runtime config loading and caching |
| `normalize-tool-arg-schemas.ts` | Coerce tool arg schemas into a normalized shape |

## TOOL REGISTRATION GATES

```typescript
// src/plugin/tool-registry.ts
const taskToolsRecord = isTaskSystemEnabled(config) ? { task_create, task_get, task_list, task_update } : {}
const hashlineToolsRecord = config.hashline_edit ? { edit: createHashlineEditTool(ctx) } : {}
const teamModeToolsRecord = config.team_mode?.enabled ? { team_create, team_delete, team_shutdown_request, team_approve_shutdown, team_reject_shutdown, team_send_message, team_task_create, team_task_list, team_task_update, team_task_get, team_status, team_list } : {}
const lookAt = isMultimodalLookerEnabled ? { look_at: createLookAt(ctx) } : {}
const interactiveBashTool = interactiveBashEnabled ? { interactive_bash } : {}

const allTools = {
  ...createGrepTools(ctx),
  ...createGlobTools(ctx),
  ...createSessionManagerTools(ctx),
  ...backgroundTools,                 // 2 background_*
  call_omo_agent, task,
  ...lookAt,
  skill_mcp, skill,
  ...interactiveBashTool,
  ...teamModeToolsRecord,             // +12 conditional
  ...taskToolsRecord,                 // +4 conditional
  ...hashlineToolsRecord,             // +1 conditional
}

// lsp_* and ast_grep_* tools are supplied by built-in MCP servers "lsp" and "ast_grep"
```

## KEY PATTERNS

- Each handler exports a function receiving `(hookRecord, ctx, pluginConfig, managers)` → returns the OpenCode hook function.
- Handlers iterate over hook records, calling each hook with `(input, output)` in registration order.
- `safeHook()` wrapper isolates hook errors so one broken hook does not crash the chain.
- `filterDisabledTools(allTools, disabled_tools)` prunes tools listed in `disabled_tools` config.
- `experimental.max_tools` cap trims tool count when set (selects the highest-priority tools).
