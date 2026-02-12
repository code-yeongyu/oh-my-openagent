import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ExecutorContext, SessionMessage } from "./executor-types"
import { isPlanFamily } from "./constants"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import { getTaskToastManager } from "../../features/task-toast-manager"
import { getAgentToolRestrictions } from "../../shared/agent-tool-restrictions"
import { getMessageDir } from "../../shared/session-utils"
import { promptWithModelSuggestionRetry } from "../../shared/model-suggestion-retry"
import { findNearestMessageWithFields } from "../../features/hook-message-injector"
import { formatDuration } from "./time-formatter"
import { syncContinuationDeps, type SyncContinuationDeps } from "./sync-continuation-deps"

export async function executeSyncContinuation(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  deps: SyncContinuationDeps = syncContinuationDeps
): Promise<string> {
  const { client } = executorCtx
  const toastManager = getTaskToastManager()
  const taskId = `resume_sync_${args.session_id!.slice(0, 8)}`
  const startTime = new Date()

  if (toastManager) {
    toastManager.addTask({
      id: taskId,
      description: args.description,
      agent: "continue",
      isBackground: false,
    })
  }

  const syncContMeta = {
    title: `Continue: ${args.description}`,
    metadata: {
      prompt: args.prompt,
      load_skills: args.load_skills,
      description: args.description,
      run_in_background: args.run_in_background,
      sessionId: args.session_id,
      sync: true,
      command: args.command,
    },
  }
  await ctx.metadata?.(syncContMeta)
  if (ctx.callID) {
    storeToolMetadata(ctx.sessionID, ctx.callID, syncContMeta)
  }

  let resumeAgent: string | undefined
  let resumeModel: { providerID: string; modelID: string } | undefined
  let resumeVariant: string | undefined
  let anchorMessageCount: number | undefined

  try {
    try {
      const messagesResp = await client.session.messages({ path: { id: args.session_id! } })
      const messages = (messagesResp.data ?? []) as SessionMessage[]
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
      const resumeMessageDir = getMessageDir(args.session_id!)
      const resumeMessage = resumeMessageDir ? findNearestMessageWithFields(resumeMessageDir) : null
      resumeAgent = resumeMessage?.agent
      resumeModel = resumeMessage?.model?.providerID && resumeMessage?.model?.modelID
        ? { providerID: resumeMessage.model.providerID, modelID: resumeMessage.model.modelID }
        : undefined
      resumeVariant = resumeMessage?.model?.variant
    }

    const allowTask = isPlanFamily(resumeAgent)

    await promptWithModelSuggestionRetry(client, {
      path: { id: args.session_id! },
      body: {
        ...(resumeAgent !== undefined ? { agent: resumeAgent } : {}),
        ...(resumeModel !== undefined ? { model: resumeModel } : {}),
        ...(resumeVariant !== undefined ? { variant: resumeVariant } : {}),
        tools: {
          ...(resumeAgent ? getAgentToolRestrictions(resumeAgent) : {}),
          task: allowTask,
          call_omo_agent: true, // Intentionally overrides restrictions - continuation context needs delegation capability even for restricted agents
          question: false,
        },
        parts: [{ type: "text", text: args.prompt }],
      },
    })
   } catch (promptError) {
     if (toastManager) {
       toastManager.removeTask(taskId)
     }
     const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
     return `Failed to send continuation prompt: ${errorMessage}\n\nSession ID: ${args.session_id}`
   }

    try {
      const pollError = await deps.pollSyncSession(ctx, client, {
        sessionID: args.session_id!,
        agentToUse: resumeAgent ?? "continue",
        toastManager,
        taskId,
        anchorMessageCount,
      })
      if (pollError) {
        return pollError
      }

      const result = await deps.fetchSyncResult(client, args.session_id!, anchorMessageCount)
      if (!result.ok) {
        return result.error
      }

     const duration = formatDuration(startTime)

     return `Task continued and completed in ${duration}.

---

${result.textContent || "(No text output)"}

<task_metadata>
session_id: ${args.session_id}
${resumeAgent ? `subagent: ${resumeAgent}\n` : ""}</task_metadata>`
   } finally {
     if (toastManager) {
       toastManager.removeTask(taskId)
     }
   }
}
