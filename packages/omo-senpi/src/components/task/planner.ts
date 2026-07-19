import type { OmoAgentDef, OmoConfig } from "@oh-my-opencode/omo-config-core"
import { parseModelString } from "@oh-my-opencode/model-core"
import {
  resolveCategory,
  type ChildPlanner,
  type PlanResolution,
  type SenpiModelPort,
  type SenpiModelRegistryPort,
} from "@oh-my-opencode/senpi-task"

type ResolvedPlan = Extract<PlanResolution, { readonly kind: "resolved" }>["plan"]
type ResolvedModelMetadata = NonNullable<ResolvedPlan["resolved_model"]>

// The live senpi model registry surface the planner needs. ExtensionContext.modelRegistry satisfies
// it structurally; a fake with getAvailable/find satisfies it in tests.
export type TaskModelRegistry = SenpiModelRegistryPort<SenpiModelPort>

export type ResolveModelRegistry = () => TaskModelRegistry | undefined

// The category-resolving ChildPlanner the manager consumes. Resolution order:
//   1. explicit `spec.model` is honored verbatim;
//   2. `spec.subagent_type` resolves against the user's `omo.json` `agents` map (an AgentDefinition
//      with its own model / execution_mode / allowed_subagents / max_depth / tools / prompt);
//   3. otherwise `spec.category` resolves against `omo.json` `categories` + the live model registry.
// A missing registry (headless / before first live context) fails closed as model_unavailable rather
// than spawning against an unknown model. `subagent_type` is NOT a category lookup: routing it through
// `resolveCategory` would reject every named agent with `Category "<agent>" not found`, which is the
// bug this branch fixes.
export function createTaskChildPlanner(omoConfig: OmoConfig, resolveRegistry: ResolveModelRegistry): ChildPlanner {
  return (spec): PlanResolution => {
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

    if (spec.subagent_type !== undefined && spec.subagent_type.length > 0) {
      const agentDef = omoConfig.agents?.[spec.subagent_type]
      if (agentDef === undefined) {
        return {
          kind: "error",
          error: {
            code: "unknown_target",
            message: `subagent_type "${spec.subagent_type}" not found in omo.json agents.`,
          },
        }
      }
      if (agentDef.disable === true) {
        return {
          kind: "error",
          error: {
            code: "category_disabled",
            message: `Agent "${spec.subagent_type}" is disabled by omo.json.`,
          },
        }
      }
      // Resolve the agent's model. Prefer an explicit `model`: when the registry is available,
      // it must be reachable (variant suffix stripped, so `"cliproxy/kimi-k3 low"` matches a
      // registry entry `cliproxy/kimi-k3`); when the registry is cold, it is trusted verbatim so
      // the agent can still be addressed before the model cache warms. If the primary is
      // unreachable, fall back to the first `models[]` entry the registry reports available
      // (also variant-stripped). An agent with neither a reachable primary nor a reachable
      // fallback cannot be spawned.
      const registry = resolveRegistry()
      const resolvedModel = resolveAgentModel(agentDef, registry)
      if (resolvedModel === undefined) {
        const attempted = agentDef.model ?? agentDef.models?.[0] ?? "none"
        return {
          kind: "error",
          error: {
            code: registry === undefined ? "model_unavailable" : "model_unavailable",
            message:
              registry === undefined
                ? "No senpi model registry is available yet to resolve a task model."
                : `No available model for subagent_type "${spec.subagent_type}" (attempted ${attempted}).`,
          },
        }
      }
      return {
        kind: "resolved",
        plan: {
          model: resolvedModel.model,
          resolved_model: resolvedModel.metadata,
          agentType: spec.subagent_type,
          ...(agentDef.execution_mode !== undefined ? { agentExecutionMode: agentDef.execution_mode } : {}),
          ...(agentDef.allowed_subagents !== undefined ? { allowedSubagents: agentDef.allowed_subagents } : {}),
          ...(agentDef.max_depth !== undefined ? { maxDepth: agentDef.max_depth } : {}),
          ...(agentDef.prompt !== undefined ? { instructions: agentDef.prompt } : {}),
          ...(agentDef.tools !== undefined ? { toolAllowlist: resolveAgentToolAllowlist(agentDef.tools) } : {}),
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
        error: { code: "model_unavailable", message: "No senpi model registry is available yet to resolve a task model." },
      }
    }

    const resolution = resolveCategory(categoryName, omoConfig, registry)
    return toPlanResolution(categoryName, resolution)
  }
}

// Resolve a model for an `OmoAgentDef`. Mirrors the user-model path of `resolveModelForDelegateTask`:
// the primary `model` is checked against the live registry (variant suffix stripped via
// `parseModelString`, so `"cliproxy/kimi-k3 low"` matches a registry that has `cliproxy/kimi-k3`);
// if it is unavailable, the first reachable `models[]` entry wins (also variant-stripped). When no
// registry is available (headless / before first live context) the primary is trusted verbatim so
// an agent can still be addressed before the model cache warms. An agent with neither `model` nor a
// reachable `models[]` entry returns undefined so the caller surfaces `model_unavailable`.
function resolveAgentModel(
  agentDef: OmoAgentDef,
  registry: TaskModelRegistry | undefined,
): { readonly model: string; readonly metadata: ResolvedModelMetadata } | undefined {
  const availableSet = buildAvailableModelSet(registry)

  if (agentDef.model !== undefined && agentDef.model.length > 0) {
    const parsed = parseModelString(agentDef.model)
    const primaryAvailable = parsed === undefined
      || availableSet === undefined
      || availableSet.has(`${parsed.providerID}/${parsed.modelID}`)
    if (primaryAvailable) {
      const metadata = explicitModelMetadata(agentDef.model)
      if (metadata === undefined) {
        return { model: agentDef.model, metadata: { source: "explicit", provider: "", model_id: agentDef.model, display: agentDef.model } }
      }
      return { model: agentDef.model, metadata }
    }
  }

  if (agentDef.models !== undefined && agentDef.models.length > 0 && availableSet !== undefined) {
    for (const candidate of agentDef.models) {
      const parsed = parseModelString(candidate)
      if (parsed === undefined) continue
      if (availableSet.has(`${parsed.providerID}/${parsed.modelID}`)) {
        const metadata: ResolvedModelMetadata = {
          source: "explicit",
          provider: parsed.providerID,
          model_id: parsed.modelID,
          display: candidate,
          ...(parsed.variant !== undefined ? { variant: parsed.variant } : {}),
        }
        return { model: `${parsed.providerID}/${parsed.modelID}`, metadata }
      }
    }
  }
  return undefined
}

// Build a `provider/modelID` set from the registry, or undefined when the registry is absent. The
// variant suffix is NOT included in the set keys, so `parseModelString` callers can match
// `"cliproxy/kimi-k3 low"` against a set containing `"cliproxy/kimi-k3"`.
function buildAvailableModelSet(registry: TaskModelRegistry | undefined): Set<string> | undefined {
  if (registry === undefined) return undefined
  const available = registry.getAvailable()
  if (!Array.isArray(available)) return undefined
  const set = new Set<string>()
  for (const m of available) {
    if (m !== null && typeof m === "object" && "provider" in m && "id" in m) {
      set.add(`${(m as { provider: string }).provider}/${(m as { id: string }).id}`)
    }
  }
  return set
}

// `OmoAgentDef.tools` is `{ name: boolean }` (allow/deny). Convert allow entries to a tool allowlist;
// deny entries are surfaced as the manager's tool_deny path via toolAllowlist only carrying allowed
// names. The manager's `toolAllowlist` becomes the child's `tools:` whitelist; denying everything is
// expressed by an empty allowlist.
function resolveAgentToolAllowlist(tools: NonNullable<OmoAgentDef["tools"]>): readonly string[] {
  return Object.entries(tools)
    .filter(([, allowed]) => allowed === true)
    .map(([name]) => name)
}

function toPlanResolution(
  categoryName: string,
  resolution: ReturnType<typeof resolveCategory<SenpiModelPort>>,
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
