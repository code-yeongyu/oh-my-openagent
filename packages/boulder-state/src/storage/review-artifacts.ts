import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"

export type MomusReviewVerdict = "okay" | "reject"

export interface MomusReviewArtifactInput {
  verdict: MomusReviewVerdict
  reviewedAt: Date
  model?: string
  planHash?: string
  durationMs?: number
  sessionId?: string
  reviewerOutput: string
}

const REVIEW_FILE_PATTERN = /^(\d+)-/

function resolvePlanFilePath(directory: string, planPath: string): string {
  return isAbsolute(planPath) ? resolve(planPath) : resolve(directory, planPath)
}

export function getPlanReviewsDir(directory: string, planPath: string): string {
  const planFilePath = resolvePlanFilePath(directory, planPath)
  const withoutExtension = planFilePath.endsWith(".md") ? planFilePath.slice(0, -".md".length) : planFilePath
  return `${withoutExtension}.reviews`
}

export function hashPlanContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex")
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return "unknown"
  }
  return `${(durationMs / 1000).toFixed(1)}s`
}

export function formatMomusReviewArtifact(input: {
  sequence: number
  planPath: string
  artifact: MomusReviewArtifactInput
}): string {
  const { artifact } = input
  const lines = [
    `# Momus review ${String(input.sequence).padStart(3, "0")}: ${artifact.verdict.toUpperCase()}`,
    "",
    `- Plan: ${input.planPath}`,
    `- Verdict: ${artifact.verdict}`,
    `- Reviewed at: ${artifact.reviewedAt.toISOString()}`,
    `- Model: ${artifact.model ?? "unknown"}`,
    `- Plan hash (sha256): ${artifact.planHash ?? "unavailable"}`,
    `- Duration: ${formatDuration(artifact.durationMs)}`,
  ]
  if (artifact.sessionId) {
    lines.push(`- Reviewer session: ${artifact.sessionId}`)
  }
  lines.push("", "## Reviewer output", "", artifact.reviewerOutput.trim(), "")
  return lines.join("\n")
}

function nextReviewSequence(reviewsDir: string): number {
  if (!existsSync(reviewsDir)) {
    return 1
  }
  let max = 0
  for (const entry of readdirSync(reviewsDir)) {
    const match = REVIEW_FILE_PATTERN.exec(entry)
    if (match) {
      const value = Number.parseInt(match[1], 10)
      if (Number.isFinite(value) && value > max) {
        max = value
      }
    }
  }
  return max + 1
}

export function writeMomusReviewArtifact(
  directory: string,
  planPath: string,
  artifact: MomusReviewArtifactInput,
): string | null {
  try {
    const reviewsDir = getPlanReviewsDir(directory, planPath)
    if (!existsSync(reviewsDir)) {
      mkdirSync(reviewsDir, { recursive: true })
    }
    const sequence = nextReviewSequence(reviewsDir)
    const fileName = `${String(sequence).padStart(3, "0")}-${artifact.verdict}.md`
    const filePath = join(reviewsDir, fileName)
    writeFileSync(filePath, formatMomusReviewArtifact({ sequence, planPath, artifact }), "utf-8")
    return filePath
  } catch {
    return null
  }
}
