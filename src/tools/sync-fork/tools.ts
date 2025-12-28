import { tool, type PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { SYNC_FORK_DESCRIPTION, DEFAULT_LIMIT, MAX_LIMIT } from "./constants"
import { getOrCreateState, atomicWriteState, deleteState, getNewCommits } from "./state"
import { runPreflight, getUpstreamCommits, enrichCommitsWithFiles } from "./git-adapter"
import type { SyncForkArgs, SyncForkResult, ParsedCommit } from "./types"

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

    await enrichCommitsWithFiles(context.repoRoot, filteredCommits)

    const byType = countByType(filteredCommits)

    const report = generateBasicReport(context, filteredCommits, warnings)

    state.upstream.lastFetchedAt = new Date().toISOString()
    await atomicWriteState(state)

    return {
      success: true,
      summary: {
        total: allCommits.length,
        new: newCommits.length,
        byPriority: {},
        byType,
      },
      markdownReport: report,
      nextSteps: [
        "Phase 3-4 TODO: AI analysis will be added to provide priority recommendations",
        "Phase 5 TODO: Execution phase will handle cherry-pick and PR creation",
      ],
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

function generateBasicReport(
  context: { upstreamRemote: string; upstreamBranch: string; mergeBase: string },
  commits: ParsedCommit[],
  warnings: string[]
): string {
  const lines: string[] = [
    "# Fork Sync Report",
    "",
    "## Context",
    `- **Upstream**: ${context.upstreamRemote}/${context.upstreamBranch}`,
    `- **Merge Base**: ${context.mergeBase.slice(0, 7)}`,
    `- **Commits Found**: ${commits.length}`,
    "",
  ]

  if (warnings.length > 0) {
    lines.push("## Warnings", "")
    for (const w of warnings) {
      lines.push(`- ${w}`)
    }
    lines.push("")
  }

  if (commits.length === 0) {
    lines.push("**No new commits to sync.**")
    return lines.join("\n")
  }

  lines.push("## Commits", "")
  lines.push("| SHA | Type | Subject |")
  lines.push("|-----|------|---------|")

  for (const c of commits.slice(0, 20)) {
    const subject = c.subject.length > 60 ? c.subject.slice(0, 57) + "..." : c.subject
    lines.push(`| ${c.shortSha} | ${c.type} | ${subject} |`)
  }

  if (commits.length > 20) {
    lines.push(`| ... | ... | *(${commits.length - 20} more commits)* |`)
  }

  lines.push("")
  lines.push("---")
  lines.push("*AI analysis phase not yet implemented*")

  return lines.join("\n")
}
