import { isPriorityAliasOf, type PriorityPairingRegistry, type ResolvedChildPlan } from "@oh-my-opencode/senpi-task"

import type { TaskModelRegistry } from "./planner"
import type { ParentServiceTier } from "./runtime-context"

const FAST_MODEL_SUFFIX = "-fast"

export type ResolveParentServiceTier = () => ParentServiceTier | undefined

type ModelReference = {
  readonly provider: string
  readonly id: string
}

function splitModelReference(reference: string): ModelReference | undefined {
  const slash = reference.indexOf("/")
  if (slash <= 0 || slash === reference.length - 1) return undefined
  return { provider: reference.slice(0, slash), id: reference.slice(slash + 1) }
}

/**
 * A delegated child preserves the parent's effective execution tier: when the parent is on the
 * priority ("fast") tier and the planned model has a `-fast` catalog sibling, the child is planned
 * on that sibling. The tier then travels as MODEL IDENTITY, which is the one thing every child
 * runner already carries (in-process `model`, rpc `--model`, persisted `resolved_model`, resume),
 * and the task row shows the `-fast` id instead of silently running standard. A model already on
 * `-fast`, or one with no priority sibling, is left as planned.
 */
export function inheritParentFastMode(
  plan: ResolvedChildPlan,
  registry: (TaskModelRegistry & PriorityPairingRegistry) | undefined,
  parentServiceTier: ParentServiceTier | undefined,
): ResolvedChildPlan {
  if (parentServiceTier !== "priority" || registry === undefined) return plan
  const base = splitModelReference(plan.model)
  if (base === undefined || base.id.endsWith(FAST_MODEL_SUFFIX)) return plan
  const fastId = `${base.id}${FAST_MODEL_SUFFIX}`
  const baseEntry = registry.find(base.provider, base.id)
  if (!isPriorityAliasOf(registry.find(base.provider, fastId), baseEntry, registry)) return plan
  const model = `${base.provider}/${fastId}`
  return {
    ...plan,
    model,
    ...(plan.resolved_model === undefined
      ? {}
      : { resolved_model: { ...plan.resolved_model, model_id: fastId, display: model } }),
  }
}
