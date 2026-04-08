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

  const extractedSessionId = metadataSessionId ?? extractSessionIdFromOutput(toolOutput.output)
  const lineageSessionIDs = boulderState.session_ids
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

  appendSessionId(ctx.directory, trackedSessionId, "appended")

  const { currentTask, shouldSkipTaskSessionUpdate } = resolveTaskContext(
    pendingTaskRef,
    boulderState.active_plan,
  )

  if (currentTask && !shouldSkipTaskSessionUpdate) {
    upsertTaskSessionState(ctx.directory, {
      taskKey: currentTask.key,
      taskLabel: currentTask.label,
      taskTitle: currentTask.title,
      sessionId: trackedSessionId,
      agent: typeof toolOutput.metadata?.agent === "string" ? toolOutput.metadata.agent : undefined,
      category: typeof toolOutput.metadata?.category === "string" ? toolOutput.metadata.category : undefined,
    })
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
