import type { ReasoningCoreClient, ReasoningCoreKbAddEntry } from "./reasoning-core-client"
import { matchesExactLearnedInsight, replaceLearnedPattern } from "./kb-replacement-helper"
import type { PolicyVerdict } from "./types"
import { log } from "../../shared/logger"

const MINIMUM_CONTENT_LENGTH = 20
const KB_WRITER_TAG = "prometheus-plan-generation"

export async function writeAllowedPlanPattern(input: {
  client: ReasoningCoreClient
  verdict: PolicyVerdict
  planName: string
  sessionID: string
}): Promise<void> {
  const { client, verdict, planName, sessionID } = input

  try {
    const pattern = extractPattern(verdict, planName)
    if (!pattern) {
      log("[plan-kb-writer] Skipped: pattern did not pass quality gate", { sessionID, planName })
      return
    }

    const entry: ReasoningCoreKbAddEntry = {
      layer: "Learned",
      content: {
        Insight: {
          problem_type: "prometheus_plan_generation",
          lesson: pattern.lesson,
          example: pattern.example,
        },
      },
      tags: [KB_WRITER_TAG, "planning", `plan:${planName}`],
    }

    await replaceLearnedPattern({
      client,
      newEntry: entry,
      query: {
        content_type: "insight",
        layer: "Learned",
        keyword: "prometheus_plan_generation",
        similarity_query: pattern.lesson,
        tags: [KB_WRITER_TAG, "planning", `plan:${planName}`],
      },
      isDuplicate: matchesExactLearnedInsight,
    })

    log("[plan-kb-writer] Saved planning pattern to KB", { sessionID, planName })
  } catch (error) {
    log("[plan-kb-writer] KB write failed (non-blocking)", {
      sessionID,
      planName,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function extractPattern(verdict: PolicyVerdict, planName: string): { lesson: string; example: string } | null {
  if (!verdict.proofArtifact || typeof verdict.proofArtifact !== "object") return null

  const artifact = verdict.proofArtifact as Record<string, unknown>
  if ("fallbackAllow" in artifact) return null

  const outcome = artifact.outcome as Record<string, unknown> | undefined
  const kbResult = artifact.kbResult as Record<string, unknown> | undefined

  const stopSignal = typeof outcome?.stop_signal === "string" ? outcome.stop_signal : "unknown"
  const priorPatternCount = typeof kbResult?.count === "number" ? kbResult.count : 0

  const lesson = `Plan "${planName}" passed all six prerequisites (research_completed, user_intent_clear, scope_bounded, codebase_explored, no_blocking_questions, dependencies_identified) with stop_signal=${stopSignal} and ${priorPatternCount} prior KB patterns consulted.`

  if (lesson.length < MINIMUM_CONTENT_LENGTH) return null

  const constraintState = outcome?.constraint_state as Record<string, unknown> | undefined
  const domains = constraintState?.domains as Record<string, number[]> | undefined
  const domainSummary = domains
    ? Object.entries(domains).map(([k, v]) => `${k}=[${v.join(",")}]`).join(", ")
    : "no domain state"

  const example = `session plan-write gate: plan="${planName}", domains={${domainSummary}}, solved=${constraintState?.solved ?? "unknown"}`

  if (example.length < MINIMUM_CONTENT_LENGTH) return null

  return { lesson, example }
}
