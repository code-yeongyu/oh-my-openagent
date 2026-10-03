/**
 * The session-model half of the store (#9425), loaded only in the store worker like `store-ops.ts`.
 * The gateway records a model when it creates or re-models a session; the session's own runtime then
 * keeps the record true through the engine's `model_select` (a user's `/model`, a fallback switch and
 * its revert) and writes one `milestone` row per outbound binding for a fallback switch.
 */
import type { SqlRow } from "./sql"
import { fallbackMilestoneText, type ModelChange, type ModelProvenance, type ModelSetter, type ObserveModelRequest, type ObserveModelResult, type SessionModelRecord, type ThreadModel } from "./session-models"
import { type StoreContext, transaction, write } from "./store-ops"
import { expireDue, insertOutbox, selectBindings } from "./store-relay-ops"

const COLUMNS = ["durable_id", "provider", "model_id", "thinking_level", "provenance", "set_by", "reason", "chosen_provider", "chosen_model_id", "chosen_provenance", "revision", "pending_provider", "pending_model_id", "pending_set_by"] as const

/** Every model write clears a held set-model's choice: a switch that lands ends the engine's hold. */
const CLEAR_PENDING = "pending_provider = NULL, pending_model_id = NULL, pending_set_by = NULL"

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

function recordFrom(row: SqlRow): SessionModelRecord {
  return { model: modelFrom(row), revision: Number(row.revision) }
}

function selectModel(ctx: StoreContext, durableId: string): SqlRow | undefined {
  return ctx.sql.one([...COLUMNS], `SELECT ${COLUMNS.join(", ")} FROM session_models WHERE durable_id = ?`, [durableId])
}

/**
 * Writes `model` as the record. A `fallback` record keeps the choice it overrode (`chosen_*`), so a
 * command that rewrites a session on its fallback model - a level change, a held or superseded
 * switch - leaves the engine's fallback-revert something true to return to.
 */
function putModel(ctx: StoreContext, durableId: string, model: ThreadModel, now: number): void {
  write(
    ctx,
    `INSERT INTO session_models (durable_id, provider, model_id, thinking_level, provenance, set_by, reason, chosen_provider, chosen_model_id, chosen_provenance, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(durable_id) DO UPDATE SET provider = excluded.provider, model_id = excluded.model_id, thinking_level = excluded.thinking_level,
       provenance = excluded.provenance, set_by = excluded.set_by, reason = excluded.reason,
       chosen_provider = CASE WHEN excluded.provenance = 'fallback' THEN session_models.chosen_provider ELSE excluded.chosen_provider END,
       chosen_model_id = CASE WHEN excluded.provenance = 'fallback' THEN session_models.chosen_model_id ELSE excluded.chosen_model_id END,
       chosen_provenance = CASE WHEN excluded.provenance = 'fallback' THEN session_models.chosen_provenance ELSE excluded.chosen_provenance END,
       updated_at = excluded.updated_at,
       revision = session_models.revision + 1, ${CLEAR_PENDING}`,
    [durableId, model.provider, model.id, model.thinking_level, model.provenance, model.set_by, model.reason, model.provider, model.id, model.provenance === "fallback" ? null : model.provenance, now],
  )
}

/** The gateway's own choice at spawn or `set-model`: replaces the record, and is what a later fallback revert returns to. */
export async function recordSessionModel(ctx: StoreContext, request: { readonly now: number; readonly durable_id: string; readonly model: ThreadModel }): Promise<ThreadModel> {
  const { model } = request
  await transaction(ctx, "record_session_model", () => {
    putModel(ctx, request.durable_id, model, request.now)
  })
  return model
}

/**
 * Compare-and-swap for the model command paths (#9429 B2): writes `model` only while the record is
 * still at the revision the caller read before it read the engine (`null`: no record yet). Every write
 * to the record bumps the revision - this one, the gateway's own record, and the session's observed
 * switches and levels - so a caller whose engine read-back is older than any write that landed since
 * its read loses the swap, even when that write put back the values it read (A->B->A). The store
 * worker runs every op in one serial queue, so the check and the write are atomic across every
 * SDK/CLI/agent caller sharing the database. `record` is the record after the call: the caller's
 * write when applied, else the one that beat it, for the caller to refresh from the engine.
 */
export async function recordSessionModelIfCurrent(ctx: StoreContext, request: { readonly now: number; readonly durable_id: string; readonly expect_revision: number | null; readonly model: ThreadModel }): Promise<{ readonly applied: boolean; readonly record: SessionModelRecord | null }> {
  return await transaction(ctx, "record_session_model_if_current", () => {
    const row = selectModel(ctx, request.durable_id)
    const record = row === undefined ? null : recordFrom(row)
    if ((record?.revision ?? null) !== request.expect_revision) return { applied: false, record }
    putModel(ctx, request.durable_id, request.model, request.now)
    return { applied: true, record: { model: request.model, revision: (record?.revision ?? 0) + 1 } }
  })
}

/**
 * A set-model the engine held: its choice waits on the record until the switch lands, so the session's
 * observer can attribute the landed switch to this setter. It is not the record's model, so the
 * revision does not move. False when the session has no record.
 */
export async function recordPendingSessionModel(ctx: StoreContext, request: { readonly now: number; readonly durable_id: string; readonly provider: string; readonly id: string; readonly set_by: ModelSetter }): Promise<boolean> {
  return await transaction(ctx, "record_pending_session_model", () =>
    write(ctx, "UPDATE session_models SET pending_provider = ?, pending_model_id = ?, pending_set_by = ? WHERE durable_id = ?", [request.provider, request.id, request.set_by, request.durable_id]) > 0)
}

/** A new thinking level for a session the gateway has a record of; false when it has none. */
export async function updateSessionThinking(ctx: StoreContext, request: { readonly now: number; readonly durable_id: string; readonly thinking_level: string }): Promise<boolean> {
  return await transaction(ctx, "update_session_thinking", () =>
    write(ctx, "UPDATE session_models SET thinking_level = ?, updated_at = ?, revision = revision + 1 WHERE durable_id = ?", [request.thinking_level, request.now, request.durable_id]) > 0)
}

function observe(ctx: StoreContext, request: ObserveModelRequest, row: SqlRow): void {
  const to = [request.to.provider, request.to.id]
  const thinking = request.thinking_level
  if (request.source === "fallback") {
    // A second fallback in the same window keeps the model the first one overrode.
    const chosen = row.provenance === "fallback" ? [row.chosen_provider, row.chosen_model_id, row.chosen_provenance] : [row.provider, row.model_id, row.provenance]
    write(ctx, `UPDATE session_models SET provider = ?, model_id = ?, thinking_level = COALESCE(?, thinking_level), provenance = 'fallback', reason = ?, chosen_provider = ?, chosen_model_id = ?, chosen_provenance = ?, updated_at = ?, revision = revision + 1, ${CLEAR_PENDING} WHERE durable_id = ?`, [
      ...to, thinking, request.reason, nullable(chosen[0]), nullable(chosen[1]), nullable(chosen[2]), request.now, request.durable_id,
    ])
    return
  }
  if (request.source === "fallback-revert") {
    // The engine still switched: the revision moves, so a command holding an older read-back loses its swap.
    if (row.provenance !== "fallback") {
      write(ctx, `UPDATE session_models SET updated_at = ?, revision = revision + 1, ${CLEAR_PENDING} WHERE durable_id = ?`, [request.now, request.durable_id])
      return
    }
    write(ctx, `UPDATE session_models SET provider = ?, model_id = ?, thinking_level = COALESCE(?, thinking_level), provenance = COALESCE(chosen_provenance, 'set'), reason = NULL, updated_at = ?, revision = revision + 1, ${CLEAR_PENDING} WHERE durable_id = ?`, [...to, thinking, request.now, request.durable_id])
    return
  }
  // `set` or `cycle`: an explicit switch. The gateway writes its own setter after the engine switched,
  // so the switch the session observes for the model the record already names as set keeps that setter;
  // a held set-model's switch landing takes the setter that call recorded as pending. Any other is the user's.
  const same = row.provider === request.to.provider && row.model_id === request.to.id && row.provenance === "set"
  const held = row.pending_provider === request.to.provider && row.pending_model_id === request.to.id
  const setBy = same ? nullable(row.set_by) : held ? nullable(row.pending_set_by) : "user"
  write(ctx, `UPDATE session_models SET provider = ?, model_id = ?, thinking_level = COALESCE(?, thinking_level), provenance = 'set', set_by = ?, reason = NULL, chosen_provider = ?, chosen_model_id = ?, chosen_provenance = 'set', updated_at = ?, revision = revision + 1, ${CLEAR_PENDING} WHERE durable_id = ?`, [
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

/** One session's record with its revision, null when it has none; a plain read that takes no write lock. */
export function sessionModelRecord(ctx: StoreContext, durableId: string): SessionModelRecord | null {
  const row = selectModel(ctx, durableId)
  return row === undefined ? null : recordFrom(row)
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
