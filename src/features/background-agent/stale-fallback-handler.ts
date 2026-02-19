import type { OhMyOpenCodeConfig } from "../../config"
import type { BackgroundTask, LaunchInput } from "./types"
import { normalizeFallbackModels } from "../../shared/model-resolver"
import { log } from "../../shared"

function resolveFallbackModelsForTask(
  task: BackgroundTask,
  pluginConfig: OhMyOpenCodeConfig,
): string[] {
  const agentName = task.agent?.toLowerCase()
  if (agentName) {
    const agentConfig = pluginConfig.agents?.[agentName as keyof typeof pluginConfig.agents]
    if (agentConfig?.fallback_models) {
      return normalizeFallbackModels(agentConfig.fallback_models) ?? []
    }
  }

  if (task.category && pluginConfig.categories?.[task.category]) {
    const categoryConfig = pluginConfig.categories[task.category]
    if (categoryConfig?.fallback_models) {
      return normalizeFallbackModels(categoryConfig.fallback_models) ?? []
    }
  }

  return []
}

export function resolveNextFallbackModel(
  task: BackgroundTask,
  pluginConfig: OhMyOpenCodeConfig,
): { nextModel: string; remainingModels: string[] } | undefined {
  if (task.fallbackModels && task.fallbackModels.length > 0) {
    return {
      nextModel: task.fallbackModels[0],
      remainingModels: task.fallbackModels.slice(1),
    }
  }

  const allFallbackModels = resolveFallbackModelsForTask(task, pluginConfig)
  if (allFallbackModels.length === 0) return undefined

  const currentModel = task.model
    ? `${task.model.providerID}/${task.model.modelID}`
    : undefined

  let startIndex = 0
  if (currentModel) {
    const idx = allFallbackModels.indexOf(currentModel)
    if (idx >= 0) startIndex = idx + 1
  }

  if (startIndex >= allFallbackModels.length) return undefined

  return {
    nextModel: allFallbackModels[startIndex],
    remainingModels: allFallbackModels.slice(startIndex + 1),
  }
}

function parseModelToProviderAndId(
  model: string,
): { providerID: string; modelID: string } | undefined {
  const parts = model.split("/")
  if (parts.length < 2) return undefined
  return { providerID: parts[0], modelID: parts.slice(1).join("/") }
}

export function buildFallbackLaunchInput(
  task: BackgroundTask,
  nextModel: string,
  remainingModels: string[],
): LaunchInput | undefined {
  const parsed = parseModelToProviderAndId(nextModel)
  if (!parsed) return undefined

  return {
    description: task.description,
    prompt: task.prompt,
    agent: task.agent,
    parentSessionID: task.parentSessionID,
    parentMessageID: task.parentMessageID,
    parentModel: task.parentModel,
    parentAgent: task.parentAgent,
    parentTools: task.parentTools,
    model: parsed,
    isUnstableAgent: task.isUnstableAgent,
    category: task.category,
    fallbackModels: remainingModels,
  }
}

export function createStaleFallbackHandler(
  pluginConfig: OhMyOpenCodeConfig,
  launchFn: (input: LaunchInput) => Promise<BackgroundTask>,
): (task: BackgroundTask) => Promise<void> {
  return async (task: BackgroundTask) => {
    const result = resolveNextFallbackModel(task, pluginConfig)
    if (!result) {
      log("[background-agent] No fallback models available for stale task", {
        taskId: task.id,
        agent: task.agent,
        category: task.category,
      })
      return
    }

    const { nextModel, remainingModels } = result
    const launchInput = buildFallbackLaunchInput(task, nextModel, remainingModels)
    if (!launchInput) {
      log("[background-agent] Invalid fallback model format", {
        taskId: task.id,
        model: nextModel,
      })
      return
    }

    log("[background-agent] Re-launching stale task with fallback model", {
      taskId: task.id,
      fromModel: task.model ? `${task.model.providerID}/${task.model.modelID}` : "unknown",
      toModel: nextModel,
      remainingFallbacks: remainingModels.length,
    })

    try {
      const newTask = await launchFn(launchInput)
      log("[background-agent] Fallback task launched", {
        originalTaskId: task.id,
        newTaskId: newTask.id,
        model: nextModel,
      })
    } catch (error) {
      log("[background-agent] Failed to launch fallback task", {
        taskId: task.id,
        model: nextModel,
        error: String(error),
      })
    }
  }
}
