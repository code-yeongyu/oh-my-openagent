import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
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

// The category-resolving ChildPlanner the manager consumes. An explicit `model` on the spec is honored
// verbatim; otherwise a category is resolved against omo.json + the live model registry. A missing
// registry (headless / before first live context) fails closed as model_unavailable rather than
// spawning against an unknown model.
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

    const categoryName = spec.category ?? spec.subagent_type
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
