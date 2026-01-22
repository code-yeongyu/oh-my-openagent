# 智能供应商故障切换 (Smart Provider Failover)

## 1. 简介
在多模型协作环境下，API 供应商经常会遇到 **429 (频率限制)**、**余额不足** 或 **订阅配额耗尽** 的情况。
Smart Failover 系统为 `oh-my-opencode` 引入了一套自动化的故障检测与恢复机制。它能确保在主模型不可用时，系统瞬间接管请求并切换到备用模型，实现“永不掉线”的 AI 助手体验。

## 2. 核心特性
- **管道符配置 (`|`)**: 极简的备选链定义方式。
- **数组配置（string[]）**: 与管道符等价，更易维护。
- **秒级无感切换**: 自动强行终止 OpenCode 原生的卡顿重试循环，秒切备用线路。
- **错误诊断（Best-Effort）**: 主要通过模式匹配识别常见失败原因（限流、配额、余额等）。
- **安全防护栏**: 
  - **上下文窗口对齐**: 自动跳过窗口过小的备用模型。
  - **PROBATION 恢复**: 冷却结束后模型进入 PROBATION，可再次被选用；会话进入 idle 后清理回健康状态。
  - **内存管理**: 随会话销毁自动清理缓存，无内存泄露风险。

## 3. 使用方法
Smart Failover 默认启用（除非你显式禁用 `smart-failover` hook）。只需要通过 `model` 定义“主模型 + 备用模型链”即可使用。

### 3.1 模型备用链写法
支持两种等价写法：

- **管道符写法**（string）
- **数组写法**（string[]）

两者语义一致：第一个是主模型，后续是备用模型。

### 3.2 Hook 开关
如需禁用，可在 `oh-my-opencode.json` 中把 `smart-failover` 加入 `disabled_hooks`。

### 示例配置
```jsonc
{
  "model": "openai/gpt-5.2-codex | google/gemini-3-pro"
}
```

### 数组示例
```jsonc
{
  "model": ["openai/gpt-5.2-codex", "google/gemini-3-pro"]
}
```

`model` 也可以写在单个 agent（例如 `agents.Sisyphus.model`）或 category 配置里，上述两种写法同样支持。

## 4. 默认行为说明
- **触发条件**：检测到 retry loop（`session.status: retry`）或部分会话错误（`session.error`）后，会把当前 `provider/model` 标记为不可用，并切换到下一个可用的备用模型。
- **冷却与退避**：retry loop 的冷却时间固定为 5 分钟；会话错误触发的冷却会按失败次数做指数退避。
- **锁定**：余额不足/配额耗尽等信号会锁定特定的 `provider/model` 组合（modelKey），直到重置。
- **fallback 选择**：只会选择 HEALTHY/PROBATION 的模型；上下文窗口过小的 fallback 会被跳过。

## 5. 限制说明
- **Retry-After**：事件里不一定能拿到响应头，因此基于 header 的冷却时间属于 best-effort。
- **PROBATION**：当前以会话进入 idle 作为“恢复健康”的近似信号，并非专门的 health-check 请求闭环。

## 6. 故障状态说明
- **HEALTHY (健康)**: 正常使用。
- **COOLING (冷却中)**: 触发 429 或 5xx 错误，根据指数退避算法进入等待期。
- **LOCKED (锁定)**: 触发余额不足或配额耗尽，除非重启或修改配置，否则不再尝试。
- **PROBATION (试用期)**: 冷却结束后可再次被选用；会话进入 idle 后清理回健康状态。

## 7. UI 交互
- **故障提示**: 切换时会弹出黄色 Toast，内容如 `⚠️ Switched to google/gemini-3-pro`。
- **静默机制**: 每个会话仅提示一次，后续切换保持静默，不干扰工作。
