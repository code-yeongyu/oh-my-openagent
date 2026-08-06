import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoriesConfig, CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isAnyFallbackModelAvailable } from "../../shared"
import { log } from "../../shared/logger"
import { applyEnvironmentContext } from "./environment-context"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"
import { createSisyphusAgent } from "../sisyphus"
import { applyFrontierToolSchemaPermission } from "../frontier-tool-schema-guard"
import { setSisyphusRuntimePromptContext } from "../sisyphus-runtime-prompt-reconciler"

export function maybeCreateSisyphusConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  uiSelectedModel?: string
  availableModels: Set<string>
  systemDefaultModel?: string
  isFirstRunNoCache: boolean
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  userCategories?: CategoriesConfig
  useTaskSystem: boolean
  disableOmoEnv?: boolean
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    useTaskSystem,
    disableOmoEnv = false,
  } = input

  const sisyphusOverride = agentOverrides["sisyphus"]
  const sisyphusRequirement = AGENT_MODEL_REQUIREMENTS["sisyphus"]
  const hasSisyphusExplicitConfig = sisyphusOverride !== undefined
  const meetsSisyphusAnyModelRequirement =
    !sisyphusRequirement?.requiresAnyModel ||
    hasSisyphusExplicitConfig ||
    isFirstRunNoCache ||
    isAnyFallbackModelAvailable(sisyphusRequirement.fallbackChain, availableModels)

  if (!disabledAgents.includes("sisyphus") && !meetsSisyphusAnyModelRequirement) {
    log("[agent-registration] Agent skipped: no model in fallback chain is available", {
      agent: "sisyphus",
    })
  }
  if (disabledAgents.includes("sisyphus") || !meetsSisyphusAnyModelRequirement) return undefined

  let sisyphusResolution = applyModelResolution({
    uiSelectedModel: sisyphusOverride?.model !== undefined ? undefined : uiSelectedModel,
    userModel: sisyphusOverride?.model,
    requirement: sisyphusRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !sisyphusOverride?.model && !uiSelectedModel) {
    sisyphusResolution = getFirstFallbackModel(sisyphusRequirement)
  }

  if (!sisyphusResolution) {
    log("[agent-registration] Agent skipped: model resolution returned no result", {
      agent: "sisyphus",
      configuredModel: sisyphusOverride?.model,
    })
    return undefined
  }
  const { model: sisyphusModel, variant: sisyphusResolvedVariant } = sisyphusResolution

  let sisyphusConfig = createSisyphusAgent(
    sisyphusModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    useTaskSystem
  )

  if (sisyphusResolvedVariant) {
    sisyphusConfig = { ...sisyphusConfig, variant: sisyphusResolvedVariant }
  }

  sisyphusConfig = applyOverrides(sisyphusConfig, sisyphusOverride, mergedCategories, directory)

  const resolvedModel = sisyphusConfig.model ?? ""
  sisyphusConfig.permission = applyFrontierToolSchemaPermission(
    sisyphusConfig.permission,
    resolvedModel,
    sisyphusOverride?.permission,
    (sisyphusOverride as { tools?: Record<string, boolean> } | undefined)?.tools
  )

  sisyphusConfig = applyEnvironmentContext(sisyphusConfig, directory, {
    disableOmoEnv,
  })

  // The body above is baked from the *configured* model. If the user switches to
  // a different model family in the TUI, the system-transform hook rebuilds the
  // prompt for the runtime model using this captured pipeline (issue #5297/#5316).
  setSisyphusRuntimePromptContext({
    configuredModel: sisyphusModel,
    bakedPrompt: sisyphusConfig.prompt ?? "",
    rebuildPromptForModel: (runtimeModel: string): string => {
      let rebuilt = createSisyphusAgent(
        runtimeModel,
        availableAgents,
        undefined,
        availableSkills,
        availableCategories,
        useTaskSystem
      )
      rebuilt = applyOverrides(rebuilt, sisyphusOverride, mergedCategories, directory)
      rebuilt = applyEnvironmentContext(rebuilt, directory, { disableOmoEnv })
      return rebuilt.prompt ?? ""
    },
  })

  return sisyphusConfig
}
