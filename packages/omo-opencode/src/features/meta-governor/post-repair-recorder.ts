/**
 * Post-Repair Recorder for MetaGovernor — PR 7 of 9.
 *
 * After each recovery hook repairs an error, this module records the
 * outcome into agentmemory. This ensures the MetaGovernor learns from
 * recovery attempts across sessions.
 *
 * Architecture invariants:
 * - DI: AgentmemoryWriteBackend injected via function parameter.
 * - No-op when backend is null (graceful degradation).
 * - Bypasses observeAndLearn() to preserve custom severity/category.
 * - Success → leve deviation (low severity, lesson saved for pattern).
 * - Failure → grave deviation (high severity, lesson saved as bug).
 */

import type {
  AgentmemoryWriteBackend,
  ClosedLoopConfig,
  Decision,
  Deviation,
  LearnFromOutcomeOutput,
  LessonLearned,
  MemoryDecision,
} from "./types"

/** Local default closed-loop config so this PR is self-contained. */
function defaultClosedLoopConfig(): ClosedLoopConfig {
  return {
    enabled: true,
    minSeverityToLearn: "media",
    maxLessonsPerSession: 20,
    saveDecisions: true,
  }
}

/**
 * Outcome of a recovery hook repair attempt.
 */
export interface RecoveryOutcome {
  /** Error code or category (e.g. "TOOL_TIMEOUT", "JSON_PARSE_ERROR"). */
  readonly errorCode: string
  /** Recovery strategy used (e.g. "retry", "fallback", "compact"). */
  readonly fixStrategy: string
  /** Whether the repair succeeded. */
  readonly success: boolean
  /** Session ID where the repair happened. */
  readonly sessionID: string
  /** Directory context. */
  readonly directory: string
  /** Files changed during the repair, if any. */
  readonly filesChanged?: readonly string[]
  /** Additional context about the error. */
  readonly context?: string
}

/**
 * Build a Decision from a recovery outcome.
 *
 * Success → positive score, "continue" action.
 * Failure → negative score, "warn" action with escalation to oracle.
 */
function buildDecisionFromRecovery(outcome: RecoveryOutcome): Decision {
  const deviation: Deviation = {
    severity: outcome.success ? "leve" : "grave",
    category: `recovery:${outcome.fixStrategy}`,
    detail: `${outcome.errorCode}: ${outcome.context ?? "no context"}`,
  }

  return {
    action: outcome.success ? "continue" : "warn",
    score: outcome.success ? 0.5 : -0.5,
    reasoning: `Recovery ${outcome.success ? "succeeded" : "failed"}: ${outcome.fixStrategy} for ${outcome.errorCode}`,
    evidence: [
      {
        source: "deviation-detector",
        value: deviation.detail,
        confidence: 1,
        weight: outcome.success ? 0.3 : 0.8,
      },
    ],
    shouldEscalateTo: outcome.success ? null : "oracle",
  }
}

/** Severity ordering for threshold comparison. */
const SEVERITY_ORDER: Record<string, number> = {
  leve: 0,
  media: 1,
  grave: 2,
}

/**
 * Check if any deviation meets the severity threshold.
 */
function severityMeetsThreshold(
  deviations: readonly Deviation[],
  threshold: ClosedLoopConfig["minSeverityToLearn"],
): boolean {
  const minOrder = SEVERITY_ORDER[threshold] ?? 0
  return deviations.some((d) => (SEVERITY_ORDER[d.severity] ?? 0) >= minOrder)
}

/**
 * Record a recovery outcome to agentmemory.
 *
 * This bypasses observeAndLearn() to preserve custom severity and category
 * from the recovery outcome (observeAndLearn hardcodes severity: "media").
 *
 * When `writeBackend` is null, this is a silent no-op.
 */
export async function recordRecovery(
  outcome: RecoveryOutcome,
  writeBackend: AgentmemoryWriteBackend | null,
  options?: {
    config?: ClosedLoopConfig
  },
): Promise<LearnFromOutcomeOutput | null> {
  if (!writeBackend) {
    return null
  }

  const config = options?.config ?? defaultClosedLoopConfig()
  const decision = buildDecisionFromRecovery(outcome)

  // Config disabled → no-op
  if (!config.enabled) {
    return { lessonSaved: null, decisionSaved: null, reason: "closed-loop learning disabled" }
  }

  // Build deviations with custom severity/category (bypass observeAndLearn)
  const deviations: Deviation[] = [{
    severity: outcome.success ? "leve" : "grave",
    category: `recovery:${outcome.fixStrategy}`,
    detail: `${outcome.errorCode}: ${outcome.context ?? "no context"}`,
  }]

  let lessonSaved: LessonLearned | null = null
  let decisionSaved: MemoryDecision | null = null

  // Save decision record if enabled
  if (config.saveDecisions) {
    const decisionRecord: MemoryDecision = {
      id: `D-${Math.abs(`${outcome.sessionID}-${decision.action}-${Date.now()}`.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)).toString(36)}`,
      timestampISO: new Date().toISOString(),
      action: decision.action,
      score: decision.score,
      reasoning: decision.reasoning,
      sessionID: outcome.sessionID,
      directory: outcome.directory,
      deviations: deviations.map((d) => ({
        severity: d.severity,
        category: d.category,
        detail: d.detail,
      })),
    }

    try {
      await writeBackend.saveMemory({
        content: `Decision: ${decision.action} (score ${decision.score.toFixed(2)}). ${decision.reasoning}`,
        concepts: ["meta-governor", "decision", decision.action, ...deviations.map((d) => d.category)],
        type: "fact",
        files: [...(outcome.filesChanged ?? [])],
      })
      decisionSaved = decisionRecord
    } catch {
      // Backend failure is non-fatal — degrade silently
    }
  }

  // Save lesson if deviations meet severity threshold
  if (severityMeetsThreshold(deviations, config.minSeverityToLearn)) {
    const concepts = [...new Set(deviations.flatMap((d) => [d.category, d.severity]))]
    const deviationSummary = deviations
      .map((d) => `[${d.severity}] ${d.category}: ${d.detail}`)
      .join("; ")
    const content = `Action "${decision.action}" (score ${decision.score.toFixed(2)}) after deviations: ${deviationSummary}. Reasoning: ${decision.reasoning}`

    try {
      const result = await writeBackend.saveLesson({
        content,
        context: `session:${outcome.sessionID} dir:${outcome.directory}`,
        confidence: Math.max(0.3, Math.min(0.8, Math.abs(decision.score))),
        tags: concepts,
      })

      lessonSaved = {
        id: result.id,
        title: `${decision.action} after ${deviations[0]?.category ?? "recovery"}`,
        content,
        type: "pattern",
        concepts,
        confidence: Math.max(0.3, Math.min(0.8, Math.abs(decision.score))),
        files: [...(outcome.filesChanged ?? [])],
        sessionID: outcome.sessionID,
      }
    } catch {
      // Backend failure is non-fatal — degrade silently
    }
  }

  // Determine reason
  const reasons: string[] = []
  if (decisionSaved) reasons.push("decision saved")
  if (lessonSaved) {
    reasons.push("lesson saved")
  } else if (!severityMeetsThreshold(deviations, config.minSeverityToLearn)) {
    reasons.push("severity below threshold")
  }
  if (!decisionSaved && !lessonSaved && !reasons.length) {
    reasons.push("no saveable content")
  }

  return {
    lessonSaved,
    decisionSaved,
    reason: reasons.join("; ") || "no action taken",
  }
}

export { defaultClosedLoopConfig }
