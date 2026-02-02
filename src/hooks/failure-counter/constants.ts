/**
 * Failure Counter Hook Constants
 *
 * Configuration defaults and failure detection patterns for
 * tracking consecutive delegate_task failures.
 */

import type { FailureCounterConfig } from "./types"

/**
 * Default configuration for the failure counter hook
 */
export const DEFAULT_FAILURE_COUNTER_CONFIG: FailureCounterConfig = {
  enabled: true,
  failure_window_ms: 5 * 60 * 1000, // 5 minutes
  reset_on_success: true,
  threshold_skill_injection: 1,
  threshold_oracle_dispatch: 2,
  threshold_block: 3,
}

/**
 * Tools that are monitored for failure detection
 */
export const MONITORED_TOOLS = [
  "delegate_task",
  "sisyphus_task",  // backward compat alias
  "task",
]

/**
 * Patterns that indicate a failure in tool output
 */
export const FAILURE_PATTERNS = [
  /❌/,
  /\bFAILED\b/i,
  /\bError:/i,
  /\bfailed\b/i,
  /\bexception\b/i,
  /\bBLOCKED\b/,
  /task failed/i,
  /execution failed/i,
  /could not complete/i,
  /unable to complete/i,
]

/**
 * Patterns that indicate success (used to reset counter)
 */
export const SUCCESS_PATTERNS = [
  /✅/,
  /\bSUCCESS\b/i,
  /\bcompleted successfully\b/i,
  /\btask completed\b/i,
  /\bDONE\b/,
]

/**
 * Skill to inject on first failure
 */
export const SYSTEMATIC_DEBUGGING_SKILL = "systematic-debugging"

/**
 * Messages for each failure threshold
 */
export const FAILURE_MESSAGES = {
  skill_injection: `⚠️ **第 1 次失败检测**

您的 delegate_task 调用失败了。已自动加载 \`systematic-debugging\` skill。

**请遵循系统化调试流程：**
1. 停止随机修复，先调查根本原因
2. 阅读错误信息，理解失败原因
3. 形成单一假设并最小化测试

如果继续失败，系统将自动咨询 Oracle。`,

  oracle_dispatch: `⚠️ **第 2 次连续失败**

已自动派发 Oracle 进行高级分析。

**Oracle 将帮助：**
- 分析失败模式
- 提供架构级建议
- 识别潜在的根本原因

如果第 3 次失败，delegate_task 将被阻止，需要用户介入。`,

  block: `🛑 **连续 3 次失败 - delegate_task 已阻止**

您已连续失败 3 次。为防止进一步的无效尝试，delegate_task 调用已被暂时阻止。

**请执行以下操作之一：**
1. 使用 \`/reset-failures\` 命令重置计数器
2. 手动分析问题并制定新策略
3. 向用户请求帮助或澄清

**不要继续盲目尝试。** 停下来，思考，制定新计划。`,
}
