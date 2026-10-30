import { createHash } from "node:crypto"
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

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
const MAX_SEQUENCE_ATTEMPTS = 1000

function resolvePlanFilePath(directory: string, planPath: string): string {
  return resolve(directory, planPath)
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

function isInsideDirectory(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  )
}

function realpathWithMissingTail(path: string): string {
  let current = path
  const missingTail: string[] = []
  for (;;) {
    try {
      const real = realpathSync(current)
      return missingTail.length === 0 ? real : join(real, ...missingTail)
    } catch {
      const parent = dirname(current)
      if (parent === current) {
        return resolve(path)
      }
      missingTail.unshift(basename(current))
      current = parent
    }
  }
}

interface ContainedPlan {
  plansRoot: string
  reviewsDir: string
}

function resolveContainedPlan(directory: string, planPath: string): ContainedPlan | null {
  const plansRoot = resolve(directory, ".omo", "plans")
  const planFilePath = resolvePlanFilePath(directory, planPath)
  if (!isInsideDirectory(plansRoot, planFilePath)) {
    return null
  }
  const realPlansRoot = realpathWithMissingTail(plansRoot)
  if (!isInsideDirectory(realpathWithMissingTail(directory), realPlansRoot)) {
    return null
  }
  const realPlanFilePath = realpathWithMissingTail(planFilePath)
  if (!isInsideDirectory(realPlansRoot, realPlanFilePath)) {
    return null
  }
  return { plansRoot, reviewsDir: getPlanReviewsDir(directory, planPath) }
}

export function isContainedPlanPath(directory: string, planPath: string): boolean {
  return resolveContainedPlan(directory, planPath) !== null
}

function findArtifactBySessionId(reviewsDir: string, sessionId: string): string | null {
  const sessionLine = `- Reviewer session: ${sessionId}`
  for (const entry of readdirSync(reviewsDir)) {
    if (!REVIEW_FILE_PATTERN.test(entry)) {
      continue
    }
    let content: string
    try {
      content = readFileSync(join(reviewsDir, entry), "utf-8")
    } catch {
      continue
    }
    if (content.split("\n").includes(sessionLine)) {
      return join(reviewsDir, entry)
    }
  }
  return null
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

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  )
}

function artifactFileFlags(): number {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  return constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow
}

function createArtifactFile(reviewsDir: string, planPath: string, artifact: MomusReviewArtifactInput): string {
  let sequence = nextReviewSequence(reviewsDir)
  for (let attempt = 0; attempt < MAX_SEQUENCE_ATTEMPTS; attempt += 1) {
    const fileName = `${String(sequence).padStart(3, "0")}-${artifact.verdict}.md`
    const filePath = join(reviewsDir, fileName)
    let fd: number
    try {
      fd = openSync(filePath, artifactFileFlags())
    } catch (error) {
      if (hasErrorCode(error, "EEXIST") || hasErrorCode(error, "ELOOP")) {
        sequence += 1
        continue
      }
      throw error
    }
    try {
      writeFileSync(fd, formatMomusReviewArtifact({ sequence, planPath, artifact }), "utf-8")
      return filePath
    } finally {
      closeSync(fd)
    }
  }
  throw new Error(`Could not allocate a review artifact sequence in ${reviewsDir}`)
}

function ensurePlansGitignore(plansRoot: string): void {
  const gitignorePath = join(plansRoot, ".gitignore")
  if (existsSync(gitignorePath)) {
    return
  }
  try {
    writeFileSync(gitignorePath, "*.reviews\n", "utf-8")
  } catch {
    // Best effort only: a missing ignore file must never block the artifact write.
  }
}

export function writeMomusReviewArtifact(
  directory: string,
  planPath: string,
  artifact: MomusReviewArtifactInput,
): string | null {
  const contained = resolveContainedPlan(directory, planPath)
  if (!contained) {
    return null
  }
  const { plansRoot, reviewsDir } = contained
  if (!existsSync(reviewsDir)) {
    mkdirSync(reviewsDir, { recursive: true })
  }
  ensurePlansGitignore(plansRoot)
  if (!isInsideDirectory(realpathSync(plansRoot), realpathSync(reviewsDir))) {
    return null
  }
  if (artifact.sessionId) {
    const existing = findArtifactBySessionId(reviewsDir, artifact.sessionId)
    if (existing) {
      return existing
    }
  }
  return createArtifactFile(reviewsDir, planPath, artifact)
}
