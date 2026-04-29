import type { ModelFallbackInfo } from "../../features/task-toast-manager/types"
import type { DelegateTaskArgs, ToolContextWithMetadata, DelegatedModelConfig } from "./types"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { getTaskToastManager } from "../../features/task-toast-manager"
import { publishToolMetadata } from "../../features/tool-metadata-store"
import { subagentSessions, syncSubagentSessions, setSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { formatDuration } from "./time-formatter"
import { formatDetailedError } from "./error-formatting"
import { syncTaskDeps, type SyncTaskDeps } from "./sync-task-deps"
import { getNextSyncFallbackModel, retrySyncPromptWithFallbacks } from "./sync-task-fallback"
import { buildTaskMetadataBlock } from "../../features/tool-metadata-store/task-metadata-contract"
import { resolveMetadataModel } from "./resolve-metadata-model"
import { shouldRetryError } from "../../shared/model-error-classifier"
import type { ModelFallbackState } from "../../hooks/model-fallback/hook"

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

    // Only default to childDepth: 1 for legacy managers that cannot enforce spawn depth.
    let spawnContext: { rootSessionID: string; parentDepth: number; childDepth: number }
    if (spawnReservation?.spawnContext) {
      spawnContext = spawnReservation.spawnContext
    } else if (typeof manager?.assertCanSpawn === "function") {
      spawnContext = await manager.assertCanSpawn(parentContext.sessionID)
    } else {
      log(
        "[task] WARNING: BackgroundManager has no spawn enforcement methods (reserveSubagentSpawn / assertCanSpawn). " +
        "Depth limits cannot be enforced for this task. This indicates an old SDK or a misconfiguration.",
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

    const registerSyncSession = async (newSessionID: string): Promise<void> => {
      syncSessionID = newSessionID
      subagentSessions.add(newSessionID)
      syncSubagentSessions.add(newSessionID)
      setSessionAgent(newSessionID, agentToUse)
      executorCtx.modelFallbackControllerAccessor?.setSessionFallbackChain(newSessionID, fallbackChain)

      if (args.category) {
        SessionCategoryRegistry.register(newSessionID, args.category)
      }

      if (onSyncSessionCreated) {
        log("[task] Invoking onSyncSessionCreated callback", { sessionID: newSessionID, parentID: parentContext.sessionID })
        try {
          await onSyncSessionCreated({
            sessionID: newSessionID,
            parentID: parentContext.sessionID,
            title: args.description,
          })
        } catch (error) {
          log("[task] onSyncSessionCreated callback failed", { error: String(error) })
        }
        await new Promise(r => setTimeout(r, 200))
      }
    }

    const publishSyncMetadata = async (
      currentSessionID: string,
      currentModel: DelegatedModelConfig | undefined,
      currentTaskId: string,
      spawnDepth: number,
    ): Promise<void> => {
      await publishToolMetadata(ctx, {
        title: args.description,
        metadata: {
          prompt: args.prompt,
          agent: agentToUse,
          category: args.category,
          ...(args.requested_subagent_type !== undefined ? { requested_subagent_type: args.requested_subagent_type } : {}),
          load_skills: args.load_skills,
          description: args.description,
          run_in_background: args.run_in_background,
          taskId: currentSessionID,
          sessionId: currentSessionID,
          sync: true,
          spawnDepth,
          command: args.command,
          model: resolveMetadataModel(currentModel, parentContext.model),
        },
      })
    }

    await registerSyncSession(sessionID)

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
    await publishSyncMetadata(sessionID, categoryModel, taskId, spawnContext.childDepth)

    const syncPromptInput = {
      sessionID,
      agentToUse,
      args,
      systemContent,
      toastManager,
      taskId,
      sisyphusAgentConfig: executorCtx.sisyphusAgentConfig,
    }

    let effectiveCategoryModel = categoryModel
    let fallbackState: ModelFallbackState | undefined = effectiveCategoryModel && fallbackChain?.length
      ? {
          providerID: effectiveCategoryModel.providerID,
          modelID: effectiveCategoryModel.modelID,
          fallbackChain,
          attemptCount: 0,
          pending: true,
        }
      : undefined
    let activeSessionID = sessionID

    const cleanupRetrySession = (currentSessionID: string): void => {
      subagentSessions.delete(currentSessionID)
      syncSubagentSessions.delete(currentSessionID)
      executorCtx.modelFallbackControllerAccessor?.clearSessionFallbackChain(currentSessionID)
      SessionCategoryRegistry.remove(currentSessionID)
    }

    try {
      while (true) {
        let promptError = await deps.sendSyncPrompt(client, {
          ...syncPromptInput,
          sessionID: activeSessionID,
          categoryModel: effectiveCategoryModel,
        })
        if (promptError) {
          const promptResult = await retrySyncPromptWithFallbacks({
            sessionID: activeSessionID,
            initialError: promptError,
            categoryModel: effectiveCategoryModel,
            fallbackChain,
            sendPrompt: async (fallbackModel) => {
              return deps.sendSyncPrompt(client, {
                ...syncPromptInput,
                sessionID: activeSessionID,
                categoryModel: fallbackModel,
              })
            },
          })

          promptError = promptResult.promptError
          effectiveCategoryModel = promptResult.categoryModel
          fallbackState = promptResult.fallbackState ?? fallbackState

          if (promptError) {
            return promptError
          }
        }

        const pollError = await deps.pollSyncSession(ctx, client, {
          sessionID: activeSessionID,
          agentToUse,
          toastManager,
          taskId,
        }, syncPollTimeoutMs)
        if (pollError) {
          const nextFallbackModel = shouldRetryError({ message: pollError })
            ? getNextSyncFallbackModel(activeSessionID, fallbackState)
            : null
          if (!nextFallbackModel) {
            return pollError
          }

          cleanupRetrySession(activeSessionID)

          const retrySessionResult = await deps.createSyncSession(client, {
            parentSessionID: parentContext.sessionID,
            agentToUse,
            description: args.description,
            defaultDirectory: directory,
          })
          if (!retrySessionResult.ok) {
            return retrySessionResult.error
          }

          activeSessionID = retrySessionResult.sessionID
          effectiveCategoryModel = nextFallbackModel
          await registerSyncSession(activeSessionID)
          if (toastManager && taskId) {
            toastManager.addTask({
              id: taskId,
              sessionID: activeSessionID,
              description: args.description,
              agent: agentToUse,
              isBackground: false,
              category: args.category,
              skills: args.load_skills,
              modelInfo,
            })
          }
          if (taskId) {
            await publishSyncMetadata(activeSessionID, effectiveCategoryModel, taskId, spawnContext.childDepth)
          }
          continue
        }

        const result = await deps.fetchSyncResult(client, activeSessionID)
      if (!result.ok) {
        return result.error
      }

      const duration = formatDuration(startTime)

      const actualModelStr = effectiveCategoryModel
        ? `${effectiveCategoryModel.providerID}/${effectiveCategoryModel.modelID}`
        : undefined
      const parentModelStr = parentContext.model
        ? `${parentContext.model.providerID}/${parentContext.model.modelID}`
        : undefined
      let modelRoutingNote = ""
      if (actualModelStr && parentModelStr && actualModelStr !== parentModelStr) {
        modelRoutingNote = `\n⚠️  Model routing: parent used ${parentModelStr}, this subagent used ${actualModelStr} (via category: ${args.category ?? "unknown"})`
      } else if (actualModelStr) {
        modelRoutingNote = `\nModel: ${actualModelStr}${args.category ? ` (category: ${args.category})` : ""}`
      }

      await publishSyncMetadata(activeSessionID, effectiveCategoryModel, taskId!, spawnContext.childDepth)

      return `Task completed in ${duration}.

Agent: ${agentToUse}${args.category ? ` (category: ${args.category})` : ""}${modelRoutingNote}

---

${result.textContent || "(No text output)"}

${buildTaskMetadataBlock({
        sessionId: activeSessionID,
        taskId: activeSessionID,
        agent: agentToUse,
        category: args.category,
      })}`
      }
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
      executorCtx.modelFallbackControllerAccessor?.clearSessionFallbackChain(syncSessionID)
      SessionCategoryRegistry.remove(syncSessionID)
    }
  }
}
