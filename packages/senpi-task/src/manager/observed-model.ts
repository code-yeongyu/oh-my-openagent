import { isTerminalRecord, nowIso } from "./manager-helpers"
import type { ResolvedModelRecord, TaskRecord } from "../state"
import type { ManagedChildEvent, ManagedChildHandle } from "./child-handle"

/**
 * The provider/model a child event says the child is running on (#9722). The only real carrier is
 * an assistant message (`message.provider` + `message.model`) - in-process and rpc children both
 * stream those. Anything else is not a model observation, and an event naming only one half is
 * ignored: a partial observation must never rewrite the record.
 */
export function readObservedModel(event: ManagedChildEvent): { readonly provider: string; readonly modelId: string } | undefined {
  if (typeof event.message !== "object" || event.message === null) return undefined
  const provider = readStringField(event.message, "provider")
  const modelId = readStringField(event.message, "model")
  return provider === undefined || modelId === undefined ? undefined : { provider, modelId }
}

export type EffectiveModelStore = {
  readonly load?: (taskId: string) => TaskRecord | null | undefined
  readonly replace?: (record: TaskRecord) => void
}

export type EffectiveModelPort = {
  readonly store: EffectiveModelStore
  readonly taskId: string
  readonly now: () => number
}

/** The record's effective route at spawn, read from the child handle itself - never the plan (#9722). */
export function stampSpawnEffectiveModel(record: TaskRecord, observedModel: { readonly provider: string; readonly id: string } | undefined): TaskRecord {
  if (observedModel === undefined) return record
  return {
    ...record,
    effective_model: {
      provider: observedModel.provider,
      model_id: observedModel.id,
      display: `${observedModel.provider}/${observedModel.id}`,
      source: record.resolved_model?.source ?? "explicit",
    },
  }
}

/**
 * Write the child's observed route onto the record's effective_model. It touches NOTHING else:
 * `model` and `resolved_model` keep stating the plan, and a runtime fallback's own rewrite stays
 * the fallback path's job. A same-value observation is a no-op, so the store is not churned per
 * assistant message.
 */
export function observeChildEffectiveModel(port: EffectiveModelPort, provider: string, modelId: string): void {
  if (port.store.load === undefined || port.store.replace === undefined) return
  const current = port.store.load(port.taskId)
  if (current === null || current === undefined || isTerminalRecord(current)) return
  if (current.effective_model?.provider === provider && current.effective_model.model_id === modelId) return
  const effective: ResolvedModelRecord = {
    provider,
    model_id: modelId,
    display: `${provider}/${modelId}`,
    source: current.effective_model?.source ?? current.resolved_model?.source ?? "explicit",
  }
  port.store.replace({ ...current, effective_model: effective, updated_at: nowIso(port.now) })
}

/** Keep a running record's effective_model current from the child's own assistant messages. */
export function subscribeEffectiveModel(handle: ManagedChildHandle, port: EffectiveModelPort): () => void {
  return handle.subscribe((event) => {
    const observed = readObservedModel(event)
    if (observed !== undefined) observeChildEffectiveModel(port, observed.provider, observed.modelId)
  })
}

function readStringField(record: object, key: string): string | undefined {
  const value = Reflect.get(record, key)
  return typeof value === "string" ? value : undefined
}
