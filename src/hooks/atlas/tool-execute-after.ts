import type { PluginInput } from "@opencode-ai/plugin"
import { appendSessionId, getPlanProgress, readBoulderState } from "../../features/boulder-state"
import { log } from "../../shared/logger"
import { isCallerOrchestrator } from "../../shared/session-utils"
import { collectGitDiffStats, formatFileChanges } from "../../shared/git-worktree"
import { HOOK_NAME } from "./hook-name"
import { DIRECT_WORK_REMINDER } from "./system-reminder-templates"
import { isSisyphusPath } from "./sisyphus-path"
import { extractSessionIdFromOutput } from "./subagent-session-id"
import { buildOrchestratorReminder, buildStandaloneVerificationReminder } from "./verification-reminders"
import { isWriteOrEditToolName } from "./write-edit-tool-policy"
import type { ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types"

export function createToolExecuteAfterHandler(input: {
  ctx: PluginInput
  pendingFilePaths: Map<string, string>
}): (toolInput: ToolExecuteAfterInput, toolOutput: ToolExecuteAfterOutput) => Promise<void> {
  const { ctx, pendingFilePaths } = input

  return async (toolInput, toolOutput): Promise<void> => {
    // Guard against undefined output (e.g., from /review command - see issue #1035)
    if (!toolOutput) {
      return
    }

    if (!isCallerOrchestrator(toolInput.sessionID)) {
      return
    }

    if (isWriteOrEditToolName(toolInput.tool)) {
      let filePath = toolInput.callID ? pendingFilePaths.get(toolInput.callID) : undefined
      if (toolInput.callID) {
        pendingFilePaths.delete(toolInput.callID)
      }
      if (!filePath) {
        filePath = toolOutput.metadata?.filePath as string | undefined
      }
      if (filePath && !isSisyphusPath(filePath)) {
        toolOutput.output = (toolOutput.output || "") + DIRECT_WORK_REMINDER
        log(`[${HOOK_NAME}] Direct work reminder appended`, {
          sessionID: toolInput.sessionID,
          tool: toolInput.tool,
          filePath,
        })
      }
      return
    }

    if (toolInput.tool !== "task") {
      return
    }

    const outputStr = toolOutput.output && typeof toolOutput.output === "string" ? toolOutput.output : ""
    const isBackgroundLaunch = outputStr.includes("Background task launched") || outputStr.includes("Background task continued")
    if (isBackgroundLaunch) {
      return
    }

    if (toolOutput.output && typeof toolOutput.output === "string") {
      const gitStats = collectGitDiffStats(ctx.directory)
      const fileChanges = formatFileChanges(gitStats)
      const subagentSessionId = extractSessionIdFromOutput(toolOutput.output)

      const boulderState = readBoulderState(ctx.directory)
      if (boulderState) {
        const progress = getPlanProgress(boulderState.active_plan)

        if (toolInput.sessionID && !boulderState.session_ids?.includes(toolInput.sessionID)) {
          appendSessionId(ctx.directory, toolInput.sessionID)
          log(`[${HOOK_NAME}] Appended session to boulder`, {
            sessionID: toolInput.sessionID,
            plan: boulderState.plan_name,
          })
        }

        // Preserve original subagent response - critical for debugging failed tasks
        const originalResponse = toolOutput.output

        toolOutput.output = `
## SUBAGENT WORK COMPLETED

${fileChanges}

---

**Subagent Response:**

${originalResponse}

<system-reminder>
${buildOrchestratorReminder(boulderState.plan_name, progress, subagentSessionId)}
</system-reminder>`

        log(`[${HOOK_NAME}] Output transformed for orchestrator mode (boulder)`, {
          plan: boulderState.plan_name,
          progress: `${progress.completed}/${progress.total}`,
          fileCount: gitStats.length,
        })
      } else {
        toolOutput.output += `\n<system-reminder>\n${buildStandaloneVerificationReminder(subagentSessionId)}\n</system-reminder>`

        log(`[${HOOK_NAME}] Verification reminder appended for orchestrator`, {
          sessionID: toolInput.sessionID,
          fileCount: gitStats.length,
        })
      }
    }
  }
}
