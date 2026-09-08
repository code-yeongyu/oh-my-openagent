import type { ResolvedChildPlan } from "@oh-my-opencode/senpi-task"

import type { TaskModelRegistry } from "./planner"
import type { ParentServiceTier } from "./runtime-context"

const FAST_MODEL_SUFFIX = "-fast"

export type ResolveParentServiceTier = () => ParentServiceTier | undefined

type ModelReference = {
  readonly provider: string
  readonly id: string
}

// A catalog priority-tier alias of the base model: same provider, `<base>-fast` id, declares
// `serviceTier: "priority"` and points its upstream id back at the base. This is the exact shape
// senpi's catalog generator emits for openai and openai-codex; a model that merely ends in `-fast`
// (a different Cursor composer SKU, a user-defined entry with its own upstream id) is NOT an alias
// and must not replace the planned model.
type FastVariant = ModelReference & {
  readonly upstreamModelId: string
  readonly serviceTier: "priority"
}

function splitModelReference(reference: string): ModelReference | undefined {
  const slash = reference.indexOf("/")
  if (slash <= 0 || slash === reference.length - 1) return undefined
  return { provider: reference.slice(0, slash), id: reference.slice(slash + 1) }
}

function readField(candidate: object, field: string): unknown {
  return field in candidate ? Reflect.get(candidate, field) : undefined
}

function asFastVariant(candidate: unknown, base: ModelReference): FastVariant | undefined {
  if (typeof candidate !== "object" || candidate === null) return undefined
  const fastId = `${base.id}${FAST_MODEL_SUFFIX}`
  if (readField(candidate, "provider") !== base.provider || readField(candidate, "id") !== fastId) return undefined
  if (readField(candidate, "serviceTier") !== "priority" || readField(candidate, "upstreamModelId") !== base.id) {
    return undefined
  }
  return { provider: base.provider, id: fastId, upstreamModelId: base.id, serviceTier: "priority" }
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
  registry: TaskModelRegistry | undefined,
  parentServiceTier: ParentServiceTier | undefined,
): ResolvedChildPlan {
  if (parentServiceTier !== "priority" || registry === undefined) return plan
  const base = splitModelReference(plan.model)
  if (base === undefined || base.id.endsWith(FAST_MODEL_SUFFIX)) return plan
  const variant = asFastVariant(registry.find(base.provider, `${base.id}${FAST_MODEL_SUFFIX}`), base)
  if (variant === undefined) return plan
  const model = `${variant.provider}/${variant.id}`
  return {
    ...plan,
    model,
    ...(plan.resolved_model === undefined
      ? {}
      : { resolved_model: { ...plan.resolved_model, model_id: variant.id, display: model } }),
  }
}
