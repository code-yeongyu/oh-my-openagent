import type { AgentOverrideConfig, AgentOverrides } from "../config/schema"
import { getAgentConfigKey } from "../shared/agent-display-names"
import {
  resolveAgentPromptAppend,
  shouldIncludeAgentPromptAppend,
} from "./builtin-agents/resolve-prompt-append"

type RuntimePromptAppendRule = {
  configKey: string
  displayName?: string
  conditionalAppend: string
  alwaysAppend?: string
  includeModelKeywords?: string[]
  excludeModelKeywords?: string[]
}

type RuntimePromptAppendContext = RuntimePromptAppendRule & {
  configuredPrompt: string
  basePrompt: string
}

export type RuntimePromptAppendRegistry = {
  configure: (input: {
    agentConfigs: Record<string, unknown>
    agentOverrides?: AgentOverrides
    directory?: string
  }) => void
  reconcile: (input: {
    system: string[]
    agentName?: string
    runtimeModel?: string
  }) => boolean
}

function normalizeAgentName(name: string): string {
  return getAgentConfigKey(name).trim().toLowerCase()
}

function createRule(
  configKey: string,
  override: AgentOverrideConfig,
  directory?: string,
): RuntimePromptAppendRule | undefined {
  const conditionalAppend = resolveAgentPromptAppend({
    promptAppend: override.prompt_append,
    configDir: directory,
  })
  if (!conditionalAppend) return undefined

  return {
    configKey: normalizeAgentName(configKey),
    displayName: override.displayName,
    conditionalAppend,
    alwaysAppend: resolveAgentPromptAppend({
      promptAppendAlways: override.prompt_append_always,
      configDir: directory,
    }),
    includeModelKeywords: override.prompt_append_include_model_keywords,
    excludeModelKeywords: override.prompt_append_exclude_model_keywords,
  }
}

type RegisteredAgent = {
  prompt: string
  model?: string
}

function findRegisteredAgent(
  agentConfigs: Record<string, unknown>,
  rule: RuntimePromptAppendRule,
): RegisteredAgent | undefined {
  for (const [name, value] of Object.entries(agentConfigs)) {
    const normalizedName = normalizeAgentName(name)
    const normalizedDisplayName = rule.displayName
      ? normalizeAgentName(rule.displayName)
      : undefined
    if (normalizedName !== rule.configKey && normalizedName !== normalizedDisplayName) continue
    if (!value || typeof value !== "object") return undefined
    const prompt = Reflect.get(value, "prompt")
    if (typeof prompt !== "string") return undefined
    const model = Reflect.get(value, "model")
    return {
      prompt,
      model: typeof model === "string" ? model : undefined,
    }
  }
  return undefined
}

function getConfiguredModel(override: AgentOverrideConfig): string | undefined {
  const model = Reflect.get(override, "model")
  return typeof model === "string" ? model : undefined
}

function combineAppends(
  conditionalAppend: string | undefined,
  alwaysAppend: string | undefined,
): string | undefined {
  const parts = [conditionalAppend, alwaysAppend].filter((part): part is string => part !== undefined)
  return parts.length > 0 ? parts.join("\n\n") : undefined
}

function removeConfiguredAppend(
  configuredPrompt: string,
  configuredAppend: string | undefined,
): string | undefined {
  if (!configuredAppend) return configuredPrompt
  const suffix = `\n${configuredAppend}`
  return configuredPrompt.endsWith(suffix)
    ? configuredPrompt.slice(0, -suffix.length)
    : undefined
}

function createContexts(input: {
  agentConfigs: Record<string, unknown>
  agentOverrides?: AgentOverrides
  directory?: string
}): RuntimePromptAppendContext[] {
  if (!input.agentOverrides) return []

  return Object.entries(input.agentOverrides).flatMap(([configKey, override]) => {
    if (!override) return []
    const rule = createRule(configKey, override, input.directory)
    if (!rule) return []
    const registeredAgent = findRegisteredAgent(input.agentConfigs, rule)
    if (!registeredAgent) return []
    const configuredPrompt = registeredAgent.prompt
    const configuredAppend = resolveAgentPromptAppend({
      model: getConfiguredModel(override) ?? registeredAgent.model,
      promptAppend: override.prompt_append,
      promptAppendAlways: override.prompt_append_always,
      includeModelKeywords: override.prompt_append_include_model_keywords,
      excludeModelKeywords: override.prompt_append_exclude_model_keywords,
      configDir: input.directory,
    })
    const basePrompt = removeConfiguredAppend(configuredPrompt, configuredAppend)
    if (basePrompt === undefined) return []
    return [{ ...rule, configuredPrompt, basePrompt }]
  })
}

function findContext(
  contexts: RuntimePromptAppendContext[],
  agentName: string,
): RuntimePromptAppendContext | undefined {
  const normalizedAgent = normalizeAgentName(agentName)
  return contexts.find((context) =>
    context.configKey === normalizedAgent
    || (context.displayName !== undefined && normalizeAgentName(context.displayName) === normalizedAgent)
  )
}

function replaceConfiguredPrompt(
  system: string[],
  configuredPrompt: string,
  desiredPrompt: string,
): boolean {
  if (configuredPrompt === desiredPrompt) return false
  for (let index = 0; index < system.length; index++) {
    const promptIndex = system[index].indexOf(configuredPrompt)
    if (promptIndex === -1) continue
    const part = system[index]
    system[index] = `${part.slice(0, promptIndex)}${desiredPrompt}${part.slice(promptIndex + configuredPrompt.length)}`
    return true
  }
  return false
}

export function createRuntimePromptAppendRegistry(): RuntimePromptAppendRegistry {
  let contexts: RuntimePromptAppendContext[] = []

  return {
    configure: (input): void => {
      contexts = createContexts(input)
    },
    reconcile: (input): boolean => {
      if (!input.agentName || !input.runtimeModel) return false
      const context = findContext(contexts, input.agentName)
      if (!context) return false
      const includeConditional = shouldIncludeAgentPromptAppend({
        model: input.runtimeModel,
        includeModelKeywords: context.includeModelKeywords,
        excludeModelKeywords: context.excludeModelKeywords,
      })
      const desiredAppend = combineAppends(
        includeConditional ? context.conditionalAppend : undefined,
        context.alwaysAppend,
      )
      const desiredPrompt = desiredAppend
        ? `${context.basePrompt}\n${desiredAppend}`
        : context.basePrompt
      return replaceConfiguredPrompt(input.system, context.configuredPrompt, desiredPrompt)
    },
  }
}
