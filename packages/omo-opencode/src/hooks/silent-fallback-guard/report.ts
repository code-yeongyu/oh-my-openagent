import type { FallbackCandidate, SilentFallbackGuardConfig } from "./types"

export interface GuardReport {
  timestamp: string
  diffHash: string
  mode: "report" | "pushback"
  candidates: FallbackCandidate[]
  selected: FallbackCandidate[]
  skipped: FallbackCandidate[]
  saturation: boolean
  failOpenStatus?: "DIFF_UNAVAILABLE" | "HOOK_ERROR" | "UNSUPPORTED_LANGUAGE" | "SATURATED"
  skippedReason?: string
  pushback?: {
    attempted: boolean
    accepted: boolean
    reason?: string
  }
}

export interface BudgetResult {
  selected: FallbackCandidate[]
  skipped: FallbackCandidate[]
  saturation: boolean
}

export function applyReviewBudget(
  candidates: FallbackCandidate[],
  config: SilentFallbackGuardConfig,
): BudgetResult {
  const sorted = [...candidates].sort(
    (left, right) => confidenceRank(left.confidence) - confidenceRank(right.confidence),
  )
  const reviewable = config.includeLowConfidence
    ? sorted
    : sorted.filter((candidate) => candidate.confidence !== "low")

  const selected: FallbackCandidate[] = []
  const skipped: FallbackCandidate[] = []
  const perFile = new Map<string, number>()
  const perRisk = new Map<string, number>()
  let saturation = false

  for (const candidate of reviewable) {
    if (selected.length >= config.maxReviewCandidates) {
      skipped.push(candidate)
      saturation = true
      continue
    }
    if ((perFile.get(candidate.file) ?? 0) >= config.maxPerFile) {
      skipped.push(candidate)
      saturation = true
      continue
    }
    if ((perRisk.get(candidate.riskType) ?? 0) >= config.maxPerRiskType) {
      skipped.push(candidate)
      saturation = true
      continue
    }
    selected.push(candidate)
    perFile.set(candidate.file, (perFile.get(candidate.file) ?? 0) + 1)
    perRisk.set(candidate.riskType, (perRisk.get(candidate.riskType) ?? 0) + 1)
  }

  if (!config.includeLowConfidence) {
    skipped.push(...sorted.filter((candidate) => candidate.confidence === "low"))
  }

  return { selected, skipped, saturation }
}

export function buildReviewerPrompt(report: GuardReport): string {
  const lines: string[] = [
    "# Silent Fallback Guard Review",
    "",
    `Diff hash: ${report.diffHash}`,
    `Mode: ${report.mode}`,
    `Total candidates: ${report.candidates.length}`,
    `Selected for review: ${report.selected.length}`,
    `Skipped: ${report.skipped.length}`,
    report.saturation ? "SATURATION: review budget was exceeded; only highest-risk examples are shown." : "",
    "",
    "## Review checklist",
    "- [ ] Record every reviewed candidate.",
    "- [ ] Remove only obvious unrequested fallback slop.",
    "- [ ] Keep fallback behavior that is justified by plan, tests, or project instructions.",
    "- [ ] Ask the user a structured question with numbered options when context is insufficient.",
    "- [ ] Do not finish work until this checklist and the final report are complete.",
    "",
  ]

  if (report.selected.length === 0) {
    lines.push("No fallback candidates require review.")
    return lines.filter(Boolean).join("\n")
  }

  lines.push("## Candidates requiring review")
  for (const candidate of report.selected) {
    lines.push("")
    lines.push(`### ${candidate.file}:${candidate.line}`)
    lines.push(`- Risk type: ${candidate.riskType}`)
    lines.push(`- Confidence: ${candidate.confidence}`)
    lines.push(`- Reason: ${candidate.reason}`)
    lines.push("")
    lines.push("```")
    lines.push(candidate.raw)
    lines.push("```")
    if (candidate.commentContext) {
      lines.push(`Comment context: ${candidate.commentContext}`)
    }
    lines.push("")
    lines.push("Decision: KEEP / REMOVE / USER_DECISION")
    lines.push("Justification: ...")
    lines.push("")
    lines.push("If the context is insufficient, ask the user with numbered options, for example:")
    lines.push("1. Remove fallback and fail fast on missing data.")
    lines.push("2. Keep fallback because missing values are expected and documented.")
    lines.push("3. Replace with explicit quarantine/logging path.")
  }

  return lines.filter(Boolean).join("\n")
}

export function buildSaturationSummary(report: GuardReport): string {
  return [
    "Silent Fallback Guard: candidate saturation.",
    `Reviewed ${report.selected.length} of ${report.candidates.length} candidates.`,
    `Skipped ${report.skipped.length} candidates due to budget limits.`,
    "Increase maxReviewCandidates/maxPerFile/maxPerRiskType or review the full report if needed.",
  ].join(" ")
}

function confidenceRank(confidence: "high" | "medium" | "low"): number {
  return confidence === "high" ? 0 : confidence === "medium" ? 1 : 2
}
