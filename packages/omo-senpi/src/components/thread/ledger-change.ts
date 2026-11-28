import type { ExtensionFacade } from "./gateway/store-extension-facade"

/** The `extension_request` a hand-over or a metadata change sends each other device it touches (#15221 row 25). */
export const THREAD_LEDGER_RPC = "omo.thread.ledger"

export type LedgerChange =
  | {
      readonly op: "hand_over"
      readonly created: string
      readonly from: string
      readonly to: string
      readonly to_device?: string
    }
  | { readonly op: "set_metadata"; readonly thread: string; readonly value: unknown; readonly updated_by?: string }

export type LedgerAnswer =
  | { readonly kind: "ok" }
  | { readonly kind: "refused"; readonly code: string; readonly message: string; readonly bytes?: number; readonly limit?: number }

type LedgerStore = Pick<
  ExtensionFacade,
  "threadOpener" | "recordThreadCreation" | "handOverThread" | "setThreadMetadata"
>

const text = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined)

export function ledgerChangeOf(data: unknown): LedgerChange | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const record = data as Readonly<Record<string, unknown>>
  const toDevice = text(record["to_device"])
  const updatedBy = text(record["updated_by"])
  if (record["op"] === "hand_over") {
    const [created, from, to] = [text(record["created"]), text(record["from"]), text(record["to"])]
    if (created === undefined || from === undefined || to === undefined) return undefined
    return { op: "hand_over", created, from, to, ...(toDevice === undefined ? {} : { to_device: toDevice }) }
  }
  const thread = text(record["thread"])
  if (record["op"] === "set_metadata" && thread !== undefined && "value" in record)
    return { op: "set_metadata", thread, value: record["value"], ...(updatedBy === undefined ? {} : { updated_by: updatedBy }) }
  return undefined
}

/**
 * Applies one change to this device's store, on the device that asked and on every other device it touches. A device
 * that has the child's row hands it over only from the opener it records; one that has none (the new opener's device)
 * records the new opener; one that already names the new opener has nothing to do, so a repeated request is harmless.
 */
export async function applyLedgerChange(store: LedgerStore, change: LedgerChange): Promise<LedgerAnswer> {
  if (change.op === "set_metadata") {
    const set = await store.setThreadMetadata({
      durable_id: change.thread,
      value: change.value,
      ...(change.updated_by === undefined ? {} : { updated_by: change.updated_by }),
    })
    if (set.kind === "ok") return set
    return set.code === "metadata_too_large"
      ? { ...set, message: `metadata is ${set.bytes} bytes; the limit is ${set.limit}.` }
      : set
  }
  const opener = await store.threadOpener(change.created)
  if (opener?.creator_durable_id === change.to) return { kind: "ok" }
  if (opener === undefined) {
    await store.recordThreadCreation({
      creator_durable_id: change.to,
      created_durable_id: change.created,
      ...(change.to_device === undefined ? {} : { creator_device: change.to_device }),
    })
    return { kind: "ok" }
  }
  return await store.handOverThread({
    created_durable_id: change.created,
    from_durable_id: change.from,
    to_durable_id: change.to,
    ...(change.to_device === undefined ? {} : { to_device: change.to_device }),
  })
}

export async function answerLedgerRequest(store: LedgerStore, data: unknown): Promise<LedgerAnswer> {
  const change = ledgerChangeOf(data)
  if (change === undefined)
    return { kind: "refused", code: "invalid_arguments", message: "The ledger request is not a hand_over or set_metadata change." }
  return await applyLedgerChange(store, change)
}
