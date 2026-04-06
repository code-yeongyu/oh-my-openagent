import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { loadWorkflowState } from "./loader"
import { parseReviewFile } from "./review-parser"
import type { WorkflowPhase, WorkflowState } from "./types"

function isReviewApproved(review: {
  verdict: string | null
  score: number
  criticalIssues: string[]
}): boolean {
  if (!review.verdict) return false
  if (review.verdict !== "APPROVE") return false
  if (review.score < 30) return false
  if (review.criticalIssues.length > 0) return false
  return true
}

export function getRequiredFilesForPhase(
  phase: WorkflowPhase,
  state: WorkflowState
): string[] {
  switch (phase) {
    case "reviewing":
      return state.planFile ? [state.planFile] : []
    case "executing":
      return [state.planFile, state.reviewFile].filter(Boolean) as string[]
    case "deploying":
      return state.buildReportFile ? [state.buildReportFile] : []
    case "testing":
      return [state.planFile].filter(Boolean) as string[]
    default:
      return []
  }
}

export interface ValidationResult {
  valid: boolean
  missing: string[]
  currentPhase: WorkflowPhase
  targetPhase: WorkflowPhase
}

export function validatePhasePrerequisites(
  projectRoot: string,
  targetPhase: WorkflowPhase
): ValidationResult {
  const state = loadWorkflowState(projectRoot)
  const requiredFiles = getRequiredFilesForPhase(targetPhase, state)
  const missing: string[] = []

  for (const file of requiredFiles) {
    if (!file) continue
    const fullPath = join(projectRoot, file)
    if (!existsSync(fullPath)) {
      missing.push(file)
    }
  }

  if (targetPhase === "executing") {
    if (!state.reviewFile) {
      missing.push("Review file")
    } else {
      const reviewPath = join(projectRoot, state.reviewFile)
      if (existsSync(reviewPath)) {
        const content = readFileSync(reviewPath, "utf-8")
        const parsed = parseReviewFile(content)
        if (!isReviewApproved(parsed)) {
          missing.push("Review approval (score >= 30, no critical issues)")
        }
      } else {
        missing.push(state.reviewFile)
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    currentPhase: state.phase,
    targetPhase,
  }
}
