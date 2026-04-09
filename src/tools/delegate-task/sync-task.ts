import type { ModelFallbackInfo } from "../../features/task-toast-manager/types"
import type { DelegateTaskArgs, ToolContextWithMetadata, DelegatedModelConfig } from "./types"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { getTaskToastManager } from "../../features/task-toast-manager"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import { resolveCallID } from "./resolve-call-id"
import { subagentSessions, syncSubagentSessions, setSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { formatDuration } from "./time-formatter"
import { formatDetailedError } from "./error-formatting"
import { syncTaskDeps, type SyncTaskDeps } from "./sync-task-deps"
import { setSessionFallbackChain, clearSessionFallbackChain } from "../../hooks/model-fallback/hook"

export async function executeSyncTask(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext,
  agentToUse: string,
  categoryModel: DelegatedModelConfig | undefined,
  systemContent: string | undefined,
  modelInfo?: ModelFallbackInfo,
  fallbackChain?: import("../../shared/model-requirements").FallbackEntry[],
  deps: SyncTaskDeps = syncTaskDeps
): Promise<string> {
  const { manager, client, directory, onSyncSessionCreated, syncPollTimeoutMs } = executorCtx
  const toastManager = getTaskToastManager()
  let taskId: string | undefined
  let syncSessionID: string | undefined
  let spawnReservation:
    | Awaited<ReturnType<ExecutorContext["manager"]["reserveSubagentSpawn"]>>
    | undefined

  try {
    if (typeof manager?.reserveSubagentSpawn === "function") {
      spawnReservation = await manager.reserveSubagentSpawn(parentContext.sessionID)
    }

    // Depth/descendant guard. We must NOT silently fall back to childDepth: 1
    // when the manager is unavailable or lacks the spawn methods, because that
    // would let subagents recurse without bound. The only safe fallback is
    // when the manager genuinely cannot enforce limits (legacy SDK), in which
    // case we still record childDepth: 1 but log a warning so regressions are
    // visible.
    let spawnContext: { rootSessionID: string; parentDepth: number; childDepth: number }
    if (spawnReservation?.spawnContext) {
      spawnContext = spawnReservation.spawnContext
    } else if (typeof manager?.assertCanSpawn === "function") {
      spawnContext = await manager.assertCanSpawn(parentContext.sessionID)
    } else {
      log(
        "[task] WARNING: BackgroundManager has no spawn enforcement methods (reserveSubagentSpawn / assertCanSpawn). " +
        "Depth and descendant limits cannot be enforced for this task. This indicates an old SDK or a misconfiguration.",
        { parentSessionID: parentContext.sessionID }
      )
      spawnContext = {
        rootSessionID: parentContext.sessionID,
        parentDepth: 0,
        childDepth: 1,
      }
    }

    const createSessionResult = await deps.createSyncSession(client, {
      parentSessionID: parentContext.sessionID,
      agentToUse,
      description: args.description,
      defaultDirectory: directory,
    })

    if (!createSessionResult.ok) {
      spawnReservation?.rollback()
      return createSessionResult.error
    }

    const sessionID = createSessionResult.sessionID
    spawnReservation?.commit()
    syncSessionID = sessionID
    subagentSessions.add(sessionID)
    syncSubagentSessions.add(sessionID)
    setSessionAgent(sessionID, agentToUse)
    setSessionFallbackChain(sessionID, fallbackChain)

    if (args.category) {
      SessionCategoryRegistry.register(sessionID, args.category)
    }

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
        sessionID,
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
        spawnDepth: spawnContext.childDepth,
        command: args.command,
        model: categoryModel ? { providerID: categoryModel.providerID, modelID: categoryModel.modelID } : undefined,
      },
    }
    await ctx.metadata?.(syncTaskMeta)
    const callID = resolveCallID(ctx)
    if (callID) {
      storeToolMetadata(ctx.sessionID, callID, syncTaskMeta)
    }

    const promptError = await deps.sendSyncPrompt(client, {
      sessionID,
      agentToUse,
      args,
      systemContent,
      categoryModel,
      toastManager,
      taskId,
      sisyphusAgentConfig: executorCtx.sisyphusAgentConfig,
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
      }, syncPollTimeoutMs)
      if (pollError) {
        return pollError
      }

      const result = await deps.fetchSyncResult(client, sessionID)
      if (!result.ok) {
        return result.error
      }

      const duration = formatDuration(startTime)

      // 检测模型路由是否与父 session 不同，给用户可见的提示
      const actualModelStr = categoryModel
        ? `${categoryModel.providerID}/${categoryModel.modelID}`
        : undefined
      const parentModelStr = parentContext.model
        ? `${parentContext.model.providerID}/${parentContext.model.modelID}`
        : undefined
      const modelRoutingNote =
        actualModelStr && parentModelStr && actualModelStr !== parentModelStr
          ? `\n⚠️  Model routing: parent used ${parentModelStr}, this subagent used ${actualModelStr} (via category: ${args.category ?? "unknown"})`
          : actualModelStr
            ? `\nModel: ${actualModelStr}${args.category ? ` (category: ${args.category})` : ""}`
            : ""

      return `Task completed in ${duration}.

Agent: ${agentToUse}${args.category ? ` (category: ${args.category})` : ""}${modelRoutingNote}

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
    spawnReservation?.rollback()
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
      syncSubagentSessions.delete(syncSessionID)
      clearSessionFallbackChain(syncSessionID)
      SessionCategoryRegistry.remove(syncSessionID)
    }
  }
}
