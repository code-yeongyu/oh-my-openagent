import type { PluginInput } from "@opencode-ai/plugin"
import type { CategoriesConfig } from "../../config/schema"
import type { BackgroundManager } from "../../features/background-agent"
import type { ParentContext } from "../delegate-task/executor"
import { resolveCategoryExecution } from "../delegate-task/executor"
import type { DelegateTaskArgs } from "../delegate-task/types"

function parseModel(model: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!model) {
    return undefined
  }

  const separatorIndex = model.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex >= model.length - 1) {
    throw new Error("invalid_model_override_format")
  }

  return {
    providerID: model.slice(0, separatorIndex),
    modelID: model.slice(separatorIndex + 1),
  }
}

async function getSystemDefaultModel(client: PluginInput["client"]): Promise<string | undefined> {
  try {
    const openCodeConfig = await client.config.get()
    return (openCodeConfig as { data?: { model?: string } })?.data?.model
  } catch {
    return undefined
  }
}

export interface TeamCategoryContext {
  client: PluginInput["client"]
  userCategories?: CategoriesConfig
  sisyphusJuniorModel?: string
}

export interface SpawnExecutionRequest {
  teamName: string
  name: string
  prompt: string
  category: string
  subagentType: string
  model?: string
  manager: BackgroundManager
  categoryContext?: TeamCategoryContext
}

export interface SpawnExecutionResult {
  agentType: string
  teammateModel: string
  launchModel?: { providerID: string; modelID: string; variant?: string }
  categoryPromptAppend?: string
}

export async function resolveSpawnExecution(
  request: SpawnExecutionRequest,
  parentContext: ParentContext,
): Promise<SpawnExecutionResult> {
  if (request.model) {
    const launchModel = parseModel(request.model)
    return {
      agentType: request.subagentType,
      teammateModel: request.model,
      ...(launchModel ? { launchModel } : {}),
    }
  }

  if (!request.categoryContext?.client) {
    return {
      agentType: request.subagentType,
      teammateModel: "native",
    }
  }

  const inheritedModel = parentContext.model
    ? `${parentContext.model.providerID}/${parentContext.model.modelID}`
    : undefined

  const systemDefaultModel = await getSystemDefaultModel(request.categoryContext.client)

  const delegateArgs: DelegateTaskArgs = {
    description: `[team:${request.teamName}] ${request.name}`,
    prompt: request.prompt,
    category: request.category,
    subagent_type: "sisyphus-junior",
    run_in_background: true,
    load_skills: [],
  }

  const resolution = await resolveCategoryExecution(
    delegateArgs,
    {
      manager: request.manager,
      client: request.categoryContext.client,
      directory: process.cwd(),
      userCategories: request.categoryContext.userCategories,
      sisyphusJuniorModel: request.categoryContext.sisyphusJuniorModel,
    },
    inheritedModel,
    systemDefaultModel,
  )

  if (resolution.error) {
    throw new Error(resolution.error)
  }

  if (!resolution.categoryModel) {
    throw new Error("category_model_not_resolved")
  }

  return {
    agentType: resolution.agentToUse,
    teammateModel: `${resolution.categoryModel.providerID}/${resolution.categoryModel.modelID}`,
    launchModel: resolution.categoryModel,
    categoryPromptAppend: resolution.categoryPromptAppend,
  }
}
