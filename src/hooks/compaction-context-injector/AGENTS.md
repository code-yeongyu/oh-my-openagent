# src/hooks/compaction-context-injector/ -- 压缩后上下文恢复

**生成时间:** 2026-05-18

## 概述

延续层钩子。在 `session.compacted` 时触发，重新注入在上下文窗口压缩期间丢失的关键上下文。防止 Agent 在 OpenCode 裁剪会话历史后迷失方向。

## 层级 + 事件

- **层级：** 延续
- **事件：** `session.compacted`（主要）、`session.idle`、`session.deleted`、`message.updated`、`message.part.delta`、`message.part.updated`

## 关键文件

| 文件 | 用途 |
|------|---------|
| `hook.ts` | `createCompactionContextInjector()` — 组合捕获、恢复、注入、事件 |
| `recovery.ts` | `createRecoveryLogic()` — 压缩后重建 Agent/模型/工具 |
| `tail-monitor.ts` | 跟踪助手输出以检测无文本尾部 |
| `session-prompt-config-resolver.ts` | 遍历会话消息以解析当前 Agent/模型/工具 |
| `validated-model.ts` | `validateCheckpointModel()` — 模型验证 |
| `session-id.ts` | `resolveSessionID()`、`isCompactionAgent()` |
| `recovery-prompt-config.ts` | `createExpectedRecoveryPromptConfig()`、`isPromptConfigRecovered()` |
| `constants.ts` | `RECOVERY_COOLDOWN_MS`、`NO_TEXT_TAIL_THRESHOLD`、`RECENT_COMPACTION_WINDOW_MS` |
| `types.ts` | `CompactionContextInjector` 接口 |
| `compaction-context-prompt.ts` | `COMPACTION_CONTEXT_PROMPT` — 8 节摘要模板 |
| `index.ts` / `index.test.ts` | 桶导出 + 测试 |
| `recovery.test.ts` / `session-prompt-config-resolver.test.ts` | 单元测试 |

## 工作原理

1. **捕获：** 压缩前，通过 `setCompactionAgentConfigCheckpoint()` 保存 Agent/模型/工具检查点
2. **注入：** 返回带有活跃委托会话历史的 `COMPACTION_CONTEXT_PROMPT`
3. **恢复：** 在 `session.compacted` 时，分派内部提示以恢复已检查点的配置
4. **尾部监视器：** 检测连续的无文本输出助手消息；如果近期有压缩则触发恢复

## 集成

在 `create-continuation-hooks.ts` 中注册为 `compactionContextInjector`。

## 区别

- **`compactionTodoPreserver`：** 仅保留待办事项（同级延续钩子）
- **`anthropicContextWindowLimitRecovery`：** 先发制人地防止限制触达（会话层）
