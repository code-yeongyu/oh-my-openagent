import type { PluginInput } from "@opencode-ai/plugin"
import {
  appendSessionId,
  appendSessionIdForWork,
  getWorkForSession,
  type BoulderState,
  resolveBoulderPlanPath,
  resolveBoulderPlanPathForWork,
  upsertTaskSessionState,
  upsertTaskSessionStateForWork,
} from "../../features/boulder-state"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./hook-name"
import { extractSessionIdFromOutput, validateSubagentSessionId } from "./subagent-session-id"
import { resolveTaskContext } from "./task-context"
import type { PendingTaskRef, ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types"

export async function syncBackgroundLaunchSessionTracking(input: {
  ctx: PluginInput
  boulderState: BoulderState | null
  toolInput: ToolExecuteAfterInput
  toolOutput: ToolExecuteAfterOutput
  pendingTaskRef: PendingTaskRef | undefined
  metadataSessionId?: string
}): Promise<void> {
  const { ctx, boulderState, toolInput, toolOutput, pendingTaskRef, metadataSessionId } = input
  if (!boulderState) {
    return
  }

  if (typeof toolInput.sessionID !== "string") {
    return
  }

  const trackedWork = getWorkForSession(ctx.directory, toolInput.sessionID)
  const extractedSessionId = metadataSessionId ?? extractSessionIdFromOutput(toolOutput.output)
  const lineageSessionIDs = trackedWork?.session_ids ?? boulderState.session_ids
  const subagentSessionId = await validateSubagentSessionId({
    client: ctx.client,
    sessionID: extractedSessionId,
    lineageSessionIDs,
  })

  const trackedSessionId = subagentSessionId ?? await resolveFallbackTrackedSessionId({
    ctx,
    extractedSessionId,
    lineageSessionIDs,
  })
  if (!trackedSessionId) {
    return
  }

  if (trackedWork) {
    appendSessionIdForWork(ctx.directory, trackedWork.work_id, trackedSessionId, "appended")
  } else {
    appendSessionId(ctx.directory, trackedSessionId, "appended")
  }

  const { currentTask, shouldSkipTaskSessionUpdate } = resolveTaskContext(
    pendingTaskRef,
    trackedWork
      ? resolveBoulderPlanPathForWork(ctx.directory, trackedWork)
      : resolveBoulderPlanPath(ctx.directory, boulderState),
  )

  if (currentTask && !shouldSkipTaskSessionUpdate) {
    if (trackedWork) {
      upsertTaskSessionStateForWork(ctx.directory, trackedWork.work_id, {
        taskKey: currentTask.key,
        taskLabel: currentTask.label,
        taskTitle: currentTask.title,
        sessionId: trackedSessionId,
        agent: typeof toolOutput.metadata?.agent === "string" ? toolOutput.metadata.agent : undefined,
        category: typeof toolOutput.metadata?.category === "string" ? toolOutput.metadata.category : undefined,
      })
    } else {
      upsertTaskSessionState(ctx.directory, {
        taskKey: currentTask.key,
        taskLabel: currentTask.label,
        taskTitle: currentTask.title,
        sessionId: trackedSessionId,
        agent: typeof toolOutput.metadata?.agent === "string" ? toolOutput.metadata.agent : undefined,
        category: typeof toolOutput.metadata?.category === "string" ? toolOutput.metadata.category : undefined,
      })
    }
  }

  log(`[${HOOK_NAME}] Background launch session tracked`, {
    sessionID: toolInput.sessionID,
    subagentSessionId: trackedSessionId,
    taskKey: currentTask?.key,
  })
}

async function resolveFallbackTrackedSessionId(input: {
  ctx: PluginInput
  extractedSessionId?: string
  lineageSessionIDs: string[]
}): Promise<string | undefined> {
  if (!input.extractedSessionId) {
    return undefined
  }

  try {
    const session = await input.ctx.client.session.get({ path: { id: input.extractedSessionId } })
    const parentSessionId = session.data?.parentID
    if (typeof parentSessionId === "string" && input.lineageSessionIDs.includes(parentSessionId)) {
      return input.extractedSessionId
    }
    return undefined
  } catch {
    return undefined
  }
}

async function resolveSessionOrigin(
  ctx: PluginInput,
  sessionID: string,
): Promise<"direct" | "appended"> {
  try {
    const session = await ctx.client.session.get({ path: { id: sessionID } })
    return typeof session.data?.parentID === "string" && session.data.parentID.length > 0
      ? "appended"
      : "direct"
  } catch {
    return "appended"
  }
}
