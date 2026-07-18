/**
 * Closed-loop learning for MetaGovernor.
 *
 * PR 3 of 8. After every repair/action cycle, observeAndLearn() decides
 * whether to persist a lesson or decision record to agentmemory. Future
 * sessions retrieve these via aggregateRead() (PR 2) and factor them into
 * scoring (PR 5).
 *
 * Design:
 * - Pure function with DI backend (no side effects without backend).
 * - config.enabled=false → returns no-op with reason.
 * - Severity threshold: minSeverityToLearn filters what gets saved.
 * - Session cap: maxLessonsPerSession prevents flooding.
 * - Lessons go to agentmemory_memory_save (type: "pattern").
 * - Decisions go to agentmemory_memory_save (type: "fact").
 * - No file I/O, no MCP calls — just decision logic + DI write.
 */

import type {
  AgentmemoryWriteBackend,
  ClosedLoopConfig,
  Decision,
  Deviation,
  LearnFromOutcomeInput,
  LearnFromOutcomeOutput,
  LessonLearned,
  MemoryDecision,
  MemoryRead,
} from "./types"

/** Severity ordering for threshold comparison. */
const SEVERITY_ORDER: Record<string, number> = {
  leve: 0,
  media: 1,
  grave: 2,
}

/**
 * Generate a deterministic lesson ID from session + timestamp.
 */
function generateLessonId(sessionID: string, timestamp: string): string {
  const hash = `${sessionID}-${timestamp}`.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
  return `L-${Math.abs(hash).toString(36)}`
}

/**
 * Generate a deterministic decision ID from session + action + timestamp.
 */
function generateDecisionId(sessionID: string, action: string, timestamp: string): string {
  const hash = `${sessionID}-${action}-${timestamp}`.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
  return `D-${Math.abs(hash).toString(36)}`
}

/**
 * Check if the decision's severity meets the threshold.
 */
function severityMeetsThreshold(
  deviations: readonly Deviation[],
  threshold: ClosedLoopConfig["minSeverityToLearn"]
): boolean {
  const minOrder = SEVERITY_ORDER[threshold] ?? 0
  return deviations.some((d) => (SEVERITY_ORDER[d.severity] ?? 0) >= minOrder)
}

/**
 * Extract concepts from deviations for the lesson.
 */
function extractConcepts(deviations: readonly Deviation[]): string[] {
  const concepts = new Set<string>()
  for (const d of deviations) {
    concepts.add(d.category)
    concepts.add(d.severity)
  }
  return [...concepts]
}

/**
 * Build the lesson content string from a decision and its deviations.
 */
function buildLessonContent(decision: Decision, deviations: readonly Deviation[]): string {
  const deviationSummary = deviations
    .map((d) => `[${d.severity}] ${d.category}: ${d.detail}`)
    .join("; ")
  return `Action "${decision.action}" (score ${decision.score.toFixed(2)}) after deviations: ${deviationSummary}. Reasoning: ${decision.reasoning}`
}

/**
 * Core learning function. Decides whether to save a lesson and/or decision
 * to agentmemory based on the outcome of a repair/action cycle.
 *
 * Returns LearnFromOutcomeOutput describing what was saved (or why nothing was saved).
 */
export async function observeAndLearn(
  input: LearnFromOutcomeInput,
  backend: AgentmemoryWriteBackend
): Promise<LearnFromOutcomeOutput> {
  const { decision, config, sessionID, directory, filesChanged } = input
  const now = new Date().toISOString()

  // Config disabled → no-op
  if (!config.enabled) {
    return { lessonSaved: null, decisionSaved: null, reason: "closed-loop learning disabled" }
  }

  // No deviations → nothing to learn from
  if (decision.evidence.length === 0 && decision.action === "continue") {
    return { lessonSaved: null, decisionSaved: null, reason: "no deviations to learn from" }
  }

  let lessonSaved: LessonLearned | null = null
  let decisionSaved: MemoryDecision | null = null

  // Save decision record if enabled
  if (config.saveDecisions) {
    const decisionRecord: MemoryDecision = {
      id: generateDecisionId(sessionID, decision.action, now),
      timestampISO: now,
      action: decision.action,
      score: decision.score,
      reasoning: decision.reasoning,
      sessionID,
      directory,
      deviations: decision.evidence
        .filter((e) => e.source === "deviation-detector")
        .map((e) => ({
          severity: "media" as const,
          category: e.source,
          detail: e.value,
        })),
    }

    try {
      await backend.saveMemory({
        content: `Decision: ${decision.action} (score ${decision.score.toFixed(2)}). ${decision.reasoning}`,
        concepts: ["meta-governor", "decision", decision.action],
        type: "fact",
        files: [...filesChanged],
      })
      decisionSaved = decisionRecord
    } catch {
      // Backend failure is non-fatal — degrade silently
    }
  }

  // Save lesson if deviations meet severity threshold
  const deviationsFromEvidence = decision.evidence
    .filter((e) => e.source === "deviation-detector")
    .map<Deviation>((e) => ({
      severity: "media",
      category: e.source,
      detail: e.value,
    }))

  if (severityMeetsThreshold(deviationsFromEvidence, config.minSeverityToLearn)) {
    const concepts = extractConcepts(deviationsFromEvidence)
    const content = buildLessonContent(decision, deviationsFromEvidence)

    try {
      const result = await backend.saveLesson({
        content,
        context: `session:${sessionID} dir:${directory}`,
        confidence: Math.max(0.3, Math.min(0.8, Math.abs(decision.score))),
        tags: concepts,
      })

      lessonSaved = {
        id: result.id,
        title: `${decision.action} after ${deviationsFromEvidence[0]?.category ?? "deviation"}`,
        content,
        type: "pattern",
        concepts,
        confidence: Math.max(0.3, Math.min(0.8, Math.abs(decision.score))),
        files: [...filesChanged],
        sessionID,
      }
    } catch {
      // Backend failure is non-fatal — degrade silently
    }
  }

  // Determine reason
  const reasons: string[] = []
  if (decisionSaved) reasons.push("decision saved")
  if (lessonSaved) reasons.push("lesson saved")
  if (!decisionSaved && !lessonSaved) {
    if (!severityMeetsThreshold(deviationsFromEvidence, config.minSeverityToLearn)) {
      reasons.push("severity below threshold")
    } else {
      reasons.push("no saveable content")
    }
  }

  return {
    lessonSaved,
    decisionSaved,
    reason: reasons.join("; ") || "no action taken",
  }
}

/**
 * Helper: create a default ClosedLoopConfig.
 */
export function defaultClosedLoopConfig(): ClosedLoopConfig {
  return {
    enabled: true,
    minSeverityToLearn: "media",
    maxLessonsPerSession: 20,
    saveDecisions: true,
  }
}

export { SEVERITY_ORDER }
