# src/tools/call-omo-agent/ — 直接 Agent 调用工具

**生成时间:** 2026-05-15

## 概述

23 个文件。`call_omo_agent` 工具 — 直接调用命名 Agent（仅 explore、librarian）。与 `delegate-task` 不同：没有分类系统、不加载技能、不进行模型选择。固定的 Agent 集合，相同的执行模式（后台/同步）。

## 与 delegate-task 的区别

| 方面 | `call_omo_agent` | `delegate-task`（`task`）|
|--------|-----------------|--------------------------|
| Agent 选择 | 命名 Agent（explore/librarian）| 分类或 subagent_type |
| 技能加载 | 无 | 支持 `load_skills[]` |
| 模型选择 | 来自 Agent 的降级链 | 来自分类配置 |
| 使用场景 | 快速上下文搜索 | 带技能的完整委派 |

## 允许的 Agent

仅 `explore` 和 `librarian` — 通过 `constants.ts` 中的 `ALLOWED_AGENTS` 常量强制。不区分大小写验证。

## 执行模式

与 delegate-task 相同的两种模式：

| 模式 | 文件 | 描述 |
|------|------|-------------|
| **后台** | `background-agent-executor.ts` | 通过 `BackgroundManager` 异步执行 |
| **同步** | `sync-executor.ts` | 创建会话 → 等待空闲 → 返回结果 |

## 关键文件

| 文件 | 用途 |
|------|---------|
| `tools.ts` | `createCallOmoAgent()` 工厂 — 验证 Agent，路由到执行器 |
| `background-executor.ts` | 根据 `run_in_background` 路由到后台或同步 |
| `background-agent-executor.ts` | 通过 `BackgroundManager.launch()` 发起 |
| `sync-executor.ts` | 同步会话：创建 → 发送提示 → 轮询 → 获取结果 |
| `session-creator.ts` | 为同步执行创建 OpenCode 会话 |
| `subagent-session-creator.ts` | 使用 Agent 特定配置创建会话 |
| `subagent-session-prompter.ts` | 将提示注入会话 |
| `completion-poller.ts` | 轮询直到会话空闲 |
| `session-completion-poller.ts` | 会话特定的完成检查 |
| `session-message-output-extractor.ts` | 提取最后一条助手消息作为结果 |
| `message-processor.ts` | 处理原始消息内容 |
| `message-dir.ts` + `message-storage-directory.ts` | 消息交换的临时存储 |
| `types.ts` | `CallOmoAgentArgs`、`AllowedAgentType`、`ToolContextWithMetadata` |

## 会话延续

传入 `session_id` 可恢复现有会话而非创建新会话 — 在两个执行器中均已处理。
