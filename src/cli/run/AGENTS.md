# src/cli/run/ — 非交互式会话启动器

**生成时间:** 2026-05-15

## 概述

37 个文件。驱动 `oh-my-opencode run <message>` 命令。连接到 OpenCode 服务器、创建/恢复会话、流式传输事件并轮询完成。

## 执行流程

```
runner.ts
  1. opencode-binary-resolver.ts → 查找 OpenCode 二进制文件
  2. server-connection.ts → 连接到 OpenCode 服务器（如果需要则启动）
  3. agent-resolver.ts → 标志 → 环境变量 → 配置 → Sisyphus
  4. session-resolver.ts → 创建新会话或恢复现有会话
  5. events.ts → 从会话流式传输 SSE 事件
  6. event-handlers.ts → 处理每种事件类型
  7. poll-for-completion.ts → 等待待办事项 + 后台任务完成
  8. on-complete-hook.ts → 执行用户定义的完成钩子
```

## 关键文件

| 文件 | 用途 |
|------|---------|
| `runner.ts` | 主编排 — 连接、解析、运行、完成 |
| `server-connection.ts` | 启动 OpenCode 服务器进程，创建 SDK 客户端 |
| `agent-resolver.ts` | 解析 Agent：`--agent` 标志 → `OPENCODE_AGENT` 环境变量 → 配置 → Sisyphus |
| `session-resolver.ts` | 创建新会话或通过 `--attach` / `--session-id` 恢复 |
| `events.ts` | SSE 事件流订阅 |
| `event-handlers.ts` | 将事件路由到处理器（message、tool、error、idle）|
| `event-stream-processor.ts` | 通过过滤和缓冲处理事件流 |
| `poll-for-completion.ts` | 轮询会话直到待办完成 + 无后台任务 |
| `completion.ts` | 判断会话是否真正完成 |
| `continuation-state.ts` | 在跨调用中持久化 `run` 延续的状态 |
| `output-renderer.ts` | 格式化终端会话输出 |
| `json-output.ts` | JSON 输出模式（`--json` 标志）|
| `types.ts` | `RunOptions`、`RunResult`、`RunContext`、事件负载类型 |

## Agent 解析优先级

```
1. --agent CLI 标志
2. OPENCODE_AGENT 环境变量
3. default_run_agent 配置
4. "sisyphus"（默认）
```

## 完成检测

基于轮询的两个条件：
1. 所有待办事项标记为已完成（无 pending/in_progress）
2. 无正在运行的后台任务

`on-complete-hook.ts` 在完成时执行可选的用户命令（例如 `--on-complete "notify-send done"`）。
