import type { EffectiveModelRecord, EffectiveModelSource, ResolvedModelRecord, TaskRecord } from "../state"
import { type ManagedChildEvent } from "./child-handle"

export type ModelEventStore = {
  readonly load?: (taskId: string) => TaskRecord | null | undefined
  readonly replace?: (record: TaskRecord) => void
  /**
   * Whether a `model_changed` effect id was minted by THIS omo process (the S1 effect ledger).
   * Pre-S1 no checker exists - nothing is ours - so every `set`/`cycle` switch reads as the
   * operator's, which is the truthful answer until omo can issue its own child `set_model`.
   */
  readonly isOwnEffect?: (effectId: string) => boolean
}

type ResolvedModelEventStore = {
  readonly load: (taskId: string) => TaskRecord | null | undefined
  readonly replace: (record: TaskRecord) => void
  readonly isOwnEffect?: (effectId: string) => boolean
}

// The `model_changed` sources the host actually names (docs/rpc.md "model_changed"). Anything
// else is future host vocabulary: ignored rather than persisted, because the record schema only
// vouches for these.
const MODEL_CHANGED_SOURCES: ReadonlySet<string> = new Set([
  "set",
  "cycle",
  "restore",
  "fallback",
  "fallback-revert",
])

/**
 * Apply a child's live model events to its record (F12): `retry_fallback_applied` (as before),
 * `retry_fallback_reverted` (restore the pre-fallback `resolved_model`) and `model_changed` (any
 * source) keep `effective_model` current, so `task_output`, `/tasks`, `omo.task.updated` and the
 * completion notice report the model the child actually runs. A `set`/`cycle` switch omo did not
 * mint itself is marked `switched_by_operator`. Never touches the spawn plan (`model` /
 * `resolved_model` state the plan except on the two fallback events) or the parent's model.
 */
export function applyModelEvent(
  store: ModelEventStore,
  taskId: string,
  event: ManagedChildEvent,
): void {
  if (store.load === undefined || store.replace === undefined) return
  const resolved: ResolvedModelEventStore = {
    load: store.load,
    replace: store.replace,
    ...(store.isOwnEffect === undefined ? {} : { isOwnEffect: store.isOwnEffect }),
  }
  switch (event.type) {
    case "retry_fallback_applied":
      return applyFallbackApplied(resolved, taskId, event)
    case "retry_fallback_reverted":
      return applyFallbackReverted(resolved, taskId, event)
    case "model_changed":
      return applyModelChanged(resolved, taskId, event)
    default:
      return
  }
}

function applyFallbackApplied(
  store: ResolvedModelEventStore,
  taskId: string,
  event: ManagedChildEvent,
): void {
  const selector = readEventString(event, "to")
  const record = store.load(taskId)
  if (selector === undefined || record == null) return
  const resolvedModel = parseModelSelector(selector, record.resolved_model?.source ?? "category")
  if (resolvedModel === undefined) return
  const fallbackModels = remainingFallbacks(record.fallback_models, resolvedModel)
  const fallbackAttempts = appendFallbackAttempts(
    record.fallback_attempts,
    record.resolved_model,
    resolvedModel,
  )
  store.replace({
    ...record,
    model: resolvedModel.display,
    resolved_model: resolvedModel,
    effective_model: toEffectiveRecord(resolvedModel, "fallback"),
    fallback_attempts: fallbackAttempts,
    updated_at: new Date().toISOString(),
    ...(fallbackModels === undefined ? {} : { fallback_models: fallbackModels }),
  })
}

function applyFallbackReverted(
  store: ResolvedModelEventStore,
  taskId: string,
  event: ManagedChildEvent,
): void {
  const record = store.load(taskId)
  if (record == null) return
  const selector = readEventString(event, "to")
  // Host truth first (the controller emits the original selector); the record's own attempt
  // history answers when the event carries none.
  const restored = (selector !== undefined
    ? parseModelSelector(selector, record.resolved_model?.source ?? "category")
    : undefined) ?? record.fallback_attempts?.[0]
  if (restored === undefined) return
  store.replace({
    ...record,
    model: restored.display,
    resolved_model: restored,
    effective_model: toEffectiveRecord(restored, "fallback-revert"),
    updated_at: new Date().toISOString(),
  })
}

function applyModelChanged(
  store: ResolvedModelEventStore,
  taskId: string,
  event: ManagedChildEvent,
): void {
  const record = store.load(taskId)
  if (record == null) return
  const source = readEventString(event, "source")
  if (source === undefined || !MODEL_CHANGED_SOURCES.has(source)) return
  const model = readModelRef(event)
  if (model === undefined) return
  const thinkingLevel = readEventString(event, "thinkingLevel")
  const effectId = readEventString(event, "effectId")
  const switchedByOperator = (source === "set" || source === "cycle")
    && (effectId === undefined || store.isOwnEffect?.(effectId) !== true)
  const previous = record.effective_model
  const sameRoute = previous?.provider === model.provider && previous?.model_id === model.id
  store.replace({
    ...record,
    effective_model: {
      provider: model.provider,
      model_id: model.id,
      display: `${model.provider}/${model.id}`,
      ...(thinkingLevel === undefined ? {} : { reasoning: thinkingLevel }),
      ...(sameRoute && previous?.service_tier !== undefined ? { service_tier: previous.service_tier } : {}),
      source: source as EffectiveModelSource,
      ...(switchedByOperator ? { switched_by_operator: true } : {}),
    },
    updated_at: new Date().toISOString(),
  })
}

function toEffectiveRecord(
  model: ResolvedModelRecord,
  source: EffectiveModelSource,
): EffectiveModelRecord {
  return {
    provider: model.provider,
    model_id: model.model_id,
    display: model.display,
    ...(model.variant === undefined ? {} : { variant: model.variant }),
    ...(model.reasoning_effort === undefined ? {} : { reasoning_effort: model.reasoning_effort }),
    ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
    source,
  }
}

function readModelRef(event: ManagedChildEvent): { readonly provider: string; readonly id: string } | undefined {
  const value = Reflect.get(event, "model")
  if (typeof value !== "object" || value === null) return undefined
  const provider = Reflect.get(value, "provider")
  const id = Reflect.get(value, "id")
  return typeof provider === "string" && typeof id === "string" ? { provider, id } : undefined
}

function parseModelSelector(
  selector: string,
  source: ResolvedModelRecord["source"],
): ResolvedModelRecord | undefined {
  const slash = selector.indexOf("/")
  if (slash <= 0 || slash === selector.length - 1) return undefined
  const colon = selector.lastIndexOf(":")
  const hasThinking = colon > slash
  const display = hasThinking ? selector.slice(0, colon) : selector
  return {
    source,
    provider: display.slice(0, slash),
    model_id: display.slice(slash + 1),
    display,
    ...(hasThinking
      ? { reasoning: selector.slice(colon + 1), reasoning_effort: selector.slice(colon + 1) }
      : {}),
  }
}

function remainingFallbacks(
  candidates: readonly ResolvedModelRecord[] | undefined,
  selected: ResolvedModelRecord,
): readonly ResolvedModelRecord[] | undefined {
  if (candidates === undefined) return undefined
  const selectedIndex = candidates.findIndex((candidate) =>
    candidate.provider === selected.provider && candidate.model_id === selected.model_id
  )
  return selectedIndex === -1 ? candidates : candidates.slice(selectedIndex + 1)
}

function appendFallbackAttempts(
  attempts: readonly ResolvedModelRecord[] | undefined,
  previous: ResolvedModelRecord | undefined,
  selected: ResolvedModelRecord,
): readonly ResolvedModelRecord[] {
  const next = [...(attempts ?? [])]
  for (const candidate of [previous, selected]) {
    if (
      candidate !== undefined
      && !next.some((attempt) =>
        attempt.provider === candidate.provider && attempt.model_id === candidate.model_id
      )
    ) {
      next.push(candidate)
    }
  }
  return next
}

function readEventString(event: ManagedChildEvent, key: string): string | undefined {
  const value = Reflect.get(event, key)
  return typeof value === "string" ? value : undefined
}
