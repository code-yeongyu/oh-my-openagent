/**
 * MetaGovernor Decision Handler — PR 6 of 8.
 *
 * Takes a ScoringResult from the scoring engine and dispatches to the
 * appropriate action: continue, warn, escalate, or stop. This is the
 * "executor" that translates scoring decisions into concrete outcomes.
 *
 * Architecture invariants:
 * - Pure dispatch: no I/O, no MCP calls, no side effects
 * - DI pattern: backends injected via DecisionHandlerConfig
 * - Audit trail: every decision + outcome recorded in DecisionHistory
 * - Configurable: all thresholds and behaviors overridable
 */

import type {
  Decision,
  DecisionHandlerConfig,
  DecisionHandlerInput,
  DecisionHandlerOutput,
  ScoringResult,
  Evidence,
  Deviation,
} from "./types"

// ─── Default config ────────────────────────────────────────────────

export const defaultDecisionHandlerConfig = (): DecisionHandlerConfig => ({
  enabled: true,
  maxHistoryPerSession: 50,
  forceContinueAfterStops: 3,
  warnMessageTemplate:
    "[MetaGovernor] Score {score}: {reasoning}. Evidence: {evidenceCount} signal(s).",
  escalateMessageTemplate:
    "[MetaGovernor] Escalating to {target}: {reasoning}",
  stopMessageTemplate:
    "[MetaGovernor] STOP — {reasoning}. Evidence: {evidenceCount} signal(s).",
})

// ─── Helpers ────────────────────────────────────────────────────────

function formatMessage(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value)
  }
  return result
}

function evidenceCount(evidence: readonly Evidence[]): number {
  return evidence.length
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Core decision handler. Takes a ScoringResult and dispatches to the
 * appropriate action. Pure function — no side effects.
 *
 * @param input - ScoringResult + session context
 * @param config - Handler configuration
 * @returns DecisionHandlerOutput with action taken + message + history entry
 */
export function handleDecision(
  input: DecisionHandlerInput,
  config?: Partial<DecisionHandlerConfig>,
): DecisionHandlerOutput {
  const resolvedConfig = { ...defaultDecisionHandlerConfig(), ...config }

  // Disabled = pass-through: always continue
  if (!resolvedConfig.enabled) {
    return {
      action: "continue",
      message: null,
      historyEntry: {
        decision: input.scoringResult.decision,
        action: "continue",
        timestampISO: new Date().toISOString(),
        sessionID: input.sessionID,
        reasoning: "Decision handler disabled — pass-through continue",
      },
    }
  }

  const decision = input.scoringResult.decision
  const score = decision.score
  const reasoning = decision.reasoning
  const evCount = evidenceCount(decision.evidence)
  const target = decision.shouldEscalateTo ?? resolvedConfig.defaultEscalationTarget ?? "oracle"

  // Paralysis override: force continue with warning
  if (input.scoringResult.paralysisOverride) {
    const message = formatMessage(
      resolvedConfig.warnMessageTemplate,
      {
        score: score.toFixed(3),
        reasoning: `Paralysis detected — forced continue. ${reasoning}`,
        evidenceCount: String(evCount),
      },
    )

    return {
      action: "continue",
      message,
      historyEntry: {
        decision,
        action: "continue",
        timestampISO: new Date().toISOString(),
        sessionID: input.sessionID,
        reasoning: `Paralysis override: ${reasoning}`,
      },
    }
  }

  // Dispatch by action
  switch (decision.action) {
    case "continue": {
      return {
        action: "continue",
        message: null,
        historyEntry: {
          decision,
          action: "continue",
          timestampISO: new Date().toISOString(),
          sessionID: input.sessionID,
          reasoning,
        },
      }
    }

    case "warn": {
      const message = formatMessage(
        resolvedConfig.warnMessageTemplate,
        {
          score: score.toFixed(3),
          reasoning,
          evidenceCount: String(evCount),
        },
      )

      return {
        action: "warn",
        message,
        historyEntry: {
          decision,
          action: "warn",
          timestampISO: new Date().toISOString(),
          sessionID: input.sessionID,
          reasoning,
        },
      }
    }

    case "escalate": {
      const message = formatMessage(
        resolvedConfig.escalateMessageTemplate,
        {
          target,
          reasoning,
        },
      )

      return {
        action: "escalate",
        message,
        historyEntry: {
          decision,
          action: "escalate",
          timestampISO: new Date().toISOString(),
          sessionID: input.sessionID,
          reasoning: `Escalate to ${target}: ${reasoning}`,
        },
      }
    }

    case "stop": {
      const message = formatMessage(
        resolvedConfig.stopMessageTemplate,
        {
          reasoning,
          evidenceCount: String(evCount),
        },
      )

      return {
        action: "stop",
        message,
        historyEntry: {
          decision,
          action: "stop",
          timestampISO: new Date().toISOString(),
          sessionID: input.sessionID,
          reasoning,
        },
      }
    }
  }
}

/**
 * Trim history to max size. Returns trimmed array + entries dropped count.
 */
export function trimHistory(
  history: readonly DecisionHandlerOutput["historyEntry"][],
  maxSize: number,
): { trimmed: DecisionHandlerOutput["historyEntry"][]; dropped: number } {
  if (history.length <= maxSize) {
    return { trimmed: [...history], dropped: 0 }
  }
  const dropped = history.length - maxSize
  return { trimmed: history.slice(-maxSize), dropped }
}

/**
 * Count consecutive stops in history (most recent first).
 */
export function countConsecutiveStops(
  history: readonly DecisionHandlerOutput["historyEntry"][],
): number {
  let count = 0
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.action === "stop") {
      count++
    } else {
      break
    }
  }
  return count
}
