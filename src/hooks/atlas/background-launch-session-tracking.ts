import type { PluginInput } from "@opencode-ai/plugin"
import { appendSessionId, type BoulderState, upsertTaskSessionState } from "../../features/boulder-state"
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

  if (toolInput.sessionID && !boulderState.session_ids.includes(toolInput.sessionID)) {
    appendSessionId(ctx.directory, toolInput.sessionID)
  }

  const extractedSessionId = metadataSessionId ?? extractSessionIdFromOutput(toolOutput.output)
  const lineageSessionIDs = toolInput.sessionID && !boulderState.session_ids.includes(toolInput.sessionID)
    ? [...boulderState.session_ids, toolInput.sessionID]
    : boulderState.session_ids
  const subagentSessionId = await validateSubagentSessionId({
    client: ctx.client,
    sessionID: extractedSessionId,
    lineageSessionIDs,
  })

  if (!subagentSessionId) {
    return
  }

  appendSessionId(ctx.directory, subagentSessionId)

  const { currentTask, shouldSkipTaskSessionUpdate } = resolveTaskContext(
    pendingTaskRef,
    boulderState.active_plan,
  )

  if (currentTask && !shouldSkipTaskSessionUpdate) {
    upsertTaskSessionState(ctx.directory, {
      taskKey: currentTask.key,
      taskLabel: currentTask.label,
      taskTitle: currentTask.title,
      sessionId: subagentSessionId,
      agent: typeof toolOutput.metadata?.agent === "string" ? toolOutput.metadata.agent : undefined,
      category: typeof toolOutput.metadata?.category === "string" ? toolOutput.metadata.category : undefined,
    })
  }

  log(`[${HOOK_NAME}] Background launch session tracked`, {
    sessionID: toolInput.sessionID,
    subagentSessionId,
    taskKey: currentTask?.key,
  })
}
