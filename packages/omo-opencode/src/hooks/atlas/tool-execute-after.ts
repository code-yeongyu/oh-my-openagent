import type { PluginInput } from "@opencode-ai/plugin"
import { isCallerOrchestrator } from "../../shared/session-utils"
import { collectGitDiffStats, formatFileChanges } from "../../shared/git-worktree"
import { extractSessionIdFromMetadata } from "./subagent-session-id"
import { handleDirectWorkToolAfter } from "./tool-execute-after-direct-work"
import { handleSubagentCompletionAfter } from "./tool-execute-after-subagent-completion"
import { didToolMakeProgress, isTangibleProgressTool, recordToolProgress } from "./tool-progress"
import type { PendingTaskRef, SessionState } from "./types"
import type { ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types"

export function createToolExecuteAfterHandler(input: {
  ctx: PluginInput
  pendingFilePaths: Map<string, string>
  pendingTaskRefs: Map<string, PendingTaskRef>
  pendingPlanSnapshots?: Map<string, string>
  autoCommit: boolean
  getState: (sessionID: string) => SessionState
  isCallerOrchestrator?: (sessionID: string | undefined) => Promise<boolean>
  collectGitDiffStats?: typeof collectGitDiffStats
  formatFileChanges?: typeof formatFileChanges
}): (toolInput: ToolExecuteAfterInput, toolOutput: ToolExecuteAfterOutput | undefined) => Promise<void> {
  const { ctx, pendingFilePaths, pendingTaskRefs, pendingPlanSnapshots, autoCommit, getState } = input
  const resolveIsCallerOrchestrator = input.isCallerOrchestrator ?? ((sessionID) => isCallerOrchestrator(sessionID, ctx.client))
  const collectGitDiffStatsImpl = input.collectGitDiffStats ?? collectGitDiffStats
  const formatFileChangesImpl = input.formatFileChanges ?? formatFileChanges
  return async (toolInput, toolOutput): Promise<void> => {
    // Guard against undefined output (e.g., from /review command - see issue #1035)
    if (!toolOutput) {
      return
    }

    if (toolInput.sessionID && isTangibleProgressTool(toolInput.tool) && didToolMakeProgress(toolOutput)) {
      recordToolProgress(getState(toolInput.sessionID))
    }

    if (!(await resolveIsCallerOrchestrator(toolInput.sessionID))) {
      return
    }

    if (await handleDirectWorkToolAfter({
      ctx,
      pendingFilePaths,
      pendingPlanSnapshots,
      toolInput,
      toolOutput,
    })) {
      return
    }

    const metadataSessionId = extractSessionIdFromMetadata(toolOutput.metadata)
    const isPluginToolWithSession = toolInput.tool !== "task" && !!metadataSessionId
    if (toolInput.tool !== "task" && !isPluginToolWithSession) {
      return
    }

    await handleSubagentCompletionAfter({
      ctx,
      pendingTaskRefs,
      autoCommit,
      getState,
      collectGitDiffStats: collectGitDiffStatsImpl,
      formatFileChanges: formatFileChangesImpl,
      toolInput,
      toolOutput,
      metadataSessionId,
    })
  }
}
