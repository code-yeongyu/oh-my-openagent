import type { PluginInput } from "@opencode-ai/plugin"
import {
  endTaskTimer,
  getWorkForSession,
  getPlanProgress,
  getTaskSessionState,
  readBoulderState,
  resolveBoulderPlanPath,
  resolveBoulderPlanPathForWork,
  startTaskTimer,
  upsertTaskSessionState,
} from "../../features/boulder-state"
import { existsSync, readFileSync } from "node:fs"
import { log } from "../../shared/logger"
import { isCallerOrchestrator } from "../../shared/session-utils"
import { syncBackgroundLaunchSessionTracking } from "./background-launch-session-tracking"
import { collectGitDiffStats, formatFileChanges } from "../../shared/git-worktree"
import { shouldPauseForFinalWaveApproval } from "./final-wave-approval-gate"
import { HOOK_NAME } from "./hook-name"
import { DIRECT_WORK_REMINDER } from "./system-reminder-templates"
import { isSisyphusPath } from "./sisyphus-path"
import { resolvePreferredSessionId, resolveTaskContext } from "./task-context"
import { extractSessionIdFromMetadata, extractSessionIdFromOutput, validateSubagentSessionId } from "./subagent-session-id"
import {
  buildCompletionGate,
  buildFinalWaveApprovalReminder,
  buildOrchestratorReminder,
  buildStandaloneVerificationReminder,
} from "./verification-reminders"
import { isWriteOrEditToolName } from "./write-edit-tool-policy"
import type { PendingTaskRef, SessionState } from "./types"
import type { ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types"

function isTrackedTaskChecked(planPath: string, taskKey: string): boolean {
  if (!existsSync(planPath)) {
    return false
  }

  const [section, label] = taskKey.split(":")
  if (!section || !label) {
    return false
  }

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const matcher = section === "todo"
    ? new RegExp(`^\\s*[-*]\\s*\\[[xX]\\]\\s*${escapedLabel}\\.\\s+`, "m")
    : section === "final-wave"
      ? new RegExp(`^\\s*[-*]\\s*\\[[xX]\\]\\s*${escapedLabel.toUpperCase()}\\.\\s+`, "m")
      : null
  if (!matcher) {
    return false
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    return matcher.test(content)
  } catch {
    return false
  }
}

export function createToolExecuteAfterHandler(input: {
  ctx: PluginInput
  pendingFilePaths: Map<string, string>
  pendingTaskRefs: Map<string, PendingTaskRef>
  autoCommit: boolean
  getState: (sessionID: string) => SessionState
  isCallerOrchestrator?: (sessionID: string | undefined) => Promise<boolean>
}): (toolInput: ToolExecuteAfterInput, toolOutput: ToolExecuteAfterOutput | undefined) => Promise<void> {
  const { ctx, pendingFilePaths, pendingTaskRefs, autoCommit, getState } = input
  const resolveIsCallerOrchestrator = input.isCallerOrchestrator ?? ((sessionID) => isCallerOrchestrator(sessionID, ctx.client))
  return async (toolInput, toolOutput): Promise<void> => {
    // Guard against undefined output (e.g., from /review command - see issue #1035)
    if (!toolOutput) {
      return
    }

    if (!(await resolveIsCallerOrchestrator(toolInput.sessionID))) {
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

    const metadataSessionId = extractSessionIdFromMetadata(toolOutput.metadata)
    const isPluginToolWithSession = toolInput.tool !== "task" && !!metadataSessionId
    if (toolInput.tool !== "task" && !isPluginToolWithSession) {
      return
    }

    const outputStr = toolOutput.output && typeof toolOutput.output === "string" ? toolOutput.output : ""
    const pendingTaskRef = toolInput.callID ? pendingTaskRefs.get(toolInput.callID) : undefined
    if (toolInput.callID) {
      pendingTaskRefs.delete(toolInput.callID)
    }
    const boulderState = readBoulderState(ctx.directory)
    const isBackgroundLaunch = outputStr.includes("Background task launched") || outputStr.includes("Background task continued")
      || outputStr.includes("Background delegate launched")
      || outputStr.includes("Background agent task launched")
    if (isBackgroundLaunch) {
      await syncBackgroundLaunchSessionTracking({
        ctx,
        boulderState,
        toolInput,
        toolOutput,
        pendingTaskRef,
        metadataSessionId,
      })
      return
    }

    if (toolOutput.output && typeof toolOutput.output === "string") {
      const worktreePath = boulderState?.worktree_path?.trim()
      const verificationDirectory = worktreePath ? worktreePath : ctx.directory
      const gitStats = collectGitDiffStats(verificationDirectory)
      const fileChanges = formatFileChanges(gitStats)
      const extractedSessionId = metadataSessionId ?? extractSessionIdFromOutput(toolOutput.output)

      if (boulderState) {
        const sessionWork = toolInput.sessionID
          ? getWorkForSession(ctx.directory, toolInput.sessionID)
          : null
        const planPath = sessionWork
          ? resolveBoulderPlanPathForWork(ctx.directory, sessionWork)
          : resolveBoulderPlanPath(ctx.directory, boulderState)
        const workScopedBoulderState = sessionWork
          ? {
              ...boulderState,
              active_plan: sessionWork.active_plan,
              plan_name: sessionWork.plan_name,
              status: sessionWork.status,
              started_at: sessionWork.started_at,
              ended_at: sessionWork.ended_at,
              elapsed_ms: sessionWork.elapsed_ms,
              updated_at: sessionWork.updated_at,
              session_ids: [...sessionWork.session_ids],
              session_origins: sessionWork.session_origins ? { ...sessionWork.session_origins } : {},
              agent: sessionWork.agent,
              worktree_path: sessionWork.worktree_path,
              task_sessions: sessionWork.task_sessions ? { ...sessionWork.task_sessions } : {},
            }
          : boulderState
        const progress = getPlanProgress(planPath)
        const {
          currentTask,
          shouldSkipTaskSessionUpdate,
          shouldIgnoreCurrentSessionId,
        } = resolveTaskContext(pendingTaskRef, planPath)
        const trackedTaskSession = currentTask
          ? getTaskSessionState(ctx.directory, currentTask.key)
          : null
        const sessionState = toolInput.sessionID ? getState(toolInput.sessionID) : undefined

        const lineageSessionIDs = sessionWork?.session_ids ?? boulderState.session_ids
        const subagentSessionId = await validateSubagentSessionId({
          client: ctx.client,
          sessionID: extractedSessionId,
          lineageSessionIDs,
        })

        if (currentTask && subagentSessionId && !shouldSkipTaskSessionUpdate) {
          if (sessionWork) {
            startTaskTimer(ctx.directory, sessionWork.work_id, {
              taskKey: currentTask.key,
              taskLabel: currentTask.label,
              taskTitle: currentTask.title,
              sessionId: subagentSessionId,
              agent: typeof toolOutput.metadata?.agent === "string" ? toolOutput.metadata.agent : undefined,
              category: typeof toolOutput.metadata?.category === "string" ? toolOutput.metadata.category : undefined,
            })
            if (isTrackedTaskChecked(planPath, currentTask.key)) {
              endTaskTimer(ctx.directory, sessionWork.work_id, currentTask.key)
            }
          } else {
            upsertTaskSessionState(ctx.directory, {
              taskKey: currentTask.key,
              taskLabel: currentTask.label,
              taskTitle: currentTask.title,
              sessionId: subagentSessionId,
              agent: typeof toolOutput.metadata?.agent === "string" ? toolOutput.metadata.agent : undefined,
              category: typeof toolOutput.metadata?.category === "string" ? toolOutput.metadata.category : undefined,
            })
          }
        }

        const preferredSessionId = resolvePreferredSessionId(
          shouldIgnoreCurrentSessionId ? undefined : subagentSessionId,
          trackedTaskSession?.session_id,
        )

        // Preserve original subagent response - critical for debugging failed tasks
        const originalResponse = toolOutput.output
        const shouldPauseForApproval = sessionState
          ? shouldPauseForFinalWaveApproval({
              planPath,
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
          ? buildFinalWaveApprovalReminder(workScopedBoulderState.plan_name, progress, preferredSessionId)
          : buildCompletionGate(workScopedBoulderState.plan_name, preferredSessionId)
        const followupReminder = shouldPauseForApproval
          ? null
          : buildOrchestratorReminder(workScopedBoulderState.plan_name, progress, preferredSessionId, autoCommit, false)

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
          plan: workScopedBoulderState.plan_name,
          progress: `${progress.completed}/${progress.total}`,
          fileCount: gitStats.length,
          preferredSessionId,
          waitingForFinalWaveApproval: shouldPauseForApproval,
        })
      } else {
        const lineageSessionIDs = toolInput.sessionID ? [toolInput.sessionID] : []
        const subagentSessionId = await validateSubagentSessionId({
          client: ctx.client,
          sessionID: extractedSessionId,
          lineageSessionIDs,
        })
        const preferredSessionId = pendingTaskRef?.kind === "skip"
          ? undefined
          : subagentSessionId
        toolOutput.output += `\n<system-reminder>\n${buildStandaloneVerificationReminder(
          resolvePreferredSessionId(preferredSessionId),
        )}\n</system-reminder>`

        log(`[${HOOK_NAME}] Verification reminder appended for orchestrator`, {
          sessionID: toolInput.sessionID,
          fileCount: gitStats.length,
        })
      }
    }
  }
}
