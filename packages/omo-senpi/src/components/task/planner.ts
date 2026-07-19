import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  resolveAgent,
  resolveCategory,
  type AgentDefinition,
  type ChildPlanner,
  type PlanResolution,
  type ResolvedAgentResult,
  type SenpiModelPort,
  type SenpiModelRegistryPort,
} from "@oh-my-opencode/senpi-task"

type ResolvedPlan = Extract<PlanResolution, { readonly kind: "resolved" }>["plan"]
type ResolvedModelMetadata = NonNullable<ResolvedPlan["resolved_model"]>

// The live senpi model registry surface the planner needs. ExtensionContext.modelRegistry satisfies
// it structurally; a fake with getAvailable/find satisfies it in tests.
export type TaskModelRegistry = SenpiModelRegistryPort<SenpiModelPort>

export type ResolveModelRegistry = () => TaskModelRegistry | undefined

const NO_REGISTRY_MESSAGE = "No senpi model registry is available yet to resolve a task model."

// The category-and-agent resolving ChildPlanner the manager consumes. Resolution order:
// 1. a subagent_type naming a known agent wins: an explicit `model` keeps the headless explicit
//    path (agent persona attached, no registry access); otherwise the agent's model chain resolves
//    against the live registry and a missing registry fails closed as model_unavailable.
// 2. an explicit `model` alone is honored verbatim, before any registry access.
// 3. a category (or a subagent_type naming a category) resolves against omo.json + the registry.
export function createTaskChildPlanner(
  omoConfig: OmoConfig,
  agents: Readonly<Record<string, AgentDefinition>>,
  resolveRegistry: ResolveModelRegistry,
): ChildPlanner {
  const availableAgents = listAvailableAgents(agents)
  return (spec): PlanResolution => {
    if (spec.subagent_type !== undefined) {
      const agentResolution = resolveAgentTarget(spec.subagent_type, spec.model, agents, resolveRegistry)
      if (agentResolution !== undefined) return agentResolution
    }

    if (spec.model !== undefined && spec.model.length > 0) {
      const resolvedModel = explicitModelMetadata(spec.model)
      return {
        kind: "resolved",
        plan: {
          model: spec.model,
          ...(resolvedModel !== undefined ? { resolved_model: resolvedModel } : {}),
        },
      }
    }

    const categoryName = spec.category ?? spec.subagent_type
    if (categoryName === undefined) {
      return { kind: "error", error: { code: "invalid_target", message: "A task requires a category, subagent_type, or model." } }
    }

    const registry = resolveRegistry()
    if (registry === undefined) {
      return {
        kind: "error",
        error: { code: "model_unavailable", message: NO_REGISTRY_MESSAGE },
      }
    }

    const resolution = resolveCategory(categoryName, omoConfig, registry)
    return toPlanResolution(categoryName, resolution, availableAgents)
  }
}

// Agent-first target handling. Unknown and disabled names may retain category fallback, but a known
// disabled name cannot use an explicit model to bypass agent disablement.
function resolveAgentTarget(
  agentName: string,
  explicitModel: string | undefined,
  agents: Readonly<Record<string, AgentDefinition>>,
  resolveRegistry: ResolveModelRegistry,
): PlanResolution | undefined {
  const definition = Object.hasOwn(agents, agentName) ? agents[agentName] : undefined
  if (definition?.disable === true) {
    if (explicitModel === undefined || explicitModel.length === 0) return undefined
    return {
      kind: "error",
      error: {
        code: "unknown_target",
        message: `Target "${agentName}" not found.`,
        availableAgents: listAvailableAgents(agents),
      },
    }
  }

  if (explicitModel !== undefined && explicitModel.length > 0) {
    const resolution = resolveAgent(agentName, agents, undefined, { modelOverride: explicitModel })
    if (resolution.kind !== "resolved") return undefined
    return { kind: "resolved", plan: toAgentPlan(resolution, explicitModelMetadata(explicitModel)) }
  }

  const registry = resolveRegistry()
  const resolution = resolveAgent(agentName, agents, registry)
  if (resolution.kind === "resolved") {
    return { kind: "resolved", plan: toAgentPlan(resolution, undefined) }
  }
  if (resolution.kind === "model_unavailable") {
    if (registry === undefined) {
      return { kind: "error", error: { code: "model_unavailable", message: NO_REGISTRY_MESSAGE } }
    }
    return {
      kind: "error",
      error: {
        code: "model_unavailable",
        message: `No available model for agent "${agentName}" (attempted ${resolution.attemptedModel ?? "none"}).`,
        availableAgents: resolution.availableAgents,
      },
    }
  }
  return undefined
}

function toAgentPlan(resolution: ResolvedAgentResult, explicitModel: ResolvedModelMetadata | undefined): ResolvedPlan {
  const resolvedModel = resolution.resolved_model ?? explicitModel
  return {
    model: resolution.model,
    ...(resolvedModel !== undefined ? { resolved_model: resolvedModel } : {}),
    agentType: resolution.agentType,
    ...(resolution.instructions !== undefined ? { instructions: resolution.instructions } : {}),
    ...(resolution.toolAllowlist !== undefined ? { toolAllowlist: resolution.toolAllowlist } : {}),
    ...(resolution.agentExecutionMode !== undefined ? { agentExecutionMode: resolution.agentExecutionMode } : {}),
    ...(resolution.allowedSubagents !== undefined ? { allowedSubagents: resolution.allowedSubagents } : {}),
    ...(resolution.maxDepth !== undefined ? { maxDepth: resolution.maxDepth } : {}),
  }
}

function listAvailableAgents(agents: Readonly<Record<string, AgentDefinition>>): readonly string[] {
  return Object.entries(agents)
    .filter(([, definition]) => definition.disable !== true)
    .map(([name]) => name)
    .sort()
}

function toPlanResolution(
  categoryName: string,
  resolution: ReturnType<typeof resolveCategory<SenpiModelPort>>,
  availableAgents: readonly string[],
): PlanResolution {
  if (resolution.kind === "resolved") {
    return {
      kind: "resolved",
      plan: {
        model: `${resolution.spec.provider}/${resolution.spec.modelId}`,
        resolved_model: {
          source: "category",
          provider: resolution.spec.provider,
          model_id: resolution.spec.modelId,
          display: `${resolution.spec.provider}/${resolution.spec.modelId}`,
          ...(resolution.spec.variant !== undefined ? { variant: resolution.spec.variant } : {}),
          ...(resolution.spec.reasoningEffort !== undefined ? { reasoning_effort: resolution.spec.reasoningEffort } : {}),
        },
        category: resolution.category,
        ...(resolution.spec.prompt_append !== undefined && { promptAppend: resolution.spec.prompt_append }),
      },
    }
  }
  if (resolution.kind === "disabled") {
    return {
      kind: "error",
      error: { code: "category_disabled", message: resolution.reason, availableCategories: resolution.availableCategories },
    }
  }
  if (resolution.kind === "not_found") {
    return {
      kind: "error",
      error: {
        code: "unknown_target",
        message: `Category "${categoryName}" not found.`,
        availableAgents,
        availableCategories: resolution.availableCategories,
      },
    }
  }
  return {
    kind: "error",
    error: {
      code: "model_unavailable",
      message: `No available model for category "${categoryName}" (attempted ${resolution.attemptedModel ?? "none"}).`,
      availableCategories: resolution.availableCategories,
    },
  }
}

function explicitModelMetadata(model: string): ResolvedModelMetadata | undefined {
  const separatorIndex = model.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex === model.length - 1) {
    return undefined
  }
  return {
    source: "explicit",
    provider: model.slice(0, separatorIndex),
    model_id: model.slice(separatorIndex + 1),
    display: model,
  }
}
