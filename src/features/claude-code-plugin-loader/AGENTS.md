# src/features/claude-code-plugin-loader/ — 统一 Claude Code 插件加载器

**生成时间:** 2026-05-15

## 概述

16 个文件。完整的 Claude Code 插件兼容层。从 `.opencode/plugins/` 和 `~/.claude/plugins/` 发现并加载所有插件组件（命令、Agent、技能、钩子、MCP 服务器、LSP 服务器）。

## 为什么存在

Claude Code 插件将命令/Agent/技能作为单独的文件发布，并附带 `plugin.json` 清单。OmO 使用此加载器将它们引入自己的注册表，因此现有的 Claude Code 插件在 OmO 下无需修改即可工作。

## 加载管道

```
loadAllPluginComponents(ctx)
  → discoverPlugins()                  # 扫描 .opencode/plugins + ~/.claude/plugins
  → readPluginManifest(plugin.json)    # 解析 name/version/commands/agents/skills/hooks/mcpServers
  → loadPluginCommands()
  → loadPluginAgents()
  → loadPluginSkills()
  → loadPluginHooks()                  # 注册钩子处理器
  → loadPluginMcpServers()             # 送入 mcp-config-handler（Tier 2）
  → loadPluginLspServers()
  → return LoadedPluginBundle
```

在配置处理器的第 2 阶段从 `src/plugin-handlers/plugin-components-loader.ts` 调用（10 秒超时，带错误隔离 — 一个损坏的插件不会拖垮整个插件加载）。

## 关键文件

| 文件 | 用途 |
|------|------|
| `index.ts` | 桶导出：`loadAllPluginComponents`、`PluginManifest`、`ClaudeSettings` 类型 |
| `plugin-discovery.ts` | 跨作用域查找插件目录 |
| `plugin-manifest-parser.ts` | 用 Zod 验证解析 `plugin.json` |
| `command-loader.ts` | 从 `commands/` 或 `COMMANDS.md` 加载命令 |
| `agent-loader.ts` | 从 `agents/` 或 `AGENTS.md` frontmatter 加载 Agent |
| `skill-loader.ts` | 从 `skills/` 或 `SKILL.md` 加载技能 |
| `hook-loader.ts` | 从 `hooks/` 或清单加载钩子配置 |
| `mcp-loader.ts` | 提取 MCP 服务器配置 |
| `lsp-loader.ts` | 提取 LSP 服务器配置 |
| `settings-loader.ts` | 解析 Claude Code `settings.json` |

## 插件清单 (plugin.json)

```jsonc
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "...",
  "commands": ["./commands"],       // 或字符串路径数组
  "agents": ["./agents"],
  "skills": ["./skills"],
  "hooks": "./hooks/config.json",
  "mcpServers": "./.mcp.json",
  "lspServers": "./lsp"
}
```

## 作用域

| 作用域 | 路径 | 优先级 |
|--------|------|--------|
| `project` | `.opencode/plugins/` | 最高 |
| `local` | `~/.opencode/plugins/` | 中等 |
| `user` | `~/.claude/plugins/` | 中等 |
| `managed` | 内置 | 最低 |

## 错误隔离

每个插件隔离加载。 — if one fails (bad manifest, missing file, syntax error), others still load. Errors surface as warnings in `bunx oh-my-opencode doctor`.

## RELATED

- Phase 2 loader: `src/plugin-handlers/plugin-components-loader.ts`
- Tier 2 MCP integration: `src/features/claude-code-mcp-loader/`
- Claude Code compat hooks: `src/hooks/claude-code-hooks/`
