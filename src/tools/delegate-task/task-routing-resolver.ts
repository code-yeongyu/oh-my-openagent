import type { DelegateTaskArgs, DelegateTaskToolOptions } from "./types"
import type { ParentContext } from "./executor-types"
import { resolveCategoryExecution } from "./category-resolver"
import { resolveSubagentExecution } from "./subagent-resolver"

export interface TaskRoutingResult {
  agentToUse: string
  categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
  categoryPromptAppend: string | undefined
  maxPromptTokens?: number
  modelInfo: import("../../features/task-toast-manager/types").ModelFallbackInfo | undefined
  actualModel: string | undefined
  isUnstableAgent: boolean
  fallbackChain?: import("../../shared/model-requirements").FallbackEntry[]
  error?: string
}

export async function resolveTaskRouting(args: DelegateTaskArgs, input: {
  options: DelegateTaskToolOptions
  parentContext: ParentContext
  categoryExamples: string
  inheritedModel: string | undefined
  systemDefaultModel: string | undefined
}): Promise<TaskRoutingResult> {
  const { options, parentContext, categoryExamples, inheritedModel, systemDefaultModel } = input

  if (args.category) {
    return resolveCategoryExecution(args, options, inheritedModel, systemDefaultModel)
  }

  const resolution = await resolveSubagentExecution(
    args,
    options,
    parentContext.agent,
    categoryExamples,
    inheritedModel,
  )

  return {
    agentToUse: resolution.agentToUse,
    categoryModel: resolution.categoryModel,
    categoryPromptAppend: undefined,
    maxPromptTokens: undefined,
    modelInfo: undefined,
    actualModel: undefined,
    isUnstableAgent: false,
    fallbackChain: resolution.fallbackChain,
    error: resolution.error,
  }
}
