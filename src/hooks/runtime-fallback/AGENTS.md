# src/hooks/runtime-fallback/ — 响应式提供商错误恢复

**生成时间:** 2026-05-15

## 概述

32 个文件。会话层钩子，当 API 提供商在运行时返回错误（429、503、配额耗尽、冷却信号）时**响应式地**切换到备用模型。与 `model-fallback` 不同（后者在 chat.params 先发制人地应用）。

## RUNTIME-FALLBACK vs MODEL-FALLBACK

| 方面 | runtime-fallback | model-fallback |
|--------|-----------------|----------------|
| **触发方式** | 响应式 — 错误发生后 | 主动式 — 在请求时 |
| **事件** | session.error、message.updated、session.status | chat.params |
| **配置来源** | `categories[].fallback_models`、`agents[].fallback_models` | 硬编码的 `AGENT_MODEL_REQUIREMENTS` 链 |
| **状态** | 每会话 FallbackState + 冷却跟踪 | 模块全局 pendingModelFallbacks |
| **使用场景** | 执行期间提供商错误 | 预配置的 Agent 备用链 |

它们**独立**运行 — 没有直接集成。

## 错误检测

### HTTP 状态码（可配置）
默认重试码：`429, 500, 502, 503, 504`

### 错误消息模式（constants.ts）
```
/rate.?limit/i, /too.?many.?requests/i, /quota.*reset.*after/i,
/exhausted.*capacity/i, /all.*credentials.*for.*model/i,
/cool(?:ing)?.?down/i, /model.*not.*supported/i,
/service.?unavailable/i, /overloaded/i, /temporarily.?unavailable/i
```

### 错误类型分类（error-classifier.ts）
- `missing_api_key` — 提供商拒绝认证
- `model_not_found` — 模型不可用
- `quota_exceeded` — 计费/配额触达
- 通过 `auto-retry-signal.ts` 自动重试信号检测 — 提取"retrying in ~2 weeks" 样式的信号，触发立即降级

## 备用状态机

```typescript
interface FallbackState {
  originalModel: string
  currentModel: string
  fallbackIndex: number
  failedModels: Map<string, number>  // 模型 → 冷却截止时间戳
  attemptCount: number
  pendingFallbackModel?: string
}
```

## 备用链解析（fallback-models.ts）

优先级顺序：
1. **会话分类**（通过 SessionCategoryRegistry）
2. **Agent 配置** `fallback_models`
3. **Agent 的分类** `fallback_models`
4. **会话 ID 模式匹配**（从会话 ID 格式检测 Agent）

## 重试流程

```
session.error / message.updated（带错误）/ session.status（重试信号）
  → isRetryableError(error)?
  → getFallbackModelsForSession(sessionID, agent)
  → findNextAvailableFallback() — 跳过冷却中的模型
  → prepareFallback() — 更新状态，标记当前失败
  → dispatchFallbackRetry() — 提示通知 + 使用新模型的 promptAsync
  → 30 秒超时 — 如果超时则中止并尝试下一个
```

## 冷却机制

失败的模型进入 60 秒冷却。`findNextAvailableFallback()` 跳过冷却中的模型，防止在持续失败的模型上颠簸。

## 关键文件

| 文件 | 用途 |
|------|---------|
| `hook.ts` | `createRuntimeFallbackHook()` — 组合所有处理器 |
| `event-handler.ts` | 路由会话生命周期（created、error、stop、idle）|
| `message-update-handler.ts` | 处理 `message.updated` 中的错误部分 |
| `session-status-handler.ts` | 处理 session.status 中的提供商重试信号 |
| `chat-message-handler.ts` | 在 chat.message 上应用备用模型覆盖 |
| `error-classifier.ts` | `isRetryableError()`、`classifyErrorType()` |
| `auto-retry-signal.ts` | 提取 "retrying in..." 信号 |
| `fallback-state.ts` | 状态机：createFallbackState、prepareFallback、findNextAvailableFallback、isModelInCooldown |
| `fallback-models.ts` | 从配置层级解析链（字符串 + 原始对象）|
| `fallback-bootstrap-model.ts` | 状态缺失时推导初始模型 |
| `fallback-retry-dispatcher.ts` | 提示 + 分派重试编排 |
| `auto-retry.ts` | 中止、超时调度、清理 |
| `agent-resolver.ts` | 会话 → Agent 名称规范化 |
| `retry-model-payload.ts` | 构建模型有效载荷（providerID/modelID/variant/reasoningEffort）|
| `visible-assistant-response.ts` | 检测助手是否产生了真实输出而非仅错误 |
| `last-user-retry-parts.ts` | 提取最后一次用户消息部分用于重试 |

## 注意

- 冷却和失败跟踪是**每会话级别** — 并发会话不共享状态
- `visible-assistant-response.ts` 防止在助手已产生部分有效响应时重试
- Runtime-fallback 通过 `create-session-hooks.ts` 在会话层注册
