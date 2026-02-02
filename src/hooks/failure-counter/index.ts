/**
 * Failure Counter Hook
 *
 * Tracks consecutive failures for delegate_task calls and triggers
 * automatic responses at each failure threshold:
 * - 1st failure: Inject systematic-debugging skill
 * - 2nd failure: Dispatch Oracle for consultation
 * - 3rd failure: Block delegate_task and require user intervention
 *
 * Per docs/SUBAGENTS-COMPARISON.md Task 9.2
 */

import type {
  FailureCounterConfig,
  FailureCounterState,
  FailureResponse,
  FailureTracker,
} from "./types"
import {
  DEFAULT_FAILURE_COUNTER_CONFIG,
  MONITORED_TOOLS,
  FAILURE_PATTERNS,
  SUCCESS_PATTERNS,
  SYSTEMATIC_DEBUGGING_SKILL,
  FAILURE_MESSAGES,
} from "./constants"

export interface FailureCounterHookContext {
  cwd: string
  log?: (message: string) => void
}

export interface FailureCounterHookOptions {
  config?: Partial<FailureCounterConfig>
}

/**
 * Check if tool output indicates a failure
 */
function isFailureOutput(output: string): boolean {
  return FAILURE_PATTERNS.some((pattern) => pattern.test(output))
}

/**
 * Check if tool output indicates a success
 */
function isSuccessOutput(output: string): boolean {
  return SUCCESS_PATTERNS.some((pattern) => pattern.test(output))
}

/**
 * Determine the appropriate response based on failure count
 */
function determineResponse(
  tracker: FailureTracker,
  config: FailureCounterConfig,
  state: FailureCounterState,
  sessionId: string
): FailureResponse {
  const { consecutiveFailures } = tracker

  // Check if blocked (3+ failures)
  if (consecutiveFailures >= config.threshold_block) {
    if (!state.blockedSessions.has(sessionId)) {
      state.blockedSessions.add(sessionId)
      return {
        type: "block",
        message: FAILURE_MESSAGES.block,
      }
    }
    // Already blocked, continue blocking
    return {
      type: "block",
      message: `🛑 delegate_task 仍处于阻止状态 (${consecutiveFailures} 次连续失败)。使用 \`/reset-failures\` 重置。`,
    }
  }

  // Check if Oracle dispatch needed (2 failures)
  if (consecutiveFailures >= config.threshold_oracle_dispatch) {
    if (!state.oracleDispatchedSessions.has(sessionId)) {
      state.oracleDispatchedSessions.add(sessionId)
      return {
        type: "dispatch_oracle",
        message: FAILURE_MESSAGES.oracle_dispatch,
      }
    }
  }

  // Check if skill injection needed (1 failure)
  if (consecutiveFailures >= config.threshold_skill_injection) {
    if (!state.skillInjectedSessions.has(sessionId)) {
      state.skillInjectedSessions.add(sessionId)
      return {
        type: "inject_skill",
        skillName: SYSTEMATIC_DEBUGGING_SKILL,
        message: FAILURE_MESSAGES.skill_injection,
      }
    }
  }

  return { type: "none" }
}

/**
 * Create the Failure Counter Hook
 */
export function createFailureCounterHook(
  _ctx: FailureCounterHookContext,
  options: FailureCounterHookOptions = {}
) {
  const config: FailureCounterConfig = {
    ...DEFAULT_FAILURE_COUNTER_CONFIG,
    ...options.config,
  }

  // Track state per session
  const state: FailureCounterState = {
    trackers: new Map(),
    skillInjectedSessions: new Set(),
    oracleDispatchedSessions: new Set(),
    blockedSessions: new Set(),
  }

  return {
    /**
     * PreToolUse: Block delegate_task if session is blocked
     */
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: {
        args: Record<string, unknown>
        blocked?: boolean
        message?: string
        messages?: Array<{ role: string; content: string }>
      }
    ): Promise<void> => {
      if (!config.enabled) {
        return
      }

      const toolLower = input.tool.toLowerCase()
      
      // Only monitor specific tools
      if (!MONITORED_TOOLS.some(t => toolLower.includes(t.toLowerCase()))) {
        return
      }

      // Check if session is blocked
      if (state.blockedSessions.has(input.sessionID)) {
        output.blocked = true
        output.message = `🛑 delegate_task 已被阻止，因为检测到连续 3 次失败。

**要解除阻止，请执行以下操作之一：**
1. 使用 \`/reset-failures\` 命令重置计数器
2. 分析之前的失败并制定新策略
3. 请求用户帮助

在解除阻止之前，请勿继续尝试。`
      }
    },

    /**
     * PostToolUse: Track failures and inject responses
     */
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: {
        args: Record<string, unknown>
        content?: string
        messages?: Array<{ role: string; content: string }>
      }
    ): Promise<void> => {
      if (!config.enabled) {
        return
      }

      const toolLower = input.tool.toLowerCase()
      
      // Only monitor specific tools
      if (!MONITORED_TOOLS.some(t => toolLower.includes(t.toLowerCase()))) {
        return
      }

      const outputContent = (output.content ?? "") as string
      const sessionId = input.sessionID

      // Check for success - reset counter
      if (isSuccessOutput(outputContent)) {
        if (config.reset_on_success) {
          state.trackers.delete(sessionId)
          state.skillInjectedSessions.delete(sessionId)
          state.oracleDispatchedSessions.delete(sessionId)
          state.blockedSessions.delete(sessionId)
        }
        return
      }

      // Check for failure
      if (!isFailureOutput(outputContent)) {
        return
      }

      // Get or create tracker
      let tracker = state.trackers.get(sessionId)
      if (!tracker) {
        tracker = {
          taskId: input.callID,
          consecutiveFailures: 0,
        }
        state.trackers.set(sessionId, tracker)
      }

      // Check if within time window
      const now = Date.now()
      if (
        tracker.lastFailureTimestamp &&
        now - tracker.lastFailureTimestamp > config.failure_window_ms
      ) {
        // Outside window, reset
        tracker.consecutiveFailures = 0
        state.skillInjectedSessions.delete(sessionId)
        state.oracleDispatchedSessions.delete(sessionId)
        state.blockedSessions.delete(sessionId)
      }

      // Increment failure count
      tracker.consecutiveFailures++
      tracker.lastError = outputContent.slice(0, 500)
      tracker.lastFailureTimestamp = now

      // Determine and apply response
      const response = determineResponse(tracker, config, state, sessionId)

      if (response.type === "none") {
        return
      }

      output.messages = output.messages || []

      switch (response.type) {
        case "inject_skill":
          output.messages.push({
            role: "system",
            content: `[FAILURE COUNTER - AUTO-INJECTED]

${response.message}

---

**自动加载的 Skill: ${response.skillName}**

请立即调用 \`skill("${response.skillName}")\` 工具加载系统化调试指南。`,
          })
          break

        case "dispatch_oracle":
          output.messages.push({
            role: "system",
            content: `[FAILURE COUNTER - ORACLE DISPATCH]

${response.message}

---

**建议操作：**
\`\`\`
delegate_task(
  agent="oracle",
  prompt="我在执行任务时遇到了连续失败。请分析以下错误并提供解决策略：\\n\\n${tracker.lastError?.replace(/"/g, '\\"').slice(0, 200)}..."
)
\`\`\``,
          })
          break

        case "block":
          output.messages.push({
            role: "system",
            content: `[FAILURE COUNTER - BLOCKED]

${response.message}`,
          })
          break
      }
    },

    /**
     * UserPromptSubmit: Handle /reset-failures command
     */
    UserPromptSubmit: async (
      input: { sessionID: string; prompt: string },
      output: {
        blocked?: boolean
        message?: string
        messages?: Array<{ role: string; content: string }>
      }
    ): Promise<void> => {
      if (!config.enabled) {
        return
      }

      const prompt = input.prompt.trim().toLowerCase()
      
      if (prompt === "/reset-failures" || prompt === "/reset-failure") {
        const sessionId = input.sessionID
        const tracker = state.trackers.get(sessionId)
        const wasBlocked = state.blockedSessions.has(sessionId)
        const previousCount = tracker?.consecutiveFailures ?? 0

        // Reset all state for this session
        state.trackers.delete(sessionId)
        state.skillInjectedSessions.delete(sessionId)
        state.oracleDispatchedSessions.delete(sessionId)
        state.blockedSessions.delete(sessionId)

        output.messages = output.messages || []
        output.messages.push({
          role: "system",
          content: `✅ **失败计数器已重置**

${wasBlocked ? "🔓 delegate_task 阻止已解除。" : ""}
${previousCount > 0 ? `之前的连续失败次数: ${previousCount}` : "没有记录的失败。"}

您现在可以继续使用 delegate_task。请确保在继续之前：
1. 分析了之前失败的原因
2. 制定了新的解决策略
3. 准备好了更具体的任务描述`,
        })

        // Block the original prompt from being processed
        output.blocked = true
        output.message = "失败计数器已重置。"
      }
    },
  }
}

export type { FailureCounterConfig } from "./types"
