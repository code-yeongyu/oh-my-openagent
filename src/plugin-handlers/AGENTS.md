# src/plugin-handlers/ — 6-Phase Config Loading Pipeline

**Generated:** 2026-03-06

## OVERVIEW

13 non-test files implementing the `ConfigHandler` — the `config` hook handler. Executes 6 sequential phases to register agents, tools, MCPs, and commands with OpenCode.

## 6-PHASE PIPELINE

| Phase | Handler                | Purpose                                                     |
| ----- | ---------------------- | ----------------------------------------------------------- |
| 1     | `applyProviderConfig`  | Cache model context limits, detect anthropic-beta headers   |
| 2     | `loadPluginComponents` | Discover Claude Code plugins (10s timeout, error isolation) |
| 3     | `applyAgentConfig`     | Load agents from 5 sources, skill discovery, plan demotion  |
| 4     | `applyToolConfig`      | Agent-specific tool permissions                             |
| 5     | `applyMcpConfig`       | Merge builtin + CC + plugin MCPs                            |
| 6     | `applyCommandConfig`   | Merge commands/skills from 9 parallel sources               |

## FILES

| File                                 | Lines | Purpose                                        |
| ------------------------------------ | ----- | ---------------------------------------------- |
| `config-handler.ts`                  | ~200  | Main orchestrator, 6-phase sequential          |
| `plugin-components-loader.ts`        | ~100  | CC plugin discovery (10s timeout)              |
| `agent-config-handler.ts`            | ~300  | Agent loading + skill discovery from 5 sources |
| `mcp-config-handler.ts`              | ~150  | Builtin + CC + plugin MCP merge                |
| `command-config-handler.ts`          | ~200  | 9 parallel sources for commands/skills         |
| `tool-config-handler.ts`             | ~100  | Agent-specific tool grants/denials             |
| `provider-config-handler.ts`         | ~80   | Provider config + model cache                  |
| `prometheus-agent-config-builder.ts` | ~100  | Prometheus config with model resolution        |
| `plan-model-inheritance.ts`          | 28    | Plan demotion logic                            |
| `agent-priority-order.ts`            | ~30   | sisyphus, hephaestus, prometheus, atlas first  |
| `agent-key-remapper.ts`              | ~30   | Agent key → display name                       |
| `category-config-resolver.ts`        | ~40   | User vs default category lookup                |
| `index.ts`                           | ~10   | Barrel exports                                 |

## TOOL PERMISSIONS

| Agent                       | Granted                  | Denied                             |
| --------------------------- | ------------------------ | ---------------------------------- |
| Librarian                   | grep*app*\*              | —                                  |
| Atlas, Sisyphus, Prometheus | task, task\_\*, teammate | —                                  |
| Hephaestus                  | task                     | —                                  |
| Default (all others)        | —                        | grep*app*_, task\__, teammate, LSP |

## MULTI-LEVEL CONFIG MERGE

```
User (~/.config/opencode/oh-my-openagent.jsonc or legacy ~/.config/opencode/oh-my-opencode.jsonc)
  ↓ deepMerge
Project (.opencode/oh-my-openagent.jsonc or legacy .opencode/oh-my-opencode.jsonc)
  ↓ Zod defaults
Final Config
```

- Per-directory precedence: canonical `oh-my-openagent` files win over legacy `oh-my-opencode` files, and `.jsonc` wins over `.json`

- `agents`, `categories`, `claude_code`: deep merged
- `disabled_*` arrays: Set union
