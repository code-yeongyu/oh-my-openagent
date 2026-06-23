import type { ReasoningCoreClient, ReasoningCoreKbAddEntry } from "./reasoning-core-client"
import { matchesExactLearnedInsight, replaceLearnedPattern } from "./kb-replacement-helper"
import type { PolicyVerdict } from "./types"
import { log } from "../../shared/logger"

const MINIMUM_CONTENT_LENGTH = 20
const KB_WRITER_TAG = "prometheus-momus-review"

export async function writeAllowedMomusPattern(input: {
  client: ReasoningCoreClient
  verdict: PolicyVerdict
  sessionID: string
}): Promise<void> {
  const { client, verdict, sessionID } = input

  try {
    const pattern = extractPattern(verdict)
    if (!pattern) {
      log("[momus-kb-writer] Skipped: pattern did not pass quality gate", { sessionID })
      return
    }

    const entry: ReasoningCoreKbAddEntry = {
      layer: "Learned",
      content: {
        Insight: {
          problem_type: "prometheus_momus_review",
          lesson: pattern.lesson,
          example: pattern.example,
        },
      },
      tags: [
        KB_WRITER_TAG,
        "planning",
        "review",
        "momus",
        "review_prereq:plan_file_referenced",
        "review_prereq:plan_content_present",
        "review_prereq:review_scope_clear",
        "review_prereq:plan_generation_completed",
      ],
    }

    await replaceLearnedPattern({
      client,
      newEntry: entry,
      query: {
        content_type: "insight",
        layer: "Learned",
        keyword: "prometheus_momus_review",
        similarity_query: pattern.lesson,
        tags: [KB_WRITER_TAG, "planning", "review", "momus"],
      },
      isDuplicate: matchesExactLearnedInsight,
    })

    log("[momus-kb-writer] Saved review pattern to KB", { sessionID })
  } catch (error) {
    log("[momus-kb-writer] KB write failed (non-blocking)", {
      sessionID,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function extractPattern(verdict: PolicyVerdict): { lesson: string; example: string } | null {
  if (!verdict.proofArtifact || typeof verdict.proofArtifact !== "object") return null

  const artifact = verdict.proofArtifact as Record<string, unknown>
  const review = isRecord(artifact.review) ? artifact.review : undefined
  const kbResult = isRecord(artifact.kbResult) ? artifact.kbResult : undefined
  const outcome = isRecord(artifact.outcome) ? artifact.outcome : undefined
  if (!review) return null

  const planPath = typeof review.planPath === "string" ? review.planPath : ""
  const planContent = typeof review.planContent === "string" ? review.planContent.trim() : ""
  if (!planPath || planContent.length < MINIMUM_CONTENT_LENGTH) return null

  const priorPatternCount = typeof kbResult?.count === "number" ? kbResult.count : 0
  const stopSignal = typeof outcome?.stop_signal === "string" ? outcome.stop_signal : "unknown"
  const lesson = `Momus review delegation passed plan reference, content, scope, and generation checks with stop_signal=${stopSignal} and ${priorPatternCount} prior review patterns consulted.`

  const evidence = isRecord(artifact.evidence) ? artifact.evidence : undefined
  const verified = Array.isArray(evidence?.verified) ? evidence.verified.join(",") : ""
  const unverified = Array.isArray(evidence?.unverified) ? evidence.unverified.join(",") : ""
  const example = `momus review: plan="${planPath}", verified=[${verified}], unverified=[${unverified}]`

  if (lesson.length < MINIMUM_CONTENT_LENGTH || example.length < MINIMUM_CONTENT_LENGTH) {
    return null
  }

  return { lesson, example }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
