/**
 * Phase Rollback - 动态阶段回溯机制
 *
 * 自动提取验证失败的具体原因，根据失败原因重组任务。
 */

export type TaskPhase = "planning" | "implementation" | "review" | "verification"

export interface FailureReason {
  phase: TaskPhase
  reason: string
  timestamp: Date
  taskId?: string
}

export interface RollbackHistory {
  from: TaskPhase
  to: TaskPhase
  reason: string
  timestamp: Date
}

export interface PhaseRollbackConfig {
  maxHistorySize: number
}

const DEFAULT_CONFIG: PhaseRollbackConfig = {
  maxHistorySize: 20,
}

export interface PhaseRollback {
  extractFailureReason(errorMessage: string): FailureReason
  suggestRollbackPhase(failure: FailureReason): TaskPhase
  rollbackTo(targetPhase: TaskPhase, reason: string): RollbackHistory
  getHistory(): RollbackHistory[]
  clearHistory(): void
}

/**
 * Creates a phase rollback manager.
 */
export function createPhaseRollback(
  currentPhase: TaskPhase,
  config: Partial<PhaseRollbackConfig> = {}
): PhaseRollback {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }
  let phase = currentPhase
  const history: RollbackHistory[] = []

  function extractFailureReason(errorMessage: string): FailureReason {
    const lowerMessage = errorMessage.toLowerCase()

    // Detect phase from error message
    let detectedPhase: TaskPhase = phase

    if (
      lowerMessage.includes("type error") ||
      lowerMessage.includes("compile") ||
      lowerMessage.includes("build failed")
    ) {
      detectedPhase = "implementation"
    } else if (
      lowerMessage.includes("test failed") ||
      lowerMessage.includes("assertion") ||
      lowerMessage.includes("expect")
    ) {
      detectedPhase = "verification"
    } else if (
      lowerMessage.includes("design") ||
      lowerMessage.includes("architecture") ||
      lowerMessage.includes("requirement")
    ) {
      detectedPhase = "planning"
    } else if (
      lowerMessage.includes("review") ||
      lowerMessage.includes("lint") ||
      lowerMessage.includes("code quality")
    ) {
      detectedPhase = "review"
    }

    return {
      phase: detectedPhase,
      reason: errorMessage,
      timestamp: new Date(),
    }
  }

  function suggestRollbackPhase(failure: FailureReason): TaskPhase {
    // Suggest rolling back to one phase before the failure
    const phaseOrder: TaskPhase[] = ["planning", "implementation", "review", "verification"]
    const failureIndex = phaseOrder.indexOf(failure.phase)

    if (failureIndex <= 0) {
      return "planning"
    }

    return phaseOrder[failureIndex - 1]
  }

  function rollbackTo(targetPhase: TaskPhase, reason: string): RollbackHistory {
    const rollback: RollbackHistory = {
      from: phase,
      to: targetPhase,
      reason,
      timestamp: new Date(),
    }

    history.push(rollback)

    // Trim history if exceeds max size
    while (history.length > mergedConfig.maxHistorySize) {
      history.shift()
    }

    phase = targetPhase

    return rollback
  }

  function getHistory(): RollbackHistory[] {
    return [...history]
  }

  function clearHistory(): void {
    history.length = 0
  }

  return {
    extractFailureReason,
    suggestRollbackPhase,
    rollbackTo,
    getHistory,
    clearHistory,
  }
}
