import type { OmoConfig, OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import type { ChildPlanner, PlanResolution, PlanResolutionError } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { TaskRuntimeContext } from "./runtime-context"
import { createOncePerSessionGuard } from "./usage-guidance"

// The dead-chain warning custom-message type; the component registers a compact renderer for it.
export const CATEGORY_UNAVAILABLE_MESSAGE_TYPE = "senpi-task.category-unavailable"

export type CategoryUnavailableWarningDeps = {
  readonly planner: ChildPlanner
  readonly pi: SenpiExtensionAPI
  readonly runtime: TaskRuntimeContext
  readonly omoConfig: OmoConfig
  readonly settings: OmoTaskSettings
}

type DeadChainError = PlanResolutionError & {
  readonly category: string
  readonly attempted_chain: NonNullable<PlanResolutionError["attempted_chain"]>
}

function asDeadChainError(resolution: PlanResolution): DeadChainError | undefined {
  if (resolution.kind !== "error") return undefined
  const error = resolution.error
  if (error.code !== "model_unavailable") return undefined
  if (error.category === undefined || error.attempted_chain === undefined) return undefined
  return { ...error, category: error.category, attempted_chain: error.attempted_chain }
}

function warningSuppressed(config: OmoConfig, settings: OmoTaskSettings, category: string): boolean {
  const perCategory = config.categories?.[category]?.warn_unavailable
  const effective = perCategory ?? settings.warnings?.unavailable_categories ?? true
  return effective === false
}

// A user category with its own model never warns: its failure is a plain user-model miss, not a
// dead builtin chain (the resolver omits attempted_chain for it; this is the belt-and-braces guard).
function hasUserModel(config: OmoConfig, category: string): boolean {
  return config.categories?.[category]?.model !== undefined
}

/**
 * Planner decorator that surfaces dead-chain category failures. On a model_unavailable plan error
 * carrying attempted_chain, once per (session, category): a headless-safe ui notify (auto-bridged
 * to RPC {method:"notify"} by senpi) plus a structured custom message for remote clients. It never
 * steers or triggers a turn, never fires at tool registration (the planner only runs at spawn,
 * when the registry is captured), and never warns for categories with a user-configured model.
 * Suppression: categories.<name>.warn_unavailable ?? task.warnings.unavailable_categories ?? true.
 */
export function createCategoryUnavailableWarningPlanner(deps: CategoryUnavailableWarningDeps): ChildPlanner {
  const warned = createOncePerSessionGuard()
  return (spec): PlanResolution => {
    const resolution = deps.planner(spec)
    const error = asDeadChainError(resolution)
    if (error === undefined) return resolution
    const category = error.category
    if (hasUserModel(deps.omoConfig, category)) return resolution
    if (warningSuppressed(deps.omoConfig, deps.settings, category)) return resolution
    const sessionId = deps.runtime.sessionId() ?? "unknown-session"
    if (!warned(`${sessionId}:${category}`)) return resolution

    const providers = (error.missing_providers ?? []).join(", ")
    const text = `Category "${category}" has no usable model: none of its fallback-chain providers are connected (${providers}).`
    deps.runtime.ui()?.notify(text, "info")
    deps.pi.sendMessage(
      {
        customType: CATEGORY_UNAVAILABLE_MESSAGE_TYPE,
        content: text,
        display: true,
        details: {
          category,
          reason: "no_chain_rung_available",
          attempted_chain: error.attempted_chain,
          missing_providers: error.missing_providers ?? [],
          available_categories: error.availableCategories ?? [],
        },
      },
      {},
    )
    return resolution
  }
}
