import type { ResolvedModelRecord, TaskRecord } from "../state"
import type { ManagedChildEvent } from "./child-handle"

export type RuntimeFallbackStore = {
  readonly load?: (taskId: string) => TaskRecord | null | undefined
  readonly replace?: (record: TaskRecord) => void
}

export function applyRuntimeFallbackEvent(
  store: RuntimeFallbackStore,
  taskId: string,
  event: ManagedChildEvent,
): void {
  if (event.type !== "retry_fallback_applied" || store.load === undefined || store.replace === undefined) return
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
    fallback_attempts: fallbackAttempts,
    updated_at: new Date().toISOString(),
    ...(fallbackModels === undefined ? {} : { fallback_models: fallbackModels }),
  })
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
