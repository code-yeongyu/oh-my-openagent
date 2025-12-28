import { tool, type PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { SYNC_FORK_DESCRIPTION, DEFAULT_LIMIT, MAX_LIMIT } from "./constants"
import {
  getOrCreateState,
  atomicWriteState,
  deleteState,
  getNewCommits,
  markCommitAsReviewed,
  updateLastReviewed,
} from "./state"
import { runPreflight, getUpstreamCommits, enrichCommitsWithFiles } from "./git-adapter"
import { prepareAnalysisPackets, suggestPriority } from "./analysis"
import {
  groupCommitsByScope,
  generateRecommendations,
  generateMarkdownReport,
} from "./report"
import type { SyncForkArgs, SyncForkResult, ParsedCommit, Priority } from "./types"

export function createSyncForkTool(_ctx: PluginInput) {
  return tool({
    description: SYNC_FORK_DESCRIPTION,
    args: {
      filter: tool.schema
        .enum(["all", "fix", "perf", "security", "feat"])
        .optional()
        .describe("Filter commits by type (default: all)"),
      since: tool.schema
        .string()
        .optional()
        .describe("Only commits since date (ISO-8601)"),
      limit: tool.schema
        .number()
        .optional()
        .describe(`Max commits to analyze (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT})`),
      output: tool.schema
        .enum(["json", "markdown"])
        .optional()
        .describe("Output format (default: markdown)"),
      scaffold: tool.schema
        .boolean()
        .optional()
        .describe("Generate cherry-pick commands without executing"),
      resetState: tool.schema
        .boolean()
        .optional()
        .describe("Clear state file and start fresh"),
      dryRun: tool.schema
        .boolean()
        .optional()
        .describe("Analyze only, don't execute anything"),
    },
    async execute(args: SyncForkArgs): Promise<string> {
      log(`[sync_fork] Starting with args: ${JSON.stringify(args)}`)

      const result = await executeSyncFork(args)

      if (args.output === "json") {
        return JSON.stringify(result, null, 2)
      }

      if (result.success && result.markdownReport) {
        return result.markdownReport
      }

      return JSON.stringify(result, null, 2)
    },
  })
}

async function executeSyncFork(args: SyncForkArgs): Promise<SyncForkResult> {
  try {
    if (args.resetState) {
      const deleted = await deleteState()
      log(`[sync_fork] State reset: ${deleted ? "deleted" : "no state file found"}`)
    }

    const preflight = await runPreflight()

    if (!preflight.success || !preflight.context) {
      return {
        success: false,
        error: preflight.errors.join("; "),
        nextSteps: preflight.suggestions,
      }
    }

    const { context, warnings } = preflight
    log(`[sync_fork] Preflight passed. Repo: ${context.repoRoot}`)
    log(`[sync_fork] Merge base: ${context.mergeBase}`)

    const limit = Math.min(args.limit || DEFAULT_LIMIT, MAX_LIMIT)
    const allCommits = await getUpstreamCommits(context, args.since, limit)
    log(`[sync_fork] Found ${allCommits.length} upstream commits`)

    if (allCommits.length === 0) {
      return {
        success: true,
        summary: {
          total: 0,
          new: 0,
          byPriority: {},
          byType: {},
        },
        markdownReport: "# Fork Sync Report\n\n**Status**: Fork is up to date with upstream.\n",
        nextSteps: [],
      }
    }

    const state = getOrCreateState()
    const newCommitShas = getNewCommits(state, allCommits.map((c) => c.sha))
    const newCommits = allCommits.filter((c) => newCommitShas.includes(c.sha))
    log(`[sync_fork] ${newCommits.length} new commits (${allCommits.length - newCommits.length} already reviewed)`)

    let filteredCommits = newCommits
    if (args.filter && args.filter !== "all") {
      filteredCommits = newCommits.filter((c) => c.type === args.filter)
      log(`[sync_fork] Filtered to ${filteredCommits.length} ${args.filter} commits`)
    }

    if (filteredCommits.length === 0) {
      return {
        success: true,
        summary: {
          total: allCommits.length,
          new: 0,
          byPriority: {},
          byType: countByType(allCommits),
        },
        markdownReport: generateNoNewCommitsReport(context, warnings, args.filter),
        nextSteps: [],
      }
    }

    await enrichCommitsWithFiles(context.repoRoot, filteredCommits)

    const groups = groupCommitsByScope(filteredCommits)
    log(`[sync_fork] Grouped into ${groups.length} groups`)

    const recommendations = generateRecommendations(groups)
    log(`[sync_fork] Generated ${recommendations.length} recommendations`)

    for (const commit of filteredCommits) {
      const priority = suggestPriority(commit)
      markCommitAsReviewed(state, commit.sha, priority)
    }

    if (filteredCommits.length > 0) {
      updateLastReviewed(state, filteredCommits[filteredCommits.length - 1].sha)
    }

    state.upstream.lastFetchedAt = new Date().toISOString()
    await atomicWriteState(state)

    const byPriority = countByPriority(recommendations)
    const byType = countByType(filteredCommits)

    const markdownReport = generateMarkdownReport(context, recommendations, warnings)

    return {
      success: true,
      summary: {
        total: allCommits.length,
        new: filteredCommits.length,
        byPriority,
        byType,
      },
      recommendations,
      markdownReport,
      nextSteps: generateNextSteps(recommendations),
    }
  } catch (e) {
    log(`[sync_fork] Error: ${e}`)
    return {
      success: false,
      error: String(e),
    }
  }
}

function countByType(commits: ParsedCommit[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const c of commits) {
    counts[c.type] = (counts[c.type] || 0) + 1
  }
  return counts
}

function countByPriority(
  recommendations: { priority: Priority }[]
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of recommendations) {
    counts[r.priority] = (counts[r.priority] || 0) + 1
  }
  return counts
}

function generateNoNewCommitsReport(
  context: { upstreamRemote: string; upstreamBranch: string; mergeBase: string },
  warnings: string[],
  filter?: string
): string {
  const lines: string[] = [
    "# Fork Sync Report",
    "",
    "## Context",
    `- **Upstream**: ${context.upstreamRemote}/${context.upstreamBranch}`,
    `- **Merge Base**: ${context.mergeBase.slice(0, 7)}`,
    "",
  ]

  if (warnings.length > 0) {
    lines.push("## Warnings", "")
    for (const w of warnings) {
      lines.push(`- ⚠️ ${w}`)
    }
    lines.push("")
  }

  if (filter && filter !== "all") {
    lines.push(`**No new ${filter} commits to sync.**`)
  } else {
    lines.push("**All commits have been reviewed. No new commits to sync.**")
  }

  return lines.join("\n")
}

function generateNextSteps(
  recommendations: { priority: Priority; suggestedIssueTitle: string }[]
): string[] {
  const steps: string[] = []

  const p0Count = recommendations.filter((r) => r.priority === "P0").length
  const p1Count = recommendations.filter((r) => r.priority === "P1").length

  if (p0Count > 0) {
    steps.push(`🔴 ${p0Count} CRITICAL (P0) recommendations require immediate attention`)
  }

  if (p1Count > 0) {
    steps.push(`🟠 ${p1Count} HIGH (P1) recommendations should be synced soon`)
  }

  if (recommendations.length > 0) {
    steps.push("Review the recommendations and approve which commits to sync")
    steps.push("Use linear_create_issue to create tracking issues for approved syncs")
    steps.push("Execute cherry-pick commands to sync approved commits")
  }

  return steps
}
