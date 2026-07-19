import { resolveModelForDelegateTask } from "@oh-my-opencode/delegate-core"

import type { SenpiModelPort, SenpiModelRegistryPort } from "../category"
import type { ResolvedModelRecord } from "../state"
import {
  findExactAgentModel,
  parseAvailableAgentModels,
  type ParsedAgentModel,
} from "./agent-model-registry"
import { AGENT_FALLBACK_CHAINS } from "./builtin/fallback-chains"
import type { AgentDefinition } from "./types"

export type ResolveAgentOptions = {
  readonly modelOverride?: string
}

type AgentPersona = {
  readonly agentType: string
  readonly instructions?: string
  readonly toolAllowlist?: readonly string[]
  readonly agentExecutionMode?: "in-process" | "process"
  readonly allowedSubagents?: readonly string[]
  readonly maxDepth?: number
}

export type ResolvedAgentResult = AgentPersona & {
  readonly kind: "resolved"
  readonly agent: string
  readonly model: string
  readonly resolved_model?: ResolvedModelRecord
  readonly availableAgents: readonly string[]
}

export type AgentNotFoundResult = {
  readonly kind: "not_found"
  readonly agent: string
  readonly availableAgents: readonly string[]
}

export type AgentModelUnavailableResult = {
  readonly kind: "model_unavailable"
  readonly agent: string
  readonly attemptedModel: string | undefined
  readonly availableAgents: readonly string[]
}

export type AgentResolutionResult = ResolvedAgentResult | AgentNotFoundResult | AgentModelUnavailableResult

type AgentResolutionContext = {
  readonly name: string
  readonly persona: AgentPersona
  readonly availableAgents: readonly string[]
}

export function resolveAgent<TModel extends SenpiModelPort>(
  name: string,
  agents: Readonly<Record<string, AgentDefinition>>,
  registry: SenpiModelRegistryPort<TModel> | undefined,
  options: ResolveAgentOptions = {},
): AgentResolutionResult {
  const availableAgents = Object.entries(agents)
    .filter(([, definition]) => definition.disable !== true)
    .map(([agentName]) => agentName)
    .sort()
  const definition = Object.hasOwn(agents, name) ? agents[name] : undefined
  if (definition === undefined || definition.disable === true) {
    return { kind: "not_found", agent: name, availableAgents }
  }

  const persona = agentPersona(name, definition)
  const context: AgentResolutionContext = { name, persona, availableAgents }
  if (options.modelOverride !== undefined) {
    return {
      kind: "resolved",
      agent: name,
      model: options.modelOverride,
      availableAgents,
      ...persona,
    }
  }

  const fallbackChain = Object.hasOwn(AGENT_FALLBACK_CHAINS, name)
    ? AGENT_FALLBACK_CHAINS[name]
    : undefined
  if (registry === undefined) {
    const fallbackHead = fallbackChain?.[0]
    const fallbackProvider = fallbackHead?.providers[0]
    const attemptedModel = definition.model
      ?? definition.models?.[0]
      ?? (fallbackHead !== undefined && fallbackProvider !== undefined
        ? `${fallbackProvider}/${fallbackHead.model}`
        : undefined)
    return { kind: "model_unavailable", agent: name, attemptedModel, availableAgents }
  }

  let attemptedModel: string | undefined
  const directModels = [
    ...(definition.model === undefined ? [] : [definition.model]),
    ...(definition.models ?? []),
  ]
  for (const candidate of directModels) {
    attemptedModel = candidate
    const found = findExactAgentModel(candidate, registry)
    if (found !== undefined) {
      return resolvedAgent(context, found)
    }
  }

  const availableModels = parseAvailableAgentModels(registry.getAvailable())
  if (availableModels !== undefined && fallbackChain !== undefined) {
    const resolution = resolveModelForDelegateTask(
      { fallbackChain, availableModels: new Set(availableModels) },
      {
        connectedProviders: null,
        hasProviderModelsCache: true,
        hasConnectedProvidersCache: true,
      },
    )
    if (resolution !== undefined && !("skipped" in resolution)) {
      attemptedModel = resolution.model
      const found = findExactAgentModel(resolution.model, registry)
      if (found !== undefined) {
        return resolvedAgent(context, found, resolution.variant)
      }
    }
  }

  return { kind: "model_unavailable", agent: name, attemptedModel, availableAgents }
}

function agentPersona(name: string, definition: AgentDefinition): AgentPersona {
  const toolAllowlist = definition.tools?.filter((rule) =>
    rule.allow && !rule.pattern.includes(" ") && !rule.pattern.includes("*")
  ).map((rule) => rule.pattern)
  const agentExecutionMode = toExecutionMode(definition.executionMode)
  return {
    agentType: name,
    ...(definition.prompt !== undefined ? { instructions: definition.prompt } : {}),
    ...(toolAllowlist !== undefined ? { toolAllowlist } : {}),
    ...(agentExecutionMode !== undefined ? { agentExecutionMode } : {}),
    ...(definition.allowedSubagents !== undefined ? { allowedSubagents: definition.allowedSubagents } : {}),
    ...(definition.maxDepth !== undefined ? { maxDepth: definition.maxDepth } : {}),
  }
}

function resolvedAgent(
  context: AgentResolutionContext,
  model: ParsedAgentModel,
  variant?: string,
): ResolvedAgentResult {
  const display = `${model.provider}/${model.modelId}`
  return {
    kind: "resolved",
    agent: context.name,
    model: display,
    resolved_model: {
      source: "agent",
      provider: model.provider,
      model_id: model.modelId,
      display,
      ...(variant !== undefined ? { variant } : {}),
    },
    availableAgents: context.availableAgents,
    ...context.persona,
  }
}

function toExecutionMode(value: string | undefined): AgentPersona["agentExecutionMode"] {
  switch (value) {
    case "in-process":
    case "process":
      return value
    default:
      return undefined
  }
}
