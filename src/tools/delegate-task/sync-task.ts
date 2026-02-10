import type { ModelFallbackInfo } from "../../features/task-toast-manager/types"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { getTaskToastManager } from "../../features/task-toast-manager"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import { subagentSessions } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { formatDuration } from "./time-formatter"
import { formatDetailedError } from "./error-formatting"
import { syncTaskDeps, type SyncTaskDeps } from "./sync-task-deps"

export async function executeSyncTask(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext,
  agentToUse: string,
  categoryModel: { providerID: string; modelID: string; variant?: string } | undefined,
  systemContent: string | undefined,
  modelInfo?: ModelFallbackInfo,
  deps: SyncTaskDeps = syncTaskDeps
): Promise<string> {
  const { client, directory, onSyncSessionCreated } = executorCtx
  const toastManager = getTaskToastManager()
  let taskId: string | undefined
  let syncSessionID: string | undefined

  try {
    const createSessionResult = await deps.createSyncSession(client, {
      parentSessionID: parentContext.sessionID,
      agentToUse,
      description: args.description,
      defaultDirectory: directory,
    })

    if (!createSessionResult.ok) {
      return createSessionResult.error
    }

    const sessionID = createSessionResult.sessionID
    syncSessionID = sessionID
    subagentSessions.add(sessionID)

    if (onSyncSessionCreated) {
      log("[task] Invoking onSyncSessionCreated callback", { sessionID, parentID: parentContext.sessionID })
      await onSyncSessionCreated({
        sessionID,
        parentID: parentContext.sessionID,
        title: args.description,
      }).catch((err) => {
      log("[task] onSyncSessionCreated callback failed", { error: String(err) })
      })
      await new Promise(r => setTimeout(r, 200))
    }

    taskId = `sync_${sessionID.slice(0, 8)}`
    const startTime = new Date()

    if (toastManager) {
      toastManager.addTask({
        id: taskId,
        description: args.description,
        agent: agentToUse,
        isBackground: false,
        category: args.category,
        skills: args.load_skills,
        modelInfo,
      })
    }

    const syncTaskMeta = {
      title: args.description,
      metadata: {
        prompt: args.prompt,
        agent: agentToUse,
        category: args.category,
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        sessionId: sessionID,
        sync: true,
        command: args.command,
      },
    }
    await ctx.metadata?.(syncTaskMeta)
    if (ctx.callID) {
      storeToolMetadata(ctx.sessionID, ctx.callID, syncTaskMeta)
    }

    const promptError = await deps.sendSyncPrompt(client, {
      sessionID,
      agentToUse,
      args,
      systemContent,
      categoryModel,
      toastManager,
      taskId,
    })
    if (promptError) {
      return promptError
    }

    try {
      const pollError = await deps.pollSyncSession(ctx, client, {
        sessionID,
        agentToUse,
        toastManager,
        taskId,
      })
      if (pollError) {
        return pollError
      }

      const result = await deps.fetchSyncResult(client, sessionID)
      if (!result.ok) {
        return result.error
      }

      const duration = formatDuration(startTime)

      return `Task completed in ${duration}.

Agent: ${agentToUse}${args.category ? ` (category: ${args.category})` : ""}

---

${result.textContent || "(No text output)"}

<task_metadata>
session_id: ${sessionID}
</task_metadata>`
    } finally {
      if (toastManager && taskId !== undefined) {
        toastManager.removeTask(taskId)
      }
    }
  } catch (error) {
    return formatDetailedError(error, {
      operation: "Execute task",
      args,
      sessionID: syncSessionID,
      agent: agentToUse,
      category: args.category,
    })
  } finally {
    if (syncSessionID) {
      subagentSessions.delete(syncSessionID)
    }
  }
}
