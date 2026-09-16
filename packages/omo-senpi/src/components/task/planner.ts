import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { inheritParentFastMode, type ResolveParentServiceTier } from "./fast-mode-inheritance"
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
//    against the live registry and a missing registry fails closed as model_unavailable. A
//    subagent_type naming no enabled agent is a typed unknown_target error - never a category
//    lookup of the same string (#8348).
// 2. an explicit `model` alone is honored verbatim, before any registry access.
// 3. a category resolves against omo.json + the registry.
// Whatever path resolved, the plan then inherits the parent's effective execution tier
// (fast-mode-inheritance.ts) so a fast parent never delegates to a standard-tier child.
export function createTaskChildPlanner(
  omoConfig: OmoConfig,
  agents: Readonly<Record<string, AgentDefinition>>,
  resolveRegistry: ResolveModelRegistry,
  resolveParentServiceTier: ResolveParentServiceTier = () => undefined,
): ChildPlanner {
  const availableAgents = listAvailableAgents(agents)
  const planChild = (spec: Parameters<ChildPlanner>[0]): PlanResolution => {
    if (spec.subagent_type !== undefined) {
      const agentResolution = resolveAgentTarget(spec.subagent_type, spec.model, agents, resolveRegistry, omoConfig)
      return agentResolution ?? unresolvableAgentTarget(spec.subagent_type, availableAgents, resolveRegistry, omoConfig)
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

    const categoryName = spec.category
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
  return (spec): PlanResolution => {
    const resolution = planChild(spec)
    if (resolution.kind !== "resolved") return resolution
    return {
      kind: "resolved",
      plan: inheritParentFastMode(resolution.plan, resolveRegistry(), resolveParentServiceTier()),
    }
  }
}

// Agent-first target handling. `undefined` means "this name is no enabled agent" - unknown or
// disabled alike, with or without an explicit model, so a disabled agent can never be revived by a
// call-site model. The caller turns that into a typed error; it is never a category lookup.
function resolveAgentTarget(
  agentName: string,
  explicitModel: string | undefined,
  agents: Readonly<Record<string, AgentDefinition>>,
  resolveRegistry: ResolveModelRegistry,
  omoConfig: OmoConfig,
): PlanResolution | undefined {
  if (explicitModel !== undefined && explicitModel.length > 0) {
    const resolution = resolveAgent(agentName, agents, undefined, { modelOverride: explicitModel })
    if (resolution.kind !== "resolved") return undefined
    return { kind: "resolved", plan: toAgentPlan(resolution, explicitModelMetadata(explicitModel)) }
  }

  const registry = resolveRegistry()
  const resolution = resolveAgent(agentName, agents, registry, { omoConfig })
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

// A subagent_type names an AGENT. When it names none, the caller is told so by name and pointed at
// the valid targets - and, when the string happens to be a category key, at the `category` field it
// meant. Falling through to a category lookup instead (the pre-#8348 behavior) silently handed the
// caller another family's model with no error and no warning.
function unresolvableAgentTarget(
  agentName: string,
  availableAgents: readonly string[],
  resolveRegistry: ResolveModelRegistry,
  omoConfig: OmoConfig,
): PlanResolution {
  const registry = resolveRegistry()
  const category = registry === undefined ? undefined : resolveCategory(agentName, omoConfig, registry)
  const categoryHint =
    category !== undefined && category.kind !== "not_found"
      ? ` "${agentName}" is a category, not an agent — use category="${agentName}" instead.`
      : ""
  return {
    kind: "error",
    error: {
      code: "unknown_target",
      message: `Subagent type "${agentName}" is not an available agent.${categoryHint}`,
      availableAgents,
      ...(category !== undefined ? { availableCategories: category.availableCategories } : {}),
    },
  }
}

function toAgentPlan(resolution: ResolvedAgentResult, explicitModel: ResolvedModelMetadata | undefined): ResolvedPlan {
  const resolvedModel = resolution.resolved_model ?? explicitModel
  // Identical precedence to the category path below: reasoning outranks reasoningEffort outranks
  // variant, and whichever is chosen becomes the child's thinking level through asSenpiThinkingLevel.
  const appliedVariant = resolution.resolved_model?.reasoning ?? resolution.resolved_model?.reasoning_effort ?? resolution.resolved_model?.variant
  return {
    model: resolution.model,
    ...(resolution.requested_model !== undefined
      ? { requested_model: resolution.requested_model }
      : {}),
    ...(resolution.fallback_models !== undefined
      ? { fallback_models: resolution.fallback_models }
      : {}),
    ...(resolvedModel !== undefined ? { resolved_model: resolvedModel } : {}),
    ...(appliedVariant !== undefined ? { variant: appliedVariant } : {}),
    agentType: resolution.agentType,
    ...(resolution.instructions !== undefined ? { instructions: resolution.instructions } : {}),
    ...(resolution.toolAllowlist !== undefined ? { toolAllowlist: resolution.toolAllowlist } : {}),
    // The denylist must travel too: it becomes the record's tool_deny -> ChildSpec.toolDenylist ->
    // senpi excludeTools, and a deny-only agent is otherwise invisible to every policy check.
    ...(resolution.toolDenylist !== undefined ? { toolDenylist: resolution.toolDenylist } : {}),
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
    const appliedVariant = resolution.spec.reasoning ?? resolution.spec.reasoningEffort ?? resolution.spec.variant
    return {
      kind: "resolved",
      plan: {
        model: `${resolution.spec.provider}/${resolution.spec.modelId}`,
        ...(resolution.spec.requested_model !== undefined
          ? { requested_model: resolution.spec.requested_model }
          : {}),
        ...(resolution.spec.fallback_models !== undefined
          ? { fallback_models: resolution.spec.fallback_models }
          : {}),
        resolved_model: {
          source: "category",
          provider: resolution.spec.provider,
          model_id: resolution.spec.modelId,
          display: resolution.spec.displayName ?? `${resolution.spec.provider}/${resolution.spec.modelId}`,
          ...(resolution.spec.variant !== undefined ? { variant: resolution.spec.variant } : {}),
          ...(resolution.spec.reasoningEffort !== undefined ? { reasoning_effort: resolution.spec.reasoningEffort } : {}),
          ...(resolution.spec.reasoning !== undefined ? { reasoning: resolution.spec.reasoning } : {}),
        },
        ...(appliedVariant !== undefined ? { variant: appliedVariant } : {}),
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
      // Dead-chain detail rides the error so the warning layer can surface it without re-resolving.
      category: categoryName,
      ...(resolution.attempted_chain !== undefined && { attempted_chain: resolution.attempted_chain }),
      ...(resolution.missing_providers !== undefined && { missing_providers: resolution.missing_providers }),
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
