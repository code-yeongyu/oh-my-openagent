import type { PluginInput } from "@opencode-ai/plugin"
import {
  appendSessionId,
  getPlanProgress,
  getTaskSessionState,
  readBoulderState,
  readCurrentTopLevelTask,
  upsertTaskSessionState,
} from "../../features/boulder-state"
import { log } from "../../shared/logger"
import { isCallerOrchestrator } from "../../shared/session-utils"
import { collectGitDiffStats, formatFileChanges } from "../../shared/git-worktree"
import { shouldPauseForFinalWaveApproval } from "./final-wave-approval-gate"
import { HOOK_NAME } from "./hook-name"
import { DIRECT_WORK_REMINDER } from "./system-reminder-templates"
import { isSisyphusPath } from "./sisyphus-path"
import { extractSessionIdFromOutput } from "./subagent-session-id"
import {
  buildCompletionGate,
  buildFinalWaveApprovalReminder,
  buildOrchestratorReminder,
  buildStandaloneVerificationReminder,
} from "./verification-reminders"
import { isWriteOrEditToolName } from "./write-edit-tool-policy"
import type { SessionState } from "./types"
import type { ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types"

function resolvePreferredSessionId(currentSessionId?: string, trackedSessionId?: string): string {
  return currentSessionId ?? trackedSessionId ?? "<session_id>"
}

export function createToolExecuteAfterHandler(input: {
  ctx: PluginInput
  pendingFilePaths: Map<string, string>
  pendingTaskRefs: Map<string, { key: string; label: string; title: string } | null>
  autoCommit: boolean
  getState: (sessionID: string) => SessionState
}): (toolInput: ToolExecuteAfterInput, toolOutput: ToolExecuteAfterOutput) => Promise<void> {
  const { ctx, pendingFilePaths, pendingTaskRefs, autoCommit, getState } = input
  return async (toolInput, toolOutput): Promise<void> => {
    // Guard against undefined output (e.g., from /review command - see issue #1035)
    if (!toolOutput) {
      return
    }

    if (!(await isCallerOrchestrator(toolInput.sessionID, ctx.client))) {
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
    const pendingTaskRef = toolInput.callID ? pendingTaskRefs.get(toolInput.callID) : undefined
    if (toolInput.callID) {
      pendingTaskRefs.delete(toolInput.callID)
    }
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
        const shouldSkipTaskSessionUpdate = pendingTaskRef === null
        const currentTask = shouldSkipTaskSessionUpdate
          ? null
          : pendingTaskRef ?? readCurrentTopLevelTask(boulderState.active_plan)
        const trackedTaskSession = currentTask
          ? getTaskSessionState(ctx.directory, currentTask.key)
          : null
        const sessionState = toolInput.sessionID ? getState(toolInput.sessionID) : undefined

        if (toolInput.sessionID && !boulderState.session_ids?.includes(toolInput.sessionID)) {
          appendSessionId(ctx.directory, toolInput.sessionID)
          log(`[${HOOK_NAME}] Appended session to boulder`, {
            sessionID: toolInput.sessionID,
            plan: boulderState.plan_name,
          })
        }

        if (currentTask && subagentSessionId) {
          upsertTaskSessionState(ctx.directory, {
            taskKey: currentTask.key,
            taskLabel: currentTask.label,
            taskTitle: currentTask.title,
            sessionId: subagentSessionId,
            agent: toolOutput.metadata?.agent as string | undefined,
            category: toolOutput.metadata?.category as string | undefined,
          })
        }

        const preferredSessionId = resolvePreferredSessionId(
          subagentSessionId,
          trackedTaskSession?.session_id,
        )

        // Preserve original subagent response - critical for debugging failed tasks
        const originalResponse = toolOutput.output
        const shouldPauseForApproval = sessionState
          ? shouldPauseForFinalWaveApproval({
              planPath: boulderState.active_plan,
              taskOutput: originalResponse,
              sessionState,
            })
          : false

        if (sessionState) {
          sessionState.waitingForFinalWaveApproval = shouldPauseForApproval

          if (shouldPauseForApproval && sessionState.pendingRetryTimer) {
            clearTimeout(sessionState.pendingRetryTimer)
            sessionState.pendingRetryTimer = undefined
          }
        }

        const leadReminder = shouldPauseForApproval
          ? buildFinalWaveApprovalReminder(boulderState.plan_name, progress, preferredSessionId)
          : buildCompletionGate(boulderState.plan_name, preferredSessionId)
        const followupReminder = shouldPauseForApproval
          ? null
          : buildOrchestratorReminder(boulderState.plan_name, progress, preferredSessionId, autoCommit, false)

        toolOutput.output = `
<system-reminder>
${leadReminder}
</system-reminder>

## SUBAGENT WORK COMPLETED

${fileChanges}

---

**Subagent Response:**

${originalResponse}

${
  followupReminder === null
    ? ""
    : `<system-reminder>\n${followupReminder}\n</system-reminder>`
}`
        log(`[${HOOK_NAME}] Output transformed for orchestrator mode (boulder)`, {
          plan: boulderState.plan_name,
          progress: `${progress.completed}/${progress.total}`,
          fileCount: gitStats.length,
          preferredSessionId,
          waitingForFinalWaveApproval: shouldPauseForApproval,
        })
      } else {
        toolOutput.output += `\n<system-reminder>\n${buildStandaloneVerificationReminder(
          resolvePreferredSessionId(subagentSessionId),
        )}\n</system-reminder>`

        log(`[${HOOK_NAME}] Verification reminder appended for orchestrator`, {
          sessionID: toolInput.sessionID,
          fileCount: gitStats.length,
        })
      }
    }
  }
}
