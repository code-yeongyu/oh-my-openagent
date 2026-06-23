import type { ReasoningCoreClient, ReasoningCoreKbAddEntry } from "./reasoning-core-client"
import { matchesExactLearnedInsight, replaceLearnedPattern } from "./kb-replacement-helper"
import type { PolicyVerdict } from "./types"
import { log } from "../../shared/logger"

const MINIMUM_CONTENT_LENGTH = 20
const KB_WRITER_TAG = "prometheus-metis-consultation"

export async function writeAllowedConsultationPattern(input: {
  client: ReasoningCoreClient
  verdict: PolicyVerdict
  sessionID: string
}): Promise<void> {
  const { client, verdict, sessionID } = input

  try {
    const pattern = extractPattern(verdict)
    if (!pattern) {
      log("[metis-kb-writer] Skipped: pattern did not pass quality gate", { sessionID })
      return
    }

    const entry: ReasoningCoreKbAddEntry = {
      layer: "Learned",
      content: {
        Insight: {
          problem_type: "prometheus_metis_consultation",
          lesson: pattern.lesson,
          example: pattern.example,
        },
      },
      tags: [
        KB_WRITER_TAG,
        "planning",
        "metis",
        "prereq:goal_present",
        "prereq:discussion_present",
        "prereq:understanding_present",
        "prereq:research_present",
      ],
    }

    await replaceLearnedPattern({
      client,
      newEntry: entry,
      query: {
        content_type: "insight",
        layer: "Learned",
        keyword: "prometheus_metis_consultation",
        similarity_query: pattern.lesson,
        tags: [KB_WRITER_TAG, "planning", "metis"],
      },
      isDuplicate: matchesExactLearnedInsight,
    })

    log("[metis-kb-writer] Saved consultation pattern to KB", { sessionID })
  } catch (error) {
    log("[metis-kb-writer] KB write failed (non-blocking)", {
      sessionID,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function extractPattern(verdict: PolicyVerdict): { lesson: string; example: string } | null {
  if (!verdict.proofArtifact || typeof verdict.proofArtifact !== "object") return null

  const artifact = verdict.proofArtifact as Record<string, unknown>
  const sections = isRecord(artifact.sections) ? artifact.sections : undefined
  const kbResult = isRecord(artifact.kbResult) ? artifact.kbResult : undefined
  const outcome = isRecord(artifact.outcome) ? artifact.outcome : undefined

  const goal = typeof sections?.goal === "string" ? sections.goal.trim() : ""
  const research = typeof sections?.research === "string" ? sections.research.trim() : ""
  if (!goal || !research) return null

  const priorPatternCount = typeof kbResult?.count === "number" ? kbResult.count : 0
  const stopSignal = typeof outcome?.stop_signal === "string" ? outcome.stop_signal : "unknown"
  const lesson = `Metis consultation passed goal/discussed/understanding/research with stop_signal=${stopSignal} and ${priorPatternCount} prior consultation patterns consulted.`

  const evidence = isRecord(artifact.evidence) ? artifact.evidence : undefined
  const verified = Array.isArray(evidence?.verified) ? evidence.verified.join(",") : ""
  const unverified = Array.isArray(evidence?.unverified) ? evidence.unverified.join(",") : ""
  const example = `metis consultation: goal="${goal}", research="${research}", verified=[${verified}], unverified=[${unverified}]`

  if (lesson.length < MINIMUM_CONTENT_LENGTH || example.length < MINIMUM_CONTENT_LENGTH) {
    return null
  }

  return { lesson, example }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
