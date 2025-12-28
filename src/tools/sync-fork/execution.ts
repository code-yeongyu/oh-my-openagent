import { executeCommand } from "../../shared/command-executor"
import { log } from "../../shared/logger"
import type {
  SyncRecommendation,
  SyncForkState,
  ParsedCommit,
  GitContext,
  LinearIssueData,
} from "./types"
import { atomicWriteState, markCommitAsSynced } from "./state"

export interface ExecutionResult {
  success: boolean
  branch?: string
  prUrl?: string
  prNumber?: string
  syncedCommits: string[]
  failedCommits: string[]
  conflictCommits: string[]
  error?: string
}

async function git(args: string, cwd: string): Promise<{ success: boolean; output: string }> {
  const cmd = `cd "${cwd}" && git ${args}`
  try {
    const result = await executeCommand(cmd)
    const hasError = result.includes("[stderr:") && (result.includes("error:") || result.includes("fatal:"))
    return { success: !hasError, output: result }
  } catch (e) {
    return { success: false, output: String(e) }
  }
}

async function gh(args: string, cwd: string): Promise<{ success: boolean; output: string }> {
  const cmd = `cd "${cwd}" && gh ${args}`
  try {
    const result = await executeCommand(cmd)
    return { success: !result.includes("[stderr:"), output: result }
  } catch (e) {
    return { success: false, output: String(e) }
  }
}

/** Creates a new sync branch for cherry-picking upstream commits. */
export async function createSyncBranch(
  repoRoot: string,
  baseBranch?: string
): Promise<{ success: boolean; branchName: string; error?: string }> {
  const date = new Date().toISOString().split("T")[0]
  const branchName = `sync/upstream-${date}`

  if (baseBranch) {
    const checkout = await git(`checkout ${baseBranch}`, repoRoot)
    if (!checkout.success) {
      return { success: false, branchName, error: `Failed to checkout ${baseBranch}: ${checkout.output}` }
    }
  }

  const create = await git(`checkout -b ${branchName}`, repoRoot)
  if (!create.success) {
    if (create.output.includes("already exists")) {
      const suffix = Date.now().toString(36)
      const altBranch = `${branchName}-${suffix}`
      const altCreate = await git(`checkout -b ${altBranch}`, repoRoot)
      if (!altCreate.success) {
        return { success: false, branchName: altBranch, error: altCreate.output }
      }
      return { success: true, branchName: altBranch }
    }
    return { success: false, branchName, error: create.output }
  }

  log(`[sync-fork] Created branch: ${branchName}`)
  return { success: true, branchName }
}

/** Cherry-picks commits from upstream, handling conflicts gracefully. */
export async function cherryPickCommits(
  repoRoot: string,
  commits: ParsedCommit[]
): Promise<{
  success: boolean
  synced: string[]
  failed: string[]
  conflicts: string[]
}> {
  const synced: string[] = []
  const failed: string[] = []
  const conflicts: string[] = []

  for (const commit of commits) {
    log(`[sync-fork] Cherry-picking ${commit.shortSha}: ${commit.subject.slice(0, 50)}`)

    const result = await git(`cherry-pick -x ${commit.sha}`, repoRoot)

    if (result.success) {
      synced.push(commit.sha)
      continue
    }

    if (result.output.includes("conflict") || result.output.includes("CONFLICT")) {
      log(`[sync-fork] Conflict in ${commit.shortSha}, aborting cherry-pick`)
      await git("cherry-pick --abort", repoRoot)
      conflicts.push(commit.sha)
      continue
    }

    log(`[sync-fork] Failed to cherry-pick ${commit.shortSha}: ${result.output}`)
    await git("cherry-pick --abort", repoRoot)
    failed.push(commit.sha)
  }

  return {
    success: conflicts.length === 0 && failed.length === 0,
    synced,
    failed,
    conflicts,
  }
}

/** Pushes the sync branch to origin with upstream tracking. */
export async function pushBranch(
  repoRoot: string,
  branchName: string
): Promise<{ success: boolean; error?: string }> {
  log(`[sync-fork] Pushing ${branchName} to origin`)

  const result = await git(`push -u origin ${branchName}`, repoRoot)
  if (!result.success) {
    return { success: false, error: result.output }
  }

  return { success: true }
}

/** Creates a GitHub PR using gh CLI with heredoc for safe body escaping. */
export async function createPullRequest(
  repoRoot: string,
  recommendations: SyncRecommendation[],
  branchName: string
): Promise<{ success: boolean; url?: string; number?: string; error?: string }> {
  const title = generatePRTitle(recommendations)
  const body = generatePRBody(recommendations)

  log(`[sync-fork] Creating PR: ${title}`)

  const escapedTitle = escapeForShell(title)
  const ghCommand = `pr create --title "${escapedTitle}" --body "$(cat <<'SYNCFORK_EOF'
${body}
SYNCFORK_EOF
)"`

  const result = await gh(ghCommand, repoRoot)

  if (!result.success) {
    return { success: false, error: result.output }
  }

  const urlMatch = result.output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)
  const url = urlMatch ? urlMatch[0] : undefined
  const numberMatch = url?.match(/\/pull\/(\d+)/)
  const number = numberMatch ? numberMatch[1] : undefined

  return { success: true, url, number }
}

/** Extracts P0/P1 recommendations as Linear issue data for OmO to create. */
export function prepareLinearIssues(
  recommendations: SyncRecommendation[]
): LinearIssueData[] {
  return recommendations
    .filter((r) => r.priority === "P0" || r.priority === "P1")
    .map((r) => ({
      title: r.suggestedIssueTitle,
      description: r.suggestedIssueDescription,
      labels: r.suggestedLabels,
      priority: r.priority,
    }))
}

function generatePRTitle(recommendations: SyncRecommendation[]): string {
  const totalCommits = recommendations.reduce((sum, r) => sum + r.commits.length, 0)
  const p0Count = recommendations.filter((r) => r.priority === "P0").length
  const p1Count = recommendations.filter((r) => r.priority === "P1").length

  let priority = ""
  if (p0Count > 0) priority = "[P0] "
  else if (p1Count > 0) priority = "[P1] "

  return `${priority}Sync: Upstream changes (${totalCommits} commits)`
}

function generatePRBody(recommendations: SyncRecommendation[]): string {
  const lines: string[] = ["## Summary", ""]

  const byPriority: Record<string, number> = {}
  for (const r of recommendations) {
    byPriority[r.priority] = (byPriority[r.priority] || 0) + r.commits.length
  }

  for (const [p, count] of Object.entries(byPriority).sort()) {
    lines.push(`- ${count} ${p} commit(s)`)
  }

  lines.push("", "## Recommendations", "")

  for (const rec of recommendations) {
    lines.push(`### ${rec.suggestedIssueTitle}`)
    lines.push("")
    lines.push(`**Priority**: ${rec.priority} | **Effort**: ${rec.estimatedEffort} | **Risk**: ${rec.riskSummary.level}`)
    lines.push("")
    lines.push("**Commits**:")
    for (const c of rec.commits) {
      lines.push(`- \`${c.shortSha}\` ${c.subject}`)
    }
    lines.push("")
    lines.push(`**Reasoning**: ${rec.reasoning}`)
    lines.push("")
  }

  lines.push("---")
  lines.push("*Generated by /sync-fork*")

  return lines.join("\n")
}

function escapeForShell(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
}

/** Executes the full sync workflow: branch, cherry-pick, push, PR, state update. */
export async function executeSync(
  context: GitContext,
  state: SyncForkState,
  recommendations: SyncRecommendation[]
): Promise<ExecutionResult> {
  const allCommits = recommendations.flatMap((r) => r.commits)

  if (allCommits.length === 0) {
    return {
      success: true,
      syncedCommits: [],
      failedCommits: [],
      conflictCommits: [],
    }
  }

  const branchResult = await createSyncBranch(context.repoRoot)
  if (!branchResult.success) {
    return {
      success: false,
      syncedCommits: [],
      failedCommits: allCommits.map((c) => c.sha),
      conflictCommits: [],
      error: branchResult.error,
    }
  }

  const cherryResult = await cherryPickCommits(context.repoRoot, allCommits)

  if (cherryResult.synced.length === 0) {
    return {
      success: false,
      branch: branchResult.branchName,
      syncedCommits: [],
      failedCommits: cherryResult.failed,
      conflictCommits: cherryResult.conflicts,
      error: "No commits were successfully cherry-picked",
    }
  }

  const pushResult = await pushBranch(context.repoRoot, branchResult.branchName)
  if (!pushResult.success) {
    return {
      success: false,
      branch: branchResult.branchName,
      syncedCommits: cherryResult.synced,
      failedCommits: cherryResult.failed,
      conflictCommits: cherryResult.conflicts,
      error: pushResult.error,
    }
  }

  const prResult = await createPullRequest(
    context.repoRoot,
    recommendations,
    branchResult.branchName
  )

  for (const sha of cherryResult.synced) {
    markCommitAsSynced(state, sha, prResult.number || "unknown")
  }
  await atomicWriteState(state, context.repoRoot)

  return {
    success: cherryResult.conflicts.length === 0 && cherryResult.failed.length === 0,
    branch: branchResult.branchName,
    prUrl: prResult.url,
    prNumber: prResult.number,
    syncedCommits: cherryResult.synced,
    failedCommits: cherryResult.failed,
    conflictCommits: cherryResult.conflicts,
    error: prResult.success ? undefined : prResult.error,
  }
}

/** Generates a bash script with cherry-pick commands for manual execution. */
export function generateScaffoldCommands(
  recommendations: SyncRecommendation[]
): string {
  const lines: string[] = [
    "#!/bin/bash",
    "# Sync Fork - Cherry-pick Commands",
    "# Generated by /sync-fork --scaffold",
    "",
    "set -e",
    "",
    "# Create sync branch",
    `BRANCH="sync/upstream-$(date +%Y-%m-%d)"`,
    'git checkout -b "$BRANCH"',
    "",
  ]

  for (const rec of recommendations) {
    lines.push(`# ${rec.suggestedIssueTitle}`)
    lines.push(`# Priority: ${rec.priority} | Risk: ${rec.riskSummary.level}`)
    lines.push(rec.cherryPickCommand)
    lines.push("")
  }

  lines.push("# Push and create PR")
  lines.push('git push -u origin "$BRANCH"')
  lines.push('gh pr create --title "Sync: Upstream changes" --body "See commits for details"')

  return lines.join("\n")
}
