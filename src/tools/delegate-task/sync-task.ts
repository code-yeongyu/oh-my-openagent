import { getTaskToastManager } from "../../features/task-toast-manager"
import type { ModelFallbackInfo } from "../../features/task-toast-manager/types"
import type { ModelFallbackState } from "../../hooks/model-fallback/hook"
import { shouldRetryError } from "../../shared/model-error-classifier"
import { formatDetailedError } from "./error-formatting"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { buildRecoveredSyncTaskCompletion, buildSyncTaskCompletion } from "./sync-completion-message"
import { shouldAttemptPollErrorRecovery } from "./sync-poll-error-recovery"
import { reserveSyncSubagentSpawn } from "./sync-spawn-reservation"
import { type SyncTaskDeps, syncTaskDeps } from "./sync-task-deps"
import { getNextSyncFallbackModel, retrySyncPromptWithFallbacks } from "./sync-task-fallback"
import { publishSyncTaskMetadata } from "./sync-task-metadata"
import { cleanupSyncSessionSideEffects, registerSyncSessionSideEffects } from "./sync-session-lifecycle"
import type { DelegatedModelConfig, DelegateTaskArgs, ToolContextWithMetadata } from "./types"

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
  const { manager, client, directory, syncPollTimeoutMs } = executorCtx
  const hasActiveChildBackgroundTasks = manager?.hasActiveChildTasks?.bind(manager)
  const toastManager = getTaskToastManager()
  let taskId: string | undefined
  let syncSessionID: string | undefined
  let spawnReservation:
    | Awaited<ReturnType<ExecutorContext["manager"]["reserveSubagentSpawn"]>>
    | undefined

  try {
    const spawn = await reserveSyncSubagentSpawn(executorCtx, parentContext)
    spawnReservation = spawn.reservation
    const { spawnContext } = spawn

    const createSessionResult = await deps.createSyncSession(client, {
      parentSessionID: parentContext.sessionID,
      agentToUse,
      description: args.description,
      defaultDirectory: directory,
      categoryModel,
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
      await registerSyncSessionSideEffects({
        args,
        executorCtx,
        sessionID: newSessionID,
        parentContext,
        agentToUse,
        fallbackChain,
        systemContent,
      })
    }

    const publishSyncMetadata = async (
      currentSessionID: string,
      currentModel: DelegatedModelConfig | undefined,
      spawnDepth: number,
    ): Promise<void> => {
      await publishSyncTaskMetadata({
        args,
        ctx,
        currentSessionID,
        currentModel,
        parentContext,
        agentToUse,
        spawnDepth,
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
    await publishSyncMetadata(sessionID, categoryModel, spawnContext.childDepth)

    const syncPromptInput = {
      sessionID,
      agentToUse,
      args,
      systemContent,
      directory: createSessionResult.parentDirectory,
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
      cleanupSyncSessionSideEffects(currentSessionID, executorCtx)
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
          hasActiveChildBackgroundTasks,
        }, syncPollTimeoutMs)
        if (pollError) {
          if (shouldAttemptPollErrorRecovery(pollError)) {
            const recoveredResult = await deps.fetchSyncResult(client, activeSessionID, undefined, {
              strictAbortRecovery: true,
            })
            if (recoveredResult.ok) {
              return buildRecoveredSyncTaskCompletion({
                activeSessionID,
                agentToUse,
                args,
                effectiveCategoryModel,
                parentContext,
                startTime,
                textContent: recoveredResult.textContent,
              })
            }
          }

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
            categoryModel: nextFallbackModel,
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
            await publishSyncMetadata(activeSessionID, effectiveCategoryModel, spawnContext.childDepth)
          }
          continue
        }

        const result = await deps.fetchSyncResult(client, activeSessionID)
        if (!result.ok) {
          return result.error
        }

        await publishSyncMetadata(activeSessionID, effectiveCategoryModel, spawnContext.childDepth)

        return buildSyncTaskCompletion({
          activeSessionID,
          agentToUse,
          args,
          effectiveCategoryModel,
          parentContext,
          startTime,
          textContent: result.textContent,
        })
      }
    } finally {
      if (toastManager && taskId !== undefined) {
        toastManager.removeTask(taskId)
      }
    }
  } catch (error) {
    spawnReservation?.rollback()
    const errorToFormat = error instanceof Error ? error : String(error)
    return formatDetailedError(errorToFormat, {
      operation: "Execute task",
      args,
      sessionID: syncSessionID,
      agent: agentToUse,
      category: args.category,
    })
  } finally {
    if (syncSessionID) {
      cleanupSyncSessionSideEffects(syncSessionID, executorCtx)
    }
  }
}
