# src/features/claude-code-agent-loader/ -- Claude Code Agent 兼容层

**生成时间:** 2026-05-18

## 概述

与 `claude-code-mcp-loader` 并列。从 `.opencode/agents/`、`~/.claude/agents/` 和内联的 `opencode.json` 配置加载 Claude Code Agent 定义，然后将它们转换为 OpenCode `AgentConfig`。12 个文件。

## 加载管道

```
loadUserAgents() / loadProjectAgents() / loadOpencodeGlobalAgents() / loadOpencodeProjectAgents()
  -> loader.ts：在 agents/ 目录中发现 .md 文件
  -> agent-definitions-loader.ts：解析 YAML frontmatter + 正文，从显式路径加载
  -> json-agent-loader.ts：解析 .json / .jsonc Agent 定义
  -> opencode-config-agents-reader.ts：从 opencode.json 读取内联 agents
  -> claude-model-mapper.ts：将 "sonnet" / "opus" / "haiku" 转换为 OpenCode provider/model ID
  -> 返回 Record<string, ClaudeCodeAgentConfig>
```

## 关键文件

| 文件 | 用途 |
|------|------|
| `index.ts` | 桶：所有导出 |
| `loader.ts` | `loadUserAgents()`、`loadProjectAgents()`、`loadOpencode*Agents()` 主入口 |
| `agent-definitions-loader.ts` | `parseMarkdownAgentFile()`、`loadAgentDefinitions()` |
| `json-agent-loader.ts` | `parseJsonAgentFile()` — JSON/JSONC Agent 定义 |
| `claude-model-mapper.ts` | Claude 别名 -> OpenCode `providerID/modelID` |
| `opencode-config-agents-reader.ts` | 从 `opencode.json` 读取内联 `agents` 和 `agent_definitions` |
| `types.ts` | `ClaudeCodeAgentConfig`、`AgentScope`、`LoadedAgent` |

## 集成

配置加载的第 3 阶段（`src/plugin-handlers/agent-config-handler.ts`）调用此加载器，在插件接口构建之前填充 Agent 注册表。

## 配套加载器

- **`claude-code-plugin-loader`**：完整插件，包含命令、技能、钩子、MCP
- **`claude-code-mcp-loader`**：来自 `.mcp.json` 的 Tier 2 MCP

## 相关

- 第 3 阶段集成：`src/plugin-handlers/agent-config-handler.ts`
- 插件加载器：`src/features/claude-code-plugin-loader/`
- MCP 加载器：`src/features/claude-code-mcp-loader/`
