import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ExecutorContext, ParentContext, SessionMessage } from "./executor-types"
import { isPlanFamily } from "./constants"
import { publishToolMetadata } from "../../features/tool-metadata-store"
import { getTaskToastManager } from "../../features/task-toast-manager"
import { getAgentToolRestrictions } from "../../shared/agent-tool-restrictions"
import { getMessageDir } from "../../shared"
import { promptWithModelSuggestionRetry } from "../../shared/model-suggestion-retry"
import { findNearestMessageWithFields } from "../../features/hook-message-injector"
import { formatDuration } from "./time-formatter"
import { syncContinuationDeps, type SyncContinuationDeps } from "./sync-continuation-deps"
import { setSessionTools } from "../../shared/session-tools-store"
import { normalizeSDKResponse } from "../../shared"
import { buildTaskPrompt } from "./prompt-builder"
import { buildTaskMetadataBlock } from "../../features/tool-metadata-store/task-metadata-contract"
import { getTaskID } from "./task-id"
import { resolveMetadataModel } from "./resolve-metadata-model"

export async function executeSyncContinuation(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext,
  deps: SyncContinuationDeps = syncContinuationDeps
): Promise<string> {
  const { client, syncPollTimeoutMs, sisyphusAgentConfig } = executorCtx
  const toastManager = getTaskToastManager()
  const continuationID = getTaskID(args)
  if (!continuationID) {
    throw new Error("task_id is required to continue a sync task")
  }
  const taskId = `resume_sync_${continuationID.slice(0, 8)}`
  const startTime = new Date()

  if (toastManager) {
    toastManager.addTask({
      id: taskId,
      description: args.description,
      agent: "continue",
      isBackground: false,
    })
  }

  let syncContMeta: { title: string; metadata: Record<string, unknown> } | undefined

  let resumeAgent: string | undefined
  let resumeModel: { providerID: string; modelID: string } | undefined
  let resumeVariant: string | undefined
  let anchorMessageCount: number | undefined

  try {
    try {
      const messagesResp = await client.session.messages({ path: { id: continuationID } })
      const messages = normalizeSDKResponse(messagesResp, [] as SessionMessage[])
      anchorMessageCount = messages.length
      for (let i = messages.length - 1; i >= 0; i--) {
        const info = messages[i].info
        if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
          resumeAgent = info.agent
          resumeModel = info.model ?? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined)
          resumeVariant = info.variant
          break
        }
      }
    } catch {
      const resumeMessageDir = getMessageDir(continuationID)
      const resumeMessage = resumeMessageDir ? findNearestMessageWithFields(resumeMessageDir) : null
      resumeAgent = resumeMessage?.agent
      resumeModel = resumeMessage?.model?.providerID && resumeMessage?.model?.modelID
        ? { providerID: resumeMessage.model.providerID, modelID: resumeMessage.model.modelID }
        : undefined
      resumeVariant = resumeMessage?.model?.variant
    }

    syncContMeta = {
      title: `Continue: ${args.description}`,
      metadata: {
        prompt: args.prompt,
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        taskId: continuationID,
        sessionId: continuationID,
        sync: true,
        command: args.command,
        model: resolveMetadataModel(resumeModel, parentContext.model),
      },
    }
    await publishToolMetadata(ctx, syncContMeta)

    const allowTask = isPlanFamily(resumeAgent)
    const tddEnabled = sisyphusAgentConfig?.tdd
    const effectivePrompt = buildTaskPrompt(args.prompt, resumeAgent, tddEnabled)
    const tools = {
      task: allowTask,
      call_omo_agent: true,
      question: false,
      ...(resumeAgent ? getAgentToolRestrictions(resumeAgent) : {}),
    }
    setSessionTools(continuationID, tools)

    await promptWithModelSuggestionRetry(client, {
      path: { id: continuationID },
      body: {
        ...(resumeAgent !== undefined ? { agent: resumeAgent } : {}),
        ...(resumeModel !== undefined ? { model: resumeModel } : {}),
        ...(resumeVariant !== undefined ? { variant: resumeVariant } : {}),
        tools,
        parts: [{ type: "text", text: effectivePrompt }],
      },
    })
   } catch (promptError) {
     if (toastManager) {
       toastManager.removeTask(taskId)
     }
     const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
     return `Failed to send continuation prompt: ${errorMessage}\n\nTask ID: ${continuationID}`
   }

    try {
      const pollError = await deps.pollSyncSession(ctx, client, {
        sessionID: continuationID,
        agentToUse: resumeAgent ?? "continue",
        toastManager,
        taskId,
        anchorMessageCount,
      }, syncPollTimeoutMs)
      if (pollError) {
        return pollError
      }

      const result = await deps.fetchSyncResult(client, continuationID, anchorMessageCount)
      if (!result.ok) {
        return result.error
      }

     const duration = formatDuration(startTime)

     return `Task continued and completed in ${duration}.

---

${result.textContent || "(No text output)"}

${buildTaskMetadataBlock({
        sessionId: continuationID,
        taskId: continuationID,
        agent: resumeAgent,
      })}`
   } finally {
     if (toastManager) {
       toastManager.removeTask(taskId)
     }
   }
}
