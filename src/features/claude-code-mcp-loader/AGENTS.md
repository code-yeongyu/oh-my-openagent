# src/features/claude-code-mcp-loader/ — Tier 2 MCP 加载器 (.mcp.json)

**生成时间:** 2026-05-15

## 概述

11 个文件。从项目/用户作用域加载 `.mcp.json` 文件，并展开 `${VAR}` 环境变量。在配置加载的第 5 阶段将 Tier 2 送入 3 层 MCP 系统的 `mcp-config-handler.ts`。

## 为什么存在

Claude Code 生态通过带有 `${VAR}` 环境变量占位符的 `.mcp.json` 文件提供 MCP。OmO 直接使用这些文件，因此现有的 Claude Code MCP 配置无需修改即可工作。

## 加载管道

```
loadMcpConfigs(ctx)
  → scope-filter.ts: 在项目 + 用户作用域发现 .mcp.json
  → loader.ts: 解析 JSON
  → env-expander.ts: 用 process.env[VAR] 替换 ${VAR}
  → transformer.ts: 将 Claude Code 格式映射为 OpenCode McpLocal / McpRemote 形状
  → return LoadedMcpServer[]
```

## MCP 格式

```jsonc
// .mcp.json
{
  "mcpServers": {
    "my-stdio": {
      "type": "stdio",
      "command": "node",
      "args": ["server.js"],
      "env": {
        "API_KEY": "${MY_API_KEY}"
      }
    },
    "my-http": {
      "type": "http",       // "sse" 旧版 → 映射为 http
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${MY_TOKEN}"
      }
    }
  }
}
```

## 关键文件

| 文件 | 用途 |
|------|------|
| `index.ts` | 桶导出：`loadMcpConfigs`、类型 |
| `loader.ts` | `loadMcpConfigs()` 主入口 |
| `types.ts` | `ClaudeCodeMcpServer`、`LoadedMcpServer`、`McpScope` |
| `env-expander.ts` | `expandEnvVarsInObject()` — 递归 `${VAR}` 替换 |
| `transformer.ts` | Claude Code 格式 → OpenCode `Mcp` 形状 |
| `scope-filter.ts` | 项目与用户作用域的优先级 |

## 三层 MCP 上下文

| 层级 | 加载器 | 作用域 |
|------|--------|--------|
| 1. 内置 | `src/mcp/` `createBuiltinMcps()` | 全局，3 个远程 HTTP MCP + 本地 stdio `lsp` |
| 2. **Claude Code** | **此模块** | **来自 `.mcp.json`，项目 + 用户** |
| 3. 技能嵌入 | `src/features/skill-mcp-manager/` | 每会话，来自 SKILL.md YAML |

## 安全性

- **环境变量允许列表**：`mcp_env_allowlist` 配置限制哪些环境变量可以被展开
- **不执行 shell**：`${VAR}` 只是字符串替换，不是 shell `$()`
- **密钥编辑**：`env-cleaner.ts`（在 skill-mcp-manager 中）从日志中过滤已知的密钥模式

## 相关

- 第 5 阶段集成：`src/plugin-handlers/mcp-config-handler.ts`
- 技能嵌入 MCP（Tier 3）：`src/features/skill-mcp-manager/`
- 内置 MCP（Tier 1）：`src/mcp/`
