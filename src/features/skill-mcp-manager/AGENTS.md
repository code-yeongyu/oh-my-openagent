# src/features/skill-mcp-manager/ — 技能嵌入的 MCP 客户端生命周期管理

**生成时间:** 2026-05-15

## 概述

18 个文件。管理 MCP 系统的**第 3 层**：在 SKILL.md YAML frontmatter 中声明的技能嵌入 MCP 服务器。每会话客户端隔离、双传输（stdio + HTTP）、OAuth 2.0 升级认证、空闲清理。

## 三层 MCP 上下文

| 层级 | 管理器 | 作用域 |
|------|---------|-------|
| 1. 内置 | `createBuiltinMcps()`（src/mcp/）| 全局，3 个远程 HTTP + 1 个本地 stdio（`lsp`）|
| 2. Claude Code | `claude-code-mcp-loader`（src/features/）| 来自 `.mcp.json` |
| 3. **技能嵌入** | **`SkillMcpManager`（本模块）** | **每会话，来自 SKILL.md YAML** |

## 客户端键格式

```
${sessionID}:${skillName}:${serverName}
```

实现：每会话隔离，同一技能可在多个会话中同时使用，每个技能可配置多个服务器。

## 双传输

| 类型 | 文件 | 后端 |
|------|------|---------|
| **stdio** | `stdio-client.ts` | `StdioClientTransport`（本地进程）|
| **http** | `http-client.ts` | `StreamableHTTPClientTransport`（远程）|

**检测**（connection-type.ts）：显式 `type` 字段 → URL 存在 → 命令存在。旧版 `"sse"` 映射为 http。

## 状态

```typescript
interface SkillMcpManagerState {
  clients: Map<clientKey, ManagedClient>              // 活跃连接
  pendingConnections: Map<clientKey, Promise<Client>> // 防竞态
  disconnectedSessions: Map<sessionID, generation>    // 过期连接检测
  authProviders: Map<url, OAuthProvider>              // 每服务器的 OAuth 状态
  inFlightConnections: Map<sessionID, count>          // 连接计数
}
```

## 关键文件

| 文件 | 用途 |
|------|---------|
| `manager.ts` | `SkillMcpManager` 类 — 主 API（getOrCreateClient、disconnectSession、listTools、callTool 等）|
| `types.ts` | `ManagedStdioClient`、`ManagedHttpClient`、`SkillMcpManagerState`、`ConnectionType` |
| `connection.ts` | 客户端工厂，含防竞态、重试、环境变量展开 |
| `connection-type.ts` | 从配置检测 stdio 还是 http（旧版 sse → http）|
| `stdio-client.ts` | Stdio 传输工厂 |
| `http-client.ts` | HTTP 传输工厂 |
| `cleanup.ts` | SIGINT/SIGTERM 处理器，空闲定时器（60 秒间隔，5 分钟 TTL）|
| `oauth-handler.ts` | OAuth 令牌管理、刷新、升级（403 作用域提升）|
| `env-cleaner.ts` | 过滤 npm/pnpm/yarn 配置 + 25 种以上密钥模式（_KEY、_SECRET、_TOKEN）|
| `error-redaction.ts` | 日志记录前从错误信息中擦除敏感数据 |

## 生命周期集成

**钩子**：`src/plugin/event.ts` 在 `session.deleted`:
```typescript
await managers.skillMcpManager.disconnectSession(sessionInfo.id)
```

## 生命周期流程

```
1. session.created      → 无操作（懒连接）
2. 首次 MCP 工具调用   → getOrCreateClient() 创建并缓存
3. 持续使用            → 更新 lastUsedAt 时间戳
4. 空闲 >5 分钟        → 清理定时器移除
5. session.deleted     → disconnectSession() 关闭会话客户端
6. 进程退出            → 通过 SIGINT/SIGTERM 处理器执行 disconnectAll()
```

## 竞态条件预防

- **pendingConnections**：对同一键的并发连接尝试进行去重
- **inFlightConnections**：每会话计数器，防止在连接建立期间过早清理
- **shutdownGeneration**：基于计数器的断开后过期连接检测

## 公共 API

```typescript
class SkillMcpManager {
  constructor(options?: { createOAuthProvider? })
  getOrCreateClient(info, config): Promise<Client>
  disconnectSession(sessionID): Promise<void>
  disconnectAll(): Promise<void>
  listTools/Resources/Prompts(info, context): Promise<...[]>
  callTool(info, context, name, args): Promise<unknown>
  readResource(info, context, uri): Promise<unknown>
  getPrompt(info, context, name, args): Promise<unknown>
  getConnectedServers(): string[]
  isConnected(info): boolean
}
```

## 重试语义

- `getOrCreateClientWithRetry()` — 失败时最多 3 次尝试并强制重连
- `withOperationRetry()` — 感知 OAuth 的包装器：403 时升级认证，401 时刷新令牌

## 安全性

- **env-cleaner.ts** — 在 stdio 孵化前剥离 npm/pnpm 配置变量（防止 pnpm 项目隔离问题）和密钥模式
- **error-redaction.ts** — 在记录到日志前掩盖错误消息中的令牌/机密
- **OAuth 隔离** — 身份提供者按服务器 URL 键控，令牌永不跨服务器
