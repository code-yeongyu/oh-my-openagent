# src/plugin/ — 8 OpenCode Hook Handlers + Hook Composition

**Generated:** 2026-03-06

## OVERVIEW

Core glue layer. 20 source files assembling the 8 OpenCode hook handlers and composing 48 hooks into the PluginInterface. Every handler file corresponds to one OpenCode hook type.

## HANDLER FILES

| File | OpenCode Hook | Purpose |
|------|---------------|---------|
| `chat-message.ts` | `chat.message` | First-message variant, session setup, keyword detection |
| `chat-params.ts` | `chat.params` | Anthropic effort level, think mode |
| `event.ts` | `event` | Session lifecycle (created, deleted, idle, error) |
| `tool-execute-before.ts` | `tool.execute.before` | Pre-tool guards (file guard, label truncator, rules injector) |
| `tool-execute-after.ts` | `tool.execute.after` | Post-tool hooks (output truncation, comment checker, metadata) |
| `messages-transform.ts` | `experimental.chat.messages.transform` | Context injection, thinking block validation |
| `tool-registry.ts` | `tool` | 26 tools assembled from factories |
| `chat-headers.ts` | `chat.headers` | Copilot x-initiator header injection |
| `skill-context.ts` | — | Skill/browser/category context for tool creation |

## HOOK COMPOSITION (hooks/ subdir)

| File | Tier | Count |
|------|------|-------|
| `create-session-hooks.ts` | Session | 23 |
| `create-tool-guard-hooks.ts` | Tool Guard | 12 |
| `create-skill-hooks.ts` | Skill | 2 |
| `create-core-hooks.ts` | Aggregator | Session + Guard + Transform = 37 |

## SUPPORT FILES

| File | Purpose |
|------|---------|
| `available-categories.ts` | Build `AvailableCategory[]` for agent prompt injection |
| `session-agent-resolver.ts` | Resolve which agent owns a session |
| `session-status-normalizer.ts` | Normalize session status across OpenCode versions |
| `recent-synthetic-idles.ts` | Dedup rapid idle events |
| `unstable-agent-babysitter.ts` | Track unstable agent behavior across sessions |
| `types.ts` | `PluginContext`, `PluginInterface`, `ToolsRecord`, `TmuxConfig` |
| `ultrawork-model-override.ts` | Ultrawork mode model override logic |
| `ultrawork-db-model-override.ts` | DB-level model override for ultrawork |
| `config-handler.ts` | Runtime config loading and caching |

## KEY PATTERNS

- Each handler exports a function receiving `(hookRecord, ctx, pluginConfig, managers)` → returns OpenCode hook function
- Handlers iterate over hook records, calling each hook with `(input, output)` in sequence
- `safeHook()` wrapper in composition files catches errors per-hook without breaking the chain
- Tool registry uses `filterDisabledTools()` before returning
