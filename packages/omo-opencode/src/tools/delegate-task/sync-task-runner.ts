import type { TaskToastManager } from "../../features/task-toast-manager/manager"
import type { ModelFallbackInfo } from "../../features/task-toast-manager/types"
import type { ModelFallbackState } from "../../hooks/model-fallback/hook"
import type { FallbackEntry } from "../../shared/model-requirements"
import { shouldRetryError } from "../../shared/model-error-classifier"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { buildRecoveredSyncTaskCompletion, buildSyncTaskCompletion } from "./sync-completion-message"
import { shouldAttemptPollErrorRecovery } from "./sync-poll-error-recovery"
import type { SyncTaskDeps } from "./sync-task-deps"
import { getNextSyncFallbackModel, retrySyncPromptWithFallbacks } from "./sync-task-fallback"
import type { DelegatedModelConfig, DelegateTaskArgs, ToolContextWithMetadata } from "./types"

type SyncTaskRunnerInput = {
  readonly args: DelegateTaskArgs
  readonly ctx: ToolContextWithMetadata
  readonly executorCtx: ExecutorContext
  readonly parentContext: ParentContext
  readonly agentToUse: string
  readonly categoryModel: DelegatedModelConfig | undefined
  readonly fallbackChain: FallbackEntry[] | undefined
  readonly deps: SyncTaskDeps
  readonly sessionID: string
  readonly spawnDepth: number
  readonly taskId: string
  readonly startTime: Date
  readonly syncPollTimeoutMs: number | undefined
  readonly systemContent: string | undefined
  readonly toastManager: TaskToastManager | undefined
  readonly modelInfo: ModelFallbackInfo | undefined
  readonly registerSyncSession: (newSessionID: string) => Promise<void>
  readonly publishSyncMetadata: (
    currentSessionID: string,
    currentModel: DelegatedModelConfig | undefined,
    spawnDepth: number,
  ) => Promise<void>
  readonly cleanupRetrySession: (currentSessionID: string) => void
  readonly setSyncSessionID: (currentSessionID: string) => void
}

function addRetryTaskToast(input: {
  readonly args: DelegateTaskArgs
  readonly agentToUse: string
  readonly sessionID: string
  readonly taskId: string
  readonly toastManager: TaskToastManager | undefined
  readonly modelInfo: ModelFallbackInfo | undefined
}): void {
  if (!input.toastManager) return
  input.toastManager.addTask({
    id: input.taskId,
    sessionID: input.sessionID,
    description: input.args.description,
    agent: input.agentToUse,
    isBackground: false,
    category: input.args.category,
    skills: input.args.load_skills,
    modelInfo: input.modelInfo,
  })
}

export async function runSyncTaskLoop(input: SyncTaskRunnerInput): Promise<string> {
  const {
    args,
    ctx,
    executorCtx,
    parentContext,
    agentToUse,
    fallbackChain,
    deps,
    spawnDepth,
    taskId,
    startTime,
    syncPollTimeoutMs,
    systemContent,
    toastManager,
    modelInfo,
    registerSyncSession,
    publishSyncMetadata,
    cleanupRetrySession,
    setSyncSessionID,
  } = input
  const { client, directory, sisyphusAgentConfig } = executorCtx
  const hasActiveChildBackgroundTasks = executorCtx.manager?.hasActiveChildTasks?.bind(executorCtx.manager)
  let effectiveCategoryModel = input.categoryModel
  let fallbackState: ModelFallbackState | undefined = effectiveCategoryModel && fallbackChain?.length
    ? {
        providerID: effectiveCategoryModel.providerID,
        modelID: effectiveCategoryModel.modelID,
        fallbackChain,
        attemptCount: 0,
        pending: true,
      }
    : undefined
  let activeSessionID = input.sessionID

  while (true) {
    let promptError = await deps.sendSyncPrompt(client, {
      sessionID: activeSessionID,
      agentToUse,
      args,
      systemContent,
      directory,
      toastManager,
      taskId,
      sisyphusAgentConfig,
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
            sessionID: activeSessionID,
            agentToUse,
            args,
            systemContent,
            directory,
            toastManager,
            taskId,
            sisyphusAgentConfig,
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
      setSyncSessionID(activeSessionID)
      effectiveCategoryModel = nextFallbackModel
      await registerSyncSession(activeSessionID)
      addRetryTaskToast({
        args,
        agentToUse,
        sessionID: activeSessionID,
        taskId,
        toastManager,
        modelInfo,
      })
      await publishSyncMetadata(activeSessionID, effectiveCategoryModel, spawnDepth)
      continue
    }

    const result = await deps.fetchSyncResult(client, activeSessionID)
    if (!result.ok) {
      return result.error
    }

    await publishSyncMetadata(activeSessionID, effectiveCategoryModel, spawnDepth)

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
}
