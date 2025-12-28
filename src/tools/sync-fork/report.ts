import { PRIORITY_LABELS } from "./constants"
import type {
  ParsedCommit,
  AIAnalysisResult,
  SyncRecommendation,
  Priority,
  GitContext,
} from "./types"
import { suggestPriority, createFallbackAnalysis } from "./analysis"

export interface CommitGroup {
  groupId: string
  commits: ParsedCommit[]
  prNumber?: string
  scope?: string
}

export function groupCommitsByScope(commits: ParsedCommit[]): CommitGroup[] {
  const groups: Map<string, ParsedCommit[]> = new Map()

  for (const commit of commits) {
    if (commit.prNumber) {
      const key = `pr-${commit.prNumber}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(commit)
      continue
    }

    if (commit.scope) {
      const key = `scope-${commit.scope}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(commit)
      continue
    }

    const key = `type-${commit.type}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(commit)
  }

  const result: CommitGroup[] = []
  for (const [key, groupCommits] of groups.entries()) {
    const [kind, value] = key.split("-", 2)
    result.push({
      groupId: key,
      commits: groupCommits,
      prNumber: kind === "pr" ? value : undefined,
      scope: kind === "scope" ? value : undefined,
    })
  }

  return result.sort((a, b) => {
    const aPriority = getGroupPriority(a.commits)
    const bPriority = getGroupPriority(b.commits)
    return priorityOrder(aPriority) - priorityOrder(bPriority)
  })
}

function getGroupPriority(commits: ParsedCommit[]): Priority {
  const priorities = commits.map((c) => suggestPriority(c))
  if (priorities.includes("P0")) return "P0"
  if (priorities.includes("P1")) return "P1"
  if (priorities.includes("P2")) return "P2"
  return "P3"
}

function priorityOrder(p: Priority | "Skip"): number {
  const order: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, Skip: 4 }
  return order[p] ?? 5
}

export function generateRecommendations(
  groups: CommitGroup[],
  analysisResults?: Map<string, AIAnalysisResult>
): SyncRecommendation[] {
  const recommendations: SyncRecommendation[] = []

  for (const group of groups) {
    const analyses = group.commits.map((c) => {
      if (analysisResults?.has(c.sha)) {
        return analysisResults.get(c.sha)!
      }
      return createFallbackAnalysis(c)
    })

    const priority = getHighestPriority(analyses.map((a) => a.priority))
    if (priority === "Skip") continue

    const reasoning = analyses
      .filter((a) => a.priority !== "Skip")
      .map((a) => a.reasoning)
      .join(" ")

    const conflictLikelihood = getWorstConflict(
      analyses.map((a) => a.conflictLikelihood)
    )

    const affectedAreas = [...new Set(analyses.flatMap((a) => a.affectedAreas))]

    const title = generateIssueTitle(group, priority)
    const description = generateIssueDescription(group, analyses, priority)
    const cherryPickCmd = generateCherryPickCommand(group.commits)

    recommendations.push({
      groupId: group.groupId,
      suggestedIssueTitle: title,
      suggestedIssueDescription: description,
      commits: group.commits,
      priority,
      reasoning: reasoning.slice(0, 500),
      suggestedLabels: PRIORITY_LABELS[priority] || ["sync-upstream"],
      estimatedEffort: estimateEffort(group.commits),
      cherryPickCommand: cherryPickCmd,
      riskSummary: {
        level: conflictLikelihood === "likely" ? "HIGH" : conflictLikelihood === "possible" ? "MEDIUM" : "LOW",
        conflictLikelihood,
        affectedAreas,
      },
    })
  }

  return recommendations.sort(
    (a, b) => priorityOrder(a.priority) - priorityOrder(b.priority)
  )
}

function getHighestPriority(priorities: (Priority | "Skip")[]): Priority | "Skip" {
  for (const p of ["P0", "P1", "P2", "P3"] as Priority[]) {
    if (priorities.includes(p)) return p
  }
  return "Skip"
}

function getWorstConflict(
  conflicts: ("likely" | "possible" | "unlikely")[]
): "likely" | "possible" | "unlikely" {
  if (conflicts.includes("likely")) return "likely"
  if (conflicts.includes("possible")) return "possible"
  return "unlikely"
}

function generateIssueTitle(group: CommitGroup, priority: Priority): string {
  const prefix = `Sync [${priority}]:`
  if (group.prNumber) {
    return `${prefix} Upstream PR #${group.prNumber}`
  }
  if (group.scope) {
    return `${prefix} ${group.scope} updates (${group.commits.length} commits)`
  }
  const type = group.commits[0]?.type || "misc"
  return `${prefix} ${type} changes (${group.commits.length} commits)`
}

function generateIssueDescription(
  group: CommitGroup,
  analyses: AIAnalysisResult[],
  priority: Priority
): string {
  const lines: string[] = [
    "## Summary",
    "",
    `Sync ${group.commits.length} commit(s) from upstream.`,
    "",
    "## Commits",
    "",
  ]

  for (const commit of group.commits) {
    lines.push(`- \`${commit.shortSha}\`: ${commit.subject}`)
  }

  lines.push("", "## AI Analysis", "")

  for (let i = 0; i < analyses.length; i++) {
    const analysis = analyses[i]
    const commit = group.commits[i]
    lines.push(`### ${commit.shortSha}`)
    lines.push(`- **Priority**: ${analysis.priority}`)
    lines.push(`- **Reasoning**: ${analysis.reasoning}`)
    lines.push(`- **Conflict Risk**: ${analysis.conflictLikelihood}`)
    lines.push("")
  }

  lines.push("## Cherry-pick Command", "")
  lines.push("```bash")
  lines.push(generateCherryPickCommand(group.commits))
  lines.push("```")

  return lines.join("\n")
}

function generateCherryPickCommand(commits: ParsedCommit[]): string {
  const shas = commits.map((c) => c.sha).join(" ")
  return `git cherry-pick -x ${shas}`
}

function estimateEffort(
  commits: ParsedCommit[]
): "trivial" | "small" | "medium" | "large" {
  const totalFiles = commits.reduce((sum, c) => sum + c.files.length, 0)
  if (totalFiles <= 2) return "trivial"
  if (totalFiles <= 5) return "small"
  if (totalFiles <= 15) return "medium"
  return "large"
}

export function generateMarkdownReport(
  context: GitContext,
  recommendations: SyncRecommendation[],
  warnings: string[]
): string {
  const lines: string[] = [
    "# Fork Sync Analysis Report",
    "",
    "## Context",
    `- **Upstream**: ${context.upstreamRemote}/${context.upstreamBranch}`,
    `- **Merge Base**: ${context.mergeBase.slice(0, 7)}`,
    `- **Recommendations**: ${recommendations.length}`,
    "",
  ]

  if (warnings.length > 0) {
    lines.push("## Warnings", "")
    for (const w of warnings) {
      lines.push(`- ⚠️ ${w}`)
    }
    lines.push("")
  }

  const byPriority = groupByPriority(recommendations)

  for (const [priority, recs] of Object.entries(byPriority)) {
    if (recs.length === 0) continue

    const emoji = priority === "P0" ? "🔴" : priority === "P1" ? "🟠" : priority === "P2" ? "🟡" : "🟢"
    lines.push(`## ${emoji} ${priority} - ${getPriorityLabel(priority as Priority)}`, "")

    for (const rec of recs) {
      lines.push(`### ${rec.suggestedIssueTitle}`)
      lines.push("")
      lines.push(`**Commits**: ${rec.commits.length} | **Effort**: ${rec.estimatedEffort} | **Conflict Risk**: ${rec.riskSummary.conflictLikelihood}`)
      lines.push("")
      lines.push(`**Reasoning**: ${rec.reasoning}`)
      lines.push("")

      for (const commit of rec.commits) {
        lines.push(`- \`${commit.shortSha}\` ${commit.subject}`)
      }

      lines.push("")
      lines.push("```bash")
      lines.push(rec.cherryPickCommand)
      lines.push("```")
      lines.push("")
    }
  }

  lines.push("---")
  lines.push("*Generated by /sync-fork*")

  return lines.join("\n")
}

function groupByPriority(
  recommendations: SyncRecommendation[]
): Record<string, SyncRecommendation[]> {
  const result: Record<string, SyncRecommendation[]> = {
    P0: [],
    P1: [],
    P2: [],
    P3: [],
  }

  for (const rec of recommendations) {
    result[rec.priority]?.push(rec)
  }

  return result
}

function getPriorityLabel(priority: Priority): string {
  const labels: Record<Priority, string> = {
    P0: "CRITICAL (Sync Immediately)",
    P1: "HIGH (Sync Soon)",
    P2: "MEDIUM (Queue for Batch)",
    P3: "LOW (Nice to Have)",
  }
  return labels[priority]
}
