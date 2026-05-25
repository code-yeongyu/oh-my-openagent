# src/openclaw/ — 双向外部集成

**生成时间:** 2026-05-15

## 概述

18 个文件。双向集成系统：**出站**会话事件通知（Discord/Telegram/HTTP webhook/shell 命令）和**入站**回复处理（守护进程轮询聊天应用，将回复注入回 tmux 会话）。命名为"claw"（爪子），因为它从 OpenCode 伸出并拉回回复。

## 双向流程

### 出站（OpenCode → 外部）
```
OpenCode 会话事件 → dispatchOpenClawEvent()
  → runtime-dispatch.ts：将事件映射到 OpenClaw 事件
  → dispatcher.ts：执行网关（HTTP POST 或 shell 命令）
  → session-registry.ts：记录消息 ID ↔ sessionID ↔ tmux 窗格
```

### 入站（外部 → OpenCode）
```
Discord/Telegram API → 回复监听守护进程（独立的 Bun 进程）
  → reply-listener-{discord,telegram}.ts：每 3 秒轮询
  → session-registry.ts：从消息 ID 查找目标 tmux 会话
  → reply-listener-injection.ts：向 tmux 窗格发送按键（速率受限）
```

## 关键文件

| 文件 | 用途 |
|------|---------|
| `index.ts` | `wakeOpenClaw()`、`initializeOpenClaw()` — 主入口 |
| `types.ts` | `OpenClawConfig`、`OpenClawPayload`、`WakeResult` 类型 |
| `config.ts` | 网关解析 + URL 验证（需要 HTTPS，localhost 除外）|
| `dispatcher.ts` | HTTP POST + shell 命令执行，含变量插值 |
| `runtime-dispatch.ts` | 将 OpenCode 事件映射到 OpenClaw 事件，编排分发 |
| `session-registry.ts` | JSONL 注册表，关联消息 ID ↔ 会话 ↔ 窗格（文件锁保护）|
| `reply-listener.ts` | 守护进程生命周期：启动/停止、轮询循环、状态持久化 |
| `reply-listener-discord.ts` | Discord API 轮询 |
| `reply-listener-telegram.ts` | Telegram API 轮询 |
| `reply-listener-injection.ts` | 将接收到的回复注入 tmux 窗格（速率限制 + 用户过滤）|
| `reply-listener-state.ts` | 守护进程状态：PID、配置签名、轮询跟踪 |
| `daemon.ts` | 守护进程入口点（作为分离的 Bun 进程运行）|
| `tmux.ts` | `capturePane()`、`sendToPane()` 工具函数 |

## 网关类型

| 类型 | 配置 | 执行 |
|------|--------|-----------|
| **HTTP webhook** | `url` 字段 | 使用 JSON 负载的 POST |
| **Shell 命令** | `command` 字段 | 使用环境变量执行（OPENCLAW_*）|

## 负载变量（插值）

`{sessionId}`、`{projectPath}`、`{tmuxSession}`、`{timestamp}`、`{eventType}`（session.created/deleted/idle）、`{messageContent}`、`{promptSummary}`

## 集成点

- `src/index.ts` — 在插件启动时调用 `initializeOpenClaw(pluginConfig.openclaw)`（如果 `enabled`）
- `src/plugin/event.ts` — 调用 `dispatchOpenClawEvent()` for session.created/deleted/idle
- `src/config/schema/openclaw.ts` — Zod config schema

## DAEMON LIFECYCLE

```
initializeOpenClaw(config)
  → wakeOpenClaw() if reply_listener.enabled
  → spawn daemon.ts as detached process
  → daemon writes PID to .opencode/openclaw.state.json
  → daemon polls Discord/Telegram every 3s
  → on reply: lookup in session-registry → inject into tmux via send-keys
```

## SECURITY

- **URL validation**: HTTPS required except localhost (config.ts)
- **Authorized users**: Inbound replies filtered by allowed user ID list
- **Token redaction**: Secrets masked in logs and error messages
- **Rate limiting**: Reply injection throttled per pane
