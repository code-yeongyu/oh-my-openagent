import type { PluginInput } from "@opencode-ai/plugin"
import {
  endTaskTimer,
  getPlanProgress,
  getTaskSessionState,
  getWorkForSession,
  readBoulderState,
  resolveBoulderPlanPath,
  resolveBoulderPlanPathForWork,
  startTaskTimer,
  upsertTaskSessionState,
} from "../../features/boulder-state"
import { collectGitDiffStats, formatFileChanges } from "../../shared/git-worktree"
import { log } from "../../shared/logger"
import { syncBackgroundLaunchSessionTracking } from "./background-launch-session-tracking"
import { HOOK_NAME } from "./hook-name"
import { buildSubagentCompletionReminder } from "./subagent-completion-reminder"
import { extractSessionIdFromOutput, validateSubagentSessionId } from "./subagent-session-id"
import { resolvePreferredSessionId, resolveTaskContext } from "./task-context"
import { isTrackedTaskChecked } from "./tool-execute-after-plan-tasks"
import type { PendingTaskRef, SessionState, ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types"
import { buildStandaloneVerificationReminder } from "./verification-reminders"

function isBackgroundLaunchOutput(output: string): boolean {
  return output.includes("Background task launched") || output.includes("Background task continued")
    || output.includes("Background delegate launched")
    || output.includes("Background agent task launched")
}

function isBackgroundOutputIncompleteReport(toolName: string, output: string): boolean {
  if (toolName !== "background_output") return false
  const trimmedOutput = output.trimStart()
  const incompleteStatus = "(?:pending|running|error|cancelled|interrupt)"
  const taskStatusTable = new RegExp(
    `^# Task Status\\b[\\s\\S]*\\|\\s*Status\\s*\\|\\s*\\*\\*${incompleteStatus}\\*\\*\\s*\\|`,
  )
  const fullSessionStatusReport = new RegExp(`^# Full Session Output\\b[\\s\\S]*^Status:\\s*${incompleteStatus}\\s*$`, "m")
  const bareStatusReport = new RegExp(`^Status:\\s*${incompleteStatus}\\s*$`)

  return taskStatusTable.test(trimmedOutput)
    || fullSessionStatusReport.test(trimmedOutput)
    || bareStatusReport.test(trimmedOutput)
    || trimmedOutput.startsWith("Error fetching messages:")
}

export async function handleSubagentCompletionAfter(input: {
  ctx: PluginInput
  pendingTaskRefs: Map<string, PendingTaskRef>
  autoCommit: boolean
  getState: (sessionID: string) => SessionState
  collectGitDiffStats: typeof collectGitDiffStats
  formatFileChanges: typeof formatFileChanges
  toolInput: ToolExecuteAfterInput
  toolOutput: ToolExecuteAfterOutput
  metadataSessionId: string | undefined
}): Promise<void> {
  const {
    ctx,
    pendingTaskRefs,
    autoCommit,
    getState,
    collectGitDiffStats: collectGitDiffStatsImpl,
    formatFileChanges: formatFileChangesImpl,
    toolInput,
    toolOutput,
    metadataSessionId,
  } = input
  const outputStr = typeof toolOutput.output === "string" ? toolOutput.output : ""
  const pendingTaskRef = toolInput.callID ? pendingTaskRefs.get(toolInput.callID) : undefined
  if (toolInput.callID) {
    pendingTaskRefs.delete(toolInput.callID)
  }

  const boulderState = readBoulderState(ctx.directory)
  if (isBackgroundLaunchOutput(outputStr)) {
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

  if (outputStr.length === 0) {
    return
  }
  if (isBackgroundOutputIncompleteReport(toolInput.tool, outputStr)) {
    return
  }

  const worktreePath = boulderState?.worktree_path?.trim()
  const verificationDirectory = worktreePath ? worktreePath : ctx.directory
  const gitStats = collectGitDiffStatsImpl(verificationDirectory)
  const fileChanges = formatFileChangesImpl(gitStats)
  const extractedSessionId = metadataSessionId ?? extractSessionIdFromOutput(outputStr)

  if (!boulderState) {
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
    return
  }

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

  const originalResponse = toolOutput.output
  if (sessionState) {
    if (sessionState.activeContinuationPlanPath !== undefined
      && sessionState.activeContinuationPlanPath !== planPath) {
      sessionState.verifiedTaskKeys = undefined
    }
  }
  const isAlreadyVerified = currentTask
    ? isTrackedTaskChecked(planPath, currentTask.key)
      || sessionState?.verifiedTaskKeys?.has(currentTask.key) === true
    : false
  const reminderDecision = await buildSubagentCompletionReminder({
    ctx,
    planPath,
    planName: workScopedBoulderState.plan_name,
    progress,
    preferredSessionId,
    originalResponse,
    orchestratorSessionId: toolInput.sessionID,
    currentTask,
    sessionState,
    isAlreadyVerified,
    autoCommit,
  })

  toolOutput.output = `
<system-reminder>
${reminderDecision.leadReminder}
</system-reminder>

## SUBAGENT WORK COMPLETED

${fileChanges}

---

**Subagent Response:**

${originalResponse}

${
  reminderDecision.followupReminder === null
    ? ""
    : `<system-reminder>\n${reminderDecision.followupReminder}\n</system-reminder>`
}`
  log(`[${HOOK_NAME}] Output transformed for orchestrator mode (boulder)`, {
    plan: workScopedBoulderState.plan_name,
    progress: `${progress.completed}/${progress.total}`,
    fileCount: gitStats.length,
    preferredSessionId,
    waitingForFinalWaveApproval: sessionState?.waitingForFinalWaveApproval === true,
    isMissingFinalWaveVerdict: reminderDecision.isMissingFinalWaveVerdict,
    isRejectedFinalWaveVerdict: reminderDecision.isRejectedFinalWaveVerdict,
    isAlreadyVerified,
  })
}
