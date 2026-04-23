import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ExecutorContext, ParentContext, SessionMessage } from "./executor-types"
import { isPlanFamily } from "./constants"
import { publishToolMetadata } from "../../features/tool-metadata-store"
import { getTaskToastManager } from "../../features/task-toast-manager"
import { getAgentToolRestrictions } from "../../shared/agent-tool-restrictions"
import { getMessageDir, normalizeSDKResponse } from "../../shared"
import { promptWithModelSuggestionRetry } from "../../shared/model-suggestion-retry"
import { resolveMessageContext } from "../../features/hook-message-injector"
import { formatDuration } from "./time-formatter"
import { syncContinuationDeps, type SyncContinuationDeps } from "./sync-continuation-deps"
import { setSessionTools } from "../../shared/session-tools-store"
import { buildTaskPrompt } from "./prompt-builder"
import { buildTaskMetadataBlock } from "../../features/tool-metadata-store/task-metadata-contract"
import { getTaskID } from "./task-id"
import { resolveMetadataModel } from "./resolve-metadata-model"

type ResumeModel = { providerID: string; modelID: string }

type ResumeContext = {
  resumeAgent?: string
  resumeModel?: ResumeModel
  resumeVariant?: string
  anchorMessageCount?: number
}

async function resolveResumeContext(
  client: ExecutorContext["client"],
  continuationID: string
): Promise<ResumeContext> {
  try {
    const messagesResp = await client.session.messages({ path: { id: continuationID } })
    const messages = normalizeSDKResponse(messagesResp, [] as SessionMessage[])

    for (let index = messages.length - 1; index >= 0; index--) {
      const info = messages[index].info
      if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
        return {
          resumeAgent: info.agent,
          resumeModel: info.model ?? (info.providerID && info.modelID
            ? { providerID: info.providerID, modelID: info.modelID }
            : undefined),
          resumeVariant: info.variant,
          anchorMessageCount: messages.length,
        }
      }
    }

    return { anchorMessageCount: messages.length }
  } catch {
    const resumeMessageDir = getMessageDir(continuationID)
    const { prevMessage } = await resolveMessageContext(continuationID, client, resumeMessageDir)
    const resumeMessageModel = prevMessage?.model

    return {
      resumeAgent: prevMessage?.agent,
      resumeModel: resumeMessageModel?.providerID && resumeMessageModel.modelID
        ? { providerID: resumeMessageModel.providerID, modelID: resumeMessageModel.modelID }
        : undefined,
      resumeVariant: resumeMessageModel?.variant,
    }
  }
}

export async function executeSyncContinuation(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext,
  deps: SyncContinuationDeps = syncContinuationDeps,
  systemContent?: string
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

  let resumeAgent: string | undefined
  let resumeModel: ResumeModel | undefined
  let resumeVariant: string | undefined
  let anchorMessageCount: number | undefined

  try {
    const resumeContext = await resolveResumeContext(client, continuationID)
    resumeAgent = resumeContext.resumeAgent
    resumeModel = resumeContext.resumeModel
    resumeVariant = resumeContext.resumeVariant
    anchorMessageCount = resumeContext.anchorMessageCount

    const resumeModelForMetadata = resumeModel && resumeVariant !== undefined
      ? { ...resumeModel, variant: resumeVariant }
      : resumeModel

    const syncContMeta = {
      title: `Continue: ${args.description}`,
      metadata: {
        prompt: args.prompt,
        ...(resumeAgent !== undefined ? { agent: resumeAgent } : {}),
        ...(args.category !== undefined ? { category: args.category } : {}),
        ...(args.requested_subagent_type !== undefined ? { requested_subagent_type: args.requested_subagent_type } : {}),
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        taskId: continuationID,
        sessionId: continuationID,
        sync: true,
        command: args.command,
        model: resolveMetadataModel(resumeModelForMetadata, parentContext.model),
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
        system: systemContent,
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
        category: args.category,
      })}`
   } finally {
     if (toastManager) {
       toastManager.removeTask(taskId)
     }
   }
}
