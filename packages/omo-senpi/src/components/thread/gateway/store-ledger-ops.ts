/**
 * The sub-session ledger (#15221 row 25), worker side: who opened which thread (`thread_creations`) and one opaque JSON
 * value per thread (`thread_metadata`). Rows are keyed by durable session ids; the device columns are hints, so a store
 * restored under a new device id still resolves. The opener's device and the hosting device each record a creation, and
 * a second record of the same pair only fills a device it did not know.
 */
import { THREAD_METADATA_MAX_BYTES } from "./constants"
import { transaction, type StoreContext } from "./store-ops"

export type ThreadCreationRequest = {
  readonly now: number
  readonly creator_durable_id: string
  readonly created_durable_id: string
  readonly creator_device?: string
  readonly created_device?: string
}

export type ThreadOpener = {
  readonly creator_durable_id: string
  readonly creator_device: string | null
  readonly created_at: number
}

export type ThreadChild = {
  readonly created_durable_id: string
  readonly created_device: string | null
  readonly created_at: number
}

export type HandOverRequest = {
  readonly now: number
  readonly created_durable_id: string
  readonly from_durable_id: string
  readonly to_durable_id: string
  readonly to_device?: string
}

export type HandOverResult =
  | { readonly kind: "ok" }
  | { readonly kind: "refused"; readonly code: "not_creator"; readonly message: string }

export type SetMetadataRequest = {
  readonly now: number
  readonly durable_id: string
  readonly value: unknown
  readonly updated_by?: string
}

export type SetMetadataResult =
  | { readonly kind: "ok" }
  | { readonly kind: "refused"; readonly code: "metadata_too_large"; readonly bytes: number; readonly limit: number }
  | { readonly kind: "refused"; readonly code: "invalid_arguments"; readonly message: string }

export type ThreadMetadata = { readonly value: unknown; readonly updated_by: string | null; readonly updated_at: number }

const OPENER_SQL =
  "SELECT creator_durable_id, creator_device, created_at FROM thread_creations WHERE created_durable_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"

function openerOf(ctx: StoreContext, created: string): ThreadOpener | undefined {
  const row = ctx.sql.one(["creator_durable_id", "creator_device", "created_at"], OPENER_SQL, [created])
  return row === undefined
    ? undefined
    : {
        creator_durable_id: String(row["creator_durable_id"]),
        creator_device: row["creator_device"] === null ? null : String(row["creator_device"]),
        created_at: Number(row["created_at"]),
      }
}

/** Whether `creator` opened `created`: a session op's `caller_created_target` reads it. */
export function createdBy(ctx: StoreContext, creator: string, created: string): boolean {
  return openerOf(ctx, created)?.creator_durable_id === creator
}

export async function recordThreadCreation(ctx: StoreContext, request: ThreadCreationRequest): Promise<void> {
  await transaction(ctx, "record_thread_creation", () => {
    // A thread has one opener. A child re-records its first opener on every start; after a hand-over that is stale.
    const opener = openerOf(ctx, request.created_durable_id)
    if (opener !== undefined && opener.creator_durable_id !== request.creator_durable_id) return
    ctx.sql.run(
      `INSERT INTO thread_creations (creator_durable_id, created_durable_id, created_at, creator_device, created_device)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (creator_durable_id, created_durable_id) DO UPDATE SET
         creator_device = COALESCE(creator_device, excluded.creator_device),
         created_device = COALESCE(created_device, excluded.created_device)`,
      [
        request.creator_durable_id,
        request.created_durable_id,
        request.now,
        request.creator_device ?? null,
        request.created_device ?? null,
      ],
    )
  })
}

export function threadOpener(ctx: StoreContext, created: string): ThreadOpener | undefined {
  return openerOf(ctx, created)
}

/** The openers of several threads at once (a listing's rows), keyed by thread; a thread with none is absent. */
export function threadOpeners(ctx: StoreContext, created: readonly string[]): Record<string, ThreadOpener> {
  const found: Record<string, ThreadOpener> = {}
  for (const id of new Set(created)) {
    const opener = openerOf(ctx, id)
    if (opener !== undefined) found[id] = opener
  }
  return found
}

export function threadChildren(ctx: StoreContext, creator: string): readonly ThreadChild[] {
  return (
    ctx.sql
      .all(
        ["created_durable_id", "created_device", "created_at"],
        "SELECT created_durable_id, created_device, created_at FROM thread_creations WHERE creator_durable_id = ? ORDER BY created_at, created_durable_id",
        [creator],
      )
      .filter((row) => openerOf(ctx, String(row["created_durable_id"]))?.creator_durable_id === creator)
      .map((row) => ({
        created_durable_id: String(row["created_durable_id"]),
        created_device: row["created_device"] === null ? null : String(row["created_device"]),
        created_at: Number(row["created_at"]),
      }))
  )
}

/** Moves a child to another opener; only its current opener may. The row keeps who handed it over. */
export async function handOverThread(ctx: StoreContext, request: HandOverRequest): Promise<HandOverResult> {
  return await transaction(ctx, "hand_over_thread", (): HandOverResult => {
    const opener = openerOf(ctx, request.created_durable_id)
    if (opener?.creator_durable_id !== request.from_durable_id)
      return {
        kind: "refused",
        code: "not_creator",
        message: `${request.from_durable_id} did not open ${request.created_durable_id}; only its opener can hand it over.`,
      }
    const created = ctx.sql.one(
      ["created_device"],
      "SELECT created_device FROM thread_creations WHERE creator_durable_id = ? AND created_durable_id = ?",
      [request.from_durable_id, request.created_durable_id],
    )
    ctx.sql.run("DELETE FROM thread_creations WHERE created_durable_id = ?", [request.created_durable_id])
    ctx.sql.run(
      `INSERT INTO thread_creations (creator_durable_id, created_durable_id, created_at, creator_device, created_device, handed_over_from)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        request.to_durable_id,
        request.created_durable_id,
        request.now,
        request.to_device ?? null,
        created === undefined || created["created_device"] === null ? null : String(created["created_device"]),
        request.from_durable_id,
      ],
    )
    return { kind: "ok" }
  })
}

/** One JSON value per thread, at most 4 KB in UTF-8 bytes: a larger value is refused, never cut. */
export async function setThreadMetadata(ctx: StoreContext, request: SetMetadataRequest): Promise<SetMetadataResult> {
  const json = JSON.stringify(request.value)
  if (json === undefined)
    return { kind: "refused", code: "invalid_arguments", message: "metadata must be a JSON value." }
  const bytes = Buffer.byteLength(json, "utf8")
  if (bytes > THREAD_METADATA_MAX_BYTES)
    return { kind: "refused", code: "metadata_too_large", bytes, limit: THREAD_METADATA_MAX_BYTES }
  await transaction(ctx, "set_thread_metadata", () => {
    ctx.sql.run(
      `INSERT INTO thread_metadata (durable_id, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (durable_id) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [request.durable_id, json, request.updated_by ?? null, request.now],
    )
  })
  return { kind: "ok" }
}

export function threadMetadata(ctx: StoreContext, durableId: string): ThreadMetadata | undefined {
  const row = ctx.sql.one(
    ["value_json", "updated_by", "updated_at"],
    "SELECT value_json, updated_by, updated_at FROM thread_metadata WHERE durable_id = ?",
    [durableId],
  )
  return row === undefined
    ? undefined
    : {
        value: JSON.parse(String(row["value_json"])) as unknown,
        updated_by: row["updated_by"] === null ? null : String(row["updated_by"]),
        updated_at: Number(row["updated_at"]),
      }
}
