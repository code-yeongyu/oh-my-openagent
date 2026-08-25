import type { WorktreeClassification, WorktreeSweepResult } from "./types"

/**
 * One machine-parseable line per worktree:
 *   `SWEEP <path> <ref>` / `KEEP(<reason>) <path> <ref>` / `PRUNE <path> <ref>`
 */
export function formatClassification(classification: WorktreeClassification): string {
  const head =
    classification.decision === "KEEP" && classification.reason !== undefined
      ? `KEEP(${classification.reason})`
      : classification.decision
  return classification.ref.length > 0
    ? `${head} ${classification.path} ${classification.ref}`
    : `${head} ${classification.path}`
}

export function formatSummary(result: WorktreeSweepResult): string {
  const mode = result.apply ? "apply" : "dry-run"
  const removed = result.repos.reduce((total, repo) => total + repo.removed.length, 0)
  const failed = result.repos.reduce((total, repo) => total + repo.failed.length, 0)
  return `SUMMARY mode=${mode} repos=${result.repos.length} sweep=${result.sweepCount} keep=${result.keepCount} prune=${result.pruneCount} removed=${removed} failed=${failed}`
}

export function formatResult(result: WorktreeSweepResult): string[] {
  const lines: string[] = []
  for (const repo of result.repos) {
    lines.push(`REPO ${repo.repo} default=${repo.defaultBranch}`)
    for (const classification of repo.classifications) {
      lines.push(formatClassification(classification))
    }
    for (const failure of repo.failed) {
      lines.push(`FAILED ${failure.path} ${failure.error}`)
    }
  }
  lines.push(formatSummary(result))
  return lines
}
