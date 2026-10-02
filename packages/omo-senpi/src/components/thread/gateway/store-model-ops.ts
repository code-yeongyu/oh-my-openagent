/**
 * The session-model half of the store (#9425), loaded only in the store worker like `store-ops.ts`.
 * The gateway records a model when it creates or re-models a session; the session's own runtime then
 * keeps the record true through the engine's `model_select` (a user's `/model`, a fallback switch and
 * its revert) and writes one `milestone` row per outbound binding for a fallback switch.
 */
import type { SqlRow } from "./sql"
import { fallbackMilestoneText, type ModelChange, type ModelProvenance, type ModelSetter, type ObserveModelRequest, type ObserveModelResult, type ThreadModel } from "./session-models"
import { type StoreContext, transaction, write } from "./store-ops"
import { expireDue, insertOutbox, selectBindings } from "./store-relay-ops"

const COLUMNS = ["durable_id", "provider", "model_id", "thinking_level", "provenance", "set_by", "reason", "chosen_provider", "chosen_model_id", "chosen_provenance"] as const

function nullable(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function modelFrom(row: SqlRow): ThreadModel {
  return {
    provider: String(row.provider),
    id: String(row.model_id),
    thinking_level: nullable(row.thinking_level),
    provenance: row.provenance as ModelProvenance,
    set_by: nullable(row.set_by) as ModelSetter | null,
    reason: nullable(row.reason),
  }
}

function selectModel(ctx: StoreContext, durableId: string): SqlRow | undefined {
  return ctx.sql.one([...COLUMNS], `SELECT ${COLUMNS.join(", ")} FROM session_models WHERE durable_id = ?`, [durableId])
}

/** The gateway's own choice at spawn or `set-model`: replaces the record, and is what a later fallback revert returns to. */
export async function recordSessionModel(ctx: StoreContext, request: { readonly now: number; readonly durable_id: string; readonly model: ThreadModel }): Promise<ThreadModel> {
  const { model } = request
  await transaction(ctx, "record_session_model", () => {
    write(
      ctx,
      `INSERT INTO session_models (durable_id, provider, model_id, thinking_level, provenance, set_by, reason, chosen_provider, chosen_model_id, chosen_provenance, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(durable_id) DO UPDATE SET provider = excluded.provider, model_id = excluded.model_id, thinking_level = excluded.thinking_level,
         provenance = excluded.provenance, set_by = excluded.set_by, reason = excluded.reason, chosen_provider = excluded.chosen_provider,
         chosen_model_id = excluded.chosen_model_id, chosen_provenance = excluded.chosen_provenance, updated_at = excluded.updated_at`,
      [request.durable_id, model.provider, model.id, model.thinking_level, model.provenance, model.set_by, model.reason, model.provider, model.id, model.provenance === "fallback" ? null : model.provenance, request.now],
    )
  })
  return model
}

/** A new thinking level for a session the gateway has a record of; false when it has none. */
export async function updateSessionThinking(ctx: StoreContext, request: { readonly now: number; readonly durable_id: string; readonly thinking_level: string }): Promise<boolean> {
  return await transaction(ctx, "update_session_thinking", () =>
    write(ctx, "UPDATE session_models SET thinking_level = ?, updated_at = ? WHERE durable_id = ?", [request.thinking_level, request.now, request.durable_id]) > 0)
}

function observe(ctx: StoreContext, request: ObserveModelRequest, row: SqlRow): void {
  const to = [request.to.provider, request.to.id]
  const thinking = request.thinking_level
  if (request.source === "fallback") {
    // A second fallback in the same window keeps the model the first one overrode.
    const chosen = row.provenance === "fallback" ? [row.chosen_provider, row.chosen_model_id, row.chosen_provenance] : [row.provider, row.model_id, row.provenance]
    write(ctx, "UPDATE session_models SET provider = ?, model_id = ?, thinking_level = COALESCE(?, thinking_level), provenance = 'fallback', reason = ?, chosen_provider = ?, chosen_model_id = ?, chosen_provenance = ?, updated_at = ? WHERE durable_id = ?", [
      ...to, thinking, request.reason, nullable(chosen[0]), nullable(chosen[1]), nullable(chosen[2]), request.now, request.durable_id,
    ])
    return
  }
  if (request.source === "fallback-revert") {
    if (row.provenance !== "fallback") return
    write(ctx, "UPDATE session_models SET provider = ?, model_id = ?, thinking_level = COALESCE(?, thinking_level), provenance = COALESCE(chosen_provenance, 'set'), reason = NULL, updated_at = ? WHERE durable_id = ?", [...to, thinking, request.now, request.durable_id])
    return
  }
  // `set` or `cycle`: an explicit switch. The gateway writes its own setter after the engine switched,
  // so the switch the session observes for the model the record already names as set keeps that setter.
  const same = row.provider === request.to.provider && row.model_id === request.to.id && row.provenance === "set"
  const setBy = same ? nullable(row.set_by) : "user"
  write(ctx, "UPDATE session_models SET provider = ?, model_id = ?, thinking_level = COALESCE(?, thinking_level), provenance = 'set', set_by = ?, reason = NULL, chosen_provider = ?, chosen_model_id = ?, chosen_provenance = 'set', updated_at = ? WHERE durable_id = ?", [
    ...to, thinking, setBy, ...to, request.now, request.durable_id,
  ])
}

/**
 * The session's `model_select`. A record exists only for a session the gateway created or
 * re-modelled; a session without one is left without one. A `restore` (a resume re-applying the
 * persisted model) changes nothing. A `fallback` writes one milestone row to every active outbound
 * binding of the session subscribed to milestones, record or not.
 */
export async function observeModelSelect(ctx: StoreContext, request: ObserveModelRequest): Promise<ObserveModelResult> {
  if (request.source === "restore") return { updated: false, milestones: [] }
  const result = await transaction(ctx, "observe_model_select", () => {
    const row = selectModel(ctx, request.durable_id)
    if (row !== undefined) observe(ctx, request, row)
    // senpi's fallback always switches away from a current model, so `from` is known; the record stands in when the event omits it.
    const from = request.from ?? (row === undefined ? null : { provider: String(row.provider), id: String(row.model_id) })
    if (request.source !== "fallback" || from === null) return { updated: row !== undefined, milestones: [] }
    expireDue(ctx, request.now)
    const change: ModelChange = { from, to: request.to, reason: request.reason }
    const milestones = selectBindings(ctx, "session_durable_id = ? AND status = 'active' AND direction_outbound = 1", [request.durable_id])
      .filter((binding) => binding.outbound_events.includes("milestone"))
      .map((binding) => ({ binding_id: binding.binding_id, cursor: insertOutbox(ctx, { binding, event: "milestone", text: fallbackMilestoneText(change), now: request.now, model_change: change }) }))
    return { updated: row !== undefined, milestones }
  })
  ctx.emit({ kind: "model_observed", session_durable_id: request.durable_id, source: request.source, updated: result.updated, cursors: result.milestones.map((row) => row.cursor) })
  return result
}

/** The records of `durableIds` that exist, keyed by durable id; a plain read that takes no write lock. */
export function sessionModels(ctx: StoreContext, durableIds: readonly string[]): Readonly<Record<string, ThreadModel>> {
  const models: Record<string, ThreadModel> = {}
  for (const durableId of new Set(durableIds)) {
    const row = selectModel(ctx, durableId)
    if (row !== undefined) models[durableId] = modelFrom(row)
  }
  return models
}
