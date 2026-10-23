import { isFallbackHandoff } from "../lifecycle/fallback-handoff"
import type { EffectiveModelRecord, ResolvedModelRecord, TaskRecord } from "../state"
import type { ManagerStartSpec, ResolvedChildPlan } from "./types"

export type ParentRungPlan = {
  readonly plan: ResolvedChildPlan
  readonly parentModel?: string
}

/**
 * A category child's chain ends on the model its parent session runs (#10750): when every category rung
 * is spent or signed out, the child keeps working on the model the user chose instead of dying. The rung
 * goes LAST, after admission picked the primary, so any usable category rung still routes exactly as
 * before. An explicit model pin, an agent route, or a parent model the chain already names adds nothing.
 */
export function withParentModelRung(plan: ResolvedChildPlan, spec: ManagerStartSpec): ParentRungPlan {
  if (spec.category === undefined || spec.model !== undefined || spec.parent_model === undefined) return { plan }
  const parent = parseParentModel(spec.parent_model, plan.resolved_model?.source ?? "category")
  if (parent === undefined) return { plan }
  const chain = [plan.resolved_model, plan.requested_model, ...(plan.fallback_models ?? [])]
  if (chain.some((rung) => rung !== undefined && sameModel(rung, parent)) || plan.model === parent.display) return { plan }
  return {
    plan: { ...plan, fallback_models: [...(plan.fallback_models ?? []), parent] },
    parentModel: parent.display,
  }
}

export function isParentModelRung(record: Pick<TaskRecord, "parent_model">, model: string | Pick<ResolvedModelRecord, "provider" | "model_id">): boolean {
  if (record.parent_model === undefined) return false
  if (typeof model !== "string") return `${model.provider}/${model.model_id}` === record.parent_model
  // A model id may itself contain ":" (a Bedrock "...-v2:0"), so the selector matches as-is or without a thinking suffix.
  return model === record.parent_model || baseSelector(model) === record.parent_model
}

/**
 * The parent-model note as of the child's CURRENT route. It reads as ran ONLY once a child is observed on the
 * parent's model. While the parent's model is SELECTED but no child has reported it (#10797), whether an older
 * route was observed or none ever was, it carries a phase instead: `switching` while the task is live,
 * `unconfirmed` once it ended. An ended record cannot tell a child that never spawned from one that spawned
 * without reporting its model and died before its first message, so the phase never claims which of the two
 * happened. A revert or an operator switch drops it.
 */
export function activeParentModelFallback(record: TaskRecord): TaskRecord["parent_model_fallback"] {
  const fallback = record.parent_model_fallback
  const observed = record.effective_model
  if (fallback === undefined || (observed !== undefined && isParentModelRung(record, observed))) return fallback
  const live = record.status === "running" || record.status === "pending" || isFallbackHandoff(record)
  const selected = record.resolved_model
  const parentSelected = selected !== undefined && isParentModelRung(record, selected)
  if (!parentSelected || (observed !== undefined && movedAway(observed))) return undefined
  return { ...fallback, phase: live ? "switching" : "unconfirmed" }
}

/** An observation that came after the hop (a revert, an operator or client switch) supersedes the note. */
function movedAway(observed: EffectiveModelRecord): boolean {
  return observed.switched_by_operator === true || CHANGES_AFTER_THE_HOP.has(observed.source)
}

const CHANGES_AFTER_THE_HOP: ReadonlySet<EffectiveModelRecord["source"]> = new Set(["set", "cycle", "restore", "fallback-revert"])

function parseParentModel(value: string, source: ResolvedModelRecord["source"]): ResolvedModelRecord | undefined {
  const slash = value.indexOf("/")
  if (slash <= 0 || slash === value.length - 1) return undefined
  return { source, provider: value.slice(0, slash), model_id: value.slice(slash + 1), display: value }
}

function sameModel(left: Pick<ResolvedModelRecord, "provider" | "model_id">, right: Pick<ResolvedModelRecord, "provider" | "model_id">): boolean {
  return left.provider === right.provider && left.model_id === right.model_id
}

function baseSelector(selector: string): string {
  const slash = selector.indexOf("/")
  const colon = selector.lastIndexOf(":")
  return colon > slash ? selector.slice(0, colon) : selector
}
